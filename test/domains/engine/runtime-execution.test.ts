import { describe, expect, it } from 'vitest';
import { createRuntime } from '../../../domains/engine/runtime-service.js';
import { createPortableRunCheckpoint } from '../../../domains/engine/portable-run-checkpoint.js';
import { createMemoryRuntimeStore } from '../../../domains/engine/runtime-store.js';
import type { WorkflowRun } from '../../../domains/engine/workflow-run.js';
import { RuntimeProtocolError } from '../../../domains/engine/runtime-errors.js';

const workflow = {
  id: 'reader',
  version: '1',
  entry: 'read',
  steps: { read: { type: 'call_tool' as const, ref: 'read-source', retry: 'idempotent' as const } },
};

describe('Runtime execution extensions and recovery', () => {
  it.each(['claim', 'execute'] as const)(
    'rechecks asynchronous %s authorization against the snapshot retried after a CAS conflict',
    async (operation) => {
      let release!: () => void;
      let started!: () => void;
      const paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      let checks = 0;
      let executions = 0;
      const runtime = createRuntime({
        store: createMemoryRuntimeStore<WorkflowRun>(),
        workflows: [
          {
            id: 'snapshot-authorization',
            version: '1',
            entry: ['work', 'revoke'],
            initialState: { approved: true },
            stateSchema: { type: 'object' },
            transitionHandler: { id: 'revoke', version: '1' },
            steps: {
              work: { type: 'call_tool', ref: 'work' },
              revoke: { type: 'call_tool', ref: 'revoke' },
            },
          },
        ],
        transitionHandlers: [
          {
            id: 'revoke',
            version: '1',
            apply: ({ run, event }) => ({
              state: event.stepId === 'revoke' ? { approved: false } : run.state!,
              next: [],
            }),
          },
        ],
        executors: [
          {
            id: 'configured-host',
            capabilities: [],
            supports: (action) => action.ref === 'work',
            preflight: async (_action, _context, run) => {
              const approved = (run!.state as { approved: boolean }).approved;
              checks++;
              if (checks === 1) {
                started();
                await paused;
              }
              if (!approved)
                throw new RuntimeProtocolError(
                  'COMMAND_REJECTED',
                  'Current snapshot no longer authorizes dispatch',
                );
            },
            execute: async () => {
              executions++;
              return { status: 'succeeded', output: 'worked' };
            },
          },
        ],
      });
      const run = await runtime.start({
        runId: 'r',
        workflow: { id: 'snapshot-authorization', version: '1' },
        input: null,
      });
      const action = run.actions[0];
      const work =
        operation === 'execute'
          ? runtime.execute({ runId: 'r', actionId: action.id, executorId: 'configured-host' })
          : runtime.claim({
              runId: 'r',
              actionId: action.id,
              attempt: action.attempt,
              inputHash: action.inputHash,
              executorId: 'configured-host',
              claimToken: 'work-token',
            });
      await entered;
      const revoke = run.actions[1];
      await runtime.claim({
        runId: 'r',
        actionId: revoke.id,
        attempt: revoke.attempt,
        inputHash: revoke.inputHash,
        executorId: 'manual-control',
        claimToken: 'control-token',
      });
      await runtime.recordOutcome({
        runId: 'r',
        outcome: {
          actionId: revoke.id,
          attempt: revoke.attempt,
          inputHash: revoke.inputHash,
          claimToken: 'control-token',
          outcomeId: 'revoked',
          status: 'succeeded',
          output: null,
        },
      });
      const rejected = expect(work).rejects.toMatchObject({ code: 'COMMAND_REJECTED' });
      release();
      await rejected;
      expect(checks).toBe(2);
      expect(executions).toBe(0);
      expect((await runtime.inspect('r')).actions[0].status).toBe('pending');
    },
  );
  it('passes the claimed Run snapshot to an executor before it performs external work', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const runtime = createRuntime({
      store,
      workflows: [
        {
          id: 'stateful-check',
          version: '1',
          entry: 'check',
          stateSchema: {
            type: 'object',
            required: ['candidate'],
            properties: { candidate: { type: 'string' } },
          },
          steps: { check: { type: 'call_tool', ref: 'run-check' } },
        },
      ],
      executors: [
        {
          id: 'check-host',
          capabilities: [],
          supports: (action) => action.ref === 'run-check',
          async execute(action, _context, run) {
            expect(run?.state).toEqual({ candidate: 'current' });
            expect(run?.actions.find((item) => item.id === action.id)?.status).toBe('running');
            expect((await store.read(action.runId))?.actions[0].status).toBe('running');
            return { status: 'succeeded', output: { checked: true } };
          },
        },
      ],
    });
    const run = await runtime.start({
      runId: 'stateful-check-run',
      workflow: { id: 'stateful-check', version: '1' },
      input: null,
      initialState: { candidate: 'current' },
    });
    const completed = await runtime.execute({
      runId: run.runId,
      actionId: run.actions[0].id,
      executorId: 'check-host',
    });
    expect(completed.status).toBe('completed');
  });

  it('commits an executor claim before invoking code and records its result', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    let sawDurableClaim = false;
    const runtime = createRuntime({
      store,
      workflows: [workflow],
      executors: [
        {
          id: 'reader',
          capabilities: [],
          supports: (action) => action.ref === 'read-source',
          async execute(action, context) {
            sawDurableClaim = (await store.read(action.runId))!.actions[0].status === 'running';
            expect(context?.invocationCwd).toBe('D:/isolated');
            return { status: 'succeeded', output: { contents: 'source' } };
          },
        },
      ],
    });
    const run = await runtime.start({
      runId: 'r',
      workflow: { id: 'reader', version: '1' },
      input: null,
    });
    const result = await runtime.execute({
      runId: 'r',
      actionId: run.actions[0].id,
      executorId: 'reader',
      context: { requestId: 'request-1', invocationCwd: 'D:/isolated' },
    });
    expect(sawDurableClaim).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.outputs.read.value).toEqual({ contents: 'source' });
  });

  it('retains an uncertain executor after a thrown error and does not execute it twice', async () => {
    let calls = 0;
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [workflow],
      executors: [
        {
          id: 'reader',
          capabilities: [],
          supports: () => true,
          async execute() {
            calls += 1;
            throw new Error('disconnected after sending');
          },
        },
      ],
    });
    const run = await runtime.start({
      runId: 'r',
      workflow: { id: 'reader', version: '1' },
      input: null,
    });
    const command = { runId: 'r', actionId: run.actions[0].id, executorId: 'reader' };
    await expect(runtime.execute(command)).rejects.toThrow(/EXECUTION_UNKNOWN/);
    expect((await runtime.inspect('r')).actions[0].status).toBe('unknown');
    await expect(runtime.execute(command)).rejects.toThrow(/ACTION_ALREADY_CLAIMED/);
    expect(calls).toBe(1);
    await expect(
      runtime.retry({ runId: 'r', actionId: run.actions[0].id, attempt: 1 }),
    ).rejects.toThrow(/RECONCILIATION_REQUIRED/);
    const retried = await runtime.retry({
      runId: 'r',
      actionId: run.actions[0].id,
      attempt: 1,
      reconciliation: { resolution: 'not-executed', evidence: { remoteOperation: 'not-found' } },
    });
    expect(retried.actions[0]).toMatchObject({ attempt: 2, status: 'pending' });
  });

  it('applies a registered asynchronous business validator before accepting a result', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [
        {
          ...workflow,
          steps: { read: { ...workflow.steps.read, validator: { id: 'source', version: '1' } } },
        },
      ],
      validators: [
        {
          id: 'source',
          version: '1',
          async validate({ outcome }) {
            return { accepted: outcome.output === 'trusted', reason: '来源未核实' };
          },
        },
      ],
    });
    const run = await runtime.start({
      runId: 'r',
      workflow: { id: 'reader', version: '1' },
      input: null,
    });
    const action = run.actions[0];
    await runtime.claim({
      runId: 'r',
      actionId: action.id,
      inputHash: action.inputHash,
      attempt: 1,
      executorId: 'host',
      claimToken: 'token',
    });
    const portableBeforeRejection = createPortableRunCheckpoint(await runtime.inspect('r'));
    const outcome = {
      actionId: action.id,
      attempt: 1,
      inputHash: action.inputHash,
      claimToken: 'token',
      outcomeId: 'result',
      status: 'succeeded' as const,
      output: 'untrusted',
    };
    await expect(runtime.recordOutcome({ runId: 'r', outcome })).rejects.toThrow(
      /OUTCOME_REJECTED/,
    );
    expect((await runtime.inspect('r')).actions[0]).toMatchObject({
      status: 'running',
      rejectedOutcomes: [{ outcome, code: 'OUTCOME_REJECTED', reason: '来源未核实' }],
    });
    expect(createPortableRunCheckpoint(await runtime.inspect('r'))).toEqual(
      portableBeforeRejection,
    );
    expect(
      (
        await runtime.recordOutcome({
          runId: 'r',
          outcome: { ...outcome, outcomeId: 'result-corrected', output: 'trusted' },
        })
      ).status,
    ).toBe('completed');
  });

  it('persists a rejected Outcome so recovery cannot rewrite its identity', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const validated = {
      ...workflow,
      steps: { read: { ...workflow.steps.read, validator: { id: 'source', version: '1' } } },
    };
    const validator = {
      id: 'source',
      version: '1',
      validate: ({ outcome }: { outcome: { output: unknown } }) => ({
        accepted: outcome.output === 'trusted',
        reason: '来源未核实',
      }),
    };
    const runtime = createRuntime({ store, workflows: [validated], validators: [validator] });
    const started = await runtime.start({
      runId: 'rejected-result',
      workflow: { id: 'reader', version: '1' },
      input: null,
    });
    const action = started.actions[0];
    await runtime.claim({
      runId: started.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'host',
      claimToken: 'claim-1',
    });
    const rejected = {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'claim-1',
      outcomeId: 'result-1',
      status: 'succeeded' as const,
      output: 'untrusted',
    };
    await expect(
      runtime.recordOutcome({ runId: started.runId, outcome: rejected }),
    ).rejects.toThrow(/OUTCOME_REJECTED/);

    const resumed = createRuntime({ store, workflows: [validated], validators: [validator] });
    expect((await resumed.inspect(started.runId)).actions[0]).toMatchObject({
      status: 'running',
      rejectedOutcomes: [{ outcome: rejected, code: 'OUTCOME_REJECTED', reason: '来源未核实' }],
    });
    await expect(
      resumed.recordOutcome({ runId: started.runId, outcome: rejected }),
    ).rejects.toThrow(/OUTCOME_REJECTED/);
    await expect(
      resumed.recordOutcome({
        runId: started.runId,
        outcome: { ...rejected, output: 'trusted' },
      }),
    ).rejects.toThrow(/OUTCOME_CONFLICT/);
    await resumed.markUnknown({
      runId: started.runId,
      actionId: action.id,
      attempt: action.attempt,
      reason: '修正结果的提交状态不明',
    });
    await expect(
      resumed.retry({
        runId: started.runId,
        actionId: action.id,
        attempt: action.attempt,
        reconciliation: { resolution: 'not-executed', evidence: { remoteOperation: 'not-found' } },
      }),
    ).rejects.toThrow(/OUTCOME_ALREADY_RECORDED/);
    const corrected = await resumed.recordOutcome({
      runId: started.runId,
      outcome: { ...rejected, outcomeId: 'result-2', output: 'trusted' },
    });
    expect(corrected.status).toBe('completed');
  });

  it('keeps a validator rejection readable when the validator gives an empty reason', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [
        {
          ...workflow,
          steps: { read: { ...workflow.steps.read, validator: { id: 'source', version: '1' } } },
        },
      ],
      validators: [
        { id: 'source', version: '1', validate: () => ({ accepted: false, reason: '' }) },
      ],
    });
    const started = await runtime.start({
      runId: 'empty-reason',
      workflow: { id: 'reader', version: '1' },
      input: null,
    });
    const action = started.actions[0];
    await runtime.claim({
      runId: started.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'host',
      claimToken: 'claim',
    });
    await expect(
      runtime.recordOutcome({
        runId: started.runId,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: 'claim',
          outcomeId: 'result',
          status: 'succeeded',
          output: 'value',
        },
      }),
    ).rejects.toThrow(/OUTCOME_REJECTED/);
    expect((await runtime.inspect(started.runId)).actions[0]).toMatchObject({
      rejectedOutcomes: [{ reason: '结果未满足业务验收条件' }],
    });
  });

  it('persists an executor result when its validator throws before acceptance', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const validated = {
      ...workflow,
      steps: { read: { ...workflow.steps.read, validator: { id: 'source', version: '1' } } },
    };
    let calls = 0;
    const runtime = createRuntime({
      store,
      workflows: [validated],
      validators: [
        {
          id: 'source',
          version: '1',
          validate: () => {
            throw new Error('validator unavailable');
          },
        },
      ],
      executors: [
        {
          id: 'reader',
          capabilities: [],
          supports: () => true,
          execute: () => {
            calls += 1;
            return { status: 'succeeded', output: { contents: 'already-written' } };
          },
        },
      ],
    });
    const started = await runtime.start({
      runId: 'validator-throws',
      workflow: { id: 'reader', version: '1' },
      input: null,
    });
    const command = { runId: started.runId, actionId: started.actions[0].id, executorId: 'reader' };
    await expect(runtime.execute(command)).rejects.toThrow(/OUTCOME_PROCESSING_ERROR/);

    const resumed = createRuntime({ store, workflows: [validated] });
    expect((await resumed.inspect(started.runId)).actions[0]).toMatchObject({
      status: 'running',
      rejectedOutcomes: [
        {
          code: 'OUTCOME_PROCESSING_ERROR',
          outcome: { output: { contents: 'already-written' }, status: 'succeeded' },
        },
      ],
    });
    await expect(runtime.execute(command)).rejects.toThrow(/ACTION_ALREADY_CLAIMED/);
    expect(calls).toBe(1);
  });

  it('marks an executor result unknown when the returned value cannot be persisted', async () => {
    let calls = 0;
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [workflow],
      executors: [
        {
          id: 'reader',
          capabilities: [],
          supports: () => true,
          execute: () => {
            calls += 1;
            return { status: 'succeeded', output: undefined as never };
          },
        },
      ],
    });
    const started = await runtime.start({
      runId: 'invalid-executor-result',
      workflow: { id: 'reader', version: '1' },
      input: null,
    });
    const command = { runId: started.runId, actionId: started.actions[0].id, executorId: 'reader' };
    await expect(runtime.execute(command)).rejects.toThrow(/EXECUTION_UNKNOWN/);
    expect((await runtime.inspect(started.runId)).actions[0]).toMatchObject({ status: 'unknown' });
    await expect(runtime.execute(command)).rejects.toThrow(/ACTION_ALREADY_CLAIMED/);
    expect(calls).toBe(1);
  });

  it('keeps an unhandled event as a rejected result without partially advancing the run', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const defined = {
      ...workflow,
      transitions: [{ from: 'read', to: 'read', on: 'again' }],
    };
    const runtime = createRuntime({ store, workflows: [defined] });
    const started = await runtime.start({
      runId: 'unhandled-event',
      workflow: { id: 'reader', version: '1' },
      input: null,
    });
    const action = started.actions[0];
    await runtime.claim({
      runId: started.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'host',
      claimToken: 'claim',
    });
    const outcome = {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'claim',
      outcomeId: 'unexpected-event',
      status: 'succeeded' as const,
      output: { written: true },
      event: 'unexpected',
    };
    await expect(runtime.recordOutcome({ runId: started.runId, outcome })).rejects.toThrow(
      /OUTCOME_PROCESSING_ERROR/,
    );
    const resumed = createRuntime({ store, workflows: [defined] });
    expect(await resumed.inspect(started.runId)).toMatchObject({
      status: 'running',
      ready: [],
      outputs: {},
      actions: [
        {
          status: 'running',
          rejectedOutcomes: [{ outcome, code: 'OUTCOME_PROCESSING_ERROR' }],
        },
      ],
    });
    await expect(
      resumed.recordOutcome({ runId: started.runId, outcome: { ...outcome, event: 'again' } }),
    ).rejects.toThrow(/OUTCOME_CONFLICT/);
  });

  it('routes explicit events and bounds cycles without losing the final accepted result', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [
        {
          ...workflow,
          maxTransitions: 2,
          transitions: [{ from: 'read', to: 'read', on: 'again' }],
        },
      ],
    });
    let run = await runtime.start({
      runId: 'r',
      workflow: { id: 'reader', version: '1' },
      input: null,
    });
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const action = run.actions.find((candidate) => candidate.status === 'pending')!;
      await runtime.claim({
        runId: 'r',
        actionId: action.id,
        inputHash: action.inputHash,
        attempt: 1,
        executorId: 'host',
        claimToken: 'token',
      });
      run = await runtime.recordOutcome({
        runId: 'r',
        outcome: {
          actionId: action.id,
          attempt: 1,
          inputHash: action.inputHash,
          claimToken: 'token',
          outcomeId: `result-${iteration}`,
          status: 'succeeded',
          output: iteration,
          event: 'again',
        },
      });
    }
    expect(run.status).toBe('failed');
    expect(run.reason).toMatch(/TRANSITION_LIMIT/);
    expect(run.actions).toHaveLength(2);
    expect(run.actions[1].outcome?.output).toBe(1);
  });

  it('checks request cancellation without mutating ambient process context or starting work', async () => {
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [workflow],
    });
    const controller = new AbortController();
    controller.abort();
    const cwd = process.cwd();
    await expect(
      runtime.start({
        runId: 'r',
        workflow: { id: 'reader', version: '1' },
        input: null,
        context: { requestId: 'aborted', signal: controller.signal, invocationCwd: 'D:/different' },
      }),
    ).rejects.toThrow(/REQUEST_ABORTED/);
    await expect(runtime.inspect('r')).rejects.toThrow(/RUN_NOT_FOUND/);
    expect(process.cwd()).toBe(cwd);
  });
});
