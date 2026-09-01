import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const createDefaultCometPluginBridge = vi.hoisted(() =>
  vi.fn(async () => ({
    currentLanguage: 'en' as const,
    pluginRuntime: {} as never,
  })),
);

vi.mock('../../../domains/comet-plugin/index.js', () => ({
  createDefaultCometPluginBridge,
}));

import { createDefaultDashboardPluginHostFactory } from '../../../domains/dashboard/default-plugin-host.js';

describe('default dashboard plugin host options', () => {
  it('leaves the default project knowledge cache selection to the plugin bridge', async () => {
    await createDefaultDashboardPluginHostFactory({
      memoryRoot: '/tmp/comet-memory',
      cometVersion: '0.0.0-test',
    })('project-1', '/tmp/comet-project');

    expect(createDefaultCometPluginBridge).toHaveBeenCalledWith({
      projectRoot: '/tmp/comet-project',
      projectId: 'project-1',
      memoryRoot: path.resolve('/tmp/comet-memory'),
      cometVersion: '0.0.0-test',
    });
  });

  it('forwards explicitly configured plugin and knowledge roots', async () => {
    await createDefaultDashboardPluginHostFactory({
      stateRoot: '/tmp/comet-plugins',
      memoryRoot: '/tmp/comet-memory',
      knowledgeCacheRoot: '/tmp/comet-knowledge',
      cometVersion: '0.0.0-test',
    })('project-1', '/tmp/comet-project');

    expect(createDefaultCometPluginBridge).toHaveBeenLastCalledWith({
      projectRoot: '/tmp/comet-project',
      projectId: 'project-1',
      stateRoot: path.resolve('/tmp/comet-plugins'),
      memoryRoot: path.resolve('/tmp/comet-memory'),
      knowledgeCacheRoot: path.resolve('/tmp/comet-knowledge'),
      cometVersion: '0.0.0-test',
    });
  });
});
