import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
import { classicTaskRevision } from '../../../domains/comet-classic/classic-tasks.js';
import { ensureClassicRuntimeRun } from '../../../domains/comet-classic/classic-runtime-run.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

describe('Classic compact recovery and task reconciliation', () => {
  let root: string;
  let change: string;
  const cli = (...args: string[]) =>
    withClassicCommandContext({ projectRoot: root, invocationCwd: root }, () =>
      runClassicCli(args),
    );
  const tasks = '- [ ] existing implementation <!-- comet-task:a -->\n';
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-recovery-contract-'));
    await prepareClassicLegacyProject(root);
    expect((await cli('state', 'init', 'demo', 'hotfix')).exitCode).toBe(0);
    change = path.join(root, 'openspec/changes/demo');
    await fs.writeFile(path.join(change, 'tasks.md'), tasks);
    await fs.writeFile(path.join(change, 'proposal.md'), 'Repair implementation\n');
    await fs.writeFile(path.join(root, 'plan.md'), '- [ ] implementation <!-- comet-task:a -->\n');
    expect((await cli('state', 'set', 'demo', 'plan', 'plan.md')).exitCode).toBe(0);
    const statePath = path.join(change, '.comet.yaml');
    await fs.writeFile(
      statePath,
      (await fs.readFile(statePath, 'utf8')).replace('phase: open', 'phase: build'),
    );
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it('returns layout and reconcile action at entry without expanding the full task list', async () => {
    const result = await cli('state', 'check', 'demo', 'build', '--json');
    expect(result.exitCode, result.stdout).toBe(0);
    const { data } = JSON.parse(result.stdout!);
    expect(data.layout).toMatchObject({
      schema: 'comet.classic-layout.v1',
      changesRoot: path.join(root, 'openspec/changes'),
    });
    expect(data.nextAction).toMatchObject({ kind: 'reconcile-task', taskId: 'a' });
    expect(data.taskState).toMatchObject({ total: 1, completed: 0, next: { id: 'a' } });
    expect(data.taskState.tasks).toBeUndefined();
  });

  it.each(['drift', 'unbound-detached'] as const)(
    'rejects all task writes on %s workspaces without changing files',
    async (mode) => {
      const git = (...args: string[]) =>
        execFileSync(
          'git',
          ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args],
          { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
      git('init', '-b', 'main');
      git('add', '.');
      git('commit', '-m', 'fixture');
      expect((await cli('state', 'set', 'demo', 'isolation', 'branch')).exitCode).toBe(0);
      const statePath = path.join(change, '.comet.yaml');
      if (mode === 'drift') git('checkout', '-b', 'other');
      else {
        git('checkout', '--detach', 'HEAD');
        await fs.writeFile(
          statePath,
          (await fs.readFile(statePath, 'utf8')).replace(
            'bound_branch: main',
            'bound_branch: null',
          ),
        );
      }
      const files = [statePath, path.join(change, 'tasks.md'), path.join(root, 'plan.md')];
      const before = await Promise.all(files.map((file) => fs.readFile(file, 'utf8')));
      for (const args of [
        ['task-complete', 'demo', 'a', '--expect', classicTaskRevision(tasks)],
        ['tasks', 'demo', '--assign-ids'],
        ['sync-plan', 'demo'],
      ]) {
        const result = await cli('state', ...args);
        expect(result.exitCode, result.stdout).not.toBe(0);
        expect(await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))).toEqual(before);
      }
    },
  );

  it.each(['archived-string', 'invalid-enum', 'unknown-field', 'duplicate-field'] as const)(
    'validates the complete schema before task writes: %s',
    async (malformed) => {
      const statePath = path.join(change, '.comet.yaml');
      const source = await fs.readFile(statePath, 'utf8');
      const invalid =
        malformed === 'archived-string'
          ? source.replace('archived: false', 'archived: "true"')
          : malformed === 'invalid-enum'
            ? source.replace('build_mode: direct', 'build_mode: invalid')
            : source + (malformed === 'unknown-field' ? 'unknown_field: true\n' : 'phase: build\n');
      await fs.writeFile(statePath, invalid);
      const files = [statePath, path.join(change, 'tasks.md'), path.join(root, 'plan.md')];
      const before = await Promise.all(files.map((file) => fs.readFile(file, 'utf8')));
      for (const args of [
        ['task-complete', 'demo', 'a', '--expect', classicTaskRevision(tasks)],
        ['tasks', 'demo', '--assign-ids'],
        ['sync-plan', 'demo'],
      ]) {
        expect((await cli('state', ...args)).exitCode).not.toBe(0);
        expect(await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))).toEqual(before);
      }
    },
  );

  it.each([
    { stage: 'done', unresolved: ['tests failed'], expected: 'blocked' },
    { stage: 'checkoff', unresolved: ['review incomplete'], expected: 'blocked' },
    { stage: 'done', unresolved: [], expected: 'checkoff' },
    { stage: 'task-review', unresolved: ['review pending'], expected: 'review' },
  ])(
    'resolves completion checkpoint $stage with unresolved=$unresolved to $expected',
    async ({ stage, unresolved, expected }) => {
      await fs.writeFile(
        path.join(root, 'checkpoint-input.json'),
        JSON.stringify({
          schemaVersion: 1,
          taskIds: ['a'],
          revision: classicTaskRevision(tasks),
          stage,
          sessionId: 'worker',
          evidence: [],
          unresolved,
          reviewRounds: 0,
        }),
      );
      expect(
        (await cli('state', 'checkpoint', 'demo', '--file', 'checkpoint-input.json')).exitCode,
      ).toBe(0);
      const recovered = await cli('state', 'check', 'demo', 'build', '--recover', '--json');
      expect(recovered.exitCode, recovered.stdout).toBe(0);
      expect(JSON.parse(recovered.stdout!).data.nextAction).toMatchObject({
        kind: expected,
        taskId: 'a',
      });
      expect(await fs.readFile(path.join(change, 'tasks.md'), 'utf8')).toBe(tasks);
    },
  );
  it('records accepted completion and synchronizes a mapped plan without executing implementation', async () => {
    const result = await cli(
      'state',
      'task-complete',
      'demo',
      'a',
      '--expect',
      classicTaskRevision(tasks),
      '--json',
    );
    expect(result.exitCode, result.stdout).toBe(0);
    expect(await fs.readFile(path.join(root, 'plan.md'), 'utf8')).toContain('- [x] implementation');
    const recovered = await cli('state', 'check', 'demo', 'build', '--recover', '--json');
    expect(JSON.parse(recovered.stdout!).data.nextAction.kind).toBe('check');
    expect(recovered.stdout).not.toContain('first unchecked Superpowers plan task');
  });
  it('reports extra plan tasks for explicit reconciliation, not automatic reimplementation', async () => {
    await fs.writeFile(path.join(root, 'plan.md'), '- [ ] untracked requirement\n');
    const result = await cli('state', 'check', 'demo', 'build', '--recover', '--json');
    expect(result.exitCode, result.stdout).toBe(0);
    expect(JSON.parse(result.stdout!).data.nextAction.kind).toBe('reconcile-plan');
    expect(await fs.readFile(path.join(root, 'plan.md'), 'utf8')).toBe(
      '- [ ] untracked requirement\n',
    );
  });
  it('expands tasks only on explicit details and rejects unknown entry options', async () => {
    const result = await cli('state', 'check', 'demo', 'build', '--recover', '--details', '--json');
    expect(result.exitCode, result.stdout).toBe(0);
    expect(JSON.parse(result.stdout!).data.taskState.tasks).toHaveLength(1);
    expect((await cli('state', 'check', 'demo', 'build', '--unexpected')).exitCode).not.toBe(0);
  });
  it('resumes review from a structured checkpoint instead of restarting unchecked implementation', async () => {
    const checkpoint = {
      schemaVersion: 1,
      taskIds: ['a'],
      revision: classicTaskRevision(tasks),
      stage: 'task-review',
      sessionId: 'implementer-a',
      evidence: ['commit:abc'],
      unresolved: ['independent review'],
      reviewRounds: 1,
    };
    await fs.writeFile(path.join(root, 'checkpoint-input.json'), JSON.stringify(checkpoint));
    const saved = await cli(
      'state',
      'checkpoint',
      'demo',
      '--file',
      'checkpoint-input.json',
      '--json',
    );
    expect(saved.exitCode, saved.stdout).toBe(0);
    const recovered = await cli('state', 'check', 'demo', 'build', '--recover', '--json');
    expect(recovered.exitCode, recovered.stdout).toBe(0);
    const { data } = JSON.parse(recovered.stdout!);
    expect(data.nextAction).toMatchObject({ kind: 'review', taskId: 'a' });
    expect(data.coordination).toMatchObject({
      stage: 'task-review',
      stale: false,
      reviewRounds: 1,
    });
    expect(data.coordination.checkpoint).toBeUndefined();
    expect(data.checkpoint.content).toBeUndefined();
    expect(await fs.readFile(path.join(change, '.comet/subagent-progress.md'), 'utf8')).toContain(
      'task-review',
    );
    const changed = tasks.replace('existing implementation', 'new requirements');
    await fs.writeFile(path.join(change, 'tasks.md'), changed);
    const stale = JSON.parse(
      (await cli('state', 'check', 'demo', 'build', '--recover', '--json')).stdout!,
    ).data;
    expect(stale.coordination.stale).toBe(true);
    expect(stale.nextAction.kind).toBe('reconcile-task');
  });
  it('repairs stale mapped plan projections explicitly without changing task acceptance', async () => {
    await fs.writeFile(path.join(change, 'tasks.md'), tasks.replace('[ ]', '[x]'));
    const result = await cli('state', 'sync-plan', 'demo', '--json');
    expect(result.exitCode, result.stdout).toBe(0);
    expect(JSON.parse(result.stdout!).data.planSync).toBe('synced');
    expect(await fs.readFile(path.join(root, 'plan.md'), 'utf8')).toContain('[x]');
  });
  it('invalidates delivery authorization before archive-reopen and never infers legacy completion', async () => {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    const statePath = path.join(change, '.comet.yaml');
    await fs.writeFile(
      statePath,
      (await fs.readFile(statePath, 'utf8'))
        .replace('phase: build', 'phase: archive')
        .replace('verify_result: pending', 'verify_result: pass'),
    );
    await ensureClassicRuntimeRun(change);
    await fs.writeFile(
      path.join(root, 'delivery-input.json'),
      JSON.stringify({ action: 'local', targetBranch: 'main' }),
    );
    const authorized = await cli(
      'state',
      'delivery',
      'demo',
      '--file',
      'delivery-input.json',
      '--json',
    );
    expect(authorized.exitCode, authorized.stdout).toBe(0);
    const reopened = await cli('state', 'transition', 'demo', 'archive-reopen', '--json');
    expect(reopened.exitCode, reopened.stdout).toBe(0);
    const inspected = await cli('state', 'delivery', 'demo', '--json');
    expect(JSON.parse(inspected.stdout!).data).toMatchObject({
      delivery: null,
      verification: { status: 'needsAuthorization' },
    });
    await fs.writeFile(
      statePath,
      (await fs.readFile(statePath, 'utf8'))
        .replace('phase: verify', 'phase: archive')
        .replace('verify_result: pending', 'verify_result: pass')
        .replace('archived: false', 'archived: true'),
    );
    const next = await cli('state', 'next', 'demo', '--json');
    expect(next.exitCode, next.stdout).toBe(0);
    expect(JSON.parse(next.stdout!).data.nextAction.kind).toBe('delivery');
    const entry = await cli('state', 'check', 'demo', 'archive', '--json');
    expect(entry.exitCode, entry.stdout).toBe(0);
    expect(JSON.parse(entry.stdout!).data.nextAction.kind).toBe('delivery');
  });
  it('records a committed archive through the locked public command without dirtying the archive', async () => {
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args],
        { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
      ).trim();
    git('init', '-b', 'main');
    const statePath = path.join(change, '.comet.yaml');
    await fs.writeFile(
      statePath,
      (await fs.readFile(statePath, 'utf8'))
        .replace('phase: build', 'phase: archive')
        .replace('verify_result: pending', 'verify_result: pass'),
    );
    await ensureClassicRuntimeRun(change);
    const inputPath = path.join(root, 'delivery-input.json');
    await fs.writeFile(inputPath, JSON.stringify({ action: 'local', targetBranch: 'main' }));
    expect((await cli('state', 'delivery', 'demo', '--file', 'delivery-input.json')).exitCode).toBe(
      0,
    );
    await fs.writeFile(
      statePath,
      (await fs.readFile(statePath, 'utf8')).replace('archived: false', 'archived: true'),
    );
    const archiveRoot = path.join(root, 'openspec/changes/archive');
    await fs.mkdir(archiveRoot, { recursive: true });
    const archived = path.join(archiveRoot, '2026-09-10-demo');
    await fs.rename(change, archived);
    git('add', '--', '.');
    git('commit', '-m', 'chore: archive demo');
    const commit = git('rev-parse', 'HEAD');
    await fs.writeFile(
      inputPath,
      JSON.stringify({ action: 'local', targetBranch: 'main', commit }),
    );
    const result = await cli(
      'state',
      'delivery',
      'demo',
      '--file',
      'delivery-input.json',
      '--json',
    );
    expect(result.exitCode, result.stdout).toBe(0);
    expect(JSON.parse(result.stdout!).data.verification.status).toBe('complete');
    expect(git('status', '--porcelain', '--', path.relative(root, archived))).toBe('');
  });
});
