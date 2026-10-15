import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  promises as fs,
  lstatSync,
  readFileSync,
  readdirSync,
  openSync,
  closeSync,
  fstatSync,
  realpathSync,
  type BigIntStats,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { hashFileRaceSafe, readFileRaceSafe } from '../../platform/fs/race-safe-read.js';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';
import {
  inspectProcessLiveness,
  readProcessIdentity,
} from '../../platform/process/process-identity.js';
import {
  resolveWorkspaceRuntimeLocation,
  resolveWorkspaceRuntimeRootSync,
} from '../../platform/paths/workspace-runtime.js';
import { atomicWriteContainedText } from './contained-atomic-write.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
} from './protected-project-path.js';

export { resolveWorkspaceRuntimeRootSync };

/** 只读发现当前与未迁移的旧 Runtime，不创建目录或开始迁移。 */
export async function readWorkspaceRuntimeRoots(projectRoot: string): Promise<string[]> {
  const root = await fs.realpath(projectRoot);
  const current = resolveWorkspaceRuntimeRootSync(root);
  const prior = await inspectProtectedProjectPath(root, '.comet/runtime', {
    label: '旧 Workspace Runtime 只读查询',
  });
  if (!prior.exists || (await isWorkspaceRuntimeMigrationFence(prior.target))) return [current];
  if (!(await fs.lstat(prior.target)).isDirectory())
    throw new Error('旧 Workspace Runtime 必须是真实目录');
  return [current, prior.target];
}

const FENCE_SCHEMA = 'comet.workspace-runtime-migration.v1';
const FENCE_MARKER = '.comet-runtime-migration.json';
const JOURNAL_SCHEMA = 'comet.workspace-runtime-migration-journal.v1';
const MAX_METADATA_BYTES = 1024 * 1024;
const inFlight = new Map<string, Promise<void>>();
const fenceInFlight = new Map<string, Promise<void>>();
const failedMigrations = new Set<string>();

interface MigrationFence {
  schema: typeof FENCE_SCHEMA;
  workspaceId: string;
  source: string;
  target: string;
  kind: 'file' | 'directory';
}

interface MigrationJournal extends MigrationFence {
  journalSchema: typeof JOURNAL_SCHEMA;
  id: string;
  backup: string;
  stage: string;
  contentHash: string;
  sourceIdentity: string;
  pid: number;
  hostname: string;
  processIdentity?: string;
}

interface Entry {
  relative: string;
  kind: 'file' | 'directory';
  identity: string;
  version: string;
  mode: number;
  digest?: string;
  size: number;
}

export interface WorkspaceRuntimeMigrationOptions {
  projectRoot: string;
  /** 已验证的额外源根，例如当前工作区的 Git common directory；目标仍按 projectRoot 隔离。 */
  sourceRoot?: string;
  /** 便携副本中的异工作区 fence 不代表本机数据；不读取其中记录的目标。 */
  ignoreForeignWorkspaceFence?: boolean;
  /** 测试故障注入；任何异常都保留 journal 和已存在的数据副本。 */
  testHooks?: {
    afterJournal?: () => void | Promise<void>;
    afterFence?: () => void | Promise<void>;
    afterCopy?: () => void | Promise<void>;
    beforePublish?: () => void | Promise<void>;
    afterPublish?: () => void | Promise<void>;
  };
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

async function statOrNull(file: string): Promise<BigIntStats | null> {
  try {
    return await fs.lstat(file, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function identity(stat: BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
}

function version(stat: BigIntStats): string {
  return `${identity(stat)}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

async function assertRealDirectory(directory: string): Promise<void> {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`Runtime 路径必须是真实目录：${directory}`);
}

/** 逐级创建；已存在的链接、文件和设备均不能成为 Runtime 的父目录。 */
async function ensureAbsoluteDirectory(directory: string): Promise<void> {
  const parent = path.dirname(directory);
  if (parent === directory) {
    await assertRealDirectory(directory);
    return;
  }
  await ensureAbsoluteDirectory(parent);
  try {
    await fs.mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await assertRealDirectory(directory);
}

async function assertPath(
  root: string,
  target: string,
  expected: 'file' | 'directory' | 'any' = 'any',
): Promise<boolean> {
  if (!isInside(root, target)) throw new Error(`Runtime 路径超出受管目录：${target}`);
  if (root === target) {
    const stat = await statOrNull(root);
    if (!stat) return false;
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error(`Runtime 根必须是真实目录：${root}`);
    return true;
  }
  return (
    await inspectProtectedProjectPath(root, path.relative(root, target).split(path.sep).join('/'), {
      label: 'Workspace Runtime',
      expected,
    })
  ).exists;
}

function journalPath(source: string): string {
  return path.join(path.dirname(source), `.${path.basename(source)}.comet-runtime-migration.json`);
}

async function readJson(file: string, maxBytes = MAX_METADATA_BYTES): Promise<unknown> {
  const { bytes } = await readFileRaceSafe(file, maxBytes, { label: 'Runtime 迁移记录' });
  return JSON.parse(bytes.toString('utf8')) as unknown;
}

function parseFence(value: unknown): MigrationFence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fence = value as Partial<MigrationFence>;
  if (fence.schema !== FENCE_SCHEMA) return null;
  if (
    typeof fence.workspaceId !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(fence.workspaceId) ||
    typeof fence.source !== 'string' ||
    !path.isAbsolute(fence.source) ||
    typeof fence.target !== 'string' ||
    !path.isAbsolute(fence.target) ||
    (fence.kind !== 'file' && fence.kind !== 'directory')
  )
    throw new Error('Runtime 迁移 fence 已损坏');
  return fence as MigrationFence;
}

/** 只识别迁移标记；调用方仍须通过 resolver 验证 workspace 和目的地。 */
export async function isWorkspaceRuntimeMigrationFence(
  source: string,
  target?: string,
  options?: { projectRoot: string; ignoreForeignWorkspaceFence?: boolean },
): Promise<boolean> {
  const stat = await statOrNull(source);
  if (!stat) return false;
  if (stat.isSymbolicLink()) throw new Error(`Runtime 迁移路径不能是符号链接：${source}`);
  const file = stat.isDirectory() ? path.join(source, FENCE_MARKER) : source;
  const fileStat = await statOrNull(file);
  if (!fileStat) return false;
  if (stat.isFile() && fileStat.size > BigInt(MAX_METADATA_BYTES)) return false;
  let value;
  try {
    value = await readJson(file);
  } catch (error) {
    if (error instanceof SyntaxError && stat.isFile()) return false;
    throw error;
  }
  const fence = parseFence(value);
  if (!fence) return false;
  const foreign =
    options !== undefined &&
    fence.workspaceId !== resolveWorkspaceRuntimeLocation(options.projectRoot).workspaceId;
  if (foreign && !options?.ignoreForeignWorkspaceFence)
    throw new Error(`Runtime 迁移 fence 属于其他工作区：${source}`);
  if (!foreign && target !== undefined && path.resolve(target) !== fence.target)
    throw new Error(`Runtime 迁移 fence 属于其他路径或工作区，不能沿用：${source}`);
  if ((stat.isDirectory() ? 'file' : 'directory') !== fence.kind)
    throw new Error(`Runtime 迁移 fence 类型无效：${source}`);
  if (stat.isDirectory() && (await fs.readdir(source)).some((entry) => entry !== FENCE_MARKER))
    throw new Error(`Runtime 迁移 fence 含有额外内容：${source}`);
  return true;
}

/** 同步路径消费者只读识别；不创建目录，也不尝试迁移或修复。 */
export function isWorkspaceRuntimeMigrationFenceSync(source: string, target?: string): boolean {
  let stat;
  try {
    stat = lstatSync(source);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error(`Runtime 迁移路径不能是符号链接：${source}`);
  const file = stat.isDirectory() ? path.join(source, FENCE_MARKER) : source;
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error(`Runtime 迁移 fence 必须是真实文件：${file}`);
  if (before.size > BigInt(MAX_METADATA_BYTES)) {
    if (stat.isFile()) return false;
    throw new Error(`Runtime 迁移 fence 过大：${file}`);
  }
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let value;
  try {
    const bytes = readFileSync(fd);
    if (
      version(fstatSync(fd, { bigint: true })) !== version(before) ||
      version(lstatSync(file, { bigint: true })) !== version(before)
    )
      throw new Error(`Runtime 迁移 fence 在读取时发生变化：${file}`);
    try {
      value = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch (error) {
      if (error instanceof SyntaxError && stat.isFile()) return false;
      throw error;
    }
  } finally {
    closeSync(fd);
  }
  const fence = parseFence(value);
  if (!fence) return false;
  if (target !== undefined && path.resolve(target) !== fence.target)
    throw new Error(`Runtime 迁移 fence 属于其他路径或工作区，不能沿用：${source}`);
  if ((stat.isDirectory() ? 'file' : 'directory') !== fence.kind)
    throw new Error(`Runtime 迁移 fence 类型无效：${source}`);
  if (stat.isDirectory() && readdirSync(source).some((entry) => entry !== FENCE_MARKER))
    throw new Error(`Runtime 迁移 fence 含有额外内容：${source}`);
  return true;
}

function hazardousName(relative: string): boolean {
  return relative
    .split('/')
    .some((name) =>
      /(?:\.lock|\.choosing|\.ticket|\.tmp|\.stop|\.comet-runtime-migration\.json)$/u.test(name),
    );
}

function unfinishedProcess(value: unknown, context = ''): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => unfinishedProcess(entry, context));
  const record = value as Record<string, unknown>;
  const state = record.status ?? record.phase;
  const executing = ['running', 'reserved', 'active', 'claimed', 'unknown'].includes(String(state));
  if (
    executing &&
    (/(?:execution|activeProcess|action|claim)/iu.test(context) ||
      Object.keys(record).some((key) =>
        /^(?:pid|ownerPid|owner_pid|child|owner|claim)$/u.test(key),
      ))
  )
    return true;
  return Object.entries(record).some(([key, child]) =>
    unfinishedProcess(child, `${context}/${key}`),
  );
}

async function inspectQuiescence(file: string, relative: string): Promise<void> {
  if (await isWorkspaceRuntimeMigrationFence(file)) return;
  if (hazardousName(relative))
    throw new Error(`旧 Runtime 含锁或未完成写入；请先停止旧进程并恢复，再迁移：${file}`);
  if (path.basename(relative) === 'trajectory.jsonl') return inspectClassicTrajectory(file);
  const normalized = relative.split('/');
  const transactionIndex = normalized.findIndex((part) => /^transactions?$/iu.test(part));
  const transactionTail = transactionIndex < 0 ? [] : normalized.slice(transactionIndex + 1);
  const transaction =
    /(?:transaction|journal)[^/]*\.json$/iu.test(path.basename(relative)) ||
    (transactionTail.length === 1 && relative.endsWith('.json'));
  // 已完成事务的 staged/backups 是历史证据，不是当前执行记录。
  if (transactionIndex >= 0 && !transaction) return;
  const execution = /(?:execution|process|action|run|state|checkpoint)/iu.test(relative);
  if (!relative.endsWith('.json') || (!transaction && !execution)) return;
  let value: unknown;
  try {
    value = await readJson(file, Number.MAX_SAFE_INTEGER);
  } catch (error) {
    throw new Error(`旧 Runtime 状态无法验证，保留原数据：${file}`, { cause: error });
  }
  if (path.basename(relative) === 'pending-action.json' && value !== null)
    throw new Error(`旧 Runtime 仍有 pending action；请先恢复或取消旧执行：${file}`);
  if (transaction) {
    const status = (value as { status?: unknown } | null)?.status;
    if (status !== 'committed' && status !== 'rolled-back')
      throw new Error(`旧 Runtime 含未完成事务；请先使用旧 Runtime 恢复：${file}`);
    return;
  }
  if (unfinishedProcess(value, relative))
    throw new Error(`旧 Runtime 含活跃执行；请先停止并恢复执行：${file}`);
}

function canonicalStoredJson(value: unknown): string {
  function normalized(current: unknown, depth: number): unknown {
    if (depth > 64) throw new Error('Runtime 记录嵌套超过 64 层');
    if (Array.isArray(current)) return current.map((item) => normalized(item, depth + 1));
    if (!current || typeof current !== 'object') return current;
    return Object.fromEntries(
      Object.keys(current)
        .sort()
        .map((key) => [key, normalized((current as Record<string, unknown>)[key], depth + 1)]),
    );
  }
  return JSON.stringify(normalized(value, 0));
}

function storedHash(value: unknown): string {
  return createHash('sha256').update(canonicalStoredJson(value)).digest('hex');
}

function validateStoredRecord(
  value: unknown,
  runId?: string,
  revision?: number,
): asserts value is { runId: string; revision: number; run?: { revision?: unknown } } {
  const record = value as {
    runId?: unknown;
    revision?: unknown;
    run?: { revision?: unknown };
  } | null;
  if (
    !record ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    typeof record.runId !== 'string' ||
    !record.runId ||
    !Number.isSafeInteger(record.revision) ||
    Number(record.revision) < 1 ||
    (runId !== undefined && record.runId !== runId) ||
    (revision !== undefined && record.revision !== revision) ||
    (record.run?.revision !== undefined && record.run.revision !== record.revision)
  )
    throw new Error('旧 Runtime 版本记录无效或不连续');
}

async function inspectRevisionHead(
  directory: string,
  names: readonly string[],
): Promise<string | null> {
  const revisions = names.filter((name) => /^[0-9]{16}\.json$/u.test(name));
  if (!revisions.length) return null;
  const slots = new Set(revisions.map((name) => Number(name.slice(0, -5))));
  const records = new Map<number, unknown>();
  const latest = Number(revisions.at(-1)!.slice(0, -5));
  async function readRecord(slot: number): Promise<unknown> {
    if (records.has(slot)) return records.get(slot);
    const value = await readJson(
      path.join(directory, `${String(slot).padStart(16, '0')}.json`),
      Number.MAX_SAFE_INTEGER,
    );
    if (slot === 1 || slot === 2 || slot === latest) records.set(slot, value);
    return value;
  }
  let baseline: {
    slot: number;
    record: { runId: string; revision: number; run?: { revision?: unknown } };
  } | null = null;
  for (const slot of [1, 2]) {
    if (!slots.has(slot)) break;
    const value = (await readRecord(slot)) as {
      schema?: unknown;
      record?: unknown;
      hash?: unknown;
      runId?: unknown;
    } | null;
    if (value?.schema !== 'comet.runtime-store-checkpoint.v1' || Object.hasOwn(value, 'runId'))
      continue;
    validateStoredRecord(value.record);
    if (
      value.record.revision < slot ||
      value.hash !== storedHash(value.record) ||
      Object.keys(value).some((key) => !['schema', 'record', 'hash'].includes(key))
    )
      throw new Error('旧 Runtime 恢复基线校验失败');
    if (slot === 2) {
      const initial = structuredClone(value.record);
      initial.revision = 1;
      if (initial.run?.revision !== undefined) initial.run.revision = 1;
      if (canonicalStoredJson(await readRecord(1)) !== canonicalStoredJson(initial))
        throw new Error('旧 Runtime 恢复基线与初始版本不一致');
    }
    baseline = { slot, record: value.record };
    break;
  }
  const baseRevision = baseline?.record.revision ?? 0;
  const baseSlot = baseline?.slot ?? 0;
  const lastRevision = latest === baseSlot ? baseRevision : latest;
  if (
    !slots.has(1) ||
    lastRevision < baseRevision ||
    revisions.length !== lastRevision - baseRevision + baseSlot ||
    [...slots].some(
      (revision) =>
        !Number.isSafeInteger(revision) ||
        revision < 1 ||
        (revision > baseSlot && revision <= baseRevision),
    )
  )
    throw new Error('旧 Runtime 版本记录无效或不连续');
  const latestValue = latest === baseSlot ? baseline!.record : await readRecord(latest);
  validateStoredRecord(latestValue, baseline?.record.runId, lastRevision);
  for (const revision of slots) {
    if (revision !== baseSlot)
      validateStoredRecord(await readRecord(revision), latestValue.runId, revision);
  }
  // v2 checkpoint 已发布时才可取代旧历史；先验证其内容绑定，不能仅凭文件存在。
  const compact = path.join(
    path.dirname(directory),
    '.runtime-store-v2',
    path.basename(directory),
    'checkpoint.json',
  );
  if (await statOrNull(compact)) {
    const current = (await readJson(compact, Number.MAX_SAFE_INTEGER)) as {
      schema?: unknown;
      record?: unknown;
      hash?: unknown;
      legacyRevision?: unknown;
    };
    validateStoredRecord(current.record, latestValue.runId);
    if (
      current.schema !== 'comet.runtime-store-snapshot.v2' ||
      current.hash !==
        storedHash({ record: current.record, legacyRevision: current.legacyRevision }) ||
      current.legacyRevision !== latestValue.revision ||
      current.record.revision < latestValue.revision ||
      Object.keys(current).some(
        (key) => !['schema', 'record', 'hash', 'legacyRevision'].includes(key),
      )
    )
      throw new Error('Runtime checkpoint 与旧历史不一致');
    if (unfinishedProcess(current.record, 'sdk-run'))
      throw new Error(`旧 Runtime 含活跃执行：${compact}`);
    return '';
  }
  return revisions.at(-1)!;
}

async function inspectClassicTrajectory(file: string): Promise<void> {
  const { bytes } = await readFileRaceSafe(file, Number.MAX_SAFE_INTEGER, {
    label: 'Classic 执行轨迹',
  });
  const pending = new Map<string, number>();
  for (const line of bytes.toString('utf8').split(/\r?\n/u).filter(Boolean)) {
    let event: {
      type?: unknown;
      runId?: unknown;
      data?: {
        scope?: unknown;
        action?: { id?: unknown; inputHash?: unknown; attempt?: unknown; status?: unknown };
      };
    };
    try {
      event = JSON.parse(line) as typeof event;
    } catch (error) {
      throw new Error(`Classic 执行轨迹损坏，不能证明旧执行已停止：${file}`, { cause: error });
    }
    if (!event || typeof event !== 'object') throw new Error(`Classic 执行轨迹无效：${file}`);
    if (event.type !== 'command_check_started' && event.type !== 'command_check_executed') continue;
    if (typeof event.runId !== 'string' || !event.runId || typeof event.data?.scope !== 'string')
      throw new Error(`Classic 命令执行记录缺少归属：${file}`);
    const action = event.data.action;
    if (
      action &&
      (typeof action.id !== 'string' ||
        typeof action.inputHash !== 'string' ||
        !Number.isSafeInteger(action.attempt))
    )
      throw new Error(`Classic 命令执行记录缺少 action 身份：${file}`);
    const key = JSON.stringify([
      event.runId,
      event.data.scope,
      action ? [action.id, action.inputHash, action.attempt] : null,
    ]);
    if (event.type === 'command_check_started') pending.set(key, (pending.get(key) ?? 0) + 1);
    else if (!action || action.status === 'succeeded' || action.status === 'failed') {
      const count = pending.get(key) ?? 0;
      if (count <= 1) pending.delete(key);
      else pending.set(key, count - 1);
    }
  }
  if (pending.size)
    throw new Error(`旧 Classic 命令尚未记录执行结束；请先停止并恢复旧执行：${file}`);
}

async function snapshotTree(root: string, checkQuiescence: boolean): Promise<Entry[]> {
  const entries: Entry[] = [];
  const rootStat = await fs.lstat(root, { bigint: true });
  const rootIdentity = identity(rootStat);
  async function visit(file: string, relative: string, authoritative = true): Promise<void> {
    const stat = await fs.lstat(file, { bigint: true });
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
      throw new Error(`Runtime 迁移拒绝符号链接或特殊文件：${file}`);
    if (stat.isFile() && stat.nlink !== 1n) throw new Error(`Runtime 迁移拒绝硬链接：${file}`);
    if (
      checkQuiescence &&
      hazardousName(relative || path.basename(file)) &&
      !(await isWorkspaceRuntimeMigrationFence(file))
    )
      throw new Error(`旧 Runtime 含锁或未完成写入；请先停止旧进程并恢复：${file}`);
    const entry: Entry = {
      relative,
      kind: stat.isDirectory() ? 'directory' : 'file',
      identity: identity(stat),
      version: version(stat),
      mode: Number(stat.mode) & 0o777,
      size: Number(stat.size),
    };
    entries.push(entry);
    if (stat.isDirectory()) {
      const names = (await fs.readdir(file)).sort();
      const revisionHead = checkQuiescence ? await inspectRevisionHead(file, names) : null;
      for (const child of names)
        await visit(
          path.join(file, child),
          relative ? `${relative}/${child}` : child,
          !/^[0-9]{16}\.json$/u.test(child) || revisionHead === child,
        );
    } else {
      if (checkQuiescence && authoritative)
        await inspectQuiescence(file, relative || path.basename(file));
      const hashed = await hashFileRaceSafe(file, {
        bigint: true,
        label: 'Runtime 迁移源',
        verify: async () => {
          if (identity(await fs.lstat(root, { bigint: true })) !== rootIdentity)
            throw new Error(`Runtime 迁移源已替换：${root}`);
          if (rootStat.isDirectory()) await assertPath(root, file, 'file');
        },
      });
      if (version(hashed.stat as BigIntStats) !== entry.version)
        throw new Error(`Runtime 迁移源在读取期间变化：${file}`);
      entry.digest = hashed.digest;
    }
  }
  await visit(root, '');
  return entries;
}

function contentManifest(entries: readonly Entry[]): string {
  return JSON.stringify(
    entries.map(({ relative, kind, mode, digest }) => ({ relative, kind, mode, digest })),
  );
}

function unchangedManifest(entries: readonly Entry[]): string {
  return JSON.stringify(
    entries.map(({ relative, kind, identity: object, version: state, digest }) => ({
      relative,
      kind,
      object,
      state: kind === 'file' ? state : undefined,
      digest,
    })),
  );
}

async function inspectSiblingWriters(
  projectRoot: string,
  source: string,
  ignoreOwnJournal = true,
): Promise<void> {
  let parent = path.dirname(source);
  while (isInside(projectRoot, parent)) {
    for (const entry of await fs.readdir(parent, { withFileTypes: true })) {
      if (
        hazardousName(entry.name) ||
        /(?:transaction|root-move).*\.json$/iu.test(entry.name) ||
        entry.name === 'trajectory.jsonl' ||
        entry.name === 'pending-action.json'
      ) {
        const file = path.join(parent, entry.name);
        if (!ignoreOwnJournal || file !== journalPath(source))
          await inspectQuiescence(file, entry.name);
      }
    }
    if (parent === projectRoot) break;
    parent = path.dirname(parent);
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
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

async function copySnapshot(
  source: string,
  target: string,
  entries: readonly Entry[],
): Promise<void> {
  for (const entry of entries) {
    const from = path.join(source, entry.relative);
    const to = path.join(target, entry.relative);
    if (entry.kind === 'directory') {
      await fs.mkdir(to, { mode: 0o700 });
      continue;
    }
    const input = await fs.open(from, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let output;
    try {
      if (version(await input.stat({ bigint: true })) !== entry.version)
        throw new Error(`Runtime 迁移源已变化：${from}`);
      output = await fs.open(to, 'wx', entry.mode);
      const digest = createHash('sha256');
      const buffer = Buffer.alloc(128 * 1024);
      for (;;) {
        const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        digest.update(buffer.subarray(0, bytesRead));
        await output.writeFile(buffer.subarray(0, bytesRead));
      }
      await output.chmod(entry.mode);
      await output.sync();
      if (
        digest.digest('hex') !== entry.digest ||
        version(await input.stat({ bigint: true })) !== entry.version
      )
        throw new Error(`Runtime 迁移复制期间源文件变化：${from}`);
    } finally {
      await output?.close();
      await input.close();
    }
  }
  for (const entry of [...entries].reverse())
    if (entry.kind === 'directory') {
      await fs.chmod(path.join(target, entry.relative), entry.mode);
      await syncDirectory(path.join(target, entry.relative));
    }
}

async function readMigrationJournal(
  source: string,
  target: string,
  projectRoot: string,
): Promise<MigrationJournal | null> {
  const file = journalPath(source);
  if (!(await statOrNull(file))) return null;
  const value = (await readJson(file)) as Partial<MigrationJournal>;
  const location = resolveWorkspaceRuntimeLocation(projectRoot);
  if (
    !parseFence(value) ||
    value.journalSchema !== JOURNAL_SCHEMA ||
    typeof value.id !== 'string' ||
    !/^[a-f0-9-]{36}$/u.test(value.id) ||
    value.workspaceId !== location.workspaceId ||
    value.source !== source ||
    value.target !== target ||
    value.backup !==
      path.join(
        path.dirname(source),
        `.${path.basename(source)}.comet-runtime-source-${value.id}`,
      ) ||
    value.stage !==
      path.join(
        path.dirname(target),
        `.${path.basename(target)}.comet-runtime-stage-${value.id}`,
      ) ||
    typeof value.contentHash !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.contentHash) ||
    typeof value.sourceIdentity !== 'string' ||
    !value.sourceIdentity ||
    !Number.isSafeInteger(value.pid) ||
    Number(value.pid) < 1 ||
    typeof value.hostname !== 'string' ||
    (value.processIdentity !== undefined && typeof value.processIdentity !== 'string')
  )
    throw new Error(`Runtime 迁移记录无效，拒绝自动恢复：${file}`);
  return value as MigrationJournal;
}

async function canRecover(journal: MigrationJournal): Promise<boolean> {
  if (journal.hostname !== os.hostname()) return false;
  if (journal.pid === process.pid && failedMigrations.has(journal.id)) return true;
  return (await inspectProcessLiveness(journal.pid, journal.processIdentity)) === 'dead';
}

async function assertBoundSnapshot(
  file: string,
  journal: MigrationJournal,
  source: boolean,
): Promise<Entry[]> {
  const snapshot = await snapshotTree(file, source);
  if (
    snapshot[0].kind !== journal.kind ||
    createHash('sha256').update(contentManifest(snapshot)).digest('hex') !== journal.contentHash ||
    (source && snapshot[0].identity !== journal.sourceIdentity)
  )
    throw new Error(`Runtime 迁移数据与已锁定的摘要不一致，拒绝恢复：${file}`);
  return snapshot;
}

async function rebuildPartialStage(
  source: string,
  stage: string,
  original: readonly Entry[],
): Promise<void> {
  const partial = await snapshotTree(stage, false);
  const expected = new Map(original.map((entry) => [entry.relative, entry]));
  for (const entry of partial) {
    const bound = expected.get(entry.relative);
    if (!bound || bound.kind !== entry.kind || (entry.kind === 'file' && entry.size > bound.size))
      throw new Error(`Runtime 迁移暂存内容与摘要不一致，拒绝删除：${stage}`);
    if (entry.kind !== 'file') continue;
    if (entry.size === bound.size && entry.digest === bound.digest) continue;
    const file = path.join(source, entry.relative);
    const input = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (version(await input.stat({ bigint: true })) !== bound.version)
        throw new Error('Runtime 迁移备份在部分复制恢复前发生变化');
      const hash = createHash('sha256');
      const buffer = Buffer.alloc(128 * 1024);
      let remaining = entry.size;
      while (remaining > 0) {
        const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, remaining), null);
        if (!bytesRead) throw new Error('Runtime 迁移备份意外结束');
        hash.update(buffer.subarray(0, bytesRead));
        remaining -= bytesRead;
      }
      if (
        hash.digest('hex') !== entry.digest ||
        version(await input.stat({ bigint: true })) !== bound.version
      )
        throw new Error(`Runtime 迁移暂存内容与摘要不一致，拒绝删除：${stage}`);
    } finally {
      await input.close();
    }
  }
  if (
    unchangedManifest(partial) !== unchangedManifest(await snapshotTree(stage, false)) ||
    unchangedManifest(original) !== unchangedManifest(await snapshotTree(source, true))
  )
    throw new Error('Runtime 迁移数据在部分复制恢复时发生变化');
  // 唯一允许丢弃的是同一事务的目录子集和文件前缀；独有或改写内容必须保留。
  await fs.rm(stage, { recursive: true });
  await copySnapshot(source, stage, original);
}

async function writeMigrationFence(journal: MigrationJournal, projectRoot: string): Promise<void> {
  const { source, target, workspaceId, kind } = journal;
  if (kind === 'file' && !(await statOrNull(source))) await fs.mkdir(source, { mode: 0o700 });
  const fence: MigrationFence = { schema: FENCE_SCHEMA, workspaceId, source, target, kind };
  await atomicWriteContainedText(
    kind === 'file' ? path.join(source, FENCE_MARKER) : source,
    `${JSON.stringify(fence)}\n`,
    { containedRoot: projectRoot, exclusive: true, requireAtomicPublication: true },
  );
  await syncDirectory(path.dirname(source));
}

/**
 * 仅恢复已证明退出的迁移实例。每次都按 journal 的摘要重验数据；不确定副本、
 * 来源不符的部分副本、活跃或未知主机 owner 均保留原样，不按超时时间抢占。
 */
interface MigrationRepairFailure {
  journalFingerprint: string;
  sourceDigest: string;
  error: string;
  recordedAt: string;
}

function repairFailureFile(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.runtime-migration-repair-failure.json');
}

/** 递归枚举源树的名字/大小/mtime 摘要；只做元数据遍历，不读文件内容。 */
async function migrationSourceDigest(source: string): Promise<string | null> {
  const entries: string[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    let listing;
    try {
      listing = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of listing.sort((left, right) => left.name.localeCompare(right.name))) {
      let stat;
      try {
        stat = await fs.lstat(path.join(directory, entry.name), { bigint: true });
      } catch {
        continue;
      }
      entries.push(
        `${prefix}${entry.name}:${stat.isDirectory() ? 'd' : 'f'}:${stat.size}:${stat.mtimeNs}`,
      );
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(path.join(directory, entry.name), `${prefix}${entry.name}/`);
      }
    }
  }
  await walk(source, '');
  if (entries.length === 0) return null;
  return createHash('sha256')
    .update(entries.join(String.fromCharCode(10)))
    .digest('hex');
}

async function journalFingerprintOf(source: string): Promise<string | null> {
  const stat = await statOrNull(journalPath(source));
  if (!stat) return null;
  return `${stat.size}:${stat.mtimeNs}`;
}

/**
 * 迁移恢复失败会重读整棵源树做摘要核验，代价随源体积线性增长。把失败连同
 * journal 与源树的元数据指纹记在用户级工作区：源未变化时后续启动直接复现
 * 同一错误，任何源内容变化都会使记录失效并重新尝试完整恢复。
 */
export async function recallFailedMigrationRepair(
  source: string,
  location: ReturnType<typeof resolveWorkspaceRuntimeLocation>,
): Promise<Error | null> {
  try {
    const value = (await readJson(
      repairFailureFile(location.workspaceRoot),
    )) as Partial<MigrationRepairFailure> | null;
    if (!value || typeof value !== 'object') return null;
    const journalFingerprint = await journalFingerprintOf(source);
    const sourceDigest = await migrationSourceDigest(source);
    if (
      typeof value.journalFingerprint !== 'string' ||
      typeof value.sourceDigest !== 'string' ||
      typeof value.error !== 'string' ||
      journalFingerprint !== value.journalFingerprint ||
      sourceDigest !== value.sourceDigest
    )
      return null;
    return new Error(`Runtime 迁移恢复此前已失败且源未变化，跳过重复扫描：${value.error}`);
  } catch {
    return null;
  }
}

export async function recordFailedMigrationRepair(
  source: string,
  location: ReturnType<typeof resolveWorkspaceRuntimeLocation>,
  error: unknown,
): Promise<void> {
  try {
    const journalFingerprint = await journalFingerprintOf(source);
    const sourceDigest = await migrationSourceDigest(source);
    if (!journalFingerprint || !sourceDigest) return;
    const failure: MigrationRepairFailure = {
      journalFingerprint,
      sourceDigest,
      error: error instanceof Error ? error.message : String(error),
      recordedAt: new Date().toISOString(),
    };
    await ensureAbsoluteDirectory(location.workspaceRoot);
    await fs.writeFile(
      repairFailureFile(location.workspaceRoot),
      JSON.stringify(failure, null, 2) + String.fromCharCode(10),
      'utf8',
    );
  } catch {
    // 失败记录是加速缓存；写不进去时下次照常完整恢复。
  }
}

export async function repairWorkspaceRuntimeMigration(
  source: string,
  target: string,
  options: WorkspaceRuntimeMigrationOptions,
): Promise<boolean> {
  const location = resolveWorkspaceRuntimeLocation(options.projectRoot);
  const requestedRoot = path.resolve(options.sourceRoot ?? options.projectRoot);
  const sourceRoot = options.sourceRoot ? realpathSync(requestedRoot) : location.projectRoot;
  source = path.resolve(source);
  if (isInside(requestedRoot, source))
    source = path.join(sourceRoot, path.relative(requestedRoot, source));
  target = path.resolve(target);
  if (
    source === sourceRoot ||
    !isInside(sourceRoot, source) ||
    !isInside(location.runtimeRoot, target) ||
    isInside(source, target) ||
    isInside(target, source)
  )
    throw new Error('Runtime 迁移恢复路径超出当前 workspace 的受管范围');
  if (!(await assertPath(sourceRoot, path.dirname(source), 'directory'))) return false;
  let journal = await readMigrationJournal(source, target, location.projectRoot);
  if (!journal) return false;
  const deadline = Date.now() + 5_000;
  while (!(await canRecover(journal))) {
    if (
      journal.hostname !== os.hostname() ||
      journal.pid === process.pid ||
      (await inspectProcessLiveness(journal.pid, journal.processIdentity)) !== 'alive' ||
      Date.now() >= deadline
    )
      throw new Error(
        `Runtime 迁移未完成，owner 仍活跃或无法确认退出；保留记录：${journalPath(source)}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 25));
    const current = await readMigrationJournal(source, target, location.projectRoot);
    if (!current) return true;
    journal = current;
  }
  await ensureAbsoluteDirectory(location.workspaceRoot);
  const recoveryLock = path.join(location.workspaceRoot, '.runtime-migration-recovery.lock');
  return withRecoverableFileLock(
    recoveryLock,
    async () => {
      const current = await readMigrationJournal(source, target, location.projectRoot);
      if (!current) return true;
      if (!(await canRecover(current))) throw new Error('Runtime 迁移 owner 已改变，不能恢复');
      await assertPath(location.dataRoot, path.dirname(target), 'directory');
      await assertPath(sourceRoot, current.backup);
      await assertPath(location.dataRoot, current.stage);
      await assertPath(location.dataRoot, target);
      let backup = await statOrNull(current.backup);
      const stage = await statOrNull(current.stage);
      const published = await statOrNull(target);
      const fenced = await isWorkspaceRuntimeMigrationFence(source, target);
      if (!backup && !fenced) {
        if (stage || published) throw new Error('Runtime 迁移源与目标同时存在，拒绝自动恢复');
        await inspectSiblingWriters(sourceRoot, source);
        await assertBoundSnapshot(source, current, true);
        await fs.rename(source, current.backup);
        backup = await fs.lstat(current.backup, { bigint: true });
      }
      if (!fenced) {
        if (!backup) throw new Error('Runtime 迁移原数据和备份均缺失，不能恢复');
        await assertBoundSnapshot(current.backup, current, true);
        const sourceStat = await statOrNull(source);
        const emptyFileFence =
          current.kind === 'file' &&
          sourceStat?.isDirectory() &&
          (await fs.readdir(source)).length === 0;
        if (sourceStat && !emptyFileFence)
          throw new Error('Runtime 旧路径在迁移后出现新内容，不能恢复');
        await writeMigrationFence(current, sourceRoot);
      }
      const fenceStat = await fs.lstat(source);
      const fence = parseFence(
        await readJson(fenceStat.isDirectory() ? path.join(source, FENCE_MARKER) : source),
      );
      if (fence?.workspaceId !== current.workspaceId || fence.kind !== current.kind)
        throw new Error('Runtime 迁移 fence 与记录不一致');
      if (published && stage) throw new Error('Runtime 迁移目标和暂存副本同时存在，拒绝覆盖');
      let original: Entry[] | null = null;
      if (backup) original = await assertBoundSnapshot(current.backup, current, true);
      if (!published) {
        if (!original) throw new Error('Runtime 迁移备份缺失，不能发布');
        if (stage) {
          try {
            await assertBoundSnapshot(current.stage, current, false);
          } catch {
            await rebuildPartialStage(current.backup, current.stage, original);
            await assertBoundSnapshot(current.stage, current, false);
          }
        } else {
          await copySnapshot(current.backup, current.stage, original);
          await assertBoundSnapshot(current.stage, current, false);
        }
        if (
          unchangedManifest(original) !==
          unchangedManifest(await snapshotTree(current.backup, true))
        )
          throw new Error('Runtime 迁移备份在恢复中发生变化');
        await assertPath(location.dataRoot, path.dirname(target), 'directory');
        if (await statOrNull(target)) throw new Error('Runtime 迁移目标在恢复中出现，拒绝覆盖');
        await fs.rename(current.stage, target);
        await syncDirectory(path.dirname(target));
      }
      await assertBoundSnapshot(target, current, false);
      if (original) {
        if (
          unchangedManifest(original) !==
          unchangedManifest(await snapshotTree(current.backup, true))
        )
          throw new Error('Runtime 迁移备份在清理前发生变化');
        await fs.rm(current.backup, { recursive: true });
      }
      await fs.unlink(journalPath(source));
      await syncDirectory(path.dirname(source));
      failedMigrations.delete(current.id);
      return true;
    },
    { timeoutMs: 5_000 },
  );
}

async function migrate(
  source: string,
  target: string,
  options: WorkspaceRuntimeMigrationOptions,
  directoryOnly: boolean,
): Promise<void> {
  const location = resolveWorkspaceRuntimeLocation(options.projectRoot);
  source = path.resolve(source);
  const requestedRoot = path.resolve(options.sourceRoot ?? options.projectRoot);
  const sourceRoot = options.sourceRoot ? realpathSync(requestedRoot) : location.projectRoot;
  if (isInside(requestedRoot, source))
    source = path.join(sourceRoot, path.relative(requestedRoot, source));
  target = path.resolve(target);
  if (
    source === sourceRoot ||
    !isInside(sourceRoot, source) ||
    !isInside(location.runtimeRoot, target) ||
    isInside(source, target) ||
    isInside(target, source)
  )
    throw new Error(
      'Runtime 迁移源必须在当前 workspace 内，目标必须在它的用户级 Runtime 内，且两者不能互相包含',
    );
  // 检查 journal 必须早于“源不存在”：崩溃可能发生在 rename 和 fence 发布之间。
  await assertPath(sourceRoot, path.dirname(source), 'directory');
  await repairWorkspaceRuntimeMigration(source, target, options);
  if (!(await assertPath(sourceRoot, source))) return;
  if (await isWorkspaceRuntimeMigrationFence(source)) {
    const stat = await fs.lstat(source);
    const fence = parseFence(
      await readJson(stat.isDirectory() ? path.join(source, FENCE_MARKER) : source),
    )!;
    if (fence.workspaceId !== location.workspaceId && options.ignoreForeignWorkspaceFence) return;
    if (fence.workspaceId !== location.workspaceId || fence.target !== target)
      throw new Error(`Runtime 迁移 fence 的工作区或目标无效；不要在其他 clone 上沿用：${source}`);
    // 已完成迁移后本机数据也可能丢失。保留 fence 阻断旧版写入，仅校验现有
    // 目标的类型与 containment；缺失记录交由 workflow 的便携恢复规则决定。
    await ensureAbsoluteDirectory(location.workspaceRoot);
    await assertPath(location.workspaceRoot, target, fence.kind);
    return;
  }
  const before = await snapshotTree(source, true);
  if (directoryOnly && before[0].kind !== 'directory')
    throw new Error(`Runtime 迁移源必须是目录：${source}`);
  await inspectSiblingWriters(sourceRoot, source);
  // 即使内容相同也不合并两个 Runtime；归属不明的目标不能覆盖。
  if (await statOrNull(target)) throw new Error(`新旧 Runtime 同时存在，拒绝覆盖或合并：${target}`);
  await ensureAbsoluteDirectory(path.dirname(target));
  await assertPath(location.dataRoot, path.dirname(target), 'directory');
  const id = randomUUID();
  const journal: MigrationJournal = {
    schema: FENCE_SCHEMA,
    journalSchema: JOURNAL_SCHEMA,
    id,
    workspaceId: location.workspaceId,
    source,
    target,
    kind: before[0].kind,
    backup: path.join(path.dirname(source), `.${path.basename(source)}.comet-runtime-source-${id}`),
    stage: path.join(path.dirname(target), `.${path.basename(target)}.comet-runtime-stage-${id}`),
    contentHash: createHash('sha256').update(contentManifest(before)).digest('hex'),
    sourceIdentity: before[0].identity,
    pid: process.pid,
    hostname: os.hostname(),
    ...((await readProcessIdentity(process.pid))
      ? { processIdentity: (await readProcessIdentity(process.pid))! }
      : {}),
  };
  const journalFile = journalPath(source);
  try {
    await atomicWriteContainedText(journalFile, `${JSON.stringify(journal)}\n`, {
      containedRoot: sourceRoot,
      exclusive: true,
      requireAtomicPublication: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      await repairWorkspaceRuntimeMigration(source, target, options);
      return migrate(source, target, options, directoryOnly);
    }
    throw error;
  }
  try {
    await options.testHooks?.afterJournal?.();
    if (unchangedManifest(before) !== unchangedManifest(await snapshotTree(source, true)))
      throw new Error('旧 Runtime 在加锁前发生变化');
    await inspectSiblingWriters(sourceRoot, source);
    await assertPath(sourceRoot, source, before[0].kind);
    await fs.rename(source, journal.backup);
    const fence: MigrationFence = {
      schema: FENCE_SCHEMA,
      workspaceId: location.workspaceId,
      source,
      target,
      kind: journal.kind,
    };
    if (journal.kind === 'file') await fs.mkdir(source, { mode: 0o700 });
    await atomicWriteContainedText(
      journal.kind === 'file' ? path.join(source, FENCE_MARKER) : source,
      `${JSON.stringify(fence)}\n`,
      { containedRoot: sourceRoot, exclusive: true, requireAtomicPublication: true },
    );
    await syncDirectory(path.dirname(source));
    await options.testHooks?.afterFence?.();
    const fenced = await snapshotTree(journal.backup, true);
    if (contentManifest(before) !== contentManifest(fenced))
      throw new Error('旧 Runtime 在建立兼容 fence 期间发生变化');
    await copySnapshot(journal.backup, journal.stage, fenced);
    await options.testHooks?.afterCopy?.();
    if (contentManifest(fenced) !== contentManifest(await snapshotTree(journal.stage, false)))
      throw new Error('Runtime 迁移副本校验失败');
    await options.testHooks?.beforePublish?.();
    if (unchangedManifest(fenced) !== unchangedManifest(await snapshotTree(journal.backup, true)))
      throw new Error('旧 Runtime 在复制后继续变化，不能切换');
    await assertPath(sourceRoot, source);
    if (!(await isWorkspaceRuntimeMigrationFence(source, target)))
      throw new Error('Runtime 迁移 fence 已改变');
    await assertPath(location.dataRoot, path.dirname(target), 'directory');
    if (await statOrNull(target)) throw new Error(`Runtime 迁移目标已出现，拒绝覆盖：${target}`);
    // stage 与 target 同父目录，跨卷只发生在前面的复制；发布仍为本卷 rename。
    await fs.rename(journal.stage, target);
    await syncDirectory(path.dirname(target));
    await options.testHooks?.afterPublish?.();
    if (unchangedManifest(fenced) !== unchangedManifest(await snapshotTree(journal.backup, true)))
      throw new Error('旧 Runtime 在切换后继续变化，保留原副本等待恢复');
    if (contentManifest(fenced) !== contentManifest(await snapshotTree(target, false)))
      throw new Error('Runtime 目标在清理前发生变化，保留原副本等待恢复');
    await fs.rm(journal.backup, { recursive: true });
    await fs.unlink(journalFile);
    await syncDirectory(path.dirname(source));
  } catch (error) {
    failedMigrations.add(journal.id);
    throw new Error(
      `Runtime 迁移未完成，已保留可恢复数据。请停止旧进程后重试命令以恢复；若仍失败请检查记录 ${journalFile}，不要直接删除 fence 或记录。${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export interface WorkspaceRuntimeFenceOptions extends Omit<
  WorkspaceRuntimeMigrationOptions,
  'testHooks'
> {
  testHooks?: {
    afterStagingDirectory?: (staging: string) => void | Promise<void>;
    beforePublish?: () => void | Promise<void>;
  };
}

/**
 * 封住旧版的文件写入口。只创建类型相反的兼容标记，不伪造目标文件或迁移旧锁。
 * 调用者须先完成相关旧事务与执行记录的只读检查，再修改便携状态。
 */
export function ensureWorkspaceRuntimeMigrationFence(
  source: string,
  target: string,
  options: WorkspaceRuntimeFenceOptions,
): Promise<void> {
  const location = resolveWorkspaceRuntimeLocation(options.projectRoot);
  const requestedRoot = path.resolve(options.sourceRoot ?? options.projectRoot);
  const sourceRoot = options.sourceRoot ? realpathSync(requestedRoot) : location.projectRoot;
  source = path.resolve(source);
  if (isInside(requestedRoot, source))
    source = path.join(sourceRoot, path.relative(requestedRoot, source));
  target = path.resolve(target);
  if (
    source === sourceRoot ||
    !isInside(sourceRoot, source) ||
    target === location.runtimeRoot ||
    !isInside(location.runtimeRoot, target) ||
    isInside(source, target) ||
    isInside(target, source)
  )
    return Promise.reject(new Error('Runtime 兼容标记路径超出当前 workspace 的受管范围'));
  const key = `${source}\0${target}`;
  const existing = fenceInFlight.get(key);
  if (existing) return existing;
  const pending = (async () => {
    if (!(await assertPath(sourceRoot, path.dirname(source), 'directory')))
      throw new Error('Runtime 兼容标记的父目录不存在');
    if (await statOrNull(journalPath(source)))
      throw new Error('Runtime 兼容标记存在未完成迁移，必须先恢复');
    await ensureAbsoluteDirectory(location.workspaceRoot);
    await assertPath(location.workspaceRoot, target, 'file');
    async function existingFence(): Promise<boolean> {
      if (!(await assertPath(sourceRoot, source))) return false;
      if (!(await isWorkspaceRuntimeMigrationFence(source)))
        throw new Error(`旧文件入口或锁仍存在，拒绝覆盖：${source}`);
      const stat = await fs.lstat(source);
      const fence = parseFence(
        await readJson(stat.isDirectory() ? path.join(source, FENCE_MARKER) : source),
      )!;
      if (fence.workspaceId !== location.workspaceId && options.ignoreForeignWorkspaceFence)
        return true;
      if (
        fence.workspaceId !== location.workspaceId ||
        fence.target !== target ||
        fence.kind !== 'file'
      )
        throw new Error('Runtime 兼容标记属于其他工作区或目标');
      return true;
    }
    if (await existingFence()) return;
    const parent = path.dirname(source);
    const parentIdentity = identity(await fs.lstat(parent, { bigint: true }));
    const staging = path.join(
      parent,
      `.${path.basename(source)}.comet-runtime-stage-${randomUUID()}`,
    );
    await fs.mkdir(staging, { mode: 0o700 });
    const stageIdentity = identity(await fs.lstat(staging, { bigint: true }));
    try {
      await options.testHooks?.afterStagingDirectory?.(staging);
      const fence: MigrationFence = {
        schema: FENCE_SCHEMA,
        workspaceId: location.workspaceId,
        source,
        target,
        kind: 'file',
      };
      await atomicWriteContainedText(
        path.join(staging, FENCE_MARKER),
        `${JSON.stringify(fence)}\n`,
        {
          containedRoot: sourceRoot,
          exclusive: true,
          requireAtomicPublication: true,
        },
      );
      await syncDirectory(staging);
      await options.testHooks?.beforePublish?.();
      await assertPath(sourceRoot, parent, 'directory');
      if (identity(await fs.lstat(parent, { bigint: true })) !== parentIdentity)
        throw new Error('Runtime 兼容标记父目录在发布前发生变化');
      if (await existingFence()) return;
      // 标记完整后才发布目录。旧锁是普通文件，类型冲突使 rename 失败；Node
      // 没有跨平台目录 rename-no-replace，已存在的未知目录在上面明确拒绝。
      try {
        await fs.rename(staging, source);
      } catch (error) {
        if (await existingFence()) return;
        throw error;
      }
      await syncDirectory(parent);
    } finally {
      const remaining = await statOrNull(staging);
      if (remaining && identity(remaining) === stageIdentity) {
        await assertPath(sourceRoot, staging, 'directory');
        await fs.rm(staging, { recursive: true });
      }
    }
  })().finally(() => {
    if (fenceInFlight.get(key) === pending) fenceInFlight.delete(key);
  });
  fenceInFlight.set(key, pending);
  return pending;
}

/** 在修改便携状态之前，只读确认关联旧 Runtime 没有尚在执行的写入。 */
export async function assertWorkspaceRuntimeMigrationQuiescent(
  source: string,
  options: Pick<WorkspaceRuntimeMigrationOptions, 'projectRoot' | 'sourceRoot'>,
): Promise<void> {
  const location = resolveWorkspaceRuntimeLocation(options.projectRoot);
  const requestedRoot = path.resolve(options.sourceRoot ?? options.projectRoot);
  const sourceRoot = options.sourceRoot ? realpathSync(requestedRoot) : location.projectRoot;
  source = path.resolve(source);
  if (isInside(requestedRoot, source))
    source = path.join(sourceRoot, path.relative(requestedRoot, source));
  if (!isInside(sourceRoot, source)) throw new Error('Runtime 迁移检查源超出受管目录');
  if (!(await assertPath(sourceRoot, path.dirname(source), 'directory'))) return;
  if (await assertPath(sourceRoot, source)) {
    if (!(await isWorkspaceRuntimeMigrationFence(source))) await snapshotTree(source, true);
  }
  await inspectSiblingWriters(sourceRoot, source, false);
}

function coordinatedMigration(
  source: string,
  target: string,
  options: WorkspaceRuntimeMigrationOptions,
  directoryOnly: boolean,
): Promise<void> {
  const location = resolveWorkspaceRuntimeLocation(options.projectRoot);
  const requestedRoot = path.resolve(options.sourceRoot ?? options.projectRoot);
  const sourceRoot = options.sourceRoot ? realpathSync(requestedRoot) : location.projectRoot;
  const absoluteSource = path.resolve(source);
  const canonicalSource = isInside(requestedRoot, absoluteSource)
    ? path.join(sourceRoot, path.relative(requestedRoot, absoluteSource))
    : absoluteSource;
  const key = `${canonicalSource}\0${path.resolve(target)}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = migrate(source, target, options, directoryOnly).finally(() => {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}

/** 旧路径保留类型相反的 fence，阻断旧版按路径写入；不自动恢复不确定事务。 */
export function migrateWorkspaceRuntimePath(
  source: string,
  target: string,
  options: WorkspaceRuntimeMigrationOptions,
): Promise<void> {
  return coordinatedMigration(source, target, options, false);
}

export function migrateWorkspaceRuntimeDirectory(
  source: string,
  target: string,
  options: WorkspaceRuntimeMigrationOptions,
): Promise<void> {
  return coordinatedMigration(source, target, options, true);
}

/** 操作前统一调用：校验用户级目录，迁移旧树，并保留阻断旧版写入的兼容标记。 */
export async function resolveWorkspaceRuntimeRoot(projectRoot: string): Promise<string> {
  const location = resolveWorkspaceRuntimeLocation(projectRoot);
  await ensureAbsoluteDirectory(location.workspaceRoot);
  await ensureProtectedProjectDirectory(location.projectRoot, '.comet', {
    label: 'Workspace Runtime 兼容标记',
  });
  const source = path.join(location.projectRoot, '.comet', 'runtime');
  // 本机数据丢失时由 workflow 的便携 checkpoint 决定能否恢复；有效 fence 只
  // 阻断旧路径写入，不能让已存在的便携恢复入口永久失效。未完成迁移须先处理。
  const recalledFailure = await recallFailedMigrationRepair(source, location);
  if (recalledFailure) throw recalledFailure;
  try {
    await repairWorkspaceRuntimeMigration(source, location.runtimeRoot, {
      projectRoot: location.projectRoot,
    });
  } catch (error) {
    await recordFailedMigrationRepair(source, location, error);
    throw error;
  }
  if (await isWorkspaceRuntimeMigrationFence(source)) {
    const fence = parseFence(await readJson(source));
    if (
      fence?.workspaceId === location.workspaceId &&
      fence.target === location.runtimeRoot &&
      fence.kind === 'directory'
    ) {
      if (!(await statOrNull(location.runtimeRoot)))
        await ensureProtectedProjectDirectory(location.workspaceRoot, 'runtime', {
          label: 'Workspace Runtime 恢复目录',
        });
      // journal 已完成恢复，fence 也已核对当前 workspace；只验证真实目标，
      // 不再为同一次访问重复运行两轮迁移和目录准备。
      await assertPath(location.workspaceRoot, location.runtimeRoot, 'directory');
      return location.runtimeRoot;
    }
  }
  await migrateWorkspaceRuntimeDirectory(source, location.runtimeRoot, {
    projectRoot: location.projectRoot,
    ignoreForeignWorkspaceFence: true,
  });
  let created = false;
  try {
    await fs.mkdir(location.runtimeRoot, { mode: 0o700 });
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await assertPath(location.workspaceRoot, location.runtimeRoot, 'directory');
  if (!(await statOrNull(source))) {
    const fence: MigrationFence = {
      schema: FENCE_SCHEMA,
      workspaceId: location.workspaceId,
      source,
      target: location.runtimeRoot,
      kind: 'directory',
    };
    try {
      await atomicWriteContainedText(source, `${JSON.stringify(fence)}\n`, {
        containedRoot: location.projectRoot,
        exclusive: true,
        requireAtomicPublication: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // 旧版可能在 fence 发布前创建旧树。只移除本调用刚创建且仍为空的目标。
      if (!(await isWorkspaceRuntimeMigrationFence(source))) {
        if (created) await fs.rmdir(location.runtimeRoot);
        await migrateWorkspaceRuntimeDirectory(source, location.runtimeRoot, {
          projectRoot: location.projectRoot,
          ignoreForeignWorkspaceFence: true,
        });
      }
    }
  }
  await migrateWorkspaceRuntimeDirectory(source, location.runtimeRoot, {
    projectRoot: location.projectRoot,
    ignoreForeignWorkspaceFence: true,
  });
  return location.runtimeRoot;
}
