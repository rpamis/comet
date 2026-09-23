import { describe, expect, it } from 'vitest';
import { createRuntime } from '../../../domains/engine/runtime-service.js';
import { createMemoryRuntimeStore } from '../../../domains/engine/runtime-store.js';
import type { WorkflowRun } from '../../../domains/engine/workflow-run.js';

const child = {
  id: 'research',
  version: '1',
  entry: 'read',
  steps: { read: { type: 'invoke_skill' as const, ref: 'read@1' } },
};
const parent = {
  id: 'report',
  version: '1',
  entry: 'research',
  steps: {
    research: { type: 'child_workflow' as const, workflow: { id: 'research', version: '1' } },
    write: { type: 'invoke_skill' as const, ref: 'write@1' },
  },
  transitions: [{ from: 'research', to: 'write' }],
};

describe('durable child workflows', () => {
  it('starts a deterministic child once and resumes its completed output after a Runtime restart', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const runtime = createRuntime({ store, workflows: [parent, child] });
    const started = await runtime.start({ runId: 'parent', workflow: parent, input: 'topic' });
    const advanced = await runtime.next({ runId: 'parent' });
    expect(advanced.children).toHaveLength(1);
    const childId = advanced.children[0].runId;
    let childRun = await runtime.inspect(childId);
    const childRevision = childRun.revision;
    await runtime.next({ runId: 'parent' });
    expect((await runtime.inspect(childId)).revision).toBe(childRevision);
    expect(started.children[0].runId).toBe(childId);
    const action = childRun.actions[0];
    childRun = await runtime.claim({
      runId: childId,
      actionId: action.id,
      attempt: 1,
      inputHash: action.inputHash,
      executorId: 'host',
      claimToken: 'token',
    });
    await runtime.recordOutcome({
      runId: childId,
      outcome: {
        actionId: action.id,
        attempt: 1,
        inputHash: action.inputHash,
        claimToken: 'token',
        outcomeId: 'r1',
        status: 'succeeded',
        output: { source: 'primary' },
      },
    });
    const restarted = createRuntime({ store, workflows: [parent, child] });
    const resumed = await restarted.next({ runId: 'parent' });
    expect(resumed.actions[0].status).toBe('succeeded');
    expect(resumed.actions[1]).toMatchObject({ stepId: 'write', status: 'pending' });
    expect(resumed.actions[1].input).toMatchObject({
      outputs: { research: { read: { source: 'primary' } } },
    });
    expect(await restarted.next({ runId: 'parent' })).toEqual(resumed);
  });

  it('does not let a host claim or invent completion for a child workflow action', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [parent, child],
    });
    const run = await runtime.start({ runId: 'parent', workflow: parent, input: null });
    const action = run.actions[0];
    await expect(
      runtime.claim({
        runId: 'parent',
        actionId: action.id,
        attempt: 1,
        inputHash: action.inputHash,
        executorId: 'host',
        claimToken: 'fake',
      }),
    ).rejects.toThrow(/CHILD_MANAGED/);
    await runtime.next({ runId: 'parent' });
    const managed = (await runtime.inspect('parent')).actions[0];
    await expect(
      runtime.recordOutcome({
        runId: 'parent',
        outcome: {
          actionId: action.id,
          attempt: 1,
          inputHash: action.inputHash,
          claimToken: managed.claim!.token,
          outcomeId: 'fake',
          status: 'succeeded',
          output: {},
        },
      }),
    ).rejects.toThrow(/CHILD_MANAGED/);
  });

  it('propagates cancellation to an existing child and keeps it cancelled across recovery', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [parent, child],
    });
    await runtime.start({ runId: 'parent', workflow: parent, input: null });
    const run = await runtime.next({ runId: 'parent' });
    await runtime.cancel({ runId: 'parent', reason: 'user cancelled' });
    expect((await runtime.inspect(run.children[0].runId)).status).toBe('cancelled');
    await runtime.next({ runId: 'parent' });
    expect((await runtime.inspect(run.children[0].runId)).status).toBe('cancelled');
  });
});
