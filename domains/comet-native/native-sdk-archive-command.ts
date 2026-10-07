import { NativeUsageError, success, type DispatchResult } from './native-cli-shared.js';
import { recoverNativeSdkArchiveOutcome, NATIVE_SDK_ARCHIVE_STEPS } from './native-sdk-archive.js';
import { recoverNativeSdkSupervisorCleanupOutcome } from './native-sdk-supervisor-cleanup.js';
import {
  inspectNativeSdkSupervisorDelivery,
  recoverNativeSdkSupervisorDeliveryOutcome,
} from './native-sdk-supervisor-deliver.js';
import { inspectNativeSdkStatus, projectNativeSdkStatus } from './native-sdk-status.js';
import { loadOwnedNativeSdkRuntime, inspectNativeSdkRun } from './native-runtime-ownership.js';
import { restoreNativeSupervisorChildArchiveMaterials } from './native-sdk-supervisor-archive.js';
import { parseNativePortableState } from './native-portable-state.js';
import { randomUUID } from 'node:crypto';
import type { WorkflowRun } from '../engine/runtime.js';

function pendingArchiveAction(run: WorkflowRun) {
  if (
    run.waits.some((wait) => wait.status === 'pending') ||
    run.evidenceWaits?.some((wait) => wait.status === 'pending') ||
    run.actions.some((action) => ['running', 'unknown'].includes(action.status))
  )
    return null;
  const actions = run.actions.filter((action) => action.status === 'pending');
  if (actions.length !== 1) return null;
  const action = actions[0];
  const step = NATIVE_SDK_ARCHIVE_STEPS.findIndex(
    ([stepId, ref]) => action.stepId === stepId && action.ref === ref,
  );
  return action.type === 'call_tool' && step >= 0 ? { action, step } : null;
}

/** 从公开 inspect 读取原 Parent，再补全已成功归档的来源材料。 */
export async function backfillNativeSdkSupervisorChildArchiveMaterials(options: {
  projectRoot: string;
  targetProjectRoot: string;
  parent: string;
  expectedRevision: number;
  dryRun: boolean;
}) {
  const inspection = await inspectNativeSdkRun(options.projectRoot, options.parent);
  return restoreNativeSupervisorChildArchiveMaterials(options, inspection);
}

export async function archiveNativeSdkChange(options: {
  projectRoot: string;
  name: string;
  dryRun: boolean;
  recover: boolean;
  confirmed: boolean;
  expectedPreflightHash?: string;
  finish?: string;
  serialFirst?: string;
  commitMessage?: string;
  mergeMessage?: string;
}): Promise<DispatchResult> {
  if (
    options.expectedPreflightHash !== undefined ||
    options.finish !== undefined ||
    options.serialFirst !== undefined ||
    options.commitMessage !== undefined ||
    options.mergeMessage !== undefined ||
    options.confirmed
  ) {
    throw new NativeUsageError(
      'SDK Archive uses the confirmed Run decision and keeps Git delivery separate; compat preflight, finish, commit message and confirmation options are not accepted',
    );
  }
  if (options.recover && options.dryRun) {
    throw new NativeUsageError('--recover and --dry-run cannot be used together');
  }
  const inspection = await inspectNativeSdkRun(options.projectRoot, options.name);
  let { run, state } = inspection;
  if (options.recover) {
    const unknown = run.actions.filter((action) => action.status === 'unknown');
    const action = unknown.length === 1 ? unknown[0] : undefined;
    if (
      state.phase !== 'archive' ||
      !action ||
      ![
        'supervisor.parent.deliver',
        'archive.execute',
        'archive.finalize',
        'supervisor.cleanup',
      ].includes(action.stepId)
    ) {
      return {
        command: 'archive',
        exitCode: 73,
        error: {
          code: 'conflict',
          message: `Native SDK Archive for ${options.name} has no single recoverable delivery, Archive, or cleanup Action`,
        },
      };
    }
    const { runtime } = await loadOwnedNativeSdkRuntime(options.projectRoot, options.name);
    if (action.stepId === 'supervisor.parent.deliver') {
      await recoverNativeSdkSupervisorDeliveryOutcome({
        runtime,
        runId: run.runId,
        projectRoot: options.projectRoot,
      });
    } else if (action.stepId === 'supervisor.cleanup') {
      await recoverNativeSdkSupervisorCleanupOutcome({
        runtime,
        runId: run.runId,
        projectRoot: options.projectRoot,
      });
    } else {
      await recoverNativeSdkArchiveOutcome({
        runtime,
        runId: run.runId,
        projectRoot: options.projectRoot,
      });
    }
    return success('archive', {
      change: options.name,
      runtimeFormat: 'sdk',
      recoveredAction: { id: action.id, stepId: action.stepId },
      ...(await inspectNativeSdkStatus(options)),
    });
  }
  const pending = run.actions.find((action) => action.status === 'pending');
  if (options.dryRun) {
    const ready = state.phase === 'archive' && pendingArchiveAction(run) !== null;
    const delivery =
      ready && pending?.stepId === 'supervisor.parent.deliver'
        ? await inspectNativeSdkSupervisorDelivery(run, pending, options.projectRoot)
        : undefined;
    return success('archive --dry-run', {
      change: options.name,
      runtimeFormat: 'sdk',
      phase: state.phase,
      status: run.status,
      ready,
      ...(delivery ? { delivery } : {}),
      ...(pending ? { pendingAction: { id: pending.id, stepId: pending.stepId } } : {}),
    });
  }
  if (state.phase !== 'archive') {
    return {
      command: 'archive',
      exitCode: 73,
      error: {
        code: 'conflict',
        message: `Native SDK Archive for ${options.name} has no pending Archive Action; inspect comet native status ${options.name} --json`,
      },
    };
  }
  const { runtime, executors } = await loadOwnedNativeSdkRuntime(options.projectRoot, options.name);
  const completedActions: { id: string; stepId: string; status: string }[] = [];
  let previousStep = -1;
  // 每次 execute 都独立提交原 Action 和 CAS 检查点；不跨越扩展、审批或未知执行。
  for (let count = 0; count < NATIVE_SDK_ARCHIVE_STEPS.length; count += 1) {
    if (state.phase !== 'archive') break;
    const next = pendingArchiveAction(run);
    if (!next) break;
    const { action, step } = next;
    if (previousStep >= 0 && step !== previousStep + 1) break;
    const executor = executors.find((candidate) => candidate.supports(action));
    if (!executor) throw new Error(`Native SDK Action ${action.stepId} has no executor`);
    run = await runtime.execute({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: action.id,
      executorId: executor.id,
      context: { requestId: randomUUID(), projectRoot: options.projectRoot },
    });
    state = parseNativePortableState(run.state);
    const committed = run.actions.find((entry) => entry.id === action.id)!;
    completedActions.push({ id: committed.id, stepId: committed.stepId, status: committed.status });
    previousStep = step;
    if (committed.status !== 'succeeded') break;
  }
  const result = success('archive', {
    change: options.name,
    runtimeFormat: 'sdk',
    completedActions,
    ...(await projectNativeSdkStatus(options, { ...inspection, run, state })),
  });
  const latestArchiveAction = [...run.actions]
    .reverse()
    .find((action) => NATIVE_SDK_ARCHIVE_STEPS.some(([stepId]) => action.stepId === stepId));
  const blocked = run.actions.find((action) => ['running', 'unknown'].includes(action.status));
  const failed = latestArchiveAction?.status === 'failed' ? latestArchiveAction : undefined;
  return blocked || failed
    ? {
        ...result,
        exitCode: 73,
        error: {
          code: 'blocked',
          message: `Native SDK Archive stopped at ${blocked?.stepId ?? failed!.stepId}; inspect the original Action before continuing`,
        },
      }
    : result;
}
