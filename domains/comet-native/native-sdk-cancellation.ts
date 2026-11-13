import { resolveWorkspaceRuntimeRootSync } from '../workflow-contract/workspace-runtime.js';
import path from 'node:path';
import { createFileRuntimeStore, createRuntime, type WorkflowRun } from '../engine/runtime.js';
import { readWorkflowApplicationRun } from '../workflow-application/application.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { readCometCurrentSelection } from '../workflow-contract/current-selection.js';
import type { NativePortableContinuation } from './native-portable-continuation.js';
import { parseNativePortableState } from './native-portable-state.js';
import type { NativePortableState } from './native-portable-types.js';
/** 只核对业务调度；取消和进程清理由 Agent 平台负责，不要求停止握手。 */
export async function inspectNativeSdkQuiescence(options: {
  projectRoot: string;
  run: WorkflowRun;
  ownerObservation?: Awaited<ReturnType<typeof readSdkChangeOwner>>;
}) {
  const outstandingActions: Array<{
    runId: string;
    actionId: string;
    stepId: string;
    attempt: number;
    inputHash: string;
    reason: string;
  }> = [];
  const outstandingRuns = new Set<string>();
  const owner =
    options.ownerObservation === undefined
      ? await readSdkChangeOwner(options.projectRoot, 'native', options.run.runId, {
          readOnly: true,
        })
      : options.ownerObservation;
  const store = createFileRuntimeStore<WorkflowRun>({
    singleWriter: true,
    rootDir: path.join(resolveWorkspaceRuntimeRootSync(options.projectRoot), 'sdk-runs/native'),
  });
  const visited = new Set<string>();
  async function inspect(run: WorkflowRun): Promise<void> {
    if (visited.has(run.runId)) return;
    visited.add(run.runId);
    for (const action of run.actions) {
      if (!['pending', 'running', 'unknown'].includes(action.status)) continue;
      outstandingRuns.add(run.runId);
      outstandingActions.push({
        runId: run.runId,
        actionId: action.id,
        stepId: action.stepId,
        attempt: action.attempt,
        inputHash: action.inputHash,
        reason: '原业务任务仍待完成或由 Agent 核对结果',
      });
    }
    for (const child of run.children) {
      const record =
        owner && owner.application !== 'native'
          ? await readWorkflowApplicationRun(options.projectRoot, owner.application, child.runId)
          : await store.read(child.runId);
      if (!record) {
        const action = run.actions.find((entry) => entry.id === child.actionId);
        const neverStarted =
          action?.type === 'child_workflow' &&
          action.status === 'cancelled' &&
          action.attempt === 1 &&
          !action.claim &&
          !action.outcome &&
          action.receipts.length === 0 &&
          action.reconciliations.length === 0;
        if (!neverStarted) outstandingRuns.add(child.runId);
      } else if (!['cancelled', 'completed'].includes(record.status)) {
        outstandingRuns.add(child.runId);
      } else {
        await inspect(record);
      }
    }
  }
  await inspect(options.run);
  return {
    quiescent: outstandingActions.length === 0 && outstandingRuns.size === 0,
    outstandingActions,
    outstandingRuns: [...outstandingRuns],
  };
}
export async function inspectNativeSdkCancellation(options: {
  projectRoot: string;
  run: WorkflowRun;
  ownerObservation?: Awaited<ReturnType<typeof readSdkChangeOwner>>;
}) {
  if (options.run.status !== 'cancelled') return null;
  const { quiescent, outstandingActions, outstandingRuns } =
    await inspectNativeSdkQuiescence(options);
  const owner =
    options.ownerObservation === undefined
      ? await readSdkChangeOwner(options.projectRoot, 'native', options.run.runId, {
          readOnly: true,
        })
      : options.ownerObservation;
  const selected = quiescent ? await readCometCurrentSelection(options.projectRoot) : null;
  const cleanupRequired = Boolean(
    selected?.status === 'selected' &&
    selected.selection.change === options.run.runId &&
    (owner?.application === 'native'
      ? selected.selection.workflow === 'native'
      : owner &&
        selected.selection.workflow === 'application' &&
        selected.selection.applicationId === owner.application),
  );
  let cleanup: {
    reason: string;
    inspectionCommand: string;
    repairCommand: string;
    finishCommand: string;
  } | null = null;
  if (cleanupRequired) {
    cleanup = {
      reason: '业务调度已取消，当前选择尚未释放；请核对工作区事务并重试清理。',
      inspectionCommand: 'comet native doctor --json',
      repairCommand: 'comet native doctor --repair --json',
      finishCommand: `comet native doctor ${options.run.runId} --repair --json`,
    };
  }
  return {
    status: quiescent && !cleanupRequired ? ('cancelled' as const) : ('cancelling' as const),
    reason: options.run.reason ?? null,
    quiescent,
    cleanupRequired,
    cleanup,
    outstandingActions,
    outstandingRuns,
  };
}
export async function projectNativeSdkCancellationContinuation(options: {
  projectRoot: string;
  run: WorkflowRun;
  state: NativePortableState;
  base: NativePortableContinuation;
  cancellationObservation?: Awaited<ReturnType<typeof inspectNativeSdkCancellation>>;
}) {
  // 只复用同一次状态输出的观察；独立调用仍重新检查原执行和清理状态。
  const cancellation =
    options.cancellationObservation === undefined
      ? await inspectNativeSdkCancellation(options)
      : options.cancellationObservation;
  if (!cancellation) return null;
  const chinese = options.state.language === 'zh-CN';
  const continuation: NativePortableContinuation = {
    ...options.base,
    status: cancellation.status,
    disposition: cancellation.status === 'cancelled' ? 'done' : 'blocked',
    mode: cancellation.status === 'cancelled' ? 'done' : 'reconcile',
    requiresUserDecision: false,
    action: 'none',
    commandArgs:
      cancellation.status === 'cancelled'
        ? null
        : cancellation.cleanupRequired
          ? ['comet', 'native', 'doctor', '--json']
          : ['comet', 'native', 'doctor', options.state.name, '--repair'],
    requiredInputs: cancellation.quiescent ? [] : ['original-platform-task-result'],
    inputOptions: [],
    commandAlternatives: [],
    runnerAction: { ...options.base.runnerAction, kind: 'none' },
    userCommunication: {
      required: false,
      message: null,
      suggestedReply: null,
      agentInstruction: cancellation.cleanupRequired
        ? chinese
          ? '业务调度已取消，但当前选择尚未释放，清理仍未完成。先运行全局 Native doctor 查看根变更锁的原持有者、锁龄和待恢复事务；确认原持有者已停止且达到现有接管条件后再显式修复，最后重试此任务的 doctor --repair。不得删锁或跳过原有保护。'
          : 'Scheduling is cancelled, but current selection release is still pending. Inspect global Native doctor for the root mutation lock owner, age, and unfinished transactions. Confirm the owner stopped and existing takeover conditions are met before explicit repair, then retry this change’s doctor --repair. Do not delete locks or bypass their protections.'
        : cancellation.quiescent
          ? chinese
            ? '业务任务已取消，代码与历史保留。原平台任务的取消和进程清理由 Agent 通过平台工具核对；Comet 不声明原进程已经停止。'
            : 'Business scheduling is cancelled; code and history are retained. The Agent must verify original task cancellation and process cleanup through the platform. Comet does not certify process termination.'
          : chinese
            ? '任务已停止派发。通过原 Agent 平台核对尚未完成的任务、实际副作用、取消及清理结果；沿用原业务任务记录，不按历史 PID 杀进程，不生成停止回执。'
            : 'Scheduling is cancelled. Inspect unfinished tasks, actual side effects, cancellation, and cleanup through their original Agent platform. Keep the original business task records; do not kill historical PIDs or create stop receipts.',
    },
  };
  return { continuation, cancellation };
}
/** 只有原执行与选择清理都已完成的取消任务才退出活动集合。 */
export async function isNativeSdkCancellationComplete(options: {
  projectRoot: string;
  run: WorkflowRun;
}): Promise<boolean> {
  return (await inspectNativeSdkCancellation(options))?.status === 'cancelled';
}
/** 从权威存储只读检查取消；保留历史投影不能证明任务仍在执行。 */
export async function isNativeSdkChangeCancellationComplete(
  projectRoot: string,
  name: string,
): Promise<boolean> {
  const owner = await readSdkChangeOwner(projectRoot, 'native', name, { readOnly: true });
  if (!owner) return false;
  const record =
    owner.application === 'native'
      ? await createFileRuntimeStore<WorkflowRun>({
          singleWriter: true,
          rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs/native'),
        }).read(owner.runId)
      : await readWorkflowApplicationRun(projectRoot, owner.application, owner.runId);
  if (!record || record.status !== 'cancelled') return false;
  const run = await createRuntime({
    workflows: [],
    store: { read: async () => record, compareAndSwap: async () => false },
  }).inspect(owner.runId);
  if (
    run.workflow.id !== 'comet-native' ||
    !['1', '2', '3', '4'].includes(run.workflow.version) ||
    run.runId !== name ||
    parseNativePortableState(run.state).name !== name ||
    (
      run.input as {
        name?: unknown;
        artifactRootRef?: unknown;
      } | null
    )?.name !== name ||
    typeof (
      run.input as {
        artifactRootRef?: unknown;
      }
    ).artifactRootRef !== 'string'
  ) {
    throw new Error('Native cancellation Run does not match its change ownership');
  }
  return isNativeSdkCancellationComplete({ projectRoot, run });
}
