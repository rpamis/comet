import { inspectGitWorktree, resolveGitRef, samePath } from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';
import type { RuntimeValidator } from '../engine/runtime.js';
import { preflightNativeCheckPlans } from './native-check-executor.js';
import { parseNativePortableState } from './native-portable-state.js';
import {
  nativeSdkCheckPlans,
  nativeSdkSupervisorChildCheckSummaries,
} from './native-sdk-checks.js';
import { currentNativeSdkSupervisorPlan } from './native-sdk-supervisor-prepare.js';
import { supervisorAcceptanceScope } from './native-supervisor-model.js';
import { nativeSupervisorChildWorktree } from './native-supervisor-workspace.js';
import {
  parseNativeVerifierAcceptance,
  validateAndScopeNativeVerifierFinalResult,
} from './native-verifier-protocol.js';

const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

export const nativeSdkSupervisorBuilderValidator: RuntimeValidator = {
  id: 'native-supervisor-builder-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (outcome.status === 'failed') return { accepted: true };
    if (
      !context?.projectRoot ||
      action.stepId !== 'supervisor.child.builder' ||
      action.type !== 'handoff'
    ) {
      return { accepted: false, reason: 'Native SDK Supervisor Builder result lacks its project' };
    }
    try {
      const state = parseNativePortableState(run.state);
      const plan = await currentNativeSdkSupervisorPlan(run, context.projectRoot);
      const activation = (action.input as { activation?: Record<string, unknown> }).activation;
      const output = outcome.output as Record<string, unknown> | null;
      if (
        state.phase !== 'build' ||
        !action.claim?.sessionId ||
        !activation ||
        typeof activation.child !== 'string' ||
        !plan.contract.children.some(({ name }) => name === activation.child) ||
        activation.contractHash !== state.children_contract_hash ||
        typeof activation.worktree !== 'string' ||
        !samePath(
          activation.worktree,
          nativeSupervisorChildWorktree(context.projectRoot, state.name, activation.child),
        ) ||
        activation.branch !== `comet/supervisor/${state.name}/${activation.child}` ||
        typeof activation.baseCommit !== 'string' ||
        !COMMIT_PATTERN.test(activation.baseCommit) ||
        !output ||
        typeof output.candidateCommit !== 'string' ||
        !COMMIT_PATTERN.test(output.candidateCommit)
      ) {
        throw new Error('Native SDK Supervisor Builder result lacks a claimed child candidate');
      }
      const worktree = inspectGitWorktree(activation.worktree);
      if (
        worktree.currentBranch !== activation.branch ||
        resolveGitRef(activation.worktree, activation.branch) !== output.candidateCommit
      ) {
        throw new Error('Native SDK Supervisor Builder candidate does not match its worktree');
      }
      const checkPlans = nativeSdkCheckPlans(output);
      if (checkPlans.length === 0) {
        throw new Error('Native SDK Supervisor Builder candidate needs a Runtime check plan');
      }
      preflightNativeCheckPlans(activation.worktree, checkPlans);
      runGitCommand(activation.worktree, [
        'merge-base',
        '--is-ancestor',
        activation.baseCommit,
        output.candidateCommit,
      ]);
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const nativeSdkSupervisorVerifierValidator: RuntimeValidator = {
  id: 'native-supervisor-verifier-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (outcome.status === 'failed') return { accepted: true };
    if (
      !context?.projectRoot ||
      action.stepId !== 'supervisor.child.verifier' ||
      action.type !== 'handoff'
    ) {
      return { accepted: false, reason: 'Native SDK Supervisor Verifier lacks its project' };
    }
    try {
      const state = parseNativePortableState(run.state);
      const plan = await currentNativeSdkSupervisorPlan(run, context.projectRoot);
      const activation = (action.input as { activation?: Record<string, unknown> }).activation;
      const output = outcome.output as Record<string, unknown> | null;
      const evidence = output?.evidence as Record<string, unknown> | null | undefined;
      if (
        state.phase !== 'build' ||
        !action.claim?.sessionId ||
        !activation ||
        typeof activation.child !== 'string' ||
        !plan.contract.children.some(({ name }) => name === activation.child) ||
        activation.contractHash !== state.children_contract_hash ||
        typeof activation.worktree !== 'string' ||
        !samePath(
          activation.worktree,
          nativeSupervisorChildWorktree(context.projectRoot, state.name, activation.child),
        ) ||
        typeof activation.candidateCommit !== 'string' ||
        typeof activation.checkActionId !== 'string' ||
        typeof activation.builderSessionId !== 'string' ||
        action.claim.sessionId === activation.builderSessionId ||
        !output ||
        output.candidateCommit !== activation.candidateCommit ||
        !['pass', 'fail', 'blocked'].includes(String(output.verdict)) ||
        !evidence ||
        typeof evidence.summary !== 'string' ||
        !evidence.summary.trim() ||
        !Array.isArray(evidence.checks) ||
        evidence.checks.some((id) => typeof id !== 'string')
      ) {
        throw new Error('Native SDK Supervisor Verifier lacks an independent bound result');
      }
      const checked = await nativeSdkSupervisorChildCheckSummaries({
        run,
        checkActionId: activation.checkActionId,
        projectRoot: context.projectRoot,
      });
      if (
        checked.child !== activation.child ||
        checked.candidateCommit !== activation.candidateCommit ||
        checked.checkIds.length !== evidence.checks.length ||
        checked.checkIds.some((id) => !(evidence.checks as string[]).includes(id))
      ) {
        throw new Error('Native SDK Supervisor Verifier check evidence is not current');
      }
      const acceptance = parseNativeVerifierAcceptance(evidence.acceptance);
      validateAndScopeNativeVerifierFinalResult(
        { verdict: output.verdict as 'pass' | 'fail' | 'blocked', acceptance },
        {
          acceptanceIds: supervisorAcceptanceScope(plan.contract, activation.child).map(
            ({ id }) => id,
          ),
          requiredChecksPassed: true,
        },
      );
      if (output.verdict === 'pass') {
        const integrationChecks = nativeSdkCheckPlans({
          verificationChecks: output.integrationChecks,
        });
        if (
          integrationChecks.length === 0 ||
          integrationChecks.some(({ repeatable }) => !repeatable)
        ) {
          throw new Error('Native SDK Supervisor pass needs repeatable integration checks');
        }
        preflightNativeCheckPlans(activation.worktree, integrationChecks);
      }
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
