import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  personalMemoryContextCommand,
  personalMemoryObserveCommand,
  personalMemoryRememberCommand,
  personalMemoryRetrieveCommand,
  personalMemoryStatusCommand,
} from '../../app/commands/personal-memory.js';

describe('personal memory commands', () => {
  const roots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('uses the shared bridge for explicit memory, retrieval, context, and status', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'comet-memory-cli-'));
    roots.push(root);
    const memoryRoot = path.join(root, 'memory');
    const stateRoot = path.join(root, 'plugins');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) =>
      logs.push(String(message ?? '')),
    );

    await personalMemoryRememberCommand(root, {
      memoryRoot,
      stateRoot,
      category: 'preference',
      scope: 'project',
      text: '使用简洁的中文说明',
      json: true,
    });
    const retrieved = (await personalMemoryRetrieveCommand(root, {
      memoryRoot,
      stateRoot,
      task: '写文档',
      json: true,
    })) as { records: readonly { text: string }[] };
    expect(retrieved.records.map((record) => record.text)).toContain('使用简洁的中文说明');
    expect(retrieved).toHaveProperty('profileText');

    const context = (await personalMemoryContextCommand(root, {
      memoryRoot,
      stateRoot,
      task: '写文档',
      phase: 'verify',
      json: true,
    })) as readonly { pluginId: string }[];
    expect(context.map((entry) => entry.pluginId)).toContain('comet.personal-memory');

    const status = (await personalMemoryStatusCommand(root, {
      memoryRoot,
      stateRoot,
      json: true,
    })) as { learningEnabled: boolean };
    expect(status.learningEnabled).toBe(true);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('records workflow observations through the bridge', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'comet-memory-observe-cli-'));
    roots.push(root);
    const options = {
      memoryRoot: path.join(root, 'memory'),
      stateRoot: path.join(root, 'plugins'),
      text: '完成后运行项目验证命令',
      category: 'habit',
      workflow: 'native',
      candidateKey: 'verification-command',
      change: 'change-a',
    };
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await personalMemoryObserveCommand(root, { ...options, json: true });
    const status = await personalMemoryObserveCommand(root, {
      ...options,
      change: 'change-b',
      json: true,
    });
    expect(status).toMatchObject({ learningEnabled: true });
  });

  it('uses a Chinese default category while preserving direct user text', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'comet-memory-default-category-'));
    roots.push(root);
    const memoryRoot = path.join(root, 'memory');
    const stateRoot = path.join(root, 'plugins');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await personalMemoryRememberCommand(root, {
      memoryRoot,
      stateRoot,
      scope: 'global',
      text: 'Keep the user supplied wording',
      json: true,
    });

    const { createDefaultCometPluginBridge } =
      await import('../../domains/comet-plugin/integration.js');
    const bridge = await createDefaultCometPluginBridge({
      projectRoot: root,
      projectId: 'default-category-project',
      memoryRoot,
      stateRoot,
    });
    expect(await bridge.manage({ scope: 'global' })).toMatchObject({
      records: [
        expect.objectContaining({ category: '可复用偏好', text: 'Keep the user supplied wording' }),
      ],
    });
  });
});
