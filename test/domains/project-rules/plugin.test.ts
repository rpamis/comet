import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryPluginStateStore, PluginRuntime } from '../../../domains/comet-plugin/index.js';
import { createProjectRulesPluginDescriptor } from '../../../domains/project-rules/plugin.js';
import { ProjectRulesService } from '../../../domains/project-rules/project-rules.js';

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
        load: expect.any(Function),
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

  it('exposes project initialization, rule authoring, and candidate actions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-project-rules-plugin-'));
    try {
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ scripts: { test: 'test' } }),
      );
      const service = new ProjectRulesService({
        projectRoot: root,
        projectId: 'project-1',
        runVerification: () => 'ok',
      });
      const descriptor = createProjectRulesPluginDescriptor({
        projectRoot: root,
        projectId: 'project-1',
        createService: () => service,
      });
      const runtime = new PluginRuntime({
        cometVersion: '0.4.0',
        store: new MemoryPluginStateStore(),
        descriptors: [descriptor],
      });
      await runtime.reconcileFirstParty();
      const scope = { scope: 'project' as const, projectId: 'project-1' };

      await expect(runtime.invoke('comet.project-rules', 'init', {}, scope)).resolves.toMatchObject(
        {
          initialized: true,
        },
      );
      await runtime.invoke('comet.project-rules', 'add', { text: '使用项目验证命令' }, scope);
      await runtime.invoke('comet.project-rules', 'scan', {}, scope);
      await expect(
        runtime.invoke('comet.project-rules', 'verify', {}, scope),
      ).resolves.toMatchObject({
        passed: true,
        label: 'npm run test',
      });
      await runtime.invoke(
        'comet.project-rules',
        'observe',
        {
          candidateKey: 'verify-command',
          text: '使用项目验证命令',
          workflow: 'native',
          changeId: 'change-1',
          success: true,
        },
        scope,
      );
      await runtime.invoke(
        'comet.project-rules',
        'observe',
        {
          candidateKey: 'verify-command',
          text: '使用项目验证命令',
          workflow: 'full',
          changeId: 'change-2',
          success: true,
        },
        scope,
      );

      const details = await runtime.invoke('comet.project-rules', 'details', {}, scope);
      const candidate = (details as Array<{ id: string; text: string }>)[0];
      expect(candidate).toMatchObject({ text: '使用项目验证命令' });
      await expect(
        runtime.invoke('comet.project-rules', 'candidates', {}, scope),
      ).resolves.toMatchObject({
        candidates: [{ text: '使用项目验证命令', state: 'pending' }],
        operations: ['adopt', 'ignore', 'snooze', 'restore'],
      });
      await runtime.invoke('comet.project-rules', 'snooze', { id: candidate.id }, scope);
      await expect(
        runtime.invoke('comet.project-rules', 'status', {}, scope),
      ).resolves.toMatchObject({
        candidates: [{ text: '使用项目验证命令', state: 'snoozed' }],
      });
      await runtime.invoke('comet.project-rules', 'restore', { id: candidate.id }, scope);
      await runtime.invoke('comet.project-rules', 'adopt', { id: candidate.id }, scope);
      await expect(
        runtime.invoke('comet.project-rules', 'status', {}, scope),
      ).resolves.toMatchObject({
        candidates: [],
      });
      await expect(fs.readFile(path.join(root, 'AGENTS.md'), 'utf8')).resolves.toContain(
        '使用项目验证命令',
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
