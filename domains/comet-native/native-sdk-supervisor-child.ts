import { inspectGitWorktree, resolveGitRef, samePath } from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';
import type { RuntimeValidator } from '../engine/runtime.js';
import { nativeSupervisorContractRef } from './native-children-contract.js';
import { parseNativeReportedChecks, parseNativePortableState } from './native-portable-state.js';
import { nativeSdkRequiresIndependentReview } from './native-sdk-review.js';
import { currentNativeSdkSupervisorContract } from './native-sdk-supervisor-prepare.js';
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
      const plan = await currentNativeSdkSupervisorContract(run, context.projectRoot);
      const activation = (
        action.input as {
          activation?: Record<string, unknown>;
        }
      ).activation;
      const output = outcome.output as Record<string, unknown> | null;
      if (
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
        nativeSupervisorContractRef(activation, run) !== state.children_contract_ref ||
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
      parseNativeReportedChecks(output.checks ?? []);
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
      const plan = await currentNativeSdkSupervisorContract(run, context.projectRoot);
      const activation = (
        action.input as {
          activation?: Record<string, unknown>;
        }
      ).activation;
      const output = outcome.output as Record<string, unknown> | null;
      const evidence = output?.evidence as Record<string, unknown> | null | undefined;
      if (
        state.phase !== 'build' ||
        !action.claim?.sessionId ||
        !activation ||
        typeof activation.child !== 'string' ||
        !plan.contract.children.some(({ name }) => name === activation.child) ||
        nativeSupervisorContractRef(activation, run) !== state.children_contract_ref ||
        typeof activation.worktree !== 'string' ||
        !samePath(
          activation.worktree,
          nativeSupervisorChildWorktree(context.projectRoot, state.name, activation.child),
        ) ||
        typeof activation.candidateCommit !== 'string' ||
        typeof activation.builderSessionId !== 'string' ||
        (nativeSdkRequiresIndependentReview(run, action) &&
          action.claim.sessionId === activation.builderSessionId) ||
        !output ||
        output.candidateCommit !== activation.candidateCommit ||
        !['pass', 'fail', 'blocked'].includes(String(output.verdict)) ||
        !evidence ||
        typeof evidence.summary !== 'string' ||
        !evidence.summary.trim() ||
        !Array.isArray(evidence.checks)
      ) {
        throw new Error(
          'Native SDK Supervisor Verifier lacks a bound result or required independent session',
        );
      }
      const reported = parseNativeReportedChecks(evidence.checks);
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
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
