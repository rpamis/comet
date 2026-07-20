import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { readRunState } from '../../../domains/engine/state.js';

const scriptsDir = path.resolve('assets', 'skills', 'comet', 'scripts');
const scriptByCommand: Record<string, string> = {
  'hook-guard': path.join(scriptsDir, 'comet-hook-guard.mjs'),
  state: path.join(scriptsDir, 'comet-state.mjs'),
};
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
});

async function makeProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-hook-'));
  temporary.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

async function initializeGitProject(dir: string): Promise<void> {
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test User']);
  await fs.writeFile(path.join(dir, 'README.md'), '# Test\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'init']);
}

function run(cwd: string, command: string, args: string[] = [], input?: string) {
  return spawnSync(process.execPath, [scriptByCommand[command], ...args], {
    cwd,
    encoding: 'utf8',
    input,
  });
}

function hookInput(filePath: string): string {
  return JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: '// test' },
  });
}

async function seedDesignChange(dir: string): Promise<string> {
  run(dir, 'state', ['init', 'demo', 'full']);
  const changeDir = path.join(dir, 'openspec', 'changes', 'demo');
  // Open→design transition requires the open artifacts to exist first.
  await fs.writeFile(path.join(changeDir, 'proposal.md'), 'proposal\n');
  await fs.writeFile(path.join(changeDir, 'design.md'), 'design\n');
  await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] task\n');
  run(dir, 'state', ['transition', 'demo', 'open-complete']);
  return changeDir;
}

async function seedChange(
  dir: string,
  name: string,
  phase: 'open' | 'design' | 'build' | 'verify' | 'archive',
  options: {
    archived?: boolean;
    workflow?: 'full' | 'hotfix';
    designDoc?: string | null;
    plan?: string | null;
    verificationReport?: string | null;
    isolation?: string;
    boundBranch?: string;
  } = {},
): Promise<string> {
  const changeDir = path.join(dir, 'openspec', 'changes', name);
  await fs.mkdir(changeDir, { recursive: true });
  const workflow = options.workflow ?? 'full';
  const designDoc =
    options.designDoc === undefined
      ? phase === 'build' || phase === 'verify' || phase === 'archive'
        ? `docs/superpowers/specs/${name}-design.md`
        : null
      : options.designDoc;
  const isolation =
    options.isolation ?? (phase === 'open' || phase === 'design' ? 'null' : 'branch');
  const lines = [
    `workflow: ${workflow}`,
    `phase: ${phase}`,
    `design_doc: ${designDoc ?? 'null'}`,
    `plan: ${options.plan ?? 'null'}`,
    `verification_report: ${options.verificationReport ?? 'null'}`,
    `build_mode: ${phase === 'open' || phase === 'design' ? 'null' : 'executing-plans'}`,
    `isolation: ${isolation}`,
    `verify_mode: ${phase === 'verify' || phase === 'archive' ? 'light' : 'null'}`,
    `verify_result: ${phase === 'archive' ? 'pass' : 'pending'}`,
    `verified_at: ${phase === 'archive' ? '2026-07-12' : 'null'}`,
    `archived: ${options.archived ?? false}`,
  ];
  if (options.boundBranch) lines.push(`bound_branch: ${options.boundBranch}`);
  lines.push('');
  await fs.writeFile(path.join(changeDir, '.comet.yaml'), lines.join('\n'));
  return changeDir;
}

describe('Classic hook guard command', () => {
  describe('standard Superpowers artifact first writes', () => {
    it.each([
      {
        label: 'design document',
        changeName: 'design-change',
        phase: 'design' as const,
        target: ['specs', '2026-07-13-durable-retries-design.md'],
      },
      {
        label: 'implementation plan',
        changeName: 'build-change',
        phase: 'build' as const,
        target: ['plans', '2026-07-13-durable-retries.md'],
      },
      {
        label: 'verification report',
        changeName: 'verify-change',
        phase: 'verify' as const,
        target: ['reports', '2026-07-13-durable-retries-verify.md'],
      },
    ])('allows a standard first $label write for a single active change', async (example) => {
      const dir = await makeProject();
      await seedChange(dir, example.changeName, example.phase);
      const target = path.join(dir, 'docs', 'superpowers', ...example.target);

      const result = run(dir, 'hook-guard', [], hookInput(target));

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(`phase: ${example.phase}, superpowers`);
    });

    it('allows the selected build change to create a standard plan with multiple active changes', async () => {
      const dir = await makeProject();
      await seedChange(dir, 'build-change', 'build');
      await seedChange(dir, 'unrelated-design', 'design');
      expect(run(dir, 'state', ['select', 'build-change']).status).toBe(0);
      const target = path.join(
        dir,
        'docs',
        'superpowers',
        'plans',
        '2026-07-13-durable-retries.md',
      );

      const result = run(dir, 'hook-guard', [], hookInput(target));

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('phase: build, superpowers');
    });

    it('requires selection before a standard plan write with multiple active changes', async () => {
      const dir = await makeProject();
      await seedChange(dir, 'build-change', 'build');
      await seedChange(dir, 'unrelated-design', 'design');
      const target = path.join(
        dir,
        'docs',
        'superpowers',
        'plans',
        '2026-07-13-durable-retries.md',
      );

      const result = run(dir, 'hook-guard', [], hookInput(target));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('multiple active changes require a current change');
      expect(result.stderr).toContain('comet state select <change-name>');
    });

    it.each(['open', 'design', 'verify', 'archive'] as const)(
      'blocks a standard plan first write during %s',
      async (phase) => {
        const dir = await makeProject();
        await seedChange(dir, 'wrong-phase', phase);
        const target = path.join(
          dir,
          'docs',
          'superpowers',
          'plans',
          '2026-07-13-durable-retries.md',
        );

        const result = run(dir, 'hook-guard', [], hookInput(target));

        expect(result.status).toBe(2);
        expect(result.stderr).toContain('Expected phase: build');
        expect(result.stderr).not.toContain('include the change name');
      },
    );

    it('allows the recorded plan and blocks a second unrecorded plan', async () => {
      const dir = await makeProject();
      const recorded = 'docs/superpowers/plans/2026-07-13-existing.md';
      await seedChange(dir, 'occupied-plan', 'build', { plan: recorded });

      const recordedResult = run(
        dir,
        'hook-guard',
        [],
        hookInput(path.join(dir, ...recorded.split('/'))),
      );
      const secondResult = run(
        dir,
        'hook-guard',
        [],
        hookInput(path.join(dir, 'docs', 'superpowers', 'plans', '2026-07-13-second-feature.md')),
      );

      expect(recordedResult.status).toBe(0);
      expect(secondResult.status).toBe(2);
      expect(secondResult.stderr).toContain('plan is already recorded');
      expect(secondResult.stderr).toContain(recorded);
    });

    it('blocks a named standard plan when the governing change plan slot is occupied', async () => {
      const dir = await makeProject();
      const recorded = 'docs/superpowers/plans/2026-07-13-existing.md';
      await seedChange(dir, 'occupied-plan', 'build', { plan: recorded });
      const target = path.join(
        dir,
        'docs',
        'superpowers',
        'plans',
        '2026-07-13-occupied-plan-plan.md',
      );

      const result = run(dir, 'hook-guard', [], hookInput(target));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('plan is already recorded');
      expect(result.stderr).toContain(recorded);
    });

    it.skipIf(process.platform !== 'win32')(
      'treats a Windows case-variant standard plan as wrong-phase while preserving diagnostics',
      async () => {
        const dir = await makeProject();
        await seedChange(dir, 'windows-wrong-phase', 'design');
        const relativeTarget = 'Docs/superpowers/plans/2026-07-13-windows-wrong-phase-plan.md';

        const result = run(
          dir,
          'hook-guard',
          [],
          hookInput(path.join(dir, ...relativeTarget.split('/'))),
        );

        expect(result.status).toBe(2);
        expect(result.stderr).toContain('Expected phase: build');
        expect(result.stderr).toContain(`Target file: ${relativeTarget}`);
      },
    );

    it.skipIf(process.platform !== 'win32')(
      'blocks a Windows case-variant named plan when the slot is occupied',
      async () => {
        const dir = await makeProject();
        const recorded = 'docs/superpowers/plans/2026-07-13-existing.md';
        await seedChange(dir, 'windows-occupied-plan', 'build', { plan: recorded });
        const target = path.join(
          dir,
          'Docs',
          'superpowers',
          'plans',
          '2026-07-13-windows-occupied-plan-plan.md',
        );

        const result = run(dir, 'hook-guard', [], hookInput(target));

        expect(result.status).toBe(2);
        expect(result.stderr).toContain('plan is already recorded');
        expect(result.stderr).toContain(recorded);
      },
    );

    it.skipIf(process.platform !== 'win32')(
      'allows a Windows case-variant of an exact recorded artifact path',
      async () => {
        const dir = await makeProject();
        const recorded = 'docs/superpowers/plans/2026-07-13-recorded.md';
        await seedChange(dir, 'recorded-case-plan', 'design', { plan: recorded });
        const target = path.join(dir, 'Docs', 'superpowers', 'plans', '2026-07-13-recorded.md');

        const result = run(dir, 'hook-guard', [], hookInput(target));

        expect(result.status).toBe(0);
        expect(result.stderr).toContain('phase: design, superpowers');
      },
    );

    it.skipIf(process.platform === 'win32')(
      'does not treat a non-Windows case variant as an exact recorded artifact path',
      async () => {
        const dir = await makeProject();
        const recorded = 'docs/superpowers/plans/2026-07-13-recorded.md';
        await seedChange(dir, 'recorded-case-plan', 'design', { plan: recorded });
        const relativeTarget = 'Docs/superpowers/plans/2026-07-13-recorded.md';

        const result = run(
          dir,
          'hook-guard',
          [],
          hookInput(path.join(dir, ...relativeTarget.split('/'))),
        );

        expect(result.status).toBe(2);
        expect(result.stderr).toContain('source writes are not allowed during design');
        expect(result.stderr).toContain(`Target file: ${relativeTarget}`);
      },
    );

    it('fails closed for a stale selection before a standard plan first write', async () => {
      const dir = await makeProject();
      await initializeGitProject(dir);
      await seedChange(dir, 'build-change', 'build', { isolation: 'current', boundBranch: 'main' });
      await seedChange(dir, 'other-build', 'build');
      expect(run(dir, 'state', ['select', 'build-change']).status).toBe(0);
      git(dir, ['switch', '-c', 'other']);
      const target = path.join(
        dir,
        'docs',
        'superpowers',
        'plans',
        '2026-07-13-durable-retries.md',
      );

      const result = run(dir, 'hook-guard', [], hookInput(target));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('current change selection is stale or invalid');
    });

    it.each([
      path.join('docs', 'superpowers', 'notes', '2026-07-13-note.md'),
      path.join('docs', 'superpowers', 'plans', 'nested', '2026-07-13-plan.md'),
      path.join('docs', 'superpowers', 'plans', '2026-07-13-plan.txt'),
    ])('keeps non-standard Superpowers paths blocked: %s', async (target) => {
      const dir = await makeProject();
      await seedChange(dir, 'build-change', 'build');

      const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, target)));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('unmatched Superpowers artifact');
    });
  });

  it('requires a current change before source writes with multiple active changes', async () => {
    const dir = await makeProject();
    await seedChange(dir, 'build-ready', 'build');
    await seedChange(dir, 'open-change', 'open');

    const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, 'src', 'feature.ts')));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('multiple active changes require a current change');
    expect(result.stderr).toContain('comet state select <change-name>');
    expect(result.stderr).toContain('build-ready');
    expect(result.stderr).toContain('open-change');
    expect(result.stderr).not.toContain('Current phase: open');
  });

  it.each([
    ['.comet config', path.join('.comet', 'config.yaml')],
    ['Superpowers workspace', path.join('.superpowers', 'sdd', 'progress.md')],
    ['Claude config', path.join('.claude', 'rules', 'custom.md')],
    ['root Markdown', 'README.md'],
  ])('keeps the %s allowlist with multiple unselected changes', async (_label, target) => {
    const dir = await makeProject();
    await seedChange(dir, 'build-ready', 'build');
    await seedChange(dir, 'open-change', 'open');

    const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, target)));

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('whitelist');
  });

  it('keeps global allowlists when the current selection is malformed', async () => {
    const dir = await makeProject();
    await seedChange(dir, 'build-ready', 'build');
    await fs.mkdir(path.join(dir, '.comet'), { recursive: true });
    await fs.writeFile(path.join(dir, '.comet', 'current-change.json'), '{broken\n');

    const result = run(
      dir,
      'hook-guard',
      [],
      hookInput(path.join(dir, '.superpowers', 'sdd', 'progress.md')),
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('whitelist: superpowers workspace');
  });

  it.each(['design', 'archive'] as const)(
    'allows selected build source writes while another change is in %s',
    async (phase) => {
      const dir = await makeProject();
      await seedChange(dir, 'build-ready', 'build');
      await seedChange(dir, 'unrelated-change', phase);
      expect(run(dir, 'state', ['select', 'build-ready']).status).toBe(0);

      const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, 'src', 'feature.ts')));

      expect(result.status).toBe(0);
      expect(result.stderr).toContain('phase: build');
    },
  );

  it('blocks source writes for the selected open change even when another change can build', async () => {
    const dir = await makeProject();
    await seedChange(dir, 'build-ready', 'build');
    await seedChange(dir, 'open-change', 'open');
    expect(run(dir, 'state', ['select', 'open-change']).status).toBe(0);

    const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, 'src', 'feature.ts')));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Current phase: open');
  });

  it('keeps single-change source guard behavior without a selection', async () => {
    const dir = await makeProject();
    await seedChange(dir, 'design-change', 'design');

    const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, 'src', 'feature.ts')));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Current phase: design');
  });

  it('ignores archived changes when deciding whether selection is required', async () => {
    const dir = await makeProject();
    await seedChange(dir, 'build-ready', 'build');
    await seedChange(dir, 'archived-change', 'archive', { archived: true });

    const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, 'src', 'feature.ts')));

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('phase: build');
  });

  it('fails closed when the current change selection is malformed', async () => {
    const dir = await makeProject();
    await seedChange(dir, 'build-ready', 'build');
    await fs.mkdir(path.join(dir, '.comet'), { recursive: true });
    await fs.writeFile(path.join(dir, '.comet', 'current-change.json'), '{broken\n');

    const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, 'src', 'feature.ts')));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('current change selection is stale or invalid');
    expect(result.stderr).toContain('invalid JSON');
  });

  it.each(['current', 'branch', 'worktree'])(
    'fails closed when the bound branch drifts (isolation: %s)',
    async (isolation) => {
      const dir = await makeProject();
      await initializeGitProject(dir);
      await seedChange(dir, 'build-ready', 'build', { isolation, boundBranch: 'main' });
      expect(run(dir, 'state', ['select', 'build-ready']).status).toBe(0);
      git(dir, ['switch', '-c', 'other']);

      const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, 'src', 'feature.ts')));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("bound to branch 'main'");
      expect(result.stderr).toContain("current branch is 'other'");
    },
  );

  it('fails closed for a drifted sole active change without a selection', async () => {
    const dir = await makeProject();
    await initializeGitProject(dir);
    await seedChange(dir, 'build-ready', 'build', { isolation: 'current', boundBranch: 'main' });
    git(dir, ['switch', '-c', 'other']);

    const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, 'src', 'feature.ts')));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("bound to branch 'main'");
    expect(result.stderr).toContain("current branch is 'other'");
  });

  it('still blocks selected full-workflow build source writes without a design document', async () => {
    const dir = await makeProject();
    await seedChange(dir, 'illegal-build', 'build', { designDoc: null });
    expect(run(dir, 'state', ['select', 'illegal-build']).status).toBe(0);

    const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, 'src', 'feature.ts')));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('design_doc is empty');
  });

  it('selects, reads, and clears the current change through the state launcher', async () => {
    const dir = await makeProject();
    await initializeGitProject(dir);
    expect(run(dir, 'state', ['init', 'demo', 'hotfix']).status).toBe(0);

    const selected = run(dir, 'state', ['select', 'demo']);

    expect(selected.status).toBe(0);
    expect(selected.stderr).toContain('[SELECTED] current change: demo');
    expect(run(dir, 'state', ['current']).stdout.trim()).toBe('demo');
    expect(run(dir, 'state', ['clear-selection']).status).toBe(0);
    expect(run(dir, 'state', ['clear-selection']).status).toBe(0);
    expect(run(dir, 'state', ['current']).status).not.toBe(0);
  });

  it('rejects selecting a missing current change through the state launcher', async () => {
    const dir = await makeProject();

    const result = run(dir, 'state', ['select', 'missing']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('active change state not found');
  });

  it('allows writes when no active change exists', async () => {
    const dir = await makeProject();

    const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, 'src', 'free.ts')));

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('allowed: no active comet change');
  });

  it('blocks source writes in design without migrating the active change or creating Run files', async () => {
    const dir = await makeProject();
    const changeDir = await seedChange(dir, 'read-only-design', 'design');
    const stateFile = path.join(changeDir, '.comet.yaml');
    const before = await fs.readFile(stateFile, 'utf8');

    const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, 'src', 'index.ts')));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('COMET PHASE GUARD');
    expect(result.stderr).toContain('Current phase: design');
    expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
    expect(await readRunState(changeDir)).toBeNull();
    await expect(fs.access(path.join(changeDir, '.comet'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('leaves legacy command fields byte-for-byte unchanged while guarding', async () => {
    const dir = await makeProject();
    const changeDir = await seedChange(dir, 'legacy-read-only', 'design');
    const stateFile = path.join(changeDir, '.comet.yaml');
    await fs.appendFile(
      stateFile,
      'build_command: node legacy-build.js\nverify_command: node legacy-verify.js\n',
    );
    const before = await fs.readFile(stateFile, 'utf8');

    const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, 'src', 'index.ts')));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Current phase: design');
    expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
    expect(await readRunState(changeDir)).toBeNull();
    await expect(fs.access(path.join(changeDir, '.comet'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('allows OpenSpec artifact writes in design', async () => {
    const dir = await makeProject();
    const changeDir = await seedDesignChange(dir);

    const result = run(dir, 'hook-guard', [], hookInput(path.join(changeDir, 'proposal.md')));

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('phase: design, handoff/spec');
  });

  it('allows Superpowers workspace writes during guarded phases', async () => {
    const dir = await makeProject();
    run(dir, 'state', ['init', 'demo', 'full']);

    const openResult = run(
      dir,
      'hook-guard',
      [],
      hookInput(path.join(dir, '.superpowers', 'sdd', 'progress.md')),
    );

    expect(openResult.status).toBe(0);
    expect(openResult.stderr).toContain('.superpowers/sdd/progress.md');

    await seedDesignChange(dir);
    const designResult = run(
      dir,
      'hook-guard',
      [],
      hookInput(path.join(dir, '.superpowers', 'sdd', 'progress.md')),
    );

    expect(designResult.status).toBe(0);
    expect(designResult.stderr).toContain('.superpowers/sdd/progress.md');
  });

  // The hook guard reads governing state leniently: an unknown field makes the
  // strict projection unavailable, so it falls back to the legacy phase read
  // and still enforces the phase write rule — without rewriting the file.
  it('still blocks and leaves state untouched when the state has an unknown field', async () => {
    const dir = await makeProject();
    const changeDir = await seedDesignChange(dir);
    await fs.appendFile(path.join(changeDir, '.comet.yaml'), 'unknown_root_field: true\n');
    const before = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');

    const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, 'src', 'index.ts')));

    expect(result.status).toBe(2);
    expect(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8')).toBe(before);
  });
});
