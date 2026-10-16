import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { sameFileObject } from '../../platform/fs/file-identity.js';
import { RaceSafeReadError } from '../../platform/fs/race-safe-read.js';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';

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
import { RuntimeProtocolError } from './runtime-errors.js';
import { encodeRuntimeHistory } from './runtime-history-storage.js';
import { decodeJsonValueMaps } from '../../platform/fs/json-value-pool.js';

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
  return JSON.stringify(snapshotNext(runId, expectedRevision, next));
}

function snapshotNext<T extends RuntimeRecord>(
  runId: string,
  expectedRevision: number | null,
  next: T,
): T {
  assertRunId(runId);
  if (utilTypes.isProxy(next))
    throw new RuntimeProtocolError(
      'STORE_INVALID_RUN_ID',
      'RuntimeStore records must be plain JSON data',
    );
  if (expectedRevision !== null) assertRevision(expectedRevision);
  validateRuntimeValue(next);
  const snapshot = structuredClone(next);
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
 * 使用可恢复的跨进程锁串行 CAS，以原子替换保存一个带校验值的完整 checkpoint。
 * 旧版本历史只在写入时迁移：先验证、发布新 authority 和格式标记，再清理已覆盖文件。
 * 不使用增量日志；checkpoint 内的业务历史仍由调用者维护。
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

  const currentName = 'checkpoint.json';
  const formatSchema = 'comet.runtime-store-format.v2';
  const compactDirectory = '.runtime-store-v2';
  const compactRunDirectory = (runId: string) => `${compactDirectory}/${runDirectory(runId)}`;
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
    if (runRef === compactRunDirectory(runId) && legacyNames.length > 0) {
      throw new RuntimeProtocolError('STORE_INVALID_ENTRY', 'checkpoint 目录不能包含旧版本文件');
    }
    if (names.has(currentName)) {
      if (runRef !== compactRunDirectory(runId)) {
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
            ? decodeJsonValueMaps(stored, snapshot.pool)
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
    state: 'pending' | 'ready';
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
        value.schema !== formatSchema ||
        value.runId !== runId ||
        !['pending', 'ready'].includes(value.state) ||
        Object.keys(value).some((key) => !['schema', 'runId', 'state'].includes(key))
      ) {
        throw new RuntimeProtocolError('STORE_CORRUPT_RECORD', 'RuntimeStore 格式标记损坏');
      }
      marker = value;
    }
    return { original, staged, marker };
  }

  async function readCurrent(runId: string): Promise<T | null> {
    assertRunId(runId);
    if (!(await inspectProtectedProjectPath(volumeRoot, rootRelative, rootOptions)).exists)
      return null;
    const state = await layout(runId);
    const compact = await readState(runId, false, compactRunDirectory(runId));
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

  async function read(runId: string): Promise<T | null> {
    // 原子替换和迁移可能发生在两次安全路径检查之间；损坏数据从不降级到旧快照。
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await readCurrent(runId);
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

  async function publish(runId: string, record: T, state: StoreState): Promise<void> {
    const directory = path.join(rootDir, compactRunDirectory(runId));
    const legacyRevision = state.legacyRevision;
    const encoded = encodeRuntimeHistory(record);
    const payload = encoded.pool
      ? { record: encoded.record, legacyRevision, pool: encoded.pool }
      : { record, legacyRevision };
    await atomicWriteContainedText(
      path.join(directory, currentName),
      JSON.stringify({
        schema: encoded.pool ? 'comet.runtime-store-snapshot.v3' : compactSchema,
        ...payload,
        hash: hashRuntimeValue(payload),
      }) + '\n',
      { containedRoot: rootDir, exclusive: !state.compacted, requireAtomicPublication: true },
    );
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

  async function prepareWriter(runId: string): Promise<StoreState> {
    let inspected = await layout(runId);
    const existing = await readState(runId, false, compactRunDirectory(runId));
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
    read,
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
    async compareAndSwap(runId, expectedRevision, next) {
      const snapshot = snapshotNext(runId, expectedRevision, next);
      assertMirroredRevisions(snapshot);
      return withWriter(runId, async () => {
        const state = await prepareWriter(runId);
        if ((state.record?.revision ?? null) !== expectedRevision) return false;
        await publish(runId, snapshot, state);
        return true;
      });
    },
  };
}
