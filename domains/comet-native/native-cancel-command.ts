import { randomUUID } from 'node:crypto';
import { readCometCurrentSelection } from '../workflow-contract/current-selection.js';
import { nativeProjectPaths } from './native-paths.js';
import { readNativePortableTransaction } from './native-portable-transactions.js';
import { inspectNativeSdkRun, loadOwnedNativeSdkRuntime } from './native-runtime-ownership.js';
import { settleNativeSdkCancellation } from './native-sdk-cancellation-cleanup.js';
import { inspectNativeSdkCancellation } from './native-sdk-cancellation.js';
import {
  assertNoArguments,
  NativeUsageError,
  success,
  takeFlag,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';

/** 取消业务调度；原平台任务的取消、超时和进程清理由 Agent 平台负责。 */
export async function nativeCancelCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const name = args.shift();
  if (!name || name.startsWith('--')) throw new NativeUsageError('cancel requires a change name');
  const reason =
      takeOption(args, '--reason') ?? 'Cancelled by the user without completing the change',
    dryRun = takeFlag(args, '--dry-run');
  assertNoArguments(args);
  const { run, state, artifactRootRef } = await inspectNativeSdkRun(projectRoot, name);
  if (run.status === 'completed')
    throw new Error('Completed changes retain their Archive and delivery history');
  const paths = await nativeProjectPaths(projectRoot, artifactRootRef, { readOnly: true });
  if (
    (await readNativePortableTransaction(paths, { kind: 'archive', change: name })) ||
    run.actions.some(
      (action) =>
        action.stepId.startsWith('archive.') && ['running', 'unknown'].includes(action.status),
    )
  )
    throw new Error(
      'Finish or recover the original Archive transaction before cancelling: comet native archive ' +
        name +
        ' --recover',
    );
  const platformTasks = run.actions
    .filter((action) => ['running', 'unknown'].includes(action.status) && action.type === 'handoff')
    .map((action) => ({
      actionId: action.id,
      sessionId: action.claim?.sessionId,
      status: action.status,
    }));
  if (dryRun) {
    const selected = await readCometCurrentSelection(projectRoot);
    return success('cancel', {
      change: name,
      runId: run.runId,
      dryRun: true,
      willCancel: true,
      phase: state.phase,
      reason,
      platformTasks,
      selectionRelease: {
        currentlySelected: selected.status === 'selected' && selected.selection.change === name,
      },
      retained: { code: true, commits: true, workspace: true, branches: true },
    });
  }
  const cancelled =
    run.status === 'cancelled'
      ? run
      : await (
          await loadOwnedNativeSdkRuntime(projectRoot, name)
        ).runtime.cancel({
          runId: run.runId,
          expectedRevision: run.revision,
          reason,
          context: { requestId: randomUUID(), projectRoot },
        });
  await settleNativeSdkCancellation({ projectRoot, run: cancelled });
  return success('cancel', {
    change: name,
    runId: cancelled.runId,
    cancelled: true,
    ...(run.status === 'cancelled' ? { alreadyCancelled: true } : {}),
    status:
      (await inspectNativeSdkCancellation({ projectRoot, run: cancelled }))?.status ?? 'cancelled',
    reason: cancelled.reason,
    codeRetained: true,
    workspaceRetained: true,
    platformTasks,
    instruction:
      'Comet 已取消后续调度。请使用 Agent 平台取消或核对原平台任务；进程清理由平台负责。代码、批准、任务记录和已有结果保留。',
  });
}
