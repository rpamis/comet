import {
  resolveWorkspaceRuntimeRoot,
  resolveWorkspaceRuntimeRootSync,
} from '../workflow-contract/workspace-runtime.js';
import path from 'node:path';
import type { OwnedProcessInstance } from '../../platform/process/owned-command.js';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';

import {
  inspectProcessLiveness,
  terminateRegisteredProcessTree,
  inspectProcessTreeLiveness,
  readProcessIdentity,
  type ProcessLiveness,
} from '../../platform/process/process-identity.js';
import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import {
  hashRuntimeValue,
  type RuntimeAction,
  type RuntimeValue,
  type RuntimeStoppedAction,
  type WorkflowRun,
} from '../engine/runtime.js';

const CHECK_REFS = new Set([
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
  pid: number;
  identity?: string;
  instanceId?: string;
  ownerPid?: number;
}
export interface NativeSdkCheckExecution {
  schema: 'comet.native.sdk-check-execution.v1';
  runId: string;
  actionId: string;
  attempt: number;
  inputHash: string;
  claimToken: string;
  candidateId: string;
  plansHash: string;
  owner: ProcessInstance;
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
  });
  if (!file.exists) return null;
  const { bytes } = await readProtectedProjectFile(runtimeRoot, ref, 8 * 1024 * 1024, {
    label: 'Native 检查执行记录',
  });
  const value = JSON.parse(bytes.toString('utf8')) as NativeSdkCheckExecution;
  if (
    value.schema !== 'comet.native.sdk-check-execution.v1' ||
    value.runId !== run.runId ||
    value.actionId !== action.id ||
    value.attempt !== action.attempt ||
    value.inputHash !== action.inputHash ||
    value.claimToken !== action.claim?.token ||
    !Number.isSafeInteger(value.owner?.pid) ||
    value.owner.pid < 1 ||
    !['reserved', 'running', 'completed', 'interrupted'].includes(value.phase) ||
    !Array.isArray(value.checks) ||
    (value.terminationUnconfirmed !== undefined &&
      typeof value.terminationUnconfirmed !== 'boolean') ||
    (value.child && (!Number.isSafeInteger(value.child.pid) || value.child.pid < 1))
  ) {
    throw new Error('Native 检查执行记录不匹配原 Action；保留原证据并核对，不能重新执行');
  }
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
  const child = execution.child;
  return hashRuntimeValue({
    child: child
      ? {
          pid: child.pid,
          identity: child.identity ?? null,
          instanceId: child.instanceId ?? null,
          ownerPid: child.ownerPid ?? null,
        }
      : null,
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
    receipt.childBinding === childBinding(execution) &&
    (receipt.source === 'process-tree' ||
      (receipt.source === 'stopped-action' &&
        typeof receipt.evidence === 'string' &&
        receipt.evidence.trim().length > 0 &&
        receipt.executionHash === hashRuntimeValue(execution as unknown as RuntimeValue)))
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

/** 旧 Windows 登记只能由明确绑定原领取的人工停止事实恢复，不能推断后代已退出。 */
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
  if (
    !execution?.child ||
    (await inspectProcessLiveness(execution.owner.pid, execution.owner.identity)) !== 'dead' ||
    (await inspectProcessTreeLiveness(execution.child.pid, execution.child.identity)) !== 'dead'
  ) {
    throw new Error('Native 检查原领取方或监管进程尚未确认退出；不能提交人工停止证据');
  }
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
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: action.claim.token,
    candidateId: options.candidateId,
    plansHash: options.plansHash,
    owner: { pid: process.pid, identity: (await readProcessIdentity(process.pid)) ?? undefined },
    phase: 'reserved',
    terminationUnconfirmed: true,
    checks: [],
  };
  await atomicWriteContainedText(file, JSON.stringify(execution), {
    containedRoot: runtimeRoot,
    exclusive: true,
    requireAtomicPublication: true,
  });
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
    assertNotStopped,
    save,
    async recordTermination(instance: OwnedProcessInstance, confirmed: boolean) {
      if (!confirmed) return;
      if (childBinding({ ...execution, child: instance }) !== childBinding(execution))
        throw new Error('Native 检查停止证据不匹配原进程实例');
      await recordTerminationReceipt({ projectRoot, run, action, execution });
    },
    async register(checkId: string, child: number | OwnedProcessInstance, signal?: AbortSignal) {
      signal?.throwIfAborted();
      await assertNotStopped();
      const pid = typeof child === 'number' ? child : child.pid;
      const identity =
        typeof child === 'number'
          ? ((await readProcessIdentity(pid)) ?? undefined)
          : child.identity;
      signal?.throwIfAborted();
      execution.child =
        typeof child === 'number'
          ? { pid, ...(identity === undefined ? {} : { identity }) }
          : {
              pid,
              instanceId: child.instanceId,
              ownerPid: child.ownerPid,
              ...(identity === undefined ? {} : { identity }),
            };
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
  owner: ProcessLiveness;
  process: ProcessLiveness;
  /** 仅描述平台可观察的受管边界；不证明主动脱组的后代已停止。 */
  processBoundary: 'process-group' | 'supervisor-process' | 'unknown';
  phase: NativeSdkCheckExecution['phase'] | 'missing' | 'invalid';
  quiescent: boolean;
  recoveryRequired: boolean;
  execution?: NativeSdkCheckExecution;
  reason?: string;
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
          (options.includeSettled || ['running', 'unknown', 'cancelled'].includes(action.status)) &&
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
              quiescent: false,
              recoveryRequired: true,
              reason: '检查缺少持久进程登记，无法确认它是否仍在执行',
            };
          const owner = await inspectProcessLiveness(execution.owner.pid, execution.owner.identity);
          const process = execution.child
            ? await inspectProcessTreeLiveness(execution.child.pid, execution.child.identity)
            : !execution.terminationUnconfirmed &&
                (['reserved', 'interrupted'].includes(execution.phase) ||
                  (execution.phase === 'completed' && execution.checks.length === 0))
              ? 'dead'
              : 'unknown';
          const receipt =
            execution.child && globalThis.process.platform === 'win32'
              ? await readTerminationReceipt(projectRoot, run, action)
              : null;
          const treeConfirmed =
            !execution.child ||
            globalThis.process.platform !== 'win32' ||
            (matchesTerminationReceipt(receipt, execution) &&
              (receipt?.source !== 'stopped-action' || owner === 'dead'));
          const quiescent =
            treeConfirmed &&
            process === 'dead' &&
            (owner === 'dead' || ['completed', 'interrupted'].includes(execution.phase));
          return {
            ...base,
            owner,
            process,
            processBoundary:
              globalThis.process.platform === 'win32'
                ? ('supervisor-process' as const)
                : ('process-group' as const),
            phase: execution.phase,
            execution,
            quiescent,
            ...(!execution.child && execution.terminationUnconfirmed
              ? {
                  reason:
                    '检查在监管进程 PID 登记完成前中断；缺少原进程身份，保留未知状态，不能验收或重试',
                }
              : !treeConfirmed
                ? { reason: 'Windows 检查缺少整树停止证据；组长退出不能证明后代已停止' }
                : {}),
            recoveryRequired:
              owner !== 'alive' ||
              execution.phase === 'completed' ||
              execution.phase === 'interrupted',
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

/** 先阻止后续启动，再仅清理仍匹配已登记创建身份的进程树。 */
export async function terminateNativeSdkCheckExecutions(options: {
  projectRoot: string;
  run: Readonly<WorkflowRun>;
}) {
  const inspections = await inspectNativeSdkCheckExecutions(options);
  for (const item of inspections) {
    const action = options.run.actions.find((entry) => entry.id === item.actionId)!;
    await requestNativeSdkCheckStop({ ...options, action });
    if (
      item.execution?.child &&
      item.process === 'alive' &&
      (await terminateRegisteredProcessTree(item.execution.child))
    ) {
      await recordTerminationReceipt({ ...options, action, execution: item.execution });
    }
  }
  return inspectNativeSdkCheckExecutions(options);
}
