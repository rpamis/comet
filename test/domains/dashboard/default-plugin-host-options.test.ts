import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createDefaultCometPluginBridge = vi.hoisted(() =>
  vi.fn(async () => ({
    currentLanguage: 'en' as const,
    pluginRuntime: {} as never,
  })),
);

vi.mock('../../../domains/comet-plugin/index.js', () => ({
  createDefaultCometPluginBridge,
}));

vi.mock(import('../../../platform/paths/project-identity.js'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveStableProjectId: vi.fn(() => 'repository-1'),
}));

import { createDefaultDashboardPluginHostFactory } from '../../../domains/dashboard/default-plugin-host.js';

describe('default dashboard plugin host options', () => {
  let homeDirectory: string;
  let projectRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-host-options-'));
    projectRoot = path.join(homeDirectory, 'project');
  });

  afterEach(async () => {
    await fs.rm(homeDirectory, { recursive: true, force: true });
  });

  it('leaves the default project knowledge cache selection to the plugin bridge', async () => {
    await createDefaultDashboardPluginHostFactory({
      homeDirectory,
      memoryRoot: path.join(homeDirectory, 'memory'),
      cometVersion: '0.0.0-test',
    })('dashboard-1', projectRoot);

    expect(createDefaultCometPluginBridge).toHaveBeenCalledWith({
      homeDirectory,
      projectRoot,
      projectId: 'repository-1',
      memoryRoot: path.join(homeDirectory, 'memory'),
      cometVersion: '0.0.0-test',
    });
  });

  it('forwards explicitly configured plugin and knowledge roots', async () => {
    await createDefaultDashboardPluginHostFactory({
      homeDirectory,
      stateRoot: path.join(homeDirectory, 'plugins'),
      memoryRoot: path.join(homeDirectory, 'memory'),
      knowledgeCacheRoot: path.join(homeDirectory, 'knowledge'),
      cometVersion: '0.0.0-test',
    })('dashboard-1', projectRoot);

    expect(createDefaultCometPluginBridge).toHaveBeenLastCalledWith({
      homeDirectory,
      projectRoot,
      projectId: 'repository-1',
      stateRoot: path.join(homeDirectory, 'plugins'),
      memoryRoot: path.join(homeDirectory, 'memory'),
      knowledgeCacheRoot: path.join(homeDirectory, 'knowledge'),
      cometVersion: '0.0.0-test',
    });
  });
});
