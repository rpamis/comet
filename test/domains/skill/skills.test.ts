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
  installCometHooksForPlatform,
  parseProjectConfigOverrides,
  renderProjectConfig,
  mergeProjectConfig,
} from '../../../domains/skill/platform-install.js';
import type { Platform } from '../../../platform/install/platforms.js';
import { resolveArtifactLanguage } from '../../../domains/skill/languages.js';

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

  describe('language constraints', () => {
    it('resolves exact artifact language ids and defaults to en when unset', () => {
      expect(resolveArtifactLanguage('zh-CN').id).toBe('zh-CN');
      expect(resolveArtifactLanguage('en').id).toBe('en');
      expect(resolveArtifactLanguage(undefined).id).toBe('en');
    });

    it('rejects zh and en-US as artifact language values', () => {
      expect(() => resolveArtifactLanguage('zh')).toThrow('Invalid artifact language');
      expect(() => resolveArtifactLanguage('en-US')).toThrow('Invalid artifact language');
    });

    it('does not route Comet artifact language through the current user request language', async () => {
      const assetsDir = getAssetsDir();
      const files = [
        'skills/comet/SKILL.md',
        'skills/comet-open/SKILL.md',
        'skills/comet-design/SKILL.md',
        'skills/comet-build/SKILL.md',
        'skills/comet-verify/SKILL.md',
        'skills/comet-archive/SKILL.md',
        'skills/comet-hotfix/SKILL.md',
        'skills/comet-tweak/SKILL.md',
        'skills/comet/reference/subagent-dispatch.md',
        'skills-zh/comet/SKILL.md',
        'skills-zh/comet-open/SKILL.md',
        'skills-zh/comet-design/SKILL.md',
        'skills-zh/comet-build/SKILL.md',
        'skills-zh/comet-verify/SKILL.md',
        'skills-zh/comet-archive/SKILL.md',
        'skills-zh/comet-hotfix/SKILL.md',
        'skills-zh/comet-tweak/SKILL.md',
        'skills-zh/comet/reference/subagent-dispatch.md',
      ];

      for (const file of files) {
        const content = await fs.readFile(path.join(assetsDir, file), 'utf-8');
        expect(content, file).not.toContain('user request that triggered this workflow');
        expect(content, file).not.toContain('触发本次工作流的用户请求语言');
      }
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

    it('installs ambient resume instructions while preserving user content', async () => {
      await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), '# User\n\nKeep this.\n', 'utf-8');

      await createWorkingDirs(tmpDir, 'zh-CN');

      const agents = await fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf-8');
      const claude = await fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
      expect(agents).toContain('# User\n\nKeep this.');
      expect(agents).toContain('<comet-ambient-resume>');
      expect(agents).toContain('开始处理需要改动或调查的任务前');
      expect(claude).toContain('<comet-ambient-resume>');
      expect(claude).toContain('开始处理需要改动或调查的任务前');
    });

    it('records the selected project language in Comet config', async () => {
      await createWorkingDirs(tmpDir, 'zh-CN');

      const config = await fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf-8');
      expect(config).toContain('# language: en | zh-CN');
      expect(config).toContain('language: zh-CN');
    });

    it('defaults the project language to en when none is provided', async () => {
      await createWorkingDirs(tmpDir);

      const config = await fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf-8');
      expect(config).toContain('# language: en | zh-CN');
      expect(config).toContain('language: en');
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

      const manifest = await readManifest();
      for (const skillRelPath of manifest.skills) {
        const copiedPath = path.join(tmpDir, '.claude', 'skills', skillRelPath);
        expect(await fileExists(copiedPath), `zh install should include ${skillRelPath}`).toBe(
          true,
        );
      }
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
      expect(command).toContain('node "$COMET_STATE" init <name> full');
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

    it('creates MimoCode slash commands in project and global config directories', async () => {
      const mimocodePlatform: Platform = {
        id: 'mimocode',
        name: 'MimoCode',
        skillsDir: '.mimocode',
        globalSkillsDir: '.config/mimocode',
        openspecToolId: 'opencode',
      };

      await copyCometSkillsForPlatform(tmpDir, mimocodePlatform, false, 'skills', 'project');
      await expect(
        fs.access(path.join(tmpDir, '.mimocode', 'commands', 'comet-open.md')),
      ).resolves.toBeUndefined();

      const globalRoot = path.join(tmpDir, 'global-root');
      await fs.mkdir(globalRoot, { recursive: true });
      await copyCometSkillsForPlatform(globalRoot, mimocodePlatform, false, 'skills', 'global');
      await expect(
        fs.access(path.join(globalRoot, '.config', 'mimocode', 'commands', 'comet.md')),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(globalRoot, '.mimocode', 'commands', 'comet.md')),
      ).rejects.toThrow();
    });
  });

  describe('installCometHooksForPlatform', () => {
    const staleCometCommand = 'bash .legacy/skills/comet/scripts/comet-hook-guard.sh';
    const currentCometScript = 'comet/scripts/comet-hook-guard.mjs';
    const normalized = (value: string) => value.replace(/\\/g, '/');
    const expectedHookCommand = (skillsDir: string) =>
      `node "${normalized(path.join(tmpDir, skillsDir, 'skills', ...currentCometScript.split('/')))}" --project-root "${normalized(tmpDir)}"`;

    it('merges Claude-style hooks into an existing matcher group without replacing user hooks', async () => {
      const platform: Platform = {
        id: 'claude',
        name: 'Claude Code',
        skillsDir: '.claude',
        openspecToolId: 'claude',
        supportsHooks: true,
        hookFormat: 'claude-code',
      };
      const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
      const initialSettings = {
        model: 'sonnet',
        hooks: {
          PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo post' }] }],
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [
                { type: 'command', command: 'echo user-write-check' },
                { type: 'command', command: staleCometCommand },
              ],
            },
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: 'echo user-bash-check' }],
            },
          ],
        },
      };
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(settingsPath, JSON.stringify(initialSettings), 'utf-8');

      await installCometHooksForPlatform(tmpDir, platform);
      const firstInstall = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
      const writeGroup = firstInstall.hooks.PreToolUse.find(
        (entry: { matcher: string }) => entry.matcher === 'Write|Edit',
      );

      expect(firstInstall.model).toBe('sonnet');
      expect(firstInstall.hooks.PostToolUse).toEqual(initialSettings.hooks.PostToolUse);
      expect(firstInstall.hooks.PreToolUse).toHaveLength(2);
      const command = writeGroup.hooks[1].command as string;
      expect(normalized(command)).toContain(`/.claude/skills/${currentCometScript}`);
      expect(normalized(command)).toContain(`--project-root "${normalized(tmpDir)}"`);
      expect(command).not.toContain('node .claude/');
      expect(writeGroup.hooks).toEqual([
        { type: 'command', command: 'echo user-write-check' },
        {
          type: 'command',
          command,
        },
      ]);

      await installCometHooksForPlatform(tmpDir, platform);
      const secondInstall = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
      expect(secondInstall).toEqual(firstInstall);
    });

    it('does not throw when an existing hook group is malformed (non-array)', async () => {
      // Hand-edited settings may store a hook group as an object/scalar rather
      // than an array; install must coerce it instead of throwing.
      const platform: Platform = {
        id: 'claude',
        name: 'Claude Code',
        skillsDir: '.claude',
        openspecToolId: 'claude',
        supportsHooks: true,
        hookFormat: 'claude-code',
      };
      const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
      const malformedSettings = {
        hooks: {
          PreToolUse: { matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'echo x' }] },
        },
      };
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(settingsPath, JSON.stringify(malformedSettings), 'utf-8');

      await expect(installCometHooksForPlatform(tmpDir, platform)).resolves.toEqual({
        installed: true,
      });

      const updated = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
      expect(updated.hooks.PreToolUse).toHaveLength(1);
      expect(updated.hooks.PreToolUse[0].matcher).toBe('Write|Edit');
    });

    it.each([
      { id: 'qwen', skillsDir: '.qwen', hookFormat: 'qwen' as const },
      { id: 'qoder', skillsDir: '.qoder', hookFormat: 'qoder' as const },
    ])(
      'merges $id hooks into the existing matcher group idempotently',
      async ({ id, skillsDir, hookFormat }) => {
        const platform: Platform = {
          id,
          name: id,
          skillsDir,
          openspecToolId: id,
          supportsHooks: true,
          hookFormat,
        };
        const settingsPath = path.join(tmpDir, skillsDir, 'settings.json');
        const initialSettings = {
          theme: 'dark',
          hooks: {
            AfterTool: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo after' }] }],
            PreToolUse: [
              {
                matcher: 'Write|Edit',
                hooks: [
                  {
                    type: 'command',
                    command: 'echo user-write-check',
                    description: 'User write check',
                  },
                  {
                    type: 'command',
                    command: staleCometCommand,
                    description: 'Old Comet hook',
                  },
                ],
              },
            ],
          },
        };
        await fs.mkdir(path.dirname(settingsPath), { recursive: true });
        await fs.writeFile(settingsPath, JSON.stringify(initialSettings), 'utf-8');

        await installCometHooksForPlatform(tmpDir, platform);
        const firstInstall = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));

        expect(firstInstall.theme).toBe('dark');
        expect(firstInstall.hooks.AfterTool).toEqual(initialSettings.hooks.AfterTool);
        expect(firstInstall.hooks.PreToolUse).toHaveLength(1);
        expect(firstInstall.hooks.PreToolUse[0].hooks).toEqual([
          {
            type: 'command',
            command: 'echo user-write-check',
            description: 'User write check',
          },
          {
            type: 'command',
            command: expectedHookCommand(skillsDir),
            description: 'Block code writes in wrong Comet phase (open/design/archive)',
          },
        ]);

        await installCometHooksForPlatform(tmpDir, platform);
        const secondInstall = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
        expect(secondInstall).toEqual(firstInstall);
      },
    );

    it('merges Gemini hooks into the existing matcher group idempotently', async () => {
      const platform: Platform = {
        id: 'gemini',
        name: 'Gemini CLI',
        skillsDir: '.gemini',
        openspecToolId: 'gemini',
        supportsHooks: true,
        hookFormat: 'gemini',
      };
      const settingsPath = path.join(tmpDir, '.gemini', 'settings.json');
      const initialSettings = {
        selectedAuthType: 'oauth',
        hooks: {
          AfterTool: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo after' }] }],
          BeforeTool: [
            {
              matcher: 'write_file|edit_file',
              hooks: [
                {
                  type: 'command',
                  command: 'echo user-write-check',
                  name: 'User write check',
                },
                {
                  type: 'command',
                  command: staleCometCommand,
                  name: 'Old Comet hook',
                },
              ],
            },
          ],
        },
      };
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(settingsPath, JSON.stringify(initialSettings), 'utf-8');

      await installCometHooksForPlatform(tmpDir, platform);
      const firstInstall = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));

      expect(firstInstall.selectedAuthType).toBe('oauth');
      expect(firstInstall.hooks.AfterTool).toEqual(initialSettings.hooks.AfterTool);
      expect(firstInstall.hooks.BeforeTool).toHaveLength(1);
      expect(firstInstall.hooks.BeforeTool[0].hooks).toEqual([
        {
          type: 'command',
          command: 'echo user-write-check',
          name: 'User write check',
        },
        {
          type: 'command',
          command: expectedHookCommand('.gemini'),
          name: 'Block code writes in wrong Comet phase (open/design/archive)',
        },
      ]);

      await installCometHooksForPlatform(tmpDir, platform);
      const secondInstall = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
      expect(secondInstall).toEqual(firstInstall);
    });

    it('replaces only managed Windsurf hooks and preserves user hooks idempotently', async () => {
      const platform: Platform = {
        id: 'windsurf',
        name: 'Windsurf',
        skillsDir: '.windsurf',
        openspecToolId: 'windsurf',
        supportsHooks: true,
        hookFormat: 'windsurf',
      };
      const hooksPath = path.join(tmpDir, '.windsurf', 'hooks.json');
      const initialHooks = {
        enabled: true,
        hooks: {
          post_write_code: [{ command: 'echo post', show_output: false }],
          pre_write_code: [
            { command: 'echo user-write-check', show_output: false },
            { command: staleCometCommand, show_output: true },
          ],
        },
      };
      await fs.mkdir(path.dirname(hooksPath), { recursive: true });
      await fs.writeFile(hooksPath, JSON.stringify(initialHooks), 'utf-8');

      await installCometHooksForPlatform(tmpDir, platform);
      const firstInstall = JSON.parse(await fs.readFile(hooksPath, 'utf-8'));

      expect(firstInstall.enabled).toBe(true);
      expect(firstInstall.hooks.post_write_code).toEqual(initialHooks.hooks.post_write_code);
      expect(firstInstall.hooks.pre_write_code).toEqual([
        { command: 'echo user-write-check', show_output: false },
        {
          command: expectedHookCommand('.windsurf'),
          show_output: true,
        },
      ]);

      await installCometHooksForPlatform(tmpDir, platform);
      const secondInstall = JSON.parse(await fs.readFile(hooksPath, 'utf-8'));
      expect(secondInstall).toEqual(firstInstall);
    });
  });

  describe('Chinese Comet workflow safeguards', () => {
    it('requires OpenSpec instructions for each standard open artifact', async () => {
      const zhOpen = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet-open', 'SKILL.md'),
        'utf-8',
      );

      expect(zhOpen).toContain('openspec instructions proposal --change "<name>" --json');
      expect(zhOpen).toContain('openspec instructions design --change "<name>" --json');
      expect(zhOpen).toContain('openspec instructions tasks --change "<name>" --json');
      for (const field of [
        '`context`',
        '`rules`',
        '`template`',
        '`instruction`',
        '`resolvedOutputPath`',
        '`dependencies`',
      ]) {
        expect(zhOpen).toContain(field);
      }
      expect(zhOpen).toContain('不得复制到 artifact 内容中');
      expect(zhOpen).toContain('每创建一个 artifact 后');
      expect(zhOpen).toContain('openspec status --change "<name>" --json');
      expect(zhOpen).toContain('必须立即停止 artifact 创建');
      expect(zhOpen).toContain('不得回退为硬编码文档结构');
    });

    it('requires OpenSpec instructions for each standard open artifact (English)', async () => {
      const enOpen = await fs.readFile(
        path.resolve('assets', 'skills', 'comet-open', 'SKILL.md'),
        'utf-8',
      );

      expect(enOpen).toContain('openspec instructions proposal --change "<name>" --json');
      expect(enOpen).toContain('openspec instructions design --change "<name>" --json');
      expect(enOpen).toContain('openspec instructions tasks --change "<name>" --json');
      for (const field of [
        '`context`',
        '`rules`',
        '`template`',
        '`instruction`',
        '`resolvedOutputPath`',
        '`dependencies`',
      ]) {
        expect(enOpen).toContain(field);
      }
      expect(enOpen).toContain('must not copy them into the artifact content');
      expect(enOpen).toContain('After creating each artifact');
      expect(enOpen).toContain('openspec status --change "<name>" --json');
      expect(enOpen).toContain('must immediately stop artifact creation');
      expect(enOpen).toContain('Must not fall back to hard-coded artifact prose');
    });

    it('routes Chinese tweak build through OpenSpec apply without changing full workflow', async () => {
      const zhTweak = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet-tweak', 'SKILL.md'),
        'utf-8',
      );
      const zhBuild = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet-build', 'SKILL.md'),
        'utf-8',
      );

      expect(zhTweak).toContain('使用 Skill 工具加载 `openspec-apply-change` 技能');
      expect(zhTweak).toContain('这条 apply 路径只属于 tweak');
      expect(zhTweak).toContain(
        '完整 `/comet` 或 `workflow: full` 不得套用 tweak 的 `openspec-apply-change` 构建路径',
      );
      expect(zhTweak).toContain('单一 OpenSpec change');
      expect(zhTweak).not.toContain('不新增 capability');
      expect(zhBuild).not.toContain('openspec-apply-change');
    });

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
      const zhScripts = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet', 'reference', 'scripts.md'),
        'utf-8',
      );
      const zhIntentFrame = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet', 'reference', 'intent-frame.md'),
        'utf-8',
      );
      const zhCometRule = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'rules', 'comet-phase-guard.md'),
        'utf-8',
      );
      const zhDecisionPoint = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet', 'reference', 'decision-point.md'),
        'utf-8',
      );
      const zhDebugGate = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet', 'reference', 'debug-gate.md'),
        'utf-8',
      );

      expect(zhComet).toContain('决策点是阻塞点');
      expect(zhComet).toContain('CometIntentFrame');
      expect(zhComet).toContain('node "$COMET_INTENT" route --stdin');
      expect(zhComet).toContain('**CometIntentFrame 最小骨架**');
      expect(zhComet).toContain('"schema_version": "comet.intent.v1"');
      expect(zhComet).toContain('"slots": {');
      expect(zhComet).toContain('"context": {');
      expect(zhComet).toContain('"evidence": []');
      expect(zhComet).toContain('"proposed_route": {');
      expect(zhComet).not.toContain('"entities": []');
      expect(zhComet).not.toContain('"target_area":');
      expect(zhComet).not.toContain('"scope":');
      expect(zhComet).not.toContain('"dirty_worktree":');
      expect(zhComet).not.toContain('"next_skill": null');
      expect(zhComet).not.toContain('"requires_confirmation": true');
      expect(zhComet).not.toContain('"fallback_reason": null');
      expect(zhComet).toContain('**意图识别槽位提取**');
      expect(zhComet).not.toContain('字段命名采用常见 NLU / Agent Router 术语');
      expect(zhComet).not.toContain('填槽指南');
      expect(zhComet).toContain('`ask_user`');
      expect(zhComet).toContain('`CometIntentFrame + runtime scorer` 是事实源');
      expect(zhComet).toContain('`comet/reference/intent-frame.md`');
      expect(zhIntentFrame).toContain('`requested_action`');
      expect(zhIntentFrame).toContain('`workflow_candidate`');
      expect(zhIntentFrame).toContain('`user_explicit_workflow`');
      expect(zhIntentFrame).toContain('`existing_behavior`');
      expect(zhIntentFrame).toContain('`new_capability`');
      expect(zhIntentFrame).toContain('`public_api_change`');
      expect(zhIntentFrame).toContain('`schema_change`');
      expect(zhIntentFrame).toContain('`cross_module_change`');
      expect(zhIntentFrame).toContain('`proposed_route`');
      expect(zhHotfix).toContain('入口传入 intent frame');
      expect(zhHotfix).toContain('复核 `risk_signal` 和升级信号');
      expect(zhTweak).toContain('入口传入 intent frame');
      expect(zhTweak).toContain('复核 `risk_signal` 和升级信号');
      expect(zhScripts).toContain('COMET_INTENT="$COMET_SCRIPTS_DIR/comet-intent.mjs"');
      expect(zhComet).toContain('`comet/reference/decision-point.md`');
      expect(zhDecisionPoint).toContain('优先使用 `AskUserQuestion`');
      expect(zhDecisionPoint).toContain('第一次调用 `AskUserQuestion` 失败');
      expect(zhDecisionPoint).toContain('本会话后续决策点不得反复重试 `AskUserQuestion`');
      expect(zhDecisionPoint).toContain(
        '若当前平台没有结构化提问工具，则必须在对话中提出明确选项并停止流程',
      );
      expect(zhDecisionPoint).toContain('不得用推荐规则、默认值、历史偏好');
      expect(zhOpen).toContain('### 1b. 需求澄清完成确认（阻塞点）');
      expect(zhOpen).toContain(
        '不得在用户确认需求澄清完成前创建 proposal.md、design.md 或 tasks.md',
      );
      expect(zhOpen).toContain('`comet/reference/decision-point.md`');
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
        '必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户明确确认设计方案',
      );
      expect(zhDesign).toContain(
        '不得用“跳过重复上下文探索”削弱 Superpowers `brainstorming` 的澄清流程',
      );
      expect(zhDesign).not.toContain('跳过重复上下文探索，直接进入设计提问');
      expect(zhBuild).toContain('不得根据推荐规则自行选择 `branch` 或 `worktree`');
      expect(zhBuild).toContain('不得根据推荐规则自行选择执行方式');
      expect(zhBuild).toContain('`comet/reference/decision-point.md`');
      expect(zhVerify).toContain(
        '验证不通过时**必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户决定修复或接受偏差',
      );
      expect(zhVerify).toContain(
        '必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户选择分支处理方式',
      );
      expect(zhVerify).toContain(
        '只有在用户完成选择且对应操作完成后，才允许写入 `branch_status: handled`',
      );
      expect(zhArchive).toContain('### 1. 归档前最终确认（阻塞点）');
      expect(zhArchive).toContain('不得在用户确认前运行 `comet archive "<change-name>"`');
      expect(zhArchive).toContain('`comet/reference/decision-point.md`');
      expect(zhArchive).toContain('「确认归档」');
      expect(zhArchive).toContain('「需要调整或重新验证」');
      expect(zhArchive).toContain('「暂不归档」');
      expect(zhArchive).toContain('`comet state transition <change-name> archive-reopen`');
      expect(zhVerify).toContain('不得因为验证已通过就自动归档');
      expect(zhHotfix).toContain(
        '命中质变信号或文件数 tripwire 时，**必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户明确选择**',
      );
      expect(zhHotfix).toContain('不得直接进入 `/comet-design`');
      expect(zhTweak).toContain(
        '命中质变信号或文件数 tripwire 时，**必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户明确选择**',
      );
      expect(zhTweak).toContain('不得直接进入 `/comet-design`');
      expect(zhComet).toContain('`verify_result: fail` → 进入验证失败决策阻塞点');
      expect(zhComet).not.toContain(
        '`verify_result: fail` → `node "$COMET_STATE" transition <name> verify-fail` 后 `/comet-build`',
      );
      expect(zhHotfix).toContain(
        '若 hotfix 创建了 delta spec，则根据 comet-verify 的规模评估规则进入完整验证路径',
      );
      expect(zhHotfix).not.toContain('停止 hotfix，升级为 `/comet`');
      expect(zhTweak).toContain('带 delta spec 的验证分流');

      // HIGH: hotfix/tweak IMPORTANT blocks must acknowledge verify decision points
      expect(zhHotfix).toContain('验证阶段（comet-verify）的验证失败决策和分支处理决策');
      expect(zhTweak).toContain('验证阶段（comet-verify）的验证失败决策和分支处理决策');
      expect(zhHotfix).toContain('归档前最终确认');
      expect(zhTweak).toContain('归档前最终确认');

      // MEDIUM: comet-design brainstorming does not write Design Doc before confirmation
      expect(zhDesign).toContain('brainstorming 阶段不写入 Design Doc 文件');
      expect(zhDesign).toContain('增量更新 `brainstorm-summary.md`');
      expect(zhDesign).toContain('### 1e. 主动式上下文压缩');

      // MEDIUM: comet-verify Spec drift requires user choice
      expect(zhVerify).toContain(
        '必须使用当前平台可用的用户输入/确认机制以单选题形式暂停并等待用户选择处理方式',
      );

      // MEDIUM: comet/SKILL.md build phase resume recognizes plan-ready pause before all build decisions
      expect(zhComet).toContain(
        '先检查 `build_pause`、`plan`、`isolation`、`build_mode`、`tdd_mode` 和 `review_mode`',
      );
      expect(zhComet).toContain('`build_pause: plan-ready` 且 plan 文件存在');
      expect(zhComet).toContain('`build_pause` 不是执行方式，不得写入 `build_mode`');
      expect(zhComet).toContain(
        '若 `build_pause: plan-ready` 但 `isolation`、`build_mode`、`tdd_mode` 和 `review_mode` 都已经设置，则视为 stale pause',
      );
      expect(zhComet).toContain('工作区隔离、执行方式、TDD 模式和代码审查模式');
      expect(zhBuild).toContain('提供 plan-ready 暂停点');
      expect(zhBuild).toContain('不得自动继续，也不得把暂停写入 `build_mode`');
      expect(zhBuild).toContain('在 `executing-plans` 下，主会话直接执行任务');
      expect(zhBuild).toContain('review_mode');
      expect(zhBuild).toContain('| `off` | 不自动派发代码审查 |');
      expect(zhBuild).toContain(
        '| `standard` | 默认不为每任务派发 reviewer，仅当任务命中风险信号时派发每任务 reviewer，外加一次最终轻量代码审查 |',
      );
      expect(zhBuild).toContain(
        '| `thorough` | 为每个任务派发每任务 reviewer（spec + quality），外加一次最终完整审查 |',
      );
      expect(zhBuild).toContain('build → verify');
      expect(zhBuild).toContain(
        'CRITICAL review 发现（安全漏洞、数据丢失风险、构建/测试失败）必须先修复',
      );
      expect(zhBuild).toContain(
        'comet state record-check <change-name> build --command "<实际运行的构建命令>" --exit-code 0',
      );
      expect(zhVerify).toContain(
        'comet state record-check <change-name> verify --command "<实际运行的验证命令>" --exit-code 0',
      );
      expect(zhBuild).toContain('`--command` 只记录命令文本，Comet **绝不会执行该文本**');
      expect(zhVerify).toContain('`--command` 只记录命令文本，Comet **绝不会执行该文本**');
      expect(zhBuild).toContain('build 与 verify 证据彼此独立，不能互相替代');
      expect(zhVerify).toContain('verify 与 build 证据彼此独立，不能互相替代');
      expect(zhBuild).toContain(
        '`COMET_SKIP_BUILD=1` 仅是旧流程的兼容绕过方式，不是可审计的构建证据',
      );
      expect(zhVerify).toContain('不能把该绕过标记视为可审计的验证或构建证据');

      // MEDIUM: comet-verify Step 1b treats CRITICAL/IMPORTANT as blocking
      expect(zhVerify).toContain('CRITICAL 或 IMPORTANT 失败项必须修复');
      expect(zhVerify).toContain('不允许跳过修复直接全部接受');
      expect(zhVerify).toContain('当 `review_mode: standard` 或 `thorough` 时');
      expect(zhVerify).toContain('当 `review_mode: off` 时跳过自动代码审查');
      expect(zhVerify).toContain('只检查正确性、安全、边界条件');
      expect(zhVerify).toContain('无 CRITICAL 或 IMPORTANT 问题');
      expect(zhVerify).toContain('不影响正确性、安全、边界条件的 code pattern consistency 建议');
      expect(zhVerify).toContain('不执行 spec 覆盖率、Design Doc 一致性或漂移检查');
      expect(zhHotfix).toContain('默认 `review_mode: off`');

      // MEDIUM: hotfix IMPORTANT covers >3-tasks comet-build decision points
      expect(zhHotfix).toContain('任务超过 3 个转入 `/comet-build` 时的工作区隔离和执行方式选择');

      // LOW: comet-build "中" level requires user confirmation before brainstorming
      expect(zhBuild).toContain(
        '使用当前平台可用的用户输入/确认机制暂停并等待用户确认后**，必须使用 Skill 工具加载 Superpowers `brainstorming`',
      );

      // LOW: comet-build 50% threshold is a hard decision point
      expect(zhBuild).toContain(
        '必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户决定是否拆分为新 change',
      );

      // LOW: comet-verify Step 2b disambiguates design.md vs Design Doc
      expect(zhVerify).toContain('实现符合 `openspec/changes/<name>/design.md` 高层设计决策');
      expect(zhTweak).not.toContain('停止 tweak，升级为完整 `/comet`');

      // IMPORTANT: main /comet preset detection must match the current tweak positioning.
      expect(zhComet).toContain('用户明确描述为可收敛为单一 OpenSpec change 的轻量/中等变更');
      expect(zhComet).toContain('通过 OpenSpec apply 执行');
      expect(zhComet).not.toContain('用户明确描述为文案/配置/文档/prompt 小调整');

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
      expect(zhBuild).toContain('主会话只负责协调，禁止直接编写实现代码');
      expect(zhBuild).toContain('如果当前平台没有真实后台 agent 调度能力');
      expect(zhBuild).toContain(
        '先确认当前平台存在可调用的真实后台 subagent / Task / multi-agent 调度能力',
      );
      expect(zhBuild).toContain('`comet state set <name> subagent_dispatch confirmed`');
      expect(zhBuild).toContain(
        '用户选择改用主窗口执行后，必须先运行 `comet state set <name> build_mode executing-plans`',
      );
      expect(zhBuild).not.toContain('使用 Skill 工具加载对应技能');
      expect(zhBuild).toContain('tdd_mode');
      expect(zhBuild).toContain('`comet state set <name> tdd_mode <tdd|direct>`');
      expect(zhBuild).toContain('若 `tdd_mode: tdd`');
      expect(zhBuild).toContain(
        'TDD 约束和证据门槛已在 `comet/reference/subagent-dispatch.md` 中定义',
      );
      expect(zhComet).toContain('`tdd_mode`');
      expect(zhComet).toContain('full workflow 离开 build 阶段前 `tdd_mode` 必须已选择');
      expect(zhHotfix).toContain('立即使用 Skill 工具加载 `comet-design` skill');
      expect(zhTweak).toContain('立即使用 Skill 工具加载 `comet-design` skill');
      expect(zhVerify).toContain(
        '用户选择 B 后，运行 `comet state transition <change-name> verify-fail`，然后调用 `/comet-build`',
      );

      // CRITICAL: implementation-time crashes must enter systematic debugging and keep tests in the current change.
      expect(zhBuild).toContain('必须使用 Skill 工具加载 Superpowers `systematic-debugging` 技能');
      expect(zhBuild).toContain('`comet/reference/debug-gate.md`');
      expect(zhBuild).toContain(
        '运行程序、测试、构建或手动验证时出现崩溃、异常行为、测试失败或构建失败',
      );
      expect(zhHotfix).toContain('必须使用 Skill 工具加载 Superpowers `systematic-debugging` 技能');
      expect(zhHotfix).toContain('`comet/reference/debug-gate.md`');
      expect(zhTweak).toContain('`comet/reference/debug-gate.md`');
      expect(zhDebugGate).toContain('先补充能复现该崩溃/异常的最小失败测试');
      expect(zhDebugGate).toContain(
        '不得通过另起一个“写测试用例”的 change 来替代当前 change 的验证闭环',
      );

      // CRITICAL: phase skills stay platform-neutral; the shared decision-point protocol owns AskUserQuestion fallback.
      expect(
        [zhComet, zhDesign, zhBuild, zhVerify, zhArchive, zhHotfix, zhTweak].join('\n'),
      ).not.toContain('AskUserQuestion');
      expect(zhComet).toContain('`auto_transition`');
      expect(zhComet).toContain('不影响 phase 推进');
      expect(zhCometRule).toContain(
        'brainstorming in progress: incrementally update brainstorm-summary.md',
      );
      expect(zhCometRule).toContain('active compaction gate');
      expect(zhCometRule).toContain(
        '使用 Skill 工具重新加载 Superpowers `subagent-driven-development` 技能',
      );
      expect(zhCometRule).toContain(
        '读取 `comet/reference/subagent-dispatch.md` 获取 Comet 专属扩展',
      );
      expect(zhCometRule).toContain('禁止在主会话中直接执行 task');
      for (const content of [zhOpen, zhDesign]) {
        expect(content).toContain('自动衔接下一阶段');
        expect(content).toContain('node "$COMET_STATE" next <change-name>');
        expect(content).toContain('`NEXT: auto`');
        expect(content).toContain('`NEXT: manual`');
        expect(content).toContain('按 `HINT`');
      }
      for (const content of [zhBuild, zhVerify]) {
        expect(content).toContain('自动衔接下一阶段');
        expect(content).toContain('comet state next <change-name>');
        expect(content).toContain('`NEXT: auto`');
        expect(content).toContain('`NEXT: manual`');
        expect(content).toContain('按 `HINT`');
      }
      expect(zhHotfix).toContain('自动衔接下一阶段');
      expect(zhHotfix).toContain('node "$COMET_STATE" next <name>');
      expect(zhHotfix).toContain('`NEXT: auto`');
      expect(zhHotfix).toContain(
        '`phase: build` 返回 `comet-hotfix`，`verify` 返回 `comet-verify`，`archive` 返回 `comet-archive`',
      );
      expect(zhTweak).toContain('自动衔接下一阶段');
      expect(zhTweak).toContain('node "$COMET_STATE" next <name>');
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
      const enScripts = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'reference', 'scripts.md'),
        'utf-8',
      );
      const enIntentFrame = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'reference', 'intent-frame.md'),
        'utf-8',
      );
      const enCometRule = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'rules', 'comet-phase-guard.md'),
        'utf-8',
      );
      const enDecisionPoint = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'reference', 'decision-point.md'),
        'utf-8',
      );
      const enDebugGate = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'reference', 'debug-gate.md'),
        'utf-8',
      );

      expect(enComet).toContain('Decision points are blocking points');
      expect(enComet).toContain('CometIntentFrame');
      expect(enComet).toContain('node "$COMET_INTENT" route --stdin');
      expect(enComet).toContain('**Minimal CometIntentFrame Skeleton**');
      expect(enComet).toContain('"schema_version": "comet.intent.v1"');
      expect(enComet).toContain('"slots": {');
      expect(enComet).toContain('"context": {');
      expect(enComet).toContain('"evidence": []');
      expect(enComet).toContain('"proposed_route": {');
      expect(enComet).not.toContain('"entities": []');
      expect(enComet).not.toContain('"target_area":');
      expect(enComet).not.toContain('"scope":');
      expect(enComet).not.toContain('"dirty_worktree":');
      expect(enComet).not.toContain('"next_skill": null');
      expect(enComet).not.toContain('"requires_confirmation": true');
      expect(enComet).not.toContain('"fallback_reason": null');
      expect(enComet).toContain('**Intent Recognition Slot Extraction**');
      expect(enComet).not.toContain('Field names use common NLU / Agent Router terminology');
      expect(enComet).not.toContain('Slot-filling guide');
      expect(enComet).toContain('`ask_user`');
      expect(enComet).toContain('`CometIntentFrame + runtime scorer` is the source of truth');
      expect(enComet).toContain('`comet/reference/intent-frame.md`');
      expect(enIntentFrame).toContain('`requested_action`');
      expect(enIntentFrame).toContain('`workflow_candidate`');
      expect(enIntentFrame).toContain('`user_explicit_workflow`');
      expect(enIntentFrame).toContain('`existing_behavior`');
      expect(enIntentFrame).toContain('`new_capability`');
      expect(enIntentFrame).toContain('`public_api_change`');
      expect(enIntentFrame).toContain('`schema_change`');
      expect(enIntentFrame).toContain('`cross_module_change`');
      expect(enIntentFrame).toContain('`proposed_route`');
      expect(enHotfix).toContain('intent frame from the entry');
      expect(enHotfix).toContain('recheck `risk_signal` and escalation signals');
      expect(enTweak).toContain('intent frame from the entry');
      expect(enTweak).toContain('recheck `risk_signal` and escalation signals');
      expect(enScripts).toContain('COMET_INTENT="$COMET_SCRIPTS_DIR/comet-intent.mjs"');
      expect(enDecisionPoint).toContain('prefer `AskUserQuestion`');
      expect(enDecisionPoint).toContain('the first `AskUserQuestion` call fails');
      expect(enDecisionPoint).toContain(
        'do not repeatedly retry `AskUserQuestion` for later decision points in the same session',
      );
      expect(enDecisionPoint).toContain(
        'If the current platform has no structured question tool, ask clear options in the conversation and stop until the user replies',
      );
      expect(enDecisionPoint).toContain(
        'Never substitute recommendation rules, defaults, historical preferences',
      );
      expect(enOpen).toContain(
        '### 1b. Requirements Clarification Completion Confirmation (Blocking Point)',
      );
      expect(enOpen).toContain(
        'Must not create proposal.md, design.md, or tasks.md before the user confirms requirements clarification is complete',
      );
      expect(enOpen).toContain(
        'Full `/comet` workflow must not use the Skill tool to load the `openspec-propose` skill',
      );
      expect(enOpen).toContain('`comet/reference/decision-point.md`');
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
        'must follow the `comet/reference/decision-point.md` protocol to pause and wait for the user to explicitly confirm',
      );
      expect(enDesign).toContain(
        'must not weaken the Superpowers `brainstorming` clarification flow by "skipping redundant context exploration"',
      );
      expect(enDesign).not.toContain('Skip redundant context exploration');
      expect(enBuild).toContain(
        'proceed to Step 3 to choose workspace isolation, execution method, TDD mode, and code review mode',
      );
      expect(enBuild).toContain(
        'Then continue this step to choose workspace isolation, execution method, TDD mode, and code review mode',
      );
      expect(enBuild).toContain(
        'Must not choose `branch` or `worktree` based on recommendation rules',
      );
      expect(enBuild).toContain(
        'must not choose the execution method, TDD mode, or code review mode based on recommendation rules',
      );
      expect(enBuild).toContain('`comet/reference/decision-point.md`');
      expect(enVerify).toContain(
        'must follow the `comet/reference/decision-point.md` protocol to pause and wait for the user to decide whether to fix or accept the deviation',
      );
      expect(enVerify).toContain(
        'Must follow the `comet/reference/decision-point.md` protocol to pause and wait for the user to choose branch handling method',
      );
      expect(enVerify).toContain(
        'Only after the user completes selection and the corresponding operation finishes, may `branch_status: handled` be written',
      );
      expect(enTweak).toContain('Use the Skill tool to load the `openspec-apply-change` skill');
      expect(enTweak).toContain('This apply path belongs only to tweak');
      expect(enTweak).toContain(
        "Full `/comet` or `workflow: full` must not use tweak's `openspec-apply-change` build path",
      );
      expect(enTweak).toContain('single OpenSpec change');
      expect(enTweak).not.toContain('No new capability');
      expect(enBuild).not.toContain('openspec-apply-change');
      expect(enArchive).toContain('### 1. Final Archive Confirmation (Blocking Point)');
      expect(enArchive).toContain(
        'Must not run `comet archive "<change-name>"` before user confirmation',
      );
      expect(enArchive).toContain('`comet/reference/decision-point.md`');
      expect(enArchive).toContain('Confirm archive');
      expect(enArchive).toContain('Needs adjustment or re-verification');
      expect(enArchive).toContain('Do not archive yet');
      expect(enArchive).toContain('`comet state transition <change-name> archive-reopen`');
      expect(enVerify).toContain('Must not automatically archive just because verification passed');
      expect(enHotfix).toContain(
        "must pause under the `comet/reference/decision-point.md` protocol and wait for the user's explicit choice",
      );
      expect(enHotfix).toContain('Do not directly enter `/comet-design`');
      expect(enTweak).toContain(
        'must pause per `comet/reference/decision-point.md` and delegate the decision to the user',
      );
      expect(enTweak).toContain('Do not directly enter `/comet-design`');
      expect(enTweak).toContain('`comet/reference/debug-gate.md`');
      expect(enComet).toContain(
        '`verify_result: fail` → Enter verification failure decision blocking point',
      );
      expect(enComet).not.toContain(
        '`verify_result: fail` → `node "$COMET_STATE" transition <name> verify-fail` then `/comet-build`',
      );

      expect(enHotfix).toContain('handle it through this file\'s "Upgrade Assessment"');
      expect(enTweak).toContain('handle it through this file\'s "Upgrade Assessment"');
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
      expect(enComet).toContain(
        'first check `build_pause`, `plan`, `isolation`, `build_mode`, `tdd_mode`, and `review_mode`',
      );
      expect(enComet).toContain('`build_pause: plan-ready` and the plan file exists');
      expect(enComet).toContain(
        '`build_pause` is not an execution method and must not be written to `build_mode`',
      );
      expect(enComet).toContain(
        '`build_pause: plan-ready` but `isolation`, `build_mode`, `tdd_mode`, and `review_mode` are all already set',
      );
      expect(enComet).toContain(
        'workspace isolation, execution method, TDD mode, and code review mode',
      );
      expect(enBuild).toContain('Provide Plan-Ready Pause Point');
      expect(enBuild).toContain(
        'Must not auto-continue and must not write the pause into `build_mode`',
      );
      expect(enBuild).toContain(
        'Under `executing-plans`, the main session executes tasks directly',
      );
      expect(enBuild).toContain(
        'use the Skill tool to load the Superpowers `requesting-code-review` skill',
      );
      expect(enBuild).toContain('request one lightweight code review');
      expect(enBuild).toContain('build → verify');
      expect(enBuild).toContain(
        'CRITICAL review findings (security vulnerabilities, data loss risk, build/test failures) must be fixed',
      );
      expect(enBuild).toContain(
        'comet state record-check <change-name> build --command "<actual build command>" --exit-code 0',
      );
      expect(enVerify).toContain(
        'comet state record-check <change-name> verify --command "<actual verification command>" --exit-code 0',
      );
      expect(enBuild).toContain(
        '`--command` records command text only; Comet **never executes it**',
      );
      expect(enVerify).toContain(
        '`--command` records command text only; Comet **never executes it**',
      );
      expect(enBuild).toContain(
        'Build and verify evidence are separate and cannot substitute for each other',
      );
      expect(enVerify).toContain(
        'Verify and build evidence are separate and cannot substitute for each other',
      );
      expect(enBuild).toContain(
        '`COMET_SKIP_BUILD=1` is only a compatibility bypass for legacy workflows, not auditable build evidence',
      );
      expect(enVerify).toContain('cannot be treated as auditable verification or build evidence');
      expect(enVerify).toContain('CRITICAL or IMPORTANT failures must be fixed');
      expect(enVerify).toContain('skipping fix to accept all is not allowed');
      expect(enVerify).toContain('Code review strategy');
      expect(enVerify).toContain(
        'use the Skill tool to load the Superpowers `requesting-code-review` skill',
      );
      expect(enVerify).toContain('checks only correctness, security, and edge cases');
      expect(enVerify).toContain('no CRITICAL or IMPORTANT issues');
      expect(enVerify).toContain(
        'does not perform spec coverage, Design Doc consistency, or drift checks',
      );
      expect(enHotfix).toContain('6 quick checks');
      expect(enHotfix).toContain(
        'workspace isolation and execution-method selection when tasks exceed 3 and transfer to `/comet-build`',
      );
      expect(enBuild).toContain(
        'Must follow the `comet/reference/decision-point.md` protocol to pause and wait for the user to explicitly choose',
      );
      expect(enBuild).toContain(
        'must follow the `comet/reference/decision-point.md` protocol to pause and wait for the user to decide whether to split into a new change',
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
      expect(enHotfix).toContain('immediately use the Skill tool to load the `comet-design` skill');
      expect(enTweak).toContain('immediately use the Skill tool to load the `comet-design` skill');
      expect(enVerify).toContain(
        'After user selects B, run `comet state transition <change-name> verify-fail`, then invoke `/comet-build`',
      );

      expect(enComet).toContain(
        'User explicitly describes a lightweight/medium change that can fit in a single OpenSpec change',
      );
      expect(enComet).toContain('executed through OpenSpec apply');
      expect(enComet).not.toContain(
        'User explicitly describes copy/config/docs/prompt small adjustment',
      );

      expect(enBuild).toContain(
        'must use the Skill tool to load the Superpowers `systematic-debugging` skill',
      );
      expect(enBuild).toContain('`comet/reference/debug-gate.md`');
      expect(enBuild).toContain(
        'a crash, unexpected behavior, test failure, or build failure appears while running the program, tests, build, or manual verification',
      );
      expect(enDebugGate).toContain(
        'first add a minimal failing test that reproduces the crash or unexpected behavior',
      );
      expect(enHotfix).toContain(
        'must use the Skill tool to load the Superpowers `systematic-debugging` skill',
      );
      expect(enHotfix).toContain('`comet/reference/debug-gate.md`');
      expect(enDebugGate).toContain(
        'do not replace the current change verification loop by starting a separate “write test cases” change',
      );

      // Phase skills stay platform-neutral; the shared decision-point protocol owns AskUserQuestion fallback.
      expect(
        [enComet, enOpen, enDesign, enBuild, enVerify, enArchive, enHotfix, enTweak].join('\n'),
      ).not.toContain('AskUserQuestion');
      expect(enComet).toContain('`comet/reference/decision-point.md`');
      expect(enComet).toContain('`auto_transition`');
      expect(enComet).toContain('does not block phase updates');
      expect(enCometRule).toContain(
        'brainstorming in progress: incrementally update brainstorm-summary.md',
      );
      expect(enCometRule).toContain('active compaction gate');
      expect(enCometRule).toContain(
        'Use the Skill tool to reload the Superpowers `subagent-driven-development` skill',
      );
      expect(enCometRule).toContain(
        're-read `comet/reference/subagent-dispatch.md` for Comet-specific extensions',
      );
      expect(enCometRule).toContain('Do not execute the pending task directly in the main window');
      for (const content of [enOpen, enDesign]) {
        expect(content).toContain('Automatic Handoff to Next Phase');
        expect(content).toContain('node "$COMET_STATE" next <change-name>');
        expect(content).toContain('`NEXT: auto`');
        expect(content).toContain('`NEXT: manual`');
        expect(content).toContain('run `/<SKILL>` manually');
      }
      for (const content of [enBuild, enVerify]) {
        expect(content).toContain('Automatic Handoff to Next Phase');
        expect(content).toContain('comet state next <change-name>');
        expect(content).toContain('`NEXT: auto`');
        expect(content).toContain('`NEXT: manual`');
        expect(content).toContain('run `/<SKILL>` manually');
      }
      expect(enHotfix).toContain('Automatic Handoff to Next Phase');
      expect(enHotfix).toContain('node "$COMET_STATE" next <name>');
      expect(enHotfix).toContain('`NEXT: auto`');
      expect(enHotfix).toContain(
        '`phase: build` returns `comet-hotfix`, `verify` returns `comet-verify`, `archive` returns `comet-archive`',
      );
      expect(enTweak).toContain('Automatic Handoff to Next Phase');
      expect(enTweak).toContain('node "$COMET_STATE" next <name>');
      expect(enTweak).toContain('`NEXT: auto`');
      expect(enTweak).toContain(
        '`phase: build` returns `comet-tweak`, `verify` returns `comet-verify`, `archive` returns `comet-archive`',
      );
    });
  });

  describe('Comet output language safeguards', () => {
    it('requires OpenSpec and Superpowers outputs to follow the configured Comet artifact language', async () => {
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
      expect(zhSkills.comet).toContain(
        '所有 OpenSpec 和 Superpowers 产物都必须使用 Comet 配置的产物语言',
      );
      expect(zhSkills['comet-open']).toContain(
        '传递给 OpenSpec 的所有提问和产物要求都必须包含解析后的 Comet 产物语言',
      );
      expect(zhSkills['comet-design']).toContain(
        'Language: 使用 `"$COMET_BASH" "$COMET_STATE" get <name> language` 读取到的 Comet 配置产物语言输出',
      );
      expect(zhSkills['comet-build']).toContain(
        '计划文件和执行反馈必须使用 `comet state get <name> language` 读取到的 Comet 配置产物语言',
      );
      expect(zhSkills['comet-build']).toContain('ARGUMENTS 必须包含与 Step 1 相同的 Language 约束');
      expect(zhSkills['comet-verify']).toContain(
        '验证报告和分支处理说明必须使用 `comet state get <name> language` 读取到的 Comet 配置产物语言',
      );
      expect(zhSkills['comet-archive']).toContain(
        '归档摘要和生命周期闭环说明必须使用 `comet state get <name> language` 读取到的 Comet 配置产物语言',
      );
      expect(zhSkills['comet-hotfix']).toContain('精简版 OpenSpec 产物必须使用 Comet 配置产物语言');
      expect(zhSkills['comet-tweak']).toContain('精简版 OpenSpec 产物必须使用 Comet 配置产物语言');

      expect(enSkills.comet).toContain('Output Language Rule');
      expect(enSkills.comet).toContain(
        'Use the configured Comet artifact language as the output language for every OpenSpec and Superpowers artifact',
      );
      expect(enSkills['comet-open']).toContain(
        'Every prompt and artifact request passed to OpenSpec must include the resolved Comet artifact language',
      );
      expect(enSkills['comet-design']).toContain(
        'Language: Use the configured Comet artifact language from `"$COMET_BASH" "$COMET_STATE" get <name> language`',
      );
      expect(enSkills['comet-build']).toContain(
        'Plan files and execution feedback must use the configured Comet artifact language from `comet state get <name> language`',
      );
      expect(enSkills['comet-build']).toContain(
        'ARGUMENTS must include the same Language constraint as Step 1',
      );
      expect(enSkills['comet-verify']).toContain(
        'Verification reports and branch-handling notes must use the configured Comet artifact language from `comet state get <name> language`',
      );
      expect(enSkills['comet-archive']).toContain(
        'Archive summaries and lifecycle closure notes must use the configured Comet artifact language from `comet state get <name> language`',
      );
      expect(enSkills['comet-hotfix']).toContain(
        'Streamlined OpenSpec artifacts must use the configured Comet artifact language',
      );
      expect(enSkills['comet-tweak']).toContain(
        'Streamlined OpenSpec artifacts must use the configured Comet artifact language',
      );
    });
  });

  describe('Comet build subagent dispatch safeguards', () => {
    it('composes the Superpowers loop with the Chinese Comet dispatch contract', async () => {
      const zhBuild = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet-build', 'SKILL.md'),
        'utf-8',
      );
      const zhDispatch = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet', 'reference', 'subagent-dispatch.md'),
        'utf-8',
      );
      const zhRecovery = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet', 'reference', 'context-recovery.md'),
        'utf-8',
      );
      const zhGuard = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'rules', 'comet-phase-guard.md'),
        'utf-8',
      );

      expect(zhBuild).toContain(
        '使用 Skill 工具加载 Superpowers `subagent-driven-development` 技能',
      );
      expect(zhBuild).toContain('选择工作区隔离、执行方式、TDD 模式和代码审查模式');
      expect(zhBuild).toContain('读取 `comet/reference/subagent-dispatch.md` 获取 Comet 专属扩展');
      expect(zhBuild).not.toContain('#### Subagent 调度协议');
      expect(zhDispatch).toContain('发生冲突时，以本文档中更具体的 Comet 约束为准');
      expect(zhDispatch).toContain(
        'Superpowers `subagent-driven-development` 技能提供基础连续派发循环',
      );
      expect(zhDispatch).toContain('Comet 的 `review_mode` 接管 reviewer 阶段');
      expect(zhDispatch).not.toContain('按 `review_mode` 决定所需审查与修复流程');
      expect(zhDispatch).toContain(
        '派发第一个 task 前，必须完成 Superpowers `subagent-driven-development` 技能的预检计划审查',
      );
      expect(zhDispatch).toContain('不得把多个 task 打包给同一个 agent');
      expect(zhDispatch).toContain('每个 task 派发一个全新的后台 implementer agent');
      expect(zhDispatch).toContain('task reviewer、修复 agent 和 final reviewer');
      expect(zhDispatch).toContain(
        'Language: 使用 "$COMET_BASH" "$COMET_STATE" get <name> language 读取到的 Comet 配置产物语言输出',
      );
      expect(zhDispatch).toContain('允许修改的文件范围');
      expect(zhDispatch).toContain('必须执行的测试命令');
      expect(zhDispatch).toContain('提交哈希');
      expect(zhDispatch).toContain('确认提交和文件在当前工作树可见');
      expect(zhDispatch).toContain('实现提交或差异以及 RED/GREEN 证据');
      expect(zhDispatch).toContain(
        '大型 task 文本、实现报告和审查材料必须通过已加载的 Superpowers `subagent-driven-development` 技能提供的文件交接机制传递',
      );
      expect(zhDispatch).toContain(
        '不得要求 reviewer 重新运行 implementer 已经运行并报告的同一批测试',
      );
      expect(zhDispatch).toContain('不得在 reviewer prompt 中预判、压低或禁止报告某个发现');
      expect(zhDispatch).toContain('implementer 不得勾选 plan 或 OpenSpec task');
      expect(zhDispatch).toContain('协调者唯一允许的文件修改');
      expect(zhDispatch).toContain('plan、OpenSpec task 和 subagent 进度检查点');
      expect(zhDispatch).toContain('openspec/changes/<name>/.comet/subagent-progress.md');
      expect(zhDispatch).toContain('final-review | final-fix');
      expect(zhDispatch).toContain('当前审查-修复轮次');
      expect(zhDispatch).toContain('已通过的审查阶段');
      expect(zhDispatch).toContain('所有 task 已勾选且检查点处于 `final-review` 或 `final-fix`');
      expect(zhDispatch).toContain(
        '使用 Skill 工具加载 Superpowers `test-driven-development` 技能',
      );
      expect(zhDispatch).toContain(
        '当 `review_mode: standard` 时，默认不为每个 task 派发 reviewer，而是按**风险触发**决定',
      );
      expect(zhDispatch).toContain(
        '当 `review_mode: thorough` 时，**每个 task 派发一个每任务 reviewer，同时检查 spec compliance 与 code quality**',
      );
      expect(zhDispatch).toContain('当 reviewer 返回无法仅从审查材料验证的发现时');
      expect(zhDispatch).toContain(
        '若已加载的 Superpowers `subagent-driven-development` 技能通过自己的进度记录报告某个 task 已完成',
      );
      expect(zhDispatch).toContain('当 `review_mode: off` 时');
      expect(zhDispatch).toContain(
        'Comet 不读取、不写入、也不要求任何 Superpowers `subagent-driven-development` 内部脚本或工作区路径',
      );
      for (const forbidden of [
        'spec reviewer',
        'code quality reviewer',
        'spec compliance reviewer',
        'dual-review',
        'both reviews',
        'task-reviewer-prompt',
        'task-brief',
        'review-package',
        'sdd-workspace',
        '.superpowers/sdd',
        'SDD ' + '技能',
        '当前 ' + 'SDD',
        'Superpowers ' + 'SDD',
      ]) {
        expect(zhDispatch, `zh dispatch should not bind to ${forbidden}`).not.toContain(forbidden);
      }
      expect(zhDispatch).toContain(
        'node "$COMET_STATE" task-checkoff "$PLAN_FILE" "$PLAN_TASK_TEXT"',
      );
      expect(zhDispatch).not.toContain('PLAN_MATCHES="$(grep -cF');
      expect(zhDispatch).toContain('RED 失败命令与失败摘要');
      expect(zhDispatch).toContain('GREEN 通过命令与通过摘要');
      expect(zhDispatch).not.toContain("grep -n '\\- \\[ \\]' openspec/changes/<name>/tasks.md");
      expect(zhDispatch).toContain('禁止总结、禁止询问用户是否继续、禁止在任务之间等待用户输入');
      expect(zhDispatch).toContain('存在无法从仓库、计划或既有上下文消除的真实歧义');
      expect(zhDispatch).toContain('平台没有真实后台 agent 调度能力');
      expect(zhDispatch).toContain('不得加载 `finishing-a-development-branch`');
      expect(zhDispatch).toContain('返回 `comet-build` 继续执行退出条件、阶段守卫和后续阶段衔接');
      expect(zhRecovery).toContain('重新加载 Superpowers `subagent-driven-development` 技能');
      expect(zhRecovery).toContain('重新阅读 `comet/reference/subagent-dispatch.md`');
      expect(zhRecovery).toContain('读取 `openspec/changes/<name>/.comet/subagent-progress.md`');
      expect(zhGuard).toContain('重新加载 Superpowers `subagent-driven-development` 技能');
      expect(zhGuard).toContain('读取 `comet/reference/subagent-dispatch.md` 获取 Comet 专属扩展');
      expect(zhGuard).toContain('读取 `openspec/changes/<name>/.comet/subagent-progress.md`');
    });

    it('keeps the English dispatch contract behaviorally aligned', async () => {
      const enBuild = await fs.readFile(
        path.resolve('assets', 'skills', 'comet-build', 'SKILL.md'),
        'utf-8',
      );
      const enDispatch = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'reference', 'subagent-dispatch.md'),
        'utf-8',
      );
      const enRecovery = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'reference', 'context-recovery.md'),
        'utf-8',
      );
      const enGuard = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'rules', 'comet-phase-guard.en.md'),
        'utf-8',
      );

      expect(enBuild).toContain(
        'Use the Skill tool to load the Superpowers `subagent-driven-development` skill',
      );
      expect(enBuild).toContain(
        'read `comet/reference/subagent-dispatch.md` for Comet-specific extensions',
      );
      expect(enBuild).toContain(
        'TDD constraints and evidence thresholds are defined in `comet/reference/subagent-dispatch.md`',
      );
      expect(enBuild).toContain(
        'workspace isolation, execution method, TDD mode, and code review mode',
      );
      expect(enBuild).toContain(
        'explicitly choose isolation method, execution method, TDD mode, and code review mode',
      );
      expect(enBuild).toContain(
        'update `isolation`, execution method, TDD mode, and code review mode fields',
      );
      expect(enBuild).not.toContain(
        'ask the user to choose both workspace isolation ' + 'and execution method',
      );
      expect(enBuild).toContain('current execution branch and `review_mode`');
      expect(enBuild).toContain('dispatches no per-task reviewer under `off`');
      expect(enBuild).toContain('every task gets a per-task reviewer');
      expect(enBuild).not.toContain('must wait for both reviews to pass');
      expect(enDispatch).toContain(
        'If the Superpowers skill conflicts with this document, the more specific Comet constraints here take precedence',
      );
      expect(enDispatch).toContain(
        'Before dispatching the first task, complete the Superpowers `subagent-driven-development` skill pre-flight plan review',
      );
      expect(enDispatch).toContain('Never bundle multiple tasks into one agent');
      expect(enDispatch).toContain('fresh background implementer agent for every task');
      expect(enDispatch).toContain('task reviewer, fix agents, and the final reviewer');
      expect(enDispatch).toContain(
        'Language: Use the configured Comet artifact language from "$COMET_BASH" "$COMET_STATE" get <name> language',
      );
      expect(enDispatch).toContain('allowed file scope');
      expect(enDispatch).toContain('required test commands');
      expect(enDispatch).toContain('commit hash');
      expect(enDispatch).toContain('verify that the commit and changed files are visible');
      expect(enDispatch).toContain('implementation commit or diff, and the RED/GREEN evidence');
      expect(enDispatch).toContain(
        'Large task text, implementation reports, and review material must move through the file-handoff mechanism exposed by the loaded Superpowers `subagent-driven-development` skill',
      );
      expect(enDispatch).toContain(
        'Do not ask a reviewer to re-run the same tests the implementer already ran and reported',
      );
      expect(enDispatch).toContain(
        'Do not pre-judge, suppress, or down-rank findings in the reviewer prompt',
      );
      expect(enDispatch).toContain('The coordinator may modify only');
      expect(enDispatch).toContain('plan, OpenSpec task, and subagent progress checkpoint');
      expect(enDispatch).toContain('openspec/changes/<name>/.comet/subagent-progress.md');
      expect(enDispatch).toContain('final-review | final-fix');
      expect(enDispatch).toContain('current review-fix round');
      expect(enDispatch).toContain('review stages already passed');
      expect(enDispatch).toContain(
        'all tasks are checked and the checkpoint stage is `final-review` or `final-fix`',
      );
      expect(enDispatch).toContain(
        'use the Skill tool to load the Superpowers `test-driven-development` skill',
      );
      expect(enDispatch).toContain('Do NOT summarize');
      expect(enDispatch).toContain('irreducible ambiguity');
      expect(enDispatch).toContain('real background agent dispatch capability');
      expect(enDispatch).toContain('must not load `finishing-a-development-branch`');
      expect(enDispatch).toContain(
        'return control to `comet-build` for exit checks, the phase guard, and phase handoff',
      );
      expect(enRecovery).toContain('reload the Superpowers `subagent-driven-development` skill');
      expect(enRecovery).toContain('Re-read `comet/reference/subagent-dispatch.md`');
      expect(enRecovery).toContain('Read `openspec/changes/<name>/.comet/subagent-progress.md`');
      expect(enGuard).toContain('reload the Superpowers `subagent-driven-development` skill');
      expect(enGuard).toContain(
        'Re-read `comet/reference/subagent-dispatch.md` for Comet-specific extensions',
      );
      expect(enGuard).toContain('Read `openspec/changes/<name>/.comet/subagent-progress.md`');
      expect(enGuard).toContain('according to the current `review_mode`');
      expect(enGuard).toContain('validated according to `review_mode`');
      expect(enGuard).not.toContain('wait for both spec compliance and code quality reviews');
      expect(enGuard).not.toContain('passed both reviews');
      expect(enGuard).not.toContain('After dual review');
      expect(enDispatch).toContain(
        'Superpowers `subagent-driven-development` skill provides the base continuous dispatch loop',
      );
      expect(enDispatch).toContain("Comet's `review_mode` takes over the reviewer stage");
      expect(enDispatch).not.toContain('with review and fix flow determined by `review_mode`');
      expect(enDispatch).toContain('The selected `review_mode`');
      expect(enDispatch).toContain('After `review_mode` validation');
      expect(enDispatch).toContain(
        'When a reviewer returns an item that cannot be verified from review material alone',
      );
      expect(enDispatch).toContain(
        'If the loaded Superpowers `subagent-driven-development` skill reports a task complete through its own progress record',
      );
      expect(enDispatch).toContain(
        'Comet does not read, write, or require any Superpowers `subagent-driven-development` internal scripts or workspace paths',
      );
      for (const forbidden of [
        'spec reviewer',
        'code quality reviewer',
        'spec compliance reviewer',
        'dual-review',
        'both reviews',
        'task-reviewer-prompt',
        'task-brief',
        'review-package',
        'sdd-workspace',
        '.superpowers/sdd',
        'SDD ' + 'skill',
        'loaded ' + 'SDD',
        'Superpowers ' + 'SDD',
      ]) {
        expect(enDispatch, `en dispatch should not bind to ${forbidden}`).not.toContain(forbidden);
      }
      expect(enDispatch).not.toContain('After both reviews pass');
      expect(enDispatch).not.toContain('dual-review approval');
    });

    it('does not install a Stop hook for task continuity', async () => {
      const manifest = await readManifest();
      const hooks = Object.values(manifest.hooks ?? {});

      expect(hooks.length).toBeGreaterThan(0);
      expect(hooks.every((hook) => hook.matcher === 'Write|Edit')).toBe(true);
      expect(hooks.some((hook) => /stop/i.test(hook.matcher))).toBe(false);
    });
  });

  describe('Comet phase guard rules', () => {
    const section = (content: string, heading: string) => {
      const start = content.indexOf(heading);
      expect(start).toBeGreaterThanOrEqual(0);
      const rest = content.slice(start + heading.length);
      const nextHeading = rest.search(/\n## /u);
      return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
    };

    it('delegates post-guard handoff to comet-state next so auto_transition is honored', async () => {
      const zhGuard = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'rules', 'comet-phase-guard.md'),
        'utf-8',
      );
      const enGuard = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'rules', 'comet-phase-guard.en.md'),
        'utf-8',
      );

      const zhSection = section(zhGuard, '## 阶段退出后自动过渡');
      expect(zhSection).toContain('comet-state next <change-name>');
      expect(zhSection).toContain('NEXT: auto');
      expect(zhSection).toContain('NEXT: manual');
      expect(zhSection).toContain('NEXT: done');
      expect(zhSection).not.toContain('必须调用下一阶段的 skill');
      expect(zhSection).not.toContain('open → `comet-design`');

      const enSection = section(enGuard, '## Automatic Transition After Phase Exit');
      expect(enSection).toContain('comet-state next <change-name>');
      expect(enSection).toContain('NEXT: auto');
      expect(enSection).toContain('NEXT: manual');
      expect(enSection).toContain('NEXT: done');
      expect(enSection).not.toContain("must invoke the next phase's skill");
      expect(enSection).not.toContain('open → `comet-design`');
    });

    it('keeps build decision rules aligned with the four build choices', async () => {
      const zhGuard = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'rules', 'comet-phase-guard.md'),
        'utf-8',
      );
      const enGuard = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'rules', 'comet-phase-guard.en.md'),
        'utf-8',
      );

      expect(zhGuard).toContain('`isolation` / `build_mode` / `tdd_mode` / `review_mode` 四项选择');
      expect(enGuard).toContain(
        'four choices: `isolation` / `build_mode` / `tdd_mode` / `review_mode`',
      );
    });

    it('documents the Superpowers workspace hook allowlist in both languages', async () => {
      const zhGuard = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'rules', 'comet-phase-guard.md'),
        'utf-8',
      );
      const enGuard = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'rules', 'comet-phase-guard.en.md'),
        'utf-8',
      );

      expect(zhGuard).toContain('`.superpowers/*`');
      expect(enGuard).toContain('`.superpowers/*`');
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
      expect(manifest.skills).toContain('comet/reference/intent-frame.md');
      expect(manifest.skills).toContain('comet/scripts/comet-env.mjs');
      expect(manifest.skills).toContain('comet/scripts/comet-intent.mjs');
    });

    it('documents Ambient Resume in both Comet entry Skills', async () => {
      const zh = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet', 'SKILL.md'),
        'utf-8',
      );
      const en = await fs.readFile(path.resolve('assets', 'skills', 'comet', 'SKILL.md'), 'utf-8');

      expect(zh).toContain('Comet Ambient Resume');
      expect(zh).toContain('node "$COMET_RESUME_PROBE" probe --stdin');
      expect(zh).toContain('不把无关任务挂到 active Comet change');
      expect(en).toContain('Comet Ambient Resume');
      expect(en).toContain('node "$COMET_RESUME_PROBE" probe --stdin');
      expect(en).toContain('Never attach unrelated work');
    });

    it('documents the resume probe script in both script references', async () => {
      const zh = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet', 'reference', 'scripts.md'),
        'utf-8',
      );
      const en = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'reference', 'scripts.md'),
        'utf-8',
      );

      expect(zh).toContain('COMET_RESUME_PROBE="$COMET_SCRIPTS_DIR/comet-resume-probe.mjs"');
      expect(zh).toContain('| `COMET_RESUME_PROBE` |');
      expect(en).toContain('COMET_RESUME_PROBE="$COMET_SCRIPTS_DIR/comet-resume-probe.mjs"');
      expect(en).toContain('| `COMET_RESUME_PROBE` |');
    });

    it('documents every Classic transition event and the archive boundary bilingually', async () => {
      const zh = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet', 'reference', 'scripts.md'),
        'utf-8',
      );
      const en = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'reference', 'scripts.md'),
        'utf-8',
      );

      for (const event of [
        'open-complete',
        'design-complete',
        'build-complete',
        'verify-pass',
        'verify-fail',
        'archive-confirm',
        'archive-reopen',
        'archived',
        'preset-escalate',
      ]) {
        expect(zh).toContain(`comet state transition <change-name> ${event}`);
        expect(en).toContain(`comet state transition <change-name> ${event}`);
      }
      expect(zh).toContain('不要在归档流程之外手动执行 `archived` transition');
      expect(en).toContain('do not manually run the `archived` transition outside that flow');
    });

    it('documents the Ambient Resume probe command in context recovery references', async () => {
      const zh = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet', 'reference', 'context-recovery.md'),
        'utf-8',
      );
      const en = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'reference', 'context-recovery.md'),
        'utf-8',
      );

      expect(zh).toContain('comet/reference/scripts.md');
      expect(zh).toContain('node "$COMET_RESUME_PROBE" probe --stdin');
      expect(en).toContain('comet/reference/scripts.md');
      expect(en).toContain('node "$COMET_RESUME_PROBE" probe --stdin');
    });

    it('keeps review_mode wired through state and schema scripts', async () => {
      const stateScript = await fs.readFile(
        path.resolve('domains', 'comet-classic', 'classic-state-command.ts'),
        'utf-8',
      );
      const guardScript = await fs.readFile(
        path.resolve('domains', 'comet-classic', 'classic-guard.ts'),
        'utf-8',
      );
      const validateScript = await fs.readFile(
        path.resolve('domains', 'comet-classic', 'classic-validate-command.ts'),
        'utf-8',
      );

      expect(stateScript).toContain('review_mode: reviewMode');
      expect(stateScript).toContain("review_mode: ['off', 'standard', 'thorough']");
      expect(stateScript).toContain("projectConfigValue('review_mode')");
      expect(stateScript).toContain('review_mode must be selected before leaving build');
      expect(guardScript).toContain('reviewModeSelected');
      expect(guardScript).toContain("check('review_mode selected'");
      expect(validateScript).toContain("review_mode: ['off', 'standard', 'thorough']");
    });

    it('keeps platform search roots out of English and Chinese skill prose', async () => {
      const manifest = await readManifest();
      const skillPaths = manifest.skills.filter(
        (skillPath) =>
          skillPath.endsWith('.md') &&
          (skillPath === 'comet/SKILL.md' ||
            skillPath.startsWith('comet-') ||
            skillPath.startsWith('comet-any/')),
      );

      for (const languageDir of ['skills', 'skills-zh']) {
        for (const skillPath of skillPaths) {
          const content = await fs.readFile(
            path.resolve('assets', languageDir, skillPath),
            'utf-8',
          );
          if (!content.includes('COMET_STATE') && !content.includes('COMET_GUARD')) continue;

          // Skills may either carry the bootstrap inline or delegate it to
          // reference/scripts.md for progressive loading. Inline bootstrap still
          // needs the safe HOME glob; delegated bootstrap is validated in scripts.md.
          const isMainEntry = skillPath === 'comet/SKILL.md';
          const delegatesBootstrap = content.includes('comet/reference/scripts.md');
          const hasInlineBootstrap = content.includes('node "$COMET_ENV"');

          if (!isMainEntry) {
            expect(
              delegatesBootstrap || hasInlineBootstrap,
              `${languageDir}/${skillPath} should either delegate or inline Comet bootstrap`,
            ).toBe(true);
            if (hasInlineBootstrap) {
              expect(content, `${languageDir}/${skillPath} should use comet-env.mjs`).toContain(
                'comet-env.mjs',
              );
              expect(
                content,
                `${languageDir}/${skillPath} should allow HOME skill glob expansion`,
              ).toContain('"$HOME"/.*/skills');
              expect(
                content,
                `${languageDir}/${skillPath} should not quote the HOME skill glob`,
              ).not.toContain('"$HOME/.*/skills"');
            }
          } else {
            expect(
              content,
              `${languageDir}/${skillPath} should delegate bootstrap to reference/scripts.md`,
            ).toContain('comet/reference/scripts.md');
          }
          expect(content, `${languageDir}/${skillPath} should not inline roots`).not.toContain(
            'COMET_SEARCH_ROOTS=',
          );
        }
      }
    });

    it('uses node (not bash) in shipped Comet command examples', async () => {
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

    it('keeps the COMET_ENV locator block identical across shipped skills', async () => {
      const manifest = await readManifest();
      const skillPaths = manifest.skills.filter(
        (skillPath) =>
          skillPath.endsWith('SKILL.md') &&
          (skillPath === 'comet/SKILL.md' || skillPath.startsWith('comet-')),
      );

      const extractLocatorBlock = (content: string) => {
        const start = content.indexOf('COMET_ENV="${COMET_ENV:-$(find .');
        const end = content.indexOf('node "$COMET_ENV"');

        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);

        return content.slice(start, end + 'node "$COMET_ENV"'.length);
      };

      for (const languageDir of ['skills', 'skills-zh']) {
        let baseline: string | null = null;

        for (const skillPath of skillPaths) {
          const content = await fs.readFile(
            path.resolve('assets', languageDir, skillPath),
            'utf-8',
          );
          if (!content.includes('COMET_ENV="${COMET_ENV:-$(find .')) continue;

          const locatorBlock = extractLocatorBlock(content);
          if (baseline === null) {
            baseline = locatorBlock;
            continue;
          }

          expect(
            locatorBlock,
            `${languageDir}/${skillPath} should reuse the shared locator block`,
          ).toBe(baseline);
        }
      }
    });

    it('ships every comet reference doc that skill prose points to', async () => {
      const manifest = await readManifest();
      const manifestSkills = new Set(manifest.skills);
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
          const references =
            content.match(/(?:comet|comet-any)\/reference\/(?:subagents\/)?[a-z-]+\.md/g) ?? [];

          for (const referencePath of new Set(references)) {
            expect(
              manifestSkills.has(referencePath),
              `${languageDir}/${skillPath} references ${referencePath} but manifest.json does not ship it`,
            ).toBe(true);
          }
        }
      }
    });
  });

  describe('parseProjectConfigOverrides', () => {
    it('returns empty object for empty or whitespace-only input', () => {
      expect(parseProjectConfigOverrides('')).toEqual({});
      expect(parseProjectConfigOverrides('   \n  ')).toEqual({});
    });

    it('returns empty object for malformed YAML', () => {
      expect(parseProjectConfigOverrides('{{invalid')).toEqual({});
    });

    it('parses valid YAML into string-keyed record', () => {
      const result = parseProjectConfigOverrides(
        'context_compression: beta\nreview_mode: thorough\n',
      );
      expect(result).toEqual({ context_compression: 'beta', review_mode: 'thorough' });
    });

    it('converts booleans and numbers to strings', () => {
      const result = parseProjectConfigOverrides('auto_transition: true\ncount: 42\n');
      expect(result.auto_transition).toBe('true');
      expect(result.count).toBe('42');
    });

    it('skips null values', () => {
      const result = parseProjectConfigOverrides('context_compression: null\n');
      expect(result).toEqual({});
    });
  });

  describe('renderProjectConfig', () => {
    it('renders all managed fields with defaults when no existing values', () => {
      const output = renderProjectConfig({});
      expect(output).toContain('# language: en | zh-CN');
      expect(output).toContain('language: en');
      expect(output).toContain('# context_compression: off | beta');
      expect(output).toContain('context_compression: off');
      expect(output).toContain('# review_mode: off | standard | thorough');
      expect(output).toContain('review_mode: standard');
      expect(output).toContain('# auto_transition: true | false');
      expect(output).toContain('auto_transition: true');
    });

    it('preserves existing managed field values', () => {
      const output = renderProjectConfig({
        language: 'zh-CN',
        context_compression: 'beta',
        review_mode: 'thorough',
        auto_transition: 'false',
      });
      expect(output).toContain('language: zh-CN');
      expect(output).toContain('context_compression: beta');
      expect(output).toContain('review_mode: thorough');
      expect(output).toContain('auto_transition: false');
    });

    it('uses the selected artifact language as the default language value', () => {
      const output = renderProjectConfig({}, 'zh-CN');
      expect(output).toContain('language: zh-CN');
    });

    it('forces the language field to the passed value even when an existing value differs', () => {
      const output = renderProjectConfig({ language: 'en' }, 'zh-CN');
      expect(output).toContain('language: zh-CN');
    });

    it('preserves the existing language when no language override is passed', () => {
      const output = renderProjectConfig({ language: 'zh-CN' }, null);
      expect(output).toContain('language: zh-CN');
    });

    it('preserves extra user fields after managed fields', () => {
      const output = renderProjectConfig({ custom_key: 'custom_value' });
      expect(output).toContain('custom_key: custom_value');
    });

    it('trailing newline', () => {
      const output = renderProjectConfig({});
      expect(output.endsWith('\n')).toBe(true);
    });
  });

  describe('mergeProjectConfig', () => {
    it('creates config with defaults when no file exists', async () => {
      await mergeProjectConfig(tmpDir);
      const content = await fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf-8');
      expect(content).toContain('language: en');
      expect(content).toContain('context_compression: off');
      expect(content).toContain('review_mode: standard');
      expect(content).toContain('auto_transition: true');
    });

    it('preserves existing user values and fills missing managed fields', async () => {
      const configDir = path.join(tmpDir, '.comet');
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, 'config.yaml'),
        'context_compression: beta\n',
        'utf-8',
      );

      await mergeProjectConfig(tmpDir);
      const content = await fs.readFile(path.join(configDir, 'config.yaml'), 'utf-8');
      expect(content).toContain('language: en');
      expect(content).toContain('context_compression: beta');
      expect(content).toContain('review_mode: standard');
      expect(content).toContain('auto_transition: true');
    });

    it('preserves extra user fields', async () => {
      const configDir = path.join(tmpDir, '.comet');
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, 'config.yaml'),
        'context_compression: beta\ncustom_setting: hello\n',
        'utf-8',
      );

      await mergeProjectConfig(tmpDir);
      const content = await fs.readFile(path.join(configDir, 'config.yaml'), 'utf-8');
      expect(content).toContain('custom_setting: hello');
    });

    it('overwrites review_mode default from off to standard on re-init', async () => {
      const configDir = path.join(tmpDir, '.comet');
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(path.join(configDir, 'config.yaml'), 'review_mode: off\n', 'utf-8');

      await mergeProjectConfig(tmpDir);
      const content = await fs.readFile(path.join(configDir, 'config.yaml'), 'utf-8');
      expect(content).toContain('review_mode: off');
    });

    it('overwrites an existing language when a new language is explicitly passed', async () => {
      const configDir = path.join(tmpDir, '.comet');
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(path.join(configDir, 'config.yaml'), 'language: en\n', 'utf-8');

      await mergeProjectConfig(tmpDir, 'zh-CN');
      const content = await fs.readFile(path.join(configDir, 'config.yaml'), 'utf-8');
      expect(content).toContain('language: zh-CN');
    });

    it('preserves the existing language when no language is passed', async () => {
      const configDir = path.join(tmpDir, '.comet');
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(path.join(configDir, 'config.yaml'), 'language: zh-CN\n', 'utf-8');

      await mergeProjectConfig(tmpDir, null);
      const content = await fs.readFile(path.join(configDir, 'config.yaml'), 'utf-8');
      expect(content).toContain('language: zh-CN');
    });
  });

  describe('createWorkingDirs with config merge', () => {
    it('merges config on second call instead of skipping', async () => {
      await createWorkingDirs(tmpDir);
      const configPath = path.join(tmpDir, '.comet', 'config.yaml');
      // Simulate old config with review_mode: off
      await fs.writeFile(configPath, 'review_mode: off\n', 'utf-8');

      await createWorkingDirs(tmpDir);
      const content = await fs.readFile(configPath, 'utf-8');
      expect(content).toContain('review_mode: off');
      expect(content).toContain('context_compression: off');
      expect(content).toContain('auto_transition: true');
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
