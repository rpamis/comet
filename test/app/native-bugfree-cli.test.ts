import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { bugfreeFixture } from '../helpers/native-bugfree.js';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';
import { resolveWorkspaceRuntimeRootSync } from '../../domains/workflow-contract/workspace-runtime.js';
import { execFileSync } from 'node:child_process';
import { fixtureAcceptanceReview } from '../helpers/native-builder-acceptance-review.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it('submits the typed receipt template through the public CLI without rebuilding identity fields', async () => {
  await ensureCliBuilt(path.resolve('.'));
  const binary = path.resolve('bin/comet.js');
  const originalTask = 'Produce the expected value without changing the public interface.';
  const fixture = await bugfreeFixture((root) => roots.push(root), binary, originalTask);
  const pending = await fixture.invoke('next', 'bugfree-test');
  const requestFile = path.join(path.dirname(fixture.root), 'opaque-result.json');
  const dispatch = async (request: unknown) => {
    await fs.writeFile(requestFile, JSON.stringify(request));
    return JSON.parse(
      execFileSync(
        process.execPath,
        [
          binary,
          'runtime',
          'dispatch',
          '--application',
          'native',
          '--project-root',
          fixture.root,
          '--request',
          requestFile,
          '--json',
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 30000 },
      ),
    );
  };
  const claimed = await dispatch({
    ...pending.data.pendingAction.claimRequest,
    sessionId: 'public-builder',
  });
  const request = claimed.data.resultRequest;
  expect(claimed.data.originalRequest).toEqual({ source: 'run.input.task', text: originalTask });
  expect(request.result.output).toMatchObject({
    verificationChecks: [],
    acceptanceReview: [{ id: 'A1' }],
  });
  expect(claimed.data.checkRequestTemplate).toMatchObject({
    executable: expect.any(String),
    argv: expect.any(Array),
  });
  await fs.writeFile(path.join(fixture.root, 'value.txt'), 'expected\n');
  request.result.output = {
    ...request.result.output,
    summary: 'Implemented the expected value.',
    acceptanceReview: fixtureAcceptanceReview(['A1']),
    checks: [],
    knownLimits: [],
    verificationChecks: [
      {
        id: 'read-value',
        name: 'Read the final value',
        executable: process.execPath,
        argv: ['-e', "process.stdout.write(require('node:fs').readFileSync('value.txt','utf8'))"],
        cwdRef: '.',
        timeoutMs: 10000,
        repeatable: true,
      },
    ],
  };
  await dispatch(request);
  const accepted = await fixture.inspect();
  expect(accepted.actions.at(-1)).toMatchObject({ stepId: 'verify.checks', status: 'pending' });
  await dispatch(request);
  expect(await fixture.inspect()).toEqual(accepted);
  const review = await fixture.invoke('next', 'bugfree-test');
  const reviewer = await dispatch({
    ...review.data.pendingAction.claimRequest,
    sessionId: 'public-reviewer',
  });
  expect(reviewer.data.resultRequest.result.output.response.result.requestReview).toMatchObject({
    result: '<aligned|conflict|blocked>',
  });
  await dispatch(reviewer.data.refreshChecksResultRequest);
  await fixture.invoke('next', 'bugfree-test');
  const refreshed = await fixture.inspect();
  expect(refreshed.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
  expect(
    refreshed.actions.filter((action) => action.stepId === 'verify.requested-checks'),
  ).toHaveLength(1);
  const continuation = await fixture.invoke('next', 'bugfree-test');
  const resumed = await dispatch({
    ...continuation.data.pendingAction.claimRequest,
    sessionId: 'public-reviewer',
  });
  const finalRequest = resumed.data.resultRequest;
  finalRequest.result.output.response.result = {
    ...finalRequest.result.output.response.result,
    verdict: 'pass',
    passedAcceptanceIds: ['A1'],
    acceptance: [],
    risks: [],
    summary: 'The original request, Spec and current value agree.',
    requestReview: {
      result: 'aligned',
      reason: 'The expected value is implemented and the public interface remains unchanged.',
    },
  };
  await dispatch(finalRequest);
  expect((await fixture.inspect()).state).toMatchObject({ verification_result: 'pass' });
}, 90000);

it('runs public CLI claims, requested checks, compact results, cold recovery and acceptance', async () => {
  await ensureCliBuilt(path.resolve('.'));
  const fixture = await bugfreeFixture((root) => roots.push(root), path.resolve('bin/comet.js'));
  let run = await fixture.candidate('expected\n');
  const status = await fixture.invoke('status', 'bugfree-test');
  expect(status.data).toMatchObject({ verifyMode: 'bugfree' });
  let state = run.state as {
    builder_handoff: { candidate_id: string };
    loop: { iteration: number; attempt: number };
  };
  await fixture.submit(
    {
      candidateId: state.builder_handoff.candidate_id,
      verifierExecutionRef: 'external-reviewer',
      response: {
        kind: 'request-checks',
        iteration: state.loop.iteration,
        attempt: state.loop.attempt,
        checks: [
          {
            id: 'actual-value',
            name: 'Read actual value',
            executable: process.execPath,
            argv: [
              '-e',
              "if(require('node:fs').readFileSync('value.txt','utf8')!=='expected\\n')process.exit(1)",
            ],
            cwdRef: '.',
            timeoutMs: 10000,
            repeatable: true,
          },
        ],
      },
    },
    'external-reviewer',
  );
  await fixture.invoke('next', 'bugfree-test');
  run = await fixture.inspect();
  state = run.state;
  await fixture.submit(
    {
      candidateId: state.builder_handoff.candidate_id,
      verifierExecutionRef: 'external-reviewer',
      response: {
        kind: 'final-result',
        result: {
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          verdict: 'pass',
          passedAcceptanceIds: ['A1'],
          acceptance: [],
          risks: [],
          summary: 'Verified final value.',
        },
      },
    },
    'external-reviewer',
  );
  await fixture.invoke('next', 'bugfree-test');
  const report = await fs.readFile(path.join(fixture.change, 'verification.md'), 'utf8');
  expect(report).toContain('bugfree');
  expect(report).toContain('本轮实际执行');
  expect(report).toContain('actual-value');
  const final = await fixture.inspect();
  expect(final.waits.at(-1)?.stepId).toBe('verify.confirm');
  expect(final.status).toBe('waiting');
  const reviewerIds = final.actions
    .filter((action: { stepId: string }) => action.stepId === 'verify.verifier')
    .map((action: { id: string }) => action.id);
  const runtimeRoot = resolveWorkspaceRuntimeRootSync(fixture.root);
  expect(path.relative(process.env.COMET_DATA_DIR!, runtimeRoot).startsWith('..')).toBe(false);
  for (const directory of ['sdk-runs', 'applications', 'change-owners', 'state-projections'])
    await fs.rm(path.join(runtimeRoot, directory), { recursive: true, force: true });
  await expect(fixture.invoke('status', 'bugfree-test')).rejects.toThrow('checkpoint recovery');
  await fixture.invoke('doctor', 'bugfree-test', '--repair', '--confirmed');
  const restored = await fixture.inspect();
  expect(restored.input.verifyMode).toBe('bugfree');
  expect(
    restored.actions
      .filter((action: { stepId: string }) => action.stepId === 'verify.verifier')
      .map((action: { id: string }) => action.id),
  ).toEqual(reviewerIds);
  const wait = restored.waits.find(
    (entry: { stepId: string; status: string }) =>
      entry.stepId === 'verify.confirm' && entry.status === 'pending',
  );
  await fixture.invoke(
    'next',
    'bugfree-test',
    '--accept-result',
    '--summary',
    'Simulated fixture user accepts this result',
    '--proposal-hash',
    wait.proposalHash,
    '--expected-state-version',
    String(restored.state.state_version),
    '--expected-action',
    'accept-result',
  );
  const accepted = await fixture.inspect();
  expect(accepted.state.phase).toBe('archive');
  expect(accepted.waits.find((entry: { id: string }) => entry.id === wait.id).decision.choice).toBe(
    'approved',
  );
}, 180000);
