import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_RETRY_MS = 20;
const DEFAULT_MALFORMED_LOCK_STALE_MS = 5 * 60_000;

interface PluginStoreLockOwner {
  readonly pid: number;
  readonly nonce: string;
  readonly createdAt: number;
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
  const owner: PluginStoreLockOwner = {
    pid: process.pid,
    nonce: randomUUID(),
    createdAt: Date.now(),
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
  if (owner !== null && processIsAlive(owner.pid)) return false;
  if (owner === null && Date.now() - Number(stat.mtimeMs) < malformedLockStaleMs) {
    return false;
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
    await fs.rm(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
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
      Number.isFinite(value.createdAt)
      ? { pid: Number(value.pid), nonce: value.nonce, createdAt: value.createdAt }
      : null;
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM' || code !== 'ESRCH';
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
