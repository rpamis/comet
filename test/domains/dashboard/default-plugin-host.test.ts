import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createDefaultDashboardPluginHostFactory } from '../../../domains/dashboard/default-plugin-host.js';

describe('default dashboard plugin host', () => {
  it('registers the personal memory page against the shared plugin runtime', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-default-plugin-host-'));
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot, { recursive: true });
    try {
      const factory = createDefaultDashboardPluginHostFactory({
        stateRoot: path.join(root, 'plugins'),
        memoryRoot: path.join(root, 'memory'),
      });
      const host = await factory('project-1', projectRoot);
      expect(await host.list()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ pluginId: 'comet.personal-memory', status: 'enabled' }),
          expect.objectContaining({
            pluginId: 'comet.project-knowledge',
            label: '项目知识',
            route: '/plugins/project-knowledge',
            status: 'enabled',
            projectPaused: false,
          }),
        ]),
      );
      await expect(host.get('comet.personal-memory')).resolves.toMatchObject({
        data: { status: { learningEnabled: true, retrievalEnabled: true } },
      });
      await expect(host.get('comet.project-knowledge')).resolves.toMatchObject({
        data: {
          provider: 'local',
          configured: true,
          retrieval: expect.stringContaining('不会在项目中生成知识文件'),
          diagnostics: [],
        },
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the project knowledge page reachable while the project is paused', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-default-plugin-host-pause-'));
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot, { recursive: true });
    try {
      const factory = createDefaultDashboardPluginHostFactory({
        stateRoot: path.join(root, 'plugins'),
        memoryRoot: path.join(root, 'memory'),
      });
      const host = await factory('project-1', projectRoot);

      await host.lifecycle('comet.project-knowledge', 'disable');

      await expect(host.list()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            pluginId: 'comet.project-knowledge',
            status: 'disabled',
            globallyDisabled: false,
            projectPaused: true,
          }),
        ]),
      );
      await expect(host.get('comet.project-knowledge')).resolves.toMatchObject({ data: null });

      await host.lifecycle('comet.project-knowledge', 'enable');

      await expect(host.list()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            pluginId: 'comet.project-knowledge',
            status: 'enabled',
            globallyDisabled: false,
            projectPaused: false,
          }),
        ]),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps a globally disabled project knowledge page reachable for recovery', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-default-plugin-host-global-'));
    const projectRoot = path.join(root, 'project');
    const stateRoot = path.join(root, 'plugins');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(
      path.join(stateRoot, 'state.json'),
      `${JSON.stringify({
        plugins: [
          {
            id: 'comet.project-knowledge',
            version: '1.0.0',
            status: 'disabled',
            explicitRemoval: false,
            disabledProjects: [],
            updatedAt: '2026-08-20T00:00:00.000Z',
          },
        ],
      })}\n`,
    );
    try {
      const factory = createDefaultDashboardPluginHostFactory({
        stateRoot,
        memoryRoot: path.join(root, 'memory'),
      });
      const host = await factory('project-1', projectRoot);

      await expect(host.list()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            pluginId: 'comet.project-knowledge',
            status: 'disabled',
            globallyDisabled: true,
            projectPaused: false,
          }),
        ]),
      );
      await expect(host.get('comet.project-knowledge')).resolves.toMatchObject({ data: null });

      await host.lifecycle('comet.project-knowledge', 'enable');

      await expect(host.list()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            pluginId: 'comet.project-knowledge',
            status: 'enabled',
            globallyDisabled: false,
            projectPaused: false,
          }),
        ]),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
