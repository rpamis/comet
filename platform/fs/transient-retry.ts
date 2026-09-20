import { promises as fs } from 'node:fs';

const RETRYABLE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);
const DELAYS_MS = [50, 100, 200];

/**
 * Windows real-time scanners, search indexers, and editors briefly hold
 * handles on files being renamed or removed; a bare rename/unlink then throws
 * EPERM/EACCES even though the operation would succeed a moment later. These
 * helpers retry the transient codes with a short backoff and surface the last
 * error otherwise unchanged.
 */
async function withTransientRetry<T>(operation: () => Promise<T>, _label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt === DELAYS_MS.length || !RETRYABLE_CODES.has(code ?? '')) throw error;
      await new Promise((resolve) => setTimeout(resolve, DELAYS_MS[attempt]));
    }
  }
  throw lastError;
}

export async function renameWithRetry(source: string, target: string): Promise<void> {
  await withTransientRetry(() => fs.rename(source, target), `rename ${target}`);
}

export async function unlinkWithRetry(target: string): Promise<void> {
  await withTransientRetry(() => fs.unlink(target), `unlink ${target}`);
}

export async function linkWithRetry(source: string, target: string): Promise<void> {
  await withTransientRetry(() => fs.link(source, target), `link ${target}`);
}

/** Re-exported read that also tolerates transient Windows sharing violations. */
export async function readFileWithRetry(path: string): Promise<string> {
  return withTransientRetry(() => fs.readFile(path, 'utf8'), `read ${path}`);
}
