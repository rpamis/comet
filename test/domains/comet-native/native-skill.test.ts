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
    expect(source).toContain('询问最上游、最重要的一个问题');
    expect(source).toContain('推荐答案');
    expect(source).toContain('实际影响');
    expect(source).toContain('然后结束本轮等待回答');
    expect(source).toContain('实现方式、是否落盘计划、测试粒度、调试方法和审查强度都由模型');
    expect(source).toContain('决定权属于用户，模型只能给出推荐');
    expect(source).toContain('没有用户决定时才自动推进');
    expect(source).toContain('完整目标规格');
    expect(source).toContain('comet native new <change-name> --language zh-CN');
    expect(source).toContain('comet native next <change-name>');
    expect(source).toContain('不得为用户刚补充的答案创建第二个 change');
    expect(source).toContain('`/comet-native` 是 Skill 入口，不是 shell 命令');
    expect(source).toContain('用户明确给出的 lowercase kebab-case capability ID 必须原样保留');
    expect(source).toContain('自然语言显示名称');
  });

  it('discovers hidden decisions without manufacturing unnecessary questions', async () => {
    const source = await read('zh', 'SKILL.md');

    expect(source).toContain('主要分支、默认行为、边界条件、失败路径、兼容性约束和不可逆操作');
    expect(source).toContain('仓库事实');
    expect(source).toContain('模型自主选择的实现方式');
    expect(source).toContain('用户决定');
    expect(source).toContain('回答后更新原有产物并重新计算决策前沿');
    expect(source).toContain('相邻功能的实现方式');
    expect(source).toContain('只能用于形成推荐项，不能代替用户答案');
    expect(source).toContain('一个反例能区分两种合理解释');
    expect(source).toContain('然后结束本轮等待回答');
    expect(source).toContain('调用 `next`');
    expect(source).toContain('不存在高影响未知项时，不提确认题');
    expect(source).toContain('另一个没有当前对话上下文的强模型');
    expect(source).toContain('不猜测用户可见行为');
  });

  it('keeps Runtime continuation inside the same Skill without claiming background execution', async () => {
    const source = await read('zh', 'SKILL.md');

    expect(source).toContain('机器可读 continuation 契约');
    expect(source).toContain('不代表宿主会在后台自动执行');
    expect(source).toContain('同一个 `/comet-native` Skill');
    expect(source).toContain('不要把四个阶段拆成多个 Skill');
    expect(source).toContain('没有用户决定或 Runtime 阻塞时持续推进');
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
      'checkpoint',
      'check',
      'next',
      'archive',
      'doctor',
    ]) {
      expect(commands).toContain(command);
    }
    expect(artifacts).toContain('<artifact-root>/comet/');
    expect(artifacts).toContain('specs/<capability>/spec.md');
    expect(artifacts).toContain('base_hash');
    expect(artifacts).toContain('schema: comet.native.v3');
    expect(artifacts).toContain('check-receipts/<sha256>.json');
    expect(artifacts).toContain('acceptance_id');
    expect(source).toContain('--confirmed');
    expect(source).toContain('acceptancePage');
    expect(source).toContain('nextCursor');
    expect(source).toContain('不调用 Git、shell、项目脚本或任何外部进程');
    expect(source).not.toContain('记录正确的 canonical base hash');
    expect(artifacts).toContain(
      '`phase`、`revision`、`approval`、`spec_changes`、operation、`base_hash`',
    );
    expect(commands).toContain('comet native spec remove <change-name> <capability>');
    expect(commands).toContain('comet native spec rebase <change-name> --summary <text>');
    expect(source).toContain('离开 Build 时传 `--confirmed`');
    expect(recovery).toContain('受控重开到 Build');
    expect(recovery).toContain('transition.json');
    expect(recovery).toContain('copying');
    expect(recovery).toContain('ready');
    expect(recovery).toContain('switched');
    expect(recovery).toContain('workspace-root-changed');
    expect(recovery).toContain('第三次且 scope 无进展时 manual stop');
    expect(commands).toContain('--acceptance-cursor <token>');
    expect(commands).toContain('runtime/evidence/check-receipts');
    expect(commands).not.toContain('command-receipts');
    expect(commands).not.toContain('--timeout <ms>');
  });

  it('ships an English Skill with the same Native protocol surfaces', async () => {
    const source = await read('en', 'SKILL.md');
    const files = [
      source,
      await read('en', 'reference/artifacts.md'),
      await read('en', 'reference/commands.md'),
      await read('en', 'reference/recovery.md'),
    ].join('\n');

    expect(source).toContain('ask the single most upstream question');
    expect(source).toContain('recommended answer');
    expect(source).toContain('complete target specification');
    expect(source).toContain('comet native new <change-name> --language en');
    expect(source).toContain('comet native next <change-name>');
    expect(source).toContain('--confirmed');
    expect(source).toContain("Do not create a second change for the user's answer");
    expect(source).toContain('`/comet-native` is a Skill entry, not a shell command');
    expect(source).toContain(
      'Preserve any lowercase kebab-case capability ID explicitly supplied by the user exactly',
    );
    expect(source).toContain('natural-language display name');
    expect(source).toContain('the choice is a user decision owned by the user');
    expect(source).toContain('Progress automatically only when no user decision exists');
    expect(source).toContain('implementation of an adjacent feature');
    expect(source).toContain("support a recommendation, not replace the user's answer");
    expect(source).toContain('one counterexample distinguishes two reasonable interpretations');
    expect(source).toContain('then end the turn and wait');
    expect(source).toContain('call `next`');
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
