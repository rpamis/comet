import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inspectGitWorktree,
  currentGitBranch,
  gitWorktreeContextFromEntries,
  listGitWorktrees,
  isLocalGitBranch,
  listGitWorktreeRoots,
  samePath,
  withGitWorktreeReadScope,
  createGitWorktreeReadCache,
} from '../../platform/paths/git-worktree.js';
import { snapshotCometRuntimeMetrics } from '../../platform/process/runtime-metrics.js';
import * as commands from '../../platform/process/external-command.js';
import {
  createCometDaemonServer,
  resolveCometDaemonEndpoint,
  sendCometDaemonRequest,
} from '../../platform/process/comet-daemon.js';

describe('Git worktree inspection', () => {
  let primary: string;
  let secondary: string;

  beforeEach(async () => {
    primary = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-git-primary-'));
    const home = path.join(primary, 'test-home');
    await fs.mkdir(home);
    for (const key of Object.keys(process.env).filter((key) => /^GIT_/iu.test(key)))
      vi.stubEnv(key, undefined);
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('XDG_CONFIG_HOME', path.join(home, '.config'));
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
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
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

  it('reuses daemon observations across queries while seeing a same-size HEAD edit with restored mtime', async () => {
    const cache = createGitWorktreeReadCache();
    const query = () =>
      cache.run(primary, async () => withGitWorktreeReadScope(() => listGitWorktrees(primary)));
    expect((await query()).find((entry) => samePath(entry.root, secondary))?.branch).toBe(
      'feature/secondary',
    );
    const before = snapshotCometRuntimeMetrics();
    await query();
    expect(snapshotCometRuntimeMetrics().gitCommands).toBe(before.gitCommands);
    const gitDir = (await fs.readFile(path.join(secondary, '.git'), 'utf8'))
      .trim()
      .slice('gitdir: '.length);
    const headPath = path.join(gitDir, 'HEAD');
    const stamp = await fs.stat(headPath);
    await fs.writeFile(headPath, 'ref: refs/heads/feature/next-next\n');
    await fs.utimes(headPath, stamp.atime, stamp.mtime);
    expect((await query()).find((entry) => samePath(entry.root, secondary))?.branch).toBe(
      'feature/next-next',
    );
    expect(snapshotCometRuntimeMetrics().gitCommands).toBeGreaterThan(before.gitCommands);
  });

  it('refreshes worktree registrations and falls back for indirect configuration', async () => {
    const cache = createGitWorktreeReadCache();
    const query = () =>
      cache.run(primary, async () => withGitWorktreeReadScope(() => listGitWorktrees(primary)));
    expect(await query()).toHaveLength(2);
    const extra = path.join(primary, 'extra');
    expect(
      spawnSync('git', ['-C', primary, 'worktree', 'add', extra, '-b', 'feature/extra']).status,
    ).toBe(0);
    expect(await query()).toHaveLength(3);
    expect(spawnSync('git', ['-C', primary, 'worktree', 'remove', '--force', extra]).status).toBe(
      0,
    );
    expect(await query()).toHaveLength(2);
    const included = path.join(primary, 'include.cfg');
    await fs.writeFile(included, '[core]\n\tbare = false\n');
    expect(spawnSync('git', ['-C', primary, 'config', 'include.path', included]).status).toBe(0);
    const before = snapshotCometRuntimeMetrics();
    expect(await query()).toHaveLength(2);
    await query();
    expect(snapshotCometRuntimeMetrics().gitCommands - before.gitCommands).toBe(4);
  });

  it('keeps daemon cache requests isolated and sees detach immediately', async () => {
    const cache = createGitWorktreeReadCache();
    const first = cache.run(primary, async () => {
      const initial = withGitWorktreeReadScope(() => inspectGitWorktree(secondary).currentBranch);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return [initial, inspectGitWorktree(secondary).currentBranch];
    });
    expect(await first).toEqual(['feature/secondary', 'feature/secondary']);
    expect(spawnSync('git', ['-C', secondary, 'checkout', '--detach']).status).toBe(0);
    const next = await cache.run(secondary, async () => inspectGitWorktree(secondary));
    expect(next.currentBranch).toBeNull();
    // 写路径及未启用缓存的查询继续直接观察 Git。
    expect(currentGitBranch(secondary)).toBeNull();
  });

  it('preloads a caller subdirectory and observes a newly nested repository instead of inheriting its parent', async () => {
    const nested = path.join(primary, 'nested');
    await fs.mkdir(nested);
    const cache = createGitWorktreeReadCache();
    const query = () => cache.run(primary, async () => inspectGitWorktree(nested), nested);
    expect((await query()).currentBranch).toBe('master');
    const before = snapshotCometRuntimeMetrics();
    expect((await query()).currentBranch).toBe('master');
    expect(snapshotCometRuntimeMetrics().gitCommands).toBe(before.gitCommands);
    expect(spawnSync('git', ['init', '-b', 'inner', nested]).status).toBe(0);
    expect((await query()).currentBranch).toBe('inner');
  });

  it('serves daemon controls while a cache miss is waiting for Git', async () => {
    const cache = createGitWorktreeReadCache();
    const buildId = `nonblocking-${path.basename(primary)}`;
    const endpoint = resolveCometDaemonEndpoint(primary, buildId);
    const server = await createCometDaemonServer({
      endpoint,
      buildId,
      projectRoot: primary,
      handler: async () => ({
        exitCode: 0,
        stdout: JSON.stringify(await cache.run(primary, async () => inspectGitWorktree(primary))),
      }),
    });
    const request = (extra: { control?: 'ping'; runtime?: 'native'; argv?: string[] }) =>
      sendCometDaemonRequest({ endpoint, buildId, projectRoot: primary, cwd: primary, ...extra });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const refreshing = new Promise<void>((resolve) => {
      started = resolve;
    });
    try {
      expect((await request({ runtime: 'native', argv: ['status'] })).ok).toBe(true);
      expect(spawnSync('git', ['-C', primary, 'checkout', '-b', 'next']).status).toBe(0);
      const execute = commands.runExternalCommandAsync;
      vi.spyOn(commands, 'runExternalCommandAsync').mockImplementation(
        async (command, args, options) => {
          if (args.includes('worktree')) {
            started();
            await held;
          }
          return execute(command, args, options);
        },
      );
      let completed = false;
      const query = request({ runtime: 'native', argv: ['status'] }).then((result) => {
        completed = true;
        return result;
      });
      await refreshing;
      expect((await request({ control: 'ping' })).ok).toBe(true);
      expect(completed).toBe(false);
      release();
      expect(JSON.parse((await query).stdout!).currentBranch).toBe('next');
    } finally {
      release();
      await server.close();
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
