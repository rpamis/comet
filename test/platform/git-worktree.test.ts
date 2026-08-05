import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  inspectGitWorktree,
  isLocalGitBranch,
  listGitWorktreeRoots,
} from '../../platform/paths/git-worktree.js';

describe('Git worktree inspection', () => {
  let primary: string;
  let secondary: string;

  beforeEach(async () => {
    primary = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-git-primary-'));
    secondary = path.join(
      os.tmpdir(),
      `comet-git-secondary-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const git = (...args: string[]) =>
      spawnSync('git', ['-C', primary, ...args], { encoding: 'utf8', timeout: 20_000 });
    expect(git('init', '-b', 'master').status).toBe(0);
    expect(git('config', 'user.email', 'worktree@example.com').status).toBe(0);
    expect(git('config', 'user.name', 'Worktree Test').status).toBe(0);
    await fs.writeFile(path.join(primary, 'README.md'), '# worktree\n');
    expect(git('add', 'README.md').status).toBe(0);
    expect(git('commit', '-m', 'initial').status).toBe(0);
    expect(git('worktree', 'add', secondary, '-b', 'feature/secondary').status).toBe(0);
  });

  afterEach(async () => {
    spawnSync('git', ['-C', primary, 'worktree', 'remove', '--force', secondary], {
      encoding: 'utf8',
      timeout: 20_000,
    });
    await fs.rm(secondary, { recursive: true, force: true });
    await fs.rm(primary, { recursive: true, force: true });
  });

  it('distinguishes the primary checkout from a linked worktree', () => {
    expect(inspectGitWorktree(primary)).toMatchObject({
      isGitWorktree: true,
      isSecondaryWorktree: false,
      currentWorktreeRoot: path.resolve(primary),
      primaryWorktreeRoot: path.resolve(primary),
      currentBranch: 'master',
    });
    expect(inspectGitWorktree(secondary)).toMatchObject({
      isGitWorktree: true,
      isSecondaryWorktree: true,
      currentWorktreeRoot: path.resolve(secondary),
      primaryWorktreeRoot: path.resolve(primary),
      currentBranch: 'feature/secondary',
    });
    expect(isLocalGitBranch(primary, 'master')).toBe(true);
    expect(isLocalGitBranch(primary, 'feature/secondary')).toBe(true);
    expect(isLocalGitBranch(primary, 'missing')).toBe(false);
    expect(listGitWorktreeRoots(primary)).toEqual([path.resolve(primary), path.resolve(secondary)]);
  });

  it('returns a stable non-Git result outside a repository', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-no-git-'));
    try {
      expect(inspectGitWorktree(outside)).toEqual({
        isGitWorktree: false,
        isSecondaryWorktree: false,
        currentWorktreeRoot: null,
        primaryWorktreeRoot: null,
        currentBranch: null,
      });
      expect(listGitWorktreeRoots(outside)).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
