import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import {
  canonicalPath,
  isPathWithin,
  loadUserEvalEnvironment,
  resolveEvalContext,
  type ResolvedEvalContext,
} from '../../domains/eval/index.js';
import {
  collectStandaloneTasks,
  loadInstalledCustomAgent,
} from '../../domains/eval/standalone-static-collect.js';
import { recordRepositoryEvalExperiment } from '../../domains/bundle/eval-run-result.js';
import { prepareEvalManifest } from '../../domains/bundle/eval-manifest-runtime.js';

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

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function manifestField(data: Record<string, unknown> | undefined, ...names: string[]): unknown {
  if (!data) return undefined;
  for (const name of names) {
    if (Object.hasOwn(data, name)) return data[name];
  }
  return undefined;
}

async function resolveLaunchExecution(
  options: EvalCommandOptions,
  context: ResolvedEvalContext,
): Promise<Pick<EvalLaunchDetails, 'agent' | 'model' | 'api' | 'judge'>> {
  let manifest: Record<string, unknown> | undefined;
  if (context.manifestPath) {
    const parsed = parseYaml(await fs.readFile(context.manifestPath, 'utf8')) as unknown;
    manifest =
      parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  }
  const execution =
    manifest?.execution && typeof manifest.execution === 'object'
      ? (manifest.execution as Record<string, unknown>)
      : undefined;
  const manifestAgent = nonEmpty(manifestField(execution, 'agent')) as EvalAgent | undefined;
  const mainAgent =
    options.agent ??
    manifestAgent ??
    (nonEmpty(process.env.BENCH_EVAL_AGENT) as EvalAgent | undefined) ??
    'claude-code';
  const customAdapter = await loadInstalledCustomAgent(mainAgent);
  const modelEnv: Partial<Record<EvalAgent, string[]>> = {
    'claude-code': ['BENCH_CC_MODEL', 'ANTHROPIC_MODEL', 'BENCH_MODEL'],
    codex: ['BENCH_CODEX_MODEL', 'OPENAI_MODEL', 'CODEX_MODEL', 'BENCH_MODEL'],
    qoder: ['BENCH_QODER_MODEL', 'QODER_MODEL', 'BENCH_MODEL'],
    codebuddy: ['BENCH_CODEBUDDY_MODEL', 'CODEBUDDY_MODEL', 'BENCH_MODEL'],
  };
  const baseUrlEnv: Partial<Record<EvalAgent, string[]>> = {
    'claude-code': ['ANTHROPIC_BASE_URL', 'BENCH_BASE_URL'],
    codex: ['OPENAI_BASE_URL', 'CODEX_BASE_URL', 'BENCH_BASE_URL'],
    qoder: ['QODER_BASE_URL'],
    codebuddy: ['CODEBUDDY_BASE_URL', 'BENCH_BASE_URL'],
  };
  const mainModel =
    options.model ??
    nonEmpty(manifestField(execution, 'model')) ??
    (customAdapter?.modelEnv
      ? nonEmpty(process.env[customAdapter.modelEnv])
      : (modelEnv[mainAgent] ?? []).map((key) => nonEmpty(process.env[key])).find(Boolean)) ??
    'default';
  const mainBaseUrl =
    options.baseUrl ??
    nonEmpty(manifestField(execution, 'baseUrl', 'base_url')) ??
    (customAdapter?.baseUrlEnv
      ? nonEmpty(process.env[customAdapter.baseUrlEnv])
      : (baseUrlEnv[mainAgent] ?? []).map((key) => nonEmpty(process.env[key])).find(Boolean));
  const judgeManifest =
    manifest?.judge && typeof manifest.judge === 'object'
      ? (manifest.judge as Record<string, unknown>)
      : undefined;
  const judgeEnabled =
    Boolean(judgeManifest) ||
    Boolean(options.judgeAgent || options.judgeModel || options.judgeBaseUrl) ||
    ['1', 'true', 'yes', 'on'].includes((process.env.BENCH_LLM_JUDGE ?? '').toLowerCase());
  const judge: EvalLaunchDetails['judge'] = judgeEnabled
    ? {
        agent: (options.judgeAgent ??
          (nonEmpty(manifestField(judgeManifest, 'agent')) as EvalAgent | undefined) ??
          mainAgent) as EvalAgent,
        model:
          options.judgeModel ??
          nonEmpty(manifestField(judgeManifest, 'model')) ??
          nonEmpty(process.env.BENCH_JUDGE_MODEL) ??
          'missing',
        api:
          (options.judgeBaseUrl ??
          nonEmpty(manifestField(judgeManifest, 'baseUrl', 'base_url')) ??
          nonEmpty(process.env.BENCH_JUDGE_BASE_URL))
            ? 'custom'
            : 'default',
      }
    : null;
  return {
    agent: mainAgent,
    model: mainModel,
    api: mainBaseUrl ? 'custom' : 'default',
    judge,
  };
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
  if (suite === 'langfuse') args.push('--extra', 'langfuse');
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
  const experimentId = `comet-eval-${randomUUID()}`;
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

function runEval(
  args: string[],
  root: string,
  suite: EvalSuite,
  experimentId: string,
  context: ResolvedEvalContext,
  uvCacheDir: string,
  uvProjectEnvironment: string,
  reportHtml: boolean,
): void {
  assertEvalHarness(root, suite);
  // Validate the owner boundary immediately before uv can create its cache or environment.
  // The context was validated during resolution and is rechecked in the Python harness before writes.
  assertUvAvailable();
  execFileSync('uv', args, {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      COMET_EVAL_EXPERIMENT_ID: experimentId,
      COMET_EVAL_CONTEXT: JSON.stringify(context),
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
  try {
    const runtimeContext = prepared
      ? { ...context, manifestPath: await canonicalPath(prepared.path) }
      : context;
    const args = await buildEvalArgs(options, runtimeContext, details.reportConfig);
    printLaunchDetails(details);
    runEval(
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
  const userEnvironment = loadUserEvalEnvironment();
  if (userEnvironment?.created) {
    console.log(`Created user Eval config template: ${userEnvironment.path}`);
    console.log('Edit this file with your model credentials, then run comet eval again.');
  }
  await executeEval(options, true);
}

export async function evalCommand(
  target?: string,
  options: EvalCommandOptions = {},
): Promise<void> {
  const resolvedOptions = optionsWithTarget(target, options);
  if (resolvedOptions.collect) {
    await evalCollectCommand(resolvedOptions);
    return;
  }
  await evalRunCommand(resolvedOptions);
}

export type { EvalAgent, EvalCommandOptions, EvalSuite };
