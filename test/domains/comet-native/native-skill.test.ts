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
  it('locks unresolved user-visible decisions before any workflow action', async () => {
    const source = await read('zh', 'SKILL.md');
    const commands = await read('zh', 'reference/commands.md');
    const recovery = await read('zh', 'reference/recovery.md');
    const lockStart = source.indexOf('## 需求澄清协议');
    const startOrResume = source.indexOf('## 开始或恢复');
    const protocolStart = source.indexOf('## 决策协议');
    const progressionStart = source.indexOf('## 推进契约');

    expect(lockStart).toBeGreaterThan(0);
    expect(lockStart).toBeLessThan(startOrResume);
    expect(protocolStart).toBeGreaterThan(startOrResume);
    expect(progressionStart).toBeGreaterThan(protocolStart);

    const lock = source.slice(lockStart, startOrResume);
    expect(lock).toContain('沿决策树');
    expect(lock).toContain('无法证明它只是实现选择');
    expect(lock).toContain('按用户决定处理');
    expect(lock).toContain('一次只问一个');
    expect(lock).toContain('推荐答案');
    expect(lock).toContain('问完立即结束本轮');
    expect(lock).toContain('达成共享理解前');
    expect(lock).toContain('不进入 Build');
    expect(lock).toContain('不修改项目实现');
    expect(lock).toContain('不调用 `next`');
    expect(lock).toContain('必须能引用');
    expect(lock).toContain('不要询问实现选择');
    expect(lock).toContain('不允许把产品决定重新归类为实现选择');
    expect(lock).toContain('一个完整策略问题');
    expect(lock).toContain('保持现有行为');
    expect(lock).toContain('不代表新行为自动继承旧语义');
    expect(lock).toContain('回答后仍会留下同级的用户可见分支');
    expect(lock).toContain('这个问题就过窄');
    expect(lock).toContain('新引入的输出或能力');
    expect(lock).toContain('旧代码、相邻能力和兼容性要求都不能关闭');
    expect(lock).toContain('该新行为本身');
    expect(lock).toContain('“规范化”“直观”“标准”“预期”');
    expect(lock).toContain('只是未定义行为的占位词');
    expect(lock).toContain('唯一允许的用户可见结果');
    expect(lock).toContain('当前消息是对已提出阻塞问题的回答');
    expect(lock).toContain('离开 Shape 的 `next` 必须带 `--confirmed`');
    expect(lock).toContain('该 transition 后禁止任何工具调用');
    expect(lock).toContain('大小写折叠、外围标点、内部标点或撇号保留');
    expect(lock).toContain('缺少其中任一项');
    const clarificationSurfaces = [source, commands, recovery].join('\n');
    expect(clarificationSurfaces).not.toContain('高影响决定');
    expect(clarificationSurfaces).not.toContain('高影响用户决定');

    const protocol = source.slice(protocolStart, progressionStart);
    expect(protocol).not.toMatch(/高影响|显著改变/u);
    expect(protocol).toContain('共享理解不是额外的确认步骤');
    expect(protocol).toContain('没有用户决定时直接继续');
  });

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
    expect(source).toContain('没有用户决定时直接继续');
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
    expect(source).toContain('显式要求在某个阶段停下或切换会话');
    expect(source).toContain('精确输出约定的停点标记');
    expect(source).toContain('transition 成功后不再调用工具');
  });

  it('preserves caller-requested timepoint evidence across execution boundaries', async () => {
    const zh = await read('zh', 'SKILL.md');
    const en = await read('en', 'SKILL.md');

    expect(zh).toContain('## 执行边界与时点证据');
    expect(zh).toContain('直接重定向标准输出');
    expect(zh).toContain('不可变证据');
    expect(zh).toContain('不得在状态变化后重建、刷新或覆盖');
    expect(zh).toContain('transition 成功后工具调用数必须为零');
    expect(zh).toContain('回答回合不是下一阶段的执行回合');
    expect(zh).toContain('`continuation.disposition: continue` 也不能覆盖');
    expect(zh).toContain('首次预演与首次提交调用本身');

    expect(en).toContain('## Execution boundaries and timepoint evidence');
    expect(en).toContain('redirect standard output directly');
    expect(en).toContain('immutable evidence');
    expect(en).toContain('Never reconstruct, refresh, or overwrite it after state changes');
    expect(en).toContain('the tool-call count after success must be zero');
    expect(en).toContain('The answer turn is not the next phase execution turn');
    expect(en).toContain('`continuation.disposition: continue` does not override');
    expect(en).toContain('the first preview and first commit invocations themselves');
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
      '`phase`、`revision`、`approval`、`approved_contract_hash`、`spec_changes`、operation、`base_hash`',
    );
    expect(commands).toContain('comet native spec remove <change-name> <capability>');
    expect(commands).toContain('comet native spec rebase <change-name> --summary <text>');
    expect(source).toContain('离开 Build 时传 `--confirmed`');
    expect(source).toContain('先前已经提出的阻塞问题');
    expect(source).toContain('最初提出功能不算这类显式确认');
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
    const commands = await read('en', 'reference/commands.md');
    const recovery = await read('en', 'reference/recovery.md');
    const files = [source, await read('en', 'reference/artifacts.md'), commands, recovery].join(
      '\n',
    );

    const lockStart = source.indexOf('## Clarification lock');
    const startOrResume = source.indexOf('## Start or resume');
    const protocolStart = source.indexOf('## Decision protocol');
    const progressionStart = source.indexOf('## Progression contract');
    expect(lockStart).toBeGreaterThan(0);
    expect(lockStart).toBeLessThan(startOrResume);
    const lock = source.slice(lockStart, startOrResume);
    expect(lock).toContain('walk the decision tree');
    expect(lock).toContain('cannot prove that it is only an implementation choice');
    expect(lock).toContain('treat it as a user decision');
    expect(lock).toContain('ask one question at a time');
    expect(lock).toContain('recommended answer');
    expect(lock).toContain('end the turn immediately');
    expect(lock).toContain('shared understanding');
    expect(lock).toContain('do not enter Build');
    expect(lock).toContain('do not modify the project implementation');
    expect(lock).toContain('do not call `next`');
    expect(lock).toContain('must be able to quote');
    expect(lock).toContain('do not ask implementation choices');
    expect(lock).toContain('does not reclassify product decisions as implementation choices');
    expect(lock).toContain('one coherent policy question');
    expect(lock).toContain('Preserve existing behavior');
    expect(lock).toContain('does not mean that new behavior inherits old semantics');
    expect(lock).toContain('would leave a sibling user-visible branch unresolved');
    expect(lock).toContain('the question is too narrow');
    expect(lock).toContain('newly introduced output or capability');
    expect(lock).toContain(
      'Old code, adjacent capabilities, and compatibility requirements cannot close',
    );
    expect(lock).toContain('that new behavior itself');
    expect(lock).toContain('“normalized,” “intuitive,” “standard,” and “expected”');
    expect(lock).toContain('placeholders for undefined behavior');
    expect(lock).toContain('the only permitted user-visible result');
    expect(lock).toContain('current message answers a surfaced blocking question');
    expect(lock).toContain('the `next` that leaves Shape must include `--confirmed`');
    expect(lock).toContain('no tool call is permitted after that transition');
    expect(lock).toContain(
      'case folding, surrounding punctuation, and preservation of internal punctuation or apostrophes',
    );
    expect(lock).toContain('Omitting any one');
    expect(files).not.toMatch(/high-impact (?:user )?decision/iu);
    const protocol = source.slice(protocolStart, progressionStart);
    expect(protocol).not.toMatch(/materially change|high-impact/iu);
    expect(protocol).toContain('Shared understanding is not an extra confirmation step');
    expect(protocol).toContain('When no user decision exists, continue directly');

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
    expect(source).toContain('explicitly asks you to stop at a phase or switch sessions');
    expect(source).toContain('emit the requested boundary marker exactly');
    expect(source).toContain('make no more tool calls after the transition succeeds');
    expect(source).toContain('implementation of an adjacent feature');
    expect(source).toContain("support a recommendation, not replace the user's answer");
    expect(source).toContain('one counterexample distinguishes two reasonable interpretations');
    expect(source).toContain('then end the turn and wait');
    expect(source).toContain('call `next`');
    expect(files).toContain('comet native spec remove <change-name> <capability>');
    expect(files).toContain('comet native spec rebase <change-name> --summary <text>');
    expect(source).toContain('pass `--confirmed` when leaving Build');
    expect(source).toContain('previously surfaced blocking question');
    expect(source).toContain(
      'The initial feature request is not this kind of explicit confirmation',
    );
    expect(files).toContain('reopens the change in Build');
    expect(files).toContain(
      'runtime owns `approval`, `approved_contract_hash`, `spec_changes`, operation, and `base_hash`',
    );
    expect(files).toContain('runtime/transition.json');
    expect(files).toContain('<artifact-root>/comet/');
    expect(files).not.toMatch(
      /openspec|superpowers|grill-me|grilling|brainstorming|requiredSkillCalls|subagent|test-driven-development|code-review/iu,
    );
  });
});
