import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { build } from 'esbuild';

import {
  createFileRuntimeStore,
  createMemoryRuntimeStore,
} from '../../../domains/engine/runtime-store.js';

interface RecordValue {
  runId: string;
  revision: number;
  state: { message: string };
}

describe('memory RuntimeStore', () => {
  it('commits an aggregate only against its expected revision', async () => {
    const store = createMemoryRuntimeStore<RecordValue>();
    const first = { runId: 'run-1', revision: 1, state: { message: 'ready' } };
    expect(await store.read('run-1')).toBeNull();
    expect(await store.compareAndSwap('run-1', null, first)).toBe(true);
    expect(await store.compareAndSwap('run-1', null, first)).toBe(false);
    expect(await store.read('run-1')).toEqual(first);
    expect(
      await store.compareAndSwap('run-1', 1, { ...first, revision: 2, state: { message: 'done' } }),
    ).toBe(true);
    expect(await store.compareAndSwap('run-1', 1, { ...first, revision: 2 })).toBe(false);
    expect(await store.read('run-1')).toEqual({
      runId: 'run-1',
      revision: 2,
      state: { message: 'done' },
    });
  });

  it('isolates snapshots and rejects values that cannot be preserved as JSON', async () => {
    const store = createMemoryRuntimeStore<RecordValue>();
    const first = { runId: 'run-1', revision: 1, state: { message: 'ready' } };
    await store.compareAndSwap('run-1', null, first);
    first.state.message = 'mutated input';
    const read = (await store.read('run-1'))!;
    read.state.message = 'mutated output';
    expect((await store.read('run-1'))!.state.message).toBe('ready');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [
      undefined,
      NaN,
      Infinity,
      1n,
      () => true,
      Symbol(),
      new Date(),
      new Map(),
      cyclic,
      new Array(2),
    ]) {
      await expect(
        store.compareAndSwap('run-1', 1, {
          ...first,
          revision: 2,
          value,
        } as RecordValue),
      ).rejects.toThrow(/JSON/);
    }
    expect((await store.read('run-1'))!.revision).toBe(1);
  });

  it('uses canonical JSON without invoking inherited serialization hooks', async () => {
    const store = createMemoryRuntimeStore<RecordValue & { values: number[] }>();
    class CustomArray extends Array<number> {
      toJSON() {
        throw new Error('must not execute');
      }
    }
    await store.compareAndSwap('run-1', null, {
      runId: 'run-1',
      revision: 1,
      state: { message: 'ready' },
      values: new CustomArray(-0, 2),
    });
    expect((await store.read('run-1'))!.values).toEqual([0, 2]);
  });

  it('rejects invalid run identities and revision transitions before writing', async () => {
    const store = createMemoryRuntimeStore<RecordValue>();
    const first = { runId: 'run-1', revision: 1, state: { message: 'ready' } };
    await expect(store.read('')).rejects.toThrow(/runId/);
    await expect(store.compareAndSwap('', null, first)).rejects.toThrow(/runId/);
    await expect(store.compareAndSwap('different', null, first)).rejects.toThrow(/runId/);
    for (const revision of [0, 2, NaN, 1.5]) {
      await expect(store.compareAndSwap('run-1', null, { ...first, revision })).rejects.toThrow(
        /revision|JSON/i,
      );
    }
    await expect(store.compareAndSwap('run-1', 0, first)).rejects.toThrow(/revision/i);
    expect(await store.read('run-1')).toBeNull();
  });
});

describe('file RuntimeStore', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'comet-runtime-store-')));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reopens complete aggregates and rejects stale writes across store instances', async () => {
    const rootDir = path.join(root, 'nested', 'store');
    const store = createFileRuntimeStore<RecordValue>({ rootDir });
    const other = createFileRuntimeStore<RecordValue>({ rootDir });
    const first = { runId: 'run/1', revision: 1, state: { message: 'ready' } };
    expect(await store.read(first.runId)).toBeNull();
    expect(await store.compareAndSwap(first.runId, null, first)).toBe(true);
    expect(await other.read(first.runId)).toEqual(first);
    const outcomes = await Promise.all([
      store.compareAndSwap(first.runId, 1, { ...first, revision: 2, state: { message: 'left' } }),
      other.compareAndSwap(first.runId, 1, { ...first, revision: 2, state: { message: 'right' } }),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(
      (await createFileRuntimeStore<RecordValue>({ rootDir }).read(first.runId))!.revision,
    ).toBe(2);
    expect(await store.compareAndSwap(first.runId, 1, { ...first, revision: 2 })).toBe(false);
  });

  it('captures the supplied aggregate before asynchronous file operations begin', async () => {
    const store = createFileRuntimeStore<RecordValue>({ rootDir: path.join(root, 'store') });
    const next = { runId: 'run-1', revision: 1, state: { message: 'ready' } };
    const pending = store.compareAndSwap('run-1', null, next);
    next.revision = 99;
    next.state.message = 'changed';
    expect(await pending).toBe(true);
    expect(await store.read('run-1')).toEqual({
      runId: 'run-1',
      revision: 1,
      state: { message: 'ready' },
    });
  });

  it('keeps distinct JSON run identities separate even when UTF-8 would replace their surrogates', async () => {
    const store = createFileRuntimeStore<RecordValue>({ rootDir: path.join(root, 'store') });
    for (const runId of ['\ud800', '\ud801']) {
      expect(await store.read(runId)).toBeNull();
      expect(
        await store.compareAndSwap(runId, null, {
          runId,
          revision: 1,
          state: { message: runId },
        }),
      ).toBe(true);
    }
    expect((await store.read('\ud800'))!.state.message).toBe('\ud800');
    expect((await store.read('\ud801'))!.state.message).toBe('\ud801');
  });

  it.each(['missing', 'corrupt', 'runId', 'revision'])(
    'fails closed on %s committed state',
    async (damage) => {
      const rootDir = path.join(root, 'store');
      const store = createFileRuntimeStore<RecordValue>({ rootDir });
      const first = { runId: 'run-1', revision: 1, state: { message: 'ready' } };
      await store.compareAndSwap(first.runId, null, first);
      await store.compareAndSwap(first.runId, 1, { ...first, revision: 2 });
      const runDir = path.join(rootDir, (await fs.readdir(rootDir))[0]);
      const latest = path.join(runDir, '0000000000000002.json');
      if (damage === 'missing') await fs.unlink(path.join(runDir, '0000000000000001.json'));
      else if (damage === 'corrupt') await fs.writeFile(latest, '{broken');
      else
        await fs.writeFile(
          latest,
          JSON.stringify({ ...first, revision: 2, [damage]: damage === 'runId' ? 'other' : 9 }),
        );
      await expect(store.read(first.runId)).rejects.toThrow();
      await expect(
        store.compareAndSwap(first.runId, 2, { ...first, revision: 3 }),
      ).rejects.toThrow();
    },
  );

  it('does not follow a store ancestor replaced by a symlink or junction', async () => {
    const outside = path.join(root, 'outside');
    const link = path.join(root, 'link');
    await fs.mkdir(outside);
    await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    const store = createFileRuntimeStore<RecordValue>({ rootDir: path.join(link, 'store') });
    await expect(store.read('run-1')).rejects.toThrow(/link|junction/);
    await expect(
      store.compareAndSwap('run-1', null, {
        runId: 'run-1',
        revision: 1,
        state: { message: 'ready' },
      }),
    ).rejects.toThrow(/link|junction/);
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('rejects a run directory replaced while revisions are being enumerated', async () => {
    const rootDir = path.join(root, 'store');
    const store = createFileRuntimeStore<RecordValue>({ rootDir });
    await store.compareAndSwap('run-1', null, {
      runId: 'run-1',
      revision: 1,
      state: { message: 'ready' },
    });
    const runDir = path.join(rootDir, (await fs.readdir(rootDir))[0]);
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    const readdir = fs.readdir.bind(fs);
    const spy = vi.spyOn(fs, 'readdir').mockImplementationOnce(async (...args) => {
      await fs.rename(runDir, path.join(root, 'held'));
      await fs.symlink(outside, runDir, process.platform === 'win32' ? 'junction' : 'dir');
      return readdir(...args);
    });
    try {
      await expect(store.read('run-1')).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it('has one CAS winner when independent processes publish the same revision', async () => {
    const rootDir = path.join(root, 'store');
    const bundle = await bundleStore(root);
    const store = createFileRuntimeStore<RecordValue>({ rootDir });
    await store.compareAndSwap('run-1', null, {
      runId: 'run-1',
      revision: 1,
      state: { message: 'ready' },
    });
    const workers = await Promise.all(
      ['a', 'b', 'c', 'd'].map((label) => startWorker(bundle, rootDir, 'normal', label)),
    );
    try {
      const results = workers.map(async (worker) => {
        const message = once(worker, 'message');
        const exited = once(worker, 'exit');
        worker.send('go');
        const [result] = await message;
        await exited;
        return result as { committed: boolean };
      });
      expect((await Promise.all(results)).filter((result) => result.committed)).toHaveLength(1);
      expect((await store.read('run-1'))!.revision).toBe(2);
    } finally {
      for (const worker of workers) worker.kill();
    }
  });

  it.each(['before', 'after'])('recovers a writer killed %s atomic publication', async (mode) => {
    const rootDir = path.join(root, 'store');
    const bundle = await bundleStore(root);
    const store = createFileRuntimeStore<RecordValue>({ rootDir });
    await store.compareAndSwap('run-1', null, {
      runId: 'run-1',
      revision: 1,
      state: { message: 'ready' },
    });
    const worker = await startWorker(bundle, rootDir, mode, 'next');
    const stopped = once(worker, 'message');
    worker.send('go');
    await stopped;
    const exited = once(worker, 'exit');
    worker.kill('SIGKILL');
    await exited;
    const reopened = createFileRuntimeStore<RecordValue>({ rootDir });
    const recovered = (await reopened.read('run-1'))!;
    expect(recovered.revision).toBe(mode === 'before' ? 1 : 2);
    expect(recovered.state.message).toBe(mode === 'before' ? 'ready' : 'next');
    const runDir = path.join(rootDir, (await fs.readdir(rootDir))[0]);
    const abandoned = (await fs.readdir(runDir)).filter((name) => name.endsWith('.tmp'));
    expect(abandoned.length).toBeGreaterThan(0);
    expect(
      await reopened.compareAndSwap('run-1', recovered.revision, {
        ...recovered,
        revision: recovered.revision + 1,
      }),
    ).toBe(true);
    for (const temporary of abandoned)
      await expect(fs.stat(path.join(runDir, temporary))).resolves.toBeDefined();
  });
});

async function bundleStore(root: string): Promise<string> {
  const outfile = path.join(root, 'store.mjs');
  await build({
    entryPoints: [path.resolve('domains/engine/runtime-store.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  });
  return outfile;
}

async function startWorker(
  bundle: string,
  rootDir: string,
  mode: string,
  label: string,
): Promise<ChildProcess> {
  const script = `
    import { promises as fs } from 'node:fs';
    import { pathToFileURL } from 'node:url';
    const [bundle, rootDir, mode, label] = process.argv.slice(1);
    const { createFileRuntimeStore } = await import(pathToFileURL(bundle).href);
    if (mode !== 'normal') {
      const link = fs.link.bind(fs);
      fs.link = async (...args) => {
        if (mode === 'after') await link(...args);
        process.send({ checkpoint: mode });
        await new Promise(() => {});
      };
    }
    process.send({ ready: true });
    await new Promise((resolve) => process.once('message', resolve));
    const committed = await createFileRuntimeStore({ rootDir }).compareAndSwap('run-1', 1, {
      runId: 'run-1', revision: 2, state: { message: label },
    });
    process.send({ committed });
    process.disconnect();
  `;
  const worker = spawn(
    process.execPath,
    ['--input-type=module', '-e', script, bundle, rootDir, mode, label],
    {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
    },
  );
  let stderr = '';
  worker.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });
  await new Promise<void>((resolve, reject) => {
    worker.once('message', () => resolve());
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(stderr || `Runtime worker exited ${code}`));
    });
  });
  return worker;
}
