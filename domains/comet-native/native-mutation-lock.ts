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
): Promise<NativeLock> {
  const deadline = Date.now() + 5_000;
  const file = path.join(paths.locksDir, 'root-move.lock');
  while (true) {
    try {
      return await acquireNativeLock(paths, 'root-move', operation);
    } catch (error) {
      const cause = (error as Error & { cause?: NodeJS.ErrnoException }).cause;
      if (cause?.code !== 'EEXIST') throw error;
      const diagnosis = await diagnoseNativeLock(file);
      if (diagnosis.status === 'missing') continue;
      if (diagnosis.status !== 'active' || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.floor(Math.random() * 11)));
    }
  }
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
