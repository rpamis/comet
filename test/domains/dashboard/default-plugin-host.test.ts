import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createDefaultDashboardPluginHostFactory } from '../../../domains/dashboard/default-plugin-host.js';

describe('default dashboard plugin host', () => {
  it('registers both first-party pages against the shared plugin runtime', async () => {
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
          expect.objectContaining({ pluginId: 'comet.project-rules', status: 'enabled' }),
        ]),
      );
      await expect(host.get('comet.project-rules')).resolves.toMatchObject({
        data: { initialized: false },
      });
      await expect(host.get('comet.personal-memory')).resolves.toMatchObject({
        data: { status: { learningEnabled: true, retrievalEnabled: true } },
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
