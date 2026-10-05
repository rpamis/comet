import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { prepareNativeApplication } from '../../helpers/native-application.js';
import { readChangeRuntimeOwner } from '../../../domains/workflow-contract/change-runtime-owner.js';
import { inspectCometHook } from '../../../domains/comet-entry/hook-router.js';
import type { RuntimeAction, WorkflowRun } from '../../../domains/engine/runtime.js';
import { createPortableRunCheckpoint } from '../../../domains/engine/runtime.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture(supervisor = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-application-'));
  roots.push(root);
  return prepareNativeApplication(root, supervisor);
}
async function removeLocalStores(projectRoot: string) {
  for (const directory of ['applications', 'change-owners', 'state-projections'])
    await fs.rm(path.join(projectRoot, '.comet/runtime', directory), {
      recursive: true,
      force: true,
    });
}

it('transfers a custom Supervisor through public CLI with fixed identity and an interrupted Child', async () => {
  const f = await fixture(true);
  let run = await f.dispatch({
    operation: 'execute',
    runId: f.name,
    actionId: f.pending(f.run, 'supervisor.prepare').id,
    executorId: 'native-supervisor-prepare',
  });
  for (let count = 0; count < 2; count++)
    run = await f.dispatch({
      operation: 'execute',
      runId: f.name,
      actionId: f.pending(run, 'supervisor.child.prepare').id,
      executorId: 'native-supervisor-child-prepare',
    });
  const builder = f.pending(run, 'supervisor.child.builder');
  run = await f.submitBuilder(builder, 'approved\n', 'original-child-builder');
  run = await f.dispatch({
    operation: 'execute',
    runId: f.name,
    actionId: f.pending(run, 'supervisor.child.checks').id,
    executorId: 'comet-native-checks',
  });
  const review = f.pending(run, 'native.extension.child.candidate-review');
  run = await f.dispatch({
    operation: 'claim',
    runId: f.name,
    actionId: review.id,
    attempt: review.attempt,
    inputHash: review.inputHash,
    executorId: 'native-review-script',
    capabilities: ['skill-script'],
    sessionId: 'interrupted-child-review',
    claimToken: 'original-review-claim',
  });
  const claimed = run.actions.find((action) => action.id === review.id)!;
  const childRoot = (claimed.input as { activation: { workspaceRoot: string } }).activation
    .workspaceRoot;
  const script = path.join(path.dirname(f.file), 'candidate-review/scripts/review.mjs');
  const originalResult = JSON.parse(
    execFileSync(process.execPath, [script, JSON.stringify(claimed.input)], { encoding: 'utf8' }),
  );
  const originalBytes = await fs.readFile(path.join(childRoot, 'candidate.txt'));
  run = await f.dispatch({
    operation: 'mark-unknown',
    runId: f.name,
    actionId: claimed.id,
    attempt: claimed.attempt,
    reason: 'Host interrupted before reporting',
  });
  const transfer = path.join(f.root, 'transfer');
  await f.native(['transfer', 'export', f.name, '--output', transfer, '--confirmed-stopped']);
  const target = path.join(f.root, 'target');
  execFileSync('git', ['clone', '--no-local', f.projectRoot, target], { stdio: 'pipe' });
  await writeProjectConfig(target, defaultProjectConfig('docs', 'en'));
  const module = path.join(path.dirname(f.file), 'application.mjs');
  const originalModule = await fs.readFile(module, 'utf8');
  await fs.writeFile(module, originalModule + '\n// fixed-package drift\n');
  const refused = await runNativeCli([
    'transfer',
    'import',
    '--input',
    transfer,
    '--project-root',
    target,
    '--json',
  ]);
  expect(refused.exitCode).not.toBe(0);
  expect(await readChangeRuntimeOwner(target, 'native', f.name)).toBeNull();
  expect(f.git(target, ['branch', '--list', 'comet/supervisor/*'])).toBe('');
  await fs.writeFile(module, originalModule);
  const result = await runNativeCli([
    'transfer',
    'import',
    '--input',
    transfer,
    '--project-root',
    target,
    '--json',
  ]);
  expect(result.exitCode, result.stdout).toBe(0);
  const status = await runNativeCli(['status', f.name, '--project-root', target, '--json']);
  expect(status.exitCode, status.stdout).toBe(0);
  expect(JSON.parse(status.stdout!).data.application).toMatchObject({
    id: 'native-candidate-review',
    projectRoot: await fs.realpath(target),
  });
  expect(await readChangeRuntimeOwner(target, 'native', f.name)).toMatchObject({
    application: 'native-candidate-review',
  });
  const statusAction = JSON.parse(status.stdout!).data.run.actions.find(
    (action: { id: string }) => action.id === claimed.id,
  );
  expect(statusAction.status).toBe('unknown');
  await fs.writeFile(path.join(childRoot, 'candidate.txt'), 'source is now corrupted\n');
  const request = path.join(f.root, 'target-request.json');
  const dispatch = (requestBody: unknown) => {
    execFileSync(process.execPath, [
      '-e',
      "require('fs').writeFileSync(process.argv[1],process.argv[2])",
      request,
      JSON.stringify(requestBody),
    ]);
    let stdout: string;
    try {
      stdout = execFileSync(
        process.execPath,
        [
          'bin/comet.js',
          'runtime',
          'dispatch',
          '--application',
          'native-candidate-review',
          '--project-root',
          target,
          '--request',
          request,
        ],
        { cwd: path.resolve('.'), encoding: 'utf8' },
      );
    } catch (error) {
      stdout = (error as { stdout?: string }).stdout!;
      if (!stdout) throw error;
    }
    return JSON.parse(stdout);
  };
  const inspected = dispatch({ operation: 'inspect', runId: f.name });
  const imported = inspected.data.actions.find((action: RuntimeAction) => action.id === claimed.id);
  expect(imported.claim).toEqual(
    createPortableRunCheckpoint(run).run.actions.find((action) => action.id === claimed.id)!.claim,
  );
  expect(imported.attempt).toBe(claimed.attempt);
  expect(imported.input.activation.workspaceRoot).not.toBe(childRoot);
  expect(
    await fs.readFile(path.join(imported.input.activation.workspaceRoot, 'candidate.txt')),
  ).toEqual(originalBytes);
  const reported = dispatch({
    operation: 'record-outcome',
    runId: f.name,
    outcome: {
      actionId: imported.id,
      attempt: imported.attempt,
      inputHash: imported.inputHash,
      claimToken: imported.claim.token,
      outcomeId: 'original-executed-review',
      status: 'succeeded',
      output: originalResult,
    },
  });
  expect(reported.status, JSON.stringify(reported.error)).toBe('succeeded');
  expect(
    reported.data.actions.find((action: RuntimeAction) => action.id === claimed.id).outcome.output,
  ).toEqual(originalResult);
  expect(
    reported.data.actions.some(
      (action: RuntimeAction) =>
        action.stepId === 'supervisor.child.verifier' && action.status === 'pending',
    ),
  ).toBe(true);
}, 120000);

it('runs a real disk Skill, repairs a failed candidate, restores cold and retains original Verify/approval', async () => {
  const f = await fixture();
  const builderWork = await f.native(['status', f.name]);
  expect(builderWork.skillWork).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        binding: expect.objectContaining({ usage: 'guidance' }),
        skill: expect.objectContaining({ contentHash: expect.any(String) }),
      }),
    ]),
  );
  let run = await f.submitBuilder(f.pending(f.run, 'build.builder'), 'missing requirement\n');
  await f.native(['next', f.name]);
  run = await f.dispatch({ operation: 'inspect', runId: f.name });
  const firstReview = f.pending(run, 'native.extension.candidate.candidate-review');
  expect(firstReview).toBeTruthy();
  expect(f.pending(run, 'verify.verifier')).toBeUndefined();
  run = await f.dispatch({
    operation: 'execute',
    runId: f.name,
    actionId: firstReview.id,
    executorId: 'native-review-script',
  });
  expect((run.state as { phase: string }).phase).toBe('build');
  run = await f.submitBuilder(f.pending(run, 'build.builder'), 'approved\n', 'repair-builder');
  await f.native(['next', f.name]);
  run = await f.dispatch({ operation: 'inspect', runId: f.name });
  const secondReview = f.pending(run, 'native.extension.candidate.candidate-review');
  expect(secondReview.id).not.toBe(firstReview.id);
  const request = path.join(f.root, 'cold-inspect.json');
  await fs.writeFile(request, JSON.stringify({ operation: 'inspect', runId: f.name }));
  const cold = JSON.parse(
    execFileSync(
      process.execPath,
      [
        'bin/comet.js',
        'runtime',
        'dispatch',
        '--application',
        'native-candidate-review',
        '--project-root',
        f.projectRoot,
        '--request',
        request,
      ],
      { cwd: path.resolve('.'), encoding: 'utf8' },
    ),
  );
  expect(cold.status).toBe('succeeded');
  expect(cold.data.actions.find((action: { id: string }) => action.id === secondReview.id)).toEqual(
    secondReview,
  );
  run = await f.dispatch({
    operation: 'execute',
    runId: f.name,
    actionId: secondReview.id,
    executorId: 'native-review-script',
  });
  expect(f.pending(run, 'verify.verifier')).toBeTruthy();
  expect(run.waits.some((wait) => wait.stepId === 'verify.confirm')).toBe(false);
  expect((run.state as { phase: string }).phase).toBe('verify');
  expect(await readChangeRuntimeOwner(f.projectRoot, 'native', f.name)).toMatchObject({
    application: 'native-candidate-review',
  });
  await f.native(['select', f.name]);
  expect(
    JSON.parse(await fs.readFile(path.join(f.projectRoot, '.comet/current-change.json'), 'utf8')),
  ).toMatchObject({ workflow: 'application', applicationId: 'native-candidate-review' });
  expect((await f.native(['doctor', f.name])).healthy).toBe(true);
  expect(
    await inspectCometHook(f.projectRoot, {
      intent: 'write',
      targets: ['candidate.txt'],
      toolName: 'Write',
      platform: 'codex',
      timing: 'before',
    }),
  ).toMatchObject({ allowed: false });
  const verifier = f.pending(run, 'verify.verifier');
  run = await f.claim(verifier, 'independent-verifier');
  run = await f.record(
    run.actions.find(({ id }) => id === verifier.id)!,
    {
      candidateId: (run.state as { builder_handoff: { candidate_id: string } }).builder_handoff
        .candidate_id,
      verifierExecutionRef: 'independent-verifier',
      response: {
        kind: 'final-result',
        result: {
          iteration: (run.state as { loop: { iteration: number } }).loop.iteration,
          attempt: (run.state as { loop: { attempt: number } }).loop.attempt,
          verdict: 'pass',
          acceptance: [{ id: 'A1', result: 'passed', reason: 'Checked actual candidate' }],
          risks: [],
          summary: 'Accepted all items',
        },
      },
    },
  );
  await f.native(['next', f.name]);
  run = await f.dispatch({ operation: 'inspect', runId: f.name });
  expect(
    run.waits.some((wait) => wait.status === 'pending' && wait.stepId === 'verify.confirm'),
  ).toBe(true);
  expect((run.state as { phase: string }).phase).toBe('verify');
  expect(await f.native(['archive', f.name, '--dry-run'])).toMatchObject({
    ready: false,
    phase: 'verify',
  });
  // 丢失本地 Store 时，只用固定包和 portable checkpoint 恢复同一 Run。
  await removeLocalStores(f.projectRoot);
  const module = path.join(path.dirname(f.file), 'application.mjs');
  const originalModule = await fs.readFile(module, 'utf8');
  const marker = path.join(f.root, 'drift-executed.txt');
  await fs.writeFile(
    module,
    originalModule +
      `\nimport {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)},'executed');\n`,
  );
  await expect(f.native(['status', f.name])).rejects.toThrow('固定');
  await expect(fs.access(marker)).rejects.toThrow();
  await fs.writeFile(module, originalModule);
  expect((await f.native(['status', f.name])).application.id).toBe('native-candidate-review');
  run = await f.dispatch({ operation: 'inspect', runId: f.name });
  const acceptance = run.waits.find(
    (wait) => wait.status === 'pending' && wait.stepId === 'verify.confirm',
  )!;
  await f.native([
    'next',
    f.name,
    '--accept-result',
    '--summary',
    'Test user accepts verified result',
    '--expected-state-version',
    String((run.state as { state_version: number }).state_version),
    '--expected-action',
    'accept-result',
    '--proposal-hash',
    acceptance.proposalHash,
  ]);
  run = await f.dispatch({ operation: 'inspect', runId: f.name });
  for (
    let count = 0;
    run.actions.some((action) => action.status === 'pending') && count < 8;
    count++
  ) {
    await f.native(['archive', f.name]);
    run = await f.dispatch({ operation: 'inspect', runId: f.name });
  }
  expect(run.state).toMatchObject({ phase: 'archive', archived: true });
  await removeLocalStores(f.projectRoot);
  expect((await f.native(['status', f.name])).application.id).toBe('native-candidate-review');
  expect((await f.dispatch({ operation: 'inspect', runId: f.name })).actions).toEqual(
    createPortableRunCheckpoint(run).run.actions,
  );
}, 120000);

it('rejects fake loaded/pass evidence and stale artifacts while preserving the claimed Action', async () => {
  const f = await fixture();
  let run = await f.submitBuilder(f.pending(f.run, 'build.builder'), 'not acceptable\n');
  await f.native(['next', f.name]);
  run = await f.dispatch({ operation: 'inspect', runId: f.name });
  const review = f.pending(run, 'native.extension.candidate.candidate-review');
  run = await f.dispatch({
    operation: 'claim',
    runId: f.name,
    actionId: review.id,
    attempt: review.attempt,
    inputHash: review.inputHash,
    executorId: 'native-review-script',
    capabilities: ['skill-script'],
    sessionId: 'manual-host',
    claimToken: 'manual-claim',
  });
  const claimed = run.actions.find(({ id }) => id === review.id)!;
  const script = path.join(path.dirname(f.file), 'candidate-review/scripts/review.mjs');
  const actual = JSON.parse(
    execFileSync(process.execPath, [script, JSON.stringify(claimed.input)], { encoding: 'utf8' }),
  );
  await expect(f.record(claimed, { ...actual, verdict: 'pass', loaded: true })).rejects.toThrow();
  expect(
    (await f.dispatch({ operation: 'inspect', runId: f.name })).actions.find(
      ({ id }) => id === review.id,
    )?.status,
  ).toBe('running');
  await fs.writeFile(path.join(f.projectRoot, 'candidate.txt'), 'approved changed\n');
  await expect(f.record(claimed, actual)).rejects.toThrow();
}, 60000);

it('binds reverse Child reviews, repairs integration in its worktree, and reviews the parent candidate', async () => {
  const f = await fixture(true);
  let run = f.run;
  const execute = async (action: RuntimeAction, executorId: string) =>
    f.dispatch({
      operation: 'execute',
      runId: f.name,
      actionId: action.id,
      executorId,
    });
  run = await execute(f.pending(run, 'supervisor.prepare'), 'native-supervisor-prepare');
  for (const child of ['left', 'right']) {
    const action = run.actions.find(
      (action) =>
        action.status === 'pending' &&
        action.stepId === 'supervisor.child.prepare' &&
        (action.input as { activation: { child: string } }).activation.child === child,
    )!;
    run = await execute(action, 'native-supervisor-child-prepare');
  }
  const childAction = (value: WorkflowRun, step: string, child: string) =>
    value.actions.find(
      (action) =>
        (action.status === 'pending' &&
          action.stepId === step &&
          (
            action.input as {
              activation: { child?: string; reviewSource?: { activation: { child: string } } };
            }
          ).activation?.reviewSource?.activation.child === child) ||
        (action.status === 'pending' &&
          action.stepId === step &&
          (action.input as { activation: { child?: string } }).activation?.child === child),
    )!;
  run = await f.submitBuilder(
    childAction(run, 'supervisor.child.builder', 'left'),
    'missing\n',
    'left-builder',
  );
  run = await f.submitBuilder(
    childAction(run, 'supervisor.child.builder', 'right'),
    'approved\n',
    'right-builder',
  );
  run = await execute(childAction(run, 'supervisor.child.checks', 'right'), 'comet-native-checks');
  run = await execute(childAction(run, 'supervisor.child.checks', 'left'), 'comet-native-checks');
  run = await execute(
    childAction(run, 'native.extension.child.candidate-review', 'right'),
    'native-review-script',
  );
  run = await execute(
    childAction(run, 'native.extension.child.candidate-review', 'left'),
    'native-review-script',
  );
  expect(childAction(run, 'supervisor.child.verifier', 'left')).toBeUndefined();
  expect(childAction(run, 'supervisor.child.verifier', 'right')).toBeTruthy();
  run = await f.submitBuilder(
    childAction(run, 'supervisor.child.builder', 'left'),
    'approved\n',
    'left-repair-builder',
  );
  run = await execute(childAction(run, 'supervisor.child.checks', 'left'), 'comet-native-checks');
  run = await execute(
    childAction(run, 'native.extension.child.candidate-review', 'left'),
    'native-review-script',
  );
  async function verifyChild(child: string, verdict = 'pass') {
    const action = childAction(run, 'supervisor.child.verifier', child);
    run = await f.claim(action, `${child}-verifier`);
    const claimed = run.actions.find(({ id }) => id === action.id)!;
    const input = (claimed.input as { activation: { candidateCommit: string } }).activation;
    run = await f.record(claimed, {
      candidateCommit: input.candidateCommit,
      verdict,
      evidence: {
        summary: 'Independently checked Child',
        checks: ['candidate-process'],
        acceptance: [
          {
            id: 'A1',
            result: verdict === 'pass' ? 'passed' : 'failed',
            reason: 'Actual artifact checked',
          },
        ],
      },
      integrationChecks: f.checks,
    });
  }
  await verifyChild('right');
  run = await execute(
    childAction(run, 'supervisor.child.integrate', 'right'),
    'native-supervisor-integrate',
  );
  const integrationChecks = childAction(run, 'supervisor.child.integration-checks', 'right');
  const integrationRoot = (
    integrationChecks.input as { activation: { integrationWorktree: string } }
  ).activation.integrationWorktree;
  await fs.writeFile(path.join(integrationRoot, 'candidate.txt'), 'integration violation\n');
  run = await execute(integrationChecks, 'comet-native-checks');
  await verifyChild('left', 'fail');
  expect(childAction(run, 'supervisor.child.builder', 'left')).toBeTruthy();
  run = await f.submitBuilder(
    childAction(run, 'supervisor.child.builder', 'left'),
    'approved\n',
    'left-verifier-repair-builder',
  );
  run = await execute(childAction(run, 'supervisor.child.checks', 'left'), 'comet-native-checks');
  run = await execute(
    childAction(run, 'native.extension.child.candidate-review', 'left'),
    'native-review-script',
  );
  await verifyChild('left');
  expect(childAction(run, 'supervisor.child.integrate', 'left')).toBeUndefined();
  run = await execute(
    childAction(run, 'native.extension.integration.candidate-review', 'right'),
    'native-review-script',
  );
  const repair = f.pending(run, 'supervisor.child.integration-repair');
  expect(
    (repair.input as { activation: { integrationWorktree: string } }).activation
      .integrationWorktree,
  ).toBe(integrationRoot);
  run = await f.submitBuilder(repair, 'approved\n', 'integration-repair-builder');
  run = await execute(
    childAction(run, 'supervisor.child.integration-checks', 'right'),
    'comet-native-checks',
  );
  run = await execute(
    childAction(run, 'native.extension.integration.candidate-review', 'right'),
    'native-review-script',
  );
  run = await execute(
    childAction(run, 'supervisor.child.archive', 'right'),
    'native-supervisor-child-archive',
  );
  run = await execute(
    childAction(run, 'supervisor.child.integrate', 'left'),
    'native-supervisor-integrate',
  );
  run = await execute(
    childAction(run, 'supervisor.child.integration-checks', 'left'),
    'comet-native-checks',
  );
  run = await execute(
    childAction(run, 'native.extension.integration.candidate-review', 'left'),
    'native-review-script',
  );
  run = await execute(
    childAction(run, 'supervisor.child.archive', 'left'),
    'native-supervisor-child-archive',
  );
  expect(f.pending(run, 'supervisor.parent.builder')).toBeTruthy();
  const status = await f.native(['status', f.name]);
  expect(
    status.skillWork.some(
      (entry: { binding: { stepId: string } }) =>
        entry.binding.stepId === 'supervisor.parent.builder',
    ),
  ).toBe(true);
  run = await f.submitBuilder(
    f.pending(run, 'supervisor.parent.builder'),
    'parent violation\n',
    'parent-builder',
  );
  run = await execute(f.pending(run, 'verify.checks'), 'comet-native-checks');
  run = await execute(
    f.pending(run, 'native.extension.parent.candidate-review'),
    'native-review-script',
  );
  expect((run.state as { phase: string }).phase).toBe('build');
  expect(f.pending(run, 'supervisor.parent.builder')).toBeTruthy();
  run = await f.submitBuilder(
    f.pending(run, 'supervisor.parent.builder'),
    'approved\n',
    'parent-repair-builder',
  );
  run = await execute(f.pending(run, 'verify.checks'), 'comet-native-checks');
  run = await execute(
    f.pending(run, 'native.extension.parent.candidate-review'),
    'native-review-script',
  );
  expect(f.pending(run, 'verify.verifier')).toBeTruthy();
}, 300000);

it('does not discard an unknown Child when another review requires Shape revision', async () => {
  const f = await fixture(true);
  let run = await f.dispatch({
    operation: 'execute',
    runId: f.name,
    actionId: f.pending(f.run, 'supervisor.prepare').id,
    executorId: 'native-supervisor-prepare',
  });
  for (let count = 0; count < 2; count++)
    run = await f.dispatch({
      operation: 'execute',
      runId: f.name,
      actionId: f.pending(run, 'supervisor.child.prepare').id,
      executorId: 'native-supervisor-child-prepare',
    });
  const builders = run.actions.filter(
    (action) => action.status === 'pending' && action.stepId === 'supervisor.child.builder',
  );
  run = await f.claim(builders[1], 'unknown-builder');
  const unknown = run.actions.find(({ id }) => id === builders[1].id)!;
  run = await f.dispatch({
    operation: 'mark-unknown',
    runId: f.name,
    actionId: unknown.id,
    attempt: unknown.attempt,
    reason: 'Actual host return interrupted',
  });
  run = await f.submitBuilder(builders[0], 'NEEDS-REQUIREMENTS\n');
  run = await f.dispatch({
    operation: 'execute',
    runId: f.name,
    actionId: f.pending(run, 'supervisor.child.checks').id,
    executorId: 'comet-native-checks',
  });
  run = await f.dispatch({
    operation: 'execute',
    runId: f.name,
    actionId: f.pending(run, 'native.extension.child.candidate-review').id,
    executorId: 'native-review-script',
  });
  const revision = () =>
    f.native([
      'next',
      f.name,
      '--revise-requirements',
      '--summary',
      'User requested revision',
      '--expected-state-version',
      String((run.state as { state_version: number }).state_version),
      '--expected-action',
      'revise-requirements',
    ]);
  await expect(revision()).rejects.toThrow();
  expect(
    (await f.dispatch({ operation: 'inspect', runId: f.name })).actions.find(
      ({ id }) => id === unknown.id,
    ),
  ).toMatchObject({ status: 'unknown', claim: unknown.claim });
  run = await f.record(unknown, { summary: 'Known execution failed after interruption' }, 'failed');
  await revision();
  run = await f.dispatch({ operation: 'inspect', runId: f.name });
  expect(run.state).toMatchObject({
    phase: 'shape',
    builder_handoff: null,
    verification_result: 'pending',
  });
  expect(
    (run.state as { shape_confirmation_hash?: string }).shape_confirmation_hash,
  ).toBeUndefined();
}, 120000);

it('requires protected Shape revision for a review-discovered requirement change', async () => {
  const f = await fixture();
  let run = await f.submitBuilder(f.pending(f.run, 'build.builder'), 'NEEDS-REQUIREMENTS\n');
  await f.native(['next', f.name]);
  run = await f.dispatch({ operation: 'inspect', runId: f.name });
  await fs.appendFile(
    path.join(f.change, 'brief.md'),
    '\n# Decisions\nReview changed the confirmed design.\n',
  );
  run = await f.dispatch({
    operation: 'execute',
    runId: f.name,
    actionId: f.pending(run, 'native.extension.candidate.candidate-review').id,
    executorId: 'native-review-script',
  });
  expect(
    run.waits.some(
      (wait) => wait.status === 'pending' && wait.stepId.startsWith('native.extension.revise.'),
    ),
  ).toBe(true);
  await f.native([
    'next',
    f.name,
    '--revise-requirements',
    '--summary',
    'User chose new requirements',
    '--expected-state-version',
    String((run.state as { state_version: number }).state_version),
    '--expected-action',
    'revise-requirements',
  ]);
  run = await f.dispatch({ operation: 'inspect', runId: f.name });
  expect(run.state).toMatchObject({
    phase: 'shape',
    builder_handoff: null,
    verification_result: 'pending',
  });
  expect(
    (run.state as { shape_confirmation_hash?: string }).shape_confirmation_hash,
  ).toBeUndefined();
  expect(f.pending(run, 'verify.verifier')).toBeUndefined();
}, 60000);
