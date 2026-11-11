import path from 'node:path';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { nativeSupervisorContractRef } from './native-children-contract.js';
import { nativeProjectPaths } from './native-paths.js';
import { nativePortableStateFile } from './native-portable-storage.js';
import { nativeSdkVerifyWaitDecisions } from './native-sdk-verify-decision.js';
import { inspectGitWorktree, resolveGitRef, samePath } from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';
import {
  hashRuntimeValue,
  type CreateRuntimeOptions,
  type DefineWorkflowOptions,
  type RuntimeAction,
  type RuntimeCommandValidator,
  type RuntimeExecutor,
  type RuntimeOutcome,
  type RuntimeStateValidator,
  type RuntimeValidator,
  type RuntimeValue,
  type WorkflowRun,
  type WorkflowTransitionHandler,
} from '../engine/runtime.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import {
  DEFAULT_WORKFLOW_NATIVE_MAX_VERIFY_FAILURES,
  normalizeWorkflowRelativePath,
} from '../workflow-contract/project-config.js';
import {
  readNativeChildrenContract,
  type NativeChildrenContract,
} from './native-children-contract.js';
import { nativeChildrenAcceptanceValidation } from './native-children.js';
import { readProjectConfig } from './native-config.js';
import {
  applyNativeVerifierEnvelope,
  confirmNativePortableAcceptance,
  confirmNativeSkillCoordinatedPass,
  prepareNativePortableShapeConfirmation,
  recordNativeVerifierExecutionError,
  reserveNativeVerifierAttempt,
  resolveNativeVerifierBlocker,
  retryNativeVerifier,
  returnNativeCandidateToBuild,
  submitNativeBuilderCandidate,
} from './native-loop-runtime.js';
import { withNativeMutation } from './native-mutation.js';
import type { NativePortableAcceptanceInput } from './native-portable-acceptance.js';
import {
  assertNativePortableDocuments,
  discoverNativePortableSpecChanges,
  readNativePortableAcceptance,
} from './native-portable-requirements.js';
import {
  appendNativePortableHistory,
  parseNativePortableState,
  parseNativeReportedChecks,
} from './native-portable-state.js';
import { toNativePortableText } from './native-portable-text.js';
import type {
  NativePortableAcceptanceState,
  NativePortableSpecChange,
  NativePortableState,
  NativeSupervisorCoordinationMode,
} from './native-portable-types.js';
import { emptyNativePortableHistoryOverflow } from './native-portable-types.js';
import { createNativeRunnerChannel, NATIVE_SKILL_COORDINATION } from './native-runner-protocol.js';
import {
  nativeSdkArchiveApplyExecutor,
  nativeSdkArchiveApplyValidator,
  nativeSdkArchiveFinalizeExecutor,
  nativeSdkArchiveFinalizeValidator,
  nativeSdkArchivePreflightExecutor,
  nativeSdkArchivePreflightValidator,
} from './native-sdk-archive.js';
import { nativeSdkMatchesRun } from './native-sdk-definition.js';
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
import { nativeSdkVerificationReportMetadata } from './native-sdk-report.js';
import { nativeSdkRequiresIndependentReview } from './native-sdk-review.js';
import {
  nativeSdkImplementationRevisionCommandValidator,
  nativeSdkImplementationRevisionExecutor,
  nativeSdkImplementationRevisionValidator,
  nativeSdkReviseCommandValidator,
  nativeSdkReviseExecutor,
  nativeSdkReviseValidator,
} from './native-sdk-revise.js';
import {
  nativeSdkSupervisorChildArchiveExecutor,
  nativeSdkSupervisorChildArchiveValidator,
} from './native-sdk-supervisor-archive.js';
import {
  nativeSdkSupervisorBuilderValidator,
  nativeSdkSupervisorVerifierValidator,
} from './native-sdk-supervisor-child.js';
import {
  nativeSdkSupervisorCleanupExecutor,
  nativeSdkSupervisorCleanupValidator,
} from './native-sdk-supervisor-cleanup.js';
import {
  nativeSdkSupervisorDeliverExecutor,
  nativeSdkSupervisorDeliverValidator,
} from './native-sdk-supervisor-deliver.js';
import {
  nativeSdkSupervisorIntegrateExecutor,
  nativeSdkSupervisorIntegrateValidator,
  nativeSdkSupervisorIntegrationRepairValidator,
} from './native-sdk-supervisor-integrate.js';
import { nativeSdkSupervisorParentCandidateCommit } from './native-sdk-supervisor-parent.js';
import {
  currentNativeSdkSupervisorActions,
  selectNativeSdkReadyChildren,
} from './native-sdk-supervisor-plan.js';
import {
  currentNativeSdkSupervisorContract,
  nativeSdkSupervisorChildPrepareExecutor,
  nativeSdkSupervisorChildPrepareValidator,
  nativeSdkSupervisorPrepareExecutor,
  nativeSdkSupervisorPrepareValidator,
} from './native-sdk-supervisor-prepare.js';
import {
  nativeSdkFailedChildVerifierActivation,
  nativeSdkLegacyChildFailureForWait,
} from './native-sdk-supervisor-verifier-recovery.js';
import { materializeNativeDeltaTargetsLocked } from './native-shape-materialization.js';
import { supervisorAcceptanceScope } from './native-supervisor-model.js';
import {
  nativeSupervisorIntegrationBranch,
  nativeSupervisorIntegrationWorktree,
} from './native-supervisor-workspace.js';
import { nativeBuilderRepairContext } from './native-task-context.js';
import type { NativeProjectPaths } from './native-types.js';
/** 数据升级在加载边界完成；这里只选择当前平台执行协议。 */
export function nativeSdkApplicationForRun(
  run: Pick<WorkflowRun, 'workflow'> | null,
  application = defineNativeWorkflowApplication(),
) {
  if (run && (run.workflow.version !== '4' || !nativeSdkMatchesRun(application.workflow, run)))
    throw new Error(
      'Native Run 尚未完成业务数据适配，请通过原 change 的当前入口继续；原记录与批准保留。',
    );
  return application;
}
interface NativeShapeProposal {
  specChanges: NativePortableSpecChange[];
  acceptance: Array<Pick<NativePortableAcceptanceState, 'id' | 'source' | 'text'>>;
  children: {
    contract: NativeChildrenContract;
  } | null;
}
export interface NativeWorkflowApplication {
  workflow: DefineWorkflowOptions;
  transitionHandler: WorkflowTransitionHandler;
  validators: readonly RuntimeValidator[];
  stateValidators: readonly RuntimeStateValidator[];
  executors: readonly RuntimeExecutor[];
  commandValidators: readonly RuntimeCommandValidator[];
  validateRecovery?: CreateRuntimeOptions['validateRecovery'];
}
export async function assertNativeSdkStartAvailable(options: {
  projectRoot: string;
  name: string;
  artifactRootRef: string;
}): Promise<void> {
  const paths = await nativeProjectPaths(options.projectRoot, options.artifactRootRef, {
    change: options.name,
  });
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
  const paths = await nativeProjectPaths(options.projectRoot, options.artifactRootRef, {
    change: options.name,
  });
  await withNativeMutation(paths, async () => {
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
function nativeSdkShapeConstraintsVersion(state: NativePortableState): 1 | 2 | 3 {
  // Upgrade only a fresh proposal; pending approvals retain their original document contract.
  return state.phase === 'shape' &&
    state.status === 'active' &&
    state.loop.next_action === 'prepare-shape-confirmation'
    ? 3
    : (state.document_constraints_version ?? 2);
}
/** Reads formal Shape artifacts; only an explicit preparation may generate derived targets. */
export async function collectNativeSdkShapeProposal(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  materializeTargets?: boolean;
  acceptance?: readonly NativePortableAcceptanceInput[];
}): Promise<NativeShapeProposal> {
  const state = parseNativePortableState({
    ...options.state,
    document_constraints_version: nativeSdkShapeConstraintsVersion(options.state),
  });
  if (state.phase !== 'shape' || !['active', 'await-user'].includes(state.status)) {
    throw new Error('Native Shape proposal requires an active or pending Shape');
  }
  const changeDir = path.join(options.paths.changesDir, state.name);
  const specChanges = await discoverNativePortableSpecChanges({ paths: options.paths, state });
  if (
    options.materializeTargets === true &&
    state.status === 'active' &&
    state.shape_confirmation_hash === undefined &&
    specChanges.some((spec) => spec.delta_source)
  )
    await withNativeMutation(options.paths, () =>
      materializeNativeDeltaTargetsLocked({ paths: options.paths, state, specChanges }),
    );
  // 新提案只约束本次声明；待确认提案和批准后的重新校验仍绑定原集合。
  const preparing =
    state.status === 'active' &&
    state.loop.next_action === 'prepare-shape-confirmation' &&
    state.shape_confirmation_hash === undefined;
  await assertNativePortableDocuments({
    paths: options.paths,
    state: preparing ? { ...state, spec_changes: specChanges } : state,
    specChanges,
  });
  const acceptance =
    options.acceptance === undefined
      ? (
          await readNativePortableAcceptance({
            paths: options.paths,
            state,
            specChanges,
          })
        ).acceptance
      : options.acceptance.map((entry, index) => {
          const sources = [
            'brief.md',
            ...specChanges.flatMap((spec) => (spec.source ? [spec.source] : [])),
          ];
          if (
            !entry ||
            typeof entry.source !== 'string' ||
            typeof entry.text !== 'string' ||
            !entry.text.trim()
          )
            throw new Error(
              'Native acceptance requires a readable source reference and nonempty text',
            );
          const source = normalizeWorkflowRelativePath(entry.source, 'Native acceptance source');
          if (!sources.includes(source))
            throw new Error(
              'Native acceptance must reference this change brief or a declared specification',
            );
          return { id: `A${index + 1}`, source, text: entry.text.trim() };
        });
  if (!acceptance.length)
    throw new Error('Native Shape requires at least one acceptance criterion');
  const children = await readNativeChildrenContract({
    changeDir,
    acceptanceIds: acceptance.map(({ id }) => id),
    validation: nativeChildrenAcceptanceValidation({ ...state, acceptance }),
  });
  return {
    specChanges,
    acceptance: acceptance.map(({ id, source, text }) => ({ id, source, text })),
    children: children ? { contract: children.contract } : null,
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
  delete next.children_contract_ref;
  delete next.children_contract;
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
  delete next.children_contract_ref;
  delete next.children_contract;
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
  delete next.children_contract_ref;
  delete next.children_contract;
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
  agentChecks = false,
): Record<string, RuntimeValue> {
  const input = (
    action.input as {
      activation?: Record<string, RuntimeValue>;
    }
  ).activation;
  const result = output as {
    integrationChecks?: RuntimeValue;
  } | null;
  if (!input || !action.claim?.sessionId || (!agentChecks && !result?.integrationChecks)) {
    throw new Error('Native SDK Supervisor Verifier lacks its Child activation');
  }
  return {
    ...input,
    verifierActionId: action.id,
    verifierSessionId: action.claim.sessionId,
    ...(agentChecks ? {} : { integrationChecks: result!.integrationChecks! }),
  };
}
function queuedSupervisorIntegration(run: Readonly<WorkflowRun>): RuntimeAction | null {
  const actions = currentNativeSdkSupervisorActions(run);
  const dispatched = new Set(
    actions
      .filter((action) => action.stepId === 'supervisor.child.integrate')
      .map(
        (action) =>
          (
            action.input as {
              activation?: {
                child?: string;
              };
            }
          ).activation?.child,
      ),
  );
  return (
    actions.find(
      (action) =>
        action.stepId === 'supervisor.child.verifier' &&
        action.status === 'succeeded' &&
        (
          action.outcome?.output as {
            verdict?: unknown;
          } | null
        )?.verdict === 'pass' &&
        !dispatched.has(
          (
            action.input as {
              activation?: {
                child?: string;
              };
            }
          ).activation?.child,
        ),
    ) ?? null
  );
}
function supervisorChildRepairActivation(
  run: Readonly<WorkflowRun>,
  source: Readonly<RuntimeAction>,
  failureKey: 'failedCheckActionId' | 'failedVerifierActionId',
): Record<string, RuntimeValue> {
  const verified = (
    source.input as {
      activation?: Record<string, RuntimeValue>;
    }
  ).activation;
  const builder = currentNativeSdkSupervisorActions(run).find(
    (action) =>
      action.stepId === 'supervisor.child.builder' &&
      action.status === 'succeeded' &&
      action.claim?.sessionId === verified?.builderSessionId &&
      (
        action.outcome?.output as {
          candidateCommit?: unknown;
        } | null
      )?.candidateCommit === verified?.candidateCommit,
  );
  const input = (
    builder?.input as
      | {
          activation?: Record<string, RuntimeValue>;
        }
      | undefined
  )?.activation;
  if (!input || input.child !== verified?.child) {
    throw new Error('Native SDK Supervisor repair lacks the failed Child Builder');
  }
  return { ...input, [failureKey]: source.id };
}
function supervisorParentRepairActivation(
  run: Readonly<WorkflowRun>,
  failure:
    | {
        failedVerifierActionId: string;
      }
    | {
        failedCheckActionId: string;
      }
    | {
        rejectedDecisionId: string;
      },
): Record<string, RuntimeValue> {
  const builder = [...currentNativeSdkSupervisorActions(run)]
    .reverse()
    .find(
      (action) => action.stepId === 'supervisor.parent.builder' && action.status === 'succeeded',
    );
  const activation = (
    builder?.input as
      | {
          activation?: Record<string, RuntimeValue>;
        }
      | undefined
  )?.activation;
  if (!builder || !activation) {
    throw new Error('Native Supervisor parent repair lacks the prior integration candidate');
  }
  return {
    ...activation,
    integrationCommit: nativeSdkSupervisorParentCandidateCommit(builder),
    ...failure,
  };
}
function builderCandidateState(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  outcome: Readonly<RuntimeOutcome>,
): NativePortableState {
  const output = outcome.output as Record<string, unknown> | null;
  const sessionId = action.claim?.sessionId;
  if (
    ['3', '4'].includes(run.workflow.version) &&
    output?.requireIndependentReview !== undefined &&
    typeof output.requireIndependentReview !== 'boolean'
  ) {
    throw new Error('requireIndependentReview must be a boolean');
  }
  const state = parseNativePortableState(run.state);
  if (
    state.phase !== 'build' ||
    !['build.builder', 'supervisor.parent.builder'].includes(action.stepId) ||
    action.type !== 'handoff' ||
    !sessionId ||
    !output ||
    typeof output.summary !== 'string' ||
    !output.summary.trim() ||
    (output.addressedAcceptanceIds !== undefined &&
      (!Array.isArray(output.addressedAcceptanceIds) ||
        output.addressedAcceptanceIds.some((id) => typeof id !== 'string'))) ||
    !Array.isArray(output.checks) ||
    !Array.isArray(output.knownLimits) ||
    output.knownLimits.some((limit) => typeof limit !== 'string')
  ) {
    throw new Error('Native Builder result needs a claimed host session and a complete candidate');
  }
  const checks = output.checks as NonNullable<
    Parameters<typeof submitNativeBuilderCandidate>[0]['input']['checks']
  >;
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
    requireAcceptanceReview: !['3', '4'].includes(run.workflow.version),
    input: {
      identity,
      summary: output.summary,
      addressedAcceptanceIds: (output.addressedAcceptanceIds ?? []) as string[],
      acceptanceReview:
        output.acceptanceReview === undefined
          ? undefined
          : (output.acceptanceReview as NonNullable<
              Parameters<typeof submitNativeBuilderCandidate>[0]['input']['acceptanceReview']
            >),
      checks,
      knownLimits: output.knownLimits as string[],
      review: review
        ? {
            status: 'passed',
            summary: review.summary as string,
            reviewerExecutionRef: review.reviewerExecutionRef as string,
          }
        : null,
      candidateId: action.id,
      // 兼容旧请求中的有效时间；新请求由 Runtime 记录，无需 Agent 填写。
      now:
        typeof output.submittedAt === 'string' && !Number.isNaN(Date.parse(output.submittedAt))
          ? new Date(output.submittedAt)
          : new Date(),
    },
  });
}
function verifierResultState(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  outcome: Readonly<RuntimeOutcome>,
): {
  state: NativePortableState;
} {
  const output = outcome.output as Record<string, unknown> | null;
  const sessionId = action.claim?.sessionId;
  const state = parseNativePortableState(run.state);
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
    (nativeSdkRequiresIndependentReview(run, action) &&
      sessionId === candidate.builder_execution_ref) ||
    !output ||
    output.candidateId !== candidate.candidate_id ||
    output.verifierExecutionRef !== sessionId
  ) {
    throw new Error(
      `Native Verifier result is not bound to an independent current execution; candidateId must match the current candidate and verifierExecutionRef must equal the claimed sessionId ${sessionId ?? '(missing)'}; use the current outcomeRequest template`,
    );
  }
  const input = run.input as {
    maxVerifyFailures?: unknown;
  };
  const maxVerifyFailures = input.maxVerifyFailures ?? DEFAULT_WORKFLOW_NATIVE_MAX_VERIFY_FAILURES;
  if (!Number.isSafeInteger(maxVerifyFailures) || (maxVerifyFailures as number) < 1)
    throw new Error('Native Verify failure budget is invalid');
  const channel = createNativeRunnerChannel();
  const identity = channel.captureExecutionIdentity({
    identityProvider: NATIVE_SKILL_COORDINATION,
    executionRef: sessionId,
  });
  const applied = applyNativeVerifierEnvelope({
    state,
    requireIndependentSession: false,
    envelope: channel.envelopeVerifierResponse({
      candidateId: candidate.candidate_id,
      identity,
      payload: output.response,
    }),
    reportedChecks: parseNativeReportedChecks(output.checks ?? []),
    maxVerifyFailures: maxVerifyFailures as number,
  });
  if (
    typeof (
      run.input as {
        task?: unknown;
      }
    ).task === 'string' &&
    applied.response.result.verdict === 'pass' &&
    applied.response.result.requestReview?.result !== 'aligned'
  )
    throw new Error(
      'Native pass requires requestReview aligned with the original task and authorized changes; report fail or blocked for conflicts or unresolved requirements',
    );
  return { state: applied.state };
}
/** 失败收据结束原领取，不产生验收结论；后继 Verifier 仍须独立。 */
function verifierExecutionFailureState(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  outcome: Readonly<RuntimeOutcome>,
): NativePortableState {
  const output = outcome.output as {
    summary?: unknown;
  } | null;
  if (
    outcome.status !== 'failed' ||
    action.stepId !== 'verify.verifier' ||
    action.type !== 'handoff' ||
    !action.claim?.sessionId ||
    !output ||
    typeof output.summary !== 'string' ||
    !output.summary.trim()
  ) {
    throw new Error(
      'Native Verifier execution failure needs the original claimed session and summary',
    );
  }
  const state = parseNativePortableState(run.state);
  return recordNativeVerifierExecutionError({ state, summary: output.summary });
}
const shapeValidator: RuntimeValidator = {
  id: 'comet-native-shape-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (outcome.status === 'failed') return { accepted: true };
    const input = run.input as {
      name?: unknown;
      artifactRootRef?: unknown;
    };
    if (
      !context?.projectRoot ||
      typeof input.name !== 'string' ||
      typeof input.artifactRootRef !== 'string' ||
      !['shape.prepare', 'shape.revalidate'].includes(action.stepId)
    )
      return { accepted: false, reason: 'Native Shape lacks its project and Action' };
    try {
      const proposal = proposalFrom(outcome.output);
      const state = parseNativePortableState(run.state);
      if (
        state.name !== input.name ||
        !Array.isArray(proposal.acceptance) ||
        proposal.acceptance.length === 0 ||
        !Array.isArray(proposal.specChanges)
      )
        throw new Error('Native Shape requires its change, specifications and acceptance criteria');
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: String(error) };
    }
  },
};
const builderValidator: RuntimeValidator = {
  id: 'comet-native-builder-outcome',
  version: '1',
  async validate({ run, outcome, context }) {
    if (outcome.status === 'failed') return { accepted: true };
    const input = run.input as {
      name?: unknown;
      artifactRootRef?: unknown;
    };
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
      const output = outcome.output as Record<string, unknown> | null;
      if (
        ['3', '4'].includes(run.workflow.version) &&
        output?.requireIndependentReview !== undefined &&
        typeof output.requireIndependentReview !== 'boolean'
      )
        throw new Error('requireIndependentReview must be a boolean');
      {
        if (output?.response || output?.verificationChecks !== undefined)
          throw new Error(
            'Run checks with platform tools and submit checks reports, not Runtime check plans.',
          );
        return { accepted: true };
      }
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
      const plan = await currentNativeSdkSupervisorContract(run, context.projectRoot);
      const input = (
        action.input as {
          activation?: Record<string, unknown>;
        }
      ).activation;
      const state = plan.state;
      const worktree = nativeSupervisorIntegrationWorktree(context.projectRoot, state.name);
      const branch = nativeSupervisorIntegrationBranch(state.name);
      const candidateCommit = nativeSdkSupervisorParentCandidateCommit(action, outcome);
      const integrated = new Set(
        currentNativeSdkSupervisorActions(run)
          .filter(
            (candidate) =>
              candidate.stepId === 'supervisor.child.archive' && candidate.status === 'succeeded',
          )
          .map(
            (candidate) =>
              (
                candidate.input as {
                  activation: {
                    child: string;
                  };
                }
              ).activation.child,
          ),
      );
      if (
        state.phase !== 'build' ||
        !input ||
        nativeSupervisorContractRef(input, run) !== state.children_contract_ref ||
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
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
const verifierValidator: RuntimeValidator = {
  id: 'comet-native-verifier-outcome',
  version: '1',
  async validate({ run, outcome, context }) {
    const input = run.input as {
      artifactRootRef?: unknown;
      maxVerifyFailures?: unknown;
    };
    if (!context?.projectRoot || typeof input.artifactRootRef !== 'string') {
      return { accepted: false, reason: 'Native Verifier result lacks its project binding' };
    }
    try {
      if (outcome.status === 'failed') {
        return { accepted: true };
      }
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
      const requested =
        (
          outcome.output as {
            response?: {
              kind?: unknown;
            };
          } | null
        )?.response?.kind === 'request-checks';
      if (requested)
        throw new Error('Run additional checks with platform tools and report the final result.');
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
export function defineNativeWorkflowApplication(
  version: '1' | '2' | '3' | '4' = '4',
): NativeWorkflowApplication {
  if (version !== '4')
    throw new Error('旧 Native 受管检查定义不再支持；普通检查请使用 Agent 平台工具。');
  return createNativeWorkflowApplication();
}
function confirmSdkShape(run: WorkflowRun, state: NativePortableState) {
  const shape = [...run.actions]
    .reverse()
    .find((action) => action.stepId === 'shape.prepare' && action.status === 'succeeded')!;
  const proposal = proposalFrom(shape.outcome!.output);
  const confirmed = confirmNativePortableAcceptance({
    state,
    acceptance: state.acceptance.map(({ id, source, text }) => ({ id, source, text })),
  });
  return proposal.children
    ? {
        state: parseNativePortableState({
          ...confirmed,
          children_contract_ref: shape.id,
          children_contract: proposal.children.contract,
        }) as unknown as RuntimeValue,
        next: ['supervisor.prepare'],
      }
    : { state: confirmed as unknown as RuntimeValue, next: ['build.builder'] };
}
function acceptedSdkResult(run: WorkflowRun, state: NativePortableState) {
  const confirmed = confirmNativeSkillCoordinatedPass(state);
  if (!confirmed.children_contract_ref)
    return { state: confirmed as unknown as RuntimeValue, next: ['archive.prepare'] };
  const parentBuilder = [...run.actions]
    .reverse()
    .find(
      (action) => action.stepId === 'supervisor.parent.builder' && action.status === 'succeeded',
    );
  const activation = (
    parentBuilder?.input as
      | {
          activation?: Record<string, RuntimeValue>;
        }
      | undefined
  )?.activation;
  if (!parentBuilder || !activation)
    throw new Error('Native Supervisor delivery lacks its parent integration candidate');
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
function createNativeWorkflowApplication(): NativeWorkflowApplication {
  const application: NativeWorkflowApplication = {
    workflow: {
      id: 'comet-native',
      version: '4',
      entry: 'shape.prepare',
      commands: {
        'revise-implementation': {
          stepId: 'repair.implementation',
          validator: {
            id: nativeSdkImplementationRevisionCommandValidator.id,
            version: nativeSdkImplementationRevisionCommandValidator.version,
          },
        },
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
        'repair.implementation': {
          type: 'call_tool',
          ref: 'native-revise-implementation',
          validator: {
            id: nativeSdkImplementationRevisionValidator.id,
            version: nativeSdkImplementationRevisionValidator.version,
          },
        },
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
        'supervisor.child.verifier': {
          type: 'handoff',
          ref: 'native-supervisor-verifier',
          validator: {
            id: nativeSdkSupervisorVerifierValidator.id,
            version: nativeSdkSupervisorVerifierValidator.version,
          },
        },
        'supervisor.child.verifier-retry': {
          type: 'ask_user',
          proposalFrom: 'supervisor.child.verifier',
          choices: ['retry', 'repair'],
        },
        'supervisor.child.integrate': {
          type: 'call_tool',
          ref: 'native-supervisor-integrate',
          validator: {
            id: nativeSdkSupervisorIntegrateValidator.id,
            version: nativeSdkSupervisorIntegrateValidator.version,
          },
        },
        'supervisor.child.integration-repair': {
          type: 'handoff',
          ref: 'native-supervisor-integration-repair',
          validator: {
            id: nativeSdkSupervisorIntegrationRepairValidator.id,
            version: nativeSdkSupervisorIntegrationRepairValidator.version,
          },
        },
        'supervisor.child.integration-resume': {
          type: 'ask_user',
          proposalFrom: 'supervisor.child.integration-repair',
          choices: ['continue'],
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
          choices: ['retry', 'repair'],
        },

        'verify.confirm': {
          type: 'ask_user',
          proposalFrom: 'verify.verifier',
          choices: ['approved', 'rejected', 'reverify'],
        },
        'archive.prepare': {
          type: 'call_tool',
          ref: 'native-archive-preflight',
          retry: 'idempotent',
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
        { from: 'repair.implementation', to: 'archive.prepare' },
        { from: 'repair.implementation', to: 'archive.execute' },
        { from: 'repair.implementation', to: 'shape.prepare' },
        { from: 'repair.implementation', to: 'build.builder' },
        { from: 'repair.implementation', to: 'supervisor.parent.builder' },
        { from: 'shape.revise', to: 'shape.prepare' },
        { from: 'shape.remove', to: 'shape.prepare' },
        { from: 'shape.disassociate', to: 'shape.prepare' },
        { from: 'shape.prepare', to: 'shape.confirm' },
        { from: 'shape.prepare', to: 'supervisor.shape.confirm' },
        { from: 'shape.confirm', to: 'shape.prepare', on: 'rejected' },
        { from: 'supervisor.shape.confirm', to: 'shape.prepare', on: 'rejected' },
        { from: 'supervisor.prepare', to: 'supervisor.child.prepare' },
        { from: 'supervisor.child.prepare', to: 'supervisor.child.builder' },
        { from: 'supervisor.child.builder', to: 'supervisor.child.resume', on: 'failed' },
        { from: 'supervisor.child.resume', to: 'supervisor.child.builder', on: 'continue' },
        { from: 'supervisor.child.verifier', to: 'supervisor.child.verifier-retry', on: 'failed' },
        { from: 'supervisor.child.verifier-retry', to: 'supervisor.child.verifier', on: 'retry' },
        { from: 'supervisor.child.verifier-retry', to: 'supervisor.child.builder', on: 'repair' },
        { from: 'supervisor.child.verifier', to: 'supervisor.child.integrate' },
        { from: 'supervisor.child.verifier', to: 'supervisor.child.builder' },
        { from: 'supervisor.child.archive', to: 'supervisor.child.integrate' },
        { from: 'supervisor.child.archive', to: 'supervisor.child.prepare' },
        { from: 'supervisor.child.archive', to: 'supervisor.parent.builder' },
        { from: 'supervisor.parent.builder', to: 'supervisor.parent.resume', on: 'failed' },
        { from: 'supervisor.parent.resume', to: 'supervisor.parent.builder', on: 'continue' },
        { from: 'build.builder', to: 'build.resume', on: 'failed' },
        { from: 'build.resume', to: 'build.builder', on: 'continue' },
        {
          from: 'verify.verifier',
          to: 'verify.confirm',
        },
        { from: 'verify.verifier', to: 'build.builder' },
        { from: 'verify.verifier', to: 'supervisor.parent.builder' },
        { from: 'verify.verifier', to: 'verify.verifier', on: 'failed' },
        { from: 'verify.verifier', to: 'verify.retry', on: 'failed' },
        { from: 'verify.retry', to: 'verify.verifier', on: 'retry' },
        { from: 'verify.verifier', to: 'verify.stop' },
        { from: 'verify.stop', to: 'verify.verifier', on: 'retry' },
        { from: 'verify.stop', to: 'build.builder', on: 'repair' },
        { from: 'verify.stop', to: 'supervisor.parent.builder', on: 'repair' },

        ...[{ from: 'verify.confirm', to: 'archive.prepare', on: 'approved' }],
        { from: 'verify.confirm', to: 'build.builder', on: 'rejected' },
        { from: 'verify.confirm', to: 'supervisor.parent.builder', on: 'rejected' },
        { from: 'supervisor.parent.deliver', to: 'archive.prepare' },
        { from: 'archive.prepare', to: 'archive.execute' },
        { from: 'archive.prepare', to: 'verify.stop', on: 'failed' },
        { from: 'archive.execute', to: 'verify.stop', on: 'failed' },
        { from: 'archive.execute', to: 'archive.finalize' },
        { from: 'archive.finalize', to: 'supervisor.cleanup' },
        { from: 'verify.confirm', to: 'verify.verifier', on: 'reverify' },
        { from: 'build.builder', to: 'verify.verifier' },
        { from: 'supervisor.parent.builder', to: 'verify.verifier' },
        { from: 'supervisor.child.builder', to: 'supervisor.child.verifier' },
        { from: 'supervisor.child.integrate', to: 'supervisor.child.archive' },
        {
          from: 'supervisor.child.verifier-retry',
          to: 'supervisor.child.integration-repair',
          on: 'repair',
        },
        { from: 'supervisor.child.integration-repair', to: 'supervisor.child.archive' },
        {
          from: 'supervisor.child.integration-repair',
          to: 'supervisor.child.integration-resume',
          on: 'failed',
        },
        {
          from: 'supervisor.child.integration-resume',
          to: 'supervisor.child.integration-repair',
          on: 'continue',
        },
        { from: 'shape.confirm', to: 'build.builder', on: 'approved' },
        { from: 'shape.confirm', to: 'supervisor.prepare', on: 'approved' },
        { from: 'supervisor.shape.confirm', to: 'supervisor.prepare', on: 'multi-session' },
        { from: 'supervisor.shape.confirm', to: 'supervisor.prepare', on: 'single-session' },
        { from: 'verify.confirm', to: 'supervisor.parent.deliver', on: 'approved' },
      ],
    },
    transitionHandler: {
      id: 'comet-native-transition',
      version: '1',
      apply({ run, event }) {
        const state = parseNativePortableState(run.state);
        if (event.kind === 'action-outcome' && event.stepId === 'repair.implementation') {
          if (event.outcome.status !== 'succeeded')
            return { state: state as unknown as RuntimeValue, next: [] };
          const output = event.outcome.output as {
            drift: boolean;
            requirementsChanged: boolean;
            archiveStep: string;
            reason: string;
          };
          if (!output.drift)
            return { state: state as unknown as RuntimeValue, next: [output.archiveStep] };
          if (output.requirementsChanged)
            return {
              state: resetShapeForRequirementsRevision(
                state,
                output.reason,
              ) as unknown as RuntimeValue,
              next: ['shape.prepare'],
            };
          const returned = returnNativeCandidateToBuild({ state, reason: output.reason });
          const verifier = [...run.actions]
            .reverse()
            .find((action) => action.stepId === 'verify.verifier' && action.status === 'succeeded');
          if (!verifier)
            throw new Error('Native implementation revision has no original Verifier result');
          return {
            state: returned as unknown as RuntimeValue,
            next: state.children_contract_ref
              ? [
                  {
                    stepId: 'supervisor.parent.builder',
                    input: supervisorParentRepairActivation(run, {
                      failedVerifierActionId: verifier.id,
                    }),
                  },
                ]
              : [
                  {
                    stepId: 'build.builder',
                    input: { repairContext: nativeBuilderRepairContext(returned, run) },
                  },
                ],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'shape.revise') {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          const reason = (
            event.outcome.output as {
              reason: string;
            }
          ).reason;
          return {
            state: resetShapeForRequirementsRevision(state, reason) as unknown as RuntimeValue,
            next: ['shape.prepare'],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'shape.remove') {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          const capability = (
            event.outcome.output as {
              capability: string;
            }
          ).capability;
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
              document_constraints_version: nativeSdkShapeConstraintsVersion(state),
              spec_changes: proposal.specChanges,
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
            ? confirmSdkShape(run, state)
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
          });
          return confirmSdkShape(run, selected);
        }
        if (event.kind === 'action-outcome' && event.stepId === 'supervisor.prepare') {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          const proposal = proposalFrom(
            run.actions.find((action) => action.id === state.children_contract_ref)?.outcome
              ?.output,
          );
          if (!proposal.children || !state.children_contract_ref) {
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
                contractRef: state.children_contract_ref!,
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
            contractRef: string;
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
            const activation = (
              action?.input as {
                activation?: Record<string, RuntimeValue>;
              }
            )?.activation;
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
          const input = (
            action.input as {
              activation?: Record<string, RuntimeValue>;
            }
          ).activation;
          const proposal = proposalFrom(
            run.actions.find((action) => action.id === state.children_contract_ref)?.outcome
              ?.output,
          );
          if (!input || !proposal.children || typeof input.child !== 'string') {
            throw new Error('Native SDK Supervisor Builder lacks its confirmed child plan');
          }
          return {
            state: state as unknown as RuntimeValue,
            next: [
              {
                stepId: 'supervisor.child.verifier',
                input: {
                  ...input,
                  candidateCommit: (
                    event.outcome.output as {
                      candidateCommit: string;
                    }
                  ).candidateCommit,
                  builderSessionId: action.claim.sessionId,
                  acceptance: supervisorAcceptanceScope(proposal.children.contract, input.child),
                  ...{
                    checks:
                      (
                        event.outcome.output as {
                          checks?: RuntimeValue;
                        }
                      ).checks ?? [],
                  },
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
              activation?: Record<string, RuntimeValue> & {
                failedBuilderActionId?: string;
              };
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
        if (event.kind === 'wait-resolved' && event.stepId === 'supervisor.child.verifier-retry') {
          const wait = run.waits.find(
            (candidate) =>
              candidate.stepId === event.stepId &&
              candidate.decision?.id === event.decisionId &&
              candidate.proposalHash === event.proposalHash,
          );
          const activation = (
            wait?.proposal as {
              activation?: Record<string, RuntimeValue>;
            }
          )?.activation;
          const legacy = wait && nativeSdkLegacyChildFailureForWait(run, wait);
          if (legacy) {
            if (event.choice !== 'repair') throw new Error('旧失败提案只允许原 repair 决定');
            const original = (legacy.input as { activation: Record<string, RuntimeValue> })
              .activation;
            return {
              state: state as unknown as RuntimeValue,
              next: [
                {
                  stepId:
                    legacy.stepId === 'supervisor.child.integration-checks'
                      ? 'supervisor.child.integration-repair'
                      : 'supervisor.child.builder',
                  input:
                    legacy.stepId === 'supervisor.child.integration-checks'
                      ? {
                          ...original,
                          contractRef: state.children_contract_ref!,
                          failedCheckActionId: legacy.id,
                        }
                      : supervisorChildRepairActivation(run, legacy, 'failedCheckActionId'),
                },
              ],
            };
          }
          const action = run.actions.find(
            (candidate) => candidate.id === activation?.failedVerifierActionId,
          );
          if (
            !action ||
            !activation ||
            hashRuntimeValue(nativeSdkFailedChildVerifierActivation(run, action)) !==
              hashRuntimeValue(activation)
          )
            throw new Error('Native Child Verifier recovery lacks its original failed Action');
          return {
            state: state as unknown as RuntimeValue,
            next: [
              {
                stepId:
                  event.choice === 'retry'
                    ? 'supervisor.child.verifier'
                    : 'supervisor.child.builder',
                input:
                  event.choice === 'retry'
                    ? activation
                    : supervisorChildRepairActivation(run, action, 'failedVerifierActionId'),
              },
            ],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'supervisor.child.verifier') {
          if (event.outcome.status !== 'succeeded') {
            const action = run.actions.find((candidate) => candidate.id === event.outcome.actionId);
            if (!action) throw new Error('Native SDK Supervisor Verifier Action is missing');
            return {
              state: state as unknown as RuntimeValue,
              next: [
                {
                  stepId: 'supervisor.child.verifier-retry',
                  input: nativeSdkFailedChildVerifierActivation(run, action),
                },
              ],
            };
          }
          const output = event.outcome.output as {
            verdict: string;
            candidateCommit: string;
          };
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
                ['supervisor.child.integrate', 'supervisor.child.integration-repair'].includes(
                  candidate.stepId,
                ) && ['pending', 'running', 'unknown'].includes(candidate.status),
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
                input: supervisorIntegrationActivation(
                  action,
                  event.outcome.output,
                  run.workflow.version === '4',
                ),
              },
            ],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'supervisor.child.integrate') {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          const action = run.actions.find((candidate) => candidate.id === event.outcome.actionId);
          const input = (
            action?.input as
              | {
                  activation?: Record<string, RuntimeValue>;
                }
              | undefined
          )?.activation;
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
                stepId: 'supervisor.child.archive',
                input: {
                  child: input.child,
                  candidateCommit: input.candidateCommit,
                  integrationCommit: output.integrationCommit,
                  mergeActionId: event.outcome.actionId,
                  contractRef: state.children_contract_ref!,
                },
              },
            ],
          };
        }
        if (
          event.kind === 'action-outcome' &&
          event.stepId === 'supervisor.child.integration-repair'
        ) {
          const action = run.actions.find((a) => a.id === event.outcome.actionId)!;
          const input = (action.input as { activation: Record<string, RuntimeValue> }).activation;
          return {
            state: state as unknown as RuntimeValue,
            next: [
              {
                stepId:
                  event.outcome.status === 'failed'
                    ? 'supervisor.child.integration-resume'
                    : 'supervisor.child.archive',
                input:
                  event.outcome.status === 'failed'
                    ? { ...input, failedBuilderActionId: action.id }
                    : {
                        ...input,
                        integrationCommit: (event.outcome.output as { integrationCommit: string })
                          .integrationCommit,
                        repairActionId: action.id,
                      },
              },
            ],
          };
        }
        if (
          event.kind === 'wait-resolved' &&
          event.stepId === 'supervisor.child.integration-resume'
        ) {
          const wait = run.waits.find(
            (w) =>
              w.stepId === event.stepId &&
              w.decision?.id === event.decisionId &&
              w.proposalHash === event.proposalHash,
          )!;
          const input = (wait.proposal as { activation: Record<string, RuntimeValue> }).activation;
          if (
            !run.actions.some(
              (a) =>
                a.id === (input.failedRepairActionId ?? input.failedBuilderActionId) &&
                a.stepId === 'supervisor.child.integration-repair' &&
                a.status === 'failed',
            )
          )
            throw new Error('Integration continuation lacks its original failed repair');
          return {
            state: state as unknown as RuntimeValue,
            next: [{ stepId: 'supervisor.child.integration-repair', input }],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === 'supervisor.child.archive') {
          if (event.outcome.status !== 'succeeded') {
            return { state: state as unknown as RuntimeValue, next: [] };
          }
          const proposal = proposalFrom(
            run.actions.find((action) => action.id === state.children_contract_ref)?.outcome
              ?.output,
          );
          const integration = run.outputs['supervisor.prepare']?.value as
            | {
                integrationBranch: string;
                integrationWorktree: string;
              }
            | undefined;
          if (!proposal.children || !state.children_contract_ref || !integration) {
            throw new Error('Native SDK Supervisor continuation lacks its confirmed plan');
          }
          const integrated = new Set(
            currentNativeSdkSupervisorActions(run)
              .filter(
                (action) =>
                  action.stepId === 'supervisor.child.archive' && action.status === 'succeeded',
              )
              .map(
                (action) =>
                  (
                    action.input as {
                      activation: {
                        child: string;
                      };
                    }
                  ).activation.child,
              ),
          );
          const currentAction = run.actions.find((action) => action.id === event.outcome.actionId);
          if (!currentAction) throw new Error('Native SDK Supervisor archive Action missing');
          integrated.add(
            (
              currentAction.input as {
                activation: {
                  child: string;
                };
              }
            ).activation.child,
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
                    run.workflow.version === '4',
                  ),
                },
              ],
            };
          }
          const active = new Set(
            currentNativeSdkSupervisorActions(run)
              .filter((action) => action.stepId === 'supervisor.child.prepare')
              .map(
                (action) =>
                  (
                    action.input as {
                      activation: {
                        child: string;
                      };
                    }
                  ).activation.child,
              )
              .filter((child) => !integrated.has(child)),
          );
          const ready = selectNativeSdkReadyChildren({
            contract: proposal.children.contract,
            integrated: [...integrated],
            active: [...active],
            maxParallel: state.coordination_mode === 'single-session' ? 1 : 2,
          });
          const output = event.outcome.output as {
            integrationCommit: string;
          };
          if (integrated.size === proposal.children.contract.children.length) {
            return {
              state: state as unknown as RuntimeValue,
              next: [
                {
                  stepId: 'supervisor.parent.builder',
                  input: {
                    contractRef: state.children_contract_ref,
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
                contractRef: state.children_contract_ref!,
                integrationBranch: integration.integrationBranch,
                integrationWorktree: integration.integrationWorktree,
                targetCommit: output.integrationCommit,
              },
            })),
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
          return {
            state: reserveNativeVerifierAttempt(candidate) as unknown as RuntimeValue,
            next: ['verify.verifier'],
          };
        }
        if (event.kind === 'wait-resolved' && event.stepId === 'build.resume') {
          const wait = run.waits.find(
            (candidate) =>
              candidate.stepId === 'build.resume' &&
              candidate.decision?.id === event.decisionId &&
              candidate.proposalHash === event.proposalHash,
          );
          const activation = (
            wait?.proposal as {
              activation?: {
                failedBuilderActionId?: unknown;
              };
            }
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
            const activation = (
              action?.input as {
                activation?: Record<string, RuntimeValue>;
              }
            )?.activation;
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
          return {
            state: reserveNativeVerifierAttempt(candidate) as unknown as RuntimeValue,
            next: ['verify.verifier'],
          };
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
              activation?: Record<string, RuntimeValue> & {
                failedBuilderActionId?: string;
              };
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
            next:
              verified.state.verification_result === 'pass'
                ? [
                    {
                      stepId: 'verify.confirm',
                      input: {
                        report: nativeSdkVerificationReportMetadata(
                          verified.state,
                          (
                            run.input as {
                              artifactRootRef: string;
                            }
                          ).artifactRootRef,
                        ),
                      },
                    },
                  ]
                : verified.state.phase === 'build'
                  ? state.children_contract_ref
                    ? [
                        {
                          stepId: 'supervisor.parent.builder',
                          input: supervisorParentRepairActivation(run, {
                            failedVerifierActionId: action.id,
                          }),
                        },
                      ]
                    : [
                        {
                          stepId: 'build.builder',
                          input: { repairContext: nativeBuilderRepairContext(verified.state, run) },
                        },
                      ]
                  : ['verify.stop'],
          };
        }
        if (event.kind === 'wait-resolved' && event.stepId === 'verify.stop') {
          const wait = run.waits.find(
            (candidate) =>
              candidate.stepId === event.stepId &&
              candidate.decision?.id === event.decisionId &&
              candidate.proposalHash === event.proposalHash,
          );
          if (
            !wait ||
            !nativeSdkVerifyWaitDecisions(state, wait, run).some(
              ({ choice }) => choice === event.choice,
            )
          ) {
            throw new Error('Native Verify stop decision does not match the current Run');
          }
          if (event.choice === 'retry') {
            const reserved = reserveNativeVerifierAttempt(
              resolveNativeVerifierBlocker(state, { reason: wait.decision?.reason }),
            );
            return {
              state: reserved as unknown as RuntimeValue,
              next: [
                {
                  stepId: 'verify.verifier',
                  input: {
                    recoveryWaitId: wait.id,
                    ...(wait.decision?.reason === undefined
                      ? {}
                      : { reason: wait.decision.reason }),
                  },
                },
              ],
            };
          }
          const returned = returnNativeCandidateToBuild({
            state,
            reason: 'The user chose to revise the implementation after Verify stopped.',
          });
          const failedVerifier = [...run.actions]
            .reverse()
            .find((action) => action.stepId === 'verify.verifier' && action.status === 'succeeded');
          const failedCheck = !failedVerifier
            ? run.actions.find(
                (action) =>
                  action.stepId === 'verify.checks' &&
                  action.status === 'failed' &&
                  run.actionContexts[action.id].sequence ===
                    wait.results['verify.checks']?.sequence,
              )
            : undefined;
          if (!failedVerifier && !failedCheck)
            throw new Error('Native Verify stop has no original failed result');
          return {
            state: returned as unknown as RuntimeValue,
            next: state.children_contract_ref
              ? [
                  {
                    stepId: 'supervisor.parent.builder',
                    input: supervisorParentRepairActivation(
                      run,
                      failedVerifier
                        ? {
                            failedVerifierActionId: failedVerifier.id,
                          }
                        : { failedCheckActionId: failedCheck!.id },
                    ),
                  },
                ]
              : [
                  {
                    stepId: 'build.builder',
                    input: { repairContext: nativeBuilderRepairContext(returned, run) },
                  },
                ],
          };
        }
        if (event.kind === 'wait-resolved' && event.stepId === 'verify.retry') {
          const reserved = reserveNativeVerifierAttempt(retryNativeVerifier(state));
          return { state: reserved as unknown as RuntimeValue, next: ['verify.verifier'] };
        }

        if (event.kind === 'wait-resolved' && event.stepId === 'verify.confirm') {
          const wait = run.waits.find(
            (candidate) =>
              candidate.stepId === event.stepId &&
              candidate.decision?.id === event.decisionId &&
              candidate.proposalHash === event.proposalHash,
          );
          if (
            !wait ||
            !nativeSdkVerifyWaitDecisions(state, wait, run).some(
              ({ choice }) => choice === event.choice,
            )
          ) {
            throw new Error(
              'Native Verify confirmation does not match an executable current decision',
            );
          }
          if (event.choice === 'reverify') {
            const ready = parseNativePortableState({
              ...state,
              status: 'active',
              state_version: state.state_version + 1,
              verification: null,
              verification_result: 'pending',
              verification_report: null,
              acceptance: state.acceptance.map((item) => ({
                ...item,
                result: 'pending',
                reason: null,
              })),
              loop: {
                ...state.loop,
                stage: 'verify-ready',
                next_action: 'run-required-checks-and-dispatch-verifier',
              },
            });
            return {
              state: reserveNativeVerifierAttempt(ready) as unknown as RuntimeValue,
              next: ['verify.verifier'],
            };
          }
          if (event.choice === 'approved') {
            return acceptedSdkResult(run, state);
          }
          const returned = returnNativeCandidateToBuild({
            state,
            reason: 'The user rejected the Skill-coordinated Verifier pass.',
          });
          return {
            state: returned as unknown as RuntimeValue,
            next: state.children_contract_ref
              ? [
                  {
                    stepId: 'supervisor.parent.builder',
                    input: supervisorParentRepairActivation(run, {
                      rejectedDecisionId: event.decisionId,
                    }),
                  },
                ]
              : [
                  {
                    stepId: 'build.builder',
                    input: { repairContext: nativeBuilderRepairContext(returned, run) },
                  },
                ],
          };
        }
        if (
          event.kind === 'action-outcome' &&
          ['archive.prepare', 'archive.execute'].includes(event.stepId) &&
          event.outcome.status === 'failed' &&
          (event.outcome.output as { reason?: string }).reason === 'candidate-drift'
        ) {
          const reason = '归档候选已变化；由 Agent 核对实际修改，选择修订实现或重新验收。';
          return {
            state: parseNativePortableState({
              ...state,
              phase: 'verify',
              status: 'await-user',
              state_version: state.state_version + 1,
              verification: null,
              verification_result: 'pending',
              verification_report: null,
              acceptance: state.acceptance.map((item) => ({
                ...item,
                result: 'pending',
                reason: null,
              })),
              blockers: [
                {
                  owner: 'user',
                  reason: toNativePortableText(reason),
                  acceptance_ids: [],
                  resolution_action: 'await-user',
                },
              ],
              loop: { ...state.loop, stage: 'await-user', next_action: 'await-user' },
            }) as unknown as RuntimeValue,
            next: ['verify.stop'],
          };
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
              event.outcome.status === 'succeeded' && state.children_contract_ref
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
      nativeSdkImplementationRevisionValidator,
      nativeSdkReviseValidator,
      nativeSdkRemoveValidator,
      nativeSdkDisassociateValidator,
      shapeValidator,
      builderValidator,
      verifierValidator,
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
    commandValidators: [
      nativeSdkImplementationRevisionCommandValidator,
      nativeSdkReviseCommandValidator,
      nativeSdkRemoveCommandValidator,
      nativeSdkDisassociateCommandValidator,
    ],
    executors: [
      nativeSdkImplementationRevisionExecutor,
      nativeSdkReviseExecutor,
      nativeSdkRemoveExecutor,
      nativeSdkDisassociateExecutor,
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
  return application;
}
