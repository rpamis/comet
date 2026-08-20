import { describe, expect, it } from 'vitest';
import {
  MemoryPluginStateStore,
  PluginRuntime,
  type PluginDescriptor,
} from '../../../domains/comet-plugin/index.js';
import {
  DashboardPluginHost,
  type DashboardPluginPageRegistration,
} from '../../../domains/dashboard/plugin-host.js';

function descriptor(id: string, status: 'enabled' | 'disabled' = 'enabled'): PluginDescriptor {
  return {
    id,
    kind: 'third-party',
    version: '1.0.0',
    scopes: ['project'],
    compatible: () => true,
    create: async () => ({
      dashboard: { id, label: '测试页面', route: `/plugins/${id}` },
      invoke: async (capability, input) => {
        if (capability === 'echo') return input;
        throw new Error(`unknown capability: ${capability}`);
      },
    }),
  };
}

const page: DashboardPluginPageRegistration = {
  pluginId: 'test.plugin',
  label: '测试页面',
  route: '/plugins/test-plugin',
  load: async ({ invoke }) => ({ value: await invoke('echo', { ok: true }) }),
};

describe('DashboardPluginHost', () => {
  it('lists a page and loads its snapshot through the public runtime API', async () => {
    const runtime = new PluginRuntime({
      cometVersion: '0.4.0',
      store: new MemoryPluginStateStore(),
      descriptors: [descriptor('test.plugin')],
    });
    await runtime.install('test.plugin');
    const host = new DashboardPluginHost({
      runtime,
      projectId: 'project-1',
      pages: [page],
    });

    await expect(host.list()).resolves.toEqual([
      expect.objectContaining({
        pluginId: 'test.plugin',
        label: '测试页面',
        route: '/plugins/test-plugin',
        status: 'enabled',
        globallyDisabled: false,
        projectPaused: false,
      }),
    ]);
    await expect(host.get('test.plugin')).resolves.toMatchObject({
      pluginId: 'test.plugin',
      status: 'enabled',
      data: { value: { ok: true } },
    });
  });

  it('keeps a disabled page visible without loading its private data', async () => {
    const runtime = new PluginRuntime({
      cometVersion: '0.4.0',
      store: new MemoryPluginStateStore(),
      descriptors: [descriptor('test.plugin')],
    });
    await runtime.install('test.plugin');
    await runtime.disable('test.plugin', { scope: 'project', projectId: 'project-1' });
    const host = new DashboardPluginHost({ runtime, projectId: 'project-1', pages: [page] });

    await expect(host.list()).resolves.toEqual([
      expect.objectContaining({
        pluginId: 'test.plugin',
        status: 'disabled',
        globallyDisabled: false,
        projectPaused: true,
      }),
    ]);
    await expect(host.get('test.plugin')).resolves.toMatchObject({
      pluginId: 'test.plugin',
      status: 'disabled',
      data: null,
    });
  });

  it('invokes lifecycle operations without deleting plugin data', async () => {
    const runtime = new PluginRuntime({
      cometVersion: '0.4.0',
      store: new MemoryPluginStateStore(),
      descriptors: [descriptor('test.plugin')],
    });
    await runtime.install('test.plugin');
    const host = new DashboardPluginHost({ runtime, projectId: 'project-1', pages: [page] });

    await host.lifecycle('test.plugin', 'disable');
    expect((await host.list())[0]).toMatchObject({ status: 'disabled' });
    await host.lifecycle('test.plugin', 'enable');
    expect((await host.list())[0]).toMatchObject({ status: 'enabled' });
    await host.lifecycle('test.plugin', 'uninstall');
    await expect(host.list()).resolves.toEqual([]);
    expect(await runtime.get('test.plugin')).toMatchObject({ status: 'uninstalled' });
  });

  it('re-enables a globally disabled plugin from its project page', async () => {
    const runtime = new PluginRuntime({
      cometVersion: '0.4.0',
      store: new MemoryPluginStateStore(),
      descriptors: [descriptor('test.plugin')],
    });
    await runtime.install('test.plugin');
    await runtime.disable('test.plugin');
    const host = new DashboardPluginHost({ runtime, projectId: 'project-1', pages: [page] });

    await expect(host.list()).resolves.toEqual([
      expect.objectContaining({
        status: 'disabled',
        globallyDisabled: true,
        projectPaused: false,
      }),
    ]);
    await host.lifecycle('test.plugin', 'enable');
    await expect(host.list()).resolves.toEqual([
      expect.objectContaining({
        status: 'enabled',
        globallyDisabled: false,
        projectPaused: false,
      }),
    ]);
  });

  it('clears a project pause when global and project disable states overlap', async () => {
    const runtime = new PluginRuntime({
      cometVersion: '0.4.0',
      store: new MemoryPluginStateStore(),
      descriptors: [descriptor('test.plugin')],
    });
    await runtime.install('test.plugin');
    await runtime.disable('test.plugin', { scope: 'project', projectId: 'project-1' });
    await runtime.disable('test.plugin');
    const host = new DashboardPluginHost({ runtime, projectId: 'project-1', pages: [page] });

    await expect(host.list()).resolves.toEqual([
      expect.objectContaining({
        status: 'disabled',
        globallyDisabled: true,
        projectPaused: true,
      }),
    ]);

    await host.lifecycle('test.plugin', 'enable');
    await expect(host.list()).resolves.toEqual([
      expect.objectContaining({
        status: 'enabled',
        globallyDisabled: false,
        projectPaused: false,
      }),
    ]);
  });
});
