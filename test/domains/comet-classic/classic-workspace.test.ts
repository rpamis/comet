import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
import { selectCurrentChange } from '../../../domains/comet-classic/classic-current-change.js';
import { classicStateCommand } from '../../../domains/comet-classic/classic-state-command.js';
import {
  prepareClassicWorkspace,
  resolveClassicWorkspace,
} from '../../../domains/comet-classic/classic-workspace.js';
import { listGitWorktrees } from '../../../platform/paths/git-worktree.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function seedChange(root: string, name: string, branch: string): Promise<void> {
  const directory = path.join(root, 'openspec', 'changes', name);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, '.comet.yaml'),
    [
      'workflow: full',
      'phase: build',
      'design_doc: docs/superpowers/specs/design.md',
      'plan: null',
      'build_mode: executing-plans',
      'isolation: worktree',
      'verify_mode: null',
      'verify_result: pending',
      'verified_at: null',
      `bound_branch: ${branch}`,
      'archived: false',
      '',
    ].join('\n'),
  );
}

describe('Classic workspace preparation and routing', () => {
  let root: string;
  const worktrees: string[] = [];

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-workspace-'));
    git(root, 'init', '-b', 'main');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'Test User');
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'classic:',
        '  artifact_layout: legacy',
        '',
      ].join('\n'),
    );
    await fs.mkdir(path.join(root, 'openspec', 'changes'), { recursive: true });
    await fs.writeFile(path.join(root, 'openspec', 'changes', '.gitkeep'), '');
    await fs.writeFile(path.join(root, 'README.md'), '# Classic workspace\n');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'initial');
  });

  afterEach(async () => {
    for (const worktree of worktrees.splice(0)) {
      try {
        git(root, 'worktree', 'remove', '--force', worktree);
      } catch {
        // Cleanup is best effort; the assertions above are the useful result.
      }
    }
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('prepares, reuses, and routes a Classic change to its linked worktree', async () => {
    const prepared = await prepareClassicWorkspace({
      projectRoot: root,
      name: 'parallel-change',
      isolation: 'worktree',
    });
    worktrees.push(prepared.projectRoot);
    expect(prepared).toMatchObject({
      projectRoot: path.resolve(root, '.worktrees', 'parallel-change'),
      changeBranch: 'comet/parallel-change',
      createdBranch: true,
      createdWorktree: true,
      reusedWorktree: false,
    });
    await seedChange(prepared.projectRoot, 'parallel-change', 'comet/parallel-change');

    const reused = await prepareClassicWorkspace({
      projectRoot: root,
      name: 'parallel-change',
      isolation: 'worktree',
    });
    expect(reused).toMatchObject({
      projectRoot: prepared.projectRoot,
      createdWorktree: false,
      reusedWorktree: true,
    });

    const resolved = await resolveClassicWorkspace({ projectRoot: root, name: 'parallel-change' });
    expect(resolved).toMatchObject({
      projectRoot: prepared.projectRoot,
      branch: 'comet/parallel-change',
      routed: true,
    });

    const selection = await selectCurrentChange(root, 'parallel-change');
    expect(selection.branch).toBe('comet/parallel-change');
    await expect(
      fs.access(path.join(prepared.projectRoot, '.comet', 'current-change.json')),
    ).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, '.comet', 'current-change.json'))).rejects.toThrow();
  });

  it('recreates a linked worktree when its branch remains but registration is gone', async () => {
    const prepared = await prepareClassicWorkspace({
      projectRoot: root,
      name: 'recreated-change',
      isolation: 'worktree',
    });
    const branch = prepared.changeBranch!;
    const removedRoot = prepared.projectRoot;
    await fs.rm(removedRoot, { recursive: true, force: true });
    git(root, 'worktree', 'prune');
    expect(listGitWorktrees(root).some((entry) => entry.branch === branch)).toBe(false);
    await seedChange(root, 'recreated-change', branch);

    const resolved = await resolveClassicWorkspace({ projectRoot: root, name: 'recreated-change' });
    worktrees.push(resolved.projectRoot);
    expect(resolved).toMatchObject({
      branch,
      recreatedWorktree: true,
      routed: true,
    });
    expect(listGitWorktrees(root).find((entry) => entry.branch === branch)?.root).toBe(
      resolved.projectRoot,
    );
  });

  it('rejects traversal in the change name and worktree path', async () => {
    await expect(
      prepareClassicWorkspace({
        projectRoot: root,
        name: '../../outside',
        isolation: 'worktree',
      }),
    ).rejects.toThrow('Invalid change name');

    await expect(
      prepareClassicWorkspace({
        projectRoot: root,
        name: 'safe-change',
        isolation: 'worktree',
        worktreePath: path.resolve(root, '..', 'outside'),
      }),
    ).rejects.toThrow('must remain inside the primary worktree');
  });

  it('initializes a new Classic state with the prepared workspace binding', async () => {
    const result = await withClassicCommandContext({ projectRoot: root, invocationCwd: root }, () =>
      classicStateCommand(['init', 'serial-change', 'full', '--isolation', 'current'], {
        json: false,
        invocationCwd: root,
      }),
    );
    expect(result.exitCode).toBe(0);
    const state = await fs.readFile(
      path.join(root, 'openspec', 'changes', 'serial-change', '.comet.yaml'),
      'utf8',
    );
    expect(state).toContain('isolation: current');
    expect(state).toContain('bound_branch: main');
  });
});
