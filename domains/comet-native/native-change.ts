import { NativeChangeRevisionConflictError } from './native-runtime-errors.js';
export {
  NativeChangeRevisionConflictError,
  NativeWorkspaceIsolationRequiredError,
} from './native-runtime-errors.js';
import { listNativeSdkHistoryPartitions } from './native-sdk-history-discovery.js';
import { promises as fs } from 'fs';
import {
  runWithHookReadCache,
  runWithoutHookReadCache,
} from '../../platform/process/hook-read-cache.js';
import path from 'path';
import { parseDocument, stringify } from 'yaml';

import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';
import { createFileRuntimeStore, createRuntime, type WorkflowRun } from '../engine/runtime.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';

import { readWorkflowApplicationRun } from '../workflow-application/application.js';
import { isNativeSdkCancellationComplete } from './native-sdk-cancellation.js';
import { mapWithConcurrency } from './native-concurrency.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { atomicWriteText } from './native-atomic-file.js';
import { nativeBriefTemplate } from './native-artifact-language.js';
import { assertNoPendingNativeRootMove } from './native-config.js';
import { withNativeMutation } from './native-mutation.js';
import { parseNativePortableState } from './native-portable-state.js';
import {
  isInsidePath,
  nativeChangeRuntimeDir,
  resolveContainedNativePath,
} from './native-paths.js';
import { readNativeProtectedDirectory } from './native-protected-file.js';
import { compareAndSwapNativeRevision } from './native-revision.js';

import { assertNativeTrajectoryHealthy } from './native-trajectory-recovery.js';
import {
  assertNativeWorkspaceBinding,
  inspectNativeWorkspaceAdvisory,
  inspectNativeWorkspaceBinding,
  readNativeWorkspaceIdentity,
} from './native-workspace.js';
import type {
  NativeChangeSchemaInspection,
  NativeChangeState,
  NativeProjectPaths,
} from './native-types.js';
import { NATIVE_CHANGE_SCHEMA, NATIVE_RUNTIME_PROTOCOL_VERSION } from './native-types.js';

export {
  NATIVE_CHANGE_STATE_FILE,
  NativeRuntimeCompatibilityError,
  NativeSchemaMigrationRequiredError,
  assertCapabilityId,
  assertNativeName,
  inspectNativeChangeValue,
  nativeChangeDocument,
  nativeV2ChangeDocument,
  parseLegacyNativeChangeValue,
  parseNativeChangeValue,
  parseV2NativeChangeValue,
} from './native-change-model.js';
import {
  NATIVE_CHANGE_STATE_FILE,
  NativeRuntimeCompatibilityError,
  NativeSchemaMigrationRequiredError,
  assertNativeName,
  inspectNativeChangeValue,
  nativeChangeDocument,
  parseNativeChangeValue,
} from './native-change-model.js';

export const NATIVE_BRIEF_TEMPLATE = nativeBriefTemplate('en');

export function nativeChangeDir(paths: NativeProjectPaths, name: string): string {
  assertNativeName(name);
  const target = path.join(paths.changesDir, name);
  if (!isInsidePath(paths.changesDir, target)) throw new Error('Native change path escaped');
  return target;
}

export async function hasPendingNativeSchemaMigration(
  paths: NativeProjectPaths,
  name: string,
): Promise<boolean> {
  const runtimeDir = nativeChangeRuntimeDir(paths, name);
  const file = path.join(runtimeDir, 'schema-migration.json');
  await resolveContainedNativePath(
    isInsidePath(paths.runtimeDir, file) ? paths.runtimeDir : paths.nativeRoot,
    file,
  );
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function readChangeDocumentFile(file: string, root = path.dirname(file)): Promise<unknown> {
  const ref = path.relative(root, file).split(path.sep).join('/');
  const source = await readNativeBoundedTextFile({
    root,
    ref,
    maxBytes: null,
    includeHash: false,
  });
  const document = parseDocument(source.text, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Invalid Native change file ${file}: ${document.errors[0].message}`);
  }
  return document.toJS();
}

export async function inspectNativeChange(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeChangeSchemaInspection> {
  const file = path.join(nativeChangeDir(paths, name), NATIVE_CHANGE_STATE_FILE);
  await resolveContainedNativePath(paths.nativeRoot, file);
  const inspection = inspectNativeChangeValue(await readChangeDocumentFile(file, paths.nativeRoot));
  if (inspection.state && inspection.state.name !== name) {
    throw new Error(`Native change directory/name mismatch: ${name}`);
  }
  if (await hasPendingNativeSchemaMigration(paths, name)) {
    return {
      status: 'migration-required',
      schema: inspection.schema,
      minimumRuntimeVersion: inspection.minimumRuntimeVersion,
      state: inspection.state,
      message: `Native schema migration is incomplete for ${name}; run doctor --repair`,
    };
  }
  return inspection;
}

/**
 * Read only the change state document for lightweight candidate discovery.
 *
 * Unlike `inspectNativeChange`, this deliberately does not inspect schema-migration journals,
 * baselines, workspace identity, or any other Runtime artifact. Callers must use the full
 * inspection before resuming or mutating the selected change.
 */
export async function inspectNativeChangeStateDocument(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeChangeSchemaInspection> {
  const file = path.join(nativeChangeDir(paths, name), NATIVE_CHANGE_STATE_FILE);
  await resolveContainedNativePath(paths.nativeRoot, file);
  const inspection = inspectNativeChangeValue(await readChangeDocumentFile(file, paths.nativeRoot));
  if (inspection.state && inspection.state.name !== name) {
    throw new Error(`Native change directory/name mismatch: ${name}`);
  }
  return inspection;
}

export async function readNativeChange(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeChangeState> {
  const inspection = await inspectNativeChange(paths, name);
  if (inspection.status === 'migration-required') {
    throw new NativeSchemaMigrationRequiredError(name, inspection.schema);
  }
  if (inspection.status === 'runtime-incompatible' || !inspection.state) {
    throw new NativeRuntimeCompatibilityError(inspection.schema, inspection.minimumRuntimeVersion);
  }
  await assertNativeWorkspaceBinding(paths, name);
  return inspection.state as NativeChangeState;
}

export async function writeNativeChange(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeChangeState> {
  return compareAndSwapNativeChange(paths, state, state.revision);
}

export async function compareAndSwapNativeChangeFile(
  file: string,
  state: NativeChangeState,
  expectedRevision: number,
): Promise<NativeChangeState> {
  const next = {
    ...state,
    schema: NATIVE_CHANGE_SCHEMA,
    minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
    revision: expectedRevision + 1,
  } satisfies NativeChangeState;
  const result = await compareAndSwapNativeRevision({
    expectedRevision,
    next,
    read: async () => {
      const current = parseNativeChangeValue(await readChangeDocumentFile(file));
      if (current.name !== state.name) {
        throw new Error(`Native change file/name mismatch: ${state.name}`);
      }
      return current;
    },
    write: (value) => atomicWriteText(file, stringify(nativeChangeDocument(value))),
    equals: (left, right) =>
      JSON.stringify(nativeChangeDocument(left)) === JSON.stringify(nativeChangeDocument(right)),
    conflict: (actualRevision) =>
      new NativeChangeRevisionConflictError(state.name, expectedRevision, actualRevision),
  });
  Object.assign(state, result);
  return result;
}

export async function compareAndSwapNativeChangeLocked(
  paths: NativeProjectPaths,
  state: NativeChangeState,
  expectedRevision: number,
): Promise<NativeChangeState> {
  await assertNoPendingNativeRootMove(paths.projectRoot);
  if (await hasPendingNativeSchemaMigration(paths, state.name)) {
    throw new NativeSchemaMigrationRequiredError(state.name, state.schema);
  }
  const current = await readNativeChange(paths, state.name);
  if (current.verification_protocol !== state.verification_protocol) {
    throw new Error('Native verification protocol changed outside a revisioned state transition');
  }
  await assertNativeTrajectoryHealthy(paths, state.name);
  const file = path.join(nativeChangeDir(paths, state.name), NATIVE_CHANGE_STATE_FILE);
  await resolveContainedNativePath(paths.nativeRoot, file);
  return compareAndSwapNativeChangeFile(file, state, expectedRevision);
}

export async function compareAndSwapNativeChange(
  paths: NativeProjectPaths,
  state: NativeChangeState,
  expectedRevision: number,
): Promise<NativeChangeState> {
  return withNativeMutation(paths, () =>
    compareAndSwapNativeChangeLocked(paths, state, expectedRevision),
  );
}

export async function writeNativeChangeFile(
  file: string,
  state: NativeChangeState,
): Promise<NativeChangeState> {
  return compareAndSwapNativeChangeFile(file, state, state.revision);
}

export async function readNativeChangeFile(file: string): Promise<NativeChangeState> {
  return parseNativeChangeValue(await readChangeDocumentFile(file));
}

export async function listNativeChanges(paths: NativeProjectPaths): Promise<NativeChangeState[]> {
  const names = await listNativeChangeNames(paths);
  return Promise.all(names.map((name) => readNativeChange(paths, name)));
}

async function listNativeChangeNames(paths: NativeProjectPaths): Promise<string[]> {
  let entries;
  try {
    const directory = await readNativeProtectedDirectory({
      root: paths.nativeRoot,
      directory: paths.changesDir,
      label: 'Native changes directory',
      maxEntries: Number.MAX_SAFE_INTEGER,
    });
    await directory.verify();
    entries = directory.entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
  return names;
}

export async function listActiveNativeChangesOwnedByWorkspace(
  paths: NativeProjectPaths,
): Promise<string[]> {
  // Keep this observation fresh and discard its reads before the caller creates a change.
  return runWithoutHookReadCache(() =>
    runWithHookReadCache(() => inspectActiveNativeChangesOwnedByWorkspace(paths)),
  );
}

async function inspectActiveNativeChangesOwnedByWorkspace(
  paths: NativeProjectPaths,
): Promise<string[]> {
  let workspace: ReturnType<typeof inspectGitWorktree> | undefined;
  const partitions = await listNativeSdkHistoryPartitions(paths.projectRoot);
  const historyNames = new Set(partitions.history);
  const names = new Set([
    ...(await listNativeChangeNames(paths)).filter((name) => !historyNames.has(name)),
    ...partitions.active,
  ]);
  const results = await mapWithConcurrency(
    [...names].sort(),
    4,
    async (name): Promise<PromiseSettledResult<string | null>> => {
      try {
        return { status: 'fulfilled', value: await inspect(name) };
      } catch (reason) {
        return { status: 'rejected', reason };
      }
    },
  );
  const owned: string[] = [];
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
    if (result.value) owned.push(result.value);
  }
  return owned;

  async function inspect(name: string): Promise<string | null> {
    const sdkOwner = await readSdkChangeOwner(paths.projectRoot, 'native', name, {
      readOnly: true,
    });
    if (sdkOwner) {
      const runtime = createRuntime({
        store:
          sdkOwner.application === 'native'
            ? createFileRuntimeStore<WorkflowRun>({
                singleWriter: true,
                rootDir: path.join(paths.workspaceRuntimeRoot, 'sdk-runs', 'native'),
              })
            : {
                read: (runId) =>
                  readWorkflowApplicationRun(paths.projectRoot, sdkOwner.application, runId),
                compareAndSwap: async () => false,
              },
        workflows: [],
      });
      const run = await runtime.inspect(sdkOwner.runId);
      if (
        run.workflow.id !== 'comet-native' ||
        !['1', '2', '3', '4'].includes(run.workflow.version)
      ) {
        throw new Error(`Native SDK Run ${name} does not match its change ownership`);
      }
      const state = parseNativePortableState(run.state);
      const input = run.input as {
        name?: unknown;
        artifactRootRef?: unknown;
      } | null;
      if (
        state.name !== name ||
        run.runId !== name ||
        input?.name !== name ||
        typeof input?.artifactRootRef !== 'string'
      ) {
        throw new Error(`Native SDK Run ${name} does not match its change identity`);
      }
      if (
        state.archived ||
        (await isNativeSdkCancellationComplete({
          projectRoot: paths.projectRoot,
          run,
        }))
      )
        return null;
      workspace ??= inspectGitWorktree(paths.projectRoot);
      if (
        (state.workspace.change_branch !== null &&
          workspace.currentBranch !== state.workspace.change_branch) ||
        (state.workspace.isolation === 'worktree' && !workspace.isSecondaryWorktree)
      ) {
        return null;
      }
      return name;
    }
    const document = await readChangeDocumentFile(
      path.join(nativeChangeDir(paths, name), NATIVE_CHANGE_STATE_FILE),
      paths.nativeRoot,
    );
    if (
      document &&
      typeof document === 'object' &&
      (document as { schema?: unknown }).schema === 'comet.native.v4'
    ) {
      const state = parseNativePortableState(document);
      if (state.name !== name) throw new Error('Native change directory/name mismatch: ' + name);
      if (state.archived) return null;
      workspace ??= inspectGitWorktree(paths.projectRoot);
      if (
        (state.workspace.change_branch !== null &&
          workspace.currentBranch !== state.workspace.change_branch) ||
        (state.workspace.isolation === 'worktree' && !workspace.isSecondaryWorktree)
      )
        return null;
      return name;
    }
    const inspection = inspectNativeChangeValue(document);
    if (!inspection.state) {
      return name;
    }
    if (inspection.state.archived) return null;
    const identity = await readNativeWorkspaceIdentity(paths, name);
    if (identity?.schema === 'comet.native.workspace.v3') {
      const binding = await inspectNativeWorkspaceBinding({ paths, identity });
      if (binding.code === 'workspace-binding-root-changed') return null;
    } else if (identity) {
      const advisory = await inspectNativeWorkspaceAdvisory({
        paths,
        identity,
      });
      if (advisory.state === 'drifted') return null;
    }
    return name;
  }
}
