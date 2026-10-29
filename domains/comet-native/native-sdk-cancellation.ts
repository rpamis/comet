import { resolveWorkspaceRuntimeRootSync } from '../workflow-contract/workspace-runtime.js';
import path from 'node:path';

import { createFileRuntimeStore, createRuntime, type WorkflowRun } from '../engine/runtime.js';
import { readWorkflowApplicationRun } from '../workflow-application/index.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { readCometCurrentSelection } from '../workflow-contract/current-selection.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { diagnoseNativeLock, NATIVE_LOCK_UNKNOWN_TAKEOVER_MS } from './native-lock.js';
import { nativeProjectPaths } from './native-paths.js';
import type { NativePortableContinuation } from './native-portable-continuation.js';
import { parseNativePortableState } from './native-portable-state.js';
import type { NativePortableState } from './native-portable-types.js';
import {
  inspectNativeSdkCheckExecutions,
  hasNativeSdkPortableStopEvidence,
  type NativeSdkCheckExecutionInspection,
} from './native-sdk-check-execution.js';

/** Run 取消只终止调度；原领取方或 Runtime 进程凭据还必须证明执行已停止。 */
export async function inspectNativeSdkQuiescence(options: {
  projectRoot: string;
  run: WorkflowRun;
  checkExecutionObservation?: readonly NativeSdkCheckExecutionInspection[];
  ownerObservation?: Awaited<ReturnType<typeof readSdkChangeOwner>>;
}) {
  const outstandingActions: Array<{
    runId: string;
    actionId: string;
    stepId: string;
    attempt: number;
    inputHash: string;
    reason: string;
    acknowledgementRequest?: {
      operation: 'cancel' | 'acknowledge-stopped' | 'doctor';
      commandArgs?: string[];
      runId: string;
      expectedRevision: number;
      reason?: string;
      stoppedActions: Array<{
        actionId: string;
        attempt: number;
        inputHash: string;
        claimToken: string;
        evidence: string;
      }>;
    };
  }> = [];
  const outstandingRuns: string[] = [];
  const visited = new Set<string>();
  const owner =
    options.ownerObservation === undefined
      ? await readSdkChangeOwner(options.projectRoot, 'native', options.run.runId, {
          readOnly: true,
        })
      : options.ownerObservation;
  const store = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(resolveWorkspaceRuntimeRootSync(options.projectRoot), 'sdk-runs/native'),
  });
  async function inspect(run: WorkflowRun): Promise<void> {
    if (visited.has(run.runId)) return;
    visited.add(run.runId);
    const executions =
      (run === options.run ? options.checkExecutionObservation : undefined) ??
      (await inspectNativeSdkCheckExecutions({
        projectRoot: options.projectRoot,
        run,
        includeSettled: true,
      }));
    for (const action of run.actions) {
      if (['pending', 'running', 'unknown'].includes(action.status)) {
        outstandingRuns.push(run.runId);
      }
      const managed = executions.filter(
        (execution) => execution.actionId === action.id && execution.attempt === action.attempt,
      );
      const managedUnresolved = managed.some(
        (execution) => !execution.quiescent || !hasNativeSdkPortableStopEvidence(run, action),
      );
      const requiresManagedStop = managed.some(
        (execution) => !execution.quiescent && execution.phase !== 'missing',
      );
      const requiresRegistrationRecovery = managed.some(
        (execution) =>
          !execution.quiescent &&
          execution.owner === 'dead' &&
          execution.execution !== undefined &&
          !execution.execution.child,
      );
      const claimedUnresolved =
        action.status === 'cancelled' &&
        action.claim !== undefined &&
        !action.cancellation &&
        !action.executionStop;
      if (!managedUnresolved && !claimedUnresolved) continue;
      outstandingActions.push({
        runId: run.runId,
        actionId: action.id,
        stepId: action.stepId,
        attempt: action.attempt,
        inputHash: action.inputHash,
        reason: managedUnresolved
          ? 'Runtime-managed execution has not been proven stopped'
          : 'The original host has not acknowledged that this execution and its child tasks stopped',
        ...((requiresManagedStop && !requiresRegistrationRecovery) || !action.claim
          ? {}
          : {
              acknowledgementRequest: {
                operation: requiresRegistrationRecovery
                  ? ('doctor' as const)
                  : ['succeeded', 'failed'].includes(action.status)
                    ? ('acknowledge-stopped' as const)
                    : ('cancel' as const),
                ...(requiresRegistrationRecovery
                  ? {
                      commandArgs: [
                        'comet',
                        'native',
                        'doctor',
                        run.runId,
                        '--repair',
                        '--confirmed',
                        '--stopped-actions',
                        '<path-to-stopped-actions-json>',
                      ],
                    }
                  : {}),
                runId: run.runId,
                expectedRevision: run.revision,
                ...(['succeeded', 'failed'].includes(action.status)
                  ? {}
                  : { reason: run.reason ?? '停止已取消的工作' }),
                stoppedActions: [
                  {
                    actionId: action.id,
                    attempt: action.attempt,
                    inputHash: action.inputHash,
                    claimToken: action.claim.token,
                    evidence:
                      '<actual evidence that the original execution and its child tasks stopped>',
                  },
                ],
              },
            }),
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
        if (!neverStarted) outstandingRuns.push(child.runId);
      } else if (record.status !== 'cancelled' && record.status !== 'completed') {
        outstandingRuns.push(child.runId);
      } else {
        const validated = await createRuntime({
          workflows: [],
          store: { read: async () => record, compareAndSwap: async () => false },
        }).inspect(child.runId);
        await inspect(validated);
      }
    }
  }
  await inspect(options.run);
  const quiescent = outstandingActions.length === 0 && outstandingRuns.length === 0;
  return { quiescent, outstandingActions, outstandingRuns };
}

export async function inspectNativeSdkCancellation(options: {
  projectRoot: string;
  run: WorkflowRun;
  checkExecutionObservation?: readonly NativeSdkCheckExecutionInspection[];
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
    rootMoveLock?: {
      status: string;
      owner: unknown;
      ageMs: number | null;
      minimumUnknownOwnerAgeMs: number;
      remainingMs: number | null;
    };
  } | null = null;
  if (cleanupRequired) {
    cleanup = {
      reason:
        'Original executions stopped, but releasing the current selection is still pending. Inspect the root mutation lock and unfinished transactions before repair.',
      inspectionCommand: 'comet native doctor --json',
      repairCommand: 'comet native doctor --repair --json',
      finishCommand: `comet native doctor ${options.run.runId} --repair --json`,
    };
    try {
      const input = options.run.input as { artifactRootRef?: unknown } | null;
      if (typeof input?.artifactRootRef === 'string') {
        const paths = await nativeProjectPaths(options.projectRoot, input.artifactRootRef, {
          readOnly: true,
        });
        const file = path.join(paths.locksDir, 'root-move.lock');
        await inspectProtectedProjectPath(
          paths.workspaceRuntimeRoot,
          path.relative(paths.workspaceRuntimeRoot, file),
          { label: 'Native cancellation root mutation lock', expected: 'file' },
        );
        const lock = await diagnoseNativeLock(file);
        const createdAt = lock.owner ? Date.parse(lock.owner.createdAt) : Number.NaN;
        const ageMs = Number.isFinite(createdAt) ? Math.max(0, Date.now() - createdAt) : null;
        cleanup.rootMoveLock = {
          status: lock.status,
          owner: lock.owner,
          ageMs,
          minimumUnknownOwnerAgeMs: NATIVE_LOCK_UNKNOWN_TAKEOVER_MS,
          remainingMs:
            lock.status === 'unknown' && ageMs !== null
              ? Math.max(0, createdAt + NATIVE_LOCK_UNKNOWN_TAKEOVER_MS - Date.now())
              : null,
        };
        if (lock.status !== 'missing')
          cleanup.reason = `Current selection release is blocked by the ${lock.status} root mutation lock. Confirm the owner stopped before explicit root doctor repair; the existing unknown-owner age protection is retained.`;
      }
    } catch (error) {
      cleanup.reason = `Current selection release needs root diagnosis: ${error instanceof Error ? error.message : String(error)}`;
    }
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
  checkExecutionObservation?: readonly NativeSdkCheckExecutionInspection[];
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
    requiredInputs: cancellation.quiescent ? [] : ['original-execution-stop-evidence'],
    inputOptions: [],
    commandAlternatives: [],
    runnerAction: { ...options.base.runnerAction, kind: 'none' },
    userCommunication: {
      required: false,
      message: null,
      suggestedReply: null,
      agentInstruction: cancellation.cleanupRequired
        ? chinese
          ? '原执行已停止，但当前选择尚未释放，取消仍未完成。先运行全局 Native doctor 查看根变更锁的原持有者、锁龄和待恢复事务；确认原持有者已停止且达到现有接管条件后再显式修复，最后重试此任务的 doctor --repair。不得删锁或跳过原有保护。'
          : 'Original executions stopped, but current selection release is still pending. Cancellation is not complete. Inspect global Native doctor for the root mutation lock owner, age, and unfinished transactions. Confirm the owner stopped and existing takeover conditions are met before explicit repair, then retry this change’s doctor --repair. Do not delete locks or bypass their protections.'
        : cancellation.quiescent
          ? chinese
            ? '任务已取消，原执行已停止。保留现有代码、历史和收据；可以在此工作区开始新需求，无需验收或归档。'
            : 'The task is cancelled and its original executions are stopped. Existing code, history and receipts are retained. This workspace can start new work without verification or Archive.'
          : chinese
            ? '任务已停止派发。先执行 doctor --repair 停止可核验的 Runtime 进程；其余原宿主必须确认原执行及子任务已经停止，再按 cancellation 中的原领取模板回报真实证据。此前工作区保持占用，不得另行派发或用普通结果恢复任务。'
            : 'Scheduling is cancelled. Run doctor --repair to stop verifiable Runtime processes. The original host must stop any other original execution and its child tasks, then submit actual evidence using its original-claim template in cancellation. The workspace remains occupied until this is established; do not dispatch replacement work or resume the Run with an ordinary outcome.',
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
    run.workflow.version !== '1' ||
    run.runId !== name ||
    parseNativePortableState(run.state).name !== name ||
    (run.input as { name?: unknown; artifactRootRef?: unknown } | null)?.name !== name ||
    typeof (run.input as { artifactRootRef?: unknown }).artifactRootRef !== 'string'
  ) {
    throw new Error('Native cancellation Run does not match its change ownership');
  }
  return isNativeSdkCancellationComplete({ projectRoot, run });
}
