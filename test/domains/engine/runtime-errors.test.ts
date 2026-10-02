import { expect, test } from 'vitest';
import {
  createMemoryRuntimeStore,
  createRuntime,
  RuntimeProtocolError,
} from '../../../domains/engine/runtime.js';

test.each([
  ['REVISION_CONFLICT', 'inspect-run'],
  ['STALE_PROPOSAL', 'review-proposal'],
  ['EXECUTION_UNKNOWN', 'reconcile-execution'],
  ['ACTION_IN_FLIGHT', 'reconcile-execution'],
  ['RECONCILIATION_REQUIRED', 'reconcile-execution'],
  ['OUTPUT_INVALID', 'inspect-outcome'],
  ['OUTCOME_PROCESSING_ERROR', 'inspect-outcome'],
  ['WORKFLOW_CHANGED', 'restore-definition'],
  ['STORE_CORRUPT_RECORD', 'repair-storage'],
  ['INVALID_JSON', 'correct-input'],
  ['FUTURE_HOST_ERROR', 'manual-review'],
  ['toString', 'manual-review'],
])('provides recovery guidance for %s without changing its code', (code, recovery) => {
  const error = new RuntimeProtocolError(code, 'details');
  expect(error).toMatchObject({ name: 'RuntimeProtocolError', code, recovery });
  expect(error.message).toBe(`${code}: details`);
});

test('an unknown executor result recommends reconciliation without executing again', async () => {
  let executions = 0;
  const runtime = createRuntime({
    store: createMemoryRuntimeStore(),
    workflows: [
      {
        id: 'unknown',
        version: '1',
        entry: 'write',
        steps: { write: { type: 'call_tool', ref: 'write' } },
      },
    ],
    executors: [
      {
        id: 'host',
        capabilities: [],
        supports: () => true,
        async execute() {
          executions++;
          throw new Error('connection lost');
        },
      },
    ],
  });
  const run = await runtime.start({
    runId: 'unknown',
    workflow: { id: 'unknown', version: '1' },
    input: null,
  });
  await expect(
    runtime.execute({ runId: run.runId, actionId: run.actions[0].id, executorId: 'host' }),
  ).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN', recovery: 'reconcile-execution' });
  const saved = await runtime.next({ runId: run.runId });
  expect(saved.actions[0]).toMatchObject({ status: 'unknown', attempt: 1 });
  expect(executions).toBe(1);
});
