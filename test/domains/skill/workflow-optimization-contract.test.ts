import { promises as fs } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const skillRoot = path.resolve('assets', 'skills');
const zhSkillRoot = path.resolve('assets', 'skills-zh');

async function readSkill(root: string, name: string): Promise<string> {
  return fs.readFile(path.join(root, name, 'SKILL.md'), 'utf8');
}

function descriptionOf(skill: string): string {
  return skill.match(/^description:\s*"([^"]+)"/mu)?.[1] ?? '';
}

describe('Comet workflow optimization contracts', () => {
  it.each([
    ['中文', zhSkillRoot, 'OpenSpec >= 1.5.0', 'OpenSpec 状态驱动产物循环'],
    ['English', skillRoot, 'OpenSpec >= 1.5.0', 'OpenSpec status-driven artifact loop'],
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
    ['中文', zhSkillRoot, 'Design Doc 和状态证据落盘后', '无法程序化触发时不得阻塞'],
    [
      'English',
      skillRoot,
      'after the Design Doc and state evidence are persisted',
      'must not block when programmatic compaction is unavailable',
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
      '入口工作区隔离是用户决策点',
    ],
    [
      'English',
      skillRoot,
      'reproduce the bug and record failing evidence first',
      'task count alone does not route to `/comet-build`',
      'Entry workspace isolation is a user decision point',
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
    ['English', skillRoot, 'and clears preset-only `build_mode`'],
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
    '%s verification keeps non-waivable failures in verify and moves branch handling after archive',
    async (_language, root, forbiddenWaiver) => {
      const verify = await readSkill(root, 'comet-verify');
      const archive = await readSkill(root, 'comet-archive');

      expect(verify).not.toContain(forbiddenWaiver);
      expect(verify).not.toContain('finishing-a-development-branch');
      expect(archive).toContain('finishing-a-development-branch');
      expect(archive).toContain('comet state set <change-name> branch_status handled');
      expect(archive).not.toContain('git add -A');
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
    ['中文', zhSkillRoot, '仅在用户明确调用', '或由 Comet 根 Skill/runtime'],
    [
      'English',
      skillRoot,
      'Use only when explicitly invoked',
      'or routed by the root Comet skill/runtime',
    ],
  ])(
    '%s phase skill descriptions cannot bypass root routing',
    async (_language, root, explicitMarker, routedMarker) => {
      const rootDescription = descriptionOf(await readSkill(root, 'comet'));

      expect(rootDescription).toContain('/comet');
      expect(rootDescription).toContain('active Comet change');

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

        expect(description, name).toContain(explicitMarker);
        expect(description, name).toContain(routedMarker);
      }

      const anyDescription = descriptionOf(await readSkill(root, 'comet-any'));
      expect(anyDescription).toMatch(/不要用于一般 Skill|Do not use for general Skill/u);
    },
  );

  it.each([
    [
      '中文',
      zhSkillRoot,
      '### 1b. 需求与 Change 名称解析（默认不阻塞）',
      '范围与命名都明确时直接继续',
      '最终审视同时确认 change 名称、范围和产物内容',
    ],
    [
      'English',
      skillRoot,
      '### 1b. Resolve Requirements and Change Name (Non-blocking by Default)',
      'Continue directly when scope and naming are both unambiguous',
      'The final review confirms the change name, scope, and artifact content together',
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
      '展示联合决策前先检查当前平台能力',
      '分支名也必须在 Step 2 的同一个联合决策中确认',
      '使用 Step 2 已确认的分支名，不得再次暂停',
    ],
    [
      'English',
      skillRoot,
      'Check current platform capabilities before presenting the joint decision',
      'The branch name must be confirmed in the same Step 2 joint decision',
      'Use the branch name already confirmed in Step 2; do not pause again',
    ],
  ])(
    '%s build flow has one executable configuration decision',
    async (_language, root, preflight, jointBranch, noSecondPause) => {
      const skill = await readSkill(root, 'comet-build');

      expect(skill).toContain(preflight);
      expect(skill).toContain(jointBranch);
      expect(skill).toContain(noSecondPause);
      expect(skill).not.toMatch(
        /必须暂停等待用户改选 `executing-plans`|must pause and wait for the user to choose main-window execution/u,
      );
    },
  );

  it.each([
    [
      '中文',
      zhSkillRoot,
      '返回 `/comet-build` Step 2 的同一个联合决策',
      '只剩一个合法模式时直接采用',
      '暂停并等待用户改选 `build_mode: executing-plans`',
    ],
    [
      'English',
      skillRoot,
      'Return to the same `/comet-build` Step 2 joint decision',
      'apply the only valid mode directly when just one remains',
      'pause and wait for the user to choose `build_mode: executing-plans`',
    ],
  ])(
    '%s dispatch capability loss reuses the build decision instead of adding a pause',
    async (_language, root, returnMarker, singleModeMarker, stalePause) => {
      const dispatch = await fs.readFile(
        path.join(root, 'comet', 'reference', 'subagent-dispatch.md'),
        'utf8',
      );

      expect(dispatch).toContain(returnMarker);
      expect(dispatch).toContain(singleModeMarker);
      expect(dispatch).not.toContain(stalePause);
    },
  );

  it.each([
    [
      '中文',
      zhSkillRoot,
      '前 3 次可修复失败自动回到 build',
      '只有接受 WARNING/SUGGESTION 偏差或第 4 次失败后的策略选择才是用户决策点',
      '验证不通过时**必须按',
    ],
    [
      'English',
      skillRoot,
      'Automatically return to build for the first 3 repairable failures',
      'Only accepting WARNING/SUGGESTION deviations or choosing a strategy after the 4th failure is a user decision point',
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
        path.join(root, 'comet', 'reference', 'decision-point.md'),
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
});
