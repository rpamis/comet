import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { resolveContainedNativePath } from './native-paths.js';
import type { NativeProjectPaths } from './native-types.js';

const NATIVE_LOCK_MAX_BYTES = 16 * 1024;
const NATIVE_LOCK_COORDINATOR_DIR = '.coordinator';
const NATIVE_LOCK_COORDINATOR_TIMEOUT_MS = 5_000;

export interface NativeLockOwner {
  id: string;
  pid: number;
  hostname: string;
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
}

export interface NativeLockDiagnosis {
  status: 'missing' | 'active' | 'stale' | 'unknown';
  owner: NativeLockOwner | null;
  identity: NativeLockFileIdentity | null;
}

export type NativeStaleLockTakeover =
  | { status: 'removed'; owner: NativeLockOwner }
  | { status: 'missing' }
  | { status: 'changed'; diagnosis: NativeLockDiagnosis };

interface NativeLockSnapshot {
  file: string;
  owner: NativeLockOwner;
  identity: NativeLockFileIdentity;
}

type NativeLockCoordinatorPaths = Pick<NativeProjectPaths, 'nativeRoot' | 'locksDir'>;

const nativeLockCoordinator = new AsyncLocalStorage<Map<string, NativeLock>>();
const nativeLockLocalCoordinator = new Map<string, Promise<void>>();

function lockName(value: string): string {
  if (!/^[a-z][a-z0-9-]*$/u.test(value)) throw new Error(`Invalid Native lock name: ${value}`);
  return `${value}.lock`;
}

function parseNativeLockOwner(value: unknown, file: string): NativeLockOwner {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid Native lock metadata: ${file}`);
  }
  const owner = value as Partial<NativeLockOwner>;
  if (
    typeof owner.id !== 'string' ||
    owner.id.length === 0 ||
    typeof owner.pid !== 'number' ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid < 1 ||
    typeof owner.hostname !== 'string' ||
    owner.hostname.length === 0 ||
    typeof owner.createdAt !== 'string' ||
    owner.createdAt.length === 0 ||
    typeof owner.operation !== 'string' ||
    owner.operation.length === 0
  ) {
    throw new Error(`Invalid Native lock metadata: ${file}`);
  }
  return owner as NativeLockOwner;
}

function nativeLockFileIdentity(stat: import('fs').BigIntStats): NativeLockFileIdentity {
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    size: stat.size.toString(),
    birthtimeNs: stat.birthtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
    mtimeNs: stat.mtimeNs.toString(),
  };
}

function sameNativeLockObject(
  left: NativeLockFileIdentity,
  right: NativeLockFileIdentity,
): boolean {
  if (left.device !== '0' || left.inode !== '0' || right.device !== '0' || right.inode !== '0') {
    return left.device === right.device && left.inode === right.inode;
  }
  return left.birthtimeNs === right.birthtimeNs && left.size === right.size;
}

function sameNativeLockVersion(
  left: NativeLockFileIdentity,
  right: NativeLockFileIdentity,
): boolean {
  return (
    sameNativeLockObject(left, right) &&
    left.size === right.size &&
    left.birthtimeNs === right.birthtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.mtimeNs === right.mtimeNs
  );
}

function sameNativeLockDiagnosis(left: NativeLockDiagnosis, right: NativeLockDiagnosis): boolean {
  if (left.status !== right.status) return false;
  if (!left.owner || !left.identity || !right.owner || !right.identity) {
    return left.owner === right.owner && left.identity === right.identity;
  }
  return left.owner.id === right.owner.id && sameNativeLockVersion(left.identity, right.identity);
}

async function readNativeLockSnapshot(file: string): Promise<NativeLockSnapshot | null> {
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(file, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Native lock must be a regular file: ${file}`);
    }
    if (stat.size > BigInt(NATIVE_LOCK_MAX_BYTES)) {
      throw new Error(`Native lock metadata exceeds ${NATIVE_LOCK_MAX_BYTES} bytes: ${file}`);
    }
    const source = await handle.readFile({ encoding: 'utf8' });
    const pathStat = await fs.lstat(file, { bigint: true });
    if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
      throw new Error(`Native lock must be a regular file: ${file}`);
    }
    const identity = nativeLockFileIdentity(stat);
    if (!sameNativeLockObject(identity, nativeLockFileIdentity(pathStat))) {
      throw new Error(`Native lock changed while reading: ${file}`);
    }
    return {
      file,
      owner: parseNativeLockOwner(JSON.parse(source) as unknown, file),
      identity,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  } finally {
    await handle.close();
  }
}

export async function readNativeLock(file: string): Promise<NativeLockOwner | null> {
  return (await readNativeLockSnapshot(file))?.owner ?? null;
}

function diagnosisFromSnapshot(snapshot: NativeLockSnapshot | null): NativeLockDiagnosis {
  if (!snapshot) return { status: 'missing', owner: null, identity: null };
  if (snapshot.owner.hostname !== os.hostname()) {
    return { status: 'unknown', owner: snapshot.owner, identity: snapshot.identity };
  }
  const alive = isProcessAlive(snapshot.owner.pid);
  return {
    status: alive === true ? 'active' : alive === false ? 'stale' : 'unknown',
    owner: snapshot.owner,
    identity: snapshot.identity,
  };
}

async function restoreQuarantinedNativeLock(quarantine: string, file: string): Promise<void> {
  try {
    await fs.lstat(file);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    await fs.rename(quarantine, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function removeBoundNativeLock(
  expected: NativeLockSnapshot,
  quarantineDir: string,
): Promise<'removed' | 'missing'> {
  const current = await readNativeLockSnapshot(expected.file);
  if (!current) return 'missing';
  if (current.owner.id !== expected.owner.id) {
    throw new Error(`Native lock ownership changed: ${expected.file}`);
  }
  if (!sameNativeLockVersion(current.identity, expected.identity)) {
    throw new Error(`Native lock identity changed: ${expected.file}`);
  }
  await fs.mkdir(quarantineDir, { recursive: true });
  const quarantine = path.join(
    quarantineDir,
    `${path.basename(expected.file)}.${expected.owner.id}.${randomUUID()}.removed`,
  );
  try {
    await fs.rename(expected.file, quarantine);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
  const moved = await readNativeLockSnapshot(quarantine);
  if (
    !moved ||
    moved.owner.id !== expected.owner.id ||
    !sameNativeLockObject(moved.identity, expected.identity)
  ) {
    await restoreQuarantinedNativeLock(quarantine, expected.file);
    throw new Error(`Native lock changed before quarantine: ${expected.file}`);
  }
  await fs.rm(quarantine, { force: true });
  return 'removed';
}

function newNativeLockOwner(operation: string): NativeLockOwner {
  return {
    id: randomUUID(),
    pid: process.pid,
    hostname: os.hostname(),
    createdAt: new Date().toISOString(),
    operation,
  };
}

async function writeNativeLockFile(
  file: string,
  owner: NativeLockOwner,
): Promise<NativeLockFileIdentity> {
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(file, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const existing = await readNativeLock(file);
      throw new Error(
        `Native lock is already held: ${file}${existing ? ` by pid ${existing.pid} for ${existing.operation}` : ''}`,
        { cause: error },
      );
    }
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify(owner, null, 2) + '\n', 'utf8');
    await handle.sync();
    return nativeLockFileIdentity(await handle.stat({ bigint: true }));
  } finally {
    await handle.close();
  }
}

async function publishNativeCoordinatorClaim(
  paths: NativeLockCoordinatorPaths,
  operation: string,
): Promise<NativeLock> {
  const locksDir = await resolveContainedNativePath(paths.nativeRoot, paths.locksDir);
  await fs.mkdir(locksDir, { recursive: true });
  const coordinatorDir = await resolveContainedNativePath(
    paths.nativeRoot,
    path.join(locksDir, NATIVE_LOCK_COORDINATOR_DIR),
  );
  await fs.mkdir(coordinatorDir, { recursive: true });
  const owner = newNativeLockOwner(operation);
  const temporary = path.join(coordinatorDir, `.${owner.id}.tmp`);
  const file = path.join(coordinatorDir, `${owner.id}.claim`);
  try {
    const identity = await writeNativeLockFile(temporary, owner);
    await fs.rename(temporary, file);
    const published = await readNativeLockSnapshot(file);
    if (!published || !sameNativeLockObject(identity, published.identity)) {
      throw new Error(`Native lock coordinator claim changed while publishing: ${file}`);
    }
    return { file, nativeRoot: paths.nativeRoot, locksDir, owner, identity: published.identity };
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function hasNativeCoordinatorPredecessor(claim: NativeLock): Promise<boolean> {
  const coordinatorDir = path.dirname(claim.file);
  let predecessor = false;
  const claimName = path.basename(claim.file);
  for (const entry of await fs.readdir(coordinatorDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.claim')) continue;
    const file = path.join(coordinatorDir, entry.name);
    if (path.resolve(file) === path.resolve(claim.file)) continue;
    try {
      const snapshot = await readNativeLockSnapshot(file);
      const diagnosis = diagnosisFromSnapshot(snapshot);
      if (diagnosis.status === 'missing') continue;
      if (diagnosis.status === 'stale' && snapshot) {
        await removeBoundNativeLock(snapshot, coordinatorDir);
        continue;
      }
      if (entry.name < claimName) predecessor = true;
    } catch {
      if (entry.name < claimName) predecessor = true;
    }
  }
  return predecessor;
}

async function releaseNativeCoordinatorClaim(claim: NativeLock): Promise<void> {
  const current = await readNativeLockSnapshot(claim.file);
  if (!current) return;
  if (
    current.owner.id !== claim.owner.id ||
    !sameNativeLockVersion(current.identity, claim.identity)
  ) {
    throw new Error(`Native lock coordinator ownership changed: ${claim.file}`);
  }
  await removeBoundNativeLock(current, path.dirname(claim.file));
}

async function acquireNativeCoordinator(
  paths: NativeLockCoordinatorPaths,
  operation: string,
): Promise<NativeLock> {
  const deadline = Date.now() + NATIVE_LOCK_COORDINATOR_TIMEOUT_MS;
  while (true) {
    const claim = await publishNativeCoordinatorClaim(paths, operation);
    // A total order prevents two simultaneous claimants from symmetrically observing each
    // other, releasing, and retrying until both time out. The lexicographically first live
    // claim proceeds; later claims wait for it to publish the actual lock.
    if (!(await hasNativeCoordinatorPredecessor(claim))) return claim;
    await releaseNativeCoordinatorClaim(claim);
    if (Date.now() >= deadline) {
      throw new Error(`Native lock coordinator is busy: ${paths.locksDir}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2 + Math.floor(Math.random() * 7)));
  }
}

async function acquireNativeLocalCoordinator(key: string): Promise<() => void> {
  const previous = nativeLockLocalCoordinator.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const turn = previous.then(() => current);
  nativeLockLocalCoordinator.set(key, turn);
  await previous;
  return () => {
    release();
    if (nativeLockLocalCoordinator.get(key) === turn) nativeLockLocalCoordinator.delete(key);
  };
}

async function withNativeLockCoordinator<T>(
  paths: NativeLockCoordinatorPaths,
  operation: string,
  work: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(paths.locksDir);
  const current = nativeLockCoordinator.getStore();
  if (current?.has(key)) return work();
  const releaseLocal = await acquireNativeLocalCoordinator(key);
  try {
    const claim = await acquireNativeCoordinator(paths, operation);
    const next = new Map(current ?? []);
    next.set(key, claim);
    return await nativeLockCoordinator.run(next, async () => {
      try {
        return await work();
      } finally {
        await releaseNativeCoordinatorClaim(claim);
      }
    });
  } finally {
    releaseLocal();
  }
}

export async function withNativeLockRecovery<T>(
  pathEntries: readonly NativeLockCoordinatorPaths[],
  operation: string,
  work: () => Promise<T>,
): Promise<T> {
  const unique = [
    ...new Map(pathEntries.map((entry) => [path.resolve(entry.locksDir), entry])).values(),
  ].sort((left, right) => path.resolve(left.locksDir).localeCompare(path.resolve(right.locksDir)));
  const enter = async (index: number): Promise<T> => {
    const entry = unique[index];
    return entry ? withNativeLockCoordinator(entry, operation, () => enter(index + 1)) : work();
  };
  return enter(0);
}

export async function acquireNativeLock(
  paths: NativeProjectPaths,
  name: string,
  operation: string,
): Promise<NativeLock> {
  return withNativeLockCoordinator(paths, `acquire ${name}`, async () => {
    const locksDir = await resolveContainedNativePath(paths.nativeRoot, paths.locksDir);
    await fs.mkdir(locksDir, { recursive: true });
    const file = await resolveContainedNativePath(
      paths.nativeRoot,
      path.join(locksDir, lockName(name)),
    );
    const owner = newNativeLockOwner(operation);
    const identity = await writeNativeLockFile(file, owner);
    return { file, nativeRoot: paths.nativeRoot, locksDir, owner, identity };
  });
}

export async function releaseNativeLock(lock: NativeLock): Promise<void> {
  if (!(await readNativeLockSnapshot(lock.file))) return;
  await withNativeLockCoordinator(lock, `release ${path.basename(lock.file)}`, async () => {
    const current = await readNativeLockSnapshot(lock.file);
    if (!current) return;
    if (current.owner.id !== lock.owner.id) {
      throw new Error(`Native lock ownership changed: ${lock.file}`);
    }
    if (!sameNativeLockVersion(current.identity, lock.identity)) {
      throw new Error(`Native lock identity changed: ${lock.file}`);
    }
    const coordinatorDir = path.join(lock.locksDir, NATIVE_LOCK_COORDINATOR_DIR);
    await removeBoundNativeLock(current, coordinatorDir);
  });
}

export function isProcessAlive(pid: number): boolean | null {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    return null;
  }
}

export async function diagnoseNativeLock(file: string): Promise<NativeLockDiagnosis> {
  return diagnosisFromSnapshot(await readNativeLockSnapshot(file));
}

export async function takeOverNativeStaleLock(
  paths: NativeProjectPaths,
  file: string,
  expected?: NativeLockDiagnosis,
): Promise<NativeStaleLockTakeover> {
  return withNativeLockCoordinator(paths, `take over ${path.basename(file)}`, async () => {
    const locksDir = await resolveContainedNativePath(paths.nativeRoot, paths.locksDir);
    const containedFile = await resolveContainedNativePath(paths.nativeRoot, file);
    if (path.resolve(path.dirname(containedFile)) !== path.resolve(locksDir)) {
      throw new Error(`Native lock takeover target is outside the lock directory: ${file}`);
    }
    const snapshot = await readNativeLockSnapshot(containedFile);
    const diagnosis = diagnosisFromSnapshot(snapshot);
    if (diagnosis.status === 'missing') return { status: 'missing' };
    if (expected && !sameNativeLockDiagnosis(expected, diagnosis)) {
      return { status: 'changed', diagnosis };
    }
    if (diagnosis.status !== 'stale' || !snapshot) {
      return { status: 'changed', diagnosis };
    }
    const coordinatorDir = path.join(locksDir, NATIVE_LOCK_COORDINATOR_DIR);
    const removed = await removeBoundNativeLock(snapshot, coordinatorDir);
    return removed === 'removed'
      ? { status: 'removed', owner: snapshot.owner }
      : { status: 'missing' };
  });
}
