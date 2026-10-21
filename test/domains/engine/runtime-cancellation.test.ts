import { describe, expect, it } from 'vitest';
import { parseRuntimeAction } from '../../../domains/engine/runtime-action.js';
import {
  createMemoryRuntimeStore,
  createPortableRunCheckpoint,
  createRuntime,
  readPortableRunCheckpoint,
  type RuntimeStoppedAction,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';

async function fixture() {
  const runtime = createRuntime({
    store: createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [
      {
        id: 'cancellation',
        version: '1',
        entry: 'work',
        steps: { work: { type: 'handoff', ref: 'host' } },
      },
    ],
  });
  const started = await runtime.start({
    runId: 'cancel-task',
    workflow: { id: 'cancellation', version: '1' },
    input: { retained: 'partial work' },
  });
  const action = started.actions[0];
  await runtime.claim({
    runId: started.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'original-host',
    sessionId: 'original-session',
    claimToken: 'private-live-claim-token',
  });
  const stopped: RuntimeStoppedAction = {
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: 'private-live-claim-token',
    evidence: 'The original host confirms the task and its children exited; partial files remain.',
  };
  return { runtime, stopped, runId: started.runId };
}

describe('Runtime cancellation acknowledgement', () => {
  it('keeps cancellation terminal and acknowledges stopped work once without losing history', async () => {
    const f = await fixture();
    const cancelled = await f.runtime.cancel({ runId: f.runId, reason: 'User stopped this work' });
    expect(cancelled.actions[0].cancellation).toBeUndefined();
    expect(await f.runtime.cancel({ runId: f.runId, reason: 'Repeated cancellation' })).toEqual(
      cancelled,
    );
    const stopped = await f.runtime.cancel({
      runId: f.runId,
      expectedRevision: cancelled.revision,
      reason: 'Original host stopped',
      stoppedActions: [f.stopped],
    });
    expect(stopped.revision).toBe(cancelled.revision + 1);
    expect(stopped.status).toBe('cancelled');
    expect(stopped.reason).toBe(cancelled.reason);
    expect(stopped.actions[0]).toEqual({ ...cancelled.actions[0], cancellation: f.stopped });
    expect(
      await f.runtime.cancel({ runId: f.runId, reason: 'Retry', stoppedActions: [f.stopped] }),
    ).toEqual(stopped);
    expect(await f.runtime.next({ runId: f.runId })).toEqual(stopped);
    await expect(
      f.runtime.recordOutcome({
        runId: f.runId,
        outcome: { ...f.stopped, outcomeId: 'late', status: 'failed', output: 'Late host result' },
      }),
    ).rejects.toThrow(/RUN_CANCELLED/);
    expect(await f.runtime.inspect(f.runId)).toEqual(stopped);
  });

  it('prioritizes committed cancellation over malformed late outcomes without accepting them', async () => {
    const f = await fixture();
    const cancelled = await f.runtime.cancel({ runId: f.runId, reason: 'Stop' });
    await expect(
      f.runtime.recordOutcome({
        runId: f.runId,
        outcome: {
          ...f.stopped,
          outcomeId: 'late-invalid',
          status: 'failed',
          output: undefined as never,
        },
      }),
    ).rejects.toThrow(/RUN_CANCELLED/);
    expect(await f.runtime.inspect(f.runId)).toEqual(cancelled);
    const active = await fixture();
    await expect(
      active.runtime.recordOutcome({
        runId: active.runId,
        outcome: { ...active.stopped, outcomeId: 'invalid', status: 'failed', output: null },
      }),
    ).rejects.toThrow(/INVALID_OUTCOME/);
  });

  it.each([
    ['claim', { claimToken: 'another-host' }, /STALE_ACTION/],
    ['attempt', { attempt: 2 }, /STALE_ACTION/],
    ['input', { inputHash: '0'.repeat(64) }, /STALE_ACTION/],
    ['missing evidence', { evidence: '  ' }, /INVALID_ACTION/],
    ['placeholder evidence', { evidence: '<actual stop proof>' }, /INVALID_ACTION/],
    ['multiline placeholder evidence', { evidence: ' \n<host exit\nproof>\n ' }, /INVALID_ACTION/],
    ['wrong action', { actionId: 'other-action' }, /ACTION_NOT_FOUND/],
  ] as const)(
    'rejects %s evidence without committing cancellation',
    async (_label, changes, expected) => {
      const f = await fixture();
      const before = await f.runtime.inspect(f.runId);
      await expect(
        f.runtime.cancel({
          runId: f.runId,
          reason: 'Cancel',
          stoppedActions: [{ ...f.stopped, ...changes }],
        }),
      ).rejects.toThrow(expected);
      expect(await f.runtime.inspect(f.runId)).toEqual(before);
    },
  );

  it('rejects placeholder stop proof after cancellation without changing the retained task', async () => {
    const f = await fixture();
    const cancelled = await f.runtime.cancel({ runId: f.runId, reason: 'Stop requested' });
    const placeholder = { ...f.stopped, evidence: '<replace with actual stop evidence>' };
    await expect(
      f.runtime.cancel({ runId: f.runId, reason: 'Stopped', stoppedActions: [placeholder] }),
    ).rejects.toMatchObject({ code: 'INVALID_ACTION' });
    await expect(
      f.runtime.acknowledgeStopped({ runId: f.runId, stoppedActions: [placeholder] }),
    ).rejects.toMatchObject({ code: 'INVALID_ACTION' });
    expect(await f.runtime.inspect(f.runId)).toEqual(cancelled);
    expect(() =>
      parseRuntimeAction({ ...cancelled.actions[0], cancellation: placeholder }),
    ).toThrow(/INVALID_ACTION/);
  });

  it('preserves concrete historical evidence verbatim, including embedded angle brackets', async () => {
    const f = await fixture();
    const stopped = {
      ...f.stopped,
      evidence: 'Host <worker-42> exited with code 0; child process 43 was reaped.',
    };
    const cancelled = await f.runtime.cancel({
      runId: f.runId,
      reason: 'Stop',
      stoppedActions: [stopped],
    });
    expect(parseRuntimeAction(cancelled.actions[0]).cancellation).toEqual(stopped);
    const recovered = readPortableRunCheckpoint(createPortableRunCheckpoint(cancelled), f.runId)!;
    expect(recovered.actions[0].cancellation!.evidence).toBe(stopped.evidence);
    expect(recovered.actions[0].cancellation!.claimToken).toBe(recovered.actions[0].claim!.token);
  });

  it('rejects duplicate and conflicting acknowledgements and stale CAS revisions', async () => {
    const f = await fixture();
    await expect(
      f.runtime.cancel({
        runId: f.runId,
        reason: 'Cancel',
        stoppedActions: [f.stopped, f.stopped],
      }),
    ).rejects.toThrow(/INVALID_ACTION/);
    const cancelled = await f.runtime.cancel({
      runId: f.runId,
      reason: 'Cancel',
      stoppedActions: [f.stopped],
    });
    await expect(
      f.runtime.cancel({
        runId: f.runId,
        reason: 'Cancel',
        stoppedActions: [{ ...f.stopped, evidence: 'Different evidence' }],
      }),
    ).rejects.toThrow(/OUTCOME_CONFLICT/);
    await expect(
      f.runtime.cancel({
        runId: f.runId,
        expectedRevision: cancelled.revision - 1,
        reason: 'Cancel',
        stoppedActions: [f.stopped],
      }),
    ).rejects.toThrow(/REVISION_CONFLICT/);
    expect(await f.runtime.inspect(f.runId)).toEqual(cancelled);
  });

  it('retains cancellation evidence in portable recovery without exposing the live claim token', async () => {
    const f = await fixture();
    const cancelled = await f.runtime.cancel({
      runId: f.runId,
      reason: 'Cancel',
      stoppedActions: [f.stopped],
    });
    const checkpoint = createPortableRunCheckpoint(cancelled);
    expect(JSON.stringify(checkpoint)).not.toContain(f.stopped.claimToken);
    const recovered = readPortableRunCheckpoint(checkpoint, f.runId)!;
    expect(recovered.status).toBe('cancelled');
    expect(recovered.actions[0].cancellation).toMatchObject({ evidence: f.stopped.evidence });
    expect(recovered.actions[0].cancellation!.claimToken).toBe(recovered.actions[0].claim!.token);
  });
});
