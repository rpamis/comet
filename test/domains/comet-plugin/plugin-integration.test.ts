import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';
import {
  createDefaultCometPluginBridge,
  type CometPluginBridge,
} from '../../../domains/comet-plugin/integration.js';

async function withBridge(
  callback: (bridge: CometPluginBridge, projectRoot: string) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-bridge-'));
  const memoryRoot = path.join(root, 'memory');
  const projectRoot = path.join(root, 'project');
  await fs.mkdir(projectRoot, { recursive: true });
  const bridge = await createDefaultCometPluginBridge({
    projectRoot,
    memoryRoot,
    projectId: 'demo-project',
    stateRoot: path.join(root, 'plugin-state'),
    cometVersion: '0.4.0-test',
  });
  try {
    await callback(bridge, projectRoot);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe('Comet plugin integration bridge', () => {
  test('collects global and project context through the public runtime', async () => {
    await withBridge(async (bridge) => {
      await bridge.remember({
        scope: 'global',
        category: '沟通偏好',
        text: '使用中文回复',
      });
      await bridge.addRule('服务端改动必须运行测试', '.comet/rules/backend.md');

      const contributions = await bridge.collectContext({
        task: '服务端改动必须运行测试',
        path: 'src/server.ts',
      });

      expect(contributions.map((entry) => entry.pluginId)).toEqual([
        'comet.personal-memory',
        'comet.project-rules',
      ]);
      expect(contributions.map((entry) => entry.text)).toEqual([
        expect.stringContaining('使用中文回复'),
        expect.stringContaining('服务端改动必须运行测试'),
      ]);
    });
  });

  test('dispatches one lifecycle observation to both independent plugins', async () => {
    await withBridge(async (bridge) => {
      await bridge.dispatchLifecycle({
        name: 'change.completed',
        workflow: 'native',
        changeId: 'change-1',
        success: true,
        category: '操作习惯',
        text: '只提交本次改动文件',
        ruleText: '只提交本次改动文件',
        candidateKey: 'stage-scope',
      });

      const memory = await bridge.retrieve({ task: '提交改动' });
      const rules = await bridge.projectRulesStatus();
      expect(memory.records).toHaveLength(0);
      expect(rules.candidates).toEqual([]);

      await bridge.dispatchLifecycle({
        name: 'change.completed',
        workflow: 'native',
        changeId: 'change-2',
        success: true,
        category: '操作习惯',
        text: '只提交本次改动文件',
        ruleText: '只提交本次改动文件',
        candidateKey: 'stage-scope',
      });

      expect((await bridge.retrieve({ task: '提交改动' })).records).toHaveLength(1);
      expect((await bridge.projectRulesStatus()).candidates).toEqual([
        { text: '只提交本次改动文件', state: 'pending' },
      ]);
    });
  });

  test('checkpoints personal memory after a workflow observation', async () => {
    await withBridge(async (bridge) => {
      const sync = vi.spyOn(bridge, 'syncMemory').mockResolvedValue({
        status: 'local-only',
        retryable: false,
        message: 'No memory Git remote is configured',
      });

      await bridge.dispatchLifecycle({
        name: 'change.completed',
        workflow: 'native',
        changeId: 'change-checkpoint',
        success: true,
        category: 'checkpoint',
        text: 'workflow completed',
      });

      expect(sync).toHaveBeenCalledOnce();
    });
  });

  test('consumes verification and review lifecycle events as memory observations', async () => {
    await withBridge(async (bridge) => {
      for (const [name, changeId] of [
        ['verification.completed', 'verify-1'],
        ['review.completed', 'review-1'],
      ] as const) {
        await bridge.dispatchLifecycle({
          name,
          workflow: 'native',
          changeId,
          success: true,
          category: '工作方式',
          text: '验证后再提交',
          candidateKey: 'verify-before-submit',
        });
      }
      expect((await bridge.retrieve({ task: '验证 提交' })).records).toHaveLength(1);
    });
  });

  test('lets the host repair a failed project check before rerunning it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-repair-'));
    const memoryRoot = path.join(root, 'memory');
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ scripts: { test: 'host-check' } }),
    );
    try {
      let executions = 0;
      const bridge = await createDefaultCometPluginBridge({
        projectRoot,
        memoryRoot,
        projectId: 'repair-project',
        stateRoot: path.join(root, 'plugin-state'),
        runProjectRuleVerification: () => {
          executions += 1;
          if (executions === 1) throw new Error('check failed');
          return 'ok';
        },
        repairProjectRules: async () => {
          return true;
        },
      });
      const result = await bridge.projectRulesAction('verify', { maxAttempts: 2 });
      expect(result).toMatchObject({ passed: true, attempts: 2, nextAction: 'complete' });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('passes project rule carrier adapters through the public bridge', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-carrier-'));
    const memoryRoot = path.join(root, 'memory');
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ scripts: { lint: 'eslint .' } }),
    );
    try {
      const bridge = await createDefaultCometPluginBridge({
        projectRoot,
        memoryRoot,
        projectId: 'carrier-project',
        stateRoot: path.join(root, 'plugin-state'),
        projectRuleCarrierAdapters: [
          {
            id: 'eslint-config',
            supports: (entrypoint) => entrypoint.id === 'package-lint',
            apply: async ({ candidate, writeText }) => {
              await writeText('.eslintrc.comet.json', JSON.stringify({ rule: candidate.text }));
              return {
                targetPath: '.eslintrc.comet.json',
                change: '已将规则写入 ESLint 项目配置。',
              };
            },
          },
        ],
      });
      for (const changeId of ['carrier-1', 'carrier-2']) {
        await bridge.dispatchLifecycle({
          name: 'task.completed',
          workflow: 'native',
          changeId,
          success: true,
          category: 'project-rule',
          text: '禁止跨层直接访问文件系统。',
          ruleText: '禁止跨层直接访问文件系统。',
          candidateKey: 'native-lint-adapter',
        });
      }
      const details = (await bridge.projectRulesAction('details')) as Array<{ id: string }>;
      await bridge.projectRulesAction('adopt', { id: details[0].id });
      await expect(
        fs.readFile(path.join(projectRoot, '.eslintrc.comet.json'), 'utf8'),
      ).resolves.toContain('禁止跨层直接访问文件系统');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
