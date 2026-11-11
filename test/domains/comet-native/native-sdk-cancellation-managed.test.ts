import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  createMemoryRuntimeStore,
  createRuntime,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
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
