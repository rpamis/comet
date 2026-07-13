import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  ensureDir,
  copyFile,
  fileExists,
  readJson,
  writeFile,
  readDir,
  removeFile,
  removeDir,
  isDirEmpty,
} from '../../platform/fs/file-system.js';

describe('file-system utils', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `comet-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('ensureDir', () => {
    it('creates a directory that does not exist', async () => {
      const dirPath = path.join(tmpDir, 'new-dir');
      await ensureDir(dirPath);
      const stat = await fs.stat(dirPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('creates nested directories recursively', async () => {
      const dirPath = path.join(tmpDir, 'a', 'b', 'c');
      await ensureDir(dirPath);
      const stat = await fs.stat(dirPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('does not throw when directory already exists', async () => {
      const dirPath = path.join(tmpDir, 'exists');
      await fs.mkdir(dirPath);
      await expect(ensureDir(dirPath)).resolves.not.toThrow();
    });

    it('follows symlinks and creates at the real target', async () => {
      if (process.platform === 'win32') return; // requires elevated permissions

      const realDir = path.join(tmpDir, 'real');
      await fs.mkdir(realDir);
      const symlinkDir = path.join(tmpDir, 'link');
      await fs.symlink(realDir, symlinkDir);

      const nested = path.join(symlinkDir, 'nested', 'deep');
      await ensureDir(nested);

      // Should exist at the real target
      const stat = await fs.stat(path.join(realDir, 'nested', 'deep'));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('copyFile', () => {
    it('copies file content from source to destination', async () => {
      const src = path.join(tmpDir, 'source.txt');
      const dest = path.join(tmpDir, 'sub', 'dest.txt');
      await fs.writeFile(src, 'hello');
      await copyFile(src, dest);
      const content = await fs.readFile(dest, 'utf-8');
      expect(content).toBe('hello');
    });

    it('creates parent directories of destination', async () => {
      const src = path.join(tmpDir, 'src.txt');
      const dest = path.join(tmpDir, 'deep', 'nested', 'dest.txt');
      await fs.writeFile(src, 'data');
      await copyFile(src, dest);
      const content = await fs.readFile(dest, 'utf-8');
      expect(content).toBe('data');
    });

    it('follows symlinks and writes to the symlink target', async () => {
      if (process.platform === 'win32') return; // requires elevated permissions

      const realDir = path.join(tmpDir, 'real-target');
      await fs.mkdir(realDir);
      const symlinkDir = path.join(tmpDir, 'symlink-dir');
      await fs.symlink(realDir, symlinkDir);

      const src = path.join(tmpDir, 'source.txt');
      const dest = path.join(symlinkDir, 'file.txt');
      await fs.writeFile(src, 'via-symlink');
      await copyFile(src, dest);

      // File should be at the real target, accessible through the symlink
      const content = await fs.readFile(dest, 'utf-8');
      expect(content).toBe('via-symlink');
      const realContent = await fs.readFile(path.join(realDir, 'file.txt'), 'utf-8');
      expect(realContent).toBe('via-symlink');
    });

    it('follows broken symlinks by resolving readlink target', async () => {
      if (process.platform === 'win32') return; // requires elevated permissions

      // Simulate: ~/.claude/skills/comet -> ../../.agents/skills/comet
      const agentDir = path.join(tmpDir, '.agents', 'skills', 'comet');
      await fs.mkdir(agentDir, { recursive: true });

      const claudeSkillsDir = path.join(tmpDir, '.claude', 'skills');
      await fs.mkdir(claudeSkillsDir, { recursive: true });
      const symlinkPath = path.join(claudeSkillsDir, 'comet');
      await fs.symlink(path.join('..', '..', '.agents', 'skills', 'comet'), symlinkPath);

      // Now remove the target to simulate a broken symlink
      await fs.rm(agentDir, { recursive: true });

      const src = path.join(tmpDir, 'SKILL.md');
      await fs.writeFile(src, 'skill-content');
      const dest = path.join(symlinkPath, 'SKILL.md');

      // copyFile should resolve the broken symlink and create at the target
      await copyFile(src, dest);

      // Verify file was written to the symlink target, not the symlink path
      const realDest = path.join(agentDir, 'SKILL.md');
      const content = await fs.readFile(realDest, 'utf-8');
      expect(content).toBe('skill-content');
    });
  });

  describe('fileExists', () => {
    it('returns true for an existing file', async () => {
      const filePath = path.join(tmpDir, 'real.txt');
      await fs.writeFile(filePath, '');
      expect(await fileExists(filePath)).toBe(true);
    });

    it('returns true for an existing directory', async () => {
      expect(await fileExists(tmpDir)).toBe(true);
    });

    it('returns false for a non-existent path', async () => {
      expect(await fileExists(path.join(tmpDir, 'nope'))).toBe(false);
    });

    it('propagates access permission errors', async () => {
      const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      const accessSpy = vi.spyOn(fs, 'access').mockRejectedValue(error);

      try {
        await expect(fileExists(path.join(tmpDir, 'blocked'))).rejects.toBe(error);
      } finally {
        accessSpy.mockRestore();
      }
    });
  });

  describe('readJson', () => {
    it('parses a JSON file and returns typed data', async () => {
      const filePath = path.join(tmpDir, 'data.json');
      await fs.writeFile(filePath, JSON.stringify({ name: 'test', version: '1.0' }));
      const data = await readJson<{ name: string; version: string }>(filePath);
      expect(data).toEqual({ name: 'test', version: '1.0' });
    });

    it('throws on invalid JSON', async () => {
      const filePath = path.join(tmpDir, 'bad.json');
      await fs.writeFile(filePath, '{not json');
      await expect(readJson(filePath)).rejects.toThrow();
    });
  });

  describe('writeFile', () => {
    it('writes content to a file', async () => {
      const filePath = path.join(tmpDir, 'out.txt');
      await writeFile(filePath, 'my content');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('my content');
    });

    it('creates parent directories', async () => {
      const filePath = path.join(tmpDir, 'dir', 'subdir', 'out.txt');
      await writeFile(filePath, 'deep');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('deep');
    });
  });

  describe('readDir', () => {
    it('lists directory entries', async () => {
      await fs.writeFile(path.join(tmpDir, 'a.txt'), '');
      await fs.writeFile(path.join(tmpDir, 'b.txt'), '');
      const entries = await readDir(tmpDir);
      expect(entries).toContain('a.txt');
      expect(entries).toContain('b.txt');
    });

    it('returns empty array for non-existent directory', async () => {
      const entries = await readDir(path.join(tmpDir, 'nope'));
      expect(entries).toEqual([]);
    });

    it('throws for non-ENOENT filesystem errors', async () => {
      const readdirSpy = vi
        .spyOn(fs, 'readdir')
        .mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));

      try {
        await expect(readDir(tmpDir)).rejects.toThrow('permission denied');
      } finally {
        readdirSpy.mockRestore();
      }
    });
  });

  describe('removal failures', () => {
    it('propagates removeFile permission errors', async () => {
      const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      const unlinkSpy = vi.spyOn(fs, 'unlink').mockRejectedValue(error);

      try {
        await expect(removeFile(path.join(tmpDir, 'blocked.txt'))).rejects.toBe(error);
      } finally {
        unlinkSpy.mockRestore();
      }
    });

    it('propagates removeDir permission errors', async () => {
      const dirPath = path.join(tmpDir, 'blocked');
      await fs.mkdir(dirPath);
      const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      const rmSpy = vi.spyOn(fs, 'rm').mockRejectedValue(error);

      try {
        await expect(removeDir(dirPath)).rejects.toBe(error);
      } finally {
        rmSpy.mockRestore();
      }
    });
  });

  describe('isDirEmpty', () => {
    it('propagates readdir permission errors', async () => {
      const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      const readdirSpy = vi.spyOn(fs, 'readdir').mockRejectedValue(error);

      try {
        await expect(isDirEmpty(path.join(tmpDir, 'blocked'))).rejects.toBe(error);
      } finally {
        readdirSpy.mockRestore();
      }
    });
  });
});
