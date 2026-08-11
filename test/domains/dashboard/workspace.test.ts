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
