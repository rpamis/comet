import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const { writeFileMock } = vi.hoisted(() => ({ writeFileMock: vi.fn() }));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  writeFileMock.mockImplementation(actual.writeFile);
  return { ...actual, writeFile: writeFileMock };
});

import { PLATFORMS, type Platform } from '../../platform/install/platforms.js';
import {
  removeLegacyCometSkillsForPlatform,
  removeCometSkillsForPlatform,
  removeCometRulesForPlatform,
  removeCometHooksForPlatform,
  removeWorkingDirs,
} from '../../domains/skill/uninstall.js';
import {
  copyCometSkillsForPlatform,
  copyCometRulesForPlatform,
  installCometHooksForPlatform,
} from '../../domains/skill/platform-install.js';
import { fileExists, removeFile, removeDir, isDirEmpty } from '../../platform/fs/file-system.js';
import {
  getProjectRegistryPath,
  upsertProjectInstallation,
} from '../../platform/install/project-registry.js';

describe('uninstall', () => {
  let tmpDir: string;

  beforeEach(async () => {
    writeFileMock.mockReset();
    writeFileMock.mockImplementation(fs.writeFile);
    tmpDir = path.join(
      os.tmpdir(),
      `comet-uninstall-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('removes only managed Codex skills from canonical and legacy roots', async () => {
    const codexPlatform = PLATFORMS.find((platform) => platform.id === 'codex')!;
    await copyCometSkillsForPlatform(tmpDir, codexPlatform, true, 'skills', 'project');
    const legacyComet = path.join(tmpDir, '.codex', 'skills', 'comet');
    await fs.mkdir(legacyComet, { recursive: true });
    await fs.writeFile(path.join(legacyComet, 'SKILL.md'), '# Comet\n');
    for (const root of ['.agents', '.codex']) {
      const personal = path.join(tmpDir, root, 'skills', 'personal', 'SKILL.md');
      await fs.mkdir(path.dirname(personal), { recursive: true });
      await fs.writeFile(personal, '# Personal\n');
    }

    await removeCometSkillsForPlatform(tmpDir, codexPlatform, 'project');

    await expect(fs.access(path.join(tmpDir, '.agents', 'skills', 'comet'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(legacyComet)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const root of ['.agents', '.codex']) {
      await expect(
        fs.readFile(path.join(tmpDir, root, 'skills', 'personal', 'SKILL.md'), 'utf8'),
      ).resolves.toBe('# Personal\n');
    }
  });

  it.each(['canonical', 'external'] as const)(
    'unlinks a legacy Codex managed Skill junction without modifying its %s target',
    async (targetKind) => {
      const codexPlatform = PLATFORMS.find((platform) => platform.id === 'codex')!;
      const target =
        targetKind === 'canonical'
          ? path.join(tmpDir, '.agents', 'skills', 'comet')
          : path.join(tmpDir, 'external', 'comet');
      const legacyLink = path.join(tmpDir, '.codex', 'skills', 'comet');
      await fs.mkdir(target, { recursive: true });
      await fs.writeFile(path.join(target, 'SKILL.md'), '# Target Comet\n');
      await fs.writeFile(path.join(target, 'keep.txt'), 'keep\n');
      await fs.mkdir(path.dirname(legacyLink), { recursive: true });
      await fs.symlink(target, legacyLink, process.platform === 'win32' ? 'junction' : 'dir');

      await removeLegacyCometSkillsForPlatform(tmpDir, codexPlatform, 'project');

      await expect(fs.lstat(legacyLink)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.readFile(path.join(target, 'SKILL.md'), 'utf8')).resolves.toBe(
        '# Target Comet\n',
      );
      await expect(fs.readFile(path.join(target, 'keep.txt'), 'utf8')).resolves.toBe('keep\n');
    },
  );

  it.each(['canonical', 'external'] as const)(
    'unlinks a nested legacy Codex managed junction without modifying its %s target',
    async (targetKind) => {
      const codexPlatform = PLATFORMS.find((platform) => platform.id === 'codex')!;
      const target =
        targetKind === 'canonical'
          ? path.join(tmpDir, '.agents', 'skills', 'comet', 'scripts')
          : path.join(tmpDir, 'external', 'comet-scripts');
      const legacyComet = path.join(tmpDir, '.codex', 'skills', 'comet');
      const legacyLink = path.join(legacyComet, 'scripts');
      await fs.mkdir(target, { recursive: true });
      await fs.writeFile(path.join(target, 'comet-state.mjs'), 'target state\n');
      await fs.writeFile(path.join(target, 'keep.txt'), 'keep\n');
      await fs.mkdir(legacyComet, { recursive: true });
      await fs.writeFile(path.join(legacyComet, 'SKILL.md'), '# Legacy Comet\n');
      await fs.symlink(target, legacyLink, process.platform === 'win32' ? 'junction' : 'dir');

      await removeLegacyCometSkillsForPlatform(tmpDir, codexPlatform, 'project');

      await expect(fs.lstat(legacyLink)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.readFile(path.join(target, 'comet-state.mjs'), 'utf8')).resolves.toBe(
        'target state\n',
      );
      await expect(fs.readFile(path.join(target, 'keep.txt'), 'utf8')).resolves.toBe('keep\n');
    },
  );

  it.each(['.agents', '.codex'] as const)(
    'refuses to clean a shared Codex skills-root junction at %s',
    async (root) => {
      const codexPlatform = PLATFORMS.find((platform) => platform.id === 'codex')!;
      const target = path.join(tmpDir, 'external', root.slice(1), 'skills');
      const targetComet = path.join(target, 'comet');
      const personal = path.join(target, 'personal', 'SKILL.md');
      const skillsLink = path.join(tmpDir, root, 'skills');
      await fs.mkdir(targetComet, { recursive: true });
      await fs.writeFile(path.join(targetComet, 'SKILL.md'), '# Target Comet\n');
      await fs.writeFile(path.join(targetComet, 'keep.txt'), 'keep\n');
      await fs.mkdir(path.dirname(personal), { recursive: true });
      await fs.writeFile(personal, '# Personal\n');
      await fs.mkdir(path.dirname(skillsLink), { recursive: true });
      await fs.symlink(target, skillsLink, process.platform === 'win32' ? 'junction' : 'dir');

      const result = await removeCometSkillsForPlatform(tmpDir, codexPlatform, 'project');

      expect(result.failed).toBeGreaterThan(0);
      await expect(fs.lstat(skillsLink)).resolves.toMatchObject({});
      await expect(fs.readFile(path.join(targetComet, 'SKILL.md'), 'utf8')).resolves.toBe(
        '# Target Comet\n',
      );
      await expect(fs.readFile(path.join(targetComet, 'keep.txt'), 'utf8')).resolves.toBe('keep\n');
      await expect(fs.readFile(personal, 'utf8')).resolves.toBe('# Personal\n');
    },
  );

  it.each(['.agents', '.codex'] as const)(
    'refuses to clean a shared Codex platform-root junction at %s',
    async (root) => {
      const codexPlatform = PLATFORMS.find((platform) => platform.id === 'codex')!;
      const target = path.join(tmpDir, 'external', `${root.slice(1)}-root`);
      const comet = path.join(target, 'skills', 'comet', 'SKILL.md');
      const personal = path.join(target, 'skills', 'personal', 'SKILL.md');
      await fs.mkdir(path.dirname(comet), { recursive: true });
      await fs.mkdir(path.dirname(personal), { recursive: true });
      await fs.writeFile(comet, '# Comet\n');
      await fs.writeFile(personal, '# Personal\n');
      await fs.symlink(
        target,
        path.join(tmpDir, root),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const result = await removeCometSkillsForPlatform(tmpDir, codexPlatform, 'project');

      expect(result.failed).toBeGreaterThan(0);
      await expect(fs.lstat(path.join(tmpDir, root))).resolves.toMatchObject({});
      await expect(fs.readFile(comet, 'utf8')).resolves.toBe('# Comet\n');
      await expect(fs.readFile(personal, 'utf8')).resolves.toBe('# Personal\n');
    },
  );

  it('counts a Skill removal failure and continues removing independent managed Skills', async () => {
    const codexPlatform = PLATFORMS.find((platform) => platform.id === 'codex')!;
    await copyCometSkillsForPlatform(tmpDir, codexPlatform, true, 'skills', 'project');
    const blockedSkill = path.join(tmpDir, '.agents', 'skills', 'comet', 'SKILL.md');
    const removableSkill = path.join(tmpDir, '.agents', 'skills', 'comet-open', 'SKILL.md');
    const userSkill = path.join(tmpDir, '.agents', 'skills', 'personal', 'SKILL.md');
    await fs.mkdir(path.dirname(userSkill), { recursive: true });
    await fs.writeFile(userSkill, '# Personal\n');
    const unlink = fs.unlink.bind(fs);
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const unlinkSpy = vi.spyOn(fs, 'unlink').mockImplementation(async (filePath) => {
      if (path.resolve(String(filePath)) === path.resolve(blockedSkill)) throw permissionError;
      await unlink(filePath);
    });

    try {
      await expect(
        removeCometSkillsForPlatform(tmpDir, codexPlatform, 'project'),
      ).resolves.toMatchObject({ failed: 1 });
    } finally {
      unlinkSpy.mockRestore();
    }

    await expect(fs.readFile(blockedSkill, 'utf8')).resolves.toContain('# Comet');
    await expect(fs.access(removableSkill)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(userSkill, 'utf8')).resolves.toBe('# Personal\n');
  });

  it('counts a Rule removal failure and continues removing independent managed Rules', async () => {
    const claudePlatform = PLATFORMS.find((platform) => platform.id === 'claude')!;
    const rulesDir = path.join(tmpDir, '.claude', 'rules');
    const blockedRule = path.join(rulesDir, 'comet-workflow-guard.md');
    const removableRule = path.join(rulesDir, 'comet-phase-guard.md');
    const userRule = path.join(rulesDir, 'personal.md');
    await fs.mkdir(rulesDir, { recursive: true });
    await fs.writeFile(blockedRule, '# Blocked Rule\n');
    await fs.writeFile(removableRule, '# Removable Rule\n');
    await fs.writeFile(userRule, '# Personal Rule\n');
    const unlink = fs.unlink.bind(fs);
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const unlinkSpy = vi.spyOn(fs, 'unlink').mockImplementation(async (filePath) => {
      if (path.resolve(String(filePath)) === path.resolve(blockedRule)) throw permissionError;
      await unlink(filePath);
    });

    try {
      await expect(removeCometRulesForPlatform(tmpDir, claudePlatform, 'project')).resolves.toEqual(
        { removed: 1, failed: 1 },
      );
    } finally {
      unlinkSpy.mockRestore();
    }

    await expect(fs.readFile(blockedRule, 'utf8')).resolves.toBe('# Blocked Rule\n');
    await expect(fs.access(removableRule)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(userRule, 'utf8')).resolves.toBe('# Personal Rule\n');
  });

  it('counts a Hook-file removal failure without deleting user Hook files', async () => {
    const kiroPlatform = PLATFORMS.find((platform) => platform.id === 'kiro')!;
    const hooksDir = path.join(tmpDir, '.kiro', 'hooks');
    const managedHook = path.join(hooksDir, 'comet-hook-router.kiro.hook');
    const userHook = path.join(hooksDir, 'personal.kiro.hook');
    await fs.mkdir(hooksDir, { recursive: true });
    await fs.writeFile(managedHook, '{}\n');
    await fs.writeFile(userHook, '{}\n');
    const unlink = fs.unlink.bind(fs);
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const unlinkSpy = vi.spyOn(fs, 'unlink').mockImplementation(async (filePath) => {
      if (path.resolve(String(filePath)) === path.resolve(managedHook)) throw permissionError;
      await unlink(filePath);
    });

    try {
      await expect(removeCometHooksForPlatform(tmpDir, kiroPlatform, 'project')).resolves.toEqual({
        removed: 0,
        failed: 1,
      });
    } finally {
      unlinkSpy.mockRestore();
    }

    await expect(fs.readFile(managedHook, 'utf8')).resolves.toBe('{}\n');
    await expect(fs.readFile(userHook, 'utf8')).resolves.toBe('{}\n');
  });

  it('counts an empty Rule-directory removal failure after removing managed Rules', async () => {
    const claudePlatform = PLATFORMS.find((platform) => platform.id === 'claude')!;
    const rulesDir = path.join(tmpDir, '.claude', 'rules');
    await fs.mkdir(rulesDir, { recursive: true });
    await fs.writeFile(path.join(rulesDir, 'comet-workflow-guard.md'), '# Rule\n');
    await fs.writeFile(path.join(rulesDir, 'comet-phase-guard.md'), '# Legacy Rule\n');
    const rm = fs.rm.bind(fs);
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const rmSpy = vi.spyOn(fs, 'rm').mockImplementation(async (dirPath, options) => {
      if (path.resolve(String(dirPath)) === path.resolve(rulesDir)) throw permissionError;
      await rm(dirPath, options);
    });

    try {
      await expect(removeCometRulesForPlatform(tmpDir, claudePlatform, 'project')).resolves.toEqual(
        { removed: 2, failed: 1 },
      );
    } finally {
      rmSpy.mockRestore();
    }

    await expect(fs.readdir(rulesDir)).resolves.toEqual([]);
  });

  describe('file-system utilities', () => {
    describe('removeFile', () => {
      it('removes an existing file and returns true', async () => {
        const filePath = path.join(tmpDir, 'test.txt');
        await fs.writeFile(filePath, 'hello', 'utf-8');
        expect(await fileExists(filePath)).toBe(true);

        const result = await removeFile(filePath);
        expect(result).toBe(true);
        expect(await fileExists(filePath)).toBe(false);
      });

      it('returns false for non-existent file', async () => {
        const result = await removeFile(path.join(tmpDir, 'nope.txt'));
        expect(result).toBe(false);
      });
    });

    describe('removeDir', () => {
      it('removes an existing directory and returns true', async () => {
        const dirPath = path.join(tmpDir, 'subdir');
        await fs.mkdir(dirPath, { recursive: true });
        await fs.writeFile(path.join(dirPath, 'file.txt'), 'data', 'utf-8');

        const result = await removeDir(dirPath);
        expect(result).toBe(true);
        expect(await fileExists(dirPath)).toBe(false);
      });

      it('returns false for non-existent directory', async () => {
        const result = await removeDir(path.join(tmpDir, 'nope'));
        expect(result).toBe(false);
      });

      it('removes a symlinked directory without deleting its target', async () => {
        if (process.platform === 'win32') return; // requires elevated permissions
        // Data-safety: a symlinked skills/rules/hooks dir must be unlinked in
        // place, never recursively removed through to its resolved target.
        const realDir = path.join(tmpDir, 'real-target');
        const realFile = path.join(realDir, 'keep-me.txt');
        await fs.mkdir(realDir, { recursive: true });
        await fs.writeFile(realFile, 'data', 'utf-8');

        const symlinkDir = path.join(tmpDir, 'skills-symlink');
        await fs.symlink(realDir, symlinkDir, 'dir');

        const result = await removeDir(symlinkDir);

        expect(result).toBe(true);
        expect(await fileExists(symlinkDir)).toBe(false);
        expect(await fileExists(realDir)).toBe(true);
        expect(await fileExists(realFile)).toBe(true);
      });
    });

    describe('isDirEmpty', () => {
      it('returns true for empty directory', async () => {
        const dirPath = path.join(tmpDir, 'empty');
        await fs.mkdir(dirPath, { recursive: true });
        expect(await isDirEmpty(dirPath)).toBe(true);
      });

      it('returns false for non-empty directory', async () => {
        const dirPath = path.join(tmpDir, 'notempty');
        await fs.mkdir(dirPath, { recursive: true });
        await fs.writeFile(path.join(dirPath, 'file.txt'), 'data', 'utf-8');
        expect(await isDirEmpty(dirPath)).toBe(false);
      });

      it('returns true for non-existent directory', async () => {
        expect(await isDirEmpty(path.join(tmpDir, 'nope'))).toBe(true);
      });

      it('returns false when the path is not a directory', async () => {
        // readdir on a file throws ENOTDIR (a non-ENOENT error); isDirEmpty
        // must report false so callers never treat an unreadable path as empty.
        const filePath = path.join(tmpDir, 'a-file.txt');
        await fs.writeFile(filePath, 'data', 'utf-8');
        expect(await isDirEmpty(filePath)).toBe(false);
      });
    });
  });

  describe('removeCometSkillsForPlatform', () => {
    const claudePlatform: Platform = PLATFORMS.find((p) => p.id === 'claude')!;

    it('removes installed Comet skills', async () => {
      await copyCometSkillsForPlatform(tmpDir, claudePlatform, true, 'skills', 'project');

      const skillsDir = path.join(tmpDir, '.claude', 'skills');
      const entriesBefore = await fs.readdir(skillsDir);
      const cometEntries = entriesBefore.filter((e) => e.startsWith('comet'));
      expect(cometEntries.length).toBeGreaterThan(0);

      const result = await removeCometSkillsForPlatform(tmpDir, claudePlatform, 'project');
      expect(result.removed).toBeGreaterThan(0);

      for (const entry of cometEntries) {
        expect(await fileExists(path.join(skillsDir, entry))).toBe(false);
      }
    });

    it('handles already-removed skills gracefully', async () => {
      const result = await removeCometSkillsForPlatform(tmpDir, claudePlatform, 'project');
      expect(result.removed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('removes OpenCode commands', async () => {
      const opencodePlatform: Platform = PLATFORMS.find((p) => p.id === 'opencode')!;

      await copyCometSkillsForPlatform(tmpDir, opencodePlatform, true, 'skills', 'project');

      const commandsDir = path.join(tmpDir, '.opencode', 'commands');
      expect(await fileExists(commandsDir)).toBe(true);

      const result = await removeCometSkillsForPlatform(tmpDir, opencodePlatform, 'project');
      expect(result.removed).toBeGreaterThan(0);
    });

    it('removes only the managed Pi extension and preserves shared settings', async () => {
      const piPlatform: Platform = PLATFORMS.find((p) => p.id === 'pi')!;
      const extensionsDir = path.join(tmpDir, '.pi', 'extensions');
      const cometExtension = path.join(extensionsDir, 'comet-commands.ts');
      const unrelatedExtension = path.join(extensionsDir, 'custom.ts');
      const settingsPath = path.join(tmpDir, '.pi', 'settings.json');

      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(settingsPath, JSON.stringify({ theme: 'dark' }), 'utf-8');
      await copyCometSkillsForPlatform(tmpDir, piPlatform, true, 'skills', 'project');
      await fs.writeFile(unrelatedExtension, 'export default function custom() {}', 'utf-8');

      const result = await removeCometSkillsForPlatform(tmpDir, piPlatform, 'project');
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));

      expect(result.removed).toBeGreaterThan(0);
      expect(await fileExists(cometExtension)).toBe(false);
      expect(await fileExists(unrelatedExtension)).toBe(true);
      expect(settings).toEqual({ theme: 'dark', enableSkillCommands: true });
    });

    it('removes Comet skills from the legacy global Pi directory', async () => {
      const piPlatform: Platform = PLATFORMS.find((p) => p.id === 'pi')!;
      const legacySkill = path.join(tmpDir, '.pi', 'skills', 'comet', 'SKILL.md');

      await fs.mkdir(path.dirname(legacySkill), { recursive: true });
      await fs.writeFile(legacySkill, '# Comet', 'utf-8');

      const result = await removeCometSkillsForPlatform(tmpDir, piPlatform, 'global');

      expect(result.removed).toBe(1);
      expect(await fileExists(legacySkill)).toBe(false);
    });
  });

  describe('removeCometRulesForPlatform', () => {
    it('removes rules for a platform that supports them', async () => {
      const claudePlatform: Platform = PLATFORMS.find((p) => p.id === 'claude')!;

      await copyCometRulesForPlatform(tmpDir, claudePlatform, true, 'zh', 'project');

      const rulePath = path.join(tmpDir, '.claude', 'rules', 'comet-workflow-guard.md');
      expect(await fileExists(rulePath)).toBe(true);

      const result = await removeCometRulesForPlatform(tmpDir, claudePlatform, 'project');
      expect(result.removed).toBeGreaterThan(0);
      expect(await fileExists(rulePath)).toBe(false);
    });

    it('removes Cursor MDC format rules', async () => {
      const cursorPlatform: Platform = PLATFORMS.find((p) => p.id === 'cursor')!;

      await copyCometRulesForPlatform(tmpDir, cursorPlatform, true, 'zh', 'project');

      const rulePath = path.join(tmpDir, '.cursor', 'rules', 'comet-workflow-guard.mdc');
      expect(await fileExists(rulePath)).toBe(true);

      const result = await removeCometRulesForPlatform(tmpDir, cursorPlatform, 'project');
      expect(result.removed).toBeGreaterThan(0);
      expect(await fileExists(rulePath)).toBe(false);
    });

    it('removes GitHub Copilot instructions format', async () => {
      const copilotPlatform: Platform = PLATFORMS.find((p) => p.id === 'github-copilot')!;

      await copyCometRulesForPlatform(tmpDir, copilotPlatform, true, 'zh', 'project');

      const rulePath = path.join(
        tmpDir,
        '.github',
        'instructions',
        'comet-workflow-guard.instructions.md',
      );
      expect(await fileExists(rulePath)).toBe(true);

      const result = await removeCometRulesForPlatform(tmpDir, copilotPlatform, 'project');
      expect(result.removed).toBeGreaterThan(0);
      expect(await fileExists(rulePath)).toBe(false);
    });

    it('skips platforms without rules support', async () => {
      const geminiPlatform: Platform = PLATFORMS.find((p) => p.id === 'gemini')!;
      const result = await removeCometRulesForPlatform(tmpDir, geminiPlatform, 'project');
      expect(result.removed).toBe(0);
    });

    it('counts a Rule-directory inspection permission failure without deleting user Rules', async () => {
      const claudePlatform: Platform = PLATFORMS.find((p) => p.id === 'claude')!;
      const rulesDir = path.join(tmpDir, '.claude', 'rules');
      const userRule = path.join(rulesDir, 'personal.md');
      await fs.mkdir(rulesDir, { recursive: true });
      await fs.writeFile(userRule, '# Personal Rule\n');
      const readdir = fs.readdir.bind(fs);
      const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      const readdirSpy = vi.spyOn(fs, 'readdir').mockImplementation(async (dirPath, options) => {
        if (path.resolve(String(dirPath)) === path.resolve(rulesDir)) throw permissionError;
        return readdir(dirPath, options as never);
      });

      try {
        await expect(
          removeCometRulesForPlatform(tmpDir, claudePlatform, 'project'),
        ).resolves.toEqual({ removed: 0, failed: 1 });
      } finally {
        readdirSpy.mockRestore();
      }

      await expect(fs.readFile(userRule, 'utf8')).resolves.toBe('# Personal Rule\n');
    });
  });

  describe('removeCometHooksForPlatform', () => {
    it('removes Codex hooks from canonical and historical files while preserving user config', async () => {
      const codex = PLATFORMS.find((platform) => platform.id === 'codex')!;
      const canonicalPath = path.join(tmpDir, '.codex', 'hooks.json');
      const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
      const userHandler = { type: 'command', command: 'node my-user-hook.mjs' };

      await installCometHooksForPlatform(tmpDir, codex, 'project');
      const canonical = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
      const cometHandler = canonical.hooks.PreToolUse[0].hooks[0];
      canonical.hooks.PreToolUse[0].hooks.push(userHandler);
      await fs.writeFile(canonicalPath, JSON.stringify(canonical, null, 2), 'utf8');
      await fs.writeFile(
        legacyPath,
        JSON.stringify(
          {
            model: 'gpt-5',
            hooks: {
              PreToolUse: [{ matcher: 'Write|Edit', hooks: [cometHandler, userHandler] }],
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      const result = await removeCometHooksForPlatform(tmpDir, codex, 'project');

      expect(result).toEqual({ removed: 2, failed: 0 });
      const cleanedCanonical = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
      expect(cleanedCanonical.hooks.PreToolUse[0].hooks).toEqual([userHandler]);
      const cleanedLegacy = JSON.parse(await fs.readFile(legacyPath, 'utf8'));
      expect(cleanedLegacy.model).toBe('gpt-5');
      expect(cleanedLegacy.hooks.PreToolUse[0].hooks).toEqual([userHandler]);
    });

    it('removes quoted Codex hook commands whose script path contains spaces', async () => {
      const codex = PLATFORMS.find((platform) => platform.id === 'codex')!;
      const canonicalPath = path.join(tmpDir, '.codex', 'hooks.json');
      const managedPath = 'C:/Users/Jane Doe/.agents/skills/comet/scripts/comet-hook-guard.mjs';
      await fs.mkdir(path.dirname(canonicalPath), { recursive: true });
      await fs.writeFile(
        canonicalPath,
        JSON.stringify(
          {
            hooks: {
              PreToolUse: [
                {
                  matcher: 'Write|Edit',
                  hooks: [
                    {
                      type: 'command',
                      command: `node "${managedPath}" --project-root "C:/Users/Jane Doe"`,
                    },
                  ],
                },
              ],
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      await expect(removeCometHooksForPlatform(tmpDir, codex, 'project')).resolves.toEqual({
        removed: 1,
        failed: 0,
      });
      const cleaned = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
      expect(cleaned.hooks.PreToolUse[0].hooks).toEqual([]);
    });

    it('continues Codex cleanup across files and counts only canonical write failures', async () => {
      const codex = {
        ...PLATFORMS.find((platform) => platform.id === 'codex')!,
        legacyHookConfigFiles: ['settings.local.json', 'settings.backup.json'],
      };
      const canonicalPath = path.join(tmpDir, '.codex', 'hooks.json');
      const legacyPath = path.join(tmpDir, '.codex', 'settings.local.json');
      const backupPath = path.join(tmpDir, '.codex', 'settings.backup.json');
      const userHandler = { type: 'command', command: 'node my-user-hook.mjs' };

      await installCometHooksForPlatform(tmpDir, codex, 'project');
      const canonical = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
      const cometHandler = canonical.hooks.PreToolUse[0].hooks[0];
      canonical.hooks.PreToolUse[0].hooks.push(userHandler);
      await fs.writeFile(canonicalPath, JSON.stringify(canonical, null, 2), 'utf8');
      await fs.writeFile(
        legacyPath,
        JSON.stringify(
          {
            hooks: {
              PreToolUse: [{ matcher: 'Write|Edit', hooks: [cometHandler, userHandler] }],
            },
          },
          null,
          2,
        ),
        'utf8',
      );
      await fs.copyFile(legacyPath, backupPath);
      writeFileMock
        .mockRejectedValueOnce(new Error('simulated canonical write failure'))
        .mockImplementationOnce(fs.writeFile)
        .mockRejectedValueOnce(new Error('simulated backup write failure'));

      const result = await removeCometHooksForPlatform(tmpDir, codex, 'project');

      expect(result).toEqual({ removed: 1, failed: 1 });
      const unchangedCanonical = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
      expect(unchangedCanonical.hooks.PreToolUse[0].hooks).toEqual([cometHandler, userHandler]);
      const cleanedLegacy = JSON.parse(await fs.readFile(legacyPath, 'utf8'));
      expect(cleanedLegacy.hooks.PreToolUse[0].hooks).toEqual([userHandler]);
      const unchangedBackup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
      expect(unchangedBackup.hooks.PreToolUse[0].hooks).toEqual([cometHandler, userHandler]);
    });

    it('removes Claude Code hooks while preserving non-Comet hooks', async () => {
      const claudePlatform: Platform = PLATFORMS.find((p) => p.id === 'claude')!;

      const settingsDir = path.join(tmpDir, '.claude');
      await fs.mkdir(settingsDir, { recursive: true });
      const settingsPath = path.join(settingsDir, 'settings.local.json');
      const settings = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [
                {
                  type: 'command',
                  command: 'bash .claude/skills/comet/scripts/comet-hook-guard.sh',
                },
                { type: 'command', command: 'bash my-custom-hook.sh' },
              ],
            },
          ],
        },
      };
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

      await installCometHooksForPlatform(tmpDir, claudePlatform, 'project');

      const result = await removeCometHooksForPlatform(tmpDir, claudePlatform, 'project');
      expect(result.removed).toBeGreaterThan(0);

      const updatedContent = await fs.readFile(settingsPath, 'utf-8');
      const updated = JSON.parse(updatedContent);
      expect(updated.hooks.PreToolUse).toBeDefined();
      expect(updated.hooks.PreToolUse.length).toBeGreaterThan(0);

      const allCommands = updated.hooks.PreToolUse.flatMap((g: Record<string, unknown>) =>
        (g.hooks as Array<Record<string, unknown>>).map((h: Record<string, unknown>) => h.command),
      );
      expect(allCommands).toContain('bash my-custom-hook.sh');
      expect(allCommands.some((c: string) => c.includes('comet-hook-guard'))).toBe(false);
    });

    it('removes CodeBuddy hooks while preserving user settings and hooks', async () => {
      const codebuddyPlatform: Platform = PLATFORMS.find((p) => p.id === 'codebuddy')!;
      const settingsDir = path.join(tmpDir, '.codebuddy');
      const settingsPath = path.join(settingsDir, 'settings.json');
      const settings = {
        enabledPlugins: { 'user-plugin@example': true },
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [{ type: 'command', command: 'node user-hook.mjs' }],
            },
          ],
        },
      };
      await fs.mkdir(settingsDir, { recursive: true });
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

      await installCometHooksForPlatform(tmpDir, codebuddyPlatform, 'project');
      const result = await removeCometHooksForPlatform(tmpDir, codebuddyPlatform, 'project');

      expect(result.removed).toBeGreaterThan(0);
      const updated = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
      expect(updated.enabledPlugins).toEqual(settings.enabledPlugins);
      expect(updated.hooks.PreToolUse).toEqual(settings.hooks.PreToolUse);
    });

    it('removes Copilot hook file', async () => {
      const copilotPlatform: Platform = PLATFORMS.find((p) => p.id === 'github-copilot')!;

      const hooksDir = path.join(tmpDir, '.github', 'hooks');
      await fs.mkdir(hooksDir, { recursive: true });
      const hookFilePath = path.join(hooksDir, 'comet-guard.json');
      await fs.writeFile(hookFilePath, JSON.stringify({ version: 1 }), 'utf-8');

      expect(await fileExists(hookFilePath)).toBe(true);

      const result = await removeCometHooksForPlatform(tmpDir, copilotPlatform, 'project');
      expect(result.removed).toBe(1);
      expect(await fileExists(hookFilePath)).toBe(false);
    });

    it('removes Kiro hook files', async () => {
      const kiroPlatform: Platform = PLATFORMS.find((p) => p.id === 'kiro')!;

      const hooksDir = path.join(tmpDir, '.kiro', 'hooks');
      await fs.mkdir(hooksDir, { recursive: true });
      const hookFilePath = path.join(hooksDir, 'comet-hook-guard.kiro.hook');
      await fs.writeFile(hookFilePath, JSON.stringify({ enabled: true }), 'utf-8');

      expect(await fileExists(hookFilePath)).toBe(true);

      const result = await removeCometHooksForPlatform(tmpDir, kiroPlatform, 'project');
      expect(result.removed).toBe(1);
      expect(await fileExists(hookFilePath)).toBe(false);
    });

    it('skips platforms without hooks support', async () => {
      const cursorPlatform: Platform = PLATFORMS.find((p) => p.id === 'cursor')!;
      const result = await removeCometHooksForPlatform(tmpDir, cursorPlatform, 'project');
      expect(result.removed).toBe(0);
    });

    it('preserves empty hook groups after removal', async () => {
      const claudePlatform: Platform = PLATFORMS.find((p) => p.id === 'claude')!;
      const settingsDir = path.join(tmpDir, '.claude');
      await fs.mkdir(settingsDir, { recursive: true });
      const settingsPath = path.join(settingsDir, 'settings.local.json');

      const settings = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [
                {
                  type: 'command',
                  command: 'bash .claude/skills/comet/scripts/comet-hook-guard.sh',
                },
              ],
            },
          ],
        },
      };
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

      const result = await removeCometHooksForPlatform(tmpDir, claudePlatform, 'project');
      expect(result.removed).toBe(1);

      const updatedContent = await fs.readFile(settingsPath, 'utf-8');
      const updated = JSON.parse(updatedContent);
      expect(updated.hooks.PreToolUse).toEqual([{ matcher: 'Write|Edit', hooks: [] }]);
    });
  });

  describe('removeWorkingDirs', () => {
    it('removes .comet directory', async () => {
      const cometDir = path.join(tmpDir, '.comet');
      await fs.mkdir(cometDir, { recursive: true });
      await fs.writeFile(path.join(cometDir, 'config.yaml'), 'test: true', 'utf-8');

      const result = await removeWorkingDirs(tmpDir);
      expect(result.removed).toBeGreaterThan(0);
      expect(await fileExists(cometDir)).toBe(false);
    });

    it('removes empty docs/superpowers directories', async () => {
      const specsDir = path.join(tmpDir, 'docs', 'superpowers', 'specs');
      const plansDir = path.join(tmpDir, 'docs', 'superpowers', 'plans');
      await fs.mkdir(specsDir, { recursive: true });
      await fs.mkdir(plansDir, { recursive: true });

      await removeWorkingDirs(tmpDir);

      expect(await fileExists(path.join(tmpDir, 'docs'))).toBe(false);
    });

    it('preserves non-empty docs directories', async () => {
      const specsDir = path.join(tmpDir, 'docs', 'superpowers', 'specs');
      await fs.mkdir(specsDir, { recursive: true });
      await fs.writeFile(path.join(specsDir, 'important.md'), 'keep me', 'utf-8');

      await removeWorkingDirs(tmpDir);

      expect(await fileExists(path.join(tmpDir, 'docs'))).toBe(true);
      expect(await fileExists(path.join(specsDir, 'important.md'))).toBe(true);
    });
  });

  describe('full uninstall cycle', () => {
    it('installs and then completely removes Comet for Claude Code', async () => {
      const claudePlatform: Platform = PLATFORMS.find((p) => p.id === 'claude')!;

      // Install everything
      await copyCometSkillsForPlatform(tmpDir, claudePlatform, true, 'skills', 'project');
      await copyCometRulesForPlatform(tmpDir, claudePlatform, true, 'zh', 'project');
      await installCometHooksForPlatform(tmpDir, claudePlatform, 'project');

      // Verify installation
      const skillsDir = path.join(tmpDir, '.claude', 'skills');
      const skillEntries = (await fs.readdir(skillsDir)).filter((e) => e.startsWith('comet'));
      expect(skillEntries.length).toBeGreaterThan(0);

      const rulePath = path.join(tmpDir, '.claude', 'rules', 'comet-workflow-guard.md');
      expect(await fileExists(rulePath)).toBe(true);

      // Uninstall everything
      const skillsResult = await removeCometSkillsForPlatform(tmpDir, claudePlatform, 'project');
      expect(skillsResult.removed).toBeGreaterThan(0);

      const rulesResult = await removeCometRulesForPlatform(tmpDir, claudePlatform, 'project');
      expect(rulesResult.removed).toBeGreaterThan(0);

      const hooksResult = await removeCometHooksForPlatform(tmpDir, claudePlatform, 'project');
      expect(hooksResult.removed).toBeGreaterThan(0);

      // Verify complete removal
      for (const entry of skillEntries) {
        expect(await fileExists(path.join(skillsDir, entry))).toBe(false);
      }
      expect(await fileExists(rulePath)).toBe(false);
    });
  });
});

// --- uninstallCommand interactive selection tests ---

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn().mockResolvedValue(true),
  checkbox: vi.fn().mockResolvedValue([]),
}));

import { select, checkbox } from '@inquirer/prompts';
import { uninstallCommand } from '../../app/commands/uninstall.js';

const mockedSelect = vi.mocked(select);
const mockedCheckbox = vi.mocked(checkbox);

describe('uninstallCommand interactive selection', () => {
  let tmpDir: string;

  let homedirSpy: MockInstance<typeof os.homedir>;

  beforeEach(async () => {
    mockedSelect.mockReset();
    mockedCheckbox.mockReset();
    mockedSelect.mockResolvedValue(true as never);
    tmpDir = path.join(
      os.tmpdir(),
      `comet-uninstall-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

  it('uninstalls an explicitly scoped canonical global Codex install without a detection path', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home');
    const codexPlatform = PLATFORMS.find((platform) => platform.id === 'codex')!;
    await copyCometSkillsForPlatform(fakeHome, codexPlatform, true, 'skills', 'global');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let jsonOutput: string;
    try {
      await uninstallCommand(tmpDir, { scope: 'global', force: true, json: true });
      jsonOutput = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(JSON.parse(jsonOutput).targets).toEqual([
      expect.objectContaining({ scope: 'global', platform: 'codex' }),
    ]);
    await expect(
      fs.access(path.join(fakeHome, '.agents', 'skills', 'comet')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not apply project registry recovery targets to an explicit global uninstall', async () => {
    const fakeHome = path.join(tmpDir, 'global-scope-recovery-home');
    const opencode = PLATFORMS.find((platform) => platform.id === 'opencode')!;
    const commandPath = path.join(tmpDir, '.opencode', 'commands', 'comet.md');
    await copyCometSkillsForPlatform(tmpDir, opencode, true, 'skills', 'project');
    await fs.rm(path.join(tmpDir, '.opencode', 'skills'), { recursive: true, force: true });
    await upsertProjectInstallation(tmpDir, [{ platform: 'opencode', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await uninstallCommand(tmpDir, { scope: 'global', force: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.targets).toEqual([]);
    } finally {
      log.mockRestore();
    }

    await expect(fs.access(commandPath)).resolves.toBeUndefined();
    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8')) as {
      projects: unknown[];
    };
    expect(registry.projects).toHaveLength(1);
  });

  it('does not auto-detect Codex from a shared canonical global Skill root', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home');
    const codexPlatform = PLATFORMS.find((platform) => platform.id === 'codex')!;
    await copyCometSkillsForPlatform(fakeHome, codexPlatform, true, 'skills', 'global');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir, { force: true, json: true });
    } finally {
      log.mockRestore();
    }

    await expect(
      fs.access(path.join(fakeHome, '.agents', 'skills', 'comet')),
    ).resolves.toBeUndefined();
  });

  it('uninstalls all indexed projects with --all-projects --force --json', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home-all-uninstall');
    const projectA = path.join(tmpDir, 'project-a');
    const projectB = path.join(tmpDir, 'project-b');
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;

    for (const project of [projectA, projectB]) {
      await copyCometSkillsForPlatform(project, claudePlatform, true, 'skills', 'project');
      await upsertProjectInstallation(project, [{ platform: 'claude', language: 'en' }], 'init', {
        homeDir: fakeHome,
      });
    }

    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let jsonOutput: string;
    try {
      await uninstallCommand(projectA, { allProjects: true, force: true, json: true });
      jsonOutput = log.mock.calls.map((c) => c.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    const result = JSON.parse(jsonOutput);
    expect(result.mode).toBe('all-projects');
    expect(
      result.projects.every((project: { status: string }) => project.status === 'uninstalled'),
    ).toBe(true);
    await expect(
      fs.access(path.join(projectA, '.claude', 'skills', 'comet')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      fs.access(path.join(projectB, '.claude', 'skills', 'comet')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf-8'));
    expect(registry.projects).toEqual([]);
  });

  it('removes Hook then Rule but keeps the Skill retry anchor when canonical Hook cleanup fails', async () => {
    const fakeHome = path.join(tmpDir, 'hook-failure-home');
    const codex = PLATFORMS.find((platform) => platform.id === 'codex')!;
    await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
    await copyCometSkillsForPlatform(tmpDir, codex, true, 'skills', 'project');
    await copyCometRulesForPlatform(tmpDir, codex, true, 'en', 'project');
    await fs.writeFile(path.join(tmpDir, '.codex', 'hooks.json'), '[]\n', 'utf8');
    await upsertProjectInstallation(tmpDir, [{ platform: 'codex', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir, { force: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.targets[0]).toMatchObject({
        platform: 'codex',
        hooksFailed: 1,
        rulesRemoved: 1,
        skillsRemoved: 0,
      });
      expect(result.summary.totalFailures).toBeGreaterThan(0);
    } finally {
      log.mockRestore();
    }

    await expect(
      fs.access(path.join(tmpDir, '.agents', 'skills', 'comet', 'SKILL.md')),
    ).resolves.toBeUndefined();
  });

  it('keeps the Skill retry anchor when canonical Rule cleanup fails after Hook removal', async () => {
    const fakeHome = path.join(tmpDir, 'rule-failure-home');
    const codex = PLATFORMS.find((platform) => platform.id === 'codex')!;
    await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
    await copyCometSkillsForPlatform(tmpDir, codex, true, 'skills', 'project');
    await copyCometRulesForPlatform(tmpDir, codex, true, 'en', 'project');
    await installCometHooksForPlatform(tmpDir, codex, 'project');
    const rulePath = path.join(tmpDir, '.codex', 'rules', 'comet-phase-guard.md');
    const unlink = fs.unlink.bind(fs);
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const unlinkSpy = vi.spyOn(fs, 'unlink').mockImplementation(async (filePath) => {
      if (path.resolve(String(filePath)) === path.resolve(rulePath)) throw permissionError;
      await unlink(filePath);
    });
    await upsertProjectInstallation(tmpDir, [{ platform: 'codex', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir, { force: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.targets[0]).toMatchObject({
        platform: 'codex',
        hooksRemoved: 1,
        rulesFailed: 1,
        skillsRemoved: 0,
      });
    } finally {
      unlinkSpy.mockRestore();
      log.mockRestore();
    }

    await expect(
      fs.access(path.join(tmpDir, '.agents', 'skills', 'comet', 'SKILL.md')),
    ).resolves.toBeUndefined();
  });

  it('counts working-directory cleanup failure and keeps the project registry entry', async () => {
    const fakeHome = path.join(tmpDir, 'working-dir-failure-home');
    const claude = PLATFORMS.find((platform) => platform.id === 'claude')!;
    await copyCometSkillsForPlatform(tmpDir, claude, true, 'skills', 'project');
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.comet', 'state'), 'keep\n', 'utf8');
    await upsertProjectInstallation(tmpDir, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const rm = fs.rm.bind(fs);
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const rmSpy = vi.spyOn(fs, 'rm').mockImplementation(async (targetPath, options) => {
      if (path.resolve(String(targetPath)) === path.resolve(path.join(tmpDir, '.comet'))) {
        throw permissionError;
      }
      await rm(targetPath, options);
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir, { force: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.summary.totalFailures).toBe(1);
    } finally {
      rmSpy.mockRestore();
      log.mockRestore();
    }

    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8')) as {
      projects: unknown[];
    };
    expect(registry.projects).toHaveLength(1);
    await expect(fs.readFile(path.join(tmpDir, '.comet', 'state'), 'utf8')).resolves.toBe('keep\n');
  });

  it('retries registered project cleanup after the Skill target was removed on the first attempt', async () => {
    const fakeHome = path.join(tmpDir, 'working-dir-retry-home');
    const claude = PLATFORMS.find((platform) => platform.id === 'claude')!;
    await copyCometSkillsForPlatform(tmpDir, claude, true, 'skills', 'project');
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.comet', 'state'), 'retry\n', 'utf8');
    await upsertProjectInstallation(tmpDir, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const rm = fs.rm.bind(fs);
    let cometRemovalAttempts = 0;
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const rmSpy = vi.spyOn(fs, 'rm').mockImplementation(async (targetPath, options) => {
      if (path.resolve(String(targetPath)) === path.resolve(path.join(tmpDir, '.comet'))) {
        cometRemovalAttempts++;
        if (cometRemovalAttempts === 1) throw permissionError;
      }
      await rm(targetPath, options);
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await uninstallCommand(tmpDir, { force: true, json: true });
      const firstResult = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(firstResult.summary.totalFailures).toBe(1);
      const retainedRegistry = JSON.parse(
        await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8'),
      ) as { projects: unknown[] };
      expect(retainedRegistry.projects).toHaveLength(1);
      log.mockClear();
      await uninstallCommand(tmpDir, { force: true, json: true });
      const retryResult = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(retryResult.summary).toMatchObject({ targetsProcessed: 1, totalFailures: 0 });
      expect(retryResult.workingDirsRemoved).toBe(1);
    } finally {
      log.mockRestore();
      rmSpy.mockRestore();
    }

    expect(cometRemovalAttempts).toBe(2);
    await expect(fs.access(path.join(tmpDir, '.comet'))).rejects.toMatchObject({ code: 'ENOENT' });
    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8')) as {
      projects: unknown[];
    };
    expect(registry.projects).toEqual([]);
  });

  it('matches a registered current project through its canonical symlink identity', async () => {
    const fakeHome = path.join(tmpDir, 'canonical-recovery-home');
    const realProject = path.join(tmpDir, 'canonical-real-project');
    const projectAlias = path.join(tmpDir, 'canonical-project-alias');
    await fs.mkdir(path.join(realProject, '.comet'), { recursive: true });
    await fs.writeFile(path.join(realProject, '.comet', 'state'), 'recover\n', 'utf8');
    await fs.symlink(realProject, projectAlias, process.platform === 'win32' ? 'junction' : 'dir');
    await upsertProjectInstallation(realProject, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await uninstallCommand(projectAlias, { currentProject: true, force: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.summary).toMatchObject({ targetsProcessed: 1, totalFailures: 0 });
      expect(result.workingDirsRemoved).toBe(1);
    } finally {
      log.mockRestore();
    }

    await expect(fs.access(path.join(realProject, '.comet'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8')) as {
      projects: unknown[];
    };
    expect(registry.projects).toEqual([]);
  });

  it('uses registry lastTargets to retry an OpenCode command cleanup for current-project', async () => {
    const fakeHome = path.join(tmpDir, 'opencode-recovery-home');
    const opencode = PLATFORMS.find((platform) => platform.id === 'opencode')!;
    const commandPath = path.join(tmpDir, '.opencode', 'commands', 'comet.md');
    await copyCometSkillsForPlatform(tmpDir, opencode, true, 'skills', 'project');
    await upsertProjectInstallation(tmpDir, [{ platform: 'opencode', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const unlink = fs.unlink.bind(fs);
    let commandAttempts = 0;
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const unlinkSpy = vi.spyOn(fs, 'unlink').mockImplementation(async (targetPath) => {
      if (path.resolve(String(targetPath)) === path.resolve(commandPath)) {
        commandAttempts++;
        if (commandAttempts === 1) throw permissionError;
      }
      await unlink(targetPath);
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await uninstallCommand(tmpDir, { currentProject: true, force: true, json: true });
      const first = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(first.summary.totalFailures).toBe(1);
      await expect(fs.access(commandPath)).resolves.toBeUndefined();
      log.mockClear();

      await uninstallCommand(tmpDir, { currentProject: true, force: true, json: true });
      const second = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(second.summary).toMatchObject({ targetsProcessed: 1, totalFailures: 0 });
    } finally {
      log.mockRestore();
      unlinkSpy.mockRestore();
    }

    expect(commandAttempts).toBe(2);
    await expect(fs.access(commandPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8')) as {
      projects: unknown[];
    };
    expect(registry.projects).toEqual([]);
  });

  it('merges detected targets with registry recovery targets before retrying cleanup', async () => {
    const fakeHome = path.join(tmpDir, 'detected-recovery-union-home');
    const opencode = PLATFORMS.find((platform) => platform.id === 'opencode')!;
    const claude = PLATFORMS.find((platform) => platform.id === 'claude')!;
    const commandPath = path.join(tmpDir, '.opencode', 'commands', 'comet.md');
    const claudeSkillPath = path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md');
    await copyCometSkillsForPlatform(tmpDir, opencode, true, 'skills', 'project');
    await copyCometSkillsForPlatform(tmpDir, claude, true, 'skills', 'project');
    await upsertProjectInstallation(
      tmpDir,
      [
        { platform: 'opencode', language: 'en' },
        { platform: 'claude', language: 'en' },
      ],
      'init',
      { homeDir: fakeHome },
    );
    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    mockedCheckbox.mockResolvedValue(['opencode:project'] as never);
    const unlink = fs.unlink.bind(fs);
    let commandAttempts = 0;
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const unlinkSpy = vi.spyOn(fs, 'unlink').mockImplementation(async (targetPath) => {
      if (path.resolve(String(targetPath)) === path.resolve(commandPath)) {
        commandAttempts++;
        if (commandAttempts === 1) throw permissionError;
      }
      await unlink(targetPath);
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await uninstallCommand(tmpDir);
      expect(commandAttempts).toBe(1);
      await expect(fs.access(commandPath)).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(tmpDir, '.opencode', 'skills', 'comet')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.access(claudeSkillPath)).resolves.toBeUndefined();
      const retainedRegistry = JSON.parse(
        await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8'),
      ) as { projects: unknown[] };
      expect(retainedRegistry.projects).toHaveLength(1);
      log.mockClear();

      await uninstallCommand(tmpDir, { currentProject: true, force: true, json: true });
      const retry = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(retry.summary).toMatchObject({ targetsProcessed: 2, totalFailures: 0 });
      expect(
        retry.targets.map((target: { scope: string; platform: string }) => ({
          scope: target.scope,
          platform: target.platform,
        })),
      ).toEqual([
        { scope: 'project', platform: 'claude' },
        { scope: 'project', platform: 'opencode' },
      ]);
    } finally {
      log.mockRestore();
      unlinkSpy.mockRestore();
    }

    expect(commandAttempts).toBe(2);
    await expect(fs.access(commandPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8')) as {
      projects: unknown[];
    };
    expect(registry.projects).toEqual([]);
  });

  it('keeps detected global and recovered project targets separate for the same platform', async () => {
    const fakeHome = path.join(tmpDir, 'detected-global-recovery-project-home');
    const opencode = PLATFORMS.find((platform) => platform.id === 'opencode')!;
    const projectCommandPath = path.join(tmpDir, '.opencode', 'commands', 'comet.md');
    await copyCometSkillsForPlatform(tmpDir, opencode, true, 'skills', 'project');
    await fs.rm(path.join(tmpDir, '.opencode', 'skills'), { recursive: true, force: true });
    await copyCometSkillsForPlatform(fakeHome, opencode, true, 'skills', 'global');
    await upsertProjectInstallation(tmpDir, [{ platform: 'opencode', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await uninstallCommand(tmpDir, { currentProject: true, force: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.summary).toMatchObject({ targetsProcessed: 2, totalFailures: 0 });
      expect(
        result.targets.map((target: { scope: string; platform: string }) => ({
          scope: target.scope,
          platform: target.platform,
        })),
      ).toEqual([
        { scope: 'global', platform: 'opencode' },
        { scope: 'project', platform: 'opencode' },
      ]);
    } finally {
      log.mockRestore();
    }

    await expect(fs.access(projectCommandPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.access(path.join(fakeHome, '.opencode', 'skills', 'comet')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8')) as {
      projects: unknown[];
    };
    expect(registry.projects).toEqual([]);
  });

  it('runs follow-on cleanup for an all-projects registry entry with no remaining Skill target', async () => {
    const fakeHome = path.join(tmpDir, 'all-projects-stale-home');
    const project = path.join(tmpDir, 'all-projects-stale-project');
    await fs.mkdir(path.join(project, '.comet'), { recursive: true });
    await fs.writeFile(path.join(project, '.comet', 'state'), 'stale\n', 'utf8');
    await fs.writeFile(
      path.join(project, 'AGENTS.md'),
      '<comet-ambient-resume>\nmanaged\n</comet-ambient-resume>\n',
      'utf8',
    );
    await upsertProjectInstallation(project, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await uninstallCommand(project, { allProjects: true, force: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.projects[0]).toMatchObject({
        projectPath: path.resolve(project),
        status: 'uninstalled',
        workingDirsRemoved: 1,
        projectInstructionsRemoved: 1,
      });
    } finally {
      log.mockRestore();
    }

    await expect(fs.access(path.join(project, '.comet'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(project, 'AGENTS.md'), 'utf8')).resolves.not.toContain(
      'comet-ambient-resume',
    );
    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8')) as {
      projects: unknown[];
    };
    expect(registry.projects).toEqual([]);
  });

  it('uses registry lastTargets to retry a Pi extension cleanup for all-projects', async () => {
    const fakeHome = path.join(tmpDir, 'pi-all-projects-recovery-home');
    const project = path.join(tmpDir, 'pi-all-projects-recovery-project');
    const pi = PLATFORMS.find((platform) => platform.id === 'pi')!;
    const extensionPath = path.join(project, '.pi', 'extensions', 'comet-commands.ts');
    await copyCometSkillsForPlatform(project, pi, true, 'skills', 'project');
    await upsertProjectInstallation(project, [{ platform: 'pi', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const unlink = fs.unlink.bind(fs);
    let extensionAttempts = 0;
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const unlinkSpy = vi.spyOn(fs, 'unlink').mockImplementation(async (targetPath) => {
      if (path.resolve(String(targetPath)) === path.resolve(extensionPath)) {
        extensionAttempts++;
        if (extensionAttempts === 1) throw permissionError;
      }
      await unlink(targetPath);
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await uninstallCommand(project, { allProjects: true, force: true, json: true });
      const first = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(first.projects[0].status).toBe('failed');
      await expect(fs.access(extensionPath)).resolves.toBeUndefined();
      log.mockClear();

      await uninstallCommand(project, { allProjects: true, force: true, json: true });
      const second = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(second.projects[0]).toMatchObject({
        status: 'uninstalled',
        summary: { targetsProcessed: 1, totalFailures: 0 },
      });
    } finally {
      log.mockRestore();
      unlinkSpy.mockRestore();
    }

    expect(extensionAttempts).toBe(2);
    await expect(fs.access(extensionPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8')) as {
      projects: unknown[];
    };
    expect(registry.projects).toEqual([]);
  });

  it.each([true, false])(
    'reports canonical Codex cleanup refusal and preserves project state in %s output',
    async (json) => {
      const fakeHome = path.join(tmpDir, `failure-home-${json}`);
      const sharedSkills = path.join(tmpDir, `failure-shared-skills-${json}`);
      await fs.mkdir(path.join(sharedSkills, 'comet'), { recursive: true });
      await fs.writeFile(path.join(sharedSkills, 'comet', 'SKILL.md'), '# Comet\n');
      await fs.mkdir(path.join(tmpDir, '.agents'), { recursive: true });
      await fs.symlink(
        sharedSkills,
        path.join(tmpDir, '.agents', 'skills'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await fs.mkdir(path.join(tmpDir, '.codex', 'rules'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, '.codex', 'rules', 'comet-phase-guard.md'), '# Rule\n');
      await fs.writeFile(
        path.join(tmpDir, 'AGENTS.md'),
        '<comet-ambient-resume>keep</comet-ambient-resume>\n',
      );
      await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, '.comet', 'state'), 'keep\n');
      await upsertProjectInstallation(tmpDir, [{ platform: 'codex', language: 'en' }], 'init', {
        homeDir: fakeHome,
      });
      homedirSpy.mockRestore();
      homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        await uninstallCommand(tmpDir, { force: true, json });
        const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
        if (json) {
          const result = JSON.parse(output);
          expect(result.targets[0].skillsFailed).toBeGreaterThan(0);
          expect(result.summary.totalFailures).toBeGreaterThan(0);
        } else {
          expect(output).toMatch(/incomplete|failed/iu);
        }
      } finally {
        log.mockRestore();
      }

      await expect(
        fs.access(path.join(tmpDir, '.codex', 'rules', 'comet-phase-guard.md')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8')).resolves.toContain(
        'comet-ambient-resume',
      );
      await expect(fs.readFile(path.join(tmpDir, '.comet', 'state'), 'utf8')).resolves.toBe(
        'keep\n',
      );
      const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8'));
      expect(registry.projects).toHaveLength(1);
    },
  );

  it('removes Rules before preserving a legacy-only Codex Skill root that refuses removal', async () => {
    const sharedSkills = path.join(tmpDir, 'legacy-only-shared-skills');
    await fs.mkdir(path.join(sharedSkills, 'comet'), { recursive: true });
    await fs.writeFile(path.join(sharedSkills, 'comet', 'SKILL.md'), '# Legacy Comet\n');
    await fs.mkdir(path.join(tmpDir, '.codex', 'rules'), { recursive: true });
    await fs.symlink(
      sharedSkills,
      path.join(tmpDir, '.codex', 'skills'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await fs.writeFile(
      path.join(tmpDir, '.codex', 'rules', 'comet-phase-guard.md'),
      '# Keep Rule\n',
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir, { force: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.targets[0]).toMatchObject({ platform: 'codex', skillsFailed: 1 });
      expect(result.summary.totalFailures).toBeGreaterThan(0);
    } finally {
      log.mockRestore();
    }
    await expect(
      fs.access(path.join(tmpDir, '.codex', 'rules', 'comet-phase-guard.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(path.join(tmpDir, '.codex', 'skills'))).resolves.toMatchObject({});
  });

  it('does not mark all-projects uninstall complete when canonical cleanup is refused', async () => {
    const fakeHome = path.join(tmpDir, 'all-projects-failure-home');
    const project = path.join(tmpDir, 'all-projects-failure-project');
    const sharedSkills = path.join(tmpDir, 'all-projects-failure-skills');
    await fs.mkdir(path.join(sharedSkills, 'comet'), { recursive: true });
    await fs.writeFile(path.join(sharedSkills, 'comet', 'SKILL.md'), '# Comet\n');
    await fs.mkdir(path.join(project, '.agents'), { recursive: true });
    await fs.symlink(
      sharedSkills,
      path.join(project, '.agents', 'skills'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await fs.mkdir(path.join(project, '.codex'), { recursive: true });
    await upsertProjectInstallation(project, [{ platform: 'codex', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(project, { allProjects: true, force: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.projects[0].status).toBe('failed');
      expect(result.projects[0].summary.totalFailures).toBeGreaterThan(0);
    } finally {
      log.mockRestore();
    }
    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8'));
    expect(registry.projects).toHaveLength(1);
  });

  it('rejects --all-projects with --scope global during uninstall', async () => {
    await expect(
      uninstallCommand(tmpDir, { allProjects: true, scope: 'global', json: true, force: true }),
    ).rejects.toThrow('--all-projects cannot be combined with --scope global');
  });

  it('keeps JSON uninstall current-project by default when registry has projects', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home-current-uninstall');
    const projectA = path.join(tmpDir, 'project-current-uninstall');
    const projectB = path.join(tmpDir, 'project-other-uninstall');
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;

    await copyCometSkillsForPlatform(projectA, claudePlatform, true, 'skills', 'project');
    await copyCometSkillsForPlatform(projectB, claudePlatform, true, 'skills', 'project');
    await upsertProjectInstallation(projectA, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
    await upsertProjectInstallation(projectB, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });

    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let jsonOutput: string;
    try {
      await uninstallCommand(projectA, { json: true, force: true });
      jsonOutput = log.mock.calls.map((c) => c.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    const result = JSON.parse(jsonOutput);
    expect(result.mode).toBeUndefined();
    expect(await fileExists(path.join(projectB, '.claude', 'skills', 'comet'))).toBe(true);
  });

  it('removes the current project from the registry after project-scope JSON uninstall', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home-current-uninstall-refresh');
    const projectA = path.join(tmpDir, 'project-current-uninstall-refresh');
    const projectB = path.join(tmpDir, 'project-other-uninstall-refresh');
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;

    await copyCometSkillsForPlatform(projectA, claudePlatform, true, 'skills', 'project');
    await copyCometSkillsForPlatform(projectB, claudePlatform, true, 'skills', 'project');
    await upsertProjectInstallation(projectA, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
    await upsertProjectInstallation(projectB, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });

    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(projectA, { json: true, force: true });
    } finally {
      log.mockRestore();
    }

    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf-8')) as {
      projects: Array<{ path: string }>;
    };
    expect(registry.projects.map((project) => project.path)).toEqual([path.resolve(projectB)]);
    expect(await fileExists(path.join(projectB, '.claude', 'skills', 'comet'))).toBe(true);
  });

  it('auto-selects single target and uninstalls on confirmation', async () => {
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;
    await copyCometSkillsForPlatform(tmpDir, claudePlatform, true, 'skills', 'project');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir, { force: false });
    } finally {
      log.mockRestore();
    }

    expect(mockedSelect).toHaveBeenCalled();
    expect(mockedCheckbox).not.toHaveBeenCalled();

    const skillsDir = path.join(tmpDir, '.claude', 'skills');
    const entries = (await fs.readdir(skillsDir)).filter((e) => e.startsWith('comet'));
    expect(entries.length).toBe(0);
  });

  it('cancels when single target user declines', async () => {
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;
    await copyCometSkillsForPlatform(tmpDir, claudePlatform, true, 'skills', 'project');

    mockedSelect.mockResolvedValue(false as never);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir, { force: false });
    } finally {
      log.mockRestore();
    }

    const skillsDir = path.join(tmpDir, '.claude', 'skills');
    const entries = (await fs.readdir(skillsDir)).filter((e) => e.startsWith('comet'));
    expect(entries.length).toBeGreaterThan(0);
  });

  it('shows checkbox when multiple targets detected', async () => {
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;
    await copyCometSkillsForPlatform(tmpDir, claudePlatform, true, 'skills', 'project');
    // Create a second current platform (Codex) fixture and its detection directory.
    const codexDir = path.join(tmpDir, '.agents', 'skills', 'comet');
    await fs.mkdir(codexDir, { recursive: true });
    await fs.mkdir(path.join(tmpDir, '.codex'), { recursive: true });
    await fs.writeFile(path.join(codexDir, 'SKILL.md'), '# Comet', 'utf-8');

    mockedCheckbox.mockResolvedValue(['claude:project'] as never);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir, { force: false });
    } finally {
      log.mockRestore();
    }

    expect(mockedCheckbox).toHaveBeenCalled();
    expect(mockedSelect).not.toHaveBeenCalled();

    // Claude should be uninstalled
    const claudeSkillsDir = path.join(tmpDir, '.claude', 'skills');
    const claudeEntries = (await fs.readdir(claudeSkillsDir)).filter((e) => e.startsWith('comet'));
    expect(claudeEntries.length).toBe(0);

    // Codex should remain
    expect(await fileExists(path.join(codexDir, 'SKILL.md'))).toBe(true);
  });

  it('skips prompt with --force and uninstalls all', async () => {
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;
    await copyCometSkillsForPlatform(tmpDir, claudePlatform, true, 'skills', 'project');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir, { force: true });
    } finally {
      log.mockRestore();
    }

    expect(mockedSelect).not.toHaveBeenCalled();
    expect(mockedCheckbox).not.toHaveBeenCalled();

    const skillsDir = path.join(tmpDir, '.claude', 'skills');
    const entries = (await fs.readdir(skillsDir)).filter((e) => e.startsWith('comet'));
    expect(entries.length).toBe(0);
  });

  it('skips prompt with --json and uninstalls all', async () => {
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;
    await copyCometSkillsForPlatform(tmpDir, claudePlatform, true, 'skills', 'project');
    await fs.writeFile(
      path.join(tmpDir, 'AGENTS.md'),
      'before\n\n<comet-ambient-resume>\nbody\n</comet-ambient-resume>\nafter\n',
      'utf-8',
    );
    await fs.writeFile(
      path.join(tmpDir, 'CLAUDE.md'),
      '# Claude\n\n<comet-ambient-resume>\nbody\n</comet-ambient-resume>\n',
      'utf-8',
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let jsonOutput;
    try {
      await uninstallCommand(tmpDir, { json: true });
      jsonOutput = log.mock.calls.map((c) => c.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(mockedSelect).not.toHaveBeenCalled();
    expect(mockedCheckbox).not.toHaveBeenCalled();

    const result = JSON.parse(jsonOutput);
    expect(result.summary.targetsProcessed).toBeGreaterThan(0);
    expect(result.projectInstructionsRemoved).toBe(2);
  });

  it('prints message when no targets found', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output;
    try {
      await uninstallCommand(tmpDir);
      output = log.mock.calls.map((c) => c.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain('No Comet installations found');
    expect(mockedSelect).not.toHaveBeenCalled();
  });

  it('returns stable JSON summary when no targets are found', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let jsonOutput: string;
    try {
      await uninstallCommand(tmpDir, { json: true });
      jsonOutput = log.mock.calls.map((c) => c.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    const result = JSON.parse(jsonOutput);
    expect(result).toMatchObject({
      targets: [],
      workingDirsRemoved: 0,
      summary: {
        targetsProcessed: 0,
        totalSkillsRemoved: 0,
        totalRulesRemoved: 0,
        totalHooksRemoved: 0,
      },
      projectInstructionsRemoved: 0,
    });
  });

  it('uninstalls antigravity2 global skills correctly without deleting other config files', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home');
    const configDir = path.join(fakeHome, '.gemini', 'config');

    const antigravity2Platform = PLATFORMS.find((p) => p.id === 'antigravity2')!;
    await copyCometSkillsForPlatform(fakeHome, antigravity2Platform, true, 'skills', 'global');

    // Create a sibling configuration file that must NOT be deleted
    const manifestPath = path.join(configDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify({ user: 'settings' }), 'utf-8');

    mockedSelect.mockResolvedValue(true as never);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir, { force: false });
    } finally {
      log.mockRestore();
    }

    const skillsCometDir = path.join(configDir, 'skills', 'comet');
    expect(await fileExists(skillsCometDir)).toBe(false);
    expect(await fileExists(manifestPath)).toBe(true);
    expect(JSON.parse(await fs.readFile(manifestPath, 'utf-8'))).toEqual({ user: 'settings' });
  });

  it('does not remove root managed project instructions with only global scope', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home');
    await fs.mkdir(path.join(fakeHome, '.agents', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(
      path.join(fakeHome, '.agents', 'skills', 'comet', 'SKILL.md'),
      '# Comet\n\nUse this skill.',
      'utf-8',
    );

    const agentsOriginal =
      'before\n\n<comet-ambient-resume>\nmanaged\n</comet-ambient-resume>\nafter\n';
    const claudeOriginal = '# User\n\n<comet-ambient-resume>\nmanaged\n</comet-ambient-resume>\n';
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), agentsOriginal, 'utf-8');
    await fs.writeFile(path.join(tmpDir, 'CLAUDE.md'), claudeOriginal, 'utf-8');

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let jsonOutput: string;
    try {
      await uninstallCommand(tmpDir, { json: true, force: true, scope: 'global' });
      jsonOutput = log.mock.calls.map((c) => c.join(' ')).join('\n');
    } finally {
      log.mockRestore();
      homedirSpy.mockRestore();
    }

    const result = JSON.parse(jsonOutput);
    expect(result.projectInstructionsRemoved).toBe(0);

    const agents = await fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf-8');
    const claude = await fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(agents).toBe(agentsOriginal);
    expect(claude).toBe(claudeOriginal);
  });

  it('removes only managed project instruction blocks and keeps user-authored content', async () => {
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;
    await copyCometSkillsForPlatform(tmpDir, claudePlatform, true, 'skills', 'project');
    await fs.writeFile(
      path.join(tmpDir, 'AGENTS.md'),
      '# User\n\nKeep this.\n<comet-ambient-resume>\nmanaged\n</comet-ambient-resume>\n',
      'utf-8',
    );
    await fs.writeFile(
      path.join(tmpDir, 'CLAUDE.md'),
      '# User\n\nAlso keep this.\n<comet-ambient-resume>\nmanaged\n</comet-ambient-resume>\n',
      'utf-8',
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir, { force: true });
    } finally {
      log.mockRestore();
    }

    const agents = await fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf-8');
    const claude = await fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(agents).toContain('Keep this.');
    expect(agents).not.toContain('<comet-ambient-resume>');
    expect(claude).toContain('Also keep this.');
    expect(claude).not.toContain('<comet-ambient-resume>');
  });
});
