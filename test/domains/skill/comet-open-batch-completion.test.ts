import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('comet-open 批量拆分完成协议', () => {
  it('由 OpenSpec CLI 状态驱动 artifact 生成，不硬编码 schema 顺序', async () => {
    const skill = await readFile(
      path.resolve('assets', 'skills-zh', 'comet-open', 'SKILL.md'),
      'utf8',
    );

    expect(skill).toContain('不得硬编码生成顺序');
    expect(skill).toContain('从尚未完成且为 `status: "ready"` 的 artifacts 中');
    expect(skill).toContain('推进 `applyRequires` 依赖闭包');
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
    expect(skill).toContain('`applyRequires` 列出的每个 artifact');
    expect(skill).toContain('`isComplete` 仅作诊断信息');
    expect(skill).toContain('任一拆分项未通过检查时，不得宣告拆分完成');
  });
});
