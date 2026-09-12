import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('comet-open 批量拆分完成协议', () => {
  it('由 OpenSpec CLI 状态驱动 artifact 生成，不硬编码 schema 顺序', async () => {
    const skill = await readFile(
      path.resolve('assets', 'skills-zh', 'comet-open', 'SKILL.md'),
      'utf8',
    );

    expect(skill).toContain('不得写死生成顺序');
    expect(skill).toContain('在尚未完成、状态为 `status: "ready"` 的产物中');
    expect(skill).toContain('优先处理 `applyRequires` 所需的依赖，并遵循 CLI 返回的顺序');
    expect(skill).not.toContain(
      '**标准产物循环**（对每个 `artifact-id`：`proposal` → `design` → `tasks`）',
    );
  });

  it('所有拆分项通过 CLI 完成检查后才允许宣告批量拆分完成', async () => {
    const skill = await readFile(
      path.resolve('assets', 'skills-zh', 'comet-open', 'SKILL.md'),
      'utf8',
    );

    expect(skill).toContain(
      'comet classic openspec --agent-json -- status --change "<name>" --json',
    );
    expect(skill).toContain('完整依赖闭包');
    expect(skill).toContain('comet state artifacts <name> --json');
    expect(skill).toContain('`isComplete` 仅用于诊断');
    expect(skill).toContain('任一拆分项未通过检查时，不能宣告拆分完成');
  });
});
