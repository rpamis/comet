import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { openSqliteDatabase } from './sqlite.js';
import { remainingOperationMs, throwIfOperationAborted } from '../process/operation-budget.js';

export interface RecoverableFileLockOwner {
  readonly nonce: string;
  readonly createdAt: number;
  readonly operation?: string;
}
export interface RecoverableFileLockOptions {
  readonly timeoutMs?: number;
  readonly retryMs?: number;
  readonly operation?: string;
  /** Accepted for callers upgrading from the old record format. */
  readonly malformedLockStaleMs?: number;
}
export interface RecoverableFileLockDiagnosis {
  readonly status: 'missing' | 'active' | 'stale' | 'unknown' | 'malformed';
  readonly owner: RecoverableFileLockOwner | null;
  readonly token: string | null;
  readonly coordinator?: Array<{
    file: string;
    status: 'active' | 'unknown' | 'malformed';
    owner: RecoverableFileLockOwner | null;
    token: string;
  }>;
}

async function metadata(
  file: string,
): Promise<{ owner: RecoverableFileLockOwner | null; token: string } | null> {
  let content: string;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('File lock metadata must be a regular file: ' + file);
    content = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const value = JSON.parse(content);
    const nonce = value.nonce ?? value.id;
    const createdAt =
      typeof value.createdAt === 'number' ? value.createdAt : Date.parse(value.createdAt);
    if (typeof nonce === 'string' && nonce && Number.isFinite(createdAt)) {
      return {
        owner: {
          nonce,
          createdAt,
          ...(typeof value.operation === 'string' ? { operation: value.operation } : {}),
        },
        token: nonce,
      };
    }
  } catch {
    /* Old malformed metadata is never a process identity. */
  }
  return { owner: null, token: 'unparsed' };
}

async function openTransaction(file: string) {
  const databaseFile = file + '.sqlite';
  try {
    const stat = await fs.lstat(databaseFile);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('File lock database must be a regular file: ' + databaseFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let database: ReturnType<typeof openSqliteDatabase>;
  try {
    database = openSqliteDatabase(path.toNamespacedPath(databaseFile));
  } catch (error) {
    throw new Error('Unable to open Runtime lock database ' + databaseFile, { cause: error });
  }
  try {
    database.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE;');
    return database;
  } catch (error) {
    database.close();
    if (/database is (?:locked|busy)/iu.test(String(error))) return null;
    throw new Error('Unable to acquire Runtime lock transaction ' + databaseFile, { cause: error });
  }
}
function closeTransaction(database: NonNullable<Awaited<ReturnType<typeof openTransaction>>>) {
  try {
    database.exec('ROLLBACK;');
  } finally {
    database.close();
  }
}

/** A transaction is held by the open connection and released by the OS on process exit. */
export async function acquireRecoverableFileLock(
  file: string,
  options: RecoverableFileLockOptions = {},
) {
  file = path.resolve(file);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const parent = await fs.lstat(path.dirname(file));
  if (!parent.isDirectory() || parent.isSymbolicLink())
    throw new Error('File lock parent must be a real directory: ' + path.dirname(file));
  const deadline = performance.now() + remainingOperationMs(options.timeoutMs ?? 30_000);
  let database: Awaited<ReturnType<typeof openTransaction>>;
  for (;;) {
    throwIfOperationAborted();
    database = await openTransaction(file);
    if (database) break;
    if (performance.now() >= deadline) throw new Error('Timed out waiting for file lock: ' + file);
    await new Promise((resolve) => setTimeout(resolve, options.retryMs ?? 20));
  }
  const owner: RecoverableFileLockOwner = {
    nonce: randomUUID(),
    createdAt: Date.now(),
    ...(options.operation ? { operation: options.operation } : {}),
  };
  try {
    if (await metadata(file)) await fs.unlink(file);
    await fs.writeFile(file, JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
  } catch (error) {
    closeTransaction(database);
    throw error;
  }
  let released = false;
  return {
    owner,
    async release() {
      if (released) return;
      released = true;
      try {
        if ((await metadata(file))?.token === owner.nonce) await fs.unlink(file);
      } finally {
        closeTransaction(database);
      }
    },
  };
}

/** Metadata is diagnostic only; an old PID record cannot keep an unlocked transaction held. */
export async function diagnoseRecoverableFileLock(
  file: string,
): Promise<RecoverableFileLockDiagnosis> {
  file = path.resolve(file);
  const record = await metadata(file);
  try {
    await fs.access(file + '.sqlite');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return record
        ? { status: record.owner ? 'stale' : 'malformed', ...record }
        : { status: 'missing', owner: null, token: null };
    throw error;
  }
  const database = await openTransaction(file);
  if (!database)
    return { status: 'active', owner: record?.owner ?? null, token: record?.token ?? null };
  closeTransaction(database);
  return record
    ? { status: record.owner ? 'stale' : 'malformed', ...record }
    : { status: 'missing', owner: null, token: null };
}

export async function repairRecoverableFileLock(
  file: string,
  expectedToken: string,
  options: { confirmedOwnerStopped?: boolean } = {},
): Promise<'removed' | 'missing' | 'changed' | 'blocked'> {
  file = path.resolve(file);
  const record = await metadata(file);
  if (!record) return 'missing';
  if (record.token !== expectedToken) return 'changed';
  const database = await openTransaction(file);
  if (!database) return 'blocked';
  try {
    const current = await metadata(file);
    if (!current) return 'missing';
    if (current.token !== expectedToken) return 'changed';
    if (!current.owner && !options.confirmedOwnerStopped) return 'blocked';
    await fs.unlink(file);
    return 'removed';
  } finally {
    closeTransaction(database);
  }
}

export async function withRecoverableFileLock<T>(
  file: string,
  operation: () => Promise<T>,
  options: RecoverableFileLockOptions = {},
): Promise<T> {
  const lock = await acquireRecoverableFileLock(file, options);
  try {
    return await operation();
  } finally {
    await lock.release();
  }
}
