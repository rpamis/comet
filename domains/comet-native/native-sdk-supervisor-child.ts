import { inspectGitWorktree, resolveGitRef, samePath } from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';
import type { RuntimeValidator } from '../engine/runtime.js';
import { preflightNativeCheckPlans } from './native-check-executor.js';
import { nativeSupervisorContractRef } from './native-children-contract.js';
import { parseNativeReportedChecks, parseNativePortableState } from './native-portable-state.js';
import {
  nativeSdkCheckPlans,
  nativeSdkSupervisorChildCheckSummaries,
} from './native-sdk-checks.js';
import { nativeSdkRequiresIndependentReview } from './native-sdk-review.js';
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
        ['3', '4'].includes(run.workflow.version) &&
        output?.requireIndependentReview !== undefined &&
        typeof output.requireIndependentReview !== 'boolean'
      ) {
        throw new Error('requireIndependentReview must be a boolean');
      }
      if (
        state.phase !== 'build' ||
        !action.claim?.sessionId ||
        !activation ||
        typeof activation.child !== 'string' ||
        !plan.contract.children.some(({ name }) => name === activation.child) ||
        nativeSupervisorContractRef(activation) !== state.children_contract_ref ||
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
      if (run.workflow.version === '4') parseNativeReportedChecks(output.checks ?? []);
      else {
        const checkPlans = nativeSdkCheckPlans(output);
        preflightNativeCheckPlans(activation.worktree, checkPlans);
      }
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
        nativeSupervisorContractRef(activation) !== state.children_contract_ref ||
        typeof activation.worktree !== 'string' ||
        !samePath(
          activation.worktree,
          nativeSupervisorChildWorktree(context.projectRoot, state.name, activation.child),
        ) ||
        typeof activation.candidateCommit !== 'string' ||
        (run.workflow.version !== '4' && typeof activation.checkActionId !== 'string') ||
        typeof activation.builderSessionId !== 'string' ||
        (nativeSdkRequiresIndependentReview(run, action) &&
          action.claim.sessionId === activation.builderSessionId) ||
        !output ||
        output.candidateCommit !== activation.candidateCommit ||
        !['pass', 'fail', 'blocked'].includes(String(output.verdict)) ||
        !evidence ||
        typeof evidence.summary !== 'string' ||
        !evidence.summary.trim() ||
        !Array.isArray(evidence.checks) ||
        (run.workflow.version !== '4' && evidence.checks.some((id) => typeof id !== 'string'))
      ) {
        throw new Error(
          'Native SDK Supervisor Verifier lacks a bound result or required independent session',
        );
      }
      if (run.workflow.version !== '4') {
        const checked = await nativeSdkSupervisorChildCheckSummaries({
          run,
          checkActionId: activation.checkActionId as string,
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
      }
      const reported =
        run.workflow.version === '4' ? parseNativeReportedChecks(evidence.checks) : [];
      const acceptance = parseNativeVerifierAcceptance(evidence.acceptance);
      validateAndScopeNativeVerifierFinalResult(
        { verdict: output.verdict as 'pass' | 'fail' | 'blocked', acceptance },
        {
          acceptanceIds: supervisorAcceptanceScope(plan.contract, activation.child).map(
            ({ id }) => id,
          ),
          requiredChecksPassed: reported.every((check) => check.result === 'passed'),
        },
      );
      if (output.verdict === 'pass' && run.workflow.version !== '4') {
        const integrationChecks = nativeSdkCheckPlans({
          verificationChecks: output.integrationChecks,
        });
        if (integrationChecks.some(({ repeatable }) => !repeatable)) {
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
