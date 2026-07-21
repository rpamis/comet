import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { mkdir, mkdtemp, rm, lstat, readFile, realpath, symlink, writeFile } from 'fs/promises';
import os from 'os';
import {
  copyCometSkillsForPlatform,
  getCentralSkillsDir,
  prepareManagedSkillCopyTarget,
} from '../../../domains/skill/platform-install.js';
import { fileExists } from '../../../platform/fs/file-system.js';
import { PLATFORMS, type Platform } from '../../../platform/install/platforms.js';

const mockPlatform: Platform = {
  id: 'claude',
  name: 'Claude Code',
  skillsDir: '.claude',
  globalSkillsDir: '.claude',
  openspecToolId: 'claude',
  rulesDir: 'rules',
  rulesFormat: 'md',
  supportsHooks: true,
  hookFormat: 'claude-code',
};

const codexPlatform = PLATFORMS.find((platform) => platform.id === 'codex');

if (!codexPlatform) {
  throw new Error('Codex platform definition is missing');
}

describe('symlink install mode', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'comet-symlink-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('getCentralSkillsDir', () => {
    it('returns .comet/skills for project scope', () => {
      const result = getCentralSkillsDir(tmpDir, 'project');
      expect(result).toBe(path.join(tmpDir, '.comet', 'skills'));
    });

    it('returns .comet/skills for global scope', () => {
      const result = getCentralSkillsDir(tmpDir, 'global');
      expect(result).toBe(path.join(tmpDir, '.comet', 'skills'));
    });
  });

  describe('prepareManagedSkillCopyTarget', () => {
    it('detaches a fully managed Skill-root symlink without changing its target', async () => {
      await copyCometSkillsForPlatform(tmpDir, mockPlatform, true, 'skills', 'project', 'symlink');
      const platformSkills = path.join(tmpDir, '.claude', 'skills');
      const centralComet = path.join(tmpDir, '.comet', 'skills', 'skills', 'comet', 'SKILL.md');
      const centralContent = await readFile(centralComet, 'utf8');

      await prepareManagedSkillCopyTarget(tmpDir, mockPlatform, 'project');

      expect((await lstat(platformSkills)).isSymbolicLink()).toBe(false);
      expect(await fileExists(path.join(platformSkills, 'comet', 'SKILL.md'))).toBe(false);
      expect(await readFile(centralComet, 'utf8')).toBe(centralContent);
    });

    it('detaches managed entry symlinks while preserving unrelated Skills', async () => {
      const centralComet = path.join(tmpDir, '.comet', 'skills', 'skills', 'comet');
      const platformSkills = path.join(tmpDir, '.claude', 'skills');
      const personalSkill = path.join(platformSkills, 'personal', 'SKILL.md');
      await mkdir(centralComet, { recursive: true });
      await writeFile(path.join(centralComet, 'SKILL.md'), '# Central Comet\n', 'utf8');
      await mkdir(path.dirname(personalSkill), { recursive: true });
      await writeFile(personalSkill, '# Personal\n', 'utf8');
      await symlink(
        centralComet,
        path.join(platformSkills, 'comet'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      await prepareManagedSkillCopyTarget(tmpDir, mockPlatform, 'project');

      expect(await fileExists(path.join(platformSkills, 'comet'))).toBe(false);
      expect(await readFile(personalSkill, 'utf8')).toBe('# Personal\n');
      expect(await readFile(path.join(centralComet, 'SKILL.md'), 'utf8')).toBe('# Central Comet\n');
    });

    it('refuses to detach a shared Skill-root symlink with unmanaged entries', async () => {
      await copyCometSkillsForPlatform(tmpDir, mockPlatform, true, 'skills', 'project', 'symlink');
      const platformSkills = path.join(tmpDir, '.claude', 'skills');
      const openSpecSkill = path.join(tmpDir, '.comet', 'skills', 'skills', 'openspec', 'SKILL.md');
      await mkdir(path.dirname(openSpecSkill), { recursive: true });
      await writeFile(openSpecSkill, '# OpenSpec\n', 'utf8');

      await expect(prepareManagedSkillCopyTarget(tmpDir, mockPlatform, 'project')).rejects.toThrow(
        /unmanaged entries: openspec/iu,
      );

      expect((await lstat(platformSkills)).isSymbolicLink()).toBe(true);
      expect(await readFile(openSpecSkill, 'utf8')).toBe('# OpenSpec\n');
    });
  });

  describe('copyCometSkillsForPlatform install modes', () => {
    it('copies Codex skills to .agents without writing to legacy .codex skills', async () => {
      const result = await copyCometSkillsForPlatform(
        tmpDir,
        codexPlatform,
        false,
        'skills',
        'project',
        'copy',
      );

      expect(result.failed).toBe(0);
      expect(await fileExists(path.join(tmpDir, '.agents', 'skills', 'comet', 'SKILL.md'))).toBe(
        true,
      );
      expect(await fileExists(path.join(tmpDir, '.codex', 'skills', 'comet', 'SKILL.md'))).toBe(
        false,
      );
    });

    it('links Codex managed skills under .agents and preserves unrelated skills', async () => {
      const unrelatedSkill = path.join(tmpDir, '.agents', 'skills', 'third-party', 'SKILL.md');
      await mkdir(path.dirname(unrelatedSkill), { recursive: true });
      await writeFile(unrelatedSkill, '# Third-party Skill\n', 'utf-8');

      const result = await copyCometSkillsForPlatform(
        tmpDir,
        codexPlatform,
        true,
        'skills',
        'project',
        'symlink',
      );

      expect(result.failed).toBe(0);
      expect(await readFile(unrelatedSkill, 'utf-8')).toBe('# Third-party Skill\n');

      const cometSkillLink = path.join(tmpDir, '.agents', 'skills', 'comet');
      expect((await lstat(cometSkillLink)).isSymbolicLink()).toBe(true);
      expect(await realpath(cometSkillLink)).toBe(
        await realpath(path.join(tmpDir, '.comet', 'skills', 'skills', 'comet')),
      );
      expect(await fileExists(path.join(tmpDir, '.codex', 'skills', 'comet', 'SKILL.md'))).toBe(
        false,
      );
    });

    it('copies skills to central store and creates symlink', async () => {
      const result = await copyCometSkillsForPlatform(
        tmpDir,
        mockPlatform,
        false,
        'skills',
        'project',
        'symlink',
      );

      expect(result.copied).toBeGreaterThan(0);
      expect(result.failed).toBe(0);

      // Verify central store has actual files
      const centralSkillPath = path.join(tmpDir, '.comet', 'skills', 'skills', 'comet', 'SKILL.md');
      expect(await fileExists(centralSkillPath)).toBe(true);

      // Verify platform dir is a symlink
      const platformSkillsDir = path.join(tmpDir, '.claude', 'skills');
      const stat = await lstat(platformSkillsDir);
      expect(stat.isSymbolicLink()).toBe(true);

      // Verify symlink points to central store
      const linkedPath = await realpath(platformSkillsDir);
      const expectedTarget = await realpath(path.join(tmpDir, '.comet', 'skills', 'skills'));
      expect(linkedPath).toBe(expectedTarget);
    });

    it('links only Classic plus shared comet-any assets for a Classic install', async () => {
      const result = await copyCometSkillsForPlatform(
        tmpDir,
        mockPlatform,
        true,
        'skills',
        'project',
        'symlink',
        'classic',
      );

      expect(result.failed).toBe(0);
      await expect(
        readFile(path.join(tmpDir, '.claude', 'skills', 'comet-any', 'SKILL.md'), 'utf8'),
      ).resolves.toContain('name: comet-any');
      await expect(
        readFile(path.join(tmpDir, '.claude', 'skills', 'comet-classic', 'SKILL.md'), 'utf8'),
      ).resolves.toContain('name: comet-classic');
      await expect(
        lstat(path.join(tmpDir, '.claude', 'skills', 'comet-native')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('skips existing files in central store when overwrite is false', async () => {
      // First install
      await copyCometSkillsForPlatform(tmpDir, mockPlatform, false, 'skills', 'project', 'symlink');

      // Second install without overwrite
      const result = await copyCometSkillsForPlatform(
        tmpDir,
        mockPlatform,
        false,
        'skills',
        'project',
        'symlink',
      );

      expect(result.skipped).toBeGreaterThan(0);
      expect(result.copied).toBe(0);
    });

    it('overwrites files in central store when overwrite is true', async () => {
      // First install
      await copyCometSkillsForPlatform(tmpDir, mockPlatform, false, 'skills', 'project', 'symlink');

      // Second install with overwrite
      const result = await copyCometSkillsForPlatform(
        tmpDir,
        mockPlatform,
        true,
        'skills',
        'project',
        'symlink',
      );

      expect(result.copied).toBeGreaterThan(0);
    });

    it('links managed skills into an existing skills directory with unrelated user skills', async () => {
      const existingSkill = path.join(tmpDir, '.claude', 'skills', 'personal-skill', 'SKILL.md');
      await mkdir(path.dirname(existingSkill), { recursive: true });
      await writeFile(existingSkill, '# Personal Skill\n', 'utf-8');

      const result = await copyCometSkillsForPlatform(
        tmpDir,
        mockPlatform,
        true,
        'skills',
        'project',
        'symlink',
      );

      expect(result.failed).toBe(0);
      expect(await readFile(existingSkill, 'utf-8')).toBe('# Personal Skill\n');

      const platformSkillsDir = path.join(tmpDir, '.claude', 'skills');
      const stat = await lstat(platformSkillsDir);
      expect(stat.isSymbolicLink()).toBe(false);

      const cometSkillLink = path.join(platformSkillsDir, 'comet');
      const cometSkillStat = await lstat(cometSkillLink);
      expect(cometSkillStat.isSymbolicLink()).toBe(true);
      expect(await realpath(cometSkillLink)).toBe(
        await realpath(path.join(tmpDir, '.comet', 'skills', 'skills', 'comet')),
      );
      expect(await fileExists(path.join(cometSkillLink, 'SKILL.md'))).toBe(true);
    });

    it('does not replace an existing managed skill directory that contains unmanaged files', async () => {
      const existingNestedFile = path.join(tmpDir, '.claude', 'skills', 'comet', 'local-notes.md');
      await mkdir(path.dirname(existingNestedFile), { recursive: true });
      await writeFile(existingNestedFile, '# Local notes\n', 'utf-8');

      const result = await copyCometSkillsForPlatform(
        tmpDir,
        mockPlatform,
        true,
        'skills',
        'project',
        'symlink',
      );

      expect(result.failed).toBe(1);
      expect(await readFile(existingNestedFile, 'utf-8')).toBe('# Local notes\n');

      const cometSkillStat = await lstat(path.join(tmpDir, '.claude', 'skills', 'comet'));
      expect(cometSkillStat.isSymbolicLink()).toBe(false);
    });

    it('uses copy behavior when mode is copy (default)', async () => {
      const result = await copyCometSkillsForPlatform(
        tmpDir,
        mockPlatform,
        false,
        'skills',
        'project',
        'copy',
      );

      expect(result.copied).toBeGreaterThan(0);

      // Verify platform dir is NOT a symlink
      const platformSkillsDir = path.join(tmpDir, '.claude', 'skills');
      const stat = await lstat(platformSkillsDir);
      expect(stat.isSymbolicLink()).toBe(false);

      // Verify actual file exists in platform dir
      const skillPath = path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md');
      expect(await fileExists(skillPath)).toBe(true);
    });

    it('defaults to copy mode when installMode is not specified', async () => {
      const result = await copyCometSkillsForPlatform(
        tmpDir,
        mockPlatform,
        false,
        'skills',
        'project',
      );

      expect(result.copied).toBeGreaterThan(0);

      // Verify platform dir is NOT a symlink
      const platformSkillsDir = path.join(tmpDir, '.claude', 'skills');
      const stat = await lstat(platformSkillsDir);
      expect(stat.isSymbolicLink()).toBe(false);
    });
  });
});
