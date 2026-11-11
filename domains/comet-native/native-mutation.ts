import { promises as fs } from 'fs';

import { assertNoPendingNativeRootMove } from './native-config.js';
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

/** 单写入者按当前业务事务边界写入，不创建进程或文件锁。 */
export async function withNativeMutation<T>(
  paths: NativeProjectPaths,
  work: () => Promise<T>,
  options?: {
    allowedTransactionId?: string;
    allowedPortableTransaction?: NativePortableTransactionRef;
  },
): Promise<T> {
  await assertNoPendingNativeRootMove(paths.projectRoot);
  if (
    await hasUnfinishedTransaction(
      paths,
      options?.allowedTransactionId,
      options?.allowedPortableTransaction,
    )
  )
    throw new Error('Native transaction recovery is required before another mutation');
  return work();
}
