import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('comet-open 恢复语义', () => {
  it('明确说明 done、ready 和 blocked 对应的恢复动作', async () => {
    const skill = await readFile(
      path.resolve('assets', 'skills-zh', 'comet-open', 'SKILL.md'),
      'utf8',
    );

    expect(skill).toContain('恢复时按以下顺序处理');
    expect(skill).toContain('`done`：该 artifact 已完成，保持原文件不变');
    expect(skill).toContain('`ready`：依赖已经满足，可以立即生成');
    expect(skill).toContain('`blocked`：当前不可生成，不是等待用户或等待时间');
    expect(skill).toContain('先完成 `missingDeps` 列出的依赖 artifact');
    expect(skill).toContain('只有 `isComplete: true` 才表示 OpenSpec open 产物全部完成');
  });
});
