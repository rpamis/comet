import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { readFileRaceSafe, RaceSafeReadError } from './race-safe-read.js';
import { linkWithRetry, unlinkWithRetry } from './transient-retry.js';
import { inspectProcessLiveness, readProcessIdentity } from '../process/process-identity.js';

export interface RecoverableFileLockOwner {
  readonly pid: number;
  readonly nonce: string;
  readonly createdAt: number;
  readonly hostname?: string;
  readonly processIdentity?: string;
}

export interface RecoverableFileLockOptions {
  readonly timeoutMs?: number;
  readonly retryMs?: number;
  /** Retained for source compatibility. Age alone no longer proves owner exit. */
  readonly malformedLockStaleMs?: number;
}

export interface RecoverableFileLockDiagnosis {
  readonly status: 'missing' | 'active' | 'stale' | 'unknown' | 'malformed';
  readonly owner: RecoverableFileLockOwner | null;
  readonly token: string | null;
  readonly coordinator?: Array<{
    file: string;
    status: 'active' | 'unknown' | 'malformed';
    owner: RecoverableFileLockOwner | null;
    token: string;
  }>;
}

interface LockSnapshot {
  content: string;
  stat: BigIntStats;
  owner: RecoverableFileLockOwner | null;
  token: string;
}

const MAX_OWNER_BYTES = 16 * 1024;

function parseOwner(content: string): RecoverableFileLockOwner | null {
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    if (
      !value ||
      !Number.isSafeInteger(value.pid) ||
      Number(value.pid) < 1 ||
      typeof value.nonce !== 'string' ||
      !value.nonce ||
      typeof value.createdAt !== 'number' ||
      !Number.isFinite(value.createdAt) ||
      (value.hostname !== undefined && (typeof value.hostname !== 'string' || !value.hostname)) ||
      (value.processIdentity !== undefined &&
        (typeof value.processIdentity !== 'string' || !value.processIdentity))
    )
      return null;
    return value as unknown as RecoverableFileLockOwner;
  } catch {
    return null;
  }
}

function objectIdentity(stat: BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
}

async function captureParent(file: string) {
  const directory = path.dirname(file);
  const stat = await fs.lstat(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`File lock parent must be a real directory: ${directory}`);
  return { directory, identity: objectIdentity(stat), realPath: await fs.realpath(directory) };
}

async function verifyParent(parent: Awaited<ReturnType<typeof captureParent>>) {
  const stat = await fs.lstat(parent.directory, { bigint: true });
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    objectIdentity(stat) !== parent.identity ||
    (await fs.realpath(parent.directory)) !== parent.realPath
  ) {
    throw new Error(`File lock parent changed: ${parent.directory}`);
  }
}

async function snapshot(file: string): Promise<LockSnapshot | null> {
  try {
    const parent = await captureParent(file);
    const read = await readFileRaceSafe(file, MAX_OWNER_BYTES, {
      bigint: true,
      label: 'File lock',
      verify: () => verifyParent(parent),
    });
    const stat = read.stat as BigIntStats;
    const content = read.bytes.toString('utf8');
    const token = createHash('sha256')
      .update(`${objectIdentity(stat)}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}\n${content}`)
      .digest('hex');
    return { content, stat, owner: parseOwner(content), token };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function ownerStatus(
  owner: RecoverableFileLockOwner,
): Promise<'active' | 'stale' | 'unknown'> {
  if (owner.hostname !== os.hostname()) return 'unknown';
  const liveness = await inspectProcessLiveness(owner.pid, owner.processIdentity);
  return liveness === 'alive' ? 'active' : liveness === 'dead' ? 'stale' : 'unknown';
}

async function diagnosis(current: LockSnapshot | null): Promise<RecoverableFileLockDiagnosis> {
  return current
    ? {
        status: current.owner ? await ownerStatus(current.owner) : 'malformed',
        owner: current.owner,
        token: current.token,
      }
    : { status: 'missing', owner: null, token: null };
}

/** Inspect without creating directories, taking locks, or repairing state. */
export async function diagnoseRecoverableFileLock(
  file: string,
): Promise<RecoverableFileLockDiagnosis> {
  file = path.resolve(file);
  const result = await diagnosis(await snapshot(file));
  const coordinator: NonNullable<RecoverableFileLockDiagnosis['coordinator']> = [];
  let entries: string[];
  try {
    const directory = `${file}.contenders`;
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(`File lock coordinator must be a directory: ${directory}`);
    entries = await fs.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result;
    throw error;
  }
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.choosing') && !entry.endsWith('.ticket')) continue;
    const target = path.join(`${file}.contenders`, entry);
    const current = await snapshot(target);
    let checked = await diagnosis(current);
    if (current && entry.endsWith('.ticket')) {
      const ticket = current.owner
        ? (JSON.parse(current.content) as { ticket?: number }).ticket
        : undefined;
      if (!Number.isSafeInteger(ticket) || ticket! < 1)
        checked = { ...checked, status: 'malformed' };
    }
    if (current && checked.status !== 'missing' && checked.status !== 'stale') {
      coordinator.push({
        file: target,
        status: checked.status,
        owner: checked.owner,
        token: current.token,
      });
    }
  }
  return { ...result, ...(coordinator.length ? { coordinator } : {}) };
}

async function newOwner(): Promise<RecoverableFileLockOwner> {
  const processIdentity = await readProcessIdentity(process.pid);
  return {
    pid: process.pid,
    nonce: randomUUID(),
    createdAt: Date.now(),
    hostname: os.hostname(),
    ...(processIdentity === null ? {} : { processIdentity }),
  };
}

/** Publish only a complete record. A crash leaves an unreferenced temporary file. */
async function publish(
  file: string,
  owner: RecoverableFileLockOwner,
  ticket?: number,
): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const parent = await captureParent(file);
  try {
    await verifyParent(parent);
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(
        JSON.stringify({ ...owner, ...(ticket === undefined ? {} : { ticket }) }),
        'utf8',
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    await verifyParent(parent);
    await linkWithRetry(temporary, file);
  } finally {
    await verifyParent(parent);
    await unlinkWithRetry(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

/**
 * All cooperating publishers and removers serialize their short metadata updates.
 * Immutable, nonce-named bakery tickets avoid an abandoned coordinator lock. Dead
 * local tickets are ignored, never deleted by a competing process. Unknown remote
 * contenders remain blockers; a timeout never establishes that their owner exited.
 */
async function coordinatorSnapshot(
  file: string,
  deadline: number,
  retryMs: number,
): Promise<LockSnapshot | null> {
  for (;;) {
    try {
      return await snapshot(file);
    } catch (error) {
      const retryable =
        (error instanceof RaceSafeReadError && error.reason === 'changed') ||
        (process.platform === 'win32' &&
          ['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? ''));
      if (!retryable || performance.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
}

async function withCoordinator<T>(
  file: string,
  owner: RecoverableFileLockOwner,
  deadline: number,
  retryMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  const coordinatorOwner = { ...owner, nonce: randomUUID(), createdAt: Date.now() };
  const parent = await captureParent(file);
  const directory = `${file}.contenders`;
  await verifyParent(parent);
  await fs.mkdir(directory, { recursive: true });
  const directoryStat = await fs.lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
    throw new Error(`File lock coordinator must be a directory: ${directory}`);
  const choosing = path.join(directory, `${coordinatorOwner.nonce}.choosing`);
  const ticketFile = path.join(directory, `${coordinatorOwner.nonce}.ticket`);
  try {
    await publish(choosing, coordinatorOwner);
    let highest = 0;
    for (const entry of await fs.readdir(directory)) {
      if (!entry.endsWith('.ticket')) continue;
      const current = await coordinatorSnapshot(path.join(directory, entry), deadline, retryMs);
      if (!current) continue;
      const number = current.owner
        ? (JSON.parse(current.content) as { ticket?: number }).ticket
        : undefined;
      if (!Number.isSafeInteger(number) || number! < 1 || !current.owner)
        throw new Error(`Invalid file lock coordinator ticket: ${path.join(directory, entry)}`);
      if ((await ownerStatus(current.owner)) !== 'stale') highest = Math.max(highest, number!);
    }
    if (!Number.isSafeInteger(highest + 1))
      throw new Error(`File lock coordinator ticket overflow: ${directory}`);
    const ticket = highest + 1;
    await publish(ticketFile, coordinatorOwner, ticket);
    await unlinkWithRetry(choosing);
    for (;;) {
      let blocked = false;
      for (const entry of await fs.readdir(directory)) {
        if (
          (!entry.endsWith('.choosing') && !entry.endsWith('.ticket')) ||
          entry === path.basename(ticketFile)
        )
          continue;
        const current = await coordinatorSnapshot(path.join(directory, entry), deadline, retryMs);
        if (!current) {
          blocked = true;
          continue;
        }
        if (!current.owner)
          throw new Error(
            `Invalid file lock coordinator record: ${path.join(directory, entry)}; confirm all writers have stopped before repairing it`,
          );
        if ((await ownerStatus(current.owner)) === 'stale') continue;
        if (entry.endsWith('.choosing')) {
          blocked = true;
          continue;
        }
        const other = (JSON.parse(current.content) as { ticket?: number }).ticket;
        if (!Number.isSafeInteger(other) || other! < 1)
          throw new Error(`Invalid file lock coordinator ticket: ${path.join(directory, entry)}`);
        if (other! < ticket || (other === ticket && current.owner.nonce < coordinatorOwner.nonce))
          blocked = true;
      }
      if (!blocked) {
        await verifyParent(parent);
        return await operation();
      }
      if (performance.now() >= deadline)
        throw new Error(
          `Timed out waiting for file lock coordinator: ${directory}; inspect its owner records before repair`,
        );
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  } finally {
    for (const ownFile of [choosing, ticketFile]) {
      const current = await coordinatorSnapshot(
        ownFile,
        Math.max(deadline, performance.now() + 1000),
        retryMs,
      );
      if (current?.owner?.nonce === coordinatorOwner.nonce)
        await unlinkWithRetry(ownFile).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
    }
  }
}

/** Must run inside the coordinator. Changed metadata is retained for investigation. */
async function removeBound(file: string, expected: LockSnapshot): Promise<boolean> {
  const parent = await captureParent(file);
  const current = await snapshot(file);
  if (!current) return true;
  if (current.token !== expected.token) return false;
  const quarantine = `${file}.${randomUUID()}.removed`;
  try {
    await verifyParent(parent);
    await fs.rename(file, quarantine);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
  const moved = await snapshot(quarantine);
  if (
    !moved ||
    moved.content !== expected.content ||
    objectIdentity(moved.stat) !== objectIdentity(expected.stat)
  ) {
    // link is no-clobber: even a non-cooperating writer's replacement is preserved.
    await fs.link(quarantine, file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    throw new Error(`File lock changed during repair; preserved record at ${quarantine}`);
  }
  await fs.unlink(quarantine);
  return true;
}

/** Confirmed repair binds approval to the exact inspected owner and file version. */
export async function repairRecoverableFileLock(
  file: string,
  expectedToken: string,
  options: { confirmedOwnerStopped?: boolean } = {},
): Promise<'removed' | 'missing' | 'changed' | 'blocked'> {
  file = path.resolve(file);
  const inspected = await diagnoseRecoverableFileLock(file);
  const contender = inspected.coordinator?.find((entry) => entry.token === expectedToken);
  if (contender) {
    if (contender.status === 'active' || !options.confirmedOwnerStopped) return 'blocked';
    // A confirmed abandoned ticket has a unique, immutable nonce path. New
    // contenders publish different paths, so repairing it cannot remove theirs.
    const current = await snapshot(contender.file);
    if (!current) return 'missing';
    if (current.token !== expectedToken) return 'changed';
    if (current.owner && (await ownerStatus(current.owner)) === 'active') return 'blocked';
    return (await removeBound(contender.file, current)) ? 'removed' : 'changed';
  }
  const owner = await newOwner();
  return withCoordinator(file, owner, performance.now() + 1_000, 10, async () => {
    const current = await snapshot(file);
    if (!current) return 'missing';
    if (current.token !== expectedToken) return 'changed';
    const checked = await diagnosis(current);
    if (
      checked.status === 'active' ||
      (checked.status !== 'stale' && !options.confirmedOwnerStopped)
    )
      return 'blocked';
    return (await removeBound(file, current)) ? 'removed' : 'changed';
  });
}

export async function withRecoverableFileLock<T>(
  file: string,
  operation: () => Promise<T>,
  options: RecoverableFileLockOptions = {},
): Promise<T> {
  file = path.resolve(file);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retryMs = options.retryMs ?? 20;
  const deadline = performance.now() + timeoutMs;
  const owner = await newOwner();
  let held: LockSnapshot | null = null;
  for (;;) {
    const acquired = await withCoordinator(file, owner, deadline, retryMs, async () => {
      const current = await snapshot(file);
      if (current) {
        if ((await diagnosis(current)).status !== 'stale' || !(await removeBound(file, current)))
          return false;
      }
      try {
        await publish(file, owner);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
      }
      held = await snapshot(file);
      if (held?.owner?.nonce !== owner.nonce)
        throw new Error(`File lock ownership changed while publishing: ${file}`);
      return true;
    });
    if (acquired) break;
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for file lock: ${file}`);
    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }
  try {
    return await operation();
  } finally {
    try {
      await withCoordinator(file, owner, performance.now() + timeoutMs, retryMs, async () => {
        const current = await snapshot(file);
        if (
          held &&
          current?.token === (held as LockSnapshot).token &&
          current.owner?.nonce === owner.nonce
        )
          await removeBound(file, current);
      });
    } catch (error) {
      process.stderr.write(
        `[comet] warning: could not release file lock ${file}: ${error instanceof Error ? error.message : error}; inspect the owner before repair\n`,
      );
    }
  }
}
