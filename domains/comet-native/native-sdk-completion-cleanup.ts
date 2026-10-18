import { closeNativeSdkHistory } from './native-sdk-history.js';
import type { WorkflowRun } from '../engine/runtime.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import {
  clearCometCurrentSelectionIf,
  readCometCurrentSelection,
} from '../workflow-contract/current-selection.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { nativeProjectPaths } from './native-paths.js';

/** 归档动作提交、Run 落定为 completed 后调用；在 mutation lock 内释放仍指向该 Run 的当前选择。 */
export async function settleNativeSdkCompletion(options: {
  projectRoot: string;
  run: WorkflowRun;
}): Promise<void> {
  if (options.run.status !== 'completed') return;
  const input = options.run.input as { artifactRootRef?: unknown } | null;
  if (typeof input?.artifactRootRef !== 'string') return;
  const paths = await nativeProjectPaths(options.projectRoot, input.artifactRootRef);
  await withNativeMutationLock(paths, `release archived change ${options.run.runId}`, async () => {
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
      `Native SDK Run ${options.run.runId} is archived but current selection release remains pending. Run comet native doctor --json to inspect the root mutation lock owner, age, and repair conditions, then retry comet native doctor ${options.run.runId} --repair. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  });
  await closeNativeSdkHistory(options);
}
