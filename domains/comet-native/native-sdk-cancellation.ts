import path from 'node:path';

import { createFileRuntimeStore, createRuntime, type WorkflowRun } from '../engine/runtime.js';
import { readWorkflowApplicationRun } from '../workflow-application/index.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { readCometCurrentSelection } from '../workflow-contract/current-selection.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { diagnoseNativeLock, NATIVE_LOCK_UNKNOWN_TAKEOVER_MS } from './native-lock.js';
import { nativeProjectPaths } from './native-paths.js';
import type { NativePortableContinuation } from './native-portable-continuation.js';
import type { NativePortableState } from './native-portable-types.js';
import { inspectNativeSdkCheckExecutions } from './native-sdk-check-execution.js';

/** Run 取消只终止调度；原领取方或 Runtime 进程凭据还必须证明执行已停止。 */
export async function inspectNativeSdkCancellation(options: {
  projectRoot: string;
  run: WorkflowRun;
}) {
  if (options.run.status !== 'cancelled') return null;
  const outstandingActions: Array<{
    runId: string;
    actionId: string;
    stepId: string;
    attempt: number;
    inputHash: string;
    reason: string;
    acknowledgementRequest?: {
      operation: 'cancel';
      runId: string;
      expectedRevision: number;
      reason: string;
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
  const owner = await readSdkChangeOwner(options.projectRoot, 'native', options.run.runId);
  const store = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(options.projectRoot, '.comet/runtime/sdk-runs/native'),
  });
  async function inspect(run: WorkflowRun): Promise<void> {
    if (visited.has(run.runId)) return;
    visited.add(run.runId);
    const executions = await inspectNativeSdkCheckExecutions({
      projectRoot: options.projectRoot,
      run,
    });
    for (const action of run.actions) {
      const managed = executions.filter(
        (execution) => execution.actionId === action.id && execution.attempt === action.attempt,
      );
      const managedUnresolved = managed.some(
        (execution) =>
          !execution.quiescent && !(execution.phase === 'missing' && action.cancellation),
      );
      const requiresManagedStop = managed.some(
        (execution) => !execution.quiescent && execution.phase !== 'missing',
      );
      const claimedUnresolved =
        action.status === 'cancelled' && action.claim !== undefined && !action.cancellation;
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
        ...(requiresManagedStop || !action.claim
          ? {}
          : {
              acknowledgementRequest: {
                operation: 'cancel' as const,
                runId: run.runId,
                expectedRevision: run.revision,
                reason: run.reason ?? 'Stop the cancelled work',
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
        const paths = await nativeProjectPaths(options.projectRoot, input.artifactRootRef);
        const file = path.join(paths.locksDir, 'root-move.lock');
        await inspectProtectedProjectPath(
          options.projectRoot,
          path.relative(options.projectRoot, file),
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
}) {
  const cancellation = await inspectNativeSdkCancellation(options);
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
