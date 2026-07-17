import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  inspectGitRepository,
  type GitRepositoryInspection,
} from '../../platform/process/git-repository.js';
import { atomicWriteJson } from './native-atomic-file.js';
import { nativeChangeDir } from './native-change.js';
import { resolveContainedNativePath } from './native-paths.js';
import type { NativeProjectPaths } from './native-types.js';

export interface NativeWorkspaceIdentity {
  schema: 'comet.native.workspace.v1';
  capturedAt: string;
  capturedRevision: number;
  nativeRootRef: string;
  vcs:
    | {
        kind: 'git';
        head: string | null;
        branch: string | null;
        worktreeId: string;
        commonDirId: string;
        projectPrefix: string;
      }
    | {
        kind: 'unavailable';
        head: null;
        branch: null;
        worktreeId: null;
        commonDirId: null;
        projectPrefix: null;
        failureKind: string;
      };
  sessionHash?: string;
}

export type NativeWorkspaceFindingCode =
  | 'workspace-worktree-changed'
  | 'workspace-branch-changed'
  | 'workspace-head-changed'
  | 'workspace-inspection-unavailable'
  | 'workspace-unattributed-changes';

export interface NativeWorkspaceAdvisory {
  state: 'aligned' | 'drifted' | 'unknown';
  findingCodes: NativeWorkspaceFindingCode[];
}

export interface CaptureNativeWorkspaceOptions {
  paths: NativeProjectPaths;
  name: string;
  revision: number;
  now?: Date;
  sessionId?: string;
  inspectRepository?: (projectRoot: string) => Promise<GitRepositoryInspection>;
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
  const normalized = process.platform === 'win32' ? path.normalize(value).toLowerCase() : value;
  return createHash('sha256').update(`${tag}\n${normalized}`).digest('hex');
}

async function physicalIdentity(tag: string, value: string): Promise<string> {
  return identityHash(tag, await fs.realpath(value));
}

async function physicalGitIdentities(inspection: {
  worktreeRoot: string;
  commonDir: string;
}): Promise<{ worktreeId: string; commonDirId: string } | null> {
  try {
    const [worktreeId, commonDirId] = await Promise.all([
      physicalIdentity('comet.native.workspace-worktree.v1', inspection.worktreeRoot),
      physicalIdentity('comet.native.workspace-common-dir.v1', inspection.commonDir),
    ]);
    return { worktreeId, commonDirId };
  } catch {
    return null;
  }
}

function assertIdentity(value: unknown): asserts value is NativeWorkspaceIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native workspace identity must be an object');
  }
  const identity = value as Partial<NativeWorkspaceIdentity>;
  if (identity.schema !== 'comet.native.workspace.v1') {
    throw new Error('Unsupported Native workspace identity');
  }
  if (
    typeof identity.capturedAt !== 'string' ||
    Number.isNaN(Date.parse(identity.capturedAt)) ||
    !Number.isSafeInteger(identity.capturedRevision) ||
    (identity.capturedRevision ?? -1) < 1 ||
    typeof identity.nativeRootRef !== 'string' ||
    identity.nativeRootRef.length === 0 ||
    !identity.vcs ||
    typeof identity.vcs !== 'object'
  ) {
    throw new Error('Native workspace identity is invalid');
  }
  normalizedPortableRef(identity.nativeRootRef, 'Native workspace root ref');
  if (identity.sessionHash !== undefined && !/^[a-f0-9]{64}$/u.test(identity.sessionHash)) {
    throw new Error('Native workspace session hash is invalid');
  }
  if (identity.vcs.kind === 'git') {
    if (
      !/^[a-f0-9]{64}$/u.test(identity.vcs.worktreeId) ||
      !/^[a-f0-9]{64}$/u.test(identity.vcs.commonDirId) ||
      typeof identity.vcs.projectPrefix !== 'string' ||
      (identity.vcs.head !== null && typeof identity.vcs.head !== 'string') ||
      (identity.vcs.branch !== null && typeof identity.vcs.branch !== 'string')
    ) {
      throw new Error('Native Git workspace identity is invalid');
    }
    normalizedPortableRef(identity.vcs.projectPrefix, 'Native workspace project prefix');
  } else if (
    identity.vcs.kind !== 'unavailable' ||
    identity.vcs.head !== null ||
    identity.vcs.branch !== null ||
    identity.vcs.worktreeId !== null ||
    identity.vcs.commonDirId !== null ||
    identity.vcs.projectPrefix !== null ||
    typeof identity.vcs.failureKind !== 'string' ||
    identity.vcs.failureKind.length === 0
  ) {
    throw new Error('Native unavailable workspace identity is invalid');
  }
}

export function nativeWorkspaceFile(paths: NativeProjectPaths, name: string): string {
  return path.join(nativeChangeDir(paths, name), 'runtime', 'workspace.json');
}

export async function inspectNativeWorkspaceIdentity(
  options: CaptureNativeWorkspaceOptions,
): Promise<NativeWorkspaceIdentity> {
  if (!Number.isSafeInteger(options.revision) || options.revision < 1) {
    throw new Error('Native workspace revision must be a positive integer');
  }
  const inspect = options.inspectRepository ?? inspectGitRepository;
  const inspection = await inspect(options.paths.projectRoot);
  const nativeRootRef = portableRelative(options.paths.projectRoot, options.paths.nativeRoot);
  if (!nativeRootRef) throw new Error('Native root is outside the project root');
  const projectId = options.sessionId
    ? await physicalIdentity('comet.native.workspace-project.v1', options.paths.projectRoot)
    : null;

  const base = {
    schema: 'comet.native.workspace.v1' as const,
    capturedAt: (options.now ?? new Date()).toISOString(),
    capturedRevision: options.revision,
    nativeRootRef,
    ...(options.sessionId
      ? {
          sessionHash: identityHash(
            'comet.native.workspace-session.v1',
            `${projectId}\n${nativeRootRef}\n${options.sessionId}`,
          ),
        }
      : {}),
  };

  if (!inspection.available) {
    return {
      ...base,
      vcs: {
        kind: 'unavailable',
        head: null,
        branch: null,
        worktreeId: null,
        commonDirId: null,
        projectPrefix: null,
        failureKind: inspection.failure.kind,
      },
    };
  }

  const projectPrefix = portableRelative(inspection.worktreeRoot, options.paths.projectRoot);
  if (projectPrefix === null) {
    return {
      ...base,
      vcs: {
        kind: 'unavailable',
        head: null,
        branch: null,
        worktreeId: null,
        commonDirId: null,
        projectPrefix: null,
        failureKind: 'project-outside-worktree',
      },
    };
  }

  const identities = await physicalGitIdentities(inspection);
  if (!identities) {
    return {
      ...base,
      vcs: {
        kind: 'unavailable',
        head: null,
        branch: null,
        worktreeId: null,
        commonDirId: null,
        projectPrefix: null,
        failureKind: 'identity-unavailable',
      },
    };
  }

  return {
    ...base,
    vcs: {
      kind: 'git',
      head: inspection.head,
      branch: inspection.branch,
      worktreeId: identities.worktreeId,
      commonDirId: identities.commonDirId,
      projectPrefix,
    },
  };
}

export async function writeNativeWorkspaceIdentity(
  options: CaptureNativeWorkspaceOptions,
): Promise<NativeWorkspaceIdentity> {
  const identity = await inspectNativeWorkspaceIdentity(options);
  const file = nativeWorkspaceFile(options.paths, options.name);
  await resolveContainedNativePath(options.paths.nativeRoot, file);
  await atomicWriteJson(file, identity);
  return identity;
}

export async function readNativeWorkspaceIdentity(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeWorkspaceIdentity | null> {
  const file = nativeWorkspaceFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    assertIdentity(value);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function inspectNativeWorkspaceAdvisory(options: {
  paths: NativeProjectPaths;
  identity: NativeWorkspaceIdentity;
  attributedPaths?: string[];
  inspectRepository?: (projectRoot: string) => Promise<GitRepositoryInspection>;
}): Promise<NativeWorkspaceAdvisory> {
  assertIdentity(options.identity);
  const inspect = options.inspectRepository ?? inspectGitRepository;
  const current = await inspect(options.paths.projectRoot);
  if (options.identity.vcs.kind !== 'git' || !current.available) {
    return { state: 'unknown', findingCodes: ['workspace-inspection-unavailable'] };
  }

  const codes = new Set<NativeWorkspaceFindingCode>();
  const identities = await physicalGitIdentities(current);
  if (!identities) {
    return { state: 'unknown', findingCodes: ['workspace-inspection-unavailable'] };
  }
  if (
    identities.worktreeId !== options.identity.vcs.worktreeId ||
    identities.commonDirId !== options.identity.vcs.commonDirId
  ) {
    codes.add('workspace-worktree-changed');
  }
  const [currentProjectPrefix, currentNativeRootRef] = [
    portableRelative(current.worktreeRoot, options.paths.projectRoot),
    portableRelative(options.paths.projectRoot, options.paths.nativeRoot),
  ];
  if (currentProjectPrefix === null || currentNativeRootRef === null) {
    return { state: 'unknown', findingCodes: ['workspace-inspection-unavailable'] };
  }
  if (
    currentProjectPrefix !== options.identity.vcs.projectPrefix ||
    currentNativeRootRef !== options.identity.nativeRootRef
  ) {
    codes.add('workspace-worktree-changed');
  }
  if (current.branch !== options.identity.vcs.branch) codes.add('workspace-branch-changed');
  if (current.head !== options.identity.vcs.head) codes.add('workspace-head-changed');

  const attributed = new Set(
    (options.attributedPaths ?? []).map((item) => item.replaceAll('\\', '/')),
  );
  if (current.changedPaths.some((item) => !attributed.has(item))) {
    codes.add('workspace-unattributed-changes');
  }
  return {
    state: codes.size > 0 ? 'drifted' : 'aligned',
    findingCodes: [...codes].sort(),
  };
}
