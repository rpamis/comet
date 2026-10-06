import { NativeUsageError, success, type DispatchResult } from './native-cli-shared.js';
import { recoverNativeSdkArchiveOutcome } from './native-sdk-archive.js';
import { recoverNativeSdkSupervisorCleanupOutcome } from './native-sdk-supervisor-cleanup.js';
import {
  inspectNativeSdkSupervisorDelivery,
  recoverNativeSdkSupervisorDeliveryOutcome,
} from './native-sdk-supervisor-deliver.js';
import { inspectNativeSdkStatus } from './native-sdk-status.js';
import { loadOwnedNativeSdkRuntime, inspectNativeSdkRun } from './native-runtime-ownership.js';
import { advanceNativeSdkChange } from './native-sdk-next.js';
import { restoreNativeSupervisorChildArchiveMaterials } from './native-sdk-supervisor-archive.js';

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
  const { run, state } = await inspectNativeSdkRun(options.projectRoot, options.name);
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
    const delivery =
      state.phase === 'archive' && pending?.stepId === 'supervisor.parent.deliver'
        ? await inspectNativeSdkSupervisorDelivery(run, pending, options.projectRoot)
        : undefined;
    return success('archive --dry-run', {
      change: options.name,
      runtimeFormat: 'sdk',
      phase: state.phase,
      status: run.status,
      ready: state.phase === 'archive' && pending !== undefined,
      ...(delivery ? { delivery } : {}),
      ...(pending ? { pendingAction: { id: pending.id, stepId: pending.stepId } } : {}),
    });
  }
  if (state.phase !== 'archive' || !pending) {
    return {
      command: 'archive',
      exitCode: 73,
      error: {
        code: 'conflict',
        message: `Native SDK Archive for ${options.name} has no pending Archive Action; inspect comet native status ${options.name} --json`,
      },
    };
  }
  const result = await advanceNativeSdkChange(options.projectRoot, options.name);
  return { ...result, command: 'archive' };
}
