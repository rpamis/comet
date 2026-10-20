import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { test, expect } from 'vitest';
import {
  createRuntime,
  createFileRuntimeStore,
  hashRuntimeValue,
  readRuntimeProjection,
  queryRuntimeProjection,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
test('逐次冷读取和提交保留紧凑历史树，不把相同累计值重复写入 checkpoint', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-pool-write-regression-'));
  const count = 60,
    id = (i: number) => 'step-' + String(i).padStart(3, '0');
  const workflow = {
    id: 'chain',
    version: '1',
    entry: id(0),
    steps: Object.fromEntries(
      Array.from({ length: count }, (_, i) => [id(i), { type: 'call_tool', ref: 'tool' }]),
    ),
    transitions: Array.from({ length: count - 1 }, (_, i) => ({
      from: id(i),
      to: id(i + 1),
    })),
  };
  const make = () =>
    createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({ rootDir: directory }),
      workflows: [workflow],
      executors: [
        {
          id: 'host',
          supports: () => true,
          execute: async (action) => ({
            status: 'succeeded',
            output: { step: action.stepId, text: 'x'.repeat(1000) },
          }),
        },
      ],
    });
  try {
    let runtime = make(),
      run = await runtime.start({
        runId: 'chain',
        workflow: { id: 'chain', version: '1' },
        input: null,
      });
    const rows = [];
    for (let n = 1; n < count; n++) {
      run = await runtime.execute({
        runId: 'chain',
        actionId: run.actions.at(-1)!.id,
        executorId: 'host',
      });
      if ((n + 1) % 20 === 0) {
        runtime = make();
        const full = await runtime.inspect('chain');
        if (JSON.stringify(full) !== JSON.stringify(run)) throw Error('full original mismatch');
        const projection = await readRuntimeProjection(
          createFileRuntimeStore({ rootDir: directory }),
          'chain',
        );
        if (projection.hash() !== hashRuntimeValue(full)) throw Error('semantic hash mismatch');
        queryRuntimeProjection(projection, { view: 'current' });
        if (projection.stats?.validationMaterializedEntries !== 0)
          throw Error('validation materialized history');
        const file = path.join(
          directory,
          '.runtime-store-v2',
          hashRuntimeValue('chain'),
          'checkpoint.json',
        );
        const text = await fs.readFile(file, 'utf8'),
          checkpoint = JSON.parse(text);
        if (checkpoint.pool.nodes.length > (n + 1) * 25)
          throw Error('persistent nodes exhibit write amplification');
        if (Buffer.byteLength(text) > (n + 1) * 7000)
          throw Error('checkpoint physical write amplification');
        rows.push({
          actions: n + 1,
          nodes: checkpoint.pool.nodes.length,
          bytes: Buffer.byteLength(text),
        });
      }
    }
    const file = path.join(
        directory,
        '.runtime-store-v2',
        hashRuntimeValue('chain'),
        'checkpoint.json',
      ),
      checkpoint = JSON.parse(await fs.readFile(file, 'utf8'));
    checkpoint.pool.nodes[0].value = 999999;
    const { schema, hash, ...payload } = checkpoint;
    checkpoint.hash = hashRuntimeValue(payload);
    await fs.writeFile(file, JSON.stringify(checkpoint));
    let rejected = false;
    try {
      await readRuntimeProjection(createFileRuntimeStore({ rootDir: directory }), 'chain');
    } catch {
      rejected = true;
    }
    if (!rejected) throw Error('corrupt pool accepted');
    expect(rows).toHaveLength(3);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 60000);
