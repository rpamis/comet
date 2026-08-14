import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';
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
});
