import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  getBaseDir,
  detectPlatforms,
  hasSkills,
  hasPluginSuperpowers,
  hasOpenCodePluginSuperpowers,
} from '../../platform/install/detect.js';
import {
  PLATFORMS,
  getPlatformSkillsDir,
  getPlatformSkillsDirs,
  type Platform,
} from '../../platform/install/platforms.js';

const mockPlatform: Platform = {
  id: 'claude',
  name: 'Claude Code',
  skillsDir: '.claude',
  openspecToolId: 'claude',
};

describe('detect', () => {
  let tmpDir: string;
  let homedirSpy: MockInstance<typeof os.homedir>;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `comet-detect-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });

    const fakeHome = path.join(tmpDir, 'fake-home');
    await fs.mkdir(fakeHome, { recursive: true });
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
  });

  afterEach(async () => {
    homedirSpy.mockRestore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('getBaseDir', () => {
    it('returns home directory for global scope', () => {
      expect(getBaseDir('global', tmpDir)).toBe(os.homedir());
    });

    it('returns project path for project scope', () => {
      expect(getBaseDir('project', tmpDir)).toBe(tmpDir);
    });
  });

  describe('platform global skills directories', () => {
    it('declares Codex canonical, compatibility, detection, and rules roots separately', () => {
      const codex = PLATFORMS.find((platform) => platform.id === 'codex');

      expect(codex).toBeDefined();
      expect(codex?.skillsDir).toBe('.agents');
      expect(codex?.globalSkillsDir).toBe('.agents');
      expect(codex?.legacySkillsDirs).toEqual(['.codex']);
      expect(codex?.detectionPaths).toEqual(['.codex']);
      expect(codex?.rulesBaseDir).toBe('.codex');
      expect(codex?.hookConfigFile).toBe('hooks.json');
      expect(codex?.legacyHookConfigFiles).toEqual(['settings.local.json']);
      expect(getPlatformSkillsDir(codex!, 'project')).toBe('.agents');
      expect(getPlatformSkillsDir(codex!, 'global')).toBe('.agents');
      expect(getPlatformSkillsDirs(codex!, 'project')).toEqual(['.agents', '.codex']);
      expect(getPlatformSkillsDirs(codex!, 'global')).toEqual(['.agents', '.codex']);
    });

    it('declares Kimi Code global skills under the user .kimi-code directory', () => {
      const kimicode = PLATFORMS.find((platform) => platform.id === 'kimicode');

      expect(kimicode).toBeDefined();
      expect(kimicode?.skillsDir).toBe('.kimi-code');
      expect(kimicode?.globalSkillsDir).toBe('.kimi-code');
      expect(kimicode?.openspecToolId).toBe('kimi');
    });

    it('declares Lingma global skills under the user .lingma directory', () => {
      const lingma = PLATFORMS.find((platform) => platform.id === 'lingma');

      expect(lingma).toBeDefined();
      expect(lingma?.skillsDir).toBe('.lingma');
      expect(lingma?.globalSkillsDir).toBe('.lingma');
    });

    it('declares ZCode skills under .zcode with opencode openspec tool id', () => {
      const zcode = PLATFORMS.find((platform) => platform.id === 'zcode');

      expect(zcode).toBeDefined();
      expect(zcode?.skillsDir).toBe('.zcode');
      expect(zcode?.globalSkillsDir).toBe('.zcode');
      expect(zcode?.openspecToolId).toBe('opencode');
      expect(zcode?.rulesDir).toBe('rules');
      expect(zcode?.rulesFormat).toBe('md');
    });

    it('declares MimoCode skills under .mimocode with opencode-compatible paths', () => {
      const mimocode = PLATFORMS.find((platform) => platform.id === 'mimocode');

      expect(mimocode).toBeDefined();
      expect(mimocode?.skillsDir).toBe('.mimocode');
      expect(mimocode?.globalSkillsDir).toBe('.config/mimocode');
      expect(mimocode?.openspecToolId).toBe('opencode');
      expect(mimocode?.rulesDir).toBe('rules');
      expect(mimocode?.rulesFormat).toBe('md');
    });

    it('declares Trae CN directories while using OpenSpec Trae support', () => {
      const traeCn = PLATFORMS.find((platform) => platform.id === 'trae-cn');

      expect(traeCn).toBeDefined();
      expect(traeCn?.skillsDir).toBe('.trae-cn');
      expect(traeCn?.globalSkillsDir).toBe('.trae-cn');
      expect(traeCn?.openspecToolId).toBe('trae');
      expect(traeCn?.rulesDir).toBe('rules');
      expect(traeCn?.rulesFormat).toBe('md');
    });
  });

  describe('detectPlatforms', () => {
    it('detects Codex from its configuration directory', async () => {
      await fs.mkdir(path.join(tmpDir, '.codex'));

      const detected = await detectPlatforms(tmpDir);

      expect(detected.has('codex')).toBe(true);
    });

    it('does not detect Codex from a shared .agents skills directory alone', async () => {
      await fs.mkdir(path.join(tmpDir, '.agents', 'skills', 'personal-skill'), {
        recursive: true,
      });

      const detected = await detectPlatforms(tmpDir);

      expect(detected.has('codex')).toBe(false);
    });

    it('detects claude platform when .claude directory exists', async () => {
      await fs.mkdir(path.join(tmpDir, '.claude'));
      const detected = await detectPlatforms(tmpDir);
      expect(detected.has('claude')).toBe(true);
    });

    it('detects github-copilot when copilot-instructions.md exists', async () => {
      await fs.mkdir(path.join(tmpDir, '.github'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, '.github', 'copilot-instructions.md'), '');
      const detected = await detectPlatforms(tmpDir);
      expect(detected.has('github-copilot')).toBe(true);
    });

    it('does not detect github-copilot when only .github dir exists', async () => {
      await fs.mkdir(path.join(tmpDir, '.github'));
      const detected = await detectPlatforms(tmpDir);
      expect(detected.has('github-copilot')).toBe(false);
    });

    it('detects multiple platforms', async () => {
      await fs.mkdir(path.join(tmpDir, '.claude'));
      await fs.mkdir(path.join(tmpDir, '.cursor'));
      await fs.mkdir(path.join(tmpDir, '.kimi-code'));
      const detected = await detectPlatforms(tmpDir);
      expect(detected.has('claude')).toBe(true);
      expect(detected.has('cursor')).toBe(true);
      expect(detected.has('kimicode')).toBe(true);
      expect(detected.size).toBeGreaterThanOrEqual(3);
    });

    it('returns empty set when no platforms detected', async () => {
      const detected = await detectPlatforms(tmpDir);
      expect(detected.size).toBe(0);
    });

    it('detects both antigravity and antigravity2 from the shared .agents directory', async () => {
      const antigravity = PLATFORMS.find((platform) => platform.id === 'antigravity');
      const antigravity2 = PLATFORMS.find((platform) => platform.id === 'antigravity2');
      expect(antigravity?.skillsDir).toBe('.agents');
      expect(antigravity2?.skillsDir).toBe('.agents');

      await fs.mkdir(path.join(tmpDir, '.agents'));
      const detected = await detectPlatforms(tmpDir);
      expect(detected.has('antigravity')).toBe(true);
      expect(detected.has('antigravity2')).toBe(true);
    });

    it('detects MimoCode from the project config directory', async () => {
      await fs.mkdir(path.join(tmpDir, '.mimocode'));
      const detected = await detectPlatforms(tmpDir);
      expect(detected.has('mimocode')).toBe(true);
    });
  });

  describe('hasSkills', () => {
    it('detects openspec skills when openspec- prefixed dirs exist', async () => {
      await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'openspec-core'), {
        recursive: true,
      });
      expect(await hasSkills(tmpDir, mockPlatform, 'openspec')).toBe(true);
    });

    it('detects superpowers skills', async () => {
      await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'brainstorming'), {
        recursive: true,
      });
      await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'using-superpowers'), {
        recursive: true,
      });
      expect(await hasSkills(tmpDir, mockPlatform, 'superpowers')).toBe(true);
    });

    it('detects comet skills', async () => {
      await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), { recursive: true });
      expect(await hasSkills(tmpDir, mockPlatform, 'comet')).toBe(true);
    });

    it('treats OpenCode Comet skills without slash commands as incomplete', async () => {
      const opencode = PLATFORMS.find((platform) => platform.id === 'opencode');
      expect(opencode).toBeDefined();
      if (!opencode) return;

      await fs.mkdir(path.join(tmpDir, '.opencode', 'skills', 'comet'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, '.opencode', 'skills', 'comet-open'), { recursive: true });

      expect(await hasSkills(tmpDir, opencode, 'comet')).toBe(false);
    });

    it('detects OpenCode Comet skills when matching slash commands exist', async () => {
      const opencode = PLATFORMS.find((platform) => platform.id === 'opencode');
      expect(opencode).toBeDefined();
      if (!opencode) return;

      await fs.mkdir(path.join(tmpDir, '.opencode', 'skills', 'comet'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, '.opencode', 'skills', 'comet-open'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, '.opencode', 'commands'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, '.opencode', 'commands', 'comet.md'), '');
      await fs.writeFile(path.join(tmpDir, '.opencode', 'commands', 'comet-open.md'), '');

      expect(await hasSkills(tmpDir, opencode, 'comet')).toBe(true);
    });

    it('requires MimoCode slash commands before treating Comet as installed', async () => {
      const mimocode = PLATFORMS.find((platform) => platform.id === 'mimocode');
      expect(mimocode).toBeDefined();
      if (!mimocode) return;

      await fs.mkdir(path.join(tmpDir, '.mimocode', 'skills', 'comet'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, '.mimocode', 'skills', 'comet-open'), { recursive: true });

      expect(await hasSkills(tmpDir, mimocode, 'comet')).toBe(false);

      await fs.mkdir(path.join(tmpDir, '.mimocode', 'commands'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, '.mimocode', 'commands', 'comet.md'), '');
      await fs.writeFile(path.join(tmpDir, '.mimocode', 'commands', 'comet-open.md'), '');

      expect(await hasSkills(tmpDir, mimocode, 'comet')).toBe(true);
    });

    it('detects Antigravity global skills in the Gemini Antigravity directory', async () => {
      const antigravity = PLATFORMS.find((platform) => platform.id === 'antigravity');
      expect(antigravity).toBeDefined();
      if (!antigravity) return;

      const fakeHome = os.homedir();
      await fs.mkdir(path.join(fakeHome, '.gemini', 'antigravity', 'skills', 'comet'), {
        recursive: true,
      });

      expect(await hasSkills(fakeHome, antigravity, 'comet', [], 'global')).toBe(true);
    });

    it('detects Antigravity 2.0 global skills in the Gemini config directory', async () => {
      const antigravity2 = PLATFORMS.find((platform) => platform.id === 'antigravity2');
      expect(antigravity2).toBeDefined();
      if (!antigravity2) return;

      const fakeHome = os.homedir();
      await fs.mkdir(path.join(fakeHome, '.gemini', 'config', 'skills', 'comet'), {
        recursive: true,
      });

      expect(await hasSkills(fakeHome, antigravity2, 'comet', [], 'global')).toBe(true);
    });

    it('returns false for missing skills', async () => {
      await fs.mkdir(path.join(tmpDir, '.claude', 'skills'), { recursive: true });
      expect(await hasSkills(tmpDir, mockPlatform, 'comet')).toBe(false);
    });

    it('returns false when skills directory does not exist', async () => {
      expect(await hasSkills(tmpDir, mockPlatform, 'comet')).toBe(false);
    });

    it('returns false when a platform directory exists without a skills directory', async () => {
      await fs.mkdir(path.join(tmpDir, '.claude'), { recursive: true });

      expect(await hasSkills(tmpDir, mockPlatform, 'comet')).toBe(false);
    });

    it('detects plugin-installed superpowers for claude platform', async () => {
      const origEnv = process.env.CLAUDE_CONFIG_DIR;
      const pluginDir = path.join(tmpDir, '.claude');
      process.env.CLAUDE_CONFIG_DIR = pluginDir;

      const skillsDir = path.join(
        pluginDir,
        'plugins',
        'cache',
        'claude-plugins-official',
        'superpowers',
        '5.0.0',
        'skills',
      );
      await fs.mkdir(skillsDir, { recursive: true });
      await fs.mkdir(path.join(skillsDir, 'brainstorming'));
      await fs.mkdir(path.join(skillsDir, 'using-superpowers'));

      // No skills in the normal location
      await fs.mkdir(path.join(tmpDir, '.claude', 'skills'), { recursive: true });

      expect(await hasSkills(tmpDir, mockPlatform, 'superpowers')).toBe(true);

      if (origEnv !== undefined) {
        process.env.CLAUDE_CONFIG_DIR = origEnv;
      } else {
        delete process.env.CLAUDE_CONFIG_DIR;
      }
    });

    it('does not detect plugin superpowers for non-claude platforms', async () => {
      const origEnv = process.env.CLAUDE_CONFIG_DIR;
      const pluginDir = path.join(tmpDir, '.claude');
      process.env.CLAUDE_CONFIG_DIR = pluginDir;

      const skillsDir = path.join(
        pluginDir,
        'plugins',
        'cache',
        'claude-plugins-official',
        'superpowers',
        '5.0.0',
        'skills',
      );
      await fs.mkdir(skillsDir, { recursive: true });
      await fs.mkdir(path.join(skillsDir, 'brainstorming'));

      const cursorPlatform: Platform = {
        id: 'cursor',
        name: 'Cursor',
        skillsDir: '.cursor',
        openspecToolId: 'cursor',
      };

      expect(await hasSkills(tmpDir, cursorPlatform, 'superpowers')).toBe(false);

      if (origEnv !== undefined) {
        process.env.CLAUDE_CONFIG_DIR = origEnv;
      } else {
        delete process.env.CLAUDE_CONFIG_DIR;
      }
    });

    it('detects plugin-installed superpowers for codex platform', async () => {
      const origEnv = process.env.CODEX_HOME;
      const pluginDir = path.join(tmpDir, '.codex');
      process.env.CODEX_HOME = pluginDir;

      try {
        const skillsDir = path.join(
          pluginDir,
          'plugins',
          'cache',
          'openai-curated',
          'superpowers',
          'c6ea566d',
          'skills',
        );
        await fs.mkdir(skillsDir, { recursive: true });
        await fs.mkdir(path.join(skillsDir, 'brainstorming'));
        await fs.mkdir(path.join(skillsDir, 'using-superpowers'));

        // Keep the canonical project Skill location empty so detection comes from the plugin cache.
        await fs.mkdir(path.join(tmpDir, '.agents', 'skills'), { recursive: true });

        const codexPlatform = PLATFORMS.find((platform) => platform.id === 'codex');
        expect(codexPlatform).toBeDefined();
        if (!codexPlatform) return;

        expect(await hasSkills(tmpDir, codexPlatform, 'superpowers')).toBe(true);
      } finally {
        if (origEnv !== undefined) {
          process.env.CODEX_HOME = origEnv;
        } else {
          delete process.env.CODEX_HOME;
        }
      }
    });
  });

  describe('hasPluginSuperpowers', () => {
    it('returns true when superpowers plugin is installed', async () => {
      const origEnv = process.env.CLAUDE_CONFIG_DIR;
      const pluginDir = path.join(tmpDir, '.claude');
      process.env.CLAUDE_CONFIG_DIR = pluginDir;

      const skillsDir = path.join(
        pluginDir,
        'plugins',
        'cache',
        'test-marketplace',
        'superpowers',
        '5.0.0',
        'skills',
      );
      await fs.mkdir(skillsDir, { recursive: true });
      await fs.mkdir(path.join(skillsDir, 'brainstorming'));
      await fs.mkdir(path.join(skillsDir, 'using-superpowers'));

      expect(await hasPluginSuperpowers()).toBe(true);

      if (origEnv !== undefined) {
        process.env.CLAUDE_CONFIG_DIR = origEnv;
      } else {
        delete process.env.CLAUDE_CONFIG_DIR;
      }
    });

    it('returns false when no plugin cache exists', async () => {
      const origEnv = process.env.CLAUDE_CONFIG_DIR;
      process.env.CLAUDE_CONFIG_DIR = path.join(tmpDir, 'nonexistent');

      expect(await hasPluginSuperpowers()).toBe(false);

      if (origEnv !== undefined) {
        process.env.CLAUDE_CONFIG_DIR = origEnv;
      } else {
        delete process.env.CLAUDE_CONFIG_DIR;
      }
    });

    it('returns false when plugin exists but has no matching skills', async () => {
      const origEnv = process.env.CLAUDE_CONFIG_DIR;
      const pluginDir = path.join(tmpDir, '.claude');
      process.env.CLAUDE_CONFIG_DIR = pluginDir;

      const skillsDir = path.join(
        pluginDir,
        'plugins',
        'cache',
        'test-marketplace',
        'superpowers',
        '5.0.0',
        'skills',
      );
      await fs.mkdir(skillsDir, { recursive: true });
      await fs.mkdir(path.join(skillsDir, 'unrelated-skill'));

      expect(await hasPluginSuperpowers()).toBe(false);

      if (origEnv !== undefined) {
        process.env.CLAUDE_CONFIG_DIR = origEnv;
      } else {
        delete process.env.CLAUDE_CONFIG_DIR;
      }
    });
  });

  describe('hasOpenCodePluginSuperpowers', () => {
    it('returns true when superpowers plugin source directory exists with skills', async () => {
      const origEnv = process.env.OPENCODE_CONFIG_DIR;
      const opencodeDir = path.join(tmpDir, '.config', 'opencode');
      process.env.OPENCODE_CONFIG_DIR = opencodeDir;

      const skillsDir = path.join(opencodeDir, 'superpowers', 'skills');
      await fs.mkdir(skillsDir, { recursive: true });
      await fs.mkdir(path.join(skillsDir, 'brainstorming'));
      await fs.mkdir(path.join(skillsDir, 'using-superpowers'));

      expect(await hasOpenCodePluginSuperpowers()).toBe(true);

      if (origEnv !== undefined) {
        process.env.OPENCODE_CONFIG_DIR = origEnv;
      } else {
        delete process.env.OPENCODE_CONFIG_DIR;
      }
    });

    it('returns true when opencode.json contains superpowers plugin entry', async () => {
      const origEnv = process.env.OPENCODE_CONFIG_DIR;
      const opencodeDir = path.join(tmpDir, '.config', 'opencode');
      process.env.OPENCODE_CONFIG_DIR = opencodeDir;

      await fs.mkdir(opencodeDir, { recursive: true });
      await fs.writeFile(
        path.join(opencodeDir, 'opencode.json'),
        JSON.stringify({
          plugin: ['superpowers@git+https://github.com/obra/superpowers.git'],
        }),
      );

      expect(await hasOpenCodePluginSuperpowers()).toBe(true);

      if (origEnv !== undefined) {
        process.env.OPENCODE_CONFIG_DIR = origEnv;
      } else {
        delete process.env.OPENCODE_CONFIG_DIR;
      }
    });

    it('returns false when no superpowers plugin is installed', async () => {
      const origEnv = process.env.OPENCODE_CONFIG_DIR;
      process.env.OPENCODE_CONFIG_DIR = path.join(tmpDir, 'nonexistent');

      expect(await hasOpenCodePluginSuperpowers()).toBe(false);

      if (origEnv !== undefined) {
        process.env.OPENCODE_CONFIG_DIR = origEnv;
      } else {
        delete process.env.OPENCODE_CONFIG_DIR;
      }
    });

    it('returns false when opencode.json exists but has no superpowers entry', async () => {
      const origEnv = process.env.OPENCODE_CONFIG_DIR;
      const opencodeDir = path.join(tmpDir, '.config', 'opencode');
      process.env.OPENCODE_CONFIG_DIR = opencodeDir;

      await fs.mkdir(opencodeDir, { recursive: true });
      await fs.writeFile(
        path.join(opencodeDir, 'opencode.json'),
        JSON.stringify({ plugin: ['some-other-plugin'] }),
      );

      expect(await hasOpenCodePluginSuperpowers()).toBe(false);

      if (origEnv !== undefined) {
        process.env.OPENCODE_CONFIG_DIR = origEnv;
      } else {
        delete process.env.OPENCODE_CONFIG_DIR;
      }
    });

    it('returns false when opencode.json is invalid JSON', async () => {
      const origEnv = process.env.OPENCODE_CONFIG_DIR;
      const opencodeDir = path.join(tmpDir, '.config', 'opencode');
      process.env.OPENCODE_CONFIG_DIR = opencodeDir;

      await fs.mkdir(opencodeDir, { recursive: true });
      await fs.writeFile(path.join(opencodeDir, 'opencode.json'), 'not valid json');

      expect(await hasOpenCodePluginSuperpowers()).toBe(false);

      if (origEnv !== undefined) {
        process.env.OPENCODE_CONFIG_DIR = origEnv;
      } else {
        delete process.env.OPENCODE_CONFIG_DIR;
      }
    });
  });

  describe('hasSkills for OpenCode plugin-installed superpowers', () => {
    it('detects superpowers via OpenCode plugin when normal skills dir is empty', async () => {
      const origEnv = process.env.OPENCODE_CONFIG_DIR;
      const opencodeDir = path.join(tmpDir, '.config', 'opencode');
      process.env.OPENCODE_CONFIG_DIR = opencodeDir;

      const opencode = PLATFORMS.find((platform) => platform.id === 'opencode');
      expect(opencode).toBeDefined();
      if (!opencode) return;

      // Create the plugin source directory with superpowers skills
      const pluginSkillsDir = path.join(opencodeDir, 'superpowers', 'skills');
      await fs.mkdir(pluginSkillsDir, { recursive: true });
      await fs.mkdir(path.join(pluginSkillsDir, 'brainstorming'));
      await fs.mkdir(path.join(pluginSkillsDir, 'using-superpowers'));

      // Normal skills directory is empty — no skills there
      await fs.mkdir(path.join(tmpDir, '.opencode', 'skills'), { recursive: true });

      expect(await hasSkills(tmpDir, opencode, 'superpowers')).toBe(true);

      if (origEnv !== undefined) {
        process.env.OPENCODE_CONFIG_DIR = origEnv;
      } else {
        delete process.env.OPENCODE_CONFIG_DIR;
      }
    });
  });
});
