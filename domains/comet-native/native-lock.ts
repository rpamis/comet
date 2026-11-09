import { AsyncLocalStorage } from 'node:async_hooks';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  acquireRecoverableFileLock,
  diagnoseRecoverableFileLock,
  repairRecoverableFileLock,
  withRecoverableFileLock,
} from '../../platform/fs/recoverable-file-lock.js';
import { readFileRaceSafe } from '../../platform/fs/race-safe-read.js';
import { resolveContainedNativePath } from './native-paths.js';
import type { NativeProjectPaths } from './native-types.js';

/** Legacy source compatibility; lock recovery no longer waits for an owner age. */
export const NATIVE_LOCK_UNKNOWN_TAKEOVER_MS = 0;
export interface NativeLockOwner {
  id: string;
  createdAt: string;
  operation: string;
}
export interface NativeLockFileIdentity {
  device: string;
  inode: string;
  size: string;
  birthtimeNs: string;
  ctimeNs: string;
  mtimeNs: string;
}
export interface NativeLock {
  file: string;
  nativeRoot: string;
  locksDir: string;
  owner: NativeLockOwner;
  identity: NativeLockFileIdentity;
  publicationFile?: string;
  coordinatorVersion?: string;
}
export interface NativeLockDiagnosis {
  status: 'missing' | 'active' | 'stale' | 'unknown';
  owner: NativeLockOwner | null;
  identity: NativeLockFileIdentity | null;
}
export interface NativeLockRecovery extends Omit<NativeLockDiagnosis, 'status'> {
  kind?: 'lock' | 'coordinator';
  status: NativeLockDiagnosis['status'] | 'malformed';
  file: string;
  token: string | null;
  contentDigest?: string;
}
export type NativeStaleLockTakeover =
  | { status: 'removed'; owner: NativeLockOwner }
  | { status: 'missing' }
  | { status: 'changed'; diagnosis: NativeLockDiagnosis };
export class NativeLockBusyError extends Error {
  constructor(
    readonly file: string,
    readonly owner: NativeLockOwner | null,
    cause?: unknown,
  ) {
    super('Native lock is busy: ' + file, { cause });
    this.name = 'NativeLockBusyError';
  }
}
type Paths = Pick<NativeProjectPaths, 'runtimeDir' | 'locksDir'>;
const handles = new WeakMap<NativeLock, Awaited<ReturnType<typeof acquireRecoverableFileLock>>>();
const recovery = new AsyncLocalStorage<ReadonlySet<string>>();
function fileIdentity(stat: import('node:fs').BigIntStats): NativeLockFileIdentity {
  return {
    device: String(stat.dev),
    inode: String(stat.ino),
    size: String(stat.size),
    birthtimeNs: String(stat.birthtimeNs),
    ctimeNs: String(stat.ctimeNs),
    mtimeNs: String(stat.mtimeNs),
  };
}
async function snapshot(file: string) {
  try {
    const read = await readFileRaceSafe(file, 16 * 1024, {
      bigint: true,
      label: 'Native lock metadata',
    });
    const value = JSON.parse(read.bytes.toString('utf8'));
    const id = value.id ?? value.nonce;
    const createdAt =
      typeof value.createdAt === 'number'
        ? new Date(value.createdAt).toISOString()
        : value.createdAt;
    if (
      typeof id !== 'string' ||
      !id ||
      typeof createdAt !== 'string' ||
      !Number.isFinite(Date.parse(createdAt))
    )
      throw new Error('Invalid Native lock metadata: ' + file);
    return {
      owner: {
        id,
        createdAt,
        operation: typeof value.operation === 'string' ? value.operation : 'Runtime operation',
      },
      identity: fileIdentity(read.stat as import('node:fs').BigIntStats),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export async function readNativeLock(file: string): Promise<NativeLockOwner | null> {
  return (await snapshot(file))?.owner ?? null;
}
export async function diagnoseNativeLock(file: string): Promise<NativeLockDiagnosis> {
  const diagnosis = await diagnoseRecoverableFileLock(file);
  const record = await snapshot(file);
  return {
    status: diagnosis.status === 'malformed' ? 'unknown' : diagnosis.status,
    owner: record?.owner ?? null,
    identity: record?.identity ?? null,
  };
}
export async function inspectNativeLockRecovery(file: string): Promise<NativeLockRecovery> {
  const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (stat && !stat.isFile())
    return { file, status: 'malformed', owner: null, identity: null, token: null };
  const diagnosis = await diagnoseRecoverableFileLock(file);
  let record: Awaited<ReturnType<typeof snapshot>> = null;
  try {
    record = await snapshot(file);
  } catch {
    /* Malformed legacy metadata can be explicitly retired without process probes. */
  }
  return {
    file,
    status: diagnosis.status,
    token: diagnosis.token,
    owner: record?.owner ?? null,
    identity: record?.identity ?? null,
  };
}
export async function inspectNativeProjectLocks(
  paths: NativeProjectPaths,
): Promise<NativeLockRecovery[]> {
  const directory = await resolveContainedNativePath(paths.runtimeDir, paths.locksDir);
  const entries = await fs
    .readdir(directory, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
  const files = entries
    .filter((entry) => entry.name.endsWith('.lock') && entry.name !== '.recovery.lock')
    .map((entry) => ({ file: path.join(directory, entry.name), kind: 'lock' as const }));
  const coordinator = path.join(directory, '.coordinator');
  const old = await fs.readdir(coordinator).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  files.push(
    ...old
      .filter((name) => name.endsWith('.claim') && name !== '.protocol-v2.claim')
      .map((name) => ({ file: path.join(coordinator, name), kind: 'coordinator' as 'lock' })),
  );
  const result: NativeLockRecovery[] = [];
  for (const entry of files) {
    const record = await inspectNativeLockRecovery(entry.file);
    if (record.status !== 'missing') result.push({ ...record, kind: entry.kind });
  }
  return result;
}
export async function repairNativeProjectLock(
  paths: NativeProjectPaths,
  token: string,
  confirmedOwnerStopped: boolean,
): Promise<void> {
  const current = (await inspectNativeProjectLocks(paths)).find((entry) => entry.token === token);
  if (!current || !confirmedOwnerStopped)
    throw new Error(
      'Native lock changed; inspect doctor and confirm the interrupted operation before recovery',
    );
  const result = await repairRecoverableFileLock(current.file, token, { confirmedOwnerStopped });
  if (result !== 'removed' && result !== 'missing')
    throw new Error('Native lock is still held or changed; preserve the current operation');
}
export async function withNativeLockRecovery<T>(
  entries: readonly Paths[],
  operation: string,
  work: () => Promise<T>,
): Promise<T> {
  const unique = [
    ...new Map(entries.map((entry) => [path.resolve(entry.locksDir), entry])).values(),
  ].sort((a, b) => a.locksDir.localeCompare(b.locksDir));
  const enter = async (index: number): Promise<T> => {
    const entry = unique[index];
    if (!entry) return work();
    const key = path.resolve(entry.locksDir);
    const held = recovery.getStore();
    if (held?.has(key)) return enter(index + 1);
    return withRecoverableFileLock(
      path.join(key, '.recovery.lock'),
      () =>
        recovery.run(new Set([...(held ?? []), key]), async () => {
          await prepareLockProtocol(entry);
          return enter(index + 1);
        }),
      { operation, timeoutMs: 5000 },
    );
  };
  return enter(0);
}
export async function acquireNativeLock(
  paths: NativeProjectPaths,
  name: string,
  operation: string,
  options: { timeoutMs?: number } = {},
): Promise<NativeLock> {
  return withNativeLockRecovery([paths], operation, () =>
    acquireNativeOperationLock(paths, name, operation, options.timeoutMs),
  );
}

async function prepareLockProtocol(paths: Paths): Promise<void> {
  const directory = await resolveContainedNativePath(
    paths.runtimeDir,
    path.join(paths.locksDir, '.coordinator'),
  );
  await fs.mkdir(directory, { recursive: true });
  const marker = '.protocol-v2.claim';
  const legacyClaims = async () =>
    (await fs.readdir(directory)).filter((name) => name.endsWith('.claim') && name !== marker);
  if ((await legacyClaims()).length)
    throw new Error('Legacy Native lock operations require confirmed recovery before upgrading');
  try {
    await fs.writeFile(
      path.join(directory, marker),
      JSON.stringify({ schema: 'comet.native.lock.v2' }),
      { flag: 'wx' },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  if ((await legacyClaims()).length)
    throw new Error('Legacy Native lock operations changed during protocol upgrade');
}

async function acquireNativeOperationLock(
  paths: NativeProjectPaths,
  name: string,
  operation: string,
  timeoutMs = 0,
): Promise<NativeLock> {
  if (!/^[a-z][a-z0-9-]*$/u.test(name)) throw new Error('Invalid Native lock name: ' + name);
  const locksDir = await resolveContainedNativePath(paths.runtimeDir, paths.locksDir);
  const file = path.join(locksDir, name + '.lock');
  let handle: Awaited<ReturnType<typeof acquireRecoverableFileLock>>;
  try {
    handle = await acquireRecoverableFileLock(file, { timeoutMs, operation });
  } catch (error) {
    if (/Timed out waiting for file lock/u.test(String(error)))
      throw new NativeLockBusyError(file, await readNativeLock(file), error);
    throw error;
  }
  try {
    const current = await snapshot(file);
    if (!current) throw new Error('Native lock metadata disappeared before acquisition');
    const lock: NativeLock = { file, locksDir, nativeRoot: paths.runtimeDir, ...current };
    handles.set(lock, handle);
    return lock;
  } catch (error) {
    await handle.release();
    throw error;
  }
}
export async function releaseNativeLock(lock: NativeLock): Promise<void> {
  const handle = handles.get(lock);
  if (!handle) {
    if (!(await snapshot(lock.file))) return;
    throw new Error('Native lock handle is not active');
  }
  try {
    if (!(await handle.release())) throw new Error('Native lock ownership changed');
  } finally {
    handles.delete(lock);
  }
}
export function nativeLockOwnerAgeMs(owner: NativeLockOwner | null, now = Date.now()): number {
  return owner ? Math.max(0, now - Date.parse(owner.createdAt)) : 0;
}
export interface NativeLockTakeoverOptions {
  allowAgedUnknown?: boolean;
}
export async function takeOverNativeStaleLock(
  paths: NativeProjectPaths,
  file: string,
  expected?: NativeLockDiagnosis,
  options: NativeLockTakeoverOptions = {},
): Promise<NativeStaleLockTakeover> {
  const contained = await resolveContainedNativePath(paths.runtimeDir, file);
  if (path.resolve(path.dirname(contained)) !== path.resolve(paths.locksDir))
    throw new Error('Native lock recovery target is outside the lock directory');
  const current = await diagnoseNativeLock(contained);
  if (current.status === 'missing') return { status: 'missing' };
  if (current.status === 'unknown' && !options.allowAgedUnknown)
    return { status: 'changed', diagnosis: current };
  if (current.status === 'active' || (expected && expected.owner?.id !== current.owner?.id))
    return { status: 'changed', diagnosis: current };
  const record = await diagnoseRecoverableFileLock(contained);
  const result = await repairRecoverableFileLock(contained, record.token!, {
    confirmedOwnerStopped: true,
  });
  return result === 'missing'
    ? { status: 'missing' }
    : result === 'removed' && current.owner
      ? { status: 'removed', owner: current.owner }
      : { status: 'changed', diagnosis: current };
}
