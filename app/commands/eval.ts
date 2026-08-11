import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';
import { recordRepositoryEvalExperiment } from '../../domains/bundle/eval-run-result.js';
import { prepareEvalManifest } from '../../domains/bundle/eval-manifest-runtime.js';

type EvalSuite = 'local' | 'langsmith' | 'langfuse';
type EvalAgent = 'claude-code' | 'codex' | 'qoder' | 'codebuddy';

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
}

interface EvalLaunchDetails {
  mode: 'run' | 'collect';
  suite: EvalSuite;
  evalRoot: string;
  experimentId: string;
  profile: string;
  task: string;
  reportConfig: string | null;
  reportPath: string;
  target: string;
  agent: EvalAgent | null;
}

type EvalManifestSource = 'explicit' | 'auto-detected' | 'synthesized';

interface ResolvedEvalContext {
  schema: 'comet.eval.context.v1';
  skillRoot: string;
  manifestSource: EvalManifestSource;
  manifestPath?: string;
  artifactOwnerRoot: string;
  artifactRoot: string;
  baseManifest?: Record<string, unknown>;
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = path.resolve(moduleDirectory, '../..');
const packageRoot = path.basename(moduleRoot) === 'dist' ? path.dirname(moduleRoot) : moduleRoot;

function evalRoot(options: EvalCommandOptions): string {
  return options.project
    ? path.join(path.resolve(options.project), 'eval')
    : path.join(packageRoot, 'eval');
}

function assertEvalHarness(root: string, suite: EvalSuite): void {
  const requiredFiles = ['pyproject.toml', `${suite}/tests/tasks/test_tasks.py`];
  if (requiredFiles.every((file) => existsSync(path.join(root, file)))) return;

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
  if (agent === 'claude-code' || agent === 'codex' || agent === 'qoder' || agent === 'codebuddy') {
    return agent;
  }
  throw new Error(
    `Unsupported evaluation agent: ${agent}. Expected claude-code, codex, qoder, or codebuddy.`,
  );
}

function assertTarget(options: EvalCommandOptions): void {
  if (!options.manifest && !options.skillPath) {
    throw new Error('Pass one of --manifest or --skill-path');
  }
  if (options.manifest && options.skillPath) {
    throw new Error('Pass exactly one of --manifest or --skill-path');
  }
}

async function canonicalPath(target: string): Promise<string> {
  const resolved = path.resolve(target);
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}

async function resolveManifestSkillRoot(manifestPath: string): Promise<string> {
  try {
    const data = parse(await fs.readFile(manifestPath, 'utf8')) as {
      skill?: { source?: unknown };
    };
    const source = data?.skill?.source;
    if (typeof source === 'string' && source.trim()) {
      return canonicalPath(
        path.isAbsolute(source) ? source : path.join(path.dirname(manifestPath), source),
      );
    }
  } catch {
    // The Python harness remains the validation authority and will report malformed manifests.
  }
  return canonicalPath(path.join(path.dirname(manifestPath), '..'));
}

async function resolveEvalContext(options: EvalCommandOptions): Promise<ResolvedEvalContext> {
  assertTarget(options);
  let skillRoot: string;
  let manifestPath: string | undefined;
  let manifestSource: EvalManifestSource;
  let baseManifest: Record<string, unknown> | undefined;

  if (options.manifest) {
    manifestPath = await canonicalPath(options.manifest);
    skillRoot = await resolveManifestSkillRoot(manifestPath);
    manifestSource = 'explicit';
  } else {
    const rawSkillPath = options.skillPath!;
    const canonicalTarget = await canonicalPath(rawSkillPath);
    skillRoot =
      path.basename(canonicalTarget) === 'SKILL.md'
        ? path.dirname(canonicalTarget)
        : canonicalTarget;
    const yamlManifest = path.join(skillRoot, 'comet', 'eval.yaml');
    const ymlManifest = path.join(skillRoot, 'comet', 'eval.yml');
    if (await isFile(yamlManifest)) {
      manifestPath = await canonicalPath(yamlManifest);
      manifestSource = 'auto-detected';
    } else if (await isFile(ymlManifest)) {
      manifestPath = await canonicalPath(ymlManifest);
      manifestSource = 'auto-detected';
    } else {
      manifestSource = 'synthesized';
      baseManifest = {
        apiVersion: 'comet.eval/v1alpha1',
        kind: 'SkillEvalManifest',
        metadata: { name: path.basename(skillRoot) },
        skill: { name: path.basename(skillRoot), source: skillRoot },
        evaluation: {},
      };
    }
  }

  const artifactOwnerRoot = options.project ? await canonicalPath(options.project) : skillRoot;
  return {
    schema: 'comet.eval.context.v1',
    skillRoot,
    manifestSource,
    ...(manifestPath ? { manifestPath } : {}),
    artifactOwnerRoot,
    artifactRoot: path.join(artifactOwnerRoot, '.comet', 'eval'),
    ...(baseManifest ? { baseManifest } : {}),
  };
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

function resolveTask(options: EvalCommandOptions): string {
  if (options.task) return options.task;
  if (options.quick) return 'generic-skill-smoke';
  if (options.skillPath || options.manifest) return 'auto-generated';
  return 'recommended';
}

async function resolveReportConfig(options: EvalCommandOptions): Promise<string | null> {
  if (options.reportConfig) return path.resolve(options.reportConfig);
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
  collectOnly: boolean,
  context: ResolvedEvalContext,
  resolvedReportConfig?: string | null,
): Promise<string[]> {
  assertTarget(options);

  const suite = resolveSuite(options);
  const args = ['run'];
  // Collection must stay offline. The Langfuse adapter imports the SDK lazily,
  // so the optional dependency is only needed for an actual reporting run.
  if (suite === 'langfuse' && !collectOnly) args.push('--extra', 'langfuse');
  args.push('pytest', `${suite}/tests/tasks/test_tasks.py`);

  if (context.manifestPath) {
    args.push(`--eval-manifest=${context.manifestPath}`);
  } else if (options.skillPath) {
    const task = options.task ?? (options.quick ? 'generic-skill-smoke' : undefined);
    if (task) args.push(`--task=${task}`);
    args.push(`--skill-path=${path.resolve(options.skillPath)}`);
    if (options.skillName) args.push(`--skill-name=${options.skillName}`);
    if (options.profile) args.push(`--profile=${options.profile}`);
  }

  if (options.agent) args.push(`--agent=${resolveAgent(options)}`);
  if (options.quick) args.push('--quick');
  args.push(`--project-root=${context.artifactOwnerRoot}`);

  if (options.task && options.manifest) {
    args.push(`--task=${options.task}`);
  }

  const reportConfig =
    resolvedReportConfig === undefined ? await resolveReportConfig(options) : resolvedReportConfig;
  if (reportConfig) args.push(`--report-config=${reportConfig}`);

  if (collectOnly) {
    args.push('--collect-only');
  } else {
    args.push('-v');
  }

  return args;
}

async function buildLaunchDetails(
  options: EvalCommandOptions,
  collectOnly: boolean,
  root: string,
  context: ResolvedEvalContext,
): Promise<EvalLaunchDetails> {
  const suite = resolveSuite(options);
  const reportConfig = await resolveReportConfig(options);
  const experimentId = `comet-eval-${randomUUID()}`;
  return {
    mode: collectOnly ? 'collect' : 'run',
    suite,
    evalRoot: root,
    experimentId,
    profile: resolveProfile(options),
    task: resolveTask(options),
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
    agent: options.agent ? resolveAgent(options) : null,
  };
}

function printLaunchDetails(details: EvalLaunchDetails): void {
  console.log(`Eval root: ${details.evalRoot}`);
  console.log(`Mode: ${details.mode}`);
  console.log(`Suite: ${details.suite}`);
  console.log(`Target: ${details.target}`);
  console.log(`Experiment: ${details.experimentId}`);
  console.log(`Profile: ${details.profile}`);
  console.log(`Task: ${details.task}`);
  if (details.agent) console.log(`Agent override: ${details.agent}`);
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
): void {
  assertEvalHarness(root, suite);
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
      UV_PROJECT_ENVIRONMENT: path.join(context.artifactRoot, 'venv'),
    },
  });
}

async function executeEval(options: EvalCommandOptions, collectOnly: boolean): Promise<void> {
  assertTarget(options);
  const root = evalRoot(options);
  const context = await resolveEvalContext(options);
  const details = await buildLaunchDetails(options, collectOnly, root, context);
  const prepared = options.manifest ? await prepareEvalManifest(options.manifest) : null;
  let bodyFailed = false;
  let bodyError: unknown;
  let cleanupFailed = false;
  let cleanupError: unknown;
  try {
    const runtimeContext = prepared
      ? { ...context, manifestPath: await canonicalPath(prepared.path) }
      : context;
    const args = await buildEvalArgs(options, collectOnly, runtimeContext, details.reportConfig);
    printLaunchDetails(details);
    runEval(args, root, details.suite, details.experimentId, runtimeContext);
    if (!collectOnly && prepared?.context && details.suite === 'local') {
      await recordRepositoryEvalExperiment({
        context: prepared.context,
        experimentDir: path.join(context.artifactRoot, 'runs', details.experimentId),
        level: options.quick === false ? 'full' : 'quick',
      });
    }
  } catch (error) {
    bodyFailed = true;
    bodyError = error;
    if (existsSync(details.reportPath)) {
      console.log(`Report path: ${details.reportPath}`);
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
  await executeEval(options, false);
}

export async function evalCollectCommand(options: EvalCommandOptions = {}): Promise<void> {
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
