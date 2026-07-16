import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectGitRepository } from '../../platform/process/git-repository.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function initializeRepository(repositoryRoot: string): Promise<void> {
  await fs.mkdir(repositoryRoot, { recursive: true });
  git(repositoryRoot, ['init', '--quiet']);
  git(repositoryRoot, ['config', 'user.email', 'comet-test@example.com']);
  git(repositoryRoot, ['config', 'user.name', 'Comet Test']);
  git(repositoryRoot, ['config', 'commit.gpgSign', 'false']);
}

async function commitAll(repositoryRoot: string, message: string): Promise<void> {
  git(repositoryRoot, ['add', '--all']);
  git(repositoryRoot, ['commit', '--quiet', '-m', message]);
}

describe('inspectGitRepository', () => {
  let temporaryRoot: string;

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-git-repository-'));
  });

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  it('returns runtime identity and project-relative paths from a nested project', async () => {
    const repositoryRoot = path.join(temporaryRoot, 'repository with spaces');
    const projectRoot = path.join(repositoryRoot, 'packages', 'app');
    await initializeRepository(repositoryRoot);
    await fs.mkdir(path.join(projectRoot, 'nested'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'tracked.txt'), 'before\n');
    await commitAll(repositoryRoot, 'initial');

    await fs.writeFile(path.join(projectRoot, 'tracked.txt'), 'after\n');
    await fs.writeFile(path.join(projectRoot, 'nested', 'new.txt'), 'new\n');

    const inspection = await inspectGitRepository(projectRoot);
    const expectedHead = git(repositoryRoot, ['rev-parse', 'HEAD']);
    const expectedBranch = git(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);

    expect(inspection).toEqual({
      available: true,
      head: expectedHead,
      branch: expectedBranch,
      worktreeRoot: path.normalize(repositoryRoot),
      commonDir: path.join(path.normalize(repositoryRoot), '.git'),
      changedPaths: ['nested/new.txt', 'tracked.txt'],
      failure: null,
    });
  });

  it('includes both sides of a rename and untracked files', async () => {
    const repositoryRoot = path.join(temporaryRoot, 'rename-repository');
    await initializeRepository(repositoryRoot);
    await fs.writeFile(path.join(repositoryRoot, 'old name.txt'), 'tracked\n');
    await commitAll(repositoryRoot, 'initial');

    await fs.mkdir(path.join(repositoryRoot, 'nested'));
    git(repositoryRoot, ['mv', 'old name.txt', 'nested/new name.txt']);
    await fs.writeFile(path.join(repositoryRoot, 'untracked file.txt'), 'untracked\n');

    const inspection = await inspectGitRepository(repositoryRoot);

    expect(inspection.available).toBe(true);
    if (!inspection.available) throw new Error('expected repository inspection to succeed');
    expect(inspection.changedPaths).toEqual([
      'nested/new name.txt',
      'old name.txt',
      'untracked file.txt',
    ]);
  });

  it('filters repository changes outside the project and keeps only the in-project rename side', async () => {
    const repositoryRoot = path.join(temporaryRoot, 'monorepo');
    const projectRoot = path.join(repositoryRoot, 'packages', 'app');
    const siblingRoot = path.join(repositoryRoot, 'packages', 'sibling');
    await initializeRepository(repositoryRoot);
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(siblingRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'inside.txt'), 'before\n');
    await fs.writeFile(path.join(projectRoot, 'move-out.txt'), 'move out\n');
    await fs.writeFile(path.join(siblingRoot, 'outside.txt'), 'before\n');
    await fs.writeFile(path.join(siblingRoot, 'move-in.txt'), 'move in\n');
    await commitAll(repositoryRoot, 'initial');

    await fs.writeFile(path.join(projectRoot, 'inside.txt'), 'after\n');
    await fs.writeFile(path.join(siblingRoot, 'outside.txt'), 'after\n');
    await fs.writeFile(path.join(siblingRoot, 'outside-untracked.txt'), 'outside\n');
    git(repositoryRoot, ['mv', 'packages/app/move-out.txt', 'packages/sibling/moved-out.txt']);
    git(repositoryRoot, ['mv', 'packages/sibling/move-in.txt', 'packages/app/moved-in.txt']);

    const inspection = await inspectGitRepository(projectRoot);

    expect(inspection.available).toBe(true);
    if (!inspection.available) throw new Error('expected repository inspection to succeed');
    expect(inspection.changedPaths).toEqual(['inside.txt', 'move-out.txt', 'moved-in.txt']);
    expect(inspection.changedPaths.every((changedPath) => !changedPath.startsWith('../'))).toBe(
      true,
    );
  });

  it('reports the shared common directory for a linked worktree', async () => {
    const repositoryRoot = path.join(temporaryRoot, 'primary-repository');
    const linkedWorktree = path.join(temporaryRoot, 'linked-worktree');
    await initializeRepository(repositoryRoot);
    await fs.writeFile(path.join(repositoryRoot, 'tracked.txt'), 'tracked\n');
    await commitAll(repositoryRoot, 'initial');
    git(repositoryRoot, ['worktree', 'add', '--quiet', '-b', 'linked-test', linkedWorktree]);

    const inspection = await inspectGitRepository(linkedWorktree);

    expect(inspection.available).toBe(true);
    if (!inspection.available) throw new Error('expected repository inspection to succeed');
    expect(inspection.worktreeRoot).toBe(path.normalize(linkedWorktree));
    expect(inspection.commonDir).toBe(path.join(path.normalize(repositoryRoot), '.git'));
  });

  it('represents an unborn repository without inventing a HEAD', async () => {
    const repositoryRoot = path.join(temporaryRoot, 'unborn-repository');
    await initializeRepository(repositoryRoot);
    await fs.writeFile(path.join(repositoryRoot, 'first.txt'), 'untracked\n');

    const inspection = await inspectGitRepository(repositoryRoot);

    expect(inspection.available).toBe(true);
    if (!inspection.available) throw new Error('expected repository inspection to succeed');
    expect(inspection.head).toBeNull();
    expect(inspection.branch).toBeTruthy();
    expect(inspection.changedPaths).toEqual(['first.txt']);
  });

  it('degrades explicitly outside a Git repository', async () => {
    const projectRoot = path.join(temporaryRoot, 'plain-directory');
    await fs.mkdir(projectRoot);

    const inspection = await inspectGitRepository(projectRoot);

    expect(inspection).toEqual({
      available: false,
      head: null,
      branch: null,
      worktreeRoot: null,
      commonDir: null,
      changedPaths: null,
      failure: {
        kind: 'not-repository',
        operation: 'discovery',
      },
    });
  });
});
