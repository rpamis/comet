import { spawnSync } from 'child_process';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { ensureCliBuilt } from '../../helpers/ensure-cli-built.js';

const repositoryRoot = path.resolve('.');
const cli = path.join(repositoryRoot, 'bin', 'comet.js');

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
  description: Demo Skill
goal:
  statement: Complete the demo
  inputs: []
  outputs: []
  success: [Done]
orchestration:
  mode: deterministic
  entry: finish
  steps:
    - id: finish
      action: { type: checkpoint }
skills: []
agents: []
tools: []
`,
  );
  await fs.writeFile(
    path.join(root, 'comet', 'checks.yaml'),
    `runtime:
  - id: report
    scope: completion
    type: artifact_exists
    artifact: report
`,
  );
}

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

describe('comet skill CLI end to end', () => {
  let root: string;
  let projectRoot: string;
  let changeDir: string;

  beforeAll(async () => {
    await ensureCliBuilt(repositoryRoot);
  }, 120_000);

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-skill-cli-'));
    projectRoot = path.join(root, 'project');
    changeDir = path.join(root, 'change');
    await writeSkill(path.join(projectRoot, '.comet', 'skills', 'demo'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('runs, resumes, upgrades, and evaluates a project Skill through bin/comet.js', async () => {
    const shown = runCli('skill', 'show', 'demo', '--project', projectRoot, '--json');
    expect(shown.status, shown.stderr).toBe(0);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      valid: true,
      name: 'demo',
      version: '1',
      origin: 'project',
      orchestration: { mode: 'deterministic', entry: 'finish' },
      checks: [{ checkId: 'report', scope: 'completion' }],
    });

    const started = runCli(
      'skill',
      'run',
      'demo',
      '--project',
      projectRoot,
      '--change',
      changeDir,
      '--json',
    );
    expect(started.status, started.stderr).toBe(0);
    expect(JSON.parse(started.stdout)).toMatchObject({
      state: { status: 'waiting', skill: 'demo' },
      action: { type: 'checkpoint', stepId: 'finish' },
    });

    const pending = runCli('skill', 'continue', '--change', changeDir, '--json');
    expect(pending.status, pending.stderr).toBe(0);
    expect(JSON.parse(pending.stdout)).toMatchObject({
      state: { status: 'waiting', skill: 'demo' },
      action: { type: 'checkpoint', stepId: 'finish' },
    });

    const resumed = runCli(
      'skill',
      'continue',
      '--change',
      changeDir,
      '--status',
      'succeeded',
      '--summary',
      'Finished',
      '--artifact',
      'report=report.md',
      '--json',
    );
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(JSON.parse(resumed.stdout)).toMatchObject({
      state: { status: 'completed' },
      checks: [{ checkId: 'report', passed: true }],
    });

    const skillRoot = path.join(projectRoot, '.comet', 'skills', 'demo');
    await writeSkill(skillRoot, '2');
    const upgraded = runCli(
      'skill',
      'continue',
      '--change',
      changeDir,
      '--project',
      projectRoot,
      '--upgrade',
      'demo',
      '--json',
    );
    expect(upgraded.status, upgraded.stderr).toBe(0);
    expect(JSON.parse(upgraded.stdout)).toMatchObject({
      changed: true,
      state: { status: 'completed', skillVersion: '2' },
    });

    const evaluated = runCli(
      'skill',
      'check',
      '--change',
      changeDir,
      '--scope',
      'completion',
      '--json',
    );
    expect(evaluated.status, evaluated.stderr).toBe(0);
    expect(JSON.parse(evaluated.stdout)).toMatchObject({
      scope: 'completion',
      checks: [{ checkId: 'report', passed: true }],
    });
  });

  it('runs a project Skill through a standalone .comet/runs/<run-id> directory', async () => {
    const started = runCli(
      'skill',
      'run',
      'demo',
      '--project',
      projectRoot,
      '--run-id',
      'standalone-demo',
      '--json',
    );
    expect(started.status, started.stderr).toBe(0);
    expect(JSON.parse(started.stdout)).toMatchObject({
      state: { status: 'waiting', skill: 'demo', runId: 'standalone-demo' },
      action: { type: 'checkpoint', stepId: 'finish' },
    });

    const resumed = runCli(
      'skill',
      'continue',
      '--project',
      projectRoot,
      '--run-id',
      'standalone-demo',
      '--status',
      'succeeded',
      '--summary',
      'Finished',
      '--artifact',
      'report=report.md',
      '--json',
    );
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(JSON.parse(resumed.stdout)).toMatchObject({
      state: { status: 'completed', runId: 'standalone-demo' },
      checks: [{ checkId: 'report', passed: true }],
    });

    const evaluated = runCli(
      'skill',
      'check',
      '--project',
      projectRoot,
      '--run-id',
      'standalone-demo',
      '--scope',
      'completion',
      '--json',
    );
    expect(evaluated.status, evaluated.stderr).toBe(0);
    expect(JSON.parse(evaluated.stdout)).toMatchObject({
      scope: 'completion',
      checks: [{ checkId: 'report', passed: true }],
    });
    await expect(
      fs.access(
        path.join(projectRoot, '.comet', 'runs', 'standalone-demo', '.comet', 'run-state.json'),
      ),
    ).resolves.toBeUndefined();
  });
});
