import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  getAssetsDir,
  readManifest,
  getManifestSkills,
  createWorkingDirs,
  copyCometSkillsForPlatform,
} from '../../src/core/skills.js';
import type { Platform } from '../../src/core/platforms.js';

describe('skills', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `comet-skills-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('getAssetsDir', () => {
    it('returns a path ending with assets', () => {
      const assetsDir = getAssetsDir();
      expect(path.basename(assetsDir)).toBe('assets');
    });
  });

  describe('readManifest', () => {
    it('reads and parses the manifest.json', async () => {
      const manifest = await readManifest();
      expect(manifest).toHaveProperty('version');
      expect(manifest).toHaveProperty('skills');
      expect(Array.isArray(manifest.skills)).toBe(true);
      expect(manifest.skills.length).toBeGreaterThan(0);
    });
  });

  describe('getManifestSkills', () => {
    it('returns the skills array from manifest', async () => {
      const skills = await getManifestSkills();
      expect(Array.isArray(skills)).toBe(true);
      expect(skills.length).toBeGreaterThan(0);
      expect(skills.some((s) => s.includes('comet/SKILL.md'))).toBe(true);
    });
  });

  describe('createWorkingDirs', () => {
    it('creates superpowers spec and plan directories', async () => {
      await createWorkingDirs(tmpDir);

      const specsDir = path.join(tmpDir, 'docs', 'superpowers', 'specs');
      const plansDir = path.join(tmpDir, 'docs', 'superpowers', 'plans');

      await expect(fs.stat(specsDir)).resolves.toBeDefined();
      await expect(fs.stat(plansDir)).resolves.toBeDefined();
    });

    it('does not throw when directories already exist', async () => {
      await createWorkingDirs(tmpDir);
      await expect(createWorkingDirs(tmpDir)).resolves.not.toThrow();
    });
  });

  describe('copyCometSkillsForPlatform', () => {
    const mockPlatform: Platform = {
      id: 'claude',
      name: 'Claude Code',
      skillsDir: '.claude',
      openspecToolId: 'claude',
    };

    it('copies skill files from assets to platform skills directory', async () => {
      const result = await copyCometSkillsForPlatform(tmpDir, mockPlatform, false);
      expect(result.copied).toBeGreaterThan(0);
      expect(result.skipped).toBe(0);

      // Verify a key file was copied
      const cometSkillPath = path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md');
      expect(await fileExists(cometSkillPath)).toBe(true);
    });

    it('skips existing files when overwrite is false', async () => {
      // First copy
      await copyCometSkillsForPlatform(tmpDir, mockPlatform, false);
      // Second copy should skip all
      const result = await copyCometSkillsForPlatform(tmpDir, mockPlatform, false);
      expect(result.copied).toBe(0);
      expect(result.skipped).toBeGreaterThan(0);
    });

    it('overwrites existing files when overwrite is true', async () => {
      await copyCometSkillsForPlatform(tmpDir, mockPlatform, false);
      const result = await copyCometSkillsForPlatform(tmpDir, mockPlatform, true);
      expect(result.copied).toBeGreaterThan(0);
    });

    it('copies to Chinese skills directory when language is zh', async () => {
      const result = await copyCometSkillsForPlatform(tmpDir, mockPlatform, false, 'skills-zh');
      expect(result.copied).toBeGreaterThan(0);

      // Chinese SKILL.md should exist
      const zhSkillPath = path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md');
      expect(await fileExists(zhSkillPath)).toBe(true);
    });

    it('creates OpenCode slash commands for copied Comet skills', async () => {
      const opencodePlatform: Platform = {
        id: 'opencode',
        name: 'OpenCode',
        skillsDir: '.opencode',
        globalSkillsDir: '.config/opencode',
        openspecToolId: 'opencode',
      };

      const result = await copyCometSkillsForPlatform(tmpDir, opencodePlatform, false);

      expect(result.copied).toBeGreaterThan(0);
      const commandPath = path.join(tmpDir, '.opencode', 'commands', 'comet-open.md');
      const command = await fs.readFile(commandPath, 'utf-8');

      expect(command).toContain('description: Run the comet-open Comet workflow');
      expect(command).toContain('Equivalent Comet skill: `comet-open`');
      expect(command).toContain(
        'Use the invocation arguments below as the user input for this workflow:',
      );
      expect(command).toContain('$ARGUMENTS');
      expect(command).toContain('# Comet Phase 1: Open');
      expect(command).toContain('## Steps');
      expect(command).toContain('"$COMET_BASH" "$COMET_STATE" init <name> full');
      expect(command).not.toContain('Immediately load the `comet-open` skill with the skill tool');
      expect(path.basename(commandPath)).toBe('comet-open.md');
    });

    it('creates OpenCode slash commands from the selected language skill content', async () => {
      const opencodePlatform: Platform = {
        id: 'opencode',
        name: 'OpenCode',
        skillsDir: '.opencode',
        globalSkillsDir: '.config/opencode',
        openspecToolId: 'opencode',
      };

      await copyCometSkillsForPlatform(tmpDir, opencodePlatform, false, 'skills-zh');

      const commandPath = path.join(tmpDir, '.opencode', 'commands', 'comet-open.md');
      const command = await fs.readFile(commandPath, 'utf-8');

      expect(command).toContain('description: Run the comet-open Comet workflow');
      expect(command).toContain('Equivalent Comet skill: `comet-open`');
      expect(command).toContain('# Comet 阶段 1：开启（Open）');
      expect(command).toContain('## 步骤');
      expect(command).not.toContain('# Comet Phase 1: Open');
      expect(path.basename(commandPath)).toBe('comet-open.md');
    });

    it('creates OpenCode slash commands in the global OpenCode config directory', async () => {
      const opencodePlatform: Platform = {
        id: 'opencode',
        name: 'OpenCode',
        skillsDir: '.opencode',
        globalSkillsDir: '.config/opencode',
        openspecToolId: 'opencode',
      };

      await copyCometSkillsForPlatform(tmpDir, opencodePlatform, false, 'skills', 'global');

      await expect(
        fs.access(path.join(tmpDir, '.config', 'opencode', 'commands', 'comet.md')),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(tmpDir, '.opencode', 'commands', 'comet.md')),
      ).rejects.toThrow();
    });
  });

  describe('Chinese Comet workflow safeguards', () => {
    it('requires explicit user confirmation at full-workflow decision points', async () => {
      const zhComet = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet', 'SKILL.md'),
        'utf-8',
      );
      const zhOpen = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet-open', 'SKILL.md'),
        'utf-8',
      );
      const zhDesign = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet-design', 'SKILL.md'),
        'utf-8',
      );
      const zhBuild = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet-build', 'SKILL.md'),
        'utf-8',
      );
      const zhVerify = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet-verify', 'SKILL.md'),
        'utf-8',
      );
      const zhArchive = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet-archive', 'SKILL.md'),
        'utf-8',
      );
      const zhHotfix = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet-hotfix', 'SKILL.md'),
        'utf-8',
      );
      const zhTweak = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet-tweak', 'SKILL.md'),
        'utf-8',
      );
      const zhCometRule = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'rules', 'comet-phase-guard.md'),
        'utf-8',
      );

      expect(zhComet).toContain('决策点是阻塞点');
      expect(zhOpen).toContain('### 1b. 需求澄清完成确认（阻塞点）');
      expect(zhOpen).toContain(
        '不得在用户确认需求澄清完成前创建 proposal.md、design.md 或 tasks.md',
      );
      expect(zhOpen).toContain(
        '完整 `/comet` 流程默认不得使用 Skill 工具加载 `openspec-propose` 技能',
      );
      expect(zhOpen).toContain(
        '技能加载后，按其指引创建 change 骨架，但当 Step 1b 的已确认澄清摘要已存在于对话上下文时',
      );
      expect(zhOpen).not.toContain('OpenSpec artifact 指令');
      expect(zhOpen).not.toContain('fast-forward');
      expect(zhOpen).toContain(
        '澄清摘要必须包含：目标、非目标、范围边界、关键未知项、验收场景草案',
      );
      expect(zhDesign).toContain(
        '**立即执行：** 使用 Skill 工具加载 Superpowers `brainstorming` 技能。禁止跳过此步骤。',
      );
      expect(zhDesign).toContain('技能加载后，按其指引使用以下上下文');
      expect(zhDesign).not.toContain('ARGUMENTS 包含');
      expect(zhDesign).toContain(
        '必须使用当前平台可用的用户输入/确认机制暂停并等待用户明确确认设计方案',
      );
      expect(zhDesign).toContain(
        '不得用“跳过重复上下文探索”削弱 Superpowers `brainstorming` 的澄清流程',
      );
      expect(zhDesign).not.toContain('跳过重复上下文探索，直接进入设计提问');
      expect(zhBuild).toContain('不得根据推荐规则自行选择 `branch` 或 `worktree`');
      expect(zhBuild).toContain('不得根据推荐规则自行选择执行方式');
      expect(zhVerify).toContain(
        '验证不通过时**必须使用当前平台可用的用户输入/确认机制暂停并等待用户决定修复或接受偏差',
      );
      expect(zhVerify).toContain(
        '必须使用当前平台可用的用户输入/确认机制暂停并等待用户选择分支处理方式',
      );
      expect(zhVerify).toContain(
        '只有在用户完成选择且对应操作完成后，才允许写入 `branch_status: handled`',
      );
      expect(zhArchive).toContain('### 1. 归档前最终确认（阻塞点）');
      expect(zhArchive).toContain(
        '不得在用户确认前运行 `"$COMET_BASH" "$COMET_ARCHIVE" "<change-name>"`',
      );
      expect(zhArchive).toContain('「确认归档」');
      expect(zhArchive).toContain('「需要调整或重新验证」');
      expect(zhArchive).toContain('「暂不归档」');
      expect(zhArchive).toContain(
        '`"$COMET_BASH" "$COMET_STATE" transition <change-name> archive-reopen`',
      );
      expect(zhVerify).toContain('不得因为验证已通过就自动归档');
      expect(zhHotfix).toContain(
        '满足升级条件时**必须使用当前平台可用的用户输入/确认机制暂停并等待用户明确确认**升级为完整 `/comet` 流程',
      );
      expect(zhHotfix).toContain('不得直接进入 `/comet-design`');
      expect(zhTweak).toContain(
        '满足升级条件时**必须使用当前平台可用的用户输入/确认机制暂停并等待用户明确确认**升级为完整 `/comet` 流程',
      );
      expect(zhTweak).toContain('不得直接进入 `/comet-design`');
      expect(zhComet).toContain('`verify_result: fail` → 进入验证失败决策阻塞点');
      expect(zhComet).not.toContain(
        '`verify_result: fail` → `"$COMET_BASH" "$COMET_STATE" transition <name> verify-fail` 后 `/comet-build`',
      );
      expect(zhHotfix).toContain('按升级条件阻塞确认处理');
      expect(zhHotfix).not.toContain('停止 hotfix，升级为 `/comet`');
      expect(zhTweak).toContain('按升级条件阻塞确认处理');

      // HIGH: hotfix/tweak IMPORTANT blocks must acknowledge verify decision points
      expect(zhHotfix).toContain('验证阶段（comet-verify）的验证失败决策和分支处理决策');
      expect(zhTweak).toContain('验证阶段（comet-verify）的验证失败决策和分支处理决策');
      expect(zhHotfix).toContain('归档前最终确认');
      expect(zhTweak).toContain('归档前最终确认');

      // MEDIUM: comet-design brainstorming does not write Design Doc before confirmation
      expect(zhDesign).toContain('brainstorming 阶段不写入 Design Doc 文件');
      expect(zhDesign).toContain('增量更新 `brainstorm-summary.md`');
      expect(zhDesign).toContain('### 1e. 主动上下文压缩门');

      // MEDIUM: comet-verify Spec drift requires user choice
      expect(zhVerify).toContain(
        '必须使用当前平台可用的用户输入/确认机制以单选题形式暂停并等待用户选择处理方式',
      );

      // MEDIUM: comet/SKILL.md build phase resume recognizes plan-ready pause before build decisions
      expect(zhComet).toContain('先检查 `build_pause`、`plan`、`build_mode` 和 `isolation`');
      expect(zhComet).toContain('`build_pause: plan-ready` 且 plan 文件存在');
      expect(zhComet).toContain('`build_pause` 不是执行方式，不得写入 `build_mode`');
      expect(zhComet).toContain(
        '若 `build_pause: plan-ready` 但 `isolation` 和 `build_mode` 已经设置，则视为 stale pause',
      );
      expect(zhBuild).toContain('提供 plan-ready 暂停点');
      expect(zhBuild).toContain('不得自动继续，也不得把暂停写入 `build_mode`');
      expect(zhBuild).toContain('`build_mode` 为 `executing-plans`');
      expect(zhBuild).toContain(
        '必须使用 Skill 工具加载 Superpowers `requesting-code-review` 技能',
      );
      expect(zhBuild).toContain('至少请求一次代码审查');
      expect(zhBuild).toContain('build → verify');
      expect(zhBuild).toContain(
        'CRITICAL review 发现（安全漏洞、数据丢失风险、构建/测试失败）必须先修复',
      );

      // MEDIUM: comet-verify Step 1b handles mixed CRITICAL/non-CRITICAL
      expect(zhVerify).toContain('CRITICAL 失败项必须修复');
      expect(zhVerify).toContain('不允许跳过修复直接全部接受');

      // MEDIUM: hotfix IMPORTANT covers >3-tasks comet-build decision points
      expect(zhHotfix).toContain('任务超过 3 个转入 `/comet-build` 时的工作区隔离和执行方式选择');

      // LOW: comet-build "中" level requires user confirmation before brainstorming
      expect(zhBuild).toContain(
        '使用当前平台可用的用户输入/确认机制暂停并等待用户确认后**，必须使用 Skill 工具加载 Superpowers `brainstorming`',
      );

      // LOW: comet-build 50% threshold is a hard decision point
      expect(zhBuild).toContain(
        '必须使用当前平台可用的用户输入/确认机制暂停并等待用户决定是否拆分为新 change',
      );

      // LOW: comet-verify Step 2b disambiguates design.md vs Design Doc
      expect(zhVerify).toContain('实现符合 `openspec/changes/<name>/design.md` 高层设计决策');
      expect(zhTweak).not.toContain('停止 tweak，升级为完整 `/comet`');

      // CRITICAL: build scope split must not bypass Comet state initialization
      expect(zhBuild).toContain('通过 `/comet-open` 创建独立 change');
      expect(zhBuild).not.toContain('`/opsx:new` 创建独立 change');

      // CRITICAL: open phase PRD split must happen before OpenSpec artifacts are created
      expect(zhOpen).toContain('### 1a. PRD 拆分预检（阻塞点）');
      expect(zhOpen).toContain('创建多个 OpenSpec changes');
      expect(zhOpen).toContain('保持为一个 change');
      expect(zhOpen).toContain('调整拆分方案后继续');
      expect(zhOpen).toContain('每个被接受的拆分项都必须通过 `/comet-open` 创建独立 change');
      expect(zhOpen).not.toContain('每个被接受的拆分项都必须通过 `/opsx:new` 创建独立 change');
      expect(zhOpen).toContain('已确认拆分项');
      expect(zhOpen).toContain('跳过 PRD 拆分预检');
      expect(zhOpen).toContain(
        '批量拆分模式下，单个拆分项完成 open 阶段后不得自动流转到 `/comet-design`',
      );
      expect(zhOpen).toContain('拆分完毕后必须暂停询问用户开始哪一个 change');
      expect(zhOpen).toContain('恢复时先检查已创建的 active changes');

      // IMPORTANT: main entry and build subskill agree scope expansion is blocking
      expect(zhComet).toContain('build 阶段范围扩张需重新设计或拆分新 change');
      expect(zhComet).toContain('archive 阶段执行归档脚本前的最终确认');
      expect(zhComet).toContain('open 阶段大型 PRD 需确认拆分为多个 change');

      // IMPORTANT: accepted Spec drift edits must not loop back through dirty-worktree handling
      expect(zhVerify).toContain('选项 A 属于 verify 阶段允许产物');

      // Dependency triggers must be explicit skill invocations, not ambiguous prose.
      expect(zhBuild).toContain('必须使用 Skill 工具加载 Superpowers `using-git-worktrees`');
      expect(zhBuild).not.toContain('或使用原生 `EnterWorktree` 工具');
      expect(zhBuild).toContain('必须使用 Skill 工具加载 Superpowers `brainstorming`');
      expect(zhComet).toContain(
        '若 `build_mode: subagent-driven-development`，不得在主窗口直接执行任务',
      );
      expect(zhBuild).toContain(
        '主窗口只负责协调，不得把 `subagent-driven-development` 当作当前主窗口的执行技能直接运行',
      );
      expect(zhBuild).toContain('如果当前平台没有真实后台 subagent / Task / multi-agent 调度能力');
      expect(zhBuild).toContain(
        '先确认当前平台存在可调用的真实后台 subagent / Task / multi-agent 调度能力',
      );
      expect(zhBuild).toContain(
        '`"$COMET_BASH" "$COMET_STATE" set <name> subagent_dispatch confirmed`',
      );
      expect(zhBuild).toContain(
        '用户选择改用主窗口执行后，必须先运行 `"$COMET_BASH" "$COMET_STATE" set <name> build_mode executing-plans`',
      );
      expect(zhBuild).not.toContain('使用 Skill 工具加载对应技能');
      expect(zhBuild).toContain('tdd_mode');
      expect(zhBuild).toContain('`"$COMET_BASH" "$COMET_STATE" set <name> tdd_mode <tdd|direct>`');
      expect(zhBuild).toContain('若 `tdd_mode: tdd`');
      expect(zhBuild).toContain('必须在 prompt 中注入 TDD 硬约束');
      expect(zhComet).toContain('`tdd_mode`');
      expect(zhComet).toContain('full workflow 离开 build 阶段前 `tdd_mode` 必须已选择');
      expect(zhHotfix).toContain('立即使用 Skill 工具加载 `comet-design` skill');
      expect(zhTweak).toContain('立即使用 Skill 工具加载 `comet-design` skill');
      expect(zhVerify).toContain(
        '用户选择 B 后，运行 `"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-fail`，然后调用 `/comet-build`',
      );

      // CRITICAL: implementation-time crashes must enter systematic debugging and keep tests in the current change.
      expect(zhBuild).toContain('必须使用 Skill 工具加载 Superpowers `systematic-debugging` 技能');
      expect(zhBuild).toContain(
        '运行程序、测试、构建或手动验证时出现崩溃、异常行为、测试失败或构建失败',
      );
      expect(zhBuild).toContain('先补充能复现该崩溃/异常的最小失败测试');
      expect(zhBuild).toContain(
        '不得通过另起一个“写测试用例”的 change 来替代当前 change 的验证闭环',
      );
      expect(zhHotfix).toContain('必须使用 Skill 工具加载 Superpowers `systematic-debugging` 技能');
      expect(zhHotfix).toContain('先补充能复现该崩溃/异常的最小失败测试');

      // CRITICAL: user-confirmation gates must not hardcode a platform-specific tool name.
      expect(
        [zhComet, zhDesign, zhBuild, zhVerify, zhArchive, zhHotfix, zhTweak].join('\n'),
      ).not.toContain('AskUserQuestion');
      expect(zhComet).toContain(
        '若当前平台没有结构化提问工具，则必须在对话中提出明确选项并停止流程',
      );
      expect(zhComet).toContain('`auto_transition`');
      expect(zhComet).toContain('不影响 phase 推进');
      expect(zhCometRule).toContain(
        'brainstorming in progress: incrementally update brainstorm-summary.md',
      );
      expect(zhCometRule).toContain('active compaction gate');
      for (const [content] of [
        [zhOpen, '/comet-design'],
        [zhDesign, '/comet-build'],
        [zhBuild, '/comet-verify'],
        [zhVerify, '/comet-archive'],
      ] as const) {
        expect(content).toContain('自动衔接下一阶段');
        expect(content).toContain('"$COMET_BASH" "$COMET_STATE" next <change-name>');
        expect(content).toContain('`NEXT: auto`');
        expect(content).toContain('`NEXT: manual`');
        expect(content).toContain('按 `HINT`');
      }
      expect(zhHotfix).toContain('自动衔接下一阶段');
      expect(zhHotfix).toContain('"$COMET_BASH" "$COMET_STATE" next <name>');
      expect(zhHotfix).toContain('`NEXT: auto`');
      expect(zhHotfix).toContain(
        '`phase: build` 返回 `comet-hotfix`，`verify` 返回 `comet-verify`，`archive` 返回 `comet-archive`',
      );
      expect(zhTweak).toContain('自动衔接下一阶段');
      expect(zhTweak).toContain('"$COMET_BASH" "$COMET_STATE" next <name>');
      expect(zhTweak).toContain('`NEXT: auto`');
      expect(zhTweak).toContain(
        '`phase: build` 返回 `comet-tweak`，`verify` 返回 `comet-verify`，`archive` 返回 `comet-archive`',
      );
    });
  });

  describe('English Comet workflow safeguards', () => {
    it('matches the Chinese workflow decision-point requirements', async () => {
      const enComet = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'SKILL.md'),
        'utf-8',
      );
      const enOpen = await fs.readFile(
        path.resolve('assets', 'skills', 'comet-open', 'SKILL.md'),
        'utf-8',
      );
      const enDesign = await fs.readFile(
        path.resolve('assets', 'skills', 'comet-design', 'SKILL.md'),
        'utf-8',
      );
      const enBuild = await fs.readFile(
        path.resolve('assets', 'skills', 'comet-build', 'SKILL.md'),
        'utf-8',
      );
      const enVerify = await fs.readFile(
        path.resolve('assets', 'skills', 'comet-verify', 'SKILL.md'),
        'utf-8',
      );
      const enArchive = await fs.readFile(
        path.resolve('assets', 'skills', 'comet-archive', 'SKILL.md'),
        'utf-8',
      );
      const enHotfix = await fs.readFile(
        path.resolve('assets', 'skills', 'comet-hotfix', 'SKILL.md'),
        'utf-8',
      );
      const enTweak = await fs.readFile(
        path.resolve('assets', 'skills', 'comet-tweak', 'SKILL.md'),
        'utf-8',
      );
      const enCometRule = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'rules', 'comet-phase-guard.md'),
        'utf-8',
      );

      expect(enComet).toContain('Decision points are blocking points');
      expect(enOpen).toContain(
        '### 1b. Requirements Clarification Completion Confirmation (Blocking Point)',
      );
      expect(enOpen).toContain(
        'Must not create proposal.md, design.md, or tasks.md before the user confirms requirements clarification is complete',
      );
      expect(enOpen).toContain(
        'Full `/comet` workflow must not use the Skill tool to load the `openspec-propose` skill',
      );
      expect(enOpen).toContain(
        'After the skill loads, follow its guidance to create the change skeleton, but override its "STOP and wait for user direction" behavior when a confirmed clarification summary from Step 1b is already available in the conversation context',
      );
      expect(enOpen).toContain(
        'The clarification summary must include: goals, non-goals, scope boundaries, key unknowns, and draft acceptance scenarios',
      );
      expect(enDesign).toContain(
        '**Immediately execute:** Use the Skill tool to load the Superpowers `brainstorming` skill. Skipping this step is prohibited.',
      );
      expect(enDesign).toContain(
        'After the skill loads, follow its guidance and use the following context',
      );
      expect(enDesign).not.toContain('ARGUMENTS containing');
      expect(enDesign).toContain(
        "must use the current platform's available user input/confirmation mechanism to pause and wait for the user to explicitly confirm",
      );
      expect(enDesign).toContain(
        'must not weaken the Superpowers `brainstorming` clarification flow by "skipping redundant context exploration"',
      );
      expect(enDesign).not.toContain('Skip redundant context exploration');
      expect(enBuild).toContain(
        'Must not choose `branch` or `worktree` based on recommendation rules',
      );
      expect(enBuild).toContain(
        'must not choose the execution method or TDD mode based on recommendation rules',
      );
      expect(enVerify).toContain(
        "must use the current platform's available user input/confirmation mechanism to pause and wait for the user to decide whether to fix or accept the deviation",
      );
      expect(enVerify).toContain(
        "Must use the current platform's available user input/confirmation mechanism to pause and wait for the user to choose branch handling method",
      );
      expect(enVerify).toContain(
        'Only after the user completes selection and the corresponding operation finishes, may `branch_status: handled` be written',
      );
      expect(enArchive).toContain('### 1. Final Archive Confirmation (Blocking Point)');
      expect(enArchive).toContain(
        'Must not run `"$COMET_BASH" "$COMET_ARCHIVE" "<change-name>"` before user confirmation',
      );
      expect(enArchive).toContain('Confirm archive');
      expect(enArchive).toContain('Needs adjustment or re-verification');
      expect(enArchive).toContain('Do not archive yet');
      expect(enArchive).toContain(
        '`"$COMET_BASH" "$COMET_STATE" transition <change-name> archive-reopen`',
      );
      expect(enVerify).toContain('Must not automatically archive just because verification passed');
      expect(enHotfix).toContain(
        "must use the current platform's available user input/confirmation mechanism to pause and wait for the user to explicitly confirm",
      );
      expect(enHotfix).toContain('Do not directly enter `/comet-design`');
      expect(enTweak).toContain(
        "must use the current platform's available user input/confirmation mechanism to pause and wait for the user to explicitly confirm",
      );
      expect(enTweak).toContain('Do not directly enter `/comet-design`');
      expect(enComet).toContain(
        '`verify_result: fail` → Enter verification failure decision blocking point',
      );
      expect(enComet).not.toContain(
        '`verify_result: fail` → `"$COMET_BASH" "$COMET_STATE" transition <name> verify-fail` then `/comet-build`',
      );

      expect(enHotfix).toContain('handle per "Upgrade Conditions" section');
      expect(enTweak).toContain('handle per upgrade conditions blocking confirmation');
      expect(enHotfix).toContain(
        'verify phase (comet-verify) verification-failure and branch-handling decisions',
      );
      expect(enTweak).toContain(
        'verify phase (comet-verify) verification-failure and branch-handling decisions',
      );
      expect(enHotfix).toContain('Final archive confirmation');
      expect(enTweak).toContain('Final archive confirmation');
      expect(enDesign).toContain('The brainstorming phase does not write to the Design Doc file');
      expect(enVerify).toContain(
        "must use the current platform's available user input/confirmation mechanism as a single-select question to pause and wait for the user to choose the handling method",
      );
      expect(enComet).toContain('first check `build_pause`, `plan`, `build_mode`, and `isolation`');
      expect(enComet).toContain('`build_pause: plan-ready` and the plan file exists');
      expect(enComet).toContain(
        '`build_pause` is not an execution method and must not be written to `build_mode`',
      );
      expect(enBuild).toContain('Provide Plan-Ready Pause Point');
      expect(enBuild).toContain(
        'Must not auto-continue and must not write the pause into `build_mode`',
      );
      expect(enBuild).toContain('`build_mode` is `executing-plans`');
      expect(enBuild).toContain(
        'use the Skill tool to load the Superpowers `requesting-code-review` skill',
      );
      expect(enBuild).toContain('request code review at least once');
      expect(enBuild).toContain('build → verify');
      expect(enBuild).toContain(
        'CRITICAL review findings (security vulnerabilities, data loss risk, build/test failures) must be fixed',
      );
      expect(enVerify).toContain('CRITICAL failures must be fixed');
      expect(enVerify).toContain('skipping fix to accept all is not allowed');
      expect(enHotfix).toContain(
        'workspace isolation and execution-method selection when tasks exceed 3 and transfer to `/comet-build`',
      );
      expect(enBuild).toContain(
        "Must use the current platform's available user input/confirmation mechanism to pause and wait for the user to explicitly confirm",
      );
      expect(enBuild).toContain(
        "must use the current platform's available user input/confirmation mechanism to pause and wait for the user to decide whether to split into a new change",
      );
      expect(enVerify).toContain(
        'Implementation matches `openspec/changes/<name>/design.md` high-level design decisions',
      );
      expect(enBuild).toContain('create independent change through `/comet-open`');
      expect(enBuild).not.toContain('create independent change through `/opsx:new`');
      expect(enOpen).toContain('### 1a. PRD Split Preflight (Blocking Point)');
      expect(enOpen).toContain('Create multiple OpenSpec changes');
      expect(enOpen).toContain('Keep everything as one change');
      expect(enOpen).toContain('Adjust the split plan before continuing');
      expect(enOpen).toContain(
        'Every accepted split item must be created as an independent change through `/comet-open`',
      );
      expect(enOpen).not.toContain(
        'Every accepted split item must be created as an independent change through `/opsx:new`',
      );
      expect(enOpen).toContain('confirmed split item');
      expect(enOpen).toContain('skip the PRD split preflight');
      expect(enOpen).toContain(
        'In batch split mode, a single split item must not auto-advance to `/comet-design` after completing the open phase',
      );
      expect(enOpen).toContain(
        'After splitting is complete, must pause and ask the user which change to start',
      );
      expect(enOpen).toContain('On resume, first check already-created active changes');
      expect(enComet).toContain(
        'Build phase scope expansion requiring redesign or new change split',
      );
      expect(enComet).toContain(
        'Archive phase final confirmation before running the archive script',
      );
      expect(enComet).toContain(
        'Open phase large PRD requiring confirmation to split into multiple changes',
      );
      expect(enVerify).toContain('Option A is a verify phase allowed artifact');
      expect(enBuild).toContain(
        'Must use the Skill tool to load the Superpowers `using-git-worktrees`',
      );
      expect(enBuild).not.toContain('native `EnterWorktree` tool');
      expect(enBuild).toContain(
        'must use Skill tool to load the Superpowers `brainstorming` skill',
      );
      expect(enDesign).toContain(
        'The script reads the change `.comet.yaml` `context_compression` snapshot',
      );
      expect(enDesign).toContain('Default `context_compression: off` generates');
      expect(enDesign).toContain('If context_compression is beta, use:');
      expect(enDesign).toContain('openspec/changes/<name>/.comet/handoff/spec-context.md');
      expect(enDesign).toContain('In beta mode, `spec-context.json` must be structurally valid');
      expect(enDesign).toContain('incrementally update `brainstorm-summary.md`');
      expect(enDesign).toContain('### 1e. Active Context Compaction Gate');
      expect(enHotfix).toContain('Immediately use the Skill tool to load the `comet-design` skill');
      expect(enTweak).toContain('Immediately use the Skill tool to load the `comet-design` skill');
      expect(enVerify).toContain(
        'After user selects B, run `"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-fail`, then invoke `/comet-build`',
      );

      expect(enBuild).toContain(
        'must use the Skill tool to load the Superpowers `systematic-debugging` skill',
      );
      expect(enBuild).toContain(
        'a crash, unexpected behavior, test failure, or build failure appears while running the program, tests, build, or manual verification',
      );
      expect(enBuild).toContain(
        'first add a minimal failing test that reproduces the crash or unexpected behavior',
      );
      expect(enBuild).toContain(
        'Must not replace the current change verification loop by starting a separate "write test cases" change',
      );
      expect(enHotfix).toContain(
        'must use the Skill tool to load the Superpowers `systematic-debugging` skill',
      );
      expect(enHotfix).toContain(
        'first add a minimal failing test that reproduces the crash or unexpected behavior',
      );

      expect(
        [enComet, enOpen, enDesign, enBuild, enVerify, enArchive, enHotfix, enTweak].join('\n'),
      ).not.toContain('AskUserQuestion');
      expect(enComet).toContain(
        'If the current platform has no structured question tool, ask clear options in the conversation and stop the workflow',
      );
      expect(enComet).toContain('`auto_transition`');
      expect(enComet).toContain('does not block phase updates');
      expect(enCometRule).toContain(
        'brainstorming in progress: incrementally update brainstorm-summary.md',
      );
      expect(enCometRule).toContain('active compaction gate');
      for (const [content] of [
        [enOpen, '/comet-design'],
        [enDesign, '/comet-build'],
        [enBuild, '/comet-verify'],
        [enVerify, '/comet-archive'],
      ] as const) {
        expect(content).toContain('Automatic Handoff to Next Phase');
        expect(content).toContain('"$COMET_BASH" "$COMET_STATE" next <change-name>');
        expect(content).toContain('`NEXT: auto`');
        expect(content).toContain('`NEXT: manual`');
        expect(content).toContain('run `/<SKILL>` manually');
      }
      expect(enHotfix).toContain('Automatic Handoff to Next Phase');
      expect(enHotfix).toContain('"$COMET_BASH" "$COMET_STATE" next <name>');
      expect(enHotfix).toContain('`NEXT: auto`');
      expect(enHotfix).toContain(
        '`phase: build` returns `comet-hotfix`, `verify` returns `comet-verify`, `archive` returns `comet-archive`',
      );
      expect(enTweak).toContain('Automatic Handoff to Next Phase');
      expect(enTweak).toContain('"$COMET_BASH" "$COMET_STATE" next <name>');
      expect(enTweak).toContain('`NEXT: auto`');
      expect(enTweak).toContain(
        '`phase: build` returns `comet-tweak`, `verify` returns `comet-verify`, `archive` returns `comet-archive`',
      );
    });
  });

  describe('Comet output language safeguards', () => {
    it('requires OpenSpec and Superpowers outputs to follow the user request language', async () => {
      const skillNames = [
        'comet',
        'comet-open',
        'comet-design',
        'comet-build',
        'comet-verify',
        'comet-archive',
        'comet-hotfix',
        'comet-tweak',
      ] as const;

      const readSkills = async (languageDir: 'skills' | 'skills-zh') =>
        Object.fromEntries(
          await Promise.all(
            skillNames.map(async (skillName) => [
              skillName,
              await fs.readFile(
                path.resolve('assets', languageDir, skillName, 'SKILL.md'),
                'utf-8',
              ),
            ]),
          ),
        ) as Record<(typeof skillNames)[number], string>;

      const zhSkills = await readSkills('skills-zh');
      const enSkills = await readSkills('skills');

      expect(zhSkills.comet).toContain('输出语言规则');
      expect(zhSkills.comet).toContain('以触发本次工作流的用户请求语言作为默认输出语言');
      expect(zhSkills['comet-open']).toContain(
        '传递给 OpenSpec 的所有提问和产物要求都必须包含输出语言约束',
      );
      expect(zhSkills['comet-design']).toContain('Language: 使用触发本次工作流的用户请求语言输出');
      expect(zhSkills['comet-build']).toContain(
        '计划文件和执行反馈必须使用触发本次工作流的用户请求语言',
      );
      expect(zhSkills['comet-build']).toContain('ARGUMENTS 必须包含与 Step 1 相同的 Language 约束');
      expect(zhSkills['comet-verify']).toContain(
        '验证报告和分支处理说明必须使用触发本次工作流的用户请求语言',
      );
      expect(zhSkills['comet-archive']).toContain(
        '归档摘要和生命周期闭环说明必须使用触发本次工作流的用户请求语言',
      );
      expect(zhSkills['comet-hotfix']).toContain(
        '精简版 OpenSpec 产物必须使用触发本次工作流的用户请求语言',
      );
      expect(zhSkills['comet-tweak']).toContain(
        '精简版 OpenSpec 产物必须使用触发本次工作流的用户请求语言',
      );

      expect(enSkills.comet).toContain('Output Language Rule');
      expect(enSkills.comet).toContain(
        'Use the language of the user request that triggered this workflow as the default output language',
      );
      expect(enSkills['comet-open']).toContain(
        'Every prompt and artifact request passed to OpenSpec must include the output-language constraint',
      );
      expect(enSkills['comet-design']).toContain(
        'Language: Use the language of the user request that triggered this workflow',
      );
      expect(enSkills['comet-build']).toContain(
        'Plan files and execution feedback must use the language of the user request that triggered this workflow',
      );
      expect(enSkills['comet-build']).toContain(
        'ARGUMENTS must include the same Language constraint as Step 1',
      );
      expect(enSkills['comet-verify']).toContain(
        'Verification reports and branch-handling notes must use the language of the user request that triggered this workflow',
      );
      expect(enSkills['comet-archive']).toContain(
        'Archive summaries and lifecycle closure notes must use the language of the user request that triggered this workflow',
      );
      expect(enSkills['comet-hotfix']).toContain(
        'Streamlined OpenSpec artifacts must use the language of the user request that triggered this workflow',
      );
      expect(enSkills['comet-tweak']).toContain(
        'Streamlined OpenSpec artifacts must use the language of the user request that triggered this workflow',
      );
    });
  });

  describe('Comet build subagent persistence safeguards', () => {
    it('requires subagent prompts to persist task completion in durable task files', async () => {
      const zhBuild = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet-build', 'SKILL.md'),
        'utf-8',
      );
      const enBuild = await fs.readFile(
        path.resolve('assets', 'skills', 'comet-build', 'SKILL.md'),
        'utf-8',
      );

      expect(zhBuild).toContain(
        '派发每个 subagent 时，必须在 prompt 中明确要求：技能加载后 ARGUMENTS 必须包含与 Step 1 相同的 Language 约束：`Language: 使用触发本次工作流的用户请求语言输出`；任务完成并通过验证后，立即勾选 `docs/superpowers/plans/<plan-file>.md` 中对应的计划任务；若该计划任务映射到 `openspec/changes/<name>/tasks.md` 中的任务，也同步将该 OpenSpec 任务从 `- [ ]` 改为 `- [x]`；若 plan 新增了 OpenSpec 中没有的一步，只勾选 plan 中对应任务即可。不得只更新内置 Todo 或对话内 checklist。',
      );
      expect(enBuild).toContain(
        'When dispatching each subagent, the prompt must explicitly require: after the skill loads, ARGUMENTS must include the same Language constraint as Step 1: `Language: Use the language of the user request that triggered this workflow`; after the task is complete and validated, immediately check off the corresponding plan task in `docs/superpowers/plans/<plan-file>.md`; if that plan task maps to an item in `openspec/changes/<name>/tasks.md`, also change that OpenSpec task from `- [ ]` to `- [x]`; if the plan added a step that does not exist in OpenSpec, only the corresponding plan task needs to be checked off. Do not only update the built-in Todo or an in-chat checklist.',
      );
    });
  });

  describe('Repository authoring guidance', () => {
    it('documents consistent skill invocation wording in CLAUDE.md', async () => {
      const claude = await fs.readFile(path.resolve('CLAUDE.md'), 'utf-8');

      expect(claude).toContain('## Skill 触发表述规范');
      expect(claude).toContain(
        '中文统一使用：`**立即执行：** 使用 Skill 工具加载 <skill-name> 技能。禁止跳过此步骤。`',
      );
      expect(claude).toContain(
        '英文统一使用：`**Immediately execute:** Use the Skill tool to load the <skill-name> skill. Skipping this step is prohibited.`',
      );
      expect(claude).toContain(
        '后续输入、上下文或执行要求写在“技能加载后 / After the skill loads”段落',
      );
    });
  });

  describe('Comet script discovery helper', () => {
    it('ships a shared script locator helper', async () => {
      const manifest = await readManifest();
      expect(manifest.skills).toContain('comet/scripts/comet-env.sh');
    });

    it('keeps platform search roots out of English and Chinese skill prose', async () => {
      const manifest = await readManifest();
      const skillPaths = manifest.skills.filter(
        (skillPath) =>
          skillPath.endsWith('SKILL.md') &&
          (skillPath === 'comet/SKILL.md' || skillPath.startsWith('comet-')),
      );

      for (const languageDir of ['skills', 'skills-zh']) {
        for (const skillPath of skillPaths) {
          const content = await fs.readFile(
            path.resolve('assets', languageDir, skillPath),
            'utf-8',
          );
          if (!content.includes('COMET_STATE') && !content.includes('COMET_GUARD')) continue;

          expect(content, `${languageDir}/${skillPath} should use comet-env.sh`).toContain(
            'comet-env.sh',
          );
          expect(content, `${languageDir}/${skillPath} should source COMET_ENV`).toContain(
            '. "$COMET_ENV"',
          );
          expect(
            content,
            `${languageDir}/${skillPath} should allow HOME skill glob expansion`,
          ).toContain('"$HOME"/.*/skills');
          expect(
            content,
            `${languageDir}/${skillPath} should not quote the HOME skill glob`,
          ).not.toContain('"$HOME/.*/skills"');
          expect(content, `${languageDir}/${skillPath} should not inline roots`).not.toContain(
            'COMET_SEARCH_ROOTS=',
          );
        }
      }
    });

    it('uses COMET_BASH in shipped Comet command examples', async () => {
      const manifest = await readManifest();
      const skillPaths = manifest.skills.filter(
        (skillPath) =>
          skillPath.endsWith('SKILL.md') &&
          (skillPath === 'comet/SKILL.md' || skillPath.startsWith('comet-')),
      );

      for (const languageDir of ['skills', 'skills-zh']) {
        for (const skillPath of skillPaths) {
          const content = await fs.readFile(
            path.resolve('assets', languageDir, skillPath),
            'utf-8',
          );

          expect(
            content,
            `${languageDir}/${skillPath} should avoid raw bash for Comet scripts`,
          ).not.toMatch(/(^|[` \t])bash[ \t]+"?\$COMET_/m);
        }
      }
    });
  });

  describe('Superpowers skill invocation names', () => {
    it('uses installed bare Superpowers skill names instead of plugin-prefixed aliases', async () => {
      const manifest = await readManifest();
      const skillPaths = manifest.skills.filter(
        (skillPath) =>
          skillPath.endsWith('SKILL.md') &&
          (skillPath === 'comet/SKILL.md' || skillPath.startsWith('comet-')),
      );

      for (const languageDir of ['skills', 'skills-zh']) {
        for (const skillPath of skillPaths) {
          const content = await fs.readFile(
            path.resolve('assets', languageDir, skillPath),
            'utf-8',
          );
          expect(content, `${languageDir}/${skillPath} should use bare skill names`).not.toContain(
            'superpowers:',
          );
        }
      }
    });
  });
});

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
