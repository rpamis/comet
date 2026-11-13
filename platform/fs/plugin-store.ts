import { randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';

import path from 'node:path';
import {
  withRecoverableFileLock,
  type RecoverableFileLockOptions,
} from './recoverable-file-lock.js';

export { withRecoverableFileLock, type RecoverableFileLockOptions };

export interface TextFileStore {
  read(maxBytes?: number): Promise<string | null>;
  write(content: string): Promise<void>;
}

export class JsonFileTextStore implements TextFileStore {
  private readonly filePath: string;
  private readonly lockOptions: RecoverableFileLockOptions;

  public constructor(filePath: string, lockOptions: RecoverableFileLockOptions = {}) {
    this.filePath = path.resolve(filePath);
    this.lockOptions = { ...lockOptions };
  }

  public async read(maxBytes?: number): Promise<string | null> {
    try {
      if (maxBytes === undefined) return await fs.readFile(this.filePath, 'utf8');
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
        throw new Error('Invalid file size limit');
      // Windows 的普通 open 标志不保证无阻塞地拒绝重解析点；保留 worker 隔离回退。
      if (process.platform === 'win32' || !constants.O_NOFOLLOW || !constants.O_NONBLOCK)
        throw new Error('Bounded nonblocking file reads are unavailable');
      const handle = await fs.open(
        this.filePath,
        constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw new Error('Bounded reads require a regular file');
        if (stat.size > maxBytes) throw new Error('File exceeds read size limit');
        const buffer = Buffer.alloc(maxBytes + 1);
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        if (offset > maxBytes) throw new Error('File exceeds read size limit');
        return buffer.subarray(0, offset).toString('utf8');
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  public async write(content: string): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, this.filePath);
  }

  public async withLock<T>(operation: () => Promise<T>): Promise<T> {
    return withRecoverableFileLock(`${this.filePath}.lock`, operation, this.lockOptions);
  }
}

class JsonFilePluginStorage {
  private readonly store: TextFileStore;

  public constructor(store: TextFileStore) {
    this.store = store;
  }

  public async read(maxBytes?: number): Promise<unknown | null> {
    const content = await this.store.read(maxBytes);
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
  private readonly lockOptions: RecoverableFileLockOptions;

  public constructor(root: string, lockOptions: RecoverableFileLockOptions = {}) {
    this.root = path.resolve(root);
    this.lockOptions = { ...lockOptions };
  }

  public async open(
    pluginId: string,
    scope: string,
    projectId?: string,
  ): Promise<JsonFilePluginStorage> {
    const fileName = `${safeSegment(pluginId)}-${safeSegment(scope)}-${safeSegment(projectId ?? 'global')}.json`;
    return new JsonFilePluginStorage(
      new JsonFileTextStore(path.join(this.root, fileName), this.lockOptions),
    );
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 120) || 'plugin';
}
