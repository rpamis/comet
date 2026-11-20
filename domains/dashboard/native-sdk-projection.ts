import type {
  NativeChildrenContract,
  NativeChildStatusProjection,
} from '../comet-native/native-children.js';
import { nativeSupervisorContractRef } from '../comet-native/native-children-contract.js';
import {
  createNativePortableState,
  parseNativePortableState,
} from '../comet-native/native-portable-state.js';
import { readNativeSdkRunRecord } from '../comet-native/native-sdk-state-store.js';
import { currentNativeSdkSupervisorActions } from '../comet-native/native-sdk-supervisor-plan.js';
import { projectNativeSdkAcceptanceEvidence } from '../comet-native/native-sdk-acceptance-evidence.js';
import { readChangeRuntimeOwner } from '../workflow-contract/change-runtime-owner.js';
import { readWorkflowApplicationRun } from '../workflow-application/application-run-record.js';
import { workflowAttentionFromRun, type WorkflowAttentionState } from './workflow-attention.js';
import {
  adaptNativeDashboardChange,
  type NativeDashboardChangeProjection,
  type NativeDashboardChildSummary,
  type NativeDashboardLocalExecutionSummary,
} from './native-adapter.js';

type SdkInspection = {
  run: NonNullable<Awaited<ReturnType<typeof readNativeSdkRunRecord>>>;
  state: ReturnType<typeof parseNativePortableState>;
};
type Action = SdkInspection['run']['actions'][number];

export interface NativeDashboardSdkChild extends NativeChildStatusProjection {
  archiveName: string | null;
  localExecution: NativeDashboardLocalExecutionSummary;
  attention: WorkflowAttentionState | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function activation(action: Action): Record<string, unknown> | null {
  return record(record(action.input)?.activation);
}

function failed(action: Action): boolean {
  const output = record(action.outcome?.output);
  return (
    action.status === 'failed' ||
    action.status === 'unknown' ||
    output?.verdict === 'fail' ||
    output?.verdict === 'blocked' ||
    (Array.isArray(output?.checks) &&
      output.checks.some((check) => (record(check)?.result ?? record(check)?.status) === 'failed'))
  );
}

/** 展示已确认的当前轮事实，不创建或修复旧 Supervisor 状态。 */
function childProgress(
  { run, state }: SdkInspection,
  projectRoot: string,
): NativeDashboardSdkChild[] {
  const confirmed = record(run.outputs['shape.prepare']?.value);
  const children = record(confirmed?.children);
  const contract = (state.children_contract ?? children?.contract) as
    NativeChildrenContract | undefined;
  if (!contract || state.phase === 'shape' || !state.children_contract_ref) return [];
  const actions = currentNativeSdkSupervisorActions(run).filter(
    (action) =>
      action.stepId.startsWith('supervisor.child.') &&
      nativeSupervisorContractRef(activation(action), run) === state.children_contract_ref &&
      action.status !== 'cancelled',
  );
  const latest = new Map<string, Action>();
  for (const action of actions) {
    const child = activation(action)?.child;
    if (typeof child === 'string') latest.set(child, action);
  }
  const integrated = new Set(
    [...latest]
      .filter(
        ([, action]) =>
          (action.stepId === 'supervisor.child.integration-checks' ||
            action.stepId === 'supervisor.child.archive') &&
          action.status === 'succeeded' &&
          !failed(action),
      )
      .map(([name]) => name),
  );
  const lastDispatch = [...actions]
    .reverse()
    .find(
      ({ stepId, status }) =>
        ['supervisor.child.archive', 'supervisor.child.integration-checks'].includes(stepId) &&
        status === 'succeeded',
    );
  const capacity =
    state.coordination_mode === 'single-session'
      ? 1
      : (record(lastDispatch?.outcome?.output)?.maxParallelChildren ??
        record(run.outputs['supervisor.prepare']?.value)?.maxParallelChildren);
  const occupied = [...latest.keys()].filter((name) => !integrated.has(name)).length;
  return contract.children.map((child) => {
    const action = latest.get(child.name);
    const dependencies = child.depends_on.filter((name) => !integrated.has(name));
    const preparation = actions.find(
      (candidate) =>
        candidate.stepId === 'supervisor.child.prepare' &&
        candidate.status === 'succeeded' &&
        activation(candidate)?.child === child.name,
    );
    const childWorktree = record(preparation?.outcome?.output)?.worktree;
    const archived =
      action?.stepId === 'supervisor.child.archive' &&
      action.status === 'succeeded' &&
      !failed(action);
    const status = integrated.has(child.name)
      ? 'integrated'
      : action && failed(action)
        ? 'blocked'
        : action && action.stepId !== 'supervisor.child.prepare'
          ? 'active'
          : dependencies.length === 0
            ? 'ready'
            : 'pending';
    return {
      name: child.name,
      summary: child.summary ?? null,
      dependsOn: [...child.depends_on],
      covers: [...child.covers],
      status,
      phase: action ? 'build' : null,
      projectRoot: archived
        ? projectRoot
        : typeof childWorktree === 'string'
          ? childWorktree
          : null,
      archiveName: archived ? archiveRef(action) : null,
      localExecution: describeExecution(action),
      attention:
        status === 'integrated' ? null : childAttention(action, dependencies, capacity, occupied),
      message:
        status === 'blocked'
          ? (action?.reason ?? action?.outcome?.summary ?? 'SDK Action requires recovery.')
          : null,
    };
  });
}

function childAttention(
  action: Action | undefined,
  dependencies: readonly string[],
  capacity: unknown,
  occupied: number,
): WorkflowAttentionState | null {
  if (action?.status === 'unknown') return { status: 'unknown-outcome', reason: 'unknown' };
  if (dependencies.length > 0)
    return { status: 'waiting', reason: 'dependency', related: dependencies };
  if (!action)
    return {
      status: 'waiting',
      reason: typeof capacity === 'number' && occupied >= capacity ? 'dispatch-slot' : 'unknown',
    };
  if (failed(action))
    return action.stepId.includes('verifier') || action.stepId.endsWith('integration-checks')
      ? { status: 'verification-blocker', reason: 'verification' }
      : { status: 'waiting', reason: 'unknown' };
  if (
    ['supervisor.child.integrate', 'supervisor.child.integration-checks'].includes(action.stepId) ||
    (action.stepId === 'supervisor.child.verifier' &&
      action.status === 'succeeded' &&
      record(action.outcome?.output)?.verdict === 'pass')
  )
    return { status: 'waiting', reason: 'integration' };
  if (action.status === 'pending') return { status: 'ready', reason: 'execution' };
  return null;
}

export function nativeDashboardSdkAttention(
  sdk: NativeDashboardSdkProjection,
): WorkflowAttentionState | null {
  const { run, state } = sdk;
  const actions = currentNativeSdkSupervisorActions(run).filter(
    ({ stepId }) => !stepId.startsWith('supervisor.child.'),
  );
  const waits = run.waits?.filter(({ stepId }) => !stepId.startsWith('supervisor.child.')) ?? [];
  return workflowAttentionFromRun(
    run.status,
    actions,
    waits,
    ['fail', 'blocked'].includes(state.verification_result) ||
      state.blockers.some(({ owner }) => owner === 'verifier'),
    run.evidenceWaits?.filter(({ stepId }) => !stepId.startsWith('supervisor.child.')),
  );
}

function archiveRef(action: Action): string | null {
  const ref = record(action.outcome?.output)?.archiveRef;
  return typeof ref === 'string' ? ref : null;
}

function describeExecution(
  current: Action | undefined,
  archived = false,
): NativeDashboardLocalExecutionSummary {
  const action = current?.status === 'running' || current?.status === 'unknown' ? current : null;
  const step = action?.stepId ?? '';
  const stage = step.includes('verifier')
    ? 'verifying'
    : step.includes('archive')
      ? 'archiving'
      : action
        ? 'building'
        : null;
  return {
    status: action?.status === 'running' ? 'running' : action ? 'interrupted' : 'absent',
    reason: archived ? 'archived' : action ? 'current' : 'idle',
    stage,
    actor: action
      ? step.includes('builder')
        ? 'builder'
        : step.includes('verifier')
          ? 'verifier'
          : 'runtime'
      : null,
  };
}

function executionProgress({ run, state }: SdkInspection): NativeDashboardLocalExecutionSummary {
  const current = currentNativeSdkSupervisorActions(run).filter(
    (action) => !/(?:checks|requested-checks)(?:-stop)?$/u.test(action.stepId),
  );
  return describeExecution(
    current.find((action) => action.status === 'running') ??
      current.find((action) => action.status === 'unknown'),
    state.archived,
  );
}

export interface NativeDashboardSdkProjection {
  run: SdkInspection['run'];
  state: SdkInspection['state'];
  children: NativeDashboardSdkChild[];
  localExecution: NativeDashboardLocalExecutionSummary;
}

/** Project a child Action's own scope and execution, without creating a child state file. */
export function adaptNativeDashboardSdkChild(
  sdk: NativeDashboardSdkProjection,
  child: NativeDashboardSdkChild,
  summary: NativeDashboardChildSummary,
  projectRoot: string,
): NativeDashboardChangeProjection {
  const parent = sdk.state;
  const base = createNativePortableState({
    name: child.name,
    language: parent.language,
    createdAt: parent.created_at,
  });
  return {
    ...adaptNativeDashboardChange({
      state: {
        ...base,
        phase: 'build',
        status: child.status === 'blocked' ? 'blocked' : 'active',
        state_version: parent.state_version,
        loop: {
          ...base.loop,
          stage: child.status === 'blocked' ? 'blocked' : 'building',
          goal_cycle: parent.loop.goal_cycle,
          next_action: child.message,
        },
        acceptance: parent.acceptance
          .filter(({ id }) => child.covers.includes(id))
          .map((item) => ({ ...item, result: 'pending', reason: null })),
      },
      status: 'active',
      locator: summary.locator ?? undefined,
      workspace: summary.workspace ?? undefined,
      localExecutionSummary: child.localExecution,
    }),
    supervisorParent: parent.name,
    acceptanceEvidence: projectNativeSdkAcceptanceEvidence(
      sdk.run,
      parent,
      projectRoot,
      child.name,
    ),
  };
}

/** SDK 读取失败由调用方显示为不可读，不能退回旧的进度来源。 */
export async function readNativeDashboardSdkProjection(
  projectRoot: string,
  name: string,
): Promise<NativeDashboardSdkProjection | null> {
  const owner = await readChangeRuntimeOwner(projectRoot, 'native', name);
  if (owner?.format !== 'sdk') return null;
  const run =
    owner.application === 'native'
      ? await readNativeSdkRunRecord(projectRoot, owner.runId)
      : await readWorkflowApplicationRun(projectRoot, owner.application, owner.runId);
  const input = record(run?.input);
  if (!run || run.workflow.id !== 'comet-native' || input?.name !== name) {
    throw new Error(`Native SDK Run ${name} is unavailable or does not match its owner.`);
  }
  const state = parseNativePortableState(run.state);
  if (state.name !== name) throw new Error(`Native SDK Run ${name} has a different state name.`);
  const inspection = { run, state };
  return {
    run: inspection.run,
    state: inspection.state,
    children: childProgress(inspection, projectRoot),
    localExecution: executionProgress(inspection),
  };
}
