import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  acquireNativeLock,
  diagnoseNativeLock,
  readNativeLock,
  releaseNativeLock,
} from '../../../domains/comet-native/native-lock.js';
import { withNativeMutationLock } from '../../../domains/comet-native/native-mutation-lock.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { withNativeTransitionLock } from '../../../domains/comet-native/native-transition-journal.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

describe('Native operation locks', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-lock-'));
    paths = await nativeProjectPaths(projectRoot, '.');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('stores owner metadata, rejects contention, and permits owner release', async () => {
    const lock = await acquireNativeLock(paths, 'archive', 'archive example');
    expect(await readNativeLock(lock.file)).toMatchObject({
      id: lock.owner.id,
      pid: process.pid,
      hostname: os.hostname(),
      operation: 'archive example',
    });
    await expect(acquireNativeLock(paths, 'archive', 'another archive')).rejects.toThrow(
      /already held/u,
    );
    await releaseNativeLock(lock);
    expect(await readNativeLock(lock.file)).toBeNull();
  });

  it('does not release a lock whose ownership changed', async () => {
    const lock = await acquireNativeLock(paths, 'archive', 'archive example');
    await fs.writeFile(lock.file, JSON.stringify({ ...lock.owner, id: 'another-owner' }));
    await expect(releaseNativeLock(lock)).rejects.toThrow(/ownership changed/u);
    expect(await readNativeLock(lock.file)).toMatchObject({ id: 'another-owner' });
  });

  it('does not release a replacement file that reuses the same owner metadata', async () => {
    const lock = await acquireNativeLock(paths, 'archive', 'archive example');
    const displaced = `${lock.file}.displaced`;
    await fs.rename(lock.file, displaced);
    await fs.writeFile(lock.file, JSON.stringify(lock.owner, null, 2) + '\n');

    await expect(releaseNativeLock(lock)).rejects.toThrow(/identity changed/u);
    expect(await readNativeLock(lock.file)).toMatchObject({ id: lock.owner.id });
    await fs.rm(displaced, { force: true });
  });

  it.each([
    {
      fileName: 'root-move.lock',
      run: (work: () => Promise<void>) =>
        withNativeMutationLock(paths, 'mutate after stale owner', work),
    },
    {
      fileName: 'transition-example.lock',
      run: (work: () => Promise<void>) =>
        withNativeTransitionLock(paths, 'example', 'transition after stale owner', work),
    },
  ])('requires doctor takeover for a stale $fileName', async ({ fileName, run }) => {
    await fs.mkdir(paths.locksDir, { recursive: true });
    const file = path.join(paths.locksDir, fileName);
    const stale = {
      id: `stale-${fileName}`,
      pid: 2_147_483_647,
      hostname: os.hostname(),
      createdAt: '2026-07-17T00:00:00.000Z',
      operation: 'interrupted operation',
    };
    await fs.writeFile(file, JSON.stringify(stale));
    let entered = false;

    await expect(
      run(async () => {
        entered = true;
      }),
    ).rejects.toThrow(/already held/u);
    expect(entered).toBe(false);
    expect(await readNativeLock(file)).toEqual(stale);
  });

  it('diagnoses stale local and unknown remote locks without breaking them', async () => {
    await fs.mkdir(paths.locksDir, { recursive: true });
    const file = path.join(paths.locksDir, 'archive.lock');
    const stale = {
      id: 'stale-owner',
      pid: 2_147_483_647,
      hostname: os.hostname(),
      createdAt: '2026-07-14T00:00:00.000Z',
      operation: 'archive old-change',
    };
    await fs.writeFile(file, JSON.stringify(stale));
    expect(await diagnoseNativeLock(file)).toMatchObject({ status: 'stale', owner: stale });
    expect(await fs.readFile(file, 'utf8')).toContain('stale-owner');

    await fs.writeFile(file, JSON.stringify({ ...stale, hostname: 'another-host' }));
    expect(await diagnoseNativeLock(file)).toMatchObject({ status: 'unknown' });
    expect(await fs.readFile(file, 'utf8')).toContain('another-host');
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
