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
    [
      '中文',
      zhSkillRoot,
      '使用 `writing-plans` Skill 创建实施计划',
      '计划完成后返回 Comet Build',
      '由 Comet 统一处理后续执行配置',
      '主会话直接创建实施计划',
      'Execution Handoff',
    ],
    [
      'English',
      skillRoot,
      'Use the `writing-plans` Skill to create the implementation plan',
      'return to Comet Build after the plan is complete',
      'Comet owns the subsequent execution configuration',
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
      'Design Doc 和状态证据落盘后',
      '压缩只能由用户手动触发时，给出一次非阻塞建议并继续；**不得阻塞**、不得额外制造确认点',
    ],
    [
      'English',
      skillRoot,
      'after the Design Doc and state evidence are persisted',
      'If compaction requires user action, give one non-blocking suggestion and continue; it **must not block** and must not create another confirmation point',
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
      '### 1. 归档与交付前最终确认（阻塞点）',
      '### 2. 执行归档',
      '### 5. 交付归档提交并完成',
      '「确认归档并立即推送」',
      '「确认归档、立即推送并创建 PR」',
      '不运行 `archive-confirm` 或归档命令',
      '保留 active change、`phase: archive` 和 `branch_status: pending`',
      '`handled` 只表示用户已经确认如何处理这次完整归档提交，包括仅保留本地、推送或推送并创建 PR；不表示 push 或 PR 创建已经成功',
      '归档阶段不再调用 Superpowers `finishing-a-development-branch`',
      '使用 Skill 工具加载 Superpowers',
    ],
    [
      'English',
      skillRoot,
      '### 1. Final Archive and Delivery Confirmation (Blocking Point)',
      '### 2. Execute Archive',
      '### 5. Deliver the Archive Commit and Complete',
      '"Confirm archive and push now"',
      '"Confirm archive, push now, and create a PR"',
      'Do not run `archive-confirm` or the archive command',
      'keep the active change, `phase: archive`, and `branch_status: pending`',
      '`handled` means only that the user confirmed how to handle this complete archive commit, including keeping it local, pushing it, or pushing it and creating a PR. It does not mean that push or PR creation has succeeded',
      'Archive no longer invokes Superpowers `finishing-a-development-branch`',
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
      const clearSelection = archive.indexOf('comet state clear-selection', delivery);

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

        // Phase/preset skills are user-invoked (disable-model-invocation: true) and
        // must never pose as the root entry: no root trigger phrase, no bare `/comet`.
        expect(description, name).not.toContain(rootTrigger);
        expect(description, name).not.toMatch(/(^|[^-])\/comet(?!\w)/u);
      }

      const anyDescription = descriptionOf(await readSkill(root, 'comet-any'));
      expect(anyDescription).toMatch(/不用于一般 Skill|Not for general Skill/u);
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
      '工作区已经在 Open 阶段准备并绑定',
      '保留 Open 阶段已绑定的 `isolation`',
      '不得在 Build 再创建 Worktree',
      '计划写入后只提供**一个联合决策点**',
      'Superpowers `subagent-driven-development`',
      'comet state set <name> review_mode <off|standard|thorough>',
      '不得自动选择',
    ],
    [
      'English',
      skillRoot,
      'The workspace was prepared and bound during Open',
      'preserve the `isolation` and `bound_branch` established during Open',
      'do not create a Worktree',
      'provide exactly **one joint decision point**',
      'Superpowers `subagent-driven-development`',
      'comet state set <name> review_mode <off|standard|thorough>',
      'Do not auto-select',
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
      'Build 只保留任务级或分段审查',
      '与 build 阶段审查的去重',
      '从 plan frontmatter 读取的 base-ref',
    ],
    [
      'English',
      skillRoot,
      'Verify owns the only final integrated code review for the entire change',
      'Build keeps only task-level or segmented reviews',
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
      '子代理派发操作失败属于运行停止条件',
      '不得继续派发或由主会话代写实现',
      '暂停并等待用户改选 `build_mode: executing-plans`',
    ],
    [
      'English',
      skillRoot,
      'A subagent-dispatch failure is a runtime stop condition',
      'stop dispatching and do not let the main session implement the task',
      'pause and wait for the user to choose `build_mode: executing-plans`',
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
          '当前目录有未提交工作',
          '已有其他 active Classic change',
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
        expect(workspace, `${variant.language}: ${term}`).toContain(term);
      }
    }
  });
});
