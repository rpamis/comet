import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nativeVerificationFixture } from '../helpers/native-verification-fixture.js';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';
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
  const fixture = await nativeVerificationFixture((root) => roots.push(root), binary, originalTask);
  const pending = await fixture.invoke('next', 'verification-test');
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
    verificationChecks: [expect.any(Object)],
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
  const review = await fixture.invoke('next', 'verification-test');
  const reviewer = await dispatch({
    ...review.data.pendingAction.claimRequest,
    sessionId: 'public-reviewer',
  });
  expect(reviewer.data.resultRequest.result.output.response.result.requestReview).toMatchObject({
    result: '<aligned|conflict|blocked>',
  });
  await dispatch(reviewer.data.refreshChecksResultRequest);
  await fixture.invoke('next', 'verification-test');
  const refreshed = await fixture.inspect();
  expect(refreshed.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
  expect(
    refreshed.actions.filter((action) => action.stepId === 'verify.requested-checks'),
  ).toHaveLength(1);
  const continuation = await fixture.invoke('next', 'verification-test');
  const resumed = await dispatch({
    ...continuation.data.pendingAction.claimRequest,
    sessionId: 'public-reviewer',
  });
  const finalRequest = resumed.data.resultRequest;
  finalRequest.result.output.response.result = {
    ...finalRequest.result.output.response.result,
    verdict: 'pass',
    acceptance: [
      { id: 'A1', result: 'passed', reason: 'The final value meets the original requirement.' },
    ],
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
