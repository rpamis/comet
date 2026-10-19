import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileRuntimeStore } from '../../../domains/engine/runtime.js';
import {
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
        expect(readdir).toHaveBeenCalledTimes(2);
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
