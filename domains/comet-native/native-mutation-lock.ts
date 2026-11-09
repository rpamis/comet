import { promises as fs } from 'fs';

import { assertNoPendingNativeRootMove } from './native-config.js';
import { acquireNativeLock, releaseNativeLock, type NativeLock } from './native-lock.js';
import {
  describeNativePortableTransactionEntry,
  isNativePortableTransactionUnfinished,
  readNativePortableTransactionEntry,
  type NativePortableTransactionRef,
} from './native-portable-transactions.js';
import { readNativeTransaction, retireNativeTransaction } from './native-transaction.js';
import type { NativeProjectPaths } from './native-types.js';

async function hasUnfinishedTransaction(
  paths: NativeProjectPaths,
  allowedTransactionId?: string,
  allowedPortableTransaction?: NativePortableTransactionRef,
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
      if (transaction.status === 'committed' || transaction.status === 'rolled-back')
        await retireNativeTransaction(paths, transaction.id);
    } catch {
      return true;
    }
  }
  for (const entry of entries) {
    if (!describeNativePortableTransactionEntry(entry.name)) continue;
    try {
      const transaction = await readNativePortableTransactionEntry(paths, entry.name);
      if (!transaction) continue;
      if (
        allowedPortableTransaction?.kind === transaction.kind &&
        allowedPortableTransaction.change === transaction.change
      ) {
        continue;
      }
      if (isNativePortableTransactionUnfinished(transaction)) return true;
    } catch {
      // A file with an exact portable transaction name must be diagnosed or
      // removed before a mutation can safely cross its unknown boundary.
      return true;
    }
  }
  return false;
}

async function acquireNativeMutationLock(
  paths: NativeProjectPaths,
  operation: string,
): Promise<NativeLock> {
  return acquireNativeLock(paths, 'root-move', operation, { timeoutMs: 5_000 });
}

export async function withNativeMutationLock<T>(
  paths: NativeProjectPaths,
  operation: string,
  work: () => Promise<T>,
  options?: {
    allowedTransactionId?: string;
    allowedPortableTransaction?: NativePortableTransactionRef;
  },
): Promise<T> {
  const lock = await acquireNativeMutationLock(paths, operation);
  try {
    await assertNoPendingNativeRootMove(paths.projectRoot);
    if (
      await hasUnfinishedTransaction(
        paths,
        options?.allowedTransactionId,
        options?.allowedPortableTransaction,
      )
    ) {
      throw new Error('Native transaction recovery is required before another mutation');
    }
    return await work();
  } finally {
    try {
      await releaseNativeLock(lock);
    } catch (error) {
      // The mutation already committed; a release failure (e.g. a scanner
      // holding the lock file on Windows) must not replace the operation
      // result. The stale lock is recoverable: a later acquisition takes over
      // a dead-owner lock, and doctor --repair handles the rest.
      process.stderr.write(
        `[comet] warning: could not release Native mutation lock ${lock.file} (${(error as Error).message}); run comet native doctor --repair if commands start failing
`,
      );
    }
  }
}
