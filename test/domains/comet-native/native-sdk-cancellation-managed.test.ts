import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  createMemoryRuntimeStore,
  createRuntime,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { createNativeSdkCheckExecution } from '../../../domains/comet-native/native-sdk-check-execution.js';
import { inspectNativeSdkCancellation } from '../../../domains/comet-native/native-sdk-cancellation.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('does not wait for a child Run that was referenced but never claimed or started', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-cancel-unstarted-child-'));
  roots.push(root);
  const runtime = createRuntime({
    store: createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [
      {
        id: 'parent',
        version: '1',
        entry: 'child',
        steps: { child: { type: 'child_workflow', workflow: { id: 'child', version: '1' } } },
      },
      {
        id: 'child',
        version: '1',
        entry: 'host',
        steps: { host: { type: 'handoff', ref: 'host' } },
      },
    ],
  });
  const started = await runtime.start({
    runId: 'parent',
    workflow: { id: 'parent', version: '1' },
    input: null,
  });
  expect(started.children).toHaveLength(1);
  expect(started.actions[0].claim).toBeUndefined();
  const cancelled = await runtime.cancel({
    runId: started.runId,
    reason: 'Stop before starting child',
  });
  expect(await inspectNativeSdkCancellation({ projectRoot: root, run: cancelled })).toMatchObject({
    status: 'cancelled',
    quiescent: true,
    outstandingRuns: [],
  });
});

it('keeps a claimed child whose persisted Run is missing unresolved', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-cancel-missing-child-'));
  roots.push(root);
  const runtime = createRuntime({
    store: createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [
      {
        id: 'parent',
        version: '1',
        entry: 'child',
        steps: { child: { type: 'child_workflow', workflow: { id: 'child', version: '1' } } },
      },
      {
        id: 'child',
        version: '1',
        entry: 'host',
        steps: { host: { type: 'handoff', ref: 'host' } },
      },
    ],
  });
  await runtime.start({ runId: 'parent', workflow: { id: 'parent', version: '1' }, input: null });
  const advanced = await runtime.next({ runId: 'parent' });
  expect(advanced.actions[0].claim).toBeDefined();
  const cancelled = await runtime.cancel({
    runId: advanced.runId,
    reason: 'Stop after child started',
  });
  // 内存 Runtime 确实创建过 child；持久工作区中它缺失，不能把缺失解释成从未启动。
  expect(await inspectNativeSdkCancellation({ projectRoot: root, run: cancelled })).toMatchObject({
    status: 'cancelling',
    quiescent: false,
    outstandingRuns: [advanced.children[0].runId],
  });
});

it('keeps a cancelled managed check occupied after its group stops until the original host confirms all child tasks stopped', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-cancel-managed-'));
  roots.push(root);
  const runtime = createRuntime({
    store: createMemoryRuntimeStore<WorkflowRun>(),
    workflows: [
      {
        id: 'managed-stop',
        version: '1',
        entry: 'check',
        steps: { check: { type: 'call_tool', ref: 'native-required-checks' } },
      },
    ],
  });
  const started = await runtime.start({
    runId: 'managed-stop',
    workflow: { id: 'managed-stop', version: '1' },
    input: null,
  });
  const pending = started.actions[0];
  const claimed = await runtime.claim({
    runId: started.runId,
    actionId: pending.id,
    attempt: pending.attempt,
    inputHash: pending.inputHash,
    executorId: 'comet-native-checks',
    claimToken: 'original-check',
  });
  const action = claimed.actions[0];
  const registration = await createNativeSdkCheckExecution({
    projectRoot: root,
    run: claimed,
    action,
    candidateId: 'candidate',
    plansHash: 'plans',
  });
  // 已登记的空计划实际未启动任何子进程；即使这份登记已完成，也不能推断外部后代已停止。
  registration.execution.phase = 'completed';
  await registration.save();
  const cancelled = await runtime.cancel({ runId: claimed.runId, reason: 'Stop the task' });
  const waiting = await inspectNativeSdkCancellation({ projectRoot: root, run: cancelled });
  expect(waiting).toMatchObject({ status: 'cancelling', quiescent: false });
  const request = waiting!.outstandingActions[0].acknowledgementRequest!;
  expect(request.stoppedActions[0]).toMatchObject({
    actionId: action.id,
    claimToken: action.claim!.token,
  });
  const confirmed = await runtime.cancel({
    ...request,
    stoppedActions: [
      {
        ...request.stoppedActions[0],
        evidence: 'The original host checked that this task and every detached child have stopped.',
      },
    ],
  });
  expect(await inspectNativeSdkCancellation({ projectRoot: root, run: confirmed })).toMatchObject({
    status: 'cancelled',
    quiescent: true,
  });
  expect(confirmed.actions[0].outcome).toBeUndefined();
});
