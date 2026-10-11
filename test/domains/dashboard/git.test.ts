import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  collectDashboardGitCommitPage,
  collectDashboardGitFilePage,
  collectGitSnapshot,
} from '../../../domains/dashboard/git.js';
import { buildProjectRisks } from '../../../domains/dashboard/risk.js';

const RUN_OPTS = { stdio: 'pipe' as const, timeout: 10_000 };

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, { ...RUN_OPTS, cwd: repo })
    .toString()
    .trim();
}

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-git-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'comet@test.local']);
  git(dir, ['config', 'user.name', 'Comet Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

function addCommitHistory(repo: string, count: number, prefix = 'commit'): void {
  const tree = git(repo, ['mktree']);
  let parent: string | undefined;
  try {
    parent = git(repo, ['rev-parse', '--verify', 'HEAD']);
  } catch {
    parent = undefined;
  }
  for (let index = 0; index < count; index += 1) {
    parent = git(repo, [
      'commit-tree',
      tree,
      ...(parent ? ['-p', parent] : []),
      '-m',
      `${prefix}-${index}`,
    ]);
  }
  if (parent) git(repo, ['update-ref', 'HEAD', parent]);
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
        recentCommitsHasMore: false,
        dirtyFileListHasMore: false,
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
    expect(new Set(snap.dirtyFileList)).toEqual(new Set(['kept.txt', 'fresh.txt', 'staged.txt']));
  });

  it('previews five dirty paths while retaining the full count and has-more flag', async () => {
    await fs.writeFile(path.join(repo, 'seed.txt'), 'seed');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'seed']);

    for (let i = 0; i < 25; i += 1) {
      await fs.writeFile(path.join(repo, `file-${i}.txt`), String(i));
    }

    const snap = await collectGitSnapshot(repo);
    expect(snap.dirtyFiles).toBe(25);
    expect(snap.dirtyFileList).toHaveLength(5);
    expect(snap.dirtyFileListHasMore).toBe(true);
  });

  it('counts and pages status output above 1 MiB without reporting a clean workspace', async () => {
    const directory = path.join('untracked', 'a'.repeat(96), '目录'.repeat(16));
    await fs.mkdir(path.join(repo, directory), { recursive: true });
    const names = Array.from({ length: 4000 }, (_, index) =>
      path.join(directory, `${String(index).padStart(6, '0')}-${'未跟踪'.repeat(10)}.txt`),
    );
    for (let index = 0; index < names.length; index += 100) {
      await Promise.all(
        names.slice(index, index + 100).map((name) => fs.writeFile(path.join(repo, name), '')),
      );
    }
    const output = execFileSync(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      {
        ...RUN_OPTS,
        cwd: repo,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    expect(output.length).toBeGreaterThan(1024 * 1024);
    const snapshot = await collectGitSnapshot(repo);
    expect.soft(snapshot.dirtyFiles).toBe(names.length);
    expect.soft(snapshot.dirtyFileList).toEqual(names.slice(0, 5));
    expect.soft(snapshot.dirtyFileListHasMore).toBe(true);
    const first = await collectDashboardGitFilePage(repo, { limit: 100 });
    const second = await collectDashboardGitFilePage(repo, {
      limit: 100,
      cursor: first.nextCursor!,
    });
    expect(first.total).toBe(names.length);
    expect(second.total).toBe(names.length);
    expect(first.items).toEqual(names.slice(0, 100));
    expect(second.items).toEqual(names.slice(100, 200));
  });

  it('reports an unknown dirty count when Git status fails', async () => {
    addCommitHistory(repo, 1);
    await fs.writeFile(path.join(repo, '.git', 'index'), 'invalid Git index');
    const snapshot = await collectGitSnapshot(repo);
    expect(snapshot.branch).toBe('main');
    expect(snapshot.dirtyFiles).toBeNull();
    expect(snapshot.dirtyFileList).toEqual([]);
    expect(snapshot.dirtyFileListHasMore).toBe(false);
    expect(buildProjectRisks({ git: snapshot, changes: [] })).toMatchObject([
      { code: 'GIT_STATUS_UNAVAILABLE', level: 'warning' },
    ]);
    await expect(collectDashboardGitFilePage(repo)).rejects.toMatchObject({ statusCode: 500 });
  });

  it.each([0, 5, 6, 105])(
    'previews up to five of %i commits with reliable has-more',
    async (count) => {
      addCommitHistory(repo, count);
      const snapshot = await collectGitSnapshot(repo);
      expect(snapshot.recentCommits).toHaveLength(Math.min(count, 5));
      expect(snapshot.recentCommitsHasMore).toBe(count > 5);
      expect(snapshot.recentCommits.map((line) => line.split(' ')[1])).toEqual(
        Array.from({ length: Math.min(count, 5) }, (_, index) => `commit-${count - 1 - index}`),
      );
    },
  );

  it('probes at most six recent commits without counting the complete history', async () => {
    addCommitHistory(repo, 105);
    const tracePath = path.join(repo, '.git', 'dashboard-git-trace.jsonl');
    vi.stubEnv('GIT_TRACE2_EVENT', tracePath);
    try {
      await collectGitSnapshot(repo);
    } finally {
      vi.unstubAllEnvs();
    }
    const commands = (await fs.readFile(tracePath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { event: string; argv?: string[] })
      .filter((entry) => entry.event === 'start')
      .map((entry) => entry.argv!);
    const logLimits = commands
      .filter((args) => args.includes('log'))
      .map((args) => {
        const limitFlag = args.indexOf('-n');
        return limitFlag === -1
          ? Number(args.find((arg) => /^-\d+$/u.test(arg))?.slice(1))
          : Number(args[limitFlag + 1]);
      });
    expect(logLimits).toContain(6);
    expect(logLimits.every((limit) => limit > 0 && limit <= 6)).toBe(true);
    expect(commands.some((args) => args.includes('rev-list'))).toBe(false);
  });

  it.each([0, 5, 6])(
    'previews %i nested dirty paths without collapsing directory entries',
    async (count) => {
      await fs.mkdir(path.join(repo, 'nested'));
      for (let index = 0; index < count; index += 1) {
        await fs.writeFile(path.join(repo, 'nested', `file-${index}.txt`), String(index));
      }
      const snapshot = await collectGitSnapshot(repo);
      expect(snapshot.dirtyFiles).toBe(count);
      expect(snapshot.dirtyFileList).toHaveLength(Math.min(count, 5));
      expect(snapshot.dirtyFileListHasMore).toBe(count > 5);
      expect(snapshot.dirtyFileList.every((file) => file.startsWith('nested/file-'))).toBe(true);
    },
  );

  it.each(['true', 'false'] as const)(
    'shows non-ASCII and spaced filenames verbatim with core.quotePath=%s',
    async (quotepath) => {
      await fs.mkdir(path.join(repo, 'docs'));
      await fs.writeFile(path.join(repo, 'docs', 'kept.md'), 'kept');
      git(repo, ['add', '.']);
      git(repo, ['commit', '-q', '-m', 'seed']);

      git(repo, ['config', 'core.quotepath', quotepath]);
      await fs.writeFile(path.join(repo, 'docs', '仪表盘快照测试-草稿.md'), 'zh');
      await fs.writeFile(path.join(repo, 'name with spaces.txt'), 'space');

      const snap = await collectGitSnapshot(repo);
      expect(snap.dirtyFiles).toBe(2);
      expect(new Set(snap.dirtyFileList)).toEqual(
        new Set(['docs/仪表盘快照测试-草稿.md', 'name with spaces.txt']),
      );
    },
  );

  it('shows the new path for renamed files', async () => {
    await fs.writeFile(path.join(repo, 'old-name.txt'), 'content');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'seed']);

    git(repo, ['mv', 'old-name.txt', '新文件名.txt']);

    const snap = await collectGitSnapshot(repo);
    expect(snap.dirtyFiles).toBe(1);
    expect(snap.dirtyFileList).toEqual(['新文件名.txt']);
  });
});

describe('Git detail pages', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it('returns empty pages for an unborn repository', async () => {
    await expect(collectDashboardGitCommitPage(repo)).resolves.toEqual({
      items: [],
      nextCursor: null,
      total: null,
    });
    await expect(collectDashboardGitFilePage(repo)).resolves.toEqual({
      items: [],
      nextCursor: null,
      total: 0,
    });
  });

  it('paginates long commit histories with a default of 50 and a maximum of 100', async () => {
    addCommitHistory(repo, 105);
    const first = await collectDashboardGitCommitPage(repo);
    expect(first.items).toHaveLength(50);
    expect(first.total).toBeNull();
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await collectDashboardGitCommitPage(repo, { cursor: first.nextCursor! });
    expect(second.items).toHaveLength(50);
    const third = await collectDashboardGitCommitPage(repo, { cursor: second.nextCursor! });
    expect(third.items).toHaveLength(5);
    expect(third.nextCursor).toBeNull();
    const all = [...first.items, ...second.items, ...third.items];
    expect(new Set(all).size).toBe(105);
    expect(all.map((line) => line.split(' ')[1])).toEqual(
      Array.from({ length: 105 }, (_, index) => `commit-${104 - index}`),
    );
    const maximum = await collectDashboardGitCommitPage(repo, { limit: 100 });
    expect(maximum.items).toHaveLength(100);
    expect(maximum.nextCursor).toEqual(expect.any(String));
  });

  it('keeps the initial HEAD when commits arrive between pages', async () => {
    addCommitHistory(repo, 7);
    const first = await collectDashboardGitCommitPage(repo, { limit: 3 });
    addCommitHistory(repo, 2, 'new');
    const second = await collectDashboardGitCommitPage(repo, {
      limit: 3,
      cursor: first.nextCursor!,
    });
    const third = await collectDashboardGitCommitPage(repo, {
      limit: 3,
      cursor: second.nextCursor!,
    });
    expect(
      [...first.items, ...second.items, ...third.items].map((line) => line.split(' ')[1]),
    ).toEqual(Array.from({ length: 7 }, (_, index) => `commit-${6 - index}`));
    expect(third.nextCursor).toBeNull();
    expect((await collectDashboardGitCommitPage(repo)).items[0]).toContain('new-1');
  });

  it('rejects a commit cursor whose original HEAD object is no longer available', async () => {
    addCommitHistory(repo, 2);
    const first = await collectDashboardGitCommitPage(repo, { limit: 1 });
    const head = git(repo, ['rev-parse', 'HEAD']);
    await fs.rm(path.join(repo, '.git', 'objects', head.slice(0, 2), head.slice(2)));
    await expect(
      collectDashboardGitCommitPage(repo, { limit: 1, cursor: first.nextCursor! }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: '提交分页对应的版本已不可用，请重新加载。',
    });
  });

  it('returns every dirty path with an exact total beyond the old twenty-path preview', async () => {
    await fs.mkdir(path.join(repo, 'nested'));
    const names = Array.from(
      { length: 27 },
      (_, index) => `nested/文件 ${String(index).padStart(2, '0')}.txt`,
    );
    for (const name of names) await fs.writeFile(path.join(repo, name), name);
    const first = await collectDashboardGitFilePage(repo, { limit: 10 });
    const second = await collectDashboardGitFilePage(repo, {
      limit: 10,
      cursor: first.nextCursor!,
    });
    const third = await collectDashboardGitFilePage(repo, {
      limit: 10,
      cursor: second.nextCursor!,
    });
    for (const page of [first, second, third]) expect(page.total).toBe(27);
    expect(third.nextCursor).toBeNull();
    const all = [...first.items, ...second.items, ...third.items];
    expect(new Set(all).size).toBe(27);
    expect(new Set(all)).toEqual(new Set(names));
  });

  it('rejects a file cursor after the status list changes', async () => {
    for (const name of ['a.txt', 'b.txt']) await fs.writeFile(path.join(repo, name), name);
    const first = await collectDashboardGitFilePage(repo, { limit: 1 });
    await fs.writeFile(path.join(repo, '0.txt'), 'new earlier entry');
    await expect(
      collectDashboardGitFilePage(repo, { cursor: first.nextCursor! }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Git 文件列表已变化，请重新加载。',
    });
  });

  it('rejects cursors from another project or list and invalid Git argument values', async () => {
    addCommitHistory(repo, 2);
    const first = await collectDashboardGitCommitPage(repo, { limit: 1 });
    const other = await makeRepo();
    try {
      await expect(
        collectDashboardGitCommitPage(other, { cursor: first.nextCursor! }),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        collectDashboardGitFilePage(repo, { cursor: first.nextCursor! }),
      ).rejects.toMatchObject({ statusCode: 400 });
      const cursor = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString()) as Record<
        string,
        unknown
      >;
      const unsafe = Buffer.from(JSON.stringify({ ...cursor, anchor: '--all' })).toString(
        'base64url',
      );
      await expect(collectDashboardGitCommitPage(repo, { cursor: unsafe })).rejects.toMatchObject({
        statusCode: 400,
      });
      for (const value of ['', '../HEAD', '--all', 'not-a-cursor']) {
        await expect(collectDashboardGitCommitPage(repo, { cursor: value })).rejects.toMatchObject({
          statusCode: 400,
        });
      }
      for (const limit of [0, -1, 1.5, 101, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        await expect(collectDashboardGitCommitPage(repo, { limit })).rejects.toMatchObject({
          statusCode: 400,
        });
        await expect(collectDashboardGitFilePage(repo, { limit })).rejects.toMatchObject({
          statusCode: 400,
        });
      }
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });

  it('fails explicitly for non-repositories and damaged Git data', async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-notgit-'));
    try {
      await expect(collectDashboardGitCommitPage(other)).rejects.toMatchObject({ statusCode: 500 });
      await expect(collectDashboardGitFilePage(other)).rejects.toMatchObject({ statusCode: 500 });
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
    addCommitHistory(repo, 1);
    const head = git(repo, ['rev-parse', 'HEAD']);
    await fs.rm(path.join(repo, '.git', 'objects', head.slice(0, 2), head.slice(2)));
    await expect(collectDashboardGitCommitPage(repo)).rejects.toMatchObject({ statusCode: 500 });
    await fs.writeFile(path.join(repo, '.git', 'index'), 'invalid Git index');
    await expect(collectDashboardGitFilePage(repo)).rejects.toMatchObject({ statusCode: 500 });
  });
});
