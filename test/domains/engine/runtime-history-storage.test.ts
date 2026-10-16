import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  createRuntime,
  createMemoryRuntimeStore,
  createFileRuntimeStore,
  createPortableRunCheckpoint,
  encodePortableRunCheckpoint,
  readPortableRunCheckpoint,
  portableRunCheckpointMatches,
} from '../../../domains/engine/runtime.js';

test('reuses a validated snapshot for a single execution while CAS retains concurrency authority', async () => {
  const original =
    createMemoryRuntimeStore<import('../../../domains/engine/runtime.js').WorkflowRun>();
  let reads = 0;
  const store = {
    ...original,
    read: async (id: string) => {
      reads++;
      return original.read(id);
    },
  };
  const runtime = createRuntime({
    store,
    workflows: [
      {
        id: 'one',
        version: '1',
        entry: 'work',
        steps: { work: { type: 'call_tool', ref: 'tool' } },
      },
    ],
    executors: [
      {
        id: 'tool',
        supports: () => true,
        execute: async () => ({ status: 'succeeded', output: null }),
      },
    ],
  });
  const run = await runtime.start({
    runId: 'one',
    workflow: { id: 'one', version: '1' },
    input: null,
  });
  reads = 0;
  expect(
    (await runtime.execute({ runId: 'one', actionId: run.actions[0].id, executorId: 'tool' }))
      .status,
  ).toBe('completed');
  expect(
    reads,
    'an uncontended action should not repeatedly read and validate identical history',
  ).toBe(1);
});

test('stores shared upstream results once while preserving complete action inputs and recovery', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-runtime-history-pool-'));
  const count = 24;
  const definition = {
    id: 'history',
    version: '1',
    entry: 'step-0',
    steps: Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `step-${i}`,
        { type: 'call_tool' as const, ref: 'tool' },
      ]),
    ),
    transitions: Array.from({ length: count - 1 }, (_, i) => ({
      from: `step-${i}`,
      to: `step-${i + 1}`,
    })),
  };
  const memory =
    createMemoryRuntimeStore<import('../../../domains/engine/runtime.js').WorkflowRun>();
  const runtime = createRuntime({
    store: memory,
    workflows: [definition],
    executors: [
      {
        id: 'tool',
        supports: () => true,
        execute: async (action) => ({
          status: 'succeeded',
          output: { summary: `${action.stepId}:${'x'.repeat(1200)}` },
        }),
      },
    ],
  });
  let run = await runtime.start({
    runId: 'history',
    workflow: { id: 'history', version: '1' },
    input: null,
  });
  while (run.status !== 'completed')
    run = await runtime.execute({
      runId: 'history',
      actionId: run.actions.find((action) => action.status === 'pending')!.id,
      executorId: 'tool',
    });
  const store = createFileRuntimeStore<typeof run>({ rootDir: root });
  try {
    expect(await store.restoreCheckpoint!('history', null, run)).toBe(true);
    const [entry] = await fs.readdir(path.join(root, '.runtime-store-v2'));
    const checkpoint = path.join(root, '.runtime-store-v2', entry, 'checkpoint.json');
    expect(
      (await fs.stat(checkpoint)).size,
      'historical upstream results must not be copied into every action',
    ).toBeLessThan(160000);
    const recovered = createRuntime({
      store: createFileRuntimeStore({ rootDir: root }),
      workflows: [definition],
    });
    expect(await recovered.inspect('history')).toEqual(run);
    const portable = createPortableRunCheckpoint(run);
    const encoded = encodePortableRunCheckpoint(portable);
    expect(Buffer.byteLength(JSON.stringify(encoded))).toBeLessThan(160000);
    expect(readPortableRunCheckpoint(encoded, run.runId)).toEqual(portable.run);
    expect(portableRunCheckpointMatches(encoded, portable)).toBe(true);
    expect(portableRunCheckpointMatches(portable, portable)).toBe(true);
    if ('pool' in encoded) {
      const tampered = JSON.parse(JSON.stringify(encoded));
      tampered.pool.maps[0].entries.push(['corrupt', 999999]);
      expect(() => readPortableRunCheckpoint(tampered, run.runId)).toThrow('invalid or changed');
    }
    const changed = await store.read('history');
    (changed!.actions[3].input as { outputs: Record<string, { summary: string }> }).outputs[
      'step-0'
    ].summary = 'changed by caller';
    expect(await recovered.inspect('history')).toEqual(run);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
