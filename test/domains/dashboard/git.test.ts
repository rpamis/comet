import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import * as childProcess from 'child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { collectGitSnapshot } from '../../../domains/dashboard/git.js';
import { buildProjectRisks } from '../../../domains/dashboard/risk.js';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

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
        dirtyFiles: null,
        status: 'unavailable',
        dirtyFileList: [],
        dirtyEntries: [],
        recentCommits: [],
      });
    } finally {
      await fs.rm(notRepo, { recursive: true, force: true });
    }
  });

  it('counts status output beyond 1 MiB while bounding displayed entries', async () => {
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: repo,
      input: '',
      encoding: 'utf8',
    }).trim();
    const names = Array.from(
      { length: 4500 },
      (_, index) => `file-${String(index).padStart(5, '0')}-${'x'.repeat(230)}`,
    );
    execFileSync('git', ['update-index', '--index-info'], {
      cwd: repo,
      input: names.map((name) => `100644 ${blob}\t${name}\n`).join(''),
    });
    const snap = await collectGitSnapshot(repo);
    expect(snap.dirtyFiles).toBe(4500);
    expect(snap.status).toBe('available');
    expect(snap.dirtyEntries).toHaveLength(200);
    expect(snap.dirtyEntriesTruncated).toBe(true);
    expect(snap.dirtyFileList).toEqual(names.slice(0, 20));
  });

  it('reports unknown status on command failure instead of a clean repository', async () => {
    await fs.writeFile(path.join(repo, '.git', 'index'), 'corrupt index');
    const snap = await collectGitSnapshot(repo);
    expect(snap.dirtyFiles).toBeNull();
    expect(snap.status).toBe('error');
    expect(snap.dirtyEntries).toEqual([]);
    expect(buildProjectRisks({ git: snap, changes: [] })).toEqual([
      expect.objectContaining({ code: 'GIT_STATUS_UNAVAILABLE', level: 'warning' }),
    ]);
  });

  it('decodes split UTF-8 and rename/copy records without counting source paths', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      kill: vi.fn(),
      unref: vi.fn(),
    });
    const spawn = vi.mocked(childProcess.spawn).mockImplementationOnce(() => {
      queueMicrotask(() => {
        const output = Buffer.from(
          'R  新\n路径.txt\0old.txt\0 C copied.txt\0original.txt\0?? last.txt\0',
        );
        for (const byte of output) child.stdout.write(Buffer.from([byte]));
        child.stdout.end();
        child.emit('close', 0, null);
      });
      return child as unknown as ReturnType<typeof childProcess.spawn>;
    });
    try {
      const snap = await collectGitSnapshot(repo);
      expect(snap.dirtyFiles).toBe(3);
      expect(snap.dirtyEntries).toEqual([
        { path: '新\n路径.txt', status: 'R ' },
        { path: 'copied.txt', status: ' C' },
        { path: 'last.txt', status: '??' },
      ]);
    } finally {
      spawn.mockReset();
    }
  });

  it.each([
    '?? unfinished',
    'R  target\0',
    'x'.repeat(1024 * 1024 + 1),
    '?? ' + 'x'.repeat(1024 * 1024 + 1) + '\0',
  ])('reports unknown for malformed or over-budget status records %#', async (output) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      kill: vi.fn(),
      unref: vi.fn(),
    });
    const spawn = vi.mocked(childProcess.spawn).mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stdout.write(output);
        child.emit('close', 0, null);
      });
      return child as unknown as ReturnType<typeof childProcess.spawn>;
    });
    try {
      expect(await collectGitSnapshot(repo)).toMatchObject({ dirtyFiles: null, status: 'error' });
    } finally {
      spawn.mockReset();
    }
  });

  it('ends a timed-out status scan with unknown rather than partial counts', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      kill: vi.fn(),
      unref: vi.fn(),
    });
    let spawned!: () => void;
    const ready = new Promise<void>((resolve) => {
      spawned = resolve;
    });
    const spawn = vi.mocked(childProcess.spawn).mockImplementationOnce(() => {
      spawned();
      return child as unknown as ReturnType<typeof childProcess.spawn>;
    });
    vi.useFakeTimers();
    try {
      const result = collectGitSnapshot(repo);
      await ready;
      child.stdout.write('?? partial.txt\0');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await result).toMatchObject({ dirtyFiles: null, status: 'error', dirtyEntries: [] });
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      vi.useRealTimers();
      spawn.mockReset();
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
    expect(snap.dirtyEntries).toEqual(
      expect.arrayContaining([
        { path: 'kept.txt', status: ' M' },
        { path: 'fresh.txt', status: '??' },
        { path: 'staged.txt', status: 'A ' },
      ]),
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
    expect(snap.dirtyEntries).toHaveLength(25);
  });

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
    expect(snap.dirtyEntries).toEqual([{ path: '新文件名.txt', status: 'R ' }]);
  });
});
