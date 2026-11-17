import '../helpers/isolated-agent-home.js';
import { spawnSync, execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const cli = path.resolve('bin/comet.js');
const router = path.resolve('assets/skills/comet/scripts/comet-hook-router.mjs');

describe('Native explicit no selection CLI', () => {
  let root: string;
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
    });
  const native = (...args: string[]) => run('native', ...args, '--project-root', root, '--json');
  const edit = (target = 'src/carousel.ts') =>
    spawnSync(process.execPath, [router, '--platform', 'claude', '--project-root', root], {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 'independent-skill',
        cwd: root,
        tool_name: 'Edit',
        tool_input: { file_path: path.join(root, target), old_string: 'old', new_string: 'new' },
      }),
    });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-selection-none-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    const created = native('new', 'pending-shape');
    expect(created.status, created.stderr).toBe(0);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('releases unrelated writes and restores Shape protection through explicit selection', async () => {
    expect(edit().status).toBe(2);
    const before = native('status', 'pending-shape');
    const cleared = native('select', '--none');
    expect(cleared.status, cleared.stdout + cleared.stderr).toBe(0);
    expect(edit().status).toBe(0);
    expect(native('select', '--none').status).toBe(0);
    expect(edit().status).toBe(0);
    const after = native('status', 'pending-shape');
    expect(before.status).toBe(0);
    expect(after.status).toBe(0);
    const original = JSON.parse(before.stdout).data;
    expect(original).toMatchObject({ phase: 'shape', run: { id: 'pending-shape' } });
    expect(JSON.parse(after.stdout).data).toEqual(original);
    const selected = native('select', 'pending-shape');
    expect(selected.status, selected.stdout + selected.stderr).toBe(0);
    expect(edit().status).toBe(2);
  });

  it('keeps explicit none during ambient resume and protects workflow artifacts', async () => {
    expect(native('select', '--none').status).toBe(0);
    const selection = path.join(root, '.comet/current-change.json');
    const before = await fs.readFile(selection, 'utf8');
    const probe = run('resume-probe', root, '--utterance', 'Continue pending-shape', '--json');
    expect(probe.status, probe.stderr).toBe(0);
    expect(JSON.parse(probe.stdout)).toMatchObject({
      action: 'out_of_scope',
      reasonCode: 'no-change-selected',
    });
    expect(await fs.readFile(selection, 'utf8')).toBe(before);
    expect(edit().status).toBe(0);
    for (const target of [
      '.comet/current-change.json',
      '.comet/runtime/state.json',
      'docs/comet/changes/pending-shape/brief.md',
      'docs/comet/specs/example/spec.md',
    ]) {
      expect(edit(target).status, target).toBe(2);
    }
  });

  it('distinguishes missing selection and rejects conflicting deselection arguments', async () => {
    const selection = path.join(root, '.comet/current-change.json');
    const before = await fs.readFile(selection, 'utf8');
    for (const args of [
      ['pending-shape', '--none'],
      ['--none', '--rebind'],
    ]) {
      expect(native('select', ...args).status).not.toBe(0);
      expect(await fs.readFile(selection, 'utf8')).toBe(before);
    }
    await fs.unlink(selection);
    expect(edit().status).toBe(2);
    expect(native('select', '--none').status).toBe(0);
    expect(edit().status).toBe(0);
  });

  it('isolates explicit none from another Git worktree', async () => {
    const planningRoot = root;
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        'commit',
        '--allow-empty',
        '-m',
        'fixture',
      ],
      { cwd: root },
    );
    const other = path.join(root, 'other-worktree');
    execFileSync('git', ['worktree', 'add', '-b', 'independent', other], { cwd: root });
    expect(native('select', '--none').status).toBe(0);
    try {
      root = other;
      expect(native('new', 'other-shape').status).toBe(0);
      expect(edit().status).toBe(2);
    } finally {
      root = planningRoot;
    }
    expect(edit().status).toBe(0);
  });
});
