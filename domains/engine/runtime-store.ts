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
import { canonicalRuntimeJson, cloneRuntimeValue, hashRuntimeValue } from './runtime-json.js';
import { RuntimeProtocolError } from './runtime-errors.js';

export interface RuntimeRecord {
  runId: string;
  revision: number;
}

export interface RuntimeStore<T extends RuntimeRecord> {
  read(runId: string): Promise<T | null>;
  compareAndSwap(runId: string, expectedRevision: number | null, next: T): Promise<boolean>;
  /**
   * 调用者先验证 checkpoint、owner、workspace 和 application，再导入已确认的恢复基线。
   * 仅接受缺失 Run，或除 revision 外 JSON 内容完全相同的 revision-1 初始导入。
   * 不覆盖活跃或更新的 Run，不伪造丢失历史；普通 compareAndSwap 仍只能增加一个 revision。
   */
  restoreCheckpoint?(runId: string, expectedRevision: null | 1, checkpoint: T): Promise<boolean>;
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
  const snapshot = cloneRuntimeValue(next) as unknown as T;
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot) ||
    snapshot.runId !== runId
  ) {
    throw new RuntimeProtocolError('STORE_INVALID_RUN_ID', 'next.runId 必须与目标 runId 一致');
  }
  assertRevision(snapshot.revision);
  if (snapshot.revision !== (expectedRevision ?? 0) + 1) {
    throw new RuntimeProtocolError(
      'STORE_INVALID_REVISION',
      'next.revision 必须比预期 revision 增加 1',
    );
  }
  return JSON.stringify(snapshot);
}

const CHECKPOINT_SCHEMA = 'comet.runtime-store-checkpoint.v1';

function serializeCheckpoint<T extends RuntimeRecord>(
  runId: string,
  expectedRevision: null | 1,
  checkpoint: T,
): string {
  const snapshot = cloneRuntimeValue(checkpoint) as unknown as T;
  assertRunId(runId);
  if (!snapshot || snapshot.runId !== runId) {
    throw new RuntimeProtocolError(
      'STORE_INVALID_RUN_ID',
      'checkpoint.runId 必须与目标 runId 一致',
    );
  }
  assertRevision(snapshot.revision);
  if (
    (expectedRevision !== null && expectedRevision !== 1) ||
    snapshot.revision <= (expectedRevision ?? 0)
  ) {
    throw new RuntimeProtocolError(
      'STORE_INVALID_REVISION',
      '恢复仅允许缺失 Run 或相同的初始导入，且不能回退 revision',
    );
  }
  return JSON.stringify(snapshot);
}

function checkpointAtRevision<T extends RuntimeRecord>(
  record: T,
  revision: number,
  paths: readonly string[][],
): T {
  const snapshot = cloneRuntimeValue(record) as unknown as T;
  snapshot.revision = revision;
  for (const fields of paths) {
    let target = snapshot as unknown as Record<string, unknown>;
    for (const key of fields.slice(0, -1)) target = target[key] as Record<string, unknown>;
    target[fields.at(-1)!] = revision;
  }
  return snapshot;
}

function matchesCheckpoint<T extends RuntimeRecord>(
  current: T | null,
  expectedRevision: null | 1,
  checkpoint: T,
  revisionPaths: readonly string[][] = [],
): boolean {
  return (
    (current?.revision ?? null) === expectedRevision &&
    (current === null ||
      canonicalRuntimeJson(current) ===
        canonicalRuntimeJson(checkpointAtRevision(checkpoint, 1, revisionPaths)))
  );
}

export function createMemoryRuntimeStore<T extends RuntimeRecord>(): RuntimeStore<T> {
  const records = new Map<string, { revision: number; serialized: string }>();
  return {
    async read(runId) {
      assertRunId(runId);
      const current = records.get(runId);
      return current === undefined ? null : (JSON.parse(current.serialized) as T);
    },
    async restoreCheckpoint(runId, expectedRevision, checkpoint) {
      const serialized = serializeCheckpoint(runId, expectedRevision, checkpoint);
      const snapshot = JSON.parse(serialized) as T;
      const current = records.get(runId);
      if (
        !matchesCheckpoint(
          current ? (JSON.parse(current.serialized) as T) : null,
          expectedRevision,
          snapshot,
        )
      )
        return false;
      records.set(runId, { revision: snapshot.revision, serialized });
      return true;
    },
    async compareAndSwap(runId, expectedRevision, next) {
      const serialized = serializeNext(runId, expectedRevision, next);
      const current = records.get(runId);
      const revision = current?.revision ?? null;
      if (revision !== expectedRevision) return false;
      records.set(runId, { revision: (expectedRevision ?? 0) + 1, serialized });
      return true;
    },
  };
}

export interface FileRuntimeStoreOptions {
  rootDir: string;
  /** 与顶层 revision 镜像的嵌套字段，例如固定应用记录的 run.revision。读取和写入都必须一致。 */
  mirroredRevisionPaths?: readonly 'run.revision'[];
}

/**
 * 使用原子硬链接发布不可变版本。正常版本连续递增；恢复基线明确记录原 revision，
 * 之后的版本继续连续递增。中断只会留下前一个版本或完整的新版本，不依赖锁接管。
 */
export function createFileRuntimeStore<T extends RuntimeRecord>(
  options: FileRuntimeStoreOptions,
): RuntimeStore<T> {
  if (typeof options.rootDir !== 'string' || options.rootDir.trim().length === 0) {
    throw new RuntimeProtocolError('STORE_INVALID_ROOT', 'rootDir 必须是非空路径');
  }
  const revisionPaths = (options.mirroredRevisionPaths ?? []).map((field) => {
    if (field !== 'run.revision') {
      throw new RuntimeProtocolError('STORE_INVALID_REVISION', '仅支持 run.revision 镜像字段');
    }
    return ['run', 'revision'];
  });
  function assertMirroredRevisions(record: T): void {
    for (const fields of revisionPaths) {
      let value: unknown = record;
      for (const key of fields) {
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          !Object.hasOwn(value, key)
        ) {
          throw new RuntimeProtocolError('STORE_CORRUPT_RECORD', '镜像 revision 字段缺失');
        }
        value = (value as Record<string, unknown>)[key];
      }
      if (value !== record.revision) {
        throw new RuntimeProtocolError('STORE_CORRUPT_RECORD', '镜像 revision 与记录版本不一致');
      }
    }
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
    let revisionCount = 0;
    let latestRevision = 0;
    let latestName: string | undefined;
    for (const entry of entries) {
      if (/^\..+\.tmp$/u.test(entry.name)) continue;
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[0-9]{16}\.json$/u.test(entry.name)) {
        throw new RuntimeProtocolError('STORE_INVALID_ENTRY', `版本文件无效：${entry.name}`);
      }
      const revision = Number(entry.name.slice(0, -5));
      if (!Number.isSafeInteger(revision) || revision < 1) {
        throw new RuntimeProtocolError('STORE_INVALID_ENTRY', `版本文件无效：${entry.name}`);
      }
      revisionCount += 1;
      if (revision > latestRevision) {
        latestRevision = revision;
        latestName = entry.name;
      }
    }
    if (!latestName) return null;
    const records = new Map<number, unknown>();
    async function readRecord(revision: number): Promise<unknown> {
      if (records.has(revision)) return records.get(revision);
      const result = await readProtectedProjectFile(
        rootDir,
        `${runRef}/${String(revision).padStart(16, '0')}.json`,
        Number.MAX_SAFE_INTEGER,
        { label: 'RuntimeStore revision' },
      );
      try {
        const value: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(result.bytes),
        );
        canonicalRuntimeJson(value);
        records.set(revision, value);
        return value;
      } catch {
        throw new RuntimeProtocolError(
          'STORE_CORRUPT_RECORD',
          '版本文件不是有效的 UTF-8 JSON 数据',
        );
      }
    }
    const latest = (await readRecord(latestRevision)) as T & { schema?: unknown };
    if (
      latestRevision === revisionCount &&
      (latest?.schema !== CHECKPOINT_SCHEMA || latest?.runId !== undefined)
    ) {
      if (latest?.runId !== runId || latest.revision !== latestRevision) {
        throw new RuntimeProtocolError(
          'STORE_CORRUPT_RECORD',
          '版本文件的 runId 或 revision 与目标不一致',
        );
      }
      assertMirroredRevisions(latest);
      return latest;
    }
    const names = new Set(entries.map((entry) => entry.name));
    const hasRevision = (revision: number) =>
      names.has(`${String(revision).padStart(16, '0')}.json`);
    if (!hasRevision(1)) {
      throw new RuntimeProtocolError('STORE_MISSING_REVISION', '版本历史缺少 revision 1');
    }
    let baseline: { slot: number; record: T } | null = null;
    // 恢复基线占用正常创建/CAS 的同一原子发布位置；缺失历史不会伪装成执行记录。
    for (const slot of [1, 2]) {
      if (!hasRevision(slot)) break;
      const value = (await readRecord(slot)) as {
        schema?: unknown;
        record?: T;
        hash?: unknown;
      } | null;
      if (value?.schema !== CHECKPOINT_SCHEMA || 'runId' in value) continue;
      const record = value.record;
      if (record) assertMirroredRevisions(record);
      if (
        !record ||
        record.runId !== runId ||
        !Number.isSafeInteger(record.revision) ||
        record.revision < slot ||
        value.hash !== hashRuntimeValue(record) ||
        Object.keys(value).some((key) => !['schema', 'record', 'hash'].includes(key)) ||
        (slot === 2 &&
          canonicalRuntimeJson(await readRecord(1)) !==
            canonicalRuntimeJson(checkpointAtRevision(record, 1, revisionPaths)))
      ) {
        throw new RuntimeProtocolError('STORE_CORRUPT_RECORD', '恢复 checkpoint 与版本基线不一致');
      }
      baseline = { slot, record };
      break;
    }
    const baseRevision = baseline?.record.revision ?? 0;
    const baseSlot = baseline?.slot ?? 0;
    const historyEnd = latestRevision === baseSlot ? baseRevision : latestRevision;
    if (
      historyEnd < baseRevision ||
      revisionCount !== historyEnd - baseRevision + baseSlot ||
      entries.some((entry) => {
        if (!/^[0-9]{16}\.json$/u.test(entry.name)) return false;
        const revision = Number(entry.name.slice(0, -5));
        return revision > baseSlot && revision <= baseRevision;
      })
    ) {
      let missing = baseRevision + 1;
      while (hasRevision(missing)) missing += 1;
      throw new RuntimeProtocolError('STORE_MISSING_REVISION', `版本历史缺少 revision ${missing}`);
    }
    if (baseline && latestRevision === baseline.slot) return baseline.record;
    const value = (await readRecord(latestRevision)) as T;
    if (!value || typeof value !== 'object' || value.runId !== runId) {
      throw new RuntimeProtocolError(
        'STORE_CORRUPT_RECORD',
        '版本文件的 runId 与目标 runId 不一致',
      );
    }
    if (value.revision !== latestRevision) {
      throw new RuntimeProtocolError('STORE_CORRUPT_RECORD', '版本文件的 revision 与文件名不一致');
    }
    assertMirroredRevisions(value);
    return value;
  }

  async function publish(runId: string, slot: number, serialized: string): Promise<boolean> {
    await ensureProtectedProjectDirectory(volumeRoot, rootRelative, rootOptions);
    const runRef = runDirectory(runId);
    await ensureProtectedProjectDirectory(rootDir, runRef, { label: 'RuntimeStore run' });
    const file = path.join(rootDir, runRef, `${String(slot).padStart(16, '0')}.json`);
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
  }

  return {
    read,
    async restoreCheckpoint(runId, expectedRevision, checkpoint) {
      const snapshot = JSON.parse(serializeCheckpoint(runId, expectedRevision, checkpoint)) as T;
      assertMirroredRevisions(snapshot);
      if (!matchesCheckpoint(await read(runId), expectedRevision, snapshot, revisionPaths))
        return false;
      return publish(
        runId,
        (expectedRevision ?? 0) + 1,
        JSON.stringify({
          schema: CHECKPOINT_SCHEMA,
          record: snapshot,
          hash: hashRuntimeValue(snapshot),
        }),
      );
    },
    async compareAndSwap(runId, expectedRevision, next) {
      const serialized = serializeNext(runId, expectedRevision, next);
      if (revisionPaths.length > 0) assertMirroredRevisions(JSON.parse(serialized) as T);
      const nextRevision = (expectedRevision ?? 0) + 1;
      const current = await read(runId);
      if ((current?.revision ?? null) !== expectedRevision) return false;
      return publish(runId, nextRevision, serialized);
    },
  };
}
