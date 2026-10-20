import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { runExternalCommandAsync } from '../../platform/process/external-command.js';
import { loadUserEvalEnvironment } from './user-environment.js';
import { collectStandaloneTasks, loadInstalledCustomAgent } from './standalone-static-collect.js';
import { resolveEvalContext, isPathWithin } from './standalone-context.js';
import {
  previewWorkflowApplicationEval,
  type ApplicationEvalPreview,
  type ApplicationEvalSettings,
} from './application-eval.js';
import { EvalRunError, evalValueHash, redactEvalOutput } from './eval-run-store.js';
import type { EvalRunConfig } from './eval-run-types.js';
import { EVAL_AGENT_ENVIRONMENT, resolveEvalExecution } from './eval-execution-config.js';
import { evalDefaultBudget, evalDefaultSuite } from './eval-user-settings.js';
import { readEvalRetrySelection, type EvalRetrySelection } from './eval-run-retry.js';

export interface EvalRunPreview {
  config: EvalRunConfig;
  target: {
    id: string;
    name: string;
    type: 'skill' | 'application';
    path: string;
    version: string | null;
    contentHash: string;
  };
  taskSource: string;
  tasks: Array<{ name: string; instruction: string | null; expected: unknown }>;
  taskCount: { min: number; max: number };
  environment: Array<{
    id: string;
    label: string;
    status: 'available' | 'missing' | 'not-tested';
    detail: string;
  }>;
  blockedReasons: string[];
  limitations: string[];
  confirmationHash: string;
  noModelsStarted: true;
  application?: ApplicationEvalPreview;
  retry?: EvalRetrySelection;
}
export const EVAL_AGENT_IDS = ['claude-code', 'codex', 'qoder', 'codebuddy'] as const;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const declaredTasks = (value: unknown): Array<Record<string, unknown>> => {
  const tasks = record(record(value).evaluation).tasks;
  return Array.isArray(tasks) ? tasks.map(record) : [];
};
export function applicationEvalSettings(config: EvalRunConfig): ApplicationEvalSettings {
  return {
    agent: config.agent!,
    ...(config.model ? { model: config.model } : {}),
    ...(config.judgeAgent ? { judgeAgent: config.judgeAgent } : {}),
    ...(config.judgeModel ? { judgeModel: config.judgeModel } : {}),
    ...(config.maxTurns !== undefined ? { maxTurns: config.maxTurns } : {}),
    ...(config.timeoutSeconds !== undefined ? { timeoutSeconds: config.timeoutSeconds } : {}),
  };
}
const FIELDS = new Set([
  'target',
  'targetType',
  'agent',
  'model',
  'judgeAgent',
  'judgeModel',
  'judgeEnabled',
  'baseUrl',
  'judgeBaseUrl',
  'suite',
  'task',
  'quick',
  'profile',
  'goal',
  'timeoutSeconds',
  'maxTurns',
  'previousExperimentId',
  'retrySourceRunId',
]);
export const evalPackageRoot = (() => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  return path.basename(root) === 'dist' ? path.dirname(root) : root;
})();
export function normalizeEvalRunConfig(project: string, value: unknown): EvalRunConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new EvalRunError('Eval 配置必须是对象');
  const input = { ...value } as Record<string, unknown>;
  for (const key of Object.keys(input))
    if (!FIELDS.has(key)) throw new EvalRunError(`不支持的 Eval 配置字段：${key}`);
  if (typeof input.target !== 'string' || !input.target.trim())
    throw new EvalRunError('请选择 Eval 目标路径');
  const target = path.resolve(project, input.target.trim());
  const targetType = path.basename(target) === 'application.json' ? 'application' : 'skill';
  if (input.targetType && input.targetType !== targetType)
    throw new EvalRunError(
      `目标类型与路径不一致：请选择「${targetType === 'skill' ? 'Skill / Eval manifest' : 'SDK 应用'}」，或使用自动识别`,
    );
  for (const key of ['agent', 'judgeAgent'])
    if (
      input[key] !== undefined &&
      (typeof input[key] !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/u.test(input[key] as string))
    )
      throw new EvalRunError(`${key} 无效`);
  for (const key of [
    'model',
    'judgeModel',
    'task',
    'profile',
    'goal',
    'previousExperimentId',
    'retrySourceRunId',
  ])
    if (
      input[key] !== undefined &&
      (typeof input[key] !== 'string' ||
        (input[key] as string).length > (key === 'goal' ? 4000 : 512))
    )
      throw new EvalRunError(`${key} 无效`);
  for (const key of ['baseUrl', 'judgeBaseUrl']) {
    if (input[key] !== undefined) {
      try {
        const url = new URL(String(input[key]));
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error();
      } catch {
        throw new EvalRunError('模型端点必须是无凭据的 HTTP(S) 地址');
      }
    }
  }
  if (input.quick !== undefined && typeof input.quick !== 'boolean')
    throw new EvalRunError('quick 必须是布尔值');
  if (input.judgeEnabled !== undefined && typeof input.judgeEnabled !== 'boolean')
    throw new EvalRunError('judgeEnabled 必须是布尔值');
  if (
    input.suite !== undefined &&
    !['local', 'langsmith', 'langfuse'].includes(String(input.suite))
  )
    throw new EvalRunError('不支持的报告去向');
  if (
    targetType === 'application' &&
    (input.quick ||
      input.task ||
      input.baseUrl ||
      input.judgeBaseUrl ||
      (input.suite && input.suite !== 'local'))
  )
    throw new EvalRunError('SDK 应用不支持 quick、单任务或端点覆盖，报告模式为 local');
  const environment = { ...process.env };
  loadUserEvalEnvironment(environment, os.homedir(), { create: false });
  const defaultBudget = evalDefaultBudget(targetType, environment);
  const timeoutSeconds = input.timeoutSeconds ?? defaultBudget.timeoutSeconds;
  const maxTurns = input.maxTurns ?? defaultBudget.maxTurns;
  if (
    !Number.isSafeInteger(timeoutSeconds) ||
    Number(timeoutSeconds) < 30 ||
    Number(timeoutSeconds) > 86400 ||
    !Number.isSafeInteger(maxTurns) ||
    Number(maxTurns) < 1 ||
    Number(maxTurns) > 200
  )
    throw new EvalRunError('时限须为 30–86400 秒，执行轮数须为 1–200');
  if ((input.judgeEnabled === true || input.judgeAgent || input.judgeBaseUrl) && !input.judgeModel)
    throw new EvalRunError('启用独立 Judge 时须指定模型');
  if (input.judgeEnabled === false) {
    delete input.judgeAgent;
    delete input.judgeModel;
    delete input.judgeBaseUrl;
  }
  return {
    ...input,
    target,
    targetType,
    suite: input.suite ?? (targetType === 'application' ? 'local' : evalDefaultSuite(environment)),
    timeoutSeconds,
    maxTurns,
  } as EvalRunConfig;
}
export async function hashEvalSkill(root: string, manifest?: string): Promise<string> {
  const canonical = await fs.realpath(root);
  const files: Array<[string, string]> = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (
        ['.git', '.comet', 'node_modules', '__pycache__', '.venv'].includes(entry.name) ||
        entry.name === '.env' ||
        entry.name.startsWith('.env.')
      )
        continue;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new EvalRunError('评估目标内容不能包含符号链接');
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        if (files.length >= 4096 || (await fs.stat(file)).size > 16 * 1024 * 1024)
          throw new EvalRunError('Skill 内容超过快照限制');
        files.push([
          path.relative(canonical, file).split(path.sep).join('/'),
          evalValueHash((await fs.readFile(file)).toString('base64')),
        ]);
      }
    }
  };
  await walk(canonical);
  if (manifest && !isPathWithin(canonical, await fs.realpath(manifest)))
    files.push(['external-manifest', evalValueHash(await fs.readFile(manifest, 'utf8'))]);
  return evalValueHash(files);
}
async function probe(
  command: string,
  args: string[],
  id: string,
  label: string,
): Promise<EvalRunPreview['environment'][number]> {
  try {
    await runExternalCommandAsync(command, args, { timeoutMs: 5000, maxBufferBytes: 8192 });
    return { id, label, status: 'available', detail: '本机检查通过' };
  } catch {
    return { id, label, status: 'missing', detail: `${label} 不可用，请安装或启动后重新检查` };
  }
}
export async function evalEnvironmentChecks(
  config: EvalRunConfig,
): Promise<EvalRunPreview['environment']> {
  const environment = { ...process.env };
  loadUserEvalEnvironment(environment, os.homedir(), { create: false });
  const adapter = await loadInstalledCustomAgent(config.agent ?? 'claude-code', environment, {
    includeCredentials: true,
  });
  const subjectKeys = adapter?.credentials ??
    EVAL_AGENT_ENVIRONMENT[config.agent ?? 'claude-code']?.credentials ?? ['BENCH_API_KEY'];
  const mainReady = adapter
    ? subjectKeys.every((key) => environment[key]?.trim())
    : subjectKeys.some((key) => environment[key]?.trim());
  const checks = await Promise.all([
    probe('uv', ['--version'], 'uv', 'uv'),
    probe('docker', ['info', '--format', '{{.ServerVersion}}'], 'docker', 'Docker'),
  ]);
  checks.push({
    id: 'subject',
    label: '执行模型凭据',
    status: mainReady ? 'available' : 'missing',
    detail: !subjectKeys.length
      ? '此本地适配器未声明凭据要求'
      : mainReady
        ? '已配置，未验证端点连接'
        : `请配置 ${subjectKeys.join(' / ')}，配置文件位于 ~/.comet/eval/.env`,
  });
  if (config.judgeModel) {
    const ready = ['BENCH_JUDGE_API_KEY', 'BENCH_JUDGE_AUTH_TOKEN'].some((key) =>
      environment[key]?.trim(),
    );
    checks.push({
      id: 'judge',
      label: '独立 Judge 凭据',
      status: ready ? 'available' : 'missing',
      detail: ready
        ? '已配置，未验证端点连接'
        : '请配置独立的 BENCH_JUDGE_API_KEY 或 BENCH_JUDGE_AUTH_TOKEN',
    });
  }
  if (config.suite && config.suite !== 'local') {
    const keys =
      config.suite === 'langsmith'
        ? ['LANGSMITH_API_KEY']
        : ['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'];
    const ready = keys.every((key) => environment[key]?.trim());
    checks.push({
      id: 'tracking',
      label: config.suite,
      status: ready ? 'available' : 'missing',
      detail: ready ? '已配置，未验证服务连接' : `请配置 ${keys.join(' / ')}`,
    });
  }
  checks.push({
    id: 'connection',
    label: '模型端点连通性',
    status: 'not-tested',
    detail: '预检不调用模型；正式运行后展示实际连接结果',
  });
  return checks;
}
export async function previewEvalRun(project: string, value: unknown): Promise<EvalRunPreview> {
  const config = normalizeEvalRunConfig(project, value);
  const retry = config.retrySourceRunId
    ? await readEvalRetrySelection(project, config.retrySourceRunId)
    : undefined;
  if (retry && config.targetType === 'application')
    config.previousExperimentId = retry.taskSourceRunId;
  const environmentValues = { ...process.env };
  loadUserEvalEnvironment(environmentValues, os.homedir(), { create: false });
  const resolvedContext =
    config.targetType === 'skill'
      ? await resolveEvalContext({
          project,
          ...(retry?.manifestPath
            ? { manifest: retry.manifestPath }
            : /eval\.ya?ml$/iu.test(config.target)
              ? { manifest: config.target }
              : { skillPath: config.target }),
        })
      : undefined;
  const execution = await resolveEvalExecution(config, resolvedContext, environmentValues);
  config.agent = execution.agent;
  if (execution.model !== 'default') config.model = execution.model;
  if (execution.judge) {
    if (execution.judge.model === 'missing')
      throw new EvalRunError('独立 Judge 已启用，但未配置模型');
    config.judgeAgent = execution.judge.agent;
    config.judgeModel = execution.judge.model;
  }
  let application: ApplicationEvalPreview | undefined;
  let target: EvalRunPreview['target'];
  let taskSource: string;
  let tasks: EvalRunPreview['tasks'] = [];
  let taskCount: EvalRunPreview['taskCount'];
  let limitations: string[];
  let blockedReasons: string[] = [];
  if (config.targetType === 'application') {
    application = await previewWorkflowApplicationEval({
      file: config.target,
      projectRoot: project,
      goal: config.goal,
      previousExperimentId: config.previousExperimentId,
      settings: applicationEvalSettings(config),
    });
    target = {
      id: application.application.id,
      name: application.application.id,
      type: 'application',
      path: config.target,
      version: application.application.version,
      contentHash: application.application.contentHash,
    };
    taskSource = application.taskSet ? 'fixed-reuse' : 'pending-generation';
    taskCount = application.taskCount;
    limitations = application.limitations;
    blockedReasons = [...application.blockedReasons];
    if (application.taskSet) {
      const manifest = parse(await fs.readFile(application.taskSet.manifestPath, 'utf8'));
      tasks = declaredTasks(manifest).map((task) => ({
        name: String(task.name),
        instruction: typeof task.instruction === 'string' ? task.instruction : null,
        expected: task.expect ?? null,
      }));
      taskCount = { min: tasks.length, max: tasks.length };
    }
  } else {
    const context = resolvedContext!;
    let collectedManifest: string | undefined;
    const lines = await collectStandaloneTasks(
      {
        ...config,
        environment: environmentValues,
        onManifest: (file) => {
          collectedManifest = file;
        },
      },
      context,
      evalPackageRoot,
    );
    taskSource = (lines[0] ?? '').replace(/^Tasks:\s*/u, '').replace(/\s+/gu, '-');
    let data: Record<string, unknown> = context.baseManifest ?? {};
    if (collectedManifest ?? context.manifestPath)
      data = record(parse(await fs.readFile((collectedManifest ?? context.manifestPath)!, 'utf8')));
    const names = lines.slice(1).map((line) => line.replace(/^-\s*/u, ''));
    tasks = names.map((name) => {
      const task = declaredTasks(data).find((task) => task.name === name);
      return {
        name,
        instruction:
          typeof task?.instruction === 'string'
            ? task.instruction
            : typeof task?.prompt === 'string'
              ? task.prompt
              : null,
        expected: task?.expect ?? null,
      };
    });
    taskCount =
      taskSource === 'pending-generation'
        ? { min: 2, max: 4 }
        : { min: names.length, max: names.length };
    target = {
      id: context.skillRoot,
      name:
        typeof record(data.skill).name === 'string'
          ? String(record(data.skill).name)
          : path.basename(context.skillRoot),
      type: 'skill',
      path: config.target,
      version:
        typeof record(data.metadata).version === 'string'
          ? String(record(data.metadata).version)
          : null,
      contentHash: await hashEvalSkill(context.skillRoot, context.manifestPath),
    };
    limitations = [
      '结果仅对应固定内容、用例和执行配置；环境异常样本单独标注。',
      '预检只收集目标并检查本地环境，不验证模型能力或端点连接。',
    ];
  }
  if (retry) {
    if (retry.targetId !== target.id)
      throw new EvalRunError('失败重跑的目标与原记录不一致，请选择原评估目标', 409);
    const names = new Set(tasks.map((task) => task.name));
    if (taskSource === 'pending-generation' || retry.cases.some((item) => !names.has(item.task)))
      throw new EvalRunError(
        '原固定用例不可用，失败重跑不会重新生成用例；请恢复原用例或进行完整评估',
        409,
      );
    tasks = tasks.filter((task) => retry.cases.some((item) => item.task === task.name));
    taskCount = { min: retry.cases.length, max: retry.cases.length };
    limitations = [...limitations, '仅重跑原失败用例，不替换原结果、默认基线或完整应用验收证据。'];
    taskSource = 'failed-retry';
  }
  const environment = await evalEnvironmentChecks(config);
  blockedReasons.push(
    ...environment.filter((item) => item.status === 'missing').map((item) => item.detail),
  );
  const body = {
    config,
    target,
    taskSource,
    tasks,
    taskCount,
    environment,
    blockedReasons,
    limitations,
    noModelsStarted: true as const,
    ...(application ? { application } : {}),
    ...(retry ? { retry } : {}),
  };
  // Environment availability is checked again at launch; the confirmation binds immutable inputs.
  const confirmationHash = evalValueHash({
    config,
    target,
    taskSource,
    tasks,
    execution,
    application: application?.confirmationHash,
    retry,
  });
  return JSON.parse(
    redactEvalOutput(JSON.stringify({ ...body, confirmationHash }), environmentValues),
  ) as EvalRunPreview;
}
