import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { build } from 'esbuild';

import {
  createFileRuntimeStore,
  createMemoryRuntimeStore,
} from '../../../domains/engine/runtime-store.js';

function runDirectory(rootDir: string, runId = 'run-1'): string {
  const hash = createHash('sha256').update(JSON.stringify(runId)).digest('hex');
  return path.join(rootDir, '.runtime-store-v2', hash);
}

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

  it('checks CAS revisions without reparsing a previously serialized large snapshot', async () => {
    const store = createMemoryRuntimeStore<RecordValue>();
    const first = { runId: 'large-run', revision: 1, state: { message: 'x'.repeat(1024 * 1024) } };
    await store.compareAndSwap(first.runId, null, first);
    const parse = vi.spyOn(JSON, 'parse');
    let committed: boolean;
    let stale: boolean;
    let parses: number;
    try {
      committed = await store.compareAndSwap(first.runId, 1, { ...first, revision: 2 });
      stale = await store.compareAndSwap(first.runId, 1, { ...first, revision: 2 });
      parses = parse.mock.calls.length;
    } finally {
      parse.mockRestore();
    }
    expect(committed!).toBe(true);
    expect(stale!).toBe(false);
    expect(parses!).toBe(0);
    expect(await store.read(first.runId)).toEqual({ ...first, revision: 2 });
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

  it('validates the serialized identity and revision instead of later proxy property reads', async () => {
    const store = createMemoryRuntimeStore<RecordValue>();
    for (const field of ['runId', 'revision'] as const) {
      const first = { runId: 'run-1', revision: 1, state: { message: 'ready' } };
      const next = new Proxy(
        { ...first, [field]: field === 'runId' ? 'other-run' : 99 },
        {
          get(target, key, receiver) {
            return key === field ? first[field] : Reflect.get(target, key, receiver);
          },
        },
      );
      await expect(store.compareAndSwap('run-1', null, next)).rejects.toThrow(
        /STORE_INVALID_RUN_ID|STORE_INVALID_REVISION/,
      );
      expect(await store.read('run-1')).toBeNull();
    }
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
      const runDir = runDirectory(rootDir);
      const latest = path.join(runDir, 'checkpoint.json');
      if (damage === 'missing') await fs.unlink(latest);
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
    const runDir = runDirectory(rootDir);
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

  it.each(['new', 'legacy'])(
    'has one CAS winner when independent processes publish the same revision (%s)',
    async (layout) => {
      const rootDir = path.join(root, 'store');
      const bundle = await bundleStore(root);
      const store = createFileRuntimeStore<RecordValue>({ rootDir });
      const first = { runId: 'run-1', revision: 1, state: { message: 'ready' } };
      if (layout === 'legacy') {
        const original = path.join(
          rootDir,
          createHash('sha256').update(JSON.stringify(first.runId)).digest('hex'),
        );
        await fs.mkdir(original, { recursive: true });
        await fs.writeFile(path.join(original, '0000000000000001.json'), JSON.stringify(first));
      } else await store.compareAndSwap(first.runId, null, first);
      const workers = await Promise.all(
        ['a', 'b', 'c', 'd'].map((label) => startWorker(bundle, rootDir, 'normal', label)),
      );
      try {
        const results = workers.map(async (worker) => {
          const completed = Promise.all([workerMessage(worker), once(worker, 'exit')]);
          worker.send('go');
          const [[result], [code, signal]] = await completed;
          expect({ code, signal }).toEqual({ code: 0, signal: null });
          return result as { committed: boolean };
        });
        expect((await Promise.all(results)).filter((result) => result.committed)).toHaveLength(1);
        expect((await store.read('run-1'))!.revision).toBe(2);
      } finally {
        for (const worker of workers) worker.kill();
      }
    },
  );

  it('reports a worker CAS failure after readiness instead of waiting for a missing result', async () => {
    const rootDir = path.join(root, 'store');
    const bundle = await bundleStore(root);
    const original = path.join(
      rootDir,
      createHash('sha256').update(JSON.stringify('run-1')).digest('hex'),
    );
    await fs.mkdir(original, { recursive: true });
    await fs.writeFile(path.join(original, '0000000000000001.json'), '{broken');
    const worker = await startWorker(bundle, rootDir, 'normal', 'failed');
    try {
      const completed = Promise.all([workerMessage(worker), once(worker, 'exit')]);
      worker.send('go');
      await expect(completed).rejects.toThrow('版本文件不是有效的 UTF-8 JSON 数据');
    } finally {
      worker.kill();
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
    const stopped = workerMessage(worker);
    worker.send('go');
    await stopped;
    const exited = once(worker, 'exit');
    worker.kill('SIGKILL');
    await exited;
    const reopened = createFileRuntimeStore<RecordValue>({ rootDir });
    const recovered = (await reopened.read('run-1'))!;
    expect(recovered.revision).toBe(mode === 'before' ? 1 : 2);
    expect(recovered.state.message).toBe(mode === 'before' ? 'ready' : 'next');
    const runDir = runDirectory(rootDir);
    const abandoned = (await fs.readdir(runDir)).filter((name) => name.endsWith('.tmp'));
    expect(abandoned.length).toBe(mode === 'before' ? 1 : 0);
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

const workerDiagnostics = new WeakMap<ChildProcess, { stderr: string }>();

function workerMessage(worker: ChildProcess): Promise<[unknown]> {
  return new Promise((resolve, reject) => {
    const failure = (detail: string) => {
      const stderr = workerDiagnostics.get(worker)?.stderr;
      return new Error(`${detail}${stderr ? `\n${stderr}` : ''}`);
    };
    const cleanup = () => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('close', onClose);
    };
    const onMessage = (message: unknown) => {
      cleanup();
      resolve([message]);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(failure(`Runtime worker failed before its expected message: ${error.message}`));
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(failure(`Runtime worker exited ${code ?? signal} before its expected message`));
    };
    if (worker.exitCode !== null || worker.signalCode !== null) {
      onClose(worker.exitCode, worker.signalCode);
      return;
    }
    worker.once('message', onMessage);
    worker.once('error', onError);
    // close 在 stderr 读完后触发，让 CAS 失败保留实际诊断。
    worker.once('close', onClose);
  });
}

async function bundleStore(root: string): Promise<string> {
  const outfile = path.join(root, 'store.mjs');
  await build({
    entryPoints: [path.resolve('domains/engine/runtime-store.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    banner: {
      js: "import { createRequire as __cometCreateRequire } from 'node:module'; const require = __cometCreateRequire(import.meta.url);",
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
import { createHash } from 'node:crypto';
    import { pathToFileURL } from 'node:url';
    const [bundle, rootDir, mode, label] = process.argv.slice(1);
    const { createFileRuntimeStore } = await import(pathToFileURL(bundle).href);
    if (mode !== 'normal') {
      const rename = fs.rename.bind(fs);
      fs.rename = async (...args) => {
        if (!String(args[1]).endsWith('checkpoint.json')) return rename(...args);
        if (mode === 'after') await rename(...args);
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
  const diagnostics = { stderr: '' };
  workerDiagnostics.set(worker, diagnostics);
  worker.stderr?.on('data', (chunk) => {
    diagnostics.stderr = (diagnostics.stderr + String(chunk)).slice(-16 * 1024);
  });
  const [ready] = await workerMessage(worker);
  expect(ready).toEqual({ ready: true });
  return worker;
}
