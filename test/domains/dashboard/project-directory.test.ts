import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const identity = vi.hoisted(() => ({
  resolveStableProjectId: vi.fn(),
  stableProjectId: vi.fn(),
}));

vi.mock('../../../platform/paths/project-identity.js', () => identity);

import { collectDashboardProjectDirectory } from '../../../domains/dashboard/project-directory.js';
import { getProjectRegistryPath } from '../../../platform/install/project-registry.js';

describe('collectDashboardProjectDirectory', () => {
  let tempDir: string;
  let homeDir: string;
  let currentProject: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    identity.resolveStableProjectId.mockImplementation(
      (projectPath: string) => `git:${projectPath}`,
    );
    identity.stableProjectId.mockImplementation((projectPath: string) => `path:${projectPath}`);
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-project-directory-'));
    homeDir = path.join(tempDir, 'home');
    currentProject = path.join(tempDir, 'current-project');
    await fs.mkdir(currentProject, { recursive: true });
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
        id: `path:${missingProject}`,
        isCurrent: false,
      }),
    );
    expect(identity.resolveStableProjectId).toHaveBeenCalledTimes(2);
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
