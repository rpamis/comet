import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from 'vitest';
import {
  encodeJsonValueMaps,
  readJsonValueMapProjection,
  decodeJsonValueMaps,
  hashJsonValueProjection,
  getJsonValueProjectionStats,
  freezeJsonValueProjection,
} from '../../../platform/fs/json-value-pool.js';
import { hashRuntimeValue } from '../../../domains/engine/runtime-json.js';
import {
  createRuntime,
  createMemoryRuntimeStore,
  createFileRuntimeStore,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import {
  readRuntimeProjection,
  queryRuntimeProjection,
} from '../../../domains/engine/runtime-compact-query.js';
test('persistent trees validate references and materialize only selected accumulated maps', () => {
  const record = {
    items: Array.from({ length: 100 }, (_, i) => ({
      outputs: Object.fromEntries(
        Array.from({ length: i }, (_, j) => [
          'key' + String(j).padStart(3, '0'),
          { sequence: j + 1, value: 'x'.repeat(100) },
        ]),
      ),
    })),
  };
  const paths = record.items.map((_, i) => ({
    path: ['items', String(i), 'outputs'],
    group: 'outputs',
  }));
  const encoded = encodeJsonValueMaps(record, paths);
  expect(encoded.pool?.version).toBe(3);
  const projection = readJsonValueMapProjection(encoded.record, encoded.pool);
  expect(projection.stats.materializedEntries).toBe(0);
  expect(projection.materialize(['items', '99'])).toEqual(record.items[99]);
  expect(projection.stats.materializedEntries).toBe(99);
  expect(projection.hash()).toBe(hashRuntimeValue(record));
  expect(decodeJsonValueMaps(encoded.record, encoded.pool)).toEqual(record);
  const broken = structuredClone(encoded.pool!);
  (broken.nodes[0] as { left: number | null }).left = 0;
  expect(() => readJsonValueMapProjection(encoded.record, broken)).toThrow();
});
test('hash prefix reuse counts actual hashing separately from logical data', () => {
  const record = {
    items: Array.from({ length: 40 }, (_, i) => ({
      outputs: Object.fromEntries(
        Array.from({ length: i }, (_, j) => ['step' + String(j).padStart(3, '0'), 'x'.repeat(100)]),
      ),
    })),
  };
  const encoded = encodeJsonValueMaps(
    record,
    record.items.map((_, i) => ({ path: ['items', String(i), 'outputs'], group: 'outputs' })),
  );
  const projection = readJsonValueMapProjection(encoded.record, encoded.pool);
  for (const item of projection.value.items)
    expect(hashJsonValueProjection(item)).toBe(
      hashRuntimeValue(record.items[projection.value.items.indexOf(item)]),
    );
  expect(projection.stats.hashBytes).toBeLessThan(projection.stats.logicalHashBytes / 2);
});
test('only decoded frozen child projections retain trust after envelope extraction', () => {
  const record = { run: { outputs: { result: { text: 'retained' } } } };
  const encoded = encodeJsonValueMaps(record, [{ path: ['run', 'outputs'], group: 'outputs' }]);
  const projection = readJsonValueMapProjection(encoded.record, encoded.pool);
  expect(getJsonValueProjectionStats(projection.value.run)).toBe(projection.stats);
  expect(Object.isFrozen(projection.value.run)).toBe(true);
  expect(() => {
    projection.value.run.outputs.result.text = 'changed';
  }).toThrow();
  expect(projection.stats.materializedEntries).toBe(0);
  expect(
    getJsonValueProjectionStats(freezeJsonValueProjection({ ...projection.value.run })),
  ).toBeUndefined();
  expect(getJsonValueProjectionStats(freezeJsonValueProjection(record.run))).toBeUndefined();
});
test('one-shot projection hashes preserve canonical bytes without retaining prefix caches', () => {
  const map = JSON.parse('{"10":"ten","2":"two","__proto__":{"safe":true},"雪":"\\"\\n"}');
  const record = { items: Array.from({ length: 4 }, () => ({ outputs: map })) };
  const encoded = encodeJsonValueMaps(
    record,
    record.items.map((_, i) => ({ path: ['items', String(i), 'outputs'], group: 'outputs' })),
  );
  const projection = readJsonValueMapProjection(encoded.record, encoded.pool);
  const expected = hashRuntimeValue(record);
  expect(hashJsonValueProjection(projection.value, { cachePrefixes: false })).toBe(expected);
  const bytes = projection.stats.hashBytes;
  expect(bytes).toBe(projection.stats.logicalHashBytes);
  expect(hashJsonValueProjection(projection.value, { cachePrefixes: false })).toBe(expected);
  expect(projection.stats.hashBytes).toBe(bytes * 2);
  expect(projection.hash()).toBe(expected);
  expect(projection.stats.hashBytes).toBe(bytes * 3);
  expect(projection.hash()).toBe(expected);
  expect(projection.stats.hashBytes).toBe(bytes * 3);
  expect(hashJsonValueProjection(projection.value, { cachePrefixes: false })).toBe(expected);
  expect(projection.stats.hashBytes).toBe(bytes * 4);
  expect(projection.stats.materializedMaps).toBe(0);
});
test('runtime query keeps all parallel actions and binds cursors to store and revision', async () => {
  const store = createMemoryRuntimeStore<WorkflowRun>();
  const runtime = createRuntime({
    store,
    workflows: [
      {
        id: 'q',
        version: '1',
        entry: 'a',
        steps: {
          a: { type: 'call_tool', ref: 'a' },
          b: { type: 'call_tool', ref: 'b' },
          c: { type: 'call_tool', ref: 'c' },
        },
        transitions: [
          { from: 'a', to: 'b' },
          { from: 'a', to: 'c' },
        ],
      },
    ],
    executors: [
      {
        id: 'host',
        supports: () => true,
        execute: async () => ({ status: 'succeeded', output: 'ok' }),
      },
    ],
  });
  const started = await runtime.start({
    runId: 'q',
    workflow: { id: 'q', version: '1' },
    input: null,
  });
  await runtime.execute({ runId: 'q', actionId: started.actions[0].id, executorId: 'host' });
  const projection = await readRuntimeProjection(store, 'q');
  const current = queryRuntimeProjection(projection, { view: 'current' }) as { actions: unknown[] };
  expect(current.actions).toHaveLength(2);
  const first = queryRuntimeProjection(projection, { view: 'history', limit: 1 }) as {
    nextCursor: string;
    records: unknown[];
  };
  expect(first.records).toHaveLength(1);
  expect(() =>
    queryRuntimeProjection(
      { ...projection, scope: 'other' },
      { view: 'history', cursor: first.nextCursor },
    ),
  ).toThrow();
  expect(() =>
    queryRuntimeProjection(projection, {
      view: 'history',
      cursor: first.nextCursor,
      filter: 'actions',
    }),
  ).toThrow();
  expect(() => queryRuntimeProjection(projection, { view: 'history', limit: 101 })).toThrow();
  expect(() =>
    queryRuntimeProjection(projection, { view: 'artifact', actionId: 'foreign' }),
  ).toThrow();
});
test('cold compact Run validates historical inputs without materializing them', async () => {
  const count = 50;
  const definition = {
    id: 'chain',
    version: '1',
    entry: 'step-00',
    steps: Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        'step-' + String(i).padStart(2, '0'),
        { type: 'call_tool', ref: 'tool' },
      ]),
    ),
    transitions: Array.from({ length: count - 1 }, (_, i) => ({
      from: 'step-' + String(i).padStart(2, '0'),
      to: 'step-' + String(i + 1).padStart(2, '0'),
    })),
  };
  const memory = createMemoryRuntimeStore<WorkflowRun>();
  const runtime = createRuntime({
    store: memory,
    workflows: [definition],
    executors: [
      {
        id: 'tool',
        supports: () => true,
        execute: async () => ({ status: 'succeeded', output: { text: 'x'.repeat(1000) } }),
      },
    ],
  });
  let run = await runtime.start({
    runId: 'chain',
    workflow: { id: 'chain', version: '1' },
    input: null,
  });
  for (let i = 0; i < count - 1; i++)
    run = await runtime.execute({
      runId: 'chain',
      actionId: run.actions.at(-1)!.id,
      executorId: 'tool',
    });
  const paths = [
    ...run.actions.map((_, i) => ({
      path: ['actions', String(i), 'input', 'outputs'],
      group: 'outputs',
    })),
    ...Object.keys(run.actionContexts).map((id) => ({
      path: ['actionContexts', id, 'results'],
      group: 'results',
    })),
    { path: ['outputs'], group: 'results' },
  ];
  const encoded = encodeJsonValueMaps(run, paths);
  const decoded = readJsonValueMapProjection(encoded.record, encoded.pool);
  const store = {
    queryScope: 'cold',
    read: async () => {
      throw new Error('不应完整读取');
    },
    readProjection: async () => decoded.value,
    compareAndSwap: async () => false,
  };
  const projection = await readRuntimeProjection(store, 'chain');
  expect(projection.stats!.materializedEntries).toBe(0);
  const current = queryRuntimeProjection(projection, { view: 'current' }) as { actions: unknown[] };
  expect(current.actions).toHaveLength(1);
  expect(projection.stats!.materializedEntries).toBe((count - 1) * 2);
  expect(projection.hash()).toBe(hashRuntimeValue(run));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-cold-query-'));
  try {
    const fileStore = createFileRuntimeStore<WorkflowRun>({ rootDir: directory });
    await fileStore.restoreCheckpoint!('chain', null, run);
    const cold = await readRuntimeProjection(fileStore, 'chain');
    expect(cold.stats?.validationMaterializedEntries).toBe(0);
    expect(queryRuntimeProjection(cold, { view: 'current' })).toEqual(current);
    expect(cold.stats?.materializedEntries).toBe((count - 1) * 2);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }

  const tampered = structuredClone(encoded);
  tampered.pool!.values[0] = 'tampered';
  const corrupt = readJsonValueMapProjection(tampered.record, tampered.pool);
  await expect(
    readRuntimeProjection({ ...store, readProjection: async () => corrupt.value }, 'chain'),
  ).rejects.toThrow();
});
