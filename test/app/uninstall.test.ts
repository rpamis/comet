import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { promises as fs } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import os from 'os';

const { rmdirMock, writeFileMock } = vi.hoisted(() => ({
  rmdirMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  rmdirMock.mockImplementation(actual.rmdir);
  writeFileMock.mockImplementation(actual.writeFile);
  return { ...actual, rmdir: rmdirMock, writeFile: writeFileMock };
});

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

import {
  PLATFORMS,
  getPlatformSkillsDir,
  type Platform,
} from '../../platform/install/platforms.js';
import {
  removeLegacyCometSkillsForPlatform,
  removeCometSkillsForPlatform,
  removeCometRulesForPlatform,
  removeCometHooksForPlatform,
  removeSuperpowersSkillsForPlatforms,
  removeWorkingDirs,
} from '../../domains/skill/uninstall.js';
import {
  copyCometSkillsForPlatform,
  copyCometRulesForPlatform,
  installCometHooksForPlatform,
} from '../../domains/skill/platform-install.js';
import { installCometProjectInstructions } from '../../domains/skill/project-instructions.js';
import { fileExists, removeFile, removeDir, isDirEmpty } from '../../platform/fs/file-system.js';
import {
  getProjectRegistryPath,
  upsertProjectInstallation,
} from '../../platform/install/project-registry.js';

describe('uninstall', () => {
  let tmpDir: string;

  beforeEach(async () => {
    rmdirMock.mockReset();
    rmdirMock.mockImplementation(fs.rmdir);
    writeFileMock.mockReset();
    writeFileMock.mockImplementation(fs.writeFile);
    mockedExecFileSync.mockReset();
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
    const managedHookContent =
      JSON.stringify({
        enabled: true,
        then: {
          type: 'runCommand',
          command: 'node .agents/skills/comet/scripts/comet-hook-router.mjs --platform kiro',
        },
      }) + '\n';
    await fs.mkdir(hooksDir, { recursive: true });
    await fs.writeFile(managedHook, managedHookContent);
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

    await expect(fs.readFile(managedHook, 'utf8')).resolves.toBe(managedHookContent);
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

    const retiredNativeBundles = [
      'comet-native/scripts/comet-native-checkpoint.mjs',
      'comet-native/scripts/comet-native-check.mjs',
      'comet-native/scripts/comet-native-evidence.mjs',
      'comet-native/scripts/comet-native-receipt.mjs',
    ] as const;

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

    it('removes retired Native bundles from copy and central stores without deleting user files', async () => {
      const roots = [
        path.join(tmpDir, '.claude', 'skills'),
        path.join(tmpDir, '.comet', 'skills', 'skills'),
      ];
      for (const root of roots) {
        const userFile = path.join(root, 'comet-native', 'scripts', 'user-helper.mjs');
        await fs.mkdir(path.dirname(userFile), { recursive: true });
        await fs.writeFile(userFile, 'keep user content\n', 'utf8');
        for (const relativePath of retiredNativeBundles) {
          const target = path.join(root, ...relativePath.split('/'));
          await fs.writeFile(target, 'legacy bundle\n', 'utf8');
        }
      }

      const result = await removeCometSkillsForPlatform(tmpDir, claudePlatform, 'project');

      expect(result.failed).toBe(0);
      expect(result.removed).toBe(retiredNativeBundles.length * roots.length);
      for (const root of roots) {
        for (const relativePath of retiredNativeBundles) {
          await expect(
            fs.access(path.join(root, ...relativePath.split('/'))),
          ).rejects.toMatchObject({ code: 'ENOENT' });
        }
        await expect(
          fs.readFile(path.join(root, 'comet-native', 'scripts', 'user-helper.mjs'), 'utf8'),
        ).resolves.toBe('keep user content\n');
      }
    });

    it('removes only the selected workflow Skills and keeps their shared entry', async () => {
      await copyCometSkillsForPlatform(
        tmpDir,
        claudePlatform,
        true,
        'skills',
        'project',
        'copy',
        'both',
      );
      const skillsDir = path.join(tmpDir, '.claude', 'skills');

      const result = await removeCometSkillsForPlatform(
        tmpDir,
        claudePlatform,
        'project',
        ['classic'],
        ['native'],
      );

      expect(result.failed).toBe(0);
      expect(await fileExists(path.join(skillsDir, 'comet-classic', 'SKILL.md'))).toBe(false);
      expect(await fileExists(path.join(skillsDir, 'comet-native', 'SKILL.md'))).toBe(true);
      expect(await fileExists(path.join(skillsDir, 'comet', 'SKILL.md'))).toBe(true);
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

  describe('removeSuperpowersSkillsForPlatforms', () => {
    it('removes listed Superpowers Skills from selected platforms in one CLI call', async () => {
      const claudePlatform = PLATFORMS.find((platform) => platform.id === 'claude')!;
      const codexPlatform = PLATFORMS.find((platform) => platform.id === 'codex')!;
      mockedExecFileSync.mockImplementation((_command, args) => {
        if (args[1] === 'list') {
          return JSON.stringify([
            { name: 'brainstorming', source: 'obra/superpowers', agents: ['Claude Code'] },
            {
              name: 'writing-plans',
              source: 'obra/superpowers',
              agents: ['Claude Code', 'Cursor'],
            },
            { name: 'personal', source: 'me/personal', agents: ['Claude Code'] },
            { name: 'using-superpowers', source: 'obra/superpowers', agents: ['Cursor'] },
          ]) as never;
        }
        return '' as never;
      });

      for (const name of ['brainstorming', 'writing-plans', 'using-superpowers']) {
        await fs.mkdir(path.join(tmpDir, '.agents', 'skills', name), { recursive: true });
      }

      const result = await removeSuperpowersSkillsForPlatforms(
        tmpDir,
        [claudePlatform, codexPlatform],
        'project',
        { removeSharedStorage: true },
      );

      expect(result).toEqual({ removed: 3, failed: 0 });
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        expect.any(String),
        ['skills', 'remove', 'brainstorming', '--agent', 'claude-code', 'codex', '--yes'],
        expect.objectContaining({ cwd: tmpDir }),
      );
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        expect.any(String),
        ['skills', 'remove', 'writing-plans', '--agent', 'claude-code', 'codex', '--yes'],
        expect.objectContaining({ cwd: tmpDir }),
      );
      expect(mockedExecFileSync).toHaveBeenCalledWith(
        expect.any(String),
        ['skills', 'remove', 'using-superpowers', '--agent', 'claude-code', 'codex', '--yes'],
        expect.anything(),
      );
      await expect(
        fs.access(path.join(tmpDir, '.agents', 'skills', 'brainstorming')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('uses the project Skills lock when the CLI has lost Superpowers source metadata', async () => {
      const codexPlatform = PLATFORMS.find((platform) => platform.id === 'codex')!;
      await fs.mkdir(path.join(tmpDir, '.agents', 'skills', 'brainstorming'), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, 'skills-lock.json'),
        JSON.stringify({
          version: 1,
          skills: { brainstorming: { source: 'obra/superpowers' } },
        }),
        'utf8',
      );
      mockedExecFileSync.mockImplementation((_command, args) => {
        if (args[1] === 'list') {
          return JSON.stringify([{ name: 'brainstorming', source: null }]) as never;
        }
        return '' as never;
      });

      const result = await removeSuperpowersSkillsForPlatforms(tmpDir, [codexPlatform], 'project', {
        removeSharedStorage: true,
      });

      expect(result).toEqual({ removed: 1, failed: 0 });
      await expect(
        fs.access(path.join(tmpDir, '.agents', 'skills', 'brainstorming')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
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

    it('continues Codex cleanup across files and counts every write failure', async () => {
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

      expect(result).toEqual({ removed: 1, failed: 2 });
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

    it('removes only managed Copilot entries while preserving user config', async () => {
      const copilotPlatform: Platform = PLATFORMS.find((p) => p.id === 'github-copilot')!;

      const hooksDir = path.join(tmpDir, '.github', 'hooks');
      await fs.mkdir(hooksDir, { recursive: true });
      const hookFilePath = path.join(hooksDir, 'comet-guard.json');
      await installCometHooksForPlatform(tmpDir, copilotPlatform, 'project');
      const config = JSON.parse(await fs.readFile(hookFilePath, 'utf8')) as {
        version: number;
        hooks: { preToolUse: Array<Record<string, unknown>> };
      };
      config.customSetting = 'keep';
      config.hooks.preToolUse.push({ matcher: '*', bash: 'node user-hook.mjs' });
      await fs.writeFile(hookFilePath, JSON.stringify(config, null, 2), 'utf-8');

      expect(await fileExists(hookFilePath)).toBe(true);

      const result = await removeCometHooksForPlatform(tmpDir, copilotPlatform, 'project');
      expect(result.removed).toBe(1);
      expect(await fs.readFile(hookFilePath, 'utf8')).toContain('customSetting');
      const cleaned = JSON.parse(await fs.readFile(hookFilePath, 'utf8')) as {
        customSetting: string;
        hooks: { preToolUse: Array<Record<string, unknown>> };
      };
      expect(cleaned.hooks.preToolUse).toEqual([{ matcher: '*', bash: 'node user-hook.mjs' }]);
      expect(cleaned.customSetting).toBe('keep');
    });

    it('removes only Kiro hook files that contain a managed command', async () => {
      const kiroPlatform: Platform = PLATFORMS.find((p) => p.id === 'kiro')!;

      const hooksDir = path.join(tmpDir, '.kiro', 'hooks');
      await fs.mkdir(hooksDir, { recursive: true });
      const hookFilePath = path.join(hooksDir, 'comet-hook-guard.kiro.hook');
      await fs.writeFile(
        hookFilePath,
        JSON.stringify({
          enabled: true,
          then: {
            type: 'runCommand',
            command: 'node .agents/skills/comet/scripts/comet-hook-guard.mjs --platform kiro',
          },
        }),
        'utf8',
      );

      expect(await fileExists(hookFilePath)).toBe(true);

      const result = await removeCometHooksForPlatform(tmpDir, kiroPlatform, 'project');
      expect(result.removed).toBe(1);
      expect(await fileExists(hookFilePath)).toBe(false);
    });

    it('preserves an unmanaged Kiro hook that reuses a Comet filename', async () => {
      const kiroPlatform: Platform = PLATFORMS.find((p) => p.id === 'kiro')!;
      const hooksDir = path.join(tmpDir, '.kiro', 'hooks');
      const hookFilePath = path.join(hooksDir, 'comet-hook-router.kiro.hook');
      const userConfig = {
        enabled: true,
        then: { type: 'runCommand', command: 'node user-hook.mjs' },
      };
      await fs.mkdir(hooksDir, { recursive: true });
      await fs.writeFile(hookFilePath, JSON.stringify(userConfig), 'utf8');

      await expect(removeCometHooksForPlatform(tmpDir, kiroPlatform, 'project')).resolves.toEqual({
        removed: 0,
        failed: 0,
      });
      await expect(fs.readFile(hookFilePath, 'utf8')).resolves.toBe(JSON.stringify(userConfig));
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
    async function writeNativeProjectConfig(
      artifactRoot: string,
      workflows: 'native' | 'both' = 'native',
    ): Promise<string> {
      const configPath = path.join(tmpDir, '.comet', 'config.yaml');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        [
          'schema: comet.project.v1',
          'default_workflow: native',
          `workflows: [native${workflows === 'both' ? ', classic' : ''}]`,
          'native:',
          `  artifact_root: ${artifactRoot}`,
          ...(workflows === 'both' ? ['classic:', '  artifact_layout: docs'] : []),
          '',
        ].join('\n'),
        'utf8',
      );
      return configPath;
    }

    async function createNativeWorkingTree(artifactRoot: string): Promise<string> {
      const nativeRoot = path.join(tmpDir, ...artifactRoot.split('/'), 'comet');
      for (const directory of [
        'specs',
        'changes',
        'archive',
        'runtime/locks',
        'runtime/transactions',
      ]) {
        await fs.mkdir(path.join(nativeRoot, ...directory.split('/')), { recursive: true });
      }
      return nativeRoot;
    }

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

    it('removes an empty configured docs layout', async () => {
      const configPath = path.join(tmpDir, '.comet', 'config.yaml');
      const docsRoot = path.join(tmpDir, 'docs');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, 'classic:\n  artifact_layout: docs\n', 'utf8');
      await fs.mkdir(path.join(docsRoot, 'openspec', 'changes', 'archive'), { recursive: true });
      await fs.mkdir(path.join(docsRoot, 'openspec', 'specs'), { recursive: true });
      await fs.mkdir(path.join(docsRoot, 'superpowers', 'reports'), { recursive: true });

      const result = await removeWorkingDirs(tmpDir);

      expect(result).toEqual({ removed: 1, failed: 0 });
      expect(await fileExists(path.join(tmpDir, '.comet'))).toBe(false);
      expect(await fileExists(docsRoot)).toBe(false);
    });

    it.each(['docs', 'legacy'] as const)(
      'preserves a real OpenSpec %s root with config.yaml while removing independent Comet-owned trees',
      async (artifactLayout) => {
        const configPath = path.join(tmpDir, '.comet', 'config.yaml');
        const openSpecRoot =
          artifactLayout === 'docs'
            ? path.join(tmpDir, 'docs', 'openspec')
            : path.join(tmpDir, 'openspec');
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        await fs.writeFile(
          configPath,
          [
            'schema: comet.project.v1',
            'default_workflow: classic',
            'workflows: [classic]',
            'classic:',
            `  artifact_layout: ${artifactLayout}`,
            '',
          ].join('\n'),
          'utf8',
        );
        await fs.mkdir(path.join(openSpecRoot, 'changes', 'archive'), { recursive: true });
        await fs.mkdir(path.join(openSpecRoot, 'specs'), { recursive: true });
        await fs.writeFile(path.join(openSpecRoot, 'config.yaml'), 'schema: spec-driven\n', 'utf8');
        await fs.writeFile(path.join(openSpecRoot, 'specs', 'user.md'), '# Keep\n', 'utf8');
        await fs.mkdir(path.join(tmpDir, 'docs', 'superpowers', 'specs'), {
          recursive: true,
        });
        await fs.mkdir(path.join(tmpDir, 'docs', 'superpowers', 'plans'), {
          recursive: true,
        });

        const result = await removeWorkingDirs(tmpDir);

        expect(result).toEqual({ removed: 1, failed: 0 });
        await expect(fs.stat(path.join(tmpDir, '.comet'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
        await expect(fs.readFile(path.join(openSpecRoot, 'config.yaml'), 'utf8')).resolves.toBe(
          'schema: spec-driven\n',
        );
        await expect(
          fs.readFile(path.join(openSpecRoot, 'specs', 'user.md'), 'utf8'),
        ).resolves.toBe('# Keep\n');
        await expect(fs.stat(path.join(tmpDir, 'docs', 'superpowers'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      },
    );

    it('removes the standard empty Native-only docs tree', async () => {
      await writeNativeProjectConfig('docs');
      const nativeRoot = await createNativeWorkingTree('docs');

      const result = await removeWorkingDirs(tmpDir);

      expect(result).toEqual({ removed: 1, failed: 0 });
      expect(await fileExists(path.join(tmpDir, '.comet'))).toBe(false);
      expect(await fileExists(nativeRoot)).toBe(false);
      expect(await fileExists(path.join(tmpDir, 'docs'))).toBe(false);
    });

    it('removes the standard empty Native tree from an explicit artifact root', async () => {
      await writeNativeProjectConfig('product-artifacts');
      const nativeRoot = await createNativeWorkingTree('product-artifacts');

      const result = await removeWorkingDirs(tmpDir);

      expect(result).toEqual({ removed: 1, failed: 0 });
      expect(await fileExists(path.join(tmpDir, '.comet'))).toBe(false);
      expect(await fileExists(nativeRoot)).toBe(false);
    });

    it('removes the combined empty Classic and Native docs tree', async () => {
      await writeNativeProjectConfig('docs', 'both');
      await createNativeWorkingTree('docs');
      await fs.mkdir(path.join(tmpDir, 'docs', 'openspec', 'changes', 'archive'), {
        recursive: true,
      });
      await fs.mkdir(path.join(tmpDir, 'docs', 'openspec', 'specs'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'docs', 'superpowers', 'reports'), { recursive: true });

      const result = await removeWorkingDirs(tmpDir);

      expect(result).toEqual({ removed: 1, failed: 0 });
      expect(await fileExists(path.join(tmpDir, '.comet'))).toBe(false);
      expect(await fileExists(path.join(tmpDir, 'docs'))).toBe(false);
    });

    it.each(['artifact', 'unknown', 'special'] as const)(
      'preserves Native working directories containing %s content',
      async (contentKind) => {
        const configPath = await writeNativeProjectConfig('docs');
        const nativeRoot = await createNativeWorkingTree('docs');
        const external = path.join(tmpDir, 'external-native-content');
        await fs.mkdir(external, { recursive: true });
        await fs.writeFile(path.join(external, 'marker.txt'), 'external marker\n', 'utf8');

        let retainedPath: string;
        if (contentKind === 'artifact') {
          retainedPath = path.join(nativeRoot, 'changes', 'active-change.json');
          await fs.writeFile(retainedPath, '{}\n', 'utf8');
        } else if (contentKind === 'unknown') {
          retainedPath = path.join(nativeRoot, 'user-notes');
          await fs.mkdir(retainedPath);
        } else {
          retainedPath = path.join(nativeRoot, 'runtime', 'locks');
          await fs.rmdir(retainedPath);
          await fs.symlink(
            external,
            retainedPath,
            process.platform === 'win32' ? 'junction' : 'dir',
          );
        }

        const result = await removeWorkingDirs(tmpDir);

        const configRemoved = contentKind !== 'special';
        if (configRemoved) {
          expect(result).toEqual({
            removed: 1,
            failed: 0,
            preserved: [retainedPath],
          });
        } else {
          expect(result).toMatchObject({ removed: 0, failed: 1 });
          expect(result.reason).toContain('Refusing to remove non-directory working object');
        }
        if (configRemoved) {
          await expect(fs.stat(configPath)).rejects.toMatchObject({ code: 'ENOENT' });
        } else {
          await expect(fs.stat(configPath)).resolves.toBeDefined();
        }
        await expect(fs.lstat(nativeRoot)).resolves.toBeDefined();
        await expect(fs.lstat(retainedPath)).resolves.toBeDefined();
        await expect(fs.readFile(path.join(external, 'marker.txt'), 'utf8')).resolves.toBe(
          'external marker\n',
        );
      },
    );

    it('rejects a managed-directory replacement after inspection without reading the junction target', async () => {
      const configPath = await writeNativeProjectConfig('docs');
      const nativeRoot = await createNativeWorkingTree('docs');
      const changesDir = path.join(nativeRoot, 'changes');
      const preservedChanges = path.join(tmpDir, 'preserved-native-changes');
      const external = path.join(tmpDir, 'external-replacement');
      const marker = path.join(external, 'marker.txt');
      await fs.mkdir(external, { recursive: true });
      await fs.writeFile(marker, 'external marker\n', 'utf8');
      let replaced = false;
      const readdirSpy = vi.spyOn(fs, 'readdir');
      let callsBeforeReplacement = 0;

      try {
        const result = await removeWorkingDirs(tmpDir, {
          testHooks: {
            afterPlanInspection: async () => {
              callsBeforeReplacement = readdirSpy.mock.calls.length;
              replaced = true;
              await fs.rename(changesDir, preservedChanges);
              await fs.symlink(
                external,
                changesDir,
                process.platform === 'win32' ? 'junction' : 'dir',
              );
            },
          },
        });

        expect(replaced).toBe(true);
        expect(result).toMatchObject({ removed: 0, failed: 1 });
        expect(
          readdirSpy.mock.calls
            .slice(callsBeforeReplacement)
            .some(([target]) => path.resolve(String(target)) === path.resolve(changesDir)),
        ).toBe(false);
        await expect(fs.stat(configPath)).resolves.toBeDefined();
        await expect(fs.lstat(nativeRoot)).resolves.toBeDefined();
        expect((await fs.lstat(changesDir)).isSymbolicLink()).toBe(true);
        await expect(fs.stat(preservedChanges)).resolves.toBeDefined();
        await expect(fs.readFile(marker, 'utf8')).resolves.toBe('external marker\n');
      } finally {
        readdirSpy.mockRestore();
      }
    });

    it('preserves non-empty docs directories', async () => {
      const configPath = path.join(tmpDir, '.comet', 'config.yaml');
      const legacyRoot = path.join(tmpDir, 'openspec');
      const specsDir = path.join(tmpDir, 'docs', 'superpowers', 'specs');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, 'classic:\n  artifact_layout: legacy\n', 'utf8');
      await fs.mkdir(path.join(legacyRoot, 'changes', 'archive'), { recursive: true });
      await fs.mkdir(path.join(legacyRoot, 'specs'), { recursive: true });
      await fs.mkdir(specsDir, { recursive: true });
      await fs.writeFile(path.join(specsDir, 'important.md'), 'keep me', 'utf-8');

      const result = await removeWorkingDirs(tmpDir);

      expect(result).toEqual({
        removed: 1,
        failed: 0,
        preserved: [path.join(specsDir, 'important.md')],
      });
      expect(await fileExists(configPath)).toBe(false);
      expect(await fileExists(legacyRoot)).toBe(true);
      expect(await fileExists(path.join(tmpDir, 'docs'))).toBe(true);
      expect(await fileExists(path.join(specsDir, 'important.md'))).toBe(true);
    });

    it('completes cleanup when a prior uninstall removed config and existing docs remain', async () => {
      const preservedDocument = path.join(tmpDir, 'docs', 'ARCHITECTURE.md');
      await fs.mkdir(path.dirname(preservedDocument), { recursive: true });
      await fs.writeFile(preservedDocument, 'keep me', 'utf8');

      const result = await removeWorkingDirs(tmpDir);

      expect(result).toEqual({ removed: 0, failed: 0, preserved: [preservedDocument] });
      await expect(fs.readFile(preservedDocument, 'utf8')).resolves.toBe('keep me');
    });

    it('preserves every working directory when legacy and docs OpenSpec roots both exist', async () => {
      const configPath = path.join(tmpDir, '.comet', 'config.yaml');
      const legacyRoot = path.join(tmpDir, 'openspec');
      const docsRoot = path.join(tmpDir, 'docs', 'openspec');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, 'classic:\n  artifact_layout: legacy\n', 'utf8');
      await fs.mkdir(path.join(legacyRoot, 'changes', 'archive'), { recursive: true });
      await fs.mkdir(path.join(docsRoot, 'changes', 'archive'), { recursive: true });

      const result = await removeWorkingDirs(tmpDir);

      expect(result).toMatchObject({ removed: 0, failed: 1 });
      await expect(fs.stat(configPath)).resolves.toBeDefined();
      await expect(fs.stat(legacyRoot)).resolves.toBeDefined();
      await expect(fs.stat(docsRoot)).resolves.toBeDefined();
    });

    it('preserves every working directory while a Classic root move is pending', async () => {
      const cometDir = path.join(tmpDir, '.comet');
      const configPath = path.join(cometDir, 'config.yaml');
      const journalPath = path.join(cometDir, 'classic-root-move.json');
      const legacyRoot = path.join(tmpDir, 'openspec');
      await fs.mkdir(cometDir, { recursive: true });
      await fs.writeFile(configPath, 'classic:\n  artifact_layout: legacy\n', 'utf8');
      await fs.writeFile(journalPath, '{}\n', 'utf8');
      await fs.mkdir(path.join(legacyRoot, 'changes', 'archive'), { recursive: true });
      await fs.mkdir(path.join(legacyRoot, 'specs'), { recursive: true });

      const result = await removeWorkingDirs(tmpDir);

      expect(result).toMatchObject({ removed: 0, failed: 1 });
      await expect(fs.stat(configPath)).resolves.toBeDefined();
      await expect(fs.stat(journalPath)).resolves.toBeDefined();
      await expect(fs.stat(legacyRoot)).resolves.toBeDefined();
    });

    it('preserves every working directory when .comet contains unknown user content', async () => {
      const cometDir = path.join(tmpDir, '.comet');
      const configPath = path.join(cometDir, 'config.yaml');
      const userFile = path.join(cometDir, 'user-notes.md');
      const legacyRoot = path.join(tmpDir, 'openspec');
      await fs.mkdir(cometDir, { recursive: true });
      await fs.writeFile(configPath, 'classic:\n  artifact_layout: legacy\n', 'utf8');
      await fs.writeFile(userFile, 'keep me\n', 'utf8');
      await fs.mkdir(path.join(legacyRoot, 'changes', 'archive'), { recursive: true });
      await fs.mkdir(path.join(legacyRoot, 'specs'), { recursive: true });

      const result = await removeWorkingDirs(tmpDir);

      expect(result).toMatchObject({ removed: 0, failed: 1 });
      await expect(fs.stat(configPath)).resolves.toBeDefined();
      await expect(fs.stat(userFile)).resolves.toBeDefined();
      await expect(fs.stat(legacyRoot)).resolves.toBeDefined();
    });

    it('preserves every working directory when Classic config is invalid', async () => {
      const configPath = path.join(tmpDir, '.comet', 'config.yaml');
      const legacyRoot = path.join(tmpDir, 'openspec');
      const docsRoot = path.join(tmpDir, 'docs', 'openspec');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, 'classic: invalid\n', 'utf8');
      await fs.mkdir(legacyRoot, { recursive: true });
      await fs.mkdir(docsRoot, { recursive: true });

      const result = await removeWorkingDirs(tmpDir);

      expect(result).toMatchObject({ removed: 0, failed: 1 });
      await expect(fs.stat(configPath)).resolves.toBeDefined();
      await expect(fs.stat(legacyRoot)).resolves.toBeDefined();
      await expect(fs.stat(docsRoot)).resolves.toBeDefined();
    });

    it('preserves every working directory when the full project config is malformed', async () => {
      const configPath = path.join(tmpDir, '.comet', 'config.yaml');
      const legacyRoot = path.join(tmpDir, 'openspec');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, 'schema: [broken\n', 'utf8');
      await fs.mkdir(legacyRoot, { recursive: true });

      const result = await removeWorkingDirs(tmpDir);

      expect(result).toMatchObject({ removed: 0, failed: 1 });
      await expect(fs.stat(configPath)).resolves.toBeDefined();
      await expect(fs.stat(legacyRoot)).resolves.toBeDefined();
    });

    it('preserves special layout objects instead of following or unlinking them', async () => {
      const configPath = path.join(tmpDir, '.comet', 'config.yaml');
      const target = path.join(tmpDir, 'user-open-spec-target');
      const link = path.join(tmpDir, 'openspec');
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, 'classic:\n  artifact_layout: legacy\n', 'utf8');
      await fs.mkdir(target, { recursive: true });
      await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');

      const result = await removeWorkingDirs(tmpDir);

      expect(result).toMatchObject({ removed: 0, failed: 1 });
      await expect(fs.stat(configPath)).resolves.toBeDefined();
      expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
      await expect(fs.stat(target)).resolves.toBeDefined();
    });

    it('uses bounded bottom-up removal instead of recursive working-tree deletion', async () => {
      const source = await fs.readFile(path.resolve('domains/skill/uninstall.ts'), 'utf8');
      const start = source.indexOf('async function removeWorkingDirs');
      const end = source.indexOf('\\nexport {', start);
      const implementation = source.slice(start, end);

      expect(implementation).toContain('removeManagedWorkingTree');
      expect(implementation).not.toContain('removeDir(directory)');
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

vi.mock('../../app/commands/platform-select-prompt.js', () => ({
  platformSelectPrompt: vi.fn(),
}));

import { select, checkbox } from '@inquirer/prompts';
import { platformSelectPrompt } from '../../app/commands/platform-select-prompt.js';
import { uninstallCommand } from '../../app/commands/uninstall.js';

const mockedSelect = vi.mocked(select);
const mockedCheckbox = vi.mocked(checkbox);
const mockedPlatformSelectPrompt = vi.mocked(platformSelectPrompt);

describe('uninstallCommand interactive selection', () => {
  let tmpDir: string;

  let homedirSpy: MockInstance<typeof os.homedir>;

  beforeEach(async () => {
    mockedSelect.mockReset();
    mockedCheckbox.mockReset();
    mockedPlatformSelectPrompt.mockReset();
    mockedSelect.mockResolvedValue(true as never);
    mockedPlatformSelectPrompt.mockImplementation(async (config) =>
      config.choices.filter((choice) => choice.checked === true).map((choice) => choice.value),
    );
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

  it('applies one workflow selection across all indexed projects', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home-all-workflow-selection');
    const projectA = path.join(tmpDir, 'project-a-workflow-selection');
    const projectB = path.join(tmpDir, 'project-b-workflow-selection');
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;

    for (const project of [projectA, projectB]) {
      await copyCometSkillsForPlatform(project, claudePlatform, true, 'skills', 'project');
      await upsertProjectInstallation(project, [{ platform: 'claude', language: 'en' }], 'init', {
        homeDir: fakeHome,
      });
    }

    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    mockedSelect.mockResolvedValue(true as never);
    mockedCheckbox.mockResolvedValueOnce(['native'] as never);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await uninstallCommand(projectA, { allProjects: true });
    } finally {
      log.mockRestore();
    }

    expect(mockedCheckbox).toHaveBeenCalledTimes(1);
    for (const project of [projectA, projectB]) {
      await expect(
        fs.access(path.join(project, '.claude', 'skills', 'comet-native', 'SKILL.md')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        fs.access(path.join(project, '.claude', 'skills', 'comet-classic', 'SKILL.md')),
      ).resolves.toBeUndefined();
    }
  });

  it('applies one detected-platform choice across all indexed projects', async () => {
    const fakeHome = path.join(tmpDir, 'fake-home-all-platform-selection');
    const projectA = path.join(tmpDir, 'project-a-platform-selection');
    const projectB = path.join(tmpDir, 'project-b-platform-selection');
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;
    const codexPlatform = PLATFORMS.find((p) => p.id === 'codex')!;

    for (const project of [projectA, projectB]) {
      await copyCometSkillsForPlatform(project, claudePlatform, true, 'skills', 'project');
      await copyCometSkillsForPlatform(project, codexPlatform, true, 'skills', 'project');
      await upsertProjectInstallation(
        project,
        [
          { platform: 'claude', language: 'en' },
          { platform: 'codex', language: 'en' },
        ],
        'init',
        { homeDir: fakeHome },
      );
    }

    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    mockedSelect.mockResolvedValue(true as never);
    mockedPlatformSelectPrompt.mockResolvedValueOnce(['claude']);
    mockedCheckbox.mockResolvedValueOnce(['native'] as never);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await uninstallCommand(projectA, { allProjects: true });
    } finally {
      log.mockRestore();
    }

    for (const project of [projectA, projectB]) {
      await expect(
        fs.access(path.join(project, '.claude', 'skills', 'comet-native', 'SKILL.md')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        fs.access(path.join(project, '.agents', 'skills', 'comet-native', 'SKILL.md')),
      ).resolves.toBeUndefined();
    }
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
    await fs.writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'test: true\n', 'utf8');
    await upsertProjectInstallation(tmpDir, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const rmdir = fs.rmdir.bind(fs);
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    rmdirMock.mockImplementation(async (targetPath, options) => {
      if (path.resolve(String(targetPath)) === path.resolve(path.join(tmpDir, '.comet'))) {
        throw permissionError;
      }
      await rmdir(targetPath, options);
    });

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir, { force: true, json: true });
      const result = JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
      expect(result.summary.totalFailures).toBe(1);
    } finally {
      rmdirMock.mockImplementation(rmdir);
      log.mockRestore();
    }

    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8')) as {
      projects: unknown[];
    };
    expect(registry.projects).toHaveLength(1);
    await expect(fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf8')).resolves.toBe(
      'test: true\n',
    );
  });

  it('retries registered project cleanup after the Skill target was removed on the first attempt', async () => {
    const fakeHome = path.join(tmpDir, 'working-dir-retry-home');
    const claude = PLATFORMS.find((platform) => platform.id === 'claude')!;
    await copyCometSkillsForPlatform(tmpDir, claude, true, 'skills', 'project');
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'test: true\n', 'utf8');
    await upsertProjectInstallation(tmpDir, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
    homedirSpy.mockRestore();
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    const rmdir = fs.rmdir.bind(fs);
    let cometRemovalAttempts = 0;
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    rmdirMock.mockImplementation(async (targetPath, options) => {
      if (path.resolve(String(targetPath)) === path.resolve(path.join(tmpDir, '.comet'))) {
        cometRemovalAttempts++;
        if (cometRemovalAttempts === 1) throw permissionError;
      }
      await rmdir(targetPath, options);
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
      rmdirMock.mockImplementation(rmdir);
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
    await fs.writeFile(path.join(realProject, '.comet', 'config.yaml'), 'test: true\n', 'utf8');
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
      await expect(fs.access(claudeSkillPath)).rejects.toMatchObject({ code: 'ENOENT' });
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
        { scope: 'project', platform: 'opencode' },
        { scope: 'project', platform: 'claude' },
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
      expect(result.summary).toMatchObject({ targetsProcessed: 1, totalFailures: 0 });
      expect(
        result.targets.map((target: { scope: string; platform: string }) => ({
          scope: target.scope,
          platform: target.platform,
        })),
      ).toEqual([{ scope: 'project', platform: 'opencode' }]);
    } finally {
      log.mockRestore();
    }

    await expect(fs.access(projectCommandPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.access(path.join(fakeHome, getPlatformSkillsDir(opencode, 'global'), 'skills', 'comet')),
    ).resolves.toBeUndefined();
    const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf8')) as {
      projects: unknown[];
    };
    expect(registry.projects).toEqual([]);
  });

  it('runs follow-on cleanup for an all-projects registry entry with no remaining Skill target', async () => {
    const fakeHome = path.join(tmpDir, 'all-projects-stale-home');
    const project = path.join(tmpDir, 'all-projects-stale-project');
    await fs.mkdir(path.join(project, '.comet'), { recursive: true });
    await fs.writeFile(path.join(project, '.comet', 'config.yaml'), 'test: true\n', 'utf8');
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

    expect(mockedSelect).not.toHaveBeenCalled();
    expect(mockedCheckbox).toHaveBeenCalled();

    const skillsDir = path.join(tmpDir, '.claude', 'skills');
    const entries = (await fs.readdir(skillsDir)).filter((e) => e.startsWith('comet'));
    expect(entries.length).toBe(0);
  });

  it('removes only Classic Skills when the user keeps Native', async () => {
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;
    await copyCometSkillsForPlatform(
      tmpDir,
      claudePlatform,
      true,
      'skills',
      'project',
      'copy',
      'both',
    );
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows:',
        '  - native',
        '  - classic',
        'ambient_resume: true',
        'native:',
        '  artifact_root: docs',
        '  language: en',
        'classic:',
        '  artifact_layout: docs',
        '  language: en',
        '  context_compression: off',
        '  review_mode: standard',
        '  auto_transition: true',
      ].join('\n'),
      'utf8',
    );
    mockedSelect.mockResolvedValue(true as never);
    mockedCheckbox.mockResolvedValueOnce(['classic'] as never).mockResolvedValueOnce([] as never);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir);
    } finally {
      log.mockRestore();
    }

    const skillsDir = path.join(tmpDir, '.claude', 'skills');
    expect(await fileExists(path.join(skillsDir, 'comet-native', 'SKILL.md'))).toBe(true);
    expect(await fileExists(path.join(skillsDir, 'comet-classic', 'SKILL.md'))).toBe(false);
    expect(await fileExists(path.join(skillsDir, 'comet', 'SKILL.md'))).toBe(true);
    const config = await fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf8');
    expect(config).toContain('default_workflow: native');
    expect(config).not.toContain('classic:');
  });

  it('removes only Native Skills when the user keeps Classic', async () => {
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;
    await copyCometSkillsForPlatform(
      tmpDir,
      claudePlatform,
      true,
      'skills',
      'project',
      'copy',
      'both',
    );
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows:',
        '  - native',
        '  - classic',
        'ambient_resume: true',
        'native:',
        '  artifact_root: .comet/native',
        '  language: en',
        'classic:',
        '  artifact_layout: docs',
        '  language: en',
        '  context_compression: off',
        '  review_mode: standard',
        '  auto_transition: true',
      ].join('\n'),
      'utf8',
    );
    mockedSelect.mockResolvedValue(true as never);
    mockedCheckbox.mockResolvedValueOnce(['native'] as never);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir);
    } finally {
      log.mockRestore();
    }

    const skillsDir = path.join(tmpDir, '.claude', 'skills');
    expect(await fileExists(path.join(skillsDir, 'comet-native', 'SKILL.md'))).toBe(false);
    expect(await fileExists(path.join(skillsDir, 'comet-classic', 'SKILL.md'))).toBe(true);
    expect(await fileExists(path.join(skillsDir, 'comet', 'SKILL.md'))).toBe(true);
    const config = await fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf8');
    expect(config).toContain('default_workflow: classic');
    expect(config).not.toContain('native:');
  });

  it('applies one full workflow selection to every current-project target', async () => {
    const claudePlatform = PLATFORMS.find((platform) => platform.id === 'claude')!;
    const codexPlatform = PLATFORMS.find((platform) => platform.id === 'codex')!;
    await copyCometSkillsForPlatform(
      tmpDir,
      claudePlatform,
      true,
      'skills',
      'project',
      'copy',
      'both',
    );
    await copyCometSkillsForPlatform(
      tmpDir,
      codexPlatform,
      true,
      'skills',
      'project',
      'copy',
      'both',
    );
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows:',
        '  - native',
        '  - classic',
        'ambient_resume: true',
        'native:',
        '  artifact_root: docs',
        '  language: en',
        'classic:',
        '  artifact_layout: docs',
        '  language: en',
        '  context_compression: off',
        '  review_mode: standard',
        '  auto_transition: true',
      ].join('\n'),
      'utf8',
    );
    await installCometProjectInstructions(tmpDir, 'en');
    mockedCheckbox
      .mockResolvedValueOnce(['claude:project'] as never)
      .mockResolvedValueOnce(['native', 'classic'] as never)
      .mockResolvedValueOnce([] as never);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir);
    } finally {
      log.mockRestore();
    }

    await expect(fs.access(path.join(tmpDir, '.comet', 'config.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8')).resolves.toBe('');
    await expect(
      fs.access(path.join(tmpDir, '.agents', 'skills', 'comet-native', 'SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.access(path.join(tmpDir, '.agents', 'skills', 'comet-classic', 'SKILL.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes project instructions when uninstalling the only installed workflow', async () => {
    const claudePlatform = PLATFORMS.find((platform) => platform.id === 'claude')!;
    await copyCometSkillsForPlatform(
      tmpDir,
      claudePlatform,
      true,
      'skills',
      'project',
      'copy',
      'native',
    );
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows:',
        '  - native',
        'ambient_resume: true',
        'native:',
        '  artifact_root: docs',
        '  language: en',
      ].join('\n'),
      'utf8',
    );
    await installCometProjectInstructions(tmpDir, 'en');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir, { force: true });
    } finally {
      log.mockRestore();
    }

    await expect(fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8')).resolves.not.toContain(
      'comet-ambient-resume',
    );
  });

  it('keeps OpenSpec Skills unless the Classic companion option is selected', async () => {
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;
    await copyCometSkillsForPlatform(
      tmpDir,
      claudePlatform,
      true,
      'skills',
      'project',
      'copy',
      'both',
    );
    const openSpecSkill = path.join(tmpDir, '.claude', 'skills', 'openspec-propose', 'SKILL.md');
    await fs.mkdir(path.dirname(openSpecSkill), { recursive: true });
    await fs.writeFile(openSpecSkill, '# OpenSpec', 'utf8');
    mockedSelect.mockResolvedValue(true as never);
    mockedCheckbox.mockResolvedValueOnce(['classic'] as never).mockResolvedValueOnce([] as never);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir);
    } finally {
      log.mockRestore();
    }

    expect(await fileExists(openSpecSkill)).toBe(true);
  });

  it('removes OpenSpec Skills when the Classic companion option is selected', async () => {
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;
    await copyCometSkillsForPlatform(
      tmpDir,
      claudePlatform,
      true,
      'skills',
      'project',
      'copy',
      'both',
    );
    const openSpecSkill = path.join(tmpDir, '.claude', 'skills', 'openspec-propose', 'SKILL.md');
    await fs.mkdir(path.dirname(openSpecSkill), { recursive: true });
    await fs.writeFile(openSpecSkill, '# OpenSpec', 'utf8');
    mockedSelect.mockResolvedValue(true as never);
    mockedCheckbox
      .mockResolvedValueOnce(['classic'] as never)
      .mockResolvedValueOnce(['openspec'] as never);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir);
    } finally {
      log.mockRestore();
    }

    expect(await fileExists(openSpecSkill)).toBe(false);
  });

  it('keeps Classic companion Skills during a non-interactive full uninstall', async () => {
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;
    await copyCometSkillsForPlatform(
      tmpDir,
      claudePlatform,
      true,
      'skills',
      'project',
      'copy',
      'both',
    );
    const openSpecSkill = path.join(tmpDir, '.claude', 'skills', 'openspec-propose', 'SKILL.md');
    await fs.mkdir(path.dirname(openSpecSkill), { recursive: true });
    await fs.writeFile(openSpecSkill, '# OpenSpec', 'utf8');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir, { force: true });
    } finally {
      log.mockRestore();
    }

    expect(await fileExists(openSpecSkill)).toBe(true);
  });

  it('uninstalls every current-project target after the workflow selection', async () => {
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;
    await copyCometSkillsForPlatform(tmpDir, claudePlatform, true, 'skills', 'project');

    mockedCheckbox.mockResolvedValueOnce(['native', 'classic'] as never);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir, { force: false });
    } finally {
      log.mockRestore();
    }

    const skillsDir = path.join(tmpDir, '.claude', 'skills');
    const entries = (await fs.readdir(skillsDir)).filter((e) => e.startsWith('comet'));
    expect(entries.length).toBe(0);
    expect(mockedCheckbox).toHaveBeenCalledTimes(2);
  });

  it('applies one workflow selection to every current-project platform', async () => {
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;
    await copyCometSkillsForPlatform(tmpDir, claudePlatform, true, 'skills', 'project');
    const codexPlatform = PLATFORMS.find((p) => p.id === 'codex')!;
    await copyCometSkillsForPlatform(tmpDir, codexPlatform, true, 'skills', 'project');

    mockedCheckbox.mockResolvedValueOnce(['native'] as never);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir, { force: false });
    } finally {
      log.mockRestore();
    }

    expect(mockedCheckbox).toHaveBeenCalledTimes(1);
    expect(mockedSelect).not.toHaveBeenCalled();

    expect(
      await fileExists(path.join(tmpDir, '.claude', 'skills', 'comet-native', 'SKILL.md')),
    ).toBe(false);
    expect(
      await fileExists(path.join(tmpDir, '.claude', 'skills', 'comet-classic', 'SKILL.md')),
    ).toBe(true);
    expect(
      await fileExists(path.join(tmpDir, '.agents', 'skills', 'comet-native', 'SKILL.md')),
    ).toBe(false);
    expect(
      await fileExists(path.join(tmpDir, '.agents', 'skills', 'comet-classic', 'SKILL.md')),
    ).toBe(true);
  });

  it('uses the init-style detected-platform batch selector before uninstalling', async () => {
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;
    const cursorPlatform = PLATFORMS.find((p) => p.id === 'cursor')!;
    await copyCometSkillsForPlatform(tmpDir, claudePlatform, true, 'skills', 'project');
    await copyCometSkillsForPlatform(tmpDir, cursorPlatform, true, 'skills', 'project');

    mockedPlatformSelectPrompt.mockResolvedValueOnce(['cursor']);
    mockedCheckbox.mockResolvedValueOnce(['native'] as never);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await uninstallCommand(tmpDir, { force: false });
    } finally {
      log.mockRestore();
    }

    expect(mockedPlatformSelectPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Select platforms to uninstall:',
        selectedLabel: 'Selected platforms:',
        emptyLabel: 'None',
        required: true,
      }),
    );
    expect(mockedPlatformSelectPrompt.mock.calls[0]?.[0].choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Claude Code (detected)',
          value: 'claude',
          checked: true,
        }),
        expect.objectContaining({ name: 'Cursor (detected)', value: 'cursor', checked: true }),
      ]),
    );
    expect(
      await fileExists(path.join(tmpDir, '.claude', 'skills', 'comet-native', 'SKILL.md')),
    ).toBe(true);
    expect(
      await fileExists(path.join(tmpDir, '.cursor', 'skills', 'comet-native', 'SKILL.md')),
    ).toBe(false);
  });

  it('localizes current-project uninstall output from the project config language', async () => {
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;
    await copyCometSkillsForPlatform(tmpDir, claudePlatform, true, 'skills', 'project');
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      'config:\n  default_workflow: native\n  workflows: [native]\nnative:\n  artifact_root: .comet\n  language: zh-CN\n',
      'utf8',
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
    try {
      await uninstallCommand(tmpDir, { force: true });
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain('Comet 卸载');
    expect(output).toContain('Claude Code (项目):');
    expect(output).toContain('摘要：');
    expect(output).toContain('卸载完成。');
  });

  it('explains preserved working-directory content without marking uninstall incomplete', async () => {
    const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;
    const retainedFile = path.join(tmpDir, 'docs', 'comet', 'user-notes.md');
    await copyCometSkillsForPlatform(tmpDir, claudePlatform, true, 'skills', 'project');
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      [
        'config:',
        '  default_workflow: native',
        '  workflows: [native]',
        'native:',
        '  artifact_root: docs/comet',
        '  language: zh-CN',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.mkdir(path.dirname(retainedFile), { recursive: true });
    await fs.writeFile(retainedFile, 'keep me', 'utf8');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
    try {
      await uninstallCommand(tmpDir, { force: true });
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    const retainedRelativePath = path.relative(tmpDir, retainedFile);
    expect(output).toContain(`工作目录：已保留已有内容： ${retainedRelativePath}`);
    expect(output).toContain('原因：这些内容不由 Comet 管理，因此未删除。');
    expect(output).toContain('影响：不影响 Comet 卸载完成，保留内容未被修改。');
    expect(output).toContain('卸载完成。');
    expect(output).not.toContain('清理失败：');
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
      await uninstallCommand(tmpDir, { scope: 'global', force: false });
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
