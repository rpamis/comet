import { watch } from 'node:fs';
import {
  resolveWorkspaceRuntimeRoot,
  resolveWorkspaceRuntimeRootSync,
} from '../workflow-contract/workspace-runtime.js';
import path from 'node:path';
import type { NativeCheckInstance } from './native-check-executor.js';
import {
  withRecoverableFileLock,
  acquireRecoverableFileLock,
  diagnoseRecoverableFileLock,
} from '../../platform/fs/recoverable-file-lock.js';

import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import {
  hashRuntimeValue,
  portableClaimToken,
  runtimeExecutionBinding,
  type WorkflowRuntime,
  type RuntimeAction,
  type RuntimeValue,
  type RuntimeStoppedAction,
  type WorkflowRun,
} from '../engine/runtime.js';

const CHECK_REFS = new Set([
  'native-build-checks',
  'native-required-checks',
  'native-verifier-requested-checks',
  'native-supervisor-child-checks',
  'native-supervisor-integration-checks',
]);

export function isNativeSdkCheckAction(action: Readonly<RuntimeAction>): boolean {
  return action.type === 'call_tool' && CHECK_REFS.has(action.ref ?? '');
}

export function nativeSdkCheckRuntimeRef(run: Readonly<WorkflowRun>): string {
  return `native/sdk-checks/${hashRuntimeValue(run.runId)}`;
}

/** 已保存的检查回执保留原始内容，只在解析本机存储路径时兼容旧前缀。 */
export function nativeSdkCheckStorageRef(ref: string): string {
  const normalized = ref.startsWith('.comet/runtime/') ? ref.slice('.comet/runtime/'.length) : ref;
  if (!normalized.startsWith('native/sdk-checks/'))
    throw new Error('Invalid Native SDK check storage reference');
  return normalized;
}

interface ProcessInstance {
  instanceId: string;
}
export interface NativeSdkCheckExecution {
  schema: 'comet.native.sdk-check-execution.v1';
  executionBinding?: string;
  runId: string;
  actionId: string;
  attempt: number;
  inputHash: string;
  claimToken: string;
  candidateId: string;
  plansHash: string;
  /** New executions hold an OS-released transaction for their active lifetime. */
  managed?: true;
  child?: ProcessInstance;
  checkId?: string;
  phase: 'reserved' | 'running' | 'completed' | 'interrupted';
  /** 登记前停止失败也必须保留未知状态，不能把无 child 解释为从未启动。 */
  terminationUnconfirmed?: boolean;
  checks: RuntimeValue[];
  outcome?: { status: 'succeeded' | 'failed'; output: RuntimeValue };
}

function executionRef(run: Readonly<WorkflowRun>, action: Readonly<RuntimeAction>): string {
  // 同一 Action 的所有尝试共享防重放记录；不能用新的 attempt 覆盖已执行证据。
  return `${nativeSdkCheckRuntimeRef(run)}/executions/${hashRuntimeValue(action.id)}.json`;
}

function executionLockFile(
  projectRoot: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
): string {
  return (
    path.join(
      resolveWorkspaceRuntimeRootSync(projectRoot),
      ...executionRef(run, action).split('/'),
    ) + '.active.lock'
  );
}

const legacyExecutionBindings = new WeakMap<
  NativeSdkCheckExecution,
  { childBinding: string; executionHash: string }
>();

async function readExecution(
  projectRoot: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
) {
  const runtimeRoot = resolveWorkspaceRuntimeRootSync(projectRoot);
  const ref = executionRef(run, action);
  const file = await inspectProtectedProjectPath(runtimeRoot, ref, {
    label: 'Native 检查执行记录',
    expected: 'file',
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return { exists: false };
    throw error;
  });
  if (!file.exists) return null;
  const { bytes } = await readProtectedProjectFile(runtimeRoot, ref, 8 * 1024 * 1024, {
    label: 'Native 检查执行记录',
  });
  const value = JSON.parse(bytes.toString('utf8')) as NativeSdkCheckExecution;
  if (
    value.schema !== 'comet.native.sdk-check-execution.v1' ||
    (value.executionBinding !== undefined &&
      value.executionBinding !== hashRuntimeValue(runtimeExecutionBinding(run, action))) ||
    value.runId !== run.runId ||
    value.actionId !== action.id ||
    value.attempt !== action.attempt ||
    value.inputHash !== action.inputHash ||
    portableClaimToken(value.claimToken) !== portableClaimToken(action.claim?.token ?? '') ||
    !['reserved', 'running', 'completed', 'interrupted'].includes(value.phase) ||
    !Array.isArray(value.checks) ||
    (value.terminationUnconfirmed !== undefined &&
      typeof value.terminationUnconfirmed !== 'boolean')
  ) {
    throw new Error('Native 检查执行记录不匹配原 Action；保留原证据并核对，不能重新执行');
  }
  if (Object.hasOwn(value, 'owner')) {
    const child = value.child as unknown as
      { pid?: number; identity?: string; instanceId?: string; ownerPid?: number } | undefined;
    legacyExecutionBindings.set(value, {
      childBinding: hashRuntimeValue({
        child: child
          ? {
              pid: child.pid ?? null,
              identity: child.identity ?? null,
              instanceId: child.instanceId ?? null,
              ownerPid: child.ownerPid ?? null,
            }
          : null,
        checkId: value.checkId ?? null,
      }),
      executionHash: hashRuntimeValue(value as unknown as RuntimeValue),
    });
  }
  // Retire legacy process identities at the boundary; they never authorize recovery.
  delete (value as unknown as Record<string, unknown>).owner;
  if (value.child) value.child = { instanceId: value.child.instanceId ?? 'legacy' };
  return value;
}

interface CheckTerminationReceipt {
  schema: 'comet.native.sdk-check-termination.v1';
  actionBinding: string;
  childBinding: string;
  confirmed: true;
  source: 'process-tree' | 'stopped-action';
  executionHash?: string;
  evidence?: string;
}

function actionBinding(execution: NativeSdkCheckExecution): string {
  return hashRuntimeValue([
    execution.runId,
    execution.actionId,
    execution.attempt,
    execution.inputHash,
    execution.claimToken,
  ]);
}

function childBinding(execution: NativeSdkCheckExecution): string {
  return hashRuntimeValue({
    child: execution.child?.instanceId ?? null,
    checkId: execution.checkId ?? null,
  });
}

async function readTerminationReceipt(
  projectRoot: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
): Promise<CheckTerminationReceipt | null> {
  const root = resolveWorkspaceRuntimeRootSync(projectRoot);
  const ref = `${executionRef(run, action)}.termination.json`;
  if (
    !(
      await inspectProtectedProjectPath(root, ref, {
        label: 'Native 检查停止证据',
        expected: 'file',
      })
    ).exists
  )
    return null;
  const { bytes } = await readProtectedProjectFile(root, ref, 16 * 1024, {
    label: 'Native 检查停止证据',
  });
  return JSON.parse(bytes.toString('utf8')) as CheckTerminationReceipt;
}

function matchesTerminationReceipt(
  receipt: CheckTerminationReceipt | null,
  execution: NativeSdkCheckExecution,
): boolean {
  return (
    receipt?.schema === 'comet.native.sdk-check-termination.v1' &&
    receipt.confirmed === true &&
    receipt.actionBinding === actionBinding(execution) &&
    (receipt.childBinding === childBinding(execution) ||
      receipt.childBinding === legacyExecutionBindings.get(execution)?.childBinding) &&
    (receipt.source === 'process-tree' ||
      (receipt.source === 'stopped-action' &&
        typeof receipt.evidence === 'string' &&
        receipt.evidence.trim().length > 0 &&
        (receipt.executionHash === hashRuntimeValue(execution as unknown as RuntimeValue) ||
          receipt.executionHash === legacyExecutionBindings.get(execution)?.executionHash)))
  );
}

async function recordTerminationReceipt(options: {
  projectRoot: string;
  run: Readonly<WorkflowRun>;
  action: Readonly<RuntimeAction>;
  execution: NativeSdkCheckExecution;
  evidence?: string;
}): Promise<void> {
  const { projectRoot, run, action, execution, evidence } = options;
  const root = resolveWorkspaceRuntimeRootSync(projectRoot);
  const file = path.join(root, ...`${executionRef(run, action)}.termination.json`.split('/'));
  // 独立于 owner 的执行快照写入；取消方和 owner 不得互相覆盖已确认的停止证据。
  await withRecoverableFileLock(`${file}.lock`, async () => {
    const current = await readExecution(projectRoot, run, action);
    if (
      !current ||
      childBinding(current) !== childBinding(execution) ||
      (evidence !== undefined &&
        hashRuntimeValue(current as unknown as RuntimeValue) !==
          hashRuntimeValue(execution as unknown as RuntimeValue))
    ) {
      throw new Error('Native 检查进程登记已变化；不能转移原停止证据');
    }
    if (matchesTerminationReceipt(await readTerminationReceipt(projectRoot, run, action), current))
      return;
    const receipt: CheckTerminationReceipt = {
      schema: 'comet.native.sdk-check-termination.v1',
      actionBinding: actionBinding(current),
      childBinding: childBinding(current),
      confirmed: true,
      source: evidence === undefined ? 'process-tree' : 'stopped-action',
      ...(evidence === undefined
        ? {}
        : {
            executionHash: hashRuntimeValue(current as unknown as RuntimeValue),
            evidence,
          }),
    };
    await atomicWriteContainedText(file, JSON.stringify(receipt), { containedRoot: root });
  });
}

/** Agent 确认实际命令已停止后，绑定原领取保存停止事实。 */
export async function acknowledgeNativeSdkCheckStopped(options: {
  projectRoot: string;
  run: Readonly<WorkflowRun>;
  action: Readonly<RuntimeAction>;
  stoppedAction: RuntimeStoppedAction;
}): Promise<void> {
  const { projectRoot, run, action, stoppedAction: stopped } = options;
  if (
    stopped.actionId !== action.id ||
    stopped.attempt !== action.attempt ||
    stopped.inputHash !== action.inputHash ||
    stopped.claimToken !== action.claim?.token ||
    typeof stopped.evidence !== 'string' ||
    !stopped.evidence.trim() ||
    stopped.evidence.length > 4096 ||
    /^<.*>$/su.test(stopped.evidence.trim())
  ) {
    throw new Error('Native 检查停止证据不匹配原领取身份');
  }
  const execution = await readExecution(projectRoot, run, action);
  if (!execution) throw new Error('Native 检查缺少原执行记录；保留原 Action 结果');
  const lease = await diagnoseRecoverableFileLock(executionLockFile(projectRoot, run, action));
  if (lease.status === 'active') throw new Error('原检查仍在执行；先请求停止并等待当前执行结束');
  await requestNativeSdkCheckStop(options);
  await recordTerminationReceipt({ ...options, execution, evidence: stopped.evidence });
}

export async function createNativeSdkCheckExecution(options: {
  projectRoot: string;
  run: Readonly<WorkflowRun>;
  action: Readonly<RuntimeAction>;
  candidateId: string;
  plansHash: string;
}) {
  const { projectRoot, run, action } = options;
  const runtimeRoot = await resolveWorkspaceRuntimeRoot(projectRoot);
  if (!action.claim) throw new Error('Native 检查缺少领取身份');
  await ensureProtectedProjectDirectory(
    runtimeRoot,
    `${nativeSdkCheckRuntimeRef(run)}/executions`,
    { label: 'Native 检查执行记录' },
  );
  const file = path.join(runtimeRoot, ...executionRef(run, action).split('/'));
  const execution: NativeSdkCheckExecution = {
    schema: 'comet.native.sdk-check-execution.v1',
    executionBinding: hashRuntimeValue(runtimeExecutionBinding(run, action)),
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: action.claim.token,
    candidateId: options.candidateId,
    plansHash: options.plansHash,
    managed: true,
    phase: 'reserved',
    terminationUnconfirmed: true,
    checks: [],
  };
  const lease = await acquireRecoverableFileLock(executionLockFile(projectRoot, run, action), {
    timeoutMs: 0,
    operation: action.id,
  });
  try {
    await atomicWriteContainedText(file, JSON.stringify(execution), {
      containedRoot: runtimeRoot,
      exclusive: true,
      requireAtomicPublication: true,
    });
  } catch (error) {
    await lease.release();
    throw error;
  }
  const stopController = new AbortController();
  const observeStop = async () => {
    try {
      if (await hasNativeSdkCheckStopRequest({ projectRoot, run, action }))
        stopController.abort(new Error('原检查已请求停止'));
    } catch (error) {
      stopController.abort(error);
    }
  };
  let stopWatcher: ReturnType<typeof watch>;
  try {
    stopWatcher = watch(path.dirname(file), { persistent: false }, (_event, name) => {
      if (name?.toString() === path.basename(file) + '.stop') void observeStop();
    });
    stopWatcher.on('error', (error) => stopController.abort(error));
    await observeStop();
  } catch (error) {
    await lease.release();
    throw error;
  }
  const assertNotStopped = async () => {
    const stop = await inspectProtectedProjectPath(
      runtimeRoot,
      `${executionRef(run, action)}.stop`,
      { label: 'Native 检查取消请求', expected: 'file' },
    );
    if (stop.exists) throw new Error('Native 检查已请求取消；保留实际执行证据，不能启动后续检查');
  };
  let writing = Promise.resolve();
  const save = () => {
    const text = JSON.stringify(execution);
    const result = writing.then(() =>
      atomicWriteContainedText(file, text, { containedRoot: runtimeRoot }),
    );
    writing = result.catch(() => {});
    return result;
  };
  return {
    execution,
    signal: stopController.signal as AbortSignal,
    release: async () => {
      stopWatcher.close();
      await lease.release();
    },
    assertNotStopped,
    save,
    async recordTermination(instance: NativeCheckInstance, confirmed: boolean) {
      if (!confirmed) return;
      if (childBinding({ ...execution, child: instance }) !== childBinding(execution))
        throw new Error('Native 检查停止证据不匹配原进程实例');
      await recordTerminationReceipt({ projectRoot, run, action, execution });
    },
    async register(checkId: string, child: NativeCheckInstance, signal?: AbortSignal) {
      signal?.throwIfAborted();
      await assertNotStopped();
      execution.child = { instanceId: child.instanceId };
      execution.checkId = checkId;
      execution.phase = 'running';
      await save();
      signal?.throwIfAborted();
      await assertNotStopped();
    },
  };
}

export interface NativeSdkCheckExecutionInspection {
  actionId: string;
  attempt: number;
  owner: 'active' | 'stopped' | 'unknown';
  process: 'stopped' | 'unknown';
  /** 仅描述平台可观察的受管边界；不证明主动脱组的后代已停止。 */
  processBoundary: 'command' | 'unknown';
  phase: NativeSdkCheckExecution['phase'] | 'missing' | 'invalid';
  quiescent: boolean;
  recoveryRequired: boolean;
  execution?: NativeSdkCheckExecution;
  reason?: string;
}

/** 可迁移的停止事实必须仍绑定本次领取，业务成功或失败本身不是停止证据。 */
export function hasNativeSdkPortableStopEvidence(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
): boolean {
  if (!action.claim || !['succeeded', 'failed', 'cancelled'].includes(action.status)) return false;
  const original = run.actions.find((entry) => entry.id === action.id);
  if (!original || (original !== action && hashRuntimeValue(original) !== hashRuntimeValue(action)))
    return false;
  const matches = (value: RuntimeStoppedAction | undefined) =>
    Boolean(
      value &&
      value.actionId === action.id &&
      value.attempt === action.attempt &&
      value.inputHash === action.inputHash &&
      portableClaimToken(value.claimToken) === portableClaimToken(action.claim!.token) &&
      typeof value.evidence === 'string' &&
      value.evidence.trim() &&
      value.evidence.length <= 4096 &&
      !/^<.*>$/su.test(value.evidence.trim()),
    );
  if (matches(action.executionStop) || matches(action.cancellation)) return true;
  const outcome = action.outcome;
  if (
    !outcome ||
    outcome.actionId !== action.id ||
    outcome.attempt !== action.attempt ||
    outcome.inputHash !== action.inputHash ||
    outcome.claimToken !== action.claim.token ||
    !action.receipts.some(
      (receipt) =>
        receipt.outcomeId === outcome.outcomeId && receipt.hash === hashRuntimeValue(outcome),
    )
  )
    return false;
  const interruption = (
    outcome.output as {
      interruption?: { kind?: string; stoppedAction?: Omit<RuntimeStoppedAction, 'claimToken'> };
    } | null
  )?.interruption;
  const stopped = interruption?.stoppedAction;
  return (
    outcome.status === 'failed' &&
    ['execution-unknown', 'completed-input-drift'].includes(interruption?.kind ?? '') &&
    stopped !== undefined &&
    Object.keys(stopped).every((key) =>
      ['actionId', 'attempt', 'inputHash', 'evidence'].includes(key),
    ) &&
    matches({ ...stopped, claimToken: outcome.claimToken })
  );
}

/** 将原命令的实际停止结果提交到 Run，便于继续原 Action。 */
export async function reconcileNativeSdkExecutionStops(
  projectRoot: string,
  initial: WorkflowRun,
  runtime: WorkflowRuntime | (() => Promise<WorkflowRuntime>),
): Promise<WorkflowRun> {
  const inspections = await inspectNativeSdkCheckExecutions({
    projectRoot,
    run: initial,
    includeSettled: false,
  });
  const stoppedActions = inspections.flatMap((item) => {
    const action = initial.actions.find((entry) => entry.id === item.actionId)!;
    if (
      !item.quiescent ||
      !item.execution ||
      !['succeeded', 'failed', 'cancelled'].includes(action.status) ||
      hasNativeSdkPortableStopEvidence(initial, action)
    )
      return [];
    return [
      {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim!.token,
        evidence: `Runtime 已确认原受管执行停止；执行记录摘要 ${hashRuntimeValue(item.execution as unknown as RuntimeValue)}`,
      },
    ];
  });
  return stoppedActions.length
    ? (typeof runtime === 'function' ? await runtime() : runtime).acknowledgeStopped({
        runId: initial.runId,
        expectedRevision: initial.revision,
        stoppedActions,
      })
    : initial;
}

export async function inspectNativeSdkCheckExecutions(options: {
  projectRoot: string;
  run: Readonly<WorkflowRun>;
  includeSettled?: boolean;
}): Promise<NativeSdkCheckExecutionInspection[]> {
  const { projectRoot, run } = options;
  return Promise.all(
    run.actions
      .filter(
        (action) =>
          isNativeSdkCheckAction(action) &&
          (options.includeSettled ||
            ['running', 'unknown'].includes(action.status) ||
            !hasNativeSdkPortableStopEvidence(run, action)) &&
          action.claim,
      )
      .map(async (action) => {
        const base = { actionId: action.id, attempt: action.attempt };
        try {
          const execution = await readExecution(projectRoot, run, action);
          if (!execution)
            return {
              ...base,
              owner: 'unknown' as const,
              process: 'unknown' as const,
              processBoundary: 'unknown' as const,
              phase: 'missing' as const,
              quiescent: hasNativeSdkPortableStopEvidence(run, action),
              recoveryRequired: !hasNativeSdkPortableStopEvidence(run, action),
              reason: '检查缺少持久进程登记，无法确认它是否仍在执行',
            };
          const lease = execution.managed
            ? await diagnoseRecoverableFileLock(executionLockFile(projectRoot, run, action))
            : null;
          const active = lease?.status === 'active';
          const receipt = await readTerminationReceipt(projectRoot, run, action);
          const portableStopped =
            hasNativeSdkPortableStopEvidence(run, action) &&
            (!action.executionStop?.evidence.startsWith(
              'Runtime 已确认原受管执行停止；执行记录摘要 ',
            ) ||
              action.executionStop.evidence ===
                'Runtime 已确认原受管执行停止；执行记录摘要 ' +
                  hashRuntimeValue(execution as unknown as RuntimeValue) ||
              action.executionStop.evidence ===
                'Runtime 已确认原受管执行停止；执行记录摘要 ' +
                  legacyExecutionBindings.get(execution)?.executionHash);
          const quiescent =
            !active &&
            Boolean(
              portableStopped ||
              matchesTerminationReceipt(receipt, execution) ||
              (execution.managed &&
                execution.terminationUnconfirmed === false &&
                ['completed', 'interrupted'].includes(execution.phase) &&
                (execution.phase === 'interrupted' ||
                  execution.child ||
                  execution.checks.every(
                    (check) =>
                      check !== null &&
                      typeof check === 'object' &&
                      !Array.isArray(check) &&
                      check.reusedFrom !== null &&
                      typeof check.reusedFrom === 'object' &&
                      !Array.isArray(check.reusedFrom),
                  ))),
            );
          return {
            ...base,
            owner: active
              ? ('active' as const)
              : lease
                ? ('stopped' as const)
                : ('unknown' as const),
            process: quiescent ? ('stopped' as const) : ('unknown' as const),
            processBoundary: 'command' as const,
            phase: execution.phase,
            execution,
            quiescent,
            recoveryRequired:
              !active &&
              !(quiescent && ['succeeded', 'failed', 'cancelled'].includes(action.status)),
            ...(!active && !quiescent
              ? {
                  reason:
                    '原命令结果尚未确认；核对保留日志及实际副作用，确认停止后沿用原 Action 恢复，不能自动重跑。',
                }
              : {}),
          };
        } catch (error) {
          return {
            ...base,
            owner: 'unknown' as const,
            process: 'unknown' as const,
            processBoundary: 'unknown' as const,
            phase: 'invalid' as const,
            quiescent: false,
            recoveryRequired: true,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      }),
  );
}

export async function requestNativeSdkCheckStop(options: {
  projectRoot: string;
  run: Readonly<WorkflowRun>;
  action: Readonly<RuntimeAction>;
}) {
  const { projectRoot, run, action } = options;
  const runtimeRoot = await resolveWorkspaceRuntimeRoot(projectRoot);
  await ensureProtectedProjectDirectory(
    runtimeRoot,
    `${nativeSdkCheckRuntimeRef(run)}/executions`,
    { label: 'Native 检查停止请求' },
  );
  await atomicWriteContainedText(
    path.join(runtimeRoot, ...`${executionRef(run, action)}.stop`.split('/')),
    JSON.stringify({
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimHash: hashRuntimeValue(action.claim?.token ?? null),
    }),
    { containedRoot: runtimeRoot },
  );
}

export async function hasNativeSdkCheckStopRequest(options: {
  projectRoot: string;
  run: Readonly<WorkflowRun>;
  action: Readonly<RuntimeAction>;
}): Promise<boolean> {
  const { projectRoot, run, action } = options;
  const runtimeRoot = resolveWorkspaceRuntimeRootSync(projectRoot);
  const ref = `${executionRef(run, action)}.stop`;
  if (
    !(
      await inspectProtectedProjectPath(runtimeRoot, ref, {
        label: 'Native 检查停止请求',
        expected: 'file',
      })
    ).exists
  )
    return false;
  const { bytes } = await readProtectedProjectFile(runtimeRoot, ref, 16384, {
    label: 'Native 检查停止请求',
  });
  const value = JSON.parse(bytes.toString('utf8'));
  return (
    value.actionId === action.id &&
    value.attempt === action.attempt &&
    value.inputHash === action.inputHash &&
    value.claimHash === hashRuntimeValue(action.claim?.token ?? null)
  );
}

/** 请求原执行器停止；恢复方不按历史 PID 终止其他进程。 */
export async function terminateNativeSdkCheckExecutions(options: {
  projectRoot: string;
  run: Readonly<WorkflowRun>;
}) {
  const inspections = await inspectNativeSdkCheckExecutions(options);
  for (const item of inspections) {
    const action = options.run.actions.find((entry) => entry.id === item.actionId)!;
    await requestNativeSdkCheckStop({ ...options, action });
  }
  return inspectNativeSdkCheckExecutions(options);
}
