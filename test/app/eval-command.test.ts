import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'url';

const execFileSync = vi.fn();
const existsSync = vi.fn(() => true);
const prepareEvalManifest = vi.fn();
const recordRepositoryEvalExperiment = vi.fn();
const cleanupPreparedManifest = vi.fn();
const project = path.join(os.tmpdir(), 'comet-eval-project');
const manifest = path.join(os.tmpdir(), 'demo', 'comet', 'eval.yaml');
const preparedManifest = path.join(os.tmpdir(), 'prepared', 'eval.yaml');
const skillPath = path.join(os.tmpdir(), 'demo-skill');
const evalCwd = path.join(path.resolve(project), 'eval');
const repositoryEvalContext = {
  projectRoot: project,
  name: 'demo',
  draftHash: 'a'.repeat(64),
  evalManifestHash: 'b'.repeat(64),
  sourceManifestPath: manifest,
};
const packagedEvalCwd = path.resolve(
  path.dirname(fileURLToPath(new URL('../../app/commands/eval.js', import.meta.url))),
  '../../eval',
);

vi.mock('child_process', () => ({
  execFileSync,
}));

vi.mock('fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs')>()),
  existsSync,
}));

vi.mock('../../domains/bundle/eval-manifest-runtime.js', () => ({
  prepareEvalManifest,
}));

vi.mock('../../domains/bundle/eval-run-result.js', () => ({
  recordRepositoryEvalExperiment,
}));

function expectUvRun(args: string[], cwd = evalCwd): string {
  expect(execFileSync).toHaveBeenCalledWith('uv', ['--version'], { stdio: 'pipe' });
  expect(execFileSync).toHaveBeenCalledWith('uv', args, {
    cwd,
    stdio: 'inherit',
    env: expect.objectContaining({
      COMET_EVAL_EXPERIMENT_ID: expect.stringMatching(/^comet-eval-[0-9a-f-]+$/u),
    }),
  });
  const runCall = execFileSync.mock.calls.find(
    ([command, callArgs]) => command === 'uv' && Array.isArray(callArgs) && callArgs[0] === 'run',
  );
  const experimentId = runCall?.[2]?.env?.COMET_EVAL_EXPERIMENT_ID;
  expect(experimentId).toMatch(/^comet-eval-[0-9a-f-]+$/u);
  return experimentId as string;
}

describe('eval command', () => {
  beforeEach(() => {
    execFileSync.mockReset();
    execFileSync.mockReturnValue(Buffer.from(''));
    existsSync.mockReset();
    existsSync.mockReturnValue(true);
    prepareEvalManifest.mockReset();
    cleanupPreparedManifest.mockReset();
    recordRepositoryEvalExperiment.mockReset();
    prepareEvalManifest.mockResolvedValue({
      path: manifest,
      cleanup: cleanupPreparedManifest,
    });
  });

  it('uses the packaged eval harness when project is omitted', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(project);
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await evalRunCommand({
        manifest,
      });
    } finally {
      cwd.mockRestore();
      log.mockRestore();
    }

    expectUvRun(
      [
        'run',
        'pytest',
        'local/tests/tasks/test_tasks.py',
        `--eval-manifest=${path.resolve(manifest)}`,
        '-v',
      ],
      packagedEvalCwd,
    );
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
    expect(prepareEvalManifest).toHaveBeenCalledWith(manifest);
    expect(cleanupPreparedManifest).toHaveBeenCalledTimes(1);
  });

  it('records a successful local Creator eval before cleaning up the prepared manifest', async () => {
    prepareEvalManifest.mockResolvedValue({
      path: preparedManifest,
      context: repositoryEvalContext,
      cleanup: cleanupPreparedManifest,
    });
    recordRepositoryEvalExperiment.mockResolvedValue({ status: 'eval-passed' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await evalRunCommand({ project, manifest, quick: true });
    } finally {
      log.mockRestore();
    }

    const experimentId = expectUvRun([
      'run',
      'pytest',
      'local/tests/tasks/test_tasks.py',
      `--eval-manifest=${path.resolve(preparedManifest)}`,
      '-v',
    ]);
    expect(recordRepositoryEvalExperiment).toHaveBeenCalledWith({
      context: repositoryEvalContext,
      experimentDir: path.join(evalCwd, 'local', 'logs', 'experiments', experimentId),
      level: 'quick',
    });
    expect(recordRepositoryEvalExperiment.mock.invocationCallOrder[0]).toBeLessThan(
      cleanupPreparedManifest.mock.invocationCallOrder[0],
    );
  });

  it('skips Creator recording for collect-only manifest discovery', async () => {
    prepareEvalManifest.mockResolvedValue({
      path: preparedManifest,
      context: repositoryEvalContext,
      cleanup: cleanupPreparedManifest,
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalCollectCommand } = await import('../../app/commands/eval.js');
      await evalCollectCommand({ project, manifest });
    } finally {
      log.mockRestore();
    }

    expect(recordRepositoryEvalExperiment).not.toHaveBeenCalled();
    expect(cleanupPreparedManifest).toHaveBeenCalledTimes(1);
  });

  it('preserves a Creator recording failure while still cleaning up the prepared manifest', async () => {
    const recordFailure = new Error('record failed');
    prepareEvalManifest.mockResolvedValue({
      path: preparedManifest,
      context: repositoryEvalContext,
      cleanup: cleanupPreparedManifest,
    });
    recordRepositoryEvalExperiment.mockRejectedValue(recordFailure);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await expect(evalRunCommand({ project, manifest, quick: false })).rejects.toBe(recordFailure);
    } finally {
      log.mockRestore();
    }

    expect(recordRepositoryEvalExperiment).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'full' }),
    );
    expect(cleanupPreparedManifest).toHaveBeenCalledTimes(1);
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
    expect(prepareEvalManifest).not.toHaveBeenCalled();
    expect(cleanupPreparedManifest).not.toHaveBeenCalled();
  });

  it('routes LangSmith evals through the LangSmith runner and report directory', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await evalRunCommand({
        project,
        skillPath,
        suite: 'langsmith',
        task: 'generic-skill-smoke',
      });
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    const experimentId = expectUvRun([
      'run',
      'pytest',
      'langsmith/tests/tasks/test_tasks.py',
      '--task=generic-skill-smoke',
      `--skill-path=${path.resolve(skillPath)}`,
      '-v',
    ]);
    expect(recordRepositoryEvalExperiment).not.toHaveBeenCalled();
    expect(output).toContain('Suite: langsmith');
    expect(output).toContain(
      path.join(evalCwd, 'langsmith', 'logs', 'experiments', experimentId, 'summary.md'),
    );
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
    let output: string;
    prepareEvalManifest.mockResolvedValue({
      path: preparedManifest,
      cleanup: cleanupPreparedManifest,
    });
    try {
      const { evalCollectCommand } = await import('../../app/commands/eval.js');
      await evalCollectCommand({
        project,
        manifest,
      });
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expectUvRun([
      'run',
      'pytest',
      'local/tests/tasks/test_tasks.py',
      `--eval-manifest=${path.resolve(preparedManifest)}`,
      '--collect-only',
    ]);
    expect(prepareEvalManifest).toHaveBeenCalledWith(manifest);
    expect(cleanupPreparedManifest).toHaveBeenCalledTimes(1);
    expect(output).toContain(`Target: manifest ${path.resolve(manifest)}`);
    expect(output).not.toContain(preparedManifest);
  });

  it('preserves pytest failures and cleans up a prepared manifest once', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    prepareEvalManifest.mockResolvedValue({
      path: preparedManifest,
      cleanup: cleanupPreparedManifest,
    });
    execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === 'uv' && args[0] === 'run') throw new Error('pytest failed');
      return Buffer.from('');
    });
    try {
      const { evalCollectCommand } = await import('../../app/commands/eval.js');
      await expect(evalCollectCommand({ project, manifest })).rejects.toThrow('pytest failed');
    } finally {
      log.mockRestore();
    }

    expect(prepareEvalManifest).toHaveBeenCalledWith(manifest);
    expect(cleanupPreparedManifest).toHaveBeenCalledTimes(1);
  });

  it('cleans up a prepared manifest when eval run fails', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === 'uv' && args[0] === 'run') throw new Error('run failed');
      return Buffer.from('');
    });
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await expect(evalRunCommand({ project, manifest })).rejects.toThrow('run failed');
    } finally {
      log.mockRestore();
    }

    expect(cleanupPreparedManifest).toHaveBeenCalledTimes(1);
  });

  it('cleans up a prepared manifest when runtime argument preparation fails', async () => {
    const argumentFailure = new Error('argument preparation failed');
    prepareEvalManifest.mockResolvedValue({
      get path() {
        throw argumentFailure;
      },
      cleanup: cleanupPreparedManifest,
    });
    const { evalRunCommand } = await import('../../app/commands/eval.js');

    await expect(evalRunCommand({ project, manifest })).rejects.toBe(argumentFailure);

    expect(execFileSync).not.toHaveBeenCalled();
    expect(cleanupPreparedManifest).toHaveBeenCalledTimes(1);
  });

  it('preserves the primary failure when prepared manifest cleanup also fails', async () => {
    const primaryFailure = new Error('pytest failed');
    cleanupPreparedManifest.mockRejectedValue(new Error('cleanup failed'));
    execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === 'uv' && args[0] === 'run') throw primaryFailure;
      return Buffer.from('');
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await expect(evalRunCommand({ project, manifest })).rejects.toBe(primaryFailure);
    } finally {
      log.mockRestore();
    }

    expect(cleanupPreparedManifest).toHaveBeenCalledTimes(1);
  });

  it('preserves an undefined primary failure when prepared manifest cleanup also fails', async () => {
    cleanupPreparedManifest.mockRejectedValue(new Error('cleanup failed'));
    execFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === 'uv' && args[0] === 'run') throw undefined;
      return Buffer.from('');
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await expect(evalRunCommand({ project, manifest })).rejects.toBeUndefined();
    } finally {
      log.mockRestore();
    }

    expect(cleanupPreparedManifest).toHaveBeenCalledTimes(1);
  });

  it('surfaces cleanup failures when the eval body succeeds', async () => {
    const cleanupFailure = new Error('cleanup failed');
    cleanupPreparedManifest.mockRejectedValue(cleanupFailure);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await expect(evalRunCommand({ project, manifest })).rejects.toBe(cleanupFailure);
    } finally {
      log.mockRestore();
    }

    expect(cleanupPreparedManifest).toHaveBeenCalledTimes(1);
  });

  it('prints eval execution details and report path for manifest runs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
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

  it('reports a missing eval harness before invoking uv', async () => {
    existsSync.mockReturnValue(false);
    const { evalRunCommand } = await import('../../app/commands/eval.js');

    await expect(
      evalRunCommand({
        project,
        manifest,
      }),
    ).rejects.toThrow(
      `Eval harness is missing at ${evalCwd}.\n` +
        'Reinstall @rpamis/comet or pass --project <repository-root>.',
    );

    expect(execFileSync).not.toHaveBeenCalled();
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

  it('rejects an unsupported eval suite before invoking uv', async () => {
    const { evalRunCommand } = await import('../../app/commands/eval.js');

    await expect(
      evalRunCommand({
        project,
        manifest,
        suite: 'remote' as 'local',
      }),
    ).rejects.toThrow('Unsupported eval suite: remote. Expected local or langsmith.');

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
