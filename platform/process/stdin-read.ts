import { spawnSync } from 'node:child_process';

/**
 * Synchronous stdin read with a hard timeout. Hook entry points run before any
 * async machinery exists. A separate child owns the blocking read so the
 * timeout can terminate the reader itself; an unref'd Worker cannot be
 * cancelled while it is blocked in fs.readSync and leaves the hook process
 * alive after the caller has already received a timeout.
 */
// Hook hosts normally write their JSON payload immediately. Two seconds is a
// generous scheduling window while keeping a broken or silent pipe from
// adding the old ten-second pause to every guarded tool call.
const DEFAULT_STDIN_TIMEOUT_MS = 2_000;
const STDIN_BYTE_LIMIT = 1024 * 1024;

const READ_STDIN_CHILD = `
const fs = require('node:fs');
const limit = ${STDIN_BYTE_LIMIT};
const chunks = [];
let length = 0;
const chunk = Buffer.alloc(65536);
try {
  while (length < limit) {
    const read = fs.readSync(0, chunk, 0, Math.min(chunk.length, limit - length), null);
    if (read === 0) break;
    chunks.push(Buffer.from(chunk.subarray(0, read)));
    length += read;
  }
} catch {}
process.stdout.write(Buffer.concat(chunks, length));
`;

export interface StdinReadResult {
  /** null when the host never provided input within the timeout. */
  text: string | null;
}

export function readStdinTextWithTimeout(timeoutMs = DEFAULT_STDIN_TIMEOUT_MS): StdinReadResult {
  if (process.stdin.isTTY) return { text: '' };
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) return { text: null };
  const result = spawnSync(process.execPath, ['-e', READ_STDIN_CHILD], {
    stdio: ['inherit', 'pipe', 'ignore'],
    timeout: Math.ceil(timeoutMs),
    maxBuffer: STDIN_BYTE_LIMIT,
    encoding: 'buffer',
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    // A timeout or an unavailable child must not fall back to a direct read:
    // the host may still hold the pipe open, which was the original hang.
    return { text: null };
  }
  return { text: result.stdout.toString('utf8') };
}
