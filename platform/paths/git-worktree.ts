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
  try {
    const real = fs.realpathSync.native(resolved);
    return process.platform === 'win32' ? real.toLowerCase() : real;
  } catch {
    // A path that does not exist yet cannot be resolved by the filesystem.
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }
}

function inspectGitWorktree(projectPath: string): GitWorktreeContext {
  try {
    const currentWorktreeRoot = path.resolve(runGit(projectPath, ['rev-parse', '--show-toplevel']));
    const porcelain = runGit(projectPath, ['worktree', 'list', '--porcelain', '-z']);
    const context = gitWorktreeContextFromEntries(
      currentWorktreeRoot,
      parseGitWorktreeEntries(porcelain),
    );
    // Use one fresh worktree-list observation for both identity and branch.
    // A missing entry must fail closed rather than borrow another worktree's branch.
    if (!context) throw new Error('Current worktree is missing from Git worktree list');
    return context;
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

function parseGitWorktreeEntries(porcelain: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let current: GitWorktreeEntry | null = null;
  for (const token of porcelain.split('\0')) {
    if (token.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = {
        root: path.resolve(token.slice('worktree '.length)),
        branch: null,
        detached: false,
      };
    } else if (current && token.startsWith('branch refs/heads/')) {
      current.branch = token.slice('branch refs/heads/'.length);
    } else if (current && token === 'detached') {
      current.detached = true;
    }
  }
  if (current) entries.push(current);
  return entries;
}

function listGitWorktrees(projectPath: string): GitWorktreeEntry[] {
  try {
    runGit(projectPath, ['rev-parse', '--is-inside-work-tree']);
    return parseGitWorktreeEntries(runGit(projectPath, ['worktree', 'list', '--porcelain', '-z']));
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
