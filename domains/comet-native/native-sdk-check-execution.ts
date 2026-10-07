import path from 'node:path';

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
  return `.comet/runtime/native/sdk-checks/${hashRuntimeValue(run.runId)}`;
}

interface ProcessInstance {
  pid: number;
  identity?: string;
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
  const ref = executionRef(run, action);
  const file = await inspectProtectedProjectPath(projectRoot, ref, {
    label: 'Native 检查执行记录',
    expected: 'file',
  });
  if (!file.exists) return null;
  const { bytes } = await readProtectedProjectFile(projectRoot, ref, 8 * 1024 * 1024, {
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
    (value.child && (!Number.isSafeInteger(value.child.pid) || value.child.pid < 1))
  ) {
    throw new Error('Native 检查执行记录不匹配原 Action；保留原证据并核对，不能重新执行');
  }
  return value;
}

export async function createNativeSdkCheckExecution(options: {
  projectRoot: string;
  run: Readonly<WorkflowRun>;
  action: Readonly<RuntimeAction>;
  candidateId: string;
  plansHash: string;
}) {
  const { projectRoot, run, action } = options;
  if (!action.claim) throw new Error('Native 检查缺少领取身份');
  await ensureProtectedProjectDirectory(
    projectRoot,
    `${nativeSdkCheckRuntimeRef(run)}/executions`,
    { label: 'Native 检查执行记录' },
  );
  const file = path.join(projectRoot, ...executionRef(run, action).split('/'));
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
    checks: [],
  };
  await atomicWriteContainedText(file, JSON.stringify(execution), {
    containedRoot: projectRoot,
    exclusive: true,
    requireAtomicPublication: true,
  });
  const assertNotStopped = async () => {
    const stop = await inspectProtectedProjectPath(
      projectRoot,
      `${executionRef(run, action)}.stop`,
      { label: 'Native 检查取消请求', expected: 'file' },
    );
    if (stop.exists) throw new Error('Native 检查已请求取消；保留实际执行证据，不能启动后续检查');
  };
  let writing = Promise.resolve();
  const save = () => {
    const text = JSON.stringify(execution);
    const result = writing.then(() =>
      atomicWriteContainedText(file, text, { containedRoot: projectRoot }),
    );
    writing = result.catch(() => {});
    return result;
  };
  return {
    execution,
    assertNotStopped,
    save,
    async register(checkId: string, pid: number, signal?: AbortSignal) {
      signal?.throwIfAborted();
      await assertNotStopped();
      const identity = (await readProcessIdentity(pid)) ?? undefined;
      signal?.throwIfAborted();
      execution.child = { pid, identity };
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
            : ['reserved', 'interrupted'].includes(execution.phase) ||
                (execution.phase === 'completed' && execution.checks.length === 0)
              ? 'dead'
              : 'unknown';
          const quiescent =
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
  await ensureProtectedProjectDirectory(
    projectRoot,
    `${nativeSdkCheckRuntimeRef(run)}/executions`,
    { label: 'Native 检查停止请求' },
  );
  await atomicWriteContainedText(
    path.join(projectRoot, ...`${executionRef(run, action)}.stop`.split('/')),
    JSON.stringify({
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimHash: hashRuntimeValue(action.claim?.token ?? null),
    }),
    { containedRoot: projectRoot },
  );
}

export async function hasNativeSdkCheckStopRequest(options: {
  projectRoot: string;
  run: Readonly<WorkflowRun>;
  action: Readonly<RuntimeAction>;
}): Promise<boolean> {
  const { projectRoot, run, action } = options;
  const ref = `${executionRef(run, action)}.stop`;
  if (
    !(
      await inspectProtectedProjectPath(projectRoot, ref, {
        label: 'Native 检查停止请求',
        expected: 'file',
      })
    ).exists
  )
    return false;
  const { bytes } = await readProtectedProjectFile(projectRoot, ref, 16384, {
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
    if (item.execution?.child && item.process === 'alive')
      await terminateRegisteredProcessTree(item.execution.child);
  }
  return inspectNativeSdkCheckExecutions(options);
}
