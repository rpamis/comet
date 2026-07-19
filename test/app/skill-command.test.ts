import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  skillCheckCommand,
  skillInspectCommand,
  skillInstallCommand,
  skillResumeCommand,
  skillRunCommand,
  skillShowCommand,
  skillValidateCommand,
} from '../../app/commands/skill.js';

async function writeSkill(root: string, version = '1'): Promise<void> {
  await fs.mkdir(path.join(root, 'comet'), { recursive: true });
  await fs.writeFile(path.join(root, 'SKILL.md'), '# Demo\n');
  await fs.writeFile(
    path.join(root, 'comet', 'skill.yaml'),
    `apiVersion: comet/v1alpha1
kind: Skill
metadata:
  name: demo
  version: "${version}"
  description: Demo skill
goal:
  statement: Complete the demo
  inputs: []
  outputs: []
  success:
    - Done
orchestration:
  mode: deterministic
  entry: finish
  steps:
    - id: finish
      action:
        type: checkpoint
skills: []
agents: []
tools: []
`,
  );
}

async function captureJson(run: () => Promise<void>): Promise<Record<string, unknown>> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await run();
    return JSON.parse(log.mock.calls.map((call) => call.join(' ')).join('\n'));
  } finally {
    log.mockRestore();
  }
}

describe('skill validate and inspect commands', () => {
  let root: string;
  let projectRoot: string;
  let skillRoot: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-skill-command-'));
    projectRoot = path.join(root, 'project');
    skillRoot = path.join(projectRoot, '.comet', 'skills', 'demo');
    await writeSkill(skillRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('validates a project Skill and reports its stable identity', async () => {
    const result = await captureJson(() =>
      skillValidateCommand('demo', { project: projectRoot, json: true }),
    );

    expect(result).toMatchObject({
      valid: true,
      name: 'demo',
      version: '1',
      origin: 'project',
    });
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('installs an explicit Skill into a different project', async () => {
    const targetProject = path.join(root, 'target');

    const result = await captureJson(() =>
      skillInstallCommand(skillRoot, { project: targetProject, json: true }),
    );

    expect(result).toMatchObject({
      name: 'demo',
      version: '1',
      destination: path.join(targetProject, '.comet', 'skills', 'demo'),
    });
  });

  it('shows Skill identity and package details through the simplified facade', async () => {
    const result = await captureJson(() =>
      skillShowCommand('demo', { project: projectRoot, json: true }),
    );

    expect(result).toMatchObject({
      valid: true,
      name: 'demo',
      origin: 'project',
      description: 'Demo skill',
      orchestration: {
        mode: 'deterministic',
        entry: 'finish',
      },
      skills: [],
      agents: [],
      tools: [],
      checks: [],
    });
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('runs, resumes, and evaluates a deterministic Skill as JSON', async () => {
    const changeDir = path.join(root, 'change');
    await fs.writeFile(
      path.join(skillRoot, 'comet', 'checks.yaml'),
      `runtime:
  - id: report
    scope: completion
    type: artifact_exists
    artifact: report
`,
    );

    const started = await captureJson(() =>
      skillRunCommand('demo', {
        project: projectRoot,
        change: changeDir,
        json: true,
      }),
    );
    expect(started).toMatchObject({
      state: { skill: 'demo', status: 'waiting' },
      action: { type: 'checkpoint', stepId: 'finish' },
      checks: [],
    });

    const completed = await captureJson(() =>
      skillResumeCommand({
        change: changeDir,
        status: 'succeeded',
        summary: 'Finished',
        artifact: ['report=report.md'],
        state: ['reviewed=true'],
        json: true,
      }),
    );
    expect(completed).toMatchObject({
      state: { status: 'completed' },
      action: null,
      checks: [{ checkId: 'report', passed: true }],
    });

    const evaluated = await captureJson(() =>
      skillCheckCommand({ change: changeDir, scope: 'completion', json: true }),
    );
    expect(evaluated).toMatchObject({
      scope: 'completion',
      checks: [{ checkId: 'report', passed: true }],
    });
  });

  it('prints actionable next steps in text mode for pending and failed check states', async () => {
    const changeDir = path.join(root, 'text-change');
    await fs.writeFile(
      path.join(skillRoot, 'comet', 'checks.yaml'),
      `runtime:
  - id: report
    scope: completion
    type: artifact_exists
    artifact: report
`,
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await skillRunCommand('demo', {
        project: projectRoot,
        change: changeDir,
      });
      const runOutput = log.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(runOutput).toContain('Pending action:');
      expect(runOutput).toContain(
        'Next: complete the pending action, then run comet skill continue',
      );

      log.mockClear();
      await skillResumeCommand({
        change: changeDir,
        status: 'succeeded',
        summary: 'Finished without artifact',
      });
      await skillCheckCommand({ change: changeDir, scope: 'completion' });
      const evalOutput = log.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(evalOutput).toContain('FAIL report: artifact report not found');
      expect(evalOutput).toContain(
        'Next: record the missing artifact/state and rerun comet skill check',
      );
    } finally {
      log.mockRestore();
    }
  });

  it('covers waiting run, succeeded resume, failed check, and passed check text states', async () => {
    const changeDir = path.join(root, 'state-coverage-change');
    await fs.writeFile(
      path.join(skillRoot, 'comet', 'checks.yaml'),
      `runtime:
  - id: report
    scope: completion
    type: artifact_exists
    artifact: report
`,
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await skillRunCommand('demo', {
        project: projectRoot,
        change: changeDir,
      });
      const waitingOutput = log.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(waitingOutput).toContain('Status: waiting');
      expect(waitingOutput).toContain('Pending action:');
      expect(waitingOutput).toContain('Runtime checks: 0');

      log.mockClear();
      await skillResumeCommand({
        change: changeDir,
        status: 'succeeded',
        summary: 'Finished',
        artifact: ['report=report.md'],
      });
      const resumedOutput = log.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(resumedOutput).toContain('Status: completed');
      expect(resumedOutput).toContain('Next: none');

      log.mockClear();
      await skillCheckCommand({ change: changeDir, scope: 'completion' });
      const passedEvalOutput = log.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(passedEvalOutput).toContain('PASS report: artifact report -> report.md');

      const failedChangeDir = path.join(root, 'state-coverage-failed-change');
      log.mockClear();
      await skillRunCommand('demo', {
        project: projectRoot,
        change: failedChangeDir,
      });
      log.mockClear();
      await skillResumeCommand({
        change: failedChangeDir,
        status: 'succeeded',
        summary: 'Finished without artifact',
      });
      await skillCheckCommand({ change: failedChangeDir, scope: 'completion' });
      const failedEvalOutput = log.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(failedEvalOutput).toContain('FAIL report: artifact report not found');
      expect(failedEvalOutput).toContain(
        'Next: record the missing artifact/state and rerun comet skill check',
      );
    } finally {
      log.mockRestore();
    }
  });

  it('explicitly upgrades a completed Run to a compatible Skill snapshot', async () => {
    const changeDir = path.join(root, 'upgrade-change');
    await skillRunCommand('demo', {
      project: projectRoot,
      change: changeDir,
      json: true,
    });
    await skillResumeCommand({
      change: changeDir,
      status: 'succeeded',
      summary: 'Finished',
      json: true,
    });
    await writeSkill(skillRoot, '2');

    const result = await captureJson(() =>
      skillResumeCommand({
        project: projectRoot,
        change: changeDir,
        upgrade: 'demo',
        json: true,
      }),
    );

    expect(result).toMatchObject({
      changed: true,
      state: { skill: 'demo', skillVersion: '2' },
    });
  });

  it('inspects orchestration, dependencies and guardrails without modifying the Skill', async () => {
    const before = await fs.readFile(path.join(skillRoot, 'comet', 'skill.yaml'), 'utf8');

    const result = await captureJson(() =>
      skillInspectCommand('demo', { project: projectRoot, json: true }),
    );

    expect(result).toMatchObject({
      name: 'demo',
      origin: 'project',
      orchestration: {
        mode: 'deterministic',
        entry: 'finish',
      },
      skills: [],
      agents: [],
      tools: [],
      checks: [],
    });
    expect(await fs.readFile(path.join(skillRoot, 'comet', 'skill.yaml'), 'utf8')).toBe(before);
  });
});
