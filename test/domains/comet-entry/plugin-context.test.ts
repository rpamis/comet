import { beforeEach, describe, expect, test, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  collectContext: vi.fn(),
  diagnostics: vi.fn(),
}));

vi.mock('../../../domains/comet-plugin/index.js', () => ({
  createDefaultCometPluginBridge: vi.fn(async () => bridge),
}));

import { collectCometPluginContext } from '../../../domains/comet-entry/plugin-context.js';

describe('Comet plugin context boundary', () => {
  beforeEach(() => {
    bridge.collectContext.mockReset();
    bridge.diagnostics.mockReset();
    bridge.diagnostics.mockResolvedValue([]);
  });

  test('passes through the single Agent Context assembled by the bridge', async () => {
    bridge.collectContext.mockResolvedValue([
      {
        pluginId: 'comet.context-director',
        text: '<agent_context>\n<context_manifest />\n</agent_context>',
        episodeId: 'context:one',
        manifest: [],
        applications: [],
      },
    ]);

    await expect(collectCometPluginContext(process.cwd(), { task: '测试上下文' })).resolves.toEqual(
      [
        {
          pluginId: 'comet.context-director',
          text: '<agent_context>\n<context_manifest />\n</agent_context>',
          episodeId: 'context:one',
          manifest: [],
          applications: [],
        },
      ],
    );
  });

  test('keeps an empty bridge response empty', async () => {
    bridge.collectContext.mockResolvedValue([]);

    await expect(collectCometPluginContext(process.cwd(), { task: '兼容性' })).resolves.toEqual([]);
  });
});
