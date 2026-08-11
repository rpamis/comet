import { createHash } from 'crypto';
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
  profile?: string;
}

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
  const prefix = `evaluation.tasks[${index}]`;
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
async function tomlName(root: string, fallback: string, field: string) {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(await fs.readFile(path.join(root, 'task.toml'), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch (cause) {
    throw new Error(`${field}.task.toml is invalid TOML`, { cause });
  }
  const metadata = parsed.metadata;
  return taskName(
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? ((metadata as Record<string, unknown>).name ?? fallback)
      : fallback,
    field,
  );
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
      const at = yamlPath(error?.instancePath);
      throw new Error(
        error?.keyword === 'additionalProperties' && field
          ? `${at === 'manifest' ? field : `${at}.${field}`}: unknown field`
          : `${at}: ${error?.message ?? 'invalid manifest'}`,
      );
    }
    return value as Record<string, unknown>;
  };
  if (context.manifestPath) {
    manifest = await validate(await fs.readFile(context.manifestPath, 'utf8'));
    evaluation = (manifest.evaluation as Record<string, unknown>) ?? {};
  }
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
      const name = await tomlName(root, entry.name, `bundled task ${entry.name}`);
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
      names.push(
        task.name === undefined
          ? await tomlName(source, path.basename(source), `evaluation.tasks[${i}].source`)
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
    const agent =
      options.agent ??
      ((manifest?.execution as Record<string, unknown> | undefined)?.agent as string | undefined) ??
      'claude-code';
    const profile =
      options.profile ??
      ((manifest?.skill as Record<string, unknown> | undefined)?.profile as string | undefined) ??
      'generic';
    const model =
      agent === 'claude-code'
        ? (process.env.BENCH_CC_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'runtime-default')
        : agent === 'codex'
          ? (process.env.BENCH_CODEX_MODEL ?? process.env.OPENAI_MODEL ?? 'runtime-default')
          : agent === 'qoder'
            ? (process.env.BENCH_QODER_MODEL ?? process.env.QODER_MODEL ?? 'runtime-default')
            : (process.env.BENCH_CODEBUDDY_MODEL ??
              process.env.CODEBUDDY_MODEL ??
              'runtime-default');
    const generation = createHash('sha256')
      .update(
        canonical({
          snapshot_hash: await snapshot(context.skillRoot),
          agent,
          model,
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
    const dir = path.join(context.artifactRoot, 'generated', safe, generation);
    const [meta, raw] = await Promise.all([
      fs.readFile(path.join(dir, 'generation.json'), 'utf8'),
      fs.readFile(path.join(dir, 'eval.yaml'), 'utf8'),
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
  } catch {
    return [
      'Tasks: pending generation',
      'A normal comet eval run generates and freezes 2-4 tasks before execution.',
    ];
  }
}
