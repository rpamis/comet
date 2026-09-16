import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface GitWorktreeContext {
  isGitWorktree: boolean;
  isSecondaryWorktree: boolean;
  currentWorktreeRoot: string | null;
  primaryWorktreeRoot: string | null;
  currentBranch: string | null;
}

export interface GitWorktreeEntry {
  root: string;
  branch: string | null;
  detached: boolean;
}

function runGit(projectPath: string, args: string[]): string {
  return execFileSync('git', ['-C', projectPath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10_000,
    windowsHide: true,
  }).trim();
}

/**
 * Compare two paths by identity on disk. On Windows this resolves 8.3 short
 * names and casing through the filesystem, so the same root observed from
 * different sources (Node's `path.resolve` versus `git worktree list`) still
 * compares equal; on other platforms it compares the resolved paths.
 */
export function samePath(left: string, right: string): boolean {
  return canonicalPathForComparison(left) === canonicalPathForComparison(right);
}

function canonicalPathForComparison(target: string): string {
  const resolved = path.resolve(target);
  if (process.platform !== 'win32') return resolved;
  try {
    return fs.realpathSync.native(resolved).toLowerCase();
  } catch {
    // A path that does not exist yet cannot be resolved by the filesystem.
    return resolved.toLowerCase();
  }
}

function inspectGitWorktree(projectPath: string): GitWorktreeContext {
  try {
    const currentWorktreeRoot = path.resolve(runGit(projectPath, ['rev-parse', '--show-toplevel']));
    const porcelain = runGit(projectPath, ['worktree', 'list', '--porcelain', '-z']);
    const primaryToken = porcelain.split('\0').find((token) => token.startsWith('worktree '));
    const primaryWorktreeRoot = primaryToken
      ? path.resolve(primaryToken.slice('worktree '.length))
      : currentWorktreeRoot;
    let currentBranch: string | null = null;
    try {
      currentBranch = runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']) || null;
    } catch {
      // Detached HEAD is a valid Git worktree state, but it cannot satisfy a
      // Native branch binding.
    }
    return {
      isGitWorktree: true,
      isSecondaryWorktree: !samePath(currentWorktreeRoot, primaryWorktreeRoot),
      currentWorktreeRoot,
      primaryWorktreeRoot,
      currentBranch,
    };
  } catch {
    return {
      isGitWorktree: false,
      isSecondaryWorktree: false,
      currentWorktreeRoot: null,
      primaryWorktreeRoot: null,
      currentBranch: null,
    };
  }
}

function listGitWorktrees(projectPath: string): GitWorktreeEntry[] {
  try {
    runGit(projectPath, ['rev-parse', '--is-inside-work-tree']);
    const lines = runGit(projectPath, ['worktree', 'list', '--porcelain']).split(/\r?\n/u);
    const entries: GitWorktreeEntry[] = [];
    let current: GitWorktreeEntry | null = null;
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        if (current) entries.push(current);
        current = {
          root: path.resolve(line.slice('worktree '.length)),
          branch: null,
          detached: false,
        };
      } else if (current && line.startsWith('branch refs/heads/')) {
        current.branch = line.slice('branch refs/heads/'.length);
      } else if (current && line === 'detached') {
        current.detached = true;
      }
    }
    if (current) entries.push(current);
    return entries;
  } catch {
    return [];
  }
}

function listGitWorktreeRoots(projectPath: string): string[] {
  return listGitWorktrees(projectPath).map((entry) => entry.root);
}

/** A read-only projection of one already observed worktree list. */
function gitWorktreeContextFromEntries(
  projectPath: string,
  entries: readonly GitWorktreeEntry[],
): GitWorktreeContext | null {
  const current = entries.find((entry) =>
    samePath(path.resolve(entry.root), path.resolve(projectPath)),
  );
  if (!current) return null;
  const primaryWorktreeRoot = path.resolve(entries[0].root);
  const currentWorktreeRoot = path.resolve(current.root);
  return {
    isGitWorktree: true,
    isSecondaryWorktree: !samePath(primaryWorktreeRoot, currentWorktreeRoot),
    currentWorktreeRoot,
    primaryWorktreeRoot,
    currentBranch: current.branch,
  };
}

/** Read the branch without paying for an unrelated worktree enumeration. */
function currentGitBranch(projectPath: string): string | null {
  try {
    return runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']) || null;
  } catch {
    return null;
  }
}

function isLocalGitBranch(projectPath: string, branch: string): boolean {
  try {
    runGit(projectPath, ['check-ref-format', '--branch', branch]);
    runGit(projectPath, ['show-ref', '--verify', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function resolveGitRef(projectPath: string, ref: string): string | null {
  try {
    const objectId = runGit(projectPath, [
      'rev-parse',
      '--verify',
      `${ref}^{commit}`,
    ]).toLowerCase();
    return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(objectId) ? objectId : null;
  } catch {
    return null;
  }
}

export {
  inspectGitWorktree,
  currentGitBranch,
  gitWorktreeContextFromEntries,
  isLocalGitBranch,
  listGitWorktreeRoots,
  listGitWorktrees,
  resolveGitRef,
};
export type { GitWorktreeContext };
