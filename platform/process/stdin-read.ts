/**
 * Hook input is read asynchronously in the normal path. Keeping the legacy
 * synchronous helper non-blocking preserves the small public test seam without
 * spawning a Node child for every Hook invocation.
 */
// Hook hosts normally write their JSON payload immediately. Two seconds is a
// generous scheduling window while keeping a broken or silent pipe from
// adding the old ten-second pause to every guarded tool call.
const DEFAULT_STDIN_TIMEOUT_MS = 2_000;
const STDIN_BYTE_LIMIT = 1024 * 1024;

export interface StdinReadResult {
  /** null when the host never provided input within the timeout. */
  text: string | null;
}

export function readStdinTextWithTimeout(timeoutMs = DEFAULT_STDIN_TIMEOUT_MS): StdinReadResult {
  if (process.stdin.isTTY) return { text: '' };
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) return { text: null };
  if (process.stdin.readableEnded) return { text: '' };
  const value = process.stdin.read();
  if (value === null) return { text: null };
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  return { text: text.slice(0, STDIN_BYTE_LIMIT) };
}

/**
 * Read one Hook payload without blocking the event loop or creating a helper
 * process. A silent host resolves with null at the deadline, allowing the
 * caller to fail closed and return control to the host.
 */
export async function readStdinTextWithTimeoutAsync(
  timeoutMs = DEFAULT_STDIN_TIMEOUT_MS,
): Promise<StdinReadResult> {
  if (process.stdin.isTTY) return { text: '' };
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) return { text: null };
  if (process.stdin.readableEnded) return { text: '' };

  return await new Promise<StdinReadResult>((resolve) => {
    let settled = false;
    let length = 0;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => finish({ text: null }), Math.ceil(timeoutMs));

    const finish = (result: StdinReadResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('close', onClose);
      process.stdin.removeListener('error', onError);
      process.stdin.pause();
      resolve(result);
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = STDIN_BYTE_LIMIT - length;
      if (remaining <= 0) {
        finish({ text: null });
        return;
      }
      const bounded = buffer.subarray(0, remaining);
      chunks.push(bounded);
      length += bounded.length;
      if (buffer.length > bounded.length) finish({ text: null });
    };
    const onEnd = () => finish({ text: Buffer.concat(chunks, length).toString('utf8') });
    const onClose = () => {
      if (!process.stdin.readableEnded) finish({ text: null });
    };
    const onError = () => finish({ text: null });

    process.stdin.on('data', onData);
    process.stdin.once('end', onEnd);
    process.stdin.once('close', onClose);
    process.stdin.once('error', onError);
    timer.unref();
    process.stdin.resume();
  });
}
