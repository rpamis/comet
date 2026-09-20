import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';

import { unlinkWithRetry } from './transient-retry.js';
import path from 'node:path';
import { inspectProcessLiveness, readProcessIdentity } from '../process/process-identity.js';

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_RETRY_MS = 20;
const DEFAULT_MALFORMED_LOCK_STALE_MS = 5 * 60_000;
/**
 * An empty lock file means the creating process crashed between creating the file
 * and writing its owner record — it never held the lock. A short grace covers the
 * in-flight write, so waits recover in seconds instead of the malformed-stale span.
 */
const EMPTY_LOCK_GRACE_MS = 10_000;

interface PluginStoreLockOwner {
  readonly pid: number;
  readonly nonce: string;
  readonly createdAt: number;
  readonly hostname?: string;
  readonly processIdentity?: string;
}

export interface RecoverableFileLockOptions {
  readonly timeoutMs?: number;
  readonly retryMs?: number;
  readonly malformedLockStaleMs?: number;
}

export interface TextFileStore {
  read(): Promise<string | null>;
  write(content: string): Promise<void>;
}

export class JsonFileTextStore implements TextFileStore {
  private readonly filePath: string;

  public constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  public async read(): Promise<string | null> {
    try {
      return await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  public async write(content: string): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, this.filePath);
  }

  public async withLock<T>(operation: () => Promise<T>): Promise<T> {
    return withRecoverableFileLock(`${this.filePath}.lock`, operation);
  }
}

export async function withRecoverableFileLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  options: RecoverableFileLockOptions = {},
): Promise<T> {
  const resolvedLockPath = path.resolve(lockPath);
  await fs.mkdir(path.dirname(resolvedLockPath), { recursive: true });
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const retryMs = options.retryMs ?? DEFAULT_LOCK_RETRY_MS;
  const malformedLockStaleMs = options.malformedLockStaleMs ?? DEFAULT_MALFORMED_LOCK_STALE_MS;
  const processIdentity = await readProcessIdentity(process.pid);
  const owner: PluginStoreLockOwner = {
    pid: process.pid,
    nonce: randomUUID(),
    createdAt: Date.now(),
    hostname: os.hostname(),
    ...(processIdentity === null ? {} : { processIdentity }),
  };
  let acquired = false;
  while (!acquired) {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(resolvedLockPath, 'wx');
      await handle.writeFile(JSON.stringify(owner), 'utf8');
      acquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await recoverAbandonedLock(resolvedLockPath, malformedLockStaleMs)) continue;
      if (Date.now() - started >= timeoutMs) {
        throw new Error(`Timed out waiting for file lock: ${resolvedLockPath}`, {
          cause: error,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    } finally {
      await handle?.close();
    }
  }
  try {
    return await operation();
  } finally {
    await releaseOwnedLock(resolvedLockPath, owner.nonce);
  }
}

async function recoverAbandonedLock(
  lockPath: string,
  malformedLockStaleMs: number,
): Promise<boolean> {
  let content: string;
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    [content, stat] = await Promise.all([fs.readFile(lockPath, 'utf8'), fs.stat(lockPath)]);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
  const owner = parseLockOwner(content);
  if (owner !== null) {
    if (owner.hostname !== undefined && owner.hostname !== os.hostname()) return false;
    const liveness = await inspectProcessLiveness(owner.pid, owner.processIdentity);
    if (liveness !== 'dead') return false;
  }
  if (owner === null) {
    const graceMs = content.trim().length === 0 ? EMPTY_LOCK_GRACE_MS : malformedLockStaleMs;
    if (Date.now() - Number(stat.mtimeMs) < graceMs) {
      return false;
    }
  }
  try {
    if ((await fs.readFile(lockPath, 'utf8')) !== content) return false;
    await fs.rm(lockPath);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

async function releaseOwnedLock(lockPath: string, nonce: string): Promise<void> {
  try {
    const owner = parseLockOwner(await fs.readFile(lockPath, 'utf8'));
    if (owner?.nonce !== nonce) return;
    await unlinkWithRetry(lockPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    // The operation itself already committed; a stuck lock file must not
    // replace the success result. The empty-lock grace recovers it shortly.
    process.stderr.write(
      `[comet] warning: could not remove lock file ${lockPath} (${code ?? error}); it will be recovered automatically
`,
    );
  }
}

function parseLockOwner(content: string): PluginStoreLockOwner | null {
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    return Number.isSafeInteger(value.pid) &&
      Number(value.pid) > 0 &&
      typeof value.nonce === 'string' &&
      value.nonce.length > 0 &&
      typeof value.createdAt === 'number' &&
      Number.isFinite(value.createdAt) &&
      (value.hostname === undefined ||
        (typeof value.hostname === 'string' && value.hostname.length > 0)) &&
      (value.processIdentity === undefined ||
        (typeof value.processIdentity === 'string' && value.processIdentity.length > 0))
      ? {
          pid: Number(value.pid),
          nonce: value.nonce,
          createdAt: value.createdAt,
          ...(value.hostname === undefined ? {} : { hostname: value.hostname as string }),
          ...(value.processIdentity === undefined
            ? {}
            : { processIdentity: value.processIdentity as string }),
        }
      : null;
  } catch {
    return null;
  }
}

class JsonFilePluginStorage {
  private readonly store: TextFileStore;

  public constructor(store: TextFileStore) {
    this.store = store;
  }

  public async read(): Promise<unknown | null> {
    const content = await this.store.read();
    if (content === null || content.trim().length === 0) return null;
    return JSON.parse(content) as unknown;
  }

  public async write(value: unknown): Promise<void> {
    await this.store.write(JSON.stringify(value));
  }

  public async withLock<T>(operation: () => Promise<T>): Promise<T> {
    if (this.store instanceof JsonFileTextStore) return this.store.withLock(operation);
    return operation();
  }
}

export class JsonFilePluginStorageStore {
  private readonly root: string;

  public constructor(root: string) {
    this.root = path.resolve(root);
  }

  public async open(
    pluginId: string,
    scope: string,
    projectId?: string,
  ): Promise<JsonFilePluginStorage> {
    const fileName = `${safeSegment(pluginId)}-${safeSegment(scope)}-${safeSegment(projectId ?? 'global')}.json`;
    return new JsonFilePluginStorage(new JsonFileTextStore(path.join(this.root, fileName)));
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 120) || 'plugin';
}
