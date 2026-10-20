import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';
import { isPathWithin } from './standalone-context.js';
import { parseDotenv } from './user-environment.js';
import { EVAL_AGENT_ENVIRONMENT, resolveEvalExecution } from './eval-execution-config.js';
import { EvalRunError, evalValueHash, redactEvalOutput } from './eval-run-store.js';

export interface UserEvalDefaults {
  suite?: 'local' | 'langsmith' | 'langfuse';
  langsmithEndpoint?: string;
  langsmithProject?: string;
  langsmithTracing?: boolean;
  langfuseBaseUrl?: string;
  langfuseEnvironment?: string;
  agent: string;
  model: string;
  baseUrl: string;
  judgeEnabled: boolean;
  judgeAgent: string;
  judgeModel: string;
  judgeBaseUrl: string;
  skillTimeoutSeconds: number;
  skillMaxTurns: number;
  applicationTimeoutSeconds: number;
  applicationMaxTurns: number;
}
const budgetFields = {
  skillTimeoutSeconds: ['COMET_EVAL_SKILL_TIMEOUT_SECONDS', 600, 30, 86400],
  skillMaxTurns: ['COMET_EVAL_SKILL_MAX_TURNS', 40, 1, 200],
  applicationTimeoutSeconds: ['COMET_EVAL_APPLICATION_TIMEOUT_SECONDS', 1200, 30, 3600],
  applicationMaxTurns: ['COMET_EVAL_APPLICATION_MAX_TURNS', 8, 1, 32],
} as const;
const judgeKeys = ['BENCH_JUDGE_API_KEY', 'BENCH_JUDGE_AUTH_TOKEN'];
const trackingKeys = {
  langsmith: ['LANGSMITH_API_KEY'],
  langfusePublic: ['LANGFUSE_PUBLIC_KEY'],
  langfuseSecret: ['LANGFUSE_SECRET_KEY'],
};
const trackingFields = {
  langsmithEndpoint: 'LANGSMITH_ENDPOINT',
  langsmithProject: 'LANGSMITH_PROJECT',
  langfuseBaseUrl: 'LANGFUSE_BASE_URL',
  langfuseEnvironment: 'LANGFUSE_TRACING_ENVIRONMENT',
} as const;
export function evalDefaultSuite(
  environment: NodeJS.ProcessEnv,
): NonNullable<UserEvalDefaults['suite']> {
  const value = environment.COMET_EVAL_SUITE;
  return value === 'langsmith' || value === 'langfuse' ? value : 'local';
}
const filePath = () => path.join(os.homedir(), '.comet', 'eval', '.env');
const present = (value: string | undefined) => !!value?.trim();
const hasUnsafeCharacters = (value: string) =>
  [...value].some(
    (character) => character.codePointAt(0)! < 32 || character === "'" || character === '"',
  );
const fileValues = (source: string): NodeJS.ProcessEnv => {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of parseDotenv(source)) if (!present(result[key])) result[key] = value;
  return result;
};
export function evalDefaultBudget(
  type: 'skill' | 'application',
  environment: NodeJS.ProcessEnv,
): { timeoutSeconds: number; maxTurns: number } {
  const read = (field: keyof typeof budgetFields) => {
    const [key, fallback, min, max] = budgetFields[field];
    const value = Number(environment[key]);
    return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
  };
  return {
    timeoutSeconds: read(type === 'skill' ? 'skillTimeoutSeconds' : 'applicationTimeoutSeconds'),
    maxTurns: read(type === 'skill' ? 'skillMaxTurns' : 'applicationMaxTurns'),
  };
}
async function readSource(): Promise<string> {
  try {
    const stat = await fs.lstat(filePath());
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
      throw new EvalRunError('Eval 用户配置必须是普通文件且小于 1 MiB');
    return await fs.readFile(filePath(), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}
async function describe(source: string, inherited: NodeJS.ProcessEnv) {
  const stored = fileValues(source);
  const environment = { ...stored };
  for (const [key, value] of Object.entries(inherited))
    if (present(value)) environment[key] = value;
  let execution;
  try {
    execution = await resolveEvalExecution({}, undefined, environment);
  } catch {
    throw new EvalRunError('Eval 执行 Agent 配置无效，请检查已安装的适配器');
  }
  const mainKeys = EVAL_AGENT_ENVIRONMENT[execution.agent]?.credentials ?? ['BENCH_API_KEY'];
  environment.COMET_EVAL_CUSTOM_CREDENTIALS = [
    environment.COMET_EVAL_CUSTOM_CREDENTIALS,
    ...mainKeys,
    ...judgeKeys,
    ...Object.values(trackingKeys).flat(),
  ]
    .filter(Boolean)
    .join(',');
  const credential = (keys: string[]) => {
    const key = keys.find((key) => present(environment[key]));
    const runtime = key && present(inherited[key]) ? key : undefined;
    const saved = keys.find((key) => present(stored[key]));
    return {
      configured: !!key,
      source: runtime ? 'environment' : key ? 'file' : 'none',
      saved: !!saved,
      kind: key?.endsWith('AUTH_TOKEN') ? 'auth-token' : 'api-key',
    };
  };
  const skill = evalDefaultBudget('skill', environment);
  const application = evalDefaultBudget('application', environment);
  const defaults: UserEvalDefaults = {
    suite: evalDefaultSuite(environment),
    langsmithEndpoint: environment.LANGSMITH_ENDPOINT ?? '',
    langsmithProject: environment.LANGSMITH_PROJECT ?? '',
    langsmithTracing: (environment.LANGSMITH_TRACING ?? 'true').toLowerCase() === 'true',
    langfuseBaseUrl: environment.LANGFUSE_BASE_URL ?? '',
    langfuseEnvironment: environment.LANGFUSE_TRACING_ENVIRONMENT ?? '',
    agent: execution.agent,
    model: execution.model === 'default' ? '' : execution.model,
    baseUrl: execution.baseUrl ?? '',
    judgeEnabled: !!execution.judge,
    judgeAgent: execution.judge?.agent ?? environment.BENCH_JUDGE_AGENT ?? execution.agent,
    judgeModel:
      execution.judge?.model === 'missing'
        ? ''
        : (execution.judge?.model ?? environment.BENCH_JUDGE_MODEL ?? ''),
    judgeBaseUrl: execution.judge?.baseUrl ?? environment.BENCH_JUDGE_BASE_URL ?? '',
    skillTimeoutSeconds: skill.timeoutSeconds,
    skillMaxTurns: skill.maxTurns,
    applicationTimeoutSeconds: application.timeoutSeconds,
    applicationMaxTurns: application.maxTurns,
  };
  const warnings: string[] = [];
  for (const key of ['baseUrl', 'judgeBaseUrl', 'langsmithEndpoint', 'langfuseBaseUrl'] as const) {
    try {
      if (!defaults[key]) continue;
      const url = new URL(defaults[key]);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !['http:', 'https:'].includes(url.protocol)
      )
        throw new Error();
    } catch {
      defaults[key] = '';
      warnings.push(
        `${{ baseUrl: '执行', judgeBaseUrl: 'Judge', langsmithEndpoint: 'LangSmith', langfuseBaseUrl: 'Langfuse' }[key]}端点需要重新填写无凭据的 HTTP(S) 地址，密钥请填入独立凭据输入框。`,
      );
    }
  }
  if (redactEvalOutput(JSON.stringify(defaults), environment) !== JSON.stringify(defaults))
    throw new EvalRunError('Eval 模型与端点字段含有敏感信息，请更正用户配置');
  const overridden = (label: string, keys: string[]) => {
    const key = keys.find((key) => present(environment[key]));
    return key && present(inherited[key]) ? [label] : [];
  };
  return {
    path: filePath(),
    revision: evalValueHash(source),
    defaults,
    credentials: {
      main: credential(mainKeys),
      judge: credential(judgeKeys),
      langsmith: credential(trackingKeys.langsmith),
      langfusePublic: credential(trackingKeys.langfusePublic),
      langfuseSecret: credential(trackingKeys.langfuseSecret),
    },
    warnings,
    overrides: [
      ...overridden('执行 Agent', ['BENCH_EVAL_AGENT']),
      ...overridden('执行模型', EVAL_AGENT_ENVIRONMENT[execution.agent]?.models ?? ['BENCH_MODEL']),
      ...overridden(
        '执行端点',
        EVAL_AGENT_ENVIRONMENT[execution.agent]?.urls ?? ['BENCH_BASE_URL'],
      ),
      ...overridden('执行凭据', mainKeys),
      ...overridden('Judge 开关', ['BENCH_LLM_JUDGE']),
      ...overridden('Judge Agent', ['BENCH_JUDGE_AGENT']),
      ...overridden('Judge 模型', ['BENCH_JUDGE_MODEL']),
      ...overridden('Judge 端点', ['BENCH_JUDGE_BASE_URL']),
      ...overridden('Judge 凭据', judgeKeys),
      ...overridden('默认报告去向', ['COMET_EVAL_SUITE']),
      ...overridden('LangSmith 地址', ['LANGSMITH_ENDPOINT']),
      ...overridden('LangSmith 项目', ['LANGSMITH_PROJECT']),
      ...overridden('LangSmith 轨迹追踪', ['LANGSMITH_TRACING']),
      ...overridden('LangSmith 凭据', trackingKeys.langsmith),
      ...overridden('Langfuse 地址', ['LANGFUSE_BASE_URL']),
      ...overridden('Langfuse 环境', ['LANGFUSE_TRACING_ENVIRONMENT']),
      ...overridden('Langfuse Public key', trackingKeys.langfusePublic),
      ...overridden('Langfuse Secret key', trackingKeys.langfuseSecret),
      ...Object.entries(budgetFields).flatMap(([field, [key]]) =>
        overridden(
          (
            {
              skillTimeoutSeconds: 'Skill 默认时限',
              skillMaxTurns: 'Skill 默认轮数',
              applicationTimeoutSeconds: 'SDK 应用默认时限',
              applicationMaxTurns: 'SDK 应用默认轮数',
            } as Record<string, string>
          )[field],
          [key],
        ),
      ),
    ],
  };
}
export async function readUserEvalSettings(environment: NodeJS.ProcessEnv = process.env) {
  return describe(await readSource(), environment);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new EvalRunError('Eval 设置必须是对象');
  return value as Record<string, unknown>;
}
function validateDefaults(input: unknown): UserEvalDefaults {
  const value = object(input);
  const fields = new Set([
    'suite',
    'langsmithTracing',
    ...Object.keys(trackingFields),
    'agent',
    'model',
    'baseUrl',
    'judgeEnabled',
    'judgeAgent',
    'judgeModel',
    'judgeBaseUrl',
    ...Object.keys(budgetFields),
  ]);
  for (const key of Object.keys(value))
    if (!fields.has(key)) throw new EvalRunError('不支持的 Eval 设置字段');
  if (
    value.suite !== undefined &&
    !['local', 'langsmith', 'langfuse'].includes(String(value.suite))
  )
    throw new EvalRunError('不支持的报告去向');
  if (value.langsmithTracing !== undefined && typeof value.langsmithTracing !== 'boolean')
    throw new EvalRunError('LangSmith 轨迹追踪开关无效');
  for (const key of Object.keys(trackingFields)) {
    if (value[key] === undefined) continue;
    if (
      typeof value[key] !== 'string' ||
      (value[key] as string).length > 512 ||
      hasUnsafeCharacters(value[key] as string)
    )
      throw new EvalRunError('追踪服务设置无效');
    value[key] = (value[key] as string).trim();
  }
  for (const key of ['agent', 'judgeAgent'])
    if (typeof value[key] !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/u.test(value[key] as string))
      throw new EvalRunError('请选择有效的执行 Agent');
  for (const key of ['model', 'judgeModel', 'baseUrl', 'judgeBaseUrl']) {
    if (
      typeof value[key] !== 'string' ||
      (value[key] as string).length > 512 ||
      hasUnsafeCharacters(value[key] as string)
    )
      throw new EvalRunError('模型与端点设置无效');
    value[key] = (value[key] as string).trim();
  }
  for (const key of ['baseUrl', 'judgeBaseUrl', 'langsmithEndpoint', 'langfuseBaseUrl'])
    if (value[key]) {
      try {
        const url = new URL(value[key] as string);
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
  if (typeof value.judgeEnabled !== 'boolean') throw new EvalRunError('独立 Judge 开关无效');
  if (value.judgeEnabled && !value.judgeModel)
    throw new EvalRunError('启用独立 Judge 时须指定模型');
  for (const [field, [, , min, max]] of Object.entries(budgetFields))
    if (
      !Number.isSafeInteger(value[field]) ||
      Number(value[field]) < min ||
      Number(value[field]) > max
    )
      throw new EvalRunError(
        `${field.includes('Turns') ? '默认执行轮数' : '默认时限'}须为 ${min}–${max}`,
      );
  return value as unknown as UserEvalDefaults;
}
export async function saveUserEvalSettings(
  input: unknown,
  inherited: NodeJS.ProcessEnv = process.env,
) {
  const body = object(input);
  for (const key of Object.keys(body))
    if (!['defaults', 'credentials', 'expectedRevision'].includes(key))
      throw new EvalRunError('不支持的 Eval 设置字段');
  if (typeof body.expectedRevision !== 'string') throw new EvalRunError('请先读取当前 Eval 设置');
  const defaults = validateDefaults(body.defaults);
  const changes = new Map<string, string | null>();
  if (defaults.suite !== undefined) changes.set('COMET_EVAL_SUITE', defaults.suite);
  if (defaults.langsmithTracing !== undefined)
    changes.set('LANGSMITH_TRACING', defaults.langsmithTracing ? 'true' : 'false');
  for (const [field, key] of Object.entries(trackingFields)) {
    const value = defaults[field as keyof typeof trackingFields];
    if (value !== undefined) changes.set(key, value || null);
  }
  changes.set('BENCH_EVAL_AGENT', defaults.agent);
  for (const key of EVAL_AGENT_ENVIRONMENT[defaults.agent]?.models ?? ['BENCH_MODEL'])
    changes.set(key, null);
  for (const key of EVAL_AGENT_ENVIRONMENT[defaults.agent]?.urls ?? ['BENCH_BASE_URL'])
    changes.set(key, null);
  changes.set(
    EVAL_AGENT_ENVIRONMENT[defaults.agent]?.models[0] ?? 'BENCH_MODEL',
    defaults.model || null,
  );
  changes.set(
    EVAL_AGENT_ENVIRONMENT[defaults.agent]?.urls[0] ?? 'BENCH_BASE_URL',
    defaults.baseUrl || null,
  );
  changes.set('BENCH_LLM_JUDGE', defaults.judgeEnabled ? '1' : '0');
  changes.set('BENCH_JUDGE_AGENT', defaults.judgeAgent);
  changes.set('BENCH_JUDGE_MODEL', defaults.judgeModel || null);
  changes.set('BENCH_JUDGE_BASE_URL', defaults.judgeBaseUrl || null);
  for (const [field, [key]] of Object.entries(budgetFields))
    changes.set(key, String(defaults[field as keyof UserEvalDefaults]));
  const credentials = body.credentials === undefined ? {} : object(body.credentials);
  for (const [slot, patch] of Object.entries(credentials)) {
    if (!['main', 'judge', ...Object.keys(trackingKeys)].includes(slot))
      throw new EvalRunError('不支持的凭据字段');
    const keys =
      slot === 'main'
        ? (EVAL_AGENT_ENVIRONMENT[defaults.agent]?.credentials ?? ['BENCH_API_KEY'])
        : slot === 'judge'
          ? judgeKeys
          : trackingKeys[slot as keyof typeof trackingKeys];
    if (patch !== null) {
      const value = object(patch);
      if (Object.hasOwn(trackingKeys, slot) && value.kind !== 'api-key')
        throw new EvalRunError('追踪服务请使用 API key');
      if (
        Object.keys(value).some((key) => !['value', 'kind'].includes(key)) ||
        typeof value.value !== 'string' ||
        !value.value.trim() ||
        value.value.length > 8192 ||
        hasUnsafeCharacters(value.value) ||
        !['api-key', 'auth-token'].includes(String(value.kind))
      )
        throw new EvalRunError('凭据无效，不能包含换行、控制字符或引号');
      if (
        slot === 'main' &&
        value.kind === 'auth-token' &&
        !['claude-code', 'codebuddy'].includes(defaults.agent)
      )
        throw new EvalRunError('此执行 Agent 请使用 API key');
      for (const key of keys) changes.set(key, null);
      changes.set(
        slot === 'main'
          ? value.kind === 'auth-token'
            ? defaults.agent === 'codebuddy'
              ? 'CODEBUDDY_AUTH_TOKEN'
              : 'ANTHROPIC_AUTH_TOKEN'
            : 'BENCH_API_KEY'
          : slot !== 'judge'
            ? keys[0]
            : value.kind === 'auth-token'
              ? 'BENCH_JUDGE_AUTH_TOKEN'
              : 'BENCH_JUDGE_API_KEY',
        value.value.trim(),
      );
    } else for (const key of keys) changes.set(key, null);
  }
  const file = filePath();
  const parent = path.dirname(file);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  if (!isPathWithin(await fs.realpath(os.homedir()), await fs.realpath(parent)))
    throw new EvalRunError('Eval 用户配置目录不能引用用户目录以外的位置');
  return withRecoverableFileLock(`${file}.lock`, async () => {
    const source = await readSource();
    if (evalValueHash(source) !== body.expectedRevision)
      throw new EvalRunError('Eval 设置已变化，请重新读取后保存', 409);
    const secretEnvironment = fileValues(source);
    for (const [key, value] of Object.entries(inherited))
      if (present(value)) secretEnvironment[key] = value;
    for (const [key, value] of changes)
      if (value !== null && /KEY|TOKEN/u.test(key)) secretEnvironment[key] = value;
    secretEnvironment.COMET_EVAL_CUSTOM_CREDENTIALS = [
      secretEnvironment.COMET_EVAL_CUSTOM_CREDENTIALS,
      ...(EVAL_AGENT_ENVIRONMENT[defaults.agent]?.credentials ?? ['BENCH_API_KEY']),
      ...judgeKeys,
      ...Object.values(trackingKeys).flat(),
    ]
      .filter(Boolean)
      .join(',');
    if (redactEvalOutput(JSON.stringify(defaults), secretEnvironment) !== JSON.stringify(defaults))
      throw new EvalRunError('模型与端点字段不能包含凭据');
    const lines = source.split(/\r?\n/u).filter((line) => {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line);
      return !match || !changes.has(match[1]);
    });
    while (lines.at(-1) === '') lines.pop();
    const updated = [
      ...lines,
      ...[...changes]
        .filter(([, value]) => value !== null)
        .map(([key, value]) => `${key}='${value}'`),
      '',
    ].join('\n');
    if (Buffer.byteLength(updated) > 1024 * 1024)
      throw new EvalRunError('Eval 用户配置不能超过 1 MiB');
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, updated, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, file);
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
    return describe(updated, inherited);
  });
}
