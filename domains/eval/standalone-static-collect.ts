import { createHash } from 'crypto';
import os from 'os';
import { promises as fs } from 'fs';
import path from 'path';
import Ajv from 'ajv';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { isPathWithin, type ResolvedEvalContext } from './standalone-context.js';

export interface StaticCollectOptions {
  task?: string;
  quick?: boolean;
  agent?: string;
  model?: string;
  baseUrl?: string;
  judgeAgent?: string;
  judgeModel?: string;
  judgeBaseUrl?: string;
  profile?: string;
}

const AGENT_IDS = ['claude-code', 'codex', 'qoder', 'codebuddy'] as const;
const CUSTOM_AGENT_ID_RE = /^[a-z][a-z0-9-]{1,31}$/u;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/u;
const SAFE_TOKEN_RE = /^[A-Za-z0-9._:@/+%-]{1,160}$/u;
const CUSTOM_CAPABILITIES = [
  'singleTurn',
  'resume',
  'structuredEvents',
  'telemetry',
  'skillInvocationEvidence',
] as const;
const BUILTIN_MODEL_ENVS: Record<string, string[]> = {
  'claude-code': ['BENCH_CC_MODEL', 'ANTHROPIC_MODEL', 'BENCH_MODEL'],
  codex: ['BENCH_CODEX_MODEL', 'OPENAI_MODEL', 'CODEX_MODEL', 'BENCH_MODEL'],
  qoder: ['BENCH_QODER_MODEL', 'QODER_MODEL', 'BENCH_MODEL'],
  codebuddy: ['BENCH_CODEBUDDY_MODEL', 'CODEBUDDY_MODEL', 'BENCH_MODEL'],
};
const BUILTIN_BASE_URL_ENVS: Record<string, string[]> = {
  'claude-code': ['ANTHROPIC_BASE_URL', 'BENCH_BASE_URL'],
  codex: ['OPENAI_BASE_URL', 'CODEX_BASE_URL', 'BENCH_BASE_URL'],
  qoder: ['QODER_BASE_URL'],
  codebuddy: ['CODEBUDDY_BASE_URL', 'BENCH_BASE_URL'],
};
const hash = (value: string | Buffer) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;
const codePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const canonical = (value: unknown): string =>
  value === null || typeof value !== 'object'
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(canonical).join(',')}]`
      : `{${Object.keys(value as object)
          .sort(codePoint)
          .map(
            (key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
          )
          .join(',')}}`;
const taskName = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(value))
    throw new Error(`${field} must be a valid task name`);
  return value;
};
function validateAgentId(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    (!(AGENT_IDS as readonly string[]).includes(value) && !/^[a-z][a-z0-9-]{1,31}$/u.test(value))
  )
    throw new Error(
      `Unsupported evaluation agent ${JSON.stringify(value)} in ${field}. Expected a built-in or installed custom adapter`,
    );
  return value;
}

export interface InstalledCustomAgent {
  id: string;
  modelEnv?: string;
  baseUrlEnv?: string;
}

/** Read only the explicitly installed adapter metadata needed by static collection. */
export async function loadInstalledCustomAgent(
  agentId: string,
): Promise<InstalledCustomAgent | null> {
  if ((AGENT_IDS as readonly string[]).includes(agentId)) return null;
  if (!CUSTOM_AGENT_ID_RE.test(agentId)) return null;

  const configuredRoot = process.env.COMET_EVAL_ADAPTERS_DIR;
  const registry = path.resolve(
    configuredRoot || path.join(os.homedir(), '.comet', 'eval', 'adapters'),
  );
  let realRegistry: string;
  try {
    realRegistry = await fs.realpath(registry);
    if (!(await fs.stat(realRegistry)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error(`Custom evaluation agent is not installed: ${agentId}`);
  }

  const candidate = path.join(realRegistry, agentId);
  let realCandidate: string;
  try {
    realCandidate = await fs.realpath(candidate);
    if (
      !isPathWithin(realRegistry, realCandidate) ||
      !(await fs.stat(realCandidate)).isDirectory()
    ) {
      throw new Error('invalid adapter directory', {
        cause: new Error('adapter directory escapes registry or is not a directory'),
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid adapter directory') throw error;
    throw new Error(`Custom evaluation agent is not installed: ${agentId}`, { cause: error });
  }

  let manifestPath: string;
  try {
    manifestPath = await fs.realpath(path.join(realCandidate, 'adapter.yaml'));
    if (!isPathWithin(realCandidate, manifestPath) || !(await fs.stat(manifestPath)).isFile()) {
      throw new Error('invalid adapter manifest', {
        cause: new Error('adapter manifest escapes directory or is not a file'),
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid adapter manifest') throw error;
    throw new Error(`Custom evaluation agent ${agentId} is missing adapter.yaml`, { cause: error });
  }

  let data: unknown;
  try {
    data = parseYaml(await fs.readFile(manifestPath, 'utf8'));
  } catch (cause) {
    throw new Error(`Custom evaluation agent ${agentId} has invalid adapter.yaml`, { cause });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error(`Custom evaluation agent ${agentId} adapter.yaml must be a mapping`);
  const adapter = data as Record<string, unknown>;
  const metadata = adapter.metadata;
  const allowed = new Set([
    'apiVersion',
    'kind',
    'metadata',
    'runtime',
    'credentials',
    'modelEnv',
    'baseUrlEnv',
    'capabilities',
  ]);
  const unknown = Object.keys(adapter).find((key) => !allowed.has(key));
  if (
    unknown ||
    adapter.apiVersion !== 'comet.eval.agent/v1alpha1' ||
    adapter.kind !== 'EvalAgentAdapter' ||
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    (metadata as Record<string, unknown>).id !== agentId
  ) {
    throw new Error(`Custom evaluation agent ${agentId} has invalid adapter metadata`);
  }
  if (
    !metadata ||
    typeof (metadata as Record<string, unknown>).version !== 'string' ||
    !SAFE_TOKEN_RE.test((metadata as Record<string, unknown>).version as string)
  ) {
    throw new Error(`Custom evaluation agent ${agentId} has invalid metadata.version`);
  }
  const runtime = adapter.runtime;
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime))
    throw new Error(`Custom evaluation agent ${agentId} runtime must be a mapping`);
  const runtimeData = runtime as Record<string, unknown>;
  if (Object.keys(runtimeData).some((key) => !['executable', 'install'].includes(key)))
    throw new Error(`Custom evaluation agent ${agentId} runtime has unknown fields`);
  if (typeof runtimeData.executable !== 'string' || !SAFE_TOKEN_RE.test(runtimeData.executable))
    throw new Error(`Custom evaluation agent ${agentId} runtime.executable is invalid`);
  const install = runtimeData.install ?? { kind: 'none' };
  if (!install || typeof install !== 'object' || Array.isArray(install))
    throw new Error(`Custom evaluation agent ${agentId} runtime.install must be a mapping`);
  const installData = install as Record<string, unknown>;
  if (Object.keys(installData).some((key) => !['kind', 'package', 'version'].includes(key)))
    throw new Error(`Custom evaluation agent ${agentId} runtime.install has unknown fields`);
  const installKind = installData.kind ?? 'none';
  if (!['none', 'npm', 'pip'].includes(String(installKind)))
    throw new Error(`Custom evaluation agent ${agentId} runtime.install.kind is invalid`);
  if (installKind === 'none') {
    if (installData.package !== undefined || installData.version !== undefined)
      throw new Error(
        `Custom evaluation agent ${agentId} runtime.install package requires npm or pip`,
      );
  } else if (
    typeof installData.package !== 'string' ||
    !SAFE_TOKEN_RE.test(installData.package) ||
    (installData.version !== undefined &&
      (typeof installData.version !== 'string' || !SAFE_TOKEN_RE.test(installData.version)))
  ) {
    throw new Error(`Custom evaluation agent ${agentId} runtime.install package is invalid`);
  }
  const credentials = adapter.credentials ?? [];
  if (
    !Array.isArray(credentials) ||
    credentials.length > 2 ||
    credentials.some((value) => typeof value !== 'string' || !ENV_NAME_RE.test(value)) ||
    new Set(credentials).size !== credentials.length
  )
    throw new Error(`Custom evaluation agent ${agentId} credentials are invalid`);
  const capabilities = adapter.capabilities;
  if (
    !capabilities ||
    typeof capabilities !== 'object' ||
    Array.isArray(capabilities) ||
    Object.keys(capabilities).some(
      (key) => !(CUSTOM_CAPABILITIES as readonly string[]).includes(key),
    ) ||
    CUSTOM_CAPABILITIES.some(
      (key) =>
        !Object.hasOwn(capabilities, key) ||
        typeof (capabilities as Record<string, unknown>)[key] !== 'boolean',
    )
  )
    throw new Error(`Custom evaluation agent ${agentId} capabilities are invalid`);
  const env = (name: string): string | undefined => {
    const value = adapter[name];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !ENV_NAME_RE.test(value))
      throw new Error(
        `Custom evaluation agent ${agentId} ${name} must be an environment variable name`,
      );
    return value;
  };
  return { id: agentId, modelEnv: env('modelEnv'), baseUrlEnv: env('baseUrlEnv') };
}
function validateModel(value: unknown, field: string, required = false) {
  if (value === undefined) {
    if (required) throw new Error(`${field}: is required`);
    return;
  }
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${field} must be a non-empty string`);
}
function validateBaseUrl(data: Record<string, unknown>, field: string) {
  if (Object.hasOwn(data, 'baseUrl') && Object.hasOwn(data, 'base_url'))
    throw new Error(`${field}.baseUrl and ${field}.base_url cannot both be set`);
  const value = data.baseUrl ?? data.base_url;
  if (value === undefined) return;
  try {
    if (typeof value !== 'string' || value.trim() !== value) throw new Error('invalid');
    const parsed = new URL(value);
    const port = parsed.port ? Number(parsed.port) : undefined;
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error('invalid');
  } catch {
    throw new Error(`${field}.baseUrl: must be a valid absolute http(s) URL`);
  }
}
function environmentValue(keys: string[]): string | undefined {
  return keys.map((key) => process.env[key]?.trim()).find((value) => value);
}
function judgeFlagEnabled(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    (process.env.BENCH_LLM_JUDGE ?? '').trim().toLowerCase(),
  );
}
async function validateExecutionConfig(
  options: StaticCollectOptions,
  manifest?: Record<string, unknown>,
): Promise<{ agent: string; adapter: InstalledCustomAgent | null }> {
  if (options.agent !== undefined) validateAgentId(options.agent, 'CLI evaluation agent');
  validateModel(options.model, 'CLI evaluation model');
  if (options.baseUrl !== undefined)
    validateBaseUrl({ baseUrl: options.baseUrl }, 'CLI evaluation');
  if (options.judgeAgent !== undefined)
    validateAgentId(options.judgeAgent, 'CLI Judge evaluation agent');
  validateModel(options.judgeModel, 'CLI Judge evaluation model');
  if (options.judgeBaseUrl !== undefined)
    validateBaseUrl({ baseUrl: options.judgeBaseUrl }, 'CLI Judge evaluation');
  const execution = (manifest?.execution as Record<string, unknown> | undefined) ?? {};
  if (execution.agent !== undefined) validateAgentId(execution.agent, 'manifest execution.agent');
  validateModel(execution.model, 'execution.model');
  validateBaseUrl(execution, 'execution');
  if (manifest && Object.hasOwn(manifest, 'judge')) {
    const judge = manifest.judge as Record<string, unknown>;
    if (judge.agent !== undefined) validateAgentId(judge.agent, 'manifest judge.agent');
    validateModel(judge.model, 'judge.model', true);
    validateBaseUrl(judge, 'judge');
  }
  const configuredAgent =
    options.agent ??
    (typeof execution.agent === 'string' ? execution.agent : undefined) ??
    (typeof process.env.BENCH_EVAL_AGENT === 'string' && process.env.BENCH_EVAL_AGENT.trim()
      ? process.env.BENCH_EVAL_AGENT.trim()
      : undefined) ??
    'claude-code';
  const adapter = await loadInstalledCustomAgent(configuredAgent);
  const configuredBaseUrl =
    options.baseUrl ??
    (typeof execution.baseUrl === 'string'
      ? execution.baseUrl
      : typeof execution.base_url === 'string'
        ? execution.base_url
        : environmentValue(
            adapter?.baseUrlEnv
              ? [adapter.baseUrlEnv]
              : (BUILTIN_BASE_URL_ENVS[configuredAgent] ?? []),
          ));
  if (configuredBaseUrl !== undefined) validateBaseUrl({ baseUrl: configuredBaseUrl }, 'execution');
  if (adapter?.id && configuredBaseUrl && !adapter.baseUrlEnv) {
    throw new Error(
      `custom Agent ${adapter.id} must declare baseUrlEnv before execution.baseUrl can be used`,
    );
  }
  const judge = manifest?.judge as Record<string, unknown> | undefined;
  const configuredJudge =
    options.judgeAgent ??
    (typeof judge?.agent === 'string' ? judge.agent : undefined) ??
    (judge ||
    options.judgeModel !== undefined ||
    options.judgeBaseUrl !== undefined ||
    judgeFlagEnabled()
      ? configuredAgent
      : undefined);
  if (configuredJudge) await loadInstalledCustomAgent(configuredJudge);
  const configuredJudgeModel =
    options.judgeModel ??
    (typeof judge?.model === 'string' ? judge.model : undefined) ??
    environmentValue(['BENCH_JUDGE_MODEL']);
  const judgeEnabled = Boolean(configuredJudge);
  if (judgeEnabled && !configuredJudgeModel) {
    throw new Error(
      judgeFlagEnabled()
        ? 'BENCH_JUDGE_MODEL is required when BENCH_LLM_JUDGE=1'
        : 'judge.model: is required when LLM-as-Judge is enabled',
    );
  }
  const configuredJudgeBaseUrl =
    options.judgeBaseUrl ??
    (typeof judge?.baseUrl === 'string'
      ? judge.baseUrl
      : typeof judge?.base_url === 'string'
        ? judge.base_url
        : environmentValue(['BENCH_JUDGE_BASE_URL']));
  if (configuredJudgeBaseUrl !== undefined)
    validateBaseUrl({ baseUrl: configuredJudgeBaseUrl }, 'judge');
  return { agent: configuredAgent, adapter };
}
async function file(value: string) {
  try {
    return (await fs.stat(value)).isFile();
  } catch {
    return false;
  }
}
function yamlPath(pointer?: string) {
  return !pointer
    ? 'manifest'
    : pointer
        .split('/')
        .slice(1)
        .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
        .reduce(
          (result, part) => (/^\d+$/u.test(part) ? `${result}[${part}]` : `${result}.${part}`),
          '',
        )
        .replace(/^\./u, '');
}
const ALIAS_PAIRS: Array<[string, string]> = [
  ['draftHash', 'draft_hash'],
  ['generationHash', 'generation_hash'],
  ['generationFile', 'generation_file'],
  ['expectedNodeOrder', 'expected_node_order'],
  ['recommendedTasks', 'recommended_tasks'],
  ['baselineTreatments', 'baseline_treatments'],
  ['qualityGates', 'quality_gates'],
  ['requiredOutputSchemas', 'required_output_schemas'],
  ['expectedEvidence', 'expected_evidence'],
  ['requiredSkills', 'required_skills'],
  ['expectedArtifacts', 'expected_artifacts'],
  ['generatedNodeSkills', 'generated_node_skills'],
  ['routeConformance', 'route_conformance'],
  ['maxTurns', 'max_turns'],
  ['simulatorPrompt', 'simulator_prompt'],
  ['freshResumeMarker', 'fresh_resume_marker'],
  ['baseUrl', 'base_url'],
];
function rejectAliasConflicts(value: unknown, prefix = ''): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectAliasConflicts(item, `${prefix}[${index}]`));
    return;
  }
  const data = value as Record<string, unknown>;
  for (const [camel, snake] of ALIAS_PAIRS) {
    if (Object.hasOwn(data, camel) && Object.hasOwn(data, snake)) {
      const field = prefix ? `${prefix}.` : '';
      throw new Error(`${field}${camel} and ${field}${snake} cannot both be set`);
    }
  }
  for (const [key, child] of Object.entries(data)) {
    rejectAliasConflicts(child, prefix ? `${prefix}.${key}` : key);
  }
}
function artifact(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${field} must contain non-empty relative paths`);
  if (
    path.isAbsolute(value.replaceAll('\\', '/')) ||
    value.replaceAll('\\', '/').split('/').includes('..')
  )
    throw new Error(`${field} must stay within the task workspace: ${JSON.stringify(value)}`);
}
export function validateInlineTask(task: Record<string, unknown>, index: number) {
  const taskLabel = typeof task.name === 'string' ? `task "${task.name}": ` : '';
  const prefix = `${taskLabel}evaluation.tasks[${index}]`;
  taskName(task.name, `${prefix}.name`);
  if (typeof task.prompt !== 'string' || !task.prompt.trim())
    throw new Error(`${prefix}.prompt is required`);
  const expect = task.expect;
  if (!expect || typeof expect !== 'object' || Array.isArray(expect))
    throw new Error(`${prefix}.expect must contain at least one deterministic expect`);
  const data = expect as Record<string, unknown>;
  const allowed = new Set(['files', 'contains', 'json', 'commands']);
  const unknown = Object.keys(data).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${prefix}.expect.${unknown}: unknown field`);
  if (
    !Object.values(data).some((value) =>
      Array.isArray(value)
        ? value.length
        : value && typeof value === 'object' && Object.keys(value).length,
    )
  )
    throw new Error(`${prefix}.expect must contain at least one deterministic expect`);
  if (
    task.rubric !== undefined &&
    (!Array.isArray(task.rubric) ||
      task.rubric.some((item) => typeof item !== 'string' || !item.trim()))
  )
    throw new Error(`${prefix}.rubric must be a list of non-empty strings`);
  const files = data.files ?? [];
  if (!Array.isArray(files) || files.some((item) => typeof item !== 'string'))
    throw new Error(`${prefix}.expect.files must be a list of strings`);
  files.forEach((item) => artifact(item, `${prefix}.expect.files`));
  const contains = data.contains ?? {};
  if (!contains || typeof contains !== 'object' || Array.isArray(contains))
    throw new Error(`${prefix}.expect.contains must be a mapping`);
  for (const [name, values] of Object.entries(contains)) {
    artifact(name, `${prefix}.expect.contains`);
    if (!Array.isArray(values) || values.some((item) => typeof item !== 'string'))
      throw new Error(`${prefix}.expect.contains.${name} must be a list of strings`);
  }
  const json = data.json ?? [];
  if (!Array.isArray(json)) throw new Error(`${prefix}.expect.json must be a list of mappings`);
  for (const [i, item] of json.entries()) {
    if (!item || typeof item !== 'object')
      throw new Error(`${prefix}.expect.json must be a list of mappings`);
    const check = item as Record<string, unknown>;
    artifact(check.file, `${prefix}.expect.json[${i}].file`);
    if (typeof check.path !== 'string' || !check.path.startsWith('$'))
      throw new Error(`${prefix}.expect.json[${i}].path must start with "$"`);
    if (!Object.hasOwn(check, 'equals'))
      throw new Error(`${prefix}.expect.json[${i}].equals is required`);
  }
  const commands = data.commands ?? [];
  if (!Array.isArray(commands))
    throw new Error(`${prefix}.expect.commands must be a list of mappings`);
  for (const [i, item] of commands.entries()) {
    if (!item || typeof item !== 'object')
      throw new Error(`${prefix}.expect.commands must be a list of mappings`);
    const command = item as Record<string, unknown>;
    if (typeof command.run !== 'string' || !command.run.trim())
      throw new Error(`${prefix}.expect.commands[${i}].run is required`);
    const timeout = command.timeout ?? 120;
    if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > 3600)
      throw new Error(`${prefix}.expect.commands[${i}].timeout must be 1..3600`);
  }
}
async function packagePath(root: string, value: string, field: string) {
  const normalized = value.replaceAll('\\', '/');
  if (!normalized.trim() || path.isAbsolute(normalized) || normalized.split('/').includes('..'))
    throw new Error(`${field} must stay within the Skill package: ${JSON.stringify(value)}`);
  const realRoot = await fs.realpath(root);
  let result: string;
  try {
    result = await fs.realpath(path.resolve(realRoot, normalized));
  } catch {
    throw new Error(`${field} does not exist: ${JSON.stringify(value)}`);
  }
  if (!isPathWithin(realRoot, result))
    throw new Error(`${field} must stay within the Skill package: ${JSON.stringify(value)}`);
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        if (!isPathWithin(realRoot, await fs.realpath(child)))
          throw new Error(`${field} contains a symlink outside the Skill package: ${entry.name}`);
      } else if (entry.isDirectory()) await walk(child);
    }
  };
  if ((await fs.stat(result)).isDirectory()) await walk(result);
  return result;
}
function tomlSection(
  parsed: Record<string, unknown>,
  name: string,
  field: string,
): Record<string, unknown> {
  const value = parsed[name];
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${field}.${name} must be a mapping`);
  return value as Record<string, unknown>;
}
async function sourceTaskName(root: string, fallback: string, field: string) {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(await fs.readFile(path.join(root, 'task.toml'), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch (cause) {
    throw new Error(`${field}.task.toml is invalid TOML`, { cause });
  }
  const metadata = tomlSection(parsed, 'metadata', field);
  const template = tomlSection(parsed, 'template', field);
  const environment = tomlSection(parsed, 'environment', field);
  const validation = tomlSection(parsed, 'validation', field);
  const evaluation = tomlSection(parsed, 'evaluation', field);
  const interaction = tomlSection(parsed, 'interaction', field);
  const setup = tomlSection(parsed, 'setup', field);
  const nativeTerminal = evaluation.native_terminal ?? 'archive';
  if (!['archive', 'active', 'active-blocked'].includes(String(nativeTerminal)))
    throw new Error(`${field}.evaluation.native_terminal: ${String(nativeTerminal)} is invalid`);
  const interactionMode = interaction.mode ?? 'none';
  if (!['none', 'auto_user'].includes(String(interactionMode)))
    throw new Error(`${field}.interaction.mode: ${String(interactionMode)} is invalid`);
  const maxTurns = interaction.max_turns ?? 12;
  if (typeof maxTurns !== 'number' || !Number.isInteger(maxTurns) || maxTurns < 1)
    throw new Error(`${field}.interaction.max_turns must be a positive integer`);
  if (validation.timeout !== undefined) {
    if (
      typeof validation.timeout !== 'number' ||
      !Number.isInteger(validation.timeout) ||
      validation.timeout < 1 ||
      validation.timeout > 3600
    )
      throw new Error(`${field}.validation.timeout must be 1..3600`);
  }
  if (template.required !== undefined && !Array.isArray(template.required))
    throw new Error(`${field}.template.required must be a list`);
  if (environment.dockerfile !== undefined && typeof environment.dockerfile !== 'string')
    throw new Error(`${field}.environment.dockerfile must be a string`);
  if (setup.data !== undefined && !Array.isArray(setup.data))
    throw new Error(`${field}.setup.data must be a list`);
  return taskName(metadata.name ?? fallback, field);
}
async function snapshot(root: string) {
  const realRoot = await fs.realpath(root);
  const files = new Map<string, { path: string; hash: string }>();
  let total = 0;
  const add = async (candidate: string) => {
    if (files.size >= 128 || !(await file(candidate))) return;
    const resolved = await fs.realpath(candidate);
    if (!isPathWithin(realRoot, resolved)) return;
    const relative = path.relative(realRoot, resolved).replaceAll('\\', '/');
    if (files.has(relative)) return;
    const content = await fs.readFile(resolved, 'utf8');
    if (total + Buffer.byteLength(content) > 512 * 1024) return;
    total += Buffer.byteLength(content);
    files.set(relative, { path: relative, hash: hash(content) });
  };
  const skill = path.join(realRoot, 'SKILL.md');
  await add(skill);
  for (const match of (await fs.readFile(skill, 'utf8')).matchAll(/[`"']([^`"']+)[`"']/gu))
    await add(path.join(realRoot, match[1].replaceAll('\\', '/')));
  for (const name of ['scripts', 'references', 'reference', 'examples', 'templates']) {
    const walk = async (dir: string): Promise<void> => {
      for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
        codePoint(a.name, b.name),
      )) {
        const child = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await walk(child);
        else await add(child);
      }
    };
    try {
      await walk(path.join(realRoot, name));
    } catch {
      /* optional */
    }
  }
  return hash(canonical([...files.values()].sort((a, b) => codePoint(a.path, b.path))));
}
async function managedArtifactPath(
  context: ResolvedEvalContext,
  managedRoot: 'generated' | 'cache' | 'runs' | 'locks',
  ...parts: string[]
) {
  const ownerRoot = await fs.realpath(context.artifactOwnerRoot);
  const artifactRoot = path.resolve(context.artifactRoot);
  const resolvedArtifactRoot = await fs.realpath(artifactRoot).catch(() => artifactRoot);
  if (!isPathWithin(ownerRoot, resolvedArtifactRoot))
    throw new Error('Eval artifact root must stay within its owner root');
  let current = artifactRoot;
  for (const segment of [managedRoot, ...parts]) {
    if (!segment || path.isAbsolute(segment) || segment === '.' || segment === '..')
      throw new Error('Eval managed path components must be relative names');
    current = path.join(current, segment);
    try {
      const resolved = await fs.realpath(current);
      if (!isPathWithin(ownerRoot, resolved) || !isPathWithin(resolvedArtifactRoot, resolved))
        throw new Error('Eval managed path must stay within its owner-local artifact root');
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Eval managed path must stay within its owner-local artifact root'
      )
        throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return current;
}
function interaction(manifest?: Record<string, unknown>) {
  const data =
    manifest?.interaction &&
    typeof manifest.interaction === 'object' &&
    !Array.isArray(manifest.interaction)
      ? (manifest.interaction as Record<string, unknown>)
      : {};
  return {
    mode: data.mode ?? 'none',
    max_turns: Number(data.maxTurns ?? data.max_turns ?? 12),
    simulator_prompt: data.simulatorPrompt || data.simulator_prompt || null,
    decision_patterns: data.decisionPatterns ?? [],
    decision_reply: data.decisionReply ?? null,
    decision_replies: data.decisionReplies ?? [],
    continue_prompt: data.continuePrompt ?? 'Please continue with the next phase of the workflow.',
    fresh_resume_marker: data.freshResumeMarker || data.fresh_resume_marker || null,
  };
}
export async function collectStandaloneTasks(
  options: StaticCollectOptions,
  context: ResolvedEvalContext,
  packageRoot: string,
): Promise<string[]> {
  let manifest: Record<string, unknown> | undefined;
  let evaluation: Record<string, unknown> = {};
  const validate = async (raw: string) => {
    const value = parseYaml(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Eval manifest must be a mapping');
    rejectAliasConflicts(value);
    const schema = JSON.parse(
      await fs.readFile(
        path.join(packageRoot, 'eval', 'schemas', 'comet.eval', 'v1alpha1.schema.json'),
        'utf8',
      ),
    );
    delete schema.$schema;
    const Constructor = Ajv as unknown as new (options: object) => {
      compile: (schema: object) => ((data: unknown) => boolean) & {
        errors?: Array<{
          instancePath?: string;
          keyword?: string;
          message?: string;
          params?: object;
        }>;
      };
    };
    const validator = new Constructor({ allErrors: true, strict: false }).compile(schema);
    if (!validator(value)) {
      const error = validator.errors?.[0];
      const field = (error?.params as { additionalProperty?: string } | undefined)
        ?.additionalProperty;
      const missing = (error?.params as { missingProperty?: string } | undefined)?.missingProperty;
      const at = yamlPath(error?.instancePath);
      const taskMatch = at.match(/^evaluation\.tasks\[(\d+)\](.*)$/u);
      const taskValue = taskMatch
        ? (value.evaluation as Record<string, unknown> | undefined)?.tasks
        : undefined;
      const taskNameValue =
        taskMatch && Array.isArray(taskValue)
          ? (taskValue[Number(taskMatch[1])] as Record<string, unknown> | undefined)?.name
          : undefined;
      const diagnosticAt =
        taskMatch && typeof taskNameValue === 'string' ? `task "${taskNameValue}": ${at}` : at;
      throw new Error(
        error?.keyword === 'additionalProperties' && field
          ? `${diagnosticAt === 'manifest' ? field : `${diagnosticAt}.${field}`}: unknown field`
          : error?.keyword === 'required' && missing
            ? `${diagnosticAt === 'manifest' ? missing : `${diagnosticAt}.${missing}`}: is required`
            : error?.keyword === 'pattern' && /(?:baseUrl|base_url)$/u.test(at)
              ? `${diagnosticAt}: must be a valid absolute http(s) URL`
              : `${diagnosticAt}: ${error?.message ?? 'invalid manifest'}`,
      );
    }
    return value as Record<string, unknown>;
  };
  if (context.manifestPath) {
    manifest = await validate(await fs.readFile(context.manifestPath, 'utf8'));
    evaluation = (manifest.evaluation as Record<string, unknown>) ?? {};
  }
  const executionConfig = await validateExecutionConfig(options, manifest);
  const bundled = new Set<string>();
  const bundles = new Map<string, string>();
  for (const entry of await fs.readdir(path.join(packageRoot, 'eval', 'local', 'tasks'), {
    withFileTypes: true,
  })) {
    const root = path.join(packageRoot, 'eval', 'local', 'tasks', entry.name);
    if (
      entry.isDirectory() &&
      (await file(path.join(root, 'task.toml'))) &&
      (await file(path.join(root, 'instruction.md')))
    ) {
      const name = await sourceTaskName(root, entry.name, `bundled task ${entry.name}`);
      if (bundled.has(name))
        throw new Error(`bundled task name duplicates another bundle: ${name}`);
      bundled.add(name);
      bundles.set(name, entry.name);
    }
  }
  const authored = Array.isArray(evaluation.tasks) ? evaluation.tasks : [];
  const names: string[] = [];
  for (const [i, item] of authored.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error(`evaluation.tasks[${i}] must be a mapping`);
    const task = item as Record<string, unknown>;
    if (typeof task.source === 'string') {
      if (Object.keys(task).some((key) => key !== 'source' && key !== 'name'))
        throw new Error(`evaluation.tasks[${i}]: source tasks cannot define inline fields`);
      const source = await packagePath(
        context.skillRoot,
        task.source,
        `evaluation.tasks[${i}].source`,
      );
      if (
        !(await file(path.join(source, 'task.toml'))) ||
        !(await file(path.join(source, 'instruction.md')))
      )
        throw new Error(
          `evaluation.tasks[${i}].source must point to a task package with task.toml and instruction.md`,
        );
      const canonicalSourceName = await sourceTaskName(
        source,
        path.basename(source),
        `evaluation.tasks[${i}].source`,
      );
      names.push(
        task.name === undefined
          ? canonicalSourceName
          : taskName(task.name, `evaluation.tasks[${i}].name`),
      );
    } else {
      validateInlineTask(task, i);
      names.push(task.name as string);
    }
    if (typeof task.workspace === 'string')
      await packagePath(context.skillRoot, task.workspace, `evaluation.tasks[${i}].workspace`);
  }
  const recommended = Array.isArray(evaluation.recommendedTasks)
    ? evaluation.recommendedTasks
    : Array.isArray(evaluation.recommended_tasks)
      ? evaluation.recommended_tasks
      : [];
  const rec = recommended.map((item, i) => taskName(item, `evaluation.recommendedTasks[${i}]`));
  for (const [i, name] of names.entries()) {
    const first = names.indexOf(name);
    if (first !== i)
      throw new Error(
        `evaluation.tasks[${i}].name duplicates evaluation.tasks[${first}].name: "${name}"`,
      );
    if (bundled.has(name))
      throw new Error(
        `evaluation.tasks[${i}].name conflicts with bundled task "${bundles.get(name)}": "${name}"`,
      );
  }
  for (const [i, name] of rec.entries()) {
    const first = rec.indexOf(name);
    if (first !== i)
      throw new Error(
        `evaluation.recommendedTasks[${i}] duplicates evaluation.recommendedTasks[${first}]: "${name}"`,
      );
    if (!bundled.has(name))
      throw new Error(`evaluation.recommendedTasks[${i}]: unknown bundled task "${name}"`);
    if (names.includes(name))
      throw new Error(
        `evaluation.tasks[${names.indexOf(name)}].name conflicts with evaluation.recommendedTasks[${i}]: "${name}"`,
      );
  }
  if (options.task) {
    if (!names.includes(options.task) && !bundled.has(options.task))
      throw new Error(`Task not found: ${options.task}`);
    return ['Tasks: explicit', `- ${options.task}`];
  }
  if (options.quick) return ['Tasks: quick', '- generic-skill-smoke'];
  if (names.length) return ['Tasks: authored', ...names.map((name) => `- ${name}`)];
  if (rec.length) return ['Tasks: recommended', ...rec.map((name) => `- ${name}`)];
  try {
    const agent = executionConfig.agent;
    const profile =
      options.profile ??
      ((manifest?.skill as Record<string, unknown> | undefined)?.profile as string | undefined) ??
      'generic';
    const execution = (manifest?.execution as Record<string, unknown> | undefined) ?? {};
    const configuredModel = execution.model;
    const customModel = executionConfig.adapter?.modelEnv
      ? process.env[executionConfig.adapter.modelEnv]?.trim() || undefined
      : undefined;
    const model =
      options.model ??
      (typeof configuredModel === 'string' && configuredModel.trim()
        ? configuredModel
        : undefined) ??
      customModel ??
      environmentValue(BUILTIN_MODEL_ENVS[agent] ?? []) ??
      'runtime-default';
    const customBaseUrl = executionConfig.adapter?.baseUrlEnv
      ? process.env[executionConfig.adapter.baseUrlEnv]?.trim() || undefined
      : undefined;
    const baseUrl =
      options.baseUrl ??
      (typeof execution.baseUrl === 'string'
        ? execution.baseUrl
        : typeof execution.base_url === 'string'
          ? execution.base_url
          : (customBaseUrl ??
            environmentValue(BUILTIN_BASE_URL_ENVS[agent] ?? []) ??
            'runtime-default'));
    const generation = createHash('sha256')
      .update(
        canonical({
          snapshot_hash: await snapshot(context.skillRoot),
          agent,
          model,
          base_url: baseUrl,
          profile,
          interaction: interaction(manifest),
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
    const metadataPath = await managedArtifactPath(
      context,
      'generated',
      safe,
      generation,
      'generation.json',
    );
    const manifestPath = await managedArtifactPath(
      context,
      'generated',
      safe,
      generation,
      'eval.yaml',
    );
    const [meta, raw] = await Promise.all([
      fs.readFile(metadataPath, 'utf8'),
      fs.readFile(manifestPath, 'utf8'),
    ]);
    if (
      (JSON.parse(meta) as Record<string, unknown>).generation_hash !== generation ||
      (JSON.parse(meta) as Record<string, unknown>).manifest_hash !== hash(raw)
    )
      throw new Error('cache mismatch');
    const cached = await validate(raw);
    const tasks = (cached.evaluation as Record<string, unknown>)?.tasks;
    if (!Array.isArray(tasks) || tasks.length < 2 || tasks.length > 4)
      throw new Error('cache tasks');
    const cachedNames = tasks.map((task, i) => {
      if (!task || typeof task !== 'object' || Array.isArray(task))
        throw new Error(`cached evaluation.tasks[${i}] must be a mapping`);
      validateInlineTask(task as Record<string, unknown>, i);
      return taskName((task as Record<string, unknown>).name, `cached evaluation.tasks[${i}].name`);
    });
    if (
      new Set(cachedNames).size !== cachedNames.length ||
      cachedNames.some((name) => bundled.has(name) || names.includes(name) || rec.includes(name))
    )
      throw new Error('cache collision');
    return ['Tasks: generated cache', ...cachedNames.map((name) => `- ${name}`)];
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith('Eval artifact root') ||
        error.message.startsWith('Eval managed path'))
    )
      throw error;
    return [
      'Tasks: pending generation',
      'A normal comet eval run generates and freezes 2-4 tasks before execution.',
    ];
  }
}
