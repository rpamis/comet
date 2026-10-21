import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jsonPool from '../../../platform/fs/json-value-pool.js';
import * as runtimeJson from '../../../domains/engine/runtime-json.js';
import { createFileRuntimeStore } from '../../../domains/engine/runtime-store.js';
import { runWithHookReadCache } from '../../../platform/process/hook-read-cache.js';
import {
  listFileRuntimeStoreRuns,
  listFileRuntimeStoreRunSources,
} from '../../../domains/engine/runtime-store-discovery.js';

const runId = 'closed-record';
const key = createHash('sha256').update(JSON.stringify(runId)).digest('hex');
const record = { runId, revision: 1, state: { message: 'retained history' } };
let root: string;
const active = () => path.join(root, '.runtime-store-v2', key, 'checkpoint.json');
const history = () => path.join(root, '.runtime-store-history', key, 'checkpoint.json');
const marker = () => path.join(root, key);
const store = () => createFileRuntimeStore<typeof record>({ rootDir: root });
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-store-history-'));
  await store().compareAndSwap(runId, null, record);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe('RuntimeStore single-authority history', () => {
  it('closes and explicitly reopens without changing the Run or revision', async () => {
    const source = await fs.readFile(active(), 'utf8');
    expect(await store().closeRun(runId, 2)).toBe(false);
    expect(await store().readDisposition(runId)).toBe('active');
    expect(await store().closeRun(runId, 1)).toBe(true);
    expect(await fs.readFile(history(), 'utf8')).toBe(source);
    await expect(fs.stat(active())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await store().read(runId)).toEqual(record);
    expect(await store().readDisposition(runId)).toBe('closed');
    expect(await store().closeRun(runId, 1)).toBe(true);
    await expect(
      store().compareAndSwap(runId, 1, { ...record, revision: 2 }),
    ).rejects.toMatchObject({ code: 'STORE_RUN_CLOSED' });
    await expect(
      store().restoreCheckpoint!(runId, 1, { ...record, revision: 2 }),
    ).rejects.toMatchObject({
      code: 'STORE_RUN_CLOSED',
    });
    expect((await listFileRuntimeStoreRuns({ rootDir: root }))[0].record).toEqual(record);
    expect(await store().reopenRun(runId, 2)).toBe(false);
    expect(await store().reopenRun(runId, 1)).toBe(true);
    expect(await store().reopenRun(runId, 1)).toBe(true);
    expect(await fs.readFile(active(), 'utf8')).toBe(source);
    expect(await store().readDisposition(runId)).toBe('active');
    expect(await store().compareAndSwap(runId, 1, { ...record, revision: 2 })).toBe(true);
  });

  it.each(['close', 'reopen'] as const)(
    '%s resumes after exclusive link publication is interrupted',
    async (direction) => {
      if (direction === 'reopen') await store().closeRun(runId, 1);
      const original = fs.link.bind(fs);
      const target = direction === 'close' ? history() : active();
      vi.spyOn(fs, 'link').mockImplementation(async (source, destination) => {
        await original(source, destination);
        if (destination === target) throw new Error('injected after link');
      });
      const transition = () =>
        direction === 'close' ? store().closeRun(runId, 1) : store().reopenRun(runId, 1);
      await expect(transition()).rejects.toThrow('injected');
      vi.restoreAllMocks();
      expect(await store().read(runId)).toEqual(record);
      expect(await store().readDisposition(runId)).toBe(
        direction === 'close' ? 'closing' : 'reopening',
      );
      expect((await fs.stat(active())).ino).toBe((await fs.stat(history())).ino);
      expect(await transition()).toBe(true);
      expect(await store().readDisposition(runId)).toBe(
        direction === 'close' ? 'closed' : 'active',
      );
    },
  );

  it.each(['close', 'reopen'] as const)(
    '%s resumes after unlink and before final marker',
    async (direction) => {
      if (direction === 'reopen') await store().closeRun(runId, 1);
      const original = fs.unlink.bind(fs);
      const target = direction === 'close' ? active() : history();
      vi.spyOn(fs, 'unlink').mockImplementation(async (file) => {
        await original(file);
        if (file === target) throw new Error('injected after unlink');
      });
      const transition = () =>
        direction === 'close' ? store().closeRun(runId, 1) : store().reopenRun(runId, 1);
      await expect(transition()).rejects.toThrow('injected');
      vi.restoreAllMocks();
      expect(await store().read(runId)).toEqual(record);
      expect(await transition()).toBe(true);
    },
  );

  it('rejects an independent duplicate even with identical bytes and retains both', async () => {
    const original = fs.link.bind(fs);
    vi.spyOn(fs, 'link').mockImplementation(async (source, destination) => {
      if (destination === history()) {
        await fs.copyFile(source, destination);
        throw new Error('interrupted');
      }
      await original(source, destination);
    });
    await expect(store().closeRun(runId, 1)).rejects.toThrow('interrupted');
    vi.restoreAllMocks();
    await expect(store().read(runId)).rejects.toMatchObject({ code: 'STORE_HISTORY_CONFLICT' });
    await expect(store().closeRun(runId, 1)).rejects.toMatchObject({
      code: 'STORE_HISTORY_CONFLICT',
    });
    expect(await fs.readFile(active(), 'utf8')).toBe(await fs.readFile(history(), 'utf8'));
  });

  it('validates closed contents and never falls back to an active checkpoint', async () => {
    await store().closeRun(runId, 1);
    const source = await fs.readFile(history(), 'utf8');
    await fs.writeFile(history(), source.replace('retained history', 'altered history'));
    await expect(store().read(runId)).rejects.toMatchObject({ code: 'STORE_CORRUPT_RECORD' });
    await fs.writeFile(history(), source);
    await fs.rename(history(), active());
    await expect(store().read(runId)).rejects.toMatchObject({ code: 'STORE_HISTORY_CONFLICT' });
  });

  it('pins the close revision and publishes an unsupported-by-v2 write fence', async () => {
    await store().compareAndSwap(runId, 1, { ...record, revision: 2 });
    expect(await store().closeRun(runId, 1)).toBe(false);
    expect(await store().closeRun(runId, 2)).toBe(true);
    expect(JSON.parse(await fs.readFile(marker(), 'utf8'))).toMatchObject({
      schema: 'comet.runtime-store-format.v3',
      state: 'closed',
      revision: 2,
    });
  });
});

it('metadata discovery never opens closed checkpoint contents but validates conflicts', async () => {
  await store().closeRun(runId, 1);
  const opens = vi.spyOn(fs, 'open');
  expect(await store().readPartitionMetadata(runId)).toBe('closed');
  expect(
    opens.mock.calls.filter(([file]) => String(file).endsWith('checkpoint.json')),
  ).toHaveLength(0);
  await fs.copyFile(history(), active());
  await expect(store().readPartitionMetadata(runId)).rejects.toMatchObject({
    code: 'STORE_HISTORY_CONFLICT',
  });
});

it('lifecycle mutation does not inherit a caller decision snapshot', async () => {
  await runWithHookReadCache(async () => {
    await store().read(runId);
    expect(await store().closeRun(runId, 1)).toBe(true);
    expect(await store().reopenRun(runId, 1)).toBe(true);
  });
  expect(await store().read(runId)).toEqual(record);
});

it.each(['close', 'reopen'] as const)(
  '%s keeps a recoverable fence if initial journal publication is interrupted',
  async (direction) => {
    if (direction === 'reopen') await store().closeRun(runId, 1);
    const original = fs.rename.bind(fs);
    const state = direction === 'close' ? 'closing' : 'reopening';
    vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      const journal =
        destination === marker() ? JSON.parse(await fs.readFile(source, 'utf8')) : null;
      await original(source, destination);
      if (journal?.state === state) throw new Error('injected after journal');
    });
    const transition = () =>
      direction === 'close' ? store().closeRun(runId, 1) : store().reopenRun(runId, 1);
    await expect(transition()).rejects.toThrow('injected');
    vi.restoreAllMocks();
    expect(await store().readPartitionMetadata(runId)).toBe(state);
    expect(await store().read(runId)).toEqual(record);
    if (direction === 'close') {
      await expect(
        store().compareAndSwap(runId, 1, { ...record, revision: 2 }),
      ).rejects.toMatchObject({ code: 'STORE_RUN_CLOSED' });
      expect(await transition()).toBe(true);
    } else {
      expect(await store().compareAndSwap(runId, 1, { ...record, revision: 2 })).toBe(true);
      expect(await store().readDisposition(runId)).toBe('active');
      expect(await store().read(runId)).toEqual({ ...record, revision: 2 });
    }
  },
);

it('does not remove a replaced source after link publication', async () => {
  const original = fs.link.bind(fs);
  vi.spyOn(fs, 'link').mockImplementation(async (source, destination) => {
    await original(source, destination);
    if (destination === history()) {
      const bytes = await fs.readFile(source);
      await fs.unlink(source);
      await fs.writeFile(source, bytes);
    }
  });
  await expect(store().closeRun(runId, 1)).rejects.toMatchObject({
    code: 'STORE_HISTORY_CONFLICT',
  });
  expect(await fs.stat(active())).toBeDefined();
  expect(await fs.stat(history())).toBeDefined();
});

it('rejects symlink history and absent checkpoint without reopening authority', async () => {
  await store().closeRun(runId, 1);
  const saved = path.join(root, 'saved-checkpoint');
  await fs.rename(history(), saved);
  await expect(store().read(runId)).rejects.toMatchObject({ code: 'STORE_HISTORY_CONFLICT' });
  await fs.symlink(saved, history());
  await expect(store().readPartitionMetadata(runId)).rejects.toThrow(/symbolic link/u);
  await expect(store().read(runId)).rejects.toThrow();
});

it.each(['close', 'reopen'] as const)(
  '%s tolerates an interrupted final marker commit',
  async (direction) => {
    if (direction === 'reopen') await store().closeRun(runId, 1);
    const original = fs.rename.bind(fs);
    const finalState = direction === 'close' ? 'closed' : 'ready';
    vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      const journal =
        destination === marker() ? JSON.parse(await fs.readFile(source, 'utf8')) : null;
      await original(source, destination);
      if (journal?.state === finalState) throw new Error('injected after final marker');
    });
    const transition = () =>
      direction === 'close' ? store().closeRun(runId, 1) : store().reopenRun(runId, 1);
    await expect(transition()).rejects.toThrow('injected');
    vi.restoreAllMocks();
    expect(await store().read(runId)).toEqual(record);
    expect(await transition()).toBe(true);
  },
);

it('keeps legacy reads non-mutating and migrates only on an explicit close', async () => {
  const legacyId = 'legacy-history';
  const legacyKey = createHash('sha256').update(JSON.stringify(legacyId)).digest('hex');
  const directory = path.join(root, legacyKey);
  await fs.mkdir(directory);
  const previous = { ...record, runId: legacyId };
  await fs.writeFile(path.join(directory, '0000000000000001.json'), JSON.stringify(previous));
  expect(await store().read(legacyId)).toEqual(previous);
  expect((await fs.stat(directory)).isDirectory()).toBe(true);
  expect(await store().closeRun(legacyId, 1)).toBe(true);
  expect(await store().read(legacyId)).toEqual(previous);
  expect(await store().readDisposition(legacyId)).toBe('closed');
});

it('checks mirrored revision and unknown journal fields in closed history', async () => {
  const mirrored = createFileRuntimeStore({
    rootDir: root,
    mirroredRevisionPaths: ['run.revision'],
  });
  const nested = { runId: 'nested-history', revision: 1, run: { revision: 1 } };
  await mirrored.compareAndSwap(nested.runId, null, nested);
  await mirrored.closeRun(nested.runId, 1);
  expect(await mirrored.read(nested.runId)).toEqual(nested);
  const nestedKey = createHash('sha256').update(JSON.stringify(nested.runId)).digest('hex');
  const file = path.join(root, nestedKey);
  const journal = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify({ ...journal, ignored: true }));
  await expect(mirrored.readPartitionMetadata(nested.runId)).rejects.toMatchObject({
    code: 'STORE_CORRUPT_RECORD',
  });
});

it('discovery fingerprints include closed checkpoint changes and full reads reject corruption', async () => {
  await store().closeRun(runId, 1);
  const before = await listFileRuntimeStoreRunSources({ rootDir: root });
  await fs.appendFile(history(), 'broken');
  const after = await listFileRuntimeStoreRunSources({ rootDir: root });
  expect(after[0].fingerprint).not.toBe(before[0].fingerprint);
  expect((await listFileRuntimeStoreRuns({ rootDir: root }))[0].error).not.toBeNull();
});

it.each(['close', 'reopen'] as const)(
  'settles %s before an opposite transition with a stale revision',
  async (direction) => {
    if (direction === 'reopen') await store().closeRun(runId, 1);
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      const value = destination === marker() ? JSON.parse(await fs.readFile(source, 'utf8')) : null;
      await rename(source, destination);
      if (value?.state === (direction === 'close' ? 'closing' : 'reopening'))
        throw new Error('after journal');
    });
    await expect(
      direction === 'close' ? store().closeRun(runId, 1) : store().reopenRun(runId, 1),
    ).rejects.toThrow('after journal');
    vi.restoreAllMocks();
    const opposite = (revision: number) =>
      direction === 'close'
        ? store().reopenRun(runId, revision)
        : store().closeRun(runId, revision);
    expect(await opposite(2)).toBe(false);
    expect(await store().readPartitionMetadata(runId)).toBe(
      direction === 'close' ? 'closed' : 'active',
    );
    expect(await opposite(1)).toBe(true);
    expect(await store().read(runId)).toEqual(record);
  },
);

function pooledHistoryRecord() {
  const outputs = Object.fromEntries(
    Array.from({ length: 16 }, (_, i) => [String(i), { text: `${i}:雪\\"${'x'.repeat(2000)}` }]),
  );
  return {
    runId,
    revision: 2,
    protocolVersion: 1,
    actions: Array.from({ length: 16 }, () => ({ input: { outputs } })),
    actionContexts: {},
    outputs,
  };
}

it('keeps closed projections compact and immutable while public reads remain independent', async () => {
  const input = pooledHistoryRecord();
  const pooled = createFileRuntimeStore<typeof input>({ rootDir: root });
  await pooled.compareAndSwap(runId, 1, input);
  const canonicalHash = runtimeJson.hashRuntimeValue(input);
  const decode = vi.spyOn(jsonPool, 'decodeJsonValueMaps');
  const fullHash = vi.spyOn(runtimeJson, 'hashRuntimeValue');
  expect(await pooled.closeRun(runId, 2)).toBe(true);
  expect(JSON.parse(await fs.readFile(marker(), 'utf8')).recordHash).toBe(canonicalHash);
  expect(await pooled.readDisposition(runId)).toBe('closed');
  const projection = (await pooled.readProjection!(runId))!;
  const stats = jsonPool.getJsonValueProjectionStats(projection)!;
  expect(stats).toBeDefined();
  expect(stats.materializedMaps).toBe(0);
  expect(stats.materializedEntries).toBe(0);
  expect(jsonPool.hashJsonValueProjection(projection)).toBe(canonicalHash);
  expect(decode.mock.calls.every((call) => call[2] === false)).toBe(true);
  expect(
    fullHash.mock.calls.filter(([value]) => (value as typeof input)?.runId === runId),
  ).toHaveLength(0);
  expect(() => {
    projection.actions[0].input.outputs['0'].text = 'mutated';
  }).toThrow();
  expect(() => {
    projection.actions[0].input.outputs['0'] = { text: 'mutated' };
  }).toThrow();
  expect(() => {
    projection.actions.pop();
  }).toThrow();
  const publicRecord = (await pooled.read(runId))!;
  expect(publicRecord).toEqual(input);
  publicRecord.actions[0].input.outputs['0'].text = 'caller mutation';
  expect(publicRecord.actions[1].input.outputs['0'].text).toBe(input.outputs['0'].text);
  expect((await pooled.readProjection!(runId))!.outputs['0'].text).toBe(input.outputs['0'].text);
});

it.each([
  ['close', 'journal'],
  ['close', 'link'],
  ['close', 'unlink'],
  ['reopen', 'journal'],
  ['reopen', 'link'],
  ['reopen', 'unlink'],
] as const)(
  'queries and settles compact %s history interrupted after %s',
  async (direction, stage) => {
    const input = pooledHistoryRecord();
    const pooled = createFileRuntimeStore<typeof input>({ rootDir: root });
    await pooled.compareAndSwap(runId, 1, input);
    if (direction === 'reopen') await pooled.closeRun(runId, 2);
    const rename = fs.rename.bind(fs),
      link = fs.link.bind(fs),
      unlink = fs.unlink.bind(fs);
    const pending = direction === 'close' ? 'closing' : 'reopening';
    vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      const value = destination === marker() ? JSON.parse(await fs.readFile(source, 'utf8')) : null;
      await rename(source, destination);
      if (stage === 'journal' && value?.state === pending)
        throw new Error('injected compact interruption');
    });
    vi.spyOn(fs, 'link').mockImplementation(async (source, destination) => {
      await link(source, destination);
      if (stage === 'link' && destination === (direction === 'close' ? history() : active()))
        throw new Error('injected compact interruption');
    });
    vi.spyOn(fs, 'unlink').mockImplementation(async (source) => {
      await unlink(source);
      if (stage === 'unlink' && source === (direction === 'close' ? active() : history()))
        throw new Error('injected compact interruption');
    });
    await expect(
      direction === 'close' ? pooled.closeRun(runId, 2) : pooled.reopenRun(runId, 2),
    ).rejects.toThrow('injected compact interruption');
    vi.restoreAllMocks();
    const decode = vi.spyOn(jsonPool, 'decodeJsonValueMaps');
    const projection = (await pooled.readProjection!(runId))!;
    expect(jsonPool.getJsonValueProjectionStats(projection)?.materializedMaps).toBe(0);
    expect(jsonPool.hashJsonValueProjection(projection)).toBe(runtimeJson.hashRuntimeValue(input));
    expect(await pooled.settleRun(runId)).toBe(direction === 'close' ? 'closed' : 'active');
    expect(decode.mock.calls.every((call) => call[2] === false)).toBe(true);
    expect(
      jsonPool.getJsonValueProjectionStats((await pooled.readProjection!(runId))!)
        ?.materializedMaps,
    ).toBe(0);
  },
);

it.each(['hash', 'revision', 'duplicate'] as const)(
  'rejects compact lifecycle %s conflicts without materialization',
  async (conflict) => {
    const input = pooledHistoryRecord();
    const pooled = createFileRuntimeStore<typeof input>({ rootDir: root });
    await pooled.compareAndSwap(runId, 1, input);
    await pooled.closeRun(runId, 2);
    const journal = JSON.parse(await fs.readFile(marker(), 'utf8'));
    if (conflict === 'hash') journal.recordHash = '0'.repeat(64);
    if (conflict === 'revision') journal.revision++;
    if (conflict === 'duplicate') {
      journal.state = 'reopening';
      await fs.copyFile(history(), active());
    }
    await fs.writeFile(marker(), JSON.stringify(journal));
    const decode = vi.spyOn(jsonPool, 'decodeJsonValueMaps');
    await expect(pooled.readProjection!(runId)).rejects.toMatchObject({
      code: 'STORE_HISTORY_CONFLICT',
    });
    expect(decode.mock.calls.every((call) => call[2] === false)).toBe(true);
  },
);
