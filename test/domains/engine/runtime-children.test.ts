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
  it.each(['failed', 'unknown'] as const)(
    'rejects generic retry of a managed %s child Action before changing the parent',
    async (status) => {
      const store = createMemoryRuntimeStore<WorkflowRun>();
      const runtime = createRuntime({ store, workflows: [parent, child] });
      await runtime.start({ runId: 'parent', workflow: parent, input: 'topic' });
      const advanced = await runtime.next({ runId: 'parent' });
      const childId = advanced.children[0].runId;
      if (status === 'failed') {
        const action = (await runtime.inspect(childId)).actions[0];
        await runtime.claim({
          runId: childId,
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          executorId: 'host',
          claimToken: 'child-claim',
        });
        await runtime.recordOutcome({
          runId: childId,
          outcome: {
            actionId: action.id,
            attempt: action.attempt,
            inputHash: action.inputHash,
            claimToken: 'child-claim',
            outcomeId: 'failed-child',
            status: 'failed',
            output: null,
          },
        });
        await runtime.next({ runId: 'parent' });
      } else {
        const action = advanced.actions[0];
        await runtime.markUnknown({
          runId: 'parent',
          actionId: action.id,
          attempt: action.attempt,
          reason: 'parent disconnected',
        });
      }
      const before = await runtime.inspect('parent');
      const childBefore = await runtime.inspect(childId);
      const action = before.actions[0];
      expect(action.status).toBe(status);
      const restarted = createRuntime({ store, workflows: [parent, child] });
      await expect(
        restarted.retry({
          runId: 'parent',
          actionId: action.id,
          attempt: action.attempt,
          expectedRevision: before.revision,
          reconciliation: { resolution: 'not-executed', evidence: 'isolated fixture' },
        }),
      ).rejects.toThrow(/CHILD_MANAGED/);
      expect(await restarted.inspect('parent')).toEqual(before);
      expect(await restarted.inspect(childId)).toEqual(childBefore);
    },
  );

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
