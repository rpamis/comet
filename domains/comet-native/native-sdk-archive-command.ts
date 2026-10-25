import { reconcileNativeSdkExecutionStops } from './native-sdk-check-execution.js';
import { settleNativeSdkCancellation } from './native-sdk-cancellation-cleanup.js';
import { nativeProjectPaths } from './native-paths.js';
import { readNativePortableTransaction } from './native-portable-transactions.js';
import { inspectNativeSdkArchiveFinalization } from './native-portable-archive.js';
import { importNativeSdkArchiveOriginals } from './native-sdk-archive-originals.js';
import { NativeUsageError, success, type DispatchResult } from './native-cli-shared.js';
import {
  recoverNativeSdkArchiveOutcome,
  recoverCancelledNativeSdkArchive,
  NATIVE_SDK_ARCHIVE_STEPS,
  nativeSdkRetryableArchivePreflight,
  nativeSdkRetryableArchiveFinalization,
} from './native-sdk-archive.js';
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
import { assertNativeSdkCandidateUnchanged } from './native-sdk-checks.js';
import { hashRuntimeValue, type WorkflowRun, type RuntimeValue } from '../engine/runtime.js';
import { nativeSdkNextAction, nativeSdkPendingActions } from './native-sdk-continuation.js';

function pendingArchiveAction(run: WorkflowRun) {
  const actions = nativeSdkPendingActions(run);
  if (actions.length !== 1) return null;
  const action = nativeSdkNextAction(run, parseNativePortableState(run.state));
  if (!action) return null;
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

export async function archiveNativeSdkChange(
  options: Parameters<typeof archiveNativeSdkChangeValue>[0],
): Promise<DispatchResult> {
  try {
    const result = await archiveNativeSdkChangeValue(options);
    const data =
      result.data && typeof result.data === 'object'
        ? (result.data as Record<string, unknown>)
        : {};
    if (result.exitCode === 0 || data.schema === 'comet.native.sdk-status.v1') return result;
    const inspection = await inspectNativeSdkRun(options.projectRoot, options.name, {
      readOnly: true,
    });
    return { ...result, data: { ...(await projectNativeSdkStatus(options, inspection)), ...data } };
  } catch (error) {
    if (error instanceof NativeUsageError) throw error;
    const inspection = await inspectNativeSdkRun(options.projectRoot, options.name, {
      readOnly: true,
    }).catch(() => null);
    const unresolved = inspection?.run.actions.find(
      (action) =>
        ['running', 'unknown'].includes(action.status) &&
        NATIVE_SDK_ARCHIVE_STEPS.some(
          ([stepId, ref]) => action.stepId === stepId && action.ref === ref,
        ),
    );
    if (!inspection || inspection.state.phase !== 'archive' || !unresolved) throw error;
    return {
      ...success('archive', {
        change: options.name,
        ...(await projectNativeSdkStatus(options, inspection)),
      }),
      exitCode: 73,
      error: { code: 'blocked', message: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function archiveNativeSdkChangeValue(options: {
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
  legacySpecBackup?: string;
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
  if (options.recover && run.status === 'completed' && state.archived) {
    const applied = run.outputs['archive.execute']?.value as { archiveRef?: string } | undefined;
    const completed = [...run.actions]
      .reverse()
      .find((action) => action.stepId === 'archive.finalize' && action.status === 'succeeded');
    if (!applied?.archiveRef || !completed?.outcome)
      throw new Error('Native completed Archive lacks its original finalization receipt');
    const receipt = await inspectNativeSdkArchiveFinalization({
      paths: await nativeProjectPaths(options.projectRoot, inspection.artifactRootRef, {
        readOnly: true,
      }),
      state,
      runId: run.runId,
      archiveRef: applied.archiveRef,
      history: true,
    });
    if (
      hashRuntimeValue(receipt as unknown as RuntimeValue) !==
      hashRuntimeValue(completed.outcome.output)
    )
      throw new Error('Native completed Archive differs from its original receipt');
    return success('archive', {
      change: options.name,
      alreadyArchived: true,
      historicalRecovery: true,
      currentImplementationRevalidated: false,
      receipt,
      ...(await projectNativeSdkStatus(options, inspection)),
    });
  }
  if (!options.dryRun) {
    run = await reconcileNativeSdkExecutionStops(
      options.projectRoot,
      run,
      (await loadOwnedNativeSdkRuntime(options.projectRoot, options.name)).runtime,
    );
    inspection.run = run;
  }
  if (options.legacySpecBackup) {
    if (options.dryRun)
      throw new NativeUsageError('--legacy-spec-backup cannot be used with --dry-run');
    await importNativeSdkArchiveOriginals({
      projectRoot: options.projectRoot,
      run,
      ref: options.legacySpecBackup,
    });
  }
  if (options.recover && run.status === 'cancelled') {
    const receipt = await recoverCancelledNativeSdkArchive({
      projectRoot: options.projectRoot,
      run,
    });
    await settleNativeSdkCancellation({ projectRoot: options.projectRoot, run });
    return success(
      'archive',
      {
        change: options.name,
        cancelled: true,
        recoveredCancelledArchive: true,
        receipt,
        ...(await inspectNativeSdkStatus(options)),
      },
      'Finished the previously applied Archive transaction; the Run remains cancelled and no execution was restarted.\n',
    );
  }
  if (options.recover) {
    const unknown = run.actions.filter((action) => action.status === 'unknown');
    const action = unknown.length === 1 ? unknown[0] : undefined;
    if (
      state.phase !== 'archive' ||
      !action ||
      ![
        'supervisor.parent.deliver',
        'archive.prepare',
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
    const resumedFinalization =
      action.stepId === 'archive.finalize' &&
      (await readNativePortableTransaction(
        await nativeProjectPaths(options.projectRoot, inspection.artifactRootRef, {
          readOnly: true,
        }),
        { kind: 'archive', change: state.name },
      )) !== null;
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
      run = await recoverNativeSdkArchiveOutcome({
        runtime,
        runId: run.runId,
        projectRoot: options.projectRoot,
      });
    }
    const result = success('archive', {
      change: options.name,
      recoveredAction: { id: action.id, stepId: action.stepId },
      ...(action.stepId === 'archive.finalize'
        ? {
            historicalRecovery: !resumedFinalization,
            resumedFinalization,
            currentImplementationRevalidated: false,
            recoveryMessage: resumedFinalization
              ? '已核对原候选、Specs 和报告，并继续原归档事务；没有重新运行验收检查。'
              : '已凭原持久收据补记历史归档完成；没有重新执行归档，也未重新验收当前实现。',
          }
        : {}),
      ...(await inspectNativeSdkStatus(options)),
    });
    return run.actions.find((entry) => entry.id === action.id)?.status === 'failed'
      ? {
          ...result,
          exitCode: 73,
          error: {
            code: 'blocked',
            message: '原归档预检已恢复为未通过；请按当前 Verify 修复入口继续。',
          },
        }
      : result;
  }
  let pending = run.actions.find((action) => action.status === 'pending');
  if (
    !options.dryRun &&
    pending?.stepId === 'verify.revalidate' &&
    nativeSdkPendingActions(run).length === 1 &&
    nativeSdkNextAction(run, state)?.id === pending.id &&
    !run.actions.some((action) => ['running', 'unknown'].includes(action.status)) &&
    run.waits.some(
      (wait) =>
        wait.stepId === 'verify.confirm' &&
        wait.status === 'resolved' &&
        wait.decision?.choice === 'approved',
    )
  ) {
    const { runtime, executors } = await loadOwnedNativeSdkRuntime(
      options.projectRoot,
      options.name,
    );
    const executor = executors.find((entry) => entry.supports(pending!));
    if (!executor) throw new Error('Native accepted result has no revalidation executor');
    run = await runtime.execute({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: pending.id,
      executorId: executor.id,
      context: { requestId: randomUUID(), projectRoot: options.projectRoot },
    });
    state = parseNativePortableState(run.state);
    inspection.run = run;
    inspection.state = state;
    pending = run.actions.find((action) => action.status === 'pending');
  }
  if (options.dryRun) {
    let ready = state.phase === 'archive' && pendingArchiveAction(run) !== null;
    const blockers: string[] = [];
    if (!ready)
      blockers.push(
        run.reason ??
          `Native Archive is waiting at ${pending?.stepId ?? state.loop.next_action ?? state.phase}`,
      );
    if (ready) {
      try {
        await assertNativeSdkCandidateUnchanged({
          run,
          projectRoot: options.projectRoot,
          requireEvidence: true,
        });
      } catch (error) {
        ready = false;
        blockers.push((error as Error).message);
      }
    }
    const delivery =
      ready && pending?.stepId === 'supervisor.parent.deliver'
        ? await inspectNativeSdkSupervisorDelivery(run, pending, options.projectRoot)
        : undefined;
    return success('archive --dry-run', {
      change: options.name,
      ...(await projectNativeSdkStatus(options, inspection)),
      phase: state.phase,
      status: run.status,
      ready,
      blockers,
      ...(delivery ? { delivery } : {}),
    });
  }
  if (state.phase !== 'archive' || run.status === 'cancelled') {
    return {
      ...success('archive', {
        change: options.name,
        ...(await projectNativeSdkStatus(options, { ...inspection, run, state })),
      }),
      command: 'archive',
      exitCode: 73,
      error: {
        code: 'conflict',
        message: `Native SDK Archive for ${options.name} has no pending Archive Action; inspect comet native status ${options.name} --json`,
      },
    };
  }
  const { runtime, executors } = await loadOwnedNativeSdkRuntime(options.projectRoot, options.name);
  const failedPreflight = nativeSdkRetryableArchivePreflight(run);
  if (failedPreflight) {
    run = await runtime.retry({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: failedPreflight.id,
      attempt: failedPreflight.attempt,
    });
    state = parseNativePortableState(run.state);
  }
  const failedFinalization = nativeSdkRetryableArchiveFinalization(run);
  if (failedFinalization) {
    run = await runtime.retry({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: failedFinalization.id,
      attempt: failedFinalization.attempt,
      reconciliation: {
        resolution: 'not-executed',
        evidence: {
          actionId: failedFinalization.id,
          attempt: failedFinalization.attempt,
          outcomeId: failedFinalization.outcome!.outcomeId,
          reason:
            'Runtime finalization stopped at candidate validation before any finalization writes.',
        },
      },
    });
    state = parseNativePortableState(run.state);
  }
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
