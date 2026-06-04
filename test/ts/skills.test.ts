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
      expect(command).toContain('Use the invocation arguments below as the user input for this workflow:');
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
      const zhHotfix = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet-hotfix', 'SKILL.md'),
        'utf-8',
      );
      const zhTweak = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet-tweak', 'SKILL.md'),
        'utf-8',
      );

      expect(zhComet).toContain('决策点是阻塞点');
      expect(zhDesign).toContain('必须使用 AskUserQuestion 工具暂停并等待用户明确确认设计方案');
      expect(zhBuild).toContain('不得根据推荐规则自行选择 `branch` 或 `worktree`');
      expect(zhBuild).toContain('不得根据推荐规则自行选择执行方式');
      expect(zhVerify).toContain('验证不通过时**必须使用 AskUserQuestion 工具暂停并等待用户决定修复或接受偏差');
      expect(zhVerify).toContain('必须使用 AskUserQuestion 工具暂停并等待用户选择分支处理方式');
      expect(zhVerify).toContain(
        '只有在用户完成选择且对应操作完成后，才允许写入 `branch_status: handled`',
      );
      expect(zhHotfix).toContain(
        '满足升级条件时**必须使用 AskUserQuestion 工具暂停并等待用户明确确认**升级为完整 `/comet` 流程',
      );
      expect(zhHotfix).toContain('不得直接进入 `/comet-design`');
      expect(zhTweak).toContain('满足升级条件时**必须使用 AskUserQuestion 工具暂停并等待用户明确确认**升级为完整 `/comet` 流程');
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

      // MEDIUM: comet-design brainstorming does not write Design Doc before confirmation
      expect(zhDesign).toContain('brainstorming 阶段不写入 Design Doc 文件');

      // MEDIUM: comet-verify Spec drift requires user choice
      expect(zhVerify).toContain('必须使用 AskUserQuestion 工具以单选题形式暂停并等待用户选择处理方式');

      // MEDIUM: comet/SKILL.md build phase resume recognizes plan-ready pause before build decisions
      expect(zhComet).toContain('先检查 `build_pause`、`plan`、`build_mode` 和 `isolation`');
      expect(zhComet).toContain('`build_pause: plan-ready` 且 plan 文件存在');
      expect(zhComet).toContain('`build_pause` 不是执行方式，不得写入 `build_mode`');
      expect(zhBuild).toContain('提供 plan-ready 暂停点');
      expect(zhBuild).toContain('不得自动继续，也不得把暂停写入 `build_mode`');

      // MEDIUM: comet-verify Step 1b handles mixed CRITICAL/non-CRITICAL
      expect(zhVerify).toContain('CRITICAL 失败项必须修复');
      expect(zhVerify).toContain('不允许跳过修复直接全部接受');

      // MEDIUM: hotfix IMPORTANT covers >3-tasks comet-build decision points
      expect(zhHotfix).toContain('任务超过 3 个转入 `/comet-build` 时的工作区隔离和执行方式选择');

      // LOW: comet-build "中" level requires user confirmation before brainstorming
      expect(zhBuild).toContain(
        '使用 AskUserQuestion 工具暂停并等待用户确认后**，必须使用 Skill 工具加载 Superpowers `brainstorming`',
      );

      // LOW: comet-build 50% threshold is a hard decision point
      expect(zhBuild).toContain('必须使用 AskUserQuestion 工具暂停并等待用户决定是否拆分为新 change');

      // LOW: comet-verify Step 2b disambiguates design.md vs Design Doc
      expect(zhVerify).toContain('实现符合 `openspec/changes/<name>/design.md` 高层设计决策');
      expect(zhTweak).not.toContain('停止 tweak，升级为完整 `/comet`');

      // CRITICAL: build scope split must not bypass Comet state initialization
      expect(zhBuild).toContain('通过 `/comet-open` 创建独立 change');
      expect(zhBuild).not.toContain('`/opsx:new` 创建独立 change');

      // IMPORTANT: main entry and build subskill agree scope expansion is blocking
      expect(zhComet).toContain('build 阶段范围扩张需重新设计或拆分新 change');

      // IMPORTANT: accepted Spec drift edits must not loop back through dirty-worktree handling
      expect(zhVerify).toContain('选项 A 属于 verify 阶段允许产物');

      // Dependency triggers must be explicit skill invocations, not ambiguous prose.
      expect(zhBuild).toContain('必须使用 Skill 工具加载 Superpowers `using-git-worktrees`');
      expect(zhBuild).not.toContain('或使用原生 `EnterWorktree` 工具');
      expect(zhBuild).toContain('必须使用 Skill 工具加载 Superpowers `brainstorming`');
      expect(zhHotfix).toContain('立即使用 Skill 工具加载 `comet-design` skill');
      expect(zhTweak).toContain('立即使用 Skill 工具加载 `comet-design` skill');
      expect(zhVerify).toContain('用户选择 B 后，运行 `"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-fail`，然后调用 `/comet-build`');
    });
  });

  describe('English Comet workflow safeguards', () => {
    it('matches the Chinese workflow decision-point requirements', async () => {
      const enComet = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'SKILL.md'),
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
      const enHotfix = await fs.readFile(
        path.resolve('assets', 'skills', 'comet-hotfix', 'SKILL.md'),
        'utf-8',
      );
      const enTweak = await fs.readFile(
        path.resolve('assets', 'skills', 'comet-tweak', 'SKILL.md'),
        'utf-8',
      );

      expect(enComet).toContain('Decision points are blocking points');
      expect(enDesign).toContain('must use the AskUserQuestion tool to pause and wait for the user to explicitly confirm');
      expect(enBuild).toContain('Must not choose `branch` or `worktree` based on recommendation rules');
      expect(enBuild).toContain('must not choose the execution method based on recommendation rules');
      expect(enVerify).toContain('must use the AskUserQuestion tool to pause and wait for the user to decide fix or accept deviation');
      expect(enVerify).toContain('Must use the AskUserQuestion tool to pause and wait for user to choose branch handling method');
      expect(enVerify).toContain('Only after the user completes selection and the corresponding operation finishes, may `branch_status: handled` be written');
      expect(enHotfix).toContain('must use the AskUserQuestion tool to pause and wait for the user to explicitly confirm');
      expect(enHotfix).toContain('Do not directly enter `/comet-design`');
      expect(enTweak).toContain('must use the AskUserQuestion tool to pause and wait for the user to explicitly confirm');
      expect(enTweak).toContain('Do not directly enter `/comet-design`');
      expect(enComet).toContain('`verify_result: fail` → Enter verification failure decision blocking point');
      expect(enComet).not.toContain(
        '`verify_result: fail` → `"$COMET_BASH" "$COMET_STATE" transition <name> verify-fail` then `/comet-build`',
      );

      expect(enHotfix).toContain('handle per "Upgrade Conditions" section');
      expect(enTweak).toContain('handle per upgrade conditions blocking confirmation');
      expect(enHotfix).toContain('verify phase (comet-verify) verification-failure and branch-handling decisions');
      expect(enTweak).toContain('verify phase (comet-verify) verification-failure and branch-handling decisions');
      expect(enDesign).toContain('The brainstorming phase does not write to the Design Doc file');
      expect(enVerify).toContain('must use the AskUserQuestion tool as a single-select question to pause and wait for user to choose handling method');
      expect(enComet).toContain('first check `build_pause`, `plan`, `build_mode`, and `isolation`');
      expect(enComet).toContain('`build_pause: plan-ready` and the plan file exists');
      expect(enComet).toContain('`build_pause` is not an execution method and must not be written to `build_mode`');
      expect(enBuild).toContain('Provide Plan-Ready Pause Point');
      expect(enBuild).toContain('Must not auto-continue and must not write the pause into `build_mode`');
      expect(enVerify).toContain('CRITICAL failures must be fixed');
      expect(enVerify).toContain('skipping fix to accept all is not allowed');
      expect(enHotfix).toContain('workspace isolation and execution-method selection when tasks exceed 3 and transfer to `/comet-build`');
      expect(enBuild).toContain('Must use the AskUserQuestion tool to pause and wait for the user to explicitly confirm');
      expect(enBuild).toContain('must use the AskUserQuestion tool to pause and wait for the user to decide whether to split into a new change');
      expect(enVerify).toContain('Implementation matches `openspec/changes/<name>/design.md` high-level design decisions');
      expect(enBuild).toContain('create independent change through `/comet-open`');
      expect(enBuild).not.toContain('create independent change through `/opsx:new`');
      expect(enComet).toContain('Build phase scope expansion requiring redesign or new change split');
      expect(enVerify).toContain('Option A is a verify phase allowed artifact');
      expect(enBuild).toContain('Must use the Skill tool to load the Superpowers `using-git-worktrees`');
      expect(enBuild).not.toContain('native `EnterWorktree` tool');
      expect(enBuild).toContain('must use Skill tool to load the Superpowers `brainstorming` skill');
      expect(enHotfix).toContain('Immediately use the Skill tool to load the `comet-design` skill');
      expect(enTweak).toContain('Immediately use the Skill tool to load the `comet-design` skill');
      expect(enVerify).toContain('After user selects B, run `"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-fail`, then invoke `/comet-build`');
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
      type SkillName = (typeof skillNames)[number];
      type SkillLanguageDir = 'skills' | 'skills-zh';

      const readSkillContents = async (
        languageDir: SkillLanguageDir,
      ): Promise<Record<SkillName, string>> =>
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
        ) as Record<SkillName, string>;

      const [zhSkills, enSkills] = await Promise.all([
        readSkillContents('skills-zh'),
        readSkillContents('skills'),
      ]);

      expect(zhSkills.comet).toContain('输出语言规则');
      expect(zhSkills.comet).toContain('以触发本次工作流的用户请求语言作为默认输出语言');
      expect(zhSkills['comet-open']).toContain(
        '传递给 OpenSpec 的所有提问和产物要求都必须包含输出语言约束',
      );
      expect(zhSkills['comet-design']).toContain(
        'Language: 使用触发本次工作流的用户请求语言输出',
      );
      expect(zhSkills['comet-build']).toContain(
        '计划文件和执行反馈必须使用触发本次工作流的用户请求语言',
      );
      expect(zhSkills['comet-build']).toContain(
        'ARGUMENTS 必须包含与 Step 1 相同的 Language 约束',
      );
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
          expect(content, `${languageDir}/${skillPath} should allow HOME skill glob expansion`).toContain(
            '"$HOME"/.*/skills',
          );
          expect(content, `${languageDir}/${skillPath} should not quote the HOME skill glob`).not.toContain(
            '"$HOME/.*/skills"',
          );
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

          expect(content, `${languageDir}/${skillPath} should avoid raw bash for Comet scripts`).not.toMatch(
            /(^|[` \t])bash[ \t]+"?\$COMET_/m,
          );
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
