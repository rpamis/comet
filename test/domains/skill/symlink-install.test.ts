import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { mkdtemp, rm, lstat, realpath } from 'fs/promises';
import os from 'os';
import {
  copyCometSkillsForPlatform,
  getCentralSkillsDir,
} from '../../../domains/skill/platform-install.js';
import { fileExists } from '../../../platform/fs/file-system.js';
import type { Platform } from '../../../platform/install/platforms.js';

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

  describe('copyCometSkillsForPlatform with symlink mode', () => {
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
