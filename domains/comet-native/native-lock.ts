import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import type { NativeProjectPaths } from './native-types.js';

export interface NativeLockOwner {
  id: string;
  pid: number;
  hostname: string;
  createdAt: string;
  operation: string;
}

export interface NativeLock {
  file: string;
  owner: NativeLockOwner;
}

export interface NativeLockDiagnosis {
  status: 'missing' | 'active' | 'stale' | 'unknown';
  owner: NativeLockOwner | null;
}

function lockName(value: string): string {
  if (!/^[a-z][a-z0-9-]*$/u.test(value)) throw new Error(`Invalid Native lock name: ${value}`);
  return `${value}.lock`;
}

export async function readNativeLock(file: string): Promise<NativeLockOwner | null> {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<NativeLockOwner>;
    if (
      typeof value.id !== 'string' ||
      typeof value.pid !== 'number' ||
      typeof value.hostname !== 'string' ||
      typeof value.createdAt !== 'string' ||
      typeof value.operation !== 'string'
    ) {
      throw new Error(`Invalid Native lock metadata: ${file}`);
    }
    return value as NativeLockOwner;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function acquireNativeLock(
  paths: NativeProjectPaths,
  name: string,
  operation: string,
): Promise<NativeLock> {
  await fs.mkdir(paths.locksDir, { recursive: true });
  const file = path.join(paths.locksDir, lockName(name));
  const owner: NativeLockOwner = {
    id: randomUUID(),
    pid: process.pid,
    hostname: os.hostname(),
    createdAt: new Date().toISOString(),
    operation,
  };
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
  } finally {
    await handle.close();
  }
  return { file, owner };
}

export async function releaseNativeLock(lock: NativeLock): Promise<void> {
  const current = await readNativeLock(lock.file);
  if (!current) return;
  if (current.id !== lock.owner.id) throw new Error(`Native lock ownership changed: ${lock.file}`);
  await fs.rm(lock.file, { force: true });
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
  const owner = await readNativeLock(file);
  if (!owner) return { status: 'missing', owner: null };
  if (owner.hostname !== os.hostname()) return { status: 'unknown', owner };
  const alive = isProcessAlive(owner.pid);
  return { status: alive === true ? 'active' : alive === false ? 'stale' : 'unknown', owner };
}
