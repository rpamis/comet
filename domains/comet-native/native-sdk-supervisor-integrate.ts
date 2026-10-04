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

export const nativeSdkSupervisorIntegrateExecutor: RuntimeExecutor = {
  id: 'native-supervisor-integrate',
  capabilities: [],
  supports(action) {
    return action.stepId === 'supervisor.child.integrate' && action.type === 'call_tool';
  },
  async execute(action, context, run) {
    if (!context?.projectRoot || !run || !this.supports(action)) {
      throw new Error('Native SDK Supervisor integration requires a bound Run and project');
    }
    const current = await currentIntegration(run, action, context.projectRoot);
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
    if (baseCommit !== current.expectedBaseCommit) {
      throw new Error('Native SDK Supervisor integration branch changed after the prior check');
    }
    runGitCommand(current.integrationWorktree, [
      'merge-base',
      '--is-ancestor',
      current.plan.targetCommit,
      baseCommit,
    ]);
    runGitCommand(current.integrationWorktree, [
      'merge',
      '--no-ff',
      '--no-edit',
      current.input.candidateCommit as string,
    ]);
    const integrationCommit = resolveGitRef(current.integrationWorktree, current.integrationBranch);
    if (!integrationCommit) throw new Error('Native SDK Supervisor merge produced no commit');
    return {
      status: 'succeeded',
      output: {
        child: current.input.child as string,
        candidateCommit: current.input.candidateCommit as string,
        baseCommit,
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
        output.baseCommit !== current.expectedBaseCommit ||
        typeof output.integrationCommit !== 'string' ||
        output.integrationBranch !== current.integrationBranch ||
        typeof output.integrationWorktree !== 'string' ||
        !samePath(output.integrationWorktree, current.integrationWorktree) ||
        resolveGitRef(current.integrationWorktree, current.integrationBranch) !==
          output.integrationCommit
      ) {
        throw new Error('Native SDK Supervisor integration outcome does not match the worktree');
      }
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
        parents[1] !== output.baseCommit ||
        parents[2] !== output.candidateCommit
      ) {
        throw new Error('Native SDK Supervisor integration is not the expected merge commit');
      }
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
