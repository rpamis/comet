import { inspectGitWorktree, resolveGitRef, samePath } from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';
import type { RuntimeValidator } from '../engine/runtime.js';
import { preflightNativeCheckPlans } from './native-check-executor.js';
import { nativeSdkCheckPlans } from './native-sdk-checks.js';
import { currentNativeSdkSupervisorPlan } from './native-sdk-supervisor-prepare.js';
import { nativeWorkspaceIsClean } from './native-workspace-config.js';
import {
  nativeSupervisorIntegrationBranch,
  nativeSupervisorIntegrationWorktree,
} from './native-supervisor-workspace.js';

const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

export const nativeSdkSupervisorIntegrationRepairValidator: RuntimeValidator = {
  id: 'native-supervisor-integration-repair-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (outcome.status === 'failed') return { accepted: true };
    if (
      !context?.projectRoot ||
      action.stepId !== 'supervisor.child.integration-repair' ||
      action.type !== 'handoff' ||
      !action.claim?.sessionId
    ) {
      return {
        accepted: false,
        reason: 'Native Supervisor integration repair lacks its host session',
      };
    }
    try {
      const plan = await currentNativeSdkSupervisorPlan(run, context.projectRoot);
      const input = (action.input as { activation?: Record<string, unknown> }).activation;
      const output = outcome.output as Record<string, unknown> | null;
      const failed = run.actions.find((candidate) => candidate.id === input?.failedCheckActionId);
      const failedInput = (failed?.input as { activation?: Record<string, unknown> } | undefined)
        ?.activation;
      const merge = run.actions.find((candidate) => candidate.id === input?.mergeActionId);
      const mergeOutput = merge?.outcome?.output as Record<string, unknown> | null | undefined;
      const worktree = nativeSupervisorIntegrationWorktree(context.projectRoot, plan.state.name);
      const branch = nativeSupervisorIntegrationBranch(plan.state.name);
      if (
        !input ||
        typeof input.child !== 'string' ||
        !plan.contract.children.some(({ name }) => name === input.child) ||
        input.contractHash !== plan.state.children_contract_hash ||
        typeof input.integrationWorktree !== 'string' ||
        !samePath(input.integrationWorktree, worktree) ||
        input.integrationBranch !== branch ||
        typeof input.integrationCommit !== 'string' ||
        !COMMIT_PATTERN.test(input.integrationCommit) ||
        typeof input.candidateCommit !== 'string' ||
        failed?.stepId !== 'supervisor.child.integration-checks' ||
        failed.status !== 'failed' ||
        failedInput?.child !== input.child ||
        failedInput.integrationCommit !== input.integrationCommit ||
        failedInput.mergeActionId !== input.mergeActionId ||
        merge?.stepId !== 'supervisor.child.integrate' ||
        merge.status !== 'succeeded' ||
        mergeOutput?.child !== input.child ||
        mergeOutput.candidateCommit !== input.candidateCommit ||
        !output ||
        typeof output.summary !== 'string' ||
        !output.summary.trim() ||
        typeof output.integrationCommit !== 'string' ||
        !COMMIT_PATTERN.test(output.integrationCommit) ||
        output.integrationCommit === input.integrationCommit ||
        inspectGitWorktree(worktree).currentBranch !== branch ||
        resolveGitRef(worktree, branch) !== output.integrationCommit ||
        !nativeWorkspaceIsClean(worktree)
      ) {
        throw new Error('Native Supervisor integration repair is not bound to the failed merge');
      }
      runGitCommand(worktree, [
        'merge-base',
        '--is-ancestor',
        input.integrationCommit,
        output.integrationCommit,
      ]);
      const checks = nativeSdkCheckPlans({ verificationChecks: output.integrationChecks });
      if (checks.length === 0 || checks.some(({ repeatable }) => !repeatable)) {
        throw new Error('Native Supervisor integration repair requires repeatable checks');
      }
      preflightNativeCheckPlans(worktree, checks);
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
