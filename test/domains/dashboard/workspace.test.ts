import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  collectDashboardWorkspaceSources,
  dashboardWorkspaceId,
  encodeDashboardChangeLocator,
  parseDashboardChangeLocator,
} from '../../../domains/dashboard/workspace.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  }).trim();
}

describe('Dashboard workspace discovery', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('returns one current source for a non-Git project', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-workspace-'));
    roots.push(root);

    expect(collectDashboardWorkspaceSources(root)).toEqual([
      {
        id: dashboardWorkspaceId(root),
        label: `detached:${path.basename(root)}`,
        branch: null,
        current: true,
        projectRoot: path.resolve(root),
      },
    ]);
  });

  it('discovers every registered worktree and marks the requested one current', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-worktrees-'));
    roots.push(parent);
    const repo = path.join(parent, 'repo');
    const secondary = path.join(parent, 'secondary');
    await fs.mkdir(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 'comet@test.local']);
    git(repo, ['config', 'user.name', 'Comet Test']);
    await fs.writeFile(path.join(repo, 'README.md'), '# Test\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'test: seed']);
    git(repo, ['worktree', 'add', '-q', '-b', 'feature/worktree', secondary]);

    const sources = collectDashboardWorkspaceSources(repo);
    expect(sources).toHaveLength(2);
    expect(sources.map(({ branch }) => branch)).toEqual(['main', 'feature/worktree']);
    expect(sources[0]).toMatchObject({ current: true, projectRoot: path.resolve(repo) });
    expect(sources[1]).toMatchObject({ current: false, projectRoot: path.resolve(secondary) });

    const fromSecondary = collectDashboardWorkspaceSources(secondary);
    expect(fromSecondary[0]).toMatchObject({
      current: true,
      branch: 'feature/worktree',
      projectRoot: path.resolve(secondary),
    });
  });

  it('uses the config-bearing monorepo subdirectory as the workspace root', async () => {
    const parent = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-monorepo-')),
    );
    roots.push(parent);
    const repo = path.join(parent, 'repo');
    const secondary = path.join(parent, 'secondary');
    await fs.mkdir(path.join(repo, 'dev', '.comet'), { recursive: true });
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 'comet@test.local']);
    git(repo, ['config', 'user.name', 'Comet Test']);
    await fs.writeFile(
      path.join(repo, 'dev', '.comet', 'config.yaml'),
      'schema: comet.project.v1\n',
    );
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'test: seed']);
    git(repo, ['worktree', 'add', '-q', '-b', 'feature/worktree', secondary]);

    const sources = collectDashboardWorkspaceSources(path.join(repo, 'dev'));
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      current: true,
      branch: 'main',
      projectRoot: path.resolve(repo, 'dev'),
    });
    expect(sources[1]).toMatchObject({
      current: false,
      branch: 'feature/worktree',
      projectRoot: path.resolve(secondary, 'dev'),
    });
  });

  it('falls back to the worktree root when the mapped subdirectory has no config', async () => {
    const parent = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-monorepo-fallback-')),
    );
    roots.push(parent);
    const repo = path.join(parent, 'repo');
    const secondary = path.join(parent, 'secondary');
    await fs.mkdir(repo);
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.email', 'comet@test.local']);
    git(repo, ['config', 'user.name', 'Comet Test']);
    await fs.writeFile(path.join(repo, 'README.md'), '# Test\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'test: seed']);
    git(repo, ['worktree', 'add', '-q', '-b', 'feature/worktree', secondary]);
    // Config exists only in the primary worktree, so secondary/dev has none.
    await fs.mkdir(path.join(repo, 'dev', '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(repo, 'dev', '.comet', 'config.yaml'),
      'schema: comet.project.v1\n',
    );

    const sources = collectDashboardWorkspaceSources(path.join(repo, 'dev'));
    expect(sources[0]).toMatchObject({ current: true, projectRoot: path.resolve(repo, 'dev') });
    expect(sources[1]).toMatchObject({ current: false, projectRoot: path.resolve(secondary) });

    const plain = path.join(repo, 'plain');
    await fs.mkdir(plain);
    const fromPlain = collectDashboardWorkspaceSources(plain);
    expect(fromPlain[0]).toMatchObject({ current: true, projectRoot: path.resolve(repo) });
  });

  it('round-trips an opaque locator without persisting the workspace path', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-locator-'));
    roots.push(root);
    const workspaceId = dashboardWorkspaceId(root);
    const locator = encodeDashboardChangeLocator(workspaceId, 'classic:openspec/changes/example');

    expect(locator).not.toContain(root);
    expect(parseDashboardChangeLocator(locator)).toEqual({
      workspaceId,
      identity: 'classic:openspec/changes/example',
    });
    expect(parseDashboardChangeLocator('openspec/changes/example')).toBeNull();
  });
});
