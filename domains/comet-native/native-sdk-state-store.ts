import { commitNativeSdkArchiveFailure } from './native-portable-archive.js';
import { observeWorkflowRunStore } from '../workflow-application/run-trace.js';
import {
  resolveWorkspaceRuntimeRoot,
  ensureWorkspaceRuntimeRoot,
  resolveWorkspaceRuntimeRootSync,
} from '../workflow-contract/workspace-runtime.js';
import { promises as fs } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { stringify } from 'yaml';
import {
  NATIVE_MANAGED_RUN_MARKER,
  hasNativeManagedRunMarker as hasNativeManagedRunMarkerText,
  parseNativeStateDocument,
} from './native-state-document.js';
import {
  commitNativeSdkCancellation,
  settleNativeSdkCancellation,
} from './native-sdk-cancellation-cleanup.js';
import { settleNativeSdkCompletion } from './native-sdk-completion-cleanup.js';
import { readNativeTextFilePrefix } from './native-bounded-file.js';
import {
  inspectGitWorktree,
  listGitWorktreeRoots,
  samePath,
} from '../../platform/paths/git-worktree.js';
import {
  createFileRuntimeStore,
  createPortableRunCheckpoint,
  encodePortableRunCheckpoint,
  PORTABLE_RUN_CHECKPOINT_KEY,
  readPortableRunCheckpoint,
  readRuntimeProjection,
  RuntimeProtocolError,
  type RuntimeStore,
  type WorkflowRun,
} from '../engine/runtime.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
  readSdkChangeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import { readProjectConfig } from './native-config.js';
import { atomicWriteText } from './native-atomic-file.js';
import { nativeProjectPaths } from './native-paths.js';
import { parseNativePortableState } from './native-portable-state.js';
import { nativePortableStateFile } from './native-portable-storage.js';
import { assertPortableWorkspaceBindingCurrent } from './native-portable-storage.js';
import {
  nativeSupervisorChildWorktree,
  nativeSupervisorIntegrationWorktree,
} from './native-supervisor-workspace.js';
import type { NativePortableState } from './native-portable-types.js';
import { nativeSdkRequiresIndependentReview } from './native-sdk-review.js';
import type { ApplicationIdentity } from '../workflow-application/index.js';
import { hashRuntimeValue } from '../engine/runtime.js';
type EncodedPortableRunCheckpoint = ReturnType<typeof encodePortableRunCheckpoint>;
/** A validated portable checkpoint still requires an explicit mutating recovery. */
export class NativeSdkRunRecoveryRequiredError extends Error {
  readonly code = 'NATIVE_SDK_RUN_RECOVERY_REQUIRED';
  constructor(
    readonly projectRoot: string,
    readonly change: string,
    readonly interrupted = false,
    application?: ApplicationIdentity,
  ) {
    const argv = application
      ? [
          'runtime',
          'dispatch',
          '--application-file',
          path.join(application.packageRoot, 'application.json'),
          '--project-root',
          projectRoot,
          '--request',
          '<recovery-request.json>',
          '--json',
        ]
      : null;
    super(
      argv
        ? `Native SDK Run ${change} needs checkpoint recovery. Save the recovery request JSON to a file and replace <recovery-request.json> with its path. Run comet with the exact argument array below to restore the recorded state and advance only the Runtime, without executing host work.\nRecovery argv: ${JSON.stringify(argv)}\nRecovery request: ${JSON.stringify({ operation: 'next', runId: change })}`
        : `Native SDK Run ${change} needs checkpoint recovery; run comet native doctor ${change} --repair${interrupted ? '' : ' --confirmed'} before continuing`,
    );
  }
}
export function isNativeSdkRunRecoveryRequiredError(
  error: unknown,
): error is NativeSdkRunRecoveryRequiredError {
  return (
    error instanceof Error &&
    (error as Partial<NativeSdkRunRecoveryRequiredError>).code ===
      'NATIVE_SDK_RUN_RECOVERY_REQUIRED' &&
    typeof (error as Partial<NativeSdkRunRecoveryRequiredError>).projectRoot === 'string' &&
    typeof (error as Partial<NativeSdkRunRecoveryRequiredError>).change === 'string'
  );
}
/** 外部执行及用户交接前固定可恢复状态，内部只读步骤由本地 Run 连续推进。 */
function nativeSdkCheckpointBoundary(run: WorkflowRun): boolean {
  if (run.revision === 1 || ['completed', 'cancelled', 'failed'].includes(run.status)) return true;
  if (
    (
      run.state as {
        phase?: string;
      }
    ).phase === 'shape' &&
    run.waits.some(
      (wait) =>
        ['shape.confirm', 'supervisor.shape.confirm'].includes(wait.stepId) &&
        wait.status === 'resolved' &&
        wait.decision?.choice === 'rejected',
    )
  )
    return true;
  if (
    run.waits.some((wait) => wait.status === 'pending') ||
    run.evidenceWaits?.some((wait) => wait.status === 'pending')
  )
    return true;
  return run.actions.some(
    (action) =>
      ['pending', 'running', 'unknown'].includes(action.status) &&
      (action.type === 'invoke_skill' ||
        action.type === 'handoff' ||
        Boolean(action.claim?.sessionId) ||
        !['shape.prepare', 'shape.revalidate', 'verify.revalidate', 'archive.prepare'].includes(
          action.stepId,
        )),
  );
}
function sameState(left: NativePortableState, right: NativePortableState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
/** A parent checkpoint records Child progress, but never copies a linked Git worktree. */
function assertSupervisorWorkspacesAvailable(
  run: WorkflowRun,
  state: NativePortableState,
  projectRoot: string,
): void {
  const cleanupComplete = run.actions.some(
    (action) => action.stepId === 'supervisor.cleanup' && action.status === 'succeeded',
  );
  if (cleanupComplete) return;
  const preparations = run.actions.filter(
    (action) =>
      action.status === 'succeeded' &&
      ['supervisor.prepare', 'supervisor.child.prepare'].includes(action.stepId),
  );
  if (preparations.length === 0) return;
  const registered = listGitWorktreeRoots(projectRoot);
  const required = !state.archived;
  for (const action of preparations) {
    const output = action.outcome?.output;
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      throw new Error('Native SDK Supervisor worktree receipt is invalid');
    }
    const receipt = output as Record<string, unknown>;
    const child = action.stepId === 'supervisor.child.prepare' ? receipt.child : null;
    if (action.stepId === 'supervisor.child.prepare' && typeof child !== 'string') {
      throw new Error('Native SDK Supervisor Child worktree receipt is invalid');
    }
    const expected =
      typeof child === 'string'
        ? nativeSupervisorChildWorktree(projectRoot, state.name, child)
        : nativeSupervisorIntegrationWorktree(projectRoot, state.name);
    const recorded = typeof child === 'string' ? receipt.worktree : receipt.integrationWorktree;
    const branch = typeof child === 'string' ? receipt.branch : receipt.integrationBranch;
    if (
      typeof recorded !== 'string' ||
      !samePath(recorded, expected) ||
      typeof branch !== 'string' ||
      (required &&
        (!registered.some((root) => samePath(root, expected)) ||
          inspectGitWorktree(expected).currentBranch !== branch))
    ) {
      throw new Error(
        `Native SDK Supervisor worktree unavailable in this checkout: ${expected}; transfer or repair the Child and integration worktrees before restoring the Run`,
      );
    }
  }
}
/** Resolve only one exact archived change; a reused name must not select an arbitrary Run. */
export async function findNativeSdkArchivedStateFile(
  paths: Awaited<ReturnType<typeof nativeProjectPaths>>,
  runId: string,
): Promise<string | null> {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(runId)) {
    throw new Error(`Invalid Native change name: ${runId}`);
  }
  const archive = await inspectProtectedProjectPath(
    paths.projectRoot,
    path.relative(paths.projectRoot, paths.archiveDir),
    { label: 'Native SDK Archive directory', expected: 'directory' },
  );
  if (!archive.exists) return null;
  const names = (await fs.readdir(archive.target, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        /^\d{4}-\d{2}-\d{2}-/u.test(entry.name) &&
        entry.name.slice(11) === runId,
    )
    .map((entry) => entry.name);
  if (names.length > 1) throw new Error(`Native SDK Archive ${runId} is ambiguous`);
  return names.length === 1 ? path.join(archive.target, names[0], 'comet-state.yaml') : null;
}
/** Read the unprojected local record when repairing an interrupted Run creation. */
export async function readNativeSdkRunRecord(
  projectRoot: string,
  runId: string,
): Promise<WorkflowRun | null> {
  return createFileRuntimeStore<WorkflowRun>({
    singleWriter: true,
    rootDir: path.join(await resolveWorkspaceRuntimeRoot(projectRoot), 'sdk-runs', 'native'),
  }).read(runId);
}
export async function hasNativeManagedRunMarker(file: string): Promise<boolean> {
  const { text } = await readNativeTextFilePrefix({
    root: path.dirname(file),
    ref: path.basename(file),
    maxBytes: Buffer.byteLength(NATIVE_MANAGED_RUN_MARKER) + 1,
  });
  return hasNativeManagedRunMarkerText(text);
}
export async function hasNativePortableRunCheckpoint(
  file: string,
  runId: string,
): Promise<boolean> {
  const source = await fs.readFile(file, 'utf8');
  if (!hasNativeManagedRunMarkerText(source)) return false;
  const data = parseNativeStateDocument(source, 'Native state file') as Record<string, unknown>;
  return readPortableRunCheckpoint(data[PORTABLE_RUN_CHECKPOINT_KEY], runId) !== null;
}
export async function writeNativeManagedRunState(
  file: string,
  state: NativePortableState,
  containedRoot: string,
  run?: WorkflowRun,
  archiveReceipt?: unknown,
  applicationIdentity?: ApplicationIdentity,
): Promise<void> {
  return writeNativeManagedRunProjection(
    file,
    state,
    containedRoot,
    run ? encodePortableRunCheckpoint(createPortableRunCheckpoint(run)) : undefined,
    archiveReceipt,
    applicationIdentity,
  );
}
function serializeNativeManagedRunProjection(
  state: NativePortableState,
  checkpoint?: EncodedPortableRunCheckpoint,
  archiveReceipt?: unknown,
  applicationIdentity?: ApplicationIdentity,
): string {
  return (
    NATIVE_MANAGED_RUN_MARKER +
    stringify({
      ...parseNativePortableState(state),
      ...(archiveReceipt === undefined ? {} : { archive_receipt: archiveReceipt }),
      ...(applicationIdentity ? { application_checkpoint: applicationIdentity } : {}),
    }) +
    (checkpoint ? `${PORTABLE_RUN_CHECKPOINT_KEY}: ${JSON.stringify(checkpoint)}\n` : '')
  );
}
async function writeNativeManagedRunProjection(
  file: string,
  state: NativePortableState,
  containedRoot: string,
  checkpoint?: EncodedPortableRunCheckpoint,
  archiveReceipt?: unknown,
  applicationIdentity?: ApplicationIdentity,
): Promise<void> {
  await atomicWriteText(
    file,
    serializeNativeManagedRunProjection(state, checkpoint, archiveReceipt, applicationIdentity),
    { containedRoot },
  );
}
/** Keep the existing portable state file current when a built-in SDK Run commits. */
export function createNativeSdkStateStore(
  projectRoot: string,
  options: {
    store?: RuntimeStore<WorkflowRun>;
    identity?: ApplicationIdentity;
    readOnly?: boolean;
    allowBranchRebind?: boolean;
    rootRunId?: string;
  } = {},
  projectionRead = false,
): RuntimeStore<WorkflowRun> {
  const workspaceRuntimeRoot = resolveWorkspaceRuntimeRootSync(projectRoot);
  const store = observeWorkflowRunStore(
    projectRoot,
    'native',
    options.store ??
      createFileRuntimeStore<WorkflowRun>({
        singleWriter: true,
        rootDir: path.join(workspaceRuntimeRoot, 'sdk-runs', 'native'),
      }),
  );
  function assertMutationWorkspace(): void {
    if (resolveWorkspaceRuntimeRootSync(projectRoot) !== workspaceRuntimeRoot)
      throw new Error(
        'Native SDK workspace identity changed; recreate the store in the current workspace',
      );
  }
  function parseProjection(_file: string, source: string): Record<string, unknown> {
    return parseNativeStateDocument(source, 'Native portable state') as Record<string, unknown>;
  }
  async function readPortableSource(file: string): Promise<string> {
    // 既有 portable 读取不设大小上限；保留完整内容并在恢复与普通读取中校验路径竞态。
    return (
      await readProtectedProjectFile(
        projectRoot,
        path.relative(projectRoot, file),
        Number.MAX_SAFE_INTEGER,
        { label: 'Native portable state' },
      )
    ).bytes.toString('utf8');
  }
  async function recoverFromPortableFile(
    runId: string,
    interrupted?: WorkflowRun,
    readOnly = options.readOnly,
  ): Promise<WorkflowRun | null> {
    const config = await readProjectConfig(projectRoot);
    if (!config) return null;
    const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root, {
      ...options,
      readOnly,
      change: runId,
    });
    const activeFile = nativePortableStateFile(paths, runId);
    let file = activeFile;
    let source: string;
    try {
      source = await readPortableSource(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const archivedFile = await findNativeSdkArchivedStateFile(paths, runId);
      if (!archivedFile) return null;
      file = archivedFile;
      source = await readPortableSource(file);
    }
    if (!hasNativeManagedRunMarkerText(source)) return null;
    const data = parseNativeStateDocument(source, 'Native state file') as Record<string, unknown>;
    const saved = readPortableRunCheckpoint(data[PORTABLE_RUN_CHECKPOINT_KEY], runId, {
      preserveSourceRevision: true,
    });
    if (!saved) return null;
    if (
      hashRuntimeValue((data.application_checkpoint ?? null) as never) !==
      hashRuntimeValue((options.identity ?? null) as never)
    ) {
      throw new Error('Native portable checkpoint requires its original fixed Application package');
    }
    const state = parseNativePortableState(data);
    const input = saved.input as {
      name?: unknown;
      artifactRootRef?: unknown;
    } | null;
    if (
      !sameState(parseNativePortableState(saved.state), state) ||
      input?.name !== runId ||
      input.artifactRootRef !== paths.artifactRootRef ||
      saved.workflow.id !== 'comet-native' ||
      (file !== activeFile && !state.archived)
    ) {
      throw new Error(`Native portable Run checkpoint for ${runId} does not match its state`);
    }
    if (!options.identity) {
      const [{ nativeSdkApplicationForRun }, { upgradeNativeRun }] = await Promise.all([
        import('./native-sdk-application.js'),
        import('./native-sdk-run-upgrade.js'),
      ]);
      if (options.rootRunId === runId && saved.lineage.length > 0)
        throw new Error('Native Child Run must be restored through its original parent');
      const definition = nativeSdkApplicationForRun(null);
      upgradeNativeRun(saved, definition.workflow, definition.transitionHandler);
    }
    // 已取消 Run 只恢复原记录并封存，不会在新分支派发任务。
    if (
      !options.allowBranchRebind &&
      saved.status !== 'cancelled' &&
      !(state.archived && saved.status === 'completed')
    )
      assertPortableWorkspaceBindingCurrent(projectRoot, {
        isolation: state.workspace.isolation,
        changeBranch: state.workspace.change_branch,
        targetBranch: state.workspace.target_branch,
      });
    assertSupervisorWorkspacesAvailable(saved, state, projectRoot);
    const revision = saved.revision;
    const restored: WorkflowRun = { ...saved, revision };
    if (
      interrupted &&
      hashRuntimeValue(interrupted) !== hashRuntimeValue({ ...restored, revision: 1 })
    ) {
      throw new Error(
        `Native SDK Run ${runId} differs from the interrupted checkpoint import; preserve the local records and restore matching Run history before continuing`,
      );
    }
    if (readOnly) return restored;
    if ((revision > 1 || interrupted) && !store.restoreCheckpoint) {
      throw new Error(
        `Native RuntimeStore cannot restore checkpoint revision ${revision}; use a store with restoreCheckpoint support or restore the original Run history`,
      );
    }
    const application = options.identity?.id ?? 'native';
    const archivedOwner =
      state.archived && saved.status === 'completed'
        ? await readSdkChangeOwner(projectRoot, 'native', runId, { readOnly: true })
        : null;
    // A lost local Run does not reopen an already archived, matching owner.
    if (archivedOwner?.application !== application || archivedOwner.runId !== runId)
      await registerSdkChangeOwner(projectRoot, {
        schema: COMET_CHANGE_OWNER_SCHEMA,
        workflow: 'native',
        change: runId,
        format: 'sdk',
        application,
        runId,
      });
    if (revision === 1 && !interrupted) await store.compareAndSwap(runId, null, restored);
    else await store.restoreCheckpoint!(runId, interrupted ? 1 : null, restored);
    return store.read(runId);
  }
  async function syncBoundaryCheckpoint(run: WorkflowRun, publish: boolean): Promise<WorkflowRun> {
    const state = parseNativePortableState(run.state);
    const input = run.input as {
      name?: unknown;
      artifactRootRef?: unknown;
    } | null;
    if (
      state.name !== run.runId ||
      input?.name !== run.runId ||
      typeof input.artifactRootRef !== 'string'
    )
      throw new Error(`Native SDK Run ${run.runId} does not match its portable state`);
    const config = await readProjectConfig(projectRoot);
    if (config && config.native.artifact_root !== input.artifactRootRef)
      throw new Error('Native artifact root changed after Run creation');
    if (!publish || !nativeSdkCheckpointBoundary(run)) return run;

    const current = run;
    const currentState = state;
    const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef as string, {
      change: run.runId,
    });
    let file = nativePortableStateFile(paths, run.runId);
    try {
      await fs.access(path.dirname(file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (!currentState.archived) return current;
      const archivedFile = await findNativeSdkArchivedStateFile(paths, run.runId);
      if (!archivedFile)
        throw new Error(`Native SDK Archive ${run.runId} is ambiguous`, { cause: error });
      file = archivedFile;
    }
    let source: string | null = null;
    try {
      source = await readPortableSource(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const archiveReceipt =
      source && current.actions.some((action) => action.stepId === 'archive.finalize')
        ? parseProjection(file, source).archive_receipt
        : undefined;
    const checkpoint = encodePortableRunCheckpoint(createPortableRunCheckpoint(current));
    const expected = serializeNativeManagedRunProjection(
      currentState,
      checkpoint,
      archiveReceipt,
      options.identity,
    );
    if (source !== expected)
      await atomicWriteText(file, expected, { containedRoot: paths.nativeRoot });
    return current;
  }
  async function syncStateFile(
    runId: string,
    publishCheckpoint = false,
  ): Promise<WorkflowRun | null> {
    let run: WorkflowRun | null;
    if (projectionRead) {
      try {
        run = (await readRuntimeProjection(store, runId)).record;
      } catch (error) {
        if (
          (
            error as {
              code?: string;
            }
          ).code !== 'RUN_NOT_FOUND'
        )
          throw error;
        run = null;
      }
    } else run = await store.read(runId);
    const interrupted =
      run?.revision === 1 && run.actions.some((action) => action.status !== 'pending')
        ? run
        : undefined;
    if (!run || interrupted) {
      const recovered = await recoverFromPortableFile(runId, interrupted, true);
      if (!recovered) return run;
      if (!run || recovered.revision > run.revision) {
        if (options.readOnly)
          throw new NativeSdkRunRecoveryRequiredError(
            projectRoot,
            runId,
            Boolean(interrupted),
            options.identity,
          );
        assertMutationWorkspace();
        await ensureWorkspaceRuntimeRoot(projectRoot);

        run = await recoverFromPortableFile(runId, interrupted, false);
      }
    }
    return run ? syncBoundaryCheckpoint(run, publishCheckpoint && !options.readOnly) : null;
  }
  return {
    queryScope: store.queryScope,
    read: syncStateFile,
    readProjection: (runId) =>
      createNativeSdkStateStore(projectRoot, { ...options, store, readOnly: true }, true).read(
        runId,
      ),
    async compareAndSwap(runId, expectedRevision, next) {
      if (options.readOnly) throw new Error('Native SDK diagnostic store is read-only');
      assertMutationWorkspace();
      const state = parseNativePortableState(next.state);
      for (const action of next.actions) {
        if (
          action.status !== 'running' ||
          !['verify.verifier', 'supervisor.child.verifier'].includes(action.stepId) ||
          !nativeSdkRequiresIndependentReview(next, action)
        )
          continue;
        const activation = (action.input as { activation?: { builderSessionId?: string } })
          .activation;
        const builderSessionId =
          activation?.builderSessionId ?? state.builder_handoff?.builder_execution_ref;
        if (!builderSessionId || action.claim?.sessionId !== builderSessionId) continue;
        const previous = await store.read(runId);
        const original = previous?.actions.find((entry) => entry.id === action.id);
        if (
          previous?.revision === expectedRevision &&
          (original?.status !== 'running' || !isDeepStrictEqual(original.claim, action.claim))
        ) {
          throw new RuntimeProtocolError(
            'VERIFIER_SESSION_NOT_INDEPENDENT',
            'Native Verifier requires an independent session; use a different sessionId from the Builder.',
          );
        }
      }
      const binding = state.workspace;
      try {
        assertPortableWorkspaceBindingCurrent(projectRoot, {
          isolation: binding.isolation,
          changeBranch: binding.change_branch,
          targetBranch: binding.target_branch,
        });
      } catch (error) {
        const previous = await store.read(runId);
        const newlyClaimed = next.actions.some(
          (action) =>
            action.status === 'running' &&
            !previous?.actions.some(
              (original) =>
                original.id === action.id &&
                original.status === 'running' &&
                original.attempt === action.attempt &&
                isDeepStrictEqual(original.claim, action.claim),
            ),
        );
        const reconcilesOriginal = previous?.actions.some(
          (original) =>
            ['running', 'unknown'].includes(original.status) &&
            next.actions.some(
              (action) =>
                action.id === original.id &&
                action.attempt === original.attempt &&
                isDeepStrictEqual(action.claim, original.claim),
            ),
        );
        // 分支变化不能阻止原领取回报实际结果；接管前仍禁止领取新执行。
        if (newlyClaimed || (next.status !== 'cancelled' && !reconcilesOriginal)) throw error;
      }
      const commit = () => store.compareAndSwap(runId, expectedRevision, next);
      const failedArchive = [...next.actions]
        .reverse()
        .find((action) => action.stepId === 'archive.execute' && action.status === 'failed');
      const previousRun = failedArchive ? await store.read(runId) : null;
      const recoveringArchiveFailure = previousRun?.actions.some(
        (action) => action.id === failedArchive?.id && action.status === 'unknown',
      );
      const committed =
        next.status === 'cancelled'
          ? await commitNativeSdkCancellation({ projectRoot, store, runId, expectedRevision, next })
          : recoveringArchiveFailure
            ? await commitNativeSdkArchiveFailure({
                projectRoot,
                store,
                runId,
                expectedRevision,
                next,
                actionId: failedArchive!.id,
                state,
              })
            : await commit();
      if (committed) {
        await syncBoundaryCheckpoint(next, true);
        if (next.status === 'cancelled') {
          await settleNativeSdkCancellation({ projectRoot, run: next });
        }
        if (next.status === 'completed') {
          await settleNativeSdkCompletion({ projectRoot, run: next });
        }
      }
      return committed;
    },
  };
}
