import { execFileSync } from 'node:child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireNativeLock,
  diagnoseNativeLock,
  inspectNativeLockRecovery,
  inspectNativeProjectLocks,
  NATIVE_LOCK_UNKNOWN_TAKEOVER_MS,
  readNativeLock,
  releaseNativeLock,
  repairNativeProjectLock,
  takeOverNativeStaleLock,
  withNativeLockRecovery,
} from '../../../domains/comet-native/native-lock.js';
import { withNativeMutationLock } from '../../../domains/comet-native/native-mutation-lock.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { withNativeTransitionLock } from '../../../domains/comet-native/native-transition-journal.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';
import * as processIdentity from '../../../platform/process/process-identity.js';
import * as nativeLocking from '../../../domains/comet-native/native-lock.js';
import { RaceSafeReadError } from '../../../platform/fs/race-safe-read.js';

describe('Native operation locks', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-lock-'));
    paths = await nativeProjectPaths(projectRoot, '.');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('reports missing recovery records without creating a lock directory', async () => {
    const file = path.join(paths.locksDir, 'missing.lock');
    await expect(inspectNativeLockRecovery(file)).resolves.toEqual({
      file,
      status: 'missing',
      owner: null,
      identity: null,
      token: null,
    });
    await expect(inspectNativeProjectLocks(paths)).resolves.toEqual([]);
    await expect(fs.access(paths.locksDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('lists lock and coordinator records while preserving unrelated files and directories', async () => {
    const coordinator = path.join(paths.locksDir, '.coordinator');
    await fs.mkdir(coordinator, { recursive: true });
    await fs.writeFile(path.join(paths.locksDir, 'broken.lock'), 'interrupted JSON');
    await fs.writeFile(path.join(coordinator, 'broken.claim'), 'interrupted claim');
    await fs.mkdir(path.join(paths.locksDir, 'directory.lock'));
    await fs.mkdir(path.join(coordinator, 'directory.claim'));
    await fs.writeFile(path.join(paths.locksDir, 'notes.txt'), 'keep');
    await fs.writeFile(path.join(coordinator, 'notes.txt'), 'keep');

    const records = await inspectNativeProjectLocks(paths);
    expect(records).toHaveLength(4);
    for (const [directory, kind, suffix] of [
      [paths.locksDir, 'lock', 'lock'],
      [coordinator, 'coordinator', 'claim'],
    ] as const) {
      expect(records).toContainEqual(
        expect.objectContaining({
          file: path.join(directory, `broken.${suffix}`),
          kind,
          status: 'malformed',
          token: expect.any(String),
        }),
      );
      expect(records).toContainEqual(
        expect.objectContaining({
          file: path.join(directory, `directory.${suffix}`),
          kind,
          status: 'malformed',
          token: null,
        }),
      );
      expect(await fs.readFile(path.join(directory, 'notes.txt'), 'utf8')).toBe('keep');
    }
  });

  it.each(['lock', 'coordinator'] as const)(
    'repairs only the confirmed malformed %s record and retains its original bytes',
    async (kind) => {
      const coordinator = path.join(paths.locksDir, '.coordinator');
      await fs.mkdir(coordinator, { recursive: true });
      const file =
        kind === 'lock'
          ? path.join(paths.locksDir, 'broken.lock')
          : path.join(coordinator, 'broken.claim');
      const bytes = 'partial record from interrupted process';
      await fs.writeFile(file, bytes);
      const record = (await inspectNativeProjectLocks(paths)).find((entry) => entry.file === file)!;
      await expect(repairNativeProjectLock(paths, record.token!, false)).rejects.toThrow('changed');
      expect(await fs.readFile(file, 'utf8')).toBe(bytes);
      await repairNativeProjectLock(paths, record.token!, true);
      await expect(fs.access(file)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(inspectNativeProjectLocks(paths)).resolves.toEqual([]);
      await expect(repairNativeProjectLock(paths, record.token!, true)).rejects.toThrow('changed');
    },
  );

  it('rejects an old repair token after the malformed record changes', async () => {
    await fs.mkdir(paths.locksDir, { recursive: true });
    const file = path.join(paths.locksDir, 'broken.lock');
    await fs.writeFile(file, 'old partial record');
    const before = await inspectNativeLockRecovery(file);
    await fs.writeFile(file, 'replacement partial record');
    const after = await inspectNativeLockRecovery(file);
    expect(after.token).not.toBe(before.token);
    await expect(repairNativeProjectLock(paths, before.token!, true)).rejects.toThrow('changed');
    expect(await fs.readFile(file, 'utf8')).toBe('replacement partial record');
  });

  it('preserves a live lock even when its exact repair token and stop confirmation are supplied', async () => {
    const lock = await acquireNativeLock(paths, 'active', 'still running');
    try {
      const record = await inspectNativeLockRecovery(lock.file);
      expect(record.status).toBe('active');
      await expect(repairNativeProjectLock(paths, record.token!, true)).rejects.toThrow(
        'still held',
      );
      expect(await readNativeLock(lock.file)).toEqual(lock.owner);
    } finally {
      await releaseNativeLock(lock);
    }
  });

  it('removes a confirmed stopped owner without touching another operation lock', async () => {
    await fs.mkdir(paths.locksDir, { recursive: true });
    const file = path.join(paths.locksDir, 'stopped.lock');
    await fs.writeFile(
      file,
      JSON.stringify({
        id: 'stopped-owner',
        pid: 2_147_483_647,
        hostname: os.hostname(),
        createdAt: '2026-07-14T00:00:00.000Z',
        operation: 'interrupted operation',
      }),
    );
    const other = await acquireNativeLock(paths, 'other', 'other operation');
    try {
      const record = await inspectNativeLockRecovery(file);
      expect(record.status).toBe('unknown');
      await repairNativeProjectLock(paths, record.token!, true);
      await expect(readNativeLock(file)).resolves.toBeNull();
      expect(await readNativeLock(other.file)).toEqual(other.owner);
    } finally {
      await releaseNativeLock(other);
    }
  });

  it('stores owner metadata, rejects contention, and permits owner release', async () => {
    const lock = await acquireNativeLock(paths, 'archive', 'archive example');
    expect(await readNativeLock(lock.file)).toMatchObject({
      id: lock.owner.id,
      operation: 'archive example',
    });
    await expect(acquireNativeLock(paths, 'archive', 'another archive')).rejects.toThrow(
      /lock is busy/u,
    );
    await releaseNativeLock(lock);
    expect(await readNativeLock(lock.file)).toBeNull();
  });

  it('releases a lock when close finalizes its ctime', async () => {
    const originalOpen = fs.open.bind(fs);
    const open = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (args[1] !== 'wx') return handle;

      const stat = handle.stat.bind(handle);
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'stat') {
            return async (options?: { bigint?: boolean }) => {
              const result = await stat(options as { bigint: true });
              if (!options?.bigint) return result;
              return new Proxy(result, {
                get(statTarget, statProperty) {
                  if (statProperty === 'ctimeNs') return statTarget.ctimeNs - 1n;
                  return Reflect.get(statTarget, statProperty, statTarget);
                },
              });
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    });

    try {
      const lock = await acquireNativeLock(paths, 'archive', 'archive example');
      await expect(releaseNativeLock(lock)).resolves.toBeUndefined();
    } finally {
      open.mockRestore();
    }
  });

  it('validates lock names, tolerates a missing release target, and reuses nested coordinators', async () => {
    await expect(acquireNativeLock(paths, 'Bad Name', 'invalid')).rejects.toThrow(
      'Invalid Native lock name',
    );
    const lock = await acquireNativeLock(paths, 'nested', 'nested operation');
    await fs.rm(lock.file);
    await expect(releaseNativeLock(lock)).resolves.toBeUndefined();

    const events: string[] = [];
    await withNativeLockRecovery([paths, paths], 'nested recovery', async () => {
      events.push('outer');
      await withNativeLockRecovery([paths], 'nested recovery', async () => {
        events.push('inner');
      });
    });
    expect(events).toEqual(['outer', 'inner']);
  });

  it('does not release a lock whose ownership changed', async () => {
    const lock = await acquireNativeLock(paths, 'archive', 'archive example');
    await fs.writeFile(lock.file, JSON.stringify({ ...lock.owner, id: 'another-owner' }));
    await expect(releaseNativeLock(lock)).rejects.toThrow(/ownership changed/u);
    expect(await readNativeLock(lock.file)).toMatchObject({ id: 'another-owner' });
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a symlinked lock file instead of following it',
    async () => {
      const lock = await acquireNativeLock(paths, 'archive', 'archive example');
      const displaced = `${lock.file}.real`;
      await fs.rename(lock.file, displaced);
      await fs.symlink(displaced, lock.file);

      await expect(readNativeLock(lock.file)).rejects.toThrow(/regular file/u);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a FIFO at the lock path without blocking on open',
    async () => {
      const lock = await acquireNativeLock(paths, 'archive', 'archive example');
      await fs.rm(lock.file);
      execFileSync('mkfifo', [lock.file]);

      await expect(readNativeLock(lock.file)).rejects.toThrow(/regular file/u);
    },
  );

  it('fails closed for missing, malformed, oversized, and non-lock takeover targets', async () => {
    const missing = path.join(paths.locksDir, 'archive.lock');
    expect(await diagnoseNativeLock(missing)).toEqual({
      status: 'missing',
      owner: null,
      identity: null,
    });
    await expect(takeOverNativeStaleLock(paths, missing)).resolves.toEqual({ status: 'missing' });

    await fs.mkdir(paths.locksDir, { recursive: true });
    await fs.writeFile(missing, JSON.stringify({ pid: 1 }));
    await expect(readNativeLock(missing)).rejects.toThrow(/Invalid Native lock metadata/u);

    await fs.rm(missing);
    await fs.mkdir(missing);
    await expect(readNativeLock(missing)).rejects.toThrow(/regular file/u);
    await fs.rm(missing, { recursive: true });

    await fs.writeFile(missing, 'x'.repeat(16 * 1024 + 1));
    await expect(readNativeLock(missing)).rejects.toThrow(/exceeds/u);

    await fs.writeFile(
      missing,
      JSON.stringify({
        id: 'active-owner',
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: '2026-07-17T00:00:00.000Z',
        operation: 'active operation',
      }),
    );
    const unknown = await diagnoseNativeLock(missing);
    expect(unknown.status).toBe('unknown');
    await expect(takeOverNativeStaleLock(paths, missing, unknown)).resolves.toMatchObject({
      status: 'changed',
      diagnosis: { status: 'unknown' },
    });

    await expect(
      takeOverNativeStaleLock(paths, path.join(paths.runtimeDir, 'outside.lock')),
    ).rejects.toThrow(/outside the lock directory/u);
  });

  it('serializes live mutation contenders so the later command can recheck state', async () => {
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => (releaseFirst = resolve));
    let firstEntered!: () => void;
    const firstDidEnter = new Promise<void>((resolve) => (firstEntered = resolve));
    const order: string[] = [];
    const first = withNativeMutationLock(paths, 'first mutation', async () => {
      order.push('first');
      firstEntered();
      await firstMayFinish;
    });
    await firstDidEnter;
    const second = withNativeMutationLock(paths, 'second mutation', async () => {
      order.push('second');
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(['first']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });
});
