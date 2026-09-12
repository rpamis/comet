import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('comet-open 恢复语义', () => {
  it('明确说明 done、ready 和 blocked 对应的恢复动作', async () => {
    const skill = await readFile(
      path.resolve('assets', 'skills-zh', 'comet-open', 'SKILL.md'),
      'utf8',
    );

    expect(skill).toContain('恢复时按以下顺序识别已完成的部分，只补未完成的工作');
    expect(skill).toContain('`done`：该产物已完成，保持原文件不变');
    expect(skill).toContain('`ready`：依赖已经满足，可以生成');
    expect(skill).toContain('`blocked`：读取 `missingDeps`');
    expect(skill).toContain('先完成属于 `applyRequires` 依赖闭包的依赖产物');
    expect(skill).toContain('直到完整必需闭包为 done 或合法 skipped');
    expect(skill).toContain('comet state artifacts <name> --json');
    expect(skill).toContain('不属于 `applyRequires` 的可选产物');
  });
});
