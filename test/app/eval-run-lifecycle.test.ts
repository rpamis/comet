import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evalCommand, evalRunCommand } from '../../app/commands/eval.js';
import { inspectEvalContentFreshness } from '../../domains/eval/eval-run-freshness.js';
import { listDatasetDownloads } from '../../domains/eval/dataset-downloads.js';
import {
  readManagedEvalRun,
  requestStopEvalRun,
  reconcileEvalRun,
} from '../../domains/eval/eval-run-manager.js';
import { hashEvalSkill } from '../../domains/eval/eval-run-preview.js';
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
          ...(options.env.COMET_EVAL_DATASET_PLAN
            ? {
                dataset_plan: JSON.parse(readFileSync(options.env.COMET_EVAL_DATASET_PLAN, 'utf8')),
              }
            : {}),
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

  it.each(['native', 'goal'] as const)(
    'keeps CLI dataset results current at their actual root and detects input changes (%s)',
    async (datasetTreatment) => {
      const cached = (await listDatasetDownloads(project)).find(
        (item) => item.id === 'skillsbench',
      )!;
      const datasetRoot =
        datasetTreatment === 'native' ? cached.root : path.join(project, 'imported-dataset');
      const taskRoot = path.join(datasetRoot, 'tasks/example');
      await fs.mkdir(path.join(taskRoot, 'environment'), { recursive: true });
      await fs.writeFile(
        path.join(taskRoot, 'task.md'),
        '---\nname: example\n---\nDo the selected task.',
      );
      await fs.writeFile(
        path.join(taskRoot, 'environment/Dockerfile'),
        'FROM python:3.12\nWORKDIR /workspace\n',
      );
      await fs.writeFile(
        path.join(datasetRoot, 'dataset-source.json'),
        JSON.stringify({
          dataset: cached.id,
          revision: cached.revision,
          archiveSha256: cached.archiveSha256,
        }),
      );
      await evalCommand(undefined, {
        project,
        dataset: 'skillsbench',
        datasetRoot,
        datasetTreatment,
        task: 'example',
        model: 'fixture-model',
      });
      const record = (await readManagedEvalRun(project, experiment))!;
      expect(record.status).toBe('completed');
      expect(await inspectEvalContentFreshness(project, record.config, record.contentHash)).toEqual(
        { stale: false },
      );
      expect(record.config).toMatchObject({
        dataset: 'skillsbench',
        datasetTreatment,
        datasetRoot: await fs.realpath(datasetRoot),
      });
      const legacy = {
        ...record,
        config: { ...record.config },
        contentHash: await hashEvalSkill(record.config.target),
      };
      delete legacy.config.datasetRoot;
      const file = path.join(project, '.comet/eval/runs', experiment, 'dashboard-run.json');
      await fs.writeFile(file, JSON.stringify(legacy));
      expect(await reconcileEvalRun(project, experiment)).toMatchObject({
        stale: false,
        config: { datasetRoot: await fs.realpath(datasetRoot) },
      });
      expect(await readManagedEvalRun(project, experiment)).toEqual(legacy);
      await fs.appendFile(path.join(taskRoot, 'task.md'), '\nChanged task requirements.');
      expect(await inspectEvalContentFreshness(project, record.config, record.contentHash)).toEqual(
        { stale: true },
      );
      expect((await reconcileEvalRun(project, experiment)).stale).toBe(true);
      const metadataFile = path.join(project, '.comet/eval/runs', experiment, 'metadata.json');
      const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'));
      delete metadata.dataset_plan;
      await fs.writeFile(metadataFile, JSON.stringify(metadata));
      expect(await reconcileEvalRun(project, experiment)).toMatchObject({
        stale: null,
        diagnostics: expect.arrayContaining([expect.stringContaining('历史 CLI 记录缺少数据集')]),
      });
      await fs.writeFile(metadataFile, '{broken');
      expect(await reconcileEvalRun(project, experiment)).toMatchObject({
        stale: null,
        diagnostics: expect.arrayContaining([expect.stringContaining('历史 CLI 记录缺少数据集')]),
      });
    },
  );

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
