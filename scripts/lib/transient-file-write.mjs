import { promises as fs } from 'node:fs';

const RETRYABLE_WRITE_CODES = new Set(['UNKNOWN', 'EPERM', 'EACCES', 'EBUSY']);
const DEFAULT_DELAYS_MS = [50, 100, 150, 200];

export async function withTransientFileWriteRetry(
  operation,
  {
    delaysMs = DEFAULT_DELAYS_MS,
    wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  } = {},
) {
  let lastError;
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === delaysMs.length || !RETRYABLE_WRITE_CODES.has(error?.code)) throw error;
      await wait(delaysMs[attempt]);
    }
  }
  throw lastError;
}

export async function writeFileWithTransientRetry(outputFile, output) {
  await withTransientFileWriteRetry(() => fs.writeFile(outputFile, output));
}
