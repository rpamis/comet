import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { collectDashboardProjectDirectory } from '../../../domains/dashboard/project-directory.js';
import {
  getProjectRegistryPath,
  upsertProjectInstallation,
} from '../../../platform/install/project-registry.js';

describe('collectDashboardProjectDirectory', () => {
  let tempDir: string;
  let homeDir: string;
  let currentProject: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-project-directory-'));
    homeDir = path.join(tempDir, 'home');
    currentProject = path.join(tempDir, 'current-project');
    await fs.mkdir(currentProject, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('distinguishes worktrees of the same repository and keeps IDs stable when unavailable', async () => {
    const worktree = path.join(tempDir, 'linked-project');
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', currentProject, ...args], { stdio: 'pipe' });
    git('init');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'fixture',
    );
    git('remote', 'add', 'origin', 'https://example.com/team/shared.git');
    git('worktree', 'add', '-b', 'linked', worktree);
    await upsertProjectInstallation(worktree, [], 'init', { homeDir });

    const directory = await collectDashboardProjectDirectory(currentProject, { homeDir });
    expect(new Set(directory.projects.map((entry) => entry.id)).size).toBe(2);
    const linked = directory.projects.find((entry) => entry.path === worktree)!;
    const fromLinked = await collectDashboardProjectDirectory(worktree, { homeDir });
    expect(fromLinked.currentProjectId).toBe(linked.id);
    const normalized = await collectDashboardProjectDirectory(
      path.join(currentProject, 'unused', '..'),
      { homeDir },
    );
    expect(normalized.currentProjectId).toBe(directory.currentProjectId);

    const access = fs.access.bind(fs);
    vi.spyOn(fs, 'access').mockImplementation(async (target, mode) => {
      if (target === worktree) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return access(target, mode);
    });
    const unreadable = await collectDashboardProjectDirectory(currentProject, { homeDir });
    expect(unreadable.projects.find((entry) => entry.path === worktree)).toMatchObject({
      id: linked.id,
      availability: 'unreadable',
    });
    vi.restoreAllMocks();
    git('worktree', 'remove', worktree);
    const missing = await collectDashboardProjectDirectory(currentProject, { homeDir });
    expect(missing.projects.find((entry) => entry.path === worktree)).toMatchObject({
      id: linked.id,
      availability: 'missing',
    });
  });

  it('keeps the launch project when no project index exists', async () => {
    const directory = await collectDashboardProjectDirectory(currentProject, { homeDir });

    expect(directory.currentProjectId).toBe(directory.projects[0].id);
    expect(directory.projects).toEqual([
      expect.objectContaining({
        name: 'current-project',
        path: currentProject,
        availability: 'available',
        isCurrent: true,
      }),
    ]);
  });

  it('uses the registered identity when launched through a directory alias', async () => {
    const alias = path.join(tempDir, 'project-alias');
    await fs.symlink(currentProject, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await upsertProjectInstallation(currentProject, [], 'init', { homeDir });
    const original = await collectDashboardProjectDirectory(currentProject, { homeDir });
    const fromAlias = await collectDashboardProjectDirectory(alias, { homeDir });
    expect(fromAlias.projects).toHaveLength(1);
    expect(fromAlias.currentProjectId).toBe(original.currentProjectId);
  });

  it('sorts indexed projects by last seen time and retains missing projects as unavailable', async () => {
    const recentProject = path.join(tempDir, 'recent-project');
    const missingProject = path.join(tempDir, 'missing-project');
    await fs.mkdir(recentProject);
    const registryPath = getProjectRegistryPath(homeDir);
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(
      registryPath,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: '2026-07-31T00:00:00.000Z',
        projects: [
          {
            path: missingProject,
            canonicalPath: missingProject,
            addedAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
            lastSeenAt: '2026-07-02T00:00:00.000Z',
            lastSource: 'init',
            lastTargets: [],
          },
          {
            path: recentProject,
            canonicalPath: recentProject,
            addedAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
            lastSeenAt: '2026-07-30T00:00:00.000Z',
            lastSource: 'init',
            lastTargets: [],
          },
        ],
      }),
    );

    const directory = await collectDashboardProjectDirectory(currentProject, { homeDir });

    expect(directory.projects.map((project) => project.name)).toEqual([
      'current-project',
      'recent-project',
      'missing-project',
    ]);
    expect(directory.projects.at(-1)).toEqual(
      expect.objectContaining({
        availability: 'missing',
        id: expect.any(String),
        isCurrent: false,
      }),
    );
  });

  it('falls back to the launch project when the project index is invalid', async () => {
    const registryPath = getProjectRegistryPath(homeDir);
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, '{not-json');

    const directory = await collectDashboardProjectDirectory(currentProject, { homeDir });

    expect(directory.projects).toHaveLength(1);
    expect(directory.warning).toContain('项目索引无效');
  });
});
