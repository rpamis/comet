import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';

const repositoryRoot = path.resolve('.');
const cli = path.join(repositoryRoot, 'bin', 'comet.js');
const stateScript = path.resolve('assets', 'skills', 'comet', 'scripts', 'comet-state.mjs');
const activeChange = 'resume-probe-change';

function runCli(cwd: string, args: string[], input?: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    input,
  });
}

function state(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): void {
  const result = spawnSync(process.execPath, [stateScript, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(
      `comet-state command failed: ${result.status} ${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
}

function parseResult(stdout: string) {
  return JSON.parse(stdout) as {
    action: string;
    schema_version: string;
    workflow: string | null;
    skill: string | null;
    entrySource: string | null;
    changeName: string | null;
    phase: string | null;
    confidence: string;
    reason: string;
    nextCommand: string | null;
  };
}

describe('resumeProbe command', () => {
  let tmpDir: string;

  beforeAll(async () => {
    await ensureCliBuilt(repositoryRoot);
  }, 120_000);

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-resume-cli-'));
    state(tmpDir, ['init', activeChange, 'full']);
    state(tmpDir, ['set', activeChange, 'build_mode', 'executing-plans']);
    state(tmpDir, ['set', activeChange, 'tdd_mode', 'direct']);
    state(tmpDir, ['set', activeChange, 'isolation', 'branch']);
    state(tmpDir, ['set', activeChange, 'verify_mode', 'light']);
    await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'docs', 'plan.md'), 'plan: done\n', 'utf8');
    state(tmpDir, ['set', activeChange, 'plan', 'docs/plan.md']);
    state(tmpDir, ['set', activeChange, 'phase', 'build'], {
      COMET_FORCE_PHASE: '1',
    });
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.comet', 'config.yaml'), 'language: "en"\n', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns JSON using top-level CLI invocation and --utterance', () => {
    const result = runCli(tmpDir, ['resume-probe', tmpDir, '--utterance', '继续', '--json']);

    expect(result.status, result.stderr).toBe(0);
    expect(parseResult(result.stdout)).toMatchObject({
      schema_version: 'comet.resume_probe.v2',
      workflow: 'classic',
      skill: 'comet-classic',
      entrySource: 'legacy-fallback',
      action: 'auto_resume',
      nextCommand: '/comet-classic',
    });
  });

  it('renders the resolved workflow and permanent entry in text mode', () => {
    const result = runCli(tmpDir, ['resume-probe', tmpDir, '--utterance', '继续']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('workflow: classic');
    expect(result.stdout).toContain('skill: comet-classic');
    expect(result.stdout).toContain('next: /comet-classic');
  });

  it('routes a configured Native project without considering Classic changes', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'comet.config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'native:',
        '  artifact_root: .',
        '',
      ].join('\n'),
      'utf8',
    );
    const changeDir = path.join(tmpDir, 'comet', 'changes', 'native-resume');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'change.yaml'),
      [
        'schema: comet.native.v1',
        'name: native-resume',
        'language: en',
        'phase: shape',
        'brief: brief.md',
        'approval: null',
        'spec_changes: []',
        'verification_result: pending',
        'verification_report: null',
        'archived: false',
        'created_at: 2026-07-15',
        'run_id: null',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      [
        '# Outcome',
        'Resume Native.',
        '# Scope',
        'One change.',
        '# Non-goals',
        'No Classic work.',
        '# Acceptance examples',
        '- Resume the selected change.',
        '# Constraints and invariants',
        'Keep workflows separate.',
        '# Decisions',
        'Use Native.',
        '# Open questions',
        'None.',
        '# Verification expectations',
        'Run focused tests.',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = runCli(tmpDir, [
      'resume-probe',
      tmpDir,
      '--utterance',
      '继续 native-resume',
      '--json',
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(parseResult(result.stdout)).toMatchObject({
      workflow: 'native',
      skill: 'comet-native',
      entrySource: 'project-config',
      action: 'auto_resume',
      changeName: 'native-resume',
      nextCommand: '/comet-native',
    });
  });

  it('uses stdin over --utterance when --stdin is set', () => {
    const fromUtterance = runCli(tmpDir, [
      'resume-probe',
      tmpDir,
      '--utterance',
      'what is this?',
      '--json',
    ]);
    const fromStdin = runCli(
      tmpDir,
      ['resume-probe', tmpDir, '--utterance', 'what is this?', '--stdin', '--json'],
      'continue',
    );

    expect(fromUtterance.status, fromUtterance.stderr).toBe(0);
    expect(fromStdin.status, fromStdin.stderr).toBe(0);
    expect(parseResult(fromUtterance.stdout).action).toBe('ask_user');
    expect(parseResult(fromStdin.stdout).action).toBe('auto_resume');
  });

  it('maps --no-workflow-work into an out-of-scope result', () => {
    const defaultResult = runCli(tmpDir, [
      'resume-probe',
      tmpDir,
      '--utterance',
      'what is this?',
      '--json',
    ]);
    const noNonTrivial = runCli(tmpDir, [
      'resume-probe',
      tmpDir,
      '--utterance',
      'what is this?',
      '--no-workflow-work',
      '--json',
    ]);

    expect(defaultResult.status, defaultResult.stderr).toBe(0);
    expect(noNonTrivial.status, noNonTrivial.stderr).toBe(0);
    expect(parseResult(defaultResult.stdout).action).toBe('ask_user');
    expect(parseResult(noNonTrivial.stdout).action).toBe('out_of_scope');
  });

  it('maps --already-in-comet-flow to out_of_scope', () => {
    const result = runCli(tmpDir, [
      'resume-probe',
      tmpDir,
      '--utterance',
      'continue',
      '--already-in-comet-flow',
      '--json',
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(parseResult(result.stdout).action).toBe('out_of_scope');
  });
});
