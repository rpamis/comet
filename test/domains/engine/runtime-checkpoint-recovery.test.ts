import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFileRuntimeStore,
  createMemoryRuntimeStore,
} from '../../../domains/engine/runtime-store.js';

interface RecordValue {
  runId: string;
  revision: number;
  state: { decision: string };
}
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(kind: string) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-checkpoint-store-'));
  roots.push(rootDir);
  const store =
    kind === 'memory'
      ? createMemoryRuntimeStore<RecordValue>()
      : createFileRuntimeStore<RecordValue>({ rootDir });
  const reopen = () =>
    kind === 'memory' ? store : createFileRuntimeStore<RecordValue>({ rootDir });
  return { rootDir, store, reopen };
}
const checkpoint: RecordValue = { runId: 'saved', revision: 17, state: { decision: 'approved' } };

describe.each(['memory', 'file'])('%s RuntimeStore checkpoint restoration', (kind) => {
  it('restores the original revision without reviving stale CAS or inventing history', async () => {
    const { store, reopen, rootDir } = await fixture(kind);
    expect(await store.restoreCheckpoint!(checkpoint.runId, null, checkpoint)).toBe(true);
    expect(await reopen().read(checkpoint.runId)).toEqual(checkpoint);
    expect(await store.restoreCheckpoint!(checkpoint.runId, null, checkpoint)).toBe(false);
    expect(await store.compareAndSwap(checkpoint.runId, 1, { ...checkpoint, revision: 2 })).toBe(
      false,
    );
    expect(await store.compareAndSwap(checkpoint.runId, 17, { ...checkpoint, revision: 18 })).toBe(
      true,
    );
    expect((await reopen().read(checkpoint.runId))?.revision).toBe(18);
    if (kind === 'file') {
      const runDir = path.join(rootDir, (await fs.readdir(rootDir))[0]);
      expect((await fs.readdir(runDir)).sort()).toEqual([
        '0000000000000001.json',
        '0000000000000018.json',
      ]);
    }
  });

  it('finishes only an exactly matching interrupted revision-1 import and preserves it', async () => {
    const { store, reopen, rootDir } = await fixture(kind);
    const partial = { ...checkpoint, revision: 1 };
    await store.compareAndSwap(checkpoint.runId, null, partial);
    expect(
      await store.restoreCheckpoint!(checkpoint.runId, 1, {
        ...checkpoint,
        state: { decision: 'changed' },
      }),
    ).toBe(false);
    expect(await store.read(checkpoint.runId)).toEqual(partial);
    expect(await store.restoreCheckpoint!(checkpoint.runId, 1, checkpoint)).toBe(true);
    expect(await reopen().read(checkpoint.runId)).toEqual(checkpoint);
    expect(await store.compareAndSwap(checkpoint.runId, 1, { ...partial, revision: 2 })).toBe(
      false,
    );
    expect(await store.compareAndSwap(checkpoint.runId, 17, { ...checkpoint, revision: 18 })).toBe(
      true,
    );
    expect((await reopen().read(checkpoint.runId))?.revision).toBe(18);
    if (kind === 'file') {
      const runDir = path.join(rootDir, (await fs.readdir(rootDir))[0]);
      expect(
        JSON.parse(await fs.readFile(path.join(runDir, '0000000000000001.json'), 'utf8')),
      ).toEqual(partial);
    }
  });

  it.each([null, 1] as const)(
    'has one winner against a competing initial or next CAS (%s)',
    async (expected) => {
      const { store, reopen } = await fixture(kind);
      const first = { ...checkpoint, revision: 1 };
      if (expected === 1) await store.compareAndSwap(checkpoint.runId, null, first);
      const results = await Promise.all([
        store.restoreCheckpoint!(checkpoint.runId, expected, checkpoint),
        reopen().compareAndSwap(checkpoint.runId, expected, {
          ...first,
          revision: (expected ?? 0) + 1,
        }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await store.read(checkpoint.runId))?.revision).toBe(
        results[0] ? 17 : (expected ?? 0) + 1,
      );
    },
  );

  it('captures a detached checkpoint and retains normal CAS validation', async () => {
    const { store } = await fixture(kind);
    const next = structuredClone(checkpoint);
    const pending = store.restoreCheckpoint!(next.runId, null, next);
    next.revision = 2;
    next.state.decision = 'changed';
    expect(await pending).toBe(true);
    expect(await store.read(checkpoint.runId)).toEqual(checkpoint);
    await expect(
      store.compareAndSwap('other', null, { ...checkpoint, runId: 'other' }),
    ).rejects.toThrow(/revision/);
    await expect(store.restoreCheckpoint!('wrong', null, checkpoint)).rejects.toThrow(/runId/);
    await expect(
      store.restoreCheckpoint!(checkpoint.runId, 1, { ...checkpoint, revision: 1 }),
    ).rejects.toThrow(/revision/);
  });
});

describe('file checkpoint publication', () => {
  it.each(['before', 'after'])(
    'retries an interrupted %s-publication import without resetting revision',
    async (when) => {
      const { store, reopen } = await fixture('file');
      const link = fs.link.bind(fs);
      const spy = vi.spyOn(fs, 'link').mockImplementationOnce(async (...args) => {
        if (when === 'after') await link(...args);
        throw new Error('simulated publication interruption');
      });
      await expect(store.restoreCheckpoint!(checkpoint.runId, null, checkpoint)).rejects.toThrow(
        /interruption/,
      );
      spy.mockRestore();
      expect(await reopen().read(checkpoint.runId)).toEqual(when === 'before' ? null : checkpoint);
      expect(await reopen().restoreCheckpoint!(checkpoint.runId, null, checkpoint)).toBe(
        when === 'before',
      );
      expect(await reopen().read(checkpoint.runId)).toEqual(checkpoint);
    },
  );

  it.each(['gap', 'checkpoint-hash', 'checkpoint-revision', 'initial-import'])(
    'rejects %s corruption without overwriting evidence',
    async (damage) => {
      const { store, reopen, rootDir } = await fixture('file');
      await store.compareAndSwap(checkpoint.runId, null, { ...checkpoint, revision: 1 });
      await store.restoreCheckpoint!(checkpoint.runId, 1, checkpoint);
      await store.compareAndSwap(checkpoint.runId, 17, { ...checkpoint, revision: 18 });
      await store.compareAndSwap(checkpoint.runId, 18, { ...checkpoint, revision: 19 });
      const runDir = path.join(rootDir, (await fs.readdir(rootDir))[0]);
      if (damage === 'gap') await fs.unlink(path.join(runDir, '0000000000000018.json'));
      else if (damage === 'initial-import')
        await fs.writeFile(
          path.join(runDir, '0000000000000001.json'),
          JSON.stringify({ ...checkpoint, revision: 1, state: { decision: 'changed' } }),
        );
      else {
        const file = path.join(runDir, '0000000000000002.json');
        const value = JSON.parse(await fs.readFile(file, 'utf8'));
        if (damage === 'checkpoint-hash') value.hash = '0'.repeat(64);
        else value.record.revision = 2;
        await fs.writeFile(file, JSON.stringify(value));
      }
      const before = await fs.readdir(runDir);
      await expect(reopen().read(checkpoint.runId)).rejects.toThrow();
      await expect(
        reopen().restoreCheckpoint!(checkpoint.runId, null, checkpoint),
      ).rejects.toThrow();
      expect(await fs.readdir(runDir)).toEqual(before);
    },
  );
});
