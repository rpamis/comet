import { execFileSync } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export interface ExternalCommandOptions {
  cwd?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
}

export class ExternalCommandError extends Error {
  constructor(
    readonly command: string,
    readonly args: readonly string[],
    readonly stderr: string,
    options?: ErrorOptions,
  ) {
    super(`${command} ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`, options);
    this.name = 'ExternalCommandError';
  }
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
  try {
    return execFileSync(command, [...args], {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      maxBuffer: maxBufferBytes,
      windowsHide: true,
      shell: false,
    });
  } catch (error) {
    const stderr =
      typeof (error as { stderr?: unknown }).stderr === 'string'
        ? (error as { stderr: string }).stderr.trim()
        : Buffer.isBuffer((error as { stderr?: unknown }).stderr)
          ? (error as { stderr: Buffer }).stderr.toString('utf8').trim()
          : '';
    throw new ExternalCommandError(command, args, stderr, { cause: error });
  }
}
