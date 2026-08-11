import { execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';
import Ajv from 'ajv';
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

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
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
  const reportConfig = await resolveReportConfig(options);
  const experimentId = `comet-eval-${randomUUID()}`;
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
  console.log('Task selection: resolved by harness');
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

function jsonPointerToYamlPath(pointer: string | undefined): string {
  if (!pointer) return 'manifest';
  return pointer
    .split('/')
    .slice(1)
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce(
      (result, part) =>
        Number.isInteger(Number(part)) ? `${result}[${part}]` : `${result}.${part}`,
      '',
    )
    .replace(/^\./u, '');
}

function staticHash(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

async function pathIsFile(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}

function assertTaskName(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(value)) {
    throw new Error(`${field} must be a valid task name`);
  }
}

async function resolveSkillPackagePath(
  skillRoot: string,
  value: string,
  field: string,
): Promise<string> {
  const normalized = value.replaceAll('\\', '/');
  if (!normalized.trim() || path.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`${field} must stay within the Skill package: ${JSON.stringify(value)}`);
  }
  const root = await fs.realpath(skillRoot);
  const candidate = path.resolve(root, normalized);
  if (!isPathWithin(root, candidate))
    throw new Error(`${field} must stay within the Skill package: ${JSON.stringify(value)}`);
  let resolved: string;
  try {
    resolved = await fs.realpath(candidate);
  } catch {
    throw new Error(`${field} does not exist: ${JSON.stringify(value)}`);
  }
  if (!isPathWithin(root, resolved))
    throw new Error(`${field} must stay within the Skill package: ${JSON.stringify(value)}`);
  return resolved;
}

async function taskNameFromToml(
  taskRoot: string,
  fallback: string,
  field: string,
): Promise<string> {
  const source = await fs.readFile(path.join(taskRoot, 'task.toml'), 'utf8');
  const match = /^\s*name\s*=\s*["']([^"']+)["']\s*$/mu.exec(source);
  const name = match?.[1] ?? fallback;
  assertTaskName(name, field);
  return name;
}

function validateInlineTask(task: Record<string, unknown>, index: number): void {
  const prefix = `evaluation.tasks[${index}]`;
  assertTaskName(task.name, `${prefix}.name`);
  if (typeof task.prompt !== 'string' || !task.prompt.trim())
    throw new Error(`${prefix}.prompt is required`);
  if (!task.expect || typeof task.expect !== 'object' || Array.isArray(task.expect))
    throw new Error(`${prefix}.expect must contain at least one deterministic expect`);
  const expect = task.expect as Record<string, unknown>;
  const permitted = new Set(['files', 'contains', 'json', 'commands']);
  const unknown = Object.keys(expect).find((field) => !permitted.has(field));
  if (unknown) throw new Error(`${prefix}.expect.${unknown}: unknown field`);
  if (
    !Object.values(expect).some((value) =>
      Array.isArray(value)
        ? value.length
        : value && typeof value === 'object'
          ? Object.keys(value).length
          : false,
    )
  ) {
    throw new Error(`${prefix}.expect must contain at least one deterministic expect`);
  }
  if (
    task.rubric !== undefined &&
    (!Array.isArray(task.rubric) ||
      task.rubric.some((item) => typeof item !== 'string' || !item.trim()))
  )
    throw new Error(`${prefix}.rubric must be a list of non-empty strings`);
}

function validateStaticManifestSettings(manifest: Record<string, unknown>): void {
  for (const field of ['execution', 'judge'] as const) {
    const settings = manifest[field];
    if (settings === undefined) continue;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings))
      throw new Error(`${field} must be a mapping`);
    const data = settings as Record<string, unknown>;
    if (
      data.agent !== undefined &&
      !['claude-code', 'codex', 'qoder', 'codebuddy'].includes(data.agent as string)
    )
      throw new Error(
        `Unsupported evaluation agent ${JSON.stringify(data.agent)} in ${field}.agent`,
      );
    const url = data.baseUrl ?? data.base_url;
    if (url !== undefined && (typeof url !== 'string' || !/^https?:\/\/[^\s/]+/u.test(url)))
      throw new Error(`${field}.baseUrl must be an absolute http(s) URL`);
    if (data.model !== undefined && (typeof data.model !== 'string' || !data.model.trim()))
      throw new Error(`${field}.model must be a non-empty string`);
  }
}

function staticGenerationModel(agent: string): string | null {
  if (agent === 'claude-code')
    return process.env.BENCH_CC_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'runtime-default';
  if (agent === 'codex')
    return process.env.BENCH_CODEX_MODEL ?? process.env.OPENAI_MODEL ?? 'runtime-default';
  if (agent === 'qoder')
    return process.env.BENCH_QODER_MODEL ?? process.env.QODER_MODEL ?? 'runtime-default';
  return process.env.BENCH_CODEBUDDY_MODEL ?? process.env.CODEBUDDY_MODEL ?? 'runtime-default';
}

function staticInteraction(manifest: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!manifest) return { mode: 'none', max_turns: 12 };
  const source = manifest?.interaction;
  const data =
    source && typeof source === 'object' && !Array.isArray(source)
      ? (source as Record<string, unknown>)
      : {};
  return {
    mode: data.mode ?? 'none',
    max_turns: Number(data.maxTurns ?? data.max_turns ?? 12),
    simulator_prompt: data.simulatorPrompt ?? data.simulator_prompt ?? null,
    decision_patterns: [],
    decision_reply: null,
    decision_replies: [],
    continue_prompt: 'Please continue with the next phase of the workflow.',
    fresh_resume_marker: data.freshResumeMarker ?? data.fresh_resume_marker ?? null,
  };
}

async function staticSnapshot(skillRoot: string): Promise<string> {
  const root = await fs.realpath(skillRoot);
  const entries = new Map<string, { path: string; hash: string }>();
  let total = 0;
  const add = async (candidate: string) => {
    if (entries.size >= 128 || !(await pathIsFile(candidate))) return;
    const resolved = await fs.realpath(candidate);
    if (!isPathWithin(root, resolved)) return;
    const relative = path.relative(root, resolved).replaceAll('\\', '/');
    if (entries.has(relative)) return;
    const content = await fs.readFile(resolved, 'utf8');
    const bytes = Buffer.byteLength(content, 'utf8');
    if (total + bytes > 512 * 1024) return;
    total += bytes;
    entries.set(relative, { path: relative, hash: staticHash(content) });
  };
  const skillFile = path.join(root, 'SKILL.md');
  await add(skillFile);
  const skillContent = await fs.readFile(skillFile, 'utf8');
  for (const match of skillContent.matchAll(/[`"']([^`"']+)[`"']/gu))
    await add(path.join(root, match[1].replaceAll('\\', '/')));
  for (const directory of ['scripts', 'references', 'reference', 'examples', 'templates']) {
    const start = path.join(root, directory);
    try {
      const walk = async (target: string): Promise<void> => {
        for (const entry of await fs.readdir(target, { withFileTypes: true })) {
          const child = path.join(target, entry.name);
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) await walk(child);
          else await add(child);
        }
      };
      await walk(start);
    } catch {
      /* absent optional directory */
    }
  }
  const files = [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
  return staticHash(canonicalJson(files));
}

async function loadStaticGeneratedCache(
  options: EvalCommandOptions,
  context: ResolvedEvalContext,
  manifest: Record<string, unknown> | undefined,
): Promise<string[]> {
  try {
    const execution = manifest?.execution;
    const settings =
      execution && typeof execution === 'object' && !Array.isArray(execution)
        ? (execution as Record<string, unknown>)
        : {};
    const agent = options.agent ?? (settings.agent as string | undefined) ?? 'claude-code';
    const profile =
      (manifest?.skill as Record<string, unknown> | undefined)?.profile ??
      options.profile ??
      'generic';
    const snapshotHash = await staticSnapshot(context.skillRoot);
    const generationHash = createHash('sha256')
      .update(
        canonicalJson({
          snapshot_hash: snapshotHash,
          agent,
          model: staticGenerationModel(agent),
          profile,
          interaction: staticInteraction(manifest),
          generator_version: 'comet-auto-task-generator.v1',
          task_schema_version: 'comet.eval/v1alpha1',
        }),
      )
      .digest('hex');
    const safe =
      path
        .basename(context.skillRoot)
        .replace(/[^A-Za-z0-9._-]+/gu, '-')
        .replace(/^-+|-+$/gu, '') || 'skill';
    const cache = path.join(context.artifactRoot, 'generated', safe, generationHash);
    const [metadataRaw, cachedRaw] = await Promise.all([
      fs.readFile(path.join(cache, 'generation.json'), 'utf8'),
      fs.readFile(path.join(cache, 'eval.yaml'), 'utf8'),
    ]);
    const metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
    if (
      metadata.generation_hash !== generationHash ||
      metadata.manifest_hash !== staticHash(cachedRaw)
    )
      return [];
    const cached = parse(cachedRaw) as Record<string, unknown>;
    const tasks =
      cached?.evaluation && typeof cached.evaluation === 'object'
        ? (cached.evaluation as Record<string, unknown>).tasks
        : undefined;
    if (!Array.isArray(tasks) || tasks.length < 2 || tasks.length > 4) return [];
    const names = tasks.map((task, index) => {
      if (!task || typeof task !== 'object')
        throw new Error(`cached evaluation.tasks[${index}] must be a mapping`);
      const name = (task as Record<string, unknown>).name;
      assertTaskName(name, `cached evaluation.tasks[${index}].name`);
      validateInlineTask(task as Record<string, unknown>, index);
      return name;
    });
    if (new Set(names).size !== names.length) return [];
    return names;
  } catch {
    return [];
  }
}

async function runPackagedStaticCollect(
  options: EvalCommandOptions,
  context: ResolvedEvalContext,
  suite: EvalSuite,
): Promise<void> {
  let evaluation: Record<string, unknown> = {};
  let manifest: Record<string, unknown> | undefined;
  if (context.manifestPath) {
    const raw = parse(await fs.readFile(context.manifestPath, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Eval manifest must be a mapping');
    }
    manifest = raw as Record<string, unknown>;
    const schema = JSON.parse(
      await fs.readFile(
        path.join(packageRoot, 'eval', 'schemas', 'comet.eval', 'v1alpha1.schema.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    delete schema.$schema;
    const AjvConstructor = Ajv as unknown as new (options: Record<string, unknown>) => {
      compile: (value: object) => {
        (data: unknown): boolean;
        errors?: Array<{
          instancePath?: string;
          keyword?: string;
          message?: string;
          params?: Record<string, unknown>;
        }>;
      };
    };
    const validator = new AjvConstructor({ allErrors: true, strict: false }).compile(schema);
    if (!validator(manifest)) {
      const error = validator.errors?.[0];
      const yamlPath = jsonPointerToYamlPath(error?.instancePath);
      const field = (error?.params as { additionalProperty?: string } | undefined)
        ?.additionalProperty;
      if (error?.keyword === 'additionalProperties' && field) {
        throw new Error(
          `${yamlPath === 'manifest' ? field : `${yamlPath}.${field}`}: unknown field`,
        );
      }
      throw new Error(`${yamlPath}: ${error?.message ?? 'invalid manifest'}`);
    }
    if (manifest.apiVersion !== 'comet.eval/v1alpha1' || manifest.kind !== 'SkillEvalManifest') {
      throw new Error('Expected comet.eval/v1alpha1 SkillEvalManifest');
    }
    if (
      manifest.evaluation !== undefined &&
      (typeof manifest.evaluation !== 'object' ||
        manifest.evaluation === null ||
        Array.isArray(manifest.evaluation))
    ) {
      throw new Error('evaluation must be a mapping');
    }
    evaluation = (manifest.evaluation as Record<string, unknown> | undefined) ?? {};
  }
  const authored = Array.isArray(evaluation.tasks) ? evaluation.tasks : [];
  const recommended = Array.isArray(evaluation.recommendedTasks)
    ? evaluation.recommendedTasks
    : Array.isArray(evaluation.recommended_tasks)
      ? evaluation.recommended_tasks
      : [];
  const names = (items: unknown[]) =>
    items
      .map((item) => (typeof item === 'string' ? item : (item as { name?: unknown }).name))
      .filter((item): item is string => typeof item === 'string');
  const bundledRoot = path.join(packageRoot, 'eval', 'local', 'tasks');
  const bundledEntries = (await fs.readdir(bundledRoot, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory(),
  );
  const bundled = new Set<string>();
  for (const entry of bundledEntries) {
    const taskRoot = path.join(bundledRoot, entry.name);
    if (
      !(await pathIsFile(path.join(taskRoot, 'task.toml'))) ||
      !(await pathIsFile(path.join(taskRoot, 'instruction.md')))
    )
      continue;
    const name = await taskNameFromToml(taskRoot, entry.name, `bundled task ${entry.name}`);
    if (bundled.has(name)) throw new Error(`bundled task name duplicates another bundle: ${name}`);
    bundled.add(name);
  }
  const authoredNames: string[] = [];
  for (const [index, item] of authored.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`evaluation.tasks[${index}] must be a mapping`);
    }
    const task = item as Record<string, unknown>;
    if (typeof task.source === 'string') {
      if (Object.keys(task).some((key) => key !== 'source' && key !== 'name')) {
        throw new Error(`evaluation.tasks[${index}]: source tasks cannot define inline fields`);
      }
      const source = await resolveSkillPackagePath(
        context.skillRoot,
        task.source,
        `evaluation.tasks[${index}].source`,
      );
      if (
        !(await pathIsFile(path.join(source, 'task.toml'))) ||
        !(await pathIsFile(path.join(source, 'instruction.md')))
      ) {
        throw new Error(
          `evaluation.tasks[${index}].source must point to a task package with task.toml and instruction.md`,
        );
      }
      const canonical =
        task.name === undefined
          ? await taskNameFromToml(
              source,
              path.basename(source),
              `evaluation.tasks[${index}].source`,
            )
          : task.name;
      assertTaskName(canonical, `evaluation.tasks[${index}].name`);
      authoredNames.push(canonical);
    } else {
      validateInlineTask(task, index);
      authoredNames.push(task.name as string);
    }
  }
  const duplicate = (values: string[]) =>
    values.find((value, index) => values.indexOf(value) !== index);
  const duplicateAuthored = duplicate(authoredNames);
  if (duplicateAuthored) {
    const second = authoredNames.lastIndexOf(duplicateAuthored);
    const first = authoredNames.indexOf(duplicateAuthored);
    throw new Error(
      `evaluation.tasks[${second}].name duplicates evaluation.tasks[${first}].name: "${duplicateAuthored}"`,
    );
  }
  const recommendedNames = names(recommended);
  const duplicateRecommended = duplicate(recommendedNames);
  if (duplicateRecommended) {
    const second = recommendedNames.lastIndexOf(duplicateRecommended);
    const first = recommendedNames.indexOf(duplicateRecommended);
    throw new Error(
      `evaluation.recommendedTasks[${second}] duplicates evaluation.recommendedTasks[${first}]: "${duplicateRecommended}"`,
    );
  }
  for (const [index, name] of recommendedNames.entries()) {
    if (!bundled.has(name))
      throw new Error(`evaluation.recommendedTasks[${index}]: unknown bundled task "${name}"`);
    const taskIndex = authoredNames.indexOf(name);
    if (taskIndex >= 0)
      throw new Error(
        `evaluation.tasks[${taskIndex}].name conflicts with evaluation.recommendedTasks[${index}]: "${name}"`,
      );
  }
  for (const [index, item] of authored.entries()) {
    const task = item as Record<string, unknown>;
    if (bundled.has(authoredNames[index])) {
      throw new Error(
        `evaluation.tasks[${index}].name conflicts with bundled task "${authoredNames[index]}": "${authoredNames[index]}"`,
      );
    }
    if (typeof task.workspace === 'string')
      await resolveSkillPackagePath(
        context.skillRoot,
        task.workspace,
        `evaluation.tasks[${index}].workspace`,
      );
  }
  if (manifest) validateStaticManifestSettings(manifest);
  if (options.task) {
    if (!authoredNames.includes(options.task) && !bundled.has(options.task)) {
      throw new Error(`Task not found: ${options.task}`);
    }
    console.log('Tasks: explicit');
    console.log(`- ${options.task}`);
  } else if (options.quick) {
    if (!bundled.has('generic-skill-smoke'))
      throw new Error('Bundled quick task generic-skill-smoke is unavailable');
    console.log('Tasks: quick');
    console.log('- generic-skill-smoke');
  } else if (authored.length) {
    console.log('Tasks: authored');
    authoredNames.forEach((name) => console.log(`- ${name}`));
  } else if (recommended.length) {
    console.log('Tasks: recommended');
    names(recommended).forEach((name) => console.log(`- ${name}`));
  } else {
    const cached = await loadStaticGeneratedCache(options, context, manifest);
    if (cached.length) {
      console.log('Tasks: generated cache');
      cached.forEach((name) => console.log(`- ${name}`));
    } else {
      console.log('Tasks: pending generation');
      console.log('A normal comet eval run generates and freezes 2-4 tasks before execution.');
    }
  }
  console.log(
    `Static collection only for ${suite}; credentials, Docker, endpoints, plugins, and network were not tested.`,
  );
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
    await runPackagedStaticCollect(options, context, suite);
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
