import { describe, expect, it } from 'vitest';

import {
  JsonPluginStateStore,
  MemoryPluginStateStore,
  PluginRuntime,
  type PluginDescriptor,
  type PluginEvent,
} from '../../../domains/comet-plugin/index.js';

function descriptor(
  id: string,
  kind: PluginDescriptor['kind'],
  options: Partial<PluginDescriptor> = {},
): PluginDescriptor {
  return {
    id,
    kind,
    version: '1.0.0',
    scopes: ['user'],
    compatible: () => true,
    create: () => ({}),
    ...options,
  };
}

describe('PluginRuntime', () => {
  it('persists lifecycle state through a JSON state adapter', async () => {
    let content: string | null = null;
    const file = {
      read: async () => content,
      write: async (next: string) => {
        content = next;
      },
    };
    const runtime = new PluginRuntime({
      cometVersion: '1.0.0',
      store: new JsonPluginStateStore(file),
      descriptors: [descriptor('memory', 'first-party')],
    });

    await runtime.reconcileFirstParty();
    await runtime.disable('memory');

    const restored = new PluginRuntime({
      cometVersion: '1.0.0',
      store: new JsonPluginStateStore(file),
      descriptors: [descriptor('memory', 'first-party')],
    });
    expect(await restored.get('memory')).toMatchObject({ status: 'disabled' });
    expect(JSON.parse(content ?? '{}')).toMatchObject({ plugins: [{ id: 'memory' }] });
  });

  it('bootstraps first-party plugins without silently installing third-party plugins', async () => {
    const store = new MemoryPluginStateStore();
    const runtime = new PluginRuntime({
      cometVersion: '1.0.0',
      store,
      descriptors: [
        descriptor('memory', 'first-party'),
        descriptor('rules', 'first-party'),
        descriptor('external', 'third-party'),
      ],
    });

    await runtime.reconcileFirstParty();

    expect(await runtime.list()).toMatchObject([
      { id: 'external', status: 'uninstalled' },
      { id: 'memory', status: 'enabled' },
      { id: 'rules', status: 'enabled' },
    ]);

    await expect(runtime.install('external', 'system')).rejects.toMatchObject({
      code: 'user-action-required',
    });
    await runtime.install('external');
    expect((await runtime.get('external'))?.status).toBe('enabled');
  });

  it('preserves explicit disable and uninstall choices across first-party upgrades', async () => {
    const store = new MemoryPluginStateStore();
    const first = descriptor('memory', 'first-party');
    const runtime = new PluginRuntime({ cometVersion: '1.0.0', store, descriptors: [first] });

    await runtime.reconcileFirstParty();
    await runtime.disable('memory');

    const upgraded = new PluginRuntime({
      cometVersion: '2.0.0',
      store,
      descriptors: [
        descriptor('memory', 'first-party', { version: '2.0.0' }),
        descriptor('rules', 'first-party', { version: '2.0.0' }),
      ],
    });
    await upgraded.reconcileFirstParty();

    expect(await upgraded.get('memory')).toMatchObject({ status: 'disabled', version: '2.0.0' });
    expect(await upgraded.get('rules')).toMatchObject({ status: 'enabled', version: '2.0.0' });

    await upgraded.uninstall('memory');
    const later = new PluginRuntime({
      cometVersion: '3.0.0',
      store,
      descriptors: [descriptor('memory', 'first-party', { version: '3.0.0' })],
    });
    await later.reconcileFirstParty();
    expect(await later.get('memory')).toMatchObject({ status: 'uninstalled', version: '3.0.0' });
  });

  it('delivers immutable events, scoped context, and dashboard contributions through one public runtime', async () => {
    const seen: PluginEvent[] = [];
    const runtime = new PluginRuntime({
      cometVersion: '1.0.0',
      store: new MemoryPluginStateStore(),
      descriptors: [
        descriptor('memory', 'first-party', {
          create: () => ({
            onEvent: (event) => seen.push(event),
            provideContext: () => ({ text: 'memory context' }),
            dashboard: { id: 'memory-page', label: 'Personal memory', route: '/memory' },
          }),
        }),
      ],
    });
    await runtime.reconcileFirstParty();

    const payload = { change: 'one' };
    await runtime.dispatch({ name: 'change.completed', scope: 'user', payload });
    payload.change = 'mutated';
    expect(seen[0]?.payload).toEqual({ change: 'one' });

    await expect(runtime.collectContext({ task: 'build' }, 'user')).resolves.toEqual([
      { pluginId: 'memory', text: 'memory context' },
    ]);
    await expect(runtime.dashboardPages('user')).resolves.toEqual([
      { pluginId: 'memory', id: 'memory-page', label: 'Personal memory', route: '/memory' },
    ]);
  });

  it('isolates incompatible and failing plugins while healthy plugins continue', async () => {
    const runtime = new PluginRuntime({
      cometVersion: '2.0.0',
      store: new MemoryPluginStateStore(),
      descriptors: [
        descriptor('healthy', 'first-party', {
          create: () => ({ provideContext: () => ({ text: 'ok' }) }),
        }),
        descriptor('incompatible', 'first-party', { compatible: () => false }),
        descriptor('broken', 'first-party', {
          create: () => ({
            provideContext: () => {
              throw new Error('broken provider');
            },
          }),
        }),
      ],
    });
    await runtime.reconcileFirstParty();

    await expect(runtime.collectContext({ task: 'build' }, 'user')).resolves.toEqual([
      { pluginId: 'healthy', text: 'ok' },
    ]);
    expect(runtime.diagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pluginId: 'incompatible', code: 'incompatible' }),
        expect.objectContaining({ pluginId: 'broken', code: 'execution-failed' }),
      ]),
    );
  });

  it('reports a previously enabled plugin that is no longer available without blocking others', async () => {
    const store = new MemoryPluginStateStore({
      plugins: [
        {
          id: 'removed',
          version: '1.0.0',
          status: 'enabled',
          explicitRemoval: false,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const runtime = new PluginRuntime({
      cometVersion: '1.0.0',
      store,
      descriptors: [descriptor('healthy', 'first-party', { create: () => ({}) })],
    });

    await runtime.collectContext({ task: 'build' }, 'user');

    expect(runtime.diagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pluginId: 'removed', code: 'missing', phase: 'load' }),
      ]),
    );
  });
});
