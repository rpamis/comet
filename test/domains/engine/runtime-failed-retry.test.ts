import { expect, test } from 'vitest';
import {
  createMemoryRuntimeStore,
  createRuntime,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';

async function setup(kind: 'none' | 'action' | 'wait' | 'evidence' | 'join' | 'ready') {
  const runtime = createRuntime({
    store: createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [
      {
        id: 'failed-retry',
        version: '1',
        entry: 'probe',
        initialState: {},
        stateSchema: { type: 'object' },
        transitionHandler: { id: 'route', version: '1' },
        maxTransitions: kind === 'ready' ? 1 : 100,
        steps: {
          probe: { type: 'call_tool', ref: 'probe', retry: 'idempotent' },
          other: { type: 'call_tool', ref: 'other' },
          next:
            kind === 'wait'
              ? { type: 'ask_user', proposalFrom: 'probe' }
              : kind === 'evidence'
                ? {
                    type: 'await_evidence',
                    kind: 'check',
                    validator: { id: 'check', version: '1' },
                  }
                : {
                    type: 'call_tool',
                    ref: 'next',
                    ...(kind === 'join' ? { join: ['probe', 'other'] } : {}),
                  },
        },
        transitions: [
          { from: 'probe', to: 'next', on: 'failed' },
          { from: 'other', to: 'next' },
        ],
      },
    ],
    transitionHandlers: [
      {
        id: 'route',
        version: '1',
        apply: ({ run, event }) => ({
          state: run.state!,
          next: event.stepId === 'probe' && kind !== 'none' ? ['next'] : [],
        }),
      },
    ],
    evidenceValidators: [
      {
        id: 'check',
        version: '1',
        validate: ({ contentHash }) => ({ accepted: true, actualHash: contentHash }),
      },
    ],
    executors: [
      {
        id: 'host',
        capabilities: [],
        supports: () => true,
        execute: async (action) => ({
          status: action.stepId === 'probe' ? 'failed' : 'succeeded',
          output: { ready: false },
        }),
      },
    ],
  });
  let run = await runtime.start({
    runId: `retry-${kind}`,
    workflow: { id: 'failed-retry', version: '1' },
    input: null,
  });
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions[0].id,
    executorId: 'host',
  });
  return { runtime, run };
}

test('retries an unadvanced idempotent failure despite a declared failed edge, preserving receipts and CAS', async () => {
  const { runtime, run } = await setup('none');
  const action = run.actions[0];
  expect(run.status).toBe('failed');
  expect(run.outputs.probe.sequence).toBe(run.actionContexts[action.id].sequence);
  await expect(
    runtime.retry({
      runId: run.runId,
      expectedRevision: run.revision - 1,
      actionId: action.id,
      attempt: action.attempt,
    }),
  ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  const retried = await runtime.retry({
    runId: run.runId,
    expectedRevision: run.revision,
    actionId: action.id,
    attempt: action.attempt,
  });
  expect(retried.actions[0]).toMatchObject({
    status: 'pending',
    attempt: 2,
    receipts: action.receipts,
  });
  expect(retried.actions).toHaveLength(1);
  expect(retried.status).toBe('running');
});

test.each(['action', 'wait', 'evidence', 'join', 'ready'] as const)(
  'rejects retry after the failed result reaches %s',
  async (kind) => {
    const { runtime, run } = await setup(kind);
    if (kind === 'join') expect(run.joins.next.probe).toHaveLength(1);
    if (kind === 'ready') expect(run.ready).toHaveLength(1);
    await expect(
      runtime.retry({ runId: run.runId, actionId: run.actions[0].id, attempt: 1 }),
    ).rejects.toMatchObject({ code: 'ACTION_ALREADY_ADVANCED' });
    expect(await runtime.inspect(run.runId)).toEqual(run);
  },
);

test.each(['action', 'wait', 'evidence'] as const)(
  'rejects retry after the %s successor has completed',
  async (kind) => {
    const { runtime, run } = await setup(kind);
    let completed: WorkflowRun;
    if (kind === 'action')
      completed = await runtime.execute({
        runId: run.runId,
        actionId: run.actions[1].id,
        executorId: 'host',
      });
    else if (kind === 'wait')
      completed = await runtime.resolveWait({
        runId: run.runId,
        waitId: run.waits[0].id,
        proposalHash: run.waits[0].proposalHash,
        decisionId: 'approved',
        choice: 'approved',
      });
    else
      completed = await runtime.recordEvidence({
        runId: run.runId,
        evidenceId: run.evidenceWaits![0].id,
        kind: 'check',
        ref: 'check.txt',
        contentHash: 'a'.repeat(64),
        submissionId: 'checked',
      });
    expect(completed.status).toBe('completed');
    await expect(
      runtime.retry({ runId: run.runId, actionId: run.actions[0].id, attempt: 1 }),
    ).rejects.toMatchObject({ code: 'ACTION_ALREADY_ADVANCED' });
    expect(await runtime.inspect(run.runId)).toEqual(completed);
  },
);
