import { spawnCommand } from './spawn-command.js';
import { terminateProcessTree } from './terminate-process-tree.js';

export interface RipgrepRunOptions {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly maxMatches: number;
  readonly command?: string;
}

export interface RipgrepRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly truncated: boolean;
  readonly matchLimitReached: boolean;
  readonly error?: Error;
}

/**
 * Run one argument-array ripgrep process with bounded output and lifetime.
 * The domain supplies only validated project-relative targets and fixed
 * strings; this adapter owns process and platform details.
 */
export async function runBoundedRipgrep(options: RipgrepRunOptions): Promise<RipgrepRunResult> {
  const child = spawnCommand(options.command ?? 'rg', options.args, { cwd: options.cwd });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let matchEvents = 0;
  let stdoutPending = '';
  let truncated = false;
  let matchLimitReached = false;
  let timedOut = false;
  let settled = false;
  let timer: NodeJS.Timeout | undefined;

  const terminate = async (): Promise<void> => {
    if (settled) return;
    try {
      await terminateProcessTree(child);
    } catch {
      child.kill('SIGKILL');
    }
  };

  const collectStderr = (chunk: Buffer): void => {
    if (stderrBytes >= options.maxOutputBytes) {
      truncated = true;
      return;
    }
    const remaining = options.maxOutputBytes - stderrBytes;
    const bounded = chunk.subarray(0, remaining);
    stderrChunks.push(Buffer.from(bounded));
    stderrBytes += bounded.byteLength;
    if (bounded.byteLength < chunk.byteLength) {
      truncated = true;
      void terminate();
    }
  };

  const collectStdout = (chunk: Buffer): void => {
    if (stdoutBytes >= options.maxOutputBytes || matchLimitReached) {
      truncated ||= stdoutBytes >= options.maxOutputBytes;
      return;
    }
    const remaining = options.maxOutputBytes - stdoutBytes;
    const bounded = chunk.subarray(0, remaining);
    const text = stdoutPending + bounded.toString('utf8');
    const lines = text.split('\n');
    stdoutPending = lines.pop() ?? '';
    for (const line of lines) {
      if (matchEvents >= options.maxMatches) {
        matchLimitReached = true;
        void terminate();
        break;
      }
      const complete = `${line}\n`;
      const bytes = Buffer.byteLength(complete, 'utf8');
      if (stdoutBytes + bytes > options.maxOutputBytes) {
        truncated = true;
        void terminate();
        break;
      }
      stdoutChunks.push(Buffer.from(complete, 'utf8'));
      stdoutBytes += bytes;
      if (/"type"\s*:\s*"match"/u.test(line)) {
        matchEvents += 1;
        if (matchEvents >= options.maxMatches) {
          matchLimitReached = true;
          void terminate();
          break;
        }
      }
    }
    if (bounded.byteLength < chunk.byteLength) {
      truncated = true;
      void terminate();
    }
  };

  child.stdout.on('data', (chunk: Buffer | string) => collectStdout(Buffer.from(chunk)));
  child.stderr.on('data', (chunk: Buffer | string) => collectStderr(Buffer.from(chunk)));

  const result = await new Promise<RipgrepRunResult>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      void terminate();
    }, options.timeoutMs);
    child.once('error', (error) => {
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: null,
        timedOut,
        truncated,
        matchLimitReached,
        error,
      });
    });
    child.once('close', (code) => {
      settled = true;
      if (timer) clearTimeout(timer);
      if (stdoutPending && !matchLimitReached && stdoutBytes < options.maxOutputBytes) {
        const bytes = Buffer.byteLength(stdoutPending, 'utf8');
        if (stdoutBytes + bytes <= options.maxOutputBytes) {
          stdoutChunks.push(Buffer.from(stdoutPending, 'utf8'));
          stdoutBytes += bytes;
        } else {
          truncated = true;
        }
      }
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code,
        timedOut,
        truncated,
        matchLimitReached,
      });
    });
  });
  return result;
}
