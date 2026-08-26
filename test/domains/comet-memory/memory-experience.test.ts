import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { PersonalMemoryService } from '../../../domains/comet-memory/index.js';
import { FileMemoryRepository } from '../../../domains/comet-memory/repository.js';

describe('personal memory experience projection', () => {
  it('returns a user-safe management view with evidence and conflict status', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-memory-experience-'));
    const service = new PersonalMemoryService({
      repository: new FileMemoryRepository(root),
      now: () => new Date('2026-08-17T00:00:00.000Z'),
    });

    const record = await service.remember({
      scope: 'project',
      projectKey: 'repo-a',
      category: '偏好',
      text: '使用中文回复',
      source: { kind: 'user' },
    });
    const view = await service.manage({ projectKey: 'repo-a' });

    expect(view.records).toHaveLength(1);
    expect(view.records[0]).toMatchObject({
      id: record.id,
      text: '使用中文回复',
      status: 'proven',
      evidenceCount: 0,
      sourceKind: 'user',
      canRollback: false,
    });
    expect(view.records[0]).not.toHaveProperty('source.changeId');
    expect(view).toHaveProperty('conflicts');
  });

  it('provides explicit correction, forget, and rollback commands with short confirmations', async () => {
    const commands = await import('../../../app/commands/personal-memory.js');
    expect(commands.personalMemoryCorrectCommand).toBeTypeOf('function');
    expect(commands.personalMemoryForgetCommand).toBeTypeOf('function');
    expect(commands.personalMemoryRollbackCommand).toBeTypeOf('function');

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-memory-experience-cli-'));
    const memoryRoot = path.join(root, 'memory');
    const stateRoot = path.join(root, 'plugins');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) =>
      logs.push(String(message ?? '')),
    );

    const record = await commands.personalMemoryRememberCommand(root, {
      memoryRoot,
      stateRoot,
      category: '偏好',
      scope: 'project',
      text: '使用中文回复',
      json: true,
    });
    await commands.personalMemoryCorrectCommand(root, {
      memoryRoot,
      stateRoot,
      id: (record as { id: string }).id,
      text: '使用简洁中文回复',
    });
    await commands.personalMemoryForgetCommand(root, {
      memoryRoot,
      stateRoot,
      id: (record as { id: string }).id,
    });
    await commands.personalMemoryRollbackCommand(root, {
      memoryRoot,
      stateRoot,
      id: (record as { id: string }).id,
    });

    expect(logs.some((line) => line.includes('已'))).toBe(true);
  });

  it('exposes the same management view through the public Dashboard plugin page', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-memory-experience-dashboard-'));
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot, { recursive: true });
    const { createDefaultCometPluginBridge } =
      await import('../../../domains/comet-plugin/integration.js');
    const bridge = await createDefaultCometPluginBridge({
      projectRoot,
      projectId: 'repo-dashboard',
      memoryRoot: path.join(root, 'memory'),
      stateRoot: path.join(root, 'plugins'),
    });
    const remembered = await bridge.remember({
      scope: 'project',
      projectKey: 'repo-dashboard',
      category: '偏好',
      text: 'Dashboard 也显示中文记忆',
    });
    await bridge.collectContext({ task: 'Dashboard 也显示中文记忆' });
    await bridge.collectContext({ task: '再次应用 Dashboard 中文记忆' });

    const pages = await bridge.pluginRuntime.dashboardPages({
      scope: 'project',
      projectId: bridge.currentProjectId,
    });
    const page = pages.find((entry) => entry.pluginId === 'comet.personal-memory');
    expect(page?.load).toBeTypeOf('function');
    const loaded = (await page?.load?.({
      projectId: bridge.currentProjectId,
      invoke: (capability, input) =>
        bridge.pluginRuntime.invoke('comet.personal-memory', capability, input, {
          scope: 'project',
          projectId: bridge.currentProjectId,
        }),
    })) as {
      management: {
        records: readonly {
          id: string;
          text: string;
          lastApplication?: { whyApplied: string; delivery: string };
          applicationHistory?: readonly { applicationId: string; task: string }[];
        }[];
      };
      manifestPreview: readonly {
        id: string;
        whyApplied: string;
        delivery: string;
        appliedAt: string;
      }[];
      operations: readonly string[];
    };

    expect(loaded.management.records.map((entry) => entry.text)).toContain(
      'Dashboard 也显示中文记忆',
    );
    expect(loaded.management.records.find((entry) => entry.id === remembered!.id)).toMatchObject({
      lastApplication: {
        whyApplied: expect.stringContaining('用户明确要求'),
        delivery: 'full',
      },
      applicationHistory: [
        expect.objectContaining({ task: '再次应用 Dashboard 中文记忆' }),
        expect.objectContaining({ task: 'Dashboard 也显示中文记忆' }),
      ],
    });
    expect(loaded.manifestPreview).toEqual([
      expect.objectContaining({
        id: remembered!.id,
        whyApplied: expect.stringContaining('用户明确要求'),
        delivery: 'full',
        appliedAt: expect.any(String),
      }),
    ]);
    expect(loaded.operations).toContain('manage');
  });

  it('does not report Dashboard page retrieval as a task memory application', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-memory-dashboard-notice-'));
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot, { recursive: true });
    const { createDefaultCometPluginBridge } =
      await import('../../../domains/comet-plugin/integration.js');
    const bridge = await createDefaultCometPluginBridge({
      projectRoot,
      projectId: 'repo-dashboard-notice',
      memoryRoot: path.join(root, 'memory'),
      stateRoot: path.join(root, 'plugins'),
    });
    await bridge.pluginRuntime.invoke(
      'comet.personal-memory',
      'remember',
      {
        scope: 'project',
        projectKey: 'repo-dashboard-notice',
        category: '偏好',
        text: '新增后尚未参与任务的记忆',
      },
      { scope: 'project', projectId: bridge.currentProjectId },
    );

    const page = (
      await bridge.pluginRuntime.dashboardPages({
        scope: 'project',
        projectId: bridge.currentProjectId,
      })
    ).find((entry) => entry.pluginId === 'comet.personal-memory');
    const loadPage = async () =>
      (await page?.load?.({
        projectId: bridge.currentProjectId,
        invoke: (capability, input) =>
          bridge.pluginRuntime.invoke('comet.personal-memory', capability, input, {
            scope: 'project',
            projectId: bridge.currentProjectId,
          }),
      })) as { notifications: readonly string[] };

    const loaded = await loadPage();

    expect(loaded.notifications).toEqual(['个人记忆已保存。']);

    await bridge.pluginRuntime.invoke(
      'comet.personal-memory',
      'retrieve',
      { view: 'combined', projectKey: bridge.currentProjectId },
      { scope: 'project', projectId: bridge.currentProjectId },
    );
    expect((await loadPage()).notifications).toEqual(['这次任务已应用一条已保存的协作偏好。']);
  });

  it('does not project a permanently deleted memory into the Dashboard manifest', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-memory-dashboard-delete-'));
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot, { recursive: true });
    const { createDefaultCometPluginBridge } =
      await import('../../../domains/comet-plugin/integration.js');
    const bridge = await createDefaultCometPluginBridge({
      projectRoot,
      projectId: 'repo-dashboard-delete',
      memoryRoot: path.join(root, 'memory'),
      stateRoot: path.join(root, 'plugins'),
    });
    const remembered = await bridge.remember({
      scope: 'project',
      projectKey: 'repo-dashboard-delete',
      category: '偏好',
      text: '删除后不应继续显示',
    });
    await bridge.collectContext({ task: '删除后不应继续显示' });

    const loadPage = async () => {
      const page = (
        await bridge.pluginRuntime.dashboardPages({
          scope: 'project',
          projectId: bridge.currentProjectId,
        })
      ).find((entry) => entry.pluginId === 'comet.personal-memory');
      return page?.load?.({
        projectId: bridge.currentProjectId,
        invoke: (capability, input) =>
          bridge.pluginRuntime.invoke('comet.personal-memory', capability, input, {
            scope: 'project',
            projectId: bridge.currentProjectId,
          }),
      });
    };

    const beforeDelete = (await loadPage()) as {
      manifestPreview: readonly { id: string }[];
    };
    expect(beforeDelete.manifestPreview).toEqual([expect.objectContaining({ id: remembered!.id })]);

    await bridge.pluginRuntime.invoke(
      'comet.personal-memory',
      'remove',
      { id: remembered!.id, permanent: true },
      { scope: 'project', projectId: bridge.currentProjectId },
    );

    const afterDelete = (await loadPage()) as {
      management: { records: readonly { id: string }[] };
      manifestPreview: readonly { id: string }[];
    };
    expect(afterDelete.management.records).toEqual([]);
    expect(afterDelete.manifestPreview).toEqual([]);
  });

  it('shows global memory application history across projects without leaking project history', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-memory-global-history-'));
    const memoryRoot = path.join(root, 'memory');
    const stateRoot = path.join(root, 'plugins');
    const projectA = path.join(root, 'project-a');
    const projectB = path.join(root, 'project-b');
    await Promise.all([
      fs.mkdir(projectA, { recursive: true }),
      fs.mkdir(projectB, { recursive: true }),
    ]);
    try {
      const { createDefaultCometPluginBridge } =
        await import('../../../domains/comet-plugin/integration.js');
      const bridgeA = await createDefaultCometPluginBridge({
        projectRoot: projectA,
        projectId: 'project-a',
        memoryRoot,
        stateRoot,
      });
      const global = await bridgeA.remember({
        scope: 'global',
        category: '沟通偏好',
        text: '所有项目都使用中文',
      });
      const projectOnly = await bridgeA.remember({
        scope: 'project',
        category: '协作偏好',
        text: '只属于项目 A',
      });
      await bridgeA.collectContext({
        task: '项目 A：所有项目都使用中文',
        sessionId: 'project-a-session',
      });

      const bridgeB = await createDefaultCometPluginBridge({
        projectRoot: projectB,
        projectId: 'project-b',
        memoryRoot,
        stateRoot,
      });
      await bridgeB.collectContext({
        task: '项目 B：所有项目都使用中文',
        sessionId: 'project-b-session',
      });
      const page = (
        await bridgeB.pluginRuntime.dashboardPages({ scope: 'project', projectId: 'project-b' })
      ).find((entry) => entry.pluginId === 'comet.personal-memory');
      const loaded = (await page?.load?.({
        projectId: 'project-b',
        invoke: (capability, input) =>
          bridgeB.pluginRuntime.invoke('comet.personal-memory', capability, input, {
            scope: 'project',
            projectId: 'project-b',
          }),
      })) as {
        management: {
          records: readonly {
            id: string;
            applicationHistory?: readonly { task: string; projectId?: string }[];
          }[];
        };
      };

      expect(
        loaded.management.records.find((record) => record.id === global!.id)?.applicationHistory,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ task: '项目 A：所有项目都使用中文' }),
          expect.objectContaining({ task: '项目 B：所有项目都使用中文' }),
        ]),
      );
      expect(
        loaded.management.records.find((record) => record.id === global!.id)?.applicationHistory,
      ).toHaveLength(2);
      expect(loaded.management.records.map((record) => record.id)).not.toContain(projectOnly!.id);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('repairs legacy global records with a project key before explicit Dashboard actions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-memory-experience-legacy-global-'));
    const memoryRoot = path.join(root, 'memory');
    const repository = new FileMemoryRepository(memoryRoot);
    const legacyService = new PersonalMemoryService({ repository });
    const legacy = await legacyService.remember({
      scope: 'global',
      category: '沟通偏好',
      text: '旧版记录',
    });
    const state = await repository.readState();
    await repository.writeState({
      ...state,
      records: state.records.map((record) => ({ ...record, projectKey: 'legacy-project' })),
    });
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot, { recursive: true });

    const { createDefaultCometPluginBridge } =
      await import('../../../domains/comet-plugin/integration.js');
    const bridge = await createDefaultCometPluginBridge({
      projectRoot,
      projectId: 'legacy-global-project',
      memoryRoot,
      stateRoot: path.join(root, 'plugins'),
    });

    await expect(
      bridge.pluginRuntime.invoke(
        'comet.personal-memory',
        'remember',
        {
          scope: 'global',
          category: '新增偏好',
          text: '新版本记录',
        },
        { scope: 'project', projectId: 'legacy-global-project' },
        { throwOnError: true },
      ),
    ).resolves.toMatchObject({ text: '新版本记录', scope: 'global' });

    await expect(
      bridge.pluginRuntime.invoke(
        'comet.personal-memory',
        'correct',
        { id: legacy.id, correction: { text: '修复后的记录' } },
        { scope: 'project', projectId: 'legacy-global-project' },
        { throwOnError: true },
      ),
    ).resolves.toMatchObject({ text: '修复后的记录', scope: 'global' });

    const repaired = await repository.readState();
    expect(repaired.records[0]).not.toHaveProperty('projectKey');
  });

  it('projects the project memory policy to the Dashboard page', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-memory-experience-policy-'));
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'memory:',
        '  learning: false',
        '  retrieval: true',
        'native:',
        '  artifact_root: docs',
        '',
      ].join('\n'),
      'utf8',
    );
    try {
      const { createDefaultCometPluginBridge } =
        await import('../../../domains/comet-plugin/integration.js');
      const bridge = await createDefaultCometPluginBridge({
        projectRoot,
        projectId: 'policy-dashboard-project',
        memoryRoot: path.join(root, 'memory'),
        stateRoot: path.join(root, 'plugins'),
      });
      const page = (
        await bridge.pluginRuntime.dashboardPages({
          scope: 'project',
          projectId: bridge.currentProjectId,
        })
      ).find((entry) => entry.pluginId === 'comet.personal-memory');
      const loaded = (await page?.load?.({
        projectId: bridge.currentProjectId,
        invoke: (capability, input) =>
          bridge.pluginRuntime.invoke('comet.personal-memory', capability, input, {
            scope: 'project',
            projectId: bridge.currentProjectId,
          }),
      })) as { policy: { learning: boolean; retrieval: boolean } };

      expect(loaded.policy).toEqual({ learning: false, retrieval: true });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('uses the project config language for confirmations without translating direct text', async () => {
    vi.restoreAllMocks();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-memory-experience-language-'));
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: native\nworkflows:\n  - native\nnative:\n  artifact_root: docs\n  language: en\n',
      'utf8',
    );
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) =>
      logs.push(String(message ?? '')),
    );
    const commands = await import('../../../app/commands/personal-memory.js');
    const record = await commands.personalMemoryRememberCommand(root, {
      memoryRoot: path.join(root, 'memory'),
      stateRoot: path.join(root, 'plugins'),
      text: '使用中文回复',
    });

    expect((record as { text: string }).text).toBe('使用中文回复');
    expect(logs).toContain('Memory saved: 使用中文回复');
    expect(logs.some((line) => line.includes('已记录'))).toBe(false);
  });

  it('forwards the complete bounded retrieval query from the CLI', async () => {
    vi.restoreAllMocks();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-memory-experience-retrieve-'));
    const memoryRoot = path.join(root, 'memory');
    const stateRoot = path.join(root, 'plugins');
    const { createDefaultCometPluginBridge } =
      await import('../../../domains/comet-plugin/integration.js');
    const { resolveStableProjectId } = await import('../../../platform/paths/project-identity.js');
    const projectKey = resolveStableProjectId(root);
    const bridge = await createDefaultCometPluginBridge({
      projectRoot: root,
      projectId: projectKey,
      memoryRoot,
      stateRoot,
    });
    await bridge.remember({
      scope: 'project',
      projectKey,
      category: '构建',
      text: '使用 pnpm 构建',
      tags: ['构建工具'],
      operations: ['build'],
    });
    await bridge.remember({
      scope: 'project',
      projectKey,
      category: '沟通',
      text: '使用中文说明',
      tags: ['语言'],
      operations: ['document'],
    });
    const commands = await import('../../../app/commands/personal-memory.js');
    const result = (await commands.personalMemoryRetrieveCommand(root, {
      memoryRoot,
      stateRoot,
      scope: 'project',
      category: '构建',
      tags: ['构建工具'],
      operation: 'build',
      maxEntries: 1,
      maxBytes: 4096,
      json: true,
    })) as { records: readonly { text: string }[]; truncated: boolean };

    expect(result.records.map((entry) => entry.text)).toEqual(['使用 pnpm 构建']);
    expect(result.truncated).toBe(false);
  });

  it('uses default_workflow for Markdown headings and confirmations', async () => {
    vi.restoreAllMocks();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-memory-experience-workflow-lang-'));
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows:\n  - native\n  - classic\nnative:\n  artifact_root: docs\n  language: zh-CN\nclassic:\n  artifact_layout: docs\n  language: en\n',
      'utf8',
    );
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) =>
      logs.push(String(message ?? '')),
    );
    const commands = await import('../../../app/commands/personal-memory.js');
    await commands.personalMemoryRememberCommand(root, {
      memoryRoot: path.join(root, 'memory'),
      stateRoot: path.join(root, 'plugins'),
      scope: 'global',
      category: 'Preference',
      text: '保留用户原文',
    });

    expect(logs).toContain('Memory saved: 保留用户原文');
    await expect(fs.readFile(path.join(root, 'memory', 'profile.md'), 'utf8')).resolves.toContain(
      '# Personal Profile',
    );
    const { createDefaultCometPluginBridge } =
      await import('../../../domains/comet-plugin/integration.js');
    const bridge = await createDefaultCometPluginBridge({
      projectRoot: root,
      projectId: 'workflow-language-project',
      memoryRoot: path.join(root, 'memory'),
      stateRoot: path.join(root, 'plugins'),
    });
    const pages = await bridge.pluginRuntime.dashboardPages('user');
    expect(pages.find((page) => page.pluginId === 'comet.personal-memory')?.label).toBe(
      'Personal Memory',
    );
  });

  it('keeps pause and sync confirmations short and localized', async () => {
    vi.restoreAllMocks();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-memory-experience-feedback-'));
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) =>
      logs.push(String(message ?? '')),
    );
    const commands = await import('../../../app/commands/personal-memory.js');
    const options = {
      memoryRoot: path.join(root, 'memory'),
      stateRoot: path.join(root, 'plugins'),
      language: 'en' as const,
    };
    await commands.personalMemoryPauseCommand(root, options);
    await commands.personalMemorySyncCommand(root, options);

    expect(logs).toContain('Personal memory paused.');
    expect(logs).toContain('Local memory is available; no remote is configured.');
    expect(logs.every((line) => !line.startsWith('{'))).toBe(true);
  });

  it('bounds conflict projections without exposing internal record ids', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-memory-experience-conflict-'));
    const service = new PersonalMemoryService({ repository: new FileMemoryRepository(root) });
    const base = {
      scope: 'project' as const,
      projectKey: 'repo-conflict',
      category: '构建',
      language: 'zh-CN' as const,
      workflow: 'native',
      success: true,
    };
    await service.observe({ ...base, text: '使用 pnpm build', changeId: 'change-a' });
    await service.observe({ ...base, text: '使用 npm run build', changeId: 'change-b' });

    const view = await service.manage({ projectKey: 'repo-conflict', maxEntries: 10 });
    expect(view.conflicts[0]).toMatchObject({
      texts: ['使用 npm run build', '使用 pnpm build'],
    });
    expect(view.conflicts[0]).not.toHaveProperty('recordIds');

    const bounded = await service.manage({ projectKey: 'repo-conflict', maxEntries: 1 });
    expect(bounded.records.length + bounded.conflicts.length).toBeLessThanOrEqual(1);
    expect(bounded.truncated).toBe(true);
  });
});
