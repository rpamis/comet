import { describe, expect, it } from 'vitest';
import {
  createMemoryRuntimeStore,
  createRuntime,
  approval,
  skill,
  tool,
} from '../../../domains/engine/runtime.js';
import type { RuntimeExecutor, WorkflowRun } from '../../../domains/engine/runtime.js';

const report = {
  id: 'report',
  version: '1',
  entry: 'collect',
  steps: {
    collect: skill({ ref: 'collect' }),
    approve: approval({ proposalFrom: 'collect' }),
    publish: tool({ ref: 'publish' }),
  },
  transitions: [
    { from: 'collect', to: 'approve' },
    { from: 'approve', to: 'publish', on: 'approved' },
  ],
};

function host(log: string[]): RuntimeExecutor {
  return {
    id: 'host',
    capabilities: [],
    supports: () => true,
    async execute(action) {
      log.push(action.ref!);
      return { status: 'succeeded', output: { done: action.ref! } };
    },
  };
}

describe('Runtime runUntilBlocked', () => {
  it('executes ready work and returns the approval without deciding it', async () => {
    const log: string[] = [];
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [report],
      executors: [host(log)],
    });
    await runtime.start({ runId: 'report', workflow: report, input: null });
    const result = await runtime.runUntilBlocked({ runId: 'report', executorId: 'host' });
    expect(result.reason).toBe('approval-required');
    expect(result.actionsExecuted).toBe(1);
    expect(result.run.waits[0].status).toBe('pending');
    expect(log).toEqual(['collect']);
    const repeated = await runtime.runUntilBlocked({ runId: 'report', executorId: 'host' });
    expect(repeated.actionsExecuted).toBe(0);
    expect(log).toEqual(['collect']);
  });

  it('resumes the same Run with a new Runtime after an explicit approval', async () => {
    const log: string[] = [];
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const create = () => createRuntime({ store, workflows: [report], executors: [host(log)] });
    const first = create();
    await first.start({ runId: 'report', workflow: report, input: null });
    const { run } = await first.runUntilBlocked({ runId: 'report', executorId: 'host' });
    const second = create();
    await second.resolveWait({
      runId: 'report',
      waitId: run.waits[0].id,
      proposalHash: run.waits[0].proposalHash,
      decisionId: 'user-1',
      choice: 'approved',
    });
    const result = await second.runUntilBlocked({ runId: 'report', executorId: 'host' });
    expect(result.reason).toBe('completed');
    expect(log).toEqual(['collect', 'publish']);
    expect(result.run.outputs.publish.value).toEqual({ done: 'publish' });
  });

  it('returns unknown execution after an executor disconnect and never replays it', async () => {
    let calls = 0;
    const workflow = {
      id: 'send',
      version: '1',
      entry: 'send',
      steps: { send: tool({ ref: 'send' }) },
    };
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [workflow],
      executors: [
        {
          id: 'host',
          capabilities: [],
          supports: () => true,
          async execute() {
            calls++;
            throw new Error('connection lost after send');
          },
        },
      ],
    });
    await runtime.start({ runId: 'send', workflow, input: null });
    const result = await runtime.runUntilBlocked({ runId: 'send', executorId: 'host' });
    expect(result.reason).toBe('execution-unknown');
    expect(result.run.actions[0].reason).toContain('connection lost');
    expect(result.actionsExecuted).toBe(1);
    expect((await runtime.runUntilBlocked({ runId: 'send', executorId: 'host' })).reason).toBe(
      'execution-unknown',
    );
    expect(calls).toBe(1);
  });

  it('leaves a previously claimed Action with its original executor', async () => {
    const log: string[] = [];
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [report],
      executors: [host(log)],
    });
    const run = await runtime.start({ runId: 'r', workflow: report, input: null });
    const action = run.actions[0];
    await runtime.claim({
      runId: 'r',
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'original',
    });
    const result = await runtime.runUntilBlocked({ runId: 'r', executorId: 'host' });
    expect(result.reason).toBe('action-in-flight');
    expect(result.run.actions[0].claim?.executorId).toBe('original');
    expect(log).toEqual([]);
  });

  it('does not skip an unsupported Action or claim an insufficient capability', async () => {
    for (const supports of [false, true]) {
      const log: string[] = [];
      const workflow = {
        id: 'restricted',
        version: '1',
        entry: 'one',
        steps: { one: tool({ ref: 'one', requiredCapabilities: ['restricted'] }) },
      };
      const executor = { ...host(log), supports: () => supports };
      const runtime = createRuntime({
        store: createMemoryRuntimeStore<WorkflowRun>(),
        workflows: [workflow],
        executors: [executor],
      });
      await runtime.start({ runId: 'r', workflow, input: null });
      const result = await runtime.runUntilBlocked({ runId: 'r', executorId: 'host' });
      expect(result.reason).toBe('executor-required');
      expect(result.run.actions[0].status).toBe('pending');
      expect(log).toEqual([]);
    }
  });

  it('bounds sequential execution and can continue without rerunning completed Actions', async () => {
    const log: string[] = [];
    const workflow = {
      id: 'sequence',
      version: '1',
      entry: 'one',
      steps: { one: tool({ ref: 'one' }), two: tool({ ref: 'two' }) },
      transitions: [{ from: 'one', to: 'two' }],
    };
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [workflow],
      executors: [host(log)],
    });
    await runtime.start({ runId: 'r', workflow, input: null });
    expect(
      (await runtime.runUntilBlocked({ runId: 'r', executorId: 'host', maxActions: 1 })).reason,
    ).toBe('action-limit');
    expect(log).toEqual(['one']);
    expect(
      (await runtime.runUntilBlocked({ runId: 'r', executorId: 'host', maxActions: 1 })).reason,
    ).toBe('completed');
    expect(log).toEqual(['one', 'two']);
  });

  it('returns evidence waits without submitting fabricated evidence', async () => {
    const workflow = {
      id: 'evidence',
      version: '1',
      entry: 'proof',
      steps: {
        proof: {
          type: 'await_evidence' as const,
          kind: 'proof',
          validator: { id: 'proof', version: '1' },
        },
      },
    };
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [workflow],
      executors: [host([])],
      evidenceValidators: [
        { id: 'proof', version: '1', validate: () => ({ accepted: true, actualHash: 'not-used' }) },
      ],
    });
    await runtime.start({ runId: 'r', workflow, input: null });
    const result = await runtime.runUntilBlocked({ runId: 'r', executorId: 'host' });
    expect(result.reason).toBe('evidence-required');
    expect(result.run.evidenceWaits?.[0].status).toBe('pending');
    expect(result.actionsExecuted).toBe(0);
  });

  it('rejects invalid execution limits before performing external work', async () => {
    const log: string[] = [];
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [report],
      executors: [host(log)],
    });
    await runtime.start({ runId: 'r', workflow: report, input: null });
    for (const maxActions of [0, -1, 1.5, Infinity]) {
      await expect(
        runtime.runUntilBlocked({ runId: 'r', executorId: 'host', maxActions }),
      ).rejects.toThrow(/INVALID_REQUEST/);
    }
    expect(log).toEqual([]);
  });

  it('preserves rejected results and surfaces their existing recovery error', async () => {
    const workflow = {
      id: 'checked',
      version: '1',
      entry: 'one',
      steps: { one: tool({ ref: 'one', outputSchema: { type: 'number' } }) },
    };
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [workflow],
      executors: [host([])],
    });
    await runtime.start({ runId: 'r', workflow, input: null });
    await expect(runtime.runUntilBlocked({ runId: 'r', executorId: 'host' })).rejects.toThrow(
      /OUTPUT_INVALID/,
    );
    expect((await runtime.inspect('r')).actions[0].rejectedOutcomes).toHaveLength(1);
  });

  it('leaves pending parallel work untouched when another branch requires approval', async () => {
    const log: string[] = [];
    const workflow = {
      id: 'parallel',
      version: '1',
      entry: ['one', 'two'],
      steps: {
        one: tool({ ref: 'one' }),
        two: tool({ ref: 'two' }),
        approve: approval({ proposalFrom: 'one' }),
      },
      transitions: [{ from: 'one', to: 'approve' }],
    };
    const runtime = createRuntime({
      store: createMemoryRuntimeStore(),
      workflows: [workflow],
      executors: [host(log)],
    });
    await runtime.start({ runId: 'r', workflow, input: null });
    const result = await runtime.runUntilBlocked({ runId: 'r', executorId: 'host' });
    expect(result.reason).toBe('approval-required');
    expect(log).toEqual(['one']);
    expect(result.run.actions.find((action) => action.ref === 'two')?.status).toBe('pending');
  });

  it('does not execute a cancelled Run or execute after request cancellation', async () => {
    const log: string[] = [];
    const runtime = createRuntime({
      store: createMemoryRuntimeStore(),
      workflows: [report],
      executors: [host(log)],
    });
    await runtime.start({ runId: 'r', workflow: report, input: null });
    const controller = new AbortController();
    controller.abort();
    await expect(
      runtime.runUntilBlocked({
        runId: 'r',
        executorId: 'host',
        context: { requestId: 'aborted', signal: controller.signal },
      }),
    ).rejects.toThrow(/REQUEST_ABORTED/);
    await runtime.cancel({ runId: 'r', reason: 'User cancelled' });
    expect((await runtime.runUntilBlocked({ runId: 'r', executorId: 'host' })).reason).toBe(
      'cancelled',
    );
    expect(log).toEqual([]);
  });

  it('exposes child Runs for explicit host scheduling and joins their completed results', async () => {
    const log: string[] = [];
    const child = { id: 'child', version: '1', entry: 'one', steps: { one: tool({ ref: 'one' }) } };
    const parent = {
      id: 'parent',
      version: '1',
      entry: 'child',
      steps: {
        child: { type: 'child_workflow' as const, workflow: { id: 'child', version: '1' } },
      },
    };
    const runtime = createRuntime({
      store: createMemoryRuntimeStore(),
      workflows: [parent, child],
      executors: [host(log)],
    });
    await runtime.start({ runId: 'parent', workflow: parent, input: null });
    const result = await runtime.runUntilBlocked({ runId: 'parent', executorId: 'host' });
    expect(result.reason).toBe('action-in-flight');
    expect(log).toEqual([]);
    const childId = result.run.children[0].runId;
    expect((await runtime.runUntilBlocked({ runId: childId, executorId: 'host' })).reason).toBe(
      'completed',
    );
    expect((await runtime.runUntilBlocked({ runId: 'parent', executorId: 'host' })).reason).toBe(
      'completed',
    );
    expect(log).toEqual(['one']);
  });

  it('does not start a sibling child Run when another branch already has unknown execution', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const child = { id: 'child', version: '1', entry: 'one', steps: { one: tool({ ref: 'one' }) } };
    const parent = {
      id: 'parent',
      version: '1',
      entry: ['send', 'child'],
      steps: {
        send: tool({ ref: 'send' }),
        child: { type: 'child_workflow' as const, workflow: { id: 'child', version: '1' } },
      },
    };
    const runtime = createRuntime({ store, workflows: [parent, child], executors: [host([])] });
    const run = await runtime.start({ runId: 'parent', workflow: parent, input: null });
    const action = run.actions[0];
    await runtime.claim({
      runId: 'parent',
      actionId: action.id,
      attempt: 1,
      inputHash: action.inputHash,
      executorId: 'host',
    });
    await runtime.markUnknown({
      runId: 'parent',
      actionId: action.id,
      attempt: 1,
      reason: 'lost connection',
    });
    const before = await runtime.inspect('parent');
    expect((await runtime.runUntilBlocked({ runId: 'parent', executorId: 'host' })).reason).toBe(
      'execution-unknown',
    );
    expect(await store.read(run.children[0].runId)).toBeNull();
    expect((await runtime.inspect('parent')).revision).toBe(before.revision);
  });
});
