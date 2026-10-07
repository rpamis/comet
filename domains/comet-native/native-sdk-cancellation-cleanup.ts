import type { WorkflowRun } from '../engine/runtime.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import {
  clearCometCurrentSelectionIf,
  readCometCurrentSelection,
} from '../workflow-contract/current-selection.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { nativeProjectPaths } from './native-paths.js';
import { inspectNativeSdkCancellation } from './native-sdk-cancellation.js';
import { terminateNativeSdkCheckExecutions } from './native-sdk-check-execution.js';

/** 取消 CAS 和投影锁释放后调用；确认原执行静止再在 mutation lock 内释放选择。 */
export async function settleNativeSdkCancellation(options: {
  projectRoot: string;
  run: WorkflowRun;
}): Promise<void> {
  if (options.run.status !== 'cancelled') return;
  await terminateNativeSdkCheckExecutions(options);
  const cancellation = await inspectNativeSdkCancellation(options);
  if (!cancellation?.quiescent || !cancellation.cleanupRequired) return;
  const input = options.run.input as { artifactRootRef?: unknown } | null;
  if (typeof input?.artifactRootRef !== 'string') return;
  const paths = await nativeProjectPaths(options.projectRoot, input.artifactRootRef);
  await withNativeMutationLock(paths, `release cancelled change ${options.run.runId}`, async () => {
    const selected = await readCometCurrentSelection(options.projectRoot);
    if (selected.status !== 'selected' || selected.selection.change !== options.run.runId) return;
    const owner = await readSdkChangeOwner(options.projectRoot, 'native', options.run.runId);
    const matches =
      owner &&
      (owner.application === 'native'
        ? selected.selection.workflow === 'native'
        : selected.selection.workflow === 'application' &&
          selected.selection.applicationId === owner.application);
    if (matches)
      await clearCometCurrentSelectionIf(
        options.projectRoot,
        selected.selection.workflow,
        options.run.runId,
      );
  }).catch((error: unknown) => {
    throw new Error(
      `Native cancellation is committed but current selection release remains pending. Run comet native doctor --json to inspect the root mutation lock owner, age, and repair conditions, then retry comet native doctor ${options.run.runId} --repair. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  });
}
