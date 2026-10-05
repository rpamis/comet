import path from 'node:path';

import { inspectGitWorktree, resolveGitRef, samePath } from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';
import {
  type DefineWorkflowOptions,
  type CreateRuntimeOptions,
  type RuntimeAction,
  type RuntimeOutcome,
  type RuntimeValidator,
  type RuntimeCommandValidator,
  type RuntimeStateValidator,
  type RuntimeExecutor,
  type RuntimeValue,
  type WorkflowTransitionHandler,
  type WorkflowRun,
  hashRuntimeValue,
} from '../engine/runtime.js';
import {
  hashNativeParentContract,
  nativeChildrenAcceptanceValidation,
  readNativeSupervisorShapeIntent,
} from './native-children.js';
import {
  nativeSdkArchiveApplyExecutor,
  nativeSdkArchiveApplyValidator,
  nativeSdkArchiveFinalizeExecutor,
  nativeSdkArchiveFinalizeValidator,
  nativeSdkArchivePreflightExecutor,
  nativeSdkArchivePreflightValidator,
} from './native-sdk-archive.js';
import { DEFAULT_WORKFLOW_NATIVE_MAX_VERIFY_FAILURES } from '../workflow-contract/project-config.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import {
  nativeSdkCheckExecutor,
  nativeSdkCurrentCheckSummaries,
  nativeSdkCheckPlans,
  nativeSdkCheckValidator,
} from './native-sdk-checks.js';
import {
  nativeSdkDisassociateCommandValidator,
  nativeSdkDisassociateExecutor,
  nativeSdkDisassociateValidator,
} from './native-sdk-disassociate.js';
import {
  nativeSdkRemoveCommandValidator,
  nativeSdkRemoveExecutor,
  nativeSdkRemoveValidator,
} from './native-sdk-remove.js';
import {
  nativeSdkReviseCommandValidator,
  nativeSdkReviseExecutor,
  nativeSdkReviseValidator,
} from './native-sdk-revise.js';
import {
  nativeSdkReportExecutor,
  nativeSdkReportRevalidationExecutor,
  nativeSdkReportRevalidationValidator,
  nativeSdkReportValidator,
} from './native-sdk-report.js';
import {
  currentNativeSdkSupervisorPlan,
  nativeSdkSupervisorChildPrepareExecutor,
  nativeSdkSupervisorChildPrepareValidator,
  nativeSdkSupervisorPrepareExecutor,
  nativeSdkSupervisorPrepareValidator,
} from './native-sdk-supervisor-prepare.js';
import {
  nativeSdkSupervisorBuilderValidator,
  nativeSdkSupervisorVerifierValidator,
} from './native-sdk-supervisor-child.js';
import {
  nativeSdkSupervisorIntegrateExecutor,
  nativeSdkSupervisorIntegrateValidator,
} from './native-sdk-supervisor-integrate.js';
import { nativeSdkSupervisorIntegrationRepairValidator } from './native-sdk-supervisor-integration-repair.js';
import {
  nativeSdkSupervisorDeliverExecutor,
  nativeSdkSupervisorDeliverValidator,
} from './native-sdk-supervisor-deliver.js';
import {
  nativeSdkSupervisorCleanupExecutor,
  nativeSdkSupervisorCleanupValidator,
} from './native-sdk-supervisor-cleanup.js';
import {
  nativeSdkSupervisorChildArchiveExecutor,
  nativeSdkSupervisorChildArchiveValidator,
} from './native-sdk-supervisor-archive.js';
import {
  selectNativeSdkReadyChildren,
  currentNativeSdkSupervisorActions,
} from './native-sdk-supervisor-plan.js';
import { nativeSdkSupervisorParentCandidateCommit } from './native-sdk-supervisor-parent.js';
import { supervisorAcceptanceScope } from './native-supervisor-model.js';
import {
  nativeSupervisorIntegrationBranch,
  nativeSupervisorIntegrationWorktree,
} from './native-supervisor-workspace.js';
import { preflightNativeCheckPlans } from './native-check-executor.js';
import {
  readNativeChildrenContract,
  type NativeChildrenContract,
} from './native-children-contract.js';
import { readProjectConfig } from './native-config.js';
import {
  applyNativeVerifierEnvelope,
  confirmNativeSkillCoordinatedPass,
  confirmNativePortableAcceptance,
  NATIVE_MAX_REQUEST_CHECK_ROUNDS,
  prepareNativePortableShapeConfirmation,
  submitNativeBuilderCandidate,
  reserveNativeVerifierAttempt,
  recordNativeVerifierExecutionError,
  retryNativeVerifier,
  returnNativeCandidateToBuild,
} from './native-loop-runtime.js';
import { nativeProjectPaths } from './native-paths.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { parseNativeBuilderAcceptanceReview } from './native-builder-acceptance-review.js';
import {
  assertNativePortableDocuments,
  discoverNativePortableSpecChanges,
  inspectNativePortableAcceptanceDrift,
  nativePortableShapeConfirmationHash,
  readNativePortableAcceptance,
} from './native-portable-requirements.js';
import { appendNativePortableHistory, parseNativePortableState } from './native-portable-state.js';
import { nativePortableStateFile } from './native-portable-storage.js';
import { toNativePortableText } from './native-portable-text.js';
import {
  normalizeNativeCheckRequestId,
  parseNativeVerifierResponse,
} from './native-verifier-protocol.js';
import { createNativeRunnerChannel, NATIVE_SKILL_COORDINATION } from './native-runner-protocol.js';
import type {
  NativePortableAcceptanceState,
  NativePortableCheckSummary,
  NativePortableSpecChange,
  NativePortableState,
  NativeSupervisorCoordinationMode,
} from './native-portable-types.js';
import { emptyNativePortableHistoryOverflow } from './native-portable-types.js';
import { validateNativeSdkSupervisorRecovery } from './native-sdk-supervisor-recovery.js';
import type { NativeProjectPaths } from './native-types.js';

interface NativeShapeProposal {
  specChanges: NativePortableSpecChange[];
  acceptance: Array<Pick<NativePortableAcceptanceState, 'id' | 'source' | 'text'>>;
  formalHash: string;
  children: { hash: string; contract: NativeChildrenContract } | null;
  shapeConfirmationHash: string;
}

export interface NativeWorkflowApplication {
  workflow: DefineWorkflowOptions;
  transitionHandler: WorkflowTransitionHandler;
  validators: readonly RuntimeValidator[];
  stateValidators: readonly RuntimeStateValidator[];
  executors: readonly RuntimeExecutor[];
  commandValidators: readonly RuntimeCommandValidator[];
  validateRecovery: NonNullable<CreateRuntimeOptions['validateRecovery']>;
}

export async function assertNativeSdkStartAvailable(options: {
  projectRoot: string;
  name: string;
  artifactRootRef: string;
}): Promise<void> {
  const paths = await nativeProjectPaths(options.projectRoot, options.artifactRootRef);
  const state = await inspectProtectedProjectPath(
    options.projectRoot,
    path.relative(options.projectRoot, nativePortableStateFile(paths, options.name)),
    { label: 'Native legacy change state', expected: 'file' },
  );
  if (state.exists) {
    throw new Error(`Native change ${options.name} already has legacy Runtime state`);
  }
}

export async function registerNativeSdkStartOwner(options: {
  projectRoot: string;
  name: string;
  artifactRootRef: string;
}): Promise<void> {
  const paths = await nativeProjectPaths(options.projectRoot, options.artifactRootRef);
  await withNativeMutationLock(paths, `register SDK change ${options.name}`, async () => {
    await assertNativeSdkStartAvailable(options);
    await registerSdkChangeOwner(options.projectRoot, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'native',
      change: options.name,
      format: 'sdk',
      application: 'native',
      runId: options.name,
    });
  });
}

/** Reads formal Shape artifacts without creating a second mutable Native state. */
export async function collectNativeSdkShapeProposal(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<NativeShapeProposal> {
  const state = parseNativePortableState({
    ...options.state,
    document_constraints_version: options.state.document_constraints_version ?? 2,
  });
  if (state.phase !== 'shape' || !['active', 'await-user'].includes(state.status)) {
    throw new Error('Native Shape proposal requires an active or pending Shape');
  }
  const changeDir = path.join(options.paths.changesDir, state.name);
  const specChanges = await discoverNativePortableSpecChanges({ paths: options.paths, state });
  await assertNativePortableDocuments({ paths: options.paths, state, specChanges });
  const { acceptance, formalHash } = await readNativePortableAcceptance({
    paths: options.paths,
    state,
    specChanges,
  });
  const children = await readNativeChildrenContract({
    changeDir,
    acceptanceIds: acceptance.map(({ id }) => id),
    validation: nativeChildrenAcceptanceValidation({ ...state, acceptance }),
  });
  if ((await readNativeSupervisorShapeIntent(changeDir)) && !children) {
    throw new Error('Native Supervisor Shape requires children.yaml before confirmation');
  }
  return {
    specChanges,
    acceptance: acceptance.map(({ id, source, text }) => ({ id, source, text })),
    formalHash,
    children: children ? { hash: children.hash, contract: children.contract } : null,
    shapeConfirmationHash: nativePortableShapeConfirmationHash({
      formalHash,
      childrenHash: children?.hash ?? null,
      coordinationMode: undefined,
    }),
  };
}

function resetShape(state: NativePortableState): NativePortableState {
  const next: NativePortableState = {
    ...state,
    status: 'active',
    state_version: state.state_version + 1,
    loop: { ...state.loop, stage: 'shape', next_action: 'prepare-shape-confirmation' },
    acceptance: [],
  };
  delete next.shape_confirmation_hash;
  delete next.children_contract_hash;
  delete next.coordination_mode;
  return parseNativePortableState(next);
}

function resetShapeForRemoval(
  state: NativePortableState,
  specChanges: NativePortableSpecChange[],
): NativePortableState {
  const next: NativePortableState = {
    ...state,
    phase: 'shape',
    status: 'active',
    state_version: state.state_version + 1,
    spec_changes: specChanges,
    acceptance: [],
    builder_handoff: null,
    blockers: [],
    verification: null,
    verification_result: 'pending',
    verification_report: null,
    history: [],
    history_overflow: emptyNativePortableHistoryOverflow(),
    loop: {
      stage: 'shape',
      goal_cycle: state.loop.goal_cycle + (state.phase === 'shape' ? 0 : 1),
      iteration: 0,
      attempt: 0,
      retry_epoch: 0,
      failed_iteration_count: 0,
      no_progress_count: 0,
      execution_failure_count: 0,
      previous_unresolved_ids: [],
      next_action: 'prepare-shape-confirmation',
    },
  };
  delete next.shape_confirmation_hash;
  delete next.children_contract_hash;
  delete next.coordination_mode;
  delete next.verifier_action;
  return parseNativePortableState(next);
}

function resetShapeForRequirementsRevision(
  state: NativePortableState,
  reason: string,
): NativePortableState {
  const withHistory = appendNativePortableHistory(state, {
    goal_cycle: state.loop.goal_cycle,
    iteration: state.loop.iteration,
    attempt: state.loop.attempt,
    outcome: 'recovery',
    unresolved_ids: [],
    summary: toNativePortableText(reason),
    completed_at: new Date().toISOString(),
  });
  const next: NativePortableState = {
    ...withHistory,
    phase: 'shape',
    status: 'active',
    state_version: state.state_version + 1,
    acceptance: [],
    builder_handoff: null,
    blockers: [],
    verification: null,
    verification_result: 'pending',
    verification_report: null,
    loop: {
      stage: 'shape',
      goal_cycle: state.loop.goal_cycle + 1,
      iteration: 0,
      attempt: 0,
      retry_epoch: 0,
      failed_iteration_count: 0,
      no_progress_count: 0,
      execution_failure_count: 0,
      previous_unresolved_ids: [],
      next_action: 'prepare-shape-confirmation',
    },
  };
  delete next.shape_confirmation_hash;
  delete next.children_contract_hash;
  delete next.coordination_mode;
  delete next.verifier_action;
  return parseNativePortableState(next);
}

function proposalFrom(value: unknown): NativeShapeProposal {
  if (value === null || typeof value !== 'object') throw new Error('Native Shape proposal missing');
  return value as NativeShapeProposal;
}

function supervisorIntegrationActivation(
  action: Readonly<RuntimeAction>,
  output: unknown,
): Record<string, RuntimeValue> {
  const input = (action.input as { activation?: Record<string, RuntimeValue> }).activation;
  const result = output as { integrationChecks?: RuntimeValue } | null;
  if (!input || !action.claim?.sessionId || !result?.integrationChecks) {
    throw new Error('Native SDK Supervisor Verifier lacks its Child activation');
  }
  return {
    ...input,
    verifierActionId: action.id,
    verifierSessionId: action.claim.sessionId,
    integrationChecks: result.integrationChecks,
  };
}

function queuedSupervisorIntegration(run: Readonly<WorkflowRun>): RuntimeAction | null {
  const actions = currentNativeSdkSupervisorActions(run);
  const dispatched = new Set(
    actions
      .filter((action) => action.stepId === 'supervisor.child.integrate')
      .map((action) => (action.input as { activation?: { child?: string } }).activation?.child),
  );
  return (
    actions.find(
      (action) =>
        action.stepId === 'supervisor.child.verifier' &&
        action.status === 'succeeded' &&
        (action.outcome?.output as { verdict?: unknown } | null)?.verdict === 'pass' &&
        !dispatched.has((action.input as { activation?: { child?: string } }).activation?.child),
    ) ?? null
  );
}

function supervisorChildRepairActivation(
  run: Readonly<WorkflowRun>,
  source: Readonly<RuntimeAction>,
  failureKey: 'failedCheckActionId' | 'failedVerifierActionId',
): Record<string, RuntimeValue> {
  const verified = (source.input as { activation?: Record<string, RuntimeValue> }).activation;
  const builder = currentNativeSdkSupervisorActions(run).find(
    (action) =>
      action.stepId === 'supervisor.child.builder' &&
      action.status === 'succeeded' &&
      action.claim?.sessionId === verified?.builderSessionId &&
      (action.outcome?.output as { candidateCommit?: unknown } | null)?.candidateCommit ===
        verified?.candidateCommit,
  );
  const input = (builder?.input as { activation?: Record<string, RuntimeValue> } | undefined)
    ?.activation;
  if (!input || input.child !== verified?.child) {
    throw new Error('Native SDK Supervisor repair lacks the failed Child Builder');
  }
  return { ...input, [failureKey]: source.id };
}

function supervisorParentRepairActivation(
  run: Readonly<WorkflowRun>,
  failure: { failedVerifierActionId: string } | { rejectedDecisionId: string },
): Record<string, RuntimeValue> {
  const builder = [...currentNativeSdkSupervisorActions(run)]
    .reverse()
    .find(
      (action) => action.stepId === 'supervisor.parent.builder' && action.status === 'succeeded',
    );
  const activation = (builder?.input as { activation?: Record<string, RuntimeValue> } | undefined)
    ?.activation;
  if (!builder || !activation) {
    throw new Error('Native Supervisor parent repair lacks the prior integration candidate');
  }
  return {
    ...activation,
    integrationCommit: nativeSdkSupervisorParentCandidateCommit(builder),
    ...failure,
  };
}

function selectedShapeHash(
  proposal: NativeShapeProposal,
  coordinationMode: NativeSupervisorCoordinationMode | undefined,
): string {
  return nativePortableShapeConfirmationHash({
    formalHash: proposal.formalHash,
    childrenHash: proposal.children?.hash ?? null,
    coordinationMode,
  });
}

function builderCandidateState(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  outcome: Readonly<RuntimeOutcome>,
): NativePortableState {
  const state = parseNativePortableState(run.state);
  const output = outcome.output as Record<string, unknown> | null;
  const sessionId = action.claim?.sessionId;
  if (
    state.phase !== 'build' ||
    !['build.builder', 'supervisor.parent.builder'].includes(action.stepId) ||
    action.type !== 'handoff' ||
    !sessionId ||
    !output ||
    typeof output.summary !== 'string' ||
    !output.summary.trim() ||
    !Array.isArray(output.addressedAcceptanceIds) ||
    output.addressedAcceptanceIds.some((id) => typeof id !== 'string') ||
    !Array.isArray(output.checks) ||
    !Array.isArray(output.knownLimits) ||
    output.knownLimits.some((limit) => typeof limit !== 'string') ||
    typeof output.submittedAt !== 'string' ||
    Number.isNaN(Date.parse(output.submittedAt)) ||
    new Date(output.submittedAt).toISOString() !== output.submittedAt
  ) {
    throw new Error('Native Builder result needs a claimed host session and a complete candidate');
  }
  const checks = output.checks.map((value) => {
    const check = value as Record<string, unknown> | null;
    if (
      !check ||
      typeof check.name !== 'string' ||
      !['passed', 'failed', 'not-run'].includes(String(check.result)) ||
      (check.note != null && typeof check.note !== 'string')
    ) {
      throw new Error('Native Builder check summary is invalid');
    }
    return {
      name: check.name,
      result: check.result as 'passed' | 'failed' | 'not-run',
      note: check.note as string | null,
    };
  });
  const review = output.review as Record<string, unknown> | null | undefined;
  if (
    review != null &&
    (review.status !== 'passed' ||
      typeof review.summary !== 'string' ||
      typeof review.reviewerExecutionRef !== 'string')
  ) {
    throw new Error('Native Builder review is invalid');
  }
  const identity = createNativeRunnerChannel().captureExecutionIdentity({
    identityProvider: NATIVE_SKILL_COORDINATION,
    executionRef: sessionId,
  });
  return submitNativeBuilderCandidate({
    state,
    input: {
      identity,
      summary: output.summary,
      addressedAcceptanceIds: output.addressedAcceptanceIds as string[],
      acceptanceReview:
        output.acceptanceReview === undefined
          ? undefined
          : parseNativeBuilderAcceptanceReview(output.acceptanceReview),
      checks,
      knownLimits: output.knownLimits as string[],
      review: review
        ? {
            status: 'passed',
            summary: review.summary as string,
            reviewerExecutionRef: review.reviewerExecutionRef as string,
          }
        : null,
      candidateId: hashRuntimeValue({ actionId: action.id, outcomeId: outcome.outcomeId }),
      now: new Date(output.submittedAt),
    },
  });
}

function verifierResultState(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  outcome: Readonly<RuntimeOutcome>,
): { state: NativePortableState; requestChecks: boolean } {
  const state = parseNativePortableState(run.state);
  const output = outcome.output as Record<string, unknown> | null;
  const sessionId = action.claim?.sessionId;
  const candidate = state.builder_handoff;
  if (
    state.phase !== 'verify' ||
    state.status !== 'active' ||
    state.loop.next_action !== 'await-verifier-result' ||
    action.stepId !== 'verify.verifier' ||
    action.type !== 'handoff' ||
    outcome.status !== 'succeeded' ||
    !candidate ||
    !sessionId ||
    sessionId === candidate.builder_execution_ref ||
    !output ||
    output.candidateId !== candidate.candidate_id ||
    output.verifierExecutionRef !== sessionId
  ) {
    throw new Error('Native Verifier result is not bound to an independent current execution');
  }
  const checkOutput = run.outputs['verify.checks']?.value as
    { candidateId?: unknown; checks?: unknown } | undefined;
  if (checkOutput?.candidateId !== candidate.candidate_id || !Array.isArray(checkOutput.checks)) {
    throw new Error('Native Verifier result lacks current Runtime check evidence');
  }
  const candidateStart = run.actions
    .map(
      (entry) =>
        ['build.builder', 'supervisor.parent.builder'].includes(entry.stepId) &&
        entry.status === 'succeeded',
    )
    .lastIndexOf(true);
  const candidateActions = run.actions.slice(candidateStart + 1);
  const allPreviousRequests = candidateActions.filter(
    (entry) =>
      entry.stepId === 'verify.verifier' && entry.id !== action.id && entry.status === 'succeeded',
  );
  const lastExecutionFailure = candidateActions
    .map((entry) => entry.stepId === 'verify.verifier' && entry.status === 'failed')
    .lastIndexOf(true);
  const previousVerifierActions = candidateActions
    .slice(lastExecutionFailure + 1)
    .filter(
      (entry) =>
        entry.stepId === 'verify.verifier' &&
        entry.id !== action.id &&
        entry.status === 'succeeded',
    );
  if (
    previousVerifierActions.some(
      (entry) =>
        entry.status !== 'succeeded' ||
        entry.claim?.sessionId !== sessionId ||
        (entry.outcome?.output as { response?: { kind?: unknown } } | null)?.response?.kind !==
          'request-checks',
    )
  ) {
    throw new Error('Native Verifier check request changed execution within the same attempt');
  }
  if (
    previousVerifierActions.length >= NATIVE_MAX_REQUEST_CHECK_ROUNDS &&
    (output.response as { kind?: unknown } | null)?.kind === 'request-checks'
  ) {
    throw new Error('Native Verifier exceeded the requested-check round limit');
  }
  const allCheckOutputs = [
    checkOutput,
    ...candidateActions
      .filter(
        (entry) =>
          entry.stepId === 'verify.requested-checks' &&
          ['succeeded', 'failed'].includes(entry.status),
      )
      .map((entry) => entry.outcome?.output as { checks?: unknown } | undefined),
  ];
  const checks: NativePortableCheckSummary[] = allCheckOutputs.flatMap((batch) =>
    (Array.isArray(batch?.checks) ? batch.checks : []).map((entry) => {
      const check = entry as Record<string, unknown>;
      if (
        !check ||
        typeof check.id !== 'string' ||
        typeof check.name !== 'string' ||
        !Array.isArray(check.argvDisplay) ||
        check.argvDisplay.some((arg) => typeof arg !== 'string') ||
        typeof check.cwdRef !== 'string' ||
        !['passed', 'failed', 'interrupted'].includes(String(check.status)) ||
        (check.exitCode !== null && !Number.isSafeInteger(check.exitCode)) ||
        !Number.isSafeInteger(check.durationMs)
      ) {
        throw new Error('Native Verifier result has invalid Runtime check evidence');
      }
      return {
        id: check.id,
        name: toNativePortableText(check.name),
        argv_display: (check.argvDisplay as string[]).map((arg) => toNativePortableText(arg)),
        argv_truncated: false,
        cwd_ref: check.cwdRef,
        status: check.status as NativePortableCheckSummary['status'],
        exit_code: check.exitCode as number | null,
        duration_ms: check.durationMs as number,
      };
    }),
  );
  const input = run.input as { maxVerifyFailures?: unknown };
  const maxVerifyFailures = input.maxVerifyFailures ?? DEFAULT_WORKFLOW_NATIVE_MAX_VERIFY_FAILURES;
  if (!Number.isSafeInteger(maxVerifyFailures) || (maxVerifyFailures as number) < 1) {
    throw new Error('Native Verify failure budget is invalid');
  }
  const channel = createNativeRunnerChannel();
  const identity = channel.captureExecutionIdentity({
    identityProvider: NATIVE_SKILL_COORDINATION,
    executionRef: sessionId,
  });
  const applied = applyNativeVerifierEnvelope({
    state,
    envelope: channel.envelopeVerifierResponse({
      candidateId: candidate.candidate_id,
      identity,
      payload: output.response,
    }),
    checks,
    maxVerifyFailures: maxVerifyFailures as number,
  });
  if (applied.response.kind === 'request-checks') {
    const earlierRequests = [
      ...nativeSdkCheckPlans(
        run.outputs['supervisor.parent.builder']?.value ?? run.outputs['build.builder']?.value,
      ),
      ...allPreviousRequests.flatMap((entry) => {
        const prior = parseNativeVerifierResponse(
          (entry.outcome?.output as { response?: unknown } | null)?.response,
        );
        return prior.kind === 'request-checks' ? prior.checks : [];
      }),
    ];
    for (const check of applied.response.checks) {
      const prior = earlierRequests.find((entry) => entry.id === check.id);
      if (prior && normalizeNativeCheckRequestId(prior) !== normalizeNativeCheckRequestId(check)) {
        throw new Error(`Native Verifier check ID ${check.id} refers to conflicting commands`);
      }
    }
    if (
      allPreviousRequests.length > 0 &&
      applied.response.checks.every((check) =>
        earlierRequests.some(
          (prior) => normalizeNativeCheckRequestId(prior) === normalizeNativeCheckRequestId(check),
        ),
      )
    ) {
      throw new Error('Native Verifier repeatedly requested only equivalent checks');
    }
  }
  return { state: applied.state, requestChecks: applied.response.kind === 'request-checks' };
}

function verifierExecutionFailureState(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  outcome: Readonly<RuntimeOutcome>,
): NativePortableState {
  const state = parseNativePortableState(run.state);
  const output = outcome.output as { summary?: unknown } | null;
  if (
    outcome.status !== 'failed' ||
    action.stepId !== 'verify.verifier' ||
    action.type !== 'handoff' ||
    !action.claim?.sessionId ||
    action.claim.sessionId === state.builder_handoff?.builder_execution_ref ||
    !output ||
    typeof output.summary !== 'string' ||
    !output.summary.trim()
  ) {
    throw new Error(
      'Native Verifier execution failure needs a claimed independent session and summary',
    );
  }
  return recordNativeVerifierExecutionError({ state, summary: output.summary });
}

const shapeValidator: RuntimeValidator = {
  id: 'comet-native-shape-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (outcome.status === 'failed') return { accepted: true };
    const input = run.input as { name?: unknown; artifactRootRef?: unknown };
    if (
      !context?.projectRoot ||
      typeof input.name !== 'string' ||
      typeof input.artifactRootRef !== 'string' ||
      !['shape.prepare', 'shape.revalidate'].includes(action.stepId)
    ) {
      return { accepted: false, reason: 'Native Shape result lacks a bound project and change' };
    }
    try {
      const state = parseNativePortableState(run.state);
      if (state.name !== input.name) {
        return { accepted: false, reason: 'Native Shape result belongs to another change' };
      }
      const config = await readProjectConfig(context.projectRoot);
      if (!config || config.native.artifact_root !== input.artifactRootRef) {
        return { accepted: false, reason: 'Native artifact root changed after Run creation' };
      }
      const paths = await nativeProjectPaths(context.projectRoot, input.artifactRootRef);
      const current = await collectNativeSdkShapeProposal({ paths, state });
      if (
        hashRuntimeValue(current as unknown as RuntimeValue) !== hashRuntimeValue(outcome.output)
      ) {
        return { accepted: false, reason: 'Native Shape result does not match current documents' };
      }
      if (action.stepId === 'shape.revalidate') {
        const outputs = (action.input as { outputs?: Record<string, unknown> }).outputs;
        const approved = outputs?.['shape.prepare'];
        if (
          !approved ||
          hashRuntimeValue(approved as RuntimeValue) !==
            hashRuntimeValue(current as unknown as RuntimeValue) ||
          state.shape_confirmation_hash !== selectedShapeHash(current, state.coordination_mode)
        ) {
          return { accepted: false, reason: 'Native Shape changed after user approval' };
        }
      }
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

const builderValidator: RuntimeValidator = {
  id: 'comet-native-builder-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (outcome.status === 'failed') return { accepted: true };
    const input = run.input as { name?: unknown; artifactRootRef?: unknown };
    if (
      !context?.projectRoot ||
      typeof input.name !== 'string' ||
      typeof input.artifactRootRef !== 'string'
    ) {
      return { accepted: false, reason: 'Native Builder result lacks its project binding' };
    }
    try {
      const state = parseNativePortableState(run.state);
      if (state.name !== input.name) {
        return { accepted: false, reason: 'Native Builder result belongs to another change' };
      }
      const config = await readProjectConfig(context.projectRoot);
      if (!config || config.native.artifact_root !== input.artifactRootRef) {
        return { accepted: false, reason: 'Native artifact root changed after Run creation' };
      }
      const paths = await nativeProjectPaths(context.projectRoot, input.artifactRootRef);
      const drift = await inspectNativePortableAcceptanceDrift({ paths, state });
      if (drift.drifted) {
        return { accepted: false, reason: drift.reason ?? 'Native acceptance changed' };
      }
      builderCandidateState(run, action, outcome);
      preflightNativeCheckPlans(context.projectRoot, nativeSdkCheckPlans(outcome.output));
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

const supervisorParentBuilderValidator: RuntimeValidator = {
  id: 'native-supervisor-parent-builder-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (outcome.status === 'failed') return { accepted: true };
    if (
      !context?.projectRoot ||
      action.stepId !== 'supervisor.parent.builder' ||
      action.type !== 'handoff'
    ) {
      return { accepted: false, reason: 'Native Supervisor parent Builder lacks its project' };
    }
    try {
      const plan = await currentNativeSdkSupervisorPlan(run, context.projectRoot);
      const state = parseNativePortableState(run.state);
      const input = (action.input as { activation?: Record<string, unknown> }).activation;
      const worktree = nativeSupervisorIntegrationWorktree(context.projectRoot, state.name);
      const branch = nativeSupervisorIntegrationBranch(state.name);
      const candidateCommit = nativeSdkSupervisorParentCandidateCommit(action, outcome);
      const integrated = new Set(
        currentNativeSdkSupervisorActions(run)
          .filter(
            (candidate) =>
              candidate.stepId === 'supervisor.child.integration-checks' &&
              candidate.status === 'succeeded',
          )
          .map(
            (candidate) => (candidate.input as { activation: { child: string } }).activation.child,
          ),
      );
      if (
        state.phase !== 'build' ||
        !input ||
        input.contractHash !== state.children_contract_hash ||
        input.integrationBranch !== branch ||
        typeof input.integrationWorktree !== 'string' ||
        !samePath(input.integrationWorktree, worktree) ||
        typeof input.integrationCommit !== 'string' ||
        inspectGitWorktree(worktree).currentBranch !== branch ||
        resolveGitRef(worktree, branch) !== candidateCommit ||
        integrated.size !== plan.contract.children.length ||
        plan.contract.children.some(({ name }) => !integrated.has(name))
      ) {
        throw new Error('Native Supervisor parent candidate is not the complete integration');
      }
      runGitCommand(worktree, [
        'merge-base',
        '--is-ancestor',
        input.integrationCommit,
        candidateCommit,
      ]);
      const config = await readProjectConfig(context.projectRoot);
      if (
        !config ||
        config.native.artifact_root !== (run.input as { artifactRootRef?: unknown }).artifactRootRef
      ) {
        throw new Error('Native artifact root changed after Run creation');
      }
      const paths = await nativeProjectPaths(context.projectRoot, config.native.artifact_root);
      const drift = await inspectNativePortableAcceptanceDrift({ paths, state });
      if (drift.drifted) throw new Error(drift.reason ?? 'Native acceptance changed');
      builderCandidateState(run, action, outcome);
      const checks = nativeSdkCheckPlans(outcome.output);
      if (checks.length === 0) throw new Error('Native Supervisor parent candidate needs checks');
      preflightNativeCheckPlans(worktree, checks);
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

const verifierValidator: RuntimeValidator = {
  id: 'comet-native-verifier-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    const input = run.input as { artifactRootRef?: unknown; maxVerifyFailures?: unknown };
    if (!context?.projectRoot || typeof input.artifactRootRef !== 'string') {
      return { accepted: false, reason: 'Native Verifier result lacks its project binding' };
    }
    try {
      const config = await readProjectConfig(context.projectRoot);
      if (
        !config ||
        config.native.artifact_root !== input.artifactRootRef ||
        (input.maxVerifyFailures ?? DEFAULT_WORKFLOW_NATIVE_MAX_VERIFY_FAILURES) !==
          config.native.max_verify_failures
      ) {
        return {
          accepted: false,
          reason: 'Native project configuration changed after Run creation',
        };
      }
      const paths = await nativeProjectPaths(context.projectRoot, input.artifactRootRef);
      const state = parseNativePortableState(run.state);
      const drift = await inspectNativePortableAcceptanceDrift({ paths, state });
      if (drift.drifted) {
        return { accepted: false, reason: drift.reason ?? 'Native acceptance changed' };
      }
      await nativeSdkCurrentCheckSummaries({ run, projectRoot: context.projectRoot });
      if (outcome.status === 'failed') verifierExecutionFailureState(run, action, outcome);
      else verifierResultState(run, action, outcome);
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

const nativeStateValidator: RuntimeStateValidator = {
  id: 'comet-native-state',
  version: '1',
  validate({ state }) {
    try {
      parseNativePortableState(state);
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

export function defineNativeWorkflowApplication(): NativeWorkflowApplication {
  return {
    workflow: {
      id: 'comet-native',
      version: '1',
      entry: 'shape.prepare',
      commands: {
        'revise-requirements': {
          stepId: 'shape.revise',
          validator: {
            id: nativeSdkReviseCommandValidator.id,
            version: nativeSdkReviseCommandValidator.version,
          },
        },
        'remove-capability': {
          stepId: 'shape.remove',
          validator: {
            id: nativeSdkRemoveCommandValidator.id,
            version: nativeSdkRemoveCommandValidator.version,
          },
        },
        'disassociate-capability': {
          stepId: 'shape.disassociate',
          validator: {
            id: nativeSdkDisassociateCommandValidator.id,
            version: nativeSdkDisassociateCommandValidator.version,
          },
        },
      },
      stateSchema: {
        type: 'object',
        required: ['schema', 'name', 'phase', 'status', 'state_version', 'loop', 'acceptance'],
        properties: {
          schema: { const: 'comet.native.v4' },
          name: { type: 'string' },
          phase: { enum: ['shape', 'build', 'verify', 'archive'] },
          status: { enum: ['active', 'await-user', 'blocked', 'done'] },
          state_version: { type: 'integer', minimum: 1 },
          loop: { type: 'object' },
          acceptance: { type: 'array' },
        },
      },
      transitionHandler: { id: 'comet-native-transition', version: '1' },
      stateValidator: { id: nativeStateValidator.id, version: nativeStateValidator.version },
      steps: {
        'shape.revise': {
          type: 'call_tool',
          ref: 'native-revise-requirements',
          validator: { id: nativeSdkReviseValidator.id, version: nativeSdkReviseValidator.version },
        },
        'shape.remove': {
          type: 'call_tool',
          ref: 'native-remove',
          validator: { id: nativeSdkRemoveValidator.id, version: nativeSdkRemoveValidator.version },
        },
        'shape.disassociate': {
          type: 'call_tool',
          ref: 'native-disassociate',
          validator: {
            id: nativeSdkDisassociateValidator.id,
            version: nativeSdkDisassociateValidator.version,
          },
        },
        'shape.prepare': {
          type: 'call_tool',
          ref: 'native-shape-prepare',
          validator: { id: shapeValidator.id, version: shapeValidator.version },
        },
        'shape.confirm': {
          type: 'ask_user',
          proposalFrom: 'shape.prepare',
          choices: ['approved', 'rejected'],
        },
        'supervisor.shape.confirm': {
          type: 'ask_user',
          proposalFrom: 'shape.prepare',
          choices: ['multi-session', 'single-session', 'rejected'],
        },
        'shape.revalidate': {
          type: 'call_tool',
          ref: 'native-shape-revalidate',
          validator: { id: shapeValidator.id, version: shapeValidator.version },
        },
        'build.builder': {
          type: 'handoff',
          ref: 'native-builder',
          validator: { id: builderValidator.id, version: builderValidator.version },
        },
        'build.resume': {
          type: 'ask_user',
          proposalFrom: 'build.builder',
          choices: ['continue'],
        },
        'supervisor.prepare': {
          type: 'call_tool',
          ref: 'native-supervisor-prepare',
          validator: {
            id: nativeSdkSupervisorPrepareValidator.id,
            version: nativeSdkSupervisorPrepareValidator.version,
          },
        },
        'supervisor.child.prepare': {
          type: 'call_tool',
          ref: 'native-supervisor-child-prepare',
          validator: {
            id: nativeSdkSupervisorChildPrepareValidator.id,
            version: nativeSdkSupervisorChildPrepareValidator.version,
          },
        },
        'supervisor.child.builder': {
          type: 'handoff',
          ref: 'native-supervisor-builder',
          validator: {
            id: nativeSdkSupervisorBuilderValidator.id,
            version: nativeSdkSupervisorBuilderValidator.version,
          },
        },
        'supervisor.child.resume': {
          type: 'ask_user',
          proposalFrom: 'supervisor.child.builder',
          choices: ['continue'],
        },
        'supervisor.child.checks': {
          type: 'call_tool',
          ref: 'native-supervisor-child-checks',
          validator: { id: nativeSdkCheckValidator.id, version: nativeSdkCheckValidator.version },
        },
        'supervisor.child.verifier': {
          type: 'handoff',
          ref: 'native-supervisor-verifier',
          validator: {
            id: nativeSdkSupervisorVerifierValidator.id,
            version: nativeSdkSupervisorVerifierValidator.version,
          },
        },
        'supervisor.child.integrate': {
          type: 'call_tool',
          ref: 'native-supervisor-integrate',
          validator: {
            id: nativeSdkSupervisorIntegrateValidator.id,
            version: nativeSdkSupervisorIntegrateValidator.version,
          },
        },
        'supervisor.child.integration-checks': {
          type: 'call_tool',
          ref: 'native-supervisor-integration-checks',
          validator: { id: nativeSdkCheckValidator.id, version: nativeSdkCheckValidator.version },
        },
        'supervisor.child.integration-repair': {
          type: 'handoff',
          ref: 'native-supervisor-integration-repair',
          validator: {
            id: nativeSdkSupervisorIntegrationRepairValidator.id,
            version: nativeSdkSupervisorIntegrationRepairValidator.version,
          },
        },
        'supervisor.child.archive': {
          type: 'call_tool',
          ref: 'native-supervisor-child-archive',
          validator: {
            id: nativeSdkSupervisorChildArchiveValidator.id,
            version: nativeSdkSupervisorChildArchiveValidator.version,
          },
        },
        'supervisor.parent.builder': {
          type: 'handoff',
          ref: 'native-supervisor-parent-builder',
          validator: {
            id: supervisorParentBuilderValidator.id,
            version: supervisorParentBuilderValidator.version,
          },
        },
        'supervisor.parent.resume': {
          type: 'ask_user',
          proposalFrom: 'supervisor.parent.builder',
          choices: ['continue'],
        },
        'supervisor.parent.deliver': {
          type: 'call_tool',
          ref: 'native-supervisor-parent-deliver',
          validator: {
            id: nativeSdkSupervisorDeliverValidator.id,
            version: nativeSdkSupervisorDeliverValidator.version,
          },
        },
        'supervisor.cleanup': {
          type: 'call_tool',
          ref: 'native-supervisor-cleanup',
          validator: {
            id: nativeSdkSupervisorCleanupValidator.id,
            version: nativeSdkSupervisorCleanupValidator.version,
          },
        },
        'verify.checks': {
          type: 'call_tool',
          ref: 'native-required-checks',
          validator: { id: nativeSdkCheckValidator.id, version: nativeSdkCheckValidator.version },
        },
        'verify.verifier': {
          type: 'handoff',
          ref: 'native-verifier',
          validator: { id: verifierValidator.id, version: verifierValidator.version },
        },
        'verify.retry': {
          type: 'ask_user',
          proposalFrom: 'verify.verifier',
          choices: ['retry'],
        },
        'verify.stop': {
          type: 'ask_user',
          proposalFrom: 'verify.verifier',
          choices: ['repair'],
        },
        'verify.requested-checks': {
          type: 'call_tool',
          ref: 'native-verifier-requested-checks',
          validator: { id: nativeSdkCheckValidator.id, version: nativeSdkCheckValidator.version },
        },
        'verify.report': {
          type: 'call_tool',
          ref: 'native-verification-report',
          validator: { id: nativeSdkReportValidator.id, version: nativeSdkReportValidator.version },
        },
        'verify.confirm': {
          type: 'ask_user',
          proposalFrom: 'verify.report',
          choices: ['approved', 'rejected'],
        },
        'verify.revalidate': {
          type: 'call_tool',
          ref: 'native-report-revalidate',
          validator: {
            id: nativeSdkReportRevalidationValidator.id,
            version: nativeSdkReportRevalidationValidator.version,
          },
        },
        'archive.prepare': {
          type: 'call_tool',
          ref: 'native-archive-preflight',
          validator: {
            id: nativeSdkArchivePreflightValidator.id,
            version: nativeSdkArchivePreflightValidator.version,
          },
        },
        'archive.execute': {
          type: 'call_tool',
          ref: 'native-archive',
          validator: {
            id: nativeSdkArchiveApplyValidator.id,
            version: nativeSdkArchiveApplyValidator.version,
          },
        },
        'archive.finalize': {
          type: 'call_tool',
          ref: 'native-archive-finalize',
          validator: {
            id: nativeSdkArchiveFinalizeValidator.id,
            version: nativeSdkArchiveFinalizeValidator.version,
          },
        },
      },
      transitions: [
        { from: 'shape.revise', to: 'shape.prepare' },
        { from: 'shape.remove', to: 'shape.prepare' },
        { from: 'shape.disassociate', to: 'shape.prepare' },
        { from: 'shape.prepare', to: 'shape.confirm' },
        { from: 'shape.prepare', to: 'supervisor.shape.confirm' },
        { from: 'shape.confirm', to: 'shape.revalidate', on: 'approved' },
        { from: 'shape.confirm', to: 'shape.prepare', on: 'rejected' },
        { from: 'supervisor.shape.confirm', to: 'shape.revalidate', on: 'multi-session' },
        { from: 'supervisor.shape.confirm', to: 'shape.revalidate', on: 'single-session' },
        { from: 'supervisor.shape.confirm', to: 'shape.prepare', on: 'rejected' },
        { from: 'shape.revalidate', to: 'build.builder' },
        { from: 'shape.revalidate', to: 'supervisor.prepare' },
        { from: 'supervisor.prepare', to: 'supervisor.child.prepare' },
        { from: 'supervisor.child.prepare', to: 'supervisor.child.builder' },
        { from: 'supervisor.child.builder', to: 'supervisor.child.checks' },
        { from: 'supervisor.child.builder', to: 'supervisor.child.resume', on: 'failed' },
        { from: 'supervisor.child.resume', to: 'supervisor.child.builder', on: 'continue' },
        { from: 'supervisor.child.checks', to: 'supervisor.child.verifier' },
        { from: 'supervisor.child.checks', to: 'supervisor.child.builder', on: 'failed' },
        { from: 'supervisor.child.verifier', to: 'supervisor.child.integrate' },
        { from: 'supervisor.child.verifier', to: 'supervisor.child.builder' },
        { from: 'supervisor.child.integrate', to: 'supervisor.child.integration-checks' },
        {
          from: 'supervisor.child.integration-checks',
          to: 'supervisor.child.integration-repair',
          on: 'failed',
        },
        { from: 'supervisor.child.integration-repair', to: 'supervisor.child.integration-checks' },
        { from: 'supervisor.child.integration-checks', to: 'supervisor.child.integrate' },
        { from: 'supervisor.child.integration-checks', to: 'supervisor.child.prepare' },
        { from: 'supervisor.child.integration-checks', to: 'supervisor.parent.builder' },
        { from: 'supervisor.child.integration-checks', to: 'supervisor.child.archive' },
        { from: 'supervisor.child.archive', to: 'supervisor.child.integrate' },
        { from: 'supervisor.child.archive', to: 'supervisor.child.prepare' },
        { from: 'supervisor.child.archive', to: 'supervisor.parent.builder' },
        { from: 'supervisor.parent.builder', to: 'verify.checks' },
        { from: 'supervisor.parent.builder', to: 'supervisor.parent.resume', on: 'failed' },
        { from: 'supervisor.parent.resume', to: 'supervisor.parent.builder', on: 'continue' },
        { from: 'shape.revalidate', to: 'shape.prepare', on: 'failed' },
        { from: 'build.builder', to: 'verify.checks' },
        { from: 'build.builder', to: 'build.resume', on: 'failed' },
        { from: 'build.resume', to: 'build.builder', on: 'continue' },
        { from: 'verify.checks', to: 'verify.verifier' },
        { from: 'verify.verifier', to: 'verify.report' },
        { from: 'verify.verifier', to: 'build.builder' },
        { from: 'verify.verifier', to: 'supervisor.parent.builder' },
        { from: 'verify.verifier', to: 'verify.requested-checks' },
        { from: 'verify.verifier', to: 'verify.verifier', on: 'failed' },
        { from: 'verify.verifier', to: 'verify.retry', on: 'failed' },
        { from: 'verify.retry', to: 'verify.verifier', on: 'retry' },
        { from: 'verify.verifier', to: 'verify.stop' },
        { from: 'verify.stop', to: 'build.builder', on: 'repair' },
        { from: 'verify.stop', to: 'supervisor.parent.builder', on: 'repair' },
        { from: 'verify.requested-checks', to: 'verify.verifier' },
        { from: 'verify.requested-checks', to: 'verify.verifier', on: 'failed' },
        { from: 'verify.report', to: 'verify.confirm' },
        { from: 'verify.confirm', to: 'verify.revalidate', on: 'approved' },
        { from: 'verify.confirm', to: 'build.builder', on: 'rejected' },
        { from: 'verify.confirm', to: 'supervisor.parent.builder', on: 'rejected' },
        { from: 'verify.revalidate', to: 'archive.prepare' },
        { from: 'verify.revalidate', to: 'supervisor.parent.deliver' },
        { from: 'supervisor.parent.deliver', to: 'archive.prepare' },
        { from: 'verify.revalidate', to: 'verify.report', on: 'failed' },
        { from: 'archive.prepare', to: 'archive.execute' },
        { from: 'archive.execute', to: 'archive.finalize' },
        { from: 'archive.finalize', to: 'supervisor.cleanup' },
      ],
    },
    transitionHandler: {
      id: 'comet-native-transition',
      version: '1',
      apply({ run, event }) {
        const state = parseNativePortableState(run.state);
        if (event.kind === 'action-outcome' && event.stepId === 'shape.revise') {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          const reason = (event.outcome.output as { reason: string }).reason;
          return {
            state: resetShapeForRequirementsRevision(state, reason) as unknown as RuntimeValue,
            next: ['shape.prepare'],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'shape.remove') {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          const capability = (event.outcome.output as { capability: string }).capability;
          const specChanges: NativePortableSpecChange[] = [
            ...state.spec_changes.filter((change) => change.capability !== capability),
            { capability, operation: 'remove', source: null } as const,
          ].sort((left, right) => left.capability.localeCompare(right.capability, 'en'));
          return {
            state: resetShapeForRemoval(state, specChanges) as unknown as RuntimeValue,
            next: ['shape.prepare'],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'shape.disassociate') {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          return { state: resetShape(state) as unknown as RuntimeValue, next: ['shape.prepare'] };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'shape.prepare') {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          const proposal = proposalFrom(event.outcome.output);
          const prepared = prepareNativePortableShapeConfirmation({
            state: {
              ...state,
              document_constraints_version: state.document_constraints_version ?? 2,
              spec_changes: proposal.specChanges,
              shape_confirmation_hash: proposal.shapeConfirmationHash,
            },
            acceptance: proposal.acceptance,
          });
          return {
            state: prepared as unknown as RuntimeValue,
            next:
              proposal.children && proposal.children.contract.children.length >= 2
                ? ['supervisor.shape.confirm']
                : ['shape.confirm'],
          };
        }
        if (event.kind === 'wait-resolved' && event.stepId === 'shape.confirm') {
          return event.choice === 'approved'
            ? { state: state as unknown as RuntimeValue, next: ['shape.revalidate'] }
            : { state: resetShape(state) as unknown as RuntimeValue, next: ['shape.prepare'] };
        }
        if (event.kind === 'wait-resolved' && event.stepId === 'supervisor.shape.confirm') {
          if (event.choice === 'rejected') {
            return { state: resetShape(state) as unknown as RuntimeValue, next: ['shape.prepare'] };
          }
          const proposal = proposalFrom(run.outputs['shape.prepare']?.value);
          if (!proposal.children || proposal.children.contract.children.length < 2) {
            throw new Error('Native Supervisor approval lacks its child plan');
          }
          const coordinationMode = event.choice as NativeSupervisorCoordinationMode;
          const selected = parseNativePortableState({
            ...state,
            coordination_mode: coordinationMode,
            shape_confirmation_hash: selectedShapeHash(proposal, coordinationMode),
          });
          return { state: selected as unknown as RuntimeValue, next: ['shape.revalidate'] };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'shape.revalidate') {
          if (event.outcome.status === 'failed') {
            return { state: resetShape(state) as unknown as RuntimeValue, next: ['shape.prepare'] };
          }
          const confirmed = confirmNativePortableAcceptance({
            state,
            acceptance: state.acceptance.map(({ id, source, text }) => ({ id, source, text })),
          });
          const proposal = proposalFrom(event.outcome.output);
          if (!proposal.children) {
            return { state: confirmed as unknown as RuntimeValue, next: ['build.builder'] };
          }
          const supervisor = parseNativePortableState({
            ...confirmed,
            children_contract_hash: hashNativeParentContract({
              acceptance: confirmed.acceptance,
              children: proposal.children.contract,
            }),
          });
          return { state: supervisor as unknown as RuntimeValue, next: ['supervisor.prepare'] };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'supervisor.prepare') {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          const proposal = proposalFrom(run.outputs['shape.revalidate']?.value);
          if (!proposal.children || !state.children_contract_hash) {
            throw new Error('Native Supervisor preparation lacks the confirmed child plan');
          }
          const output = event.outcome.output as {
            integrationBranch: string;
            integrationWorktree: string;
            targetCommit: string;
            integrationCommit?: string;
          };
          const ready = selectNativeSdkReadyChildren({
            contract: proposal.children.contract,
            integrated: [],
            active: [],
            maxParallel: state.coordination_mode === 'single-session' ? 1 : 2,
          });
          return {
            state: state as unknown as RuntimeValue,
            next: ready.map((child) => ({
              stepId: 'supervisor.child.prepare',
              input: {
                child,
                contractHash: state.children_contract_hash!,
                integrationBranch: output.integrationBranch,
                integrationWorktree: output.integrationWorktree,
                targetCommit: output.integrationCommit ?? output.targetCommit,
              },
            })),
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'supervisor.child.prepare') {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          const output = event.outcome.output as {
            child: string;
            contractHash: string;
            worktree: string;
            branch: string;
            baseCommit: string;
          };
          return {
            state: state as unknown as RuntimeValue,
            next: [
              {
                stepId: 'supervisor.child.builder',
                input: output,
              },
            ],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'supervisor.child.builder') {
          if (event.outcome.status !== 'succeeded') {
            const action = run.actions.find((candidate) => candidate.id === event.outcome.actionId);
            const activation = (action?.input as { activation?: Record<string, RuntimeValue> })
              ?.activation;
            if (!activation || !action) {
              throw new Error('Native SDK Supervisor Child Builder failure lacks its Action');
            }
            return {
              state: state as unknown as RuntimeValue,
              next: [
                {
                  stepId: 'supervisor.child.resume',
                  input: { ...activation, failedBuilderActionId: action.id },
                },
              ],
            };
          }
          const action = run.actions.find((candidate) => candidate.id === event.outcome.actionId);
          if (!action?.claim?.sessionId) {
            throw new Error('Native SDK Supervisor Builder Action lacks its host session');
          }
          const input = (action.input as { activation?: Record<string, RuntimeValue> }).activation;
          const proposal = proposalFrom(run.outputs['shape.revalidate']?.value);
          if (!input || !proposal.children || typeof input.child !== 'string') {
            throw new Error('Native SDK Supervisor Builder lacks its confirmed child plan');
          }
          return {
            state: state as unknown as RuntimeValue,
            next: [
              {
                stepId: 'supervisor.child.checks',
                input: {
                  ...input,
                  candidateCommit: (event.outcome.output as { candidateCommit: string })
                    .candidateCommit,
                  builderSessionId: action.claim.sessionId,
                  acceptance: supervisorAcceptanceScope(proposal.children.contract, input.child),
                  verificationChecks: (event.outcome.output as { verificationChecks: RuntimeValue })
                    .verificationChecks,
                },
              },
            ],
          };
        }
        if (event.kind === 'wait-resolved' && event.stepId === 'supervisor.child.resume') {
          const wait = run.waits.find(
            (candidate) =>
              candidate.stepId === 'supervisor.child.resume' &&
              candidate.decision?.id === event.decisionId &&
              candidate.proposalHash === event.proposalHash,
          );
          const activation = (
            wait?.proposal as {
              activation?: Record<string, RuntimeValue> & { failedBuilderActionId?: string };
            }
          )?.activation;
          if (
            !activation ||
            typeof activation.failedBuilderActionId !== 'string' ||
            !run.actions.some(
              (action) =>
                action.id === activation.failedBuilderActionId &&
                action.stepId === 'supervisor.child.builder' &&
                action.status === 'failed',
            )
          ) {
            throw new Error('Native SDK Supervisor Child continuation lacks its failed Action');
          }
          return {
            state: state as unknown as RuntimeValue,
            next: [{ stepId: 'supervisor.child.builder', input: activation }],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'supervisor.child.checks') {
          if (event.outcome.status !== 'succeeded') {
            const action = run.actions.find((candidate) => candidate.id === event.outcome.actionId);
            if (!action) throw new Error('Native SDK Supervisor Child check Action is missing');
            return {
              state: state as unknown as RuntimeValue,
              next: [
                {
                  stepId: 'supervisor.child.builder',
                  input: supervisorChildRepairActivation(run, action, 'failedCheckActionId'),
                },
              ],
            };
          }
          const action = run.actions.find((candidate) => candidate.id === event.outcome.actionId);
          const input = (action?.input as { activation?: Record<string, RuntimeValue> } | undefined)
            ?.activation;
          if (!input) throw new Error('Native SDK Supervisor checks lack their Child activation');
          return {
            state: state as unknown as RuntimeValue,
            next: [
              {
                stepId: 'supervisor.child.verifier',
                input: { ...input, checkActionId: event.outcome.actionId },
              },
            ],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'supervisor.child.verifier') {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          const output = event.outcome.output as { verdict: string; candidateCommit: string };
          if (output.verdict === 'fail' || output.verdict === 'blocked') {
            const action = run.actions.find((candidate) => candidate.id === event.outcome.actionId);
            if (!action) throw new Error('Native SDK Supervisor Verifier Action is missing');
            return {
              state: state as unknown as RuntimeValue,
              next: [
                {
                  stepId: 'supervisor.child.builder',
                  input: supervisorChildRepairActivation(run, action, 'failedVerifierActionId'),
                },
              ],
            };
          }
          if (output.verdict !== 'pass') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          if (
            run.actions.some(
              (candidate) =>
                [
                  'supervisor.child.integrate',
                  'supervisor.child.integration-checks',
                  'supervisor.child.integration-repair',
                ].includes(candidate.stepId) &&
                ['pending', 'running', 'unknown'].includes(candidate.status),
            )
          ) {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          const action = run.actions.find((candidate) => candidate.id === event.outcome.actionId);
          if (!action) throw new Error('Native SDK Supervisor Verifier Action is missing');
          return {
            state: state as unknown as RuntimeValue,
            next: [
              {
                stepId: 'supervisor.child.integrate',
                input: supervisorIntegrationActivation(action, event.outcome.output),
              },
            ],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'supervisor.child.integrate') {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          const action = run.actions.find((candidate) => candidate.id === event.outcome.actionId);
          const input = (action?.input as { activation?: Record<string, RuntimeValue> } | undefined)
            ?.activation;
          const output = event.outcome.output as {
            integrationCommit: string;
            integrationBranch: string;
            integrationWorktree: string;
          };
          if (!input)
            throw new Error('Native SDK Supervisor integration lacks its Child activation');
          return {
            state: state as unknown as RuntimeValue,
            next: [
              {
                stepId: 'supervisor.child.integration-checks',
                input: {
                  ...input,
                  integrationCommit: output.integrationCommit,
                  integrationBranch: output.integrationBranch,
                  integrationWorktree: output.integrationWorktree,
                  mergeActionId: event.outcome.actionId,
                },
              },
            ],
          };
        }
        if (
          event.kind === 'action-outcome' &&
          event.stepId === 'supervisor.child.integration-checks'
        ) {
          if (event.outcome.status !== 'succeeded') {
            const action = run.actions.find((candidate) => candidate.id === event.outcome.actionId);
            const input = (
              action?.input as { activation?: Record<string, RuntimeValue> } | undefined
            )?.activation;
            if (!input)
              throw new Error('Native SDK Supervisor failed integration check is missing');
            return {
              state: state as unknown as RuntimeValue,
              next: [
                {
                  stepId: 'supervisor.child.integration-repair',
                  input: { ...input, failedCheckActionId: event.outcome.actionId },
                },
              ],
            };
          }
          const checksAction = run.actions.find(
            (candidate) => candidate.id === event.outcome.actionId,
          );
          const checksInput = (
            checksAction?.input as { activation?: Record<string, RuntimeValue> } | undefined
          )?.activation;
          const checksOutput = event.outcome.output as { candidateId: string };
          if (
            !checksInput ||
            typeof checksInput.child !== 'string' ||
            typeof checksInput.candidateCommit !== 'string'
          ) {
            throw new Error('Native SDK Supervisor integration checks lack their child binding');
          }
          return {
            state: state as unknown as RuntimeValue,
            next: [
              {
                stepId: 'supervisor.child.archive',
                input: {
                  child: checksInput.child,
                  candidateCommit: checksInput.candidateCommit,
                  integrationCommit: checksOutput.candidateId,
                  checksActionId: event.outcome.actionId,
                  contractHash: state.children_contract_hash!,
                },
              },
            ],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'supervisor.child.archive') {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          const proposal = proposalFrom(run.outputs['shape.revalidate']?.value);
          const integration = run.outputs['supervisor.prepare']?.value as
            | {
                integrationBranch: string;
                integrationWorktree: string;
              }
            | undefined;
          if (!proposal.children || !state.children_contract_hash || !integration) {
            throw new Error('Native SDK Supervisor continuation lacks its confirmed plan');
          }
          const integrated = new Set(
            currentNativeSdkSupervisorActions(run)
              .filter(
                (action) =>
                  action.stepId === 'supervisor.child.integration-checks' &&
                  action.status === 'succeeded',
              )
              .map(
                (action) => (action.input as { activation: { child: string } }).activation.child,
              ),
          );
          const currentAction = run.actions.find((action) => action.id === event.outcome.actionId);
          if (!currentAction) throw new Error('Native SDK Supervisor archive Action missing');
          integrated.add(
            (currentAction.input as { activation: { child: string } }).activation.child,
          );
          const queuedVerifier = queuedSupervisorIntegration(run);
          if (queuedVerifier) {
            return {
              state: state as unknown as RuntimeValue,
              next: [
                {
                  stepId: 'supervisor.child.integrate',
                  input: supervisorIntegrationActivation(
                    queuedVerifier,
                    queuedVerifier.outcome?.output,
                  ),
                },
              ],
            };
          }
          const active = new Set(
            currentNativeSdkSupervisorActions(run)
              .filter((action) => action.stepId === 'supervisor.child.prepare')
              .map((action) => (action.input as { activation: { child: string } }).activation.child)
              .filter((child) => !integrated.has(child)),
          );
          const ready = selectNativeSdkReadyChildren({
            contract: proposal.children.contract,
            integrated: [...integrated],
            active: [...active],
            maxParallel: state.coordination_mode === 'single-session' ? 1 : 2,
          });
          const output = event.outcome.output as { integrationCommit: string };
          if (integrated.size === proposal.children.contract.children.length) {
            return {
              state: state as unknown as RuntimeValue,
              next: [
                {
                  stepId: 'supervisor.parent.builder',
                  input: {
                    contractHash: state.children_contract_hash,
                    integrationBranch: integration.integrationBranch,
                    integrationWorktree: integration.integrationWorktree,
                    integrationCommit: output.integrationCommit,
                    acceptance: state.acceptance.map(({ id, source, text }) => ({
                      id,
                      source,
                      text,
                    })),
                  },
                },
              ],
            };
          }
          return {
            state: state as unknown as RuntimeValue,
            next: ready.map((child) => ({
              stepId: 'supervisor.child.prepare',
              input: {
                child,
                contractHash: state.children_contract_hash!,
                integrationBranch: integration.integrationBranch,
                integrationWorktree: integration.integrationWorktree,
                targetCommit: output.integrationCommit,
              },
            })),
          };
        }
        if (
          event.kind === 'action-outcome' &&
          event.stepId === 'supervisor.child.integration-repair'
        ) {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          const action = run.actions.find((candidate) => candidate.id === event.outcome.actionId);
          const input = (action?.input as { activation?: Record<string, RuntimeValue> } | undefined)
            ?.activation;
          const output = event.outcome.output as {
            integrationCommit: string;
            integrationChecks: RuntimeValue;
          };
          if (!input) throw new Error('Native SDK Supervisor integration repair is missing');
          return {
            state: state as unknown as RuntimeValue,
            next: [
              {
                stepId: 'supervisor.child.integration-checks',
                input: {
                  ...input,
                  integrationCommit: output.integrationCommit,
                  integrationChecks: output.integrationChecks,
                  repairActionId: event.outcome.actionId,
                },
              },
            ],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'build.builder') {
          if (event.outcome.status === 'failed') {
            return {
              state: state as unknown as RuntimeValue,
              next: [
                {
                  stepId: 'build.resume',
                  input: { failedBuilderActionId: event.outcome.actionId },
                },
              ],
            };
          }
          const action = run.actions.find((candidate) => candidate.id === event.outcome.actionId);
          if (!action) throw new Error('Native Builder Action is missing from its Run');
          const candidate = builderCandidateState(run, action, event.outcome);
          return { state: candidate as unknown as RuntimeValue, next: ['verify.checks'] };
        }
        if (event.kind === 'wait-resolved' && event.stepId === 'build.resume') {
          const wait = run.waits.find(
            (candidate) =>
              candidate.stepId === 'build.resume' &&
              candidate.decision?.id === event.decisionId &&
              candidate.proposalHash === event.proposalHash,
          );
          const activation = (
            wait?.proposal as { activation?: { failedBuilderActionId?: unknown } }
          )?.activation;
          const failedBuilderActionId = activation?.failedBuilderActionId;
          if (
            typeof failedBuilderActionId !== 'string' ||
            !run.actions.some(
              (action) =>
                action.id === failedBuilderActionId &&
                action.stepId === 'build.builder' &&
                action.status === 'failed',
            )
          ) {
            throw new Error('Native SDK Builder continuation lacks its failed Action');
          }
          return {
            state: state as unknown as RuntimeValue,
            next: [{ stepId: 'build.builder', input: { failedBuilderActionId } }],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'supervisor.parent.builder') {
          if (event.outcome.status === 'failed') {
            const action = run.actions.find((candidate) => candidate.id === event.outcome.actionId);
            const activation = (action?.input as { activation?: Record<string, RuntimeValue> })
              ?.activation;
            if (!activation || !action) {
              throw new Error('Native SDK Supervisor parent Builder failure lacks its Action');
            }
            return {
              state: state as unknown as RuntimeValue,
              next: [
                {
                  stepId: 'supervisor.parent.resume',
                  input: { ...activation, failedBuilderActionId: action.id },
                },
              ],
            };
          }
          const action = run.actions.find((candidate) => candidate.id === event.outcome.actionId);
          if (!action) throw new Error('Native Supervisor parent Builder Action is missing');
          const candidate = builderCandidateState(run, action, event.outcome);
          return { state: candidate as unknown as RuntimeValue, next: ['verify.checks'] };
        }
        if (event.kind === 'wait-resolved' && event.stepId === 'supervisor.parent.resume') {
          const wait = run.waits.find(
            (candidate) =>
              candidate.stepId === 'supervisor.parent.resume' &&
              candidate.decision?.id === event.decisionId &&
              candidate.proposalHash === event.proposalHash,
          );
          const activation = (
            wait?.proposal as {
              activation?: Record<string, RuntimeValue> & { failedBuilderActionId?: string };
            }
          )?.activation;
          if (
            !activation ||
            typeof activation.failedBuilderActionId !== 'string' ||
            !run.actions.some(
              (action) =>
                action.id === activation.failedBuilderActionId &&
                action.stepId === 'supervisor.parent.builder' &&
                action.status === 'failed',
            )
          ) {
            throw new Error('Native SDK Supervisor parent continuation lacks its failed Action');
          }
          return {
            state: state as unknown as RuntimeValue,
            next: [{ stepId: 'supervisor.parent.builder', input: activation }],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'verify.checks') {
          if (event.outcome.status === 'failed') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          const reserved = reserveNativeVerifierAttempt(state);
          return { state: reserved as unknown as RuntimeValue, next: ['verify.verifier'] };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'verify.verifier') {
          const action = run.actions.find((candidate) => candidate.id === event.outcome.actionId);
          if (!action) throw new Error('Native Verifier Action is missing from its Run');
          if (event.outcome.status === 'failed') {
            const failed = verifierExecutionFailureState(run, action, event.outcome);
            if (failed.status === 'blocked') {
              return { state: failed as unknown as RuntimeValue, next: ['verify.retry'] };
            }
            const reserved = reserveNativeVerifierAttempt(failed);
            return { state: reserved as unknown as RuntimeValue, next: ['verify.verifier'] };
          }
          const verified = verifierResultState(run, action, event.outcome);
          return {
            state: verified.state as unknown as RuntimeValue,
            next: verified.requestChecks
              ? ['verify.requested-checks']
              : verified.state.verification_result === 'pass'
                ? ['verify.report']
                : verified.state.phase === 'build'
                  ? state.children_contract_hash
                    ? [
                        {
                          stepId: 'supervisor.parent.builder',
                          input: supervisorParentRepairActivation(run, {
                            failedVerifierActionId: action.id,
                          }),
                        },
                      ]
                    : ['build.builder']
                  : ['verify.stop'],
          };
        }
        if (event.kind === 'wait-resolved' && event.stepId === 'verify.stop') {
          if (
            event.choice !== 'repair' ||
            state.phase !== 'verify' ||
            state.status !== 'await-user' ||
            state.loop.next_action !== 'await-user'
          ) {
            throw new Error('Native Verify stop decision does not match the current Run');
          }
          const returned = returnNativeCandidateToBuild({
            state,
            reason: 'The user chose to revise the implementation after Verify stopped.',
          });
          const failedVerifier = [...run.actions]
            .reverse()
            .find((action) => action.stepId === 'verify.verifier' && action.status === 'succeeded');
          if (!failedVerifier) throw new Error('Native Verify stop has no Verifier result');
          return {
            state: returned as unknown as RuntimeValue,
            next: state.children_contract_hash
              ? [
                  {
                    stepId: 'supervisor.parent.builder',
                    input: supervisorParentRepairActivation(run, {
                      failedVerifierActionId: failedVerifier.id,
                    }),
                  },
                ]
              : ['build.builder'],
          };
        }
        if (event.kind === 'wait-resolved' && event.stepId === 'verify.retry') {
          const reserved = reserveNativeVerifierAttempt(retryNativeVerifier(state));
          return { state: reserved as unknown as RuntimeValue, next: ['verify.verifier'] };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'verify.requested-checks') {
          return { state: state as unknown as RuntimeValue, next: ['verify.verifier'] };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'verify.report') {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          return { state: state as unknown as RuntimeValue, next: ['verify.confirm'] };
        }
        if (event.kind === 'wait-resolved' && event.stepId === 'verify.confirm') {
          if (event.choice === 'approved') {
            return { state: state as unknown as RuntimeValue, next: ['verify.revalidate'] };
          }
          const returned = returnNativeCandidateToBuild({
            state,
            reason: 'The user rejected the Skill-coordinated Verifier pass.',
          });
          return {
            state: returned as unknown as RuntimeValue,
            next: state.children_contract_hash
              ? [
                  {
                    stepId: 'supervisor.parent.builder',
                    input: supervisorParentRepairActivation(run, {
                      rejectedDecisionId: event.decisionId,
                    }),
                  },
                ]
              : ['build.builder'],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'verify.revalidate') {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: ['verify.report'] };
          }
          const confirmed = confirmNativeSkillCoordinatedPass(state);
          if (confirmed.children_contract_hash) {
            const parentBuilder = [...run.actions]
              .reverse()
              .find(
                (action) =>
                  action.stepId === 'supervisor.parent.builder' && action.status === 'succeeded',
              );
            const activation = (
              parentBuilder?.input as { activation?: Record<string, RuntimeValue> } | undefined
            )?.activation;
            if (!activation || !parentBuilder) {
              throw new Error('Native Supervisor delivery lacks its parent integration candidate');
            }
            return {
              state: confirmed as unknown as RuntimeValue,
              next: [
                {
                  stepId: 'supervisor.parent.deliver',
                  input: {
                    ...activation,
                    integrationCommit: nativeSdkSupervisorParentCandidateCommit(parentBuilder),
                    candidateId: confirmed.builder_handoff?.candidate_id ?? null,
                  },
                },
              ],
            };
          }
          return { state: confirmed as unknown as RuntimeValue, next: ['archive.prepare'] };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'supervisor.parent.deliver') {
          return {
            state: state as unknown as RuntimeValue,
            next: event.outcome.status === 'succeeded' ? ['archive.prepare'] : [],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'archive.prepare') {
          return {
            state: state as unknown as RuntimeValue,
            next: event.outcome.status === 'succeeded' ? ['archive.execute'] : [],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'archive.execute') {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          const applied = parseNativePortableState({
            ...state,
            status: 'done',
            archived: true,
            state_version: state.state_version + 1,
            blockers: [],
            loop: { ...state.loop, stage: 'done', next_action: null },
          });
          return { state: applied as unknown as RuntimeValue, next: ['archive.finalize'] };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'archive.finalize') {
          return {
            state: state as unknown as RuntimeValue,
            next:
              event.outcome.status === 'succeeded' && state.children_contract_hash
                ? ['supervisor.cleanup']
                : [],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'supervisor.cleanup') {
          return { state: state as unknown as RuntimeValue, next: [] };
        }
        throw new Error(`Native SDK does not handle ${event.stepId} yet`);
      },
    },
    validators: [
      nativeSdkReviseValidator,
      nativeSdkRemoveValidator,
      nativeSdkDisassociateValidator,
      shapeValidator,
      builderValidator,
      nativeSdkCheckValidator,
      verifierValidator,
      nativeSdkReportValidator,
      nativeSdkReportRevalidationValidator,
      nativeSdkArchivePreflightValidator,
      nativeSdkArchiveApplyValidator,
      nativeSdkArchiveFinalizeValidator,
      nativeSdkSupervisorPrepareValidator,
      nativeSdkSupervisorChildPrepareValidator,
      nativeSdkSupervisorBuilderValidator,
      nativeSdkSupervisorVerifierValidator,
      nativeSdkSupervisorIntegrateValidator,
      nativeSdkSupervisorIntegrationRepairValidator,
      supervisorParentBuilderValidator,
      nativeSdkSupervisorDeliverValidator,
      nativeSdkSupervisorCleanupValidator,
      nativeSdkSupervisorChildArchiveValidator,
    ],
    stateValidators: [nativeStateValidator],
    validateRecovery: validateNativeSdkSupervisorRecovery,
    commandValidators: [
      nativeSdkReviseCommandValidator,
      nativeSdkRemoveCommandValidator,
      nativeSdkDisassociateCommandValidator,
    ],
    executors: [
      nativeSdkReviseExecutor,
      nativeSdkRemoveExecutor,
      nativeSdkDisassociateExecutor,
      nativeSdkCheckExecutor,
      nativeSdkReportExecutor,
      nativeSdkReportRevalidationExecutor,
      nativeSdkArchivePreflightExecutor,
      nativeSdkArchiveApplyExecutor,
      nativeSdkArchiveFinalizeExecutor,
      nativeSdkSupervisorPrepareExecutor,
      nativeSdkSupervisorChildPrepareExecutor,
      nativeSdkSupervisorIntegrateExecutor,
      nativeSdkSupervisorDeliverExecutor,
      nativeSdkSupervisorChildArchiveExecutor,
      nativeSdkSupervisorCleanupExecutor,
    ],
  };
}
