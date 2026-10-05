import { inspectGitWorktree, resolveGitRef, samePath } from '../../platform/paths/git-worktree.js';
import { gitWorktreeIsClean, runGitCommand } from '../../platform/process/git.js';
import type {
  RuntimeAction,
  RuntimeExecutor,
  RuntimeValidator,
  WorkflowRun,
} from '../engine/runtime.js';
import { preflightNativeCheckPlans } from './native-check-executor.js';
import { parseNativePortableState } from './native-portable-state.js';
import {
  nativeSdkCheckPlans,
  nativeSdkSupervisorChildCheckSummaries,
} from './native-sdk-checks.js';
import { currentNativeSdkSupervisorPlan } from './native-sdk-supervisor-prepare.js';
import { currentNativeSdkSupervisorActions } from './native-sdk-supervisor-plan.js';
import {
  nativeSupervisorChildWorktree,
  nativeSupervisorIntegrationBranch,
  nativeSupervisorIntegrationWorktree,
} from './native-supervisor-workspace.js';

async function currentIntegration(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
) {
  const plan = await currentNativeSdkSupervisorPlan(run, projectRoot);
  const state = parseNativePortableState(run.state);
  const input = (action.input as { activation?: Record<string, unknown> }).activation;
  if (
    state.phase !== 'build' ||
    !input ||
    typeof input.child !== 'string' ||
    !plan.contract.children.some(({ name }) => name === input.child) ||
    input.contractHash !== state.children_contract_hash ||
    typeof input.worktree !== 'string' ||
    !samePath(
      input.worktree,
      nativeSupervisorChildWorktree(projectRoot, state.name, input.child),
    ) ||
    input.branch !== `comet/supervisor/${state.name}/${input.child}` ||
    typeof input.candidateCommit !== 'string' ||
    resolveGitRef(input.worktree, input.branch) !== input.candidateCommit ||
    typeof input.verifierActionId !== 'string' ||
    typeof input.verifierSessionId !== 'string' ||
    typeof input.checkActionId !== 'string'
  ) {
    throw new Error('Native SDK Supervisor integration lacks its verified Child candidate');
  }
  const verifier = run.actions.find((candidate) => candidate.id === input.verifierActionId);
  const verifierOutput = verifier?.outcome?.output as Record<string, unknown> | null | undefined;
  if (
    verifier?.stepId !== 'supervisor.child.verifier' ||
    verifier.status !== 'succeeded' ||
    verifier.claim?.sessionId !== input.verifierSessionId ||
    verifierOutput?.verdict !== 'pass' ||
    verifierOutput.candidateCommit !== input.candidateCommit
  ) {
    throw new Error('Native SDK Supervisor integration lacks an independent passing Verifier');
  }
  const checked = await nativeSdkSupervisorChildCheckSummaries({
    run,
    checkActionId: input.checkActionId,
    projectRoot,
  });
  if (checked.child !== input.child || checked.candidateCommit !== input.candidateCommit) {
    throw new Error('Native SDK Supervisor integration checks belong to another Child candidate');
  }
  const integrationBranch = nativeSupervisorIntegrationBranch(state.name);
  const integrationWorktree = nativeSupervisorIntegrationWorktree(projectRoot, state.name);
  if (inspectGitWorktree(integrationWorktree).currentBranch !== integrationBranch) {
    throw new Error('Native SDK Supervisor integration worktree changed');
  }
  const actionIndex = run.actions.findIndex((candidate) => candidate.id === action.id);
  const previousCheck = currentNativeSdkSupervisorActions(run)
    .filter((candidate) => run.actions.indexOf(candidate) < actionIndex)
    .reverse()
    .find(
      (candidate) =>
        candidate.stepId === 'supervisor.child.integration-checks' &&
        candidate.status === 'succeeded',
    );
  const prepared = run.outputs['supervisor.prepare']?.value as
    { targetCommit?: unknown; integrationCommit?: unknown } | undefined;
  const expectedBaseCommit = previousCheck
    ? (previousCheck.outcome?.output as { candidateId?: unknown } | null)?.candidateId
    : (prepared?.integrationCommit ?? prepared?.targetCommit);
  if (typeof expectedBaseCommit !== 'string') {
    throw new Error('Native SDK Supervisor integration lacks its checked base commit');
  }
  const checks = nativeSdkCheckPlans({ verificationChecks: input.integrationChecks });
  if (checks.length === 0 || checks.some(({ repeatable }) => !repeatable)) {
    throw new Error('Native SDK Supervisor integration requires repeatable Runtime checks');
  }
  preflightNativeCheckPlans(input.worktree, checks);
  return { state, plan, input, integrationBranch, integrationWorktree, expectedBaseCommit };
}

/**
 * Child archive merges advance the integration head between a passed check and
 * the next merge. The advance is trusted only when it replays the recorded
 * archive chain from the checked base to the current head; any unrelated
 * commit still fails the binding.
 */
function archiveChainReaches(
  run: Readonly<WorkflowRun>,
  fromCommit: string,
  toCommit: string,
): boolean {
  let cursor = fromCommit;
  for (const action of run.actions) {
    if (
      action.stepId !== 'supervisor.child.archive' ||
      action.status !== 'succeeded' ||
      !action.outcome
    ) {
      continue;
    }
    const output = action.outcome.output as {
      baseCommit?: unknown;
      integrationCommit?: unknown;
    } | null;
    if (
      output &&
      typeof output.baseCommit === 'string' &&
      typeof output.integrationCommit === 'string' &&
      output.baseCommit === cursor
    ) {
      cursor = output.integrationCommit;
    }
  }
  return cursor === toCommit;
}

async function currentIntegrationBase(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
) {
  const current = await currentIntegration(run, action, projectRoot);
  if (
    run.actions.some(
      (candidate) =>
        candidate.id !== action.id &&
        candidate.stepId === 'supervisor.child.integrate' &&
        ['running', 'unknown'].includes(candidate.status),
    )
  ) {
    throw new Error('Another Native SDK Supervisor integration Action is unresolved');
  }
  if (!gitWorktreeIsClean(current.integrationWorktree)) {
    throw new Error('Native SDK Supervisor integration worktree must be clean before merge');
  }
  const baseCommit = resolveGitRef(current.integrationWorktree, current.integrationBranch);
  if (
    !baseCommit ||
    (baseCommit !== current.expectedBaseCommit &&
      !archiveChainReaches(run, current.expectedBaseCommit, baseCommit))
  ) {
    throw new Error('Native SDK Supervisor integration branch changed after the prior check');
  }
  const prepared = run.outputs['supervisor.prepare']?.value as { targetCommit?: unknown };
  if (typeof prepared?.targetCommit !== 'string')
    throw new Error('Native SDK Supervisor integration lacks its original target binding');
  runGitCommand(current.integrationWorktree, [
    'merge-base',
    '--is-ancestor',
    prepared.targetCommit,
    baseCommit,
  ]);
  runGitCommand(current.integrationWorktree, [
    'merge-base',
    '--is-ancestor',
    prepared.targetCommit,
    current.plan.targetCommit,
  ]);
  return { ...current, baseCommit };
}

export const nativeSdkSupervisorIntegrateExecutor: RuntimeExecutor = {
  id: 'native-supervisor-integrate',
  capabilities: [],
  supports(action) {
    return action.stepId === 'supervisor.child.integrate' && action.type === 'call_tool';
  },
  async preflight(action, context, run) {
    if (!context?.projectRoot || !run || !this.supports(action)) {
      throw new Error('Native SDK Supervisor integration requires a bound Run and project');
    }
    await currentIntegrationBase(run, action, context.projectRoot);
  },
  async execute(action, context, run) {
    if (!context?.projectRoot || !run || !this.supports(action)) {
      throw new Error('Native SDK Supervisor integration requires a bound Run and project');
    }
    const current = await currentIntegrationBase(run, action, context.projectRoot);
    const { baseCommit } = current;
    const targetIncluded =
      runGitCommand(current.integrationWorktree, [
        'merge-base',
        current.plan.targetCommit,
        baseCommit,
      ]) === current.plan.targetCommit;
    if (!targetIncluded)
      runGitCommand(current.integrationWorktree, [
        'merge',
        '--no-ff',
        '--no-edit',
        current.plan.targetCommit,
      ]);
    const targetMergeCommit = resolveGitRef(current.integrationWorktree, current.integrationBranch);
    if (!targetMergeCommit) throw new Error('Native SDK Supervisor target sync produced no commit');
    const included =
      runGitCommand(current.integrationWorktree, [
        'merge-base',
        current.input.candidateCommit as string,
        targetMergeCommit,
      ]) === current.input.candidateCommit;
    if (!included) {
      runGitCommand(current.integrationWorktree, [
        'merge',
        '--no-ff',
        '--no-edit',
        current.input.candidateCommit as string,
      ]);
    }
    const integrationCommit = resolveGitRef(current.integrationWorktree, current.integrationBranch);
    if (!integrationCommit) throw new Error('Native SDK Supervisor merge produced no commit');
    return {
      status: 'succeeded',
      output: {
        child: current.input.child as string,
        candidateCommit: current.input.candidateCommit as string,
        baseCommit,
        targetCommit: current.plan.targetCommit,
        targetMergeCommit,
        integrationCommit,
        integrationBranch: current.integrationBranch,
        integrationWorktree: current.integrationWorktree,
      },
    };
  },
};

export const nativeSdkSupervisorIntegrateValidator: RuntimeValidator = {
  id: 'native-supervisor-integrate-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (
      !context?.projectRoot ||
      action.claim?.executorId !== nativeSdkSupervisorIntegrateExecutor.id ||
      outcome.status !== 'succeeded'
    ) {
      return {
        accepted: false,
        reason: 'Native SDK Supervisor integration was not executed by Runtime',
      };
    }
    try {
      const current = await currentIntegration(run, action, context.projectRoot);
      const output = outcome.output as Record<string, unknown> | null;
      if (
        !output ||
        output.child !== current.input.child ||
        output.candidateCommit !== current.input.candidateCommit ||
        (output.baseCommit !== current.expectedBaseCommit &&
          (typeof output.baseCommit !== 'string' ||
            !archiveChainReaches(run, current.expectedBaseCommit, output.baseCommit))) ||
        typeof output.integrationCommit !== 'string' ||
        output.integrationBranch !== current.integrationBranch ||
        typeof output.integrationWorktree !== 'string' ||
        !samePath(output.integrationWorktree, current.integrationWorktree) ||
        resolveGitRef(current.integrationWorktree, current.integrationBranch) !==
          output.integrationCommit
      ) {
        throw new Error('Native SDK Supervisor integration outcome does not match the worktree');
      }
      if (!gitWorktreeIsClean(current.integrationWorktree)) {
        throw new Error('Native SDK Supervisor integration worktree changed after execution');
      }
      const prepared = run.outputs['supervisor.prepare']?.value as { targetCommit?: unknown };
      const targetCommit = output.targetCommit ?? prepared.targetCommit;
      const targetMergeCommit = output.targetMergeCommit ?? output.baseCommit;
      if (targetCommit !== current.plan.targetCommit || typeof targetMergeCommit !== 'string')
        throw new Error('Native SDK Supervisor target changed during integration');
      if (targetMergeCommit !== output.baseCommit) {
        const targetParents = runGitCommand(current.integrationWorktree, [
          'rev-list',
          '--parents',
          '-n',
          '1',
          targetMergeCommit,
        ]).split(' ');
        if (
          targetParents.length !== 3 ||
          targetParents[0] !== targetMergeCommit ||
          targetParents[1] !== output.baseCommit ||
          targetParents[2] !== targetCommit
        )
          throw new Error('Native SDK Supervisor target sync is not the expected merge commit');
      }
      runGitCommand(current.integrationWorktree, [
        'merge-base',
        '--is-ancestor',
        targetCommit as string,
        targetMergeCommit,
      ]);
      if (output.integrationCommit === targetMergeCommit) {
        runGitCommand(current.integrationWorktree, [
          'merge-base',
          '--is-ancestor',
          output.candidateCommit as string,
          output.integrationCommit,
        ]);
      } else {
        const parents = runGitCommand(current.integrationWorktree, [
          'rev-list',
          '--parents',
          '-n',
          '1',
          output.integrationCommit,
        ]).split(' ');
        if (
          parents.length !== 3 ||
          parents[0] !== output.integrationCommit ||
          parents[1] !== targetMergeCommit ||
          parents[2] !== output.candidateCommit
        ) {
          throw new Error('Native SDK Supervisor integration is not the expected merge commit');
        }
      }
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
