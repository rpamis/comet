/**
 * Recovery tests — split from comet-scripts.test.ts for maintainability.
 *
 * Tests the `check --recover` command that outputs structured recovery context
 * for context compression recovery protocol.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const scriptsDir = path.resolve('assets', 'skills', 'comet', 'scripts');
const classicRuntimeRoot = path.resolve('assets', 'skills', 'comet', 'runtime', 'classic');
const classicSkillRoot = classicRuntimeRoot;

function runNode(cwd: string, script: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      COMET_RUNTIME_CLASSIC_ROOT: classicRuntimeRoot,
      COMET_CLASSIC_SKILL_ROOT: classicRuntimeRoot,
      ...env,
    },
  });
}

async function writeFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function createChange(tmpDir: string, name: string, yaml: string, tasks = '- [x] done\n') {
  const changeDir = path.join(tmpDir, 'openspec', 'changes', name);
  await fs.mkdir(changeDir, { recursive: true });
  await writeFile(path.join(changeDir, '.comet.yaml'), yaml);
  await writeFile(path.join(changeDir, 'proposal.md'), 'proposal\n');
  await writeFile(path.join(changeDir, 'design.md'), 'design\n');
  await writeFile(path.join(changeDir, 'tasks.md'), tasks);
}

const FULL_YAML = [
  'workflow: full',
  'phase: build',
  'build_mode: null',
  'build_pause: null',
  'tdd_mode: null',
  'review_mode: null',
  'isolation: null',
  'verify_mode: null',
  'design_doc: null',
  'plan: null',
  'verify_result: pending',
  'archived: false',
  '',
].join('\n');

describe('check --recover', () => {
  let tmpDir: string;
  let stateScript: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-recovery-'));
    const tmpScriptsDir = path.join(tmpDir, 'scripts');
    await fs.mkdir(tmpScriptsDir, { recursive: true });
    for (const name of [
      'comet-runtime.mjs',
      'comet-env.mjs',
      'comet-archive.mjs',
      'comet-guard.mjs',
      'comet-handoff.mjs',
      'comet-state.mjs',
      'comet-yaml-validate.mjs',
      'comet-hook-guard.mjs',
    ]) {
      const content = await fs.readFile(path.join(scriptsDir, name), 'utf-8');
      await writeFile(path.join(tmpScriptsDir, name), content.replace(/\r\n/g, '\n'));
    }
    stateScript = path.join(tmpScriptsDir, 'comet-state.mjs');
    execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir });
    await writeFile(path.join(tmpDir, '.openspec', 'config.yaml'), 'name: test\n');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir, stdio: 'ignore' });
  });

  it('outputs recovery context for open phase', async () => {
    await createChange(tmpDir, 'recover-open', FULL_YAML.replace('phase: build', 'phase: open'));

    const result = runNode(tmpDir, stateScript, ['check', 'recover-open', 'open', '--recover']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Recovery Context: recover-open');
    expect(result.stdout).toContain('Phase: open');
    expect(result.stdout).toContain('Workflow: full');
    expect(result.stdout).toContain('proposal.md: DONE');
    expect(result.stdout).toContain('design.md: DONE');
    expect(result.stdout).toContain('tasks.md: DONE');
    expect(result.stdout).toContain('End Recovery Context');
  });

  it('outputs recovery context for build phase with partial progress', async () => {
    await createChange(
      tmpDir,
      'recover-build',
      FULL_YAML,
      ['- [x] done task', '- [ ] pending task'].join('\n'),
    );

    const result = runNode(tmpDir, stateScript, ['check', 'recover-build', 'build', '--recover']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Phase: build');
    expect(result.stdout).toContain('isolation: PENDING');
    expect(result.stdout).toContain('build_mode: PENDING');
    expect(result.stdout).toContain('Tasks: 1/2 done, 1 pending');
    expect(result.stdout).toContain("current platform's user confirmation mechanism");
  });

  it('outputs plan-ready pause recovery context for build phase', async () => {
    await writeFile(path.join(tmpDir, 'docs', 'superpowers', 'plans', 'pause-plan.md'), 'plan\n');
    await createChange(
      tmpDir,
      'recover-plan-ready',
      [
        'workflow: full',
        'phase: build',
        'build_mode: null',
        'build_pause: plan-ready',
        'tdd_mode: null',
        'review_mode: null',
        'isolation: null',
        'verify_mode: null',
        'design_doc: null',
        'plan: docs/superpowers/plans/pause-plan.md',
        'verify_result: pending',
        'archived: false',
        '',
      ].join('\n'),
    );

    const result = runNode(tmpDir, stateScript, [
      'check',
      'recover-plan-ready',
      'build',
      '--recover',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('build_pause: DONE (plan-ready)');
    expect(result.stdout).toContain('Plan-ready pause');
    expect(result.stdout).toContain('choose isolation, build mode, TDD mode, and review mode');
  });

  it('outputs subagent dispatch guidance when recovering build phase with pending tasks', async () => {
    await createChange(
      tmpDir,
      'recover-subagent',
      [
        'workflow: full',
        'phase: build',
        'build_mode: subagent-driven-development',
        'build_pause: null',
        'subagent_dispatch: confirmed',
        'tdd_mode: tdd',
        'review_mode: standard',
        'isolation: branch',
        'verify_mode: null',
        'design_doc: null',
        'plan: docs/superpowers/plans/subagent-plan.md',
        'verify_result: pending',
        'archived: false',
        '',
      ].join('\n'),
      ['- [x] done task', '- [ ] pending task'].join('\n'),
    );

    const result = runNode(tmpDir, stateScript, [
      'check',
      'recover-subagent',
      'build',
      '--recover',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('build_mode: DONE (subagent-driven-development)');
    expect(result.stdout).toContain('Tasks: 1/2 done, 1 pending');
    expect(result.stdout).toContain(
      'inspect the first unchecked task against recent git history/diff',
    );
    expect(result.stdout).toContain('dispatch a real background subagent');
    expect(result.stdout).toContain('Do not execute the pending task directly in the main window');
  });

  it('outputs recovery context for verify phase', async () => {
    await createChange(
      tmpDir,
      'recover-verify',
      FULL_YAML.replace('phase: build', 'phase: verify').replace(
        'verify_result: pending',
        'verify_result: pass',
      ),
    );

    const result = runNode(tmpDir, stateScript, ['check', 'recover-verify', 'verify', '--recover']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Phase: verify');
    expect(result.stdout).toContain('verify_result: DONE (pass)');
  });

  it('outputs recovery context for archive phase', async () => {
    await createChange(
      tmpDir,
      'recover-archive',
      FULL_YAML.replace('phase: build', 'phase: archive'),
    );

    const result = runNode(tmpDir, stateScript, [
      'check',
      'recover-archive',
      'archive',
      '--recover',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Phase: archive');
    expect(result.stdout).toContain('Recovery action: Run /comet-archive to complete archiving.');
  });
});
