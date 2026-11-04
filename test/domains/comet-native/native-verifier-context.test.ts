import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { bugfreeFixture } from '../../helpers/native-bugfree.js';
import { nativeVerifierContext } from '../../../domains/comet-native/native-verifier-context.js';
import { projectNativeSdkDispatchResult } from '../../../domains/comet-native/native-sdk-continuation.js';
import { loadOwnedNativeSdkRuntime } from '../../../domains/comet-native/native-runtime-ownership.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { nativeEditReviewScope } from '../../../domains/comet-native/native-edit-review.js';
import {
  prepareObservedEditReview,
  recordEditReview,
} from '../../../domains/workflow-contract/edit-review.js';
import { nativeVerifyMode } from '../../../domains/comet-native/native-verification-policy.js';
import {
  writeProjectConfig,
  defaultProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import type { WorkflowRun, RuntimeValue } from '../../../domains/engine/runtime.js';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it('pins mode, captures the complete change and passes without inventing command checks', async () => {
  const fixture = await bugfreeFixture((root) => roots.push(root));
  await writeProjectConfig(fixture.root, defaultProjectConfig('docs', 'zh-CN'));
  let run = await fixture.candidate('expected\n');
  expect(nativeVerifyMode(run)).toBe('bugfree');
  const action = run.actions.at(-1)!;
  expect(action.stepId).toBe('verify.verifier');
  const context = await nativeVerifierContext(run, action, fixture.root);
  expect(context?.session.strategy).toBe('fresh');
  expect(context?.changeRefs).toMatchObject({
    complete: true,
    fullChanges: expect.arrayContaining([expect.objectContaining({ path: 'value.txt' })]),
  });
  expect(context?.acceptance).toHaveLength(1);
  const state = run.state as {
    builder_handoff: { candidate_id: string };
    loop: { iteration: number; attempt: number };
  };
  await fixture.submit(
    {
      candidateId: state.builder_handoff.candidate_id,
      verifierExecutionRef: 'reviewer',
      response: {
        kind: 'final-result',
        result: {
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          verdict: 'pass',
          passedAcceptanceIds: ['A1'],
          acceptance: [],
          risks: [],
          summary: 'Read final value and requirements.',
        },
      },
    },
    'reviewer',
  );
  await fixture.invoke('next', 'bugfree-test');
  const report = await fs.readFile(path.join(fixture.change, 'verification.md'), 'utf8');
  expect(report).toContain('bugfree');
  expect(report).toContain('本轮未执行命令检查');
  run = await fixture.inspect();
  expect(run.status).toBe('waiting');
  expect(run.waits.at(-1)?.stepId).toBe('verify.confirm');
});

function final(run: WorkflowRun, sessionId: string, verdict = 'pass'): RuntimeValue {
  const state = run.state as {
    builder_handoff: { candidate_id: string };
    loop: { iteration: number; attempt: number };
  };
  return {
    candidateId: state.builder_handoff.candidate_id,
    verifierExecutionRef: sessionId,
    response: {
      kind: 'final-result',
      result: {
        iteration: state.loop.iteration,
        attempt: state.loop.attempt,
        verdict,
        passedAcceptanceIds: verdict === 'pass' ? ['A1'] : [],
        acceptance:
          verdict === 'pass' ? [] : [{ id: 'A1', result: 'failed', reason: 'The value is wrong.' }],
        risks: [],
        summary: 'Read the final value and caller.',
      },
    },
  };
}

it('reports actual receipt reuse after a successor candidate without claiming another execution', async () => {
  const fixture = await bugfreeFixture((root) => roots.push(root));
  const checks = [
    {
      id: 'same-input',
      name: 'Read unchanged input',
      executable: process.execPath,
      argv: ['-e', "process.stdout.write(require('node:fs').readFileSync('value.txt','utf8'))"],
      cwdRef: '.',
      timeoutMs: 10000,
      repeatable: true,
    },
  ];
  let run = await fixture.candidate('expected\n', 'builder', checks);
  const original = run.actions.find((action) => action.stepId === 'verify.checks')!;
  await fixture.submit(final(run, 'reviewer', 'fail'), 'reviewer');
  run = await fixture.candidate('expected\n', 'repair-builder', checks);
  const latest = run.actions.filter((action) => action.stepId === 'verify.checks').at(-1)!;
  expect(latest.outcome?.output).toMatchObject({
    checks: [{ reusedFrom: { actionId: original.id } }],
  });
  await fixture.submit(final(run, 'reviewer'), 'reviewer');
  await fixture.invoke('next', 'bugfree-test');
  const report = await fs.readFile(path.join(fixture.change, 'verification.md'), 'utf8');
  expect(report).toContain('复用记录，本轮未重新执行');
  expect(report).toContain(`原执行来源=${original.id}`);
  expect(report).toContain('日志=');
});

it('rejects Builder self-certification even with complete compact coverage', async () => {
  const fixture = await bugfreeFixture((root) => roots.push(root));
  const run = await fixture.candidate('expected\n');
  await expect(fixture.submit(final(run, 'builder'), 'builder')).rejects.toThrow(
    /implementation|independent/,
  );
  expect((await fixture.inspect()).status).toBe('running');
});

it('rejects changed candidate bytes instead of accepting a compact pass', async () => {
  const fixture = await bugfreeFixture((root) => roots.push(root));
  const run = await fixture.candidate('expected\n');
  await fs.writeFile(path.join(fixture.root, 'value.txt'), 'changed while reviewing\n');
  await expect(fixture.submit(final(run, 'reviewer'), 'reviewer')).rejects.toThrow();
  expect((await fixture.inspect()).waits.some((wait) => wait.stepId === 'verify.confirm')).toBe(
    false,
  );
});

it('shows live check input changes and returns a bound refresh request without manual protocol fields', async () => {
  const fixture = await bugfreeFixture((root) => roots.push(root));
  const cache = path.join(fixture.root, 'check-cache.bin');
  await fs.writeFile(cache, 'generated');
  const check = {
    id: 'read-cache',
    name: 'Read and restore generated cache',
    executable: process.execPath,
    argv: ['-e', "require('node:fs').writeFileSync('check-cache.bin','generated')"],
    cwdRef: '.',
    timeoutMs: 10000,
    repeatable: true,
  };
  const run = await fixture.candidate('expected\n', 'builder', [check]);
  const action = run.actions.at(-1)!;
  expect(action.stepId).toBe('verify.verifier');
  await fs.unlink(cache);
  const context = await nativeVerifierContext(run, action, fixture.root);
  expect(context?.checkInput).toMatchObject({
    status: 'changed',
    candidateStatus: 'changed',
    recovery: {
      commandArgs: [
        'comet',
        'edit-review',
        'observe',
        'native',
        'bugfree-test',
        '--session',
        '<current-agent-session>',
        '--json',
      ],
    },
    changes: [expect.objectContaining({ path: 'check-cache.bin', afterHash: 'missing' })],
  });
  expect((context?.changeRefs as { fullChanges: Array<{ path: string }> }).fullChanges).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'check-cache.bin',
        afterHash: expect.not.stringMatching(/^missing$/u),
      }),
    ]),
  );
  const owned = await loadOwnedNativeSdkRuntime(fixture.root, 'bugfree-test');
  const claimed = await owned.runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'native-host',
    sessionId: 'reviewer',
    claimToken: 'refresh-reader',
    context: { projectRoot: fixture.root, requestId: 'refresh-reader' },
  });
  const projection = await projectNativeSdkDispatchResult({
    run: claimed,
    state: claimed.state as unknown as NativePortableState,
    actionId: action.id,
    projectRoot: fixture.root,
  });
  expect(projection.resultRequest?.result.output).toMatchObject({
    candidateId: expect.any(String),
    verifierExecutionRef: 'reviewer',
  });
  expect(projection.refreshChecksResultRequest).toMatchObject({
    operation: 'record-outcome',
    receipt: projection.resultRequest!.receipt,
    result: {
      status: 'succeeded',
      output: {
        refreshChecks: true,
        candidateId: expect.any(String),
        verifierExecutionRef: 'reviewer',
        response: { kind: 'request-checks', checks: [check] },
      },
    },
  });
  await expect(fixture.submit(final(claimed, 'reviewer'), 'reviewer')).rejects.toThrow();
  const paths = await nativeProjectPaths(fixture.root, 'docs');
  const scope = {
    ...nativeEditReviewScope(paths, claimed.state as unknown as NativePortableState),
    judgment: 'agent' as const,
  };
  const proposal = await prepareObservedEditReview(scope, context!.checkInput.changes);
  const original = run.actions.find((entry) => entry.stepId === 'verify.checks')!;
  await recordEditReview(
    scope,
    {
      proposalHash: proposal.proposalHash,
      decision: 'non-behavioral',
      summary:
        'Only generated cache was removed; implementation and the original check remain applicable.',
      retainedChecks: [{ actionId: original.id, checkId: check.id }],
    },
    { kind: 'runtime-agent', executionRef: 'reviewer' },
  );
  const retained = await fixture.inspect();
  expect(
    (await nativeVerifierContext(retained, retained.actions.at(-1)!, fixture.root))?.checkInput,
  ).toMatchObject({
    status: 'changed',
    candidateStatus: 'unchanged',
    evidenceStatus: 'retained',
  });
  await fixture.submit(final(retained, 'reviewer'), 'reviewer');
  expect(
    (await fixture.inspect()).actions.filter((entry) =>
      ['verify.checks', 'verify.requested-checks'].includes(entry.stepId),
    ),
  ).toHaveLength(1);
});

it('does not offer a refresh template that would replay a one-time check', async () => {
  const fixture = await bugfreeFixture((root) => roots.push(root));
  const run = await fixture.candidate('expected\n', 'builder', [
    {
      id: 'once',
      name: 'One-time check',
      executable: process.execPath,
      argv: ['-e', "process.stdout.write('once')"],
      cwdRef: '.',
      timeoutMs: 10000,
      repeatable: false,
    },
  ]);
  const action = run.actions.at(-1)!;
  const owned = await loadOwnedNativeSdkRuntime(fixture.root, 'bugfree-test');
  const claimed = await owned.runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'native-host',
    sessionId: 'reviewer',
    claimToken: 'once-review',
    context: { projectRoot: fixture.root, requestId: 'once-review' },
  });
  const projection = await projectNativeSdkDispatchResult({
    run: claimed,
    state: claimed.state as unknown as NativePortableState,
    actionId: action.id,
    projectRoot: fixture.root,
  });
  expect(projection.refreshChecksResultRequest).toBeUndefined();
  expect(
    (await fixture.inspect()).actions.filter((entry) => entry.stepId === 'verify.checks'),
  ).toHaveLength(1);
});

it('rejects a corrupted creation baseline instead of rebuilding it from the candidate', async () => {
  const fixture = await bugfreeFixture((root) => roots.push(root));
  const run = await fixture.candidate('expected\n');
  const { resolveWorkspaceRuntimeRoot } =
    await import('../../../domains/workflow-contract/workspace-runtime.js');
  const baseline = (run.input as { verificationBaseline: { ref: string } }).verificationBaseline;
  await fs.appendFile(
    path.join(await resolveWorkspaceRuntimeRoot(fixture.root), baseline.ref),
    'changed',
  );
  await expect(fixture.submit(final(run, 'reviewer'), 'reviewer')).rejects.toThrow();
  expect((await fixture.inspect()).waits.some((wait) => wait.stepId === 'verify.confirm')).toBe(
    false,
  );
});

it('returns requested check results to the original independent session', async () => {
  const fixture = await bugfreeFixture((root) => roots.push(root));
  let run = await fixture.candidate('expected\n');
  const state = run.state as {
    builder_handoff: { candidate_id: string };
    loop: { iteration: number; attempt: number };
  };
  await fixture.submit(
    {
      candidateId: state.builder_handoff.candidate_id,
      verifierExecutionRef: 'reviewer',
      response: {
        kind: 'request-checks',
        iteration: state.loop.iteration,
        attempt: state.loop.attempt,
        checks: [
          {
            id: 'read-value',
            name: 'Read expected value',
            executable: process.execPath,
            argv: [
              '-e',
              "if(require('fs').readFileSync('value.txt','utf8')!=='expected\\n')process.exit(1)",
            ],
            cwdRef: '.',
            timeoutMs: 10000,
            repeatable: true,
          },
        ],
      },
    },
    'reviewer',
  );
  await fixture.invoke('next', 'bugfree-test');
  run = await fixture.inspect();
  const context = await nativeVerifierContext(run, run.actions.at(-1)!, fixture.root);
  expect(context?.session).toMatchObject({ strategy: 'resume', sessionId: 'reviewer' });
  expect(
    context?.checkEvidence.some((batch) =>
      (batch.checks as Array<{ id: string; status: string }>).some(
        (check) => check.id === 'read-value' && check.status === 'passed',
      ),
    ),
  ).toBe(true);
  await fixture.submit(final(run, 'reviewer'), 'reviewer');
  await fixture.invoke('next', 'bugfree-test');
  expect((await fixture.inspect()).waits.at(-1)?.stepId).toBe('verify.confirm');
});

it('continues independent semantic review after a repair with new candidate identity', async () => {
  const fixture = await bugfreeFixture((root) => roots.push(root));
  let run = await fixture.candidate('wrong\n');
  const oldCandidate = (run.state as { builder_handoff: { candidate_id: string } }).builder_handoff
    .candidate_id;
  await fixture.submit(final(run, 'reviewer', 'fail'), 'reviewer');
  run = await fixture.candidate('expected\n', 'repair-builder');
  expect(
    (run.state as { builder_handoff: { candidate_id: string } }).builder_handoff.candidate_id,
  ).not.toBe(oldCandidate);
  const context = await nativeVerifierContext(run, run.actions.at(-1)!, fixture.root);
  expect(context?.session).toMatchObject({ strategy: 'resume', sessionId: 'reviewer' });
  expect(context?.changeRefs).toMatchObject({
    complete: true,
    incrementalChanges: expect.arrayContaining([expect.objectContaining({ path: 'value.txt' })]),
  });
  await fixture.submit(final(run, 'reviewer'), 'reviewer');
  await fixture.invoke('next', 'bugfree-test');
  expect((await fixture.inspect()).waits.at(-1)?.stepId).toBe('verify.confirm');
});

it('requires a fresh session when the user requests another review of the same candidate', async () => {
  const fixture = await bugfreeFixture((root) => roots.push(root));
  let run = await fixture.candidate('expected\n');
  await fixture.submit(final(run, 'reviewer'), 'reviewer');
  await fixture.invoke('next', 'bugfree-test');
  run = await fixture.inspect();
  const wait = run.waits.find(
    (entry) => entry.stepId === 'verify.confirm' && entry.status === 'pending',
  )!;
  const { loadOwnedNativeSdkRuntime } =
    await import('../../../domains/comet-native/native-runtime-ownership.js');
  const { runtime } = await loadOwnedNativeSdkRuntime(fixture.root, 'bugfree-test');
  await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'request-new-review',
    choice: 'reverify',
    context: { projectRoot: fixture.root, requestId: 'request-new-review' },
  });
  await fixture.invoke('next', 'bugfree-test');
  run = await fixture.inspect();
  const context = await nativeVerifierContext(run, run.actions.at(-1)!, fixture.root);
  expect(context?.session.strategy).toBe('fresh');
  await expect(fixture.submit(final(run, 'reviewer'), 'reviewer')).rejects.toThrow(
    'fresh independent',
  );
});

it('preserves an actual diagnostic failure and allows semantic confirmation of its successor repair', async () => {
  const fixture = await bugfreeFixture((root) => roots.push(root));
  await fixture.candidate('wrong\n', 'builder', [
    {
      id: 'diagnose-value',
      name: 'Observe expected value',
      executable: process.execPath,
      argv: [
        '-e',
        "if(require('fs').readFileSync('value.txt','utf8')!=='expected\\n')process.exit(1)",
      ],
      cwdRef: '.',
      timeoutMs: 10000,
      repeatable: true,
    },
  ]);
  let run = await fixture.inspect();
  expect(run.actions.some((action) => action.stepId === 'verify.verifier')).toBe(false);
  const failed = run.actions.find(
    (action) => action.stepId === 'verify.checks' && action.status === 'failed',
  )!;
  expect(failed).toBeTruthy();
  run = await fixture.candidate('expected\n', 'repair-builder');
  const context = await nativeVerifierContext(run, run.actions.at(-1)!, fixture.root);
  expect(
    context?.checkEvidence.some(
      (batch) => batch.actionId === failed.id && batch.status === 'failed',
    ),
  ).toBe(true);
  await fixture.submit(final(run, 'reviewer'), 'reviewer');
  await fixture.invoke('next', 'bugfree-test');
  run = await fixture.inspect();
  expect(run.actions.find((action) => action.id === failed.id)?.outcome).toEqual(failed.outcome);
  expect(run.waits.at(-1)?.stepId).toBe('verify.confirm');
  const report = await fs.readFile(path.join(fixture.change, 'verification.md'), 'utf8');
  expect(report).toContain('前轮候选检查失败');
  expect(report).toContain('diagnose-value');
  expect(report).toContain('本轮未重跑');
});
