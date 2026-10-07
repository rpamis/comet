import { promises as fs } from 'node:fs';
import type { ApplicationIdentity } from '../workflow-application/index.js';
import { hashRuntimeValue } from '../engine/runtime.js';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Document, parseDocument } from 'yaml';

import { withRecoverableFileLock } from '../../platform/fs/plugin-store.js';
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
import { readClassicProjectFile, writeClassicProjectText } from './classic-protected-path.js';
import { assertOpenSpecChangeName } from './classic-paths.js';
import {
  classicStateToDocument,
  CLASSIC_MANAGED_RUN_MARKER,
  hasClassicManagedRunMarker,
  parseClassicStateDocument,
  type ClassicState,
} from './classic-state.js';
import {
  evaluateBranchBinding,
  liveGitBranch,
  requiresBranchBinding,
} from './classic-branch-binding.js';

const USER_CONFIG_FIELDS = new Set<keyof ClassicState>([
  'language',
  'contextCompression',
  'autoTransition',
  'reviewMode',
]);

export { CLASSIC_MANAGED_RUN_MARKER, hasClassicManagedRunMarker } from './classic-state.js';

/** Read the unprojected local record when repairing an interrupted Run creation. */
export function readClassicSdkRunRecord(
  projectRoot: string,
  runId: string,
): Promise<WorkflowRun | null> {
  return createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'classic'),
  }).read(runId);
}

interface ProjectionMarker {
  schema: 'comet.classic.sdk-state-projection.v1';
  runId: string;
  revision: number;
  state: ClassicState;
}

function equal(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

function changedFields(before: ClassicState, after: ClassicState): Array<keyof ClassicState> {
  return (Object.keys(before) as Array<keyof ClassicState>).filter(
    (field) => !equal(before[field], after[field]),
  );
}

function archiveMoveIsUnresolved(run: WorkflowRun): boolean {
  return run.actions.some(
    (action) =>
      action.stepId === `${(run.state as unknown as ClassicState).workflow}.archive.execute` &&
      (action.status === 'running' || action.status === 'unknown'),
  );
}

async function stateFileCandidates(projectRoot: string, runId: string): Promise<string[]> {
  assertOpenSpecChangeName(runId);
  const files: string[] = [];
  for (const rootRef of ['openspec/changes', 'docs/openspec/changes']) {
    files.push(path.join(projectRoot, rootRef, runId, '.comet.yaml'));
    const archiveRef = `${rootRef}/archive`;
    const archive = await inspectProtectedProjectPath(projectRoot, archiveRef, {
      label: 'Classic SDK Archive directory',
      expected: 'directory',
    });
    if (!archive.exists) continue;
    for (const entry of await fs.readdir(archive.target)) {
      if (/^\d{4}-\d{2}-\d{2}-/u.test(entry) && entry.slice(11) === runId) {
        files.push(path.join(archive.target, entry, '.comet.yaml'));
      }
    }
  }
  return files;
}

/** Keep Classic's user-editable YAML at its established path while the SDK owns transitions. */
export function createClassicSdkStateStore(
  projectRoot: string,
  options: { store?: RuntimeStore<WorkflowRun>; identity?: ApplicationIdentity } = {},
): RuntimeStore<WorkflowRun> {
  const store =
    options.store ??
    createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'classic'),
    });
  const projectionDir = '.comet/runtime/state-projections/classic';

  async function recoverFromPortableFile(
    runId: string,
    marker: ProjectionMarker | null,
    interrupted?: WorkflowRun,
  ): Promise<WorkflowRun | null> {
    let found: { file: string; source: string } | null = null;
    for (const file of await stateFileCandidates(projectRoot, runId)) {
      let source: string;
      try {
        source = await readClassicProjectFile(projectRoot, file, { label: 'Classic state file' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      if (!hasClassicManagedRunMarker(source)) continue;
      if (found) throw new Error(`Classic change ${runId} has multiple SDK state files`);
      found = { file, source };
    }
    if (!found) return null;
    const document = parseDocument(found.source, { uniqueKeys: true });
    if (document.errors.length > 0) {
      throw new Error(`Invalid Classic state file: ${document.errors[0].message}`);
    }
    const data = document.toJS() as Record<string, unknown>;
    const saved = readPortableRunCheckpoint(data[PORTABLE_RUN_CHECKPOINT_KEY], runId, {
      preserveSourceRevision: true,
    });
    if (!saved) return null;
    if (
      hashRuntimeValue((data.application_checkpoint ?? null) as never) !==
      hashRuntimeValue((options.identity ?? null) as never)
    ) {
      throw new Error(
        'Classic portable checkpoint requires its original fixed Application package',
      );
    }
    const state = parseClassicStateDocument(data).classic;
    const input = saved.input as { change?: unknown; changeDir?: unknown } | null;
    const profile = saved.workflow.id.replace(/^comet-classic-/u, '');
    const edits = state ? changedFields(saved.state as unknown as ClassicState, state) : [];
    const expectedActive =
      typeof input?.changeDir === 'string'
        ? path.join(projectRoot, ...input.changeDir.split('/'), '.comet.yaml')
        : null;
    const archivedLocation = expectedActive !== null && found.file !== expectedActive;
    if (
      !state ||
      edits.some((field) => !USER_CONFIG_FIELDS.has(field)) ||
      input?.change !== runId ||
      (input.changeDir !== `openspec/changes/${runId}` &&
        input.changeDir !== `docs/openspec/changes/${runId}`) ||
      (archivedLocation && !state.archived && !archiveMoveIsUnresolved(saved)) ||
      !['full', 'hotfix', 'tweak'].includes(profile) ||
      saved.workflow.id !== `comet-classic-${profile}` ||
      state.workflow !== profile ||
      (state.boundBranch !== null && state.boundBranch !== liveGitBranch(projectRoot))
    ) {
      throw new Error(`Classic portable Run checkpoint for ${runId} does not match its state`);
    }
    const hasSourceRevision =
      (data[PORTABLE_RUN_CHECKPOINT_KEY] as { sourceRevision?: unknown }).sourceRevision !==
      undefined;
    if (
      marker &&
      ((hasSourceRevision && marker.revision > saved.revision) ||
        ((!hasSourceRevision || marker.revision === saved.revision) &&
          !equal(marker.state, saved.state)))
    ) {
      throw new Error(
        `Classic SDK checkpoint and projection disagree for ${runId}; restore matching Run history and state from the same backup before continuing`,
      );
    }
    const sourceRevision = hasSourceRevision
      ? saved.revision
      : (marker?.revision ?? saved.revision);
    // 旧版半恢复已导入允许的配置编辑；保留它们，并使用新的 CAS revision。
    const revision = sourceRevision + (interrupted && edits.length > 0 ? 1 : 0);
    const restored: WorkflowRun = {
      ...saved,
      revision,
      ...(interrupted ? { state: state as unknown as WorkflowRun['state'] } : {}),
    };
    if (
      interrupted &&
      hashRuntimeValue(interrupted) !== hashRuntimeValue({ ...restored, revision: 1 })
    ) {
      throw new Error(
        `Classic SDK Run ${runId} differs from the interrupted checkpoint import; preserve the local records and restore matching Run history before continuing`,
      );
    }
    if ((revision > 1 || interrupted) && !store.restoreCheckpoint) {
      throw new Error(
        `Classic RuntimeStore cannot restore checkpoint revision ${revision}; use a store with restoreCheckpoint support or restore the original Run history`,
      );
    }
    await registerSdkChangeOwner(projectRoot, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'classic',
      change: runId,
      format: 'sdk',
      application: options.identity?.id ?? `classic-${profile}`,
      runId,
    });
    if (revision === 1 && !interrupted) await store.compareAndSwap(runId, null, restored);
    else await store.restoreCheckpoint!(runId, interrupted ? 1 : null, restored);
    return store.read(runId);
  }

  async function stateFile(run: WorkflowRun): Promise<string | null> {
    const input = run.input as { change?: unknown; changeDir?: unknown } | null;
    if (input?.change !== run.runId || typeof input.changeDir !== 'string') {
      throw new Error(`Classic SDK Run ${run.runId} has invalid change identity`);
    }
    const relative = input.changeDir.replaceAll('\\', '/');
    if (
      relative !== `openspec/changes/${run.runId}` &&
      relative !== `docs/openspec/changes/${run.runId}`
    ) {
      throw new Error(`Classic SDK Run ${run.runId} has invalid change directory`);
    }
    const active = path.join(projectRoot, ...relative.split('/'));
    try {
      if ((await fs.stat(active)).isDirectory()) return path.join(active, '.comet.yaml');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!(run.state as unknown as ClassicState).archived && !archiveMoveIsUnresolved(run))
      return null;
    const archiveDir = path.join(path.dirname(active), 'archive');
    const archive = await inspectProtectedProjectPath(
      projectRoot,
      path.relative(projectRoot, archiveDir),
      {
        label: 'Classic SDK Archive directory',
        expected: 'directory',
      },
    );
    if (!archive.exists) return null;
    const archives = (await fs.readdir(archive.target)).filter(
      (name) => /^\d{4}-\d{2}-\d{2}-/u.test(name) && name.slice(11) === run.runId,
    );
    if (archives.length !== 1) throw new Error(`Classic SDK Archive ${run.runId} is ambiguous`);
    return path.join(archive.target, archives[0], '.comet.yaml');
  }

  async function syncStateFile(
    runId: string,
    importUserEdits: boolean,
  ): Promise<WorkflowRun | null> {
    await ensureProtectedProjectDirectory(projectRoot, projectionDir, {
      label: 'Classic SDK state projection directory',
    });
    const lockFile = path.join(projectRoot, projectionDir, `${runId}.lock`);
    return withRecoverableFileLock(
      lockFile,
      async () => {
        const markerFile = path.join(projectRoot, projectionDir, `${runId}.json`);
        let marker: ProjectionMarker | null = null;
        let markerSource: string | null = null;
        try {
          markerSource = (
            await readProtectedProjectFile(
              projectRoot,
              `${projectionDir}/${runId}.json`,
              Number.MAX_SAFE_INTEGER,
              { label: 'Classic SDK state projection marker' },
            )
          ).bytes.toString('utf8');
          marker = JSON.parse(markerSource) as ProjectionMarker;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (
          markerSource !== null &&
          (!marker ||
            marker.schema !== 'comet.classic.sdk-state-projection.v1' ||
            marker.runId !== runId ||
            !Number.isSafeInteger(marker.revision) ||
            marker.revision < 1 ||
            !parseClassicStateDocument(classicStateToDocument(marker.state)).classic)
        ) {
          throw new Error(`Classic SDK state projection marker is invalid for ${runId}`);
        }
        let loaded = await store.read(runId);
        if (!loaded || (loaded.revision === 1 && marker && marker.revision > 1)) {
          const recovered = await recoverFromPortableFile(runId, marker, loaded ?? undefined);
          if (loaded && !recovered) {
            throw new Error(
              `Classic SDK Run ${runId} requires its matching portable checkpoint or original Run history before completing recovery`,
            );
          }
          loaded = recovered;
        }
        if (!loaded) return null;
        let run: WorkflowRun = loaded;
        let state = run.state as unknown as ClassicState;
        const file = await stateFile(run);
        if (!file) return run; // Creation can commit before the change directory exists.
        let source: string | null;
        try {
          source = await readClassicProjectFile(projectRoot, file, { label: 'Classic state file' });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          source = null;
        }
        const document =
          source === null ? new Document() : parseDocument(source, { uniqueKeys: true });
        if (document.errors.length > 0)
          throw new Error(`Invalid Classic state file: ${document.errors[0].message}`);
        const documentData = document.toJS() as Record<string, unknown>;
        const fileState = source === null ? null : parseClassicStateDocument(documentData).classic;
        if (marker && marker.revision > run.revision) {
          throw new Error(`Classic SDK state projection marker is invalid for ${runId}`);
        }
        if (fileState) {
          const base = marker?.state ?? state;
          const edits = changedFields(base, fileState);
          if (edits.some((field) => !USER_CONFIG_FIELDS.has(field))) {
            const recoveryHash = (run.input as { recoverySourceHash?: unknown } | null)
              ?.recoverySourceHash;
            const matchesRecoverySource =
              marker === null &&
              run.revision === 1 &&
              typeof recoveryHash === 'string' &&
              source !== null &&
              createHash('sha256').update(source).digest('hex') === recoveryHash;
            if (!equal(fileState, state) && !matchesRecoverySource) {
              throw new Error(`Classic state file ${file} changed a Runtime-owned field`);
            }
          } else if (edits.some((field) => !equal(state[field], fileState[field]))) {
            if (!importUserEdits) {
              throw new Error(`Classic state file ${file} changed during an SDK transition`);
            }
            for (const field of edits) {
              if (!equal(state[field], base[field]) && !equal(state[field], fileState[field])) {
                throw new Error(`Classic state file ${file} conflicts with SDK field ${field}`);
              }
            }
            state = { ...state };
            for (const field of edits) {
              (state as unknown as Record<string, unknown>)[field] = fileState[field];
            }
            const next: WorkflowRun = {
              ...run,
              revision: run.revision + 1,
              state: state as unknown as WorkflowRun['state'],
            };
            if (!(await store.compareAndSwap(runId, run.revision, next))) {
              throw new Error(
                `Classic SDK Run ${runId} changed while importing state file settings`,
              );
            }
            run = next;
          }
        }
        // A change created outside Git can acquire a branch later. Bind the
        // SDK Run itself before projecting YAML; healing only .comet.yaml would
        // leave the portable checkpoint and all SDK guards out of agreement.
        // This block only heals missing bindings. Guards still probe the live
        // branch separately when rejecting drift; projection reads do not.
        if (
          fileState &&
          state.boundBranch === null &&
          requiresBranchBinding(state.isolation) &&
          !state.archived &&
          ['running', 'waiting'].includes(run.status) &&
          !run.actions.some((action) => ['running', 'unknown'].includes(action.status))
        ) {
          const binding = evaluateBranchBinding({
            isolation: state.isolation,
            boundBranch: state.boundBranch,
            currentBranch: liveGitBranch(projectRoot),
          });
          if (binding.status === 'needs-heal') {
            state = { ...state, boundBranch: binding.branch };
            const next: WorkflowRun = {
              ...run,
              revision: run.revision + 1,
              state: state as unknown as WorkflowRun['state'],
            };
            if (!(await store.compareAndSwap(runId, run.revision, next))) {
              throw new Error(`Classic SDK Run ${runId} changed while binding its Git branch`);
            }
            run = next;
          }
        }
        const target = classicStateToDocument(state);
        const current = documentData ?? {};
        for (const [key, value] of Object.entries(target)) {
          if (equal(current[key], value)) continue;
          if (value === undefined) document.delete(key);
          else document.set(key, value);
        }
        const checkpoint = createPortableRunCheckpoint(run);
        if (!equal(current[PORTABLE_RUN_CHECKPOINT_KEY], checkpoint)) {
          document.set(PORTABLE_RUN_CHECKPOINT_KEY, checkpoint);
        }
        if (options.identity && !equal(current.application_checkpoint, options.identity))
          document.set('application_checkpoint', options.identity);
        const raw = document.toString();
        const rendered = hasClassicManagedRunMarker(raw) ? raw : CLASSIC_MANAGED_RUN_MARKER + raw;
        if (source !== rendered) {
          await writeClassicProjectText(projectRoot, file, rendered, {
            label: 'Classic state file',
          });
        }
        const projection: ProjectionMarker = {
          schema: 'comet.classic.sdk-state-projection.v1',
          runId,
          revision: run.revision,
          state,
        };
        const projectionSource = JSON.stringify(projection) + '\n';
        if (markerSource !== projectionSource) {
          await atomicWriteContainedText(markerFile, projectionSource, {
            containedRoot: projectRoot,
          });
        }
        return run;
      },
      { timeoutMs: 5_000 },
    );
  }

  return {
    read: (runId) => syncStateFile(runId, true),
    async compareAndSwap(runId, expectedRevision, next) {
      const committed = await store.compareAndSwap(runId, expectedRevision, next);
      if (committed && expectedRevision !== null) await syncStateFile(runId, false);
      return committed;
    },
  };
}
