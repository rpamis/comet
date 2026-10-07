import { describe, expect, it } from 'vitest';
import { createRuntime } from '../../../domains/engine/runtime-service.js';
import { createMemoryRuntimeStore } from '../../../domains/engine/runtime-store.js';
import { parseWorkflowRun } from '../../../domains/engine/workflow-run-validation.js';
import type { WorkflowRun } from '../../../domains/engine/workflow-run.js';

async function fixture() {
  const store = createMemoryRuntimeStore<WorkflowRun>();
  const runtime = createRuntime({
    store,
    workflows: [
      {
        id: 'report',
        version: '1',
        entry: 'collect',
        steps: {
          collect: { type: 'call_tool', ref: 'collect', retry: 'idempotent' },
          approve: { type: 'ask_user', proposalFrom: 'collect' },
          publish: { type: 'call_tool', ref: 'publish' },
          never: { type: 'call_tool', ref: 'never' },
        },
        transitions: [
          { from: 'collect', to: 'approve' },
          { from: 'never', to: 'publish' },
          { from: 'approve', to: 'publish', on: 'approved' },
          { from: 'approve', to: 'collect', on: 'rejected' },
        ],
      },
    ],
  });
  const started = await runtime.start({
    runId: 'report:run',
    workflow: { id: 'report', version: '1' },
    input: { topic: 'test' },
  });
  const pending = started.actions[0];
  const claimed = await runtime.claim({
    runId: started.runId,
    actionId: pending.id,
    attempt: pending.attempt,
    inputHash: pending.inputHash,
    executorId: 'host',
    claimToken: 'claim',
  });
  const waiting = await runtime.recordOutcome({
    runId: started.runId,
    outcome: {
      actionId: pending.id,
      attempt: pending.attempt,
      inputHash: pending.inputHash,
      claimToken: 'claim',
      outcomeId: 'collected',
      status: 'succeeded',
      output: { report: 'v1' },
    },
  });
  return { store, runtime, started, claimed, waiting };
}

describe('persisted WorkflowRun boundary', () => {
  it('round-trips isolated running and approval snapshots through the public parser', async () => {
    const { started, claimed, waiting } = await fixture();
    for (const snapshot of [started, claimed, waiting]) {
      const parsed = parseWorkflowRun(snapshot, snapshot.runId);
      expect(parsed).toEqual(snapshot);
      expect(parsed).not.toBe(snapshot);
      parsed.actions.length = 0;
      expect(snapshot.actions).toHaveLength(1);
    }
  });

  it('rejects incomplete, unsupported or inconsistent Run identities before recovery', async () => {
    const { started } = await fixture();
    const malformed: unknown[] = [
      null,
      [],
      { ...started, schemaVersion: 2 },
      { ...started, revision: 0 },
      { ...started, input: undefined },
      { ...started, unknown: true },
      { ...started, lineage: [started.runId] },
      { ...started, lineage: ['ancestor', 'ancestor'] },
      { ...started, lineage: Array.from({ length: 33 }, (_, i) => `ancestor-${i}`) },
      { ...started, definitionHashes: {} },
      { ...started, definitionHashes: { '["report","1"]': 'a'.repeat(64) } },
      { ...started, status: 'accepted' },
      { ...started, sequence: 1.5 },
      { ...started, ready: {} },
      { ...started, joins: [] },
    ];
    for (const invalid of malformed) expect(() => parseWorkflowRun(invalid)).toThrow();
    for (const field of ['definitionHashes', 'lineage', 'input', 'actions', 'waits', 'children']) {
      const invalid = { ...started } as Record<string, unknown>;
      delete invalid[field];
      expect(() => parseWorkflowRun(invalid)).toThrow();
    }
    expect(() => parseWorkflowRun(started, 'another-run')).toThrow(/INVALID_RUN/);
  });

  it('rejects a lifecycle status that contradicts the persisted pending work', async () => {
    const { started } = await fixture();

    expect(() => parseWorkflowRun({ ...started, status: 'waiting' })).toThrow(/INVALID_RUN/);
    expect(() => parseWorkflowRun({ ...started, status: 'completed' })).toThrow(/INVALID_RUN/);
    expect(() => parseWorkflowRun({ ...started, status: 'failed' })).toThrow(/INVALID_RUN/);
  });
  it('accepts receipt-bound queued work and keeps empty or terminal snapshots closed', async () => {
    const { store, runtime, waiting } = await fixture();
    // 检查持久化边界的恢复快照；原执行收据始终来自真实 Runtime。
    const queued: WorkflowRun = {
      ...waiting,
      revision: waiting.revision + 1,
      sequence: 1,
      status: 'running',
      waits: [],
      ready: [
        {
          from: 'collect',
          to: 'approve',
          results: waiting.waits[0].results,
          activation: { repairSource: waiting.actions[0].id },
        },
      ],
    };
    expect(() => parseWorkflowRun({ ...queued, ready: [] })).toThrow('running Run');
    await store.compareAndSwap(waiting.runId, waiting.revision, queued);
    expect(await runtime.inspect(waiting.runId)).toEqual(queued);
    const scheduled = await runtime.next({ runId: waiting.runId });
    expect(scheduled.waits.at(-1)).toMatchObject({
      stepId: 'approve',
      status: 'pending',
      proposal: {
        activation: { repairSource: waiting.actions[0].id },
        outputs: { collect: { report: 'v1' } },
      },
    });
    expect(scheduled.actions).toEqual(waiting.actions);
    const terminal: WorkflowRun = {
      ...queued,
      revision: scheduled.revision + 1,
      status: 'failed',
      reason: 'ACTION_FAILED: collect',
    };
    await store.compareAndSwap(waiting.runId, scheduled.revision, terminal);
    expect(await runtime.next({ runId: waiting.runId })).toEqual(terminal);
  });

  it.each(['missing-source', 'wrong-output', 'wrong-sequence', 'missing-target', 'entry-replay'])(
    'rejects a fabricated queued token before scheduling (%s)',
    async (scenario) => {
      const { store, runtime, waiting } = await fixture();
      const queued: WorkflowRun = {
        ...waiting,
        revision: waiting.revision + 1,
        sequence: 1,
        status: 'running',
        waits: [],
        ready: [
          {
            from: 'collect',
            to: 'approve',
            results: structuredClone(waiting.waits[0].results),
          },
        ],
      };
      const token = queued.ready[0];
      if (scenario === 'missing-source')
        queued.ready[0] = { from: 'never', to: 'publish', results: {} };
      if (scenario === 'wrong-output') token.results.collect.value = { report: 'forged' };
      if (scenario === 'wrong-sequence') token.results.collect.sequence += 1;
      if (scenario === 'missing-target') token.to = 'not-declared';
      if (scenario === 'entry-replay') queued.ready[0] = { from: null, to: 'collect', results: {} };
      await store.compareAndSwap(waiting.runId, waiting.revision, queued);
      await expect(runtime.inspect(waiting.runId)).rejects.toMatchObject({ code: 'INVALID_RUN' });
      await expect(runtime.next({ runId: waiting.runId })).rejects.toMatchObject({
        code: 'INVALID_RUN',
      });
      expect(await store.read(waiting.runId)).toEqual(queued);
    },
  );
});
