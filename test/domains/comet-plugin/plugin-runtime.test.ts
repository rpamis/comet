import { describe, expect, it, vi } from 'vitest';

import {
  JsonPluginStateStore,
  MemoryPluginStorageStore,
  MemoryPluginStateStore,
  PluginRuntime,
  type PluginDescriptor,
} from '../../../domains/comet-plugin/index.js';
import {
  AGENT_EXPERIENCE_SCHEMA,
  AgentExperienceJournal,
  MemoryAgentExperienceJournalStore,
  reflectionEvents,
  type AgentContextCandidate,
  type AgentExperienceEvent,
} from '../../../domains/agent-learning/index.js';

function experience(
  type: AgentExperienceEvent['type'],
  options: {
    readonly scope?: AgentExperienceEvent['scope'];
    readonly projectId?: string;
    readonly changeId?: string;
  } = {},
): AgentExperienceEvent {
  const scope = options.scope ?? 'user';
  const changeId = options.changeId ?? 'one';
  return {
    schema: AGENT_EXPERIENCE_SCHEMA,
    eventId: `event:${scope}:${changeId}`,
    episodeId: `episode:${scope}:${changeId}`,
    occurredAt: '2026-08-24T00:00:00.000Z',
    type,
    actor: 'workflow',
    scope,
    ...(scope === 'project' ? { projectId: options.projectId ?? 'project-a' } : {}),
    source: { kind: 'workflow', name: 'native', workflow: 'native', changeId },
    context: { workflow: 'native', changeId },
    evidence: [],
  };
}

function contextCandidate(summary: string, id = 'candidate'): AgentContextCandidate {
  return {
    id,
    owner: 'fixture',
    scope: 'project',
    memoryType: 'personal-episode',
    kind: 'test',
    state: 'proven',
    authority: 'inferred',
    title: summary,
    summary,
    content: summary,
    selectors: {},
    sources: [{ type: 'inference' }],
    verification: [],
  };
}

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
  it('returns after durable capture without waiting for background Reflection', async () => {
    let releaseReflection: (() => void) | undefined;
    const reflectionGate = new Promise<void>((resolve) => {
      releaseReflection = resolve;
    });
    const runtime = new PluginRuntime({
      cometVersion: '1.0.0',
      store: new MemoryPluginStateStore(),
      descriptors: [
        descriptor('memory', 'first-party', {
          create: () => ({
            events: ['episode.completed'],
            onEvent: () => reflectionGate,
          }),
        }),
      ],
    });
    await runtime.reconcileFirstParty();

    const dispatched = runtime.dispatch(experience('episode.completed'));
    const completion = await Promise.race([
      dispatched.then(() => 'returned' as const),
      new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 25)),
    ]);

    releaseReflection?.();
    await dispatched;
    expect(completion).toBe('returned');
  });

  it('records source-aware diagnostics when an Experience Event envelope is invalid', async () => {
    const runtime = new PluginRuntime({
      cometVersion: '1.0.0',
      store: new MemoryPluginStateStore(),
      descriptors: [],
    });
    const invalid = {
      ...experience('episode.completed'),
      schema: 'comet.agent-experience.invalid',
      source: { kind: 'workflow', name: 'classic', workflow: 'classic' },
    } as unknown as AgentExperienceEvent;

    await expect(runtime.dispatch(invalid)).rejects.toThrow(/schema/iu);
    expect(runtime.diagnostics()).toEqual([
      expect.objectContaining({
        pluginId: 'comet.agent-learning',
        code: 'execution-failed',
        phase: 'event',
        source: 'classic',
        message: expect.stringContaining('classic'),
      }),
    ]);
  });

  it('replays user-scope learning from the shared user Journal after switching projects', async () => {
    const userJournal = new AgentExperienceJournal(new MemoryAgentExperienceJournalStore());
    const projectAJournal = new AgentExperienceJournal(new MemoryAgentExperienceJournalStore());
    const projectBJournal = new AgentExperienceJournal(new MemoryAgentExperienceJournalStore());
    let failReflection = true;
    const received: string[] = [];
    const learner = descriptor('memory', 'first-party', {
      create: () => ({
        events: ['episode.completed'],
        onEvent: (event) => {
          if (failReflection) throw new Error('temporary reflection failure');
          received.push(event.eventId);
        },
      }),
    });
    const runtimeA = new PluginRuntime({
      cometVersion: '1.0.0',
      store: new MemoryPluginStateStore(),
      descriptors: [learner],
      journals: { user: userJournal, project: projectAJournal },
    });
    await runtimeA.reconcileFirstParty();
    const event = experience('episode.completed', { changeId: 'shared-user-event' });
    await runtimeA.dispatch(event);
    expect(await userJournal.pending()).toEqual([
      expect.objectContaining({ eventId: event.eventId }),
    ]);
    expect(await projectAJournal.list()).toEqual([]);

    failReflection = false;
    const runtimeB = new PluginRuntime({
      cometVersion: '1.0.0',
      store: new MemoryPluginStateStore(),
      descriptors: [learner],
      journals: { user: userJournal, project: projectBJournal },
    });
    await runtimeB.reconcileFirstParty();
    await runtimeB.collectContext({ task: 'resume user learning' }, 'user');

    await vi.waitFor(() => expect(received).toEqual([event.eventId]));
    await vi.waitFor(async () => expect(await userJournal.pending()).toEqual([]));
    expect(await projectBJournal.list()).toEqual([]);
  });

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
            onEvent: (event) => events.push(event.type),
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
    await runtime.dispatch(experience('episode.completed'));
    await vi.waitFor(() => expect(events).toEqual(['episode.completed']));
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
    const seen: AgentExperienceEvent[] = [];
    const runtime = new PluginRuntime({
      cometVersion: '1.0.0',
      store: new MemoryPluginStateStore(),
      descriptors: [
        descriptor('memory', 'first-party', {
          create: () => ({
            onEvent: (event) => seen.push(event),
            provideContext: () => contextCandidate('memory context'),
            dashboard: { id: 'memory-page', label: 'Personal memory', route: '/memory' },
          }),
        }),
      ],
    });
    await runtime.reconcileFirstParty();

    const event = experience('episode.completed');
    await runtime.dispatch(event);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]?.context).toEqual({ workflow: 'native', changeId: 'one' });
    expect(seen[0]?.source).toEqual({
      kind: 'workflow',
      name: 'native',
      workflow: 'native',
      changeId: 'one',
    });

    await expect(runtime.collectContext({ task: 'build' }, 'user')).resolves.toEqual([
      expect.objectContaining({ owner: 'memory', summary: 'memory context' }),
    ]);
    await expect(runtime.dashboardPages('user')).resolves.toEqual([
      { pluginId: 'memory', id: 'memory-page', label: 'Personal memory', route: '/memory' },
    ]);
  });

  it('resolves an expansion through its owning plugin when candidate IDs collide', async () => {
    const runtime = new PluginRuntime({
      cometVersion: '1.0.0',
      store: new MemoryPluginStateStore(),
      descriptors: [
        descriptor('plugin-a', 'first-party', {
          create: () => ({ resolveContext: () => contextCandidate('from A', 'shared') }),
        }),
        descriptor('plugin-b', 'first-party', {
          create: () => ({ resolveContext: () => contextCandidate('from B', 'shared') }),
        }),
      ],
    });
    await runtime.reconcileFirstParty();

    await expect(
      runtime.resolveContext('shared', { task: 'inspect' }, 'user'),
    ).resolves.toHaveLength(2);
    await expect(
      runtime.resolveContext('shared', { task: 'inspect' }, 'user', 'plugin-b'),
    ).resolves.toEqual([expect.objectContaining({ owner: 'plugin-b', summary: 'from B' })]);
  });

  it('delivers large first-party learning evidence in bounded reflection chunks once', async () => {
    const evidenceChunks: string[][] = [];
    const runtime = new PluginRuntime({
      cometVersion: '1.0.0',
      store: new MemoryPluginStateStore(),
      descriptors: [
        descriptor('memory', 'first-party', {
          create: () => ({
            reflect: async (request) => {
              evidenceChunks.push(
                reflectionEvents(request).flatMap((entry) =>
                  entry.evidence.map((evidence) => evidence.id),
                ),
              );
              return [];
            },
            consolidate: async () => {},
          }),
        }),
      ],
    });
    await runtime.reconcileFirstParty();
    const event = {
      ...experience('episode.completed'),
      evidence: Array.from({ length: 35 }, (_, index) => ({
        id: `evidence-${index}`,
        kind: 'source' as const,
        summary: `large evidence ${index} ${'内容'.repeat(2_000)}`,
      })),
    };

    await runtime.dispatch(event);
    await runtime.dispatch(event);

    await vi.waitFor(() =>
      expect(evidenceChunks.map((chunk) => chunk.length)).toEqual([16, 16, 3]),
    );
    expect(evidenceChunks.flat()).toEqual(event.evidence.map((evidence) => evidence.id));
  });

  it('isolates incompatible and failing plugins while healthy plugins continue', async () => {
    const runtime = new PluginRuntime({
      cometVersion: '2.0.0',
      store: new MemoryPluginStateStore(),
      descriptors: [
        descriptor('healthy', 'first-party', {
          create: () => ({
            provideContext: () => contextCandidate('ok', 'healthy-candidate'),
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
      expect.objectContaining({ owner: 'healthy', summary: 'ok' }),
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
              events: ['episode.completed'],
              onEvent: (event) => seen.push(`${event.source.name}:${event.context.changeId}`),
              provideContext: async (request) =>
                contextCandidate(
                  `${request.projectId}:${(await context.storage.read())?.owner}`,
                  'project-memory',
                ),
            };
          },
        }),
        descriptor('rules', 'first-party', {
          scopes: ['project'],
          create: async (context) => {
            expect(context.config).toEqual({ mode: 'strict' });
            await context.storage.write({ owner: 'rules' });
            return {
              onEvent: (event) => seen.push(`${event.source.name}:${event.context.changeId}`),
              invoke: (capability, input) =>
                capability === 'check' ? { capability, input, owner: 'rules' } : null,
            };
          },
        }),
      ],
    });
    await runtime.reconcileFirstParty();

    await runtime.dispatch(
      experience('episode.completed', { scope: 'project', projectId: 'project-a' }),
    );
    await vi.waitFor(() => expect(seen).toEqual(['native:one', 'native:one']));
    await expect(
      runtime.collectContext(
        { task: 'build', projectId: 'project-a' },
        {
          scope: 'project',
          projectId: 'project-a',
        },
      ),
    ).resolves.toEqual([expect.objectContaining({ owner: 'memory', summary: 'project-a:memory' })]);
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
    await runtime.dispatch(
      experience('episode.completed', {
        scope: 'project',
        projectId: 'project-a',
        changeId: 'two',
      }),
    );
    await vi.waitFor(() => expect(seen).toEqual(['native:one', 'native:one', 'native:two']));

    await runtime.enable('rules', { scope: 'project', projectId: 'project-a' });
    await runtime.dispatch(
      experience('episode.completed', {
        scope: 'project',
        projectId: 'project-a',
        changeId: 'three',
      }),
    );
    await vi.waitFor(() =>
      expect(seen).toEqual([
        'native:one',
        'native:one',
        'native:two',
        'native:three',
        'native:three',
      ]),
    );
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
              provideContext: () => contextCandidate(`version-${version}`, `version-${version}`),
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
      expect.objectContaining({ owner: 'memory', summary: 'version-1' }),
    ]);

    await runtime.update('memory');
    await expect(runtime.collectContext({ task: 'after' }, 'user')).resolves.toEqual([
      expect.objectContaining({ owner: 'memory', summary: 'version-2' }),
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
