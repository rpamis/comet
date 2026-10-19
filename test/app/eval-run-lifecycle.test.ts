import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evalRunCommand } from '../../app/commands/eval.js';
import { readManagedEvalRun, requestStopEvalRun } from '../../domains/eval/eval-run-manager.js';
const { dockerCommand } = vi.hoisted(() => ({ dockerCommand: vi.fn() }));
const originalArgv = process.argv;
const originalExitCode = process.exitCode;
let experiment: string;
vi.mock('../../platform/process/external-command.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../platform/process/external-command.js')>();
  return {
    ...original,
    runExternalCommandAsync: (...args: Parameters<typeof original.runExternalCommandAsync>) =>
      args[0] === 'docker' ? dockerCommand(...args) : original.runExternalCommandAsync(...args),
  };
});
vi.mock('../../domains/eval/application-eval.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../domains/eval/application-eval.js')>()),
  previewWorkflowApplicationEval: vi.fn(async () => ({
    application: { id: 'fixture', contentHash: 'content' },
    confirmationHash: 'confirmation',
    settings: { agent: 'codex', model: 'fixture-model' },
  })),
  runWorkflowApplicationEval: vi.fn(async (input) => {
    experiment = input.experimentId;
    return { status: 'passed', passed: 1, total: 1 };
  }),
}));
vi.mock('../../platform/process/run-owned-command.js', async () => {
  const childProcess = await import('child_process');
  return {
    runOwnedCommand: vi.fn(async (command, args, options) =>
      childProcess.execFileSync(command, args, {
        cwd: options.cwd,
        stdio: 'inherit',
        env: options.env,
      }),
    ),
  };
});
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn((_command, args, options) => {
      if (args[0] === '--version') return Buffer.from('uv test');
      const context = JSON.parse(options.env.COMET_EVAL_CONTEXT);
      experiment = options.env.COMET_EVAL_EXPERIMENT_ID;
      const root = path.join(context.artifactRoot, 'runs', experiment);
      mkdirSync(root, { recursive: true });
      writeFileSync(
        path.join(root, 'metadata.json'),
        JSON.stringify({
          completed_at: new Date().toISOString(),
          expected_case_matrix: { case_count: 0 },
        }),
      );
      return Buffer.from('');
    }),
  };
});
describe('CLI Eval lifecycle', () => {
  let project: string;
  beforeEach(async () => {
    dockerCommand.mockReset().mockResolvedValue('');
    process.exitCode = undefined;
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-cli-eval-run-'));
    vi.spyOn(os, 'homedir').mockReturnValue(path.join(project, 'home'));
    vi.stubEnv('COMET_EVAL_MANAGED', undefined);
    vi.stubEnv('COMET_APPLICATION_EVAL_CONTEXT', undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await fs.mkdir(path.join(project, 'skill'));
    await fs.writeFile(path.join(project, 'skill/SKILL.md'), '# Report');
  });
  afterEach(async () => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(project, { recursive: true, force: true });
  });
  it('persists CLI ownership and completion for Dashboard discovery', async () => {
    await evalRunCommand({
      project,
      skillPath: path.join(project, 'skill'),
      agent: 'codex',
      model: 'fixture-model',
    });
    const record = await readManagedEvalRun(project, experiment);
    expect(record).toMatchObject({
      origin: 'cli',
      status: 'completed',
      owner: { pid: process.pid },
      config: { model: 'fixture-model' },
    });
  });

  it.each(['skill', 'application'])(
    'exits nonzero when %s cleanup cannot be verified',
    async (targetType) => {
      dockerCommand.mockRejectedValue(new Error('fixture Docker query unavailable'));
      process.argv = [
        process.execPath,
        path.resolve('bin/comet.js'),
        'eval',
        path.join(project, targetType === 'skill' ? 'skill' : 'application.json'),
        '--project',
        project,
        '--agent',
        'codex',
        '--model',
        'fixture-model',
      ];
      vi.resetModules();
      // 经过真实 CLI 分发、磁盘运行记录和 finishCliEvalTracking；仅模型与 Docker 响应替身。
      await import('../../app/cli/index.js');
      expect(process.exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('请重试停止'));
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('fixture Docker query unavailable'),
      );
      expect(await readManagedEvalRun(project, experiment)).toMatchObject({
        status: 'stopping',
        error: expect.stringContaining('fixture Docker query unavailable'),
      });
      expect(
        JSON.parse(
          await fs.readFile(
            path.join(project, '.comet/eval/runs', experiment, 'execution-state.json'),
            'utf8',
          ),
        ),
      ).toMatchObject({ status: 'stopping' });
      dockerCommand.mockResolvedValue('');
      expect(await requestStopEvalRun(project, experiment)).toMatchObject({
        executionStatus: 'stopped',
      });
    },
  );
});
