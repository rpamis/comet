import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { readGitCommitPaths } from '../../platform/process/git.js';

vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

test.each(['ENOBUFS', 'ETIMEDOUT'])(
  'retains per-commit delivery coverage when batching reaches %s',
  async (code) => {
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const commits = ['a'.repeat(40), 'b'.repeat(40)];
    const command = vi.mocked(execFileSync);
    command.mockClear();
    command.mockImplementationOnce(() => {
      throw Object.assign(new Error('injected batch boundary'), { code });
    });
    command.mockReturnValueOnce('first.txt\0');
    command.mockReturnValueOnce('path with spaces.txt\0');
    try {
      const result = readGitCommitPaths('/fixture', commits);
      expect([...result]).toEqual([
        [commits[0], ['first.txt']],
        [commits[1], ['path with spaces.txt']],
      ]);
      expect(command).toHaveBeenCalledTimes(3);
      for (let index = 0; index < 2; index++) {
        expect(command.mock.calls[index + 1][1]).toEqual([
          'diff-tree',
          '--no-commit-id',
          '--no-renames',
          '--name-only',
          '-r',
          '-z',
          commits[index],
        ]);
        expect(command.mock.calls[index + 1][2]).not.toHaveProperty('timeout');
        expect(command.mock.calls[index + 1][2]).not.toHaveProperty('maxBuffer');
      }
    } finally {
      command.mockReset();
      command.mockImplementation(actual.execFileSync);
    }
  },
);

test('preserves Git input errors instead of treating them as batch resource pressure', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const command = vi.mocked(execFileSync);
  command.mockClear();
  command.mockImplementationOnce(() => {
    throw Object.assign(new Error('invalid revision'), { status: 128 });
  });
  try {
    expect(() => readGitCommitPaths('/fixture', ['a'.repeat(40)])).toThrow('invalid revision');
    expect(command).toHaveBeenCalledTimes(1);
  } finally {
    command.mockReset();
    command.mockImplementation(actual.execFileSync);
  }
});

test.each([1, 2, 100])(
  'reads %i commits with one Git process and retains each intermediate path',
  async (count) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-git-commit-paths-'));
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    try {
      git('init', '-b', 'main');
      git('config', 'user.name', 'Commit Paths Test');
      git('config', 'user.email', 'test@example.invalid');
      const commits: string[] = [];
      for (let i = 0; i < count; i++) {
        const ref = i % 2 ? 'path with spaces.txt' : 'a'.repeat(40);
        await fs.writeFile(path.join(root, ref), String(i));
        git('add', '--', ref);
        git('-c', 'commit.gpgsign=false', 'commit', '-m', `step ${i}`);
        commits.push(git('rev-parse', 'HEAD'));
      }
      // 根提交沿用 diff-tree 默认：无父提交，不凭空引入文件变化。
      vi.mocked(execFileSync).mockClear();
      const paths = readGitCommitPaths(root, commits);
      expect(execFileSync).toHaveBeenCalledTimes(1);
      expect(paths.size).toBe(count);
      expect(paths.get(commits[0])).toEqual([]);
      for (let i = 1; i < count; i++)
        expect(paths.get(commits[i])).toEqual([i % 2 ? 'path with spaces.txt' : 'a'.repeat(40)]);
      const empty = git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'empty');
      expect(empty).toContain('empty');
      expect(
        readGitCommitPaths(root, [git('rev-parse', 'HEAD')])
          .values()
          .next().value,
      ).toEqual([]);
    } finally {
      vi.mocked(execFileSync).mockClear();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
