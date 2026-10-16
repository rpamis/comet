import { StringDecoder } from 'node:string_decoder';

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
 * Search argument-array target batches with a shared output and lifetime budget.
 * The domain supplies only validated project-relative targets and fixed
 * strings; this adapter owns process and platform details.
 */
export async function runBoundedRipgrep(options: RipgrepRunOptions): Promise<RipgrepRunResult> {
  const separator = options.args.indexOf('--');
  const prefix = separator < 0 ? options.args : options.args.slice(0, separator + 1);
  const argumentSize = (value: string): number => value.length * 2 + 3;
  const prefixSize =
    argumentSize(options.command ?? 'rg') +
    prefix.reduce((sum, arg) => sum + argumentSize(arg), 512);
  const batches: string[][] = [];
  let batch = [...prefix];
  let size = prefixSize;
  for (const target of separator < 0 ? [] : options.args.slice(separator + 1)) {
    if (batch.length > prefix.length && size + argumentSize(target) > 24000) {
      batches.push(batch);
      batch = [...prefix];
      size = prefixSize;
    }
    batch.push(target);
    size += argumentSize(target);
  }
  batches.push(batch);
  if (batches.length === 1) return runRipgrepProcess(options);

  const started = performance.now();
  let stdout = '';
  let stderr = '';
  let matches = 0;
  let found = false;
  for (const args of batches) {
    const timeoutMs = options.timeoutMs - (performance.now() - started);
    const maxOutputBytes =
      options.maxOutputBytes - Buffer.byteLength(stdout) - Buffer.byteLength(stderr);
    if (timeoutMs <= 0 || maxOutputBytes <= 0 || matches >= options.maxMatches)
      return {
        stdout,
        stderr,
        exitCode: null,
        timedOut: timeoutMs <= 0,
        truncated: maxOutputBytes <= 0,
        matchLimitReached: matches >= options.maxMatches,
      };
    const result = await runRipgrepProcess({
      ...options,
      args,
      timeoutMs,
      maxOutputBytes,
      maxMatches: options.maxMatches - matches,
    });
    stdout += result.stdout;
    stderr += result.stderr;
    matches += result.stdout
      .split('\n')
      .filter((line) => /"type"\s*:\s*"match"/u.test(line)).length;
    found ||= result.exitCode === 0;
    if (
      result.error ||
      result.timedOut ||
      result.truncated ||
      result.matchLimitReached ||
      (result.exitCode !== null && result.exitCode > 1)
    )
      return { ...result, stdout, stderr };
  }
  return {
    stdout,
    stderr,
    exitCode: found ? 0 : 1,
    timedOut: false,
    truncated: false,
    matchLimitReached: false,
  };
}

async function runRipgrepProcess(options: RipgrepRunOptions): Promise<RipgrepRunResult> {
  let child: ReturnType<typeof spawnCommand>;
  try {
    child = spawnCommand(options.command ?? 'rg', options.args, { cwd: options.cwd });
  } catch (error) {
    return {
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: false,
      truncated: false,
      matchLimitReached: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stdoutReceivedBytes = 0;
  let stderrBytes = 0;
  let matchEvents = 0;
  let stdoutPending = '';
  const stdoutDecoder = new StringDecoder('utf8');
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
    if (stdoutReceivedBytes >= options.maxOutputBytes || matchLimitReached) {
      truncated ||= stdoutReceivedBytes >= options.maxOutputBytes;
      return;
    }
    const remaining = options.maxOutputBytes - stdoutReceivedBytes;
    const bounded = chunk.subarray(0, remaining);
    stdoutReceivedBytes += bounded.byteLength;
    const text = stdoutPending + stdoutDecoder.write(bounded);
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
      stdoutPending = '';
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
      stdoutPending += stdoutDecoder.end();
      if (
        stdoutPending &&
        !truncated &&
        !matchLimitReached &&
        stdoutBytes < options.maxOutputBytes
      ) {
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
