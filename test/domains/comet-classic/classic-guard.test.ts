import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readRunState } from '../../../domains/engine/state.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const scriptsDir = path.resolve('assets', 'skills', 'comet', 'scripts');
const scriptByCommand: Record<string, string> = {
  guard: path.join(scriptsDir, 'comet-guard.mjs'),
  handoff: path.join(scriptsDir, 'comet-handoff.mjs'),
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

function run(cwd: string, ...args: string[]) {
  const [command, ...rest] = args;
  return spawnSync(process.execPath, [scriptByCommand[command], ...rest], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(command === 'state' && rest[2] === 'phase' ? { COMET_FORCE_PHASE: '1' } : {}),
    },
  });
}

async function makeProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-guard-'));
  await prepareClassicLegacyProject(dir);
  temporary.push(dir);
  return dir;
}

describe('Classic guard command', () => {
  it('blocks the open guard when artifacts are missing and leaves state unchanged', async () => {
    const dir = await makeProject();
    expect(run(dir, 'state', 'init', 'demo', 'full').status).toBe(0);

    const result = run(dir, 'guard', 'demo', 'open');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[FAIL] proposal.md exists and non-empty');
    expect(result.stderr).toContain('[FAIL] tasks.md has at least one task');
    expect(result.stderr).toContain('BLOCKED — fix failing checks before proceeding to next phase');

    // A blocked guard must not mutate state.
    expect(run(dir, 'state', 'get', 'demo', 'phase').stdout.trim()).toBe('open');

    const stateFile = path.join(dir, 'openspec', 'changes', 'demo', '.comet.yaml');
    const migrated = await fs.readFile(stateFile, 'utf8');
    const second = run(dir, 'guard', 'demo', 'open');
    expect(second.status).toBe(1);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(migrated);
  });

  it('passes the open guard and applies the transition when artifacts exist', async () => {
    const dir = await makeProject();
    run(dir, 'state', 'init', 'demo', 'hotfix');
    run(dir, 'state', 'set', 'demo', 'isolation', 'branch');
    const changeDir = path.join(dir, 'openspec', 'changes', 'demo');
    await fs.writeFile(path.join(changeDir, 'proposal.md'), 'proposal\n');
    await fs.writeFile(path.join(changeDir, 'design.md'), 'design\n');
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] implement guard\n');

    const result = run(dir, 'guard', 'demo', 'open', '--apply');
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('ALL CHECKS PASSED — ready for next phase');
    expect(result.stderr).toContain('[APPLY] .comet.yaml updated: phase=build');
    expect(run(dir, 'state', 'get', 'demo', 'phase').stdout.trim()).toBe('build');

    const state = parse(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(state).toMatchObject({
      classic_profile: 'hotfix',
      classic_migration: 1,
    });
    const runState = await readRunState(changeDir);
    expect(runState).not.toBeNull();
    expect(runState!.skill).toBe('comet-classic');
    expect(runState!.currentStep).toBe('hotfix.build.complete');
    expect(runState!.iteration).toBe(1);
    const eventLog = await fs.readFile(
      path.join(changeDir, '.comet', 'state-events.jsonl'),
      'utf8',
    );
    expect(JSON.parse(eventLog.trim())).toMatchObject({
      schemaVersion: 1,
      change: 'demo',
      event: 'open-complete',
      source: 'comet-guard',
      from: { workflow: 'hotfix', phase: 'open' },
      to: { workflow: 'hotfix', phase: 'build' },
      effects: [{ field: 'phase', from: 'open', to: 'build' }],
    });
    const trajectory = (await fs.readFile(path.join(changeDir, runState!.trajectoryRef), 'utf8'))
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line) as { type: string });
    expect(trajectory.filter((event) => event.type === 'state_transitioned')).toHaveLength(1);
  });

  it('resolves delta specs from the project root when invoked from a nested cwd', async () => {
    const dir = await makeProject();
    expect(run(dir, 'state', 'init', 'demo', 'full').status).toBe(0);

    const changeDir = path.join(dir, 'openspec', 'changes', 'demo');
    await fs.mkdir(path.join(changeDir, 'specs', 'feature'), { recursive: true });
    await fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n');
    await fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n');
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] implement guard\n');
    await fs.writeFile(path.join(changeDir, 'specs', 'feature', 'spec.md'), '# Feature\n');
    await fs.mkdir(path.join(dir, 'docs', 'superpowers', 'specs'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'docs', 'superpowers', 'specs', 'demo-design.md'),
      [
        '---',
        'comet_change: demo',
        'role: technical-design',
        'canonical_spec: openspec',
        '---',
        '',
        '# Design',
        '',
      ].join('\n'),
    );

    expect(run(dir, 'state', 'set', 'demo', 'phase', 'design').status).toBe(0);
    expect(
      run(dir, 'state', 'set', 'demo', 'design_doc', 'docs/superpowers/specs/demo-design.md')
        .status,
    ).toBe(0);
    expect(run(dir, 'handoff', 'demo', 'design', '--write').status).toBe(0);

    const nestedCwd = path.join(dir, 'agent', 'workspace');
    await fs.mkdir(nestedCwd, { recursive: true });
    const result = run(nestedCwd, 'guard', 'demo', 'design', '--apply');

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('ALL CHECKS PASSED — ready for next phase');
    expect(result.stderr).not.toContain('ENOENT: no such file or directory, scandir');
    expect(run(dir, 'state', 'get', 'demo', 'phase').stdout.trim()).toBe('build');
  });

  it('fails closed for an unknown phase without running checks', async () => {
    const dir = await makeProject();
    run(dir, 'state', 'init', 'demo', 'full');

    const result = run(dir, 'guard', 'demo', 'lint');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unknown phase: lint');
    expect(result.stderr).toContain('Valid phases: open, design, build, verify, archive');
  });

  it('returns resolver diagnostics in json mode', async () => {
    const dir = await makeProject();
    expect(run(dir, 'state', 'init', 'demo', 'full').status).toBe(0);
    await fs.writeFile(
      path.join(dir, 'openspec', 'changes', 'demo', 'proposal.md'),
      '# Proposal\n',
    );
    await fs.writeFile(path.join(dir, 'openspec', 'changes', 'demo', 'design.md'), '# Design\n');
    await fs.writeFile(path.join(dir, 'openspec', 'changes', 'demo', 'tasks.md'), '- [ ] build\n');

    const result = run(dir, 'guard', 'demo', 'open', '--json');
    const wrapper = JSON.parse(result.stdout);
    const payload = JSON.parse(wrapper.stdout);

    expect(payload.diagnostics).toMatchObject({
      change: 'demo',
      phase: 'open',
      currentStep: 'full.open',
      runtimeEval: { stepId: 'full.open' },
    });
  });
});
