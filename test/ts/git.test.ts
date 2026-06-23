import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { collectGitSnapshot } from '../../src/dashboard/git.js';

const RUN_OPTS = { stdio: 'pipe' as const, timeout: 10_000 };

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { ...RUN_OPTS, cwd: repo }).toString().trim();
}

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-git-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'comet@test.local']);
  git(dir, ['config', 'user.name', 'Comet Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

describe('collectGitSnapshot', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it('returns null fields and empty lists for a non-git directory', async () => {
    const notRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-notgit-'));
    try {
      const snap = await collectGitSnapshot(notRepo);
      expect(snap).toEqual({
        branch: null,
        head: null,
        dirtyFiles: 0,
        dirtyFileList: [],
        recentCommits: [],
      });
    } finally {
      await fs.rm(notRepo, { recursive: true, force: true });
    }
  });

  it('reports branch, head, and the latest commits', async () => {
    await fs.writeFile(path.join(repo, 'a.txt'), 'one');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'feat: first']);
    await fs.writeFile(path.join(repo, 'b.txt'), 'two');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'feat: second']);
    await fs.writeFile(path.join(repo, 'c.txt'), 'three');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'fix: third']);

    const snap = await collectGitSnapshot(repo);
    expect(snap.branch).toBe('main');
    expect(snap.head).toMatch(/^[0-9a-f]{7,40} fix: third$/);
    expect(snap.recentCommits).toHaveLength(3);
    expect(snap.recentCommits[0]).toContain('fix: third');
    expect(snap.dirtyFiles).toBe(0);
    expect(snap.dirtyFileList).toEqual([]);
  });

  it('lists modified, untracked, and staged files in the dirty snapshot', async () => {
    await fs.writeFile(path.join(repo, 'kept.txt'), 'kept');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'init']);

    await fs.writeFile(path.join(repo, 'kept.txt'), 'kept-edit');
    await fs.writeFile(path.join(repo, 'fresh.txt'), 'new');
    await fs.writeFile(path.join(repo, 'staged.txt'), 'will be staged');
    git(repo, ['add', 'staged.txt']);

    const snap = await collectGitSnapshot(repo);
    expect(snap.dirtyFiles).toBe(3);
    expect(new Set(snap.dirtyFileList)).toEqual(
      new Set(['kept.txt', 'fresh.txt', 'staged.txt']),
    );
  });

  it('caps dirty file list at 20 entries', async () => {
    await fs.writeFile(path.join(repo, 'seed.txt'), 'seed');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'seed']);

    for (let i = 0; i < 25; i += 1) {
      await fs.writeFile(path.join(repo, `file-${i}.txt`), String(i));
    }

    const snap = await collectGitSnapshot(repo);
    expect(snap.dirtyFiles).toBe(25);
    expect(snap.dirtyFileList).toHaveLength(20);
  });
});
