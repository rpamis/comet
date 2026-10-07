import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseDocument, stringify } from 'yaml';

import { readNativeTextFilePrefix } from './native-bounded-file.js';
import { withRecoverableFileLock } from '../../platform/fs/plugin-store.js';
import {
  inspectGitWorktree,
  listGitWorktreeRoots,
  samePath,
} from '../../platform/paths/git-worktree.js';
import {
  createFileRuntimeStore,
  createPortableRunCheckpoint,
  PORTABLE_RUN_CHECKPOINT_KEY,
  readPortableRunCheckpoint,
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

const NATIVE_MANAGED_RUN_MARKER = '# comet-execution: managed-run\n';

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
export function readNativeSdkRunRecord(
  projectRoot: string,
  runId: string,
): Promise<WorkflowRun | null> {
  return createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'native'),
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
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0)
    throw new Error(`Invalid Native state file: ${document.errors[0].message}`);
  const data = document.toJS() as Record<string, unknown>;
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
  await atomicWriteText(
    file,
    NATIVE_MANAGED_RUN_MARKER +
      stringify({
        ...parseNativePortableState(state),
        ...(run ? { [PORTABLE_RUN_CHECKPOINT_KEY]: createPortableRunCheckpoint(run) } : {}),
        ...(archiveReceipt === undefined ? {} : { archive_receipt: archiveReceipt }),
        ...(applicationIdentity ? { application_checkpoint: applicationIdentity } : {}),
      }),
    {
      containedRoot,
    },
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
): RuntimeStore<WorkflowRun> {
  const store =
    options.store ??
    createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'native'),
    });
  const projectionDir = '.comet/runtime/state-projections/native';
  // 仅复用本 store 实例中已经校验过的相同文本；每次仍重新读取完整文件。
  // 不信任 mtime 或磁盘 marker，外部编辑及重复 YAML key 仍走完整解析。
  let parsedProjection: { file: string; source: string; document: Record<string, unknown> } | null =
    null;

  function parseProjection(file: string, source: string): Record<string, unknown> {
    if (parsedProjection?.file === file && parsedProjection.source === source) {
      return parsedProjection.document;
    }
    const document = parseDocument(source, { uniqueKeys: true });
    if (document.errors.length > 0) {
      throw new Error(`Native portable state is invalid YAML: ${document.errors[0].message}`);
    }
    const value = document.toJS({ mapAsMap: false }) as Record<string, unknown>;
    parsedProjection = { file, source, document: value };
    return value;
  }

  async function recoverFromPortableFile(
    runId: string,
    marker: ProjectionMarker | null,
    interrupted?: WorkflowRun,
  ): Promise<WorkflowRun | null> {
    const config = await readProjectConfig(projectRoot);
    if (!config) return null;
    const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
    const activeFile = nativePortableStateFile(paths, runId);
    let file = activeFile;
    let source: string;
    try {
      source = await fs.readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const archivedFile = await findNativeSdkArchivedStateFile(paths, runId);
      if (!archivedFile) return null;
      file = archivedFile;
      source = await fs.readFile(file, 'utf8');
    }
    if (!source.startsWith(NATIVE_MANAGED_RUN_MARKER)) return null;
    const document = parseDocument(source, { uniqueKeys: true });
    if (document.errors.length > 0)
      throw new Error(`Invalid Native state file: ${document.errors[0].message}`);
    const data = document.toJS() as Record<string, unknown>;
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
    const inspect = async () => {
      const markerFile = path.join(projectRoot, projectionDir, `${runId}.json`);
      let marker: ProjectionMarker | null = null;
      let markerSource: string | null = null;
      try {
        markerSource = (
          await readProtectedProjectFile(
            projectRoot,
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
      let run = await store.read(runId);
      if (!run || (run.revision === 1 && marker && marker.revision > 1)) {
        if (options.readOnly)
          throw new Error(
            `Native SDK Run ${runId} needs checkpoint recovery; inspect comet native doctor ${runId} before continuing`,
          );
        const recovered = await recoverFromPortableFile(runId, marker, run ?? undefined);
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
      const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef);
      let file = nativePortableStateFile(paths, runId);
      try {
        await fs.access(path.dirname(file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (!state.archived) {
          if (options.readOnly)
            throw new Error(`Native SDK state projection is missing for ${runId}`, {
              cause: error,
            });
          return run; // Start can commit before artifacts are created.
        }
        const archivedFile = await findNativeSdkArchivedStateFile(paths, runId);
        if (!archivedFile) {
          throw new Error(`Native SDK Archive ${runId} is ambiguous`, { cause: error });
        }
        file = archivedFile;
      }
      let current: NativePortableState | null = null;
      let currentSource: string | null = null;
      let currentDocument: Record<string, unknown> | null = null;
      try {
        currentSource = await fs.readFile(file, 'utf8');
        currentDocument = parseProjection(file, currentSource);
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
      const expectedCheckpoint = createPortableRunCheckpoint(run);
      const currentCheckpoint = currentDocument?.[PORTABLE_RUN_CHECKPOINT_KEY];
      const archiveReceipt = currentDocument?.['archive_receipt'];
      const unresolvedFinalization = run.actions.some(
        (action) =>
          action.stepId === 'archive.finalize' &&
          (action.status === 'running' || action.status === 'unknown'),
      );
      if (
        !current ||
        !sameState(current, state) ||
        !currentSource?.startsWith(NATIVE_MANAGED_RUN_MARKER) ||
        JSON.stringify(currentCheckpoint) !== JSON.stringify(expectedCheckpoint)
      ) {
        if (options.readOnly)
          throw new Error(
            `Native SDK state projection needs recovery for ${runId}; use its named recovery command`,
          );
        await writeNativeManagedRunState(
          file,
          state,
          paths.nativeRoot,
          run,
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
            `Native SDK state projection marker needs recovery for ${runId}; use its named recovery command`,
          );
        await atomicWriteContainedText(markerFile, projectionSource, {
          containedRoot: projectRoot,
        });
      }
      return run;
    };
    if (options.readOnly) return inspect();
    await ensureProtectedProjectDirectory(projectRoot, projectionDir, {
      label: 'Native SDK state projection directory',
    });
    const lockFile = path.join(projectRoot, projectionDir, `${runId}.lock`);
    return withRecoverableFileLock(lockFile, inspect, { timeoutMs: 5_000 });
  }

  return {
    read: syncStateFile,
    async compareAndSwap(runId, expectedRevision, next) {
      if (options.readOnly) throw new Error('Native SDK diagnostic store is read-only');
      const committed = await store.compareAndSwap(runId, expectedRevision, next);
      if (committed) await syncStateFile(runId);
      return committed;
    },
  };
}
