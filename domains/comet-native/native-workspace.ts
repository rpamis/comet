import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { atomicWriteJson } from './native-atomic-file.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { resolveContainedNativePath } from './native-paths.js';
import type { NativeProjectPaths } from './native-types.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_WORKSPACE_IDENTITY_BYTES = 16 * 1024;

export interface NativeWorkspaceIdentity {
  schema: 'comet.native.workspace.v2';
  capturedAt: string;
  capturedRevision: number;
  nativeRootRef: string;
  projectRootId: string;
  nativeRootId: string;
  /** Stable real-path hashes used for root drift decisions. */
  projectRootPathId?: string;
  nativeRootPathId?: string;
  sessionHash?: string;
}

export type NativeWorkspaceDriftComponent =
  | 'native-root-ref'
  | 'project-root-path'
  | 'native-root-path'
  | 'project-root-legacy-identity'
  | 'native-root-legacy-identity';

export type NativeWorkspaceFindingCode =
  | 'workspace-root-changed'
  | 'workspace-inspection-unavailable';

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
    process.platform === 'win32' ? path.normalize(realPath).toLowerCase() : realPath;
  return identityHash(tag, `${normalizedPath}\n${stat.dev}\n${stat.ino}\n${stat.birthtimeMs}`);
}

async function directoryPathIdentity(tag: string, value: string): Promise<string> {
  const realPath = await fs.realpath(value);
  const stat = await fs.lstat(realPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Native workspace identity requires a real directory');
  }
  const normalizedPath =
    process.platform === 'win32' ? path.normalize(realPath).toLowerCase() : realPath;
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
  ]);
  const unknown = Object.keys(root).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`Native workspace identity has unknown field(s): ${unknown.join(', ')}`);
  }
  if (root.schema !== 'comet.native.workspace.v2') {
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
}

export function nativeWorkspaceFile(paths: NativeProjectPaths, name: string): string {
  return path.join(paths.changesDir, name, 'runtime', 'workspace.json');
}

function nativeWorkspaceRef(paths: NativeProjectPaths, name: string): string {
  const relative = portableRelative(paths.nativeRoot, nativeWorkspaceFile(paths, name));
  if (!relative || relative === '.') throw new Error('Native workspace file escaped its root');
  return normalizedPortableRef(relative, 'Native workspace file ref');
}

async function readNativeWorkspaceValue(
  paths: NativeProjectPaths,
  name: string,
): Promise<unknown | null> {
  try {
    const artifact = await readNativeBoundedTextFile({
      root: paths.nativeRoot,
      ref: nativeWorkspaceRef(paths, name),
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
): Promise<'comet.native.workspace.v1' | 'comet.native.workspace.v2' | null> {
  const value = await readNativeWorkspaceValue(paths, name);
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native workspace identity must be an object');
  }
  const schema = (value as { schema?: unknown }).schema;
  if (schema === 'comet.native.workspace.v1' || schema === 'comet.native.workspace.v2') {
    if (schema === 'comet.native.workspace.v2') assertIdentity(value);
    return schema;
  }
  throw new Error('Unsupported Native workspace identity');
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
  const [projectRootId, nativeRootId, projectRootPathId, nativeRootPathId] = await Promise.all([
    physicalDirectoryIdentity('comet.native.workspace-project-root.v2', options.paths.projectRoot),
    physicalDirectoryIdentity('comet.native.workspace-native-root.v2', options.paths.nativeRoot),
    directoryPathIdentity('comet.native.workspace-project-root-path.v2', options.paths.projectRoot),
    directoryPathIdentity('comet.native.workspace-native-root-path.v2', options.paths.nativeRoot),
  ]);
  const capturedAt = (options.now ?? new Date()).toISOString();
  const identity: NativeWorkspaceIdentity = {
    schema: 'comet.native.workspace.v2',
    capturedAt,
    capturedRevision: options.revision,
    nativeRootRef,
    projectRootId,
    nativeRootId,
    projectRootPathId,
    nativeRootPathId,
    ...(options.sessionId
      ? {
          sessionHash: identityHash(
            'comet.native.workspace-session.v2',
            `${projectRootId}\n${nativeRootId}\n${options.sessionId}`,
          ),
        }
      : {}),
  };
  assertIdentity(identity);
  return identity;
}

export async function writeNativeWorkspaceIdentity(
  options: CaptureNativeWorkspaceOptions,
): Promise<NativeWorkspaceIdentity> {
  const identity = await inspectNativeWorkspaceIdentity(options);
  const file = nativeWorkspaceFile(options.paths, options.name);
  await resolveContainedNativePath(options.paths.nativeRoot, file);
  await atomicWriteJson(file, identity, { containedRoot: options.paths.nativeRoot });
  return identity;
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
    process.platform === 'win32' &&
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
