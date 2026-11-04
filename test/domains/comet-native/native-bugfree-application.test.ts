import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RuntimeAction, WorkflowRun } from '../../../domains/engine/runtime.js';
import { prepareNativeApplication } from '../../helpers/native-application.js';
import { nativeVerifierContext } from '../../../domains/comet-native/native-verifier-context.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture(supervisor = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-bugfree-app-'));
  roots.push(root);
  return prepareNativeApplication(root, supervisor, 'custom', undefined, 'bugfree');
}

it('retains extension checks, compact verification and mode through cold recovery', async () => {
  const f = await fixture();
  let run = await f.submitBuilder(f.pending(f.run, 'build.builder'), 'approved\n', 'builder');
  const execute = (action: RuntimeAction, executorId: string) =>
    f.dispatch({ operation: 'execute', runId: f.name, actionId: action.id, executorId });
  run = await execute(f.pending(run, 'verify.checks'), 'comet-native-checks');
  run = await execute(
    f.pending(run, 'native.extension.candidate.candidate-review'),
    'native-review-script',
  );
  const verifier = f.pending(run, 'verify.verifier');
  expect(verifier).toBeTruthy();
  const context = await nativeVerifierContext(run, verifier, f.projectRoot);
  expect(context?.verifyMode).toBe('bugfree');
  run = await f.claim(verifier, 'independent-reviewer');
  const state = run.state as {
    builder_handoff: { candidate_id: string };
    loop: { iteration: number; attempt: number };
  };
  await f.record(
    run.actions.find((action) => action.id === verifier.id)!,
    {
      candidateId: state.builder_handoff.candidate_id,
      verifierExecutionRef: 'independent-reviewer',
      response: {
        kind: 'final-result',
        result: {
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          verdict: 'pass',
          passedAcceptanceIds: ['A1'],
          acceptance: [],
          risks: [],
          summary: 'Verified approved candidate and extension result.',
        },
      },
    },
  );
  await f.native(['next', f.name]);
  run = await f.dispatch({ operation: 'inspect', runId: f.name });
  const reviewerActions = run.actions
    .filter((action) => action.stepId === 'verify.verifier')
    .map((action) => action.id);
  expect(
    run.waits.some((wait) => wait.stepId === 'verify.confirm' && wait.status === 'pending'),
  ).toBe(true);
  const runtimeRoot = resolveWorkspaceRuntimeRootSync(f.projectRoot);
  for (const directory of ['applications', 'change-owners', 'state-projections'])
    await fs.rm(path.join(runtimeRoot, directory), { recursive: true, force: true });
  await expect(f.native(['status', f.name])).rejects.toThrow('checkpoint recovery');
  await f.native(['doctor', f.name, '--repair', '--confirmed']);
  const status = await f.native(['status', f.name]);
  expect(status.verifyMode).toBe('bugfree');
  const restored = await f.dispatch({ operation: 'inspect', runId: f.name });
  expect(
    restored.actions
      .filter((action) => action.stepId === 'verify.verifier')
      .map((action) => action.id),
  ).toEqual(reviewerActions);
  expect(await fs.readFile(path.join(f.change, 'verification.md'), 'utf8')).toContain('bugfree');
}, 180000);

it('keeps Child checks and extension reviews while using bugfree for the final parent', async () => {
  const f = await fixture(true);
  // Runtime 的合并命令也需要此临时仓库的提交身份，不能依赖测试机的全局配置。
  f.git(f.projectRoot, ['config', '--local', 'user.name', 'Comet Test']);
  f.git(f.projectRoot, ['config', '--local', 'user.email', 'comet-test@example.com']);
  let run = f.run;
  const execute = async (action: RuntimeAction, executorId: string) => {
    try {
      return await f.dispatch({
        operation: 'execute',
        runId: f.name,
        actionId: action.id,
        executorId,
      });
    } catch (error) {
      const observed = await f.dispatch({ operation: 'inspect', runId: f.name });
      const original = observed.actions.find((entry) => entry.id === action.id);
      throw new Error(
        JSON.stringify({
          error: String(error),
          action: original?.stepId,
          status: original?.status,
          reason: original?.reason,
        }),
        { cause: error },
      );
    }
  };
  const prepare = f.pending(run, 'supervisor.prepare');
  if (prepare) run = await execute(prepare, 'native-supervisor-prepare');
  else
    expect(
      run.actions.some(
        (action) => action.stepId === 'supervisor.prepare' && action.status === 'succeeded',
      ),
    ).toBe(true);
  for (const child of ['left', 'right']) {
    const matches = (action: RuntimeAction) =>
      action.stepId === 'supervisor.child.prepare' &&
      (action.input as { activation: { child: string } }).activation.child === child;
    const pending = run.actions.find((action) => matches(action) && action.status === 'pending');
    if (pending) run = await execute(pending, 'native-supervisor-child-prepare');
    else
      expect(run.actions.some((action) => matches(action) && action.status === 'succeeded')).toBe(
        true,
      );
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
  const verifier = f.pending(run, 'verify.verifier');
  const context = await nativeVerifierContext(run, verifier, f.projectRoot);
  expect(context?.verifyMode).toBe('bugfree');
  expect(context?.workspace.implementationRoot).toBe(integrationRoot);
}, 300000);
