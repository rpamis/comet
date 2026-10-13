import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';
import { isPathWithin } from './standalone-context.js';
import {
  listEvalArchives,
  archiveEvalDetail,
  archiveEvalError,
  readArchivedEvalRun,
  readEvalArchive,
  readEvalArchiveFile,
  isEvalArchiveRunId,
} from './eval-archives.js';
import type {
  EvalCaseResult,
  EvalManagedRun,
  EvalRunComparison,
  EvalRunDetail,
} from './eval-run-types.js';

type Json = Record<string, unknown>;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
export class EvalRunError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'EvalRunError';
  }
}
export function validateEvalRunId(id: string): void {
  if (!RUN_ID.test(id)) throw new EvalRunError('无效的 Eval 运行身份');
}
export function evalValueHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
/** All persisted paths belong to the selected workspace; links outside it are rejected. */
export async function evalStoragePath(projectRoot: string, ...segments: string[]): Promise<string> {
  const project = await fs.realpath(projectRoot);
  const target = path.resolve(project, '.comet', 'eval', ...segments);
  if (!isPathWithin(path.join(project, '.comet', 'eval'), target))
    throw new EvalRunError('Eval 路径越界');
  let parent = target;
  for (;;) {
    try {
      const actual = await fs.realpath(parent);
      if (!isPathWithin(project, actual))
        throw new EvalRunError('Eval 目录不能引用当前工作区以外的路径');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const next = path.dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
  return target;
}
export async function evalRunPath(
  project: string,
  id: string,
  ...segments: string[]
): Promise<string> {
  validateEvalRunId(id);
  const root = await evalStoragePath(project, 'runs', id);
  const target = path.resolve(root, ...segments);
  if (!isPathWithin(root, target)) throw new EvalRunError('运行产物路径越界');
  return evalStoragePath(project, 'runs', id, ...segments);
}
export async function readEvalJson(file: string): Promise<Json | null> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_JSON_BYTES)
      throw new EvalRunError('Eval JSON 超过读取限制');
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export async function writeEvalJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}
const object = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;
const sumKnown = (values: Array<number | null>): number | null =>
  values.some((value) => value !== null)
    ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
export function redactEvalOutput(
  value: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  let result = value
    .replace(/(Bearer\s+)[^\s"']+/giu, '$1[redacted]')
    .replace(
      /((?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*["']?)[^\s"',}]+/giu,
      '$1[redacted]',
    );
  const declaredCredentials = new Set(
    [environment.COMET_EVAL_CUSTOM_CREDENTIALS, environment.COMET_EVAL_MAIN_CREDENTIALS]
      .flatMap((value) => (value ?? '').split(','))
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const [key, secret] of Object.entries(environment)) {
    if (
      secret &&
      (declaredCredentials.has(key) ||
        (/(?:KEY|TOKEN|SECRET|PASSWORD)$/u.test(key) && secret.length >= 8))
    )
      result = result.split(secret).join('[redacted]');
  }
  return result;
}
function normalizeCase(id: string, raw: Json, root: string): EvalCaseResult {
  const events = object(raw.events_summary);
  const manifest = object(events.case_manifest);
  const quality = object(raw.sample_quality ?? events.sample_quality);
  const status =
    quality.status === 'included' || quality.status === 'flagged' || quality.status === 'excluded'
      ? quality.status
      : 'unknown';
  const scores: Record<string, number | null> = {};
  const scoreSources: EvalCaseResult['scoreSources'] = {};
  const checksPassed = strings(raw.checks_passed).map((value) => redactEvalOutput(value));
  const checksFailed = strings(raw.checks_failed).map((value) => redactEvalOutput(value));
  for (const check of [...checksPassed, ...checksFailed]) {
    const match = /^\[RUBRIC(-JUDGE)?\]\s+([\w-]+):\s+(N\/A|[\d.]+)/u.exec(check);
    if (match) {
      scores[match[2]] = match[3] === 'N/A' ? null : number(Number(match[3]));
      scoreSources[match[2]] = match[1] ? 'judge' : 'check';
    }
  }
  const artifacts: EvalCaseResult['artifacts'] = [];
  for (const [label, reference] of Object.entries(object(events.artifact_references))) {
    if (typeof reference !== 'string') continue;
    const target = path.isAbsolute(reference)
      ? path.resolve(reference)
      : path.resolve(root, reference);
    if (isPathWithin(root, target) && label !== 'artifacts')
      artifacts.push({ id: path.relative(root, target).split(path.sep).join('/'), label });
  }
  return {
    id,
    task: text(events.task) ?? text(raw.name) ?? id,
    prompt: text(events.prompt) ? redactEvalOutput(String(events.prompt)) : null,
    finalResponse: text(events.final_response)
      ? redactEvalOutput(String(events.final_response))
      : null,
    treatment: text(events.treatment) ?? text(raw.name) ?? '',
    repetition: number(raw.rep) ?? 1,
    passed: typeof raw.passed === 'boolean' ? raw.passed : null,
    quality: status,
    qualityReason: text(quality.reason) ? redactEvalOutput(String(quality.reason)) : null,
    checksPassed,
    checksFailed,
    scores,
    scoreSources,
    failureAttribution: Array.isArray(events.failure_attribution)
      ? events.failure_attribution
          .filter(
            (item: unknown) =>
              typeof object(item).bucket === 'string' && typeof object(item).check === 'string',
          )
          .map((item: Json) => ({
            bucket: String(item.bucket),
            check: redactEvalOutput(String(item.check)),
            ...(text(item.reason) ? { reason: redactEvalOutput(String(item.reason)) } : {}),
          }))
      : [],
    durationSeconds: number(events.duration_seconds),
    tokens: number(events.total_tokens),
    costUsd: number(events.total_cost_usd),
    model:
      text(object(events.role_models).subject) ??
      text(object(events.execution_identity).model) ??
      Object.keys(object(events.model_usage))[0] ??
      null,
    agent: text(object(events.role_agents).subject) ?? text(events.agent),
    caseHash: text(manifest.task_hash)
      ? evalValueHash([
          manifest.task_hash,
          manifest.instruction_hash,
          manifest.environment_hash,
          manifest.data_hash,
        ])
      : text(manifest.case_hash),
    validatorHash: text(manifest.validator_hash),
    artifacts,
  };
}
async function optionalJson(
  project: string,
  id: string,
  name: string,
  diagnostics: string[],
): Promise<Json | null> {
  try {
    return await readEvalJson(await evalRunPath(project, id, name));
  } catch (error) {
    diagnostics.push(`${name}：${(error as Error).message}`);
    return null;
  }
}
async function baselineMap(project: string): Promise<Record<string, string>> {
  const data = await readEvalJson(await evalStoragePath(project, 'baselines.json'));
  return data?.schema === 'comet.eval.baselines.v1'
    ? (object(data.baselines) as Record<string, string>)
    : {};
}
function normalizeProgress(value: Json | null, id: string): EvalRunDetail['progress'] {
  const phases = ['preparing', 'generating', 'running', 'judging', 'finalizing'] as const;
  const phase = phases.find((item) => item === value?.phase);
  if (value?.schema !== 'comet.eval.progress.v1' || value.runId !== id || !phase) return null;
  const timestamp = (input: unknown): string | null =>
    typeof input === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/u.test(input) &&
    Number.isFinite(Date.parse(input))
      ? input
      : null;
  const clean = (input: unknown, limit: number): string | null =>
    typeof input === 'string' && input.trim()
      ? redactEvalOutput(input).replace(/\s+/gu, ' ').slice(0, limit)
      : null;
  const current = object(value.currentCase);
  const task = clean(current.task, 128);
  const activities: NonNullable<EvalRunDetail['progress']>['activities'] = [];
  for (const item of (Array.isArray(value.activities) ? value.activities : []).slice(-3)) {
    const activity = object(item);
    const kind = ['phase', 'model', 'tool'].find((entry) => entry === activity.kind);
    const at = timestamp(activity.at);
    const message = clean(activity.message, 180);
    const activityId = clean(activity.id, 180);
    if (kind && at && message && activityId)
      activities.push({ id: activityId, at, message, kind: kind as 'phase' | 'model' | 'tool' });
  }
  return {
    phase,
    updatedAt: timestamp(value.updatedAt),
    lastEventAt: timestamp(value.lastEventAt),
    currentCase: task
      ? {
          task,
          treatment: clean(current.treatment, 128),
          repetition:
            Number.isSafeInteger(current.repetition) && Number(current.repetition) > 0
              ? Number(current.repetition)
              : 1,
        }
      : null,
    activities,
  };
}
export async function readEvalRun(project: string, id: string): Promise<EvalRunDetail> {
  const archived = await readArchivedEvalRun(project, id);
  if (archived) return archived;
  const root = await evalRunPath(project, id);
  try {
    if (!(await fs.stat(root)).isDirectory()) throw new Error();
  } catch {
    throw new EvalRunError('Eval 运行不存在', 404);
  }
  const diagnostics: string[] = [];
  const [metadata, application, record, matrix, progress] = await Promise.all([
    optionalJson(project, id, 'metadata.json', diagnostics),
    optionalJson(project, id, 'application-result.json', diagnostics),
    optionalJson(project, id, 'dashboard-run.json', diagnostics),
    optionalJson(project, id, 'expected-case-matrix.json', diagnostics),
    optionalJson(project, id, 'progress.json', diagnostics),
  ]);
  const managed =
    record?.schema === 'comet.eval.managed-run.v1' ? (record as unknown as EvalManagedRun) : null;
  const entries = await fs.readdir(path.join(root, 'reports')).catch(() => [] as string[]);
  const cases: EvalCaseResult[] = [];
  let firstReport: Json | null = null;
  for (const file of entries
    .filter((file) => /^[\w.-]+_report\.json$/u.test(file))
    .sort()
    .slice(0, 2000)) {
    const raw = await optionalJson(project, id, `reports/${file}`, diagnostics);
    if (raw) {
      firstReport ??= raw;
      cases.push(normalizeCase(file, raw, root));
    }
  }
  const events = object(firstReport?.events_summary);
  const source = object(Array.isArray(events.skill_sources) ? events.skill_sources[0] : null);
  const app = object(application?.application);
  const config = managed?.config ?? {
    target: text(source.path) ?? undefined,
    agent: cases[0]?.agent ?? undefined,
    model: cases[0]?.model ?? undefined,
    ...(application?.settings ?? {}),
  };
  const targetType = text(app.id)
    ? 'application'
    : text(source.name) || managed?.config.targetType === 'skill'
      ? 'skill'
      : managed?.config.targetType === 'application'
        ? 'application'
        : 'unknown';
  const targetId =
    managed?.targetId ?? text(app.id) ?? text(source.path) ?? text(source.name) ?? id;
  const expectedTotal =
    number(object(metadata?.expected_case_matrix).case_count) ??
    number(matrix?.case_count) ??
    (Array.isArray(matrix?.cases) ? matrix!.cases.length : null);
  const completedAt = text(metadata?.completed_at);
  const executionStatus =
    managed?.status ?? (completedAt ? 'completed' : application?.status ? 'completed' : 'unknown');
  const complete =
    cases.length > 0 &&
    cases.every((item) => item.passed !== null) &&
    expectedTotal !== null &&
    cases.length === expectedTotal;
  const excluded = cases.some((item) => item.quality === 'excluded');
  let conclusion: EvalRunDetail['conclusion'] = 'incomplete';
  if (executionStatus === 'completed' && !excluded) {
    if (
      application &&
      (application.status === 'passed' ||
        application.status === 'failed' ||
        application.status === 'incomplete')
    )
      conclusion = application.status;
    else if (complete) conclusion = cases.every((item) => item.passed) ? 'passed' : 'failed';
  }
  if (managed?.config.retrySourceRunId && executionStatus === 'completed' && complete && !excluded)
    conclusion = cases.every((item) => item.passed) ? 'passed' : 'failed';
  const baselineScope =
    cases.length && cases.every((item) => item.caseHash && item.validatorHash)
      ? evalValueHash([
          targetId,
          cases
            .map((item) => [
              item.task,
              item.treatment.replace(/-r\d+$/u, ''),
              item.repetition,
              item.caseHash,
              item.validatorHash,
            ])
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        ])
      : null;
  const baselineDisabledReason = managed?.config.retrySourceRunId
    ? '此记录仅包含失败用例重跑，不能作为完整评估基线'
    : executionStatus !== 'completed'
      ? '运行尚未完整结束'
      : conclusion === 'incomplete'
        ? '结果不完整或存在环境异常'
        : cases.some((item) => item.quality !== 'included')
          ? '样本质量有风险标记或缺少有效证据'
          : !baselineScope
            ? '缺少固定用例与评分规则身份'
            : null;
  const baselines = await baselineMap(project);
  const baselineRunId = baselineScope ? text(baselines[baselineScope]) : null;
  const artifacts: EvalRunDetail['artifacts'] = [];
  for (const [name, format] of [
    ['summary.md', 'markdown'],
    ['summary.html', 'html'],
    ['application-result.json', 'json'],
    ['metadata.json', 'json'],
    ['execution.log', 'text'],
  ] as const) {
    if (
      await fs
        .stat(await evalRunPath(project, id, name))
        .then((stat) => stat.isFile())
        .catch(() => false)
    )
      artifacts.push({ id: name, label: name, format });
  }
  const knownCostUsd = sumKnown(cases.map((item) => item.costUsd));
  return {
    id,
    origin: managed?.origin ?? (metadata ? 'cli' : 'history'),
    createdAt: managed?.createdAt ?? text(metadata?.started_at),
    completedAt,
    executionStatus,
    conclusion,
    target: {
      id: targetId,
      name:
        text(app.id) ??
        text(source.name) ??
        (config.target && path.basename(config.target) === 'SKILL.md'
          ? path.basename(path.dirname(config.target))
          : path.basename(config.target ?? id)),
      type: targetType,
      version: text(app.version),
      path: text(config.target) ?? text(source.path),
      contentHash: managed?.contentHash ?? text(app.contentHash) ?? text(source.hash),
    },
    config,
    passed: cases.filter((item) => item.passed === true && item.quality !== 'excluded').length,
    total: cases.length,
    expectedTotal,
    cases,
    progress: normalizeProgress(progress, id),
    metrics: {
      durationSeconds: sumKnown(cases.map((item) => item.durationSeconds)),
      tokens: sumKnown(cases.map((item) => item.tokens)),
      knownCostUsd,
      costStatus:
        knownCostUsd === null
          ? 'unavailable'
          : cases.every((item) => item.costUsd !== null)
            ? 'case-costs-only'
            : 'partial',
      generationCostUsd: number(object(metadata?.generation_overhead).total_cost_usd),
    },
    coverage: application
      ? {
          executedSteps: strings(application.executedSteps),
          coveredSteps: strings(application.coveredSteps),
          uncoveredSteps: strings(application.uncoveredSteps),
          coveredChoices: strings(application.coveredChoices),
          uncoveredChoices: strings(application.uncoveredChoices),
          recoveredActions: strings(application.recoveredActions),
          actualModels: strings(application.actualModels),
        }
      : null,
    limitations: strings(application?.limitations),
    failures: [...strings(application?.failures), ...(managed?.error ? [managed.error] : [])],
    artifacts,
    baselineScope,
    baselineRunId,
    boundBaselineRunId: managed?.baselineRunId ?? null,
    isBaseline: baselineRunId === id,
    baselineEligible: baselineDisabledReason === null,
    baselineDisabledReason,
    availableActions: {
      stop: !!managed?.owner && !['completed', 'stopped', 'interrupted'].includes(executionStatus),
      rerun:
        ['completed', 'stopped', 'interrupted', 'unknown'].includes(executionStatus) &&
        !!config.target,
      setBaseline: baselineDisabledReason === null,
      compare:
        !managed?.config.retrySourceRunId && conclusion !== 'incomplete' && baselineScope !== null,
    },
    stale: null,
    diagnostics,
  };
}
export async function listEvalRuns(project: string): Promise<EvalRunDetail[]> {
  const root = await evalStoragePath(project, 'runs');
  const entries = await fs
    .readdir(root, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
  const runs: EvalRunDetail[] = [];
  const archives = await listEvalArchives(project);
  runs.push(...archives.items.map((item) => archiveEvalDetail(item.archive)));
  runs.push(...archives.errors.map((e) => archiveEvalError(e.id, e.message)));
  for (const entry of entries.filter((entry) => entry.isDirectory() && RUN_ID.test(entry.name))) {
    runs.push(await readEvalRun(project, entry.name));
  }
  return runs.sort(
    (a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id.localeCompare(a.id),
  );
}
export async function setEvalBaseline(
  project: string,
  id: string,
  expectedPrevious?: string,
): Promise<EvalRunDetail> {
  if ((await readArchivedEvalRun(project, id))?.archiveId)
    throw new EvalRunError('历史归档只读，不能设置基线', 409);
  const file = await evalStoragePath(project, 'baselines.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await withRecoverableFileLock(`${file}.lock`, async () => {
    const run = await readEvalRun(project, id);
    if (!run.baselineEligible || !run.baselineScope)
      throw new EvalRunError(run.baselineDisabledReason ?? '结果不完整');
    const baselines = await baselineMap(project);
    const old = baselines[run.baselineScope];
    if (old && old !== id && expectedPrevious !== old)
      throw new EvalRunError('替换基线需要确认当前旧基线', 409);
    if (expectedPrevious !== undefined && old !== expectedPrevious)
      throw new EvalRunError('基线已变化，请重新确认', 409);
    baselines[run.baselineScope] = id;
    await writeEvalJson(file, { schema: 'comet.eval.baselines.v1', baselines });
  });
  return readEvalRun(project, id);
}
export async function clearEvalBaseline(project: string, id: string): Promise<EvalRunDetail> {
  if ((await readArchivedEvalRun(project, id))?.archiveId)
    throw new EvalRunError('历史归档只读，不能清除基线', 409);
  const file = await evalStoragePath(project, 'baselines.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await withRecoverableFileLock(`${file}.lock`, async () => {
    const run = await readEvalRun(project, id);
    const baselines = await baselineMap(project);
    if (!run.baselineScope || baselines[run.baselineScope] !== id)
      throw new EvalRunError('默认基线已变化，请刷新后重新确认', 409);
    delete baselines[run.baselineScope];
    await writeEvalJson(file, { schema: 'comet.eval.baselines.v1', baselines });
  });
  return readEvalRun(project, id);
}
export async function compareEvalRuns(
  project: string,
  candidateId: string,
  baselineId: string,
): Promise<EvalRunComparison> {
  const [candidate, baseline] = await Promise.all([
    readEvalRun(project, candidateId),
    readEvalRun(project, baselineId),
  ]);
  const reasons: string[] = [];
  if (candidateId === baselineId) reasons.push('不能与自身比较');
  if (!candidate.baselineScope || candidate.baselineScope !== baseline.baselineScope)
    reasons.push('目标、固定用例或评分规则不一致');
  if (!baseline.baselineEligible || candidate.conclusion === 'incomplete')
    reasons.push('对比需要完整且有效的结果');
  const configurationChanges = [
    'agent',
    'model',
    'baseUrl',
    'judgeEnabled',
    'judgeAgent',
    'judgeModel',
    'judgeBaseUrl',
    'suite',
    'profile',
    'quick',
    'task',
    'timeoutSeconds',
    'maxTurns',
  ]
    .filter((field) => (baseline.config as Json)[field] !== (candidate.config as Json)[field])
    .map((field) => ({
      field,
      baseline: (baseline.config as Json)[field] ?? null,
      candidate: (candidate.config as Json)[field] ?? null,
    }));
  if (candidate.target.contentHash !== baseline.target.contentHash)
    configurationChanges.push({
      field: 'contentHash',
      baseline: baseline.target.contentHash,
      candidate: candidate.target.contentHash,
    });
  if (candidate.target.version !== baseline.target.version)
    configurationChanges.push({
      field: 'version',
      baseline: baseline.target.version,
      candidate: candidate.target.version,
    });
  const cases: EvalRunComparison['cases'] = candidate.cases.map((item) => {
    const other = baseline.cases.find(
      (other) =>
        other.task === item.task &&
        other.treatment === item.treatment &&
        other.repetition === item.repetition,
    );
    return {
      task: item.task,
      repetition: item.repetition,
      baseline: other?.passed ?? null,
      candidate: item.passed,
      change: !other
        ? 'unmatched'
        : other.passed === item.passed
          ? 'unchanged'
          : item.passed
            ? 'improved'
            : 'regressed',
    };
  });
  return {
    comparable: reasons.length === 0,
    reasons,
    baseline,
    candidate,
    configurationChanges,
    cases,
    improved: reasons.length ? 0 : cases.filter((item) => item.change === 'improved').length,
    regressed: reasons.length ? 0 : cases.filter((item) => item.change === 'regressed').length,
    unchanged: reasons.length ? 0 : cases.filter((item) => item.change === 'unchanged').length,
  };
}
export async function readEvalArtifact(
  project: string,
  id: string,
  artifactId: string,
  options: { tail?: boolean } = {},
): Promise<{
  content: string;
  format: 'markdown' | 'html' | 'json' | 'text';
  truncated?: boolean;
}> {
  if (isEvalArchiveRunId(id)) {
    if (options.tail) throw new EvalRunError('历史归档不支持末尾预览');
    const { archive } = await readEvalArchive(project, id.slice('archive-'.length));
    const report = archive.reports.find((r) => r.path === artifactId);
    if (!report) throw new EvalRunError('归档没有这个报告', 404);
    const bytes = await readEvalArchiveFile(project, archive, report.path);
    if (bytes.length > 4 * 1024 * 1024) throw new EvalRunError('产物超过预览限制', 413);
    return {
      content: redactEvalOutput(bytes.toString('utf8')),
      format: report.path.endsWith('.md')
        ? 'markdown'
        : report.path.endsWith('.json')
          ? 'json'
          : 'text',
    };
  }
  if (
    !/^(?:summary\.(?:md|html)|(?:application-result|metadata)\.json|execution\.log|(?:reports|events|raw)\/[\w.-]+\.(?:json|txt))$/u.test(
      artifactId,
    )
  )
    throw new EvalRunError('无效的 Eval 产物身份');
  const file = await evalRunPath(project, id, artifactId);
  const stat = await fs.stat(file).catch(() => {
    throw new EvalRunError('产物不存在', 404);
  });
  if (options.tail && artifactId !== 'execution.log')
    throw new EvalRunError('仅执行日志支持末尾预览');
  if (!stat.isFile() || (!options.tail && stat.size > 4 * 1024 * 1024))
    throw new EvalRunError('产物超过预览限制；请从运行目录查看', 413);
  if (options.tail) {
    const size = Math.min(stat.size, 256 * 1024);
    const start = stat.size - size;
    const handle = await fs.open(file, 'r');
    try {
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, start);
      let content = buffer.subarray(0, bytesRead).toString('utf8');
      if (start > 0) {
        const newline = content.indexOf('\n');
        content = newline >= 0 ? content.slice(newline + 1) : '';
      }
      return { content: redactEvalOutput(content), format: 'text', truncated: start > 0 };
    } finally {
      await handle.close();
    }
  }
  const content = redactEvalOutput(await fs.readFile(file, 'utf8'));
  return {
    content,
    format: file.endsWith('.md')
      ? 'markdown'
      : file.endsWith('.html')
        ? 'html'
        : file.endsWith('.json')
          ? 'json'
          : 'text',
  };
}
