import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  creatorDispatchCommand,
  creatorListCommand,
  creatorNextCommand,
  creatorStartCommand,
  creatorStatusCommand,
} from '../../app/commands/creator.js';
import { createCreatorRuntime } from '../../domains/workflow-creation/index.js';

let root: string;
const output = vi.spyOn(console, 'log').mockImplementation(() => {});
function result() {
  return JSON.parse(output.mock.calls.at(-1)![0]);
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-creator-command-'));
  output.mockClear();
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
async function dispatch(request: unknown) {
  const file = path.join(root, 'request.json');
  await fs.writeFile(file, JSON.stringify(request));
  return creatorDispatchCommand('report', { project: root, request: file });
}

it('starts, lists and resumes the same Creator Run, then preserves its cancellation', async () => {
  await creatorListCommand({ project: root });
  expect(result()).toEqual([]);
  const config = path.join(root, 'eval.json');
  await fs.writeFile(config, JSON.stringify({ agent: 'codex', model: 'test-model' }));
  await creatorStartCommand('report', {
    project: root,
    goal: '创建报告审批流程',
    installTarget: 'exports/report',
    host: 'codex',
    evalConfig: config,
  });
  const started = result();
  expect(started).toMatchObject({ runId: 'report', goal: '创建报告审批流程' });
  const runtime = createCreatorRuntime(root);
  const run = await runtime.inspect('report');
  expect(run.workflow.version).toBe('6');
  expect(run.input).toMatchObject({ evaluation: { agent: 'codex', model: 'test-model' } });
  await creatorStatusCommand('report', { project: root });
  expect(result()).toEqual(started);
  await creatorListCommand({ project: root });
  expect(result()).toEqual([started]);
  await creatorNextCommand('report', { project: root });
  expect(result()).toMatchObject({
    runId: 'report',
    actions: [expect.objectContaining({ stepId: 'analyze', status: 'pending' })],
  });
  await dispatch({
    operation: 'cancel',
    runId: 'report',
    expectedRevision: result().revision,
    reason: '用户停止创作',
  });
  expect(result()).toMatchObject({ runId: 'report', status: 'cancelled' });
  await creatorStatusCommand('report', { project: root });
  expect(result().status).toBe('cancelled');
});

it('rejects requests for another Run, unknown operations and undeclared fields without changing state', async () => {
  await creatorStartCommand('report', {
    project: root,
    goal: '保留当前方案',
    installTarget: 'exports/report',
    host: 'codex',
  });
  const started = result();
  await expect(dispatch({ operation: 'cancel', runId: 'other', reason: 'stop' })).rejects.toThrow(
    '当前Creator Run',
  );
  await expect(dispatch({ operation: 'finish', runId: 'report' })).rejects.toThrow('不支持');
  await expect(
    dispatch({ operation: 'cancel', runId: 'report', reason: 'stop', approved: true }),
  ).rejects.toThrow('未声明字段');
  await creatorStatusCommand('report', { project: root });
  expect(result()).toEqual(started);
});

it('claims the current Action with its original identity and rejects a stale revision', async () => {
  await creatorStartCommand('report', {
    project: root,
    goal: '生成报告',
    installTarget: 'exports/report',
    host: 'codex',
  });
  const started = result();
  const action = started.actions[0];
  const request = {
    operation: 'claim',
    runId: 'report',
    expectedRevision: started.revision,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'creator-host',
    sessionId: 'current-session',
    claimToken: 'current-claim',
    capabilities: ['skill-load', 'handoff'],
  };
  await dispatch(request);
  const claimed = result();
  expect(claimed.actions[0]).toMatchObject({
    id: action.id,
    attempt: action.attempt,
    status: 'running',
    claim: { executorId: 'creator-host', sessionId: 'current-session' },
  });
  await expect(
    dispatch({
      operation: 'cancel',
      runId: 'report',
      expectedRevision: started.revision,
      reason: 'stale request',
    }),
  ).rejects.toThrow();
  await creatorStatusCommand('report', { project: root });
  expect(result()).toEqual(claimed);
});
