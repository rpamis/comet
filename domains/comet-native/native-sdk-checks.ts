import path from 'node:path';
import { resolveWorkspaceRuntimeRoot } from '../workflow-contract/workspace-runtime.js';
import { nativeSupervisorContractRef } from './native-children-contract.js';
import { nativeProjectPaths } from './native-paths.js';

import { inspectGitWorktree, resolveGitRef, samePath } from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';
import { reportCometRuntimeProgress } from '../../platform/process/runtime-metrics.js';
import {
  hashRuntimeValue,
  type RuntimeAction,
  type RuntimeCommandValidator,
  type RuntimeExecutor,
  type RuntimeOutcome,
  type RuntimeStoppedAction,
  type RuntimeValidator,
  type RuntimeValue,
  type WorkflowRun,
  type WorkflowRuntime,
} from '../engine/runtime.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
} from '../workflow-contract/protected-project-path.js';
import {
  executeNativeCheck,
  isNativeCheckTerminationUnconfirmedError,
  nativeCheckInvocationKey,
  nativeCheckPlanKey,
  nativePortableArgvDisplay,
  normalizeNativeCheckOutputs,
  preflightNativeCheckPlans,
  type NativeCheckPlan,
} from './native-check-executor.js';
import { readProjectConfig } from './native-config.js';
import { parseNativePortableState } from './native-portable-state.js';
import { toNativePortableText } from './native-portable-text.js';
import type { NativePortableCheckSummary } from './native-portable-types.js';
import {
  acknowledgeNativeSdkCheckStopped,
  createNativeSdkCheckExecution,
  hasNativeSdkCheckStopRequest,
  inspectNativeSdkCheckExecutions,
  nativeSdkCheckRuntimeRef,
  nativeSdkCheckStorageRef,
  reconcileNativeSdkExecutionStops,
  requestNativeSdkCheckStop,
} from './native-sdk-check-execution.js';
import { nativeSdkSupervisorParentCandidateCommit } from './native-sdk-supervisor-parent.js';
import { currentNativeSdkSupervisorPlan } from './native-sdk-supervisor-prepare.js';
import {
  nativeSupervisorChildWorktree,
  nativeSupervisorIntegrationBranch,
  nativeSupervisorIntegrationWorktree,
} from './native-supervisor-workspace.js';

/** 已完成检查的输入发生变化；这不是执行结果未知。 */
export class NativeSdkCheckResultError extends Error {}

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
  if (plans.some((plan) => !plan.repeatable)) return false;
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
  const candidateId = parseNativePortableState(run.state).builder_handoff?.candidate_id;
  return plans.every(
    (plan) =>
      plan.repeatable ||
      run.actions.slice(start + 1).some((action) => {
        const output = action.outcome?.output as unknown as NativeSdkCheckOutcome | undefined;
        if (!output || !candidateId) return false;
        return (
          action.stepId === 'verify.requested-checks' &&
          ['succeeded', 'failed'].includes(action.status) &&
          output?.candidateId === candidateId &&
          checkPlansForAction(run, action, candidateId!).some(
            (original) =>
              hashRuntimeValue(original as unknown as RuntimeValue) ===
              hashRuntimeValue(plan as unknown as RuntimeValue),
          ) &&
          output.checks.some(
            (check) => check.id === plan.id && check.status === 'passed' && check.exitCode === 0,
          )
        );
      }),
  );
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
  partialLogs: { logRef: string }[];
  observedAt: string;
}

interface NativeSdkCheckOutcome {
  interruption?: NativeSdkCheckInterruption;
  candidateId: string;
  checks: NativeSdkCheckResult[];
  completedAt: string;
}

interface NativeCheckRefreshInput {
  archiveActionId: string;
  approvalWaitId: string;
  proposalHash: string;
  checkIds: string[];
  summary: string;
}

/** 补充检查沿用原批准，只能替换尚未执行的归档步骤。 */
export function nativeSdkCheckRefreshInput(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
): NativeCheckRefreshInput | null {
  const activation = (action.input as { activation?: unknown }).activation;
  if (
    !activation ||
    !run.commands?.some(
      (command) =>
        command.name === 'refresh-checks' &&
        command.actionId === action.id &&
        command.inputHash === hashRuntimeValue(activation as RuntimeValue),
    )
  )
    return null;
  return activation as NativeCheckRefreshInput;
}

function pendingCheckRefresh(run: Readonly<WorkflowRun>) {
  const pending = run.actions.filter((action) => action.status === 'pending');
  const approval = [...run.waits]
    .reverse()
    .find(
      (wait) =>
        wait.stepId === 'verify.confirm' &&
        wait.status === 'resolved' &&
        wait.decision?.choice === 'approved',
    );
  const archive = pending[0];
  const state = parseNativePortableState(run.state);
  if (
    state.phase !== 'archive' ||
    state.status !== 'active' ||
    state.archived ||
    state.children_contract_ref ||
    !approval ||
    pending.length !== 1 ||
    !['archive.prepare', 'archive.execute'].includes(archive.stepId) ||
    run.ready.length ||
    run.waits.some((wait) => wait.status === 'pending') ||
    run.evidenceWaits?.some((wait) => wait.status === 'pending') ||
    run.actions.some(
      (action) =>
        ['running', 'unknown'].includes(action.status) ||
        (action.stepId === 'archive.execute' &&
          (action.claim ||
            action.attempt !== 1 ||
            action.receipts.length ||
            !['pending', 'cancelled'].includes(action.status))),
    )
  )
    return null;
  return { archive, approval };
}
export const nativeSdkCheckRefreshCommandValidator: RuntimeCommandValidator = {
  id: 'comet-native-check-refresh-command',
  version: '1',
  async validate({ run, name, input, context }) {
    const pending = pendingCheckRefresh(run);
    const request = input as unknown as NativeCheckRefreshInput;
    if (
      name !== 'refresh-checks' ||
      !context?.projectRoot ||
      !pending ||
      request.archiveActionId !== pending.archive.id ||
      request.approvalWaitId !== pending.approval.id ||
      request.proposalHash !== pending.approval.proposalHash ||
      !request.summary?.trim() ||
      !Array.isArray(request.checkIds) ||
      !request.checkIds.length
    )
      return { accepted: false, reason: '补充检查需要原 Run 的批准、待执行归档步骤和明确检查范围' };
    const plans = allCandidateCheckPlans(run);
    if (request.checkIds.some((id) => !plans.some((plan) => plan.id === id && plan.repeatable)))
      return { accepted: false, reason: '只能补充原计划中可重复的检查' };
    return { accepted: true };
  },
};

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
  const issues: string[] = [];
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push(`verificationChecks[${index}] must be an object`);
      return;
    }
    const row = entry as Record<string, unknown>;
    for (const [key, valid] of Object.entries({
      id: typeof row.id === 'string' && !!row.id,
      name: typeof row.name === 'string' && !!row.name,
      executable: typeof row.executable === 'string' && !!row.executable,
      argv: Array.isArray(row.argv) && row.argv.every((arg) => typeof arg === 'string'),
      cwdRef: typeof row.cwdRef === 'string' && !!row.cwdRef,
      timeoutMs: Number.isSafeInteger(row.timeoutMs) && (row.timeoutMs as number) > 0,
      repeatable: typeof row.repeatable === 'boolean',
    }))
      if (!valid) issues.push(`verificationChecks[${index}].${key} is missing or invalid`);
    if (row.outputs !== undefined) {
      try {
        normalizeNativeCheckOutputs(row.outputs);
      } catch (error) {
        issues.push(`verificationChecks[${index}].outputs: ${(error as Error).message}`);
      }
    }
  });
  if (issues.length) throw new Error(`Native check plan fields are invalid:\n${issues.join('\n')}`);
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
      ...(plan.reusable === undefined ? {} : { reusable: plan.reusable === true }),
      ...(plan.outputs === undefined ? {} : { outputs: normalizeNativeCheckOutputs(plan.outputs) }),
    };
  });
}

function checkPlansForAction(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  candidateId: string,
): NativeCheckPlan[] {
  if (action.stepId === 'build.checks') {
    const activation = record(
      record(action.input, 'Build checks input').activation,
      'Build checks plan',
    );
    return nativeSdkCheckPlans({ verificationChecks: activation.checks });
  }
  if (nativeSdkCheckRefreshInput(run, action)) {
    return allCandidateCheckPlans(
      run,
      run.actions.findIndex((entry) => entry.id === action.id),
    );
  }
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
    for (const plan of requestedPlans) priorById.set(plan.id, plan);
    return [...priorById.values()];
  }
  return requestedPlans.filter((plan) => !priorKeys.has(nativeCheckPlanKey(plan)));
}

/** Verifier 后加的检查与 Builder 原计划一并保留，不能只看最近一次基础检查。 */
function allCandidateCheckPlans(run: Readonly<WorkflowRun>, before = run.actions.length) {
  const actions = run.actions.slice(0, before);
  const builderIndex = actions
    .map(
      (action) =>
        ['build.builder', 'supervisor.parent.builder'].includes(action.stepId) &&
        action.status === 'succeeded',
    )
    .lastIndexOf(true);
  if (builderIndex < 0) throw new Error('补充检查缺少原 Builder 计划');
  const plans = new Map(
    nativeSdkCheckPlans(actions[builderIndex].outcome?.output).map((plan) => [plan.id, plan]),
  );
  for (const action of actions.slice(builderIndex + 1)) {
    if (action.stepId !== 'verify.requested-checks' || !action.outcome) continue;
    const response = record(
      record(record(action.input, 'Native check input').outputs, 'Native check outputs')[
        'verify.verifier'
      ],
      'Native Verifier request',
    ).response;
    for (const plan of nativeSdkCheckPlans({
      verificationChecks: record(response, 'Native check request response').checks,
    }))
      plans.set(plan.id, plan);
  }
  return [...plans.values()];
}

function checkInput(run: Readonly<WorkflowRun>, action: Readonly<RuntimeAction>) {
  const state = parseNativePortableState(run.state);

  const input = record(run.input, 'Native SDK Run input');
  if (action.stepId === 'build.checks') {
    if (
      !['3', '4'].includes(run.workflow.version) ||
      state.phase !== 'build' ||
      state.status !== 'active' ||
      state.children_contract_ref ||
      input.name !== state.name ||
      typeof input.artifactRootRef !== 'string' ||
      action.ref !== 'native-build-checks'
    )
      throw new Error('Build checks require an active built-in Builder task');
    const plans = checkPlansForAction(run, action, action.id);
    if (!plans.length || plans.some((plan) => !plan.repeatable))
      throw new Error('Build checks require a nonempty repeatable plan');
    return {
      state,
      artifactRootRef: input.artifactRootRef,
      plans,
      executionRoot: null,
      candidateId: action.id,
      supervisorChild: null,
      supervisorBranch: null,
      supervisorIntegration: false,
      candidateCommit: null,
      mergeActionId: null,
      repairActionId: null,
      parentCandidateCommit: null,
      parentBuilderActionId: null,
    };
  }
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
      nativeSupervisorContractRef(activation) !== state.children_contract_ref
    ) {
      throw new Error('Native Supervisor integration checks lack their merge binding');
    }
    const plans = nativeSdkCheckPlans({ verificationChecks: activation.integrationChecks });
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
      nativeSupervisorContractRef(activation) !== state.children_contract_ref
    ) {
      throw new Error('Native Supervisor checks are not bound to the current Child candidate');
    }
    const plans = nativeSdkCheckPlans({ verificationChecks: activation.verificationChecks });
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
  const refresh = nativeSdkCheckRefreshInput(run, action);
  if (
    (state.phase !== 'verify' && !(state.phase === 'archive' && refresh)) ||
    state.status !== 'active' ||
    (!refresh && state.loop.stage !== 'verify-ready') ||
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
  const parentBuilder = state.children_contract_ref
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
  if (state.children_contract_ref && !parentActivation) {
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
    nativeSupervisorContractRef(activation) !== options.state.children_contract_ref ||
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

/** Agent 明确选择跨候选复用；原执行者、命令、结果与来源保持不变。 */
async function reusableRuntimeCheck(options: {
  run: Readonly<WorkflowRun>;
  action: Readonly<RuntimeAction>;
  plan: NativeCheckPlan;
  projectRoot: string;
}): Promise<NativeSdkCheckResult | null> {
  const before = options.run.actions.findIndex((entry) => entry.id === options.action.id);
  const candidateId = parseNativePortableState(options.run.state).builder_handoff?.candidate_id;
  for (const prior of options.run.actions.slice(0, before).reverse()) {
    if (!['build.checks', 'verify.checks', 'verify.requested-checks'].includes(prior.stepId))
      continue;
    const output = prior.outcome?.output as unknown as NativeSdkCheckOutcome | undefined;
    if (!output?.checks) continue;
    const plans = checkPlansForAction(options.run, prior, output.candidateId);
    const index = plans.findIndex(
      (plan) => nativeCheckPlanKey(plan) === nativeCheckPlanKey(options.plan),
    );
    if (index < 0) continue;
    const check = output.checks[index];
    if (
      !prior.outcome ||
      !['succeeded', 'failed'].includes(prior.status) ||
      output.interruption ||
      !check ||
      check.status !== 'passed' ||
      check.exitCode !== 0
    )
      return null;
    if (output.candidateId !== candidateId && !options.plan.reusable) return null;
    await validatedCheckResults({
      run: options.run,
      action: prior,
      outcome: prior.outcome,
      candidateId: output.candidateId,
      plans,
      projectRoot: options.projectRoot,
      allowCandidateSuccessor: true,
      requiredCheckIds: new Set([check.id]),
    });
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
      'native-build-checks',
      'native-required-checks',
      'native-verifier-requested-checks',
      'native-supervisor-child-checks',
      'native-supervisor-integration-checks',
    ].includes(action.ref),
  async preflight(action, context, run) {
    if (!run || !context?.projectRoot) throw new Error('Native checks require a bound SDK Run');
    const { plans, executionRoot } = checkInput(run, action);
    if (run.workflow.version !== '1' && plans.some((plan) => !plan.repeatable)) {
      throw new Error(
        'Verify requires repeatable checks. Run one-time operations through the authorized delivery workflow.',
      );
    }
    preflightNativeCheckPlans(executionRoot ?? context.projectRoot, plans);
  },
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

    preflightNativeCheckPlans(checkRoot, plans);
    const runtimeRef = checkRuntimeRef(run);
    const paths = await nativeProjectPaths(context.projectRoot, artifactRootRef);
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
      const nonRepeatableExecutions = new Set<string>();
      for (const prior of run.actions) {
        if (
          prior.id === action.id ||
          !['verify.checks', 'verify.requested-checks'].includes(prior.stepId)
        )
          continue;
        const output = prior.outcome?.output as unknown as NativeSdkCheckOutcome | undefined;
        if (!output?.checks?.length) continue;
        const completedIds = new Set(output.checks.map((check) => check.id));
        for (const original of checkPlansForAction(run, prior, output.candidateId))
          if (!original.repeatable && completedIds.has(original.id))
            nonRepeatableExecutions.add(nativeCheckInvocationKey(original));
      }
      for (const plan of plans) {
        await registration.assertNotStopped();
        const reused = nativeSdkCheckRefreshInput(run, action)?.checkIds.includes(plan.id)
          ? null
          : await reusableRuntimeCheck({
              run,
              action,
              plan,
              projectRoot: context.projectRoot,
            });
        if (reused) {
          reportCometRuntimeProgress(`复用检查 ${plan.name}`);
          checks.push(reused);
          registration.execution.checks = checks as unknown as RuntimeValue[];
          await registration.save();
          continue;
        }
        const refresh = nativeSdkCheckRefreshInput(run, action);
        if (refresh && !refresh.checkIds.includes(plan.id))
          throw new Error(
            `未选检查 ${plan.id} 的保留证据在执行期间失效；保留实际结果并核对新增变化，禁止执行未选检查`,
          );
        if (nonRepeatableExecutions.has(nativeCheckInvocationKey(plan)))
          throw new Error(
            `检查 ${plan.id} 不可重复执行，且当前输入没有有效的保留判断；需要确认后续验证方式`,
          );
        // 下一监管器尚无 PID 时也先保留未知边界，不能沿用上一条检查的停止收据。
        delete registration.execution.child;
        registration.execution.checkId = plan.id;
        registration.execution.phase = 'reserved';
        registration.execution.terminationUnconfirmed = true;
        await registration.save();
        reportCometRuntimeProgress(`运行缺失检查 ${plan.name}`);
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
        });
        registration.execution.checks = checks as unknown as RuntimeValue[];
        await registration.save();
      }
      const result = {
        status: checks.every((check) => check.status === 'passed' && check.exitCode === 0)
          ? ('succeeded' as const)
          : ('failed' as const),
        output: {
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
  requiredCheckIds?: ReadonlySet<string>;
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
  if (
    output.candidateId !== candidateId ||
    !Array.isArray(output.checks) ||
    (output.interruption
      ? output.checks.length > plans.length
      : output.checks.length !== plans.length) ||
    typeof output.completedAt !== 'string' ||
    Number.isNaN(Date.parse(output.completedAt))
  ) {
    throw new Error('Native check outcome changed candidate or plan');
  }
  if (output.interruption) await validateInterruptedCheckOutcome(options, output);
  for (const [index, plan] of plans.slice(0, output.checks.length).entries()) {
    const check = record(
      output.checks[index],
      'Native check result',
    ) as unknown as NativeSdkCheckResult;
    if (options.requiredCheckIds && !options.requiredCheckIds.has(check.id)) continue;
    let expectedRef =
      checkRuntimeRef(run) + '/logs/checks/' + checkOperationId(action) + '-' + plan.id + '.log';
    if (check.reusedFrom) {
      const origin = check.reusedFrom;
      const prior = run.actions.find((entry) => entry.id === origin.actionId);
      const priorOutput = prior?.outcome?.output as unknown as NativeSdkCheckOutcome | undefined;
      const original = priorOutput?.checks.find((entry) => entry.id === origin.checkId);
      if (
        !prior ||
        !prior.outcome ||
        prior.attempt !== origin.attempt ||
        prior.claim?.executorId !== nativeSdkCheckExecutor.id ||
        run.actions.indexOf(prior) >= run.actions.findIndex((entry) => entry.id === action.id) ||
        !['succeeded', 'failed'].includes(prior.status) ||
        priorOutput?.interruption ||
        priorOutput?.candidateId !== origin.candidateId ||
        !original ||
        original.status !== 'passed' ||
        original.exitCode !== 0 ||
        original.durationMs !== check.durationMs ||
        original.logRef !== check.logRef
      ) {
        throw new Error('Native reused check does not match its original execution');
      }
      const originalPlan = checkPlansForAction(run, prior, origin.candidateId).find(
        (entry) => entry.id === origin.checkId,
      );
      if (!originalPlan || nativeCheckPlanKey(originalPlan) !== nativeCheckPlanKey(plan)) {
        throw new Error('Native reused check command differs from its original execution');
      }
      const intervening = run.actions.slice(
        run.actions.indexOf(prior) + 1,
        run.actions.findIndex((entry) => entry.id === action.id),
      );
      if (
        intervening.some((entry) => {
          const value = entry.outcome?.output as unknown as NativeSdkCheckOutcome | undefined;
          return (
            ['build.checks', 'verify.checks', 'verify.requested-checks'].includes(entry.stepId) &&
            value?.checks?.some((result) => result.id === origin.checkId)
          );
        })
      )
        throw new Error('Native reused check was superseded by another execution');
      expectedRef = nativeSdkCheckStorageRef(original.logRef);
    }
    if (
      check.id !== plan.id ||
      check.name !== plan.name ||
      check.cwdRef !== plan.cwdRef ||
      JSON.stringify(check.argvDisplay) !== JSON.stringify(nativePortableArgvDisplay(plan.argv)) ||
      !['passed', 'failed', 'interrupted'].includes(check.status) ||
      !Number.isSafeInteger(check.durationMs) ||
      check.durationMs < 0 ||
      (check.exitCode !== null && !Number.isSafeInteger(check.exitCode)) ||
      typeof check.logRef !== 'string' ||
      nativeSdkCheckStorageRef(check.logRef) !== expectedRef
    ) {
      throw new Error('Native check result does not match its command or execution');
    }
  }
  const allPassed =
    !output.interruption &&
    output.checks.every((check) => check.status === 'passed' && check.exitCode === 0);
  if ((outcome.status === 'succeeded') !== allPassed)
    throw new Error('Native check status disagrees with its results');
  return output.checks;
}

async function partialCheckLogs(
  projectRoot: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  plans: NativeCheckPlan[],
  completed: number,
) {
  const logs: { logRef: string }[] = [];
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
    logs.push({ logRef });
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
  const registeredStopped =
    item?.quiescent &&
    item.execution &&
    interruption.kind === 'execution-unknown' &&
    !item.execution.outcome &&
    (item.owner === 'dead' || item.phase === 'interrupted') &&
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
  const checks = await currentCheckSummaries(options, 'archive');
  if (checks.some((check) => check.status !== 'passed'))
    throw new NativeSdkCheckResultError(
      '最新检查仍有失败、中断或未执行项；保留原批准并修复受影响检查，不能用旧成功结果归档',
    );
}

async function currentCheckSummaries(
  options: {
    run: Readonly<WorkflowRun>;
    projectRoot: string;
  },
  phase: 'verify' | 'archive',
): Promise<NativePortableCheckSummary[]> {
  const { run, projectRoot } = options;

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
  const state = parseNativePortableState(run.state);
  if (
    state.phase !== phase ||
    !state.builder_handoff ||
    !actions.some((entry) => entry.stepId === 'verify.checks') ||
    actions.some((entry) => entry.claim?.executorId !== nativeSdkCheckExecutor.id || !entry.outcome)
  ) {
    throw new Error('Native Verifier lacks completed Runtime checks for its candidate');
  }
  if (state.children_contract_ref) {
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
      requiredCheckIds: new Set(ids.filter((id) => !covered.has(id))),
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
  if (checks.some(({ status }) => status !== 'passed')) {
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
    }

    if (
      options.reconcileInterrupted &&
      stoppedActions.length === 1 &&
      (item.phase === 'missing' ||
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
        kind: 'execution-unknown',
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
        summary:
          '原检查执行结果未知；已记录原领取方或用户提供的全部执行停止证据，保留实际部分结果与日志，等待批准新的修复候选。',
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
