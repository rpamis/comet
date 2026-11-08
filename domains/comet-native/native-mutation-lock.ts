import { promises as fs } from 'fs';
import path from 'path';
import { RaceSafeReadError } from '../../platform/fs/race-safe-read.js';

import { assertNoPendingNativeRootMove } from './native-config.js';
import {
  acquireNativeLock,
  diagnoseNativeLock,
  releaseNativeLock,
  type NativeLock,
  takeOverNativeStaleLock,
} from './native-lock.js';
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

function isChangingNativeLockObservation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (current instanceof RaceSafeReadError && current.reason === 'changed') return true;
    current = current.cause;
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
      if (isChangingNativeLockObservation(error) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        continue;
      }
      const cause = (error as Error & { cause?: NodeJS.ErrnoException }).cause;
      if (cause?.code !== 'EEXIST') throw error;
      let diagnosis;
      try {
        diagnosis = await diagnoseNativeLock(file);
      } catch (observation) {
        if (!isChangingNativeLockObservation(observation) || Date.now() >= deadline)
          throw observation;
        await new Promise((resolve) => setTimeout(resolve, 5));
        continue;
      }
      if (diagnosis.status === 'missing') continue;
      if (diagnosis.status === 'unknown' && Date.now() < deadline) {
        try {
          await fs.lstat(file);
        } catch (missing) {
          if ((missing as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw missing;
        }
      }
      if (diagnosis.status === 'stale') {
        // A dead-owner lock on this host is leftover from a crash; taking it
        // over here spares the user a doctor round-trip. The takeover still
        // verifies owner identity before removing the file.
        const takeover = await takeOverNativeStaleLock(paths, file, diagnosis);
        if (takeover.status === 'removed' || takeover.status === 'missing') continue;
        throw error;
      }
      if (diagnosis.status !== 'active' || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.floor(Math.random() * 11)));
    }
  }
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
