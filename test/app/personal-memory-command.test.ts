import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  personalMemoryContextCommand,
  personalMemoryCorrectCommand,
  personalMemoryForgetCommand,
  personalMemoryManageCommand,
  personalMemoryObserveCommand,
  personalMemoryPauseCommand,
  personalMemoryRemoteCommand,
  personalMemoryRememberCommand,
  personalMemoryRetrieveCommand,
  personalMemoryStatusCommand,
  personalMemoryRollbackCommand,
  personalMemorySyncCommand,
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
    expect(context.map((entry) => entry.pluginId)).toContain('comet.context-director');

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
      category: '工作习惯',
      workflow: 'native',
      candidateKey: 'verification-command',
      change: 'change-a',
    };
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await personalMemoryObserveCommand(root, { ...options, json: true });
    await personalMemoryObserveCommand(root, {
      ...options,
      change: 'change-b',
      json: true,
    });
    const retrieved = (await personalMemoryRetrieveCommand(root, {
      memoryRoot: options.memoryRoot,
      stateRoot: options.stateRoot,
      task: '运行项目验证命令',
      json: true,
    })) as { records: readonly { text: string; state: string }[] };
    expect(retrieved.records).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: options.text, state: 'proven' })]),
    );
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

  it('supports memory management, lifecycle, sync, and pause controls', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'comet-memory-management-cli-'));
    roots.push(root);
    const memoryRoot = path.join(root, 'memory');
    const stateRoot = path.join(root, 'plugins');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) =>
      logs.push(String(message ?? '')),
    );

    const record = (await personalMemoryRememberCommand(root, {
      memoryRoot,
      stateRoot,
      text: '使用简洁输出',
      category: '偏好',
      json: true,
    })) as { id: string };

    const managed = (await personalMemoryManageCommand(root, {
      memoryRoot,
      stateRoot,
      language: 'en',
    })) as { records: readonly { text: string }[] };
    expect(managed.records).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: '使用简洁输出' })]),
    );
    await personalMemoryRetrieveCommand(root, {
      memoryRoot,
      stateRoot,
      language: 'en',
      task: '使用简洁输出',
    });

    await personalMemoryCorrectCommand(root, {
      memoryRoot,
      stateRoot,
      language: 'en',
      id: record.id,
      text: '使用简洁解释',
      json: true,
    });
    await personalMemoryForgetCommand(root, {
      memoryRoot,
      stateRoot,
      language: 'en',
      id: record.id,
      json: true,
    });
    await personalMemoryRollbackCommand(root, {
      memoryRoot,
      stateRoot,
      language: 'en',
      id: record.id,
      json: true,
    });
    await personalMemoryPauseCommand(root, {
      memoryRoot,
      stateRoot,
      learning: true,
      language: 'en',
      json: true,
    });
    await personalMemoryPauseCommand(root, {
      memoryRoot,
      stateRoot,
      resume: true,
      language: 'en',
      json: true,
    });

    const remote = await personalMemoryRemoteCommand(root, {
      memoryRoot,
      stateRoot,
      language: 'en',
      set: 'https://example.invalid/comet-memory.git',
      json: true,
    });
    expect(remote).toBeDefined();
    const sync = await personalMemorySyncCommand(root, {
      memoryRoot,
      stateRoot,
      language: 'en',
    });
    expect(sync).toBeDefined();
    expect(logs.length).toBeGreaterThan(0);
  });

  it('prints empty and paused retrieval states and validates command input', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'comet-memory-retrieval-cli-'));
    roots.push(root);
    const memoryRoot = path.join(root, 'memory');
    const stateRoot = path.join(root, 'plugins');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) =>
      logs.push(String(message ?? '')),
    );

    await personalMemoryManageCommand(root, {
      memoryRoot,
      stateRoot,
      language: 'en',
    });
    expect(logs).toContain('No matching personal memories.');

    await personalMemoryRetrieveCommand(root, {
      memoryRoot,
      stateRoot,
      language: 'en',
      task: 'find a missing memory',
      maxEntries: '2',
      maxBytes: 'not-a-number',
    });
    expect(logs).toContain('No matching personal memory.');

    await personalMemoryPauseCommand(root, {
      memoryRoot,
      stateRoot,
      learning: true,
      retrieval: true,
      language: 'en',
      json: true,
    });
    await personalMemoryRetrieveCommand(root, {
      memoryRoot,
      stateRoot,
      language: 'en',
      task: 'find a paused memory',
    });
    expect(logs).toContain('Personal memory retrieval is paused.');

    await personalMemoryContextCommand(root, {
      memoryRoot,
      stateRoot,
      language: 'en',
      task: 'select context',
    });
    await personalMemoryStatusCommand(root, {
      memoryRoot,
      stateRoot,
      language: 'en',
    });
    await expect(
      personalMemoryCorrectCommand(root, {
        memoryRoot,
        stateRoot,
        id: 'missing-id',
        json: true,
      }),
    ).rejects.toThrow('At least one of --text or --category is required');
  });
});
