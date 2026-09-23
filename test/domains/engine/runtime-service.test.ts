import { describe, expect, it } from 'vitest';
import { createRuntime } from '../../../domains/engine/runtime-service.js';
import { createMemoryRuntimeStore } from '../../../domains/engine/runtime-store.js';
import type { WorkflowRun } from '../../../domains/engine/workflow-run.js';

const report = {
  id: 'report',
  version: '1',
  entry: 'collect',
  steps: {
    collect: {
      type: 'invoke_skill',
      ref: 'collect@1',
      outputSchema: {
        type: 'object',
        required: ['sources'],
        properties: { sources: { type: 'array', items: { type: 'string' } } },
      },
    },
    approve: { type: 'ask_user', proposalFrom: 'collect' },
    write: { type: 'invoke_skill', ref: 'write@1' },
  },
  transitions: [
    { from: 'collect', to: 'approve' },
    { from: 'approve', on: 'approved', to: 'write' },
    { from: 'approve', on: 'rejected', to: 'collect' },
  ],
};

async function claimFirst(runtime: ReturnType<typeof createRuntime>, run: WorkflowRun) {
  const action = run.actions.find((item) => item.status === 'pending')!;
  const claimed = await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'host',
    sessionId: 's1',
    claimToken: 'token',
    capabilities: [],
  });
  return claimed.actions.find((item: { id: string }) => item.id === action.id)!;
}

function receipt(action: WorkflowRun['actions'][number], output: unknown, outcomeId = 'result-1') {
  return {
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: action.claim!.token,
    outcomeId,
    status: 'succeeded',
    output,
  };
}

describe('host-driven workflow Runtime', () => {
  it('persists work before returning it and resumes the same action from a new Runtime', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const runtime = createRuntime({ store, workflows: [report] });
    const started = await runtime.start({
      runId: 'r1',
      workflow: { id: 'report', version: '1' },
      input: { topic: '可恢复报告' },
    });
    expect(started.actions).toHaveLength(1);
    expect(started.actions[0]).toMatchObject({
      stepId: 'collect',
      status: 'pending',
      ref: 'collect@1',
    });
    expect(await store.read('r1')).toEqual(started);
    const resumed = createRuntime({ store, workflows: [report] });
    expect(await resumed.next({ runId: 'r1' })).toEqual(started);
    expect(await resumed.inspect('r1')).toEqual(started);
  });

  it('completes a non-development workflow across actions and a bound approval', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [report],
    });
    let run = await runtime.start({
      runId: 'r1',
      workflow: { id: 'report', version: '1' },
      input: null,
    });
    const collected = await claimFirst(runtime, run);
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: receipt(collected, { sources: ['primary'] }),
    });
    expect(run.status).toBe('waiting');
    expect(run.waits[0].proposal).toMatchObject({ outputs: { collect: { sources: ['primary'] } } });
    const wait = run.waits[0];
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'd1',
      choice: 'approved',
    });
    const writer = await claimFirst(runtime, run);
    expect(writer.input).toMatchObject({ outputs: { collect: { sources: ['primary'] } } });
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: receipt(writer, { report: 'finished' }, 'result-2'),
    });
    expect(run.status).toBe('completed');
    expect(run.outputs.write.value).toEqual({ report: 'finished' });
  });

  it('persists invalid output without advancing the workflow or releasing its claim', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [report],
    });
    const run = await runtime.start({
      runId: 'r1',
      workflow: { id: 'report', version: '1' },
      input: null,
    });
    const action = await claimFirst(runtime, run);
    const before = await runtime.inspect('r1');
    await expect(
      runtime.recordOutcome({ runId: 'r1', outcome: receipt(action, { wrong: true }) }),
    ).rejects.toThrow(/OUTPUT_INVALID/);
    const after = await runtime.inspect('r1');
    expect(after.revision).toBe(before.revision + 1);
    expect(after.status).toBe('running');
    expect(after.outputs).toEqual(before.outputs);
    expect(after.actions[0]).toMatchObject({
      status: 'running',
      claim: action.claim,
      rejectedOutcomes: [{ code: 'OUTPUT_INVALID', outcome: receipt(action, { wrong: true }) }],
    });
  });

  it('deduplicates result and approval retries without issuing another action', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [report],
    });
    let run = await runtime.start({
      runId: 'r1',
      workflow: { id: 'report', version: '1' },
      input: null,
    });
    const action = await claimFirst(runtime, run);
    const command = { runId: 'r1', outcome: receipt(action, { sources: [] }) };
    run = await runtime.recordOutcome(command);
    expect(await runtime.recordOutcome(command)).toEqual(run);
    const wait = run.waits[0];
    const decision = {
      runId: 'r1',
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'd1',
      choice: 'approved',
    };
    run = await runtime.resolveWait(decision);
    expect(await runtime.resolveWait(decision)).toEqual(run);
    await expect(runtime.resolveWait({ ...decision, choice: 'rejected' })).rejects.toThrow(
      /DECISION_CONFLICT/,
    );
  });

  it('rejects a stale approval after revising its proposal', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [report],
    });
    let run = await runtime.start({
      runId: 'r1',
      workflow: { id: 'report', version: '1' },
      input: null,
    });
    run = await runtime.recordOutcome({
      runId: 'r1',
      outcome: receipt(await claimFirst(runtime, run), { sources: [] }),
    });
    const wait = run.waits[0];
    const changed = await runtime.reviseWait({
      runId: 'r1',
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      proposal: { sources: ['changed'] },
    });
    expect(changed.waits[0].proposalHash).not.toBe(wait.proposalHash);
    await expect(
      runtime.resolveWait({
        runId: 'r1',
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: 'd1',
        choice: 'approved',
      }),
    ).rejects.toThrow(/STALE_PROPOSAL/);
  });

  it('pins a definition hash and rejects an incompatible same-version replacement', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const runtime = createRuntime({ store, workflows: [report] });
    await runtime.start({ runId: 'r1', workflow: { id: 'report', version: '1' }, input: null });
    const changed = createRuntime({ store, workflows: [{ ...report, maxTransitions: 20 }] });
    await expect(changed.next({ runId: 'r1' })).rejects.toThrow(/WORKFLOW_CHANGED/);
    await expect(
      runtime.start({ runId: 'r1', workflow: { id: 'report', version: '1' }, input: 'other' }),
    ).rejects.toThrow(/RUN_CONFLICT/);
  });

  it('detects a changed pinned definition when inspecting a persisted Run', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const original = createRuntime({ store, workflows: [report] });
    await original.start({ runId: 'r1', workflow: { id: 'report', version: '1' }, input: null });

    const changed = createRuntime({ store, workflows: [{ ...report, maxTransitions: 20 }] });
    await expect(changed.inspect('r1')).rejects.toThrow(/WORKFLOW_CHANGED/);
  });

  it('requires declared host capabilities before claiming an external action', async () => {
    const workflow = {
      id: 'guarded',
      version: '1',
      entry: 'check',
      steps: {
        check: {
          type: 'handoff',
          ref: 'verifier',
          requiredCapabilities: ['independent-execution'],
        },
      },
      transitions: [],
    };
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [workflow],
    });
    const run = await runtime.start({
      runId: 'r1',
      workflow: { id: 'guarded', version: '1' },
      input: null,
    });
    await expect(claimFirst(runtime, run)).rejects.toThrow(/CAPABILITY_REQUIRED/);
    expect((await runtime.inspect('r1')).actions[0].status).toBe('pending');
  });

  it('joins parallel siblings using their causal outputs despite intervening revisions', async () => {
    const workflow = {
      id: 'parallel',
      version: '1',
      entry: ['left', 'right'],
      steps: {
        left: { type: 'invoke_skill', ref: 'left' },
        right: { type: 'invoke_skill', ref: 'right' },
        join: { type: 'invoke_skill', ref: 'merge', join: ['left', 'right'] },
      },
      transitions: [
        { from: 'left', to: 'join' },
        { from: 'right', to: 'join' },
      ],
    };
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const runtime = createRuntime({ store, workflows: [workflow] });
    const run = await runtime.start({
      runId: 'r1',
      workflow: { id: 'parallel', version: '1' },
      input: null,
    });
    const left = await claimFirst(runtime, run);
    const right = await claimFirst(runtime, await runtime.inspect('r1'));
    await Promise.all([
      runtime.recordOutcome({ runId: 'r1', outcome: receipt(left, 'L', 'left-result') }),
      runtime.recordOutcome({ runId: 'r1', outcome: receipt(right, 'R', 'right-result') }),
    ]);
    const joined = await runtime.inspect('r1');
    expect(
      joined.actions.filter((action: { stepId: string }) => action.stepId === 'join'),
    ).toHaveLength(1);
    expect(joined.actions.at(-1).input).toEqual({
      input: null,
      outputs: { left: 'L', right: 'R' },
    });
  });

  it('keeps cancelled action bindings and rejects a late result', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [report],
    });
    const run = await runtime.start({
      runId: 'r1',
      workflow: { id: 'report', version: '1' },
      input: null,
    });
    const action = await claimFirst(runtime, run);
    const cancelled = await runtime.cancel({ runId: 'r1', reason: 'stop' });
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      actions: [{ status: 'cancelled', claim: { token: 'token' } }],
    });
    await expect(
      runtime.recordOutcome({ runId: 'r1', outcome: receipt(action, { sources: [] }) }),
    ).rejects.toThrow(/RUN_CANCELLED/);
  });
});
