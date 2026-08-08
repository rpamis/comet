import { execFileSync } from 'node:child_process';
import path from 'node:path';

import type { NativeSnapshotEntry } from './native-types.js';
import { isLocalGitBranch } from '../../platform/paths/git-worktree.js';
import type { NativeExternalDrift, NativeSnapshotProjection } from './native-verification-scope.js';
import { nativeDeclaredArtifactOwnsPath } from './native-verification-scope.js';
import type { NativeWorkspaceGitProvenance } from './native-workspace.js';
import type { NativeDeclaredArtifact } from './native-verification-scope.js';

const GIT_COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const MAX_EXTERNAL_DRIFT_PATHS = 8_192;
const MAX_EXTERNAL_DRIFT_PATH_BYTES = 512 * 1024;

function runGit(projectRoot: string, args: readonly string[]): Buffer | null {
  try {
    return execFileSync('git', ['-C', projectRoot, ...args], {
      encoding: 'buffer',
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
      windowsHide: true,
    });
  } catch {
    return null;
  }
}

function runGitMustSucceed(projectRoot: string, args: readonly string[]): Buffer | null {
  return runGit(projectRoot, args);
}

function safeProjectPath(value: string): string | null {
  if (
    value.length === 0 ||
    value.includes('\\') ||
    value.includes('\0') ||
    path.posix.isAbsolute(value)
  ) {
    return null;
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === '..' || normalized.startsWith('../')) return null;
  return value;
}

function nullSeparatedPaths(output: Buffer | null): string[] | null {
  if (output === null) return null;
  const paths: string[] = [];
  for (const raw of output.toString('utf8').split('\0')) {
    if (raw.length === 0) continue;
    const safe = safeProjectPath(raw);
    if (safe === null) return null;
    paths.push(safe);
  }
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right, 'en'));
}

function commit(output: Buffer | null): string | null {
  const value = output?.toString('utf8').trim().toLowerCase() ?? '';
  return GIT_COMMIT_PATTERN.test(value) ? value : null;
}

function treeObjects(output: Buffer | null): Map<string, string> | null {
  if (output === null) return null;
  const tree = new Map<string, string>();
  for (const record of output.toString('utf8').split('\0')) {
    if (record.length === 0) continue;
    const separator = record.indexOf('\t');
    if (separator < 0) return null;
    const header = /^(?:[0-7]{6}) blob ([a-f0-9]{40}|[a-f0-9]{64})$/u.exec(
      record.slice(0, separator),
    );
    const relative = safeProjectPath(record.slice(separator + 1));
    if (!header || relative === null) return null;
    tree.set(relative, header[1]!);
  }
  return tree;
}

function entriesByPath(
  projection: Pick<NativeSnapshotProjection, 'entries'>,
): Map<string, NativeSnapshotEntry> {
  return new Map(projection.entries.map((entry) => [entry.path, entry]));
}

function sameTreeEntry(
  entry: NativeSnapshotEntry | undefined,
  objectId: string | undefined,
): boolean {
  return objectId === undefined
    ? entry === undefined
    : entry !== undefined && entry.gitObjectId === objectId;
}

/**
 * Prove that a subset of baseline/current changes is a fast-forward of the target branch rather
 * than an implementation edit. Any uncertainty simply returns no evidence for that path; the
 * normal Native partial-scope path remains responsible for asking for a decision.
 */
export function detectNativeGitExternalDrift(options: {
  projectRoot: string;
  provenance: NativeWorkspaceGitProvenance;
  baseline: Pick<NativeSnapshotProjection, 'complete' | 'entries'>;
  current: Pick<NativeSnapshotProjection, 'complete' | 'entries'>;
  declaredArtifacts: readonly NativeDeclaredArtifact[];
}): NativeExternalDrift | null {
  if (!options.baseline.complete || !options.current.complete) return null;
  const { provenance } = options;
  if (
    !GIT_COMMIT_PATTERN.test(provenance.baseCommit) ||
    !GIT_COMMIT_PATTERN.test(provenance.targetCommit)
  ) {
    return null;
  }
  if (!isLocalGitBranch(options.projectRoot, provenance.targetBranch)) return null;
  const targetCommit = commit(
    runGitMustSucceed(options.projectRoot, [
      'rev-parse',
      '--verify',
      `refs/heads/${provenance.targetBranch}^{commit}`,
    ]),
  );
  if (targetCommit === null) return null;
  const currentHead = commit(
    runGitMustSucceed(options.projectRoot, ['rev-parse', '--verify', 'HEAD^{commit}']),
  );
  if (currentHead === null) return null;
  if (
    runGitMustSucceed(options.projectRoot, [
      'merge-base',
      '--is-ancestor',
      provenance.baseCommit,
      targetCommit,
    ]) === null ||
    runGitMustSucceed(options.projectRoot, [
      'merge-base',
      '--is-ancestor',
      targetCommit,
      currentHead,
    ]) === null
  ) {
    return null;
  }
  if (provenance.baseCommit === targetCommit) return null;

  const changedPaths = nullSeparatedPaths(
    runGitMustSucceed(options.projectRoot, [
      'diff',
      '--no-renames',
      '--name-only',
      '-z',
      provenance.baseCommit,
      targetCommit,
      '--',
    ]),
  );
  if (changedPaths === null || changedPaths.length === 0) return null;
  if (
    changedPaths.length > MAX_EXTERNAL_DRIFT_PATHS ||
    Buffer.byteLength(JSON.stringify(changedPaths), 'utf8') > MAX_EXTERNAL_DRIFT_PATH_BYTES
  ) {
    return null;
  }
  const [baseTree, targetTree] = [provenance.baseCommit, targetCommit].map((ref) =>
    treeObjects(
      runGitMustSucceed(options.projectRoot, [
        'ls-tree',
        '-r',
        '-z',
        '--full-tree',
        ref,
        '--',
        ...changedPaths,
      ]),
    ),
  );
  if (baseTree === null || targetTree === null) return null;

  const baselineByPath = entriesByPath(options.baseline);
  const currentByPath = entriesByPath(options.current);
  const externalPaths: string[] = [];
  for (const changedPath of changedPaths) {
    if (
      options.declaredArtifacts.some((artifact) =>
        nativeDeclaredArtifactOwnsPath(artifact, changedPath),
      )
    ) {
      continue;
    }
    if (!sameTreeEntry(baselineByPath.get(changedPath), baseTree.get(changedPath))) continue;
    if (!sameTreeEntry(currentByPath.get(changedPath), targetTree.get(changedPath))) continue;
    externalPaths.push(changedPath);
  }
  if (externalPaths.length === 0) return null;
  return {
    provider: 'git',
    baseCommit: provenance.baseCommit,
    targetBranch: provenance.targetBranch,
    targetCommit,
    paths: externalPaths,
  };
}
