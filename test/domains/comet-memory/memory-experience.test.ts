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
      status: 'active',
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
    await bridge.remember({
      scope: 'project',
      projectKey: 'repo-dashboard',
      category: '偏好',
      text: 'Dashboard 也显示中文记忆',
    });

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
    })) as { management: { records: readonly { text: string }[] }; operations: readonly string[] };

    expect(loaded.management.records.map((entry) => entry.text)).toContain(
      'Dashboard 也显示中文记忆',
    );
    expect(loaded.operations).toContain('manage');
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
