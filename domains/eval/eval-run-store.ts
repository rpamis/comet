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

import { validateApplicationEvaluationCompletion } from '../workflow-application/index.js';
import { evalRubricScores } from './eval-score-adapter.js';
import { parseEvaluationMatrix, validateEvaluationCase } from '../workflow-application/index.js';

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
/** Eval 存储路径固定在当前工作区，拒绝符号链接串用其他运行的证据。 */
export async function evalStoragePath(projectRoot: string, ...segments: string[]): Promise<string> {
  const project = await fs.realpath(projectRoot);
  const target = path.resolve(project, '.comet', 'eval', ...segments);
  if (!isPathWithin(path.join(project, '.comet', 'eval'), target))
    throw new EvalRunError('Eval 路径越界');
  let current = project;
  for (const segment of path.relative(project, target).split(path.sep)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new EvalRunError('Eval 路径不允许符号链接');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
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
  const root = path.resolve(project, '.comet', 'eval', 'runs', id);
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
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new EvalRunError('Eval JSON 必须为对象');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
/** 摘要解析失败仍绑定原始字节，不能把两个不同坏 JSON 都当成 null。 */
export async function readEvalEvidenceRevision(project: string, id: string): Promise<string> {
  const hash = createHash('sha256');
  for (const name of [
    'metadata.json',
    'application-result.json',
    'dashboard-run.json',
    'expected-case-matrix.json',
    'execution-state.json',
    'report-generation.json',
  ]) {
    hash.update(name + '\0');
    const file = await evalRunPath(project, id, name);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_JSON_BYTES) {
        hash.update(JSON.stringify([stat.size, stat.mtimeMs, stat.ctimeMs]));
        continue;
      }
      hash.update(await fs.readFile(file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      hash.update('missing');
    }
  }
  const reports = await evalRunPath(project, id, 'reports');
  for (const name of (
    await fs.readdir(reports).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    })
  )
    .filter((name) => name.endsWith('_report.json'))
    .sort()) {
    const stat = await fs.lstat(await evalRunPath(project, id, 'reports', name));
    hash.update(JSON.stringify([name, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]));
  }
  return hash.digest('hex');
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
function validExpectedMatrix(matrix: Json, declaredHash: unknown): boolean {
  try {
    parseEvaluationMatrix(matrix, declaredHash);
    return true;
  } catch {
    return false;
  }
}

// 强制复制摘录，避免 V8 的切片字符串继续持有整份大输入。
const excerpt = (value: string, limit: number): string =>
  Buffer.from(value.slice(0, limit)).toString('utf8');
function summarySource(events: Json): Json {
  const source = object(Array.isArray(events.skill_sources) ? events.skill_sources[0] : null);
  return Object.fromEntries(
    ['path', 'name', 'hash'].map((key) => [
      key,
      text(source[key]) ? excerpt(String(source[key]), 2048) : null,
    ]),
  );
}
function normalizeCase(id: string, raw: Json, root: string, includeContent = true): EvalCaseResult {
  const events = object(raw.events_summary);
  const manifest = object(events.case_manifest);
  const quality = object(raw.sample_quality ?? events.sample_quality);
  const status =
    quality.status === 'included' || quality.status === 'flagged' || quality.status === 'excluded'
      ? quality.status
      : 'unknown';
  const checksPassed = strings(raw.checks_passed).map((value) => redactEvalOutput(value));
  const checksFailed = strings(raw.checks_failed).map((value) => redactEvalOutput(value));
  const { scores, scoreSources } = evalRubricScores(checksPassed, checksFailed);
  const artifacts: EvalCaseResult['artifacts'] = [];
  for (const [label, reference] of Object.entries(object(events.artifact_references))) {
    if (typeof reference !== 'string') continue;
    const target = path.isAbsolute(reference)
      ? path.resolve(reference)
      : path.resolve(root, reference);
    if (isPathWithin(root, target) && label !== 'artifacts')
      artifacts.push({ id: path.relative(root, target).split(path.sep).join('/'), label });
  }
  const item: EvalCaseResult = {
    id,
    task: text(events.task) ?? text(raw.name) ?? id,
    prompt: text(events.prompt) ? redactEvalOutput(String(events.prompt)) : null,
    finalResponse:
      includeContent && text(events.final_response)
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
  item.task = excerpt(item.task, 1024);
  item.treatment = excerpt(item.treatment, 1024);
  if (item.caseHash && item.caseHash.length > 1024) item.caseHash = evalValueHash(item.caseHash);
  if (item.validatorHash && item.validatorHash.length > 1024)
    item.validatorHash = evalValueHash(item.validatorHash);
  if (includeContent) return item;
  // 列表和图表只保留有界摘录；完整输入、回答和检查证据由单用例接口读取。
  const clip = (value: string | null) => (value === null ? null : excerpt(value, 1024));
  return {
    ...item,
    task: excerpt(item.task, 1024),
    treatment: excerpt(item.treatment, 1024),
    prompt: clip(item.prompt),
    finalResponse: null,
    qualityReason: clip(item.qualityReason),
    model: clip(item.model),
    agent: clip(item.agent),
    checksPassed: item.checksPassed.slice(0, 100).map((value) => excerpt(value, 1024)),
    checksFailed: item.checksFailed.slice(0, 100).map((value) => excerpt(value, 1024)),
    failureAttribution: item.failureAttribution.slice(0, 100).map((value) => ({
      bucket: excerpt(value.bucket, 128),
      check: excerpt(value.check, 1024),
      ...(value.reason ? { reason: excerpt(value.reason, 1024) } : {}),
    })),
    scores: Object.fromEntries(
      Object.entries(item.scores).map(([key, value]) => [excerpt(key, 128), value]),
    ),
    scoreSources: Object.fromEntries(
      Object.entries(item.scoreSources).map(([key, value]) => [excerpt(key, 128), value]),
    ),
    artifacts: item.artifacts
      .slice(0, 100)
      .map((value) => ({ id: excerpt(value.id, 2048), label: excerpt(value.label, 128) })),
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
async function readRunJsonFiles(
  project: string,
  id: string,
  names: readonly string[],
  diagnostics: string[],
): Promise<Array<Json | null>> {
  const values: Array<Json | null> = [];
  // 每个文件仍完整校验路径；并发读取只共享顺序，不复用安全检查结果。
  for (let offset = 0; offset < names.length; offset += 4) {
    const batch = await Promise.all(
      names.slice(offset, offset + 4).map(async (name) => {
        const messages: string[] = [];
        const value = await optionalJson(project, id, name, messages);
        return { value, messages };
      }),
    );
    for (const result of batch) {
      values.push(result.value);
      diagnostics.push(...result.messages);
    }
  }
  return values;
}

async function baselineMap(project: string): Promise<Record<string, string>> {
  const data = await readEvalJson(await evalStoragePath(project, 'baselines.json'));
  return data?.schema === 'comet.eval.baselines.v1'
    ? (object(data.baselines) as Record<string, string>)
    : {};
}

export async function readEvalBaselines(project: string): Promise<Record<string, string>> {
  return baselineMap(project);
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
// 缓存仅保存规范化摘要，按文件身份失效；正文始终由详情入口按需读取。
const caseSummaries = new Map<
  string,
  { stamp: string; item: EvalCaseResult; source: Json; bytes: number }
>();
let caseSummaryBytes = 0;
function cacheCaseSummary(
  key: string,
  value: { stamp: string; item: EvalCaseResult; source: Json },
) {
  const previous = caseSummaries.get(key);
  if (previous) {
    caseSummaryBytes -= previous.bytes;
    caseSummaries.delete(key);
  }
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes > 256 * 1024) return;
  caseSummaries.set(key, { ...value, bytes });
  caseSummaryBytes += bytes;
  while (caseSummaryBytes > 16 * 1024 * 1024 || caseSummaries.size > 10000) {
    const key = caseSummaries.keys().next().value!;
    caseSummaryBytes -= caseSummaries.get(key)!.bytes;
    caseSummaries.delete(key);
  }
}
type SummaryEntry = { stamp: string; item: EvalCaseResult; source: Json; bytes: number };
// FIFO 仅保留两个活动读取器，各自预留 32MiB。排队运行不能挤掉未完成读取进度。
const evidenceQueue = new Set<string>();
const evidenceReaders = new Map<
  string,
  {
    entries: Map<string, SummaryEntry>;
    errors: Map<string, { stamp: string; messages: string[] }>;
    bytes: number;
  }
>();
async function evidenceReader(root: string) {
  for (const key of evidenceReaders.keys()) {
    if (!(await fs.stat(key).catch(() => null))?.isDirectory()) forgetEvalEvidenceReader(key);
  }
  evidenceQueue.add(root);
  for (const key of evidenceQueue) {
    if (evidenceReaders.size >= 2) break;
    if (!evidenceReaders.has(key))
      evidenceReaders.set(key, { entries: new Map(), errors: new Map(), bytes: 0 });
  }
  return evidenceReaders.get(root);
}
export function forgetEvalEvidenceReader(root: string) {
  evidenceQueue.delete(root);
  evidenceReaders.delete(root);
}
export interface EvalReadOptions {
  includeCaseContent?: boolean;
  resumable?: boolean;
  maxReportBytes?: number;
  maxReadMs?: number;
}
export async function readEvalRun(
  project: string,
  id: string,
  options: EvalReadOptions = {},
): Promise<EvalRunDetail> {
  const archived = await readArchivedEvalRun(project, id);
  if (archived) return archived;
  const root = await evalRunPath(project, id);
  try {
    if (!(await fs.stat(root)).isDirectory()) throw new Error();
  } catch {
    forgetEvalEvidenceReader(root);
    throw new EvalRunError('Eval 运行不存在', 404);
  }
  const diagnostics: string[] = [];
  const [metadata, application, record, matrix, progress, execution, recovery] =
    await readRunJsonFiles(
      project,
      id,
      [
        'metadata.json',
        'application-result.json',
        'dashboard-run.json',
        'expected-case-matrix.json',
        'progress.json',
        'execution-state.json',
        'managed-record-recovery.json',
      ],
      diagnostics,
    );
  if (recovery?.schema === 'comet.eval.managed-record-recovery.v1')
    diagnostics.push(
      `损坏管理记录已人工确认停止并隔离；原始证据：${recovery.retained}（sha256:${recovery.sha256}）。`,
    );
  const managed =
    record?.schema === 'comet.eval.managed-run.v1' &&
    record.id === id &&
    record.config &&
    typeof record.config === 'object' &&
    !Array.isArray(record.config) &&
    [
      'queued',
      'preparing',
      'generating',
      'running',
      'judging',
      'finalizing',
      'stopping',
      'completed',
      'stopped',
      'interrupted',
      'unknown',
    ].includes(String(record.status))
      ? (record as unknown as EvalManagedRun)
      : null;
  if (record && !managed)
    diagnostics.push('dashboard-run.json：管理记录身份、配置或状态无效，请核对并恢复管理记录。');
  const entries = await evalRunPath(project, id, 'reports')
    .then((directory) => fs.readdir(directory))
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') diagnostics.push(`用例报告不可读取：${error.message}`);
      return [] as string[];
    });
  let publication: Awaited<ReturnType<typeof publishedReports>> = null;
  try {
    publication = await publishedReports(project, id);
  } catch (error) {
    diagnostics.push(`reports/索引：${(error as Error).message}`);
  }
  const published = new Map(publication?.reports.map((entry) => [entry.file, entry]) ?? []);
  const cases: EvalCaseResult[] = [];
  let source: Json = {};
  const reportFiles = entries.filter((file) => /^[\w.-]+_report\.json$/u.test(file)).sort();
  if (
    publication &&
    (published.size !== reportFiles.length || reportFiles.some((file) => !published.has(file)))
  )
    diagnostics.push('reports/索引：发布代次没有覆盖当前报告集合');
  // 逐份解析并丢弃正文，不同时保留整次运行的原始 JSON。预算耗尽必须显式报告。
  const matrixValid =
    matrix && validExpectedMatrix(matrix, object(metadata?.expected_case_matrix).matrix_hash);
  const reader = options.resumable ? await evidenceReader(root) : undefined;
  const waiting = options.resumable && !reader;
  const started = Date.now();
  let reportBytes = 0;
  let exhausted = false;
  for (const file of reportFiles) {
    if (waiting) {
      diagnostics.push('报告读取预算已用尽：等待公平续扫；保留当前证据。');
      exhausted = true;
      break;
    }
    if (Date.now() - started > (options.maxReadMs ?? 60000)) {
      diagnostics.push(
        `报告读取预算已用尽：已读取 ${cases.length}/${reportFiles.length} 份，结果不完整；请提高 maxReportBytes/maxReadMs 后重试。`,
      );
      exhausted = true;
      break;
    }
    let reportPath: string;
    try {
      reportPath = await evalRunPath(project, id, 'reports', file);
    } catch (error) {
      diagnostics.push(`reports/${file}：${(error as Error).message}`);
      continue;
    }
    const stat = await fs.stat(reportPath).catch(() => null);
    const stamp = stat
      ? JSON.stringify([
          stat.dev,
          stat.ino,
          stat.size,
          stat.mtimeMs,
          stat.ctimeMs,
          matrixValid ? matrix?.matrix_hash : null,
          object(metadata?.expected_case_matrix).matrix_hash,
          publication?.generation,
          published.get(file)?.sha256,
        ])
      : '';
    const previousError = reader?.errors.get(reportPath);
    if (previousError?.stamp === stamp) {
      diagnostics.push(...previousError.messages);
      continue;
    }
    const cached =
      options.includeCaseContent === false
        ? (reader?.entries.get(reportPath) ?? caseSummaries.get(reportPath))
        : undefined;
    if (cached && cached.stamp === stamp) {
      if (!cases.length) source = cached.source;
      cases.push({ ...cached.item });
      continue;
    }
    reportBytes += stat?.size ?? 0;
    if (
      reportBytes > (options.maxReportBytes ?? 1024 * 1024 * 1024) ||
      Date.now() - started > (options.maxReadMs ?? 60000)
    ) {
      diagnostics.push(
        `报告读取预算已用尽：已读取 ${cases.length}/${reportFiles.length} 份，结果不完整；请提高 maxReportBytes/maxReadMs 后重试。`,
      );
      exhausted = true;
      break;
    }
    const diagnosticsBeforeReport = diagnostics.length;
    let raw: Json | null = null;
    try {
      raw =
        publication && published.has(file)
          ? await readPublishedReport(project, id, published.get(file)!)
          : await optionalJson(project, id, `reports/${file}`, diagnostics);
    } catch (error) {
      diagnostics.push(`reports/${file}：${(error as Error).message}`);
    }
    if (raw) {
      if (!cases.length) {
        const events = object(raw.events_summary);
        source = summarySource(events);
      }
      const item = normalizeCase(file, raw, root, options.includeCaseContent !== false);
      try {
        const identity = validateEvaluationCase(
          raw,
          id,
          file,
          matrix
            ? parseEvaluationMatrix(matrix, object(metadata?.expected_case_matrix).matrix_hash)
            : [],
        );
        item.repetition = identity.rep;
        if (identity.rep !== raw.rep)
          diagnostics.push(`${file}：已按原始名称和固定矩阵校正旧报告重复编号。`);
      } catch (error) {
        diagnostics.push(`reports/${file}：${(error as Error).message}`);
      }
      if (
        options.includeCaseContent === false &&
        !diagnostics.some((message) => message.startsWith(`reports/${file}：`))
      ) {
        const events = object(raw.events_summary);
        const entry = { stamp, item, source: summarySource(events) };
        cacheCaseSummary(reportPath, entry);
        if (reader) {
          const bytes = Buffer.byteLength(JSON.stringify(entry));
          const previous = reader.entries.get(reportPath);
          if (reader.bytes - (previous?.bytes ?? 0) + bytes > 32 * 1024 * 1024) {
            diagnostics.push('reports/读取：用例摘要超过 32MiB 有界证据预算，请缩小运行');
          } else {
            reader.bytes += bytes - (previous?.bytes ?? 0);
            reader.entries.set(reportPath, { ...entry, bytes });
          }
        }
      }
      cases.push(item);
    }
    const reportErrors = diagnostics
      .slice(diagnosticsBeforeReport)
      .filter((message) => message.startsWith('reports/'));
    if (reader && reportErrors.length)
      reader.errors.set(reportPath, { stamp, messages: reportErrors });
  }
  if (reader && !exhausted) forgetEvalEvidenceReader(root);
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
  const executionState =
    execution?.schema === 'comet.eval.execution.v1' &&
    execution.runId === id &&
    ['running', 'completed', 'interrupted', 'stopping', 'stopped'].includes(
      String(execution.status),
    )
      ? (execution.status as EvalRunDetail['executionStatus'])
      : null;
  const executionStatus =
    executionState === 'stopping'
      ? 'stopping'
      : (managed?.status ??
        executionState ??
        (completedAt ? 'completed' : application?.status ? 'completed' : 'unknown'));
  const caseKey = (task: unknown, treatment: unknown, repetition: unknown) =>
    JSON.stringify([task, treatment, repetition]);
  const actualKeys = new Set(
    cases.map((item) => caseKey(item.task, item.treatment, item.repetition)),
  );
  const expectedCases = Array.isArray(matrix?.cases) ? matrix.cases : null;
  const matrixComplete =
    matrix !== null &&
    validExpectedMatrix(matrix, object(metadata?.expected_case_matrix).matrix_hash) &&
    expectedCases !== null &&
    expectedCases.length === cases.length &&
    new Set(
      expectedCases.map((item) => {
        const expected = object(item);
        return caseKey(expected.task, expected.treatment, expected.rep);
      }),
    ).size === expectedCases.length &&
    expectedCases.every((item) => {
      const expected = object(item);
      return actualKeys.has(caseKey(expected.task, expected.treatment, expected.rep));
    });
  const complete =
    !exhausted &&
    actualKeys.size === cases.length &&
    matrixComplete &&
    cases.length > 0 &&
    cases.every((item) => item.passed !== null) &&
    expectedTotal !== null &&
    cases.length === expectedTotal &&
    metadata?.experiment_id === id &&
    !diagnostics.some(
      (message) => message.startsWith('reports/') || message.startsWith('metadata.json：'),
    );
  if (!complete)
    diagnostics.push('用例报告未覆盖完整的预期用例矩阵；保留已有结果，不允许设为基线。');
  let applicationValid = true;
  if (targetType === 'application' && !managed?.config.retrySourceRunId) {
    try {
      if (!application || application.schema !== 'comet.workflow.application.eval.result.v1')
        throw new Error('应用结果缺失或格式无效');
      await validateApplicationEvaluationCompletion(
        project,
        path.join(root, 'application-result.json'),
        application,
      );
    } catch (error) {
      applicationValid = false;
      diagnostics.push(`application-result.json：${(error as Error).message}`);
    }
  }
  const excluded = cases.some((item) => item.quality === 'excluded');
  let conclusion: EvalRunDetail['conclusion'] = 'incomplete';
  if (executionStatus === 'completed' && complete && !excluded && applicationValid) {
    if (
      application &&
      (application.status === 'passed' ||
        application.status === 'failed' ||
        application.status === 'incomplete')
    )
      conclusion =
        application.status === 'incomplete'
          ? 'incomplete'
          : (application.status === 'passed') === cases.every((item) => item.passed)
            ? application.status
            : 'incomplete';
    else if (complete) conclusion = cases.every((item) => item.passed) ? 'passed' : 'failed';
  }
  let subsetConclusion: EvalRunDetail['subsetConclusion'] =
    managed?.config.retrySourceRunId && executionStatus === 'completed' && complete && !excluded
      ? cases.every((item) => item.passed)
        ? ('passed' as const)
        : ('failed' as const)
      : null;
  if (managed?.config.retrySourceRunId) conclusion = 'incomplete';
  const failedHarnessExit = [metadata?.pytest_exitstatus, managed?.exitCode].find(
    (code) =>
      code !== undefined &&
      code !== null &&
      code !== 0 &&
      (code !== 1 || !cases.some((item) => item.passed === false)),
  );
  if (failedHarnessExit !== undefined || number(metadata?.pytest_errors)) {
    conclusion = 'incomplete';
    if (subsetConclusion) subsetConclusion = 'incomplete';
    diagnostics.push(
      `Eval 执行异常（退出码 ${failedHarnessExit ?? metadata?.pytest_exitstatus ?? '未知'}），已有用例结果已保留。`,
    );
  }
  let baselineScope =
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
      : !complete || conclusion === 'incomplete'
        ? '结果不完整或存在环境异常'
        : cases.some((item) => item.quality !== 'included')
          ? '样本质量有风险标记或缺少有效证据'
          : !baselineScope
            ? '缺少固定用例与评分规则身份'
            : null;
  const baselines = await baselineMap(project);
  const storedBaselineScope =
    Object.keys(baselines).find((scope) => baselines[scope] === id) ?? null;
  if (!baselineScope && storedBaselineScope) baselineScope = storedBaselineScope;
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
    subsetConclusion,
    evidenceRevision: await readEvalEvidenceRevision(project, id).catch(() => undefined),
    completeness: complete ? 'complete' : 'incomplete',
    integrity: diagnostics.some((message) =>
      /^(?:reports\/|metadata.json：|expected-case-matrix.json：|application-result.json：)/u.test(
        message,
      ),
    )
      ? 'invalid'
      : matrix &&
          validExpectedMatrix(matrix, object(metadata?.expected_case_matrix).matrix_hash) &&
          metadata?.experiment_id === id
        ? 'valid'
        : 'unverified',
    quality: excluded
      ? 'excluded'
      : cases.some((item) => item.quality !== 'included')
        ? 'flagged'
        : 'included',
    domainConclusion:
      applicationValid &&
      complete &&
      (application?.status === 'passed' || application?.status === 'failed')
        ? application.status
        : null,
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
    caseContentOmitted: options.includeCaseContent === false,
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
    failures: [
      ...strings(application?.failures),
      ...(managed?.error ? [managed.error] : []),
      ...(!managed?.error && text(execution?.error) ? [String(execution?.error)] : []),
    ],
    artifacts,
    baselineScope,
    storedBaselineScope,
    baselineRunId,
    boundBaselineRunId: managed?.baselineRunId ?? null,
    isBaseline: storedBaselineScope !== null,
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
interface PublishedReport {
  file: string;
  sha256: string;
  bytes: number;
  summary: Json;
}
async function publishedReports(
  project: string,
  id: string,
): Promise<{ generation: string; reports: PublishedReport[] } | null> {
  const manifest = await readEvalJson(await evalRunPath(project, id, 'report-generation.json'));
  if (!manifest) return null;
  if (
    manifest.schema !== 'comet.eval.report-generation.v1' ||
    manifest.experiment !== id ||
    typeof manifest.generation !== 'string' ||
    !Array.isArray(manifest.reports)
  )
    throw new EvalRunError('报告发布索引身份无效', 409);
  const reports = manifest.reports as PublishedReport[];
  const seen = new Set<string>();
  for (const entry of reports) {
    if (
      !entry ||
      !/^[\w.-]+_report\.json$/u.test(entry.file) ||
      seen.has(entry.file) ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 1 ||
      !entry.summary ||
      typeof entry.summary !== 'object'
    )
      throw new EvalRunError('报告发布索引条目无效', 409);
    seen.add(entry.file);
  }
  return { generation: manifest.generation, reports };
}
async function readPublishedReport(
  project: string,
  id: string,
  entry: PublishedReport,
): Promise<Json> {
  const file = await evalRunPath(project, id, 'reports', entry.file);
  const stat = await fs.stat(file);
  if (stat.size > MAX_JSON_BYTES || stat.size !== entry.bytes)
    throw new EvalRunError('报告大小与发布版本不一致', 409);
  const bytes = await fs.readFile(file);
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
    throw new EvalRunError('报告内容与发布版本不一致', 409);
  return JSON.parse(bytes.toString('utf8')) as Json;
}
export async function readEvalCasePage(
  project: string,
  id: string,
  query: { limit?: number; offset?: number; status?: string; q?: string } = {},
) {
  const limit = query.limit ?? 10,
    offset = query.offset ?? 0;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    (query.status && !['all', 'failed', 'abnormal'].includes(query.status)) ||
    (query.q?.length ?? 0) > 512
  )
    throw new EvalRunError('用例分页或筛选参数无效');
  const publication = !isEvalArchiveRunId(id) ? await publishedReports(project, id) : null;
  if (publication) {
    const matrix = await readEvalJson(await evalRunPath(project, id, 'expected-case-matrix.json'));
    const expected = parseEvaluationMatrix(matrix);
    const root = await evalRunPath(project, id);
    const search = (query.q ?? '').trim().toLowerCase();
    const selected: Array<{ item: EvalCaseResult; entry: PublishedReport }> = [];
    let searchedBytes = 0;
    const started = Date.now();
    for (const entry of publication.reports) {
      const identity = validateEvaluationCase(entry.summary, id, entry.file, expected);
      const item = normalizeCase(entry.file, entry.summary, root, false);
      item.repetition = identity.rep;
      if (query.status === 'failed' && !(item.passed === false && item.quality !== 'excluded'))
        continue;
      if (query.status === 'abnormal' && item.quality !== 'excluded') continue;
      let matches = `${item.task}\n${text(object(entry.summary.events_summary).prompt) ?? ''}`
        .toLowerCase()
        .includes(search);
      if (!matches && search && object(entry.summary.events_summary).prompt_truncated === true) {
        searchedBytes += entry.bytes;
        if (searchedBytes > 1024 * 1024 * 1024 || Date.now() - started > 60000)
          throw new EvalRunError('完整输入搜索超过读取预算，请缩小运行或筛选范围', 413);
        const raw = await readPublishedReport(project, id, entry);
        matches =
          `${text(object(raw.events_summary).task) ?? ''}\n${text(object(raw.events_summary).prompt) ?? ''}`
            .toLowerCase()
            .includes(search);
      }
      if (matches) selected.push({ item, entry });
    }
    const items: EvalCaseResult[] = [];
    for (const { entry } of selected.slice(offset, offset + limit)) {
      const raw = await readPublishedReport(project, id, entry);
      const identity = validateEvaluationCase(raw, id, entry.file, expected);
      items.push({ ...normalizeCase(entry.file, raw, root, false), repetition: identity.rep });
    }
    if ((await publishedReports(project, id))?.generation !== publication.generation)
      throw new EvalRunError('报告发布版本已变化，请重新读取', 409);
    return {
      items,
      total: selected.length,
      runTotal: publication.reports.length,
      offset,
      nextOffset: offset + limit < selected.length ? offset + limit : null,
      diagnostics: [],
      generation: publication.generation,
    };
  }
  const run = await readEvalRun(project, id, { includeCaseContent: false });
  const search = (query.q ?? '').trim().toLowerCase();
  const selected: EvalCaseResult[] = [];
  const started = Date.now();
  let searchedBytes = 0;
  for (const item of run.cases) {
    if (query.status === 'failed' && !(item.passed === false && item.quality !== 'excluded'))
      continue;
    if (query.status === 'abnormal' && item.quality !== 'excluded') continue;
    let matches = `${item.task}\n${item.prompt ?? ''}`.toLowerCase().includes(search);
    if (!matches && search && !isEvalArchiveRunId(id)) {
      // 摘录之外的输入也参与搜索；逐份读取，不把完整正文留在列表中。
      const file = await evalRunPath(project, id, 'reports', item.id);
      searchedBytes += (await fs.stat(file)).size;
      if (searchedBytes > 1024 * 1024 * 1024 || Date.now() - started > 60000)
        throw new EvalRunError('完整输入搜索超过读取预算，请缩小运行或筛选范围', 413);
      const raw = await readEvalJson(file);
      const events = object(raw?.events_summary);
      matches = `${text(events.task) ?? ''}\n${text(events.prompt) ?? ''}`
        .toLowerCase()
        .includes(search);
    }
    if (matches) selected.push(item);
  }
  return {
    items: selected.slice(offset, offset + limit),
    total: selected.length,
    runTotal: run.total,
    offset,
    nextOffset: offset + limit < selected.length ? offset + limit : null,
    diagnostics: run.diagnostics,
  };
}
export async function readEvalCase(
  project: string,
  id: string,
  caseId: string,
): Promise<EvalCaseResult> {
  if (!/^[\w.-]+_report\.json$/u.test(caseId)) throw new EvalRunError('无效的 Eval 用例身份');
  if (isEvalArchiveRunId(id)) {
    const item = (await readEvalRun(project, id)).cases.find((item) => item.id === caseId);
    if (!item) throw new EvalRunError('用例不存在', 404);
    return item;
  }
  const publication = await publishedReports(project, id);
  const entry = publication?.reports.find((entry) => entry.file === caseId);
  if (publication && !entry) throw new EvalRunError('用例不属于当前发布版本', 409);
  const raw = entry
    ? await readPublishedReport(project, id, entry)
    : await readEvalJson(await evalRunPath(project, id, 'reports', caseId));
  if (!raw) throw new EvalRunError('用例不存在', 404);
  const item = normalizeCase(caseId, raw, await evalRunPath(project, id));
  const matrix = await readEvalJson(await evalRunPath(project, id, 'expected-case-matrix.json'));
  const metadata = await readEvalJson(await evalRunPath(project, id, 'metadata.json'));
  item.repetition = validateEvaluationCase(
    raw,
    id,
    caseId,
    matrix ? parseEvaluationMatrix(matrix, object(metadata?.expected_case_matrix).matrix_hash) : [],
  ).rep;
  if (publication && (await publishedReports(project, id))?.generation !== publication.generation)
    throw new EvalRunError('报告发布版本已变化，请重新读取', 409);
  return item;
}
export async function listEvalRuns(
  project: string,
  options: EvalReadOptions = {},
): Promise<EvalRunDetail[]> {
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
    runs.push(await readEvalRun(project, entry.name, options));
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
    const run = await readEvalRun(project, id, { includeCaseContent: false });
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
  return readEvalRun(project, id, { includeCaseContent: false });
}
export async function clearEvalBaseline(
  project: string,
  id: string,
  expected?: { scope: string; runId: string },
): Promise<EvalRunDetail> {
  if ((await readArchivedEvalRun(project, id))?.archiveId)
    throw new EvalRunError('历史归档只读，不能清除基线', 409);
  const file = await evalStoragePath(project, 'baselines.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await withRecoverableFileLock(`${file}.lock`, async () => {
    const run = await readEvalRun(project, id, { includeCaseContent: false });
    const baselines = await baselineMap(project);
    const scope = expected?.scope ?? run.baselineScope;
    if (!scope || (expected && expected.runId !== id) || baselines[scope] !== id)
      throw new EvalRunError('默认基线已变化，请刷新后重新确认', 409);
    delete baselines[scope];
    await writeEvalJson(file, { schema: 'comet.eval.baselines.v1', baselines });
  });
  return readEvalRun(project, id, { includeCaseContent: false });
}
export async function compareEvalRuns(
  project: string,
  candidateId: string,
  baselineId: string,
): Promise<EvalRunComparison> {
  const [candidate, baseline] = await Promise.all([
    readEvalRun(project, candidateId, { includeCaseContent: false }),
    readEvalRun(project, baselineId, { includeCaseContent: false }),
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
