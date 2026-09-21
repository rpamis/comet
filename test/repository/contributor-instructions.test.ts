import { promises as fs } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('contributor instructions', () => {
  it('keeps risk-based verification guidance in the shared AGENTS guide', async () => {
    const content = await fs.readFile(path.resolve('AGENTS.md'), 'utf8');

    expect(content).toContain('验证范围必须与改动风险相匹配');
    expect(content).toContain('每轮先运行覆盖当前改动的最小相关测试');
    expect(content).toContain('最终交付前运行一次全量测试');
    expect(content).toContain('只有修正了明确原因后才重跑，不盲目重复');
    expect(content).toContain('不要求每个提交机械地运行全部命令');
    expect(content).toContain(
      '`app/`、`domains/`、`platform/`、`scripts/`、`test/`、`.github/`、`config/`',
    );
  });

  it('imports the shared guide from CLAUDE.md instead of duplicating it', async () => {
    const content = await fs.readFile(path.resolve('CLAUDE.md'), 'utf8');
    expect(content.trim()).toBe('@AGENTS.md');
  });
});
