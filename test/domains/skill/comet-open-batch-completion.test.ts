import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('comet-open 批量拆分完成协议', () => {
  it('由 OpenSpec CLI 状态驱动 artifact 生成，不硬编码 schema 顺序', async () => {
    const skill = await readFile(
      path.resolve('assets', 'skills-zh', 'comet-open', 'SKILL.md'),
      'utf8',
    );

    expect(skill).toContain('不得硬编码 artifact 顺序');
    expect(skill).toContain('从 `artifacts` 中选择所有 `status: "ready"`');
    expect(skill).not.toContain(
      '**标准产物循环**（对每个 `artifact-id`：`proposal` → `design` → `tasks`）',
    );
  });

  it('所有拆分项通过 CLI 完成检查后才允许宣告批量拆分完成', async () => {
    const skill = await readFile(
      path.resolve('assets', 'skills-zh', 'comet-open', 'SKILL.md'),
      'utf8',
    );

    expect(skill).toContain('openspec status --change "<name>" --json');
    expect(skill).toContain('`isComplete` 必须为 `true`');
    expect(skill).toContain('任一拆分项未通过检查时，不得宣告拆分完成');
  });
});
