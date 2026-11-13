import '../helpers/isolated-agent-home.js';
import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { nativeVerificationFixture } from '../helpers/native-verification-fixture.js';
import { fixtureAcceptanceReview } from '../helpers/native-builder-acceptance-review.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
it('submits the typed receipt template through the public CLI without rebuilding identity fields', async () => {
  const binary = path.resolve('bin/comet.js');
  await fs.access(path.resolve('dist/app/cli/index.js'));
  const originalTask = 'Produce the expected value without changing the public interface.';
  const f = await nativeVerificationFixture((root) => roots.push(root), binary, originalTask);
  expect((await f.inspect()).workflow.version).toBe('4');
  const pending = await f.invoke('next', 'verification-test'),
    file = path.join(path.dirname(f.root), 'opaque-result.json');
  const dispatch = async (request: unknown) => {
    await fs.writeFile(file, JSON.stringify(request));
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
          f.root,
          '--request',
          file,
          '--json',
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 30000 },
      ),
    );
  };
  const builder = await dispatch({
      ...pending.data.pendingAction.claimRequest,
      sessionId: 'public-builder',
    }),
    request = builder.data.resultRequest;
  expect(builder.data.originalRequest).toEqual({
    source: 'run.input.task',
    text: originalTask,
  });
  expect(Object.keys(request).sort()).toEqual(['operation', 'receipt', 'result']);
  expect(request.receipt).toEqual(expect.any(String));
  expect(request.result.output).toMatchObject({
    addressedAcceptanceIds: ['A1'],
    checks: [
      {
        name: expect.any(String),
        result: expect.any(String),
        note: expect.any(String),
      },
    ],
  });
  expect(builder.data).not.toHaveProperty('checkRequestTemplate');
  expect(request.result.output).not.toHaveProperty('verificationChecks');
  await fs.writeFile(path.join(f.root, 'value.txt'), 'expected\n');
  const observed = execFileSync(
    process.execPath,
    ['-e', "process.stdout.write(require('node:fs').readFileSync('value.txt','utf8'))"],
    { cwd: f.root, encoding: 'utf8', windowsHide: true, timeout: 10000 },
  );
  expect(observed).toBe('expected\n');
  const checks = [
    {
      name: 'Read the final value',
      result: 'passed',
      note: 'Actual platform Node command stdout: ' + observed.trim(),
    },
  ];
  request.result.output = {
    ...request.result.output,
    summary: 'SIMULATED Agent implemented the expected value.',
    acceptanceReview: fixtureAcceptanceReview(['A1']),
    checks,
    knownLimits: [],
    requireIndependentReview: true,
  };
  await dispatch(request);
  const built = await f.inspect();
  expect(built.actions.at(-1)).toMatchObject({
    stepId: 'verify.verifier',
    status: 'pending',
  });
  expect(
    built.actions.some((a: any) =>
      ['verify.checks', 'verify.requested-checks', 'build.checks'].includes(a.stepId),
    ),
  ).toBe(false);
  expect(built.state.builder_handoff.checks).toMatchObject([
    {
      name: { text: 'Read the final value' },
      result: 'passed',
      note: { text: 'Actual platform Node command stdout: expected' },
    },
  ]);
  await dispatch(request);
  expect(await f.inspect()).toEqual(built);
  const review = await f.invoke('next', 'verification-test');
  expect(review.data.pendingAction.sessionRequirements).toMatchObject({
    independent: true,
    readOnly: true,
  });
  const reviewer = await dispatch({
    ...review.data.pendingAction.claimRequest,
    sessionId: 'public-reviewer',
  });
  expect(reviewer.data.originalRequest).toEqual({
    source: 'run.input.task',
    text: originalTask,
  });
  const finalRequest = reviewer.data.resultRequest;
  expect(Object.keys(finalRequest).sort()).toEqual(['operation', 'receipt', 'result']);
  expect(finalRequest.result.output.response.result.requestReview).toMatchObject({
    result: '<aligned|conflict|blocked>',
  });
  expect(reviewer.data).not.toHaveProperty('refreshChecksResultRequest');
  finalRequest.result.output.response.result = {
    ...finalRequest.result.output.response.result,
    verdict: 'pass',
    acceptance: [
      {
        id: 'A1',
        result: 'passed',
        reason: 'SIMULATED independent fixture reading agrees with actual expected stdout.',
      },
    ],
    risks: [],
    summary: 'SIMULATED Agent compared the original request, Spec and actual value.',
    requestReview: {
      result: 'aligned',
      reason: 'Expected value and the original public interface agree in this isolated fixture.',
    },
  };
  await dispatch(finalRequest);
  const verified = await f.inspect();
  expect(verified.state).toMatchObject({
    phase: 'verify',
    status: 'await-user',
    verification_result: 'pass',
  });
  expect(verified.waits.at(-1)).toMatchObject({
    stepId: 'verify.confirm',
    status: 'pending',
  });
  expect(verified.actions.some((a: any) => a.stepId.startsWith('archive.'))).toBe(false);
  await dispatch(finalRequest);
  expect(await f.inspect()).toEqual(verified);
  await f.invoke('next', 'verification-test');
  expect(await f.inspect()).toEqual(verified);
  await f.invoke(
    'next',
    'verification-test',
    '--accept-result',
    '--summary',
    'SIMULATED USER accepts this isolated verified result',
    '--expected-state-version',
    String(verified.state.state_version),
    '--expected-action',
    'accept-result',
    '--proposal-hash',
    verified.waits.at(-1).proposalHash,
  );
  const accepted = await f.inspect();
  expect(accepted.waits.find((w: any) => w.id === verified.waits.at(-1).id)).toMatchObject({
    status: 'resolved',
    decision: { choice: 'approved' },
  });
  expect(accepted.state.verification_result).toBe('pass');
  expect(accepted.actions.filter((a: any) => a.stepId === 'verify.verifier')).toHaveLength(1);
}, 90000);
