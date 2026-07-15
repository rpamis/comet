import { promises as fs } from 'fs';
import path from 'path';

import { assertNoPendingNativeRootMove } from './native-config.js';
import {
  acquireNativeLock,
  diagnoseNativeLock,
  releaseNativeLock,
  type NativeLock,
} from './native-lock.js';
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
  allowedTransactionId?: string,
): Promise<NativeLock> {
  try {
    return await acquireNativeLock(paths, 'root-move', operation);
  } catch (error) {
    const file = path.join(paths.locksDir, 'root-move.lock');
    const diagnosis = await diagnoseNativeLock(file);
    if (diagnosis.status !== 'stale') throw error;
    await assertNoPendingNativeRootMove(paths.projectRoot);
    if (await hasUnfinishedTransaction(paths, allowedTransactionId)) throw error;
    await fs.rm(file, { force: true });
    return acquireNativeLock(paths, 'root-move', operation);
  }
}

export async function withNativeMutationLock<T>(
  paths: NativeProjectPaths,
  operation: string,
  work: () => Promise<T>,
  options?: { allowedTransactionId?: string },
): Promise<T> {
  const lock = await acquireNativeMutationLock(paths, operation, options?.allowedTransactionId);
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
