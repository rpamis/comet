import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileRuntimeStore } from '../../../domains/engine/runtime.js';
import {
  iterateFileRuntimeStoreRunSources,
  listFileRuntimeStoreRuns,
  listFileRuntimeStoreRunSources,
  listFileRuntimeStoreRunKeys,
  readFileRuntimeStoreRunSources,
} from '../../../domains/engine/runtime-store-discovery.js';

describe('read-only RuntimeStore discovery', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-discovery-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const key = (id: string) => createHash('sha256').update(JSON.stringify(id)).digest('hex');

  it('excludes only structurally closed history without opening its body, while explicit reads still validate it', async () => {
    const store = createFileRuntimeStore({ rootDir: root });
    await store.compareAndSwap('closed', null, { runId: 'closed', revision: 1 });
    await store.closeRun('closed', 1);
    await store.compareAndSwap('active', null, { runId: 'active', revision: 1 });
    const history = path.join(root, '.runtime-store-history', key('closed'), 'checkpoint.json');
    await fs.writeFile(history, '{broken');
    const open = vi.spyOn(fs, 'open');
    try {
      const entries = await listFileRuntimeStoreRuns({ rootDir: root }, { excludeClosed: true });
      expect(entries.map((entry) => entry.runId)).toEqual(['active']);
      expect(open.mock.calls.some(([file]) => String(file) === history)).toBe(false);
      await expect(store.read('closed')).rejects.toMatchObject({ code: 'STORE_CORRUPT_RECORD' });
    } finally {
      open.mockRestore();
    }
  });

  it.each(['missing', 'conflict', 'marker', 'link'] as const)(
    'fails closed on %s history metadata instead of hiding a possible owner',
    async (kind) => {
      const store = createFileRuntimeStore({ rootDir: root });
      await store.compareAndSwap('closed', null, { runId: 'closed', revision: 1 });
      await store.closeRun('closed', 1);
      const history = path.join(root, '.runtime-store-history', key('closed'), 'checkpoint.json');
      if (kind === 'missing') await fs.unlink(history);
      if (kind === 'conflict') {
        await fs.mkdir(path.join(root, '.runtime-store-v2', key('closed')), { recursive: true });
        await fs.copyFile(
          history,
          path.join(root, '.runtime-store-v2', key('closed'), 'checkpoint.json'),
        );
      }
      if (kind === 'marker') {
        const marker = JSON.parse(await fs.readFile(path.join(root, key('closed')), 'utf8'));
        marker.recordHash = 'invalid';
        await fs.writeFile(path.join(root, key('closed')), JSON.stringify(marker));
      }
      if (kind === 'link') {
        await fs.rename(history, history + '.original');
        await fs.symlink(history + '.original', history);
      }
      const entries = await listFileRuntimeStoreRuns({ rootDir: root }, { excludeClosed: true });
      expect(entries).toHaveLength(1);
      expect(entries[0].record).toBeNull();
      expect(entries[0].error).not.toBeNull();
    },
  );

  it('fails closed when an active checkpoint loses its discovery marker', async () => {
    const store = createFileRuntimeStore({ rootDir: root });
    await store.compareAndSwap('orphan', null, { runId: 'orphan', revision: 1 });
    await fs.unlink(path.join(root, key('orphan')));
    const entries = await listFileRuntimeStoreRuns({ rootDir: root }, { excludeClosed: true });
    expect(entries).toHaveLength(1);
    expect(entries[0].error).not.toBeNull();
    expect(entries[0].record).toBeNull();
  });

  it.each([100, 1000, 10000])(
    'opens only the selected 50 identities among %i entries',
    async (count) => {
      for (let start = 0; start < count; start += 100) {
        await Promise.all(
          Array.from({ length: Math.min(100, count - start) }, (_, offset) => {
            const runId = `run-${start + offset}`;
            return fs.writeFile(
              path.join(root, key(runId)),
              JSON.stringify({ schema: 'comet.runtime-store-format.v2', runId, state: 'ready' }),
            );
          }),
        );
      }
      const open = vi.spyOn(fs, 'open');
      const readdir = vi.spyOn(fs, 'readdir');
      try {
        const keys = await listFileRuntimeStoreRunKeys({ rootDir: root });
        expect(keys).toHaveLength(count);
        expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
        expect(open).not.toHaveBeenCalled();
        const sources = await readFileRuntimeStoreRunSources({ rootDir: root }, keys.slice(0, 50));
        expect(sources).toHaveLength(50);
        expect(sources.every((source) => source.runId && !source.error)).toBe(true);
        expect(sources.every((source) => !('fingerprint' in source))).toBe(true);
        expect(open).toHaveBeenCalledTimes(50);
        expect(readdir).toHaveBeenCalledTimes(1);
      } finally {
        open.mockRestore();
        readdir.mockRestore();
      }
    },
    30000,
  );

  it('pages invalid identities and never follows selected links or traversal keys', async () => {
    await fs.writeFile(path.join(root, 'invalid'), '{}');
    await fs.symlink(
      root,
      path.join(root, key('link')),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const keys = await listFileRuntimeStoreRunKeys({ rootDir: root });
    expect(keys).toHaveLength(2);
    expect(await readFileRuntimeStoreRunSources({ rootDir: root }, ['../outside'])).toEqual([]);
    const sources = await readFileRuntimeStoreRunSources({ rootDir: root }, keys);
    expect(sources.every((source) => source.error && !source.runId)).toBe(true);
    expect(sources.every((source) => !('fingerprint' in source))).toBe(true);
  });

  it('discovers identity and changing source fingerprints without reading full checkpoints', async () => {
    const store = createFileRuntimeStore({ rootDir: root });
    await store.compareAndSwap('one', null, { runId: 'one', revision: 1 });
    const first = (await listFileRuntimeStoreRunSources({ rootDir: root }))[0];
    expect(first.runId).toBe('one');
    expect(first).not.toHaveProperty('record');
    await store.compareAndSwap('one', 1, { runId: 'one', revision: 2 });
    expect((await listFileRuntimeStoreRunSources({ rootDir: root }))[0].fingerprint).not.toBe(
      first.fingerprint,
    );
  });

  it('isolates an invalid partition and still discovers healthy history', async () => {
    const store = createFileRuntimeStore({ rootDir: root });
    await store.compareAndSwap('closed', null, { runId: 'closed', revision: 1 });
    await store.closeRun('closed', 1);
    // The active partition is empty after close; preserve it outside this Store.
    const active = path.join(root, '.runtime-store-v2');
    const saved = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-partition-backup-'));
    try {
      await fs.rename(active, path.join(saved, 'active'));
      await fs.writeFile(active, 'invalid partition');
      const sources = [];
      for await (const source of iterateFileRuntimeStoreRunSources({ rootDir: root }))
        sources.push(source);
      expect(
        sources.some((source) => source.storageKey === '.runtime-store-v2' && source.error),
      ).toBe(true);
      // The malformed partition remains visible even if a marker cannot be validated.
      expect(sources.some((source) => source.runId === 'closed')).toBe(true);
      expect(await fs.readFile(active, 'utf8')).toBe('invalid partition');
    } finally {
      await fs.rm(saved, { recursive: true, force: true });
    }
  });

  it('changes fingerprints when directory validation changes without checkpoint changes', async () => {
    const store = createFileRuntimeStore({ rootDir: root });
    await store.compareAndSwap('one', null, { runId: 'one', revision: 1 });
    const current = path.join(root, '.runtime-store-v2', key('one'));
    const checkpoint = await fs.readFile(path.join(current, 'checkpoint.json'), 'utf8');
    const first = (await listFileRuntimeStoreRunSources({ rootDir: root }))[0];
    await fs.writeFile(path.join(current, 'foreign.json'), '{}');
    const broken = (await listFileRuntimeStoreRunSources({ rootDir: root }))[0];
    expect(broken.fingerprint).not.toBe(first.fingerprint);
    await expect(store.read('one')).rejects.toMatchObject({ code: 'STORE_INVALID_ENTRY' });
    await fs.unlink(path.join(current, 'foreign.json'));
    const repaired = (await listFileRuntimeStoreRunSources({ rootDir: root }))[0];
    expect(repaired.fingerprint).not.toBe(broken.fingerprint);
    expect(await store.read('one')).toEqual({ runId: 'one', revision: 1 });
    expect(await fs.readFile(path.join(current, 'checkpoint.json'), 'utf8')).toBe(checkpoint);
  });

  it('discovers validated checkpoints without creating or changing files', async () => {
    const missing = path.join(root, 'missing');
    expect(await listFileRuntimeStoreRuns({ rootDir: missing })).toEqual([]);
    expect(await fs.stat(missing).catch(() => null)).toBeNull();
    const store = createFileRuntimeStore({ rootDir: root });
    await store.compareAndSwap('first', null, { runId: 'first', revision: 1 });
    await store.compareAndSwap('second', null, { runId: 'second', revision: 1 });
    const checkpoint = path.join(root, '.runtime-store-v2', key('first'), 'checkpoint.json');
    const before = await fs.readFile(checkpoint, 'utf8');
    const entries = await listFileRuntimeStoreRuns({ rootDir: root });
    expect(entries.map((e) => e.runId).sort()).toEqual(['first', 'second']);
    expect(entries.every((e) => e.record?.revision === 1 && !e.error)).toBe(true);
    expect(await fs.readFile(checkpoint, 'utf8')).toBe(before);
  });

  it('keeps unreadable identities while returning other healthy records', async () => {
    const store = createFileRuntimeStore({ rootDir: root });
    await store.compareAndSwap('broken', null, { runId: 'broken', revision: 1 });
    await store.compareAndSwap('healthy', null, { runId: 'healthy', revision: 1 });
    await fs.writeFile(
      path.join(root, '.runtime-store-v2', key('broken'), 'checkpoint.json'),
      '{}',
    );
    const entries = await listFileRuntimeStoreRuns({ rootDir: root });
    expect(entries.find((e) => e.runId === 'broken')).toMatchObject({
      record: null,
      error: { code: 'STORE_CORRUPT_RECORD' },
    });
    expect(entries.find((e) => e.runId === 'healthy')?.record).toEqual({
      runId: 'healthy',
      revision: 1,
    });
  });
  it('uses the same UTF-8 decoding as the original store for BOM-prefixed markers', async () => {
    const store = createFileRuntimeStore({ rootDir: root });
    await store.compareAndSwap('bom', null, { runId: 'bom', revision: 1 });
    const marker = path.join(root, key('bom'));
    await fs.writeFile(marker, '\uFEFF' + (await fs.readFile(marker, 'utf8')));
    expect(await store.read('bom')).toEqual({ runId: 'bom', revision: 1 });
    expect((await listFileRuntimeStoreRuns({ rootDir: root }))[0].error).toBeNull();
  });

  it('rejects forged identities and links without following them', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-outside-'));
    try {
      await fs.writeFile(
        path.join(root, key('forged')),
        JSON.stringify({
          schema: 'comet.runtime-store-format.v2',
          runId: 'different',
          state: 'ready',
        }),
      );
      await fs.symlink(
        outside,
        path.join(root, key('linked')),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const entries = await listFileRuntimeStoreRuns({ rootDir: root });
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.record === null && e.error)).toBe(true);
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
