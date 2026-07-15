import { promises as fs } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

const roots = {
  en: path.resolve('assets', 'skills', 'comet-native'),
  zh: path.resolve('assets', 'skills-zh', 'comet-native'),
};

async function read(language: keyof typeof roots, relative: string): Promise<string> {
  return fs.readFile(path.join(roots[language], relative), 'utf8');
}

describe('Chinese Comet Native Skill', () => {
  it('has the public Native identity and a compact decision core', async () => {
    const source = await read('zh', 'SKILL.md');
    const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(source)?.[1];
    expect(frontmatter).toBeTruthy();
    const metadata = parseDocument(frontmatter!).toJS() as { name?: string; description?: string };

    expect(metadata.name).toBe('comet-native');
    expect(metadata.description).toContain('Native');
    expect(source).toContain('能从环境得到的事实不要询问用户');
    expect(source).toContain('一次只问最重要的一个问题');
    expect(source).toContain('推荐答案');
    expect(source).toContain('实际影响');
    expect(source).toContain('等待用户回答后再继续');
    expect(source).toContain('实现方式、是否落盘计划、测试粒度、调试方法和审查强度都由模型');
    expect(source).toContain('完整目标规格');
    expect(source).toContain('comet native new <change-name> --language zh-CN');
    expect(source).toContain('comet native next <change-name>');
  });

  it('references only Comet-owned Native documentation and runtime', async () => {
    const source = await read('zh', 'SKILL.md');
    const links = [...source.matchAll(/\]\(([^)]+)\)/gu)].map((match) => match[1]).sort();

    expect(links).toEqual([
      'reference/artifacts.md',
      'reference/commands.md',
      'reference/recovery.md',
      'scripts/comet-native-runtime.mjs',
    ]);
    await Promise.all(
      links.map((link) =>
        fs.access(
          link.startsWith('scripts/')
            ? path.resolve('assets', 'skills', 'comet-native', link)
            : path.join(roots.zh, link),
        ),
      ),
    );
  });

  it('contains no external workflow or prescriptive-method dependency', async () => {
    const files = [
      await read('zh', 'SKILL.md'),
      await read('zh', 'reference/artifacts.md'),
      await read('zh', 'reference/commands.md'),
      await read('zh', 'reference/recovery.md'),
    ].join('\n');
    expect(files).not.toMatch(
      /openspec|superpowers|grill-me|grilling|brainstorming|requiredSkillCalls|subagent|test-driven-development|code-review/iu,
    );
    expect(files).not.toMatch(/comet\s+(state|guard|handoff)\b/iu);
  });

  it('documents every Native CLI surface and exact artifact roots', async () => {
    const source = await read('zh', 'SKILL.md');
    const commands = await read('zh', 'reference/commands.md');
    const artifacts = await read('zh', 'reference/artifacts.md');
    const recovery = await read('zh', 'reference/recovery.md');
    for (const command of [
      'init',
      'root show',
      'root move',
      'new',
      'spec remove',
      'spec rebase',
      'list',
      'show',
      'status',
      'select',
      'next',
      'archive',
      'doctor',
    ]) {
      expect(commands).toContain(command);
    }
    expect(artifacts).toContain('<artifact-root>/comet/');
    expect(artifacts).toContain('specs/<capability>/spec.md');
    expect(artifacts).toContain('base_hash');
    expect(source).toContain('--confirmed');
    expect(source).not.toContain('记录正确的 canonical base hash');
    expect(artifacts).toContain('`spec_changes`、operation 和 `base_hash` 由 runtime 管理');
    expect(commands).toContain('comet native spec remove <change-name> <capability>');
    expect(commands).toContain('comet native spec rebase <change-name> --summary <text>');
    expect(source).toContain('离开 Build 时传 `--confirmed`');
    expect(recovery).toContain('受控重开到 Build');
    expect(recovery).toContain('transition.json');
    expect(recovery).toContain('copying');
    expect(recovery).toContain('ready');
    expect(recovery).toContain('switched');
  });

  it('ships an English Skill with the same Native protocol surfaces', async () => {
    const source = await read('en', 'SKILL.md');
    const files = [
      source,
      await read('en', 'reference/artifacts.md'),
      await read('en', 'reference/commands.md'),
      await read('en', 'reference/recovery.md'),
    ].join('\n');

    expect(source).toContain('Ask only the single most important question');
    expect(source).toContain('recommended answer');
    expect(source).toContain('complete target specification');
    expect(source).toContain('comet native new <change-name> --language en');
    expect(source).toContain('comet native next <change-name>');
    expect(source).toContain('--confirmed');
    expect(files).toContain('comet native spec remove <change-name> <capability>');
    expect(files).toContain('comet native spec rebase <change-name> --summary <text>');
    expect(source).toContain('pass `--confirmed` when leaving Build');
    expect(files).toContain('reopens the change in Build');
    expect(files).toContain('runtime owns `approval`, `spec_changes`, operation, and `base_hash`');
    expect(files).toContain('runtime/transition.json');
    expect(files).toContain('<artifact-root>/comet/');
    expect(files).not.toMatch(
      /openspec|superpowers|grill-me|grilling|brainstorming|requiredSkillCalls|subagent|test-driven-development|code-review/iu,
    );
  });
});
