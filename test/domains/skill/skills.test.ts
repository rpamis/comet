import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { parse } from 'yaml';

const { readJsonMock, readFileMock, writeFileMock } = vi.hoisted(() => ({
  readJsonMock: vi.fn(),
  readFileMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  readFileMock.mockImplementation(actual.readFile);
  writeFileMock.mockImplementation(actual.writeFile);
  return { ...actual, readFile: readFileMock, writeFile: writeFileMock };
});

vi.mock('../../../platform/fs/file-system.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platform/fs/file-system.js')>();
  readJsonMock.mockImplementation(actual.readJson);
  return { ...actual, readJson: readJsonMock };
});

import {
  getAssetsDir,
  readManifest,
  getManifestSkills,
  createWorkingDirs,
  copyCometSkillsForPlatform,
  copyCometRulesForPlatform,
  installCometHooksForPlatform,
  parseProjectConfigOverrides,
  renderProjectConfig,
  mergeProjectConfig,
} from '../../../domains/skill/platform-install.js';
import {
  reconcileCometHooksForPlatform,
  reconcileProjectCometHooksForPlatform,
} from '../../../domains/skill/hook-lifecycle.js';
import { removeCometHooksForPlatform } from '../../../domains/skill/uninstall.js';
import { PLATFORMS, type Platform } from '../../../platform/install/platforms.js';
import {
  artifactLanguageToSkillLanguage,
  resolveArtifactLanguage,
} from '../../../domains/skill/languages.js';
import { assertClassicLayoutInitializationSafe } from '../../../domains/comet-classic/classic-layout-initialization.js';
import {
  createNativeChange,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { selectNativeChange } from '../../../domains/comet-native/native-selection.js';
import { DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG } from '../../../domains/workflow-contract/project-config.js';

describe('skills', () => {
  let tmpDir: string;

  beforeEach(async () => {
    readJsonMock.mockReset();
    readJsonMock.mockImplementation(
      async (filePath: string) =>
        JSON.parse(await fs.readFile(filePath, 'utf-8')) as Record<string, unknown>,
    );
    readFileMock.mockReset();
    readFileMock.mockImplementation(fs.readFile);
    writeFileMock.mockReset();
    writeFileMock.mockImplementation(fs.writeFile);
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

    it('does not re-evaluate applicability after the comet skill loads', async () => {
      const zhContent = await fs.readFile(
        path.join(getAssetsDir(), 'skills-zh', 'comet', 'SKILL.md'),
        'utf-8',
      );
      const enContent = await fs.readFile(
        path.join(getAssetsDir(), 'skills', 'comet', 'SKILL.md'),
        'utf-8',
      );

      expect(zhContent).toContain(
        '当用户明确调用 /comet，或明确要求使用 Comet 但未指定 Native/Classic 时使用',
      );
      expect(zhContent).toContain('一旦加载本 Skill，就视为已经选定 `/comet` 入口');
      expect(zhContent).toContain('不得重新判断任务是否适合 Comet');
      expect(zhContent).toContain('必须立即执行下方入口解析');
      expect(zhContent).toContain('只按返回的 `skill` 选择下列一个入口');
      expect(zhContent).toContain(
        '**立即执行：** 使用 Skill 工具加载 `comet-native` 技能。禁止跳过此步骤。',
      );
      expect(zhContent).toContain(
        '**立即执行：** 使用 Skill 工具加载 `comet-classic` 技能。禁止跳过此步骤。',
      );
      expect(zhContent).toContain('不得搜索 Skill 文件、扫描平台配置目录或直接调用内部 bundle');
      expect(zhContent).toContain('技能加载后，把用户原始请求完整交给已加载的入口 Skill');

      expect(enContent).toContain(
        'Use when the user explicitly invokes /comet or asks to use Comet without choosing Native or Classic',
      );
      expect(enContent).toContain(
        'Once this Skill is loaded, treat the `/comet` entry as selected',
      );
      expect(enContent).toContain('do not re-evaluate whether the task is suitable for Comet');
      expect(enContent).toContain('Immediately perform the entry resolution below');
      expect(enContent).toContain('Select exactly one entry based only on the returned `skill`');
      expect(enContent).toContain(
        '**Execute immediately:** Use the Skill tool to load the `comet-native` skill. Do not skip this step.',
      );
      expect(enContent).toContain(
        '**Execute immediately:** Use the Skill tool to load the `comet-classic` skill. Do not skip this step.',
      );
      expect(enContent).toContain(
        "After the skill is loaded, pass the user's original request unchanged to the loaded entry Skill",
      );
    });

    it('rejects zh and en-US as artifact language values', () => {
      expect(() => resolveArtifactLanguage('zh')).toThrow('Invalid artifact language');
      expect(() => resolveArtifactLanguage('en-US')).toThrow('Invalid artifact language');
    });

    it('maps persisted artifact languages to skill language ids', () => {
      expect(artifactLanguageToSkillLanguage('zh-CN')).toBe('zh');
      expect(artifactLanguageToSkillLanguage('en')).toBe('en');
      expect(artifactLanguageToSkillLanguage(undefined)).toBe('en');
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

    it('keeps both Native skills operational without unreleased migration narratives', async () => {
      for (const languageDir of ['skills', 'skills-zh']) {
        const nativeDir = path.join(getAssetsDir(), languageDir, 'comet-native');
        const main = await fs.readFile(path.join(nativeDir, 'SKILL.md'), 'utf-8');
        const references = await Promise.all(
          ['commands.md', 'artifacts.md', 'recovery.md'].map((file) =>
            fs.readFile(path.join(nativeDir, 'reference', file), 'utf-8'),
          ),
        );
        const allContent = [main, ...references].join('\n');

        const requiredCommands =
          languageDir === 'skills-zh'
            ? [
                'comet native select <change-name>',
                'comet native check <change-name>',
                'comet native archive <change-name> --dry-run',
                'comet native spec rebase',
                'comet native checkpoint',
              ]
            : [
                'comet native select <change-name>',
                'comet native check <change-name>',
                'comet native archive <change-name> --dry-run',
                'comet native spec rebase',
                'comet native checkpoint',
              ];
        for (const required of [
          ...requiredCommands,
          'continuation.disposition',
          '[blocking]',
          '--confirmed',
          '--no-code-reason',
          '--allow-partial-scope',
          'git-selection-changed',
          'physical-selection-changed',
          'scope-detail-overflow',
          'acceptancePage.nextCursor',
          '--result pass|fail',
          '--report verification.md',
          '--override-repair',
          '--expect-preflight',
          'baseline-snapshot-missing',
          'workspace-root-changed',
        ]) {
          expect(allContent, `${languageDir}: ${required}`).toContain(required);
        }

        const phaseHeadings = ['## Shape', '## Build', '## Verify', '## Archive'];
        const phaseOffsets = phaseHeadings.map((heading) => main.indexOf(heading));
        expect(phaseOffsets.every((offset) => offset >= 0)).toBe(true);
        expect(phaseOffsets).toEqual([...phaseOffsets].sort((left, right) => left - right));

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
          'comet native list',
          '--evidence-receipt',
          '--failure-category',
          '--failed-check',
          'external-role handoff',
          '外部角色交接',
        ]) {
          expect(allContent, `${languageDir}: ${unwanted}`).not.toContain(unwanted);
        }
      }

      const zhMain = await fs.readFile(
        path.join(getAssetsDir(), 'skills-zh', 'comet-native', 'SKILL.md'),
        'utf-8',
      );
      const enMain = await fs.readFile(
        path.join(getAssetsDir(), 'skills', 'comet-native', 'SKILL.md'),
        'utf-8',
      );
      expect(zhMain).toMatch(/transition 成功后(?:不再调用工具|禁止任何工具调用)/);
      expect(zhMain).toContain('不依赖任何外部 Skill');
      expect(enMain).toContain('make no tool calls after the transition succeeds');
      expect(enMain).toContain('does not depend on any external Skill');
    });

    it('requires clarification before Native Shape can modify implementation or enter Build', async () => {
      const zhMain = await fs.readFile(
        path.join(getAssetsDir(), 'skills-zh', 'comet-native', 'SKILL.md'),
        'utf-8',
      );
      const enMain = await fs.readFile(
        path.join(getAssetsDir(), 'skills', 'comet-native', 'SKILL.md'),
        'utf-8',
      );
      const zhClarification = await fs.readFile(
        path.join(getAssetsDir(), 'skills-zh', 'comet-native', 'reference', 'clarification.md'),
        'utf-8',
      );
      const enClarification = await fs.readFile(
        path.join(getAssetsDir(), 'skills', 'comet-native', 'reference', 'clarification.md'),
        'utf-8',
      );

      const zhSectionOffsets = [
        zhMain.indexOf('## 核心规则'),
        zhMain.indexOf('## 开始或恢复'),
        zhMain.indexOf('## 按需加载'),
        zhMain.indexOf('## Shape'),
      ];
      expect(zhSectionOffsets.every((offset) => offset >= 0)).toBe(true);
      expect(zhSectionOffsets).toEqual([...zhSectionOffsets].sort((left, right) => left - right));
      expect(zhMain).toContain('确认当前 change 和 phase 后，再按需读取一份对应 reference');
      expect(zhMain).not.toContain('5. 只读取当前 phase 需要的正式产物');
      expect(zhMain).toContain('进入 Shape 时，必须先读取并执行[澄清参考]');
      expect(zhMain).toContain('不得以“需求看起来明确”为由跳过');
      expect(zhMain).toContain('即使初步判断没有未决行为，也必须完成');
      expect(zhMain).toContain('完成共享理解确认前，不得修改项目实现或推进到 Build');
      expect(zhClarification).toContain('进入 Shape 后必须读取本文件');
      expect(zhClarification).toContain(
        '完成问题判定、静默假设检查和共享理解确认前，不得修改项目实现或推进到 Build',
      );

      const enSectionOffsets = [
        enMain.indexOf('## Core rules'),
        enMain.indexOf('## Start or resume'),
        enMain.indexOf('## On-demand loading'),
        enMain.indexOf('## Shape'),
      ];
      expect(enSectionOffsets.every((offset) => offset >= 0)).toBe(true);
      expect(enSectionOffsets).toEqual([...enSectionOffsets].sort((left, right) => left - right));
      expect(enMain).toContain('After confirming the current change and phase');
      expect(enMain).not.toContain('5. Read only the formal artifacts');
      expect(enMain).toContain('When entering Shape, you must first read and execute');
      expect(enMain).toContain('Do not skip it because “the requirements look clear.”');
      expect(enMain).toContain('Even when the initial assessment finds no unresolved behavior');
      expect(enMain).toContain(
        'Do not modify project implementation or advance to Build until shared understanding is confirmed',
      );
      expect(enClarification).toContain('You must read this file after entering Shape');
      expect(enClarification).toContain(
        'Do not modify project implementation or advance to Build until problem classification, the silent-assumption check, and shared-understanding confirmation are complete',
      );
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

  describe('copyCometRulesForPlatform', () => {
    it('installs the unified workflow Rule for a Native project', async () => {
      const platform = PLATFORMS.find((candidate) => candidate.id === 'claude')!;

      await expect(
        copyCometRulesForPlatform(tmpDir, platform, true, 'en', 'project', 'native'),
      ).resolves.toEqual({ copied: 1, skipped: 0, failed: 0 });

      await expect(
        fs.access(path.join(tmpDir, '.claude', 'rules', 'comet-workflow-guard.md')),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(tmpDir, '.claude', 'rules', 'comet-phase-guard.md')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        fs.access(path.join(tmpDir, '.claude', 'rules', 'comet-native-phase-guard.md')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('reports a missing Rule source as failed', async () => {
      readJsonMock.mockResolvedValue({
        version: 'test',
        skills: [],
        rules: ['comet/rules/missing-rule.md'],
      });
      const platform = PLATFORMS.find((candidate) => candidate.id === 'claude')!;
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        await expect(
          copyCometRulesForPlatform(tmpDir, platform, true, 'zh', 'project'),
        ).resolves.toEqual({ copied: 0, skipped: 0, failed: 1 });
        expect(error).toHaveBeenCalledWith(expect.stringContaining('Rule source not found'));
      } finally {
        error.mockRestore();
      }
    });

    it('reports a Rule source permission failure without calling it missing', async () => {
      const platform = PLATFORMS.find((candidate) => candidate.id === 'claude')!;
      const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      readFileMock.mockRejectedValueOnce(permissionError);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        await expect(
          copyCometRulesForPlatform(tmpDir, platform, true, 'zh', 'project'),
        ).resolves.toEqual({ copied: 0, skipped: 0, failed: 1 });
        expect(error).toHaveBeenCalledWith(expect.stringContaining('Failed to copy rule'));
        expect(error).not.toHaveBeenCalledWith(expect.stringContaining('Rule source not found'));
      } finally {
        error.mockRestore();
      }
    });

    it('reports a Rule source access failure without calling it missing', async () => {
      const platform = PLATFORMS.find((candidate) => candidate.id === 'claude')!;
      const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      const accessSpy = vi.spyOn(fs, 'access').mockRejectedValue(permissionError);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        await expect(
          copyCometRulesForPlatform(tmpDir, platform, true, 'zh', 'project'),
        ).resolves.toEqual({ copied: 0, skipped: 0, failed: 1 });
        expect(error).toHaveBeenCalledWith(expect.stringContaining('Failed to copy rule'));
        expect(error).not.toHaveBeenCalledWith(expect.stringContaining('Rule source not found'));
      } finally {
        accessSpy.mockRestore();
        error.mockRestore();
      }
    });

    it('reports a Rule copy permission failure', async () => {
      const platform = PLATFORMS.find((candidate) => candidate.id === 'claude')!;
      const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      writeFileMock.mockRejectedValueOnce(permissionError);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        await expect(
          copyCometRulesForPlatform(tmpDir, platform, true, 'zh', 'project'),
        ).resolves.toEqual({ copied: 0, skipped: 0, failed: 1 });
        expect(error).toHaveBeenCalledWith(expect.stringContaining('Failed to copy rule'));
      } finally {
        error.mockRestore();
      }
    });
  });

  it.each([
    { installMode: 'copy' as const, destinationRoot: ['.claude', 'skills'] },
    { installMode: 'symlink' as const, destinationRoot: ['.comet', 'skills', 'skills'] },
  ])(
    'counts a $installMode Skill destination preflight access error instead of rejecting',
    async ({ installMode, destinationRoot }) => {
      const platform = PLATFORMS.find((candidate) => candidate.id === 'claude')!;
      const blockedDestination = path.join(tmpDir, ...destinationRoot, 'comet', 'SKILL.md');
      const access = fs.access.bind(fs);
      const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      const accessSpy = vi.spyOn(fs, 'access').mockImplementation(async (filePath, mode) => {
        if (path.resolve(String(filePath)) === path.resolve(blockedDestination)) {
          throw permissionError;
        }
        await access(filePath, mode);
      });
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        const result = await copyCometSkillsForPlatform(
          tmpDir,
          platform,
          false,
          'skills',
          'project',
          installMode,
        );
        expect(result.failed).toBeGreaterThan(0);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
      } finally {
        error.mockRestore();
        accessSpy.mockRestore();
      }
    },
  );

  it.each(['copy', 'symlink'] as const)(
    'counts an OpenCode command artifact access failure in %s mode without rejecting',
    async (installMode) => {
      const platform = PLATFORMS.find((candidate) => candidate.id === 'opencode')!;
      const blockedArtifact = path.join(tmpDir, '.opencode', 'commands', 'comet.md');
      const access = fs.access.bind(fs);
      const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      const accessSpy = vi.spyOn(fs, 'access').mockImplementation(async (filePath, mode) => {
        if (path.resolve(String(filePath)) === path.resolve(blockedArtifact)) {
          throw permissionError;
        }
        await access(filePath, mode);
      });
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        const result = await copyCometSkillsForPlatform(
          tmpDir,
          platform,
          false,
          'skills',
          'project',
          installMode,
        );
        expect(result.failed).toBeGreaterThan(0);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
      } finally {
        error.mockRestore();
        accessSpy.mockRestore();
      }
    },
  );

  it.each(['copy', 'symlink'] as const)(
    'counts a Pi settings write failure in %s mode without creating an extension',
    async (installMode) => {
      const platform = PLATFORMS.find((candidate) => candidate.id === 'pi')!;
      const settingsPath = path.join(tmpDir, '.pi', 'settings.json');
      const extensionPath = path.join(tmpDir, '.pi', 'extensions', 'comet-commands.ts');
      const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      writeFileMock.mockImplementation(async (filePath, ...args) => {
        const resolved = path.resolve(String(filePath));
        if (resolved === path.resolve(settingsPath)) throw permissionError;
        return fs.writeFile(filePath, ...args);
      });
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        const result = await copyCometSkillsForPlatform(
          tmpDir,
          platform,
          false,
          'skills',
          'project',
          installMode,
        );
        expect(result.failed).toBeGreaterThanOrEqual(1);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
        await expect(fs.access(extensionPath)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        error.mockRestore();
      }
    },
  );

  it.each(['copy', 'symlink'] as const)(
    'counts a Pi extension write failure in %s mode without rejecting',
    async (installMode) => {
      const platform = PLATFORMS.find((candidate) => candidate.id === 'pi')!;
      const settingsPath = path.join(tmpDir, '.pi', 'settings.json');
      const extensionPath = path.join(tmpDir, '.pi', 'extensions', 'comet-commands.ts');
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(settingsPath, '{"enableSkillCommands":true}\n', 'utf8');
      const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      writeFileMock.mockImplementation(async (filePath, ...args) => {
        if (path.resolve(String(filePath)) === path.resolve(extensionPath)) throw permissionError;
        return fs.writeFile(filePath, ...args);
      });
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        const result = await copyCometSkillsForPlatform(
          tmpDir,
          platform,
          false,
          'skills',
          'project',
          installMode,
        );
        expect(result.failed).toBeGreaterThanOrEqual(1);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
      } finally {
        error.mockRestore();
      }
    },
  );

  describe('createWorkingDirs', () => {
    it('creates superpowers spec and plan directories', async () => {
      await createWorkingDirs(tmpDir);

      const specsDir = path.join(tmpDir, 'docs', 'superpowers', 'specs');
      const plansDir = path.join(tmpDir, 'docs', 'superpowers', 'plans');

      await expect(fs.stat(specsDir)).resolves.toBeDefined();
      await expect(fs.stat(plansDir)).resolves.toBeDefined();
    });

    it('reuses an existing desired artifact root without a layout conflict', async () => {
      await createWorkingDirs(tmpDir);
      // After beta.13's Classic configuration recovery, a project whose desired
      // (docs) root already exists and has no conflicting legacy root can be
      // re-initialized in place instead of being rejected as unauthorized.
      await expect(createWorkingDirs(tmpDir)).resolves.toBeUndefined();
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
      await mergeProjectConfig(tmpDir, 'zh-CN', 'docs');

      const config = await fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf-8');
      expect(config).toContain('# Classic 工作流文档使用的产物语言');
      expect(config).not.toContain('# Artifact language used for workflow documents');
      expect(config).toContain('language: zh-CN');
    });

    it('defaults the project language to en when none is provided', async () => {
      await mergeProjectConfig(tmpDir);

      const config = await fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf-8');
      expect(config).toContain('# language: en | zh-CN');
      expect(config).toContain('language: en');
    });

    it.each([
      {
        label: 'OpenSpec changes',
        linkedPath: ['docs', 'openspec', 'changes'],
        escapedWrite: ['archive'],
      },
      {
        label: 'Superpowers root',
        linkedPath: ['docs', 'superpowers'],
        escapedWrite: ['specs'],
      },
      {
        label: 'Comet control directory',
        linkedPath: ['.comet'],
        escapedWrite: ['config.yaml'],
      },
    ])(
      'rejects a $label junction created after initialization preflight',
      async ({ linkedPath, escapedWrite }) => {
        const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-working-dirs-outside-'));
        try {
          const initialization = await assertClassicLayoutInitializationSafe(tmpDir, 'docs');
          await fs.mkdir(initialization.openSpecRoot, { recursive: true });
          const linked = path.join(tmpDir, ...linkedPath);
          await fs.mkdir(path.dirname(linked), { recursive: true });
          try {
            await fs.symlink(
              outsideRoot,
              linked,
              process.platform === 'win32' ? 'junction' : 'dir',
            );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
            throw error;
          }

          await expect(
            createWorkingDirs(tmpDir, 'en', 'docs', initialization.initializationPermit),
          ).rejects.toThrow(/symbolic link or junction/iu);
          await expect(fs.access(path.join(outsideRoot, ...escapedWrite))).rejects.toMatchObject({
            code: 'ENOENT',
          });
        } finally {
          await fs.rm(outsideRoot, { recursive: true, force: true });
        }
      },
    );
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
      expect(command).toContain('comet state init <name> full');
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
    const currentCometScript = 'comet/scripts/comet-hook-router.mjs';
    const normalized = (value: string) => value.replace(/\\/g, '/');
    const expectedHookCommand = (
      skillsDir: string,
      platformId: string,
      baseDir = tmpDir,
      scope: 'project' | 'global' = 'project',
    ) =>
      `node "${normalized(path.join(baseDir, skillsDir, 'skills', ...currentCometScript.split('/')))}" --platform "${platformId}"${scope === 'project' ? ` --project-root "${normalized(baseDir)}"` : ''}`;
    const runManagedHookCommand = (command: string, cwd: string) =>
      spawnSync(command, {
        cwd,
        input: JSON.stringify({
          tool_name: 'Write',
          tool_input: { file_path: 'src/app.ts' },
        }),
        shell: true,
        encoding: 'utf8',
        timeout: 20_000,
      });
    const configureNativeBuildChange = async (projectRoot: string): Promise<void> => {
      await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
      const paths = await nativeProjectPaths(projectRoot, '.');
      await ensureNativeDirectories(paths);
      const change = await createNativeChange({
        paths,
        name: 'trae-cn-build',
        language: 'en',
        verificationProtocol: 'legacy-v1',
      });
      change.phase = 'build';
      await writeNativeChange(paths, change);
      await selectNativeChange(paths, change.name);
    };

    it('installs only the unified Router Hook for a Native project', async () => {
      const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;

      await expect(
        installCometHooksForPlatform(tmpDir, codex, 'project', 'native'),
      ).resolves.toEqual({ status: 'installed' });

      const hooks = JSON.parse(
        await fs.readFile(path.join(tmpDir, '.codex', 'hooks.json'), 'utf8'),
      ) as { hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> } };
      const source = JSON.stringify(hooks).replaceAll('\\', '/');
      expect(source).toContain('comet/scripts/comet-hook-router.mjs');
      expect(source).toContain('--platform /"codex/"');
      expect(source).not.toContain('comet/scripts/comet-hook-guard.mjs');
      expect(source).not.toContain('comet-native/scripts/comet-native-hook-guard.mjs');
    });

    it('installs the Native Copilot Hook with a write matcher and structured denial output', async () => {
      const copilot = PLATFORMS.find((candidate) => candidate.id === 'github-copilot')!;

      await expect(
        installCometHooksForPlatform(tmpDir, copilot, 'project', 'native'),
      ).resolves.toEqual({ status: 'installed' });

      const config = JSON.parse(
        await fs.readFile(path.join(tmpDir, '.github', 'hooks', 'comet-guard.json'), 'utf8'),
      ) as {
        hooks: {
          preToolUse: Array<{ matcher?: string; bash: string; powershell: string }>;
        };
      };
      expect(config.hooks.preToolUse).toHaveLength(1);
      expect(config.hooks.preToolUse[0].matcher).toBe('create|edit|str_replace_editor|apply_patch');
      expect(config.hooks.preToolUse[0].bash.replaceAll('\\', '/')).toContain(
        'comet/scripts/comet-hook-router.mjs',
      );
      expect(config.hooks.preToolUse[0].bash).toContain('--platform "github-copilot"');
      expect(config.hooks.preToolUse[0].powershell).toBe(config.hooks.preToolUse[0].bash);
    });

    it('preserves existing Copilot Hook entries and settings when installing', async () => {
      const copilot = PLATFORMS.find((candidate) => candidate.id === 'github-copilot')!;
      const hookPath = path.join(tmpDir, '.github', 'hooks', 'comet-guard.json');
      const userHook = { matcher: '*', bash: 'node user-hook.mjs' };
      await fs.mkdir(path.dirname(hookPath), { recursive: true });
      await fs.writeFile(
        hookPath,
        JSON.stringify({
          version: 2,
          customSetting: true,
          hooks: {
            postToolUse: [{ matcher: '*', bash: 'node post-hook.mjs' }],
            preToolUse: [userHook],
          },
        }),
        'utf8',
      );

      await expect(
        installCometHooksForPlatform(tmpDir, copilot, 'project', 'native'),
      ).resolves.toEqual({ status: 'installed' });

      const updated = JSON.parse(await fs.readFile(hookPath, 'utf8')) as {
        version: number;
        customSetting: boolean;
        hooks: {
          postToolUse: unknown[];
          preToolUse: Array<Record<string, unknown>>;
        };
      };
      expect(updated.version).toBe(2);
      expect(updated.customSetting).toBe(true);
      expect(updated.hooks.postToolUse).toEqual([{ matcher: '*', bash: 'node post-hook.mjs' }]);
      expect(updated.hooks.preToolUse).toContainEqual(userHook);
      expect(
        updated.hooks.preToolUse.some((entry) => String(entry.bash).includes('comet-hook-router')),
      ).toBe(true);
    });

    it('returns failed when the Hook manifest cannot be read', async () => {
      const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
      readJsonMock.mockRejectedValueOnce(new Error('manifest unavailable'));

      await expect(installCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
        status: 'failed',
        reason: 'manifest unavailable',
      });
    });

    it('returns failed when a Hook-capable platform does not declare a format', async () => {
      const platform: Platform = {
        id: 'missing-hook-format',
        name: 'Missing Hook Format',
        skillsDir: '.missing-hook-format',
        openspecToolId: 'missing-hook-format',
        supportsHooks: true,
      };

      await expect(installCometHooksForPlatform(tmpDir, platform, 'project')).resolves.toEqual({
        status: 'failed',
        reason: 'hook-capable platform does not declare a hook format',
      });
    });

    it('writes project Codex hooks to .codex/hooks.json', async () => {
      const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
      const root = tmpDir;

      await expect(installCometHooksForPlatform(root, codex, 'project')).resolves.toEqual({
        status: 'installed',
      });

      const hooks = JSON.parse(await fs.readFile(path.join(root, '.codex', 'hooks.json'), 'utf-8'));
      expect(hooks.hooks.PreToolUse[0].hooks[0].command.replaceAll('\\', '/')).toContain(
        '/.agents/skills/comet/scripts/comet-hook-router.mjs',
      );
      await expect(
        fs.access(path.join(root, '.codex', 'settings.local.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('removes a historical global Codex Hook without changing the user Hook', async () => {
      const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
      const homeDir = path.join(tmpDir, 'home');
      const hooksPath = path.join(homeDir, '.codex', 'hooks.json');
      const userHook = { type: 'command', command: 'node my-user-hook.mjs' };
      await fs.mkdir(path.dirname(hooksPath), { recursive: true });
      await fs.writeFile(
        hooksPath,
        JSON.stringify({
          model: 'gpt-5',
          hooks: {
            PreToolUse: [
              { matcher: 'Write|Edit', hooks: [userHook] },
              {
                matcher: 'Write|Edit',
                hooks: [
                  {
                    type: 'command',
                    command: expectedHookCommand('.agents', 'codex', homeDir, 'global'),
                  },
                ],
              },
            ],
          },
        }),
        'utf-8',
      );

      await expect(reconcileCometHooksForPlatform(homeDir, codex, 'global')).resolves.toEqual({
        status: 'skipped',
        reason: 'blocking Hooks are project-scoped; removed 1 legacy global Hook',
      });

      const updated = JSON.parse(await fs.readFile(hooksPath, 'utf-8'));
      expect(updated.model).toBe('gpt-5');
      expect(updated.hooks.PreToolUse[0]).toEqual({ matcher: 'Write|Edit', hooks: [userHook] });
      expect(updated.hooks.PreToolUse[1]).toEqual({ matcher: 'Write|Edit', hooks: [] });
    });

    it('installs a project Router and removes the historical global Router atomically', async () => {
      const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
      const projectRoot = path.join(tmpDir, 'project');
      const homeDir = path.join(tmpDir, 'home');
      const globalHooksPath = path.join(homeDir, '.codex', 'hooks.json');
      const userHook = { type: 'command', command: 'node user-hook.mjs' };
      await fs.mkdir(path.dirname(globalHooksPath), { recursive: true });
      await fs.writeFile(
        globalHooksPath,
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: 'Write|Edit',
                hooks: [
                  userHook,
                  {
                    type: 'command',
                    command: expectedHookCommand('.agents', 'codex', homeDir, 'global'),
                  },
                ],
              },
            ],
          },
        }),
        'utf8',
      );

      await expect(
        reconcileProjectCometHooksForPlatform(projectRoot, codex, 'native', {
          globalBaseDir: homeDir,
        }),
      ).resolves.toEqual({ status: 'installed' });

      const projectHooks = JSON.parse(
        await fs.readFile(path.join(projectRoot, '.codex', 'hooks.json'), 'utf8'),
      );
      expect(projectHooks.hooks.PreToolUse[0].hooks[0].command).toBe(
        expectedHookCommand('.agents', 'codex', projectRoot),
      );
      const globalHooks = JSON.parse(await fs.readFile(globalHooksPath, 'utf8'));
      expect(globalHooks.hooks.PreToolUse[0].hooks).toEqual([userHook]);
    });

    it('does not remove the project Router when the project root is also the configured home', async () => {
      const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;

      await expect(
        reconcileProjectCometHooksForPlatform(tmpDir, codex, 'native', {
          globalBaseDir: tmpDir,
        }),
      ).resolves.toEqual({ status: 'installed' });

      const hooks = JSON.parse(
        await fs.readFile(path.join(tmpDir, '.codex', 'hooks.json'), 'utf8'),
      );
      expect(hooks.hooks.PreToolUse[0].hooks[0].command).toBe(
        expectedHookCommand('.agents', 'codex', tmpDir),
      );
    });

    it('reports incomplete project reconciliation when historical global cleanup fails', async () => {
      const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
      const projectRoot = path.join(tmpDir, 'project');
      const homeDir = path.join(tmpDir, 'home');
      const legacyPath = path.join(homeDir, '.codex', 'settings.local.json');
      await fs.mkdir(path.dirname(legacyPath), { recursive: true });
      await fs.writeFile(legacyPath, '{not-json', 'utf8');

      await expect(
        reconcileProjectCometHooksForPlatform(projectRoot, codex, 'native', {
          globalBaseDir: homeDir,
        }),
      ).resolves.toEqual({
        status: 'failed',
        cleanupFailed: 1,
        reason:
          'project Router installed, but failed to remove 1 historical global Hook configuration(s)',
      });
      await expect(
        fs.access(path.join(projectRoot, '.codex', 'hooks.json')),
      ).resolves.toBeUndefined();
      await expect(fs.readFile(legacyPath, 'utf8')).resolves.toBe('{not-json');
    });

    it('reports failure when a legacy Codex Hook config cannot be cleaned up', async () => {
      const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
      const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
      await fs.mkdir(path.dirname(legacyPath), { recursive: true });
      await fs.writeFile(legacyPath, '{not-json', 'utf-8');

      await expect(installCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
        status: 'failed',
        cleanupFailed: 1,
        reason: expect.stringContaining('legacy Hook cleanup failed'),
      });
      await expect(fs.readFile(legacyPath, 'utf-8')).resolves.toBe('{not-json');
    });

    it('keeps Codex hook installation idempotent when the project path contains spaces', async () => {
      const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
      const root = path.join(tmpDir, 'Jane Doe project');
      const canonicalPath = path.join(root, '.codex', 'hooks.json');

      await installCometHooksForPlatform(root, codex, 'project');
      const firstInstall = JSON.parse(await fs.readFile(canonicalPath, 'utf-8'));
      await installCometHooksForPlatform(root, codex, 'project');
      const secondInstall = JSON.parse(await fs.readFile(canonicalPath, 'utf-8'));

      expect(secondInstall).toEqual(firstInstall);
      expect(secondInstall.hooks.PreToolUse[0].hooks).toHaveLength(1);
    });

    it('preserves canonical group metadata and malformed entries while replacing managed hooks', async () => {
      const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
      const canonicalPath = path.join(tmpDir, '.codex', 'hooks.json');
      const userHandler = { type: 'command', command: 'node my-user-hook.mjs' };
      const canonical = {
        hooks: {
          PreToolUse: [
            null,
            'manual-group',
            {
              matcher: 'Write|Edit',
              description: 'primary group metadata',
              hooks: [null, 'manual-handler', { type: 'command', command: staleCometCommand }],
            },
            {
              matcher: 'Write|Edit',
              customField: { duplicate: true },
              hooks: [{ type: 'command', command: staleCometCommand }, userHandler],
            },
            {
              matcher: 'Write|Edit',
              keepEmpty: true,
              hooks: [{ type: 'command', command: staleCometCommand }],
            },
          ],
        },
      };
      await fs.mkdir(path.dirname(canonicalPath), { recursive: true });
      await fs.writeFile(canonicalPath, JSON.stringify(canonical, null, 2), 'utf-8');

      await expect(installCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
        status: 'installed',
      });
      const firstInstall = JSON.parse(await fs.readFile(canonicalPath, 'utf-8'));
      await expect(installCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
        status: 'installed',
      });
      const secondInstall = JSON.parse(await fs.readFile(canonicalPath, 'utf-8'));

      expect(secondInstall).toEqual(firstInstall);
      expect(secondInstall.hooks.PreToolUse[0]).toBeNull();
      expect(secondInstall.hooks.PreToolUse[1]).toBe('manual-group');
      expect(secondInstall.hooks.PreToolUse[2].description).toBe('primary group metadata');
      expect(secondInstall.hooks.PreToolUse[2].hooks.slice(0, 2)).toEqual([null, 'manual-handler']);
      expect(secondInstall.hooks.PreToolUse[2].hooks).toEqual([null, 'manual-handler']);
      expect(secondInstall.hooks.PreToolUse[3]).toEqual({
        matcher: 'Write|Edit',
        customField: { duplicate: true },
        hooks: [userHandler],
      });
      expect(secondInstall.hooks.PreToolUse[4]).toEqual({
        matcher: 'Write|Edit',
        keepEmpty: true,
        hooks: [],
      });
      expect(secondInstall.hooks.PreToolUse[5].hooks).toHaveLength(1);
      expect(secondInstall.hooks.PreToolUse[5].hooks[0].command.replaceAll('\\', '/')).toContain(
        '/.agents/skills/comet/scripts/comet-hook-router.mjs',
      );
    });

    it('migrates only Comet hooks from the historical Codex settings file', async () => {
      const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
      const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
      const legacy = {
        model: 'gpt-5',
        hooks: {
          PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo post' }] }],
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [
                { type: 'command', command: staleCometCommand },
                { type: 'command', command: 'node my-user-hook.mjs' },
              ],
            },
          ],
        },
      };
      await fs.mkdir(path.dirname(legacyPath), { recursive: true });
      await fs.writeFile(legacyPath, JSON.stringify(legacy, null, 2), 'utf-8');

      await installCometHooksForPlatform(tmpDir, codex, 'project');

      const migrated = JSON.parse(await fs.readFile(legacyPath, 'utf-8'));
      expect(migrated.model).toBe('gpt-5');
      expect(migrated.hooks.PostToolUse).toEqual(legacy.hooks.PostToolUse);
      expect(migrated.hooks.PreToolUse[0].hooks).toEqual([
        { type: 'command', command: 'node my-user-hook.mjs' },
      ]);
      await expect(fs.access(path.join(tmpDir, '.codex', 'hooks.json'))).resolves.toBeUndefined();
    });

    it('migrates quoted managed hook paths with spaces without matching malformed commands', async () => {
      const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
      const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
      const managedPath = 'C:/Users/Jane Doe/.agents/skills/comet/scripts/comet-hook-guard.mjs';
      const preservedCommands = [`node "${managedPath}`, `node "${managedPath}"; echo not-managed`];
      const legacy = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [
                {
                  type: 'command',
                  command: `node "${managedPath}" --project-root "C:/Users/Jane Doe"`,
                },
                { type: 'command', command: `node '${managedPath}'` },
                {
                  type: 'command',
                  command: 'node C:/Users/Jane/.agents/skills/comet/scripts/comet-hook-guard.mjs',
                },
                ...preservedCommands.map((command) => ({ type: 'command', command })),
              ],
            },
          ],
        },
      };
      await fs.mkdir(path.dirname(legacyPath), { recursive: true });
      await fs.writeFile(legacyPath, JSON.stringify(legacy, null, 2), 'utf-8');

      await expect(installCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
        status: 'installed',
      });

      const migrated = JSON.parse(await fs.readFile(legacyPath, 'utf-8'));
      expect(
        migrated.hooks.PreToolUse[0].hooks.map((handler: { command: string }) => handler.command),
      ).toEqual(preservedCommands);
    });

    it('reports Codex hook installation failure when legacy cleanup cannot be written', async () => {
      const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
      const canonicalPath = path.join(tmpDir, '.codex', 'hooks.json');
      const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
      const legacy = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [{ type: 'command', command: staleCometCommand }],
            },
          ],
        },
      };
      await fs.mkdir(path.dirname(legacyPath), { recursive: true });
      await fs.writeFile(legacyPath, JSON.stringify(legacy, null, 2), 'utf-8');
      writeFileMock
        .mockImplementationOnce(fs.writeFile)
        .mockRejectedValueOnce(new Error('simulated legacy write failure'));

      await expect(installCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
        status: 'failed',
        cleanupFailed: 1,
        reason: 'legacy Hook cleanup failed for settings.local.json',
      });
      await expect(fs.access(canonicalPath)).resolves.toBeUndefined();
      await expect(fs.readFile(legacyPath, 'utf-8')).resolves.toBe(JSON.stringify(legacy, null, 2));
    });

    it('reports Codex hook installation failure when legacy access fails', async () => {
      const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
      const canonicalPath = path.join(tmpDir, '.codex', 'hooks.json');
      const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
      const legacy = '{\n  "hooks": {}\n}\n';
      await fs.mkdir(path.dirname(legacyPath), { recursive: true });
      await fs.writeFile(legacyPath, legacy, 'utf-8');
      const access = fs.access.bind(fs);
      const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      const accessSpy = vi.spyOn(fs, 'access').mockImplementation(async (filePath, mode) => {
        if (path.resolve(String(filePath)) === path.resolve(legacyPath)) throw permissionError;
        await access(filePath, mode);
      });

      try {
        await expect(installCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
          status: 'failed',
          cleanupFailed: 1,
          reason: 'legacy Hook cleanup failed for settings.local.json',
        });
      } finally {
        accessSpy.mockRestore();
      }

      await expect(fs.access(canonicalPath)).resolves.toBeUndefined();
      await expect(fs.readFile(legacyPath, 'utf-8')).resolves.toBe(legacy);
    });

    it('preserves legacy hook groups, group fields, and non-object handlers during migration', async () => {
      const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
      const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
      const legacy = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              description: 'Comet-only group metadata',
              hooks: [{ type: 'command', command: staleCometCommand }],
            },
            {
              matcher: 'Bash',
              customField: { preserved: true },
              hooks: [null, 'manual-marker', { type: 'command', command: staleCometCommand }],
            },
          ],
        },
      };
      await fs.mkdir(path.dirname(legacyPath), { recursive: true });
      await fs.writeFile(legacyPath, JSON.stringify(legacy, null, 2), 'utf-8');

      await expect(installCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
        status: 'installed',
      });

      const migrated = JSON.parse(await fs.readFile(legacyPath, 'utf-8'));
      expect(migrated.hooks.PreToolUse).toEqual([
        {
          matcher: 'Write|Edit',
          description: 'Comet-only group metadata',
          hooks: [],
        },
        {
          matcher: 'Bash',
          customField: { preserved: true },
          hooks: [null, 'manual-marker'],
        },
      ]);
    });

    it('installs canonical Codex hooks without changing invalid historical JSON', async () => {
      const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
      const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
      const invalid = '{\r\n  "hooks": {\r\n';
      await fs.mkdir(path.dirname(legacyPath), { recursive: true });
      await fs.writeFile(legacyPath, invalid, 'utf-8');

      await expect(installCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
        status: 'failed',
        cleanupFailed: 1,
        reason: 'legacy Hook cleanup failed for settings.local.json',
      });

      await expect(fs.readFile(legacyPath, 'utf-8')).resolves.toBe(invalid);
      await expect(fs.access(path.join(tmpDir, '.codex', 'hooks.json'))).resolves.toBeUndefined();
    });

    it('does not overwrite invalid canonical Codex hooks or migrate the historical file', async () => {
      const codex = PLATFORMS.find((candidate) => candidate.id === 'codex')!;
      const canonicalPath = path.join(tmpDir, '.codex', 'hooks.json');
      const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
      const invalidCanonical = '{\r\n  "hooks": {\r\n';
      const legacy = `${JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Write|Edit',
                hooks: [{ type: 'command', command: staleCometCommand }],
              },
            ],
          },
        },
        null,
        2,
      )}\r\n`;
      await fs.mkdir(path.dirname(canonicalPath), { recursive: true });
      await fs.writeFile(canonicalPath, invalidCanonical, 'utf-8');
      await fs.writeFile(legacyPath, legacy, 'utf-8');

      const result = await installCometHooksForPlatform(tmpDir, codex, 'project');

      expect(result.status).toBe('failed');
      expect(result.reason).toContain('Invalid Codex settings');
      await expect(fs.readFile(canonicalPath, 'utf-8')).resolves.toBe(invalidCanonical);
      await expect(fs.readFile(legacyPath, 'utf-8')).resolves.toBe(legacy);
    });

    it('installs a dedicated Claude-style matcher group without replacing user hooks', async () => {
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
      const cometGroup = firstInstall.hooks.PreToolUse.find(
        (entry: { hooks?: Array<{ command?: string }> }) =>
          entry?.hooks?.some((hook) => hook.command?.includes('comet-hook-router.mjs')),
      );

      expect(firstInstall.model).toBe('sonnet');
      expect(firstInstall.hooks.PostToolUse).toEqual(initialSettings.hooks.PostToolUse);
      expect(firstInstall.hooks.PreToolUse).toHaveLength(3);
      expect(firstInstall.hooks.PreToolUse[0]).toEqual({
        matcher: 'Write|Edit',
        hooks: [{ type: 'command', command: 'echo user-write-check' }],
      });
      expect(firstInstall.hooks.PreToolUse[1]).toEqual(initialSettings.hooks.PreToolUse[1]);
      expect(cometGroup.matcher).toBe('Write|Edit');
      expect(cometGroup.hooks).toHaveLength(1);
      const command = cometGroup.hooks[0].command as string;
      expect(normalized(command)).toContain(`/.claude/skills/${currentCometScript}`);
      expect(normalized(command)).toContain(`--project-root "${normalized(tmpDir)}"`);
      expect(command).not.toContain('node .claude/');
      expect(cometGroup.hooks).toEqual([{ type: 'command', command }]);

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
        status: 'installed',
      });

      const updated = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
      expect(updated.hooks.PreToolUse).toHaveLength(1);
      expect(updated.hooks.PreToolUse[0].matcher).toBe('Write|Edit');
    });

    it.each([
      { id: 'qwen', skillsDir: '.qwen', hookFormat: 'qwen' as const },
      { id: 'qoder', skillsDir: '.qoder', hookFormat: 'qoder' as const },
      { id: 'codebuddy', skillsDir: '.codebuddy', hookFormat: 'codebuddy' as const },
    ])(
      'installs a dedicated $id matcher group idempotently',
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
        expect(firstInstall.hooks.PreToolUse).toHaveLength(2);
        expect(firstInstall.hooks.PreToolUse[0].hooks).toEqual([
          {
            type: 'command',
            command: 'echo user-write-check',
            description: 'User write check',
          },
        ]);
        expect(firstInstall.hooks.PreToolUse[1].hooks).toEqual([
          {
            type: 'command',
            command: expectedHookCommand(skillsDir, id),
            description: 'Route each write to the selected Comet Native or Classic phase guard',
          },
        ]);

        await installCometHooksForPlatform(tmpDir, platform);
        const secondInstall = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
        expect(secondInstall).toEqual(firstInstall);
      },
    );

    it('writes Trae project hooks to hooks.json with versioned PreToolUse groups', async () => {
      const platform = PLATFORMS.find((candidate) => candidate.id === 'trae')!;
      const hooksPath = path.join(tmpDir, '.trae', 'hooks.json');
      const initialHooks = {
        version: 1,
        userSetting: 'keep',
        hooks: {
          PostToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'echo post' }] }],
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [
                { type: 'command', command: 'echo user-write-check', timeout: 5 },
                { type: 'command', command: staleCometCommand, timeout: 10 },
              ],
            },
          ],
        },
      };
      await fs.mkdir(path.dirname(hooksPath), { recursive: true });
      await fs.writeFile(hooksPath, JSON.stringify(initialHooks), 'utf-8');

      await configureNativeBuildChange(tmpDir);
      await copyCometSkillsForPlatform(tmpDir, platform, false, 'skills', 'project');
      await expect(installCometHooksForPlatform(tmpDir, platform, 'project')).resolves.toEqual({
        status: 'installed',
      });
      const firstInstall = JSON.parse(await fs.readFile(hooksPath, 'utf-8'));

      expect(firstInstall.version).toBe(1);
      expect(firstInstall.userSetting).toBe('keep');
      expect(firstInstall.hooks.PostToolUse).toEqual(initialHooks.hooks.PostToolUse);
      expect(firstInstall.hooks.PreToolUse).toEqual([
        {
          matcher: 'Write|Edit',
          hooks: [{ type: 'command', command: 'echo user-write-check', timeout: 5 }],
        },
        {
          matcher: 'Write|Edit',
          hooks: [
            {
              type: 'command',
              command: expectedHookCommand('.trae', 'trae'),
              timeout: 30,
            },
          ],
        },
      ]);
      const router = runManagedHookCommand(
        firstInstall.hooks.PreToolUse[1].hooks[0].command,
        tmpDir,
      );
      expect(router.status, router.stderr).toBe(0);

      await installCometHooksForPlatform(tmpDir, platform, 'project');
      const secondInstall = JSON.parse(await fs.readFile(hooksPath, 'utf-8'));
      expect(secondInstall).toEqual(firstInstall);
    });

    it('writes and removes Trae CN project hooks from .trae and global hooks from .trae-cn', async () => {
      const platform = PLATFORMS.find((candidate) => candidate.id === 'trae-cn')!;
      const projectHooksPath = path.join(tmpDir, '.trae', 'hooks.json');
      const globalRoot = path.join(tmpDir, 'home');
      const globalHooksPath = path.join(globalRoot, '.trae-cn', 'hooks.json');

      await configureNativeBuildChange(tmpDir);
      await copyCometSkillsForPlatform(tmpDir, platform, false, 'skills', 'project');
      await copyCometSkillsForPlatform(globalRoot, platform, false, 'skills', 'global');
      await expect(installCometHooksForPlatform(tmpDir, platform, 'project')).resolves.toEqual({
        status: 'installed',
      });
      await expect(installCometHooksForPlatform(globalRoot, platform, 'global')).resolves.toEqual({
        status: 'installed',
      });

      const projectHooks = JSON.parse(await fs.readFile(projectHooksPath, 'utf-8'));
      const globalHooks = JSON.parse(await fs.readFile(globalHooksPath, 'utf-8'));
      expect(projectHooks.hooks.PreToolUse[0].hooks[0]).toMatchObject({
        type: 'command',
        command: expectedHookCommand('.trae-cn', 'trae-cn'),
        timeout: 30,
      });
      expect(globalHooks.hooks.PreToolUse[0].hooks[0]).toMatchObject({
        type: 'command',
        command: expectedHookCommand('.trae-cn', 'trae-cn', globalRoot, 'global'),
        timeout: 30,
      });
      const projectRouter = runManagedHookCommand(
        projectHooks.hooks.PreToolUse[0].hooks[0].command,
        tmpDir,
      );
      const globalRouter = runManagedHookCommand(
        globalHooks.hooks.PreToolUse[0].hooks[0].command,
        tmpDir,
      );
      expect(projectRouter.status, projectRouter.stderr).toBe(0);
      expect(globalRouter.status, globalRouter.stderr).toBe(0);

      await expect(removeCometHooksForPlatform(tmpDir, platform, 'project')).resolves.toEqual({
        removed: 1,
        failed: 0,
      });
      await expect(removeCometHooksForPlatform(globalRoot, platform, 'global')).resolves.toEqual({
        removed: 1,
        failed: 0,
      });
      const cleanedProjectHooks = JSON.parse(await fs.readFile(projectHooksPath, 'utf-8'));
      const cleanedGlobalHooks = JSON.parse(await fs.readFile(globalHooksPath, 'utf-8'));
      expect(cleanedProjectHooks.hooks).toBeUndefined();
      expect(cleanedGlobalHooks.hooks).toBeUndefined();
      await expect(fs.access(path.join(tmpDir, '.trae-cn', 'hooks.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    it('leaves invalid Trae hooks byte-for-byte unchanged', async () => {
      const platform = PLATFORMS.find((candidate) => candidate.id === 'trae')!;
      const hooksPath = path.join(tmpDir, '.trae', 'hooks.json');
      const invalidHooks = '{\r\n  "hooks": {\r\n';
      await fs.mkdir(path.dirname(hooksPath), { recursive: true });
      await fs.writeFile(hooksPath, invalidHooks, 'utf-8');

      const result = await installCometHooksForPlatform(tmpDir, platform, 'project');

      expect(result.status).toBe('failed');
      expect(result.reason).toContain('Invalid Trae settings');
      await expect(fs.readFile(hooksPath, 'utf-8')).resolves.toBe(invalidHooks);
    });

    it('does not add a global CodeBuddy Hook or change unrelated user config', async () => {
      const platform = PLATFORMS.find((candidate) => candidate.id === 'codebuddy')!;
      const homeDir = path.join(tmpDir, 'home');
      const settingsPath = path.join(homeDir, '.codebuddy', 'settings.json');
      const initialSettings = {
        enabledPlugins: { 'cloudbase@codebuddy-plugins-official': true },
      };
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(settingsPath, JSON.stringify(initialSettings), 'utf-8');

      await expect(installCometHooksForPlatform(homeDir, platform, 'global')).resolves.toEqual({
        status: 'skipped',
        reason: 'blocking Hooks are project-scoped',
      });

      const updated = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
      expect(updated).toEqual(initialSettings);
    });

    it('leaves invalid CodeBuddy settings byte-for-byte unchanged', async () => {
      const platform = PLATFORMS.find((candidate) => candidate.id === 'codebuddy')!;
      const settingsPath = path.join(tmpDir, '.codebuddy', 'settings.json');
      const invalidSettings = '{\r\n  "enabledPlugins": {\r\n';
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(settingsPath, invalidSettings, 'utf-8');

      const result = await installCometHooksForPlatform(tmpDir, platform, 'project');

      expect(result.status).toBe('failed');
      expect(result.reason).toContain('Invalid CodeBuddy Code settings');
      await expect(fs.readFile(settingsPath, 'utf-8')).resolves.toBe(invalidSettings);
    });

    it.each([
      {
        id: 'claude',
        configPath: ['.claude', 'settings.local.json'],
      },
      {
        id: 'amazon-q',
        configPath: ['.amazonq', 'settings.local.json'],
      },
      {
        id: 'gemini',
        configPath: ['.gemini', 'settings.json'],
      },
      {
        id: 'windsurf',
        configPath: ['.windsurf', 'hooks.json'],
      },
    ])('leaves malformed $id Hook JSON byte-for-byte unchanged', async ({ id, configPath }) => {
      const platform = PLATFORMS.find((candidate) => candidate.id === id)!;
      const settingsPath = path.join(tmpDir, ...configPath);
      const malformedSettings = '{\r\n  "hooks": {\r\n';
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(settingsPath, malformedSettings, 'utf-8');

      const result = await installCometHooksForPlatform(tmpDir, platform, 'project');

      expect(result.status).toBe('failed');
      expect(result.reason).toContain(`Invalid ${platform.name} settings`);
      await expect(fs.readFile(settingsPath, 'utf-8')).resolves.toBe(malformedSettings);
    });

    it('installs a dedicated Gemini matcher group idempotently', async () => {
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
      expect(firstInstall.hooks.BeforeTool).toHaveLength(2);
      expect(firstInstall.hooks.BeforeTool[0].hooks).toEqual([
        {
          type: 'command',
          command: 'echo user-write-check',
          name: 'User write check',
        },
      ]);
      expect(firstInstall.hooks.BeforeTool[1].hooks).toEqual([
        {
          type: 'command',
          command: expectedHookCommand('.gemini', 'gemini'),
          name: 'Route each write to the selected Comet Native or Classic phase guard',
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
          command: expectedHookCommand('.windsurf', 'windsurf'),
          show_output: true,
        },
      ]);

      await installCometHooksForPlatform(tmpDir, platform);
      const secondInstall = JSON.parse(await fs.readFile(hooksPath, 'utf-8'));
      expect(secondInstall).toEqual(firstInstall);
    });

    it('does not overwrite an unmanaged Kiro file at the canonical Router path', async () => {
      const kiro = PLATFORMS.find((candidate) => candidate.id === 'kiro')!;
      const canonicalPath = path.join(tmpDir, '.kiro', 'hooks', 'comet-hook-router.kiro.hook');
      const original = {
        enabled: true,
        then: { type: 'runCommand', command: 'node user-hook.mjs' },
      };
      await fs.mkdir(path.dirname(canonicalPath), { recursive: true });
      await fs.writeFile(canonicalPath, JSON.stringify(original, null, 2), 'utf8');

      await expect(installCometHooksForPlatform(tmpDir, kiro, 'project')).resolves.toMatchObject({
        status: 'failed',
        reason: expect.stringContaining('user-owned'),
      });
      await expect(fs.readFile(canonicalPath, 'utf8').then(JSON.parse)).resolves.toEqual(original);
    });

    it('preserves unmanaged legacy-named Kiro files while removing managed legacy files', async () => {
      const kiro = PLATFORMS.find((candidate) => candidate.id === 'kiro')!;
      const hooksDir = path.join(tmpDir, '.kiro', 'hooks');
      const classicLegacyPath = path.join(hooksDir, 'comet-hook-guard.kiro.hook');
      const nativeLegacyPath = path.join(hooksDir, 'comet-native-hook-guard.kiro.hook');
      const staleNativeCommand = `node "${normalized(
        path.join(
          tmpDir,
          '.kiro',
          'skills',
          'comet-native',
          'scripts',
          'comet-native-hook-guard.mjs',
        ),
      )}"`;
      await fs.mkdir(hooksDir, { recursive: true });
      await fs.writeFile(
        classicLegacyPath,
        JSON.stringify({ then: { type: 'runCommand', command: 'node user.mjs' } }),
        'utf8',
      );
      await fs.writeFile(
        nativeLegacyPath,
        JSON.stringify({ then: { type: 'runCommand', command: staleNativeCommand } }),
        'utf8',
      );

      await expect(installCometHooksForPlatform(tmpDir, kiro, 'project')).resolves.toEqual({
        status: 'installed',
      });
      await expect(fs.readFile(classicLegacyPath, 'utf8').then(JSON.parse)).resolves.toBeTruthy();
      await expect(fs.access(nativeLegacyPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('keeps migrated Copilot entries schema-valid and carries metadata onto the Router entry', async () => {
      const copilot = PLATFORMS.find((candidate) => candidate.id === 'github-copilot')!;
      const hookPath = path.join(tmpDir, '.github', 'hooks', 'comet-guard.json');
      const staleRouterCommand = expectedHookCommand('.github', 'github-copilot');
      await fs.mkdir(path.dirname(hookPath), { recursive: true });
      await fs.writeFile(
        hookPath,
        JSON.stringify({
          hooks: {
            preToolUse: [{ matcher: 'old', bash: staleRouterCommand, label: 'keep-me' }],
          },
        }),
        'utf8',
      );

      await installCometHooksForPlatform(tmpDir, copilot, 'project');

      const entries = (
        JSON.parse(await fs.readFile(hookPath, 'utf8')) as {
          hooks: { preToolUse: Array<Record<string, unknown>> };
        }
      ).hooks.preToolUse;
      expect(
        entries.every((entry) =>
          ['command', 'bash', 'powershell'].some((key) => typeof entry[key] === 'string'),
        ),
      ).toBe(true);
      expect(entries).toContainEqual(
        expect.objectContaining({ label: 'keep-me', bash: expect.any(String) }),
      );
    });
  });

  describe('Chinese Comet workflow safeguards', () => {
    it('uses the OpenSpec status graph to drive Chinese open artifacts', async () => {
      const zhOpen = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet-open', 'SKILL.md'),
        'utf-8',
      );

      expect(zhOpen).toContain(
        'comet classic openspec -- instructions <artifact-id> --change "<name>" --json',
      );
      expect(zhOpen).toContain('不得硬编码生成顺序');
      expect(zhOpen).not.toContain(
        'comet classic openspec -- instructions proposal --change "<name>" --json',
      );
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
      expect(zhOpen).toContain('comet classic openspec -- status --change "<name>" --json');
      expect(zhOpen).toContain('必须立即停止并报告 OpenSpec 错误');
      expect(zhOpen).toContain('不得回退为硬编码文档结构');
    });

    it('uses the OpenSpec status graph to drive English open artifacts', async () => {
      const enOpen = await fs.readFile(
        path.resolve('assets', 'skills', 'comet-open', 'SKILL.md'),
        'utf-8',
      );

      expect(enOpen).toContain(
        'comet classic openspec -- instructions <artifact-id> --change "<name>" --json',
      );
      expect(enOpen).toContain('Must not hard-code generation order');
      expect(enOpen).not.toContain(
        'comet classic openspec -- instructions proposal --change "<name>" --json',
      );
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
      expect(enOpen).toContain('must not copy them into artifact content');
      expect(enOpen).toContain('Re-run status after creating each artifact');
      expect(enOpen).toContain('comet classic openspec -- status --change "<name>" --json');
      expect(enOpen).toContain('Also stop if status/instructions fails');
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
        '完整 `/comet-classic` 或 `workflow: full` 不得套用 tweak 的 `openspec-apply-change` 构建路径',
      );
      expect(zhTweak).toContain('单一 OpenSpec change');
      expect(zhTweak).not.toContain('不新增 capability');
      expect(zhBuild).not.toContain('openspec-apply-change');
    });

    it('requires explicit user confirmation at full-workflow decision points', async () => {
      const zhComet = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet-classic', 'SKILL.md'),
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
      expect(zhComet).toContain('comet classic intent route --stdin');
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
      expect(zhScripts).toContain('comet classic intent route --stdin');
      expect(zhScripts).not.toContain('<comet-intent-script>');
      expect(zhComet).toContain('`comet/reference/decision-point.md`');
      expect(zhDecisionPoint).toContain('存在 `AskUserQuestion` 时，使用它展示单选/多选选项');
      expect(zhDecisionPoint).toContain('若无法使用 `AskUserQuestion`');
      expect(zhDecisionPoint).toContain('本会话后续决策点不得反复重试它');
      expect(zhDecisionPoint).toContain('否则在对话中提出明确选项并等待用户回复');
      expect(zhDecisionPoint).toContain('不得用推荐规则、默认值、历史偏好');
      expect(zhOpen).toContain('### 1b. 需求与 Change 名称解析（默认不阻塞）');
      expect(zhOpen).toContain('范围与命名都明确时直接继续');
      expect(zhOpen).toContain('`comet/reference/decision-point.md`');
      expect(zhOpen).toContain(
        '完整 `/comet-classic` 流程默认不得使用 Skill 工具加载 `openspec-propose` 技能',
      );
      expect(zhOpen).toContain(
        '当 Step 1b 已形成范围明确的 resolved brief 时，覆盖其"STOP and wait for user direction"行为',
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
      expect(zhBuild).toContain('不得根据推荐规则自行选择 `current`、`branch` 或 `worktree`');
      expect(zhBuild).toContain('也不得自行选择执行方式、TDD 模式或代码审查模式');
      expect(zhBuild).toContain('`comet/reference/decision-point.md`');
      expect(zhVerify).toContain('前 3 次可修复失败自动回到 build');
      expect(zhVerify).toContain(
        '只有接受 WARNING/SUGGESTION 偏差或第 4 次失败后的策略选择才是用户决策点',
      );
      expect(zhVerify).toContain('不要在 verify 阶段处理、合并或丢弃分支');
      expect(zhVerify).toContain('不要写入 `branch_status: handled`');
      expect(zhArchive).toContain('### 5. 交付归档提交并完成');
      expect(zhArchive).toContain('comet state set <change-name> branch_status handled');
      expect(zhArchive).toContain('### 1. 归档与交付前最终确认（阻塞点）');
      expect(zhArchive).toContain(
        '不得在用户确认前运行 `comet state transition <change-name> archive-confirm` 或 `comet archive "<change-name>"`',
      );
      expect(zhArchive).toContain('`comet/reference/decision-point.md`');
      expect(zhArchive).toContain('「确认归档并立即推送」');
      expect(zhArchive).toContain('「确认归档、立即推送并创建 PR」');
      expect(zhArchive).toContain('「需要调整或重新验证」');
      expect(zhArchive).toContain('「暂不归档」');
      expect(zhArchive).toContain('`comet state transition <change-name> archive-reopen`');
      expect(zhArchive).toContain(
        '`handled` 只表示用户已经确认如何远端交付这次完整归档提交，不表示 push 或 PR 创建已经成功',
      );
      expect(zhArchive).toContain('归档阶段不再调用 Superpowers `finishing-a-development-branch`');
      expect(zhArchive).not.toContain('使用 Skill 工具加载 Superpowers');
      expect(zhArchive).toContain('调用 `/comet-classic` 或 `/comet-open`');
      expect(zhArchive).not.toContain('调用 `/comet` 或 `/comet-open`');
      expect(zhVerify).toContain('不得因为验证已通过就自动归档');
      expect(zhHotfix).toContain(
        '命中质变信号或文件数 tripwire 时，**必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户明确选择**',
      );
      expect(zhHotfix).toContain('不得直接进入 `/comet-design`');
      expect(zhTweak).toContain(
        '命中质变信号或文件数 tripwire 时，**必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户明确选择**',
      );
      expect(zhTweak).toContain('不得直接进入 `/comet-design`');
      expect(zhComet).toContain('`verify_result: fail` → 自动调用 `/comet-build` 继续修复');
      expect(zhComet).not.toContain(
        '`verify_result: fail` → `comet state transition <name> verify-fail` 后 `/comet-build`',
      );
      expect(zhHotfix).toContain(
        '若 hotfix 创建了 delta spec，则根据 comet-verify 的规模评估规则进入完整验证路径',
      );
      expect(zhHotfix).not.toContain('停止 hotfix，升级为 `/comet`');
      expect(zhTweak).toContain('带 delta spec 的验证分流');

      // HIGH: hotfix/tweak IMPORTANT blocks must acknowledge verify decision points
      expect(zhHotfix).toContain('验证阶段（comet-verify）接受 WARNING/SUGGESTION 偏差');
      expect(zhTweak).toContain('验证阶段（comet-verify）接受 WARNING/SUGGESTION 偏差');
      expect(zhHotfix).toContain('归档提交后的分支处理决策');
      expect(zhTweak).toContain('归档提交后的分支处理决策');
      expect(zhHotfix).toContain('归档前最终确认');
      expect(zhTweak).toContain('归档前最终确认');

      // MEDIUM: comet-design brainstorming does not write Design Doc before confirmation
      expect(zhDesign).toContain('brainstorming 阶段不写入 Design Doc 文件');
      expect(zhDesign).toContain('增量更新 `brainstorm-summary.md`');
      expect(zhDesign).toContain('### 3a. 可选主动式上下文压缩');

      // MEDIUM: comet-verify Spec drift requires user choice
      expect(zhVerify).toContain('必须以单选题形式暂停、展示处理方式并等待用户选择');

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
      expect(zhBuild).toContain('一个联合决策点');
      expect(zhBuild).toContain('不得自动选择，也不得把暂停写入 `build_mode`');
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

      // MEDIUM: comet-verify Step 1b auto-repairs CRITICAL/IMPORTANT findings
      // without turning mandatory work into a user decision.
      expect(zhVerify).toContain('不得创建“是否修复”的伪决策');
      expect(zhVerify).toContain('CRITICAL/IMPORTANT 始终不可豁免');
      expect(zhVerify).toContain('当 `review_mode: standard` 或 `thorough` 时');
      expect(zhVerify).toContain('当 `review_mode: off` 时跳过自动代码审查');
      expect(zhVerify).toContain('只检查正确性、安全、边界条件');
      expect(zhVerify).toContain('无 CRITICAL 或 IMPORTANT 问题');
      expect(zhVerify).toContain('不影响正确性、安全、边界条件的 code pattern consistency 建议');
      expect(zhVerify).toContain('不执行 spec 覆盖率、Design Doc 一致性或漂移检查');
      expect(zhHotfix).toContain('默认 `review_mode: off`');

      // MEDIUM: hotfix task count alone does not escalate; only qualitative scope signals do.
      expect(zhHotfix).toContain('任务数量本身不触发 `/comet-build`');

      // LOW: comet-build "中" level requires user confirmation before brainstorming
      expect(zhBuild).toContain(
        '暂停、展示选择并等待用户明确确认后**，必须使用 Skill 工具加载 Superpowers `brainstorming`',
      );

      // LOW: comet-build 50% threshold is a hard decision point
      expect(zhBuild).toContain(
        '必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户决定是否拆分为新 change',
      );

      // LOW: comet-verify Step 2b disambiguates design.md vs Design Doc
      expect(zhVerify).toContain('实现符合 `<classic-change-dir>/design.md` 高层设计决策');
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
      expect(zhOpen).toContain('只有所有拆分项都通过两项 CLI 检查后');
      expect(zhOpen).toContain('断点恢复时先读取 `.comet/batches/<batch-id>.json`');

      // IMPORTANT: main entry and build subskill agree scope expansion is blocking
      expect(zhComet).toContain('build 阶段范围扩张需重新设计或拆分新 change');
      expect(zhComet).toContain('archive 阶段执行归档脚本前的最终确认');
      expect(zhComet).toContain('open 阶段大型 PRD 是否拆分为多个 changes');

      // IMPORTANT: accepted Spec drift edits must not loop back through dirty-worktree handling
      expect(zhVerify).toContain('选项 A 属于 verify 阶段允许产物');

      // Dependency triggers must be explicit skill invocations, not ambiguous prose.
      expect(zhBuild).toContain(
        '**立即执行：** 使用 Skill 工具加载 Superpowers `using-git-worktrees`',
      );
      expect(zhBuild).not.toContain('或使用原生 `EnterWorktree` 工具');
      expect(zhBuild).toContain('必须使用 Skill 工具加载 Superpowers `brainstorming`');
      expect(zhComet).toContain(
        '若 `build_mode: subagent-driven-development`，不得在主窗口直接执行任务',
      );
      expect(zhBuild).toContain('主会话只负责协调，禁止直接编写实现代码');
      expect(zhBuild).toContain('提供本工作流支持的全部工作区隔离和执行方式');
      expect(zhBuild).not.toContain('不得预检、推断或筛除');
      expect(zhBuild).not.toContain('真实异步派发、独立上下文、结果回收和所需交接能力');
      expect(zhBuild).not.toContain('`platform-default`');
      expect(zhBuild).toContain('`comet state set <name> subagent_dispatch confirmed`');
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
      expect(zhCometRule).toContain('Design Doc、状态和最新 handoff 落盘后按需执行');
      expect(zhCometRule).toContain(
        '使用 Skill 工具重新加载 Superpowers `subagent-driven-development` 技能',
      );
      expect(zhCometRule).toContain(
        '读取 `comet/reference/subagent-dispatch.md` 获取 Comet 专属扩展',
      );
      expect(zhCometRule).toContain('禁止在主会话中直接执行 task');
      for (const content of [zhOpen, zhDesign]) {
        expect(content).toContain('自动衔接下一阶段');
        expect(content).toContain('comet state next <change-name>');
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
      expect(zhHotfix).toContain('comet state next <name>');
      expect(zhHotfix).toContain('`NEXT: auto`');
      expect(zhHotfix).toContain(
        '`phase: build` 返回 `comet-hotfix`，`verify` 返回 `comet-verify`，`archive` 返回 `comet-archive`',
      );
      expect(zhTweak).toContain('自动衔接下一阶段');
      expect(zhTweak).toContain('comet state next <name>');
      expect(zhTweak).toContain('`NEXT: auto`');
      expect(zhTweak).toContain(
        '`phase: build` 返回 `comet-tweak`，`verify` 返回 `comet-verify`，`archive` 返回 `comet-archive`',
      );
    });
  });

  describe('English Comet workflow safeguards', () => {
    it('matches the Chinese workflow decision-point requirements', async () => {
      const enComet = await fs.readFile(
        path.resolve('assets', 'skills', 'comet-classic', 'SKILL.md'),
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
        path.resolve('assets', 'skills', 'comet', 'rules', 'comet-phase-guard.en.md'),
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
      expect(enComet).toContain('comet classic intent route --stdin');
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
      expect(enScripts).toContain('comet classic intent route --stdin');
      expect(enScripts).not.toContain('<comet-intent-script>');
      expect(enDecisionPoint).toContain(
        'Use `AskUserQuestion` for single-select or multi-select choices',
      );
      expect(enDecisionPoint).toContain('When `AskUserQuestion` cannot be used');
      expect(enDecisionPoint).toContain('do not repeatedly retry it for later decision points');
      expect(enDecisionPoint).toContain(
        'otherwise ask clear options in the conversation and wait for the reply',
      );
      expect(enDecisionPoint).toContain(
        'Never substitute recommendation rules, defaults, historical preferences',
      );
      expect(enOpen).toContain(
        '### 1b. Resolve Requirements and Change Name (Non-blocking by Default)',
      );
      expect(enOpen).toContain(
        'Do not run `comet classic openspec -- new change` or create proposal/design/tasks while the resolved brief or name remains ambiguous',
      );
      expect(enOpen).toContain(
        'Full `/comet-classic` workflow must not use the Skill tool to load the `openspec-propose` skill',
      );
      expect(enOpen).toContain('`comet/reference/decision-point.md`');
      expect(enOpen).toContain(
        'When Step 1b has produced an unambiguous resolved brief, override its "STOP and wait for user direction" behavior',
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
      expect(enBuild).toContain('provide exactly **one joint decision point**');
      expect(enBuild).toContain(
        'show the plan summary, pause option, and every executable Step 3 setting together',
      );
      expect(enBuild).toContain(
        'do not choose `current`, `branch`, or `worktree`, execution method, TDD mode, or review mode from recommendations',
      );
      expect(enBuild).toContain('`comet/reference/decision-point.md`');
      expect(enVerify).toContain(
        'Automatically return to build for the first 3 repairable failures',
      );
      expect(enVerify).toContain(
        'Only accepting WARNING/SUGGESTION deviations or choosing a strategy after the 4th failure is a user decision point',
      );
      expect(enVerify).toContain('Do not handle, merge, or discard branches in verify');
      expect(enVerify).toContain('do not write `branch_status: handled`');
      expect(enArchive).toContain('### 5. Deliver the Archive Commit and Complete');
      expect(enArchive).toContain('comet state set <change-name> branch_status handled');
      expect(enTweak).toContain('Use the Skill tool to load the `openspec-apply-change` skill');
      expect(enTweak).toContain('This apply path belongs only to tweak');
      expect(enTweak).toContain(
        "Full `/comet-classic` or `workflow: full` must not use tweak's `openspec-apply-change` build path",
      );
      expect(enTweak).toContain('single OpenSpec change');
      expect(enTweak).not.toContain('No new capability');
      expect(enBuild).not.toContain('openspec-apply-change');
      expect(enArchive).toContain(
        '### 1. Final Archive and Delivery Confirmation (Blocking Point)',
      );
      expect(enArchive).toContain(
        'Must not run `comet state transition <change-name> archive-confirm` or `comet archive "<change-name>"` before user confirmation',
      );
      expect(enArchive).toContain('`comet/reference/decision-point.md`');
      expect(enArchive).toContain('"Confirm archive and push now"');
      expect(enArchive).toContain('"Confirm archive, push now, and create a PR"');
      expect(enArchive).toContain('Needs adjustment or re-verification');
      expect(enArchive).toContain('Do not archive yet');
      expect(enArchive).toContain('`comet state transition <change-name> archive-reopen`');
      expect(enArchive).toContain(
        '`handled` means only that the user confirmed how to deliver this complete archive commit remotely. It does not mean that push or PR creation has succeeded',
      );
      expect(enArchive).toContain(
        'Archive no longer invokes Superpowers `finishing-a-development-branch`',
      );
      expect(enArchive).not.toContain('use the Skill tool to load Superpowers');
      expect(enArchive).toContain('invoke `/comet-classic` or `/comet-open`');
      expect(enArchive).not.toContain('invoke `/comet` or `/comet-open`');
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
        '`verify_result: fail` → Invoke `/comet-build` automatically to continue repair',
      );
      expect(enComet).not.toContain(
        '`verify_result: fail` → `comet state transition <name> verify-fail` then `/comet-build`',
      );

      expect(enHotfix).toContain('handle it through this file\'s "Upgrade Assessment"');
      expect(enTweak).toContain('handle it through this file\'s "Upgrade Assessment"');
      expect(enHotfix).toContain('Verify-phase acceptance of WARNING/SUGGESTION deviations');
      expect(enTweak).toContain('Verify-phase acceptance of WARNING/SUGGESTION deviations');
      expect(enHotfix).toContain('Final archive confirmation');
      expect(enTweak).toContain('Final archive confirmation');
      expect(enHotfix).toContain('branch-handling decision after the archive commit');
      expect(enTweak).toContain('branch-handling decision after the archive commit');
      expect(enDesign).toContain('The brainstorming phase does not write to the Design Doc file');
      expect(enVerify).toContain(
        'pause, present the handling methods as a single-select question, and wait for the user to choose',
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
      expect(enBuild).toContain('one joint decision point');
      expect(enBuild).toContain('Do not auto-select or write the pause into `build_mode`');
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
      expect(enVerify).toContain('Do not manufacture a "whether to fix" decision');
      expect(enVerify).toContain('CRITICAL/IMPORTANT findings are never waivable');
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
      expect(enHotfix).toContain('task count alone does not route to `/comet-build`');
      expect(enBuild).toContain(
        'Pause, present the choice, and wait for the user to explicitly confirm',
      );
      expect(enBuild).toContain(
        'must follow the `comet/reference/decision-point.md` protocol to pause and wait for the user to decide whether to split into a new change',
      );
      expect(enVerify).toContain(
        'Implementation matches `<classic-change-dir>/design.md` high-level design decisions',
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
      expect(enOpen).toContain('Only after every split item passes both CLI checks');
      expect(enOpen).toContain('On resume, read `.comet/batches/<batch-id>.json` first');
      expect(enComet).toContain(
        'Build phase scope expansion requiring redesign or new change split',
      );
      expect(enComet).toContain(
        'Archive phase final confirmation before running the archive script',
      );
      expect(enComet).toContain('Open phase large PRD split confirmation');
      expect(enVerify).toContain('Option A is a verify phase allowed artifact');
      expect(enBuild).toContain(
        '**Immediately execute:** Use the Skill tool to load the Superpowers `using-git-worktrees`',
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
      expect(enDesign).toContain('<classic-change-dir>/.comet/handoff/spec-context.md');
      expect(enDesign).toContain('In beta mode, `spec-context.json` must be structurally valid');
      expect(enDesign).toContain('incrementally update `brainstorm-summary.md`');
      expect(enDesign).toContain('### 3a. Optional Active Context Compaction');
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
      expect(enComet).toContain('only controls next skill invocation, not phase advancement');
      expect(enCometRule).toContain(
        'brainstorming in progress: incrementally update brainstorm-summary.md',
      );
      expect(enCometRule).toContain(
        'only after the Design Doc, state evidence, and latest handoff are persisted',
      );
      expect(enCometRule).toContain(
        'Use the Skill tool to reload the Superpowers `subagent-driven-development` skill',
      );
      expect(enCometRule).toContain(
        'Re-read `comet/reference/subagent-dispatch.md` for Comet-specific extensions',
      );
      expect(enCometRule).toContain('Do not execute tasks directly in the main session');
      for (const content of [enOpen, enDesign]) {
        expect(content).toContain('Automatic Handoff to Next Phase');
        expect(content).toContain('comet state next <change-name>');
        expect(content).toContain('`NEXT: auto`');
        expect(content).toContain('`NEXT: manual`');
        expect(content).toContain('return control with `HINT`');
      }
      for (const content of [enBuild, enVerify]) {
        expect(content).toContain('Automatic Handoff to Next Phase');
        expect(content).toContain('comet state next <change-name>');
        expect(content).toContain('`NEXT: auto`');
        expect(content).toContain('`NEXT: manual`');
        expect(content).toContain('return control with `HINT`');
      }
      expect(enHotfix).toContain('Automatic Handoff to Next Phase');
      expect(enHotfix).toContain('comet state next <name>');
      expect(enHotfix).toContain('`NEXT: auto`');
      expect(enHotfix).toContain(
        '`phase: build` returns `comet-hotfix`, `verify` returns `comet-verify`, `archive` returns `comet-archive`',
      );
      expect(enTweak).toContain('Automatic Handoff to Next Phase');
      expect(enTweak).toContain('comet state next <name>');
      expect(enTweak).toContain('`NEXT: auto`');
      expect(enTweak).toContain(
        '`phase: build` returns `comet-tweak`, `verify` returns `comet-verify`, `archive` returns `comet-archive`',
      );
    });
  });

  describe('Comet output language safeguards', () => {
    it('requires OpenSpec and Superpowers outputs to follow the configured Comet artifact language', async () => {
      const skillNames = [
        'comet-classic',
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

      expect(zhSkills['comet-classic']).toContain('输出语言规则');
      expect(zhSkills['comet-classic']).toContain(
        '所有 OpenSpec 和 Superpowers 产物都必须使用 Comet 配置的产物语言',
      );
      expect(zhSkills['comet-open']).toContain(
        '传递给 OpenSpec 的所有提问和产物要求都必须包含解析后的 Comet 产物语言',
      );
      expect(zhSkills['comet-design']).toContain(
        'Language: 使用 `comet state get <name> language` 读取到的 Comet 配置产物语言输出',
      );
      expect(zhSkills['comet-build']).toContain(
        '计划文件和执行反馈必须使用 `comet state get <name> language` 读取到的 Comet 配置产物语言',
      );
      expect(zhSkills['comet-build']).toContain('ARGUMENTS 必须包含与 Step 1 相同的 Language 约束');
      expect(zhSkills['comet-verify']).toContain(
        '验证报告必须使用 `comet state get <name> language` 读取到的 Comet 配置产物语言',
      );
      expect(zhSkills['comet-archive']).toContain(
        '归档摘要和生命周期闭环说明必须使用 `comet state get <name> language` 读取到的 Comet 配置产物语言',
      );
      expect(zhSkills['comet-hotfix']).toContain('精简版 OpenSpec 产物必须使用 Comet 配置产物语言');
      expect(zhSkills['comet-tweak']).toContain('精简版 OpenSpec 产物必须使用 Comet 配置产物语言');

      expect(enSkills['comet-classic']).toContain('Output Language Rule');
      expect(enSkills['comet-classic']).toContain(
        'Use the configured Comet artifact language as the output language for every OpenSpec and Superpowers artifact',
      );
      expect(enSkills['comet-open']).toContain(
        'Every prompt and artifact request passed to OpenSpec must include the resolved Comet artifact language',
      );
      expect(enSkills['comet-design']).toContain(
        'Language: Use the configured Comet artifact language from `comet state get <name> language`',
      );
      expect(enSkills['comet-build']).toContain(
        'Plan files and execution feedback must use the configured Comet artifact language from `comet state get <name> language`',
      );
      expect(enSkills['comet-build']).toContain(
        'ARGUMENTS must include the same Language constraint as Step 1',
      );
      expect(enSkills['comet-verify']).toContain(
        'Verification reports must use the configured Comet artifact language from `comet state get <name> language`',
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
      expect(zhBuild).toContain('一个联合决策点');
      expect(zhBuild).toContain('工作区隔离、执行方式、TDD 模式和代码审查模式');
      expect(zhBuild).toContain('读取 `comet/reference/subagent-dispatch.md` 获取 Comet 专属扩展');
      expect(zhBuild).not.toContain('不得预检、推断或筛除');
      expect(zhBuild).not.toContain('无子agent环境');
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
      expect(zhDispatch).toContain('通过已加载的 Superpowers `subagent-driven-development` 技能');
      expect(zhDispatch).not.toContain('其他平台');
      expect(zhDispatch).not.toContain('工具名称相似不等于满足异步派发');
      expect(zhDispatch).not.toContain('platform-default');
      expect(zhDispatch).toContain(
        'Language: 使用 comet state get <name> language 读取到的 Comet 配置产物语言输出',
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
      expect(zhDispatch).toContain('<classic-change-dir>/.comet/subagent-progress.md');
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
      expect(zhDispatch).toContain('comet state task-checkoff "<plan-file>" "<plan-task-text>"');
      expect(zhDispatch).toContain(
        'comet state task-checkoff "<classic-change-dir>/tasks.md" "<openspec-task-text>"',
      );
      expect(zhDispatch).not.toContain('PLAN_MATCHES="$(grep -cF');
      expect(zhDispatch).toContain('RED 失败命令与失败摘要');
      expect(zhDispatch).toContain('GREEN 通过命令与通过摘要');
      expect(zhDispatch).not.toContain("grep -n '\\- \\[ \\]' <classic-change-dir>/tasks.md");
      expect(zhDispatch).toContain('禁止总结、禁止询问用户是否继续、禁止在任务之间等待用户输入');
      expect(zhDispatch).toContain('存在无法从仓库、计划或既有上下文消除的真实歧义');
      expect(zhDispatch).toContain('子代理派发操作失败属于运行停止条件');
      expect(zhDispatch).toContain('将当前任务记录为 `BLOCKED` 并写明失败原因');
      expect(zhDispatch).toContain('不得加载 `finishing-a-development-branch`');
      expect(zhDispatch).toContain('返回 `comet-build` 继续执行退出条件、阶段守卫和后续阶段衔接');
      expect(zhRecovery).toContain('重新加载 Superpowers `subagent-driven-development` 技能');
      expect(zhRecovery).toContain('重新阅读 `comet/reference/subagent-dispatch.md`');
      expect(zhRecovery).toContain('读取 `<classic-change-dir>/.comet/subagent-progress.md`');
      expect(zhGuard).toContain('重新加载 Superpowers `subagent-driven-development` 技能');
      expect(zhGuard).toContain('读取 `comet/reference/subagent-dispatch.md` 获取 Comet 专属扩展');
      expect(zhGuard).toContain('读取 `<classic-change-dir>/.comet/subagent-progress.md`');
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
      expect(enBuild).toContain('one joint decision point');
      expect(enBuild).toContain(
        'update `isolation`, execution method, TDD mode, and code review mode fields',
      );
      expect(enBuild).toContain(
        'provide every workspace-isolation and execution choice supported by this workflow',
      );
      expect(enBuild).not.toContain('Do not preflight, infer, or filter');
      expect(enBuild).not.toContain('no subagent environment');
      expect(enBuild).not.toContain(
        'real asynchronous execution, isolated context, result collection',
      );
      expect(enBuild).not.toContain('`platform-default`');
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
      expect(enDispatch).toContain('comet state task-checkoff "<plan-file>" "<plan-task-text>"');
      expect(enDispatch).toContain(
        'comet state task-checkoff "<classic-change-dir>/tasks.md" "<openspec-task-text>"',
      );
      expect(enDispatch).toContain('fresh background implementer agent for every task');
      expect(enDispatch).toContain('task reviewer, fix agent, and final reviewer');
      expect(enDispatch).toContain(
        'Through the loaded Superpowers `subagent-driven-development` skill',
      );
      expect(enDispatch).not.toContain('Other platforms');
      expect(enDispatch).not.toContain(
        'real asynchronous execution, isolated context, result collection',
      );
      expect(enDispatch).not.toContain('platform-default');
      expect(enDispatch).toContain(
        'Language: Use the configured Comet artifact language from comet state get <name> language',
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
      expect(enDispatch).toContain('<classic-change-dir>/.comet/subagent-progress.md');
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
      expect(enDispatch).toContain('A subagent-dispatch failure is a runtime stop condition');
      expect(enDispatch).toContain('Record the current task as `BLOCKED` with the failure reason');
      expect(enDispatch).toContain('must not load `finishing-a-development-branch`');
      expect(enDispatch).toContain(
        'return control to `comet-build` for exit checks, the phase guard, and phase handoff',
      );
      expect(enRecovery).toContain('reload the Superpowers `subagent-driven-development` skill');
      expect(enRecovery).toContain('Re-read `comet/reference/subagent-dispatch.md`');
      expect(enRecovery).toContain('Read `<classic-change-dir>/.comet/subagent-progress.md`');
      expect(enGuard).toContain('reload the Superpowers `subagent-driven-development` skill');
      expect(enGuard).toContain(
        'Re-read `comet/reference/subagent-dispatch.md` for Comet-specific extensions',
      );
      expect(enGuard).toContain('Read `<classic-change-dir>/.comet/subagent-progress.md`');
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

    it('ships one bilingual workflow Rule with shared ownership semantics', async () => {
      const manifest = await readManifest();
      expect(manifest.rules).toEqual([
        'comet/rules/comet-workflow-guard.md',
        'comet/rules/comet-workflow-guard.en.md',
      ]);
      expect(manifest.nativeRules).toBeUndefined();

      const zhGuard = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'rules', 'comet-workflow-guard.md'),
        'utf-8',
      );
      const enGuard = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'rules', 'comet-workflow-guard.en.md'),
        'utf-8',
      );
      for (const guard of [zhGuard, enGuard]) {
        expect(guard).toContain('default_workflow');
        expect(guard).toContain('.comet/current-change.json');
        expect(guard).toContain('Native');
        expect(guard).toContain('Classic');
        expect(guard).toContain('Hook Router');
      }
      expect(zhGuard).toContain('先记录失败并通过 Native Runtime 回到 Build');
      expect(zhGuard).toContain('点号开头的普通项目文件');
      expect(zhGuard).toContain('零个表示当前没有 Comet 需求');
      expect(zhGuard).toContain('多个候选时暂停并让用户选择');
      expect(zhGuard).toContain('普通写入权限不覆盖 brief 中未解决的 `[blocking]`');
      expect(zhGuard).toContain('无法归因的事件和仅位于项目外的目标保持中立');
      expect(zhGuard).toContain('一旦写入已归属于本项目');
      expect(enGuard).toContain('record the failed result');
      expect(enGuard).toContain('return to Build before modifying the implementation');
      expect(enGuard).toContain('dot-prefixed project files');
      expect(enGuard).toContain('zero means there is no current Comet request');
      expect(enGuard).toContain('multiple candidates require an explicit user selection');
      expect(enGuard).toContain('does not override unresolved `[blocking]` user decisions');
      expect(enGuard).toContain('targets that are entirely outside the project remain neutral');
      expect(enGuard).toContain('Once a write is attributed to this project');

      await expect(
        fs.access(
          path.resolve('assets', 'skills', 'comet-native', 'rules', 'comet-native-phase-guard.md'),
        ),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        fs.access(
          path.resolve(
            'assets',
            'skills',
            'comet-native',
            'rules',
            'comet-native-phase-guard.en.md',
          ),
        ),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });

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
      expect(zhSection).toContain('comet state next <change-name>');
      expect(zhSection).toContain('NEXT: auto');
      expect(zhSection).toContain('NEXT: manual');
      expect(zhSection).toContain('NEXT: done');
      expect(zhSection).not.toContain('必须调用下一阶段的 skill');
      expect(zhSection).not.toContain('open → `comet-design`');

      const enSection = section(enGuard, '## Automatic Transition After Phase Exit');
      expect(enSection).toContain('comet state next <change-name>');
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

      expect(zhGuard).toContain('`isolation` / `build_mode` / `tdd_mode` / `review_mode`');
      expect(zhGuard).toContain('一个联合决策');
      expect(enGuard).toContain('`isolation` / `build_mode` / `tdd_mode` / `review_mode`');
      expect(enGuard).toContain('one joint decision');
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
        path.resolve('assets', 'skills-zh', 'comet-classic', 'SKILL.md'),
        'utf-8',
      );
      const en = await fs.readFile(
        path.resolve('assets', 'skills', 'comet-classic', 'SKILL.md'),
        'utf-8',
      );

      expect(zh).toContain('Comet Ambient Resume');
      expect(zh).toContain('comet resume-probe . --stdin --json');
      expect(zh).toContain('不把无关任务挂到 active Comet change');
      expect(en).toContain('Comet Ambient Resume');
      expect(en).toContain('comet resume-probe . --stdin --json');
      expect(en).toContain('Never attach unrelated work');
    });

    it('documents the public resume probe CLI bilingually', async () => {
      const zh = await fs.readFile(
        path.resolve('assets', 'skills-zh', 'comet', 'reference', 'scripts.md'),
        'utf-8',
      );
      const en = await fs.readFile(
        path.resolve('assets', 'skills', 'comet', 'reference', 'scripts.md'),
        'utf-8',
      );

      expect(zh).toContain('comet resume-probe . --stdin --json');
      expect(zh).not.toContain('<comet-resume-probe-script>');
      expect(en).toContain('comet resume-probe . --stdin --json');
      expect(en).not.toContain('<comet-resume-probe-script>');
    });

    it('uses only the public CLI without platform-directory discovery bilingually', async () => {
      for (const languageDir of ['skills-zh', 'skills']) {
        const source = await fs.readFile(
          path.resolve('assets', languageDir, 'comet', 'reference', 'scripts.md'),
          'utf-8',
        );

        expect(source).toContain('comet state select <change-name>');
        expect(source).not.toContain('Base directory');
        expect(source).not.toContain('<comet-state-script>');
        expect(source).not.toContain('"$PWD/../.claude/skills"');
        expect(source).not.toContain('"$HOME/.claude/skills"');
      }
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
      expect(zh).toContain('comet resume-probe . --stdin --json');
      expect(en).toContain('comet/reference/scripts.md');
      expect(en).toContain('comet resume-probe . --stdin --json');
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
          // needs explicit installed-skill roots; delegated bootstrap is validated
          // in scripts.md.
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
                `${languageDir}/${skillPath} should include the Codex skill root`,
              ).toContain('"$HOME/.codex/skills"');
              expect(
                content,
                `${languageDir}/${skillPath} should include the Claude workspace skill root`,
              ).toContain('"$PWD/../.claude/skills"');
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

    it('fails closed for malformed YAML', () => {
      expect(() => parseProjectConfigOverrides('{{invalid')).toThrow('Invalid .comet/config.yaml');
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
      expect(output).toContain('# Artifact language used by Classic workflow documents');
      expect(output).toContain('language: en');
      expect(output).toContain('# Controls beta context compression');
      expect(output).toContain('context_compression: off');
      expect(output).toContain('# Sets the default review depth');
      expect(output).toContain('review_mode: standard');
      expect(output).toContain('# Automatically enters the next Classic phase');
      expect(output).toContain('auto_transition: true');
      expect(output).toContain(
        '# Enables automatic recovery through the read-only Ambient Resume probe',
      );
      expect(output).toContain('ambient_resume: true');
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
      expect(output).toContain('# Classic 工作流文档使用的产物语言');
      expect(output).toContain('# 是否启用只读的环境感知恢复探针');
      expect(output).not.toContain('# Artifact language used for workflow documents');
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
      expect(parse(content)).toMatchObject({
        ambient_resume: true,
        classic: {
          artifact_layout: 'docs',
          language: 'en',
          context_compression: 'off',
          review_mode: 'standard',
          auto_transition: true,
        },
      });
      expect(parse(content)).not.toHaveProperty('native');
      expect(content).not.toMatch(/^(language|context_compression|review_mode|auto_transition):/mu);
    });

    it('adds every managed Native default only to an existing Native block', async () => {
      const configDir = path.join(tmpDir, '.comet');
      const configPath = path.join(configDir, 'config.yaml');
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        configPath,
        [
          'schema: comet.project.v1',
          'default_workflow: native',
          'native:',
          '  artifact_root: docs',
          '  language: en',
          '',
        ].join('\n'),
        'utf-8',
      );

      await mergeProjectConfig(tmpDir);

      expect(parse(await fs.readFile(configPath, 'utf-8'))).toMatchObject({
        native: {
          artifact_root: 'docs',
          language: 'en',
          clarification_mode: 'sequential',
          archive_confirmation: 'automatic',
          max_verify_failures: 5,
          snapshot: {
            include: ['**/*'],
            exclude: DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG.exclude,
            max_files: 10_000,
            max_total_bytes: 256 * 1024 * 1024,
            max_duration_ms: 60_000,
          },
        },
      });
      const source = await fs.readFile(configPath, 'utf-8');
      expect(source).toContain('# Controls the auditable project scope');
      expect(source).toContain('# Bounds the total file content hashed by one snapshot');
    });

    it('preserves batch clarification mode across idempotent config updates', async () => {
      const configDir = path.join(tmpDir, '.comet');
      const configPath = path.join(configDir, 'config.yaml');
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        configPath,
        [
          'schema: comet.project.v1',
          'default_workflow: native',
          'native:',
          '  artifact_root: docs',
          '  language: en',
          '  clarification_mode: batch',
          '',
        ].join('\n'),
        'utf-8',
      );

      await mergeProjectConfig(tmpDir);
      const first = await fs.readFile(configPath, 'utf-8');
      await mergeProjectConfig(tmpDir);
      const second = await fs.readFile(configPath, 'utf-8');

      expect(parse(second)).toMatchObject({
        native: { clarification_mode: 'batch' },
      });
      expect(second).toBe(first);
    });

    it('fails closed when updating an invalid Native clarification mode', async () => {
      const configDir = path.join(tmpDir, '.comet');
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, 'config.yaml'),
        'native:\n  artifact_root: docs\n  clarification_mode: sometimes\n',
        'utf-8',
      );

      await expect(mergeProjectConfig(tmpDir)).rejects.toThrow(
        'native.clarification_mode must be sequential or batch',
      );
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
      expect(parse(content)).toMatchObject({
        classic: {
          artifact_layout: 'docs',
          language: 'en',
          context_compression: 'beta',
          review_mode: 'standard',
          auto_transition: true,
        },
      });
      expect(content).not.toMatch(/^(language|context_compression|review_mode|auto_transition):/mu);
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

    it.each([
      ['malformed YAML', 'classic:\n  language: en\nextension: [unterminated\n'],
      [
        'duplicate keys',
        'classic:\n  language: en\n  review_mode: standard\n  review_mode: thorough\n',
      ],
    ])('fails closed without overwriting an existing config with %s', async (_label, source) => {
      const configDir = path.join(tmpDir, '.comet');
      const configPath = path.join(configDir, 'config.yaml');
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configPath, source, 'utf-8');

      await expect(mergeProjectConfig(tmpDir)).rejects.toThrow('Invalid .comet/config.yaml');
      await expect(fs.readFile(configPath, 'utf-8')).resolves.toBe(source);
    });

    it('preserves unknown fields inside the Classic block', async () => {
      const configDir = path.join(tmpDir, '.comet');
      const configPath = path.join(configDir, 'config.yaml');
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        configPath,
        [
          'schema: comet.project.v1',
          'default_workflow: classic',
          'workflows: [classic]',
          'classic:',
          '  artifact_layout: legacy',
          '  language: en',
          '  custom_extension:',
          '    owner: user',
          '    enabled: true',
          '',
        ].join('\n'),
        'utf-8',
      );

      await mergeProjectConfig(tmpDir, null);

      expect(parse(await fs.readFile(configPath, 'utf-8'))).toMatchObject({
        classic: {
          artifact_layout: 'legacy',
          language: 'en',
          custom_extension: {
            owner: 'user',
            enabled: true,
          },
        },
      });
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

    it('preserves new-format values when legacy top-level fields conflict', async () => {
      const configDir = path.join(tmpDir, '.comet');
      const configPath = path.join(configDir, 'config.yaml');
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        configPath,
        [
          'language: en',
          'review_mode: off',
          'classic:',
          '  language: zh-CN',
          '  context_compression: beta',
          '  review_mode: thorough',
          '  auto_transition: false',
          'native:',
          '  artifact_root: docs',
          '  language: en',
          '',
        ].join('\n'),
        'utf-8',
      );

      await mergeProjectConfig(tmpDir, null);
      const first = await fs.readFile(configPath, 'utf-8');
      await mergeProjectConfig(tmpDir, null);
      const second = await fs.readFile(configPath, 'utf-8');

      expect(parse(second)).toMatchObject({
        classic: {
          artifact_layout: 'docs',
          language: 'zh-CN',
          context_compression: 'beta',
          review_mode: 'thorough',
          auto_transition: false,
        },
        native: { artifact_root: 'docs', language: 'en' },
      });
      expect(second).not.toMatch(/^(language|context_compression|review_mode|auto_transition):/mu);
      expect(second).toBe(first);
    });
  });

  describe('createWorkingDirs config boundary', () => {
    it('does not activate a workflow or write project config', async () => {
      await createWorkingDirs(tmpDir);
      const configPath = path.join(tmpDir, '.comet', 'config.yaml');

      await expect(fs.access(configPath)).rejects.toMatchObject({ code: 'ENOENT' });
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
