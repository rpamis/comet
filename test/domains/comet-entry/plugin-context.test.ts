import { beforeEach, describe, expect, test, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  collectContext: vi.fn(),
  diagnostics: vi.fn(),
}));

vi.mock('../../../domains/comet-plugin/index.js', () => ({
  createDefaultCometPluginBridge: vi.fn(async () => bridge),
}));

import { collectCometPluginContext } from '../../../domains/comet-entry/plugin-context.js';

describe('Comet plugin context XML boundaries', () => {
  beforeEach(() => {
    bridge.collectContext.mockReset();
    bridge.diagnostics.mockReset();
    bridge.diagnostics.mockResolvedValue([]);
  });

  test('wraps personal memory and project knowledge after bridge collection', async () => {
    bridge.collectContext.mockResolvedValue([
      {
        pluginId: 'comet.personal-memory',
        text: '## 偏好\n- 使用 & <中文> "引号" \'单引号\'',
      },
      {
        pluginId: 'comet.project-knowledge',
        text: '## 项目知识参考\n- Source: docs/guide.md\n  > 结论',
      },
    ]);

    await expect(
      collectCometPluginContext(process.cwd(), { task: '测试上下文' }),
    ).resolves.toEqual([
      {
        pluginId: 'comet.personal-memory',
        text: '<personal_memory>\n## 偏好\n- 使用 &amp; &lt;中文&gt; &quot;引号&quot; &apos;单引号&apos;\n</personal_memory>',
      },
      {
        pluginId: 'comet.project-knowledge',
        text: '<project_knowledge>\n## 项目知识参考\n- Source: docs/guide.md\n  &gt; 结论\n</project_knowledge>',
      },
    ]);
  });

  test('keeps blank known contributions and unknown plugins compatible', async () => {
    bridge.collectContext.mockResolvedValue([
      { pluginId: 'comet.project-knowledge', text: '  \n' },
      { pluginId: 'comet.other', text: 'raw & <text>' },
      { pluginId: 'comet.personal-memory', text: 'memory' },
    ]);

    await expect(
      collectCometPluginContext(process.cwd(), { task: '兼容性' }),
    ).resolves.toEqual([
      { pluginId: 'comet.project-knowledge', text: '  \n' },
      { pluginId: 'comet.other', text: 'raw & <text>' },
      {
        pluginId: 'comet.personal-memory',
        text: '<personal_memory>\nmemory\n</personal_memory>',
      },
    ]);
  });
});
