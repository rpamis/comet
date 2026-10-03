import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import { measureCometGitCommand, measureCometGitCommandAsync } from './runtime-metrics.js';

import { assertSafeWindowsBatchArguments, resolveWindowsCommand } from './spawn-command.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/** 异步执行有时限的探测；超时直接结束等待，不依赖子进程关闭管道。 */
export async function runExternalCommandAsync(
  command: string,
  args: readonly string[],
  options: ExternalCommandOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isSafeInteger(maxBuffer) ||
    maxBuffer < 1
  ) {
    throw new Error('External command limits must be positive integers');
  }
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const resolved =
    process.platform === 'win32' ? resolveWindowsCommand(command, env, cwd) : command;
  const batch = process.platform === 'win32' && /\.(?:bat|cmd)$/iu.test(resolved);
  if (batch) assertSafeWindowsBatchArguments(args);
  const execute = () =>
    new Promise<string>((resolve, reject) => {
      let settled = false;
      const child = execFile(
        resolved,
        [...args],
        {
          cwd,
          env,
          encoding: 'utf8',
          maxBuffer,
          windowsHide: true,
          shell: batch,
        },
        (error, stdout, stderr) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', abort);
          if (error)
            reject(
              new ExternalCommandError(command, args, stderr.trim(), {
                cause: error,
                timedOut: commandTimedOut(error),
              }),
            );
          else resolve(stdout);
        },
      );
      const stop = (timedOut: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        child.kill('SIGKILL');
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
        reject(new ExternalCommandError(command, args, '', { timedOut }));
      };
      const abort = () => stop(false);
      const timer = setTimeout(() => stop(true), timeoutMs);
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      child.stdin?.end(options.input);
    });
  return /^(?:git|git\.exe)$/iu.test(path.win32.basename(command))
    ? measureCometGitCommandAsync(execute)
    : execute();
}

export interface ExternalCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBufferBytes?: number;
  input?: string;
  signal?: AbortSignal;
}

export class ExternalCommandError extends Error {
  readonly timedOut: boolean;

  constructor(
    readonly command: string,
    readonly args: readonly string[],
    readonly stderr: string,
    options?: ErrorOptions & { timedOut?: boolean },
  ) {
    super(`${command} ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`, options);
    this.name = 'ExternalCommandError';
    this.timedOut = options?.timedOut === true;
  }
}

function commandTimedOut(error: unknown): boolean {
  return (
    error instanceof Error &&
    ((error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ||
      ((error as { killed?: unknown }).killed === true &&
        (error as { signal?: unknown }).signal === 'SIGTERM'))
  );
}

export function runExternalCommand(
  command: string,
  args: readonly string[],
  options: ExternalCommandOptions = {},
): string {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('External command timeout must be a positive integer');
  }
  if (!Number.isSafeInteger(maxBufferBytes) || maxBufferBytes < 1) {
    throw new Error('External command max buffer must be a positive integer');
  }
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const resolvedCommand =
    process.platform === 'win32' ? resolveWindowsCommand(command, env, cwd) : command;
  const extension = path.win32.extname(resolvedCommand).toLowerCase();
  const isWindowsBatchCommand = extension === '.bat' || extension === '.cmd';
  if (process.platform === 'win32' && isWindowsBatchCommand) {
    assertSafeWindowsBatchArguments(args);
  }
  try {
    const execute = () =>
      execFileSync(resolvedCommand, [...args], {
        cwd,
        env,
        ...(options.input !== undefined ? { input: options.input } : {}),
        encoding: 'utf8',
        stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
        maxBuffer: maxBufferBytes,
        windowsHide: true,
        shell: process.platform === 'win32' && isWindowsBatchCommand,
      });
    return /^(?:git|git\.exe)$/iu.test(path.win32.basename(command))
      ? measureCometGitCommand(execute)
      : execute();
  } catch (error) {
    const stderr =
      typeof (error as { stderr?: unknown }).stderr === 'string'
        ? (error as { stderr: string }).stderr.trim()
        : Buffer.isBuffer((error as { stderr?: unknown }).stderr)
          ? (error as { stderr: Buffer }).stderr.toString('utf8').trim()
          : '';
    throw new ExternalCommandError(command, args, stderr, {
      cause: error,
      timedOut: commandTimedOut(error),
    });
  }
}
