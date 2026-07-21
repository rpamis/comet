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

describe('Comet Native Skills', () => {
  it('keeps clarification ahead of execution in both languages', async () => {
    const variants = [
      {
        language: 'zh' as const,
        clarification: '## 需求澄清协议',
        start: '## 开始或恢复',
        decision: '## 决策协议',
        progression: '## 推进契约',
        required: [
          '不能证明这一点时，按用户决定处理',
          '不要询问实现选择',
          '不能把产品决定重新归类为实现选择',
          '一次只问最上游的一个问题',
          '问题 / 推荐 / 影响',
          '任何合理回答仍会留下同级用户可见分支',
          '大小写折叠、外围标点、内部标点或撇号保留',
          '可以调查仓库事实、创建或恢复 Native change',
          '不要进入 Build、修改项目实现或调用 `next`',
          '更新原有 change 的 brief 和完整目标规格',
          '不要为补充答案创建第二个 change',
          '用户最初提出需求不算这类确认',
        ],
      },
      {
        language: 'en' as const,
        clarification: '## Clarification Protocol',
        start: '## Start or Resume',
        decision: '## Decision Protocol',
        progression: '## Progression Contract',
        required: [
          'If you cannot prove that, treat it as a user decision',
          'not to ask about implementation choices',
          'do not reclassify a product decision as an implementation choice',
          'Ask only the most upstream question',
          'Question / Recommendation / Impact',
          'would leave a sibling user-visible branch unresolved',
          'case folding, surrounding punctuation, preservation of internal punctuation or apostrophes',
          'inspect repository facts, create or resume the Native change',
          'Do not enter Build, modify project implementation, or call `next`',
          "update the existing change's brief and complete target specifications",
          'Do not create another change for a clarification answer',
          'The initial feature request is not that confirmation',
        ],
      },
    ];

    for (const variant of variants) {
      const source = await read(variant.language, 'SKILL.md');
      const clarificationOffset = source.indexOf(variant.clarification);
      const startOffset = source.indexOf(variant.start);
      const decisionOffset = source.indexOf(variant.decision);
      const progressionOffset = source.indexOf(variant.progression);

      expect(clarificationOffset, variant.language).toBeGreaterThan(0);
      expect(clarificationOffset, variant.language).toBeLessThan(startOffset);
      expect(decisionOffset, variant.language).toBeGreaterThan(startOffset);
      expect(progressionOffset, variant.language).toBeGreaterThan(decisionOffset);

      const clarification = source.slice(clarificationOffset, startOffset);
      for (const required of variant.required) {
        expect(clarification, `${variant.language}: ${required}`).toContain(required);
      }
    }
  });

  it('has the public Native identity and preserves agent autonomy', async () => {
    for (const language of ['en', 'zh'] as const) {
      const source = await read(language, 'SKILL.md');
      const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(source)?.[1];
      expect(frontmatter).toBeTruthy();
      const metadata = parseDocument(frontmatter!).toJS() as {
        name?: string;
        description?: string;
      };

      expect(metadata.name).toBe('comet-native');
      expect(metadata.description).toContain('Native');
      expect(source).toContain(language === 'en' ? 'complete target spec' : '完整目标规格');
      expect(source).toContain('comet native next <change-name>');
      expect(source).toContain('comet native select <change-name>');
      expect(source).toContain('--confirmed');
    }

    const zh = await read('zh', 'SKILL.md');
    expect(zh).toContain('能从环境取得的事实不要询问用户');
    expect(zh).toContain('实现方式、是否保存计划、测试粒度、调试方法和审查强度由你根据风险决定');
    expect(zh).toContain('不需要额外确认');
    expect(zh).toContain('用户明确给出的 lowercase kebab-case capability ID 必须原样');

    const en = await read('en', 'SKILL.md');
    expect(en).toContain('Do not ask the user for facts available from the environment');
    expect(en).toContain('Decide implementation details');
    expect(en).toContain('do not ask for additional confirmation');
    expect(en).toContain('Preserve a user-provided lowercase kebab-case capability ID exactly');
  });

  it('keeps Runtime continuation and caller stop points explicit', async () => {
    const zh = await read('zh', 'SKILL.md');
    expect(zh).toContain('机器可读的 continuation 契约');
    expect(zh).toContain('不代表宿主会在后台执行后续工作');
    expect(zh).toContain('在本 Skill 内持续推进下一阶段');
    expect(zh).toContain('transition 成功后不再调用工具');
    expect(zh).toContain('`continuation.disposition: continue`，也不能越过这个停点');

    const en = await read('en', 'SKILL.md');
    expect(en).toContain('machine-readable continuation contract');
    expect(en).toContain('does not mean that the host executes later work in the background');
    expect(en).toContain('continue into the next phase inside this Skill');
    expect(en).toContain('make no tool calls after the transition succeeds');
    expect(en).toContain('`continuation.disposition: continue` does not override that stop point');
  });

  it('preserves caller-requested point-in-time evidence', async () => {
    const zh = await read('zh', 'SKILL.md');
    expect(zh).toContain('## 执行边界与时点证据');
    expect(zh).toContain('通过重定向直接保存标准输出');
    expect(zh).toContain('不可变证据');
    expect(zh).toContain('不得在状态变化后重建、刷新或覆盖');
    expect(zh).toContain('首次调用本身就使用机器可读模式');

    const en = await read('en', 'SKILL.md');
    expect(en).toContain('## Execution Boundaries and Point-in-Time Evidence');
    expect(en).toContain('redirect stdout directly to the target');
    expect(en).toContain('immutable evidence');
    expect(en).toContain('do not rebuild, refresh, or overwrite it after state changes');
    expect(en).toContain('the first invocation itself must use machine-readable mode');
  });

  it('references only Comet-owned Native documentation and Runtime', async () => {
    for (const language of ['en', 'zh'] as const) {
      const source = await read(language, 'SKILL.md');
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
              : path.join(roots[language], link),
          ),
        ),
      );
    }
  });

  it('contains no external workflow or prescriptive-method dependency', async () => {
    for (const language of ['en', 'zh'] as const) {
      const files = await Promise.all(
        [
          'SKILL.md',
          'reference/artifacts.md',
          'reference/commands.md',
          'reference/recovery.md',
        ].map((file) => read(language, file)),
      );
      const content = files.join('\n');
      expect(content).not.toMatch(
        /openspec|superpowers|grill-me|grilling|brainstorming|requiredSkillCalls|subagent|test-driven-development|code-review/iu,
      );
      expect(content).not.toMatch(/comet\s+(state|guard|handoff)\b/iu);
    }
  });

  it('documents every Native CLI surface and exact artifact roots', async () => {
    for (const language of ['en', 'zh'] as const) {
      const source = await read(language, 'SKILL.md');
      const commands = await read(language, 'reference/commands.md');
      const artifacts = await read(language, 'reference/artifacts.md');
      const recovery = await read(language, 'reference/recovery.md');

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
        expect(commands, `${language}: ${command}`).toContain(command);
      }

      expect(artifacts).toContain('<artifact-root>/comet/');
      expect(artifacts).toContain('specs/<capability>/spec.md');
      expect(artifacts).toContain('base_hash');
      expect(artifacts).toContain('schema: comet.native.v3');
      expect(artifacts).toContain('check-receipts/<sha256>.json');
      expect(artifacts).toContain('acceptance_id');
      expect(source).toContain('acceptancePage');
      expect(source).toContain('nextCursor');
      expect(source).toContain('Git');
      expect(source).toContain('shell');
      expect(source).toContain(language === 'en' ? 'external' : '外部');
      expect(commands).toContain('comet native spec remove <change-name> <capability>');
      expect(commands).toContain('comet native spec rebase <change-name> --summary <text>');
      expect(commands).toContain('--acceptance-cursor <token>');
      expect(commands).toContain('runtime/evidence/check-receipts');
      expect(commands).not.toContain('command-receipts');
      expect(commands).not.toContain('--timeout <ms>');
      expect(recovery).toContain('transition.json');
      expect(recovery).toContain('copying');
      expect(recovery).toContain('ready');
      expect(recovery).toContain('switched');
      expect(recovery).toContain('workspace-root-changed');
    }
  });

  it('documents current Native behavior without unreleased version history', async () => {
    for (const language of ['en', 'zh'] as const) {
      const files = await Promise.all(
        [
          'SKILL.md',
          'reference/artifacts.md',
          'reference/commands.md',
          'reference/recovery.md',
        ].map((file) => read(language, file)),
      );
      const content = files.join('\n');

      for (const unwanted of [
        'comet.native.v1',
        'comet.native.v2',
        'strong coding model',
        'another strong model',
        'decision frontier',
        'cold-start executable standard',
        'Schema upgrades',
        'legacy physical-tree baseline',
        '强编码模型',
        '强模型',
        '决策前沿',
        '冷启动可执行标准',
        'Schema 升级',
        '旧 schema',
        '早期 v2',
      ]) {
        expect(content, `${language}: ${unwanted}`).not.toContain(unwanted);
      }
    }
  });
});
