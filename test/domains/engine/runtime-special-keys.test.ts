import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPortableRunCheckpoint,
  encodePortableRunCheckpoint,
  readPortableRunCheckpoint,
} from '../../../domains/engine/portable-run-checkpoint.js';
import { hashRuntimeValue } from '../../../domains/engine/runtime-json.js';
import { createRuntime } from '../../../domains/engine/runtime-service.js';
import {
  createFileRuntimeStore,
  createMemoryRuntimeStore,
  type RuntimeStore,
} from '../../../domains/engine/runtime-store.js';
import type { DefineWorkflowOptions } from '../../../domains/engine/workflow-definition.js';
import {
  parseWorkflowRun,
  parseWorkflowRunSnapshot,
} from '../../../domains/engine/workflow-run-validation.js';
import type { WorkflowRun } from '../../../domains/engine/workflow-run.js';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

async function stores(kind: 'memory' | 'file'): Promise<() => RuntimeStore<WorkflowRun>> {
  if (kind === 'memory') {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    return () => store;
  }
  const rootDir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'comet-special-result-keys-')),
  );
  temporaryDirectories.push(rootDir);
  return () => createFileRuntimeStore<WorkflowRun>({ rootDir });
}

function runtimeFor(store: RuntimeStore<WorkflowRun>, workflow: DefineWorkflowOptions) {
  return createRuntime({
    store,
    workflows: [workflow],
    executors: [
      {
        id: 'host',
        capabilities: [],
        supports: () => true,
        async execute(action) {
          return {
            status: 'succeeded',
            output: {
              source: action.stepId,
              content: action.stepId === '__proto__' ? 'x'.repeat(70_000) : 'result',
            },
          };
        },
      },
    ],
    evidenceValidators: [
      {
        id: 'evidence-validator',
        version: '1',
        validate: ({ contentHash }) => ({ accepted: true, actualHash: contentHash }),
      },
    ],
  });
}

function expectPlainObjects(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  if (!Array.isArray(value)) expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  for (const child of Object.values(value)) expectPlainObjects(child);
}

function expectRoundTrip(run: WorkflowRun): void {
  for (const parse of [parseWorkflowRun, parseWorkflowRunSnapshot]) {
    const parsed = parse(JSON.parse(JSON.stringify(run)), run.runId);
    expect(Object.keys(parsed.outputs).sort()).toEqual(Object.keys(run.outputs).sort());
    expect(Object.keys(parsed.joins).sort()).toEqual(Object.keys(run.joins).sort());
    for (const [stepId, queues] of Object.entries(run.joins))
      expect(Object.keys(parsed.joins[stepId]).sort()).toEqual(Object.keys(queues).sort());
    expect(parsed).toEqual(run);
    expectPlainObjects(parsed);
  }
  const checkpoint = createPortableRunCheckpoint(run);
  for (const field of [
    'outputs',
    'waits',
    'evidenceWaits',
    'ready',
    'joins',
    'actionContexts',
  ] as const)
    expect(checkpoint.run[field]).toEqual(run[field]);
  for (const saved of [checkpoint, encodePortableRunCheckpoint(checkpoint)]) {
    const restored = readPortableRunCheckpoint(JSON.parse(JSON.stringify(saved)), run.runId)!;
    expect(restored).toEqual(checkpoint.run);
    expectPlainObjects(restored);
  }
}

async function executeStep(
  runtime: ReturnType<typeof createRuntime>,
  run: WorkflowRun,
  stepId: string,
): Promise<WorkflowRun> {
  const action = run.actions.find((item) => item.stepId === stepId && item.status === 'pending')!;
  return runtime.execute({ runId: run.runId, actionId: action.id, executorId: 'host' });
}

describe.each(['memory', 'file'] as const)('special result keys with %s storage', (kind) => {
  it.each(['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'])(
    'keeps %s through execution, approval, evidence, and persisted follow-up work',
    async (stepId) => {
      const workflow: DefineWorkflowOptions = {
        id: 'special-results',
        version: '1',
        entry: stepId,
        steps: {
          [stepId]: { type: 'call_tool', ref: 'source' },
          approve: { type: 'ask_user', proposalFrom: stepId },
          evidence: {
            type: 'await_evidence',
            kind: 'report',
            validator: { id: 'evidence-validator', version: '1' },
          },
          finish: { type: 'call_tool', ref: 'finish' },
        },
        transitions: [
          { from: stepId, to: 'approve' },
          { from: 'approve', to: 'evidence', on: 'approved' },
          { from: 'evidence', to: 'finish' },
        ],
      };
      const reopen = await stores(kind);
      let runtime = runtimeFor(reopen(), workflow);
      let run = await runtime.start({ runId: 'results', workflow, input: null });
      run = await executeStep(runtime, run, stepId);
      const result = run.outputs[stepId];
      expect(Object.hasOwn(run.outputs, stepId)).toBe(true);
      expect(Object.keys(run.waits[0].results)).toEqual([stepId]);
      expectRoundTrip(run);
      if (stepId === '__proto__') {
        expect(encodePortableRunCheckpoint(createPortableRunCheckpoint(run)).schema).toBe(
          'comet.workflow-run-checkpoint.v2',
        );
      }

      runtime = runtimeFor(reopen(), workflow);
      expect(await runtime.inspect(run.runId)).toEqual(run);
      expect(await runtime.next({ runId: run.runId })).toEqual(run);
      const wait = run.waits[0];
      run = await runtime.resolveWait({
        runId: run.runId,
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: 'approved',
        choice: 'approved',
      });
      expect(Object.hasOwn(run.evidenceWaits![0].results, stepId)).toBe(true);
      expect(run.evidenceWaits![0].results[stepId]).toEqual(result);
      expectRoundTrip(run);

      runtime = runtimeFor(reopen(), workflow);
      expect(await runtime.inspect(run.runId)).toEqual(run);
      expect(await runtime.next({ runId: run.runId })).toEqual(run);
      run = await runtime.recordEvidence({
        runId: run.runId,
        expectedRevision: run.revision,
        evidenceId: run.evidenceWaits![0].id,
        kind: 'report',
        ref: 'report.json',
        contentHash: hashRuntimeValue('report'),
        submissionId: 'evidence',
      });
      const finish = run.actions.at(-1)!;
      expect(Object.hasOwn(run.actionContexts[finish.id].results, stepId)).toBe(true);
      expect(run.actionContexts[finish.id].results[stepId]).toEqual(result);
      expect(finish.input).toMatchObject({ outputs: { [stepId]: result.value } });
      expectRoundTrip(run);

      runtime = runtimeFor(reopen(), workflow);
      expect(await runtime.inspect(run.runId)).toEqual(run);
      expect(await runtime.next({ runId: run.runId })).toEqual(run);
      run = await executeStep(runtime, run, 'finish');
      expect(run.status).toBe('completed');
      expect(Object.hasOwn(run.outputs, stepId)).toBe(true);
      expect(run.outputs[stepId]).toEqual(result);
      expectRoundTrip(run);
      expect(await runtimeFor(reopen(), workflow).inspect(run.runId)).toEqual(run);
      expect(await reopen().read(run.runId)).toEqual(run);
    },
  );

  it('recovers a queued __proto__ result into one persisted downstream action', async () => {
    const workflow: DefineWorkflowOptions = {
      id: 'queued-results',
      version: '1',
      entry: '__proto__',
      steps: {
        ['__proto__']: { type: 'call_tool', ref: 'source' },
        finish: { type: 'call_tool', ref: 'finish' },
      },
      transitions: [{ from: '__proto__', to: 'finish' }],
    };
    const reopen = await stores(kind);
    const store = reopen();
    let runtime = runtimeFor(store, workflow);
    const started = await runtime.start({ runId: 'queued', workflow, input: null });
    const advanced = await executeStep(runtime, started, '__proto__');
    const action = advanced.actions[0];
    // 保留真实执行收据，重现下一步骤尚未调度的持久化边界。
    const queued: WorkflowRun = {
      ...advanced,
      revision: advanced.revision + 1,
      sequence: 1,
      actions: [action],
      actionContexts: { [action.id]: advanced.actionContexts[action.id] },
      ready: [{ from: '__proto__', to: 'finish', results: advanced.outputs }],
    };
    expect(await store.compareAndSwap(queued.runId, advanced.revision, queued)).toBe(true);
    expectRoundTrip(queued);
    runtime = runtimeFor(reopen(), workflow);
    expect(await runtime.inspect(queued.runId)).toEqual(queued);
    const resumed = await runtime.next({ runId: queued.runId });
    const finish = resumed.actions.at(-1)!;
    expect(resumed.actions).toHaveLength(2);
    expect(Object.keys(resumed.actionContexts[finish.id].results)).toEqual(['__proto__']);
    expect(finish.input).toEqual({
      input: null,
      outputs: { ['__proto__']: queued.outputs['__proto__'].value },
    });
    expectRoundTrip(resumed);
    expect(await reopen().read(queued.runId)).toEqual(resumed);
    expect(await runtimeFor(reopen(), workflow).next({ runId: queued.runId })).toEqual(resumed);
  });

  it.each([
    { parent: 'left', join: '__proto__' },
    { parent: '__proto__', join: 'join' },
    { parent: 'constructor', join: 'toString' },
    { parent: 'hasOwnProperty', join: 'constructor' },
  ])('retains join $join and parent $parent across recovery', async ({ parent, join }) => {
    const workflow: DefineWorkflowOptions = {
      id: 'special-join',
      version: '1',
      entry: [parent, 'right'],
      steps: {
        [parent]: { type: 'call_tool', ref: 'left' },
        right: { type: 'call_tool', ref: 'right' },
        [join]: { type: 'call_tool', ref: 'merge', join: [parent, 'right'] },
      },
      transitions: [
        { from: parent, to: join },
        { from: 'right', to: join },
      ],
    };
    const reopen = await stores(kind);
    let runtime = runtimeFor(reopen(), workflow);
    let run = await runtime.start({ runId: 'join-results', workflow, input: null });
    run = await executeStep(runtime, run, parent);
    expect(Object.hasOwn(run.joins, join)).toBe(true);
    expect(Object.hasOwn(run.joins[join], parent)).toBe(true);
    expect(run.joins[join][parent]).toHaveLength(1);
    expectRoundTrip(run);

    runtime = runtimeFor(reopen(), workflow);
    expect(await runtime.inspect(run.runId)).toEqual(run);
    expect(await runtime.next({ runId: run.runId })).toEqual(run);
    run = await executeStep(runtime, run, 'right');
    const joined = run.actions.at(-1)!;
    expect(joined.stepId).toBe(join);
    expect(run.actions.filter((action) => action.stepId === join)).toHaveLength(1);
    expect(joined.input).toEqual({
      input: null,
      outputs: { [parent]: run.outputs[parent].value, right: run.outputs.right.value },
    });
    expect(run.joins[join]).toEqual({ [parent]: [], right: [] });
    expectRoundTrip(run);

    runtime = runtimeFor(reopen(), workflow);
    run = await executeStep(runtime, await runtime.inspect(run.runId), join);
    expect(run.status).toBe('completed');
    expect(Object.hasOwn(run.outputs, join)).toBe(true);
    expectRoundTrip(run);
    expect(await runtimeFor(reopen(), workflow).next({ runId: run.runId })).toEqual(run);
    expect(await reopen().read(run.runId)).toEqual(run);
  });
});
