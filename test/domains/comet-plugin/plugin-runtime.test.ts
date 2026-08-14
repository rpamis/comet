import { describe, expect, it } from 'vitest';

import {
  JsonPluginStateStore,
  MemoryPluginStorageStore,
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
    const events: string[] = [];
    const runtime = new PluginRuntime({
      cometVersion: '1.0.0',
      store,
      descriptors: [
        descriptor('memory', 'first-party'),
        descriptor('rules', 'first-party'),
        descriptor('external', 'third-party', {
          create: () => ({
            onEvent: (event) => events.push(event.name),
            invoke: (capability, input) => ({ capability, input }),
          }),
        }),
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
    await runtime.dispatch({
      name: 'plugin.event',
      scope: 'user',
      source: { kind: 'system', name: 'test' },
      payload: { value: 1 },
    });
    expect(events).toEqual(['plugin.event']);
    await expect(runtime.invoke('external', 'echo', { value: 1 })).resolves.toEqual({
      capability: 'echo',
      input: { value: 1 },
    });

    await runtime.disable('external');
    expect((await runtime.get('external'))?.status).toBe('disabled');
    await runtime.enable('external');
    await runtime.update('external');
    await runtime.uninstall('external');
    expect((await runtime.get('external'))?.status).toBe('uninstalled');
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
    await runtime.dispatch({
      name: 'change.completed',
      scope: 'user',
      source: { kind: 'workflow', name: 'native', change: 'one' },
      payload,
    });
    payload.change = 'mutated';
    expect(seen[0]?.payload).toEqual({ change: 'one' });
    expect(seen[0]?.source).toEqual({ kind: 'workflow', name: 'native', change: 'one' });

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
          create: () => ({
            provideContext: () => ({ text: 'ok' }),
            dashboard: { id: 'healthy-page', label: 'Healthy', route: '/healthy' },
          }),
        }),
        descriptor('incompatible', 'first-party', { compatible: () => false }),
        descriptor('broken', 'first-party', {
          create: () => {
            const module = {
              provideContext: () => {
                throw new Error('broken provider');
              },
            };
            Object.defineProperty(module, 'dashboard', {
              get: () => {
                throw new Error('broken dashboard');
              },
            });
            return module;
          },
        }),
      ],
    });
    await runtime.reconcileFirstParty();

    await expect(runtime.collectContext({ task: 'build' }, 'user')).resolves.toEqual([
      { pluginId: 'healthy', text: 'ok' },
    ]);
    await expect(runtime.dashboardPages('user')).resolves.toEqual([
      { pluginId: 'healthy', id: 'healthy-page', label: 'Healthy', route: '/healthy' },
    ]);
    expect(runtime.diagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pluginId: 'incompatible', code: 'incompatible' }),
        expect.objectContaining({ pluginId: 'broken', code: 'execution-failed' }),
        expect.objectContaining({ pluginId: 'broken', phase: 'dashboard' }),
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
          disabledProjects: [],
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

  it('provides source-aware events, isolated plugin storage, configuration, and project pauses', async () => {
    const seen: string[] = [];
    const storage = new MemoryPluginStorageStore();
    const runtime = new PluginRuntime({
      cometVersion: '1.0.0',
      store: new MemoryPluginStateStore(),
      storage,
      config: {
        memory: { mode: 'safe', nested: { level: 'strict' } },
        rules: { mode: 'strict' },
      },
      descriptors: [
        descriptor('memory', 'first-party', {
          scopes: ['project'],
          create: async (context) => {
            expect(context.config).toEqual({ mode: 'safe', nested: { level: 'strict' } });
            await context.storage.write({ owner: 'memory' });
            return {
              events: ['change.completed'],
              onEvent: (event) => seen.push(`${event.source.name}:${event.payload.change}`),
              provideContext: async (request) => ({
                text: `${request.projectId}:${(await context.storage.read())?.owner}`,
              }),
            };
          },
        }),
        descriptor('rules', 'first-party', {
          scopes: ['project'],
          create: async (context) => {
            expect(context.config).toEqual({ mode: 'strict' });
            await context.storage.write({ owner: 'rules' });
            return {
              onEvent: (event) => seen.push(`${event.source.name}:${event.payload.change}`),
              invoke: (capability, input) =>
                capability === 'check' ? { capability, input, owner: 'rules' } : null,
            };
          },
        }),
      ],
    });
    await runtime.reconcileFirstParty();

    await runtime.dispatch({
      name: 'change.completed',
      scope: 'project',
      projectId: 'project-a',
      source: { kind: 'workflow', name: 'native', projectId: 'project-a' },
      payload: { change: 'one' },
    });
    expect(seen).toEqual(['native:one', 'native:one']);
    await expect(
      runtime.collectContext(
        { task: 'build', projectId: 'project-a' },
        {
          scope: 'project',
          projectId: 'project-a',
        },
      ),
    ).resolves.toEqual([{ pluginId: 'memory', text: 'project-a:memory' }]);
    expect(
      await runtime.invoke(
        'rules',
        'check',
        { path: 'src' },
        {
          scope: 'project',
          projectId: 'project-a',
        },
      ),
    ).toEqual({ capability: 'check', input: { path: 'src' }, owner: 'rules' });
    expect(runtime.getConfig('rules')).toEqual({ mode: 'strict' });
    await runtime.disable('rules', { scope: 'project', projectId: 'project-a' });
    expect(await runtime.get('rules')).toMatchObject({
      status: 'enabled',
      disabledProjects: ['project-a'],
    });
    await runtime.dispatch({
      name: 'change.completed',
      scope: 'project',
      projectId: 'project-a',
      source: { kind: 'workflow', name: 'native', projectId: 'project-a' },
      payload: { change: 'two' },
    });
    expect(seen).toEqual(['native:one', 'native:one', 'native:two']);

    await runtime.enable('rules', { scope: 'project', projectId: 'project-a' });
    await runtime.dispatch({
      name: 'change.completed',
      scope: 'project',
      projectId: 'project-a',
      source: { kind: 'workflow', name: 'native', projectId: 'project-a' },
      payload: { change: 'three' },
    });
    expect(seen).toEqual([
      'native:one',
      'native:one',
      'native:two',
      'native:three',
      'native:three',
    ]);
    await runtime.configure('rules', { mode: 'evaluate' });
    expect(runtime.getConfig('rules')).toEqual({ mode: 'evaluate' });
  });

  it('recreates an active plugin after update so new code handles later events', async () => {
    let creates = 0;
    let disposals = 0;
    const runtime = new PluginRuntime({
      cometVersion: '1.0.0',
      store: new MemoryPluginStateStore(),
      descriptors: [
        descriptor('memory', 'first-party', {
          create: () => {
            creates += 1;
            const version = creates;
            return {
              provideContext: () => ({ text: `version-${version}` }),
              dispose: () => {
                disposals += 1;
              },
            };
          },
        }),
      ],
    });
    await runtime.reconcileFirstParty();
    await expect(runtime.collectContext({ task: 'before' }, 'user')).resolves.toEqual([
      { pluginId: 'memory', text: 'version-1' },
    ]);

    await runtime.update('memory');
    await expect(runtime.collectContext({ task: 'after' }, 'user')).resolves.toEqual([
      { pluginId: 'memory', text: 'version-2' },
    ]);
    expect(disposals).toBe(1);
  });

  it('deep-freezes configuration and does not enable an uninstalled plugin', async () => {
    let contextConfig: Readonly<Record<string, unknown>> | undefined;
    const runtime = new PluginRuntime({
      cometVersion: '1.0.0',
      store: new MemoryPluginStateStore(),
      config: { external: { nested: { enabled: true } } },
      descriptors: [
        descriptor('external', 'third-party', {
          create: (context) => {
            contextConfig = context.config;
            return {};
          },
        }),
      ],
    });

    await expect(runtime.enable('external')).rejects.toMatchObject({ code: 'missing' });
    await expect(
      runtime.disable('external', { scope: 'project', projectId: 'project-a' }),
    ).rejects.toMatchObject({ code: 'missing' });
    expect(await runtime.get('external')).toMatchObject({ status: 'uninstalled' });

    await runtime.install('external');
    await runtime.collectContext({ task: 'inspect' }, 'user');
    expect(Object.isFrozen(contextConfig)).toBe(true);
    expect(Object.isFrozen(contextConfig?.nested)).toBe(true);
    expect(() => {
      (contextConfig?.nested as Record<string, unknown>).enabled = false;
    }).toThrow();
    expect(runtime.getConfig('external')).toEqual({ nested: { enabled: true } });
  });

  it('records a diagnostic when a requested capability is missing', async () => {
    const runtime = new PluginRuntime({
      cometVersion: '1.0.0',
      store: new MemoryPluginStateStore(),
      descriptors: [descriptor('memory', 'first-party')],
    });
    await runtime.reconcileFirstParty();

    await expect(runtime.invoke('memory', 'missing', {})).rejects.toMatchObject({
      code: 'missing',
    });
    expect(runtime.diagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pluginId: 'memory', code: 'missing', phase: 'invoke' }),
      ]),
    );
  });
});
