import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCurrentChange,
  currentChangeFile,
  resolveCurrentChange,
  selectCurrentChange,
} from '../../../domains/comet-classic/classic-current-change.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function seedActiveChange(root: string, name: string, archived: boolean): Promise<void> {
  const changeDir = path.join(root, 'openspec', 'changes', name);
  await fs.mkdir(changeDir, { recursive: true });
  await fs.writeFile(
    path.join(changeDir, '.comet.yaml'),
    [
      'workflow: full',
      'phase: build',
      'design_doc: docs/superpowers/specs/design.md',
      'plan: null',
      'build_mode: executing-plans',
      'isolation: branch',
      'verify_mode: null',
      'verify_result: pending',
      'verified_at: null',
      `archived: ${archived}`,
      '',
    ].join('\n'),
  );
}

describe('Classic current change selection', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-current-change-'));
    git(root, 'init', '-b', 'main');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'Test User');
    await fs.writeFile(path.join(root, 'README.md'), '# Test\n');
    git(root, 'add', 'README.md');
    git(root, 'commit', '-m', 'init');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('atomically selects an active change with the current branch', async () => {
    await seedActiveChange(root, 'change-a', false);

    const selected = await selectCurrentChange(root, 'change-a');

    expect(selected).toEqual({ version: 1, change: 'change-a', branch: 'main' });
    expect(JSON.parse(await fs.readFile(currentChangeFile(root), 'utf8'))).toEqual(selected);
    expect((await fs.readdir(path.join(root, '.comet'))).sort()).toEqual(['current-change.json']);
  });

  it('rejects missing, archived, and invalid changes', async () => {
    await expect(selectCurrentChange(root, '../escape')).rejects.toThrow('Invalid change name');
    await expect(selectCurrentChange(root, 'missing')).rejects.toThrow('active change');
    await seedActiveChange(root, 'archived-change', true);
    await expect(selectCurrentChange(root, 'archived-change')).rejects.toThrow('archived');
  });

  it('marks a selection stale after the branch changes', async () => {
    await seedActiveChange(root, 'change-a', false);
    await selectCurrentChange(root, 'change-a');

    git(root, 'switch', '-c', 'other');

    expect(await resolveCurrentChange(root)).toEqual({
      status: 'stale',
      reason: "current change 'change-a' was selected on branch 'main', current branch is 'other'",
    });
  });

  it('reports malformed selection data as stale instead of missing', async () => {
    await fs.mkdir(path.dirname(currentChangeFile(root)), { recursive: true });
    await fs.writeFile(currentChangeFile(root), '{not-json\n');

    const resolution = await resolveCurrentChange(root);

    expect(resolution.status).toBe('stale');
    expect(resolution).toMatchObject({ reason: expect.stringContaining('invalid JSON') });
  });

  it('reports unreadable selection paths as stale instead of missing', async () => {
    await fs.mkdir(currentChangeFile(root), { recursive: true });

    const resolution = await resolveCurrentChange(root);

    expect(resolution.status).toBe('stale');
    expect(resolution).toMatchObject({
      reason: expect.stringContaining('cannot read current change selection'),
    });
  });

  it('marks selections stale when the selected change disappears or becomes archived', async () => {
    await seedActiveChange(root, 'change-a', false);
    await selectCurrentChange(root, 'change-a');

    await fs.rm(path.join(root, 'openspec', 'changes', 'change-a'), { recursive: true });
    expect(await resolveCurrentChange(root)).toMatchObject({
      status: 'stale',
      reason: expect.stringContaining('active change state not found'),
    });

    await seedActiveChange(root, 'change-a', false);
    await selectCurrentChange(root, 'change-a');
    await seedActiveChange(root, 'change-a', true);
    expect(await resolveCurrentChange(root)).toEqual({
      status: 'stale',
      reason: "Cannot select current change 'change-a': change is archived",
    });
  });

  it('cleans temporary files when atomic replacement fails', async () => {
    await seedActiveChange(root, 'change-a', false);
    await fs.mkdir(currentChangeFile(root), { recursive: true });

    await expect(selectCurrentChange(root, 'change-a')).rejects.toThrow();

    expect((await fs.readdir(path.join(root, '.comet'))).sort()).toEqual(['current-change.json']);
  });

  it('clears the selection idempotently', async () => {
    await clearCurrentChange(root);
    await clearCurrentChange(root);

    expect(await exists(currentChangeFile(root))).toBe(false);
  });
});
