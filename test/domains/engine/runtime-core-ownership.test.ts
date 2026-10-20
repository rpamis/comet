import { describe, expect, it } from 'vitest';
import {
  portableRunCheckpointProjectionMatches,
  createPortableRunCheckpointProjection,
  readPortableRunCheckpointProjection,
} from '../../../domains/engine/portable-run-checkpoint.js';
import { encodeJsonValueMaps } from '../../../platform/fs/json-value-pool.js';
import { hashRuntimeValue } from '../../../domains/engine/runtime-json.js';
import {
  createMemoryRuntimeStore,
  createRuntime,
  parseWorkflowRun,
  preserveRuntimeExecutionOrigins,
  runtimeExecutionBinding,
  createPortableRunCheckpoint,
  type WorkflowRun,
  type RuntimeExecutor,
} from '../../../domains/engine/runtime.js';

const workflow = {
  id: 'ownership',
  version: '1',
  entry: 'work',
  steps: { work: { type: 'handoff', ref: 'host', retry: 'idempotent' } },
};
async function fixture(executor?: RuntimeExecutor) {
  const store = createMemoryRuntimeStore<WorkflowRun>();
  const runtime = createRuntime({
    store,
    workflows: [workflow],
    executors: executor ? [executor] : [],
  });
  const run = await runtime.start({
    runId: 'owned',
    workflow: { id: workflow.id, version: '1' },
    input: { value: 'original' },
  });
  return { store, runtime, run };
}
async function claimed() {
  const f = await fixture();
  const action = f.run.actions[0];
  const run = await f.runtime.claim({
    runId: f.run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'host',
    claimToken: 'claim',
  });
  return { ...f, run, action: run.actions[0] };
}

describe('Runtime 核心所有权和执行来源', () => {
  it('调用返回 Promise 前捕获请求，不能被随后替换输入或 Run 身份', async () => {
    const { runtime } = await fixture();
    const request = {
      runId: 'second',
      workflow: { id: 'ownership', version: '1' },
      input: { value: 'before' },
    };
    const pending = runtime.start(request);
    request.runId = 'changed';
    request.input.value = 'after';
    const run = await pending;
    expect(run.runId).toBe('second');
    expect(run.input).toEqual({ value: 'before' });
  });
  it('捕获原 AbortSignal，同时原控制器仍能取消请求', async () => {
    const f = await fixture();
    const action = f.run.actions[0];
    const controller = new AbortController();
    const context = { requestId: 'request', signal: controller.signal };
    const pending = f.runtime.claim({
      runId: f.run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'host',
      context,
    });
    context.signal = new AbortController().signal;
    controller.abort();
    await expect(pending).rejects.toThrow(/REQUEST_ABORTED/);
    expect((await f.runtime.inspect(f.run.runId)).actions[0].status).toBe('pending');
  });
  it('supports 不能用真值字符串授权执行', async () => {
    let calls = 0;
    const f = await fixture({
      id: 'host',
      capabilities: [],
      supports: () => 'true' as unknown as boolean,
      execute: async () => {
        calls++;
        return { status: 'succeeded', output: null };
      },
    });
    await expect(
      f.runtime.execute({ runId: f.run.runId, actionId: f.run.actions[0].id, executorId: 'host' }),
    ).rejects.toThrow(/INVALID_VALIDATION/);
    expect(calls).toBe(0);
  });
  it('终态停止确认保留成功事实，绑定原领取身份并可移植', async () => {
    const f = await claimed();
    const binding = {
      actionId: f.action.id,
      attempt: f.action.attempt,
      inputHash: f.action.inputHash,
      claimToken: 'claim',
    };
    const completed = await f.runtime.recordOutcome({
      runId: f.run.runId,
      outcome: { ...binding, outcomeId: 'done', status: 'succeeded', output: null },
    });
    const stopped = await f.runtime.acknowledgeStopped({
      runId: f.run.runId,
      expectedRevision: completed.revision,
      stoppedActions: [{ ...binding, evidence: '进程和子任务已退出' }],
    });
    expect(stopped.status).toBe('completed');
    expect(stopped.actions[0].status).toBe('succeeded');
    expect(stopped.actions[0].executionStop?.evidence).toBe('进程和子任务已退出');
    await expect(
      f.runtime.acknowledgeStopped({
        runId: f.run.runId,
        stoppedActions: [{ ...binding, claimToken: 'wrong', evidence: '已退出' }],
      }),
    ).rejects.toThrow(/STALE_ACTION/);
    const portable = createPortableRunCheckpoint(stopped).run;
    expect(portable.actions[0].executionStop?.claimToken).toBe(portable.actions[0].claim?.token);
  });
  it('定义升级保留已领取来源，拒绝来源跨工作流身份', async () => {
    const f = await claimed();
    const original = runtimeExecutionBinding(f.run, f.action);
    expect(f.action.executionOrigin?.workflow).toEqual(f.run.workflow);
    const upgraded = preserveRuntimeExecutionOrigins(f.run);
    upgraded.workflow.hash = 'a'.repeat(64);
    upgraded.definitionHashes[JSON.stringify(['ownership', '1'])] = upgraded.workflow.hash;
    expect(runtimeExecutionBinding(upgraded, upgraded.actions[0])).toEqual(original);
    upgraded.actions[0].executionOrigin!.workflow.id = 'other';
    expect(() => parseWorkflowRun(upgraded)).toThrow(/执行来源/);
  });
  it('重试清理旧执行来源和停止事实，再次领取绑定新尝试', async () => {
    const f = await claimed();
    const binding = {
      actionId: f.action.id,
      attempt: f.action.attempt,
      inputHash: f.action.inputHash,
      claimToken: 'claim',
    };
    await f.runtime.recordOutcome({
      runId: f.run.runId,
      outcome: { ...binding, outcomeId: 'failed', status: 'failed', output: null },
    });
    await f.runtime.acknowledgeStopped({
      runId: f.run.runId,
      stoppedActions: [{ ...binding, evidence: '失败进程已退出' }],
    });
    const retried = await f.runtime.retry({
      runId: f.run.runId,
      actionId: f.action.id,
      attempt: 1,
    });
    expect(retried.actions[0].executionOrigin).toBeUndefined();
    expect(retried.actions[0].executionStop).toBeUndefined();
  });
});

it('命令验证器不能改写将要提交的 activation', async () => {
  const runtime = createRuntime({
    store: createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [
      {
        ...workflow,
        commands: { again: { stepId: 'work', validator: { id: 'guard', version: '1' } } },
      },
    ],
    commandValidators: [
      {
        id: 'guard',
        version: '1',
        validate({ input, context }) {
          (input as { value: string }).value = 'callback mutation';
          if (context?.environment)
            (context.environment as Record<string, string>).MODE = 'changed';
          return { accepted: true };
        },
      },
    ],
  });
  const run = await runtime.start({
    runId: 'command',
    workflow: { id: 'ownership', version: '1' },
    input: null,
  });
  const request = {
    runId: run.runId,
    commandId: 'c1',
    expectedRevision: run.revision,
    name: 'again',
    input: { value: 'original' },
    context: { requestId: 'r', environment: { MODE: 'original' } },
  };
  const pending = runtime.dispatchCommand(request);
  request.input.value = 'caller mutation';
  const result = await pending;
  expect(result.actions.at(-1)?.input).toMatchObject({ activation: { value: 'original' } });
  expect(request.context.environment.MODE).toBe('original');
  expect(await runtime.inspect(run.runId)).toEqual(result);
});

it('验证器 accepted 必须是布尔值，不能以字符串提交成功', async () => {
  const f = await claimed();
  const runtime = createRuntime({
    store: f.store,
    workflows: [workflow],
    validateOutcome: () => ({ accepted: 'true' as unknown as boolean }),
  });
  await expect(
    runtime.recordOutcome({
      runId: f.run.runId,
      outcome: {
        actionId: f.action.id,
        attempt: 1,
        inputHash: f.action.inputHash,
        claimToken: 'claim',
        outcomeId: 'bad-validation',
        status: 'succeeded',
        output: null,
      },
    }),
  ).rejects.toThrow(/OUTCOME_PROCESSING_ERROR/);
  const run = await runtime.inspect(f.run.runId);
  expect(run.actions[0].status).toBe('running');
  expect(run.actions[0].outcome).toBeUndefined();
});

it('结果提交 CAS 冲突只重试提交，不再次调用执行器', async () => {
  const underlying = createMemoryRuntimeStore<WorkflowRun>();
  let failOnce = true;
  let executions = 0;
  const runtime = createRuntime({
    store: {
      ...underlying,
      async compareAndSwap(runId, revision, next) {
        if (revision !== null && next.actions[0].status === 'succeeded' && failOnce) {
          failOnce = false;
          return false;
        }
        return underlying.compareAndSwap(runId, revision, next);
      },
    },
    workflows: [workflow],
    executors: [
      {
        id: 'host',
        capabilities: [],
        supports: () => true,
        async execute() {
          executions++;
          return { status: 'succeeded', output: { once: true } };
        },
      },
    ],
  });
  const run = await runtime.start({
    runId: 'cas',
    workflow: { id: 'ownership', version: '1' },
    input: null,
  });
  expect(
    (await runtime.execute({ runId: 'cas', actionId: run.actions[0].id, executorId: 'host' }))
      .status,
  ).toBe('completed');
  expect(executions).toBe(1);
});

it('提交和冷读共用 Wait 结构约束，拒绝空决定标识且不写入 revision', async () => {
  const runtime = createRuntime({
    store: createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [
      {
        id: 'wait',
        version: '1',
        entry: 'work',
        steps: {
          work: { type: 'handoff', ref: 'host' },
          approval: { type: 'ask_user', proposalFrom: 'work' },
        },
        transitions: [{ from: 'work', to: 'approval' }],
      },
    ],
    executors: [
      {
        id: 'host',
        capabilities: [],
        supports: () => true,
        async execute() {
          return { status: 'succeeded', output: 'review' };
        },
      },
    ],
  });
  let run = await runtime.start({
    runId: 'wait',
    workflow: { id: 'wait', version: '1' },
    input: null,
  });
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions[0].id,
    executorId: 'host',
  });
  const wait = run.waits[0];
  await expect(
    runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      choice: 'approved',
      decisionId: '',
    }),
  ).rejects.toThrow();
  expect(await runtime.inspect(run.runId)).toEqual(run);
});

it('证据验证等待期间修改请求不能改变已验证的提交内容', async () => {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime = createRuntime({
    store: createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [
      {
        id: 'evidence-owner',
        version: '1',
        entry: 'proof',
        steps: {
          proof: {
            type: 'await_evidence',
            kind: 'proof',
            validator: { id: 'guard', version: '1' },
          },
        },
      },
    ],
    evidenceValidators: [
      {
        id: 'guard',
        version: '1',
        async validate({ contentHash, context }) {
          entered();
          if (context?.environment)
            (context.environment as Record<string, string>).MODE = 'mutated';
          await gate;
          return { accepted: true, actualHash: contentHash };
        },
      },
    ],
  });
  const run = await runtime.start({
    runId: 'evidence-owner',
    workflow: { id: 'evidence-owner', version: '1' },
    input: null,
  });
  const request = {
    runId: run.runId,
    evidenceId: run.evidenceWaits![0].id,
    kind: 'proof',
    ref: 'evidence/original.json',
    contentHash: 'a'.repeat(64),
    submissionId: 'original',
    context: { requestId: 'proof', environment: { MODE: 'original' } },
  };
  const pending = runtime.recordEvidence(request);
  await started;
  request.ref = 'evidence/changed.json';
  request.contentHash = 'b'.repeat(64);
  request.submissionId = 'changed';
  release();
  const result = await pending;
  expect(result.evidenceWaits![0].receipt).toEqual({
    ref: 'evidence/original.json',
    contentHash: 'a'.repeat(64),
    submissionId: 'original',
  });
  expect(request.context.environment.MODE).toBe('original');
  expect(await runtime.inspect(run.runId)).toEqual(result);
});

it('compact checkpoint 比较验证真实正文和 sourceRevision，portable 身份与 full 一致', async () => {
  const f = await claimed();
  const checkpoint = createPortableRunCheckpoint(f.run);
  const encoded = encodeJsonValueMaps(checkpoint.run, [{ path: ['outputs'], group: 'results' }]);
  const compact = {
    ...checkpoint,
    schema: 'comet.workflow-run-checkpoint.v2',
    run: encoded.record,
    pool: encoded.pool,
    storageHash: hashRuntimeValue(encoded),
  };
  expect(createPortableRunCheckpointProjection(f.run).hash).toBe(checkpoint.hash);
  expect(portableRunCheckpointProjectionMatches(compact, f.run)).toBe(true);
  expect(
    readPortableRunCheckpointProjection(compact, f.run.runId, { preserveSourceRevision: true })
      ?.revision,
  ).toBe(f.run.revision);
  expect(() =>
    portableRunCheckpointProjectionMatches(
      { ...compact, sourceRevision: f.run.revision + 1 },
      f.run,
    ),
  ).toThrow();
  const changed = { ...compact, run: { ...compact.run, input: { changed: true } } };
  expect(() => portableRunCheckpointProjectionMatches(changed, f.run)).toThrow();
});
