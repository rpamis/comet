import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
import { selectCurrentChange } from '../../../domains/comet-classic/classic-current-change.js';
import { classicStateCommand } from '../../../domains/comet-classic/classic-state-command.js';
import { readClassicArtifactLayout } from '../../../domains/comet-classic/classic-layout.js';
import { assertClassicOpenSpecRootHealthy } from '../../../domains/comet-classic/classic-openspec-root.js';
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

  it('preserves an uncommitted project configuration when preparing a worktree', async () => {
    git(root, 'rm', '--cached', '.comet/config.yaml');
    git(root, 'commit', '-m', 'leave project configuration local');
    const source = await fs.readFile(path.join(root, '.comet/config.yaml'), 'utf8');
    await fs.writeFile(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
    const prepared = await prepareClassicWorkspace({
      projectRoot: root,
      name: 'local-config',
      isolation: 'worktree',
    });
    worktrees.push(prepared.projectRoot);
    expect(await fs.readFile(path.join(prepared.projectRoot, '.comet/config.yaml'), 'utf8')).toBe(
      source,
    );
    expect(await fs.readFile(path.join(root, '.comet/config.yaml'), 'utf8')).toBe(source);
    expect(await readClassicArtifactLayout(prepared.projectRoot)).toBe('legacy');
    expect((await assertClassicOpenSpecRootHealthy(prepared.projectRoot)).schema).toBe(
      'spec-driven',
    );
    await fs.unlink(path.join(prepared.projectRoot, '.comet/config.yaml'));
    await prepareClassicWorkspace({
      projectRoot: root,
      name: 'local-config',
      isolation: 'worktree',
    });
    expect(await readClassicArtifactLayout(prepared.projectRoot)).toBe('legacy');
  });

  it('rejects a reused worktree with a different Classic configuration without overwriting it', async () => {
    const prepared = await prepareClassicWorkspace({
      projectRoot: root,
      name: 'different-config',
      isolation: 'worktree',
    });
    worktrees.push(prepared.projectRoot);
    const file = path.join(prepared.projectRoot, '.comet/config.yaml');
    const changed = (await fs.readFile(file, 'utf8')).replace(
      'artifact_layout: legacy',
      'artifact_layout: docs',
    );
    await fs.writeFile(file, changed);
    await expect(
      prepareClassicWorkspace({
        projectRoot: root,
        name: 'different-config',
        isolation: 'worktree',
      }),
    ).rejects.toThrow('configuration differs');
    expect(await fs.readFile(file, 'utf8')).toBe(changed);
  });

  it('keeps a managed worktree out of primary status without hiding neighboring user files', async () => {
    const prepared = await prepareClassicWorkspace({
      projectRoot: root,
      name: 'clean-parent',
      isolation: 'worktree',
    });
    worktrees.push(prepared.projectRoot);
    await fs.writeFile(path.join(root, '.worktrees', 'user-notes.txt'), 'keep visible\n');
    const status = git(root, 'status', '--porcelain', '--untracked-files=all');
    expect(status).not.toContain('.worktrees/clean-parent/');
    expect(status).toContain('.worktrees/user-notes.txt');
    expect(
      git(root, 'check-ignore', path.relative(root, prepared.projectRoot).replaceAll('\\', '/')),
    ).toBe('.worktrees/clean-parent');
  });

  it('rejects conflicting OpenSpec configuration when reusing a worktree', async () => {
    await fs.writeFile(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
    const options = {
      projectRoot: root,
      name: 'openspec-conflict',
      isolation: 'worktree' as const,
    };
    const prepared = await prepareClassicWorkspace(options);
    worktrees.push(prepared.projectRoot);
    const file = path.join(prepared.projectRoot, 'openspec/config.yaml');
    await fs.writeFile(file, 'schema: custom\n');
    await expect(prepareClassicWorkspace(options)).rejects.toThrow(
      'OpenSpec configuration differs',
    );
    expect(await fs.readFile(file, 'utf8')).toBe('schema: custom\n');
  });

  it('accepts tracked OpenSpec configuration after Git converts its line endings', async () => {
    git(root, 'config', 'core.autocrlf', 'true');
    await fs.writeFile(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
    git(root, 'add', 'openspec/config.yaml');
    git(root, 'commit', '-m', 'track OpenSpec configuration');
    worktrees.push(path.join(root, '.worktrees', 'tracked-config'));
    const prepared = await prepareClassicWorkspace({
      projectRoot: root,
      name: 'tracked-config',
      isolation: 'worktree',
    });
    expect((await assertClassicOpenSpecRootHealthy(prepared.projectRoot)).schema).toBe(
      'spec-driven',
    );
  });

  it('retries configuration setup after worktree recreation fails', async () => {
    const prepared = await prepareClassicWorkspace({
      projectRoot: root,
      name: 'config-retry',
      isolation: 'worktree',
    });
    worktrees.push(prepared.projectRoot);
    git(root, 'worktree', 'remove', '--force', prepared.projectRoot);
    await seedChange(root, 'config-retry', prepared.changeBranch!);
    const config = path.join(root, 'openspec/config.yaml');
    await fs.writeFile(config, 'x'.repeat(1024 * 1024 + 1));
    await expect(
      resolveClassicWorkspace({ projectRoot: root, name: 'config-retry' }),
    ).rejects.toThrow();
    expect(listGitWorktrees(root).some((entry) => entry.branch === prepared.changeBranch)).toBe(
      true,
    );
    await fs.writeFile(config, 'schema: spec-driven\n');
    const recovered = await resolveClassicWorkspace({ projectRoot: root, name: 'config-retry' });
    expect(recovered.projectRoot).toBe(prepared.projectRoot);
    expect((await assertClassicOpenSpecRootHealthy(recovered.projectRoot)).schema).toBe(
      'spec-driven',
    );
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

  it('preserves a registered worktree with a conflicting change binding during recovery', async () => {
    const prepared = await prepareClassicWorkspace({
      projectRoot: root,
      name: 'binding-conflict',
      isolation: 'worktree',
    });
    worktrees.push(prepared.projectRoot);
    await seedChange(root, 'binding-conflict', prepared.changeBranch!);
    await seedChange(prepared.projectRoot, 'binding-conflict', 'another-branch');
    await expect(
      resolveClassicWorkspace({ projectRoot: root, name: 'binding-conflict' }),
    ).rejects.toThrow('conflicting change binding');
    expect(
      await fs.readFile(
        path.join(prepared.projectRoot, 'openspec/changes/binding-conflict/.comet.yaml'),
        'utf8',
      ),
    ).toContain('bound_branch: another-branch');
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
