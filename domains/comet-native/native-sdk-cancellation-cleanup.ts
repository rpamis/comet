import { readNativePortableTransaction } from './native-portable-transactions.js';
import { closeNativeSdkHistory } from './native-sdk-history.js';
import type { WorkflowRun, RuntimeStore } from '../engine/runtime.js';
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
  const artifactRootRef = (options.run.input as { artifactRootRef?: unknown } | null)
    ?.artifactRootRef;
  if (typeof artifactRootRef === 'string') {
    const paths = await nativeProjectPaths(options.projectRoot, artifactRootRef);
    // 先保留原归档事务，等待 archive --recover 校验并收尾后再释放工作区。
    if (
      await readNativePortableTransaction(paths, {
        kind: 'archive',
        change: options.run.runId,
      })
    )
      return;
  }
  await terminateNativeSdkCheckExecutions(options);
  const cancellation = await inspectNativeSdkCancellation(options);
  if (!cancellation?.quiescent) return;
  if (!cancellation.cleanupRequired) {
    await closeNativeSdkHistory(options);
    return;
  }
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
  await closeNativeSdkHistory(options);
}

/** 在 Archive 共用锁内提交取消；投影和停止执行仍由提交后的生命周期负责。 */
export async function commitNativeSdkCancellation(options: {
  projectRoot: string;
  store: RuntimeStore<WorkflowRun>;
  runId: string;
  expectedRevision: number | null;
  next: WorkflowRun;
}): Promise<boolean> {
  const { projectRoot, store, runId, expectedRevision, next } = options;
  if (next.status !== 'cancelled')
    throw new Error('Native cancellation commit requires a cancelled Run');
  const input = next.input as { artifactRootRef?: unknown } | null;
  if (typeof input?.artifactRootRef !== 'string')
    throw new Error('Native cancellation commit requires its artifact root');
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef);
  return withNativeMutationLock(
    paths,
    `cancel SDK Native change ${runId}`,
    async () => {
      const current = await store.read(runId);
      if (current && current.status !== 'cancelled') {
        if (await readNativePortableTransaction(paths, { kind: 'archive', change: runId })) {
          throw new Error(
            `Native Archive transaction must finish before cancellation; run comet native archive ${runId} or recover its original Action with --recover`,
          );
        }
        if (
          current.actions.some(
            (action) =>
              action.stepId.startsWith('archive.') &&
              ['running', 'unknown'].includes(action.status),
          )
        ) {
          throw new Error(
            `Native Archive execution must finish or recover before cancellation; run comet native archive ${runId} --recover`,
          );
        }
      }
      return store.compareAndSwap(runId, expectedRevision, next);
    },
    { allowedPortableTransaction: { kind: 'archive', change: runId } },
  );
}
