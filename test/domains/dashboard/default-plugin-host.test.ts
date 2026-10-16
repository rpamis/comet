import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createServer } from 'node:http';
import { createDefaultCometPluginBridge } from '../../../domains/comet-plugin/index.js';
import { createDefaultDashboardPluginHostFactory } from '../../../domains/dashboard/default-plugin-host.js';
import { resolveStableProjectId } from '../../../platform/paths/project-identity.js';
import {
  FileMemoryRepository,
  PersonalMemoryService,
} from '../../../domains/comet-memory/index.js';
import { SqliteAgentContextApplicationStore } from '../../../domains/agent-learning/index.js';

describe('default dashboard plugin host', () => {
  it('returns available sections and cancels an unavailable provider within the page budget', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-remote-budget-'));
    const project = path.join(root, 'project');
    await fs.mkdir(project);
    await fs.mkdir(path.join(root, '.comet'));
    let requests = 0;
    const requestSockets = new Set<import('node:net').Socket>();
    const server = createServer((request) => {
      requests++;
      requestSockets.add(request.socket);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      `personal_memory:\n  provider: remote\n  remote:\n    endpoint: http://127.0.0.1:${(server.address() as { port: number }).port}\n    timeout_ms: 120000\n`,
    );
    const host = await createDefaultDashboardPluginHostFactory({ homeDirectory: root })(
      'route',
      project,
    );
    const pending = host.get('comet.personal-memory');
    void pending.catch(() => {});
    try {
      const snapshot = await Promise.race([
        pending,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500)),
      ]);
      expect(snapshot, 'page budget must not inherit the provider timeout').not.toBeNull();
      expect(snapshot?.data).toMatchObject({
        partial: true,
        providerConfig: { provider: 'remote' },
        sectionErrors: expect.arrayContaining([expect.objectContaining({ section: 'management' })]),
      });
      expect(requests).toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(
        [...requestSockets].every((socket) => socket.destroyed),
        'all sockets carrying hung requests must be closed',
      ).toBe(true);
    } finally {
      server.closeAllConnections();
      await pending.catch(() => {});
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('keeps a large application ledger out of the page and reads older history by cursor', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-history-'));
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot);
    const stateRoot = path.join(root, 'plugins'),
      memoryRoot = path.join(root, 'memory');
    try {
      const memory = await new PersonalMemoryService({
        repository: new FileMemoryRepository(memoryRoot),
      }).remember({ scope: 'global', category: 'workflow', text: 'Run focused checks.' });
      const store = new SqliteAgentContextApplicationStore(
        path.join(stateRoot, 'storage', 'context-applications.sqlite'),
      );
      const projectId = resolveStableProjectId(projectRoot);
      await store.appendMany(
        Array.from({ length: 3000 }, (_, index) => ({
          applicationId: `app-${index}`,
          candidateId: memory.id,
          candidateDigest: 'digest',
          owner: 'comet.personal-memory',
          scope: 'user',
          contextProjectId: projectId,
          memoryType: 'core-profile',
          episodeId: `episode-${index}`,
          task: 'Fix login',
          whyApplied: 'Explicit preference',
          delivery: 'full',
          appliedAt: new Date(1760000000000 + index * 1000).toISOString(),
          appliedEventDispatchedAt: '2026-10-15T00:00:00.000Z',
        })),
      );
      const host = await createDefaultDashboardPluginHostFactory({
        homeDirectory: root,
        stateRoot,
        memoryRoot,
        knowledgeCacheRoot: path.join(root, 'knowledge'),
      })('route', projectRoot);
      const snapshot = await host.get('comet.personal-memory');
      const data = snapshot.data as {
        management: {
          records: {
            id: string;
            contextApplicationCount: number;
            applicationHistory: unknown[];
            applicationHistoryCursor: string;
          }[];
        };
      };
      const record = data.management.records.find((record) => record.id === memory.id)!;
      expect(record.contextApplicationCount).toBe(3000);
      expect(record.applicationHistory).toHaveLength(6);
      expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThan(25000);
      const page = (await host.invoke('comet.personal-memory', 'application-history', {
        candidateId: memory.id,
        cursor: record.applicationHistoryCursor,
      })) as { items: unknown[]; total: number; nextCursor: string };
      expect(page.items).toHaveLength(20);
      expect(page.total).toBe(3000);
      expect(page.nextCursor).toBeTruthy();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('reads the task usage persisted by the CLI bridge without counting Dashboard or fast Hook reads', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-usage-'));
    const projectRoot = path.join(root, 'project');
    const otherRoot = path.join(root, 'other-project');
    await fs.mkdir(projectRoot);
    await fs.mkdir(otherRoot);
    const options = {
      homeDirectory: root,
      stateRoot: path.join(root, 'plugins'),
      memoryRoot: path.join(root, 'memory'),
      knowledgeCacheRoot: path.join(root, 'knowledge'),
    };
    try {
      const projectId = resolveStableProjectId(projectRoot);
      const bridge = await createDefaultCometPluginBridge({ ...options, projectRoot, projectId });
      await bridge.collectContext({ task: '实际任务请求' });
      const factory = createDefaultDashboardPluginHostFactory(options);
      const host = await factory('dashboard-route-id', projectRoot);
      await expect(host.get('comet.personal-memory')).resolves.toMatchObject({
        data: { contextUsage: { requests: 1 } },
      });
      await expect(host.get('comet.project-knowledge')).resolves.toMatchObject({
        data: { contextUsage: { requests: 1 } },
      });
      const fast = await createDefaultCometPluginBridge({
        ...options,
        projectRoot,
        projectId,
        bestEffortContext: true,
      });
      await fast.collectContext({ task: 'Hook 快速读取' });
      await expect(host.get('comet.personal-memory')).resolves.toMatchObject({
        data: { contextUsage: { requests: 1 } },
      });
      const other = await factory('other-route-id', otherRoot);
      await expect(other.get('comet.personal-memory')).resolves.toMatchObject({
        data: { contextUsage: { requests: 0 } },
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('preserves repository plugin pause state when the Dashboard uses a path ID', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dashboard-repository-state-'));
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot);
    try {
      const repositoryId = resolveStableProjectId(projectRoot);
      const options = {
        homeDirectory: root,
        stateRoot: path.join(root, 'plugins'),
        memoryRoot: path.join(root, 'memory'),
        knowledgeCacheRoot: path.join(root, 'knowledge'),
      };
      const bridge = await createDefaultCometPluginBridge({
        ...options,
        projectRoot,
        projectId: repositoryId,
      });
      await bridge.pluginRuntime.disable('comet.project-knowledge', {
        scope: 'project',
        projectId: repositoryId,
      });
      const factory = createDefaultDashboardPluginHostFactory(options);
      const host = await factory('dashboard-path-id', projectRoot);
      await expect(host.list()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ pluginId: 'comet.project-knowledge', projectPaused: true }),
        ]),
      );
      await host.lifecycle('comet.project-knowledge', 'enable');
      const reopened = await createDefaultCometPluginBridge({
        ...options,
        projectRoot,
        projectId: repositoryId,
      });
      expect(
        (await reopened.pluginRuntime.get('comet.project-knowledge'))?.disabledProjects,
      ).not.toContain(repositoryId);
      await host.lifecycle('comet.project-knowledge', 'disable');
      const disabled = await createDefaultCometPluginBridge({
        ...options,
        projectRoot,
        projectId: repositoryId,
      });
      expect(
        (await disabled.pluginRuntime.get('comet.project-knowledge'))?.disabledProjects,
      ).toEqual([repositoryId]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('shares an isolated project knowledge cache with CLI plugin bridges', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-default-plugin-host-cache-'));
    const projectRoot = path.join(root, 'project');
    const knowledgeCacheRoot = path.join(root, 'knowledge-cache');
    await fs.mkdir(projectRoot, { recursive: true });
    try {
      const cliBridge = await createDefaultCometPluginBridge({
        projectRoot,
        projectId: 'project-1',
        stateRoot: path.join(root, 'cli-state'),
        memoryRoot: path.join(root, 'cli-memory'),
        knowledgeCacheRoot,
      });
      await cliBridge.pluginRuntime.invoke(
        'comet.project-knowledge',
        'create',
        {
          type: 'constraint',
          title: 'Shared cache rule',
          summary: 'Dashboard and CLI use the same project knowledge records.',
        },
        { scope: 'project', projectId: 'project-1' },
      );

      const host = await createDefaultDashboardPluginHostFactory({
        stateRoot: path.join(root, 'dashboard-state'),
        memoryRoot: path.join(root, 'dashboard-memory'),
        knowledgeCacheRoot,
      })('project-1', projectRoot);

      await expect(host.get('comet.project-knowledge')).resolves.toMatchObject({
        data: {
          records: [expect.objectContaining({ title: 'Shared cache rule' })],
        },
      });

      await host.invoke('comet.project-knowledge', 'create', {
        type: 'procedure',
        title: 'Dashboard cache rule',
        summary: 'CLI retrieval reads project knowledge created in the Dashboard.',
      });
      await expect(
        cliBridge.pluginRuntime.invoke(
          'comet.project-knowledge',
          'list',
          { state: 'all' },
          { scope: 'project', projectId: 'project-1' },
        ),
      ).resolves.toMatchObject({
        records: expect.arrayContaining([
          expect.objectContaining({ title: 'Shared cache rule' }),
          expect.objectContaining({ title: 'Dashboard cache rule' }),
        ]),
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

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
