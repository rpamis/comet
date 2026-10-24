import { createHash, randomUUID } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { hasComparableFileObject, sameFileObject } from '../../platform/fs/file-identity.js';
import { RaceSafeReadError } from '../../platform/fs/race-safe-read.js';
import {
  withRecoverableFileLock,
  diagnoseRecoverableFileLock,
  repairRecoverableFileLock,
} from '../../platform/fs/recoverable-file-lock.js';

import {
  atomicWriteContainedText,
  removeContainedFile,
} from '../workflow-contract/contained-atomic-write.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import {
  canonicalRuntimeJson,
  cloneRuntimeValue,
  hashRuntimeValue,
  validateRuntimeValue,
} from './runtime-json.js';
import { runWithoutHookReadCache } from '../../platform/process/hook-read-cache.js';
import { RuntimeProtocolError } from './runtime-errors.js';
import { serializeRuntimeHistory } from './runtime-history-storage.js';
import {
  decodeJsonValueMaps,
  getJsonValueProjectionStats,
  hashJsonValueProjection,
  materializeJsonValueProjection,
} from '../../platform/fs/json-value-pool.js';

export interface RuntimeRecord {
  runId: string;
  revision: number;
}

export interface RuntimeStore<T extends RuntimeRecord> {
  readonly queryScope?: string;
  readProjection?(runId: string): Promise<T | null>;
  prepareCompareAndSwap?(
    runId: string,
    expectedRevision: number | null,
    next: T,
  ): () => Promise<boolean>;
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

function fileRuntimeStoreRunDirectory(runId: string): string {
  assertRunId(runId);
  return createHash('sha256').update(JSON.stringify(runId)).digest('hex');
}

async function fileRuntimeStoreLockFile(
  options: Pick<FileRuntimeStoreOptions, 'rootDir'>,
  runId: string,
): Promise<string> {
  const target = path.resolve(
    options.rootDir,
    '.runtime-store-v2',
    fileRuntimeStoreRunDirectory(runId),
    '.write.lock',
  );
  const volume = path.parse(target).root;
  return (
    await inspectProtectedProjectPath(volume, path.relative(volume, target).replaceAll('\\', '/'), {
      label: 'RuntimeStore writer lock',
      expected: 'file',
    })
  ).target;
}

/** 只读核对当前 Run 的写锁，不加载工作流或执行存储恢复。 */
export async function inspectFileRuntimeStoreLock(
  options: Pick<FileRuntimeStoreOptions, 'rootDir'>,
  runId: string,
) {
  const file = await fileRuntimeStoreLockFile(options, runId);
  return { ...(await diagnoseRecoverableFileLock(file)), file, path: file };
}

export async function repairFileRuntimeStoreLock(
  options: Pick<FileRuntimeStoreOptions, 'rootDir'>,
  runId: string,
  token: string,
  confirmedOwnerStopped = false,
) {
  return repairRecoverableFileLock(await fileRuntimeStoreLockFile(options, runId), token, {
    confirmedOwnerStopped,
  });
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
  return JSON.stringify(snapshotNext(runId, expectedRevision, next));
}

function snapshotNext<T extends RuntimeRecord>(
  runId: string,
  expectedRevision: number | null,
  next: T,
  copy = true,
): T {
  assertRunId(runId);
  if (utilTypes.isProxy(next))
    throw new RuntimeProtocolError(
      'STORE_INVALID_RUN_ID',
      'RuntimeStore records must be plain JSON data',
    );
  if (expectedRevision !== null) assertRevision(expectedRevision);
  validateRuntimeValue(next);
  const snapshot = copy ? structuredClone(next) : next;
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
  return snapshot;
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
  const queryScope = `memory:${randomUUID()}`;
  return {
    queryScope,
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

export type FileRuntimeStoreDisposition = 'active' | 'closing' | 'closed' | 'reopening' | 'missing';

/** 文件存储的显式历史生命周期；业务终态与资源清理由调用方先验证。 */
export interface FileRuntimeStore<T extends RuntimeRecord> extends RuntimeStore<T> {
  /**
   * 将固定 expectedRevision 的 checkpoint 封存到历史分区，不改变记录内容或 revision。
   * 调用方须先确认业务已结束、所有执行及子任务已停止，且必要清理已完成。
   * 此操作只管理存储布局，不取消进程、不执行业务清理；版本失配返回 false。
   */
  closeRun(runId: string, expectedRevision: number): Promise<boolean>;
  /**
   * 将固定 expectedRevision 的历史 checkpoint 恢复到可写分区，版本失配返回 false。
   * 此操作不启动执行或批准业务重试；调用方仍须完成 owner、恢复资格和 Runtime 校验。
   */
  reopenRun(runId: string, expectedRevision: number): Promise<boolean>;
  readDisposition(runId: string): Promise<FileRuntimeStoreDisposition>;
  /** 仅校验布局/小型事务标记，不校验历史正文；未知和冲突抛错。 */
  readPartitionMetadata(runId: string): Promise<FileRuntimeStoreDisposition>;
  /** 仅完成持久化的布局事务，不增加 revision 或执行业务。 */
  settleRun(runId: string): Promise<FileRuntimeStoreDisposition>;
}

export interface FileRuntimeStoreOptions {
  rootDir: string;
  writerProtocol?: 'application-holder-v1';
  /** 与顶层 revision 镜像的嵌套字段，例如固定应用记录的 run.revision。读取和写入都必须一致。 */
  mirroredRevisionPaths?: readonly 'run.revision'[];
}

/**
 * 使用可恢复的跨进程锁串行 CAS，以原子替换保存一个带校验值的完整 checkpoint。
 * 旧版本历史只在写入时迁移：先验证、发布新 authority 和格式标记，再清理已覆盖文件。
 * 不使用增量日志；checkpoint 内的业务历史仍由调用者维护。
 */
export function createFileRuntimeStore<T extends RuntimeRecord>(
  options: FileRuntimeStoreOptions,
): FileRuntimeStore<T> {
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
  const runDirectory = fileRuntimeStoreRunDirectory;

  const currentName = 'checkpoint.json';
  const formatSchema = 'comet.runtime-store-format.v2';
  const compactDirectory = '.runtime-store-v2';
  const compactRunDirectory = (runId: string) => `${compactDirectory}/${runDirectory(runId)}`;
  const historyRunDirectory = (runId: string) => `.runtime-store-history/${runDirectory(runId)}`;
  const lifecycleSchema = 'comet.runtime-store-format.v3';
  const compactSchema = 'comet.runtime-store-snapshot.v2';
  const lockName = '.write.lock';
  const revisionPattern = /^[0-9]{16}\.json$/u;

  interface StoreState {
    record: T | null;
    compacted: boolean;
    legacyRevision: number | null;
    formatPresent: boolean;
  }

  function emptyState(): StoreState {
    return {
      record: null,
      compacted: false,
      legacyRevision: null,
      formatPresent: false,
    };
  }

  async function readJson(runRef: string, name: string): Promise<unknown> {
    const result = await readProtectedProjectFile(
      rootDir,
      runRef ? `${runRef}/${name}` : name,
      Number.MAX_SAFE_INTEGER,
      { label: 'RuntimeStore record' },
    );
    try {
      const value: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(result.bytes),
      );
      validateRuntimeValue(value);
      return value;
    } catch {
      throw new RuntimeProtocolError('STORE_CORRUPT_RECORD', '版本文件不是有效的 UTF-8 JSON 数据');
    }
  }

  function assertRecord(record: T, runId: string, revision: number): void {
    if (
      !record ||
      typeof record !== 'object' ||
      Array.isArray(record) ||
      record.runId !== runId ||
      record.revision !== revision ||
      !Number.isSafeInteger(revision) ||
      revision < 1
    ) {
      throw new RuntimeProtocolError(
        'STORE_CORRUPT_RECORD',
        '版本文件的 runId 或 revision 与目标不一致',
      );
    }
    assertMirroredRevisions(record);
  }

  async function readState(
    runId: string,
    validateLegacy = false,
    runRef = runDirectory(runId),
    materialize = true,
  ): Promise<StoreState> {
    assertRunId(runId);
    if (!(await inspectProtectedProjectPath(volumeRoot, rootRelative, rootOptions)).exists) {
      return emptyState();
    }
    const inspection = await inspectProtectedProjectPath(rootDir, runRef, {
      label: 'RuntimeStore run',
      expected: 'directory',
    });
    if (!inspection.exists) return emptyState();
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
    const names = new Set<string>();
    const legacyNames: string[] = [];
    let latestRevision = 0;
    for (const entry of entries) {
      if (
        (entry.name === `${lockName}.contenders` ||
          (entry.name === 'legacy' && runRef === compactRunDirectory(runId))) &&
        entry.isDirectory() &&
        !entry.isSymbolicLink()
      )
        continue;
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new RuntimeProtocolError('STORE_INVALID_ENTRY', `版本文件无效：${entry.name}`);
      }
      if (
        /^\..+\.tmp$/u.test(entry.name) ||
        entry.name === lockName ||
        /^\.write\.lock\.[a-f0-9-]+\.removed$/u.test(entry.name)
      )
        continue;
      names.add(entry.name);
      if (entry.name === currentName) continue;
      if (!revisionPattern.test(entry.name)) {
        throw new RuntimeProtocolError('STORE_INVALID_ENTRY', `版本文件无效：${entry.name}`);
      }
      const revision = Number(entry.name.slice(0, -5));
      if (!Number.isSafeInteger(revision) || revision < 1) {
        throw new RuntimeProtocolError('STORE_INVALID_ENTRY', `版本文件无效：${entry.name}`);
      }
      legacyNames.push(entry.name);
      latestRevision = Math.max(latestRevision, revision);
    }
    const formatPresent = false;
    if (
      [compactRunDirectory(runId), historyRunDirectory(runId)].includes(runRef) &&
      legacyNames.length > 0
    ) {
      throw new RuntimeProtocolError('STORE_INVALID_ENTRY', 'checkpoint 目录不能包含旧版本文件');
    }
    if (names.has(currentName)) {
      if (![compactRunDirectory(runId), historyRunDirectory(runId)].includes(runRef)) {
        throw new RuntimeProtocolError('STORE_INVALID_ENTRY', '旧版本目录包含未知 checkpoint');
      }
      const snapshot = (await readJson(runRef, currentName)) as {
        schema?: unknown;
        record?: T;
        hash?: unknown;
        legacyRevision?: unknown;
        pool?: unknown;
      } | null;
      const stored = snapshot?.record;
      const legacyRevision = snapshot?.legacyRevision;
      if (
        !snapshot ||
        ![compactSchema, 'comet.runtime-store-snapshot.v3'].includes(String(snapshot.schema)) ||
        !stored ||
        Object.keys(snapshot).some(
          (key) =>
            ![
              'schema',
              'record',
              'hash',
              'legacyRevision',
              ...(snapshot.schema === 'comet.runtime-store-snapshot.v3' ? ['pool'] : []),
            ].includes(key),
        ) ||
        (legacyRevision !== null &&
          (!Number.isSafeInteger(legacyRevision) ||
            (legacyRevision as number) < 1 ||
            (legacyRevision as number) > stored.revision)) ||
        snapshot.hash !==
          hashRuntimeValue({
            record: stored,
            legacyRevision,
            ...(snapshot.schema === 'comet.runtime-store-snapshot.v3'
              ? { pool: snapshot.pool }
              : {}),
          })
      ) {
        throw new RuntimeProtocolError(
          'STORE_CORRUPT_RECORD',
          'RuntimeStore checkpoint 损坏或校验值不一致',
        );
      }
      let record: T;
      try {
        record =
          snapshot.schema === 'comet.runtime-store-snapshot.v3'
            ? decodeJsonValueMaps(stored, snapshot.pool, materialize)
            : stored;
      } catch (error) {
        throw new RuntimeProtocolError(
          'STORE_CORRUPT_RECORD',
          `RuntimeStore history references are invalid: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      assertRecord(record, runId, record.revision);
      return {
        record,
        compacted: true,
        legacyRevision: legacyRevision as number | null,
        formatPresent,
      };
    }
    if (!latestRevision) return emptyState();
    const records = new Map<number, unknown>();
    const revisionName = (revision: number) => `${String(revision).padStart(16, '0')}.json`;
    const hasRevision = (revision: number) => names.has(revisionName(revision));
    async function readRecord(revision: number): Promise<unknown> {
      if (records.has(revision)) return records.get(revision);
      const value = await readJson(runRef, revisionName(revision));
      // 迁移逐个校验历史，不能把 N 份完整快照一起保留在内存中。
      if (revision <= 2 || revision === latestRevision) records.set(revision, value);
      return value;
    }
    async function result(
      record: T,
      baselineSlot = 0,
      revision = latestRevision,
    ): Promise<StoreState> {
      assertRecord(record, runId, revision);
      if (validateLegacy) {
        for (const name of legacyNames) {
          const revision = Number(name.slice(0, -5));
          if (revision === baselineSlot) continue;
          assertRecord((await readRecord(revision)) as T, runId, revision);
        }
      }
      return {
        record,
        compacted: false,
        legacyRevision: record.revision,
        formatPresent: false,
      };
    }
    const latest = (await readRecord(latestRevision)) as T & { schema?: unknown };
    if (
      latestRevision === legacyNames.length &&
      (latest?.schema !== CHECKPOINT_SCHEMA || latest?.runId !== undefined)
    ) {
      return result(latest);
    }
    if (!hasRevision(1)) {
      throw new RuntimeProtocolError('STORE_MISSING_REVISION', '版本历史缺少 revision 1');
    }
    let baseline: { slot: number; record: T } | null = null;
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
      legacyNames.length !== historyEnd - baseRevision + baseSlot ||
      legacyNames.some((name) => {
        const revision = Number(name.slice(0, -5));
        return revision > baseSlot && revision <= baseRevision;
      })
    ) {
      let missing = baseRevision + 1;
      while (hasRevision(missing)) missing += 1;
      throw new RuntimeProtocolError('STORE_MISSING_REVISION', `版本历史缺少 revision ${missing}`);
    }
    return result(
      baseline && latestRevision === baseline.slot ? baseline.record : latest,
      baseSlot,
      baseline && latestRevision === baseline.slot ? baseline.record.revision : latestRevision,
    );
  }

  interface FormatMarker {
    schema: string;
    runId: string;
    state: 'pending' | 'ready' | 'closing' | 'closed' | 'reopening';
    revision?: number;
    recordHash?: string;
    writerProtocol?: string;
  }

  async function layout(runId: string) {
    let original = await inspectProtectedProjectPath(rootDir, runDirectory(runId), {
      label: 'RuntimeStore format',
      expected: 'any',
    });
    const staged = await inspectProtectedProjectPath(
      rootDir,
      `${compactRunDirectory(runId)}/legacy`,
      {
        label: 'RuntimeStore legacy',
        expected: 'directory',
      },
    );
    if (original.kind === 'directory' && staged.exists) {
      original = await inspectProtectedProjectPath(rootDir, runDirectory(runId), {
        label: 'RuntimeStore format',
        expected: 'any',
      });
    }
    if (original.kind === 'directory' && staged.exists) {
      throw new RuntimeProtocolError(
        'STORE_MIGRATION_CONFLICT',
        '旧写入者在迁移期间重新创建了 Run 目录；请停止旧版本进程并检查两处版本历史',
      );
    }
    let marker: FormatMarker | null = null;
    if (original.kind === 'file') {
      const value = (await readJson('', runDirectory(runId))) as FormatMarker | null;
      if (
        !value ||
        value.runId !== runId ||
        (value.schema === formatSchema
          ? !['pending', 'ready'].includes(value.state) ||
            Object.keys(value).some(
              (key) => !['schema', 'runId', 'state', 'writerProtocol'].includes(key),
            )
          : value.schema !== lifecycleSchema ||
            !['closing', 'closed', 'reopening'].includes(value.state) ||
            !Number.isSafeInteger(value.revision) ||
            value.revision! < 1 ||
            typeof value.recordHash !== 'string' ||
            !/^[a-f0-9]{64}$/u.test(value.recordHash) ||
            Object.keys(value).some(
              (key) =>
                !['schema', 'runId', 'state', 'revision', 'recordHash', 'writerProtocol'].includes(
                  key,
                ),
            ))
      ) {
        throw new RuntimeProtocolError('STORE_CORRUPT_RECORD', 'RuntimeStore 格式标记损坏');
      }
      if (value.writerProtocol !== undefined && value.writerProtocol !== 'application-holder-v1')
        throw new RuntimeProtocolError('STORE_WRITER_FENCED', '存储协议版本不受支持');
      marker = value;
    }
    return { original, staged, marker };
  }

  // 仅对解码器登记的只读投影使用流式 canonical hash，外部记录仍走 JSON 校验。
  // 生命周期只需单次完整摘要，不保留用于分页查询的 SHA 前缀缓存。
  function hashLifecycleRecord(record: T): string {
    return getJsonValueProjectionStats(record)
      ? hashJsonValueProjection(record, { cachePrefixes: false })
      : hashRuntimeValue(record);
  }

  async function readLifecycle(runId: string, marker: FormatMarker) {
    const active = await readState(runId, false, compactRunDirectory(runId), false);
    const history = await readState(runId, false, historyRunDirectory(runId), false);
    if (
      (!active.record && !history.record) ||
      (marker.state === 'closed' && (active.record || !history.record))
    ) {
      throw new RuntimeProtocolError('STORE_HISTORY_CONFLICT', '历史事务与 checkpoint 位置不一致');
    }
    if (active.record && history.record) {
      const first = await fs.lstat(path.join(rootDir, compactRunDirectory(runId), currentName));
      const second = await fs.lstat(path.join(rootDir, historyRunDirectory(runId), currentName));
      const firstIdentity = { dev: first.dev, ino: first.ino, birthtime: first.birthtimeMs };
      const secondIdentity = { dev: second.dev, ino: second.ino, birthtime: second.birthtimeMs };
      if (
        !hasComparableFileObject(firstIdentity, secondIdentity) ||
        !sameFileObject(firstIdentity, secondIdentity)
      ) {
        throw new RuntimeProtocolError(
          'STORE_HISTORY_CONFLICT',
          '活动与历史分区含两份独立 checkpoint，已保留现场',
        );
      }
    }
    const record = history.record ?? active.record!;
    if (
      record.revision !== marker.revision ||
      hashLifecycleRecord(record) !== marker.recordHash ||
      (active.record &&
        active.record !== record &&
        hashLifecycleRecord(active.record) !== marker.recordHash)
    ) {
      throw new RuntimeProtocolError(
        'STORE_HISTORY_CONFLICT',
        '历史事务的固定版本与 checkpoint 不一致',
      );
    }
    return { record, active: !!active.record, history: !!history.record };
  }

  async function readPartitionMetadata(runId: string): Promise<FileRuntimeStoreDisposition> {
    assertRunId(runId);
    if (!(await inspectProtectedProjectPath(volumeRoot, rootRelative, rootOptions)).exists)
      return 'missing';
    const state = await layout(runId);
    const active = await inspectProtectedProjectPath(
      rootDir,
      `${compactRunDirectory(runId)}/${currentName}`,
      { label: 'RuntimeStore 活动 checkpoint', expected: 'file' },
    );
    const history = await inspectProtectedProjectPath(
      rootDir,
      `${historyRunDirectory(runId)}/${currentName}`,
      { label: 'RuntimeStore 历史 checkpoint', expected: 'file' },
    );
    if (state.marker?.schema === lifecycleSchema) {
      if (
        (!active.exists && !history.exists) ||
        (state.marker.state === 'closed' && (active.exists || !history.exists))
      )
        throw new RuntimeProtocolError('STORE_HISTORY_CONFLICT', '历史分区与存储事务不一致');
      return state.marker.state as 'closing' | 'closed' | 'reopening';
    }
    if (history.exists)
      throw new RuntimeProtocolError('STORE_HISTORY_CONFLICT', '历史分区缺少存储事务');
    if (state.marker || active.exists || state.original.kind === 'directory' || state.staged.exists)
      return 'active';
    return 'missing';
  }

  async function writeLifecycle(
    runId: string,
    state: 'closing' | 'closed' | 'reopening',
    record: T,
  ) {
    await atomicWriteContainedText(
      path.join(rootDir, runDirectory(runId)),
      JSON.stringify({
        schema: lifecycleSchema,
        ...(options.writerProtocol ? { writerProtocol: options.writerProtocol } : {}),
        runId,
        state,
        revision: record.revision,
        recordHash: hashLifecycleRecord(record),
      }) + '\n',
      { containedRoot: rootDir, requireAtomicPublication: true },
    );
  }

  async function settleLifecycle(runId: string): Promise<void> {
    const marker = (await layout(runId)).marker;
    if (!marker || !['closing', 'reopening'].includes(marker.state)) return;
    const closing = marker.state === 'closing';
    const record = (await readLifecycle(runId, marker)).record;

    const observed = await readLifecycle(runId, marker);
    const sourceRef = closing ? compactRunDirectory(runId) : historyRunDirectory(runId);
    const targetRef = closing ? historyRunDirectory(runId) : compactRunDirectory(runId);
    await ensureProtectedProjectDirectory(rootDir, targetRef, { label: 'RuntimeStore 历史目标' });
    const source = path.join(rootDir, sourceRef, currentName);
    const target = path.join(rootDir, targetRef, currentName);
    const sourceExists = closing ? observed.active : observed.history;
    const targetExists = closing ? observed.history : observed.active;
    if (!targetExists) {
      // 独占硬链接发布不会覆盖目标；中断时两个名字仍指向同一份 authority。
      await inspectProtectedProjectPath(rootDir, `${sourceRef}/${currentName}`, {
        label: 'RuntimeStore 历史源',
        expected: 'file',
      });
      await inspectProtectedProjectPath(rootDir, targetRef, {
        label: 'RuntimeStore 历史目标',
        expected: 'directory',
      });
      await fs.link(source, target);
      await readLifecycle(runId, marker);
    }
    await syncDirectory(path.dirname(target));
    // 新历史目录的父目录项也必须先持久化，不能仅同步 checkpoint 所在目录。
    await syncDirectory(path.dirname(path.dirname(target)));
    await syncDirectory(rootDir);
    if (sourceExists) {
      await readLifecycle(runId, marker);
      await removeContainedFile(source, {
        containedRoot: rootDir,
        beforeRemove: async () => {
          await readLifecycle(runId, marker!);
        },
      });
      await syncDirectory(path.dirname(source));
    }
    if (closing) await writeLifecycle(runId, 'closed', record);
    else await writeMarker(runId, 'ready', false);
    const committed = await readCurrent(runId, false);
    if (
      !committed ||
      committed.revision !== record.revision ||
      hashLifecycleRecord(committed) !== hashLifecycleRecord(record)
    )
      throw new RuntimeProtocolError('STORE_HISTORY_CONFLICT', '历史转换提交后固定版本发生变化');
  }

  async function transitionRun(
    runId: string,
    expectedRevision: number,
    closing: boolean,
  ): Promise<boolean> {
    assertRunId(runId);
    assertRevision(expectedRevision);
    return withWriter(runId, async () => {
      await settleLifecycle(runId);
      const marker = (await layout(runId)).marker;
      let record: T | null;
      if (marker?.schema === lifecycleSchema) {
        if (closing && marker.state === 'reopening')
          throw new RuntimeProtocolError('STORE_HISTORY_CONFLICT', '请先完成正在进行的恢复事务');
        if (!closing && marker.state === 'closing')
          throw new RuntimeProtocolError('STORE_HISTORY_CONFLICT', '请先完成正在进行的封存事务');
        record = (await readLifecycle(runId, marker)).record;
        if (record.revision !== expectedRevision) return false;
        if (closing && marker.state === 'closed') return true;
      } else {
        record = (await prepareWriter(runId, false)).record;
        if (!record || record.revision !== expectedRevision) return false;
        if (!closing) return true;
      }
      await writeLifecycle(runId, closing ? 'closing' : 'reopening', record);
      await settleLifecycle(runId);
      return true;
    });
  }

  async function readCurrent(runId: string, materialize = true): Promise<T | null> {
    assertRunId(runId);
    if (!(await inspectProtectedProjectPath(volumeRoot, rootRelative, rootOptions)).exists)
      return null;
    const state = await layout(runId);
    if (state.marker?.schema === lifecycleSchema) {
      const { record } = await readLifecycle(runId, state.marker);
      return materialize ? materializeJsonValueProjection(record) : record;
    }
    const history = await readState(runId, false, historyRunDirectory(runId), false);
    if (history.record)
      throw new RuntimeProtocolError('STORE_HISTORY_CONFLICT', '历史 checkpoint 缺少对应存储事务');
    const compact = await readState(runId, false, compactRunDirectory(runId), materialize);
    if (compact.record) {
      if (!state.marker && !(await layout(runId)).marker) {
        throw new RuntimeProtocolError('STORE_CORRUPT_RECORD', 'RuntimeStore 格式标记缺失');
      }
      return compact.record;
    }
    if (state.original.kind === 'directory') {
      const legacy = (await readState(runId)).record;
      if (!legacy && (await layout(runId)).original.kind !== 'directory') {
        throw new RuntimeProtocolError('STORE_CHANGED_LAYOUT', '读取期间旧 Run 已迁移');
      }
      return legacy;
    }
    if (state.marker?.state === 'ready') {
      throw new RuntimeProtocolError(
        'STORE_CORRUPT_RECORD',
        'RuntimeStore checkpoint 缺失，不能回退到旧版本',
      );
    }
    if (state.staged.exists) {
      let legacy: T | null;
      try {
        legacy = (await readState(runId, false, `${compactRunDirectory(runId)}/legacy`)).record;
      } catch (error) {
        // 目录枚举后可能已发布新 checkpoint 并开始回收旧文件；不能把回收间隙误报为历史损坏。
        if ((await layout(runId)).marker?.state === 'ready') {
          throw new RuntimeProtocolError('STORE_CHANGED_LAYOUT', '读取期间旧 Run 已压缩');
        }
        throw error;
      }
      if (!legacy) {
        const after = await layout(runId);
        if (!after.staged.exists || after.marker?.state === 'ready') {
          throw new RuntimeProtocolError('STORE_CHANGED_LAYOUT', '读取期间旧 Run 已压缩');
        }
      }
      return legacy;
    }
    return null;
  }

  async function read(runId: string, materialize = true): Promise<T | null> {
    // 原子替换和迁移可能发生在两次安全路径检查之间；损坏数据从不降级到旧快照。
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await readCurrent(runId, materialize);
      } catch (error) {
        const concurrentRead = error instanceof RaceSafeReadError && error.reason === 'changed';
        const disappeared = ['ENOENT', 'ENOTDIR'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        );
        const moved =
          error instanceof Error &&
          /must be a real directory|STORE_CHANGED_DIRECTORY|STORE_CHANGED_LAYOUT/u.test(
            error.message,
          );
        if ((!concurrentRead && !disappeared && !moved) || attempt >= 15) throw error;
      }
    }
  }

  async function writeMarker(
    runId: string,
    state: FormatMarker['state'],
    exclusive: boolean,
  ): Promise<void> {
    await atomicWriteContainedText(
      path.join(rootDir, runDirectory(runId)),
      JSON.stringify({
        schema: formatSchema,
        ...(options.writerProtocol ? { writerProtocol: options.writerProtocol } : {}),
        runId,
        state,
      }) + '\n',
      { containedRoot: rootDir, exclusive, requireAtomicPublication: true },
    );
  }

  async function syncDirectory(directory: string): Promise<void> {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(directory, 'r');
      await handle.sync();
    } catch (error) {
      // 与 contained-atomic-write 相同：不支持目录 fsync 的文件系统仍可使用原子发布。
      if (
        !['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      )
        throw error;
    } finally {
      await handle?.close();
    }
  }

  async function withWriter<R>(runId: string, operation: () => Promise<R>): Promise<R> {
    await ensureProtectedProjectDirectory(volumeRoot, rootRelative, rootOptions);
    const fence = await inspectProtectedProjectPath(rootDir, '.runtime-store-coordination', {
      label: 'RuntimeStore 写入协议',
      expected: 'directory',
    });
    if (fence.exists && options.writerProtocol !== 'application-holder-v1')
      throw new RuntimeProtocolError(
        'STORE_WRITER_FENCED',
        '此 Store 已启用应用协调协议，请使用应用写入入口',
      );
    await ensureProtectedProjectDirectory(rootDir, compactRunDirectory(runId), {
      label: 'RuntimeStore run',
    });
    await syncDirectory(path.join(rootDir, compactDirectory));
    await syncDirectory(rootDir);
    try {
      return await withRecoverableFileLock(
        path.join(rootDir, compactRunDirectory(runId), lockName),
        operation,
      );
    } catch (error) {
      if (['ENOTSUP', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        throw new RuntimeProtocolError(
          'STORE_ATOMIC_PUBLICATION_UNSUPPORTED',
          '此文件系统不支持原子硬链接发布；请使用支持硬链接的本地目录或其他 RuntimeStore',
        );
      }
      throw error;
    }
  }

  async function publish(
    runId: string,
    record: T,
    state: StoreState,
    serialized = serializeRuntimeHistory(record),
  ): Promise<void> {
    const directory = path.join(rootDir, compactRunDirectory(runId));
    const legacyRevision = state.legacyRevision;
    const { encoded, json } = serialized;
    const payload = encoded.pool
      ? { record: encoded.record, legacyRevision, pool: encoded.pool }
      : { record, legacyRevision };
    const schema = encoded.pool ? 'comet.runtime-store-snapshot.v3' : compactSchema;
    // json 是本次编码生成的对象；只拼接固定 envelope，hash 仍按原 canonical 契约计算。
    const snapshot = `{"schema":${JSON.stringify(schema)},${json.slice(1, -1)},"legacyRevision":${JSON.stringify(legacyRevision)},"hash":${JSON.stringify(hashRuntimeValue(payload))}}\n`;
    await atomicWriteContainedText(path.join(directory, currentName), snapshot, {
      containedRoot: rootDir,
      exclusive: !state.compacted,
      requireAtomicPublication: true,
    });
    if (!state.formatPresent) await writeMarker(runId, 'ready', false);
  }

  async function cleanLegacy(runId: string, legacyRevision: number | null): Promise<void> {
    if (legacyRevision === null) return;
    const reference = `${compactRunDirectory(runId)}/legacy`;
    const staged = await inspectProtectedProjectPath(rootDir, reference, {
      label: 'RuntimeStore legacy',
      expected: 'directory',
    });
    if (!staged.exists) return;
    // authority 与格式标记均已持久化。只清理其覆盖的版本文件，临时文件保留供排查。
    try {
      for (const entry of await fs.readdir(staged.target, { withFileTypes: true })) {
        if (
          entry.isFile() &&
          !entry.isSymbolicLink() &&
          revisionPattern.test(entry.name) &&
          Number(entry.name.slice(0, -5)) <= legacyRevision
        ) {
          await removeContainedFile(path.join(staged.target, entry.name), {
            containedRoot: rootDir,
          });
        }
      }
      await inspectProtectedProjectPath(rootDir, reference, {
        label: 'RuntimeStore legacy',
        expected: 'directory',
      });
      await fs.rmdir(staged.target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') throw error;
      });
    } catch (error) {
      process.stderr.write(
        `[comet] warning: RuntimeStore checkpoint 已提交，旧版本清理将在下次写入重试：${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  async function prepareWriter(runId: string, materialize = true): Promise<StoreState> {
    const before = (await layout(runId)).marker;
    if (before?.writerProtocol && before.writerProtocol !== options.writerProtocol)
      throw new RuntimeProtocolError('STORE_WRITER_FENCED', '此 Run 需要应用协调写入协议');
    await settleLifecycle(runId);
    let inspected = await layout(runId);
    if (inspected.marker?.schema === lifecycleSchema)
      throw new RuntimeProtocolError(
        'STORE_RUN_CLOSED',
        'Run 已封存或正在转换历史分区；请显式恢复后再写入',
      );
    const history = await readState(runId, false, historyRunDirectory(runId), false);
    if (history.record)
      throw new RuntimeProtocolError('STORE_HISTORY_CONFLICT', '历史 checkpoint 缺少对应存储事务');
    const existing = await readState(runId, false, compactRunDirectory(runId), materialize);
    if (existing.record && !inspected.marker) {
      throw new RuntimeProtocolError(
        'STORE_CORRUPT_RECORD',
        'RuntimeStore 格式标记缺失，不能恢复旧写入路径',
      );
    }
    if (inspected.original.kind === 'directory') {
      // 两次完整验证夹住迁移：旧进程在 rename 前已成功的发布必须包含在恢复基线中。
      await readState(runId, true);
      const before = await fs.lstat(inspected.original.target);
      await inspectProtectedProjectPath(
        volumeRoot,
        `${rootRelative}/${runDirectory(runId)}`,
        rootOptions,
      );
      await inspectProtectedProjectPath(rootDir, compactRunDirectory(runId), rootOptions);
      await fs.rename(inspected.original.target, inspected.staged.target);
      const moved = await fs.lstat(inspected.staged.target);
      if (
        !moved.isDirectory() ||
        moved.isSymbolicLink() ||
        !sameFileObject(
          { dev: before.dev, ino: before.ino, birthtime: before.birthtimeMs },
          { dev: moved.dev, ino: moved.ino, birthtime: moved.birthtimeMs },
        )
      )
        throw new RuntimeProtocolError('STORE_CHANGED_DIRECTORY', '迁移时旧 Run 目录已变化');
      // 先持久化目标目录项，再持久化源目录移除；fence 不能比旧历史的迁移更早落盘。
      await syncDirectory(path.join(rootDir, compactRunDirectory(runId)));
      await syncDirectory(rootDir);
      inspected = await layout(runId);
    }
    if (!inspected.marker) {
      try {
        await writeMarker(runId, 'pending', true);
      } catch (error) {
        if (['EEXIST', 'EISDIR', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          throw new RuntimeProtocolError(
            'STORE_MIGRATION_CONFLICT',
            '旧写入者在迁移期间重新创建了 Run 路径；已保留迁移现场，未提交新 checkpoint',
          );
        }
        throw error;
      }
      inspected = await layout(runId);
    }
    let state = existing;
    if (!state.record && inspected.marker?.state === 'ready') {
      throw new RuntimeProtocolError(
        'STORE_CORRUPT_RECORD',
        'RuntimeStore checkpoint 缺失，不能回退到旧版本',
      );
    }
    if (!state.record && inspected.staged.exists) {
      state = await readState(runId, true, `${compactRunDirectory(runId)}/legacy`);
      if (state.record) {
        await publish(runId, state.record, state);
        state = { ...state, compacted: true, formatPresent: true };
      }
    } else if (state.record && inspected.marker?.state === 'pending') {
      await writeMarker(runId, 'ready', false);
    }
    if (state.record) {
      state.formatPresent = true;
      await cleanLegacy(runId, state.legacyRevision);
    }
    return state;
  }

  return {
    queryScope: `file:${createHash('sha256').update(rootDir).digest('hex')}`,
    read,
    readProjection: (runId) => read(runId, false),
    readPartitionMetadata,
    settleRun: (runId) =>
      runWithoutHookReadCache(async () => {
        if ((await readPartitionMetadata(runId)) === 'missing') return 'missing';
        return withWriter(runId, async () => {
          await settleLifecycle(runId);
          const marker = (await layout(runId)).marker;
          if (
            marker &&
            options.writerProtocol &&
            marker.writerProtocol !== options.writerProtocol
          ) {
            await atomicWriteContainedText(
              path.join(rootDir, runDirectory(runId)),
              JSON.stringify({ ...marker, writerProtocol: options.writerProtocol }) + '\n',
              { containedRoot: rootDir, requireAtomicPublication: true },
            );
          }
          return readPartitionMetadata(runId);
        });
      }),
    closeRun: (runId, expectedRevision) =>
      runWithoutHookReadCache(() => transitionRun(runId, expectedRevision, true)),
    reopenRun: (runId, expectedRevision) =>
      runWithoutHookReadCache(() => transitionRun(runId, expectedRevision, false)),
    async readDisposition(runId) {
      const record = await read(runId, false);
      if (!record) return 'missing';
      const marker = (await layout(runId)).marker;
      return marker?.schema === lifecycleSchema
        ? (marker.state as 'closing' | 'closed' | 'reopening')
        : 'active';
    },
    async restoreCheckpoint(runId, expectedRevision, checkpoint) {
      const snapshot = JSON.parse(serializeCheckpoint(runId, expectedRevision, checkpoint)) as T;
      assertMirroredRevisions(snapshot);
      return withWriter(runId, async () => {
        const state = await prepareWriter(runId);
        if (!matchesCheckpoint(state.record, expectedRevision, snapshot, revisionPaths))
          return false;
        await publish(runId, snapshot, state);
        return true;
      });
    },
    compareAndSwap: async (runId, expectedRevision, next) =>
      prepareCompareAndSwap(runId, expectedRevision, next)(),
    prepareCompareAndSwap,
  };

  function prepareCompareAndSwap(
    runId: string,
    expectedRevision: number | null,
    next: T,
  ): () => Promise<boolean> {
    snapshotNext(runId, expectedRevision, next, false);
    assertMirroredRevisions(next);
    // 在首个 await 前保存压缩快照，既隔离调用方修改，也不复制展开的历史。
    const { json } = serializeRuntimeHistory(next);
    const encoded = JSON.parse(json) as ReturnType<typeof serializeRuntimeHistory<T>>['encoded'];
    return () =>
      withWriter(runId, async () => {
        // CAS 只需要校验已有 envelope、引用和 revision，不展开已有历史映射。
        const state = await prepareWriter(runId, false);
        if ((state.record?.revision ?? null) !== expectedRevision) return false;
        await publish(runId, encoded.record, state, { encoded, json });
        return true;
      });
  }
}
