import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readRequest: vi.fn(),
  discover: vi.fn(),
  config: vi.fn(),
  worktree: vi.fn(),
  inspect: vi.fn(),
}));
vi.mock('../../../platform/process/hook-adapter.js', async (original) => ({
  ...(await original<typeof import('../../../platform/process/hook-adapter.js')>()),
  readCometHookRequest: mocks.readRequest,
}));
vi.mock('../../../domains/comet-native/native-paths.js', () => ({
  discoverNativeProject: mocks.discover,
}));
vi.mock('../../../domains/workflow-contract/project-config-reader.js', () => ({
  readWorkflowProjectConfig: mocks.config,
}));
vi.mock('../../../domains/comet-entry/hook-project-root.js', () => ({
  resolveCometHookProjectRoot: mocks.worktree,
}));
vi.mock('../../../domains/comet-entry/hook-router.js', () => ({
  inspectCometHook: mocks.inspect,
}));

import { runCometHookRouter } from '../../../domains/comet-entry/hook-router-entry.js';
import { readCachedProjectConfig } from '../../../domains/comet-entry/entry-reads.js';

const root = path.resolve('hook-budget-project');

describe('Hook entry request work budget', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    mocks.discover.mockResolvedValue(root);
    mocks.worktree.mockResolvedValue(root);
    mocks.config.mockResolvedValue({ default_workflow: 'native' });
    mocks.inspect.mockImplementation(async (projectRoot: string) => {
      await readCachedProjectConfig(projectRoot);
      return { allowed: true, reason: 'allowed' };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('does no project, config, worktree or owner discovery for definite non-write events', async () => {
    mocks.readRequest.mockResolvedValue({ intent: 'non-write', targets: [], toolName: 'Read' });
    mocks.config.mockRejectedValue(new Error('broken project policy'));
    await expect(runCometHookRouter(['--platform', 'codex', '--project-root', root])).resolves.toBe(
      0,
    );
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(mocks.worktree).not.toHaveBeenCalled();
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
  });

  it.each(['write', 'context'])(
    'shares discovery config within each %s request only',
    async (intent) => {
      mocks.readRequest.mockResolvedValue({
        intent,
        targets: intent === 'write' ? ['README.md'] : [],
      });
      for (let count = 1; count <= 2; count += 1) {
        await expect(
          runCometHookRouter(['--platform', 'codex', '--project-root', root]),
        ).resolves.toBe(0);
        expect(mocks.config).toHaveBeenCalledTimes(count);
        expect(mocks.inspect).toHaveBeenCalledTimes(count);
      }
    },
  );

  it('still fails closed on invalid project configuration for writes', async () => {
    mocks.readRequest.mockResolvedValue({ intent: 'write', targets: ['README.md'] });
    mocks.config.mockRejectedValue(new Error('broken project policy'));
    await expect(runCometHookRouter(['--platform', 'codex', '--project-root', root])).resolves.toBe(
      2,
    );
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('broken project policy'),
    );
  });
});
