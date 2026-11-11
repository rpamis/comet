import { expect, it } from 'vitest';

import {
  createRuntime,
  defineWorkflow,
  hashRuntimeValue,
  createMemoryRuntimeStore,
  preserveRuntimeExecutionOrigins,
} from '../../../domains/engine/runtime.js';
import { cancelRuntimeAction } from '../../../domains/engine/runtime-action.js';

// 用户决定只模拟隔离数据夹具；没有执行器或真实命令。
it('reads retired settled history without restoring execution and preserves current binding checks', async () => {
  const v1 = {
    id: 'classic-history-probe',
    version: '1',
    entry: 'seed',
    steps: {
      seed: { type: 'invoke_skill', ref: 'requirements@1' },
      approve: { type: 'ask_user', proposalFrom: ['seed'], choices: ['approved', 'rejected'] },
      'old.check': { type: 'call_tool', ref: 'removed-managed-check' },
      'old.evidence': {
        type: 'await_evidence',
        kind: 'managed-check',
        validator: { id: 'proof', version: '1' },
      },
      business: { type: 'invoke_skill', ref: 'agent-build@1' },
    },
    commands: { prepare: { stepId: 'old.check' } },
    transitions: [
      { from: 'seed', to: 'approve' },
      { from: 'approve', on: 'approved', to: 'old.check' },
      { from: 'old.check', to: 'old.evidence' },
      { from: 'old.evidence', to: 'business' },
    ],
  };
  const v2 = defineWorkflow({
    id: v1.id,
    version: '2',
    entry: 'seed',
    steps: { seed: v1.steps.seed, approve: v1.steps.approve, business: v1.steps.business },
    transitions: [
      { from: 'seed', to: 'approve' },
      { from: 'approve', to: 'business', on: 'approved' },
    ],
  });
  const store = createMemoryRuntimeStore();
  const runtime = createRuntime({
    store,
    workflows: [v1],
    evidenceValidators: [
      {
        id: 'proof',
        version: '1',
        validate: ({ contentHash }) => ({ accepted: true, actualHash: contentHash }),
      },
    ],
  });
  let run = await runtime.start({
    runId: 'same-run',
    workflow: { id: v1.id, version: '1' },
    input: {
      change: 'sample',
      configuration: { execution: 'agent' },
      tasks: [{ id: 't1', done: true }],
    },
  });
  let seed = run.actions[0];
  run = await runtime.claim({
    runId: run.runId,
    actionId: seed.id,
    attempt: seed.attempt,
    inputHash: seed.inputHash,
    executorId: 'manual-probe',
    claimToken: 'seed-claim',
  });
  run = await runtime.recordOutcome({
    runId: run.runId,
    outcome: {
      actionId: seed.id,
      attempt: seed.attempt,
      inputHash: seed.inputHash,
      claimToken: 'seed-claim',
      outcomeId: 'requirements-result',
      status: 'succeeded',
      output: { requirements: 'approved input' },
    },
  });
  run = await runtime.resolveWait({
    runId: run.runId,
    waitId: run.waits[0].id,
    proposalHash: run.waits[0].proposalHash,
    decisionId: 'real-approval',
    choice: 'approved',
    expectedRevision: run.revision,
  });
  run = await runtime.dispatchCommand({
    runId: run.runId,
    name: 'prepare',
    commandId: 'prepare-once',
    input: { scope: 'build' },
    expectedRevision: run.revision,
  });
  const commandPending = structuredClone(run);
  let action = run.actions.at(-1);
  run = await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'manual-probe',
    claimToken: 'original-claim',
    sessionId: 'original-session',
    expectedRevision: run.revision,
  });
  const commandRunning = structuredClone(run);
  run = await runtime.markUnknown({
    runId: run.runId,
    actionId: run.actions.at(-1).id,
    attempt: run.actions.at(-1).attempt,
    reason: '原外部结果未确认',
    expectedRevision: run.revision,
  });
  const commandUnknown = structuredClone(run);
  action = run.actions.at(-1);
  run = await runtime.recordOutcome({
    runId: run.runId,
    expectedRevision: run.revision,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: action.claim.token,
      outcomeId: 'old-accepted',
      status: 'succeeded',
      output: { exitCode: 0, receiptRef: 'logs/old.log' },
    },
  });
  const evidencePending = structuredClone(run);
  run = await runtime.recordEvidence({
    runId: run.runId,
    evidenceId: run.evidenceWaits[0].id,
    kind: 'managed-check',
    ref: 'logs/old.log',
    contentHash: 'a'.repeat(64),
    submissionId: 'accepted-proof',
    expectedRevision: run.revision,
  });
  const completeHistory = structuredClone(run);
  function migrate(raw, cancel = true) {
    const r = preserveRuntimeExecutionOrigins(raw);
    r.workflow = { id: v2.id, version: v2.version, hash: hashRuntimeValue(v2) };
    r.definitionHashes = { [JSON.stringify([v2.id, v2.version])]: r.workflow.hash };
    if (cancel) {
      r.actions = r.actions.map((a) =>
        a.stepId === 'old.check'
          ? cancelRuntimeAction(a, '旧受管检查调度已退休；不声明外部进程停止')
          : a,
      );
      for (const w of r.evidenceWaits ?? [])
        if (w.stepId === 'old.evidence' && w.status === 'pending') w.status = 'cancelled';
      if (!r.actions.some((a) => a.stepId === 'business' && a.status === 'pending')) {
        r.status = 'running';
        const approval = r.waits.find((w) => w.stepId === 'approve' && w.status === 'resolved');
        r.ready = [
          {
            from: 'approve',
            to: 'business',
            results: {
              ...approval.results,
              approve: {
                sequence: approval.sequence,
                value: { choice: approval.decision.choice, proposal: approval.proposal },
              },
            },
          },
        ];
        r.joins = {};
      }
    }
    return r;
  }
  function open(r) {
    let held = structuredClone(r);
    return createRuntime({
      workflows: [v2],
      store: {
        read: async () => held,
        compareAndSwap: async (id, rev, next) => {
          if (rev !== held.revision) return false;
          held = structuredClone(next);
          return true;
        },
      },
    });
  }
  const observations = [];
  async function check(name, r, fn) {
    try {
      const rt = open(r);
      const x = await (fn ? fn(rt, r) : rt.inspect(r.runId));
      observations.push({ name, ok: true, status: x?.status, actions: x?.actions?.length });
      return x;
    } catch (e) {
      observations.push({ name, ok: false, code: e.code, message: e.message });
    }
  }
  const migrated = migrate(completeHistory);
  await check('settled-history-accepted', migrated);
  await check('pending-evidence-cancelled', migrate(evidencePending));
  const mr = migrate(commandRunning),
    mu = migrate(commandUnknown);
  await check('old-running-command-cancelled-without-stop', mr);
  await check('old-unknown-command-cancelled-without-stop', mu);
  observations.push({
    name: 'cancel-is-not-stop',
    ok: [mr, mu].every((r) => {
      const a = r.actions.find((a) => a.claim?.token === 'original-claim');
      return (
        a.status === 'cancelled' &&
        !a.executionStop &&
        !a.cancellation &&
        !a.outcome &&
        a.claim.sessionId === 'original-session'
      );
    }),
  });
  await check('pending-evidence-unknown-step-rejected', migrate(evidencePending, false));
  await check('pending-command-unknown-step-rejected', migrate(commandPending, false));
  await check('running-command-unknown-step-rejected', migrate(commandRunning, false));
  await check('unknown-command-unknown-step-rejected', migrate(commandUnknown, false));
  const authorizationToken = structuredClone(migrated);
  const ew = authorizationToken.evidenceWaits[0];
  authorizationToken.ready = [
    {
      from: ew.stepId,
      to: 'business',
      results: {
        ...ew.results,
        [ew.stepId]: {
          sequence: ew.sequence,
          value: { ref: ew.receipt.ref, contentHash: ew.receipt.contentHash },
        },
      },
    },
  ];
  await check('historical-evidence-cannot-authorize-new-edge', authorizationToken);
  const badHash = structuredClone(migrated);
  badHash.commands[0].inputHash = 'b'.repeat(64);
  await check('historical-command-activation-hash-mismatch-rejected', badHash);
  const missingReceipt = structuredClone(migrated);
  delete missingReceipt.evidenceWaits[0].receipt;
  await check('resolved-evidence-without-receipt-rejected', missingReceipt);
  const badSequence = structuredClone(migrated);
  badSequence.evidenceWaits[0].sequence = 1;
  await check('historical-sequence-corruption-rejected', badSequence);
  await check('old-evidence-cannot-be-resubmitted', migrated, (rt, r) =>
    rt.recordEvidence({
      runId: r.runId,
      evidenceId: r.evidenceWaits[0].id,
      kind: 'managed-check',
      ref: 'logs/old.log',
      contentHash: 'a'.repeat(64),
      submissionId: 'new',
      expectedRevision: r.revision,
    }),
  );
  await check('removed-command-new-request-rejected', migrated, (rt, r) =>
    rt.dispatchCommand({
      runId: r.runId,
      name: 'prepare',
      commandId: 'new-id',
      input: { scope: 'build' },
      expectedRevision: r.revision,
    }),
  );
  await check('current-business-can-complete', migrated, async (rt, r) => {
    const a = r.actions.find((a) => a.stepId === 'business' && a.status === 'pending');
    let c = await rt.claim({
      runId: r.runId,
      actionId: a.id,
      attempt: a.attempt,
      inputHash: a.inputHash,
      executorId: 'agent',
      claimToken: 'agent-token',
      expectedRevision: r.revision,
    });
    return rt.recordOutcome({
      runId: r.runId,
      expectedRevision: c.revision,
      outcome: {
        actionId: a.id,
        attempt: a.attempt,
        inputHash: a.inputHash,
        claimToken: 'agent-token',
        outcomeId: 'agent-result',
        status: 'succeeded',
        output: { checks: [{ name: 'test', result: 'passed' }] },
      },
    });
  });

  const negative = [
    'pending-evidence-unknown-step-rejected',
    'pending-command-unknown-step-rejected',
    'running-command-unknown-step-rejected',
    'unknown-command-unknown-step-rejected',
    'historical-evidence-cannot-authorize-new-edge',
    'historical-command-activation-hash-mismatch-rejected',
    'resolved-evidence-without-receipt-rejected',
    'historical-sequence-corruption-rejected',
    'old-evidence-cannot-be-resubmitted',
    'removed-command-new-request-rejected',
  ];
  for (const result of observations)
    expect(result.ok, JSON.stringify(result)).toBe(!negative.includes(result.name));
  expect(observations).toHaveLength(16);
  expect(migrated.waits).toEqual(completeHistory.waits);
  expect(migrated.sequence).toBe(completeHistory.sequence);
  const converted = migrate(commandRunning);
  const continued = await open(converted).next({ runId: converted.runId });
  expect(continued.sequence).toBe(commandRunning.sequence + 1);
  expect(continued.actions.at(-1)).toMatchObject({ stepId: 'business', status: 'pending' });
  expect(continued.actions.find((a) => a.claim?.token === 'original-claim')).toMatchObject({
    status: 'cancelled',
    claim: { sessionId: 'original-session' },
  });
  expect(continued.actions.find((a) => a.claim?.token === 'original-claim')).not.toHaveProperty(
    'executionStop',
  );
});
