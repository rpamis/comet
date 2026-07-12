import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
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
  options: { archived?: boolean; workflow?: 'full' | 'hotfix'; designDoc?: string | null } = {},
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
  await fs.writeFile(
    path.join(changeDir, '.comet.yaml'),
    [
      `workflow: ${workflow}`,
      `phase: ${phase}`,
      `design_doc: ${designDoc ?? 'null'}`,
      'plan: null',
      `build_mode: ${phase === 'open' || phase === 'design' ? 'null' : 'executing-plans'}`,
      `isolation: ${phase === 'open' || phase === 'design' ? 'null' : 'branch'}`,
      `verify_mode: ${phase === 'verify' || phase === 'archive' ? 'light' : 'null'}`,
      `verify_result: ${phase === 'archive' ? 'pass' : 'pending'}`,
      `verified_at: ${phase === 'archive' ? '2026-07-12' : 'null'}`,
      `archived: ${options.archived ?? false}`,
      '',
    ].join('\n'),
  );
  return changeDir;
}

describe('Classic hook guard command', () => {
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

  it('fails closed when the selected branch changes', async () => {
    const dir = await makeProject();
    await initializeGitProject(dir);
    await seedChange(dir, 'build-ready', 'build');
    expect(run(dir, 'state', ['select', 'build-ready']).status).toBe(0);
    git(dir, ['switch', '-c', 'other']);

    const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, 'src', 'feature.ts')));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("selected on branch 'main'");
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

  it('blocks source writes in design and silently migrates the active change', async () => {
    const dir = await makeProject();
    const changeDir = await seedDesignChange(dir);

    const result = run(dir, 'hook-guard', [], hookInput(path.join(dir, 'src', 'index.ts')));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('COMET PHASE GUARD');
    expect(result.stderr).toContain('Current phase: design');
    const state = parse(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(state).toMatchObject({
      classic_migration: 1,
    });
    const runState = await readRunState(changeDir);
    expect(runState).not.toBeNull();
    expect(runState!.skill).toBe('comet-classic');
    expect(runState!.currentStep).toBe('full.design.handoff');
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
