import { execFileSync } from 'child_process';
import path from 'path';

interface GitWorktreeContext {
  isGitWorktree: boolean;
  isSecondaryWorktree: boolean;
  currentWorktreeRoot: string | null;
  primaryWorktreeRoot: string | null;
  currentBranch: string | null;
}

function runGit(projectPath: string, args: string[]): string {
  return execFileSync('git', ['-C', projectPath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10_000,
    windowsHide: true,
  }).trim();
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
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

function listGitWorktreeRoots(projectPath: string): string[] {
  try {
    runGit(projectPath, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    return [];
  }
  const porcelain = runGit(projectPath, ['worktree', 'list', '--porcelain', '-z']);
  return porcelain
    .split('\0')
    .filter((token) => token.startsWith('worktree '))
    .map((token) => path.resolve(token.slice('worktree '.length)));
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

export { inspectGitWorktree, isLocalGitBranch, listGitWorktreeRoots, resolveGitRef };
export type { GitWorktreeContext };
