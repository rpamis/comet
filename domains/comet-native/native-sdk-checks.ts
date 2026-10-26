import type { NativeLegacyArchiveOverlay } from './native-archive-legacy-overlay.js';
import { resolveWorkspaceRuntimeRoot } from '../workflow-contract/workspace-runtime.js';
import path from 'node:path';

import { inspectGitWorktree, resolveGitRef, samePath } from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';
import { reportCometRuntimeProgress } from '../../platform/process/runtime-metrics.js';
import {
  hashProtectedProjectFile,
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
} from '../workflow-contract/protected-project-path.js';
import {
  type RuntimeAction,
  type RuntimeStoppedAction,
  type RuntimeExecutor,
  type RuntimeOutcome,
  type RuntimeValidator,
  type RuntimeValue,
  type WorkflowRun,
  type WorkflowRuntime,
  hashRuntimeValue,
} from '../engine/runtime.js';
import {
  executeNativeCheck,
  isNativeCheckTerminationUnconfirmedError,
  nativeCheckPlanKey,
  nativePortableArgvDisplay,
  preflightNativeCheckPlans,
  type NativeCheckPlan,
} from './native-check-executor.js';
import {
  createNativeSdkCheckExecution,
  acknowledgeNativeSdkCheckStopped,
  inspectNativeSdkCheckExecutions,
  nativeSdkCheckRuntimeRef,
  nativeSdkCheckStorageRef,
  requestNativeSdkCheckStop,
  hasNativeSdkCheckStopRequest,
  reconcileNativeSdkExecutionStops,
} from './native-sdk-check-execution.js';
import { readProjectConfig } from './native-config.js';
import { nativeProjectPaths, resolveArtifactRoot } from './native-paths.js';
import {
  inspectNativePortableAcceptanceDrift,
  readNativeApprovedShapeSemanticSnapshot,
} from './native-portable-requirements.js';
import { parseNativePortableState } from './native-portable-state.js';
import { currentNativeSdkSupervisorPlan } from './native-sdk-supervisor-prepare.js';
import { nativeSdkSupervisorParentCandidateCommit } from './native-sdk-supervisor-parent.js';
import {
  nativeSupervisorChildWorktree,
  nativeSupervisorIntegrationBranch,
  nativeSupervisorIntegrationWorktree,
} from './native-supervisor-workspace.js';
import { toNativePortableText } from './native-portable-text.js';
import {
  nativeCheckInputSnapshot,
  nativeCandidateInputGate,
  nativeGeneratedCheckInputSnapshot,
} from './native-portable-checks.js';
import { nativeEditReviewScope } from './native-edit-review.js';
import type { NativePortableCheckSummary } from './native-portable-types.js';
import {
  captureNativeCheckScope,
  isNativeCheckScope,
  sameNativeCheckScope,
  type NativeCheckScope,
} from './native-check-scope.js';

/** 已完成检查的输入发生变化；这不是执行结果未知。 */
export class NativeSdkCheckInputDriftError extends Error {}
export class NativeSdkCheckInputSnapshotError extends NativeSdkCheckInputDriftError {}
export class NativeSdkCandidateDriftError extends Error {}

/** 只重放当前候选明确声明可重复执行的检查。 */
export function nativeSdkCanRefreshChecks(run: Readonly<WorkflowRun>): boolean {
  const start = run.actions
    .map(
      (action) =>
        ['build.builder', 'supervisor.parent.builder'].includes(action.stepId) &&
        action.status === 'succeeded',
    )
    .lastIndexOf(true);
  // Outputs retain earlier workflow modes. Only the latest successful Builder
  // owns this candidate; an old Supervisor one-shot plan must not disable it.
  const builder = run.actions[start];
  const plans = nativeSdkCheckPlans(builder?.outcome?.output);
  for (const action of run.actions.slice(start + 1)) {
    if (action.stepId !== 'verify.requested-checks') continue;
    const outputs = record(
      record(action.input, 'Native checks input').outputs,
      'Native checks outputs',
    );
    const response = record(
      record(outputs['verify.verifier'], 'Verifier request').response,
      'Verifier response',
    );
    plans.push(...nativeSdkCheckPlans({ verificationChecks: response.checks }));
  }
  return plans.every((plan) => plan.repeatable);
}

interface NativeSdkCheckResult {
  id: string;
  name: string;
  argvDisplay: string[];
  cwdRef: string;
  status: 'passed' | 'failed' | 'interrupted';
  exitCode: number | null;
  durationMs: number;
  logRef: string;
  logSha256: string;
  inputScope?: NativeCheckScope;
  reusedFrom?: { actionId: string; attempt: number; candidateId: string; checkId: string };
}

interface NativeSdkCheckInterruption {
  kind: 'execution-unknown' | 'completed-input-drift';
  stoppedAction: Omit<RuntimeStoppedAction, 'claimToken'>;
  processBoundary: 'process-group' | 'supervisor-process' | 'unknown';
  candidateId: string;
  plansHash: string;
  executionHash: string | null;
  unknownCheckIds: string[];
  partialLogs: { logRef: string; logSha256: string }[];
  observedAt: string;
}

interface NativeSdkCheckOutcome {
  candidateInputFingerprintGate?: string | null;
  inputBefore?: string;
  inputAfter?: string;
  inputSnapshot?: {
    schema: 'comet.native.check-input.v2';
    before: string;
    after: string;
    candidateBefore: string | null;
    complete: boolean;
    diagnostics: string[];
  };
  interruption?: NativeSdkCheckInterruption;
  candidateId: string;
  checks: NativeSdkCheckResult[];
  completedAt: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function nativeSdkCheckPlans(builderOutput: unknown): NativeCheckPlan[] {
  const output = record(builderOutput, 'Native Builder result');
  const raw = output.verificationChecks ?? [];
  if (!Array.isArray(raw)) throw new Error('Native verificationChecks must be an array');
  return raw.map((entry, index) => {
    const plan = record(entry, `Native verificationChecks[${index}]`);
    if (
      typeof plan.id !== 'string' ||
      typeof plan.name !== 'string' ||
      typeof plan.executable !== 'string' ||
      !Array.isArray(plan.argv) ||
      plan.argv.some((arg) => typeof arg !== 'string') ||
      typeof plan.cwdRef !== 'string' ||
      typeof plan.timeoutMs !== 'number' ||
      typeof plan.repeatable !== 'boolean'
    ) {
      throw new Error(`Native verificationChecks[${index}] is invalid`);
    }
    return {
      id: plan.id,
      name: plan.name,
      executable: plan.executable,
      argv: plan.argv as string[],
      cwdRef: plan.cwdRef,
      timeoutMs: plan.timeoutMs,
      repeatable: plan.repeatable,
    };
  });
}

function checkPlansForAction(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  candidateId: string,
): NativeCheckPlan[] {
  const requested = action.stepId === 'verify.requested-checks';
  const outputs = record(
    record(action.input, 'Native checks Action input').outputs,
    'Native checks inputs',
  );
  if (!requested) {
    const initial = nativeSdkCheckPlans(
      outputs['supervisor.parent.builder'] ?? outputs['build.builder'],
    );
    const index = run.actions.findIndex((entry) => entry.id === action.id);
    const priorChecks = run.actions
      .slice(0, index)
      .filter(
        (entry) =>
          entry.stepId === 'verify.checks' && ['succeeded', 'failed'].includes(entry.status),
      );
    if (!priorChecks.length) return initial;
    const plans = new Map(initial.map((plan) => [plan.id, plan]));
    const builderIndex = run.actions
      .slice(0, index)
      .map(
        (entry) =>
          ['build.builder', 'supervisor.parent.builder'].includes(entry.stepId) &&
          entry.status === 'succeeded',
      )
      .lastIndexOf(true);
    if (run.actions.indexOf(priorChecks.at(-1)!) < builderIndex) return initial;
    for (const prior of run.actions.slice(builderIndex + 1, index))
      if (
        prior.stepId === 'verify.requested-checks' &&
        ['succeeded', 'failed'].includes(prior.status)
      ) {
        const previousOutputs = record(
          record(prior.input, 'Native checks input').outputs,
          'Native check outputs',
        );
        const response = record(
          record(previousOutputs['verify.verifier'], 'Verifier request').response,
          'Verifier response',
        );
        for (const plan of nativeSdkCheckPlans({ verificationChecks: response.checks }))
          plans.set(plan.id, plan);
      }
    if ([...plans.values()].some((plan) => !plan.repeatable))
      throw new Error('不可重复执行的检查不能重放；请先确认后续验证方式');
    return [...plans.values()];
  }
  const verifier = record(outputs['verify.verifier'], 'Native Verifier check request');
  const response = record(verifier.response, 'Native Verifier check request response');
  if (verifier.candidateId !== candidateId || response.kind !== 'request-checks') {
    throw new Error('Native requested checks are not bound to the current Verifier');
  }
  const requestedPlans = nativeSdkCheckPlans({ verificationChecks: response.checks });
  const actionIndex = run.actions.findIndex((entry) => entry.id === action.id);
  if (actionIndex < 0) throw new Error('Native requested checks Action is missing from its Run');
  const candidateStart = run.actions
    .slice(0, actionIndex)
    .map(
      (entry) =>
        ['build.builder', 'supervisor.parent.builder'].includes(entry.stepId) &&
        entry.status === 'succeeded',
    )
    .lastIndexOf(true);
  const priorKeys = new Set<string>();
  const priorById = new Map<string, NativeCheckPlan>();
  for (const prior of run.actions.slice(candidateStart + 1, actionIndex)) {
    if (
      !['verify.checks', 'verify.requested-checks'].includes(prior.stepId) ||
      !['succeeded', 'failed'].includes(prior.status)
    ) {
      continue;
    }
    const priorOutputs = record(
      record(prior.input, 'Prior Native checks Action input').outputs,
      'Prior Native checks inputs',
    );
    const priorPlans =
      prior.stepId === 'verify.checks'
        ? nativeSdkCheckPlans(
            priorOutputs['supervisor.parent.builder'] ?? priorOutputs['build.builder'],
          )
        : nativeSdkCheckPlans({
            verificationChecks: record(
              record(priorOutputs['verify.verifier'], 'Prior Verifier request').response,
              'Prior Verifier response',
            ).checks,
          });
    for (const plan of priorPlans) {
      priorKeys.add(nativeCheckPlanKey(plan));
      priorById.set(plan.id, plan);
    }
  }
  if (verifier.refreshChecks === true) {
    if ([...priorById.values()].some((plan) => !plan.repeatable))
      throw new Error(
        '失效检查中包含不可重复执行的命令；不得重放，请通过原工作流修订并确认后续验证方式',
      );
    for (const plan of requestedPlans) priorById.set(plan.id, plan);
    return [...priorById.values()];
  }
  return requestedPlans.filter((plan) => !priorKeys.has(nativeCheckPlanKey(plan)));
}

function checkInput(run: Readonly<WorkflowRun>, action: Readonly<RuntimeAction>) {
  const state = parseNativePortableState(run.state);
  const input = record(run.input, 'Native SDK Run input');
  if (action.stepId === 'supervisor.child.integration-checks') {
    const activation = record(
      record(action.input, 'Native Supervisor integration checks Action input').activation,
      'Native Supervisor integration checks activation',
    );
    if (
      state.phase !== 'build' ||
      state.status !== 'active' ||
      input.name !== state.name ||
      typeof input.artifactRootRef !== 'string' ||
      action.ref !== 'native-supervisor-integration-checks' ||
      typeof activation.child !== 'string' ||
      typeof activation.integrationWorktree !== 'string' ||
      typeof activation.integrationBranch !== 'string' ||
      typeof activation.integrationCommit !== 'string' ||
      typeof activation.candidateCommit !== 'string' ||
      typeof activation.mergeActionId !== 'string' ||
      activation.contractHash !== state.children_contract_hash
    ) {
      throw new Error('Native Supervisor integration checks lack their merge binding');
    }
    const plans = nativeSdkCheckPlans({ verificationChecks: activation.integrationChecks });
    if (plans.length === 0) throw new Error('Native Supervisor integration checks require a plan');
    return {
      state,
      artifactRootRef: input.artifactRootRef,
      plans,
      executionRoot: activation.integrationWorktree,
      candidateId: activation.integrationCommit,
      supervisorChild: activation.child,
      supervisorBranch: activation.integrationBranch,
      supervisorIntegration: true,
      candidateCommit: activation.candidateCommit,
      mergeActionId: activation.mergeActionId,
      repairActionId:
        typeof activation.repairActionId === 'string' ? activation.repairActionId : null,
      parentCandidateCommit: null,
      parentBuilderActionId: null,
    };
  }
  if (action.stepId === 'supervisor.child.checks') {
    const activation = record(
      record(action.input, 'Native Supervisor checks Action input').activation,
      'Native Supervisor checks activation',
    );
    if (
      state.phase !== 'build' ||
      state.status !== 'active' ||
      input.name !== state.name ||
      typeof input.artifactRootRef !== 'string' ||
      action.ref !== 'native-supervisor-child-checks' ||
      typeof activation.child !== 'string' ||
      typeof activation.worktree !== 'string' ||
      typeof activation.branch !== 'string' ||
      typeof activation.candidateCommit !== 'string' ||
      activation.contractHash !== state.children_contract_hash
    ) {
      throw new Error('Native Supervisor checks are not bound to the current Child candidate');
    }
    const plans = nativeSdkCheckPlans({ verificationChecks: activation.verificationChecks });
    if (plans.length === 0) throw new Error('Native Supervisor Child checks require a plan');
    return {
      state,
      artifactRootRef: input.artifactRootRef,
      plans,
      executionRoot: activation.worktree,
      candidateId: activation.candidateCommit,
      supervisorChild: activation.child,
      supervisorBranch: activation.branch,
      supervisorIntegration: false,
      candidateCommit: null,
      mergeActionId: null,
      repairActionId: null,
      parentCandidateCommit: null,
      parentBuilderActionId: null,
    };
  }
  const requested = action.stepId === 'verify.requested-checks';
  if (
    state.phase !== 'verify' ||
    state.status !== 'active' ||
    state.loop.stage !== 'verify-ready' ||
    !state.builder_handoff ||
    input.name !== state.name ||
    typeof input.artifactRootRef !== 'string' ||
    (requested
      ? state.loop.next_action !== 'await-verifier-result' ||
        action.ref !== 'native-verifier-requested-checks'
      : action.stepId !== 'verify.checks' || action.ref !== 'native-required-checks')
  ) {
    throw new Error('Native checks are not bound to the current Verify candidate');
  }
  const plans = checkPlansForAction(run, action, state.builder_handoff.candidate_id);
  const parentBuilder = state.children_contract_hash
    ? [...run.actions]
        .reverse()
        .find(
          (candidate) =>
            candidate.stepId === 'supervisor.parent.builder' && candidate.status === 'succeeded',
        )
    : undefined;
  const parentActivation = parentBuilder
    ? (parentBuilder.input as { activation?: Record<string, unknown> }).activation
    : undefined;
  if (state.children_contract_hash && !parentActivation) {
    throw new Error('Native Supervisor parent checks lack their integration candidate');
  }
  return {
    state,
    artifactRootRef: input.artifactRootRef,
    plans,
    executionRoot:
      typeof parentActivation?.integrationWorktree === 'string'
        ? parentActivation.integrationWorktree
        : null,
    candidateId: state.builder_handoff.candidate_id,
    supervisorChild: null,
    supervisorBranch: null,
    supervisorIntegration: false,
    candidateCommit: null,
    mergeActionId: null,
    repairActionId: null,
    parentCandidateCommit:
      parentBuilder && parentActivation
        ? nativeSdkSupervisorParentCandidateCommit(parentBuilder)
        : null,
    parentBuilderActionId: parentBuilder?.id ?? null,
  };
}

async function assertSupervisorCheckWorkspace(options: {
  run: Readonly<WorkflowRun>;
  projectRoot: string;
  state: ReturnType<typeof parseNativePortableState>;
  child: string;
  worktree: string;
  branch: string;
  candidateCommit: string;
  allowCandidateSuccessor?: boolean;
}): Promise<void> {
  const plan = await currentNativeSdkSupervisorPlan(options.run, options.projectRoot);
  if (
    !plan.contract.children.some(({ name }) => name === options.child) ||
    !samePath(
      options.worktree,
      nativeSupervisorChildWorktree(options.projectRoot, options.state.name, options.child),
    ) ||
    options.branch !== `comet/supervisor/${options.state.name}/${options.child}` ||
    inspectGitWorktree(options.worktree).currentBranch !== options.branch ||
    (!options.allowCandidateSuccessor &&
      resolveGitRef(options.worktree, options.branch) !== options.candidateCommit)
  ) {
    throw new Error('Native Supervisor checks no longer match the Child candidate');
  }
  if (options.allowCandidateSuccessor) {
    runGitCommand(options.worktree, [
      'merge-base',
      '--is-ancestor',
      options.candidateCommit,
      resolveGitRef(options.worktree, options.branch)!,
    ]);
  }
}

async function assertSupervisorIntegrationCheckWorkspace(options: {
  run: Readonly<WorkflowRun>;
  projectRoot: string;
  state: ReturnType<typeof parseNativePortableState>;
  child: string;
  worktree: string;
  branch: string;
  integrationCommit: string;
  candidateCommit: string;
  mergeActionId: string;
  repairActionId: string | null;
}): Promise<void> {
  const plan = await currentNativeSdkSupervisorPlan(options.run, options.projectRoot);
  const merge = options.run.actions.find((action) => action.id === options.mergeActionId);
  const output = merge?.outcome?.output as Record<string, unknown> | null | undefined;
  const repair = options.repairActionId
    ? options.run.actions.find((action) => action.id === options.repairActionId)
    : null;
  const repairInput = (repair?.input as { activation?: Record<string, unknown> } | undefined)
    ?.activation;
  const repairOutput = repair?.outcome?.output as Record<string, unknown> | null | undefined;
  if (
    !plan.contract.children.some(({ name }) => name === options.child) ||
    !samePath(
      options.worktree,
      nativeSupervisorIntegrationWorktree(options.projectRoot, options.state.name),
    ) ||
    options.branch !== nativeSupervisorIntegrationBranch(options.state.name) ||
    inspectGitWorktree(options.worktree).currentBranch !== options.branch ||
    resolveGitRef(options.worktree, options.branch) !== options.integrationCommit ||
    merge?.stepId !== 'supervisor.child.integrate' ||
    merge.status !== 'succeeded' ||
    output?.child !== options.child ||
    output.candidateCommit !== options.candidateCommit ||
    (options.repairActionId
      ? repair?.stepId !== 'supervisor.child.integration-repair' ||
        repair.status !== 'succeeded' ||
        repairInput?.child !== options.child ||
        repairInput.mergeActionId !== options.mergeActionId ||
        repairOutput?.integrationCommit !== options.integrationCommit
      : output.integrationCommit !== options.integrationCommit)
  ) {
    throw new Error('Native Supervisor integration checks no longer match the merge');
  }
  if (options.repairActionId) {
    runGitCommand(options.worktree, [
      'merge-base',
      '--is-ancestor',
      output.integrationCommit as string,
      options.integrationCommit,
    ]);
  }
}

async function assertSupervisorParentCheckWorkspace(options: {
  run: Readonly<WorkflowRun>;
  projectRoot: string;
  state: ReturnType<typeof parseNativePortableState>;
  worktree: string;
  integrationCommit: string;
  builderActionId: string;
}): Promise<void> {
  await currentNativeSdkSupervisorPlan(options.run, options.projectRoot);
  const builder = options.run.actions.find((action) => action.id === options.builderActionId);
  const activation = (builder?.input as { activation?: Record<string, unknown> } | undefined)
    ?.activation;
  const branch = nativeSupervisorIntegrationBranch(options.state.name);
  if (
    builder?.stepId !== 'supervisor.parent.builder' ||
    builder.status !== 'succeeded' ||
    !builder.claim?.sessionId ||
    !builder.outcome ||
    !options.state.builder_handoff ||
    options.state.builder_handoff.builder_execution_ref !== builder.claim.sessionId ||
    options.state.builder_handoff.candidate_id !==
      hashRuntimeValue({ actionId: builder.id, outcomeId: builder.outcome.outcomeId }) ||
    activation?.contractHash !== options.state.children_contract_hash ||
    nativeSdkSupervisorParentCandidateCommit(builder) !== options.integrationCommit ||
    !samePath(
      options.worktree,
      nativeSupervisorIntegrationWorktree(options.projectRoot, options.state.name),
    ) ||
    inspectGitWorktree(options.worktree).currentBranch !== branch ||
    resolveGitRef(options.worktree, branch) !== options.integrationCommit
  ) {
    throw new Error('Native Supervisor parent checks no longer match the integration candidate');
  }
}

function checkRuntimeRef(run: Readonly<WorkflowRun>): string {
  return nativeSdkCheckRuntimeRef(run);
}

function checkOperationId(action: Readonly<RuntimeAction>): string {
  return hashRuntimeValue({ actionId: action.id, attempt: action.attempt });
}

async function reusableScopedCheck(options: {
  run: Readonly<WorkflowRun>;
  action: Readonly<RuntimeAction>;
  plan: NativeCheckPlan;
  scope: NativeCheckScope | null;
  projectRoot: string;
}): Promise<NativeSdkCheckResult | null> {
  if (!options.scope) return null;
  const before = options.run.actions.findIndex(({ id }) => id === options.action.id);
  for (const prior of options.run.actions.slice(0, before).reverse()) {
    if (
      !['verify.checks', 'verify.requested-checks'].includes(prior.stepId) ||
      !['succeeded', 'failed'].includes(prior.status) ||
      !prior.outcome ||
      prior.claim?.executorId !== nativeSdkCheckExecutor.id
    )
      continue;
    const output = prior.outcome.output as unknown as NativeSdkCheckOutcome;
    if (
      output.interruption ||
      !output.inputSnapshot?.complete ||
      output.inputSnapshot.candidateBefore === null ||
      output.inputSnapshot.candidateBefore !== output.candidateInputFingerprintGate
    )
      continue;
    const plans = checkPlansForAction(options.run, prior, output.candidateId);
    const index = plans.findIndex(
      (plan) => nativeCheckPlanKey(plan) === nativeCheckPlanKey(options.plan),
    );
    const check = output.checks[index];
    if (
      !check ||
      check.reusedFrom ||
      check.status !== 'passed' ||
      !isNativeCheckScope(check.inputScope, plans[index]) ||
      !sameNativeCheckScope(check.inputScope, options.scope)
    )
      continue;
    try {
      await validatedCheckResults({
        run: options.run,
        action: prior,
        outcome: prior.outcome,
        candidateId: output.candidateId,
        plans,
        projectRoot: options.projectRoot,
        allowCandidateSuccessor: true,
      });
    } catch {
      // 历史证据损坏不成为新的通过结果，执行当前检查重新建立证据。
      continue;
    }
    return {
      ...check,
      id: options.plan.id,
      name: options.plan.name,
      reusedFrom: {
        actionId: prior.id,
        attempt: prior.attempt,
        candidateId: output.candidateId,
        checkId: check.id,
      },
    };
  }
  return null;
}

export const nativeSdkCheckExecutor: RuntimeExecutor = {
  id: 'comet-native-checks',
  capabilities: [],
  supports: (action) =>
    action.type === 'call_tool' &&
    action.ref !== undefined &&
    [
      'native-required-checks',
      'native-verifier-requested-checks',
      'native-supervisor-child-checks',
      'native-supervisor-integration-checks',
    ].includes(action.ref),
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) throw new Error('Native checks require a bound SDK Run');
    const {
      state,
      artifactRootRef,
      plans,
      executionRoot,
      candidateId,
      supervisorChild,
      supervisorBranch,
      supervisorIntegration,
      candidateCommit,
      mergeActionId,
      repairActionId,
      parentCandidateCommit,
      parentBuilderActionId,
    } = checkInput(run, action);
    const config = await readProjectConfig(context.projectRoot);
    if (!config || config.native.artifact_root !== artifactRootRef) {
      throw new Error('Native artifact root changed after Run creation');
    }
    const paths = await nativeProjectPaths(context.projectRoot, artifactRootRef);
    const drift = await inspectNativePortableAcceptanceDrift({ paths, state });
    if (drift.drifted) throw new Error(drift.reason ?? 'Native acceptance changed');
    if (supervisorChild && supervisorBranch && executionRoot) {
      if (supervisorIntegration && candidateCommit && mergeActionId) {
        await assertSupervisorIntegrationCheckWorkspace({
          run,
          projectRoot: context.projectRoot,
          state,
          child: supervisorChild,
          worktree: executionRoot,
          branch: supervisorBranch,
          integrationCommit: candidateId,
          candidateCommit,
          mergeActionId,
          repairActionId,
        });
      } else {
        await assertSupervisorCheckWorkspace({
          run,
          projectRoot: context.projectRoot,
          state,
          child: supervisorChild,
          worktree: executionRoot,
          branch: supervisorBranch,
          candidateCommit: candidateId,
        });
      }
    } else if (parentCandidateCommit && parentBuilderActionId && executionRoot) {
      await assertSupervisorParentCheckWorkspace({
        run,
        projectRoot: context.projectRoot,
        state,
        worktree: executionRoot,
        integrationCommit: parentCandidateCommit,
        builderActionId: parentBuilderActionId,
      });
    }
    const checkRoot = executionRoot ?? context.projectRoot;
    const managedArtifactRoot = await resolveArtifactRoot(checkRoot, artifactRootRef);
    preflightNativeCheckPlans(checkRoot, plans);
    if (state.phase === 'verify' && state.builder_handoff)
      await assertNativeSdkCandidateUnchanged({ run, projectRoot: context.projectRoot });
    const fingerprintOptions = {
      state,
      projectRoot: checkRoot,
      plans,
      managedArtifactRoot,
    };
    const inputBefore = await nativeCheckInputSnapshot(fingerprintOptions);
    const candidateBefore =
      state.phase === 'verify' && state.builder_handoff
        ? await nativeCandidateInputGate({
            projectRoot: checkRoot,
            candidateId,
            plans,
            managedArtifactRoot,
            editReviewScope: nativeEditReviewScope(paths, state),
            shapeSemanticSnapshot: (await readNativeApprovedShapeSemanticSnapshot({ paths, state }))
              ?.snapshot,
            legacyShapeSemanticSnapshot: state.shape_semantic_snapshot === undefined,
          })
        : null;

    const runtimeRef = checkRuntimeRef(run);
    await ensureProtectedProjectDirectory(paths.workspaceRuntimeRoot, `${runtimeRef}/logs/checks`, {
      label: 'Native SDK check logs',
    });
    const runtimeDir = path.join(paths.workspaceRuntimeRoot, ...runtimeRef.split('/'));
    const operationId = checkOperationId(action);
    const registration = await createNativeSdkCheckExecution({
      projectRoot: context.projectRoot,
      run,
      action,
      candidateId,
      plansHash: hashRuntimeValue(plans as unknown as RuntimeValue),
    });
    const checks: NativeSdkCheckResult[] = [];
    try {
      for (const plan of plans) {
        await registration.assertNotStopped();
        const scopeOptions = {
          projectRoot: checkRoot,
          plan,
          contract: {
            shape: state.shape_confirmation_hash ?? null,
            acceptance: state.acceptance.map(({ id, source, text }) => ({ id, source, text })),
          },
        };
        const scopeBefore = await captureNativeCheckScope(scopeOptions);
        const reused = await reusableScopedCheck({
          run,
          action,
          plan,
          scope: scopeBefore,
          projectRoot: context.projectRoot,
        });
        if (reused) {
          const scopeAfter = await captureNativeCheckScope(scopeOptions);
          if (scopeAfter && sameNativeCheckScope(scopeBefore!, scopeAfter)) {
            checks.push(reused);
            registration.execution.checks = checks as unknown as RuntimeValue[];
            await registration.save();
            continue;
          }
        }
        // 下一监管器尚无 PID 时也先保留未知边界，不能沿用上一条检查的停止收据。
        delete registration.execution.child;
        registration.execution.checkId = plan.id;
        registration.execution.phase = 'reserved';
        registration.execution.terminationUnconfirmed = true;
        await registration.save();
        reportCometRuntimeProgress(`执行检查：${plan.name}`);
        const executed = await executeNativeCheck({
          projectRoot: checkRoot,
          runtimeDir,
          operationId,
          plan,
          onSpawn: ({ signal, ...instance }) => registration.register(plan.id, instance, signal),
          onTerminated: (instance, confirmed) =>
            registration.recordTermination(instance, confirmed),
        });
        const logRef = `${runtimeRef}/${executed.logRef}`;
        const scopeAfter = await captureNativeCheckScope(scopeOptions);
        const log = await inspectProtectedProjectPath(paths.workspaceRuntimeRoot, logRef, {
          label: 'Native SDK check log',
          expected: 'file',
        });
        if (!log.exists) throw new Error('Native SDK check log does not exist');
        checks.push({
          id: executed.id,
          name: executed.name,
          argvDisplay: executed.argvDisplay,
          cwdRef: executed.cwdRef,
          status: executed.status,
          exitCode: executed.exitCode,
          durationMs: executed.durationMs,
          logRef,
          logSha256: executed.logSha256,
          ...(scopeBefore && scopeAfter && sameNativeCheckScope(scopeBefore, scopeAfter)
            ? { inputScope: scopeAfter }
            : {}),
        });
        registration.execution.checks = checks as unknown as RuntimeValue[];
        await registration.save();
      }
      const inputAfter = await nativeCheckInputSnapshot(fingerprintOptions);
      const result = {
        status: checks.every((check) => check.status === 'passed')
          ? ('succeeded' as const)
          : ('failed' as const),
        output: {
          inputBefore: inputBefore.fingerprint,
          inputAfter: inputAfter.fingerprint,
          inputSnapshot: {
            schema: 'comet.native.check-input.v2',
            before: inputBefore.contentFingerprint,
            after: inputAfter.contentFingerprint,
            candidateBefore,
            complete: inputBefore.complete && inputAfter.complete,
            diagnostics: [...new Set([...inputBefore.diagnostics, ...inputAfter.diagnostics])],
          },
          candidateInputFingerprintGate:
            state.phase === 'verify' && state.builder_handoff
              ? await nativeCandidateInputGate({
                  projectRoot: checkRoot,
                  candidateId,
                  plans,
                  managedArtifactRoot,
                  editReviewScope: nativeEditReviewScope(paths, state),
                  shapeSemanticSnapshot: (
                    await readNativeApprovedShapeSemanticSnapshot({ paths, state })
                  )?.snapshot,
                  legacyShapeSemanticSnapshot: state.shape_semantic_snapshot === undefined,
                })
              : null,
          candidateId,
          checks,
          completedAt: new Date().toISOString(),
        } as unknown as RuntimeValue,
      };
      registration.execution.phase = 'completed';
      registration.execution.terminationUnconfirmed = false;
      registration.execution.outcome = result;
      await registration.save();
      return result;
    } catch (error) {
      registration.execution.phase = 'interrupted';
      registration.execution.terminationUnconfirmed =
        isNativeCheckTerminationUnconfirmedError(error);
      await registration.save();
      throw error;
    }
  },
};

async function validatedCheckResults(options: {
  run: Readonly<WorkflowRun>;
  action: Readonly<RuntimeAction>;
  outcome: Readonly<RuntimeOutcome>;
  candidateId: string;
  plans: NativeCheckPlan[];
  projectRoot: string;
  allowCandidateSuccessor?: boolean;
}): Promise<NativeSdkCheckResult[]> {
  const { run, action, outcome, candidateId, plans, projectRoot } = options;
  const output = record(outcome.output, 'Native check outcome') as unknown as NativeSdkCheckOutcome;
  if (
    process.platform === 'win32' &&
    !output.interruption &&
    ['running', 'unknown', 'cancelled'].includes(action.status)
  ) {
    const inspection = (
      await inspectNativeSdkCheckExecutions({ projectRoot, run, includeSettled: true })
    ).find((item) => item.actionId === action.id);
    if (!inspection?.quiescent) throw new Error('Windows 检查尚无原进程树停止证据；不能验收原结果');
  }
  if (outcome.status === 'succeeded' && !output.interruption && !options.allowCandidateSuccessor) {
    // 已完成检查也会在 await-user 和 Archive 前复核；不能把当时的执行阶段当作当前阶段。
    const state = parseNativePortableState(run.state);
    const input = record(run.input, 'Native SDK Run input');
    if (typeof input.artifactRootRef !== 'string')
      throw new Error('Native checks lack their artifact root');
    const artifactRootRef = input.artifactRootRef;
    const activation = (
      action.input as { activation?: { worktree?: string; integrationWorktree?: string } }
    ).activation;
    const parent = state.children_contract_hash
      ? run.actions
          .slice()
          .reverse()
          .find(
            (entry) => entry.stepId === 'supervisor.parent.builder' && entry.status === 'succeeded',
          )
      : undefined;
    const parentActivation = (
      parent?.input as { activation?: { integrationWorktree?: string } } | undefined
    )?.activation;
    const executionRoot =
      action.stepId === 'supervisor.child.checks'
        ? activation?.worktree
        : action.stepId === 'supervisor.child.integration-checks'
          ? activation?.integrationWorktree
          : parentActivation?.integrationWorktree;
    const paths = await nativeProjectPaths(executionRoot ?? projectRoot, artifactRootRef, {
      readOnly: true,
    });
    const current = await nativeCheckInputSnapshot({
      state,
      projectRoot: executionRoot ?? projectRoot,
      plans,
      managedArtifactRoot: paths.artifactRoot,
    });
    if (!current.complete) {
      throw new NativeSdkCheckInputSnapshotError(
        `Native 检查输入快照不完整：${current.diagnostics.join('；')}。先修复输入读取范围或文件状态，再刷新检查；不能验收或复用旧证据`,
      );
    }
    if (output.inputSnapshot !== undefined) {
      const snapshot = record(output.inputSnapshot, 'Native check input snapshot');
      if (
        snapshot.schema !== 'comet.native.check-input.v2' ||
        typeof snapshot.before !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(snapshot.before) ||
        typeof snapshot.after !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(snapshot.after) ||
        (snapshot.candidateBefore !== null &&
          (typeof snapshot.candidateBefore !== 'string' ||
            !/^[a-f0-9]{64}$/u.test(snapshot.candidateBefore))) ||
        typeof snapshot.complete !== 'boolean' ||
        !Array.isArray(snapshot.diagnostics) ||
        snapshot.diagnostics.some((entry) => typeof entry !== 'string')
      ) {
        throw new Error('Native 检查输入收据结构无效；不能降级复用旧版证据');
      }
      if (
        state.builder_handoff &&
        state.phase === 'verify' &&
        (snapshot.candidateBefore === null ||
          snapshot.candidateBefore !== output.candidateInputFingerprintGate)
      ) {
        throw new NativeSdkCandidateDriftError(
          'Native 候选源码在检查执行期间发生变化或无法完整读取；需要新的 Builder 候选，不能验收本次检查',
        );
      }
      if (!snapshot.complete) {
        throw new NativeSdkCheckInputDriftError(
          `Native 原检查输入快照不完整：${snapshot.diagnostics.join('；')}。当前输入已可完整读取，由当前 Verifier 请求原检查并提交 refreshChecks: true，重新建立完整证据`,
        );
      }
      // 执行环境用于判断能否复用检查，不属于 Verifier 提交时的候选内容。
      if (snapshot.after !== current.contentFingerprint) {
        throw new NativeSdkCheckInputDriftError(
          'Native 检查输入已变化（候选或项目文件内容）；保留 Verify，由当前 Verifier 请求原检查并提交 refreshChecks: true，刷新证据后再验收',
        );
      }
    } else if (
      !output.inputBefore ||
      !output.inputAfter ||
      output.inputBefore !== output.inputAfter ||
      output.inputAfter !== current.fingerprint
    ) {
      // 0.5.0 收据未分离内容与执行环境。只允许完整且仍精确匹配的旧证据；
      // 无法证明时刷新一次，新收据不再受提交 shell 的环境差异影响。
      throw new NativeSdkCheckInputDriftError(
        'Native 旧版检查收据无法区分输入变化与执行环境差异；由当前 Verifier 请求原检查并提交 refreshChecks: true，升级一次检查证据后再验收',
      );
    }
  }
  if (
    output.candidateId !== candidateId ||
    !Array.isArray(output.checks) ||
    (output.interruption
      ? output.checks.length > plans.length
      : output.checks.length !== plans.length) ||
    typeof output.completedAt !== 'string' ||
    Number.isNaN(Date.parse(output.completedAt)) ||
    new Date(output.completedAt).toISOString() !== output.completedAt
  ) {
    throw new Error('Native check outcome changed candidate or plan');
  }
  const runtimeRef = checkRuntimeRef(run);
  const operationId = checkOperationId(action);
  if (output.interruption) await validateInterruptedCheckOutcome(options, output);
  for (const [index, plan] of plans.slice(0, output.checks.length).entries()) {
    const check = record(
      output.checks[index],
      `Native check ${index}`,
    ) as unknown as NativeSdkCheckResult;
    let expectedRef = `${runtimeRef}/logs/checks/${operationId}-${plan.id}.log`;
    if (check.reusedFrom) {
      const origin = check.reusedFrom;
      const prior = run.actions.find((entry) => entry.id === origin.actionId);
      const priorOutput = prior?.outcome?.output as unknown as NativeSdkCheckOutcome | undefined;
      const priorPlans =
        prior && priorOutput ? checkPlansForAction(run, prior, priorOutput.candidateId) : [];
      const originalIndex = priorOutput?.checks.findIndex(({ id }) => id === origin.checkId) ?? -1;
      const original = priorOutput?.checks[originalIndex];
      if (
        !prior ||
        !prior.outcome ||
        run.actions.findIndex(({ id }) => id === prior.id) >=
          run.actions.findIndex(({ id }) => id === action.id) ||
        prior.attempt !== origin.attempt ||
        prior.claim?.executorId !== nativeSdkCheckExecutor.id ||
        !['succeeded', 'failed'].includes(prior.status) ||
        priorOutput?.interruption ||
        !priorOutput?.inputSnapshot?.complete ||
        priorOutput.candidateId !== origin.candidateId ||
        priorOutput.inputSnapshot.candidateBefore === null ||
        priorOutput.inputSnapshot.candidateBefore !== priorOutput.candidateInputFingerprintGate ||
        !original ||
        original.reusedFrom ||
        original.status !== 'passed' ||
        !priorPlans[originalIndex] ||
        nativeCheckPlanKey(priorPlans[originalIndex]) !== nativeCheckPlanKey(plan) ||
        !isNativeCheckScope(original.inputScope, priorPlans[originalIndex]) ||
        !isNativeCheckScope(check.inputScope, plan) ||
        !sameNativeCheckScope(original.inputScope, check.inputScope) ||
        original.logSha256 !== check.logSha256 ||
        original.exitCode !== check.exitCode ||
        original.durationMs !== check.durationMs
      ) {
        throw new Error('Native reused check is not bound to its original Runtime evidence');
      }
      expectedRef = `${runtimeRef}/logs/checks/${checkOperationId(prior)}-${origin.checkId}.log`;
      if (nativeSdkCheckStorageRef(original.logRef) !== expectedRef)
        throw new Error('Native original check log does not match its Runtime Action');
    }
    if (
      check.id !== plan.id ||
      check.name !== plan.name ||
      check.cwdRef !== plan.cwdRef ||
      hashRuntimeValue(check.argvDisplay as RuntimeValue) !==
        hashRuntimeValue(nativePortableArgvDisplay(plan.argv)) ||
      !['passed', 'failed', 'interrupted'].includes(check.status) ||
      !Number.isSafeInteger(check.durationMs) ||
      check.durationMs < 0 ||
      (check.exitCode !== null && !Number.isSafeInteger(check.exitCode)) ||
      typeof check.logRef !== 'string' ||
      nativeSdkCheckStorageRef(check.logRef) !== expectedRef ||
      typeof check.logSha256 !== 'string'
    ) {
      throw new Error('Native check receipt does not match the bound plan');
    }
    const log = await hashProtectedProjectFile(
      await resolveWorkspaceRuntimeRoot(projectRoot),
      nativeSdkCheckStorageRef(check.logRef),
      {
        label: 'Native SDK check log',
      },
    );
    if (log.digest !== check.logSha256) {
      throw new Error('Native check log changed after execution');
    }
  }
  const allPassed =
    !output.interruption && output.checks.every((check) => check.status === 'passed');
  if ((outcome.status === 'succeeded') !== allPassed) {
    throw new Error('Native check status disagrees with its results');
  }
  return output.checks;
}

/** 只把已核验的完整原结果识别为输入过期；日志损坏等其他错误仍需单独修复。 */
export async function nativeSdkCompletedCheckInputDrift(
  options: {
    run: Readonly<WorkflowRun>;
    action: Readonly<RuntimeAction>;
    projectRoot: string;
  },
  persisted: Omit<
    RuntimeOutcome,
    'actionId' | 'attempt' | 'inputHash' | 'claimToken' | 'outcomeId'
  >,
): Promise<boolean> {
  const { action } = options;
  const outcome: RuntimeOutcome = {
    ...persisted,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: action.claim!.token,
    outcomeId: `${action.id}:${action.attempt}:executor-result`,
  };
  const original = outcome.output as unknown as NativeSdkCheckOutcome;
  if (
    outcome.status !== 'succeeded' ||
    original?.interruption ||
    typeof original?.inputBefore !== 'string' ||
    !original.inputBefore ||
    typeof original?.inputAfter !== 'string' ||
    !original.inputAfter
  )
    return false;
  try {
    const { candidateId, plans } = checkInput(options.run, action);
    const validation = { ...options, candidateId, plans, outcome };
    // 原候选、完整计划和日志必须仍然可信；不能把任意校验失败包装成可恢复结果。
    await validatedCheckResults({ ...validation, allowCandidateSuccessor: true });
    await validatedCheckResults(validation);
  } catch (error) {
    return (
      error instanceof NativeSdkCheckInputDriftError ||
      error instanceof NativeSdkCandidateDriftError
    );
  }
  return false;
}

async function partialCheckLogs(
  projectRoot: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  plans: NativeCheckPlan[],
  completed: number,
) {
  const logs: { logRef: string; logSha256: string }[] = [];
  for (const plan of plans.slice(completed)) {
    const logRef = `${checkRuntimeRef(run)}/logs/checks/${checkOperationId(action)}-${plan.id}.log`;
    if (
      !(
        await inspectProtectedProjectPath(await resolveWorkspaceRuntimeRoot(projectRoot), logRef, {
          label: 'Native 中断检查日志',
          expected: 'file',
        })
      ).exists
    )
      continue;
    const log = await hashProtectedProjectFile(
      await resolveWorkspaceRuntimeRoot(projectRoot),
      logRef,
      {
        label: 'Native 中断检查日志',
      },
    );
    logs.push({ logRef, logSha256: log.digest });
  }
  return logs;
}

function assertStoppedAction(
  action: Readonly<RuntimeAction>,
  stopped: RuntimeStoppedAction | undefined,
): asserts stopped is RuntimeStoppedAction {
  if (
    !stopped ||
    Object.keys(stopped).some(
      (key) => !['actionId', 'attempt', 'inputHash', 'claimToken', 'evidence'].includes(key),
    ) ||
    stopped.actionId !== action.id ||
    stopped.attempt !== action.attempt ||
    stopped.inputHash !== action.inputHash ||
    stopped.claimToken !== action.claim?.token ||
    typeof stopped.evidence !== 'string' ||
    !stopped.evidence.trim() ||
    stopped.evidence.length > 4096 ||
    /^<.*>$/su.test(stopped.evidence.trim())
  ) {
    throw new Error(
      '中断核对需要原领取方或用户明确确认原执行及全部后代（含脱组进程）已停止，并提交绑定原 Action 的实际证据',
    );
  }
}

async function validateInterruptedCheckOutcome(
  options: {
    run: Readonly<WorkflowRun>;
    action: Readonly<RuntimeAction>;
    outcome: Readonly<RuntimeOutcome>;
    candidateId: string;
    plans: NativeCheckPlan[];
    projectRoot: string;
  },
  output: NativeSdkCheckOutcome,
) {
  const { run, action, outcome, candidateId, plans, projectRoot } = options;
  const interruption = output.interruption!;
  if (
    !interruption.stoppedAction ||
    Object.keys(interruption.stoppedAction).some(
      (key) => !['actionId', 'attempt', 'inputHash', 'evidence'].includes(key),
    )
  )
    throw new Error('中断停止事实不能携带额外领取令牌');
  assertStoppedAction(action, { ...interruption.stoppedAction, claimToken: outcome.claimToken });
  const item = (
    await inspectNativeSdkCheckExecutions({ projectRoot, run, includeSettled: true })
  ).find((entry) => entry.actionId === action.id);
  const legacyMissing =
    interruption.kind === 'execution-unknown' &&
    item?.phase === 'missing' &&
    interruption.executionHash === null &&
    output.checks.length === 0 &&
    (await hasNativeSdkCheckStopRequest({ projectRoot, run, action }));
  const completedInputDrift =
    interruption.kind === 'completed-input-drift' &&
    item?.quiescent &&
    item.execution?.phase === 'completed' &&
    item.execution.outcome &&
    hashRuntimeValue(item.execution.checks) ===
      hashRuntimeValue((item.execution.outcome.output as { checks: RuntimeValue }).checks) &&
    (await nativeSdkCompletedCheckInputDrift(options, item.execution.outcome));
  const registeredStopped =
    item?.quiescent &&
    item.execution &&
    (completedInputDrift ||
      (interruption.kind === 'execution-unknown' &&
        !item.execution.outcome &&
        (item.owner === 'dead' || item.phase === 'interrupted'))) &&
    item.execution.candidateId === candidateId &&
    item.execution.plansHash === interruption.plansHash &&
    interruption.executionHash === hashRuntimeValue(item.execution as unknown as RuntimeValue) &&
    hashRuntimeValue(output.checks as unknown as RuntimeValue) ===
      hashRuntimeValue(item.execution.checks);
  if (
    !item ||
    (!legacyMissing && !registeredStopped) ||
    outcome.status !== 'failed' ||
    (interruption.kind !== 'execution-unknown' && interruption.kind !== 'completed-input-drift') ||
    (interruption.kind === 'execution-unknown' && Boolean(item.execution?.outcome)) ||
    interruption.candidateId !== candidateId ||
    interruption.processBoundary !== item.processBoundary ||
    interruption.observedAt !== output.completedAt ||
    interruption.plansHash !== hashRuntimeValue(plans as unknown as RuntimeValue) ||
    hashRuntimeValue(interruption.unknownCheckIds) !==
      hashRuntimeValue(plans.slice(output.checks.length).map((plan) => plan.id)) ||
    hashRuntimeValue(
      interruption.partialLogs.map((entry) => ({
        ...entry,
        logRef: nativeSdkCheckStorageRef(entry.logRef),
      })) as unknown as RuntimeValue,
    ) !==
      hashRuntimeValue(
        (await partialCheckLogs(
          projectRoot,
          run,
          action,
          plans,
          output.checks.length,
        )) as unknown as RuntimeValue,
      )
  ) {
    throw new Error(
      'Native 中断核对必须绑定已停止的原执行、候选、计划及实际保留日志；不能虚报未执行或重跑原检查',
    );
  }
}

export async function nativeSdkCurrentCheckSummaries(options: {
  run: Readonly<WorkflowRun>;
  projectRoot: string;
}): Promise<NativePortableCheckSummary[]> {
  return currentCheckSummaries(options, 'verify');
}

/** Archive 只读复核原检查，不改变 Verifier 的阶段要求或推进状态。 */
export async function assertNativeSdkArchiveCheckInputs(options: {
  run: Readonly<WorkflowRun>;
  projectRoot: string;
}): Promise<void> {
  await currentCheckSummaries(options, 'archive');
}

async function currentCheckSummaries(
  options: {
    run: Readonly<WorkflowRun>;
    projectRoot: string;
  },
  phase: 'verify' | 'archive',
): Promise<NativePortableCheckSummary[]> {
  const { run, projectRoot } = options;
  const state = parseNativePortableState(run.state);
  const candidateStart = run.actions
    .map(
      (entry) =>
        ['build.builder', 'supervisor.parent.builder'].includes(entry.stepId) &&
        entry.status === 'succeeded',
    )
    .lastIndexOf(true);
  const actions = run.actions
    .slice(candidateStart + 1)
    .filter(
      (entry) =>
        ['verify.checks', 'verify.requested-checks'].includes(entry.stepId) &&
        ['succeeded', 'failed'].includes(entry.status),
    );
  if (
    state.phase !== phase ||
    !state.builder_handoff ||
    !actions.some((entry) => entry.stepId === 'verify.checks') ||
    actions.some((entry) => entry.claim?.executorId !== nativeSdkCheckExecutor.id || !entry.outcome)
  ) {
    throw new Error('Native Verifier lacks completed Runtime checks for its candidate');
  }
  if (state.children_contract_hash) {
    const parentBuilder = run.actions[candidateStart];
    const activation = (
      parentBuilder?.input as { activation?: Record<string, unknown> } | undefined
    )?.activation;
    if (
      !parentBuilder ||
      typeof activation?.integrationWorktree !== 'string' ||
      typeof activation.integrationCommit !== 'string'
    ) {
      throw new Error('Native Supervisor Verifier lacks the parent integration candidate');
    }
    await assertSupervisorParentCheckWorkspace({
      run,
      projectRoot,
      state,
      worktree: activation.integrationWorktree,
      integrationCommit: nativeSdkSupervisorParentCandidateCommit(parentBuilder),
      builderActionId: parentBuilder.id,
    });
  }
  const covered = new Set<string>();
  const checks: NativeSdkCheckResult[] = [];
  let validated = false;
  const order = new Map<string, number>();
  for (const action of actions)
    for (const check of (action.outcome?.output as unknown as NativeSdkCheckOutcome)?.checks ?? [])
      if (!order.has(check.id)) order.set(check.id, order.size);
  for (const action of actions.slice().reverse()) {
    const ids = ((action.outcome?.output as unknown as NativeSdkCheckOutcome)?.checks ?? []).map(
      (check) => check.id,
    );
    if (validated && ids.every((id) => covered.has(id))) continue;
    const plans = checkPlansForAction(run, action, state.builder_handoff!.candidate_id);
    const current = await validatedCheckResults({
      run,
      action,
      outcome: action.outcome!,
      candidateId: state.builder_handoff!.candidate_id,
      plans,
      projectRoot,
    });
    validated = true;
    for (const check of current)
      if (!covered.has(check.id)) {
        checks.push(check);
        covered.add(check.id);
      }
  }
  checks.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
  return checks.map((check) => ({
    id: check.id,
    name: toNativePortableText(check.name),
    argv_display: check.argvDisplay.map((arg) => toNativePortableText(arg)),
    argv_truncated: false,
    cwd_ref: check.cwdRef,
    status: check.status,
    exit_code: check.exitCode,
    duration_ms: check.durationMs,
  }));
}

/** 刷新检查只能保留语义未变或已复核的候选，不能把代码改动当作排版重新绑定。 */
export async function assertNativeSdkCandidateUnchanged(options: {
  run: Readonly<WorkflowRun>;
  projectRoot: string;
  requireEvidence?: boolean;
  legacyArchiveOverlay?: NativeLegacyArchiveOverlay;
}) {
  const state = parseNativePortableState(options.run.state);
  if (!state.builder_handoff) return;
  const current = options.run.actions
    .slice()
    .reverse()
    .find(
      (action) =>
        ['verify.checks', 'verify.requested-checks'].includes(action.stepId) &&
        action.status === 'succeeded' &&
        (action.outcome?.output as { candidateId?: unknown } | undefined)?.candidateId ===
          state.builder_handoff!.candidate_id,
    );
  const recorded = (current?.outcome?.output as unknown as NativeSdkCheckOutcome | undefined)
    ?.candidateInputFingerprintGate;
  if (current && recorded === null) {
    if (options.requireEvidence) {
      const output = current.outcome?.output as unknown as NativeSdkCheckOutcome;
      const diagnostics = output.inputSnapshot?.diagnostics ?? [];
      throw new NativeSdkCandidateDriftError(
        `Native 本次检查未建立候选实现摘要${diagnostics.length ? `：${diagnostics.join('；')}` : '：候选输入采集失败或不完整'}；先排除输入读取问题，再通过原工作流重新验收，不能直接归档或复用旧证据`,
      );
    }
    return;
  }
  // 旧收据没有语义摘要；显式重新验收建立绑定，不能据此复用旧成功证据。
  if (!current || recorded === undefined) {
    if (options.requireEvidence)
      throw new NativeSdkCandidateDriftError(
        'Native 旧检查缺少候选实现摘要；请通过原工作流重新验收',
      );
    return;
  }
  const actual = await nativeSdkCandidateInputGate(options);
  if (actual === recorded) return;
  const legacy = await nativeSdkCandidateInputGate({ ...options, legacyExecutionBinding: true });
  if (legacy === recorded) return;
  throw new NativeSdkCandidateDriftError(
    'Native 候选实现已变化或无法完整复核；请通过原工作流修订，不能仅刷新检查来接受代码改动',
  );
}

/** Archive 可排除另有内容绑定的事务写入；其他路径仍使用原候选检查计划。 */
export async function nativeSdkCandidateInputGate(options: {
  run: Readonly<WorkflowRun>;
  projectRoot: string;
  archiveOwnedPaths?: readonly string[];
  legacyArchiveOverlay?: NativeLegacyArchiveOverlay;
  legacyExecutionBinding?: boolean;
  includeGeneratedInputs?: boolean;
}): Promise<string | null> {
  const state = parseNativePortableState(options.run.state);
  if (!state.builder_handoff) return null;
  const current = [...options.run.actions]
    .reverse()
    .find(
      (action) =>
        ['verify.checks', 'verify.requested-checks'].includes(action.stepId) &&
        action.status === 'succeeded' &&
        (action.outcome?.output as { candidateId?: unknown } | undefined)?.candidateId ===
          state.builder_handoff!.candidate_id,
    );
  if (!current) return null;
  const plans = checkPlansForAction(options.run, current, state.builder_handoff.candidate_id);
  const input = record(options.run.input, 'Native SDK Run input');
  if (typeof input.artifactRootRef !== 'string')
    throw new Error('Native candidate lacks its artifact root');
  const paths = await nativeProjectPaths(options.projectRoot, input.artifactRootRef, {
    readOnly: true,
  });
  const parent = state.children_contract_hash
    ? options.run.actions
        .slice()
        .reverse()
        .find(
          (action) =>
            action.stepId === 'supervisor.parent.builder' && action.status === 'succeeded',
        )
    : undefined;
  const executionRoot =
    (parent?.input as { activation?: { integrationWorktree?: string } } | undefined)?.activation
      ?.integrationWorktree ?? options.projectRoot;
  const gateOptions = {
    projectRoot: executionRoot,
    candidateId: state.builder_handoff.candidate_id,
    plans,
    managedArtifactRoot: await resolveArtifactRoot(executionRoot, input.artifactRootRef),
    editReviewScope: nativeEditReviewScope(paths, state),
    shapeSemanticSnapshot: (await readNativeApprovedShapeSemanticSnapshot({ paths, state }))
      ?.snapshot,
    legacyShapeSemanticSnapshot: state.shape_semantic_snapshot === undefined,
  };
  const candidate = await nativeCandidateInputGate({
    ...gateOptions,
    archiveOwnedPaths: options.archiveOwnedPaths,
    legacyArchiveOverlay: options.legacyArchiveOverlay,
    legacyExecutionBinding: options.legacyExecutionBinding,
  });
  if (!options.includeGeneratedInputs || candidate === null) return candidate;
  const snapshot = await nativeGeneratedCheckInputSnapshot({
    state,
    projectRoot: executionRoot,
    plans,
    managedArtifactRoot: gateOptions.managedArtifactRoot,
    generatedInputExclusions: options.archiveOwnedPaths,
  });
  return snapshot.complete
    ? hashRuntimeValue({ candidate, generatedInputs: snapshot.fingerprint })
    : null;
}

export async function nativeSdkSupervisorChildCheckSummaries(options: {
  run: Readonly<WorkflowRun>;
  checkActionId: string;
  projectRoot: string;
  /** 仅供 blocked 恢复保留原候选证据；不会把原检查视为后继提交的验收。 */
  allowCandidateSuccessor?: boolean;
}): Promise<{ child: string; candidateCommit: string; checkIds: string[] }> {
  const action = options.run.actions.find((candidate) => candidate.id === options.checkActionId);
  if (
    !action ||
    action.stepId !== 'supervisor.child.checks' ||
    action.status !== 'succeeded' ||
    action.claim?.executorId !== nativeSdkCheckExecutor.id ||
    !action.outcome
  ) {
    throw new Error('Native Supervisor Child Verifier lacks completed Runtime checks');
  }
  const { state, plans, executionRoot, candidateId, supervisorChild, supervisorBranch } =
    checkInput(options.run, action);
  if (!executionRoot || !supervisorChild || !supervisorBranch) {
    throw new Error('Native Supervisor Child checks lack their candidate binding');
  }
  await assertSupervisorCheckWorkspace({
    run: options.run,
    projectRoot: options.projectRoot,
    state,
    child: supervisorChild,
    worktree: executionRoot,
    branch: supervisorBranch,
    candidateCommit: candidateId,
    allowCandidateSuccessor: options.allowCandidateSuccessor,
  });
  const checks = await validatedCheckResults({
    run: options.run,
    action,
    outcome: action.outcome,
    candidateId,
    plans,
    projectRoot: options.projectRoot,
    allowCandidateSuccessor: options.allowCandidateSuccessor,
  });
  if (checks.length === 0 || checks.some(({ status }) => status !== 'passed')) {
    throw new Error('Native Supervisor Child checks did not all pass');
  }
  return {
    child: supervisorChild,
    candidateCommit: candidateId,
    checkIds: checks.map(({ id }) => id),
  };
}

export const nativeSdkCheckValidator: RuntimeValidator = {
  id: 'comet-native-check-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (!context?.projectRoot || action.claim?.executorId !== nativeSdkCheckExecutor.id) {
      return { accepted: false, reason: 'Native checks were not run by the Runtime executor' };
    }
    try {
      const {
        state,
        artifactRootRef,
        plans,
        executionRoot,
        candidateId,
        supervisorChild,
        supervisorBranch,
        supervisorIntegration,
        candidateCommit,
        mergeActionId,
        repairActionId,
        parentCandidateCommit,
        parentBuilderActionId,
      } = checkInput(run, action);
      const config = await readProjectConfig(context.projectRoot);
      if (!config || config.native.artifact_root !== artifactRootRef) {
        return { accepted: false, reason: 'Native artifact root changed after Run creation' };
      }
      const paths = await nativeProjectPaths(context.projectRoot, artifactRootRef);
      const drift = await inspectNativePortableAcceptanceDrift({ paths, state });
      if (drift.drifted)
        return { accepted: false, reason: drift.reason ?? 'Native acceptance changed' };
      if (supervisorChild && supervisorBranch && executionRoot) {
        if (supervisorIntegration && candidateCommit && mergeActionId) {
          await assertSupervisorIntegrationCheckWorkspace({
            run,
            projectRoot: context.projectRoot,
            state,
            child: supervisorChild,
            worktree: executionRoot,
            branch: supervisorBranch,
            integrationCommit: candidateId,
            candidateCommit,
            mergeActionId,
            repairActionId,
          });
        } else {
          await assertSupervisorCheckWorkspace({
            run,
            projectRoot: context.projectRoot,
            state,
            child: supervisorChild,
            worktree: executionRoot,
            branch: supervisorBranch,
            candidateCommit: candidateId,
          });
        }
      } else if (parentCandidateCommit && parentBuilderActionId && executionRoot) {
        await assertSupervisorParentCheckWorkspace({
          run,
          projectRoot: context.projectRoot,
          state,
          worktree: executionRoot,
          integrationCommit: parentCandidateCommit,
          builderActionId: parentBuilderActionId,
        });
      }
      await validatedCheckResults({
        run,
        action,
        outcome,
        candidateId,
        plans,
        projectRoot: context.projectRoot,
      });
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

/** 完整结果按原领取补交；显式修复可保留已停止的未知或输入过期结果，始终禁止重放原检查。 */
export async function recoverNativeSdkChecks(
  projectRoot: string,
  initial: WorkflowRun,
  runtime: WorkflowRuntime,
  options: {
    reconcileInterrupted?: boolean;
    stoppedActions?: readonly RuntimeStoppedAction[];
  } = {},
): Promise<WorkflowRun> {
  let run = initial;
  if (options.reconcileInterrupted) {
    if (!Array.isArray(options.stoppedActions) || options.stoppedActions.length === 0)
      throw new Error('确认中断核对时必须提供原执行及全部后代已停止的证据');
    const inspections = await inspectNativeSdkCheckExecutions({
      projectRoot,
      run,
      includeSettled: true,
    });
    const seen = new Set<string>();
    for (const stopped of options.stoppedActions) {
      const action = run.actions.find((entry) => entry.id === stopped?.actionId);
      if (!action || !nativeSdkCheckExecutor.supports(action) || seen.has(action.id))
        throw new Error('停止证据必须唯一绑定原 Native 检查 Action');
      assertStoppedAction(action, stopped);
      seen.add(action.id);
    }
    for (const stopped of options.stoppedActions) {
      const action = run.actions.find((entry) => entry.id === stopped.actionId)!;
      const item = inspections.find((entry) => entry.actionId === action.id);
      if (
        item?.execution &&
        !item.quiescent &&
        (!item.execution.child || process.platform === 'win32')
      )
        await acknowledgeNativeSdkCheckStopped({
          projectRoot,
          run,
          action,
          stoppedAction: stopped,
        });
    }
  }
  if (options.reconcileInterrupted) {
    const terminal = options.stoppedActions!.filter((stopped) =>
      ['succeeded', 'failed'].includes(
        run.actions.find((action) => action.id === stopped.actionId)!.status,
      ),
    );
    if (terminal.length) {
      const observations = await inspectNativeSdkCheckExecutions({
        projectRoot,
        run,
        includeSettled: true,
      });
      if (
        observations.some(
          (item) =>
            terminal.some((stopped) => stopped.actionId === item.actionId) &&
            item.phase !== 'missing' &&
            !item.quiescent,
        )
      )
        throw new Error('原检查仍未确认停止，不能登记终态执行停止事实');
      run = await runtime.acknowledgeStopped({
        runId: run.runId,
        expectedRevision: run.revision,
        stoppedActions: terminal,
      });
    }
  }
  if (run.status === 'cancelled' && options.reconcileInterrupted) {
    const inspections = await inspectNativeSdkCheckExecutions({
      projectRoot,
      run,
      includeSettled: true,
    });
    if (
      inspections.some(
        (item) =>
          options.stoppedActions!.some((stopped) => stopped.actionId === item.actionId) &&
          item.phase !== 'missing' &&
          !item.quiescent,
      )
    )
      throw new Error('原检查停止尚未确认；不能登记取消完成');
    return runtime.cancel({
      runId: run.runId,
      expectedRevision: run.revision,
      reason: run.reason ?? '用户确认原检查及全部后代已停止',
      stoppedActions: options.stoppedActions!.filter(
        (stopped) =>
          run.actions.find((action) => action.id === stopped.actionId)?.status === 'cancelled',
      ),
      context: { projectRoot, requestId: 'native-check-cancellation-recovery' },
    });
  }
  run = await reconcileNativeSdkExecutionStops(projectRoot, run, runtime);
  if (run.status === 'cancelled' || run.status === 'completed') return run;
  for (const item of await inspectNativeSdkCheckExecutions({ projectRoot, run })) {
    if (!item.recoveryRequired) continue;
    const action = run.actions.find((entry) => entry.id === item.actionId)!;
    if (!['running', 'unknown'].includes(action.status)) continue;
    const stoppedActions =
      options.stoppedActions?.filter((entry) => entry.actionId === action.id) ?? [];
    if (stoppedActions.length > 1) throw new Error('不能重复提交同一 Action 的停止证据');
    let completedInputDrift = false;
    if (item.quiescent && item.execution?.phase === 'completed' && item.execution.outcome) {
      const outcome: RuntimeOutcome = {
        ...item.execution.outcome,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim!.token,
        outcomeId: `${action.id}:${action.attempt}:executor-result`,
      };
      const validation = await nativeSdkCheckValidator.validate({
        run,
        action,
        outcome,
        context: { projectRoot, requestId: 'native-check-recovery' },
      });
      if (validation.accepted) {
        run = await runtime.recordOutcome({
          runId: run.runId,
          expectedRevision: run.revision,
          outcome,
          context: { projectRoot, requestId: 'native-check-recovery' },
        });
        continue;
      }
      completedInputDrift = await nativeSdkCompletedCheckInputDrift(
        { run, action, projectRoot },
        item.execution.outcome,
      );
    }

    if (
      options.reconcileInterrupted &&
      stoppedActions.length === 1 &&
      (completedInputDrift ||
        item.phase === 'missing' ||
        (item.quiescent &&
          item.execution &&
          !item.execution.outcome &&
          (item.owner === 'dead' || item.phase === 'interrupted')))
    ) {
      assertStoppedAction(action, stoppedActions[0]);
      await requestNativeSdkCheckStop({ projectRoot, run, action });
      const checks = item.execution?.checks ?? [];
      const { actionId, attempt, inputHash, evidence } = stoppedActions[0];
      const { candidateId, plans } = checkInput(run, action);
      const observedAt = new Date().toISOString();
      const interruption: NativeSdkCheckInterruption = {
        kind: completedInputDrift ? 'completed-input-drift' : 'execution-unknown',
        stoppedAction: { actionId, attempt, inputHash, evidence },
        processBoundary: item.processBoundary,
        candidateId,
        plansHash: hashRuntimeValue(plans as unknown as RuntimeValue),
        executionHash: item.execution
          ? hashRuntimeValue(item.execution as unknown as RuntimeValue)
          : null,
        unknownCheckIds: plans.slice(checks.length).map((plan) => plan.id),
        partialLogs: await partialCheckLogs(projectRoot, run, action, plans, checks.length),
        observedAt,
      };
      const outcome: RuntimeOutcome = {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim!.token,
        // 提交时再次校验可能拒绝旧提案；新核对不能复用已拒绝的结果标识。
        outcomeId: `${action.id}:${action.attempt}:interrupted-reconciliation:${action.rejectedOutcomes?.length ?? 0}`,
        status: 'failed',
        output: {
          candidateId,
          checks,
          interruption,
          completedAt: observedAt,
        } as unknown as RuntimeValue,
        summary: completedInputDrift
          ? '原检查已完成且已确认停止，但检查输入随后变化；保留原结果与日志，不将旧成功作为当前候选验收，等待批准新的修复候选。'
          : '原检查执行结果未知；已记录原领取方或用户提供的全部执行停止证据，保留实际部分结果与日志，等待批准新的修复候选。',
      };
      const validation = await nativeSdkCheckValidator.validate({
        run,
        action,
        outcome,
        context: { projectRoot, requestId: 'native-check-interruption-recovery' },
      });
      if (!validation.accepted) throw new Error(validation.reason ?? 'Native 中断证据核对失败');
      run = await runtime.recordOutcome({
        runId: run.runId,
        expectedRevision: run.revision,
        outcome,
        context: { projectRoot, requestId: 'native-check-interruption-recovery' },
      });
      continue;
    }
    if (action.status === 'running' && item.owner !== 'alive') {
      run = await runtime.markUnknown({
        runId: run.runId,
        expectedRevision: run.revision,
        actionId: action.id,
        attempt: action.attempt,
        reason:
          item.reason ??
          '检查执行归属已丢失或无法确认；保留原进程及逐项证据，核对副作用后提交原领取结果。不能声明未执行或自动重跑。',
      });
    }
  }
  return reconcileNativeSdkExecutionStops(projectRoot, run, runtime);
}
