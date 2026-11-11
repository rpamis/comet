import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileRuntimeStore } from '../../../domains/engine/runtime-store.js';
import { withRecoverableFileLock } from '../../../platform/fs/recoverable-file-lock.js';
vi.mock('../../../platform/fs/recoverable-file-lock.js', async (original) => {
  const actual = await original<typeof import('../../../platform/fs/recoverable-file-lock.js')>();
  return { ...actual, withRecoverableFileLock: vi.fn(actual.withRecoverableFileLock) };
});
const roots: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
it('keeps serial workflow checkpoints and revision checks without acquiring writer locks', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-serial-store-'));
  roots.push(rootDir);
  const store = createFileRuntimeStore({ rootDir, singleWriter: true });
  const first = { runId: 'serial', revision: 1, value: 'original claim and approval' };
  expect(await store.compareAndSwap(first.runId, null, first)).toBe(true);
  expect(await store.compareAndSwap(first.runId, null, first)).toBe(false);
  expect(await store.closeRun(first.runId, 1)).toBe(true);
  expect(await store.read(first.runId)).toEqual(first);
  expect(await store.reopenRun(first.runId, 1)).toBe(true);
  const second = { ...first, revision: 2, value: 'accepted result' };
  expect(await store.compareAndSwap(first.runId, 1, second)).toBe(true);
  expect(await store.compareAndSwap(first.runId, 1, { ...second, value: 'stale' })).toBe(false);
  expect(await store.read(first.runId)).toEqual(second);
  expect(withRecoverableFileLock).not.toHaveBeenCalled();
});
it('keeps one winning concurrent commit for default SDK stores used by owned asynchronous work', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-owned-store-'));
  roots.push(rootDir);
  const store = createFileRuntimeStore({ rootDir });
  const first = { runId: 'owned', revision: 1, value: 'running' };
  await store.compareAndSwap(first.runId, null, first);
  const outcomes = await Promise.all(
    ['cancelled', 'completed'].map((value) =>
      createFileRuntimeStore({ rootDir }).compareAndSwap(first.runId, 1, {
        ...first,
        revision: 2,
        value,
      }),
    ),
  );
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  expect((await store.read(first.runId))?.value).toBe(outcomes[0] ? 'cancelled' : 'completed');
  expect(withRecoverableFileLock).toHaveBeenCalled();
});
