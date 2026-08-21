import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { classicWorkspaceCommand } from '../../../domains/comet-classic/classic-workspace-command.js';

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
      'isolation: current',
      'verify_mode: null',
      'verify_result: pending',
      'verified_at: null',
      `bound_branch: ${branch}`,
      'archived: false',
      '',
    ].join('\n'),
  );
}

// Regression coverage for GitHub issue #335: `classicWorkspaceCommand` used to
// call `classicCommandProjectRoot()` without ever establishing the command
// context, so every invocation failed with "Classic command project context
// is unavailable" regardless of arguments. These tests call the handler the
// same way the CLI dispatcher does — directly, with no context pre-established
// by the caller — to prove `withProjectContext` fixes that for every isolation
// mode and both subcommands.
describe('classicWorkspaceCommand', () => {
  let root: string;
  const worktrees: string[] = [];

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-workspace-command-'));
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
    await fs.writeFile(path.join(root, 'README.md'), '# workspace command\n');
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

  it.each(['current', 'branch', 'worktree'] as const)(
    'prepares a workspace with %s isolation without a caller-established context',
    async (isolation) => {
      const result = await classicWorkspaceCommand(
        ['prepare', `change-${isolation}`, '--isolation', isolation],
        { json: false, invocationCwd: root, projectRoot: root },
      );

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout!);
      expect(parsed).toMatchObject({ action: 'prepare', isolation });
      if (isolation === 'worktree') worktrees.push(parsed.projectRoot);
    },
  );

  it('resolves a workspace without a caller-established context', async () => {
    await seedChange(root, 'resolve-target', 'main');

    const result = await classicWorkspaceCommand(['resolve', 'resolve-target'], {
      json: false,
      invocationCwd: root,
      projectRoot: root,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout!);
    expect(parsed).toMatchObject({
      action: 'resolve',
      change: 'resolve-target',
      projectRoot: root,
      branch: 'main',
      routed: false,
    });
  });

  it('surfaces the underlying business error instead of a context error for an unknown change', async () => {
    await expect(
      classicWorkspaceCommand(['resolve', 'never-created'], {
        json: false,
        invocationCwd: root,
        projectRoot: root,
      }),
    ).rejects.toThrow(
      "Classic change 'never-created' was not found in any registered Git worktree",
    );
  });
});
