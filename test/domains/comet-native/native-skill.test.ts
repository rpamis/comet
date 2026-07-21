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
          'native.clarification_mode',
          '字段缺失时使用 `sequential`',
          '不能证明这一点时，按用户决定处理',
          '不要询问实现选择',
          '不能把产品决定重新归类为实现选择',
          '尚未查清的事实只阻塞依赖它的问题',
          '彼此独立的用户决定不能合并',
          '同一决定的某种合理解释',
          '一次只问最上游的一个问题',
          '问题 / 推荐 / 影响',
          '不增加通用的最终确认',
          '本轮可回答问题集',
          '前置决定都已确定',
          '答案不依赖本轮其他问题',
          '一次提出整组问题',
          '- [blocking] Q1: <问题>',
          '不要使用 Markdown 有序列表',
          '没有回答或回答不明确的问题继续保持 `[blocking]`',
          '重新计算本轮可回答问题集',
          '被静默假设的用户可见分支',
          '- [blocking] CONFIRM: <确认内容>',
          '用户明确确认前，不进入 Build，也不调用 `next`',
          '大小写折叠、外围标点、内部标点或撇号保留',
          '可以调查仓库事实、创建或恢复 Native change',
          '不要进入 Build、修改项目实现或调用 `next`',
          '更新原有 change 的 brief 和完整目标规格',
          '不要为补充答案创建第二个 change',
          '用户最初提出需求不算',
        ],
      },
      {
        language: 'en' as const,
        clarification: '## Clarification Protocol',
        start: '## Start or Resume',
        decision: '## Decision Protocol',
        progression: '## Progression Contract',
        required: [
          'native.clarification_mode',
          'use `sequential` when the field is absent',
          'If you cannot prove that, treat it as a user decision',
          'not to ask about implementation choices',
          'do not reclassify a product decision as an implementation choice',
          'An unresolved fact blocks only questions that depend on it',
          'Do not merge independent user decisions',
          'reasonable interpretation of that same decision',
          'Ask only the most upstream question',
          'Question / Recommendation / Impact',
          'without adding a generic final confirmation',
          'ready question set',
          'all prerequisite decisions settled',
          'does not depend on another question in the same round',
          'Ask the entire set together',
          '- [blocking] Q1: <question>',
          'Do not replace this prefix with a Markdown ordered list',
          'Keep unanswered or ambiguous items `[blocking]`',
          'Recompute the ready question set',
          'silently assumed',
          '- [blocking] CONFIRM: <confirmation>',
          'Until the user confirms explicitly, do not enter Build or call `next`',
          'case folding, surrounding punctuation, preservation of internal punctuation or apostrophes',
          'inspect repository facts, create or resume the Native change',
          'Do not enter Build, modify project implementation, or call `next`',
          "update the existing change's brief and complete target specifications",
          'Do not create another change for a clarification answer',
          'initial feature request does not',
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

  it('uses Claude Code structured questions without changing Native clarification rounds', async () => {
    const variants = [
      {
        language: 'zh' as const,
        start: '## 需求澄清协议',
        end: '## 执行边界与状态快照',
        required: [
          '当前工具列表提供 `AskUserQuestion` 时',
          'Sequential 模式每轮提交一道结构化问题',
          '选项互斥时使用单选',
          '把本轮整组问题放在同一次调用中',
          '不能把同一轮拆成多次工具调用',
          '整轮使用编号文本降级模式',
          '不能用一道多选题压缩多个独立的用户决定',
          '第一次调用失败',
          '本会话后续不再重试',
          '不再同时输出一套重复的文本问题',
        ],
      },
      {
        language: 'en' as const,
        start: '## Clarification Protocol',
        end: '## Execution Boundaries and Point-in-Time Evidence',
        required: [
          'current tool list provides `AskUserQuestion`',
          'Sequential mode submits one structured question per round',
          'Use single-select when the options are mutually exclusive',
          'put the entire ready question set in the same call',
          'Do not split the same round across multiple tool calls',
          'use the numbered-text fallback for the entire round',
          'Do not compress independent user decisions into one multi-select question',
          'If the first call fails',
          'do not retry it again during this session',
          'do not also output a duplicate set of text questions',
        ],
      },
    ];

    for (const variant of variants) {
      const source = await read(variant.language, 'SKILL.md');
      const clarification = source.slice(
        source.indexOf(variant.start),
        source.indexOf(variant.end),
      );
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
    expect(zh).toContain('Sequential 模式直接继续；Batch 模式先完成最终共享理解确认');
    expect(zh).toContain('Batch 模式需要重新计算问题集');
    expect(zh).toContain('用户明确给出的 lowercase kebab-case capability ID 必须原样');

    const en = await read('en', 'SKILL.md');
    expect(en).toContain('Do not ask the user for facts available from the environment');
    expect(en).toContain('Decide implementation details');
    expect(en).toContain(
      'Sequential mode continues directly. Batch mode first completes its final shared-understanding confirmation',
    );
    expect(en).toContain('Batch mode must recompute the ready question set');
    expect(en).toContain('Preserve a user-provided lowercase kebab-case capability ID exactly');
  });

  it('documents clarification mode, persistence, and recovery in both languages', async () => {
    for (const language of ['en', 'zh'] as const) {
      const artifacts = await read(language, 'reference/artifacts.md');
      const recovery = await read(language, 'reference/recovery.md');

      expect(artifacts).toContain('clarification_mode: sequential');
      expect(artifacts).toContain('`sequential`');
      expect(artifacts).toContain('`batch`');
      expect(artifacts).toContain('[blocking]');
      expect(artifacts).toContain(
        language === 'en' ? '- [blocking] Q1: <question>' : '- [blocking] Q1: <问题>',
      );
      expect(artifacts).toContain('- [blocking] CONFIRM:');
      expect(recovery).toContain('native.clarification_mode');
      expect(recovery).toContain('[blocking]');
      expect(recovery).toContain(language === 'en' ? 'saved numbers' : '已保存编号');
      expect(recovery).toContain(
        language === 'en'
          ? 'Do not reconstruct answers from chat history'
          : '不依赖聊天记录重建答案',
      );
      expect(recovery).toContain(
        language === 'en'
          ? 'Changing configuration does not clear existing blockers'
          : '切换配置不会消除已有阻塞项',
      );
      expect(recovery).toContain(
        language === 'en'
          ? "first map the user's answers to the saved questions"
          : '先把用户答案对应回已保存问题',
      );
      expect(recovery).toContain(language === 'en' ? 'explicit user confirmation' : '用户明确确认');
    }
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
    expect(zh).toContain('## 执行边界与状态快照');
    expect(zh).toContain('状态变化前的 Runtime 返回快照');
    expect(zh).toContain('通过重定向直接保存标准输出');
    expect(zh).toContain('快照确认完整后不得重建、刷新或覆盖');
    expect(zh).toContain('只反映生成时的真实状态');
    expect(zh).not.toContain('时点证据');
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
