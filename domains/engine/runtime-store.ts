import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { sameFileObject } from '../../platform/fs/file-identity.js';

import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import { canonicalRuntimeJson } from './runtime-json.js';
import { RuntimeProtocolError } from './runtime-errors.js';

export interface RuntimeRecord {
  runId: string;
  revision: number;
}

export interface RuntimeStore<T extends RuntimeRecord> {
  read(runId: string): Promise<T | null>;
  compareAndSwap(runId: string, expectedRevision: number | null, next: T): Promise<boolean>;
}

function assertRunId(runId: string): void {
  if (typeof runId !== 'string' || runId.trim().length === 0) {
    throw new RuntimeProtocolError('STORE_INVALID_RUN_ID', 'runId 必须是非空字符串');
  }
}

function assertRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new RuntimeProtocolError('STORE_INVALID_REVISION', 'revision 必须是正安全整数');
  }
}

function serializeNext<T extends RuntimeRecord>(
  runId: string,
  expectedRevision: number | null,
  next: T,
): string {
  assertRunId(runId);
  if (expectedRevision !== null) assertRevision(expectedRevision);
  const serialized = canonicalRuntimeJson(next);
  if (!next || typeof next !== 'object' || Array.isArray(next) || next.runId !== runId) {
    throw new RuntimeProtocolError('STORE_INVALID_RUN_ID', 'next.runId 必须与目标 runId 一致');
  }
  assertRevision(next.revision);
  if (next.revision !== (expectedRevision ?? 0) + 1) {
    throw new RuntimeProtocolError(
      'STORE_INVALID_REVISION',
      'next.revision 必须比预期 revision 增加 1',
    );
  }
  return serialized;
}

export function createMemoryRuntimeStore<T extends RuntimeRecord>(): RuntimeStore<T> {
  const records = new Map<string, string>();
  return {
    async read(runId) {
      assertRunId(runId);
      const current = records.get(runId);
      return current === undefined ? null : (JSON.parse(current) as T);
    },
    async compareAndSwap(runId, expectedRevision, next) {
      const serialized = serializeNext(runId, expectedRevision, next);
      const current = records.get(runId);
      const revision = current === undefined ? null : (JSON.parse(current) as T).revision;
      if (revision !== expectedRevision) return false;
      records.set(runId, serialized);
      return true;
    },
  };
}

export interface FileRuntimeStoreOptions {
  rootDir: string;
}

/**
 * Immutable, contiguous revisions are published with an atomic hard link. A
 * crashed writer leaves either its previous revision or its complete successor;
 * no lock ownership or time-based takeover participates in this protocol.
 */
export function createFileRuntimeStore<T extends RuntimeRecord>(
  options: FileRuntimeStoreOptions,
): RuntimeStore<T> {
  if (typeof options.rootDir !== 'string' || options.rootDir.trim().length === 0) {
    throw new RuntimeProtocolError('STORE_INVALID_ROOT', 'rootDir 必须是非空路径');
  }
  const rootDir = path.resolve(options.rootDir);
  const volumeRoot = path.parse(rootDir).root;
  const rootRelative = path.relative(volumeRoot, rootDir).replaceAll('\\', '/');
  if (!rootRelative)
    throw new RuntimeProtocolError('STORE_INVALID_ROOT', 'rootDir 不能是文件系统根目录');
  const rootOptions = { label: 'RuntimeStore root', expected: 'directory' as const };
  const runDirectory = (runId: string) =>
    createHash('sha256').update(JSON.stringify(runId)).digest('hex');

  async function read(runId: string): Promise<T | null> {
    assertRunId(runId);
    if (!(await inspectProtectedProjectPath(volumeRoot, rootRelative, rootOptions)).exists) {
      return null;
    }
    const runRef = runDirectory(runId);
    const inspection = await inspectProtectedProjectPath(rootDir, runRef, {
      label: 'RuntimeStore run',
      expected: 'directory',
    });
    if (!inspection.exists) return null;
    const before = await fs.lstat(inspection.target);
    const entries = await fs.readdir(inspection.target, { withFileTypes: true });
    const after = await fs.lstat(inspection.target);
    await inspectProtectedProjectPath(volumeRoot, `${rootRelative}/${runRef}`, rootOptions);
    if (
      !before.isDirectory() ||
      before.isSymbolicLink() ||
      !after.isDirectory() ||
      after.isSymbolicLink() ||
      !sameFileObject(
        { dev: before.dev, ino: before.ino, birthtime: before.birthtimeMs },
        { dev: after.dev, ino: after.ino, birthtime: after.birthtimeMs },
      )
    ) {
      throw new RuntimeProtocolError('STORE_CHANGED_DIRECTORY', '读取版本列表时 Run 目录已变化');
    }
    const revisions = entries.filter((entry) => !/^\..+\.tmp$/u.test(entry.name));
    revisions.sort((left, right) => left.name.localeCompare(right.name));
    for (const [index, entry] of revisions.entries()) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[0-9]{16}\.json$/u.test(entry.name)) {
        throw new RuntimeProtocolError('STORE_INVALID_ENTRY', `版本文件无效：${entry.name}`);
      }
      if (Number(entry.name.slice(0, -5)) !== index + 1) {
        throw new RuntimeProtocolError(
          'STORE_MISSING_REVISION',
          `版本历史缺少 revision ${index + 1}`,
        );
      }
    }
    const latest = revisions.at(-1);
    if (!latest) return null;
    const result = await readProtectedProjectFile(
      rootDir,
      `${runRef}/${latest.name}`,
      Number.MAX_SAFE_INTEGER,
      {
        label: 'RuntimeStore revision',
      },
    );
    let value: T;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.bytes)) as T;
      canonicalRuntimeJson(value);
    } catch {
      throw new RuntimeProtocolError('STORE_CORRUPT_RECORD', '版本文件不是有效的 UTF-8 JSON 数据');
    }
    if (!value || typeof value !== 'object' || value.runId !== runId) {
      throw new RuntimeProtocolError(
        'STORE_CORRUPT_RECORD',
        '版本文件的 runId 与目标 runId 不一致',
      );
    }
    if (value.revision !== revisions.length) {
      throw new RuntimeProtocolError('STORE_CORRUPT_RECORD', '版本文件的 revision 与文件名不一致');
    }
    return value;
  }

  return {
    read,
    async compareAndSwap(runId, expectedRevision, next) {
      const serialized = serializeNext(runId, expectedRevision, next);
      const nextRevision = next.revision;
      const current = await read(runId);
      if ((current?.revision ?? null) !== expectedRevision) return false;
      await ensureProtectedProjectDirectory(volumeRoot, rootRelative, rootOptions);
      const runRef = runDirectory(runId);
      await ensureProtectedProjectDirectory(rootDir, runRef, { label: 'RuntimeStore run' });
      const file = path.join(rootDir, runRef, `${String(nextRevision).padStart(16, '0')}.json`);
      try {
        await atomicWriteContainedText(file, serialized + '\n', {
          containedRoot: rootDir,
          exclusive: true,
          requireAtomicPublication: true,
        });
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        if (['ENOTSUP', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          throw new RuntimeProtocolError(
            'STORE_ATOMIC_PUBLICATION_UNSUPPORTED',
            '此文件系统不支持原子硬链接发布；请使用支持硬链接的本地目录或其他 RuntimeStore',
          );
        }
        throw error;
      }
    },
  };
}
