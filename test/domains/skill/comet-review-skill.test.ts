import { promises as fs } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const zhSkillPath = path.resolve('assets/skills-zh/comet-review/SKILL.md');
const zhOpenAiPath = path.resolve('assets/skills-zh/comet-review/agents/openai.yaml');
const enSkillPath = path.resolve('assets/skills/comet-review/SKILL.md');
const enOpenAiPath = path.resolve('assets/skills/comet-review/agents/openai.yaml');

const allowedReadOnlyCommands = new Set([
  'comet status . --json',
  'comet state get <change-name> phase',
  'comet state get <change-name> base_ref',
  'comet state get <change-name> plan',
  'comet state get <change-name> verification_report',
  'comet native show <change-name> --json',
  'comet native status <change-name> --details --json',
]);

function expectReadOnlyCommandContract(source: string, prohibitionMarker: string): void {
  const lines = source.split('\n');
  const prohibitionLines = lines.filter((line) => line.includes(prohibitionMarker));
  expect(prohibitionLines).toHaveLength(1);

  const outsideProhibition = lines.filter((line) => !line.includes(prohibitionMarker)).join('\n');
  for (const command of ['comet state set', 'comet state transition', 'comet native next']) {
    expect(outsideProhibition).not.toContain(command);
  }
  expect(outsideProhibition).not.toMatch(/\bcomet(?: native)? archive\b/iu);
  expect(outsideProhibition).not.toMatch(/\bcomet guard\b/iu);

  const bashCommands = [...source.matchAll(/```bash\n([\s\S]*?)```/gu)].flatMap((match) =>
    match[1]
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
  expect(bashCommands.length).toBeGreaterThan(0);
  for (const command of bashCommands) {
    expect(allowedReadOnlyCommands.has(command), `unexpected executable command: ${command}`).toBe(
      true,
    );
  }
}

describe('comet-review 中文 Skill', () => {
  it('保持显式调用且全程只读', async () => {
    const source = await fs.readFile(zhSkillPath, 'utf8');

    expect(source).toContain('name: comet-review');
    expect(source).toContain('disable-model-invocation: true');
    expect(source).toContain('本 Skill 的整个调用必须保持只读');
    expect(source).toContain('不修改、创建或删除文件');
    expect(source).toContain('不运行 `comet state select`');
    expect(source).toContain('不推进 phase');
    expect(source).toContain('独立于 `review_mode`');
    expect(source).toContain('不能替代 `/comet-verify` 或 Native Verify');
    expectReadOnlyCommandContract(source, '不运行 `comet state select`');
  });

  it('自动解析当前 Classic 或 Native change 并读取现有证据', async () => {
    const source = await fs.readFile(zhSkillPath, 'utf8');

    expect(source).toContain('comet status . --json');
    expect(source).toContain('.comet/current-change.json');
    expect(source).toContain('comet.selection.v2');
    expect(source).toContain('comet state get <change-name> base_ref');
    expect(source).toContain('comet native show <change-name> --json');
    expect(source).toContain('comet native status <change-name> --details --json');
    expect(source).toContain('Builder handoff');
    expect(source).toContain('verification report');
  });

  it('审查完整差异并输出可定位、分级的 finding', async () => {
    const source = await fs.readFile(zhSkillPath, 'utf8');

    expect(source).toContain('git status --short');
    expect(source).toContain('已提交、已暂存和未暂存修改');
    expect(source).toContain('所有未跟踪文件');
    expect(source).toContain('文档、配置和元数据');
    expect(source).toContain('CRITICAL');
    expect(source).toContain('IMPORTANT');
    expect(source).toContain('WARNING');
    expect(source).toContain('SUGGESTION');
    expect(source).toContain('具体文件和行号');
    expect(source).toContain('未发现具体问题');
  });

  it('提供 Codex 显式调用元数据', async () => {
    const metadata = parseYaml(await fs.readFile(zhOpenAiPath, 'utf8')) as {
      interface?: { display_name?: string; short_description?: string };
      policy?: { allow_implicit_invocation?: boolean };
    };

    expect(metadata.interface?.display_name).toBe('Comet 手动代码审查');
    expect(metadata.interface?.short_description).toBeTruthy();
    expect(metadata.policy?.allow_implicit_invocation).toBe(false);
  });
});

describe('comet-review bilingual contract', () => {
  it('keeps the English Skill aligned with the confirmed Chinese behavior', async () => {
    const source = await fs.readFile(enSkillPath, 'utf8');

    expect(source).toContain('name: comet-review');
    expect(source).toContain('disable-model-invocation: true');
    expect(source).toContain('The entire Skill invocation must remain read-only');
    expect(source).toContain('comet status . --json');
    expect(source).toContain('.comet/current-change.json');
    expect(source).toContain('comet state get <change-name> base_ref');
    expect(source).toContain('comet native show <change-name> --json');
    expect(source).toContain('comet native status <change-name> --details --json');
    expect(source).toContain('committed, staged, and unstaged changes');
    expect(source).toContain('independent of `review_mode`');
    expect(source).toContain('cannot replace `/comet-verify` or Native Verify');
    expectReadOnlyCommandContract(source, 'Do not run `comet state select`');
  });

  it('provides explicit-only Codex metadata in both languages', async () => {
    for (const metadataPath of [zhOpenAiPath, enOpenAiPath]) {
      const metadata = parseYaml(await fs.readFile(metadataPath, 'utf8')) as {
        interface?: { display_name?: string; short_description?: string };
        policy?: { allow_implicit_invocation?: boolean };
      };

      expect(metadata.interface?.display_name).toBeTruthy();
      expect(metadata.interface?.short_description).toBeTruthy();
      expect(metadata.policy?.allow_implicit_invocation).toBe(false);
    }
  });
});
