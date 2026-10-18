import { nativeSdkApplicationForRun } from './native-sdk-application.js';
import { nativeSdkMatchesRun } from './native-sdk-definition.js';
import path from 'node:path';

import {
  createFileRuntimeStore,
  createRuntime,
  hashRuntimeValue,
  type RuntimeValue,
  type WorkflowRun,
} from '../engine/runtime.js';
import {
  closeSdkChangeOwner,
  readSdkChangeOwner,
  recoverSdkChangeOwnerToActive,
} from '../workflow-contract/change-runtime-owner.js';
import { readCometCurrentSelection } from '../workflow-contract/current-selection.js';
import { resolveWorkspaceRuntimeRootSync } from '../workflow-contract/workspace-runtime.js';
import {
  inspectNativeSdkCancellation,
  inspectNativeSdkQuiescence,
} from './native-sdk-cancellation.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { nativeProjectPaths } from './native-paths.js';
import { inspectNativeSdkArchiveFinalization } from './native-portable-archive.js';
import { parseNativePortableState } from './native-portable-state.js';

/** 只封存内置 Native 的已静止终态；固定应用仍使用原有完整发现与恢复协议。 */
type NativeHistoryOptions = { projectRoot: string; run: WorkflowRun; recover?: boolean };

export async function closeNativeSdkHistory(options: NativeHistoryOptions): Promise<boolean> {
  const input = options.run.input as { artifactRootRef?: unknown } | null;
  if (typeof input?.artifactRootRef !== 'string' || !Number.isSafeInteger(options.run.revision))
    return false;
  const owner = await readSdkChangeOwner(options.projectRoot, 'native', options.run.runId, {
    readOnly: true,
  });
  if (owner?.application !== 'native') return false;
  const store = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(resolveWorkspaceRuntimeRootSync(options.projectRoot), 'sdk-runs', 'native'),
  });
  // 已封存 Run 的重复收尾不依赖其他任务持有的根变更锁。
  if ((await store.readDisposition(options.run.runId)) === 'closed')
    return closeNativeSdkHistoryLocked(options);
  const paths = await nativeProjectPaths(options.projectRoot, input.artifactRootRef, {
    readOnly: true,
  });
  return withNativeMutationLock(paths, `close Native history ${options.run.runId}`, () =>
    closeNativeSdkHistoryLocked(options),
  );
}

async function closeNativeSdkHistoryLocked(options: NativeHistoryOptions): Promise<boolean> {
  const { projectRoot } = options;
  const owner = await readSdkChangeOwner(projectRoot, 'native', options.run.runId, {
    readOnly: true,
  });
  if (!owner || owner.application !== 'native') return false;
  const store = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs', 'native'),
  });
  const record = await store.read(owner.runId);
  if (
    !record ||
    record.revision !== options.run.revision ||
    !['cancelled', 'completed'].includes(record.status)
  )
    return false;
  if (hashRuntimeValue(record) !== hashRuntimeValue(options.run))
    throw new Error('Native Run content changed at the same revision before history closure');
  const definition = nativeSdkApplicationForRun(record);
  if (!nativeSdkMatchesRun(definition.workflow, record))
    throw new Error('Native history requires a known built-in workflow definition');
  const run = await createRuntime({
    ...definition,
    workflows: [definition.workflow],
    transitionHandlers: [definition.transitionHandler],
    store: { read: async () => record, compareAndSwap: async () => false },
  }).inspect(owner.runId);
  const state = parseNativePortableState(run.state);
  const input = run.input as { name?: unknown; artifactRootRef?: unknown } | null;
  if (
    run.runId !== owner.change ||
    run.workflow.id !== 'comet-native' ||
    state.name !== owner.change ||
    input?.name !== owner.change ||
    typeof input.artifactRootRef !== 'string'
  )
    throw new Error('Native history Run does not match its change ownership');
  // 封存后的显式查看仍校验正文；重复收尾只补齐可能中断的 owner 发布。
  if ((await store.readDisposition(run.runId)) === 'closed') {
    await closeSdkChangeOwner(projectRoot, owner);
    return true;
  }
  if (
    run.ready.length > 0 ||
    run.waits.some((wait) => wait.status === 'pending') ||
    run.evidenceWaits?.some((wait) => wait.status === 'pending')
  )
    return false;
  if (run.status === 'cancelled') {
    if ((await inspectNativeSdkCancellation({ projectRoot, run }))?.status !== 'cancelled')
      return false;
  } else {
    if (!state.archived || state.phase !== 'archive' || state.status !== 'done') return false;
    if (!(await inspectNativeSdkQuiescence({ projectRoot, run })).quiescent) return false;
    const selected = await readCometCurrentSelection(projectRoot);
    if (
      selected.status === 'selected' &&
      selected.selection.workflow === 'native' &&
      selected.selection.change === run.runId
    )
      return false;
    const applied = run.outputs['archive.execute']?.value as Record<string, unknown> | undefined;
    const finalized = run.outputs['archive.finalize']?.value;
    if (
      !applied ||
      typeof applied.archiveRef !== 'string' ||
      typeof applied.transactionId !== 'string' ||
      applied.stateVersion !== state.state_version - 1 ||
      !finalized
    )
      return false;
    const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef, { readOnly: true });
    const receipt = await inspectNativeSdkArchiveFinalization({
      paths,
      state,
      runId: run.runId,
      archiveRef: applied.archiveRef,
      history: true,
    });
    if (
      receipt.transactionId !== applied.transactionId ||
      hashRuntimeValue(finalized) !== hashRuntimeValue(receipt as unknown as RuntimeValue)
    )
      throw new Error('Native history Archive receipt does not match its committed outcome');
  }
  if (options.recover && (await store.readDisposition(run.runId)) === 'reopening') {
    await recoverSdkChangeOwnerToActive(projectRoot, 'native', run.runId);
    if (!(await store.reopenRun(run.runId, run.revision))) return false;
    return closeNativeSdkHistoryLocked({ projectRoot, run });
  }
  if (!(await store.closeRun(run.runId, run.revision))) return false;
  if ((await store.readDisposition(run.runId)) !== 'closed') return false;
  await closeSdkChangeOwner(projectRoot, owner);
  return true;
}
