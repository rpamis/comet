import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'url';

const execFileSync = vi.fn();
const existsSync = vi.fn(() => true);
const readFile = vi.fn();
const prepareEvalManifest = vi.fn();
const recordRepositoryEvalExperiment = vi.fn();
const cleanupPreparedManifest = vi.fn();
const loadUserEvalEnvironment = vi.fn();
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

vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  return {
    ...original,
    execFileSync,
  };
});

vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>();
  return {
    ...original,
    promises: {
      ...original.promises,
      readFile: (target: Parameters<typeof original.promises.readFile>[0], ...args: unknown[]) =>
        String(target).includes('v1alpha1.schema.json')
          ? original.promises.readFile(target, ...(args as []))
          : readFile(target, ...args),
      stat: async (target: Parameters<typeof original.promises.stat>[0]) => {
        if (String(target).includes('comet-eval-context-')) return original.promises.stat(target);
        return {
          isFile: () =>
            String(target).endsWith('SKILL.md') || /eval[\\/]local[\\/]tasks/u.test(String(target)),
          isDirectory: () => true,
        };
      },
    },
    existsSync,
  };
});

vi.mock('../../domains/bundle/eval-manifest-runtime.js', () => ({
  prepareEvalManifest,
}));

vi.mock('../../domains/bundle/eval-run-result.js', () => ({
  recordRepositoryEvalExperiment,
}));

vi.mock('../../domains/eval/user-environment.js', () => ({
  loadUserEvalEnvironment,
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
    readFile.mockImplementation((target: unknown) =>
      Promise.resolve(
        String(target).endsWith('task.toml')
          ? `[metadata]\nname = "${path.basename(path.dirname(String(target)))}"\n`
          : 'apiVersion: comet.eval/v1alpha1\nkind: SkillEvalManifest\nmetadata: { name: demo }\nskill: { name: demo, source: .. }\nevaluation: {}\n',
      ),
    );
    prepareEvalManifest.mockReset();
    cleanupPreparedManifest.mockReset();
    recordRepositoryEvalExperiment.mockReset();
    loadUserEvalEnvironment.mockReset();
    prepareEvalManifest.mockResolvedValue({
      path: manifest,
      cleanup: cleanupPreparedManifest,
    });
  });

  it('loads the user eval environment before run and collect modes', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalRunCommand, evalCollectCommand } = await import('../../app/commands/eval.js');
      await evalCollectCommand({ project, manifest });
      await evalRunCommand({ project, manifest, quick: true });
    } finally {
      log.mockRestore();
    }

    expect(loadUserEvalEnvironment).toHaveBeenCalledTimes(2);
  });

  it('prints the generated user eval config path on first startup', async () => {
    loadUserEvalEnvironment.mockReturnValue({
      path: 'C:\\Users\\demo\\.comet\\eval\\.env',
      created: true,
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalCollectCommand } = await import('../../app/commands/eval.js');
      await evalCollectCommand({ project, manifest });

      expect(log).toHaveBeenCalledWith(
        'Created user Eval config template: C:\\Users\\demo\\.comet\\eval\\.env',
      );
      expect(log).toHaveBeenCalledWith(
        'Edit this file with your model credentials, then run comet eval again.',
      );
    } finally {
      log.mockRestore();
    }
  });

  it('uses the common Bench model in launch details', async () => {
    const previous = process.env.BENCH_MODEL;
    process.env.BENCH_MODEL = 'bench-model';
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalCollectCommand } = await import('../../app/commands/eval.js');
      await evalCollectCommand({ project, manifest });
      expect(log.mock.calls.map((call) => [...call])).toContainEqual(['Main Model: bench-model']);
    } finally {
      if (previous === undefined) delete process.env.BENCH_MODEL;
      else process.env.BENCH_MODEL = previous;
      log.mockRestore();
    }
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
        `--project-root=${path.join(os.tmpdir(), 'demo')}`,
        '-v',
      ],
      packagedEvalCwd,
    );
    const run = execFileSync.mock.calls.find(
      ([command, args]) => command === 'uv' && Array.isArray(args) && args[0] === 'run',
    );
    expect(run?.[2]?.env).toMatchObject({
      PYTHONDONTWRITEBYTECODE: '1',
      UV_CACHE_DIR: path.join(os.tmpdir(), 'demo', '.comet', 'eval', 'cache', 'uv'),
      UV_PROJECT_ENVIRONMENT: path.join(os.tmpdir(), 'demo', '.comet', 'eval', 'cache', 'venv'),
    });
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
      '--quick',
      `--project-root=${path.resolve(project)}`,
      '-v',
    ]);
    expect(prepareEvalManifest).toHaveBeenCalledWith(manifest);
    expect(cleanupPreparedManifest).toHaveBeenCalledTimes(1);
  });

  it('passes an explicitly selected agent to the eval harness', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await evalRunCommand({
        project,
        manifest,
        agent: 'qoder',
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
      '--agent=qoder',
      '--quick',
      `--project-root=${path.resolve(project)}`,
      '-v',
    ]);
  });

  it('passes CodeBuddy selection to the eval harness', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await evalRunCommand({
        project,
        manifest,
        agent: 'codebuddy',
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
      '--agent=codebuddy',
      '--quick',
      `--project-root=${path.resolve(project)}`,
      '-v',
    ]);
  });

  it('passes main and independent Judge model routing options to the eval harness', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await evalRunCommand({
        project,
        manifest,
        agent: 'codex',
        model: 'subject-model',
        baseUrl: 'https://subject.example/v1',
        judgeAgent: 'claude-code',
        judgeModel: 'judge-model',
        judgeBaseUrl: 'https://judge.example/v1',
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
      '--agent=codex',
      '--model=subject-model',
      '--base-url=https://subject.example/v1',
      '--judge-agent=claude-code',
      '--judge-model=judge-model',
      '--judge-base-url=https://judge.example/v1',
      '--quick',
      `--project-root=${path.resolve(project)}`,
      '-v',
    ]);
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
      '--quick',
      `--project-root=${path.resolve(project)}`,
      '-v',
    ]);
    expect(recordRepositoryEvalExperiment).toHaveBeenCalledWith({
      context: repositoryEvalContext,
      experimentDir: path.join(project, '.comet', 'eval', 'runs', experimentId),
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
    expect(cleanupPreparedManifest).not.toHaveBeenCalled();
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

  it('forwards local skill quick intent without independently selecting a task', async () => {
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
      `--skill-path=${path.resolve(skillPath)}`,
      '--skill-name=demo-skill',
      '--profile=generic',
      '--quick',
      `--project-root=${path.resolve(project)}`,
      '-v',
    ]);
    expect(prepareEvalManifest).not.toHaveBeenCalled();
    expect(cleanupPreparedManifest).not.toHaveBeenCalled();
  });

  it('leaves the normal local Skill run taskless for automatic task generation', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await evalRunCommand({
        project,
        skillPath,
        skillName: 'demo-skill',
      });
    } finally {
      log.mockRestore();
    }

    expectUvRun([
      'run',
      'pytest',
      'local/tests/tasks/test_tasks.py',
      `--skill-path=${path.resolve(skillPath)}`,
      '--skill-name=demo-skill',
      `--project-root=${path.resolve(project)}`,
      '-v',
    ]);
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
      `--project-root=${path.resolve(project)}`,
      '-v',
    ]);
    expect(recordRepositoryEvalExperiment).not.toHaveBeenCalled();
    expect(output).toContain('Suite: langsmith');
    expect(output).toContain(
      path.join(project, '.comet', 'eval', 'runs', experimentId, 'summary.md'),
    );
  });

  it('routes Langfuse evals through the Langfuse runner and report directory', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output: string;
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await evalRunCommand({
        project,
        skillPath,
        suite: 'langfuse',
        task: 'generic-skill-smoke',
      });
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    const experimentId = expectUvRun([
      'run',
      '--extra',
      'langfuse',
      'pytest',
      'langfuse/tests/tasks/test_tasks.py',
      '--task=generic-skill-smoke',
      `--skill-path=${path.resolve(skillPath)}`,
      `--project-root=${path.resolve(project)}`,
      '-v',
    ]);
    expect(recordRepositoryEvalExperiment).not.toHaveBeenCalled();
    expect(output).toContain('Suite: langfuse');
    expect(output).toContain(
      path.join(project, '.comet', 'eval', 'runs', experimentId, 'summary.md'),
    );
  });

  it('routes Langfuse collection through the offline static collector without the optional extra', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalCollectCommand } = await import('../../app/commands/eval.js');
      await evalCollectCommand({
        project,
        skillPath,
        suite: 'langfuse',
        task: 'generic-skill-smoke',
      });
    } finally {
      log.mockRestore();
    }

    expect(execFileSync).not.toHaveBeenCalled();
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
      `--skill-path=${path.resolve(skillPath)}`,
      '--skill-name=demo-skill',
      '--quick',
      `--project-root=${path.resolve(project)}`,
      '-v',
    ]);
  });

  it('collects a manifest target directly through the static collector', async () => {
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

    expect(execFileSync).not.toHaveBeenCalled();
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

    expect(execFileSync).not.toHaveBeenCalled();
    expect(prepareEvalManifest).not.toHaveBeenCalled();
    expect(cleanupPreparedManifest).not.toHaveBeenCalled();
    expect(output).toContain(`Target: manifest ${path.resolve(manifest)}`);
    expect(output).not.toContain(preparedManifest);
  });

  it('does not start a subprocess or prepare a manifest for static collection', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    prepareEvalManifest.mockResolvedValue({
      path: preparedManifest,
      cleanup: cleanupPreparedManifest,
    });
    try {
      const { evalCollectCommand } = await import('../../app/commands/eval.js');
      await evalCollectCommand({ project, manifest });
    } finally {
      log.mockRestore();
    }

    expect(prepareEvalManifest).not.toHaveBeenCalled();
    expect(cleanupPreparedManifest).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('rejects invalid deterministic inline expectations during static collection', async () => {
    const invalidManifest = [
      'apiVersion: comet.eval/v1alpha1',
      'kind: SkillEvalManifest',
      'metadata: { name: demo }',
      'skill: { name: demo, source: .. }',
      'evaluation:',
      '  tasks:',
      '    - name: invalid-expect',
      '      prompt: do work',
      '      expect:',
      '        json:',
      '          - file: result.json',
      '            path: items[0]',
      '            equals: done',
      '',
    ].join('\n');
    readFile.mockImplementation((target: unknown) =>
      Promise.resolve(
        String(target).endsWith('task.toml')
          ? `[metadata]\nname = "${path.basename(path.dirname(String(target)))}"\n`
          : invalidManifest,
      ),
    );
    const { evalCollectCommand } = await import('../../app/commands/eval.js');

    await expect(evalCollectCommand({ project, manifest })).rejects.toThrow(
      'evaluation.tasks[0].expect.json[0].path',
    );
    expect(execFileSync).not.toHaveBeenCalled();
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
    expect(output).toContain('Task selection: explicit');
    expect(output).toContain('- generic-skill-smoke');
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
      `Eval harness is missing at ${packagedEvalCwd}.\n` +
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
    ).rejects.toThrow('Unsupported eval suite: remote. Expected local, langsmith, or langfuse.');

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

  it('resolves a Skill directory, SKILL.md, and auto-detected manifest to one user-owned context', async () => {
    const { promises: fs } = await vi.importActual<typeof import('node:fs')>('node:fs');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-context-'));
    const skill = path.join(root, 'skill');
    const manifestPath = path.join(skill, 'comet', 'eval.yaml');
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(path.join(skill, 'SKILL.md'), '# Demo\n', 'utf8');
    await fs.writeFile(
      manifestPath,
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata:',
        '  name: demo',
        'skill:',
        '  name: demo',
        '  source: ..',
        '',
      ].join('\n'),
      'utf8',
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalCommand } = await import('../../app/commands/eval.js');
      await evalCommand(skill, { quick: true });
      await evalCommand(path.join(skill, 'SKILL.md'), { quick: true });
    } finally {
      log.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }

    const runs = execFileSync.mock.calls.filter(
      ([command, args]) => command === 'uv' && Array.isArray(args) && args[0] === 'run',
    );
    expect(runs).toHaveLength(2);
    for (const [, args, options] of runs) {
      expect(args).toContain(`--eval-manifest=${manifestPath}`);
      expect(args).toContain(`--project-root=${skill}`);
      expect(options.env).toMatchObject({
        COMET_EVAL_CONTEXT: JSON.stringify({
          schema: 'comet.eval.context.v1',
          skillRoot: skill,
          manifestSource: 'auto-detected',
          manifestPath,
          artifactOwnerRoot: skill,
          artifactRoot: path.join(skill, '.comet', 'eval'),
        }),
      });
    }
  });

  it('keeps explicit manifests and projects authoritative while reporting user-owned run paths', async () => {
    const { promises: fs } = await vi.importActual<typeof import('node:fs')>('node:fs');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-explicit-'));
    const skill = path.join(root, 'skill');
    const projectRoot = path.join(root, 'project');
    const manifestPath = path.join(skill, 'comet', 'eval.yml');
    await fs.mkdir(skill, { recursive: true });
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(path.join(skill, 'SKILL.md'), '# Demo\n', 'utf8');
    await fs.writeFile(
      manifestPath,
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata:',
        '  name: demo',
        'skill:',
        '  name: demo',
        `  source: ${skill.replace(/\\/gu, '/')}`,
        '',
      ].join('\n'),
      'utf8',
    );
    prepareEvalManifest.mockResolvedValue({ path: manifestPath, cleanup: cleanupPreparedManifest });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalCommand } = await import('../../app/commands/eval.js');
      await evalCommand(manifestPath, { project: projectRoot, quick: true });
    } finally {
      log.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }

    const run = execFileSync.mock.calls.find(
      ([command, args]) => command === 'uv' && Array.isArray(args) && args[0] === 'run',
    );
    expect(run?.[1]?.find((argument) => argument.startsWith('--eval-manifest='))).toBe(
      `--eval-manifest=${manifestPath}`,
    );
    expect(run?.[1]).toContain(`--project-root=${projectRoot}`);
    expect(run?.[2]?.env).toMatchObject({
      COMET_EVAL_CONTEXT: JSON.stringify({
        schema: 'comet.eval.context.v1',
        skillRoot: skill,
        manifestSource: 'explicit',
        manifestPath,
        artifactOwnerRoot: projectRoot,
        artifactRoot: path.join(projectRoot, '.comet', 'eval'),
      }),
    });
  });

  it('uses the packaged harness when an explicit artifact owner has no eval harness', async () => {
    const { promises: fs } = await vi.importActual<typeof import('node:fs')>('node:fs');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-owner-'));
    const owner = path.join(root, 'owner');
    const skill = path.join(root, 'skill');
    await fs.mkdir(owner);
    await fs.mkdir(skill);
    await fs.writeFile(path.join(skill, 'SKILL.md'), '# Demo\n', 'utf8');
    existsSync.mockImplementation((file) => path.resolve(file).startsWith(packagedEvalCwd));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { evalCommand } = await import('../../app/commands/eval.js');
      await evalCommand(skill, { project: owner, quick: true });
      expectUvRun(
        [
          'run',
          'pytest',
          'local/tests/tasks/test_tasks.py',
          `--skill-path=${skill}`,
          '--skill-name=skill',
          '--quick',
          `--project-root=${owner}`,
          '-v',
        ],
        packagedEvalCwd,
      );
    } finally {
      log.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects an owner-local .comet link that resolves outside before launching uv', async () => {
    const { promises: fs } = await vi.importActual<typeof import('node:fs')>('node:fs');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-link-'));
    const owner = path.join(root, 'owner');
    const outside = path.join(root, 'outside');
    const skill = path.join(root, 'skill');
    await fs.mkdir(owner);
    await fs.mkdir(outside);
    await fs.mkdir(skill);
    await fs.writeFile(path.join(skill, 'SKILL.md'), '# Demo\n', 'utf8');
    await fs.symlink(outside, path.join(owner, '.comet'), 'junction');
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await expect(
        evalRunCommand({ project: owner, skillPath: skill, quick: true }),
      ).rejects.toThrow('Eval artifact root must stay within its owner root');
      expect(execFileSync).not.toHaveBeenCalled();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects an owner-local cache link that resolves outside before launching uv', async () => {
    const { promises: fs } = await vi.importActual<typeof import('node:fs')>('node:fs');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-cache-link-'));
    const owner = path.join(root, 'owner');
    const outside = path.join(root, 'outside');
    const skill = path.join(root, 'skill');
    await fs.mkdir(owner);
    await fs.mkdir(outside);
    await fs.mkdir(skill);
    await fs.writeFile(path.join(skill, 'SKILL.md'), '# Demo\n', 'utf8');
    await fs.mkdir(path.join(owner, '.comet', 'eval'), { recursive: true });
    await fs.symlink(outside, path.join(owner, '.comet', 'eval', 'cache'), 'junction');
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await expect(
        evalRunCommand({ project: owner, skillPath: skill, quick: true }),
      ).rejects.toThrow('Eval managed path must stay within its owner root');
      expect(execFileSync).not.toHaveBeenCalled();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects an owner-local uv cache child link that resolves outside before launching uv', async () => {
    const { promises: fs } = await vi.importActual<typeof import('node:fs')>('node:fs');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-uv-link-'));
    const owner = path.join(root, 'owner');
    const outside = path.join(root, 'outside');
    const skill = path.join(root, 'skill');
    await fs.mkdir(outside);
    await fs.mkdir(skill);
    await fs.writeFile(path.join(skill, 'SKILL.md'), '# Demo\n', 'utf8');
    await fs.mkdir(path.join(owner, '.comet', 'eval', 'cache'), { recursive: true });
    await fs.symlink(outside, path.join(owner, '.comet', 'eval', 'cache', 'uv'), 'junction');
    try {
      const { evalRunCommand } = await import('../../app/commands/eval.js');
      await expect(
        evalRunCommand({ project: owner, skillPath: skill, quick: true }),
      ).rejects.toThrow('Eval managed path must stay within its owner root');
      expect(execFileSync).not.toHaveBeenCalled();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
