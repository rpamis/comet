import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { createRuntime } = await import(`${process.argv[3] ?? '@rpamis/comet'}/runtime`);
const fixture = JSON.parse(await readFile(process.argv[2], 'utf8'));

// 适配器只为冻结的测试样本提供初始事实，运行时提交仍须通过 revision CAS。
function fixtureStore(record) {
  let saved = structuredClone(record);
  return {
    async read(runId) {
      return saved.runId === runId ? structuredClone(saved) : null;
    },
    async compareAndSwap(runId, expectedRevision, next) {
      assert.equal(next.runId, runId);
      assert.equal(next.revision, expectedRevision + 1);
      if (saved.runId !== runId || saved.revision !== expectedRevision) return false;
      saved = structuredClone(next);
      return true;
    },
  };
}

let executions = 0;
const executor = {
  id: 'consumer-host',
  capabilities: [],
  supports: (action) => action.ref === 'write',
  async execute() {
    executions++;
    return { status: 'succeeded', output: { written: true } };
  },
};
const runtime = createRuntime({
  store: fixtureStore(fixture.waiting),
  workflows: [fixture.workflow],
  executors: [executor],
});
const waiting = await runtime.inspect('baseline-report');
assert.equal(waiting.status, 'waiting');
assert.equal(waiting.revision, 3);
assert.equal(waiting.actions[0].status, 'succeeded');
const wait = waiting.waits[0];
await assert.rejects(
  runtime.resolveWait({
    runId: waiting.runId,
    waitId: wait.id,
    proposalHash: 'stale',
    decisionId: 'stale-decision',
    choice: 'approved',
  }),
  { code: 'STALE_PROPOSAL' },
);
assert.equal((await runtime.inspect(waiting.runId)).revision, 3);
let run = await runtime.resolveWait({
  runId: waiting.runId,
  waitId: wait.id,
  proposalHash: wait.proposalHash,
  decisionId: 'consumer-decision',
  choice: 'approved',
});
const action = run.actions.find((item) => item.status === 'pending');
assert.ok(action);
run = await runtime.execute({ runId: run.runId, actionId: action.id, executorId: executor.id });
assert.equal(run.status, 'completed');
assert.equal(run.actions[0].id, waiting.actions[0].id);
assert.deepEqual(run.outputs.write, { sequence: 3, value: { written: true } });
assert.equal(executions, 1);

const interrupted = createRuntime({
  store: fixtureStore(fixture.unknown),
  workflows: [fixture.workflow],
  executors: [executor],
});
const unknown = await interrupted.next({ runId: 'baseline-report' });
const unfinished = unknown.actions.find((item) => item.status === 'unknown');
assert.ok(unfinished);
assert.equal(unfinished.attempt, 1);
assert.equal(unfinished.claim.executorId, 'baseline-host');
assert.equal(unknown.waits[0].decision.id, 'baseline-user-decision');
await assert.rejects(
  interrupted.retry({ runId: unknown.runId, actionId: unfinished.id, attempt: unfinished.attempt }),
  { code: 'RECONCILIATION_REQUIRED' },
);
assert.equal((await interrupted.inspect(unknown.runId)).actions.at(-1).status, 'unknown');
assert.equal(executions, 1);

const changedDefinition = structuredClone(fixture.workflow);
changedDefinition.steps.write.ref = 'different-tool';
const drifted = createRuntime({
  store: fixtureStore(fixture.waiting),
  workflows: [changedDefinition],
});
await assert.rejects(drifted.inspect('baseline-report'), { code: 'WORKFLOW_CHANGED' });
console.log(
  JSON.stringify({
    baselineCommit: fixture.source.commit,
    approval: run.status,
    unknown: 'unknown',
    executions,
    staleApprovalRejected: true,
    definitionDriftRejected: true,
    unsafeRetryRejected: true,
  }),
);
