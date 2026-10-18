import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as git from '../../platform/process/git.js';
import {
  resolveProjectWorktreeRoot,
  withProjectWorktreeRootScope,
} from '../../platform/paths/project-worktree-root.js';

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'comet-root-scope-')));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});
function initialize(directory: string) {
  mkdirSync(directory, { recursive: true });
  execFileSync('git', ['init', directory], { stdio: 'ignore' });
}

describe('request-scoped worktree roots', () => {
  it('reuses the verified root across nested paths and asynchronous learning stages', async () => {
    const project = path.join(root, 'project');
    initialize(project);
    const nested = path.join(project, 'src');
    mkdirSync(nested);
    const runGit = vi.spyOn(git, 'runGitCommand');
    await withProjectWorktreeRootScope(async () => {
      expect(resolveProjectWorktreeRoot(path.relative(process.cwd(), nested))).toBe(project);
      expect(resolveProjectWorktreeRoot(project)).toBe(project);
      await Promise.resolve();
      expect(resolveProjectWorktreeRoot(nested)).toBe(project);
      expect(resolveProjectWorktreeRoot(project)).toBe(project);
    });
    expect(runGit).toHaveBeenCalledTimes(1);
    withProjectWorktreeRootScope(() => resolveProjectWorktreeRoot(project));
    expect(runGit).toHaveBeenCalledTimes(2);
  });

  it('keeps linked worktrees distinct and accepts symlink aliases', async () => {
    const project = path.join(root, 'project');
    initialize(project);
    execFileSync(
      'git',
      [
        '-C',
        project,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        'commit',
        '--allow-empty',
        '-m',
        'initial',
      ],
      { stdio: 'ignore' },
    );
    const linked = path.join(root, 'linked');
    execFileSync('git', ['-C', project, 'worktree', 'add', '-b', 'linked', linked], {
      stdio: 'ignore',
    });
    const alias = path.join(root, 'alias');
    symlinkSync(linked, alias, 'junction');
    const runGit = vi.spyOn(git, 'runGitCommand');
    await withProjectWorktreeRootScope(async () => {
      expect(resolveProjectWorktreeRoot(project)).toBe(project);
      expect(resolveProjectWorktreeRoot(alias)).toBe(linked);
      await Promise.resolve();
      expect(resolveProjectWorktreeRoot(linked)).toBe(linked);
      expect(resolveProjectWorktreeRoot(alias)).toBe(linked);
    });
    expect(runGit).toHaveBeenCalledTimes(2);
  });

  it('rechecks failed lookups and does not retain observations after a scope throws', () => {
    const runGit = vi.spyOn(git, 'runGitCommand').mockImplementationOnce(() => {
      throw new Error('unavailable');
    });
    const project = path.join(root, 'project');
    initialize(project);
    expect(() =>
      withProjectWorktreeRootScope(() => {
        expect(resolveProjectWorktreeRoot(project)).toBe(project);
        expect(resolveProjectWorktreeRoot(project)).toBe(project);
        throw new Error('stop');
      }),
    ).toThrow('stop');
    resolveProjectWorktreeRoot(project);
    expect(runGit).toHaveBeenCalledTimes(3);
  });

  it('does not infer roots for nested repositories from a cached parent', () => {
    const project = path.join(root, 'project');
    const nested = path.join(project, 'nested');
    initialize(project);
    initialize(nested);
    const runGit = vi.spyOn(git, 'runGitCommand');
    withProjectWorktreeRootScope(() => {
      expect(resolveProjectWorktreeRoot(project)).toBe(project);
      expect(resolveProjectWorktreeRoot(nested)).toBe(nested);
      expect(resolveProjectWorktreeRoot(project)).toBe(project);
    });
    expect(runGit).toHaveBeenCalledTimes(2);
  });

  it('clears a rejected asynchronous request before later lookups', async () => {
    const project = path.join(root, 'project');
    initialize(project);
    const runGit = vi.spyOn(git, 'runGitCommand');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let detached!: Promise<string>;
    await expect(
      withProjectWorktreeRootScope(async () => {
        resolveProjectWorktreeRoot(project);
        detached = gate.then(() => resolveProjectWorktreeRoot(project));
        await Promise.resolve();
        throw new Error('rejected');
      }),
    ).rejects.toThrow('rejected');
    release();
    expect(await detached).toBe(project);
    expect(runGit).toHaveBeenCalledTimes(2);
  });

  it('isolates concurrent requests and clears observations for detached callbacks', async () => {
    const project = path.join(root, 'project');
    initialize(project);
    const runGit = vi.spyOn(git, 'runGitCommand');
    await Promise.all(
      [1, 2].map(() =>
        withProjectWorktreeRootScope(async () => {
          resolveProjectWorktreeRoot(project);
          await Promise.resolve();
          resolveProjectWorktreeRoot(project);
        }),
      ),
    );
    expect(runGit).toHaveBeenCalledTimes(2);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let detached!: Promise<string>;
    withProjectWorktreeRootScope(() => {
      resolveProjectWorktreeRoot(project);
      detached = gate.then(() => resolveProjectWorktreeRoot(project));
    });
    release();
    expect(await detached).toBe(project);
    expect(runGit).toHaveBeenCalledTimes(4);
  });
});
