import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { terminateProcessTree } from './terminate-process-tree.js';
import { measureCometGitCommand, measureCometGitCommandAsync } from './runtime-metrics.js';

import {
  assertSafeWindowsBatchArguments,
  resolveWindowsCommand,
  commandInvocation,
} from './spawn-command.js';

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
  const invocation = commandInvocation(command, args, { cwd, env });
  if (options.signal?.aborted) throw new ExternalCommandError(command, args, '执行已取消');
  const execute = () =>
    new Promise<string>((resolve, reject) => {
      let settled = false;
      let bytes = 0;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const child = spawn(invocation.command, invocation.args, {
        cwd,
        env: invocation.env,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const cleanup = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
      };
      const stop = (timedOut: boolean, reason = '') => {
        if (settled) return;
        settled = true;
        cleanup();
        void terminateProcessTree(child)
          .catch(() => child.kill('SIGKILL'))
          .finally(() => {
            child.stdin.destroy();
            child.stdout.destroy();
            child.stderr.destroy();
            child.unref();
            reject(new ExternalCommandError(command, args, reason, { timedOut }));
          });
      };
      const abort = () => stop(false, '执行已取消');
      const timer = setTimeout(() => stop(true), timeoutMs);
      const collect = (chunks: Buffer[], chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBuffer) stop(false, '命令输出超过限制');
        else chunks.push(chunk);
      };
      child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new ExternalCommandError(command, args, error.message, { cause: error }));
      });
      child.once('close', (code, signal) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (code !== 0 || signal !== null)
          reject(
            new ExternalCommandError(command, args, Buffer.concat(stderr).toString('utf8').trim()),
          );
        else resolve(Buffer.concat(stdout).toString('utf8'));
      });
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      child.stdin.on('error', () => {});
      child.stdin.end(options.input);
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
        killSignal: 'SIGKILL',
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
