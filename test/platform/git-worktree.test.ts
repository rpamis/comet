import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  inspectGitWorktree,
  currentGitBranch,
  gitWorktreeContextFromEntries,
  listGitWorktrees,
  isLocalGitBranch,
  listGitWorktreeRoots,
  samePath,
  withGitWorktreeReadScope,
} from '../../platform/paths/git-worktree.js';
import { snapshotCometRuntimeMetrics } from '../../platform/process/runtime-metrics.js';

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
    // Git can report the same root through a different path spelling than the
    // one Node resolved (for example Windows 8.3 short names), so compare
    // roots by identity on disk instead of exact string equality.
    const primaryInspection = inspectGitWorktree(primary);
    expect(primaryInspection).toMatchObject({
      isGitWorktree: true,
      isSecondaryWorktree: false,
      currentBranch: 'master',
    });
    expect(samePath(primaryInspection.currentWorktreeRoot!, path.resolve(primary))).toBe(true);
    expect(samePath(primaryInspection.primaryWorktreeRoot!, path.resolve(primary))).toBe(true);
    const secondaryInspection = inspectGitWorktree(secondary);
    expect(secondaryInspection).toMatchObject({
      isGitWorktree: true,
      isSecondaryWorktree: true,
      currentBranch: 'feature/secondary',
    });
    expect(samePath(secondaryInspection.currentWorktreeRoot!, path.resolve(secondary))).toBe(true);
    expect(samePath(secondaryInspection.primaryWorktreeRoot!, path.resolve(primary))).toBe(true);
    expect(isLocalGitBranch(primary, 'master')).toBe(true);
    expect(isLocalGitBranch(primary, 'feature/secondary')).toBe(true);
    expect(isLocalGitBranch(primary, 'missing')).toBe(false);
    const roots = listGitWorktreeRoots(primary);
    expect(roots).toHaveLength(2);
    expect(roots.some((root) => samePath(root, path.resolve(primary)))).toBe(true);
    expect(roots.some((root) => samePath(root, path.resolve(secondary)))).toBe(true);
    expect(currentGitBranch(secondary)).toBe('feature/secondary');
    expect(gitWorktreeContextFromEntries(secondary, listGitWorktrees(primary))).toEqual(
      inspectGitWorktree(secondary),
    );
    expect(
      gitWorktreeContextFromEntries(path.join(primary, 'missing'), listGitWorktrees(primary)),
    ).toBeNull();
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

  it('reuses one worktree observation for root resolution and discovery only within a query', async () => {
    const nested = path.join(secondary, 'nested');
    await fs.mkdir(nested);
    const before = snapshotCometRuntimeMetrics();
    await withGitWorktreeReadScope(async () => {
      expect(inspectGitWorktree(nested).currentBranch).toBe('feature/secondary');
      const entries = listGitWorktrees(primary);
      expect(entries).toHaveLength(2);
      entries[0].branch = 'caller-mutation';
      await Promise.resolve();
      expect(inspectGitWorktree(primary).currentBranch).toBe('master');
    });
    const after = snapshotCometRuntimeMetrics();
    expect(after.gitCommands - before.gitCommands).toBe(2);
    expect(after.gitDurationMs - before.gitDurationMs).toBeGreaterThan(0);
    expect(spawnSync('git', ['-C', secondary, 'checkout', '--detach']).status).toBe(0);
    withGitWorktreeReadScope(() => {
      expect(inspectGitWorktree(secondary).currentBranch).toBeNull();
      expect(
        listGitWorktrees(primary).find((entry) => samePath(entry.root, secondary))?.detached,
      ).toBe(true);
    });
    expect(inspectGitWorktree(secondary).currentBranch).toBeNull();
  });

  it('isolates overlapping read scopes and does not reuse a previous request branch', async () => {
    const first = withGitWorktreeReadScope(async () => {
      const initial = inspectGitWorktree(secondary);
      await Promise.resolve();
      return [initial.currentBranch, inspectGitWorktree(secondary).currentBranch];
    });
    expect(spawnSync('git', ['-C', secondary, 'checkout', '-b', 'feature/next']).status).toBe(0);
    const second = withGitWorktreeReadScope(async () => {
      await Promise.resolve();
      return inspectGitWorktree(secondary).currentBranch;
    });
    expect(await first).toEqual(['feature/secondary', 'feature/secondary']);
    expect(await second).toBe('feature/next');
    expect(currentGitBranch(secondary)).toBe('feature/next');
  });
});
