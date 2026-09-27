import { describe, expect, it } from 'vitest';
import {
  createMemoryRuntimeStore,
  createRuntime,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';

const workflow = {
  id: 'native-example',
  version: '1',
  entry: 'shape',
  initialState: { phase: 'shape' },
  stateSchema: {
    type: 'object',
    required: ['phase'],
    additionalProperties: false,
    properties: { phase: { enum: ['shape', 'build'] } },
  },
  transitionHandler: { id: 'native-transition', version: '1' },
  steps: {
    shape: { type: 'invoke_skill', ref: 'native.shape' },
    build: { type: 'invoke_skill', ref: 'native.build' },
  },
  transitions: [{ from: 'shape', to: 'build' }],
} as const;

describe('workflow-owned state transitions', () => {
  it('validates an external command before replacing pending work', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [
        {
          id: 'guarded-command',
          version: '1',
          entry: 'prepare',
          commands: {
            revise: { stepId: 'revise', validator: { id: 'revise-guard', version: '1' } },
          },
          steps: {
            prepare: { type: 'call_tool', ref: 'prepare' },
            revise: { type: 'call_tool', ref: 'revise' },
          },
        },
      ],
      commandValidators: [
        {
          id: 'revise-guard',
          version: '1',
          validate({ input }) {
            return { accepted: (input as { allowed?: boolean })?.allowed === true };
          },
        },
      ],
    });
    const before = await runtime.start({
      runId: 'guarded-command-run',
      workflow: { id: 'guarded-command', version: '1' },
      input: null,
    });
    await expect(
      runtime.dispatchCommand({
        runId: before.runId,
        expectedRevision: before.revision,
        commandId: 'revise-denied',
        name: 'revise',
        input: { allowed: false },
      }),
    ).rejects.toMatchObject({ code: 'COMMAND_REJECTED' });
    expect(await runtime.inspect(before.runId)).toEqual(before);
    const accepted = await runtime.dispatchCommand({
      runId: before.runId,
      expectedRevision: before.revision,
      commandId: 'revise-allowed',
      name: 'revise',
      input: { allowed: true },
    });
    expect(accepted.actions).toMatchObject([
      { status: 'cancelled' },
      { stepId: 'revise', status: 'pending' },
    ]);
  });
  it('dispatches a declared command as a durable Action and supersedes an unclaimed proposal', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [
        {
          id: 'command-example',
          version: '1',
          entry: 'prepare',
          commands: { revise: 'revise' },
          steps: {
            prepare: { type: 'call_tool', ref: 'prepare' },
            revise: { type: 'call_tool', ref: 'revise' },
          },
        },
      ],
    });
    const initial = await runtime.start({
      runId: 'command-example-run',
      workflow: { id: 'command-example', version: '1' },
      input: null,
    });
    const dispatched = await runtime.dispatchCommand({
      runId: initial.runId,
      expectedRevision: initial.revision,
      commandId: 'revise-1',
      name: 'revise',
      input: { reason: 'changed' },
    });
    expect(dispatched.actions[0].status).toBe('cancelled');
    expect(dispatched.actions.at(-1)).toMatchObject({
      stepId: 'revise',
      status: 'pending',
      input: {
        input: null,
        outputs: {},
        activation: { reason: 'changed' },
      },
    });
    expect((await runtime.inspect(initial.runId)).commands).toEqual([
      {
        id: 'revise-1',
        name: 'revise',
        inputHash: expect.any(String),
        actionId: dispatched.actions.at(-1)?.id,
      },
    ]);
    expect(
      await runtime.dispatchCommand({
        runId: initial.runId,
        expectedRevision: initial.revision,
        commandId: 'revise-1',
        name: 'revise',
        input: { reason: 'changed' },
      }),
    ).toEqual(dispatched);
    await expect(
      runtime.dispatchCommand({
        runId: initial.runId,
        expectedRevision: initial.revision,
        commandId: 'revise-2',
        name: 'revise',
        input: { reason: 'changed' },
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('does not interrupt a claimed Action or accept an undeclared command', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [
        {
          id: 'command-claimed',
          version: '1',
          entry: 'prepare',
          commands: { revise: 'revise' },
          steps: {
            prepare: { type: 'call_tool', ref: 'prepare' },
            revise: { type: 'call_tool', ref: 'revise' },
          },
        },
      ],
    });
    const started = await runtime.start({
      runId: 'command-claimed-run',
      workflow: { id: 'command-claimed', version: '1' },
      input: null,
    });
    await expect(
      runtime.dispatchCommand({
        runId: started.runId,
        expectedRevision: started.revision,
        commandId: 'unknown-1',
        name: 'unknown',
        input: null,
      }),
    ).rejects.toMatchObject({ code: 'COMMAND_NOT_FOUND' });
    await expect(
      runtime.dispatchCommand({
        runId: started.runId,
        expectedRevision: started.revision,
        commandId: 'prototype-1',
        name: 'toString',
        input: null,
      }),
    ).rejects.toMatchObject({ code: 'COMMAND_NOT_FOUND' });
    const action = started.actions[0];
    const claimed = await runtime.claim({
      runId: started.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'host',
      claimToken: 'claim-1',
    });
    await expect(
      runtime.dispatchCommand({
        runId: claimed.runId,
        expectedRevision: claimed.revision,
        commandId: 'revise-1',
        name: 'revise',
        input: null,
      }),
    ).rejects.toMatchObject({ code: 'ACTION_IN_FLIGHT' });
  });

  it('cancels a pending approval when a declared command supersedes its proposal', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [
        {
          id: 'command-wait',
          version: '1',
          entry: 'prepare',
          commands: { revise: 'revise' },
          steps: {
            prepare: { type: 'call_tool', ref: 'prepare' },
            confirm: { type: 'ask_user', proposalFrom: 'prepare' },
            revise: { type: 'call_tool', ref: 'revise' },
          },
          transitions: [{ from: 'prepare', to: 'confirm' }],
        },
      ],
    });
    let run = await runtime.start({
      runId: 'command-wait-run',
      workflow: { id: 'command-wait', version: '1' },
      input: null,
    });
    const prepare = run.actions[0];
    run = await runtime.claim({
      runId: run.runId,
      actionId: prepare.id,
      attempt: prepare.attempt,
      inputHash: prepare.inputHash,
      executorId: 'host',
      claimToken: 'prepare-claim',
    });
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: prepare.id,
        attempt: prepare.attempt,
        inputHash: prepare.inputHash,
        claimToken: 'prepare-claim',
        outcomeId: 'prepare-result',
        status: 'succeeded',
        output: { proposal: 'old' },
      },
    });
    const wait = run.waits[0];
    expect(wait.status).toBe('pending');
    run = await runtime.dispatchCommand({
      runId: run.runId,
      expectedRevision: run.revision,
      commandId: 'revise-wait',
      name: 'revise',
      input: null,
    });
    expect(run.waits[0].status).toBe('cancelled');
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'revise', status: 'pending' });
    await expect(
      runtime.resolveWait({
        runId: run.runId,
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: 'old-decision',
        choice: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'STALE_PROPOSAL' });
  });
  it('persists separately bound parallel Actions and waits for sibling outcomes', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const definition = {
      id: 'dynamic-fanout',
      version: '1',
      entry: 'plan',
      initialState: { phase: 'plan' },
      stateSchema: {
        type: 'object',
        required: ['phase'],
        additionalProperties: false,
        properties: { phase: { enum: ['plan', 'build'] } },
      },
      transitionHandler: { id: 'fanout-transition', version: '1' },
      steps: {
        plan: { type: 'call_tool', ref: 'make-plan' },
        worker: { type: 'handoff', ref: 'worker' },
        finish: { type: 'call_tool', ref: 'finish' },
      },
      transitions: [
        { from: 'plan', to: 'worker' },
        { from: 'worker', to: 'finish' },
      ],
    } as const;
    const options = {
      store,
      workflows: [definition],
      transitionHandlers: [
        {
          id: 'fanout-transition',
          version: '1',
          apply: ({ run, event }: { run: WorkflowRun; event: { stepId: string } }) => ({
            state: { phase: 'build' },
            next:
              event.stepId === 'plan'
                ? [
                    { stepId: 'worker', input: { taskId: 'alpha' } },
                    { stepId: 'worker', input: { taskId: 'beta' } },
                  ]
                : run.actions.filter(
                      (action) => action.stepId === 'worker' && action.status === 'succeeded',
                    ).length === 2
                  ? ['finish']
                  : [],
          }),
        },
      ],
    };
    const runtime = createRuntime(options);
    let run = await runtime.start({
      runId: 'parallel-tasks',
      workflow: { id: definition.id, version: definition.version },
      input: { project: 'example' },
    });
    const plan = run.actions[0];
    run = await runtime.claim({
      runId: run.runId,
      actionId: plan.id,
      attempt: plan.attempt,
      inputHash: plan.inputHash,
      executorId: 'planner',
      claimToken: 'plan-claim',
    });
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: plan.id,
        attempt: plan.attempt,
        inputHash: plan.inputHash,
        claimToken: 'plan-claim',
        outcomeId: 'plan-result',
        status: 'succeeded',
        output: { tasks: ['alpha', 'beta'] },
      },
    });
    const workers = run.actions.filter((action) => action.stepId === 'worker');
    expect(workers).toHaveLength(2);
    expect(workers.map((action) => action.input)).toEqual([
      {
        input: { project: 'example' },
        outputs: { plan: { tasks: ['alpha', 'beta'] } },
        activation: { taskId: 'alpha' },
      },
      {
        input: { project: 'example' },
        outputs: { plan: { tasks: ['alpha', 'beta'] } },
        activation: { taskId: 'beta' },
      },
    ]);
    const reopened = createRuntime(options);
    expect((await reopened.inspect(run.runId)).actions).toEqual(run.actions);
    for (const worker of workers) {
      run = await reopened.claim({
        runId: run.runId,
        actionId: worker.id,
        attempt: worker.attempt,
        inputHash: worker.inputHash,
        executorId: 'worker-host',
        claimToken: `claim-${worker.id}`,
      });
      run = await reopened.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: worker.id,
          attempt: worker.attempt,
          inputHash: worker.inputHash,
          claimToken: `claim-${worker.id}`,
          outcomeId: `result-${worker.id}`,
          status: 'succeeded',
          output: { done: true },
        },
      });
      if (worker.id === workers[0].id) {
        expect(run.actions.filter((action) => action.stepId === 'finish')).toHaveLength(0);
      }
    }
    expect(run.actions.filter((action) => action.stepId === 'finish')).toHaveLength(1);
  });

  it('lets an outcome validator check the current Run state before accepting a result', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [
        {
          id: 'state-bound-outcome',
          version: '1',
          entry: 'shape',
          stateSchema: {
            type: 'object',
            required: ['phase'],
            properties: { phase: { enum: ['shape'] } },
          },
          steps: {
            shape: {
              type: 'call_tool',
              ref: 'collect-shape',
              validator: { id: 'shape-state', version: '1' },
            },
          },
        },
      ],
      validators: [
        {
          id: 'shape-state',
          version: '1',
          validate: (input) => ({
            accepted: (input as typeof input & { run?: WorkflowRun }).run?.state?.phase === 'shape',
          }),
        },
      ],
    });
    const run = await runtime.start({
      runId: 'state-bound-outcome-run',
      workflow: { id: 'state-bound-outcome', version: '1' },
      input: null,
      initialState: { phase: 'shape' },
    });
    const action = run.actions[0];
    await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'shape-host',
      claimToken: 'shape-claim',
    });
    const completed = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'shape-claim',
        outcomeId: 'shape-result',
        status: 'succeeded',
        output: { acceptance: ['accepted'] },
      },
    });
    expect(completed.status).toBe('completed');
    expect(completed.state).toEqual({ phase: 'shape' });
  });

  it('starts separate Runs with different initial state under one stable workflow definition', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const definition = {
      id: 'classic-shared',
      version: '1',
      entry: 'open',
      stateSchema: {
        type: 'object',
        required: ['change', 'phase'],
        additionalProperties: false,
        properties: { change: { type: 'string' }, phase: { enum: ['open'] } },
      },
      steps: { open: { type: 'invoke_skill', ref: 'comet-open' } },
    } as const;
    const runtime = createRuntime({ store, workflows: [definition] });
    const first = await runtime.start({
      runId: 'classic-a',
      workflow: { id: definition.id, version: definition.version },
      input: { change: 'a' },
      initialState: { change: 'a', phase: 'open' },
    });
    const second = await runtime.start({
      runId: 'classic-b',
      workflow: { id: definition.id, version: definition.version },
      input: { change: 'b' },
      initialState: { change: 'b', phase: 'open' },
    });
    expect(first.workflow.hash).toBe(second.workflow.hash);
    expect(first.state).toEqual({ change: 'a', phase: 'open' });
    expect(second.state).toEqual({ change: 'b', phase: 'open' });
    const restarted = createRuntime({ store, workflows: [definition] });
    expect((await restarted.inspect(first.runId)).state).toEqual({ change: 'a', phase: 'open' });
    expect((await restarted.inspect(second.runId)).state).toEqual({ change: 'b', phase: 'open' });
  });

  it('gives an evidence validator the Run so it can reject another change receipt', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [
        {
          id: 'owned-evidence',
          version: '1',
          entry: 'proof',
          steps: {
            proof: {
              type: 'await_evidence',
              kind: 'proof',
              validator: { id: 'owned-proof', version: '1' },
            },
          },
        },
      ],
      evidenceValidators: [
        {
          id: 'owned-proof',
          version: '1',
          validate: (input) => {
            const run = (input as typeof input & { run?: WorkflowRun }).run;
            const change = (run?.input as { change?: string } | undefined)?.change;
            return {
              accepted: input.ref === `changes/${change}/proof.json`,
              actualHash: input.contentHash,
            };
          },
        },
      ],
    });
    const run = await runtime.start({
      runId: 'owned-evidence-run',
      workflow: { id: 'owned-evidence', version: '1' },
      input: { change: 'current' },
    });
    const submission = {
      runId: run.runId,
      evidenceId: run.evidenceWaits![0].id,
      kind: 'proof',
      contentHash: 'a'.repeat(64),
      submissionId: 'proof-1',
      expectedRevision: run.revision,
    };
    await expect(
      runtime.recordEvidence({ ...submission, ref: 'changes/other/proof.json' }),
    ).rejects.toThrow(/EVIDENCE_REJECTED/);
    const accepted = await runtime.recordEvidence({
      ...submission,
      ref: 'changes/current/proof.json',
    });
    expect(accepted.evidenceWaits?.[0].status).toBe('resolved');
  });

  it('invalidates a stale evidence wait only through its declared recovery transition', async () => {
    let actualHash = 'b'.repeat(64);
    let rejectionReason = 'proof changed';
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [
        {
          id: 'recover-stale-proof',
          version: '1',
          entry: 'proof',
          steps: {
            proof: {
              type: 'await_evidence',
              kind: 'proof',
              validator: { id: 'current-proof', version: '1' },
            },
            repair: { type: 'call_tool', ref: 'repair' },
          },
          transitions: [{ from: 'proof', to: 'repair', on: 'invalidated' }],
        },
      ],
      evidenceValidators: [
        {
          id: 'current-proof',
          version: '1',
          validate: ({ contentHash }) => ({
            accepted: contentHash === actualHash,
            actualHash,
            reason: rejectionReason,
          }),
        },
      ],
    });
    const run = await runtime.start({
      runId: 'stale-proof-run',
      workflow: { id: 'recover-stale-proof', version: '1' },
      input: null,
    });
    const submission = {
      runId: run.runId,
      evidenceId: run.evidenceWaits![0].id,
      kind: 'proof',
      ref: 'proof.json',
      contentHash: 'a'.repeat(64),
      submissionId: 'stale-proof-1',
      expectedRevision: run.revision,
    };
    await expect(runtime.recordEvidence(submission)).rejects.toThrow(/EVIDENCE_REJECTED/u);
    const invalidated = await runtime.invalidateEvidence(submission);
    expect(invalidated.status).toBe('running');
    expect(invalidated.evidenceWaits?.[0]).toMatchObject({
      status: 'invalidated',
      invalidation: { ref: 'proof.json', contentHash: 'a'.repeat(64), reason: 'proof changed' },
    });
    expect(invalidated.actions.at(-1)).toMatchObject({ stepId: 'repair', status: 'pending' });
    await expect(runtime.invalidateEvidence(submission)).rejects.toThrow();

    actualHash = 'a'.repeat(64);
    const fresh = await runtime.start({
      runId: 'fresh-proof-run',
      workflow: { id: 'recover-stale-proof', version: '1' },
      input: null,
    });
    await expect(
      runtime.invalidateEvidence({
        ...submission,
        runId: fresh.runId,
        evidenceId: fresh.evidenceWaits![0].id,
        expectedRevision: fresh.revision,
      }),
    ).rejects.toThrow(/EVIDENCE_STILL_VALID/u);
    expect((await runtime.inspect(fresh.runId)).evidenceWaits?.[0].status).toBe('pending');

    actualHash = 'b'.repeat(64);
    rejectionReason = 'x'.repeat(5000);
    const oversized = await runtime.start({
      runId: 'long-reason-run',
      workflow: { id: 'recover-stale-proof', version: '1' },
      input: null,
    });
    await runtime.invalidateEvidence({
      ...submission,
      runId: oversized.runId,
      evidenceId: oversized.evidenceWaits![0].id,
      expectedRevision: oversized.revision,
    });
    expect(
      (await runtime.inspect(oversized.runId)).evidenceWaits?.[0].invalidation?.reason.length,
    ).toBe(4096);
  });

  it('rejects start when neither the definition nor the caller supplies required state', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [
        {
          id: 'missing-initial-state',
          version: '1',
          entry: 'shape',
          stateSchema: { type: 'object' },
          steps: { shape: { type: 'invoke_skill', ref: 'native.shape' } },
        },
      ],
    });
    await expect(
      runtime.start({
        runId: 'missing-initial-state-run',
        workflow: { id: 'missing-initial-state', version: '1' },
        input: null,
      }),
    ).rejects.toThrow(/INITIAL_STATE_REQUIRED/);
  });

  it('does not treat a repeated start with different initial state as idempotent', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [
        {
          id: 'per-change-state',
          version: '1',
          entry: 'open',
          stateSchema: {
            type: 'object',
            required: ['change'],
            properties: { change: { type: 'string' } },
          },
          steps: { open: { type: 'invoke_skill', ref: 'comet-open' } },
        },
      ],
    });
    const command = {
      runId: 'one-change',
      workflow: { id: 'per-change-state', version: '1' },
      input: { change: 'same-input' },
    };
    const first = await runtime.start({ ...command, initialState: { change: 'a' } });
    expect(first.state).toEqual({ change: 'a' });
    expect(await runtime.start({ ...command, initialState: { change: 'a' } })).toEqual(first);
    await expect(runtime.start({ ...command, initialState: { change: 'b' } })).rejects.toThrow(
      /RUN_CONFLICT/,
    );
  });

  it('rejects a restored dynamic-state Run that lost its initial-state binding', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const workflow = {
      id: 'dynamic-state-binding',
      version: '1',
      entry: 'open',
      stateSchema: {
        type: 'object',
        required: ['change'],
        properties: { change: { type: 'string' } },
      },
      steps: { open: { type: 'invoke_skill', ref: 'comet-open' } },
    } as const;
    const runtime = createRuntime({ store, workflows: [workflow] });
    const run = await runtime.start({
      runId: 'dynamic-state-lost-hash',
      workflow: { id: workflow.id, version: workflow.version },
      input: { change: 'example' },
      initialState: { change: 'example' },
    });
    const { initialStateHash: _lost, ...withoutBinding } = run;
    expect(
      await store.compareAndSwap(run.runId, run.revision, {
        ...withoutBinding,
        revision: run.revision + 1,
      }),
    ).toBe(true);
    await expect(runtime.inspect(run.runId)).rejects.toThrow(/INVALID_RUN/);
  });

  it('does not start an evidence wait without its declared validator', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [
        {
          id: 'evidence-only',
          version: '1',
          entry: 'proof',
          steps: {
            proof: {
              type: 'await_evidence',
              kind: 'proof',
              validator: { id: 'proof-validator', version: '1' },
            },
          },
        },
      ],
    });
    await expect(
      runtime.start({
        runId: 'proof-1',
        workflow: { id: 'evidence-only', version: '1' },
        input: null,
      }),
    ).rejects.toThrow(/EVIDENCE_VALIDATOR_UNAVAILABLE/);
  });

  it('cancels an unresolved evidence wait with its run', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [
        {
          id: 'evidence-only',
          version: '1',
          entry: 'proof',
          steps: {
            proof: {
              type: 'await_evidence',
              kind: 'proof',
              validator: { id: 'proof-validator', version: '1' },
            },
          },
        },
      ],
      evidenceValidators: [
        {
          id: 'proof-validator',
          version: '1',
          validate: () => ({ accepted: true, actualHash: 'a'.repeat(64) }),
        },
      ],
    });
    const run = await runtime.start({
      runId: 'proof-cancelled',
      workflow: { id: 'evidence-only', version: '1' },
      input: null,
    });
    expect(run.evidenceWaits?.[0].status).toBe('pending');
    const cancelled = await runtime.cancel({ runId: run.runId, reason: 'user cancelled' });
    expect(cancelled.evidenceWaits?.[0].status).toBe('cancelled');
    expect((await runtime.inspect(run.runId)).evidenceWaits?.[0].status).toBe('cancelled');
  });

  it('rejects a persisted evidence wait whose kind no longer matches its pinned step', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const runtime = createRuntime({
      store,
      workflows: [
        {
          id: 'evidence-only',
          version: '1',
          entry: 'proof',
          steps: {
            proof: {
              type: 'await_evidence',
              kind: 'proof',
              validator: { id: 'proof-validator', version: '1' },
            },
          },
        },
      ],
      evidenceValidators: [
        {
          id: 'proof-validator',
          version: '1',
          validate: () => ({ accepted: true, actualHash: 'a'.repeat(64) }),
        },
      ],
    });
    const run = await runtime.start({
      runId: 'proof-tampered',
      workflow: { id: 'evidence-only', version: '1' },
      input: null,
    });
    expect(
      await store.compareAndSwap(run.runId, run.revision, {
        ...run,
        revision: run.revision + 1,
        evidenceWaits: [{ ...run.evidenceWaits![0], kind: 'other' }],
      }),
    ).toBe(true);
    await expect(runtime.inspect(run.runId)).rejects.toThrow(/INVALID_RUN/);
  });

  it('waits for validated evidence before advancing and commits its state with the receipt', async () => {
    const evidenceWorkflow = {
      id: 'classic-example',
      version: '1',
      entry: 'tasks',
      initialState: { phase: 'build-pending' },
      stateSchema: {
        type: 'object',
        required: ['phase'],
        additionalProperties: false,
        properties: { phase: { enum: ['build-pending', 'build'] } },
      },
      transitionHandler: { id: 'classic-transition', version: '1' },
      steps: {
        tasks: {
          type: 'await_evidence',
          kind: 'tasks-complete',
          validator: { id: 'tasks-validator', version: '1' },
        },
        build: { type: 'invoke_skill', ref: 'comet-build' },
      },
      transitions: [{ from: 'tasks', to: 'build' }],
    } as const;
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const options = {
      store,
      workflows: [evidenceWorkflow],
      transitionHandlers: [
        {
          id: 'classic-transition',
          version: '1',
          apply: () => ({ state: { phase: 'build' }, next: ['build'] }),
        },
      ],
      evidenceValidators: [
        {
          id: 'tasks-validator',
          version: '1',
          validate: ({ contentHash }: { contentHash: string }) => ({
            accepted: true,
            actualHash: contentHash,
          }),
        },
      ],
    };
    const runtime = createRuntime(options);
    let run = await runtime.start({
      runId: 'classic-evidence-1',
      workflow: { id: evidenceWorkflow.id, version: evidenceWorkflow.version },
      input: null,
    });
    expect(run.status).toBe('waiting');
    expect(run.actions).toHaveLength(0);
    expect(run.evidenceWaits[0]).toMatchObject({
      stepId: 'tasks',
      kind: 'tasks-complete',
      status: 'pending',
    });
    run = await runtime.recordEvidence({
      runId: run.runId,
      evidenceId: run.evidenceWaits[0].id,
      kind: 'tasks-complete',
      ref: 'tasks.md',
      contentHash: 'a'.repeat(64),
      submissionId: 'tasks-checked-1',
      expectedRevision: run.revision,
    });
    expect(run.state).toEqual({ phase: 'build' });
    expect(run.evidenceWaits[0]).toMatchObject({
      status: 'resolved',
      receipt: {
        ref: 'tasks.md',
        contentHash: 'a'.repeat(64),
        submissionId: 'tasks-checked-1',
      },
    });
    expect(run.actions[0]).toMatchObject({ stepId: 'build', status: 'pending' });
    expect(await createRuntime(options).inspect(run.runId)).toEqual(run);
  });

  it('cannot start a workflow when its pinned transition handler is unavailable', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [workflow],
    });
    await expect(
      runtime.start({
        runId: 'native-missing-handler',
        workflow: { id: workflow.id, version: workflow.version },
        input: null,
      }),
    ).rejects.toThrow(/TRANSITION_HANDLER_UNAVAILABLE/);
  });

  it('cannot start when the initial state violates the declared schema', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [{ ...workflow, initialState: { phase: 'archive' } }],
      transitionHandlers: [
        {
          id: 'native-transition',
          version: '1',
          apply: () => ({ state: { phase: 'build' }, next: ['build'] }),
        },
      ],
    });
    await expect(
      runtime.start({
        runId: 'native-invalid-initial-state',
        workflow: { id: workflow.id, version: workflow.version },
        input: null,
      }),
    ).rejects.toThrow(/INITIAL_STATE_INVALID/);
  });

  it('rejects a workflow that declares state without a schema', () => {
    const { stateSchema: unusedSchema, ...withoutSchema } = workflow;
    expect(unusedSchema).toBeDefined();
    expect(() =>
      createRuntime({
        store: createMemoryRuntimeStore<WorkflowRun>(),
        workflows: [withoutSchema],
      }),
    ).toThrow(/INVALID_WORKFLOW/);
  });

  it('rejects an asynchronous state schema before creating a Run', () => {
    expect(() =>
      createRuntime({
        store: createMemoryRuntimeStore<WorkflowRun>(),
        workflows: [{ ...workflow, stateSchema: { $async: true, type: 'object' } }],
      }),
    ).toThrow(/INVALID_WORKFLOW/);
  });

  it('refuses to resume a run without its pinned transition handler', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const runtime = createRuntime({
      store,
      workflows: [workflow],
      transitionHandlers: [
        {
          id: 'native-transition',
          version: '1',
          apply: () => ({ state: { phase: 'build' }, next: ['build'] }),
        },
      ],
    });
    await runtime.start({
      runId: 'native-handler-resume',
      workflow: { id: workflow.id, version: workflow.version },
      input: null,
    });
    const resumed = createRuntime({ store, workflows: [workflow] });
    await expect(resumed.inspect('native-handler-resume')).rejects.toThrow(
      /TRANSITION_HANDLER_UNAVAILABLE/,
    );
  });

  it('refuses to resume a run whose workflow-owned state violates its schema', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const runtime = createRuntime({
      store,
      workflows: [workflow],
      transitionHandlers: [
        {
          id: 'native-transition',
          version: '1',
          apply: () => ({ state: { phase: 'build' }, next: ['build'] }),
        },
      ],
    });
    const run = await runtime.start({
      runId: 'native-state-resume',
      workflow: { id: workflow.id, version: workflow.version },
      input: null,
    });
    expect(
      await store.compareAndSwap(run.runId, run.revision, {
        ...run,
        revision: run.revision + 1,
        state: { phase: 'archive' },
      }),
    ).toBe(true);
    await expect(runtime.inspect(run.runId)).rejects.toThrow(/RUN_STATE_INVALID/);
  });

  it('commits accepted outcome, state, and next step in one Run revision', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const options = {
      store,
      workflows: [workflow],
      transitionHandlers: [
        {
          id: 'native-transition',
          version: '1',
          apply: ({ event }: { event: { stepId: string } }) => ({
            state: { phase: event.stepId === 'shape' ? 'build' : 'shape' },
            next: event.stepId === 'shape' ? ['build'] : [],
          }),
        },
      ],
    };
    const runtime = createRuntime(options);
    let run = await runtime.start({
      runId: 'native-1',
      workflow: { id: workflow.id, version: workflow.version },
      input: null,
    });
    expect(run.state).toEqual({ phase: 'shape' });
    const action = run.actions[0];
    run = await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'host',
      claimToken: 'claim-1',
    });
    const claimed = run.actions[0];
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: claimed.id,
        attempt: claimed.attempt,
        inputHash: claimed.inputHash,
        claimToken: claimed.claim!.token,
        outcomeId: 'shape-result-1',
        status: 'succeeded',
        output: { brief: 'accepted' },
      },
    });
    expect(run.state).toEqual({ phase: 'build' });
    expect(run.actions.map((item) => [item.stepId, item.status])).toEqual([
      ['shape', 'succeeded'],
      ['build', 'pending'],
    ]);
    expect(await store.read(run.runId)).toEqual(run);
    expect(await createRuntime(options).inspect(run.runId)).toEqual(run);
  });

  it('commits an approved wait and its workflow state in one Run revision', async () => {
    const approvalWorkflow = {
      ...workflow,
      stateSchema: {
        type: 'object',
        required: ['phase'],
        additionalProperties: false,
        properties: { phase: { enum: ['shape', 'approval', 'build'] } },
      },
      steps: {
        shape: { type: 'invoke_skill', ref: 'native.shape' },
        approval: { type: 'ask_user', proposalFrom: 'shape' },
        build: { type: 'invoke_skill', ref: 'native.build' },
      },
      transitions: [
        { from: 'shape', to: 'approval' },
        { from: 'approval', to: 'build', on: 'approved' },
      ],
    } as const;
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [approvalWorkflow],
      transitionHandlers: [
        {
          id: 'native-transition',
          version: '1',
          apply: ({ event }) =>
            (event.kind as string) === 'action-outcome'
              ? { state: { phase: 'approval' }, next: ['approval'] }
              : { state: { phase: 'build' }, next: ['build'] },
        },
      ],
    });
    let run = await runtime.start({
      runId: 'native-approved',
      workflow: { id: approvalWorkflow.id, version: approvalWorkflow.version },
      input: null,
    });
    const action = run.actions[0];
    run = await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'host',
      claimToken: 'claim-approved',
    });
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'claim-approved',
        outcomeId: 'shape-approved',
        status: 'succeeded',
        output: { proposal: 'build it' },
      },
    });
    expect(run.state).toEqual({ phase: 'approval' });
    const wait = run.waits[0];
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'decision-approved',
      choice: 'approved',
    });
    expect(run.state).toEqual({ phase: 'build' });
    expect(run.actions.at(-1)?.stepId).toBe('build');
  });

  it('rejects a next step that is not an allowed outgoing edge', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [workflow],
      transitionHandlers: [
        {
          id: 'native-transition',
          version: '1',
          apply: () => ({ state: { phase: 'build' }, next: ['build', 'shape'] }),
        },
      ],
    });
    let run = await runtime.start({
      runId: 'native-invalid-edge',
      workflow: { id: workflow.id, version: workflow.version },
      input: null,
    });
    const action = run.actions[0];
    run = await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'host',
      claimToken: 'claim-invalid-edge',
    });
    await expect(
      runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: 'claim-invalid-edge',
          outcomeId: 'invalid-edge',
          status: 'succeeded',
          output: null,
        },
      }),
    ).rejects.toThrow(/OUTCOME_PROCESSING_ERROR/);
    const persisted = await runtime.inspect(run.runId);
    expect(persisted.state).toEqual({ phase: 'shape' });
    expect(persisted.actions).toHaveLength(1);
    expect(persisted.actions[0].status).toBe('running');
  });

  it('rejects a transition state that violates the workflow schema', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [workflow],
      transitionHandlers: [
        {
          id: 'native-transition',
          version: '1',
          apply: () => ({ state: { phase: 'archive' }, next: ['build'] }),
        },
      ],
    });
    let run = await runtime.start({
      runId: 'native-invalid-state',
      workflow: { id: workflow.id, version: workflow.version },
      input: null,
    });
    const action = run.actions[0];
    run = await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'host',
      claimToken: 'claim-invalid-state',
    });
    await expect(
      runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: 'claim-invalid-state',
          outcomeId: 'invalid-state',
          status: 'succeeded',
          output: null,
        },
      }),
    ).rejects.toThrow(/OUTCOME_PROCESSING_ERROR/);
    expect((await runtime.inspect(run.runId)).state).toEqual({ phase: 'shape' });
  });
});
