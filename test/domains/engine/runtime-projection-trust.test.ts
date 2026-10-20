import { expect, test } from 'vitest';
import {
  createRuntime,
  createMemoryRuntimeStore,
  readRuntimeProjection,
  queryRuntimeProjection,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { encodeJsonValueMaps, decodeJsonValueMaps } from '../../../platform/fs/json-value-pool.js';

test('已登记的池化投影不可修改，外部访问器和 Proxy 仍被拒绝', async () => {
  const memory = createMemoryRuntimeStore<WorkflowRun>();
  const runtime = createRuntime({
    store: memory,
    workflows: [
      {
        id: 'trust',
        version: '1',
        entry: 'a',
        steps: {
          a: { type: 'call_tool', ref: 'tool' },
          b: { type: 'call_tool', ref: 'tool' },
        },
        transitions: [{ from: 'a', to: 'b' }],
      },
    ],
    executors: [
      {
        id: 'tool',
        supports: () => true,
        execute: async () => ({
          status: 'succeeded',
          output: { text: 'original' },
        }),
      },
    ],
  });
  const started = await runtime.start({
    runId: 'trust',
    workflow: { id: 'trust', version: '1' },
    input: null,
  });
  const full = await runtime.execute({
    runId: 'trust',
    actionId: started.actions[0].id,
    executorId: 'tool',
  });
  const encoded = encodeJsonValueMaps(full, [
    ...full.actions.map((_, i) => ({
      path: ['actions', String(i), 'input', 'outputs'],
      group: 'outputs',
    })),
    { path: ['outputs'], group: 'results' },
  ]);
  const record = decodeJsonValueMaps(encoded.record, encoded.pool, false);
  const makeStore = (value: WorkflowRun) => ({
    read: async () => value,
    readProjection: async () => value,
    compareAndSwap: async () => false,
  });
  const projection = await readRuntimeProjection(makeStore(record), 'trust');
  const before = projection.hash();
  let getterCalls = 0;
  expect(() =>
    Object.defineProperty(record, 'input', {
      enumerable: true,
      get() {
        getterCalls++;
        return null;
      },
    }),
  ).toThrow();
  expect(() => Object.defineProperty(record, 'state', { value: new Proxy({}, {}) })).toThrow();
  const result = Object.values(projection.run.outputs)[0];
  expect(() => {
    result.sequence = -1;
  }).toThrow();
  expect(() =>
    Object.defineProperty(result, 'value', {
      get() {
        getterCalls++;
        return null;
      },
    }),
  ).toThrow();
  expect((await readRuntimeProjection(makeStore(record), 'trust')).hash()).toBe(before);
  const external = { ...full };
  Object.defineProperty(external, 'input', {
    enumerable: true,
    get() {
      getterCalls++;
      return null;
    },
  });
  for (const value of [external, new Proxy(full, {}), { ...projection.run }])
    await expect(readRuntimeProjection(makeStore(value), 'trust')).rejects.toMatchObject({
      code: 'INVALID_JSON',
    });
  const tampered = structuredClone(full);
  tampered.actions[0].input = { changed: true };
  await expect(readRuntimeProjection(makeStore(tampered), 'trust')).rejects.toMatchObject({
    code: 'INVALID_RUN',
  });
  const owned = decodeJsonValueMaps(encoded.record, encoded.pool);
  owned.input = { owned: true };
  expect(Object.isFrozen(owned)).toBe(false);
  expect(projection.hash()).toBe(before);
  expect(getterCalls).toBe(0);
});

test('标准化投影和查询句柄保持不可变，普通 Store 对象先隔离再冻结', async () => {
  const memory = createMemoryRuntimeStore<WorkflowRun>();
  const runtime = createRuntime({
    store: memory,
    workflows: [
      {
        id: 'freeze',
        version: '1',
        entry: 'a',
        steps: { a: { type: 'call_tool', ref: 'tool' }, b: { type: 'call_tool', ref: 'tool' } },
        transitions: [{ from: 'a', to: 'b' }],
      },
    ],
    executors: [
      {
        id: 'tool',
        supports: () => true,
        execute: async () => ({ status: 'succeeded', output: { text: 'result' } }),
      },
    ],
  });
  const started = await runtime.start({
    runId: 'freeze',
    workflow: { id: 'freeze', version: '1' },
    input: { topic: 'original' },
  });
  const full = await runtime.execute({
    runId: 'freeze',
    actionId: started.actions[0].id,
    executorId: 'tool',
  });
  const encoded = encodeJsonValueMaps(full, [
    ...full.actions.map((_, i) => ({
      path: ['actions', String(i), 'input', 'outputs'],
      group: 'outputs',
    })),
    { path: ['outputs'], group: 'results' },
  ]);
  const cases: string[] = [];
  let getterCalls = 0;
  for (const [kind, record] of [
    ['pooled', decodeJsonValueMaps(encoded.record, encoded.pool, false)],
    ['plain', full],
  ] as const) {
    const p = await readRuntimeProjection(
        {
          read: async () => record,
          readProjection: async () => record,
          compareAndSwap: async () => false,
        },
        'freeze',
      ),
      hash = p.hash(),
      current = JSON.stringify(queryRuntimeProjection(p, { view: 'current' }));
    const attacks: [string, () => unknown][] = [
      ['actions.push', () => p.run.actions.push({ ...p.run.actions[0], id: 'injected' })],
      [
        'run.status',
        () => {
          p.run.status = 'failed';
        },
      ],
      [
        'run getter',
        () =>
          Object.defineProperty(p.run, 'input', {
            get() {
              getterCalls++;
              return null;
            },
          }),
      ],
      [
        'run workflow identity',
        () => {
          p.run.workflow.id = 'foreign';
        },
      ],
      [
        'handle.run',
        () => Object.defineProperty(p, 'run', { value: { ...p.run, status: 'failed' } }),
      ],
      ['handle.scope', () => Object.defineProperty(p, 'scope', { value: 'foreign' })],
    ];
    for (const [name, attack] of attacks) {
      let blocked = false;
      try {
        attack();
      } catch {
        blocked = true;
      }
      if (!blocked) throw Error(kind + ' ' + name + ' allowed');
      cases.push(kind + ':' + name);
    }
    if (
      p.hash() !== hash ||
      JSON.stringify(queryRuntimeProjection(p, { view: 'current' })) !== current
    )
      throw Error('view changed');
    if (kind === 'plain') {
      if (Object.isFrozen(full) || Object.isFrozen(full.input))
        throw Error('caller owned input frozen');
      (full.input as { topic: string }).topic = 'caller change';
      full.actions.push({ ...full.actions[0] });
      if (p.hash() !== hash || (p.record.input as { topic: string }).topic !== 'original')
        throw Error('caller mutation leaked into owned projection');
    }
    const materialized = p.materialize() as WorkflowRun;
    if (Object.isFrozen(materialized)) throw Error('materialize copy frozen');
    materialized.status = 'failed';
    if (p.hash() !== hash) throw Error('materialize changed projection');
  }
  if (getterCalls) throw Error('getter executed');
  expect(cases).toHaveLength(12);
});
