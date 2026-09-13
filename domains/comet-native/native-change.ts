import { promises as fs } from 'fs';
import path from 'path';
import { parseDocument, stringify } from 'yaml';

import { listGitWorktreeRoots } from '../../platform/paths/git-worktree.js';

import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { atomicWriteText } from './native-atomic-file.js';
import { nativeBriefTemplate } from './native-artifact-language.js';
import {
  assertNoPendingNativeRootMove,
  DEFAULT_NATIVE_SNAPSHOT_CONFIG,
  readProjectConfig,
  writeProjectConfig,
} from './native-config.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import {
  isInsidePath,
  nativeChangeRuntimeDir,
  nativePreferredChangeRuntimeDir,
  nativeProjectPaths,
  resolveContainedNativePath,
} from './native-paths.js';
import { readNativeProtectedDirectory } from './native-protected-file.js';
import { compareAndSwapNativeRevision } from './native-revision.js';
import {
  createNativeContentSnapshot,
  inspectNativeContentSnapshotHealth,
  readNativeBaselineManifest,
  writeNativeBaselineManifest,
} from './native-snapshot.js';
import { assertNativeTrajectoryHealthy } from './native-trajectory-recovery.js';
import {
  assertNativeWorkspaceBindingCurrent,
  assertNativeWorkspaceBinding,
  inspectNativeWorkspaceAdvisory,
  inspectNativeWorkspaceBinding,
  readNativeWorkspaceIdentity,
  writeNativeWorkspaceIdentity,
  type NativeWorkspaceBinding,
} from './native-workspace.js';
import type {
  NativeChangeSchemaInspection,
  NativeChangeState,
  CometProjectConfig,
  NativeContentSnapshotManifest,
  NativeProjectPaths,
  NativeVerificationProtocol,
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

export class NativeChangeRevisionConflictError extends Error {
  readonly code = 'native-change-revision-conflict';

  constructor(
    readonly change: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Native change ${change} revision conflict: expected ${expectedRevision}, actual ${actualRevision}`,
    );
    this.name = 'NativeChangeRevisionConflictError';
  }
}

export class NativeWorkspaceIsolationRequiredError extends Error {
  readonly code = 'native-workspace-isolation-required';

  constructor(
    readonly requestedIsolation: NativeWorkspaceBinding['isolation'],
    readonly activeChanges: string[],
  ) {
    super(
      `Native working directory already contains active change${activeChanges.length === 1 ? '' : 's'} ${activeChanges.join(', ')}; create the new change in a separate worktree`,
    );
    this.name = 'NativeWorkspaceIsolationRequiredError';
  }
}

export class NativeBaselineIncompleteError extends Error {
  readonly code = 'native-baseline-incomplete';

  constructor(
    readonly change: string,
    readonly omittedCount: number,
    readonly omittedByReason: Record<string, number>,
    readonly samplePaths: string[],
    readonly sampleTruncated: boolean,
    readonly effectiveLimits: NativeContentSnapshotManifest['limits'] | null = null,
    readonly policyHash: string | null = null,
  ) {
    super(
      `Native change ${change} baseline is incomplete (${omittedCount} omitted entr${omittedCount === 1 ? 'y' : 'ies'}). Adjust native.snapshot scope or resource budgets in .comet/config.yaml, then retry.`,
    );
    this.name = 'NativeBaselineIncompleteError';
  }
}

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

export async function hasPendingNativeCheckpointRecovery(
  paths: NativeProjectPaths,
  name: string,
): Promise<boolean> {
  const runtimeDir = nativeChangeRuntimeDir(paths, name);
  const file = path.join(runtimeDir, 'checkpoint-journal.json');
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

export async function createNativeChange(options: {
  paths: NativeProjectPaths;
  name: string;
  language: 'en' | 'zh-CN';
  verificationProtocol?: NativeVerificationProtocol;
  workspaceBinding?: NativeWorkspaceBinding;
  initialProjectConfig?: CometProjectConfig;
  now?: Date;
}): Promise<NativeChangeState> {
  return withNativeMutationLock(options.paths, `create change ${options.name}`, () =>
    createNativeChangeLocked(options),
  );
}

async function createNativeChangeLocked(options: {
  paths: NativeProjectPaths;
  name: string;
  language: 'en' | 'zh-CN';
  verificationProtocol?: NativeVerificationProtocol;
  workspaceBinding?: NativeWorkspaceBinding;
  initialProjectConfig?: CometProjectConfig;
  now?: Date;
}): Promise<NativeChangeState> {
  assertNativeName(options.name);
  if (
    options.initialProjectConfig &&
    (await readProjectConfig(options.paths.projectRoot)) === null
  ) {
    await writeProjectConfig(options.paths.projectRoot, options.initialProjectConfig);
  }
  if (options.workspaceBinding) {
    assertNativeWorkspaceBindingCurrent(options.paths.projectRoot, options.workspaceBinding);
    const activeChanges = await listActiveNativeChangesOwnedByWorkspace(options.paths);
    if (activeChanges.length > 0) {
      throw new NativeWorkspaceIsolationRequiredError(
        options.workspaceBinding.isolation,
        activeChanges,
      );
    }
  }
  const verificationProtocol = options.verificationProtocol ?? 'legacy-v1';
  const changeDir = nativeChangeDir(options.paths, options.name);
  const runtimeDir = nativePreferredChangeRuntimeDir(options.paths, options.name);
  await resolveContainedNativePath(options.paths.nativeRoot, changeDir);
  await resolveContainedNativePath(options.paths.runtimeDir, runtimeDir);
  let createdChangeDir = false;
  let createdRuntimeDir = false;
  try {
    try {
      await fs.mkdir(changeDir, { recursive: false });
      createdChangeDir = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await fs.mkdir(options.paths.changesDir, { recursive: true });
        try {
          await fs.mkdir(changeDir, { recursive: false });
          createdChangeDir = true;
        } catch (retryError) {
          if ((retryError as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new Error(`Native change already exists: ${options.name}`, {
              cause: retryError,
            });
          }
          throw retryError;
        }
      } else if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`Native change already exists: ${options.name}`, { cause: error });
      } else {
        throw error;
      }
    }
    try {
      await fs.mkdir(runtimeDir, { recursive: false });
      createdRuntimeDir = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await fs.mkdir(options.paths.changesRuntimeDir, { recursive: true });
        await fs.mkdir(runtimeDir, { recursive: false });
        createdRuntimeDir = true;
      } else if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`Native change Runtime already exists: ${options.name}`, { cause: error });
      } else {
        throw error;
      }
    }
    const state: NativeChangeState = {
      schema: NATIVE_CHANGE_SCHEMA,
      minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
      revision: 1,
      verification_protocol: verificationProtocol,
      name: options.name,
      language: options.language,
      phase: 'shape',
      brief: 'brief.md',
      approval: null,
      approved_contract_hash: null,
      spec_changes: [],
      verification_result: 'pending',
      verification_report: null,
      implementation_scope: null,
      verification_evidence: null,
      partial_allowance: null,
      archived: false,
      created_at: (options.now ?? new Date()).toISOString().slice(0, 10),
      run_id: null,
    };
    await Promise.all([
      fs.mkdir(path.join(changeDir, 'specs'), { recursive: true }),
      fs.mkdir(path.join(runtimeDir, 'checkpoints'), { recursive: true }),
      atomicWriteText(path.join(changeDir, 'brief.md'), nativeBriefTemplate(options.language)),
    ]);
    const projectConfig = await readProjectConfig(options.paths.projectRoot);
    const snapshot = projectConfig?.native.snapshot ?? DEFAULT_NATIVE_SNAPSHOT_CONFIG;
    const baseline = await createNativeContentSnapshot(options.paths, {
      now: options.now,
      origin: 'change-created',
      policy: snapshot,
      limits: {
        maxFiles: snapshot.max_files,
        maxFileBytes: snapshot.max_total_bytes,
        maxTotalBytes: snapshot.max_total_bytes,
        maxDurationMs: snapshot.max_duration_ms,
      },
      deadlineMs: snapshot.max_duration_ms,
    });
    if (!baseline.complete) {
      const health = inspectNativeContentSnapshotHealth(baseline);
      const omittedByReason = baseline.omitted.reduce<Record<string, number>>((counts, item) => {
        counts[item.reason] = (counts[item.reason] ?? 0) + 1;
        return counts;
      }, {});
      const overflowCount = baseline.omissionOverflow?.count ?? 0;
      if (overflowCount > 0) omittedByReason.overflow = overflowCount;
      throw new NativeBaselineIncompleteError(
        state.name,
        baseline.omittedCount,
        omittedByReason,
        health.samplePaths,
        health.sampleTruncated,
        baseline.limits,
        baseline.policy?.hash ?? null,
      );
    }
    await writeNativeBaselineManifest(options.paths, state.name, baseline);
    await createNativeChangeFile(options.paths, state);
    await writeNativeWorkspaceIdentity({
      paths: options.paths,
      name: state.name,
      revision: state.revision,
      now: options.now,
      ...(options.workspaceBinding ? { binding: options.workspaceBinding } : {}),
    });
    return state;
  } catch (error) {
    if (createdRuntimeDir) await fs.rm(runtimeDir, { recursive: true, force: true });
    if (createdChangeDir) await fs.rm(changeDir, { recursive: true, force: true });
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
  if (inspection.status === 'current' && inspection.state) {
    await assertNativeVerificationProtocolBinding(paths, inspection.state as NativeChangeState);
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

async function assertNativeVerificationProtocolBinding(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<void> {
  const baseline = await readNativeBaselineManifest(paths, state.name);
  if (baseline === null) return;
  if (state.verification_protocol !== 'legacy-v1') {
    throw new Error(`Native verification protocol is unsupported: ${state.verification_protocol}`);
  }
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

async function createNativeChangeFile(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<void> {
  const file = path.join(nativeChangeDir(paths, state.name), NATIVE_CHANGE_STATE_FILE);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    await fs.access(file);
    throw new Error(`Native change state already exists: ${state.name}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (state.revision !== 1) throw new Error('New Native change must start at revision 1');
  await atomicWriteText(file, stringify(nativeChangeDocument(state)));
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
  options?: { allowPendingCheckpointRecovery?: boolean },
): Promise<NativeChangeState> {
  await assertNoPendingNativeRootMove(paths.projectRoot);
  if (await hasPendingNativeSchemaMigration(paths, state.name)) {
    throw new NativeSchemaMigrationRequiredError(state.name, state.schema);
  }
  if (
    !options?.allowPendingCheckpointRecovery &&
    (await hasPendingNativeCheckpointRecovery(paths, state.name))
  ) {
    throw new Error(
      `Native progress checkpoint recovery is required for ${state.name} before another state write`,
    );
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
  return withNativeMutationLock(paths, `write change ${state.name}`, () =>
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
  const owned: string[] = [];
  for (const name of await listNativeChangeNames(paths)) {
    const inspection = await inspectNativeChangeStateDocument(paths, name);
    if (!inspection.state) {
      if (await hasForeignRegisteredWorkspaceOwner(paths, name)) continue;
      owned.push(name);
      continue;
    }
    if (inspection.state.archived) continue;
    const identity = await readNativeWorkspaceIdentity(paths, name);
    if (!identity && (await hasForeignRegisteredWorkspaceOwner(paths, name))) continue;
    if (identity?.schema === 'comet.native.workspace.v3') {
      const binding = await inspectNativeWorkspaceBinding({ paths, identity });
      if (binding.code === 'workspace-binding-root-changed') continue;
    } else if (identity) {
      const advisory = await inspectNativeWorkspaceAdvisory({ paths, identity });
      if (advisory.state === 'drifted') continue;
    }
    owned.push(name);
  }
  return owned;
}

function sameWorkspaceRoot(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function hasForeignRegisteredWorkspaceOwner(
  paths: NativeProjectPaths,
  name: string,
): Promise<boolean> {
  for (const root of listGitWorktreeRoots(paths.projectRoot)) {
    if (sameWorkspaceRoot(root, paths.projectRoot)) continue;
    try {
      const config = await readProjectConfig(root);
      if (!config) continue;
      const candidatePaths = await nativeProjectPaths(root, config.native.artifact_root);
      const changeDir = path.join(candidatePaths.changesDir, name);
      const portableStateFile = path.join(changeDir, 'comet-state.yaml');
      try {
        const portableSource = await fs.readFile(portableStateFile, 'utf8');
        if (/^schema:\s*comet\.native\.v4\s*$/mu.test(portableSource)) {
          const localSource = await fs.readFile(
            path.join(nativePreferredChangeRuntimeDir(candidatePaths, name), 'state.json'),
            'utf8',
          );
          const local = JSON.parse(localSource) as {
            schema?: unknown;
            workspace?: { projectRoot?: unknown };
          };
          if (
            local.schema === 'comet.native.local-execution.v4' &&
            typeof local.workspace?.projectRoot === 'string' &&
            sameWorkspaceRoot(local.workspace.projectRoot, root)
          ) {
            return true;
          }
          continue;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          // A malformed foreign portable overlay cannot prove ownership.
        }
      }
      await fs.access(path.join(changeDir, NATIVE_CHANGE_STATE_FILE));
      const identity = await readNativeWorkspaceIdentity(candidatePaths, name);
      if (!identity) continue;
      if (identity.schema === 'comet.native.workspace.v3') {
        const binding = await inspectNativeWorkspaceBinding({ paths: candidatePaths, identity });
        if (binding.state === 'aligned') return true;
        continue;
      }
      const advisory = await inspectNativeWorkspaceAdvisory({
        paths: candidatePaths,
        identity,
      });
      if (advisory.state !== 'drifted') return true;
    } catch {
      // A foreign worktree that cannot prove ownership must not suppress the local change.
    }
  }
  return false;
}
