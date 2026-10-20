import { observeWorkflowRunStore } from '../workflow-application/run-trace.js';
import {
  resolveWorkspaceRuntimeRoot,
  resolveWorkspaceRuntimeRootSync,
} from '../workflow-contract/workspace-runtime.js';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { stringify } from 'yaml';
import { NATIVE_MANAGED_RUN_MARKER, parseNativeStateDocument } from './native-state-document.js';

import {
  commitNativeSdkCancellation,
  settleNativeSdkCancellation,
} from './native-sdk-cancellation-cleanup.js';
import { settleNativeSdkCompletion } from './native-sdk-completion-cleanup.js';
import { readNativeTextFilePrefix } from './native-bounded-file.js';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';
import {
  inspectGitWorktree,
  listGitWorktreeRoots,
  samePath,
} from '../../platform/paths/git-worktree.js';
import {
  createFileRuntimeStore,
  createPortableRunCheckpoint,
  portableRunCheckpointProjectionMatches,
  encodePortableRunCheckpoint,
  PORTABLE_RUN_CHECKPOINT_KEY,
  readPortableRunCheckpoint,
  readRuntimeProjection,
  type RuntimeStore,
  type WorkflowRun,
} from '../engine/runtime.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import { ensureProtectedProjectDirectory } from '../workflow-contract/protected-project-path.js';
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

interface ProjectionMarker {
  schema: 'comet.native.sdk-state-projection.v1';
  runId: string;
  revision: number;
  state: NativePortableState;
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
    rootDir: path.join(await resolveWorkspaceRuntimeRoot(projectRoot), 'sdk-runs', 'native'),
  }).read(runId);
}

export async function hasNativeManagedRunMarker(file: string): Promise<boolean> {
  const { text } = await readNativeTextFilePrefix({
    root: path.dirname(file),
    ref: path.basename(file),
    maxBytes: Buffer.byteLength(NATIVE_MANAGED_RUN_MARKER),
  });
  return text === NATIVE_MANAGED_RUN_MARKER;
}

export async function hasNativePortableRunCheckpoint(
  file: string,
  runId: string,
): Promise<boolean> {
  const source = await fs.readFile(file, 'utf8');
  if (!source.startsWith(NATIVE_MANAGED_RUN_MARKER)) return false;
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
  } = {},
  projectionRead = false,
): RuntimeStore<WorkflowRun> {
  const workspaceRuntimeRoot = resolveWorkspaceRuntimeRootSync(projectRoot);
  const store = observeWorkflowRunStore(
    projectRoot,
    'native',
    options.store ??
      createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(workspaceRuntimeRoot, 'sdk-runs', 'native'),
      }),
  );
  async function assertWorkspaceRuntimeCurrent(): Promise<void> {
    const rejectChangedRoot = (currentRoot: string) => {
      if (currentRoot !== workspaceRuntimeRoot) {
        throw new Error(
          'Native SDK workspace identity changed; recreate the Runtime before continuing',
        );
      }
    };
    // 旧 handle 不能初始化新 namespace，更不能继续读写它捕获的旧 authority。
    rejectChangedRoot(resolveWorkspaceRuntimeRootSync(projectRoot));
    if (!options.readOnly) rejectChangedRoot(await resolveWorkspaceRuntimeRoot(projectRoot));
  }

  const projectionDir = 'state-projections/native';
  // 仅复用本 store 实例中已经校验过的相同文本；每次仍重新读取完整文件。
  // 不信任 mtime 或磁盘 marker，外部编辑及重复 YAML key 仍走完整解析。
  let parsedProjection: { file: string; source: string; document: Record<string, unknown> } | null =
    null;

  function parseProjection(file: string, source: string): Record<string, unknown> {
    if (parsedProjection?.file === file && parsedProjection.source === source) {
      return parsedProjection.document;
    }
    const value = parseNativeStateDocument(source, 'Native portable state') as Record<
      string,
      unknown
    >;
    parsedProjection = { file, source, document: value };
    return value;
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
    marker: ProjectionMarker | null,
    interrupted?: WorkflowRun,
  ): Promise<WorkflowRun | null> {
    const config = await readProjectConfig(projectRoot);
    if (!config) return null;
    const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root, options);
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
    if (!source.startsWith(NATIVE_MANAGED_RUN_MARKER)) return null;
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
    const input = saved.input as { name?: unknown; artifactRootRef?: unknown } | null;
    if (
      !sameState(parseNativePortableState(saved.state), state) ||
      input?.name !== runId ||
      input.artifactRootRef !== paths.artifactRootRef ||
      saved.workflow.id !== 'comet-native' ||
      (file !== activeFile && !state.archived)
    ) {
      throw new Error(`Native portable Run checkpoint for ${runId} does not match its state`);
    }
    assertPortableWorkspaceBindingCurrent(projectRoot, {
      isolation: state.workspace.isolation,
      changeBranch: state.workspace.change_branch,
      targetBranch: state.workspace.target_branch,
    });
    assertSupervisorWorkspacesAvailable(saved, state, projectRoot);
    const hasSourceRevision =
      (data[PORTABLE_RUN_CHECKPOINT_KEY] as { sourceRevision?: unknown }).sourceRevision !==
      undefined;
    if (
      marker &&
      ((hasSourceRevision && marker.revision > saved.revision) ||
        ((!hasSourceRevision || marker.revision === saved.revision) &&
          !sameState(
            parseNativePortableState(marker.state),
            parseNativePortableState(saved.state),
          )))
    ) {
      throw new Error(
        `Native SDK checkpoint and projection disagree for ${runId}; restore matching Run history and state from the same backup before continuing`,
      );
    }
    const revision = hasSourceRevision ? saved.revision : (marker?.revision ?? saved.revision);
    const restored: WorkflowRun = { ...saved, revision };
    if (
      interrupted &&
      hashRuntimeValue(interrupted) !== hashRuntimeValue({ ...restored, revision: 1 })
    ) {
      throw new Error(
        `Native SDK Run ${runId} differs from the interrupted checkpoint import; preserve the local records and restore matching Run history before continuing`,
      );
    }
    if (options.readOnly) return restored;
    if ((revision > 1 || interrupted) && !store.restoreCheckpoint) {
      throw new Error(
        `Native RuntimeStore cannot restore checkpoint revision ${revision}; use a store with restoreCheckpoint support or restore the original Run history`,
      );
    }
    await registerSdkChangeOwner(projectRoot, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'native',
      change: runId,
      format: 'sdk',
      application: options.identity?.id ?? 'native',
      runId,
    });
    if (revision === 1 && !interrupted) await store.compareAndSwap(runId, null, restored);
    else await store.restoreCheckpoint!(runId, interrupted ? 1 : null, restored);
    return store.read(runId);
  }

  async function syncStateFile(runId: string): Promise<WorkflowRun | null> {
    await assertWorkspaceRuntimeCurrent();
    const inspect = async () => {
      const markerFile = path.join(workspaceRuntimeRoot, projectionDir, `${runId}.json`);
      let marker: ProjectionMarker | null = null;
      let markerSource: string | null = null;
      try {
        markerSource = (
          await readProtectedProjectFile(
            workspaceRuntimeRoot,
            `${projectionDir}/${runId}.json`,
            Number.MAX_SAFE_INTEGER,
            { label: 'Native SDK state projection marker' },
          )
        ).bytes.toString('utf8');
        marker = JSON.parse(markerSource) as ProjectionMarker;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (
        markerSource !== null &&
        (!marker ||
          marker.schema !== 'comet.native.sdk-state-projection.v1' ||
          marker.runId !== runId ||
          !Number.isSafeInteger(marker.revision) ||
          marker.revision < 1 ||
          parseNativePortableState(marker.state).name !== runId)
      ) {
        throw new Error(`Native SDK state projection marker is invalid for ${runId}`);
      }
      let run: WorkflowRun | null;
      if (projectionRead) {
        try {
          run = (await readRuntimeProjection(store, runId)).record;
        } catch (error) {
          if ((error as { code?: string }).code !== 'RUN_NOT_FOUND') throw error;
          run = null;
        }
      } else run = await store.read(runId);
      if (!run || (run.revision === 1 && marker && marker.revision > 1)) {
        const recovered = await recoverFromPortableFile(runId, marker, run ?? undefined);
        if (options.readOnly && recovered) {
          throw new NativeSdkRunRecoveryRequiredError(
            projectRoot,
            runId,
            run !== null,
            options.identity,
          );
        }
        if (run && !recovered) {
          throw new Error(
            `Native SDK Run ${runId} requires its matching portable checkpoint or original Run history before completing recovery`,
          );
        }
        run = recovered;
      }
      if (!run) return null;
      const state = parseNativePortableState(run.state);
      const input = run.input as { name?: unknown; artifactRootRef?: unknown } | null;
      if (
        state.name !== runId ||
        input?.name !== runId ||
        typeof input.artifactRootRef !== 'string'
      ) {
        throw new Error(`Native SDK Run ${runId} does not match its portable state`);
      }
      const config = await readProjectConfig(projectRoot);
      if (config && config.native.artifact_root !== input.artifactRootRef) {
        throw new Error('Native artifact root changed after Run creation');
      }
      const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef, options);
      let file = nativePortableStateFile(paths, runId);
      try {
        await fs.access(path.dirname(file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (!state.archived) {
          // A raw SDK start can commit before creating Native documents. The Run
          // is sufficient for read-only status when no projection was published.
          if (options.readOnly && marker)
            throw new Error(
              `Native SDK state projection is missing for ${runId}; run comet native doctor ${runId} --repair`,
              {
                cause: error,
              },
            );
          return run;
        }
        const archivedFile = await findNativeSdkArchivedStateFile(paths, runId);
        if (!archivedFile) {
          throw new Error(`Native SDK Archive ${runId} is ambiguous`, { cause: error });
        }
        file = archivedFile;
      }
      const expectedCheckpoint = projectionRead ? undefined : createPortableRunCheckpoint(run);
      // 仅在本次已校验快照内复用编码；后续读取仍重新核对磁盘和 Run。
      const encodedCheckpoint = expectedCheckpoint
        ? encodePortableRunCheckpoint(expectedCheckpoint)
        : undefined;
      let current: NativePortableState | null = null;
      let currentSource: string | null = null;
      let currentDocument: Record<string, unknown> | null = null;
      try {
        currentSource = await readPortableSource(file);
        // 只对完整字节相等的内置活动投影复用权威状态；任何编辑或额外字段仍严格解析。
        const canonical =
          options.readOnly &&
          !projectionRead &&
          !options.identity &&
          !state.archived &&
          currentSource === serializeNativeManagedRunProjection(state, encodedCheckpoint);
        currentDocument = canonical
          ? {
              ...state,
              [PORTABLE_RUN_CHECKPOINT_KEY]: encodedCheckpoint,
            }
          : parseProjection(file, currentSource);
        current = parseNativePortableState(currentDocument);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (marker && marker.revision > run.revision) {
        throw new Error(`Native SDK state projection marker is invalid for ${runId}`);
      }
      if (current && !sameState(current, state)) {
        const recoveryHash = (run.input as { recoverySourceHash?: unknown } | null)
          ?.recoverySourceHash;
        const matchesRecoverySource =
          marker === null &&
          run.revision === 1 &&
          typeof recoveryHash === 'string' &&
          currentSource !== null &&
          createHash('sha256').update(currentSource).digest('hex') === recoveryHash;
        if (
          !matchesRecoverySource &&
          (!marker || !sameState(current, parseNativePortableState(marker.state)))
        ) {
          throw new Error(`Native state file ${file} differs from SDK Run ${runId}`);
        }
      }
      const currentCheckpoint = currentDocument?.[PORTABLE_RUN_CHECKPOINT_KEY];
      let checkpointMatches: boolean;
      if (projectionRead) {
        // 同时校验实际 portable 正文与权威 Run 的规范化身份，不能只信可编辑 marker。
        checkpointMatches = portableRunCheckpointProjectionMatches(currentCheckpoint, run);
        if (
          hashRuntimeValue((currentDocument?.application_checkpoint ?? null) as never) !==
          hashRuntimeValue((options.identity ?? null) as never)
        )
          throw new Error('Native portable 投影与原固定应用身份不一致');
      } else {
        checkpointMatches =
          isDeepStrictEqual(currentCheckpoint, expectedCheckpoint) ||
          isDeepStrictEqual(currentCheckpoint, encodedCheckpoint);
      }
      const archiveReceipt = currentDocument?.['archive_receipt'];
      const unresolvedFinalization = run.actions.some(
        (action) => action.stepId === 'archive.finalize',
      );
      if (
        !current ||
        !sameState(current, state) ||
        !currentSource?.startsWith(NATIVE_MANAGED_RUN_MARKER) ||
        !checkpointMatches
      ) {
        if (options.readOnly)
          throw new Error(
            `Native SDK state projection needs recovery for ${runId}; run comet native doctor ${runId} --repair`,
          );
        await writeNativeManagedRunProjection(
          file,
          state,
          paths.nativeRoot,
          encodedCheckpoint,
          unresolvedFinalization ? archiveReceipt : undefined,
          options.identity,
        );
      }
      const projection: ProjectionMarker = {
        schema: 'comet.native.sdk-state-projection.v1',
        runId,
        revision: run.revision,
        state,
      };
      const projectionSource = JSON.stringify(projection) + '\n';
      if (markerSource !== projectionSource) {
        if (options.readOnly)
          throw new Error(
            `Native SDK state projection marker needs recovery for ${runId}; run comet native doctor ${runId} --repair`,
          );
        await atomicWriteContainedText(markerFile, projectionSource, {
          containedRoot: workspaceRuntimeRoot,
        });
      }
      return run;
    };
    if (options.readOnly) return inspect();
    await ensureProtectedProjectDirectory(workspaceRuntimeRoot, projectionDir, {
      label: 'Native SDK state projection directory',
    });
    const lockFile = path.join(workspaceRuntimeRoot, projectionDir, `${runId}.lock`);
    return withRecoverableFileLock(lockFile, inspect, { timeoutMs: 5_000 });
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
      await assertWorkspaceRuntimeCurrent();
      const committed =
        next.status === 'cancelled'
          ? await commitNativeSdkCancellation({ projectRoot, store, runId, expectedRevision, next })
          : await store.compareAndSwap(runId, expectedRevision, next);
      if (committed) {
        await syncStateFile(runId);
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
