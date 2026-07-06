import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSync = vi.fn();
const project = path.join(os.tmpdir(), 'comet-eval-project');
const manifest = path.join(os.tmpdir(), 'demo', 'comet', 'eval.yaml');
const skillPath = path.join(os.tmpdir(), 'demo-skill');
const evalCwd = path.join(path.resolve(project), 'eval');

vi.mock('child_process', () => ({
  execFileSync,
}));

function expectUvRun(args: string[]): void {
  expect(execFileSync).toHaveBeenCalledWith('uv', ['--version'], { stdio: 'pipe' });
  expect(execFileSync).toHaveBeenCalledWith('uv', args, {
    cwd: evalCwd,
    stdio: 'inherit',
  });
}

describe('eval command', () => {
  beforeEach(() => {
    execFileSync.mockReset();
    execFileSync.mockReturnValue(Buffer.from(''));
  });

  it('runs a manifest-backed quick eval from the repo root', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await evalRunCommand({
        project,
        manifest,
        quick: true,
      });
    } finally {
      log.mockRestore();
    }

    expectUvRun([
        'run',
        'pytest',
        'local/tests/tasks/test_tasks.py',
        `--eval-manifest=${path.resolve(manifest)}`,
        '-v',
      ]);
  });

  it('uses generic-skill-smoke for local skill quick runs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await evalRunCommand({
        project,
        skillPath,
        skillName: 'demo-skill',
        profile: 'generic',
        quick: true,
      });
    } finally {
      log.mockRestore();
    }

    expectUvRun([
        'run',
        'pytest',
        'local/tests/tasks/test_tasks.py',
        '--task=generic-skill-smoke',
        `--skill-path=${path.resolve(skillPath)}`,
        '--skill-name=demo-skill',
        '--profile=generic',
        '-v',
      ]);
  });

  it('runs a local Skill target directly without requiring --skill-path', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalCommand } = await import('../../app/commands/eval.js');
      await evalCommand(skillPath, {
        project,
        quick: true,
      });
    } finally {
      log.mockRestore();
    }

    expectUvRun([
        'run',
        'pytest',
        'local/tests/tasks/test_tasks.py',
        '--task=generic-skill-smoke',
        `--skill-path=${path.resolve(skillPath)}`,
        '--skill-name=demo-skill',
        '-v',
      ]);
  });

  it('collects a manifest target directly with --collect', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalCommand } = await import('../../app/commands/eval.js');
      await evalCommand(manifest, {
        project,
        collect: true,
      });
    } finally {
      log.mockRestore();
    }

    expectUvRun([
        'run',
        'pytest',
        'local/tests/tasks/test_tasks.py',
        `--eval-manifest=${path.resolve(manifest)}`,
        '--collect-only',
      ]);
  });

  it('uses collect-only discovery for manifest smoke checks', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalCollectCommand } = await import('../../app/commands/eval.js');
      await evalCollectCommand({
        project,
        manifest,
      });
    } finally {
      log.mockRestore();
    }

    expectUvRun([
        'run',
        'pytest',
        'local/tests/tasks/test_tasks.py',
        `--eval-manifest=${path.resolve(manifest)}`,
        '--collect-only',
      ]);
  });

  it('prints eval execution details and report path for manifest runs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output = '';
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await evalRunCommand({
        project,
        manifest,
        profile: 'authoring-skill',
        task: 'generic-skill-smoke',
        html: true,
      });
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain(`Eval root: ${evalCwd}`);
    expect(output).toContain('Mode: run');
    expect(output).toContain('Profile: authoring-skill');
    expect(output).toContain('Task: generic-skill-smoke');
    expect(output).toContain('Experiment:');
    expect(output).toContain('Report path:');
    expect(output).toContain('Report config:');
    expect(output).toContain('Failure attribution:');
  });

  it('surfaces a focused target error before invoking uv', async () => {
    const { evalRunCommand } = await import('../../app/commands/eval.js');

    await expect(
      evalRunCommand({
        project,
      }),
    ).rejects.toThrow('Pass one of --manifest or --skill-path');

    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('rejects mixing the direct target with explicit target options', async () => {
    const { evalCommand } = await import('../../app/commands/eval.js');

    await expect(
      evalCommand(skillPath, {
        project,
        manifest,
      }),
    ).rejects.toThrow('Pass either a target or explicit --manifest/--skill-path options');

    expect(execFileSync).not.toHaveBeenCalled();
  });
});
