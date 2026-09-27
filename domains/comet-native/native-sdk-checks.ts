import path from 'node:path';

import { inspectGitWorktree, resolveGitRef, samePath } from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';
import {
  hashProtectedProjectFile,
  ensureProtectedProjectDirectory,
} from '../workflow-contract/protected-project-path.js';
import {
  type RuntimeAction,
  type RuntimeExecutor,
  type RuntimeOutcome,
  type RuntimeValidator,
  type RuntimeValue,
  type WorkflowRun,
  hashRuntimeValue,
} from '../engine/runtime.js';
import {
  executeNativeCheck,
  nativeCheckPlanKey,
  nativePortableArgvDisplay,
  preflightNativeCheckPlans,
  type NativeCheckPlan,
} from './native-check-executor.js';
import { readProjectConfig } from './native-config.js';
import { nativeProjectPaths } from './native-paths.js';
import { inspectNativePortableAcceptanceDrift } from './native-portable-requirements.js';
import { parseNativePortableState } from './native-portable-state.js';
import { currentNativeSdkSupervisorPlan } from './native-sdk-supervisor-prepare.js';
import { nativeSdkSupervisorParentCandidateCommit } from './native-sdk-supervisor-parent.js';
import {
  nativeSupervisorChildWorktree,
  nativeSupervisorIntegrationBranch,
  nativeSupervisorIntegrationWorktree,
} from './native-supervisor-workspace.js';
import { toNativePortableText } from './native-portable-text.js';
import type { NativePortableCheckSummary } from './native-portable-types.js';

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
}

interface NativeSdkCheckOutcome {
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
  if (!requested)
    return nativeSdkCheckPlans(outputs['supervisor.parent.builder'] ?? outputs['build.builder']);
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
    for (const plan of priorPlans) priorKeys.add(nativeCheckPlanKey(plan));
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
    resolveGitRef(options.worktree, options.branch) !== options.candidateCommit
  ) {
    throw new Error('Native Supervisor checks no longer match the Child candidate');
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
  return `.comet/runtime/native/sdk-checks/${hashRuntimeValue(run.runId)}`;
}

function checkOperationId(action: Readonly<RuntimeAction>): string {
  return hashRuntimeValue({ actionId: action.id, attempt: action.attempt });
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
    if (action.stepId === 'verify.requested-checks') {
      await nativeSdkCurrentCheckSummaries({ run, projectRoot: context.projectRoot });
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
    await ensureProtectedProjectDirectory(context.projectRoot, `${runtimeRef}/logs/checks`, {
      label: 'Native SDK check logs',
    });
    const runtimeDir = path.join(context.projectRoot, ...runtimeRef.split('/'));
    const operationId = checkOperationId(action);
    const checks: NativeSdkCheckResult[] = [];
    for (const plan of plans) {
      const executed = await executeNativeCheck({
        projectRoot: checkRoot,
        runtimeDir,
        operationId,
        plan,
      });
      const logRef = `${runtimeRef}/${executed.logRef}`;
      const log = await hashProtectedProjectFile(context.projectRoot, logRef, {
        label: 'Native SDK check log',
      });
      checks.push({
        id: executed.id,
        name: executed.name,
        argvDisplay: executed.argvDisplay,
        cwdRef: executed.cwdRef,
        status: executed.status,
        exitCode: executed.exitCode,
        durationMs: executed.durationMs,
        logRef,
        logSha256: log.digest,
      });
    }
    return {
      status: checks.every((check) => check.status === 'passed') ? 'succeeded' : 'failed',
      output: {
        candidateId,
        checks,
        completedAt: new Date().toISOString(),
      } as unknown as RuntimeValue,
    };
  },
};

async function validatedCheckResults(options: {
  run: Readonly<WorkflowRun>;
  action: Readonly<RuntimeAction>;
  outcome: Readonly<RuntimeOutcome>;
  candidateId: string;
  plans: NativeCheckPlan[];
  projectRoot: string;
}): Promise<NativeSdkCheckResult[]> {
  const { run, action, outcome, candidateId, plans, projectRoot } = options;
  const output = record(outcome.output, 'Native check outcome') as unknown as NativeSdkCheckOutcome;
  if (
    output.candidateId !== candidateId ||
    !Array.isArray(output.checks) ||
    output.checks.length !== plans.length ||
    typeof output.completedAt !== 'string' ||
    Number.isNaN(Date.parse(output.completedAt)) ||
    new Date(output.completedAt).toISOString() !== output.completedAt
  ) {
    throw new Error('Native check outcome changed candidate or plan');
  }
  const runtimeRef = checkRuntimeRef(run);
  const operationId = checkOperationId(action);
  for (const [index, plan] of plans.entries()) {
    const check = record(
      output.checks[index],
      `Native check ${index}`,
    ) as unknown as NativeSdkCheckResult;
    const expectedRef = `${runtimeRef}/logs/checks/${operationId}-${plan.id}.log`;
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
      check.logRef !== expectedRef ||
      typeof check.logSha256 !== 'string'
    ) {
      throw new Error('Native check receipt does not match the bound plan');
    }
    const log = await hashProtectedProjectFile(projectRoot, check.logRef, {
      label: 'Native SDK check log',
    });
    if (log.digest !== check.logSha256) {
      throw new Error('Native check log changed after execution');
    }
  }
  const allPassed = output.checks.every((check) => check.status === 'passed');
  if ((outcome.status === 'succeeded') !== allPassed) {
    throw new Error('Native check status disagrees with its results');
  }
  return output.checks;
}

export async function nativeSdkCurrentCheckSummaries(options: {
  run: Readonly<WorkflowRun>;
  projectRoot: string;
}): Promise<NativePortableCheckSummary[]> {
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
    state.phase !== 'verify' ||
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
  const checks = (
    await Promise.all(
      actions.map(async (action) => {
        const plans = checkPlansForAction(run, action, state.builder_handoff!.candidate_id);
        return validatedCheckResults({
          run,
          action,
          outcome: action.outcome!,
          candidateId: state.builder_handoff!.candidate_id,
          plans,
          projectRoot,
        });
      }),
    )
  ).flat();
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
  });
  const checks = await validatedCheckResults({
    run: options.run,
    action,
    outcome: action.outcome,
    candidateId,
    plans,
    projectRoot: options.projectRoot,
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
