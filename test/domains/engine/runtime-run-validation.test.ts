import { describe, expect, it } from 'vitest';
import { createRuntime } from '../../../domains/engine/runtime-service.js';
import { createMemoryRuntimeStore } from '../../../domains/engine/runtime-store.js';
import { parseWorkflowRun } from '../../../domains/engine/workflow-run-validation.js';
import type { WorkflowRun } from '../../../domains/engine/workflow-run.js';

async function fixture() {
  const runtime = createRuntime({
    store: createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [
      {
        id: 'report',
        version: '1',
        entry: 'collect',
        steps: {
          collect: { type: 'call_tool', ref: 'collect', retry: 'idempotent' },
          approve: { type: 'ask_user', proposalFrom: 'collect' },
          publish: { type: 'call_tool', ref: 'publish' },
        },
        transitions: [
          { from: 'collect', to: 'approve' },
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
  return { runtime, started, claimed, waiting };
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
});
