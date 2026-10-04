import type {
  NativeChildrenContract,
  NativeChildStatusProjection,
} from '../comet-native/native-children.js';
import { parseNativePortableState } from '../comet-native/native-portable-state.js';
import { readNativeSdkRunRecord } from '../comet-native/native-sdk-state-store.js';
import { currentNativeSdkSupervisorActions } from '../comet-native/native-sdk-supervisor-plan.js';
import { readChangeRuntimeOwner } from '../workflow-contract/change-runtime-owner.js';
import type { NativeDashboardLocalExecutionSummary } from './native-adapter.js';

type SdkInspection = {
  run: NonNullable<Awaited<ReturnType<typeof readNativeSdkRunRecord>>>;
  state: ReturnType<typeof parseNativePortableState>;
};
type Action = SdkInspection['run']['actions'][number];

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
      output.checks.some((check) => record(check)?.status !== 'passed'))
  );
}

/** 展示已确认的当前轮事实，不创建或修复旧 Supervisor 状态。 */
function childProgress({ run, state }: SdkInspection): NativeChildStatusProjection[] {
  const confirmed = record(run.outputs['shape.revalidate']?.value);
  const children = record(confirmed?.children);
  if (!children?.contract || state.phase === 'shape') return [];
  const contract = children.contract as NativeChildrenContract;
  const actions = currentNativeSdkSupervisorActions(run).filter(
    (action) =>
      action.stepId.startsWith('supervisor.child.') &&
      activation(action)?.contractHash === state.children_contract_hash &&
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
          action.stepId === 'supervisor.child.integration-checks' &&
          action.status === 'succeeded' &&
          !failed(action),
      )
      .map(([name]) => name),
  );
  return contract.children.map((child) => {
    const action = latest.get(child.name);
    const status = integrated.has(child.name)
      ? 'integrated'
      : action && failed(action)
        ? 'blocked'
        : action && action.stepId !== 'supervisor.child.prepare'
          ? 'active'
          : child.depends_on.every((name) => integrated.has(name))
            ? 'ready'
            : 'pending';
    return {
      name: child.name,
      summary: child.summary ?? null,
      dependsOn: [...child.depends_on],
      covers: [...child.covers],
      status,
      phase: action ? 'build' : null,
      projectRoot: null,
      message:
        status === 'blocked'
          ? (action?.reason ?? action?.outcome?.summary ?? 'SDK Action requires recovery.')
          : null,
    };
  });
}

function executionProgress({ run, state }: SdkInspection): NativeDashboardLocalExecutionSummary {
  const current = currentNativeSdkSupervisorActions(run);
  const action =
    current.find((action) => action.status === 'running') ??
    current.find((action) => action.status === 'unknown');
  const step = action?.stepId ?? '';
  const stage = step.includes('checks')
    ? 'checking'
    : step.includes('verifier')
      ? 'verifying'
      : step.includes('archive')
        ? 'archiving'
        : action
          ? 'building'
          : null;
  return {
    status: action?.status === 'running' ? 'running' : action ? 'interrupted' : 'absent',
    reason: state.archived ? 'archived' : action ? 'current' : 'idle',
    stage,
    actor: action
      ? step.includes('builder')
        ? 'builder'
        : step.includes('verifier')
          ? 'verifier'
          : 'runtime'
      : null,
    startedAt: null,
    requestCheckRounds: 0,
    checks: [],
    recoverableFromStage: action?.status === 'unknown' ? state.loop.stage : null,
  };
}

export interface NativeDashboardSdkProjection {
  state: SdkInspection['state'];
  children: NativeChildStatusProjection[];
  localExecution: NativeDashboardLocalExecutionSummary;
}

/** SDK 读取失败由调用方显示为不可读，不能退回旧的进度来源。 */
export async function readNativeDashboardSdkProjection(
  projectRoot: string,
  name: string,
): Promise<NativeDashboardSdkProjection | null> {
  const owner = await readChangeRuntimeOwner(projectRoot, 'native', name);
  if (owner?.format !== 'sdk') return null;
  const run = await readNativeSdkRunRecord(projectRoot, owner.runId);
  const input = record(run?.input);
  if (!run || run.workflow.id !== 'comet-native' || input?.name !== name) {
    throw new Error(`Native SDK Run ${name} is unavailable or does not match its owner.`);
  }
  const state = parseNativePortableState(run.state);
  if (state.name !== name) throw new Error(`Native SDK Run ${name} has a different state name.`);
  const inspection = { run, state };
  return {
    state: inspection.state,
    children: childProgress(inspection),
    localExecution: executionProgress(inspection),
  };
}
