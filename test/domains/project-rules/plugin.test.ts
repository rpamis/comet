import { describe, expect, it } from 'vitest';
import { MemoryPluginStateStore, PluginRuntime } from '../../../domains/comet-plugin/index.js';
import { createProjectRulesPluginDescriptor } from '../../../domains/project-rules/plugin.js';

describe('project rules plugin', () => {
  it('exposes the project rules page and delegates status to the domain service', async () => {
    const descriptor = createProjectRulesPluginDescriptor({
      projectRoot: 'D:/tmp/project-rules-plugin',
      projectId: 'project-1',
    });
    const runtime = new PluginRuntime({
      cometVersion: '0.4.0',
      store: new MemoryPluginStateStore(),
      descriptors: [descriptor],
    });
    await runtime.reconcileFirstParty();

    const pages = await runtime.dashboardPages({ scope: 'project', projectId: 'project-1' });
    expect(pages).toEqual([
      {
        pluginId: 'comet.project-rules',
        id: 'project-rules',
        label: '项目规则',
        route: '/plugins/project-rules',
      },
    ]);
    await expect(
      runtime.invoke(
        'comet.project-rules',
        'status',
        {},
        { scope: 'project', projectId: 'project-1' },
      ),
    ).resolves.toMatchObject({ initialized: false, candidates: [] });
  });
});
