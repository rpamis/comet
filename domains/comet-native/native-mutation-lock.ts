import { promises as fs } from 'fs';

import { assertNoPendingNativeRootMove } from './native-config.js';
import { acquireNativeLock, releaseNativeLock, type NativeLock } from './native-lock.js';
import { readNativeTransaction } from './native-transaction.js';
import type { NativeProjectPaths } from './native-types.js';

async function hasUnfinishedTransaction(
  paths: NativeProjectPaths,
  allowedTransactionId?: string,
): Promise<boolean> {
  let entries;
  try {
    entries = await fs.readdir(paths.transactionsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    try {
      const transaction = await readNativeTransaction(paths, entry.name);
      if (
        transaction.id !== allowedTransactionId &&
        transaction.status !== 'committed' &&
        transaction.status !== 'rolled-back'
      ) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

async function acquireNativeMutationLock(
  paths: NativeProjectPaths,
  operation: string,
): Promise<NativeLock> {
  return acquireNativeLock(paths, 'root-move', operation);
}

export async function withNativeMutationLock<T>(
  paths: NativeProjectPaths,
  operation: string,
  work: () => Promise<T>,
  options?: { allowedTransactionId?: string },
): Promise<T> {
  const lock = await acquireNativeMutationLock(paths, operation);
  try {
    await assertNoPendingNativeRootMove(paths.projectRoot);
    if (await hasUnfinishedTransaction(paths, options?.allowedTransactionId)) {
      throw new Error('Native transaction recovery is required before another mutation');
    }
    return await work();
  } finally {
    await releaseNativeLock(lock);
  }
}
