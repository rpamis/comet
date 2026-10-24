import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runtimeDispatchCommand } from '../../app/commands/runtime.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('accepts a reason only as bounded text in the public resolve-wait request and preserves it after reopening', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-cli-wait-reason-'));
  roots.push(root);
  const workflow = path.join(root, 'workflow.json');
  await fs.writeFile(
    workflow,
    JSON.stringify({
      id: 'review',
      version: '1',
      entry: 'prepare',
      steps: {
        prepare: { type: 'handoff', ref: 'prepare' },
        decision: { type: 'ask_user', proposalFrom: 'prepare', choices: ['retry'] },
        verifier: { type: 'handoff', ref: 'review' },
      },
      transitions: [
        { from: 'prepare', to: 'decision' },
        { from: 'decision', to: 'verifier', on: 'retry' },
      ],
    }),
  );
  let sequence = 0;
  async function dispatch(request: unknown) {
    const file = path.join(root, `request-${++sequence}.json`);
    await fs.writeFile(file, JSON.stringify(request));
    return runtimeDispatchCommand({
      projectRoot: root,
      rootDir: path.join(root, 'runs'),
      workflow: [workflow],
      request: file,
    });
  }
  const start = await dispatch({
    operation: 'start',
    runId: 'review',
    workflow: { id: 'review', version: '1' },
    input: null,
  });
  expect(start.response.status, JSON.stringify(start.response)).toBe('succeeded');
  if (start.response.status !== 'succeeded') throw new Error('Start failed');
  const prepare = start.response.data.actions[0];
  await dispatch({
    operation: 'claim',
    runId: 'review',
    actionId: prepare.id,
    attempt: prepare.attempt,
    inputHash: prepare.inputHash,
    executorId: 'host',
    claimToken: 'prepare',
  });
  const prepared = await dispatch({
    operation: 'record-outcome',
    runId: 'review',
    outcome: {
      actionId: prepare.id,
      attempt: prepare.attempt,
      inputHash: prepare.inputHash,
      claimToken: 'prepare',
      outcomeId: 'prepared',
      status: 'succeeded',
      output: null,
    },
  });
  if (prepared.response.status !== 'succeeded') throw new Error(JSON.stringify(prepared));
  const wait = prepared.response.data.waits[0];
  const request = {
    operation: 'resolve-wait',
    runId: 'review',
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'decision-1',
    choice: 'retry',
  };
  for (const reason of [null, 1, {}, '', ' ', 'x'.repeat(4097)])
    expect((await dispatch({ ...request, reason })).response.status).toBe('failed');
  const reason = 'x'.repeat(4096);
  const resolved = await dispatch({ ...request, reason });
  expect(resolved.response).toMatchObject({
    status: 'succeeded',
    data: {
      waits: [{ decision: { reason } }],
    },
  });
  const inspected = await dispatch({ operation: 'inspect', runId: 'review' });
  expect(inspected.response).toMatchObject({
    status: 'succeeded',
    data: { waits: [{ decision: { reason } }] },
  });
  expect((await dispatch({ ...request, reason: 'Different instruction' })).response).toMatchObject({
    status: 'failed',
    error: { code: 'DECISION_CONFLICT' },
  });
});
