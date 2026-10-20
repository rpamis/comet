import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import {
  resolveEvalExecution,
  beginCliEvalTracking,
  finishCliEvalTracking,
  updateManagedEvalRun,
  registerCliEvalRun,
  canonicalPath,
  isPathWithin,
  loadUserEvalEnvironment,
  resolveEvalContext,
  type ResolvedEvalContext,
} from '../../domains/eval/index.js';
import {
  evalProjectIdentity,
  recordEvalProcessTermination,
} from '../../domains/eval/eval-run-cleanup.js';
import { collectStandaloneTasks } from '../../domains/eval/standalone-static-collect.js';
import { recordRepositoryEvalExperiment } from '../../domains/bundle/eval-run-result.js';
import { prepareEvalManifest } from '../../domains/bundle/eval-manifest-runtime.js';
import { runOwnedCommand } from '../../platform/process/run-owned-command.js';

type EvalSuite = 'local' | 'langsmith' | 'langfuse';
type EvalAgent = string;

interface EvalCommandOptions {
  project?: string;
  manifest?: string;
  skillPath?: string;
  skillName?: string;
  profile?: string;
  task?: string;
  reportConfig?: string;
  html?: boolean;
  quick?: boolean;
  collect?: boolean;
  suite?: EvalSuite;
  agent?: EvalAgent;
  model?: string;
  baseUrl?: string;
  judgeAgent?: EvalAgent;
  judgeModel?: string;
  judgeBaseUrl?: string;
}

interface EvalLaunchDetails {
  mode: 'run' | 'collect';
  suite: EvalSuite;
  evalRoot: string;
  experimentId: string;
  profile: string;
  reportConfig: string | null;
  reportPath: string;
  target: string;
  manifestSource: string;
  agent: EvalAgent | null;
  model: string;
  api: 'default' | 'custom';
  judge: { agent: EvalAgent; model: string; api: 'default' | 'custom' } | null;
  taskLines: string[];
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = path.resolve(moduleDirectory, '../..');
const packageRoot = path.basename(moduleRoot) === 'dist' ? path.dirname(moduleRoot) : moduleRoot;

function hasEvalHarness(root: string, suite: EvalSuite): boolean {
  const requiredFiles = ['pyproject.toml', `${suite}/tests/tasks/test_tasks.py`];
  return requiredFiles.every((file) => existsSync(path.join(root, file)));
}

function evalRoot(options: EvalCommandOptions, suite: EvalSuite): string {
  const projectHarness = options.project
    ? path.join(path.resolve(options.project), 'eval')
    : undefined;
  if (projectHarness && hasEvalHarness(projectHarness, suite)) return projectHarness;
  return path.join(packageRoot, 'eval');
}

function assertEvalHarness(root: string, suite: EvalSuite): void {
  if (hasEvalHarness(root, suite)) return;

  throw new Error(
    `Eval harness is missing at ${root}.\n` +
      'Reinstall @rpamis/comet or pass --project <repository-root>.',
  );
}

function resolveSuite(options: EvalCommandOptions): EvalSuite {
  const suite = options.suite ?? 'local';
  if (suite === 'local' || suite === 'langsmith' || suite === 'langfuse') return suite;
  throw new Error(`Unsupported eval suite: ${suite}. Expected local, langsmith, or langfuse.`);
}

function resolveAgent(options: EvalCommandOptions): EvalAgent {
  const agent = options.agent ?? 'claude-code';
  if (/^[a-z][a-z0-9-]{1,31}$/u.test(agent)) {
    return agent;
  }
  throw new Error(
    `Unsupported evaluation agent: ${agent}. Expected a built-in or explicitly installed adapter ID.`,
  );
}

async function resolveLaunchExecution(
  options: EvalCommandOptions,
  context: ResolvedEvalContext,
): Promise<Pick<EvalLaunchDetails, 'agent' | 'model' | 'api' | 'judge'>> {
  return resolveEvalExecution(options, context);
}

function assertTarget(options: EvalCommandOptions): void {
  if (!options.manifest && !options.skillPath) {
    throw new Error('Pass one of --manifest or --skill-path');
  }
  if (options.manifest && options.skillPath) {
    throw new Error('Pass exactly one of --manifest or --skill-path');
  }
}

async function assertArtifactRootIsSafe(context: ResolvedEvalContext): Promise<void> {
  const ownerRoot = await canonicalPath(context.artifactOwnerRoot);
  const cometRoot = path.join(ownerRoot, '.comet');
  let cometRootExists = false;
  try {
    await fs.lstat(cometRoot);
    cometRootExists = true;
    const resolvedCometRoot = await fs.realpath(cometRoot);
    if (!isPathWithin(ownerRoot, resolvedCometRoot)) {
      throw new Error('Eval artifact root must stay within its owner root');
    }
    try {
      const resolvedArtifactRoot = await fs.realpath(path.join(cometRoot, 'eval'));
      if (!isPathWithin(ownerRoot, resolvedArtifactRoot)) {
        throw new Error('Eval artifact root must stay within its owner root');
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Eval artifact root must stay within its owner root'
      ) {
        throw error;
      }
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Eval artifact root must stay within its owner root'
    ) {
      throw error;
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' || cometRootExists) throw error;
  }
}

async function resolveManagedPath(
  context: ResolvedEvalContext,
  managedRoot: 'cache' | 'runs' | 'generated' | 'locks',
  ...parts: string[]
): Promise<string> {
  await assertArtifactRootIsSafe(context);
  const ownerRoot = await canonicalPath(context.artifactOwnerRoot);
  const target = path.join(context.artifactRoot, managedRoot, ...parts);
  let component = context.artifactRoot;
  for (const segment of [managedRoot, ...parts]) {
    component = path.join(component, segment);
    try {
      await fs.lstat(component);
      const resolved = await fs.realpath(component);
      if (!isPathWithin(ownerRoot, resolved)) {
        throw new Error('Eval managed path must stay within its owner root');
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Eval managed path must stay within its owner root'
      ) {
        throw error;
      }
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return target;
}

function inferredSkillName(target: string): string {
  const resolved = path.resolve(target);
  return path.basename(resolved) === 'SKILL.md'
    ? path.basename(path.dirname(resolved))
    : path.basename(resolved);
}

function isManifestTarget(target: string): boolean {
  const normalized = target.replace(/\\/gu, '/').toLowerCase();
  return normalized.endsWith('comet/eval.yaml') || normalized.endsWith('comet/eval.yml');
}

function optionsWithTarget(
  target: string | undefined,
  options: EvalCommandOptions,
): EvalCommandOptions {
  if (!target) return options;
  if (options.manifest || options.skillPath) {
    throw new Error('Pass either a target or explicit --manifest/--skill-path options');
  }
  if (isManifestTarget(target)) {
    return {
      ...options,
      manifest: target,
    };
  }
  return {
    ...options,
    skillPath: target,
    skillName: options.skillName ?? inferredSkillName(target),
  };
}

function resolveProfile(options: EvalCommandOptions): string {
  return options.profile ?? 'generic';
}

async function resolveReportConfig(
  options: EvalCommandOptions,
  context?: ResolvedEvalContext,
): Promise<string | null> {
  if (options.reportConfig) return path.resolve(options.reportConfig);
  if (context?.manifestPath) {
    const parsed = parseYaml(await fs.readFile(context.manifestPath, 'utf8')) as unknown;
    const manifest =
      parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    const reporting =
      manifest.reporting && typeof manifest.reporting === 'object'
        ? (manifest.reporting as Record<string, unknown>)
        : undefined;
    if (typeof reporting?.config === 'string' && reporting.config.trim()) {
      const configured = path.isAbsolute(reporting.config)
        ? reporting.config
        : path.resolve(path.dirname(context.manifestPath), reporting.config);
      return configured;
    }
  }
  if (!options.html) return null;

  const file = path.join(os.tmpdir(), `comet-eval-report-${Date.now()}.json`);
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        report_outputs: {
          markdown: true,
          html: true,
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  return file;
}

async function buildEvalArgs(
  options: EvalCommandOptions,
  context: ResolvedEvalContext,
  resolvedReportConfig?: string | null,
): Promise<string[]> {
  assertTarget(options);

  const suite = resolveSuite(options);
  const args = ['run'];
  if (suite === 'langfuse' || suite === 'langsmith') args.push('--extra', suite);
  args.push('pytest', `${suite}/tests/tasks/test_tasks.py`);
  if (options.task) args.push(`--task=${options.task}`);

  if (context.manifestPath) {
    args.push(`--eval-manifest=${context.manifestPath}`);
  } else if (options.skillPath) {
    args.push(`--skill-path=${path.resolve(options.skillPath)}`);
    if (options.skillName) args.push(`--skill-name=${options.skillName}`);
    if (options.profile) args.push(`--profile=${options.profile}`);
  }

  if (options.agent) args.push(`--agent=${resolveAgent(options)}`);
  if (options.model) args.push(`--model=${options.model}`);
  if (options.baseUrl) args.push(`--base-url=${options.baseUrl}`);
  if (options.judgeAgent) args.push(`--judge-agent=${resolveAgent({ agent: options.judgeAgent })}`);
  if (options.judgeModel) args.push(`--judge-model=${options.judgeModel}`);
  if (options.judgeBaseUrl) args.push(`--judge-base-url=${options.judgeBaseUrl}`);
  if (options.quick) args.push('--quick');
  if (process.env.COMET_APPLICATION_EVAL_CONTEXT) {
    const evaluation = JSON.parse(process.env.COMET_APPLICATION_EVAL_CONTEXT);
    args.push('--count=1', `--agent-timeout=${evaluation.preview.settings.timeoutSeconds}`);
    args.push(`--max-turns=${evaluation.preview.settings.maxTurns}`);
  } else if (process.env.COMET_EVAL_MANAGED === '1') {
    const timeout = Number(process.env.COMET_EVAL_MANAGED_TIMEOUT);
    const turns = Number(process.env.COMET_EVAL_MANAGED_MAX_TURNS);
    if (Number.isSafeInteger(timeout) && timeout >= 30) args.push(`--agent-timeout=${timeout}`);
    if (Number.isSafeInteger(turns) && turns >= 1) args.push(`--max-turns=${turns}`);
  }
  args.push(`--project-root=${context.artifactOwnerRoot}`);

  const reportConfig =
    resolvedReportConfig === undefined ? await resolveReportConfig(options) : resolvedReportConfig;
  if (reportConfig) args.push(`--report-config=${reportConfig}`);

  args.push('-v');

  return args;
}

async function buildLaunchDetails(
  options: EvalCommandOptions,
  collectOnly: boolean,
  root: string,
  context: ResolvedEvalContext,
): Promise<EvalLaunchDetails> {
  const suite = resolveSuite(options);
  const reportConfig = collectOnly ? null : await resolveReportConfig(options, context);
  const experimentId =
    process.env.COMET_APPLICATION_EVAL_CONTEXT || process.env.COMET_EVAL_MANAGED === '1'
      ? process.env.COMET_EVAL_EXPERIMENT_ID!
      : `comet-eval-${randomUUID()}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/u.test(experimentId)) throw new Error('评估实验身份无效');
  const execution = await resolveLaunchExecution(options, context);
  const taskLines = await collectStandaloneTasks(
    {
      task: options.task,
      quick: options.quick,
      agent: options.agent,
      model: options.model,
      baseUrl: options.baseUrl,
      judgeAgent: options.judgeAgent,
      judgeModel: options.judgeModel,
      judgeBaseUrl: options.judgeBaseUrl,
      profile: options.profile,
    },
    context,
    packageRoot,
  );
  return {
    mode: collectOnly ? 'collect' : 'run',
    suite,
    evalRoot: root,
    experimentId,
    profile: resolveProfile(options),
    reportConfig,
    reportPath: path.join(
      context.artifactRoot,
      'runs',
      experimentId,
      reportConfig ? 'summary.html' : 'summary.md',
    ),
    target: context.manifestPath
      ? `manifest ${context.manifestPath}`
      : `skill ${context.skillRoot}`,
    manifestSource: context.manifestSource,
    agent: execution.agent,
    model: execution.model,
    api: execution.api,
    judge: execution.judge,
    taskLines,
  };
}

function printLaunchDetails(details: EvalLaunchDetails): void {
  console.log(`Eval root: ${details.evalRoot}`);
  console.log(`Mode: ${details.mode}`);
  console.log(`Suite: ${details.suite}`);
  console.log(`Target: ${details.target}`);
  console.log(`Manifest source: ${details.manifestSource}`);
  console.log(`Experiment: ${details.experimentId}`);
  console.log(`Profile: ${details.profile}`);
  const [taskSource, ...taskNames] = details.taskLines;
  const taskLabel = (taskSource ?? 'Tasks: unknown').replace(/^Tasks:\s*/u, '');
  console.log(`Task selection: ${taskLabel}`);
  console.log(`Tasks: ${taskLabel}`);
  for (const taskName of taskNames) console.log(taskName);
  console.log(`Main Agent: ${details.agent}`);
  console.log(`Main Model: ${details.model}`);
  console.log(`Main API: ${details.api}`);
  if (details.judge) {
    console.log(`Judge Agent: ${details.judge.agent}`);
    console.log(`Judge Model: ${details.judge.model}`);
    console.log(`Judge API: ${details.judge.api}`);
  }
  console.log(`Report path: ${details.reportPath}`);
  if (details.reportConfig) {
    console.log(`Report config: ${details.reportConfig}`);
  }
  if (details.mode === 'run') {
    console.log(
      'Failure attribution: the generated benchmark summary records harness, workflow, task, and model buckets for failed checks.',
    );
  }
}

function assertUvAvailable(): void {
  try {
    execFileSync('uv', ['--version'], { stdio: 'pipe' });
  } catch {
    throw new Error(
      'uv is not installed or not in PATH.\n' +
        'Install it: https://docs.astral.sh/uv/getting-started/installation/',
    );
  }
}

async function runEval(
  args: string[],
  root: string,
  suite: EvalSuite,
  experimentId: string,
  context: ResolvedEvalContext,
  uvCacheDir: string,
  uvProjectEnvironment: string,
  reportHtml: boolean,
): Promise<void> {
  assertEvalHarness(root, suite);
  // Validate the owner boundary immediately before uv can create its cache or environment.
  // The context was validated during resolution and is rechecked in the Python harness before writes.
  assertUvAvailable();
  await runOwnedCommand('uv', args, {
    cwd: root,
    streamOutput: true,
    onRegistered:
      process.env.COMET_EVAL_MANAGED !== '1' && !process.env.COMET_APPLICATION_EVAL_CONTEXT
        ? async (child) => {
            await updateManagedEvalRun(context.artifactOwnerRoot, experimentId, (current) => {
              current.child = child;
            });
          }
        : undefined,
    onTerminated:
      process.env.COMET_EVAL_MANAGED !== '1' && !process.env.COMET_APPLICATION_EVAL_CONTEXT
        ? (child, confirmed) =>
            recordEvalProcessTermination(context.artifactOwnerRoot, experimentId, child, confirmed)
        : undefined,
    env: {
      ...process.env,
      COMET_EVAL_EXPERIMENT_ID: experimentId,
      COMET_EVAL_PROJECT_ID: await evalProjectIdentity(context.artifactOwnerRoot),
      COMET_EVAL_CONTEXT: JSON.stringify(context),
      COMET_EVAL_PROGRESS_ENABLED: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTEST_ADDOPTS: [process.env.PYTEST_ADDOPTS, '-p no:cacheprovider'].filter(Boolean).join(' '),
      UV_CACHE_DIR: uvCacheDir,
      UV_PROJECT_ENVIRONMENT: uvProjectEnvironment,
      COMET_EVAL_REPORT_HTML: reportHtml ? '1' : '0',
    },
  });
}

async function executeEval(options: EvalCommandOptions, collectOnly: boolean): Promise<void> {
  assertTarget(options);
  const context = await resolveEvalContext(options);
  await assertArtifactRootIsSafe(context);
  const suite = resolveSuite(options);
  const root = evalRoot(options, suite);
  const details = await buildLaunchDetails(options, collectOnly, root, context);
  if (collectOnly) {
    printLaunchDetails(details);
    console.log(
      `Static collection only for ${suite}; credentials, Docker, endpoints, plugins, and network were not tested.`,
    );
    return;
  }
  const uvCacheDir = await resolveManagedPath(context, 'cache', 'uv');
  const uvProjectEnvironment = await resolveManagedPath(context, 'cache', 'venv');
  const prepared =
    !collectOnly && options.manifest ? await prepareEvalManifest(options.manifest) : null;
  let bodyFailed = false;
  let bodyError: unknown;
  let cleanupFailed = false;
  let cleanupError: unknown;
  const trackCli =
    process.env.COMET_EVAL_MANAGED !== '1' && !process.env.COMET_APPLICATION_EVAL_CONTEXT;
  if (trackCli) {
    await beginCliEvalTracking(context, details.experimentId, {
      target: options.manifest ? context.manifestPath! : context.skillRoot,
      targetType: 'skill',
      agent: details.agent ?? undefined,
      ...(details.model !== 'default' ? { model: details.model } : {}),
      suite: details.suite,
      ...(options.task ? { task: options.task } : {}),
      ...(options.quick ? { quick: true } : {}),
      ...(options.profile ? { profile: options.profile } : {}),
      ...(details.judge
        ? { judgeAgent: details.judge.agent, judgeModel: details.judge.model, judgeEnabled: true }
        : { judgeEnabled: false }),
    });
  }
  try {
    const runtimeContext = prepared
      ? { ...context, manifestPath: await canonicalPath(prepared.path) }
      : context;
    const args = await buildEvalArgs(options, runtimeContext, details.reportConfig);
    printLaunchDetails(details);
    await runEval(
      args,
      root,
      details.suite,
      details.experimentId,
      runtimeContext,
      uvCacheDir,
      uvProjectEnvironment,
      Boolean(details.reportConfig),
    );
    if (!collectOnly && prepared?.context && details.suite === 'local') {
      const experimentDir = await resolveManagedPath(runtimeContext, 'runs', details.experimentId);
      await recordRepositoryEvalExperiment({
        context: prepared.context,
        experimentDir,
        level: options.quick === false ? 'full' : 'quick',
      });
    }
  } catch (error) {
    bodyFailed = true;
    bodyError = error;
    const runDir = await resolveManagedPath(context, 'runs', details.experimentId);
    for (const name of ['summary.html', 'summary.md']) {
      const report = path.join(runDir, name);
      if (existsSync(report)) {
        console.log(`Report path: ${report}`);
        break;
      }
    }
  } finally {
    try {
      await prepared?.cleanup();
    } catch (error) {
      cleanupFailed = true;
      cleanupError = error;
    }
    if (trackCli)
      await finishCliEvalTracking(
        context.artifactOwnerRoot,
        details.experimentId,
        bodyError ?? cleanupError,
      );
  }
  if (bodyFailed) throw bodyError;
  if (cleanupFailed) throw cleanupError;
}

export async function evalRunCommand(options: EvalCommandOptions = {}): Promise<void> {
  const userEnvironment = loadUserEvalEnvironment();
  if (userEnvironment?.created) {
    console.log(`Created user Eval config template: ${userEnvironment.path}`);
    console.log('Edit this file with your model credentials, then run comet eval again.');
  }
  await executeEval(options, false);
}

export async function evalCollectCommand(options: EvalCommandOptions = {}): Promise<void> {
  const userEnvironment = loadUserEvalEnvironment(process.env, undefined, { create: false });
  if (userEnvironment?.created) {
    console.log(`Created user Eval config template: ${userEnvironment.path}`);
    console.log('Edit this file with your model credentials, then run comet eval again.');
  }
  await executeEval(options, true);
}

export async function evalCommand(
  target?: string,
  options: EvalCommandOptions = {},
): Promise<number> {
  if (target && path.basename(target) === 'application.json') {
    if (
      options.manifest ||
      options.skillPath ||
      options.quick ||
      options.task ||
      options.baseUrl ||
      options.judgeBaseUrl ||
      (options.suite && options.suite !== 'local')
    )
      throw new Error(
        'SDK 应用评估使用完整应用和自动用例；不能混入 Skill 目标、quick 或单任务选项',
      );
    loadUserEvalEnvironment(process.env, undefined, { create: !options.collect });
    const { previewWorkflowApplicationEval, runWorkflowApplicationEval } =
      await import('../../domains/eval/index.js');
    const input = {
      file: path.resolve(target),
      projectRoot: path.resolve(options.project ?? '.'),
      settings: {
        agent: options.agent ?? 'claude-code',
        ...(options.model ? { model: options.model } : {}),
        ...(options.judgeAgent ? { judgeAgent: options.judgeAgent } : {}),
        ...(options.judgeModel ? { judgeModel: options.judgeModel } : {}),
      },
    };
    const preview = await previewWorkflowApplicationEval(input);
    if (options.collect) {
      console.log(JSON.stringify(preview, null, 2));
      return 0;
    }
    const experimentId = `comet-eval-${randomUUID()}`;
    const trackCli = process.env.COMET_EVAL_MANAGED !== '1';
    if (trackCli)
      await registerCliEvalRun(input.projectRoot, {
        id: experimentId,
        status: 'generating',
        targetId: preview.application.id,
        contentHash: preview.application.contentHash,
        previewHash: preview.confirmationHash,
        config: {
          target: input.file,
          targetType: 'application',
          ...preview.settings,
          suite: 'local',
        },
      });
    let executionError: unknown;
    try {
      const result = await runWorkflowApplicationEval({
        ...input,
        confirmationHash: preview.confirmationHash,
        experimentId,
        executeCommand: trackCli
          ? (command, args, execution) =>
              runOwnedCommand(command, args, {
                cwd: execution?.cwd ?? input.projectRoot,
                env: execution?.env ?? process.env,
                timeoutMs: execution?.timeoutMs,
                onRegistered: async (child) => {
                  await updateManagedEvalRun(input.projectRoot, experimentId, (current) => {
                    current.child = child;
                  });
                },
                onTerminated: (child, confirmed) =>
                  recordEvalProcessTermination(input.projectRoot, experimentId, child, confirmed),
              })
          : undefined,
      });
      console.log(JSON.stringify(result, null, 2));
      return result.status === 'passed' ? 0 : 1;
    } catch (error) {
      executionError = error;
      throw error;
    } finally {
      if (trackCli) await finishCliEvalTracking(input.projectRoot, experimentId, executionError);
    }
  }
  const resolvedOptions = optionsWithTarget(target, options);
  if (resolvedOptions.collect) {
    await evalCollectCommand(resolvedOptions);
    return 0;
  }
  await evalRunCommand(resolvedOptions);
  return 0;
}

export type { EvalAgent, EvalCommandOptions, EvalSuite };
