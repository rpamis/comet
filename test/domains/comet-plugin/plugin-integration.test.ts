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
  test('invokes the configured comet-memory Skill runner with a bounded packet', async () => {
    await withBridge(async (bridge) => {
      const calls: unknown[] = [];
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-skill-runner-'));
      try {
        const skillBridge = await createDefaultCometPluginBridge({
          projectRoot: root,
          memoryRoot: path.join(root, 'memory'),
          projectId: 'skill-project',
          stateRoot: path.join(root, 'plugin-state'),
          runMemoryReview: async (packet) => {
            calls.push(packet);
            return {
              schema: 'comet.memory.actions.v1',
              actions: [
                {
                  action: 'skip',
                  language: packet.language,
                  reason:
                    packet.language === 'en' ? 'No reusable preference.' : '没有长期可复用内容',
                },
              ],
            };
          },
        });
        await skillBridge.dispatchLifecycle({
          name: 'task.completed',
          workflow: 'native',
          changeId: 'skill-runner-1',
          success: true,
          category: '工作习惯',
          text: '完成命令检查点',
          userEvidence: ['请帮我修复登录页面样式'],
          candidateKey: 'login',
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
          schema: 'comet.memory.review.v1',
          language: 'zh-CN',
          workflow: 'native',
          changeId: 'skill-runner-1',
        });
        expect((await skillBridge.retrieve({ projectKey: 'skill-project' })).records).toHaveLength(
          0,
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
      expect((await bridge.retrieve({ projectKey: 'demo-project' })).records).toHaveLength(0);
    });
  });

  test('exposes only first activation and conflict notices to the workflow caller', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-notices-'));
    try {
      const notices: string[] = [];
      const bridge = await createDefaultCometPluginBridge({
        projectRoot: root,
        memoryRoot: path.join(root, 'memory'),
        projectId: 'notice-project',
        stateRoot: path.join(root, 'plugin-state'),
        onMemoryReviewNotice: (notice) => notices.push(notice),
      });
      const observation = {
        name: 'change.completed' as const,
        workflow: 'native',
        success: true,
        category: '工作习惯',
        text: '完成命令检查点',
        userEvidence: ['提交前只暂存本次改动文件'],
        candidateKey: 'staging',
      };
      await bridge.dispatchLifecycle({ ...observation, changeId: 'notice-1' });
      await bridge.dispatchLifecycle({ ...observation, changeId: 'notice-2' });
      expect(notices).toHaveLength(0);
      await bridge.retrieve({ task: '暂存改动' });
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('应用');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('treats an unavailable or invalid Skill response as a nonblocking skip', async () => {
    await withBridge(async (bridge) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-skill-failure-'));
      try {
        const failingBridge = await createDefaultCometPluginBridge({
          projectRoot: root,
          memoryRoot: path.join(root, 'memory'),
          projectId: 'skill-failure-project',
          stateRoot: path.join(root, 'plugin-state'),
          runMemoryReview: async () => {
            throw new Error('Skill host unavailable');
          },
        });
        await expect(
          failingBridge.dispatchLifecycle({
            name: 'task.completed',
            workflow: 'native',
            changeId: 'skill-failure-1',
            success: true,
            category: '工作习惯',
            text: '完成命令检查点',
            userEvidence: ['提交前只暂存本次改动文件'],
            candidateKey: 'staging',
          }),
        ).resolves.toBeUndefined();
        expect(
          (await failingBridge.retrieve({ projectKey: 'skill-failure-project' })).records,
        ).toHaveLength(0);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
      expect((await bridge.retrieve({ projectKey: 'demo-project' })).records).toHaveLength(0);
    });
  });

  test('bridges bounded user evidence and supports an optional nonblocking host adapter', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-background-'));
    const memoryRoot = path.join(root, 'memory');
    const projectRoot = path.join(root, 'project');
    let backgroundTask: (() => Promise<void>) | undefined;
    await fs.mkdir(projectRoot, { recursive: true });
    try {
      const bridge = await createDefaultCometPluginBridge({
        projectRoot,
        memoryRoot,
        projectId: 'demo-project',
        stateRoot: path.join(root, 'plugin-state'),
        runMemoryReviewInBackground: (task) => {
          backgroundTask = task;
        },
      });
      await bridge.dispatchLifecycle({
        name: 'change.completed',
        workflow: 'native',
        changeId: 'background-1',
        success: true,
        category: '工作习惯',
        text: '完成命令检查点',
        userEvidence: ['提交前只暂存本次改动文件'],
        candidateKey: 'staging',
      });

      expect(backgroundTask).toBeTypeOf('function');
      expect((await bridge.retrieve({ task: '暂存改动' })).records).toHaveLength(0);
      await backgroundTask?.();
      expect((await bridge.retrieve({ task: '暂存改动' })).records).toHaveLength(0);
      await bridge.dispatchLifecycle({
        name: 'change.completed',
        workflow: 'native',
        changeId: 'background-2',
        success: true,
        category: '工作习惯',
        text: '完成命令检查点',
        userEvidence: ['提交前只暂存本次改动文件'],
        candidateKey: 'staging',
      });
      await backgroundTask?.();
      expect((await bridge.retrieve({ task: '暂存改动' })).records).toHaveLength(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('collects personal memory context through the public runtime', async () => {
    await withBridge(async (bridge) => {
      await bridge.remember({
        scope: 'global',
        category: '沟通偏好',
        text: '使用中文回复',
      });
      const contributions = await bridge.collectContext({
        task: '使用中文回复',
        path: 'src/server.ts',
      });

      expect(contributions.map((entry) => entry.pluginId)).toEqual(['comet.personal-memory']);
      expect(contributions[0]?.text).toEqual(expect.stringContaining('使用中文回复'));
    });
  });

  test('keeps lifecycle memory in the project scope with candidate and configured language', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-lifecycle-'));
    const memoryRoot = path.join(root, 'memory');
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot, { recursive: true });
    try {
      const bridge = await createDefaultCometPluginBridge({
        projectRoot,
        memoryRoot,
        projectId: 'demo-project',
        language: 'zh-CN',
        stateRoot: path.join(root, 'plugin-state'),
      });
      const observation = {
        name: 'change.completed' as const,
        workflow: 'hotfix',
        changeId: 'change-scope-language',
        success: true,
        category: '操作习惯',
        text: '提交前只暂存本次改动文件',
        candidateKey: 'stage-scope',
      };
      await bridge.dispatchLifecycle(observation);
      await bridge.dispatchLifecycle({ ...observation, changeId: 'change-scope-language-2' });

      const state = JSON.parse(
        await fs.readFile(path.join(memoryRoot, '.comet', 'runtime', 'memory-state.json'), 'utf8'),
      ) as {
        observations: Array<Record<string, unknown>>;
      };
      expect(state.observations).toEqual([
        expect.objectContaining({
          scope: 'project',
          projectKey: 'demo-project',
          candidateKey: 'stage-scope',
        }),
        expect.objectContaining({
          scope: 'project',
          projectKey: 'demo-project',
          candidateKey: 'stage-scope',
        }),
      ]);
      await expect(fs.stat(path.join(memoryRoot, 'profile.md'))).rejects.toThrow();
      expect((await bridge.retrieve({ scope: 'global', task: '提交' })).records).toHaveLength(0);
      expect((await bridge.retrieve({ scope: 'project', task: '提交' })).records).toHaveLength(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('resolves lifecycle language from the active project configuration', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-language-'));
    const memoryRoot = path.join(root, 'memory');
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'native:',
        '  artifact_root: docs',
        '  language: en',
        '',
      ].join('\n'),
      'utf8',
    );
    try {
      const bridge = await createDefaultCometPluginBridge({
        projectRoot,
        memoryRoot,
        projectId: 'english-project',
        stateRoot: path.join(root, 'plugin-state'),
      });
      for (const changeId of ['language-1', 'language-2']) {
        await bridge.dispatchLifecycle({
          name: 'verification.completed',
          workflow: 'native',
          changeId,
          success: true,
          category: 'Workflow habit',
          text: 'Run tests before commit',
          candidateKey: 'verify-before-commit',
        });
      }
      const records = (await bridge.retrieve({ scope: 'project', task: 'tests commit' })).records;
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        language: 'en',
        scope: 'project',
        projectKey: 'english-project',
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
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

  test('routes lifecycle checkpoints through semantic review and keeps command summaries out', async () => {
    await withBridge(async (bridge) => {
      for (const changeId of ['checkpoint-noise-1', 'checkpoint-noise-2']) {
        await bridge.dispatchLifecycle({
          name: 'task.completed',
          workflow: 'native',
          changeId,
          success: true,
          category: '工作流检查点',
          text: '完成命令检查点',
          candidateKey: 'native:build',
          operations: ['build'],
        });
      }

      expect((await bridge.retrieve({ projectKey: 'demo-project' })).records).toHaveLength(0);
      expect((await bridge.manage({ projectKey: 'demo-project' })).records).toHaveLength(0);
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
});
