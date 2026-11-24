import { createNativePortableChange } from '../../domains/comet-native/native-portable-runtime.js';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nativeProjectPaths } from '../../domains/comet-native/native-paths.js';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';
import { resolveProjectLanguage } from '../../app/commands/resume-probe.js';
import { writeClassicDelivery } from '../../domains/comet-classic/classic-progress.js';
import { resolveClassicStateFile } from '../../domains/workflow-contract/classic-state-file.js';

const repositoryRoot = path.resolve('.');
const cli = path.join(repositoryRoot, 'bin', 'comet.js');
const stateScript = path.resolve('assets', 'skills', 'comet', 'scripts', 'comet-state.mjs');
const activeChange = 'resume-probe-change';

function classicProjectConfig(ambientResume = true): string {
  return [
    'schema: comet.project.v1',
    'default_workflow: classic',
    'workflows: [classic]',
    `ambient_resume: ${String(ambientResume)}`,
    'classic:',
    '  artifact_layout: legacy',
    '  language: en',
    '',
  ].join('\n');
}

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
    await fs.mkdir(path.join(tmpDir, '.comet'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.comet', 'config.yaml'), classicProjectConfig(), 'utf8');
    await fs.mkdir(path.join(tmpDir, 'openspec'), { recursive: true });
    state(tmpDir, ['init', activeChange, 'full', '--runtime', 'compat']);
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
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns JSON using top-level CLI invocation and --utterance', () => {
    const unconfirmed = runCli(tmpDir, ['resume-probe', tmpDir, '--utterance', '继续', '--json']);
    expect(unconfirmed.status, unconfirmed.stderr).toBe(0);
    expect(parseResult(unconfirmed.stdout)).toMatchObject({
      action: 'ask_user',
      changeName: activeChange,
      nextCommand: null,
    });
    const result = runCli(tmpDir, [
      'resume-probe',
      tmpDir,
      '--utterance',
      `继续 ${activeChange}`,
      '--json',
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(parseResult(result.stdout)).toMatchObject({
      schema_version: 'comet.resume_probe.v2',
      workflow: 'classic',
      skill: 'comet-classic',
      entrySource: 'project-config',
      action: 'auto_resume',
      nextCommand: '/comet-classic',
    });
  });

  it('does not treat the removed flat language field as the project locale', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      'language: zh-CN\nambient_resume: true\n',
      'utf8',
    );

    await expect(resolveProjectLanguage(tmpDir)).resolves.toBe('unknown');
  });

  it('renders the resolved workflow and permanent entry in text mode', () => {
    const unconfirmed = runCli(tmpDir, ['resume-probe', tmpDir, '--utterance', '继续']);
    expect(unconfirmed.status, unconfirmed.stderr).toBe(0);
    expect(unconfirmed.stdout).toContain('action: ask_user');
    expect(unconfirmed.stdout).not.toContain('next:');
    const result = runCli(tmpDir, ['resume-probe', tmpDir, '--utterance', `继续 ${activeChange}`]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('workflow: classic');
    expect(result.stdout).toContain('skill: comet-classic');
    expect(result.stdout).toContain('next: /comet-classic');
  });

  it('honors ambient_resume: false in a legacy Classic project config', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.comet', 'config.yaml'),
      classicProjectConfig(false),
      'utf8',
    );

    const result = runCli(tmpDir, ['resume-probe', tmpDir, '--utterance', '继续', '--json']);

    expect(result.status, result.stderr).toBe(0);
    expect(parseResult(result.stdout)).toMatchObject({
      workflow: null,
      skill: null,
      action: 'out_of_scope',
      reason: 'Ambient Resume is disabled by .comet/config.yaml',
      nextCommand: null,
    });
  });

  it('routes a configured Native project without considering Classic changes', async () => {
    const initialized = runCli(tmpDir, ['native', 'init', '--language', 'en']);
    expect(initialized.status, initialized.stderr).toBe(0);
    await createNativePortableChange({
      paths: await nativeProjectPaths(tmpDir, 'docs'),
      name: 'native-resume',
      language: 'en',
    });
    const changeDir = path.join(tmpDir, 'docs', 'comet', 'changes', 'native-resume');
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
      `continue ${activeChange}`,
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

describe('Classic resume-probe discovery', () => {
  let projectRoot: string;

  beforeAll(async () => {
    await ensureCliBuilt(repositoryRoot);
  }, 120_000);

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-resume-discovery-'));
    await fs.mkdir(path.join(projectRoot, '.comet'));
    await fs.writeFile(path.join(projectRoot, '.comet/config.yaml'), classicProjectConfig());
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function archive(name: string, branchStatus?: 'handled' | 'pending', archived = true) {
    const dir = path.join(projectRoot, 'openspec/changes/archive', `2026-11-24-${name}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'proposal.md'), '# Accepted proposal\n');
    if (branchStatus)
      await fs.writeFile(
        path.join(dir, '.comet.yaml'),
        [
          'workflow: hotfix',
          'phase: archive',
          `archived: ${archived}`,
          `branch_status: ${branchStatus}`,
          'verify_result: pass',
          'created_at: 2026-11-24T00:00:00.000Z',
          'base_ref: main',
          'design_doc: null',
          'plan: null',
          'build_mode: null',
          'isolation: current',
          'verify_mode: full',
          'verified_at: 2026-11-24T00:00:00.000Z',
          '',
        ].join('\n'),
      );
    return dir;
  }

  function probe(utterance = '继续') {
    const captured = runCli(projectRoot, ['resume-probe', '.', '--stdin', '--json'], utterance);
    expect(captured.status, captured.stderr).toBe(0);
    return parseResult(captured.stdout);
  }

  it('skips a legacy OpenSpec archive without Comet state', async () => {
    const dir = await archive('plain-archive');
    expect(probe()).toMatchObject({ action: 'none', changeName: null, nextCommand: null });
    expect(await fs.readdir(dir)).toEqual(['proposal.md']);
  });

  it('excludes handled legacy archives without receipts and keeps pending delivery visible', async () => {
    await archive('first-delivered', 'handled');
    await archive('second-delivered', 'handled');
    expect(probe()).toMatchObject({ action: 'none', changeName: null, nextCommand: null });

    await archive('awaiting-delivery', 'pending');
    expect(probe()).toMatchObject({
      action: 'ask_user',
      phase: 'archive',
      changeName: 'awaiting-delivery',
      reason: 'archived change has pending delivery',
    });
  });

  it('retains pending sealed delivery even when archived YAML says handled', async () => {
    const dir = await archive('sealed-delivery', 'handled', false);
    await writeClassicDelivery(
      projectRoot,
      dir,
      { action: 'archive-only' },
      {
        phase: 'archive',
        verifyResult: 'pass',
        archived: false,
      },
    );
    const file = path.join(dir, '.comet.yaml');
    const state = (await fs.readFile(file, 'utf8')).replace('archived: false', 'archived: true');
    await fs.writeFile(file, state);
    expect(probe()).toMatchObject({
      action: 'ask_user',
      phase: 'archive',
      changeName: 'sealed-delivery',
      reason: 'archived change has pending delivery',
    });
    expect(await fs.readFile(file, 'utf8')).toBe(state);
  });

  it('ignores unmanaged active OpenSpec changes in agreement with status', async () => {
    const dir = path.join(projectRoot, 'openspec/changes/openspec-only');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'proposal.md'), '# OpenSpec only\n');
    await fs.writeFile(path.join(dir, 'tasks.md'), '- [ ] Implement\n');
    const status = runCli(projectRoot, ['status']);
    expect(status.status, status.stderr).toBe(0);
    expect(status.stdout).toMatch(/Unmanaged OpenSpec Changes:[\s\S]*openspec-only/);
    expect(probe()).toMatchObject({ action: 'none', changeName: null, nextCommand: null });
    expect(probe('继续 openspec-only')).toMatchObject({ action: 'none', changeName: null });
  });

  it('reports missing state for a change with a Classic runtime owner', async () => {
    await fs.mkdir(path.join(projectRoot, 'openspec'));
    state(projectRoot, ['init', 'owned-classic', 'full', '--runtime', 'compat']);
    const dir = path.join(projectRoot, 'openspec/changes/owned-classic');
    await fs.rm(await resolveClassicStateFile(dir));
    expect(probe('继续 owned-classic')).toMatchObject({
      action: 'ask_user',
      changeName: 'owned-classic',
      phase: 'invalid',
      reason: 'active OpenSpec change is missing Comet state',
      nextCommand: null,
    });
  });
});
