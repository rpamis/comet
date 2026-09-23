import { describe, expect, it } from 'vitest';

import {
  claimRuntimeAction,
  createRuntimeAction,
  recordRuntimeOutcome,
  type RuntimeAction,
  type RuntimeOutcome,
} from '../../../domains/engine/runtime-action.js';
import { createRuntime, type WorkflowRuntime } from '../../../domains/engine/runtime-service.js';
import { createMemoryRuntimeStore } from '../../../domains/engine/runtime-store.js';
import type { DefineWorkflowOptions } from '../../../domains/engine/workflow-definition.js';
import type { WorkflowRun } from '../../../domains/engine/workflow-run.js';

const report: DefineWorkflowOptions = {
  id: 'adversarial-report',
  version: '1',
  entry: 'collect',
  steps: {
    collect: { type: 'invoke_skill', ref: 'collect' },
    approve: { type: 'ask_user', proposalFrom: 'collect' },
    publish: { type: 'call_tool', ref: 'publish' },
  },
  transitions: [
    { from: 'collect', to: 'approve' },
    { from: 'approve', on: 'approved', to: 'publish' },
    { from: 'approve', on: 'rejected', to: 'collect' },
  ],
};

function outcome(action: RuntimeAction): RuntimeOutcome {
  return {
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: action.claim!.token,
    outcomeId: `outcome-${action.id}`,
    status: 'succeeded',
    output: { report: 'reviewed original' },
  };
}

async function claim(runtime: WorkflowRuntime, run: WorkflowRun): Promise<RuntimeAction> {
  const pending = run.actions.find((action) => action.status === 'pending')!;
  const claimed = await runtime.claim({
    runId: run.runId,
    actionId: pending.id,
    attempt: pending.attempt,
    inputHash: pending.inputHash,
    executorId: 'host',
    claimToken: `claim-${pending.id}`,
  });
  return claimed.actions.find((action) => action.id === pending.id)!;
}

async function fixture(workflow: DefineWorkflowOptions = report) {
  const store = createMemoryRuntimeStore<WorkflowRun>();
  const runtime = createRuntime({ store, workflows: [workflow] });
  const started = await runtime.start({
    runId: 'adversarial-run',
    workflow: { id: workflow.id, version: workflow.version },
    input: null,
  });
  return { store, runtime, started };
}

describe('Runtime protocol adversarial boundaries', () => {
  it('rejects a persisted Action whose owning Run differs from its containing snapshot', async () => {
    const { store, runtime, started } = await fixture();
    await store.compareAndSwap(started.runId, started.revision, {
      ...started,
      revision: started.revision + 1,
      actions: started.actions.map((action) => ({ ...action, runId: 'another-run' })),
    });
    await expect(runtime.inspect(started.runId)).rejects.toThrow();
  });

  it('rejects an old approval when persisted proposal content no longer matches its hash', async () => {
    const { store, runtime, started } = await fixture();
    const collected = await claim(runtime, started);
    const waiting = await runtime.recordOutcome({
      runId: started.runId,
      outcome: outcome(collected),
    });
    const wait = waiting.waits[0];
    await store.compareAndSwap(waiting.runId, waiting.revision, {
      ...waiting,
      revision: waiting.revision + 1,
      waits: waiting.waits.map((item) => ({
        ...item,
        proposal: { input: null, outputs: { collect: { report: 'unreviewed replacement' } } },
      })),
    });
    await expect(
      runtime.resolveWait({
        runId: waiting.runId,
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: 'approve-original',
        choice: 'approved',
      }),
    ).rejects.toThrow();
  });

  it('rejects unsupported Outcome fields before committing a snapshot that cannot be reopened', async () => {
    const { runtime, started } = await fixture();
    const action = await claim(runtime, started);
    const before = await runtime.inspect(started.runId);
    await expect(
      runtime.recordOutcome({
        runId: started.runId,
        outcome: { ...outcome(action), unexpectedField: true } as RuntimeOutcome,
      }),
    ).rejects.toThrow();
    expect(await runtime.inspect(started.runId)).toEqual(before);
  });

  it('rejects an omitted Outcome output at the public Action interface', () => {
    const pending = createRuntimeAction({
      id: 'a',
      runId: 'r',
      stepId: 's',
      type: 'call_tool',
      input: null,
    });
    const action = claimRuntimeAction(pending, {
      executorId: 'host',
      token: 'claim',
      attempt: pending.attempt,
      inputHash: pending.inputHash,
    });
    const missingOutput = { ...outcome(action) } as Partial<RuntimeOutcome>;
    delete missingOutput.output;
    expect(() => recordRuntimeOutcome(action, missingOutput as RuntimeOutcome)).toThrow();
  });

  it('replays the same claim request identity when the caller did not supply a claim token', async () => {
    const { runtime, started } = await fixture();
    const action = started.actions[0];
    const command = {
      runId: started.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'same-host',
      sessionId: 'same-session',
      context: { requestId: 'same-claim-request' },
    };
    const first = await runtime.claim(command);
    await expect(runtime.claim(command)).resolves.toEqual(first);
  });

  it('does not dispatch an unstarted sibling after an unhandled failure has stopped the Run', async () => {
    const { runtime, started } = await fixture({
      id: 'parallel-stop',
      version: '1',
      entry: ['left', 'right'],
      steps: {
        left: { type: 'call_tool', ref: 'check' },
        right: { type: 'call_tool', ref: 'external-side-effect' },
      },
    });
    const left = await claim(runtime, started);
    const failed = await runtime.recordOutcome({
      runId: started.runId,
      outcome: { ...outcome(left), status: 'failed' },
    });
    expect(failed.status).toBe('failed');
    await expect(claim(runtime, failed)).rejects.toThrow();
  });
});
