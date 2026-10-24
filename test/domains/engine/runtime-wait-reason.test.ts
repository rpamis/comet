import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFileRuntimeStore,
  createRuntime,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-wait-reason-'));
  roots.push(root);
  const workflow = {
    id: 'review',
    version: '1',
    entry: 'prepare',
    steps: {
      prepare: { type: 'handoff', ref: 'prepare' },
      decision: { type: 'ask_user', proposalFrom: 'prepare', choices: ['retry'] },
      verifier: { type: 'handoff', ref: 'independent-review' },
    },
    transitions: [
      { from: 'prepare', to: 'decision' },
      { from: 'decision', to: 'verifier', on: 'retry' },
    ],
  };
  const reopen = () =>
    createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({ rootDir: root }),
      workflows: [workflow],
    });
  const runtime = reopen();
  let run = await runtime.start({
    runId: 'review',
    workflow: { id: 'review', version: '1' },
    input: { candidate: 'original' },
  });
  const prepare = run.actions[0];
  run = await runtime.claim({
    runId: run.runId,
    actionId: prepare.id,
    attempt: prepare.attempt,
    inputHash: prepare.inputHash,
    executorId: 'host',
    claimToken: 'prepare',
  });
  run = await runtime.recordOutcome({
    runId: run.runId,
    outcome: {
      actionId: prepare.id,
      attempt: prepare.attempt,
      inputHash: prepare.inputHash,
      claimToken: 'prepare',
      outcomeId: 'prepared',
      status: 'succeeded',
      output: { candidate: 'original' },
    },
  });
  const wait = run.waits[0];
  const decision = {
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'user-retry',
    choice: 'retry',
  };
  return { runtime, reopen, run, decision };
}

describe('Runtime decision reason binding', () => {
  it('persists a bounded reason on its Wait without changing approval output, reopens it, and rejects changed retries', async () => {
    const f = await fixture();
    const reason = 'x'.repeat(4096);
    const command = { ...f.decision, reason };
    const resolved = await f.runtime.resolveWait(command);
    expect(resolved.waits[0].decision).toMatchObject({ reason });
    expect(resolved.outputs.decision.value).toEqual({
      choice: 'retry',
      proposal: f.run.waits[0].proposal,
    });
    const cold = f.reopen();
    expect(await cold.inspect(f.run.runId)).toEqual(resolved);
    expect(await cold.resolveWait(command)).toEqual(resolved);
    for (const changed of ['Different model', undefined])
      await expect(cold.resolveWait({ ...command, reason: changed })).rejects.toMatchObject({
        code: 'DECISION_CONFLICT',
      });
    expect((await cold.inspect(f.run.runId)).actions).toHaveLength(2);
  });

  it('keeps omitted reason backward compatible without changing old decision or output shapes', async () => {
    const f = await fixture();
    const run = await f.runtime.resolveWait(f.decision);
    expect(run.waits[0].decision).toEqual({
      id: f.decision.decisionId,
      choice: 'retry',
      proposalHash: f.decision.proposalHash,
    });
    expect(run.outputs.decision.value).toEqual({
      choice: 'retry',
      proposal: f.run.waits[0].proposal,
    });
    expect(await f.reopen().inspect(f.run.runId)).toEqual(run);
  });

  it.each([null, 1, {}, '', '  ', 'x'.repeat(4097)])(
    'rejects an invalid reason before changing the Run (case %#)',
    async (reason) => {
      const f = await fixture();
      await expect(
        f.runtime.resolveWait({ ...f.decision, reason: reason as string }),
      ).rejects.toMatchObject({ code: 'INVALID_DECISION' });
      expect(await f.runtime.inspect(f.run.runId)).toEqual(f.run);
    },
  );

  it('does not save a reason on a stale proposal', async () => {
    const f = await fixture();
    await expect(
      f.runtime.resolveWait({
        ...f.decision,
        proposalHash: '0'.repeat(64),
        reason: 'Never attach to another proposal',
      }),
    ).rejects.toMatchObject({ code: 'STALE_PROPOSAL' });
    expect(await f.reopen().inspect(f.run.runId)).toEqual(f.run);
  });
});
