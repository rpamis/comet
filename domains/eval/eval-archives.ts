import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { parseWorkflowRun, type WorkflowRun } from '../engine/runtime.js';
import {
  readProtectedProjectFile,
  inspectProtectedProjectPath,
} from '../workflow-contract/protected-project-path.js';
import type { ApplicationIdentity } from '../workflow-application/index.js';
import type { EvalRunDetail } from './eval-run-types.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
const SHA = /^[a-f0-9]{64}$/u;
export interface EvalArchive {
  schema: 'comet.eval.archive.v1';
  id: string;
  title: string;
  application: {
    id: string;
    version: string;
    base: string;
    root: string;
    contentHash: string;
    packageHash: string;
  };
  files: Record<string, string>;
  runs: Array<{ kind: 'creator' | 'application'; runId: string; file: string }>;
  reports: Array<{ path: string; label: string }>;
  artifactMappings?: Record<string, string>;
  assessment: {
    task: string;
    taskCompleted: boolean;
    originalTestsPassed: number;
    regressionTestsPassed: number;
    models: string[];
    limitations: string[];
    createdAt?: string;
    completedAt?: string;
    durationSeconds?: number;
    tokens?: number;
  };
}
export interface EvalArchiveObservation {
  archive: EvalArchive;
  runs: Array<{
    kind: 'creator' | 'application';
    run: WorkflowRun;
    identity: ApplicationIdentity | null;
  }>;
}
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
function relative(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    value.includes(':') ||
    value.split('/').some((s) => !s || s === '.' || s === '..')
  )
    throw new Error('归档引用必须是归档目录内的相对路径');
  return value;
}
export function evalArchiveRoot(id: string): string {
  if (!ID.test(id)) throw new Error('归档身份无效');
  return `eval/archives/${id}`;
}
export function evalArchiveRunId(id: string): string {
  return `archive-${id}`;
}
export function isEvalArchiveRunId(id: string): boolean {
  return id.startsWith('archive-');
}

async function manifest(project: string, id: string): Promise<EvalArchive> {
  const bytes = (
    await readProtectedProjectFile(project, `${evalArchiveRoot(id)}/archive.json`, 256 * 1024, {
      label: '历史实验归档',
    })
  ).bytes;
  const v = object(JSON.parse(bytes.toString('utf8'))),
    a = object(v.application),
    s = object(v.assessment);
  if (
    v.schema !== 'comet.eval.archive.v1' ||
    v.id !== id ||
    typeof v.title !== 'string' ||
    !['id', 'version', 'base'].every((k) => typeof a[k] === 'string' && a[k]) ||
    !SHA.test(String(a.contentHash)) ||
    !SHA.test(String(a.packageHash)) ||
    !Array.isArray(v.runs) ||
    !v.runs.length ||
    v.runs.length > 100 ||
    !Array.isArray(v.reports) ||
    typeof s.task !== 'string' ||
    typeof s.taskCompleted !== 'boolean' ||
    ![s.originalTestsPassed, s.regressionTestsPassed].every(
      (n) => Number.isSafeInteger(n) && Number(n) >= 0,
    ) ||
    ![s.models, s.limitations].every(
      (l) => Array.isArray(l) && l.every((x) => typeof x === 'string'),
    )
  )
    throw new Error('归档清单格式无效');
  relative(a.root);
  const files = object(v.files);
  for (const [file, digest] of Object.entries(files)) {
    relative(file);
    if (!SHA.test(String(digest))) throw new Error('归档文件摘要无效');
  }
  for (const run of v.runs) {
    const r = object(run);
    if (
      !['creator', 'application'].includes(String(r.kind)) ||
      typeof r.runId !== 'string' ||
      !r.runId ||
      !files[relative(r.file)]
    )
      throw new Error('归档 Run 引用无效');
  }
  if (new Set(v.runs.map((r) => `${object(r).kind}:${object(r).runId}`)).size !== v.runs.length)
    throw new Error('归档 Run 身份重复');
  for (const report of v.reports) {
    const r = object(report);
    if (typeof r.label !== 'string' || !files[relative(r.path)])
      throw new Error('归档报告引用无效');
  }
  for (const file of Object.values(object(v.artifactMappings)))
    if (!files[relative(file)]) throw new Error('归档工件引用无效');
  for (const k of ['durationSeconds', 'tokens'])
    if (
      s[k] !== undefined &&
      (typeof s[k] !== 'number' || !Number.isFinite(s[k]) || Number(s[k]) < 0)
    )
      throw new Error('归档指标无效');
  for (const k of ['createdAt', 'completedAt'])
    if (
      s[k] !== undefined &&
      (typeof s[k] !== 'string' || !Number.isFinite(Date.parse(String(s[k]))))
    )
      throw new Error('归档时间无效');
  return v as unknown as EvalArchive;
}

/** 仅读取清单声明且内容匹配的文件，不加载应用模块或恢复 Runtime。 */
export async function readEvalArchiveFile(
  project: string,
  archive: EvalArchive,
  file: string,
): Promise<Buffer> {
  relative(file);
  const expected = archive.files[file];
  if (!expected) throw new Error('归档未声明这个文件');
  const bytes = (
    await readProtectedProjectFile(
      project,
      `${evalArchiveRoot(archive.id)}/${file}`,
      16 * 1024 * 1024,
      { label: '历史实验文件' },
    )
  ).bytes;
  if (createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new Error(`归档文件内容已变化：${file}`);
  return bytes;
}
export async function readEvalArchiveManifest(project: string, id: string): Promise<EvalArchive> {
  return manifest(project, id);
}

export async function readEvalArchive(
  project: string,
  id: string,
): Promise<EvalArchiveObservation> {
  const archive = await manifest(project, id);
  const runs: EvalArchiveObservation['runs'] = [];
  for (const ref of archive.runs) {
    const bytes = await readEvalArchiveFile(project, archive, ref.file);
    const json = ref.file.endsWith('.json.gz')
      ? gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 })
      : bytes;
    const raw = object(JSON.parse(json.toString('utf8')));
    const run = parseWorkflowRun(ref.kind === 'creator' ? raw : raw.run, ref.runId);
    if (ref.kind === 'creator' && run.workflow.id !== 'comet-creator')
      throw new Error('归档记录不是 Creator Run');
    const identity = ref.kind === 'application' ? object(raw.application) : null;
    if (
      identity &&
      (raw.runId !== run.runId ||
        raw.revision !== run.revision ||
        identity.id !== archive.application.id ||
        identity.version !== archive.application.version ||
        identity.base !== archive.application.base ||
        identity.contentHash !== archive.application.contentHash ||
        typeof identity.projectRoot !== 'string' ||
        typeof identity.packageRoot !== 'string' ||
        typeof identity.runtimeVersion !== 'string')
    )
      throw new Error('归档应用身份与原 Run 不匹配');
    runs.push({ kind: ref.kind, run, identity: identity as unknown as ApplicationIdentity | null });
  }
  return { archive, runs };
}
export async function listEvalArchives(
  project: string,
): Promise<{ items: EvalArchiveObservation[]; errors: Array<{ id: string; message: string }> }> {
  const root = await inspectProtectedProjectPath(project, 'eval/archives', {
    label: '历史实验目录',
    expected: 'directory',
  });
  if (!root.exists) return { items: [], errors: [] };
  const entries = await fs.readdir(root.target, { withFileTypes: true });
  const items: EvalArchiveObservation[] = [],
    errors: Array<{ id: string; message: string }> = [];
  for (const entry of entries
    .filter((e) => ID.test(e.name) && (e.isDirectory() || e.isSymbolicLink()))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 200)) {
    try {
      items.push(await readEvalArchive(project, entry.name));
    } catch (error) {
      errors.push({
        id: entry.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { items, errors };
}
export function archiveEvalDetail(archive: EvalArchive, diagnostic?: string): EvalRunDetail {
  const a = archive.assessment;
  return {
    id: evalArchiveRunId(archive.id),
    origin: 'history',
    archiveId: archive.id,
    archiveAssessment: {
      taskCompleted: a.taskCompleted,
      originalTestsPassed: a.originalTestsPassed,
      regressionTestsPassed: a.regressionTestsPassed,
    },
    createdAt: a.createdAt ?? null,
    completedAt: a.completedAt ?? null,
    executionStatus: 'completed',
    conclusion: 'incomplete',
    target: {
      id: archive.application.id,
      name: archive.application.id,
      type: 'application',
      version: archive.application.version,
      path: `${evalArchiveRoot(archive.id)}/${archive.application.root}/application.json`,
      contentHash: archive.application.contentHash,
    },
    config: { task: a.task },
    passed: 0,
    total: 0,
    expectedTotal: null,
    cases: [],
    progress: null,
    metrics: {
      durationSeconds: a.durationSeconds ?? null,
      tokens: a.tokens ?? null,
      knownCostUsd: null,
      costStatus: 'unavailable',
      generationCostUsd: null,
    },
    coverage: null,
    limitations: [
      `历史实验 · 只读；专项任务${a.taskCompleted ? '已完成' : '未完成'}，原始测试 ${a.originalTestsPassed} 项、含回归测试 ${a.regressionTestsPassed} 项通过；不代表完整应用 Eval。`,
      ...a.limitations,
    ],
    failures: [],
    artifacts: archive.reports.map((r) => ({
      id: r.path,
      label: r.label,
      format: r.path.endsWith('.md') ? 'markdown' : r.path.endsWith('.json') ? 'json' : 'text',
    })),
    baselineScope: null,
    baselineRunId: null,
    boundBaselineRunId: null,
    isBaseline: false,
    baselineEligible: false,
    baselineDisabledReason: '历史专项复核不能作为完整评估基线',
    availableActions: { stop: false, rerun: false, setBaseline: false, compare: false },
    stale: null,
    diagnostics: diagnostic ? [diagnostic] : [],
  };
}
export async function readArchivedEvalRun(
  project: string,
  runId: string,
): Promise<EvalRunDetail | null> {
  if (!isEvalArchiveRunId(runId)) return null;
  const id = runId.slice('archive-'.length);
  const file = await inspectProtectedProjectPath(project, `${evalArchiveRoot(id)}/archive.json`, {
    expected: 'file',
    label: '历史实验清单',
  });
  if (!file.exists) return null;
  const { archive } = await readEvalArchive(project, id);
  return archiveEvalDetail(archive);
}

export function archiveEvalError(id: string, message: string): EvalRunDetail {
  const result = archiveEvalDetail(
    {
      schema: 'comet.eval.archive.v1',
      id,
      title: id,
      application: {
        id,
        version: '',
        base: 'standalone',
        root: 'application',
        contentHash: '',
        packageHash: '',
      },
      runs: [],
      files: {},
      reports: [],
      assessment: {
        task: '',
        taskCompleted: false,
        originalTestsPassed: 0,
        regressionTestsPassed: 0,
        models: [],
        limitations: [],
      },
    },
    message,
  );
  result.executionStatus = 'unknown';
  result.target = { id, name: id, type: 'unknown', version: null, path: null, contentHash: null };
  result.limitations = ['历史归档无法完整读取；不能用于判断任务完成或应用评估结论。'];
  delete result.archiveAssessment;
  return result;
}
