import { promises as fs } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const skillRoot = path.resolve('assets', 'skills');
const zhSkillRoot = path.resolve('assets', 'skills-zh');

async function readSkill(root: string, name: string): Promise<string> {
  return fs.readFile(path.join(root, name, 'SKILL.md'), 'utf8');
}

function descriptionOf(skill: string): string {
  return skill.match(/^description:\s*(['"])([^\r\n]+)\1$/mu)?.[2] ?? '';
}

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from, `Missing section: ${start}`).toBeGreaterThanOrEqual(0);
  expect(to, `Missing following section: ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

async function readChineseReference(name: string): Promise<string> {
  return fs.readFile(path.join(zhSkillRoot, 'comet-classic', 'reference', `${name}.md`), 'utf8');
}

// Approved Chinese semantics are synchronized to English; both languages retain safety contracts.
describe('Chinese Classic efficiency contracts', () => {
  it('retains per-question options and recommendations throughout clarification and confirmation', async () => {
    const decisions = await readChineseReference('decision-point');
    const presentation = section(decisions, '## 每个问题必须包含的信息', '## 各阶段需要确认什么');
    for (const requirement of [
      '**问题**',
      '**推荐与理由**',
      '**选项与影响**',
      '每个问题分别满足',
    ]) {
      expect(presentation).toContain(requirement);
    }
    expect(decisions).toContain('存在 `AskUserQuestion` 时，使用它展示单选/多选选项');
    expect(decisions).toContain('本会话后续决策点不得反复重试它');
    expect(presentation).toContain('待定决定保持未确认');
    expect(decisions).toContain('阶段明确要求的产物/设计批准也属于用户决策点');
    expect(decisions).toContain('此规则不替代阶段明确要求的用户确认');
    for (const name of ['comet-classic', 'comet-open', 'comet-design']) {
      const skill = await readSkill(zhSkillRoot, name);
      expect(skill, name).toContain('comet-classic/reference/decision-point.md');
      expect(skill, name).toContain('AskUserQuestion');
    }
    const open = await readSkill(zhSkillRoot, 'comet-open');
    const explore = section(open, '### 1. 探索想法与需求澄清', '### 1a.');
    expect(explore).toContain('各选项影响');
    const design = await readSkill(zhSkillRoot, 'comet-design');
    const brainstorming = section(design, '### 1b. 执行 Brainstorming', '### 1c.');
    expect(brainstorming).toContain('逐问给出明确问题');
    expect(brainstorming).toContain('推荐及基于当前约束的理由');
  });

  it('keeps phase confirmations reachable and preserves the selected preset initialization', async () => {
    const entry = await readSkill(zhSkillRoot, 'comet-classic');
    const continueFlow = section(entry, '## 3. 继续完成', '## 每个阶段都必须遵守的规则');
    for (const boundary of [
      'Open 产物完成后，请用户最终确认名称、范围和产物',
      'Design 形成方案后，请用户确认正式设计',
      '执行/TDD/review 配置',
      '接受偏差、处理实现与 Spec 不一致',
      '选择归档与交付方式',
      '需要从预设升级为完整流程',
      '已有仍有效的授权与配置直接复用',
    ]) {
      expect(continueFlow).toContain(boundary);
    }
    expect(entry).toContain('新 full change 交 `/comet-open`');
    expect(entry).toContain('hotfix/tweak 分别交 `/comet-hotfix`、`/comet-tweak`');
    expect(entry).not.toContain('新 change 统一交 `/comet-open`');
    expect(entry).toContain('用户选择升级后才运行');
    expect(entry).toContain('comet state transition <name> preset-escalate');
    for (const preset of ['hotfix', 'tweak']) {
      const skill = await readSkill(zhSkillRoot, `comet-${preset}`);
      expect(skill).toContain(`comet state init <name> ${preset}`);
    }
  });

  it('routes missing dependencies and malformed state to concrete recovery without changing workflow', async () => {
    const entry = await readSkill(zhSkillRoot, 'comet-classic');
    const recovery = await readChineseReference('context-recovery');
    const errors = section(recovery, '## 入口错误与恢复', '## 任务核对与补勾');
    expect(entry).toContain('context-recovery.md` 的“入口错误与恢复”');
    for (const invariant of [
      '不把命令失败当作“没有未归档的 change”',
      '必须使用的 Skill 不能用普通对话代替',
      'hotfix/tweak 返回对应预设的初始化步骤',
      '不能用 `comet state set` 覆盖损坏文件',
      '无法确认归属时停止写入',
      '不能用以前的通过结果覆盖本次失败',
    ]) {
      expect(errors).toContain(invariant);
    }
  });

  it('routes recovery to the phase contract without re-asking valid plan-ready configuration', async () => {
    const entry = await readSkill(zhSkillRoot, 'comet-classic');
    const recovery = await readChineseReference('context-recovery');
    const decisions = await readChineseReference('decision-point');
    const fields = await readChineseReference('comet-yaml-fields');
    const build = await readSkill(zhSkillRoot, 'comet-build');

    expect(entry).toContain('comet-classic/reference/context-recovery.md');
    expect(entry).toContain('根据当前阶段入口返回的 nextAction 确定还有哪些步骤未完成');
    expect(recovery).toContain('`build_pause: plan-ready` 表示用户要求计划后暂停');
    expect(recovery).toContain('仅在配置缺失或用户明确要求更改时');
    expect(recovery).toContain('只有用户明确要求继续才清除暂停');
    expect(decisions).toContain('沿用有效计划与配置，不重新发起配置决策');
    expect(fields).toContain('用户明确要求计划后暂停（包括切换模型）');
    expect(build).toContain('沿用仍然有效的计划和配置');
    for (const source of [entry, recovery, decisions, build]) {
      expect(source).not.toContain('重新发起同一个联合决策；只有用户给出完整配置后才清除暂停');
    }
  });

  it('keeps continuation and language fallback conditional across reachable Classic guidance', async () => {
    const entry = await readSkill(zhSkillRoot, 'comet-classic');
    const scripts = await readChineseReference('scripts');
    const recovery = await readChineseReference('context-recovery');
    const transition = await readChineseReference('auto-transition');
    expect(entry).toContain('所有参考按当前动作读取相关章节');
    expect(scripts).toContain('已有 change 优先使用本次有效入口返回的 `configuration.language`');
    expect(scripts).toContain('仅入口未提供该字段时');
    for (const source of [scripts, recovery, transition]) {
      expect(source).toContain('agent.continuation');
      expect(source).toContain('不重复 next、select 或 check');
    }
    for (const phase of ['open', 'build', 'verify', 'hotfix', 'tweak']) {
      const skill = await readSkill(zhSkillRoot, `comet-${phase}`);
      const handoff = skill.slice(skill.indexOf('## 自动衔接下一阶段'));
      expect(handoff, phase).toContain('comet-classic/reference/auto-transition.md');
      expect(handoff, phase).toContain('agent.continuation');
      expect(handoff, phase).toContain(
        '只有丢失上下文后恢复任务、外部状态变化，或旧结果未提供这些信息时，才运行',
      );
    }
  });

  it('uses scope and independence instead of task-count triggers while preserving review ownership', async () => {
    const build = await readSkill(zhSkillRoot, 'comet-build');
    const debug = await readChineseReference('debug-gate');
    const decisions = await readChineseReference('decision-point');
    expect(build).toContain('任务数量或增长比例本身不触发暂停');
    expect(build).toContain('只有实际扩大范围、需要重新设计或出现可独立交付的新功能时');
    expect(build).toContain('每个任务都须纳入独立审查');
    expect(build).toContain('各段通过审查后才继续依赖它的后续实施');
    expect(build).toContain('不将可独立验收的全部任务合成一段延后审查');
    expect(debug).toContain('失败数量不决定调度方式');
    expect(debug).toContain('修改范围互斥且能分别验收时才可并发实施');
    expect(debug).toContain('其他执行方式保持已选方法');
    expect(debug).toContain('根因未明前不得动源码');
    expect(decisions).toContain('暂停或停止只影响依赖该决定、或被当前问题阻塞的动作');
    expect(decisions).toContain('不得因此绕过阶段 Guard、提前实施尚未确认的范围');
    for (const obsolete of ['50% 阈值', '每完成 3 个任务', '失败 ≤ 2 个', '≥ 3 个失败']) {
      expect(`${build}\n${debug}`).not.toContain(obsolete);
    }
  });

  it('confirms an atomic strategy before planning without silently replacing existing choices', async () => {
    const build = await readSkill(zhSkillRoot, 'comet-build');
    const configuration = section(build, '### 1. 先确认执行策略', '### 2. 创建或恢复计划');
    const plan = section(build, '### 2. 创建或恢复计划', '### 3. 执行与验收');

    expect(configuration).toContain('写计划前必须确认执行策略');
    expect(configuration).toContain('在同一轮提问中收集执行方式、TDD 和审查模式');
    expect(configuration).toContain('不自动替换已有 change 的执行策略');
    expect(configuration).toContain('不写入不完整的配置');
    expect(configuration).toContain(
      'build_mode autonomous subagent_dispatch null tdd_mode tdd review_mode standard --json',
    );
    expect(plan).toContain('autonomous：由当前 Agent 直接编写和自检，不加载 writing-plans');
    expect(plan).toContain('其他计划执行策略：使用 `writing-plans` Skill');
    expect(plan).toContain('沿用仍然有效的计划和配置');
    expect(plan).toContain('只有用户明确要求继续，才清除暂停状态');
    expect(plan).toContain('计划完成后，默认按已确认的策略继续，不再追加配置确认');
    expect(build).not.toContain('计划写入后只提供**一个联合决策点**');
  });

  it('keeps autonomous planning, TDD evidence and independent review mandatory where configured', async () => {
    const build = await readSkill(zhSkillRoot, 'comet-build');
    const execution = section(build, '### 3. 执行与验收', '### 3b.');
    const verify = await readSkill(zhSkillRoot, 'comet-verify');

    expect(build).toContain('不能借自主策略跳过设计、计划、配置、验证或独立审查');
    expect(build).toContain('full 流程采用 autonomous 时，必须选择 standard 或 thorough');
    expect(execution).toContain(
      '每个实现任务都必须记录 RED 和对应 GREEN 的命令及真实结果，并确认 RED 的失败原因就是待实现的行为',
    );
    expect(execution).toContain('不回退代码伪造 RED');
    expect(execution).toContain('也必须由独立审查者完成所需审查');
    expect(execution).toContain('无法进行独立审查时停止，不能用自评代替');
    expect(verify).toContain('full autonomous 不允许跳过独立审查');
    expect(verify).toContain('已有审查覆盖当前最终 diff 且仍然有效时，直接复用');
  });

  it('reconciles implementation and evidence before checkoff and treats old-plan sync as a projection', async () => {
    const recovery = await readChineseReference('context-recovery');
    const tasks = section(recovery, '## 任务核对与补勾', '## Runtime 协调记录');

    expect(tasks).toContain('任务完成状态只以 `tasks.md` 为准');
    expect(tasks).toContain('核对当前文件、Git diff/提交、检查结果、审查记录与未解决的反馈');
    expect(tasks).toContain('实现、检查和所需审查均已满足：直接通过 task-complete 补勾');
    expect(tasks).toContain('仅补缺失检查或独立审查');
    expect(tasks).toContain('已有部分实现时仅补剩余部分');
    expect(tasks.indexOf('核对当前文件')).toBeLessThan(tasks.indexOf('comet state task-complete'));
    expect(tasks).toContain('--expect <revision> --json');
    expect(tasks).toContain('revision 冲突时，重新核对任务要求是否变化');
    expect(tasks).toContain('task-complete 会根据 tasks.md 自动同步这些任务在旧计划中的状态');
    expect(tasks).toContain('comet state sync-plan <name>');
    expect(tasks).toContain('mapping-required');
    expect(tasks).toContain('补齐明确的 ID 对应关系后再运行 sync-plan，不重做实现');
    expect(tasks).toContain('旧计划中额外存在的实际任务，先核对范围并纳入 tasks.md');
    expect(tasks).toContain('禁止按序号、位置或相似标题猜测');
  });

  it('uses compact local entry summaries and requests full recovery details only when needed', async () => {
    const recovery = await readChineseReference('context-recovery');
    const entry = section(recovery, '## 阶段入口与按需恢复', '## 任务核对与补勾');

    expect(entry).toContain('`agent.continuation`');
    expect(entry).toContain('信息仍有效时不重复 next、select 或 check');
    expect(entry).toContain('只有这些信息缺失或失效时，才运行一次入口检查');
    expect(entry).toContain('{authority, revision, total, completed, needsIds, next}');
    expect(entry).toContain('{path, stale, taskIds, stage, sessionId, reviewRounds, unresolved}');
    expect(entry).toContain('{kind, reason, taskId?}');
    expect(entry).toContain('先阅读 reason，再根据 kind 完成对应步骤');
    for (const action of [
      'reconcile-task',
      'review',
      'checkoff',
      'check',
      'reconcile-plan',
      'plan',
      'configure',
      'workspace',
      'delivery',
    ]) {
      expect(entry).toContain(action);
    }
    expect(entry).toContain('仅在新会话没有先前上下文、对话被压缩或恢复证据不足时使用');
    expect(entry).toContain('需要完整任务和检查点时，再加 `--details`');
    expect(entry).toContain('在 taskState 中增加 tasks，在 coordination 中增加 checkpoint');
    expect(entry).toContain('comet state check <change-name> <phase> --recover --details --json');
    expect(entry).toContain('恢复时保留计划、任务、审查记录和已用复查次数');
  });

  it('documents structured configuration gaps and bounded Native continuation consumption', async () => {
    const build = await readSkill(zhSkillRoot, 'comet-build');
    const recovery = await readChineseReference('context-recovery');
    const native = await readSkill(zhSkillRoot, 'comet-native');

    expect(build).toContain('`configurationReadiness`');
    expect(build).toContain('只询问 `missingFields` 和 `invalidFields`');
    expect(build).toContain('不重新列成待选择问题');
    expect(recovery).toContain('`configurationReadiness` 的 `missingFields` 与 `invalidFields`');
    expect(native).toContain('只在字段缺失、命令被拒绝或需要额外正文时读取详情');
    expect(native).toContain('不因等待工具超时重复派发');
  });

  it('publishes a usable checkpoint JSON shape and refuses stale or missing records as proof of missing implementation', async () => {
    const recovery = await readChineseReference('context-recovery');
    const checkpoint = section(recovery, '## Runtime 协调记录', '## 各阶段恢复');
    const example = checkpoint.match(/```json\s*([\s\S]*?)```/u)?.[1];
    expect(example).toBeDefined();
    expect(JSON.parse(example!)).toEqual({
      schemaVersion: 1,
      taskIds: ['task-1'],
      revision: '<task-revision>',
      stage: 'implementing',
      sessionId: '<implementer-session-id>',
      evidence: [],
      unresolved: [],
      reviewRounds: 0,
    });
    expect(checkpoint).toContain('必须替换为本次实际值');
    expect(checkpoint).toContain('comet state checkpoint <change-name> --file <json-path>');
    expect(checkpoint).toContain('读取结果为 `{checkpoint, stale}`');
    expect(checkpoint).toContain('stale 为 true 时，先核对 revision、任务范围和实际成果');
    expect(checkpoint).toContain('checkpoint 为空也不表示尚未实施');
    expect(checkpoint).toContain('Runtime 检查数据后生成 Markdown');
    expect(checkpoint).toContain('<classic-change-dir>/.comet/coordination.json');
    expect(checkpoint).toContain('供人阅读的 Markdown 文件为 `.comet/subagent-progress.md`');
    expect(checkpoint).toContain('`.comet/checkpoint.json` 由 Engine 使用，不属于协调记录');
    expect(checkpoint).toContain('不得人工修改或覆盖');
    expect(checkpoint).toContain('保存失败时，停止继续分配任务和推进阶段');
    expect(checkpoint).toContain('不能因为换了会话就重新计算次数');
  });

  it('bounds implementer reuse while preserving per-task acceptance and independent review', async () => {
    const dispatch = await readChineseReference('subagent-dispatch');
    const unit = section(dispatch, '## 如何分组和分配任务', '## 交接与证据');

    expect(unit).toContain('分配时明确 taskIds、允许修改的范围、执行顺序、验收要求和反馈时机');
    expect(unit).toContain('逐 ID 报告、验收和勾选');
    expect(unit).toContain('thorough 允许同一个实现子代理继续工作，但每个任务仍须独立审查');
    expect(unit).toContain('范围变化、依赖冲突或新风险时，暂停受影响的任务');
    expect(unit).toContain('上下文过多，无法可靠保留约束');
    expect(unit).toContain('连续两次反馈仍是同一阻塞，且没有新增实现或证据');
    expect(unit).toContain('先保存检查点，再停止复用该会话');
    expect(unit).toContain('审查子代理（reviewer）始终独立于实现子代理');
    expect(unit).toContain('子代理不再向下派发任务');
    expect(unit).not.toContain('跨任务或角色不复用 agent');
    expect(dispatch).toContain('不能擅自改变用户选定的执行方式');
  });

  it('persists authorization before archive and explicitly verifies delivery before declaring success', async () => {
    const archive = await readSkill(zhSkillRoot, 'comet-archive');
    const authorize = section(archive, '### 1. 请用户确认归档与交付方式', '### 2. 执行归档');
    const complete = section(archive, '### 5. 交付归档提交并完成', '## 退出条件');
    const example = authorize.match(/```json\s*([\s\S]*?)```/u)?.[1];
    expect(example).toBeDefined();
    expect(JSON.parse(example!)).toEqual({
      action: 'push',
      targetBranch: '<confirmed-bound-branch>',
      remote: '<confirmed-remote>',
    });
    expect(authorize.indexOf('comet state delivery <change-name> --file')).toBeLessThan(
      authorize.indexOf('comet state transition <change-name> archive-confirm'),
    );
    expect(authorize).toContain('只有用户选择 A、B 或 C 后');
    expect(authorize).toContain('尚不知道的 commit/prUrl 不得伪造');
    expect(authorize).toContain(
      '普通 `comet state delivery <change-name>` 只读取已保存的记录，入口摘要也不访问网络',
    );
    expect(authorize).toContain('comet state delivery <change-name> --verify');
    expect(authorize).toContain('返回结果为 `{delivery, verification}`');
    expect(authorize).toContain('尚未首次 push');
    expect(authorize).toContain('授权和目标仍然有效时，继续未完成的动作，再用 --verify 核对');
    expect(authorize).toContain('不能仅因为 notVerified/needsVerification 就停止');
    expect(authorize).toContain('unavailable，即网络、权限或服务故障导致无法确定实际结果');
    expect(authorize).toContain('先解决只读核对遇到的问题，不盲目重试 push，也不重复创建 PR');
    expect(authorize).toContain('旧交付授权应失效');
    expect(complete).toContain('调用超时或没有返回明确结果时，先查询实际结果，不能盲目重试');
    expect(complete).toContain('仅填写 commit/prUrl 不等于交付成功');
    expect(complete).toContain('所选动作全部经 Runtime 核对完成后，才运行 clear-selection');
    expect(archive).toContain('不能依赖当前对话回忆用户选过 A、B 还是 C');
    expect(archive).toContain(
      '旧 change 只有 handled 记录、缺少授权、交付目标发生变化，或分支关系与记录不一致时，停止并请用户明确确认',
    );
  });
});

describe('Comet workflow optimization contracts', () => {
  it.each([
    [
      '中文',
      zhSkillRoot,
      '兼容性必须通过实际能力检查，不能只凭版本号判断',
      '根据 OpenSpec 状态逐项生成产物',
    ],
    ['English', skillRoot, 'Check actual capabilities', 'Generate artifacts from OpenSpec state'],
  ])(
    '%s open flow initializes recoverable state before artifact generation',
    async (_language, root, versionMarker, loopMarker) => {
      const skill = await readSkill(root, 'comet-open');
      const init = skill.indexOf('comet state init <name> full');
      const loop = skill.indexOf(loopMarker);

      expect(skill).toContain(versionMarker);
      expect(init).toBeGreaterThan(-1);
      expect(loop).toBeGreaterThan(-1);
      expect(init).toBeLessThan(loop);
      expect(skill).toContain('applyRequires');
      expect(skill).toContain('changeRoot');
      expect(skill).toContain('.comet/batches/');
      expect(skill).toMatch(/proposal[\s\S]*design[\s\S]*tasks/u);
    },
  );

  it.each([
    [
      '中文',
      zhSkillRoot,
      '其他计划执行策略：使用 `writing-plans` Skill',
      '完成后返回 Comet Build',
      '不再次选择执行策略，也不自动进入外部 Skill 的后续流程',
      '主会话直接创建实施计划',
      'Execution Handoff',
    ],
    [
      'English',
      skillRoot,
      'use the `writing-plans` skill for writing and self-checking only',
      'Return to Comet Build',
      "without choosing the strategy again or entering the external skill's subsequent workflow",
      'Create the implementation plan directly in the main session',
      'Execution Handoff',
    ],
  ])(
    '%s build plan generation delegates plan mechanics and returns workflow control',
    async (
      _language,
      root,
      delegation,
      returnMarker,
      ownershipMarker,
      mainSessionMarker,
      handoffMarker,
    ) => {
      const skill = await readSkill(root, 'comet-build');

      expect(skill).toContain(delegation);
      expect(skill).toContain(returnMarker);
      expect(skill).toContain(ownershipMarker);
      expect(skill).not.toContain(mainSessionMarker);
      expect(skill).not.toContain(handoffMarker);
    },
  );

  it.each([
    [
      '中文',
      zhSkillRoot,
      'Design Doc 和状态记录已保存后',
      '压缩只能由用户手动触发时，给出一次非阻塞建议并继续；**不得阻塞**、不得额外制造确认点',
    ],
    [
      'English',
      skillRoot,
      'after the Design Doc and state records are saved',
      'If compression requires a manual user action, offer one nonblocking suggestion and continue. **Do not block** or create another confirmation step',
    ],
  ])(
    '%s design flow makes compaction a post-persistence optimization',
    async (_language, root, after, fallback) => {
      const skill = await readSkill(root, 'comet-design');

      expect(skill).toContain(after);
      expect(skill).toContain(fallback);
    },
  );

  it.each([
    [
      '中文',
      zhSkillRoot,
      '先复现问题并记录失败证据',
      '任务数量本身不触发 `/comet-build`',
      '开始工作时，由用户选择工作区隔离方式',
    ],
    [
      'English',
      skillRoot,
      'reproduce the issue and record the failure',
      'Task count alone does not trigger `/comet-build`',
      'Workspace isolation is a user choice at entry',
    ],
  ])(
    '%s hotfix flow preserves regression evidence without task-count routing',
    async (_language, root, regression, routing, isolationDecision) => {
      const skill = await readSkill(root, 'comet-hotfix');

      expect(skill).toContain(regression);
      expect(skill).toContain(routing);
      expect(skill).toContain(isolationDecision);
    },
  );

  it.each([
    ['中文', zhSkillRoot, '并清除预设专属的 `build_mode`'],
    ['English', skillRoot, 'and clears preset-'],
  ])(
    '%s preset escalation discards lightweight build decisions',
    async (_language, root, resetMarker) => {
      for (const name of ['comet-hotfix', 'comet-tweak']) {
        const skill = await readSkill(root, name);

        expect(skill).toContain(resetMarker);
        expect(skill).toContain('`tdd_mode`');
        expect(skill).toContain('`review_mode`');
        expect(skill).toContain('`isolation`');
        expect(skill).toContain('`verify_mode`');
      }
    },
  );

  it.each([
    ['中文', zhSkillRoot, '接受所有偏差'],
    ['English', skillRoot, 'accept all deviations'],
  ])(
    '%s verification keeps non-waivable failures in verify and lets archive own final delivery state',
    async (_language, root, forbiddenWaiver) => {
      const verify = await readSkill(root, 'comet-verify');
      const archive = await readSkill(root, 'comet-archive');

      expect(verify).not.toContain(forbiddenWaiver);
      expect(verify).not.toContain('finishing-a-development-branch');
      expect(archive).toContain('comet state set <change-name> branch_status handled');
      expect(archive).not.toContain('git add -A');
    },
  );

  it.each([
    [
      'Chinese',
      zhSkillRoot,
      '### 1. 请用户确认归档与交付方式',
      '### 2. 执行归档',
      '### 5. 交付归档提交并完成',
      '「确认归档并立即推送」',
      '「确认归档、立即推送并创建 PR」',
      '不运行 `archive-confirm` 或归档命令',
      '保留未归档的 change、`phase: archive` 和 `branch_status: pending`',
      'handled 只是兼容旧流程的状态字段，不能表示用户已授权 local/push/pr，也不能证明这些动作已成功',
      '归档阶段不再调用 Superpowers `finishing-a-development-branch`',
      '使用 Skill 工具加载 Superpowers',
    ],
    [
      'English',
      skillRoot,
      '### 1. Ask the user to confirm archive and delivery',
      '### 2. Run archive',
      '### 5. Deliver the archive commit and finish',
      'Confirm archive and push now',
      'Confirm archive, push, and create a PR',
      'Do not run archive-confirm or archive, commit, or push',
      'Keep the unarchived change, `phase: archive`, and `branch_status: pending`',
      'handled is only a legacy compatibility field. It neither authorizes local/push/pr nor proves those actions succeeded',
      'Do not invoke Superpowers `finishing-a-development-branch` in Archive',
      'use the Skill tool to load Superpowers',
    ],
  ])(
    '%s archive persists the confirmed delivery choice in its only commit',
    async (
      _language,
      root,
      confirmationHeading,
      executionHeading,
      deliveryHeading,
      pushChoice,
      prChoice,
      deferMarker,
      activeMarker,
      handledMeaning,
      noFinishingMarker,
      forbiddenLoadMarker,
    ) => {
      const archive = await readSkill(root, 'comet-archive');
      const confirmation = archive.indexOf(confirmationHeading);
      const execution = archive.indexOf(executionHeading);
      const handled = archive.indexOf(
        'comet state set <change-name> branch_status handled',
        execution,
      );
      const commit = archive.indexOf('git commit -m "chore: archive <change-name>"', handled);
      const delivery = archive.indexOf(deliveryHeading, commit);
      const clearSelection = archive.indexOf('clear-selection', delivery);

      expect(confirmation).toBeGreaterThan(-1);
      expect(confirmation).toBeLessThan(execution);
      expect(archive).toContain(pushChoice);
      expect(archive).toContain(prChoice);
      expect(archive).toContain(deferMarker);
      expect(archive).toContain(activeMarker);
      expect(handled).toBeGreaterThan(execution);
      expect(handled).toBeLessThan(commit);
      expect(commit).toBeLessThan(delivery);
      expect(clearSelection).toBeGreaterThan(delivery);
      expect(archive).toContain(handledMeaning);
      expect(archive).toContain(noFinishingMarker);
      expect(archive).not.toContain(forbiddenLoadMarker);
    },
  );

  it.each([
    ['中文', zhSkillRoot],
    ['English', skillRoot],
  ])(
    '%s primary workflow docs use stable cross-platform Comet commands',
    async (_language, root) => {
      const names = [
        'comet',
        'comet-open',
        'comet-design',
        'comet-build',
        'comet-hotfix',
        'comet-tweak',
        'comet-verify',
        'comet-archive',
      ];
      const contents = await Promise.all(names.map((name) => readSkill(root, name)));

      for (const content of contents) {
        expect(content).not.toMatch(/node "\$COMET_(?:STATE|GUARD|HANDOFF|ARCHIVE)"/u);
        expect(content).not.toContain('"$COMET_BASH"');
        expect(content).not.toMatch(/`comet-(?:state|guard|handoff)(?:\.mjs)?\s/u);
        expect(content).not.toMatch(/\bgrep\b|\bsed\b|\bhead\b|mkdir -p|\$\(/u);
      }
    },
  );

  it.each([
    ['中文', zhSkillRoot, '明确要求使用 Comet 但未指定 Native/Classic'],
    ['English', skillRoot, 'asks to use Comet without choosing Native or Classic'],
  ])(
    '%s phase skill descriptions cannot bypass root routing',
    async (_language, root, rootTrigger) => {
      const rootDescription = descriptionOf(await readSkill(root, 'comet'));

      expect(rootDescription).toContain('/comet');
      expect(rootDescription).toContain(rootTrigger);
      expect(rootDescription).not.toContain('active Comet change');

      for (const name of [
        'comet-open',
        'comet-design',
        'comet-build',
        'comet-hotfix',
        'comet-tweak',
        'comet-verify',
        'comet-archive',
      ]) {
        const description = descriptionOf(await readSkill(root, name));

        // A phase may name its own invocation; it cannot claim the root `/comet` trigger.
        expect(description, name).not.toBe('');
        expect(description, name).not.toContain(rootTrigger);
        expect(description, name).not.toMatch(/(^|[^-])\/comet(?![\w-])/u);
      }

      const anyDescription = descriptionOf(await readSkill(root, 'comet-any'));
      expect(anyDescription).toMatch(/不用于一般 Skill|Not for general Skill/u);
    },
  );

  it.each([
    [
      '中文',
      zhSkillRoot,
      '### 1b. 整理需求并确定 Change 名称',
      '范围与命名都明确时直接继续',
      '最终审视同时确认 change 名称、范围和产物内容',
    ],
    [
      'English',
      skillRoot,
      '### 1b. Summarize requirements and choose the change name',
      'Continue directly when scope and name are clear',
      'This final review confirms the change name, scope, and artifact content together',
    ],
  ])(
    '%s open flow avoids a redundant pre-artifact confirmation',
    async (_language, root, heading, continueMarker, finalReviewMarker) => {
      const skill = await readSkill(root, 'comet-open');

      expect(skill).toContain(heading);
      expect(skill).toContain(continueMarker);
      expect(skill).toContain(finalReviewMarker);
      expect(skill).not.toMatch(
        /需求与 Change 名称联合确认|Requirements and Change Name Joint Confirmation/u,
      );
    },
  );

  it.each([
    [
      '中文',
      zhSkillRoot,
      '工作区必须已在 Open 阶段准备并绑定',
      '保留 isolation、bound_branch 和已有暂停状态',
      '不能在 Build 新建或切换工作区',
      '在同一轮提问中收集执行方式、TDD 和审查模式',
      '`subagent-driven-development`',
      'comet state set <name> build_mode autonomous subagent_dispatch null tdd_mode tdd review_mode standard --json',
      '推荐不能代替用户确认',
    ],
    [
      'English',
      skillRoot,
      'Open must already have prepared and bound the workspace',
      'Preserve isolation, bound_branch, and any existing pause',
      'Do not create or switch workspaces in Build',
      'collect execution mode, TDD, and review mode together',
      '`subagent-driven-development`',
      'comet state set <name> build_mode autonomous subagent_dispatch null tdd_mode tdd review_mode standard --json',
      'Recommendations do not replace user confirmation',
    ],
  ])(
    '%s build flow exposes one joint configuration decision',
    async (
      _language,
      root,
      workspaceOwnership,
      preservedBinding,
      noWorkspaceMutation,
      jointDecision,
      executionOption,
      reviewCommand,
      noAutoSelect,
    ) => {
      const skill = await readSkill(root, 'comet-build');

      expect(skill).toContain(workspaceOwnership);
      expect(skill).toContain(preservedBinding);
      expect(skill).toContain(noWorkspaceMutation);
      expect(skill).toContain(jointDecision);
      expect(skill).toContain(executionOption);
      expect(skill).toContain(reviewCommand);
      expect(skill).toContain(noAutoSelect);
      expect(skill).not.toMatch(/当前平台能力|platform capabilities/u);
      expect(skill).not.toMatch(
        /必须暂停等待用户改选 `executing-plans`|must pause and wait for the user to choose main-window execution/u,
      );
    },
  );

  it.each([
    [
      '中文',
      zhSkillRoot,
      'Verify 负责整个 change 的唯一最终集成代码审查',
      'Build 只做任务或分段审查',
      '与 build 阶段审查的去重',
      '从 plan frontmatter 读取的 base-ref',
    ],
    [
      'English',
      skillRoot,
      'Verify owns the single final integration code review for the whole change',
      'Build reviews tasks or sections only',
      'Deduplication with build-stage review',
      'base-ref read from plan frontmatter',
    ],
  ])(
    '%s verify owns final integrated review and scale owns its baseline resolution',
    async (_language, root, finalReviewOwner, buildBoundary, duplicateReview, manualBaseline) => {
      const build = await readSkill(root, 'comet-build');
      const verify = await readSkill(root, 'comet-verify');

      expect(build).toContain(buildBoundary);
      expect(verify).toContain(finalReviewOwner);
      expect(verify).not.toContain(duplicateReview);
      expect(verify).not.toContain(manualBaseline);
    },
  );

  it.each([
    [
      '中文',
      zhSkillRoot,
      '归档与交付方式合并为同一个最终确认',
      'full workflow 的 `isolation` 可为 `current`、`branch` 或 `worktree`',
      'finishing-branch',
    ],
    [
      'English',
      skillRoot,
      'Archive and delivery method are combined into one final confirmation',
      'Full-workflow `isolation` may be `current`, `branch`, or `worktree`',
      'finishing-branch',
    ],
  ])(
    '%s Classic entry exposes one archive decision and the real isolation contract',
    async (_language, root, archiveOwnership, isolationContract, staleFinishing) => {
      const skill = await readSkill(root, 'comet-classic');

      expect(skill).toContain(archiveOwnership);
      expect(skill).toContain(isolationContract);
      expect(skill).not.toContain(staleFinishing);
    },
  );

  it.each([
    [
      '中文',
      zhSkillRoot,
      '记录实际原因，停止对应任务的执行与审查',
      '不能擅自改变用户选定的执行方式',
      '暂停并等待用户改选 executing-plans:',
    ],
    [
      'English',
      skillRoot,
      'Record dispatch/session failures and stop the affected loop',
      'without silently changing the selected strategy',
      'pause and wait for the user to choose executing-plans:',
    ],
  ])(
    '%s dispatch failure records a blocked task without manufacturing a new choice',
    async (_language, root, stopMarker, blockedMarker, stalePause) => {
      const dispatch = await fs.readFile(
        path.join(root, 'comet-classic', 'reference', 'subagent-dispatch.md'),
        'utf8',
      );

      expect(dispatch).toContain(stopMarker);
      expect(dispatch).toContain(blockedMarker);
      expect(dispatch).not.toContain(stalePause);
    },
  );

  it.each([
    [
      '中文',
      zhSkillRoot,
      '前 3 次可修复的失败自动回到 build',
      '只有接受 WARNING/SUGGESTION 偏差或第 4 次失败后的策略选择才是用户决策点',
      '验证不通过时**必须按',
    ],
    [
      'English',
      skillRoot,
      'Automatically return to Build for the first 3 repairable failures',
      'Accepting WARNING/SUGGESTION deviations or choosing a strategy after the fourth failure requires a user decision',
      'When verification does not pass, **must follow',
    ],
  ])(
    '%s verify flow repairs objective failures without unnecessary pauses',
    async (_language, root, automaticRepair, realDecision, oldBlanketPause) => {
      const skill = await readSkill(root, 'comet-verify');

      expect(skill).toContain(automaticRepair);
      expect(skill).toContain(realDecision);
      expect(skill).not.toContain(oldBlanketPause);
    },
  );

  it.each([
    [
      '中文',
      zhSkillRoot,
      '区分用户决策点、自动处理与停止条件',
      '`NEXT: manual` 只是交还控制权，不是新的用户决策点',
    ],
    [
      'English',
      skillRoot,
      'Distinguish user decisions, automatic handling, and stop conditions',
      '`NEXT: manual` returns control; it is not a new user decision point',
    ],
  ])(
    '%s decision protocol does not manufacture choices for deterministic handling',
    async (_language, root, classification, manualHandoff) => {
      const protocol = await fs.readFile(
        path.join(root, 'comet-classic', 'reference', 'decision-point.md'),
        'utf8',
      );

      expect(protocol).toContain(classification);
      expect(protocol).toContain(manualHandoff);
    },
  );

  it.each([
    [
      '中文',
      zhSkillRoot,
      '必须先区分四类情况：用户决策、自动处理、停止条件和手动衔接',
      '清晰的首次调用、可确定修复的 guard 失败、单一合法下一步和 `NEXT: manual` 都不得制造确认点',
      'internal Node Skill 的 description 允许普通任务直接触发',
      '首次调用，无 workflow 状态',
      'Node guard 失败且原因不明',
    ],
    [
      'English',
      skillRoot,
      'First distinguish four categories: user decision, automatic handling, stop condition, and manual handoff',
      'A clear first invocation, an objectively repairable guard failure, a sole valid next action, and `NEXT: manual` must not manufacture confirmation',
      'an internal Node Skill description allows ordinary tasks to trigger it',
      'First invocation, no workflow state exists',
      'Node fails its guard and the cause is unclear',
    ],
  ])(
    '%s creator templates preserve trigger boundaries and decision classification',
    async (
      _language,
      root,
      pauseClassification,
      entryClassification,
      reviewerBoundary,
      staleFirstPause,
      staleGuardPause,
    ) => {
      const creatorRoot = path.join(root, 'comet-any', 'reference');
      const pauseAuthor = await fs.readFile(
        path.join(creatorRoot, 'subagents', 'pause-points-author.md'),
        'utf8',
      );
      const entryAuthor = await fs.readFile(
        path.join(creatorRoot, 'subagents', 'workflow-entry-author.md'),
        'utf8',
      );
      const reviewer = await fs.readFile(
        path.join(creatorRoot, 'subagents', 'skill-reviewer.md'),
        'utf8',
      );
      const example = await fs.readFile(path.join(creatorRoot, 'authored-zone-example.md'), 'utf8');

      expect(pauseAuthor).toContain(pauseClassification);
      expect(entryAuthor).toContain(entryClassification);
      expect(reviewer).toContain(reviewerBoundary);
      expect(example).not.toContain(staleFirstPause);
      expect(example).not.toContain(staleGuardPause);
    },
  );

  it('keeps Classic isolation choices user-controlled while making parallel worktree guidance explicit', async () => {
    const variants = [
      {
        language: 'zh' as const,
        required: [
          '当前目录有未提交改动',
          '已有其他尚未归档的 Classic change',
          '| A | 当前目录（`current`）',
          '| B | 新分支（`branch`）',
          '| C | 新 worktree（`worktree`）',
          '推荐只作说明',
          '直接使用 `worktree`',
        ],
      },
      {
        language: 'en' as const,
        required: [
          'current directory has uncommitted work',
          'Another active Classic change already exists',
          '| A | Current directory (`current`)',
          '| B | New branch (`branch`)',
          '| C | New worktree (`worktree`)',
          'A recommendation is explanatory only',
          'select `worktree` directly',
        ],
      },
    ];
    for (const variant of variants) {
      const workspaceRoot = variant.language === 'zh' ? zhSkillRoot : skillRoot;
      const workspace = await fs.readFile(
        path.join(workspaceRoot, 'comet-classic', 'reference', 'workspace.md'),
        'utf8',
      );
      for (const term of variant.required) {
        expect(workspace.replace(/ {2,}/gu, ' '), `${variant.language}: ${term}`).toContain(term);
      }
    }
  });
});

describe('Approved English Classic efficiency contracts', () => {
  const reference = (name: string) =>
    fs.readFile(path.join(skillRoot, 'comet-classic', 'reference', name + '.md'), 'utf8');

  it('configures before planning and retains autonomous safety and explicit continuation', async () => {
    const build = await readSkill(skillRoot, 'comet-build');
    const config = section(build, '### 1. Confirm', '### 2. Create');
    const plan = section(build, '### 2. Create', '### 3. Implement');
    expect(config).toContain('Confirm the execution strategy before writing a plan.');
    expect(config).toContain("must not automatically replace an existing change's strategy");
    expect(config).toContain('without writing partial configuration');
    expect(config).toContain(
      'build_mode autonomous subagent_dispatch null tdd_mode tdd review_mode standard --json',
    );
    expect(plan).toContain('without loading writing-plans');
    expect(plan).toContain('only after the user explicitly asks to continue');
    expect(build).toContain(
      'Autonomous does not permit skipping design, planning, configuration, verification, or independent review',
    );
    expect(build).toContain(
      'every implementation task must record actual RED and corresponding GREEN commands/results',
    );
    expect(build).toContain(
      'reenacting verified implementation or reverting code to fabricate RED',
    );
    expect(build).toContain(
      'Stop if independent review is unavailable; self-review is not a substitute',
    );
    expect(await readSkill(skillRoot, 'comet-verify')).toContain(
      'Full autonomous cannot skip independent review',
    );
  });

  it('reconciles actual implementation before checkoff rather than rerunning an old plan', async () => {
    const recovery = await reference('context-recovery');
    const tasks = section(recovery, '## Task Reconciliation', '## Runtime Coordination');
    expect(tasks).toContain('sole');
    expect(tasks).toContain('Git diff');
    expect(tasks).toContain('comet state task-complete');
    expect(tasks.indexOf('Git diff')).toBeLessThan(tasks.indexOf('comet state task-complete'));
    expect(tasks).toContain('--expect <revision> --json');
    expect(tasks).toContain('mapping-required');
    expect(tasks).toContain('comet state sync-plan <name>');
    expect(tasks).toContain('comet-task');
    expect(tasks).toContain('extra');
  });

  it('keeps normal entry compact and documents valid isolated coordination JSON for cold recovery', async () => {
    const recovery = await reference('context-recovery');
    expect(recovery).toContain('Run one entry check only when it is missing or no longer valid');
    expect(recovery).toContain('{authority, revision, total, completed, needsIds, next}');
    expect(recovery).toContain('{kind, reason, taskId?}');
    expect(recovery).toContain('--recover --details --json');
    expect(recovery).toContain('this adds tasks to taskState and checkpoint to coordination');
    const checkpoint = section(recovery, '## Runtime Coordination', '## Phase-Specific');
    expect(JSON.parse(checkpoint.match(/```json\s*([\s\S]*?)```/u)![1])).toEqual({
      schemaVersion: 1,
      taskIds: ['task-1'],
      revision: '<task-revision>',
      stage: 'implementing',
      sessionId: '<implementer-session-id>',
      evidence: [],
      unresolved: [],
      reviewRounds: 0,
    });
    expect(checkpoint).toContain('.comet/coordination.json');
    expect(checkpoint).toContain('.comet/checkpoint.json');
    expect(checkpoint).toContain('Engine');
    expect(checkpoint).toContain('{checkpoint, stale}');
  });

  it('bounds reuse and retains independent review, per-ID acceptance and stalled-session exit', async () => {
    const dispatch = await reference('subagent-dispatch');
    const unit = section(dispatch, '## Grouping and Assigning Tasks', '## Handoff');
    for (const term of [
      'Specify taskIds, allowed scope, execution order, acceptance requirements, and reporting times',
      'Report, accept, and check off each ID',
      'independent per-task review',
      'context pressure prevents reliable retention of constraints',
      'two consecutive reports repeat the same blocker without new implementation/evidence',
      'Save a checkpoint and end reuse',
      'Reviewers remain independent of implementers',
      'Subagents do not nest dispatch',
    ])
      expect(unit).toContain(term);
  });

  it('persists explicit authorization before archive and distinguishes missing delivery from unavailable verification', async () => {
    const archive = await readSkill(skillRoot, 'comet-archive');
    const authorize = section(archive, '### 1. Ask the user', '### 2. Run archive');
    expect(authorize.indexOf('comet state delivery <change-name> --file')).toBeLessThan(
      authorize.indexOf('comet state transition <change-name> archive-confirm'),
    );
    expect(JSON.parse(authorize.match(/```json\s*([\s\S]*?)```/u)![1])).toEqual({
      action: 'push',
      targetBranch: '<confirmed-bound-branch>',
      remote: '<confirmed-remote>',
    });
    for (const term of [
      'Only after the user chooses A, B, or C',
      'Do not fabricate unknown commit/prUrl',
      'entry summary does not access the network',
      'comet state delivery <change-name> --verify',
      '{delivery, verification}',
      'no first push',
      'if authorization and target remain valid, perform the missing action',
      'Do not stop solely because of notVerified/needsVerification',
      'unavailable, meaning network, permission, or service failures',
      'do not blindly retry push or create duplicate PRs',
      'old delivery authorization must be invalidated',
    ])
      expect(authorize).toContain(term);
    expect(archive).toContain('Merely filling commit/prUrl does not prove delivery');
    expect(archive).toContain('only after Runtime verifies every selected action');
    expect(archive).toContain(
      'Do not infer archive, push, or PR authorization solely from branch_status: handled',
    );
  });
});
