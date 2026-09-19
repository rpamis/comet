import { readSync } from 'node:fs';
import { Worker } from 'node:worker_threads';

/**
 * Synchronous stdin read with a hard timeout. Hook entry points run before any
 * async machinery exists, and a host that spawns the hook but never writes or
 * closes the pipe would otherwise block `readFileSync(0)` forever — hanging every
 * tool call. The read happens on a detached worker thread; the main thread waits
 * on a shared flag for at most `timeoutMs` and proceeds without input on timeout.
 */
const DEFAULT_STDIN_TIMEOUT_MS = 10_000;
const STDIN_BYTE_LIMIT = 1024 * 1024;

// Layout: [length, flag] as Int32 words, then raw bytes.
const HEADER_BYTES = 8;
const FLAG_PENDING = 0;
const FLAG_DONE = 1;

const READ_STDIN_WORKER = `
const { workerData } = require('node:worker_threads');
const fs = require('node:fs');
const view = new Int32Array(workerData.buffer, 0, 2);
const bytes = new Uint8Array(workerData.buffer, ${HEADER_BYTES});
let length = 0;
const chunk = Buffer.alloc(65536);
try {
  while (length < bytes.length) {
    const read = fs.readSync(0, chunk, 0, Math.min(chunk.length, bytes.length - length), null);
    if (read === 0) break;
    chunk.copy(bytes, length, 0, read);
    length += read;
  }
} catch {}
view[0] = length;
Atomics.store(view, 1, ${FLAG_DONE});
Atomics.notify(view, 1);
`;

export interface StdinReadResult {
  /** null when the host never provided input within the timeout. */
  text: string | null;
}

export function readStdinTextWithTimeout(timeoutMs = DEFAULT_STDIN_TIMEOUT_MS): StdinReadResult {
  if (process.stdin.isTTY) return { text: '' };
  const buffer = new SharedArrayBuffer(HEADER_BYTES + STDIN_BYTE_LIMIT);
  const view = new Int32Array(buffer, 0, 2);
  const bytes = new Uint8Array(buffer, HEADER_BYTES);
  let worker: Worker;
  try {
    worker = new Worker(READ_STDIN_WORKER, { eval: true, workerData: { buffer } });
  } catch {
    // A worker cannot start in this environment; fall back to the direct read.
    return { text: readStdinDirect(bytes) };
  }
  worker.unref();
  const waitResult = Atomics.wait(view, 1, FLAG_PENDING, timeoutMs);
  if (waitResult === 'timed-out') return { text: null };
  const length = Atomics.load(view, 0);
  return { text: Buffer.from(bytes.buffer, bytes.byteOffset, length).toString('utf8') };
}

function readStdinDirect(bytes: Uint8Array): string {
  let length = 0;
  const chunk = Buffer.alloc(64 * 1024);
  try {
    while (length < bytes.length) {
      const read = readSync(0, chunk, 0, Math.min(chunk.length, bytes.length - length), null);
      if (read === 0) break;
      chunk.copy(bytes, length, 0, read);
      length += read;
    }
  } catch {
    // Reads past a closed pipe or on a broken descriptor leave whatever arrived.
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, length).toString('utf8');
}
