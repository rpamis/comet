import path from 'node:path';

import {
  inspectGitWorktree,
  listGitWorktreeRoots,
  resolveGitRef,
  samePath,
} from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';
import type {
  RuntimeAction,
  RuntimeExecutor,
  RuntimeValidator,
  WorkflowRun,
} from '../engine/runtime.js';
import { parseNativePortableState } from './native-portable-state.js';
import { nativeProjectPaths } from './native-paths.js';
import { currentNativeSdkSupervisorPlan } from './native-sdk-supervisor-prepare.js';
import { nativeSdkSupervisorParentCandidateCommit } from './native-sdk-supervisor-parent.js';
import { nativeWorkspaceIsClean } from './native-workspace-config.js';
import {
  nativeSupervisorIntegrationBranch,
  nativeSupervisorIntegrationWorktree,
} from './native-supervisor-workspace.js';

async function currentDelivery(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
) {
  const plan = await currentNativeSdkSupervisorPlan(run, projectRoot);
  const state = parseNativePortableState(run.state);
  const input = (action.input as { activation?: Record<string, unknown> }).activation;
  const prepared = run.outputs['supervisor.prepare']?.value as
    { targetCommit?: unknown; targetBranch?: unknown } | undefined;
  const parentBuilder = [...run.actions]
    .reverse()
    .find(
      (candidate) =>
        candidate.stepId === 'supervisor.parent.builder' && candidate.status === 'succeeded',
    );
  const parentCandidateCommit = parentBuilder
    ? nativeSdkSupervisorParentCandidateCommit(parentBuilder)
    : null;
  const confirmed = run.waits.some(
    (wait) =>
      wait.stepId === 'verify.confirm' &&
      wait.status === 'resolved' &&
      wait.decision?.choice === 'approved',
  );
  const revalidated = run.actions.some(
    (candidate) => candidate.stepId === 'verify.revalidate' && candidate.status === 'succeeded',
  );
  const integrationBranch = nativeSupervisorIntegrationBranch(state.name);
  const integrationWorktree = nativeSupervisorIntegrationWorktree(projectRoot, state.name);
  if (
    state.phase !== 'archive' ||
    state.verification_result !== 'pass' ||
    !state.verification ||
    !state.builder_handoff ||
    !confirmed ||
    !revalidated ||
    !input ||
    input.contractHash !== state.children_contract_hash ||
    input.candidateId !== state.builder_handoff.candidate_id ||
    input.integrationBranch !== integrationBranch ||
    typeof input.integrationWorktree !== 'string' ||
    !samePath(input.integrationWorktree, integrationWorktree) ||
    typeof input.integrationCommit !== 'string' ||
    parentCandidateCommit !== input.integrationCommit ||
    prepared?.targetBranch !== plan.targetBranch ||
    typeof prepared.targetCommit !== 'string' ||
    inspectGitWorktree(integrationWorktree).currentBranch !== integrationBranch ||
    resolveGitRef(integrationWorktree, integrationBranch) !== input.integrationCommit
  ) {
    throw new Error('Native SDK Supervisor delivery lacks the approved integration candidate');
  }
  const targetRoot = listGitWorktreeRoots(projectRoot).find(
    (root) => inspectGitWorktree(root).currentBranch === plan.targetBranch,
  );
  if (!targetRoot) throw new Error('Native SDK Supervisor target branch worktree is unavailable');
  const targetCommit = resolveGitRef(targetRoot, plan.targetBranch);
  if (targetCommit !== prepared.targetCommit && targetCommit !== input.integrationCommit) {
    throw new Error('Native SDK Supervisor target branch changed after Shape confirmation');
  }
  runGitCommand(integrationWorktree, [
    'merge-base',
    '--is-ancestor',
    prepared.targetCommit,
    input.integrationCommit,
  ]);
  return {
    state,
    input,
    targetRoot,
    targetBranch: plan.targetBranch,
    targetCommit,
    integrationBranch,
    integrationCommit: input.integrationCommit,
  };
}

export const nativeSdkSupervisorDeliverExecutor: RuntimeExecutor = {
  id: 'native-supervisor-parent-deliver',
  capabilities: [],
  supports(action) {
    return action.stepId === 'supervisor.parent.deliver' && action.type === 'call_tool';
  },
  async execute(action, context, run) {
    if (!context?.projectRoot || !run || !this.supports(action)) {
      throw new Error('Native SDK Supervisor delivery requires a bound Run and project');
    }
    const current = await currentDelivery(run, action, context.projectRoot);
    const paths = await nativeProjectPaths(
      context.projectRoot,
      (run.input as { artifactRootRef: string }).artifactRootRef,
    );
    const changeDir = samePath(current.targetRoot, context.projectRoot)
      ? path
          .relative(current.targetRoot, path.join(paths.changesDir, current.state.name))
          .replaceAll('\\', '/')
      : null;
    if (
      !nativeWorkspaceIsClean(current.targetRoot, [
        ...(changeDir ? [changeDir] : []),
        '.comet/current-change.json',
        '.comet/runtime',
      ])
    ) {
      throw new Error('Native SDK Supervisor target worktree has unrelated changes');
    }
    if (current.targetCommit !== current.integrationCommit) {
      runGitCommand(current.targetRoot, ['merge', '--ff-only', current.integrationBranch]);
    }
    const targetCommit = resolveGitRef(current.targetRoot, current.targetBranch);
    if (targetCommit !== current.integrationCommit) {
      throw new Error('Native SDK Supervisor target did not receive the verified integration');
    }
    return {
      status: 'succeeded',
      output: {
        contractHash: current.state.children_contract_hash!,
        integrationCommit: current.integrationCommit,
        targetBranch: current.targetBranch,
        targetRoot: current.targetRoot,
        targetCommit,
      },
    };
  },
};

export const nativeSdkSupervisorDeliverValidator: RuntimeValidator = {
  id: 'native-supervisor-parent-deliver-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (
      !context?.projectRoot ||
      action.claim?.executorId !== nativeSdkSupervisorDeliverExecutor.id ||
      outcome.status !== 'succeeded'
    ) {
      return {
        accepted: false,
        reason: 'Native SDK Supervisor delivery was not executed by Runtime',
      };
    }
    try {
      const current = await currentDelivery(run, action, context.projectRoot);
      const output = outcome.output as Record<string, unknown> | null;
      if (
        !output ||
        output.contractHash !== current.state.children_contract_hash ||
        output.integrationCommit !== current.integrationCommit ||
        output.targetBranch !== current.targetBranch ||
        typeof output.targetRoot !== 'string' ||
        !samePath(output.targetRoot, current.targetRoot) ||
        output.targetCommit !== current.integrationCommit ||
        resolveGitRef(current.targetRoot, current.targetBranch) !== current.integrationCommit
      ) {
        throw new Error('Native SDK Supervisor delivery outcome does not match the target');
      }
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
