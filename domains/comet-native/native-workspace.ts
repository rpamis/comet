import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  inspectGitWorktree,
  isLocalGitBranch,
  resolveGitRef,
} from '../../platform/paths/git-worktree.js';

import { atomicWriteJson } from './native-atomic-file.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import {
  nativeChangeRuntimeDir,
  nativeStorageRoot,
  resolveContainedNativePath,
} from './native-paths.js';
import type { NativeProjectPaths, NativeWorkspaceProjection } from './native-types.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const MAX_WORKSPACE_IDENTITY_BYTES = 16 * 1024;
const HOST_PLATFORM = process.platform;

export type NativeWorkspaceIsolation = 'current' | 'branch' | 'worktree';
export type NativeWorkspaceFinish = 'merge' | 'push' | 'pull-request' | 'keep';

export interface NativeWorkspaceBinding {
  isolation: NativeWorkspaceIsolation;
  changeBranch: string | null;
  targetBranch: string | null;
}

export interface NativeWorkspaceGitProvenance {
  provider: 'git';
  baseCommit: string;
  targetBranch: string;
  targetCommit: string;
}

interface NativeWorkspaceIdentityFields {
  capturedAt: string;
  capturedRevision: number;
  nativeRootRef: string;
  projectRootId: string;
  nativeRootId: string;
  /** Stable real-path hashes used for root drift decisions. */
  projectRootPathId?: string;
  nativeRootPathId?: string;
  sessionHash?: string;
  git?: NativeWorkspaceGitProvenance;
}

export interface NativeWorkspaceIdentityV2 extends NativeWorkspaceIdentityFields {
  schema: 'comet.native.workspace.v2';
}

export interface NativeWorkspaceIdentityV3
  extends NativeWorkspaceIdentityFields, NativeWorkspaceBinding {
  schema: 'comet.native.workspace.v3';
  finish: NativeWorkspaceFinish | null;
}

export type NativeWorkspaceIdentity = NativeWorkspaceIdentityV2 | NativeWorkspaceIdentityV3;

export interface NativeWorkspaceBindingInspection {
  state: 'legacy' | 'aligned' | 'drifted';
  code:
    | 'workspace-binding-legacy'
    | 'workspace-binding-root-changed'
    | 'workspace-branch-changed'
    | 'workspace-kind-changed'
    | 'workspace-vcs-unavailable'
    | null;
  message: string | null;
}

export type NativeWorkspaceDriftComponent =
  | 'native-root-ref'
  | 'project-root-path'
  | 'native-root-path'
  | 'project-root-legacy-identity'
  | 'native-root-legacy-identity';

export type NativeWorkspaceFindingCode =
  'workspace-root-changed' | 'workspace-inspection-unavailable';

export const NATIVE_WORKSPACE_ADVISORY_CODES: ReadonlySet<NativeWorkspaceFindingCode> = new Set([
  'workspace-root-changed',
  'workspace-inspection-unavailable',
]);

export function isNativeWorkspaceAdvisoryCode(code: string): code is NativeWorkspaceFindingCode {
  return NATIVE_WORKSPACE_ADVISORY_CODES.has(code as NativeWorkspaceFindingCode);
}

export interface NativeWorkspaceAdvisory {
  state: 'aligned' | 'drifted' | 'unknown';
  findingCodes: NativeWorkspaceFindingCode[];
  driftComponents: NativeWorkspaceDriftComponent[];
}

export interface CaptureNativeWorkspaceOptions {
  paths: NativeProjectPaths;
  name: string;
  revision: number;
  now?: Date;
  sessionId?: string;
  binding?: NativeWorkspaceBinding;
  finish?: NativeWorkspaceFinish;
}

export interface ResolveNativeWorkspaceBindingOptions {
  projectRoot: string;
  isolation: NativeWorkspaceIsolation;
  changeBranch?: string;
  targetBranch?: string;
}

function portableRelative(parent: string, target: string): string | null {
  const relative = path.relative(parent, target);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    return null;
  }
  return relative.replaceAll('\\', '/') || '.';
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}

function normalizedPortableRef(value: string, label: string): string {
  if (
    value.length === 0 ||
    hasControlCharacter(value) ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    /^(?:[A-Za-z]:|~)/u.test(value) ||
    value.split('/').includes('..')
  ) {
    throw new Error(`${label} must be a portable project-relative path`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${label} must be a normalized project-relative path`);
  }
  return normalized;
}

function identityHash(tag: string, value: string): string {
  return createHash('sha256').update(`${tag}\n${value}`).digest('hex');
}

async function physicalDirectoryIdentity(tag: string, value: string): Promise<string> {
  const realPath = await fs.realpath(value);
  const stat = await fs.lstat(realPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Native workspace identity requires a real directory');
  }
  const normalizedPath =
    HOST_PLATFORM === 'win32' ? path.normalize(realPath).toLowerCase() : realPath;
  return identityHash(tag, `${normalizedPath}\n${stat.dev}\n${stat.ino}\n${stat.birthtimeMs}`);
}

async function directoryPathIdentity(tag: string, value: string): Promise<string> {
  const realPath = await fs.realpath(value);
  const stat = await fs.lstat(realPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Native workspace identity requires a real directory');
  }
  const normalizedPath =
    HOST_PLATFORM === 'win32' ? path.normalize(realPath).toLowerCase() : realPath;
  return identityHash(tag, normalizedPath);
}

function isoTimestamp(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Native workspace capturedAt is invalid');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error('Native workspace capturedAt is invalid');
  }
  return value;
}

function optionalBranch(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    throw new Error(`${label} must be a non-empty branch name or null`);
  }
  return value;
}

function assertBinding(value: NativeWorkspaceBinding): void {
  if (!new Set<NativeWorkspaceIsolation>(['current', 'branch', 'worktree']).has(value.isolation)) {
    throw new Error('Native workspace isolation must be current, branch, or worktree');
  }
  optionalBranch(value.changeBranch, 'Native workspace change branch');
  optionalBranch(value.targetBranch, 'Native workspace target branch');
  if (
    (value.isolation === 'branch' || value.isolation === 'worktree') &&
    (value.changeBranch === null || value.targetBranch === null)
  ) {
    throw new Error('Native isolated workspace requires change and target branches');
  }
}

function assertGitProvenance(value: unknown): asserts value is NativeWorkspaceGitProvenance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native workspace Git provenance must be an object');
  }
  const root = value as Record<string, unknown>;
  const allowed = new Set(['provider', 'baseCommit', 'targetBranch', 'targetCommit']);
  const unknown = Object.keys(root).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`Native workspace Git provenance has unknown field(s): ${unknown.join(', ')}`);
  }
  if (
    root.provider !== 'git' ||
    typeof root.baseCommit !== 'string' ||
    !GIT_COMMIT_PATTERN.test(root.baseCommit) ||
    typeof root.targetCommit !== 'string' ||
    !GIT_COMMIT_PATTERN.test(root.targetCommit)
  ) {
    throw new Error('Native workspace Git provenance is invalid');
  }
  optionalBranch(root.targetBranch, 'Native workspace Git target branch');
}

function assertIdentity(value: unknown): asserts value is NativeWorkspaceIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native workspace identity must be an object');
  }
  const root = value as Record<string, unknown>;
  const allowed = new Set([
    'schema',
    'capturedAt',
    'capturedRevision',
    'nativeRootRef',
    'projectRootId',
    'nativeRootId',
    'projectRootPathId',
    'nativeRootPathId',
    'sessionHash',
    'git',
    'isolation',
    'changeBranch',
    'targetBranch',
    'finish',
  ]);
  const unknown = Object.keys(root).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`Native workspace identity has unknown field(s): ${unknown.join(', ')}`);
  }
  if (root.schema !== 'comet.native.workspace.v2' && root.schema !== 'comet.native.workspace.v3') {
    throw new Error('Unsupported Native workspace identity');
  }
  if (
    !Number.isSafeInteger(root.capturedRevision) ||
    (root.capturedRevision as number) < 1 ||
    typeof root.nativeRootRef !== 'string' ||
    !HASH_PATTERN.test(String(root.projectRootId)) ||
    !HASH_PATTERN.test(String(root.nativeRootId))
  ) {
    throw new Error('Native workspace identity is invalid');
  }
  isoTimestamp(root.capturedAt);
  normalizedPortableRef(root.nativeRootRef, 'Native workspace root ref');
  const hasProjectPathId = root.projectRootPathId !== undefined;
  const hasNativePathId = root.nativeRootPathId !== undefined;
  if (hasProjectPathId !== hasNativePathId) {
    throw new Error('Native workspace path identities must be provided together');
  }
  if (
    (hasProjectPathId && !HASH_PATTERN.test(String(root.projectRootPathId))) ||
    (hasNativePathId && !HASH_PATTERN.test(String(root.nativeRootPathId)))
  ) {
    throw new Error('Native workspace path identity is invalid');
  }
  if (root.sessionHash !== undefined && !HASH_PATTERN.test(String(root.sessionHash))) {
    throw new Error('Native workspace session hash is invalid');
  }
  if (root.git !== undefined) assertGitProvenance(root.git);
  if (root.schema === 'comet.native.workspace.v2') {
    if (
      root.isolation !== undefined ||
      root.changeBranch !== undefined ||
      root.targetBranch !== undefined ||
      root.finish !== undefined
    ) {
      throw new Error('Native workspace v2 identity cannot contain a workspace binding');
    }
    return;
  }
  if (
    typeof root.isolation !== 'string' ||
    root.changeBranch === undefined ||
    root.targetBranch === undefined ||
    root.finish === undefined
  ) {
    throw new Error('Native workspace v3 identity requires a workspace binding');
  }
  assertBinding(root as unknown as NativeWorkspaceBinding);
  if (
    root.finish !== null &&
    !new Set<NativeWorkspaceFinish>(['merge', 'push', 'pull-request', 'keep']).has(
      root.finish as NativeWorkspaceFinish,
    )
  ) {
    throw new Error('Native workspace finish must be merge, push, pull-request, keep, or null');
  }
}

export function resolveNativeWorkspaceBinding(
  options: ResolveNativeWorkspaceBindingOptions,
): NativeWorkspaceBinding {
  const context = inspectGitWorktree(options.projectRoot);
  if (!context.isGitWorktree) {
    if (
      options.isolation !== 'current' ||
      options.changeBranch !== undefined ||
      options.targetBranch !== undefined
    ) {
      throw new Error('Native branch and worktree isolation require a Git working directory');
    }
    return { isolation: 'current', changeBranch: null, targetBranch: null };
  }
  if (context.currentBranch === null) {
    throw new Error('Native workspace binding requires a branch; detached HEAD is not supported');
  }
  if (options.changeBranch !== undefined && options.changeBranch !== context.currentBranch) {
    throw new Error(
      `Native change branch ${options.changeBranch} does not match the current branch ${context.currentBranch}`,
    );
  }
  if (options.isolation === 'worktree' && !context.isSecondaryWorktree) {
    throw new Error('Native worktree isolation must be created in a linked Git worktree');
  }
  if (
    (options.isolation === 'branch' || options.isolation === 'worktree') &&
    options.targetBranch === undefined
  ) {
    throw new Error(`Native ${options.isolation} isolation requires --target-branch`);
  }
  if (
    options.targetBranch !== undefined &&
    !isLocalGitBranch(options.projectRoot, options.targetBranch)
  ) {
    throw new Error(`Native target branch is not a verified local branch: ${options.targetBranch}`);
  }
  const binding: NativeWorkspaceBinding = {
    isolation: options.isolation,
    changeBranch: context.currentBranch,
    targetBranch: options.targetBranch ?? context.currentBranch,
  };
  assertBinding(binding);
  return binding;
}

export function assertNativeWorkspaceBindingCurrent(
  projectRoot: string,
  expected: NativeWorkspaceBinding,
): void {
  const current = resolveNativeWorkspaceBinding({
    projectRoot,
    isolation: expected.isolation,
    ...(expected.changeBranch !== null ? { changeBranch: expected.changeBranch } : {}),
    ...(expected.isolation !== 'current' && expected.targetBranch !== null
      ? { targetBranch: expected.targetBranch }
      : {}),
  });
  if (
    current.isolation !== expected.isolation ||
    current.changeBranch !== expected.changeBranch ||
    current.targetBranch !== expected.targetBranch
  ) {
    throw new Error('Native workspace binding changed before change creation');
  }
}

export function nativeWorkspaceFile(paths: NativeProjectPaths, name: string): string {
  return path.join(nativeChangeRuntimeDir(paths, name), 'workspace.json');
}

function nativeWorkspaceRef(
  paths: NativeProjectPaths,
  name: string,
): { root: string; ref: string } {
  const file = nativeWorkspaceFile(paths, name);
  const root = nativeStorageRoot(paths, file);
  const relative = portableRelative(root, file);
  if (!relative || relative === '.') throw new Error('Native workspace file escaped its root');
  return { root, ref: normalizedPortableRef(relative, 'Native workspace file ref') };
}

async function readNativeWorkspaceValue(
  paths: NativeProjectPaths,
  name: string,
): Promise<unknown | null> {
  try {
    const workspace = nativeWorkspaceRef(paths, name);
    const artifact = await readNativeBoundedTextFile({
      root: workspace.root,
      ref: workspace.ref,
      maxBytes: MAX_WORKSPACE_IDENTITY_BYTES,
    });
    return JSON.parse(artifact.text) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function inspectNativeWorkspaceSchema(
  paths: NativeProjectPaths,
  name: string,
): Promise<
  'comet.native.workspace.v1' | 'comet.native.workspace.v2' | 'comet.native.workspace.v3' | null
> {
  const value = await readNativeWorkspaceValue(paths, name);
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native workspace identity must be an object');
  }
  const schema = (value as { schema?: unknown }).schema;
  if (
    schema === 'comet.native.workspace.v1' ||
    schema === 'comet.native.workspace.v2' ||
    schema === 'comet.native.workspace.v3'
  ) {
    if (schema !== 'comet.native.workspace.v1') assertIdentity(value);
    return schema;
  }
  throw new Error('Unsupported Native workspace identity');
}

export async function projectNativeWorkspace(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeWorkspaceProjection> {
  const context = inspectGitWorktree(paths.projectRoot);
  const base = {
    projectRoot: path.resolve(paths.projectRoot),
    currentBranch: context.currentBranch,
    isSecondaryWorktree: context.isSecondaryWorktree,
  };
  try {
    const identity = await readNativeWorkspaceIdentity(paths, name);
    if (identity === null) {
      return {
        ...base,
        bindingState: 'missing',
        isolation: null,
        changeBranch: null,
        targetBranch: null,
        finish: null,
      };
    }
    if (identity.schema !== 'comet.native.workspace.v3') {
      return {
        ...base,
        bindingState: 'legacy',
        isolation: null,
        changeBranch: null,
        targetBranch: identity.git?.targetBranch ?? null,
        finish: null,
      };
    }
    const inspection = await inspectNativeWorkspaceBinding({ paths, identity });
    return {
      ...base,
      bindingState: inspection.state === 'aligned' ? 'aligned' : 'drifted',
      isolation: identity.isolation,
      changeBranch: identity.changeBranch,
      targetBranch: identity.targetBranch,
      finish: identity.finish,
    };
  } catch {
    return {
      ...base,
      bindingState: 'invalid',
      isolation: null,
      changeBranch: null,
      targetBranch: null,
      finish: null,
    };
  }
}

export async function nativeWorkspaceIdentityNeedsMigration(
  paths: NativeProjectPaths,
  name: string,
): Promise<boolean> {
  const value = await readNativeWorkspaceValue(paths, name);
  if (value === null) return false;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native workspace identity must be an object');
  }
  if ((value as { schema?: unknown }).schema === 'comet.native.workspace.v1') return true;
  assertIdentity(value);
  if (value.schema === 'comet.native.workspace.v3') return false;
  return value.projectRootPathId === undefined || value.nativeRootPathId === undefined;
}

export async function inspectNativeWorkspaceIdentity(
  options: CaptureNativeWorkspaceOptions,
): Promise<NativeWorkspaceIdentity> {
  if (!Number.isSafeInteger(options.revision) || options.revision < 1) {
    throw new Error('Native workspace revision must be a positive integer');
  }
  const nativeRootRef = portableRelative(options.paths.projectRoot, options.paths.nativeRoot);
  if (!nativeRootRef) throw new Error('Native root is outside the project root');
  const gitContext = inspectGitWorktree(options.paths.projectRoot);
  const baseCommit = gitContext.isGitWorktree
    ? resolveGitRef(options.paths.projectRoot, 'HEAD')
    : null;
  const targetBranch = options.binding?.targetBranch ?? gitContext.currentBranch;
  const targetCommit =
    targetBranch === null || targetBranch === undefined
      ? null
      : resolveGitRef(options.paths.projectRoot, targetBranch);
  const git =
    baseCommit !== null &&
    targetBranch !== null &&
    targetBranch !== undefined &&
    targetCommit !== null
      ? {
          provider: 'git' as const,
          baseCommit,
          targetBranch,
          targetCommit,
        }
      : undefined;
  const [projectRootId, nativeRootId, projectRootPathId, nativeRootPathId] = await Promise.all([
    physicalDirectoryIdentity('comet.native.workspace-project-root.v2', options.paths.projectRoot),
    physicalDirectoryIdentity('comet.native.workspace-native-root.v2', options.paths.nativeRoot),
    directoryPathIdentity('comet.native.workspace-project-root-path.v2', options.paths.projectRoot),
    directoryPathIdentity('comet.native.workspace-native-root-path.v2', options.paths.nativeRoot),
  ]);
  const capturedAt = (options.now ?? new Date()).toISOString();
  if (options.finish && !options.binding) {
    throw new Error('Native workspace finish requires a workspace binding');
  }
  if (options.binding) assertBinding(options.binding);
  const fields: NativeWorkspaceIdentityFields = {
    capturedAt,
    capturedRevision: options.revision,
    nativeRootRef,
    projectRootId,
    nativeRootId,
    projectRootPathId,
    nativeRootPathId,
    ...(git ? { git } : {}),
    ...(options.sessionId
      ? {
          sessionHash: identityHash(
            'comet.native.workspace-session.v2',
            `${projectRootId}\n${nativeRootId}\n${options.sessionId}`,
          ),
        }
      : {}),
  };
  const identity: NativeWorkspaceIdentity = options.binding
    ? {
        schema: 'comet.native.workspace.v3',
        ...fields,
        ...options.binding,
        finish: options.finish ?? null,
      }
    : { schema: 'comet.native.workspace.v2', ...fields };
  assertIdentity(identity);
  return identity;
}

export async function writeNativeWorkspaceIdentity(
  options: CaptureNativeWorkspaceOptions,
): Promise<NativeWorkspaceIdentity> {
  const identity = await inspectNativeWorkspaceIdentity(options);
  const file = nativeWorkspaceFile(options.paths, options.name);
  const storageRoot = nativeStorageRoot(options.paths, file);
  await resolveContainedNativePath(storageRoot, file);
  await atomicWriteJson(file, identity, { containedRoot: storageRoot });
  return identity;
}

export async function setNativeWorkspaceFinish(
  paths: NativeProjectPaths,
  name: string,
  finish: NativeWorkspaceFinish,
): Promise<NativeWorkspaceIdentityV3> {
  return withNativeMutationLock(paths, `set workspace finish for ${name}`, async () => {
    const identity = await assertNativeWorkspaceBinding(paths, name);
    if (identity === null || identity.schema !== 'comet.native.workspace.v3') {
      throw new Error(`Native change ${name} has no workspace finishing contract`);
    }
    if (identity.isolation === 'current') {
      throw new Error('Native current isolation does not use a workspace finishing action');
    }
    const updated: NativeWorkspaceIdentityV3 = { ...identity, finish };
    assertIdentity(updated);
    const file = nativeWorkspaceFile(paths, name);
    const storageRoot = nativeStorageRoot(paths, file);
    await resolveContainedNativePath(storageRoot, file);
    await atomicWriteJson(file, updated, { containedRoot: storageRoot });
    return updated;
  });
}

export async function readNativeWorkspaceIdentity(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeWorkspaceIdentity | null> {
  const value = await readNativeWorkspaceValue(paths, name);
  if (value === null) return null;
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { schema?: unknown }).schema === 'comet.native.workspace.v1'
  ) {
    // v1 depended on an external Git probe. It is ignored as advisory-only legacy data.
    return null;
  }
  assertIdentity(value);
  return value;
}

export async function migrateLegacyNativeWorkspaceIdentity(options: {
  paths: NativeProjectPaths;
  name: string;
  revision: number;
  now?: Date;
}): Promise<NativeWorkspaceIdentity | null> {
  if (!(await nativeWorkspaceIdentityNeedsMigration(options.paths, options.name))) {
    return null;
  }
  return writeNativeWorkspaceIdentity(options);
}

export async function inspectNativeWorkspaceAdvisory(options: {
  paths: NativeProjectPaths;
  identity: NativeWorkspaceIdentity;
}): Promise<NativeWorkspaceAdvisory> {
  assertIdentity(options.identity);
  const current = await inspectNativeWorkspaceIdentity({
    paths: options.paths,
    name: 'workspace-advisory',
    revision: options.identity.capturedRevision,
  });
  const driftComponents: NativeWorkspaceDriftComponent[] = [];
  const codes: NativeWorkspaceFindingCode[] = [];
  if (current.nativeRootRef !== options.identity.nativeRootRef) {
    driftComponents.push('native-root-ref');
  }
  if (options.identity.projectRootPathId && options.identity.nativeRootPathId) {
    if (current.projectRootPathId !== options.identity.projectRootPathId) {
      driftComponents.push('project-root-path');
    }
    if (current.nativeRootPathId !== options.identity.nativeRootPathId) {
      driftComponents.push('native-root-path');
    }
  } else {
    if (current.projectRootId !== options.identity.projectRootId) {
      driftComponents.push('project-root-legacy-identity');
    }
    if (current.nativeRootId !== options.identity.nativeRootId) {
      driftComponents.push('native-root-legacy-identity');
    }
  }
  const onlyUnstableWindowsLegacyHashes =
    HOST_PLATFORM === 'win32' &&
    driftComponents.length > 0 &&
    driftComponents.every(
      (component) =>
        component === 'project-root-legacy-identity' || component === 'native-root-legacy-identity',
    );
  if (onlyUnstableWindowsLegacyHashes) {
    codes.push('workspace-inspection-unavailable');
  } else if (driftComponents.length > 0) {
    codes.push('workspace-root-changed');
  }
  return {
    state:
      codes.length === 0
        ? 'aligned'
        : codes.includes('workspace-root-changed')
          ? 'drifted'
          : 'unknown',
    findingCodes: codes,
    driftComponents,
  };
}

export async function inspectNativeWorkspaceBinding(options: {
  paths: NativeProjectPaths;
  identity: NativeWorkspaceIdentity;
}): Promise<NativeWorkspaceBindingInspection> {
  assertIdentity(options.identity);
  if (options.identity.schema === 'comet.native.workspace.v2') {
    return {
      state: 'legacy',
      code: 'workspace-binding-legacy',
      message: 'Legacy Native workspace metadata has no isolation binding',
    };
  }
  const advisory = await inspectNativeWorkspaceAdvisory(options);
  if (advisory.state === 'drifted') {
    return {
      state: 'drifted',
      code: 'workspace-binding-root-changed',
      message: 'Native change is being accessed from a different working directory',
    };
  }
  const context = inspectGitWorktree(options.paths.projectRoot);
  if (options.identity.changeBranch === null) {
    return context.isGitWorktree
      ? {
          state: 'drifted',
          code: 'workspace-branch-changed',
          message: 'Native change was created outside Git but is now being accessed inside Git',
        }
      : { state: 'aligned', code: null, message: null };
  }
  if (!context.isGitWorktree) {
    return {
      state: 'drifted',
      code: 'workspace-vcs-unavailable',
      message: 'Native change requires its bound Git working directory',
    };
  }
  if (context.currentBranch !== options.identity.changeBranch) {
    return {
      state: 'drifted',
      code: 'workspace-branch-changed',
      message: `Native change is bound to branch ${options.identity.changeBranch}, but the current branch is ${context.currentBranch ?? 'detached HEAD'}`,
    };
  }
  if (options.identity.isolation === 'worktree' && !context.isSecondaryWorktree) {
    return {
      state: 'drifted',
      code: 'workspace-kind-changed',
      message: 'Native change is bound to a linked Git worktree',
    };
  }
  return { state: 'aligned', code: null, message: null };
}

export async function assertNativeWorkspaceBinding(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeWorkspaceIdentity | null> {
  const identity = await readNativeWorkspaceIdentity(paths, name);
  if (identity === null) return null;
  const inspection = await inspectNativeWorkspaceBinding({ paths, identity });
  if (inspection.state === 'drifted') {
    throw new Error(`${inspection.code}: ${inspection.message}`);
  }
  return identity;
}
