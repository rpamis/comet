import { nativeSdkApplicationForRun } from './native-sdk-application.js';
import { nativeSdkMatchesRun } from './native-sdk-definition.js';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { listGitWorktreeRoots, samePath } from '../../platform/paths/git-worktree.js';
import {
  atomicWriteContainedText,
  removeContainedFile,
} from '../workflow-contract/contained-atomic-write.js';
import { isDeepStrictEqual } from 'node:util';
import { readProjectConfig } from './native-config.js';
import { nativePortableStateFile } from './native-portable-storage.js';
import { NATIVE_MANAGED_RUN_MARKER, parseNativeStateDocument } from './native-state-document.js';
import {
  readProtectedProjectFile,
  inspectProtectedProjectPath,
} from '../workflow-contract/protected-project-path.js';

import {
  createFileRuntimeStore,
  createRuntime,
  hashRuntimeValue,
  readPortableRunCheckpoint,
  PORTABLE_RUN_CHECKPOINT_KEY,
  type RuntimeValue,
  type WorkflowRun,
} from '../engine/runtime.js';
import {
  closeSdkChangeOwner,
  readChangeRuntimeOwner,
  registerSdkChangeOwner,
  COMET_CHANGE_OWNER_SCHEMA,
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

function portableHistoryImportRef(name: string): string {
  return `native/history-imports/${hashRuntimeValue(name)}.json`;
}

async function readPortableHistoryImport(
  projectRoot: string,
  name: string,
): Promise<string | null> {
  try {
    return (
      await readProtectedProjectFile(
        resolveWorkspaceRuntimeRootSync(projectRoot),
        portableHistoryImportRef(name),
        16 * 1024,
        { label: 'Native history import journal' },
      )
    ).bytes.toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function hasNativeSdkPortableHistoryImport(
  projectRoot: string,
  name: string,
): Promise<boolean> {
  return (await readPortableHistoryImport(projectRoot, name)) !== null;
}

async function assertNoOtherNativeHistoryOwner(projectRoot: string, name: string): Promise<void> {
  for (const root of listGitWorktreeRoots(projectRoot)) {
    if (samePath(root, projectRoot)) continue;
    const owner = await readChangeRuntimeOwner(root, 'native', name, { readOnly: true });
    const store = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs/native'),
    });
    if (owner || (await store.read(name)))
      throw new Error(
        `Native history still has an authoritative record in registered worktree ${root}; inspect the original Run there before migration`,
      );
  }
}

/** 具名历史迁移专用：只导入无本地记录、已停止且无需清理的内置取消 Run。 */
export async function migrateNativeSdkPortableCancellationHistory(
  projectRoot: string,
  name: string,
): Promise<boolean> {
  const config = await readProjectConfig(projectRoot);
  if (!config) throw new Error('Native history requires project configuration');
  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root, {
    readOnly: true,
  });
  const file = nativePortableStateFile(paths, name);
  return withNativeMutationLock(paths, `migrate Native cancellation history ${name}`, async () => {
    const runtimeRoot = resolveWorkspaceRuntimeRootSync(projectRoot);
    const store = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(runtimeRoot, 'sdk-runs/native'),
    });
    await assertNoOtherNativeHistoryOwner(projectRoot, name);
    const journalSource = await readPortableHistoryImport(projectRoot, name);
    const owner = {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'native' as const,
      change: name,
      format: 'sdk' as const,
      application: 'native',
      runId: name,
    };
    let existingOwner;
    let recoverOwner = false;
    try {
      existingOwner = await readChangeRuntimeOwner(projectRoot, 'native', name, { readOnly: true });
    } catch (error) {
      if (!journalSource) throw error;
      // 双份 owner 只能在两份都精确匹配本次导入时收尾；此前不移动任何分区。
      for (const partition of ['change-owners', 'change-owner-history']) {
        const value = JSON.parse(
          (
            await readProtectedProjectFile(
              runtimeRoot,
              `${partition}/native/${name}.json`,
              16 * 1024,
              { label: 'Native history import owner' },
            )
          ).bytes.toString('utf8'),
        );
        if (!isDeepStrictEqual(value, owner)) throw error;
      }
      existingOwner = owner;
      recoverOwner = true;
    }
    const existingRun = await store.read(name);
    const marker = await inspectProtectedProjectPath(
      runtimeRoot,
      `state-projections/native/${name}.json`,
      { label: 'Native SDK state projection marker', expected: 'file' },
    );
    if (!journalSource && (existingOwner || existingRun || marker.exists))
      throw new Error(
        'Native history import cannot replace an existing local owner, Run or projection',
      );
    const sourceBytes = (
      await readProtectedProjectFile(
        projectRoot,
        path.relative(projectRoot, file),
        Number.MAX_SAFE_INTEGER,
        { label: 'Native portable history checkpoint' },
      )
    ).bytes;
    const source = sourceBytes.toString('utf8');
    if (!source.startsWith(NATIVE_MANAGED_RUN_MARKER))
      throw new Error('Native history requires a managed Run checkpoint');
    const document = parseNativeStateDocument(
      source,
      'Native portable history checkpoint',
    ) as Record<string, unknown>;
    if (document.application_checkpoint != null)
      throw new Error(
        'Native history import requires a built-in workflow, not a fixed Application',
      );
    const checkpoint = document[PORTABLE_RUN_CHECKPOINT_KEY];
    const saved = readPortableRunCheckpoint(checkpoint, name, { preserveSourceRevision: true });
    if (!saved || (checkpoint as { sourceRevision?: unknown }).sourceRevision === undefined)
      throw new Error('Native history requires a checkpoint with its original source revision');
    const state = parseNativePortableState(document);
    const input = saved.input as { name?: unknown; artifactRootRef?: unknown } | null;
    if (
      !isDeepStrictEqual(parseNativePortableState(saved.state), state) ||
      state.name !== name ||
      input?.name !== name ||
      input.artifactRootRef !== paths.artifactRootRef ||
      saved.workflow.id !== 'comet-native'
    )
      throw new Error('Native history checkpoint does not match its portable state and ownership');
    const definition = nativeSdkApplicationForRun(saved);
    if (!nativeSdkMatchesRun(definition.workflow, saved))
      throw new Error('Native history requires a known built-in workflow definition');
    const run = await createRuntime({
      ...definition,
      workflows: [definition.workflow],
      transitionHandlers: [definition.transitionHandler],
      store: { read: async () => saved, compareAndSwap: async () => false },
    }).inspect(name);
    if (
      run.status !== 'cancelled' ||
      run.children.length > 0 ||
      run.lineage.length > 0 ||
      run.actions.some((action) =>
        ['archive.execute', 'archive.finalize'].includes(action.stepId),
      ) ||
      run.ready.length > 0 ||
      run.waits.some((wait) => wait.status === 'pending') ||
      run.evidenceWaits?.some((wait) => wait.status === 'pending')
    )
      throw new Error(
        'Native history import requires a cancelled Run without child Runs, pending work or Archive execution obligations',
      );
    const selected = await readCometCurrentSelection(projectRoot);
    if (
      selected.status === 'selected' &&
      selected.selection.workflow === 'native' &&
      selected.selection.change === name
    )
      throw new Error('Native history import requires completed current-selection cleanup');
    if (
      (
        await inspectNativeSdkCancellation({
          projectRoot,
          run,
          ownerObservation: existingOwner?.format === 'sdk' ? existingOwner : null,
        })
      )?.status !== 'cancelled'
    )
      throw new Error(
        'Native history import requires original execution stop evidence and completed cleanup',
      );
    const projectionSource =
      JSON.stringify({
        schema: 'comet.native.sdk-state-projection.v1',
        runId: name,
        revision: run.revision,
        state,
      }) + '\n';
    const journal = {
      schema: 'comet.native.history-import.v1',
      workflow: 'native',
      name,
      artifactRootRef: paths.artifactRootRef,
      sourceHash: createHash('sha256').update(sourceBytes).digest('hex'),
      runHash: hashRuntimeValue(run),
      revision: run.revision,
    };
    const currentSource = (
      await readProtectedProjectFile(
        projectRoot,
        path.relative(projectRoot, file),
        Number.MAX_SAFE_INTEGER,
        { label: 'Native portable history checkpoint' },
      )
    ).bytes;
    if (!currentSource.equals(sourceBytes))
      throw new Error(
        'Native history checkpoint changed during validation; retry with stable input',
      );
    if (journalSource) {
      if (!isDeepStrictEqual(JSON.parse(journalSource), journal))
        throw new Error(
          'Native history import source changed; preserve the journal and original checkpoint',
        );
      if (existingOwner && !isDeepStrictEqual(existingOwner, owner))
        throw new Error('Native history import owner changed');
      if (existingRun && hashRuntimeValue(existingRun) !== journal.runHash)
        throw new Error('Native history import Run changed; refusing to replace local history');
      if (
        marker.exists &&
        (
          await readProtectedProjectFile(
            runtimeRoot,
            `state-projections/native/${name}.json`,
            Number.MAX_SAFE_INTEGER,
            { label: 'Native SDK state projection marker' },
          )
        ).bytes.toString('utf8') !== projectionSource
      )
        throw new Error('Native history import projection changed');
    } else {
      await atomicWriteContainedText(
        path.join(runtimeRoot, portableHistoryImportRef(name)),
        JSON.stringify(journal) + '\n',
        { containedRoot: runtimeRoot, exclusive: true, requireAtomicPublication: true },
      );
    }
    await assertNoOtherNativeHistoryOwner(projectRoot, name);
    // journal 只允许补齐同一来源的导入，不覆盖任何旧记录；不改 portable 正文或推进 Run。
    if (!existingRun && !(await store.restoreCheckpoint!(name, null, run)))
      throw new Error('Native history destination changed before checkpoint import');
    if (recoverOwner) await recoverSdkChangeOwnerToActive(projectRoot, 'native', name);
    if (!existingOwner) await registerSdkChangeOwner(projectRoot, owner);
    if (!marker.exists)
      await atomicWriteContainedText(
        path.join(runtimeRoot, `state-projections/native/${name}.json`),
        projectionSource,
        { containedRoot: runtimeRoot, exclusive: true, requireAtomicPublication: true },
      );
    const closed = await closeNativeSdkHistoryLocked({ projectRoot, run, recover: true });
    if (closed)
      await removeContainedFile(path.join(runtimeRoot, portableHistoryImportRef(name)), {
        containedRoot: runtimeRoot,
        beforeRemove: async () => {
          if (
            (await readPortableHistoryImport(projectRoot, name)) !==
            (journalSource ?? JSON.stringify(journal) + '\n')
          )
            throw new Error('Native history import journal changed before completion');
        },
      });
    return closed;
  });
}

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
