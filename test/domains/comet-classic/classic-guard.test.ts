import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
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
  it.each([
    {
      name: 'mapped unchecked projection',
      plan: '- [ ] stale projection <!-- comet-task:a -->\n',
      accepted: true,
    },
    { name: 'unmapped unchecked task', plan: '- [ ] extra work\n', accepted: false },
    { name: 'unmapped checked task', plan: '- [x] extra work\n', accepted: false },
    {
      name: 'unknown checked ID',
      plan: '- [x] extra work <!-- comet-task:extra -->\n',
      accepted: false,
    },
    {
      name: 'canonical reference',
      plan: '<!-- comet-task-authority: openspec/changes/demo/tasks.md -->\n<!-- comet-task-ref:a -->\n',
      accepted: true,
    },
    {
      name: 'canonical missing reference',
      plan: '<!-- comet-task-authority: openspec/changes/demo/tasks.md -->\n',
      accepted: false,
    },
    {
      name: 'canonical unknown reference',
      plan: '<!-- comet-task-authority: openspec/changes/demo/tasks.md -->\n<!-- comet-task-ref:extra -->\n',
      accepted: false,
    },
    {
      name: 'canonical wrong authority',
      plan: '<!-- comet-task-authority: openspec/changes/other/tasks.md -->\n<!-- comet-task-ref:a -->\n',
      accepted: false,
    },
    {
      name: 'canonical checkbox ledger',
      plan: '<!-- comet-task-authority: openspec/changes/demo/tasks.md -->\n- [x] duplicate ledger <!-- comet-task:a -->\n',
      accepted: false,
    },
  ])(
    'validates plan mapping without a second completion authority: $name',
    async ({ plan, accepted }) => {
      const dir = await makeProject();
      const cli = (...args: string[]) =>
        withClassicCommandContext({ projectRoot: dir, invocationCwd: dir }, () =>
          runClassicCli(args),
        );
      expect(
        (await cli('state', 'init', 'demo', 'hotfix', '--isolation', 'current')).exitCode,
      ).toBe(0);
      const changeDir = path.join(dir, 'openspec/changes/demo');
      const stateFile = path.join(changeDir, '.comet.yaml');
      const state = parse(await fs.readFile(stateFile, 'utf8'));
      await fs.writeFile(
        stateFile,
        stringify({ ...state, phase: 'build', plan: 'docs/superpowers/plans/demo.md' }),
      );
      const planFile = path.join(dir, 'docs/superpowers/plans/demo.md');
      await fs.mkdir(path.dirname(planFile), { recursive: true });
      await fs.writeFile(planFile, plan);
      const tasksFile = path.join(changeDir, 'tasks.md');
      await fs.writeFile(tasksFile, '- [x] accepted work <!-- comet-task:a -->\n');
      await fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n');
      expect(
        (
          await cli(
            'check',
            'run',
            'demo',
            'build',
            '--',
            process.execPath,
            '-e',
            'process.exit(0)',
          )
        ).exitCode,
      ).toBe(0);
      const result = await cli('guard', 'demo', 'build');
      expect(result.exitCode, result.stderr).toBe(accepted ? 0 : 1);
      expect(result.stderr).toContain(`[${accepted ? 'PASS' : 'FAIL'}] plan task mapping is valid`);
      expect(await fs.readFile(planFile, 'utf8')).toBe(plan);
      if (accepted) {
        await fs.writeFile(tasksFile, '- [ ] accepted work <!-- comet-task:a -->\n');
        const incomplete = await cli('guard', 'demo', 'build');
        expect(incomplete.exitCode).toBe(1);
        expect(incomplete.stderr).toContain('[FAIL] tasks.md all tasks checked');
      }
    },
  );

  it('requires ordinary build evidence for autonomous full without a direct override', async () => {
    const dir = await makeProject();
    const cli = (...args: string[]) =>
      withClassicCommandContext({ projectRoot: dir, invocationCwd: dir }, () =>
        runClassicCli(args),
      );
    expect((await cli('state', 'init', 'auto', 'full')).exitCode).toBe(0);
    const changeDir = path.join(dir, 'openspec/changes/auto');
    const statePath = path.join(changeDir, '.comet.yaml');
    const state = {
      ...parse(await fs.readFile(statePath, 'utf8')),
      phase: 'build',
      language: 'en',
      build_mode: 'autonomous',
      tdd_mode: 'direct',
      review_mode: 'standard',
      isolation: 'current',
      plan: 'docs/superpowers/plans/auto.md',
      design_doc: 'docs/superpowers/specs/auto.md',
    };
    await fs.writeFile(statePath, stringify(state));
    await fs.mkdir(path.join(dir, 'docs/superpowers/plans'), { recursive: true });
    await fs.mkdir(path.join(dir, 'docs/superpowers/specs'), { recursive: true });
    await fs.writeFile(path.join(dir, state.plan), '# Implementation plan\n');
    await fs.writeFile(
      path.join(dir, state.design_doc),
      '---\ncomet_change: auto\nrole: technical-design\ncanonical_spec: openspec\n---\n# Design\n',
    );
    await fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n');
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] Implement feature\n');
    const missingEvidence = await cli('guard', 'auto', 'build');
    expect(missingEvidence.exitCode, missingEvidence.stderr).toBe(1);
    expect(missingEvidence.stderr).toContain('[PASS] build_mode allowed for workflow');
    expect(missingEvidence.stderr).toContain('[PASS] autonomous full build prerequisites');
    expect(missingEvidence.stderr).toContain('[FAIL] Build passes');
    expect(
      (await cli('check', 'run', 'auto', 'build', '--', process.execPath, '-e', 'process.exit(0)'))
        .exitCode,
    ).toBe(0);
    const ready = await cli('guard', 'auto', 'build');
    expect(ready.exitCode, ready.stderr).toBe(0);
    const migrated = parse(await fs.readFile(statePath, 'utf8'));
    for (const field of ['plan', 'design_doc', 'tdd_mode', 'review_mode']) {
      await fs.writeFile(statePath, stringify({ ...migrated, [field]: null }));
      const blocked = await cli('guard', 'auto', 'build');
      expect(blocked.exitCode, blocked.stderr).toBe(1);
      expect(blocked.stderr).toContain('[FAIL] autonomous full build prerequisites');
    }
    await fs.writeFile(statePath, stringify({ ...migrated, review_mode: 'off' }));
    const noReview = await cli('guard', 'auto', 'build');
    expect(noReview.exitCode).toBe(1);
    expect(noReview.stderr).toContain('review_mode must be standard or thorough');
  });

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
      effects: [
        { field: 'checkEpoch', to: 1 },
        { field: 'phase', from: 'open', to: 'build' },
      ],
    });
    const trajectory = (await fs.readFile(path.join(changeDir, runState!.trajectoryRef), 'utf8'))
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line) as { type: string });
    expect(trajectory.filter((event) => event.type === 'state_transitioned')).toHaveLength(1);
  });

  it.each(['docs/superpowers/specs/demo-design.md', 'openspec/changes/demo/design.md'])(
    'resolves delta specs from nested cwd with design authority %s',
    async (designPath) => {
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
        path.join(dir, designPath),
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
      expect(run(dir, 'state', 'set', 'demo', 'design_doc', designPath).status).toBe(0);
      expect(run(dir, 'handoff', 'demo', 'design', '--write').status).toBe(0);

      const nestedCwd = path.join(dir, 'agent', 'workspace');
      await fs.mkdir(nestedCwd, { recursive: true });
      const result = run(nestedCwd, 'guard', 'demo', 'design', '--apply');

      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain('ALL CHECKS PASSED — ready for next phase');
      expect(result.stderr).not.toContain('ENOENT: no such file or directory, scandir');
      expect(run(dir, 'state', 'get', 'demo', 'phase').stdout.trim()).toBe('build');
    },
  );

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
