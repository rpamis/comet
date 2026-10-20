import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  iterateCreatorRunSources,
  readCreatorRunProjection,
  type CreatorRunObservation,
} from '../workflow-creation/index.js';
import {
  iterateWorkflowApplicationRunSources,
  readWorkflowApplicationRunProjection,
  inspectWorkflowApplicationMaterial,
  inspectWorkflowApplicationPackage,
  readApplicationEvaluationEvidence,
  type WorkflowApplicationRunObservation,
  type ApplicationRunRecord,
} from '../workflow-application/index.js';
import {
  readProtectedProjectFile,
  inspectProtectedProjectPath,
} from '../workflow-contract/protected-project-path.js';
import {
  readChangeRuntimeOwner,
  SDK_APPLICATIONS,
} from '../workflow-contract/change-runtime-owner.js';
import {
  readEvalRun,
  listEvalArchives,
  iterateEvalArchiveSources,
  readEvalArchive,
  evalArchiveRoot,
  evalArchiveRunId,
  readEvalArchiveFile,
  type EvalArchiveObservation,
} from '../eval/index.js';
import { collectNativeDashboardChangePage } from './native-collector.js';
import { collectDashboardChangePage } from './collector.js';
import { DashboardSummaryIndex } from './summary-index.js';
import {
  projectDashboardApplicationDefinition,
  labelDashboardApplicationRecords,
} from './application-definition.js';
import type {
  DashboardApplicationRunKind,
  DashboardApplicationRunSummary,
  DashboardApplicationRunPage,
  DashboardApplicationRunDetail,
  DashboardApplicationRecord,
  DashboardApplicationArtifact,
  DashboardApplicationEvidence,
  DashboardApplicationIdentity,
} from './application-types.js';

type Run = ApplicationRunRecord['run'];
type Entry = {
  summary: DashboardApplicationRunSummary;
  run: Run | null;
  creator: CreatorRunObservation | null;
  application: WorkflowApplicationRunObservation | null;
  archive?: EvalArchiveObservation;
  archivedIdentity?: ApplicationRunRecord['application'] | null;
};
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, item]) => [k, canonical(item)]),
        )
      : v;
const hash = (v: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(v)))
    .digest('hex');
const creatorLabels: Record<string, [string, string]> = {
  analyze: ['理解需求与调查 Skills', '准备方案'],
  prepare: ['整理创作方案', '准备方案'],
  'confirm-plan': ['确认创作方案', '准备方案'],
  compile: ['编译应用', '构建与校验'],
  verify: ['校验应用与依赖', '构建与校验'],
  'review-verification': ['处理产物验收失败', '构建与校验'],
  'eval-preview': ['准备模型评估', '模型评估'],
  'confirm-eval': ['确认是否评估', '模型评估'],
  evaluate: ['模型评估', '模型评估'],
  preview: ['预览安装影响', '确认安装'],
  'confirm-install': ['确认安装', '确认安装'],
  install: ['安装与交付', '交付'],
  stop: ['停止创作', '结束'],
};

export class DashboardApplicationQueryError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = 'INVALID_APPLICATION_QUERY',
  ) {
    super(message);
  }
}

/** SDK 的领取凭据不能进入 JSON 预览或浏览器缓存。 */
export function sanitizeApplicationObservation(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeApplicationObservation);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/^(?:claimToken|token|apiKey|api_key|password|secret|credentials?|authorization)$/iu.test(
              key,
            ),
        )
        .map(([key, item]) => [key, sanitizeApplicationObservation(item)]),
    );
  return value;
}

function candidate(run: Run): DashboardApplicationIdentity | null {
  const prepared = object(run.outputs.prepare?.value);
  const manifest = object(object(prepared.plan).manifest);
  const id = text(manifest.id),
    version = text(manifest.version),
    base = text(manifest.base);
  if (!id || !version || !base) return null;
  const preview = object(run.outputs['eval-preview']?.value);
  return {
    id,
    version,
    base,
    contentHash: text(preview.runtimeIdentityHash),
    packageHash: text(object(run.outputs.compile?.value).contentHash),
  };
}
function summary(
  kind: DashboardApplicationRunKind,
  storageKey: string,
  run: Run | null,
  identity: DashboardApplicationIdentity | null,
  error: DashboardApplicationRunSummary['error'],
  runId: string | null,
): DashboardApplicationRunSummary {
  const goal = run
    ? (text(object(run.input).goal) ??
      text(object(run.input).title) ??
      text(object(run.input).task))
    : null;
  const children = new Set(run?.children.map((c) => c.actionId) ?? []);
  const unknown = run?.actions.filter((a) => a.status === 'unknown').length ?? 0;
  const status = !run
    ? 'unreadable'
    : kind === 'creator' && run.status === 'completed'
      ? run.outputs.install
        ? 'delivered'
        : run.outputs.stop
          ? 'stopped'
          : 'completed'
      : unknown && run.status !== 'cancelled' && run.status !== 'completed'
        ? 'unknown'
        : run.status;
  return {
    locator: `${kind}:${hash([kind === 'creator' ? null : (identity?.id ?? null), runId ?? storageKey])}`,
    kind,
    isChild: kind === 'application' && Boolean(run?.lineage.length),
    parentRunId: null,
    parentLocator: null,
    runId,
    title: identity?.id ?? goal ?? runId ?? `无法读取的记录 ${storageKey.slice(0, 8)}`,
    goal,
    status,
    revision: run?.revision ?? null,
    application: identity,
    applicationId: identity?.id ?? null,
    error,
    activity: {
      pending:
        run?.actions.filter((a) => a.status === 'pending' && !children.has(a.id)).length ?? 0,
      running:
        run?.actions.filter((a) => a.status === 'running' && !children.has(a.id)).length ?? 0,
      unknown,
      decisions: run?.waits.filter((w) => w.status === 'pending').length ?? 0,
      evidence: run?.evidenceWaits?.filter((w) => w.status === 'pending').length ?? 0,
      children:
        run?.children.filter((c) =>
          run.actions.some(
            (a) => a.id === c.actionId && ['pending', 'running', 'unknown'].includes(a.status),
          ),
        ).length ?? 0,
    },
  };
}

function limit(value: unknown): number {
  const n = value === undefined ? 40 : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 100)
    throw new DashboardApplicationQueryError('每页记录数必须在 1 到 100 之间');
  return n;
}

type ApplicationReference = {
  summary: DashboardApplicationRunSummary;
  source: {
    kind: 'creator' | 'application' | 'archive';
    runId: string | null;
    storageKey: string;
    applicationId?: string;
    archiveId?: string;
    archiveKind?: DashboardApplicationRunKind;
  };
  children: string[];
};

function creatorEntry(observation: CreatorRunObservation): Entry {
  return {
    summary: summary(
      'creator',
      observation.storageKey,
      observation.run,
      observation.run ? candidate(observation.run) : null,
      observation.error,
      observation.runId,
    ),
    run: observation.run,
    creator: observation,
    application: null,
  };
}
function applicationEntry(observation: WorkflowApplicationRunObservation): Entry {
  const fixed = observation.record?.application;
  const identity = fixed
    ? {
        id: fixed.id,
        version: fixed.version,
        base: fixed.base,
        contentHash: fixed.contentHash,
        packageHash: null,
      }
    : null;
  const item = summary(
    'application',
    observation.storageKey,
    observation.record?.run ?? null,
    identity,
    observation.error,
    observation.runId,
  );
  if (!fixed) {
    item.applicationId = observation.applicationId;
    item.locator = `application:${hash([observation.applicationId, observation.runId ?? observation.storageKey])}`;
    item.title = observation.applicationId;
  }
  return {
    summary: item,
    run: observation.record?.run ?? null,
    creator: null,
    application: observation,
  };
}
function archivedEntries(observation: EvalArchiveObservation): Entry[] {
  const entries = observation.runs.map((snapshot) => {
    const a = observation.archive.application;
    const item = summary(
      snapshot.kind,
      snapshot.run.runId,
      snapshot.run,
      {
        id: a.id,
        version: a.version,
        base: a.base,
        contentHash: a.contentHash,
        packageHash: a.packageHash,
      },
      null,
      snapshot.run.runId,
    );
    item.locator = `${snapshot.kind}:${hash(['archive', observation.archive.id, snapshot.kind, snapshot.run.runId])}`;
    item.archive = { id: observation.archive.id, title: observation.archive.title };
    return {
      summary: item,
      run: snapshot.run,
      creator: null,
      application: null,
      archive: observation,
      archivedIdentity: snapshot.identity,
    };
  });
  linkEntries(entries);
  return entries;
}
function linkEntries(entries: Entry[]): void {
  for (const child of entries.filter((e) => e.summary.kind === 'application')) {
    const parent = entries.find(
      (e) =>
        e.run &&
        e.summary.applicationId === child.summary.applicationId &&
        e.summary.archive?.id === child.summary.archive?.id &&
        e.run.children.some(
          (c) =>
            c.runId === child.summary.runId &&
            (!child.run ||
              (c.workflow.id === child.run.workflow.id &&
                c.workflow.version === child.run.workflow.version)),
        ),
    );
    if (parent) {
      child.summary.isChild = true;
      child.summary.parentRunId = parent.summary.runId;
      child.summary.parentLocator = parent.summary.locator;
    }
  }
}
function reference(entry: Entry): ApplicationReference {
  const parentRunId = entry.run?.lineage.at(-1) ?? null;
  const item = {
    ...entry.summary,
    parentRunId,
    parentLocator: parentRunId
      ? entry.archive
        ? `application:${hash(['archive', entry.archive.archive.id, 'application', parentRunId])}`
        : `application:${hash([entry.summary.applicationId, parentRunId])}`
      : null,
  };
  return {
    summary: item,
    children: entry.run?.children.map((c) => c.runId) ?? [],
    source: entry.archive
      ? {
          kind: 'archive',
          runId: item.runId,
          storageKey: item.runId ?? '',
          archiveId: entry.archive.archive.id,
          archiveKind: item.kind,
        }
      : {
          kind: item.kind,
          runId: item.runId,
          storageKey:
            entry.creator?.storageKey ?? entry.application?.storageKey ?? item.runId ?? '',
          applicationId: item.applicationId ?? undefined,
        },
  };
}

async function creatorProjection(projectRoot: string, runId: string) {
  return (await readCreatorRunProjection(projectRoot, runId))?.run ?? null;
}
async function applicationProjection(
  projectRoot: string,
  applicationId: string,
  runId: string,
): Promise<WorkflowApplicationRunObservation> {
  try {
    const value = await readWorkflowApplicationRunProjection(projectRoot, applicationId, runId);
    if (!value) throw new Error('应用 Run 已消失，请重新读取列表');
    return {
      applicationId,
      runId,
      storageKey: hash(runId),
      error: null,
      record: {
        runId,
        revision: value.projection.run.revision,
        application: value.application,
        run: value.projection.run,
      },
    };
  } catch (error) {
    return {
      applicationId,
      runId,
      storageKey: hash(runId),
      record: null,
      error: {
        code: 'APPLICATION_UNREADABLE',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
function applicationSummaryIndex(projectRoot: string) {
  return new DashboardSummaryIndex({
    projectRoot,
    namespace: 'any-v1',
    discover: async function* () {
      const add = (key: string, fingerprint: string, load: () => Promise<Entry[]>) => ({
        key,
        fingerprint,
        read: async () =>
          (await load()).map((entry) => {
            const ref = reference(entry),
              s = ref.summary;
            return {
              key: s.locator,
              sortKey: s.locator,
              search: `${s.title} ${s.goal ?? ''} ${s.runId ?? ''} ${s.application?.version ?? ''}`,
              status: s.status,
              kind: s.kind,
              group: s.applicationId,
              attention: Boolean(
                s.error ||
                s.status === 'failed' ||
                s.activity.unknown + s.activity.decisions + s.activity.evidence > 0,
              ),
              payload: ref,
            };
          }),
      });
      for await (const source of iterateCreatorRunSources(projectRoot)) {
        const key = source.runId ?? source.storageKey;
        yield add(`creator:${key}`, source.fingerprint, async () => {
          let run: Run | null = null,
            error = source.error;
          try {
            if (!error && source.runId) run = await creatorProjection(projectRoot, source.runId);
          } catch (cause) {
            error = { code: 'CREATOR_UNREADABLE', message: String(cause) };
          }
          return [creatorEntry({ ...source, run, error })];
        });
      }
      for await (const source of iterateWorkflowApplicationRunSources(projectRoot, {
        excludeApplications: SDK_APPLICATIONS,
      })) {
        const key = `${source.applicationId}:${source.runId ?? source.storageKey}`;
        yield add(`application:${key}`, source.fingerprint, async () => [
          applicationEntry(
            source.error || !source.runId
              ? { ...source, record: null }
              : await applicationProjection(projectRoot, source.applicationId, source.runId),
          ),
        ]);
      }
      for await (const source of iterateEvalArchiveSources(projectRoot))
        yield add(`archive:${source.id}`, source.fingerprint, async () => {
          if (!source.error) return archivedEntries(await readEvalArchive(projectRoot, source.id));
          const item = summary(
            'application',
            source.id,
            null,
            null,
            { code: 'ARCHIVE_UNREADABLE', message: source.error },
            null,
          );
          item.locator = `application:${hash(['archive-error', source.id])}`;
          item.title = source.id;
          item.archive = { id: source.id, title: source.id };
          return [{ summary: item, run: null, creator: null, application: null }];
        });
    },
  });
}

async function readReference(
  projectRoot: string,
  ref: ApplicationReference,
): Promise<Entry | null> {
  if (ref.source.kind === 'archive')
    return (
      archivedEntries(await readEvalArchive(projectRoot, ref.source.archiveId!)).find(
        (e) => e.summary.locator === ref.summary.locator,
      ) ?? null
    );
  if (!ref.source.runId)
    return { summary: ref.summary, run: null, creator: null, application: null };
  if (ref.source.kind === 'creator') {
    const run = await creatorProjection(projectRoot, ref.source.runId);
    return run
      ? creatorEntry({ storageKey: ref.source.storageKey, runId: run.runId, run, error: null })
      : null;
  }
  const observation = await applicationProjection(
    projectRoot,
    ref.source.applicationId!,
    ref.source.runId,
  );
  return applicationEntry(observation);
}

async function detailDataset(
  projectRoot: string,
  locator: string,
): Promise<{
  entries: Entry[];
  errors: DashboardApplicationRunPage['errors'];
  indexing?: boolean;
}> {
  const store = applicationSummaryIndex(projectRoot);
  let refs: ApplicationReference[];
  let indexing: boolean;
  let ref: ApplicationReference | null;
  try {
    await store.ensure();
    ref = await store.find<ApplicationReference>(locator);
    if (!ref) {
      await store.refresh({ maxSources: 20, budgetMs: 500 });
      ref = await store.find<ApplicationReference>(locator);
    }
    if (!ref && locator.startsWith('creator:')) {
      // 兼容旧候选链接，只分页查询已有摘要，不读取全部 Run。
      for (let offset = 0; ; offset += 100) {
        const candidates = await store.query<ApplicationReference>({
          kind: 'creator',
          limit: 100,
          offset,
        });
        ref =
          candidates.items.find(
            (item) =>
              item.summary.applicationId &&
              `creator:${hash([item.summary.applicationId, item.summary.runId ?? item.source.storageKey])}` ===
                locator,
          ) ?? null;
        if (ref || offset + 100 >= candidates.total) break;
      }
    }
    const metadata = await store.metadata();
    indexing = metadata?.indexing ?? true;
    if (!ref) {
      if (indexing)
        throw new DashboardApplicationQueryError(
          '运行列表仍在同步，请保留选择后重试',
          503,
          'APPLICATION_INDEX_PENDING',
        );
      return { entries: [], errors: [] };
    }
    refs = [ref];
    if (ref.summary.applicationId) {
      const related = await store.query<ApplicationReference>({
        group: ref.summary.applicationId,
        limit: 100,
      });
      refs = [
        ...new Map([ref, ...related.items].map((item) => [item.summary.locator, item])).values(),
      ];
    }
  } catch (error) {
    if (error instanceof DashboardApplicationQueryError) throw error;
    throw new DashboardApplicationQueryError(
      '运行列表缓存不可用，请稍后重试',
      503,
      'APPLICATION_INDEX_UNAVAILABLE',
    );
  }
  if (ref.source.kind === 'archive')
    return {
      entries: archivedEntries(await readEvalArchive(projectRoot, ref.source.archiveId!)),
      errors: [] as DashboardApplicationRunPage['errors'],
    };
  const selected = await readReference(projectRoot, ref);
  if (!selected)
    return { entries: [] as Entry[], errors: [] as DashboardApplicationRunPage['errors'] };
  selected.summary = reference(selected).summary;
  const entries: Entry[] = refs.map((r) => ({
    summary: r.summary,
    run: null,
    creator: null,
    application: null,
  }));
  for (const relevant of refs.filter(
    (r) =>
      r.summary.locator === ref!.summary.locator ||
      (r.summary.kind === 'creator' &&
        r.summary.applicationId === selected.summary.applicationId &&
        selected.summary.applicationId),
  )) {
    const entry =
      relevant.summary.locator === ref.summary.locator
        ? selected
        : await readReference(projectRoot, relevant);
    const position = entries.findIndex((e) => e.summary.locator === relevant.summary.locator);
    if (entry) entries[position] = entry;
  }
  if (selected.application?.record) {
    for (const child of selected.run?.children ?? []) {
      const observation = await applicationProjection(
        projectRoot,
        selected.application.applicationId,
        child.runId,
      );
      if (!observation.record || observation.error) continue;
      const entry = applicationEntry(observation);
      const position = entries.findIndex((e) => e.summary.locator === entry.summary.locator);
      if (position < 0) entries.push(entry);
      else entries[position] = entry;
    }
  }
  linkEntries(entries);
  return { entries, errors: [] as DashboardApplicationRunPage['errors'], indexing };
}
function page<T>(items: T[], fingerprint: string, cursor: string | undefined, size: number) {
  let offset = 0;
  if (cursor) {
    try {
      if (cursor.length > 8192) throw new Error();
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (
        parsed.schema !== 'comet.dashboard.application-cursor.v1' ||
        !Number.isSafeInteger(parsed.offset) ||
        parsed.offset < 0 ||
        parsed.offset > items.length
      )
        throw new Error();
      if (parsed.fingerprint !== fingerprint)
        throw new DashboardApplicationQueryError(
          '运行记录已变化，请重新读取当前页',
          409,
          'STALE_APPLICATION_CURSOR',
        );
      offset = parsed.offset;
    } catch (error) {
      if (error instanceof DashboardApplicationQueryError) throw error;
      throw new DashboardApplicationQueryError('分页游标无效');
    }
  }
  return {
    items: items.slice(offset, offset + size),
    total: items.length,
    nextCursor:
      offset + size < items.length
        ? Buffer.from(
            JSON.stringify({
              schema: 'comet.dashboard.application-cursor.v1',
              fingerprint,
              offset: offset + size,
            }),
          ).toString('base64url')
        : null,
  };
}
export async function collectDashboardApplicationRunPage(
  projectRoot: string,
  query: {
    kind?: string;
    status?: string;
    applicationId?: string;
    q?: string;
    limit?: number;
    cursor?: string;
    cached?: boolean;
    scope?: string;
  } = {},
): Promise<DashboardApplicationRunPage> {
  if (query.kind && !['all', 'creator', 'application'].includes(query.kind))
    throw new DashboardApplicationQueryError('运行类型无效');
  if (
    query.status &&
    ![
      'all',
      'attention',
      'active',
      'running',
      'waiting',
      'completed',
      'delivered',
      'stopped',
      'failed',
      'cancelled',
      'unknown',
      'unreadable',
    ].includes(query.status)
  )
    throw new DashboardApplicationQueryError('运行状态无效');
  if ((query.q?.length ?? 0) > 512) throw new DashboardApplicationQueryError('搜索内容过长');
  if (query.scope && !['all', 'draft', 'apps'].includes(query.scope))
    throw new DashboardApplicationQueryError('应用范围无效');
  const pageSize = limit(query.limit);
  try {
    const store = applicationSummaryIndex(projectRoot);
    await store.ensure({ fresh: !query.cached });
    const filter = {
      search: query.q,
      kind: query.kind && query.kind !== 'all' ? query.kind : undefined,
      group: query.applicationId,
      statuses:
        query.status === 'active'
          ? ['running', 'waiting', 'unknown']
          : query.status && query.status !== 'all' && query.status !== 'attention'
            ? [query.status]
            : undefined,
      attention: query.status === 'attention' ? true : undefined,
      hasGroup: query.scope && query.scope !== 'all' ? query.scope === 'apps' : undefined,
    };
    const metadata = await store.query({ ...filter, limit: 0 });
    const fingerprint = hash([
      path.resolve(projectRoot),
      query.kind ?? 'all',
      query.status ?? 'all',
      query.applicationId ?? '',
      query.q ?? '',
      query.scope ?? 'all',
      metadata.generation,
    ]);
    let offset = 0;
    if (query.cursor) {
      try {
        if (query.cursor.length > 8192) throw new Error();
        const parsed = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        if (
          parsed.schema !== 'comet.dashboard.application-cursor.v1' ||
          !Number.isSafeInteger(parsed.offset) ||
          parsed.offset < 0 ||
          parsed.offset > metadata.total
        )
          throw new Error();
        if (parsed.fingerprint !== fingerprint)
          throw new DashboardApplicationQueryError(
            '运行记录已变化，请重新读取当前页',
            409,
            'STALE_APPLICATION_CURSOR',
          );
        offset = parsed.offset;
      } catch (error) {
        if (error instanceof DashboardApplicationQueryError) throw error;
        throw new DashboardApplicationQueryError('分页游标无效');
      }
    }
    const result = await store.query<ApplicationReference>({ ...filter, limit: pageSize, offset });
    return {
      items: result.items.map((r) => r.summary),
      total: result.total,
      nextCursor:
        offset + pageSize < result.total
          ? Buffer.from(
              JSON.stringify({
                schema: 'comet.dashboard.application-cursor.v1',
                fingerprint,
                offset: offset + pageSize,
              }),
            ).toString('base64url')
          : null,
      fingerprint,
      readAt: new Date().toISOString(),
      errors: result.errors.map((message) => ({ source: 'application' as const, message })),
      indexing: result.indexing,
      indexedCount: result.indexedCount,
      sourceCount: result.sourceCount,
    };
  } catch (error) {
    if (error instanceof DashboardApplicationQueryError) throw error;
    throw new DashboardApplicationQueryError(
      '运行列表缓存不可用，请稍后重试',
      503,
      'APPLICATION_INDEX_UNAVAILABLE',
    );
  }
}

function records(
  entry: Entry,
  childLocators: ReadonlyMap<string, string>,
): DashboardApplicationRecord[] {
  const run = entry.run!;
  const caption = (stepId: string) =>
    entry.summary.kind === 'creator'
      ? (creatorLabels[stepId] ?? [stepId, '创作步骤'])
      : [stepId, '执行步骤'];
  const items: DashboardApplicationRecord[] = [];
  for (const a of run.actions) {
    const child = run.children.find((c) => c.actionId === a.id);
    const [title, phase] = caption(a.stepId);
    items.push({
      id: `action:${a.id}`,
      stepId: a.stepId,
      title,
      phase,
      kind: 'action',
      sequence: run.actionContexts[a.id]?.sequence ?? null,
      status: child && ['pending', 'running'].includes(a.status) ? 'child' : a.status,
      attempt: a.attempt,
      type: a.type,
      active:
        ['pending', 'running', 'unknown'].includes(a.status) ||
        (a.status === 'cancelled' && Boolean(a.claim) && !a.cancellation && !a.executionStop) ||
        (run.status === 'failed' && a.status === 'failed'),
      data: a,
      childRunId: child?.runId ?? null,
      childLocator: child ? (childLocators.get(child.runId) ?? null) : null,
    });
  }
  for (const w of run.waits) {
    const [title, phase] = caption(w.stepId);
    items.push({
      id: `decision:${w.id}`,
      stepId: w.stepId,
      title,
      phase,
      kind: 'decision',
      sequence: w.sequence,
      status: w.status === 'pending' ? 'waiting' : w.status,
      attempt: null,
      type: 'user_decision',
      active: w.status === 'pending',
      data: w,
      childLocator: null,
      childRunId: null,
    });
  }
  for (const w of run.evidenceWaits ?? []) {
    const [title, phase] = caption(w.stepId);
    items.push({
      id: `evidence:${w.id}`,
      stepId: w.stepId,
      title,
      phase,
      kind: 'evidence',
      sequence: w.sequence,
      status:
        w.status === 'pending'
          ? 'evidence'
          : w.status === 'resolved'
            ? 'succeeded'
            : w.status === 'invalidated'
              ? 'stale'
              : w.status,
      attempt: null,
      type: w.kind,
      active: w.status === 'pending',
      data: w,
      childLocator: null,
      childRunId: null,
    });
  }
  for (const [index, token] of run.ready.entries()) {
    const [title, phase] = caption(token.to);
    items.push({
      id: `ready:${hash(token)}:${index}`,
      stepId: token.to,
      title,
      phase,
      kind: 'ready',
      sequence: null,
      status: 'pending',
      attempt: null,
      type: 'ready',
      active: true,
      data: token,
      childLocator: null,
      childRunId: null,
    });
  }
  return items.sort(
    (a, b) =>
      (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER) ||
      a.id.localeCompare(b.id),
  );
}
function artifacts(
  entry: Entry,
  items: DashboardApplicationRecord[],
  materialize = true,
): DashboardApplicationArtifact[] {
  const result: DashboardApplicationArtifact[] = [];
  const occurrences = new Map<string, number>();
  const append = (
    label: string,
    recordId: string | null,
    uri: string | null,
    sha256: string | null,
    value?: unknown,
  ) => {
    const identity = hash([label, recordId, uri, sha256]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    result.push({
      id: hash([identity, occurrence]),
      label,
      recordId,
      uri,
      sha256,
      ...(value === undefined
        ? {}
        : { value: materialize ? sanitizeApplicationObservation(value) : value }),
    });
  };
  for (const record of items) {
    const data = object(record.data);
    for (const [index, outcome] of [
      object(data.outcome),
      ...(Array.isArray(data.rejectedOutcomes)
        ? data.rejectedOutcomes.map((r) => object(object(r).outcome))
        : []),
    ].entries()) {
      if (Array.isArray(outcome.artifacts))
        for (const item of outcome.artifacts) {
          const ref = object(item);
          if (text(ref.uri))
            append(path.basename(String(ref.uri)), record.id, text(ref.uri), text(ref.sha256));
        }
      if (outcome.output !== undefined)
        append(
          `${record.stepId}${index ? '-rejected-' + index : ''}-output.json`,
          record.id,
          null,
          null,
          outcome.output,
        );
    }
    const receipt = object(data.receipt);
    if (text(receipt.ref))
      append(
        path.basename(String(receipt.ref)),
        record.id,
        text(receipt.ref),
        text(receipt.contentHash),
      );
  }
  for (const [stepId, output] of Object.entries(entry.run!.outputs))
    append(`${stepId}-result.json`, null, null, null, output.value);
  if (entry.summary.kind === 'creator')
    for (const [ref, value] of Object.entries(
      object(object(object(entry.run!.outputs.prepare?.value).plan).documents),
    )) {
      if (typeof value === 'string') append(ref, null, null, hash(value), value);
    }
  return result;
}
const emptyEvidence = (
  kind: DashboardApplicationEvidence['kind'],
  identity: DashboardApplicationIdentity | null,
): DashboardApplicationEvidence => ({
  kind,
  status: 'not-recorded',
  version: identity?.version ?? null,
  contentHash: identity?.contentHash ?? identity?.packageHash ?? null,
  sourceLocator: null,
  sourceRunId: null,
  report: null,
  evalRunId: null,
  summary:
    kind === 'host'
      ? '没有独立宿主验证记录；本地校验和模型评估不能替代宿主验收'
      : '当前固定内容没有此类验证记录',
  details: null,
});

async function evidence(
  projectRoot: string,
  entry: Entry,
  all: Entry[],
  material: Awaited<ReturnType<typeof inspectWorkflowApplicationMaterial>> | null,
) {
  const identity = entry.summary.application;
  const available = all.filter(
    (e) => e.creator && e.run && e.summary.application?.id === identity?.id,
  );
  const packageHash = entry.creator
    ? identity?.packageHash
    : material?.status === 'matched'
      ? material.packageHash
      : null;
  const current = entry.creator
    ? entry
    : available.find(
        (e) =>
          e.summary.application?.version === identity?.version &&
          e.summary.application?.packageHash === packageHash,
      );
  const local = emptyEvidence('local', identity);
  if (current?.run) {
    const record = object(current.run.outputs.verify?.value);
    const action = current.run.actions.filter((a) => a.stepId === 'verify').at(-1);
    if (record.packageHash && record.packageHash === packageHash) {
      local.status = 'passed';
      local.summary = record.artifactVerification
        ? '本地应用与阶段产物的正常、异常样例验收已完成'
        : '本地应用、固定依赖与 Runtime 契约校验已完成';
      local.details = sanitizeApplicationObservation(record);
    } else if (action?.status === 'failed') {
      local.status = 'failed';
      local.summary = action.reason ?? action.outcome?.summary ?? '本地校验失败';
      local.details = sanitizeApplicationObservation(action.outcome);
    }
    if (local.status !== 'not-recorded') {
      local.sourceLocator = current.summary.locator;
      local.sourceRunId = current.summary.runId;
      local.contentHash = packageHash ?? null;
    }
  }
  const model = emptyEvidence('model', identity);
  if (identity && packageHash) {
    try {
      const result = await readApplicationEvaluationEvidence(projectRoot, identity.id, packageHash);
      model.status = result.status === 'not-evaluated' ? 'not-recorded' : result.status;
      model.summary = result.limitations.join('；') || '模型评估报告已绑定当前应用内容';
      model.report = result.report ?? null;
      model.details = sanitizeApplicationObservation(result);
    } catch (error) {
      model.status = 'unavailable';
      model.summary = error instanceof Error ? error.message : String(error);
    }
  }
  if (current?.run) {
    const result = object(current.run.outputs.evaluate?.value);
    const resultIdentity = object(result.application);
    const selection = current.run.waits.filter((w) => w.stepId === 'confirm-eval').at(-1);
    if (
      !model.report &&
      resultIdentity.contentHash === packageHash &&
      resultIdentity.id === identity?.id &&
      ['passed', 'failed', 'incomplete'].includes(String(result.status))
    ) {
      model.status = result.status as 'passed' | 'failed' | 'incomplete';
      model.details = sanitizeApplicationObservation(result);
      model.summary = '模型评估结果绑定当前候选';
      const experimentId = text(result.experimentId);
      if (!experimentId || !/^[A-Za-z0-9_-]{1,200}$/u.test(experimentId)) {
        model.status = 'stale';
        model.summary = '原 Eval 报告缺少有效实验身份，不能用于当前候选';
      } else {
        const ref = `.comet/eval/runs/${experimentId}/application-result.json`;
        try {
          const bytes = (
            await readProtectedProjectFile(projectRoot, ref, 2 * 1024 * 1024, {
              label: 'Creator Eval 报告',
            })
          ).bytes;
          if (hash(JSON.parse(bytes.toString('utf8'))) !== hash(result))
            throw new Error('原 Eval 报告内容已变化');
          model.report = path.join(projectRoot, '.comet/eval/runs', experimentId, 'summary.md');
        } catch (error) {
          model.status = 'stale';
          model.summary = error instanceof Error ? error.message : String(error);
        }
      }
    }
    if (selection?.decision?.choice === 'skip' && model.status === 'not-recorded') {
      model.status = 'skipped';
      model.summary = '本次创作明确跳过模型评估';
    }
    if (model.status !== 'not-recorded') {
      model.sourceLocator = current.summary.locator;
      model.sourceRunId = current.summary.runId;
      model.contentHash = packageHash ?? null;
    }
  }
  if (entry.creator && material && material.status !== 'matched') {
    if (['passed', 'failed', 'incomplete'].includes(local.status)) {
      local.status = 'stale';
      local.summary = '原本地校验结果保留，当前候选包已变化或无法读取';
    }
    if (['passed', 'failed', 'incomplete'].includes(model.status)) {
      model.status = 'stale';
      model.summary = '原模型评估结果保留，当前候选包已变化或无法读取';
    }
  }
  if (model.report) {
    const ref = path.relative(projectRoot, model.report).replaceAll('\\', '/');
    const match = /^\.comet\/eval\/runs\/([^/]+)\/(?:summary\.md|summary\.html)$/u.exec(ref);
    if (match) {
      const linked = await readEvalRun(projectRoot, match[1]).catch(() => null);
      if (linked) model.evalRunId = match[1];
    }
  }
  const other: DashboardApplicationEvidence[] = available
    .filter((e) => e !== current)
    .flatMap((e) => {
      const result: DashboardApplicationEvidence[] = [];
      if (e.run?.outputs.verify)
        result.push({
          ...emptyEvidence('local', e.summary.application),
          status: 'stale',
          sourceLocator: e.summary.locator,
          sourceRunId: e.summary.runId,
          summary: '这份本地校验属于其他候选内容，不能用于当前版本',
          details: sanitizeApplicationObservation(e.run.outputs.verify.value),
        });
      if (e.run?.outputs.evaluate)
        result.push({
          ...emptyEvidence('model', e.summary.application),
          status: 'stale',
          sourceLocator: e.summary.locator,
          sourceRunId: e.summary.runId,
          summary: '原评估结果保留；对应其他版本或候选内容',
          details: sanitizeApplicationObservation(e.run.outputs.evaluate.value),
        });
      return result;
    });
  return {
    evidence: [local, model, emptyEvidence('host', identity)],
    otherEvidence: other,
    sourceCreators:
      current?.creator && current.summary.runId && current.summary.application
        ? [
            {
              locator: current.summary.locator,
              runId: current.summary.runId,
              version: current.summary.application.version,
            },
          ]
        : [],
  };
}

/** 分发只使用保存的完整应用身份，不接受浏览器指定源文件，也不推进 Run。 */
export async function collectDashboardApplicationDeliverySource(
  projectRoot: string,
  locator: string,
) {
  if (!/^(?:creator|application):[a-f0-9]{64}$/u.test(locator))
    throw new DashboardApplicationQueryError('运行记录定位信息无效');
  const entry = (await detailDataset(projectRoot, locator)).entries.find(
    (e) => e.summary.locator === locator,
  );
  if (!entry) throw new DashboardApplicationQueryError('运行记录不存在', 404);
  if (
    entry.archive ||
    !entry.run ||
    !entry.summary.application ||
    (entry.creator && (entry.run.status !== 'completed' || !entry.run.outputs.install))
  )
    throw new DashboardApplicationQueryError(
      '历史实验和未完成创作不能分发，请先在 Agent 中完成创作',
      409,
    );
  const fixed = entry.application?.record?.application;
  const compiled = object(entry.run.outputs.compile?.value);
  const file = fixed ? path.join(fixed.packageRoot, 'application.json') : text(compiled.file);
  if (!file) throw new DashboardApplicationQueryError('找不到完整应用包', 409);
  if (!fixed) {
    const relative = path.relative(path.resolve(projectRoot), path.resolve(file));
    await inspectProtectedProjectPath(projectRoot, relative.replaceAll('\\', '/'), {
      expected: 'file',
      label: 'Creator 分发候选',
    });
  }
  const material = fixed
    ? await inspectWorkflowApplicationMaterial(fixed)
    : await inspectWorkflowApplicationPackage(
        path.dirname(file),
        entry.summary.application.packageHash ?? '',
      );
  if (material.status !== 'matched' || !material.packageHash)
    throw new DashboardApplicationQueryError(
      '应用内容已变化或不可读取，请重新完成创作并选择固定版本',
      409,
    );
  return {
    file,
    id: entry.summary.application.id,
    version: entry.summary.application.version,
    contentHash: material.packageHash,
  };
}

export async function collectDashboardApplicationRunDetail(
  projectRoot: string,
  locator: string,
  query: { recordLimit?: number; recordId?: string } = {},
): Promise<DashboardApplicationRunDetail | null> {
  if (!/^(?:creator|application):[a-f0-9]{64}$/u.test(locator))
    throw new DashboardApplicationQueryError('运行记录定位信息无效');
  const data = await detailDataset(projectRoot, locator);
  const entry = data.entries.find(
    (e) =>
      e.summary.locator === locator ||
      (e.creator &&
        e.summary.applicationId &&
        `creator:${hash([e.summary.applicationId, e.summary.runId ?? e.creator.storageKey])}` ===
          locator),
  );
  if (!entry) {
    if (data.errors.length)
      throw new DashboardApplicationQueryError(
        '运行数据源无法读取，保留当前记录后重试',
        503,
        'APPLICATION_SOURCE_UNAVAILABLE',
      );
    return null;
  }
  const empty: DashboardApplicationRunDetail = {
    ...entry.summary,
    readAt: new Date().toISOString(),
    sequence: null,
    workflow: null,
    records: [],
    currentIds: [],
    artifacts: [],
    evidence: [],
    otherEvidence: [],
    definitionStatus: 'unreadable',
    definition: { status: 'missing' },
    material: { status: 'unavailable' },
    fixedIdentity: null,
    sourceCreators: [],
    children: [],
    inspection: null,
    relatedChange: null,
  };
  if (!entry.run) return empty;
  const childLocators = new Map(
    data.entries
      .filter((e) => e.summary.parentLocator === entry.summary.locator && e.summary.runId)
      .map((e) => [e.summary.runId!, e.summary.locator]),
  );
  const run = entry.run,
    allItems = records(entry, childLocators),
    recordPage = page(
      allItems,
      hash([path.resolve(projectRoot), locator, run.revision]),
      undefined,
      limit(query.recordLimit),
    ),
    items = allItems
      .filter((r) => recordPage.items.includes(r) || r.active || r.id === query.recordId)
      .map((r) => ({ ...r, data: sanitizeApplicationObservation(r.data) })),
    fixed = entry.archivedIdentity ?? entry.application?.record?.application ?? null;
  if (entry.archive) {
    const archive = entry.archive.archive;
    let material: Awaited<ReturnType<typeof inspectWorkflowApplicationPackage>>;
    try {
      const ref = `${evalArchiveRoot(archive.id)}/${archive.application.root}/application.json`;
      const inspected = await inspectProtectedProjectPath(projectRoot, ref, {
        expected: 'file',
        label: '归档固定应用',
      });
      material = await inspectWorkflowApplicationPackage(
        path.dirname(inspected.target),
        archive.application.packageHash,
      );
    } catch (error) {
      material = { status: 'unavailable', message: String(error) };
    }
    const identity = entry.summary.application;
    const creator = data.entries.find(
      (e) => e.archive?.archive.id === archive.id && e.summary.kind === 'creator',
    );
    const local = emptyEvidence('local', identity);
    const verify = object(creator?.run?.outputs.verify?.value);
    if (verify.packageHash === archive.application.packageHash) {
      local.status = material.status === 'matched' ? 'passed' : 'stale';
      local.summary = '原 Creator 本地验收记录；归档固定应用内容单独校验';
      local.details = sanitizeApplicationObservation(verify);
      local.sourceLocator = creator!.summary.locator;
      local.sourceRunId = creator!.summary.runId;
    }
    const model = {
      ...emptyEvidence('model', identity),
      status: 'incomplete' as const,
      evalRunId: evalArchiveRunId(archive.id),
      summary: '历史专项复核；业务完成不代表完整应用 Eval 已通过',
      details: sanitizeApplicationObservation(archive.assessment),
    };
    const linked = artifacts(entry, items).map((a) => {
      if (!a.uri) return a;
      const mapped = archive.artifactMappings?.[a.uri];
      return mapped
        ? { ...a, uri: `${evalArchiveRoot(archive.id)}/${mapped}`, sha256: archive.files[mapped] }
        : { ...a, uri: null };
    });
    // 原状态仍保留在 Run 记录中；专项复核另附，不覆盖 Creator 的跳过决定。
    const skipped = creator?.run?.waits.some(
      (w) => w.stepId === 'confirm-eval' && w.decision?.choice === 'skip',
    );
    const definition =
      entry.summary.kind === 'application'
        ? projectDashboardApplicationDefinition({ run, records: allItems, material })
        : { status: 'missing' as const };
    return {
      ...empty,
      sequence: run.sequence,
      workflow: run.workflow,
      records: labelDashboardApplicationRecords(items, definition),
      recordPage: { total: recordPage.total, nextCursor: recordPage.nextCursor },
      currentIds: items.filter((r) => r.active).map((r) => r.id),
      definitionStatus: 'observed',
      definition,
      material: {
        status: material.status,
        ...(material.message ? { message: material.message } : {}),
      },
      fixedIdentity: fixed,
      artifacts: [
        ...linked,
        ...archive.reports.map((r) => ({
          id: hash(['archive-report', archive.id, r.path]),
          label: r.label,
          recordId: null,
          uri: `${evalArchiveRoot(archive.id)}/${r.path}`,
          sha256: archive.files[r.path],
        })),
      ],
      evidence: [local, model, emptyEvidence('host', identity)],
      otherEvidence: skipped
        ? [
            {
              ...emptyEvidence('model', identity),
              status: 'skipped',
              summary: '原 Creator 明确跳过模型评估；专项复核在之后独立执行',
              sourceLocator: creator!.summary.locator,
              sourceRunId: creator!.summary.runId,
            },
          ]
        : [],
      sourceCreators: creator?.summary.runId
        ? [
            {
              locator: creator.summary.locator,
              runId: creator.summary.runId,
              version: archive.application.version,
            },
          ]
        : [],
      children: run.children.map((c) => ({ ...c, locator: childLocators.get(c.runId) ?? null })),
      inspection: null,
    };
  }
  const compiled = object(run.outputs.compile?.value);
  const candidateFile = text(compiled.file);
  let material: Awaited<ReturnType<typeof inspectWorkflowApplicationMaterial>> | null = fixed
    ? await inspectWorkflowApplicationMaterial(fixed)
    : null;
  if (entry.creator && candidateFile && entry.summary.application?.packageHash) {
    const relative = path.relative(path.resolve(projectRoot), path.resolve(candidateFile));
    try {
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`))
        throw new Error('创作候选路径不属于当前项目');
      await inspectProtectedProjectPath(projectRoot, relative.replaceAll('\\', '/'), {
        expected: 'file',
        label: 'Creator 编译候选',
      });
      material = await inspectWorkflowApplicationPackage(
        path.dirname(candidateFile),
        entry.summary.application.packageHash,
      );
    } catch (error) {
      material = {
        status: 'unavailable',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const proof = await evidence(projectRoot, entry, data.entries, material);
  if (data.indexing && !entry.creator) {
    for (const item of proof.evidence)
      if (item.status === 'not-recorded' && item.kind !== 'host') {
        item.status = 'unavailable';
        item.summary = '关联创作记录仍在同步，请稍后刷新。';
      }
  }
  const definition =
    entry.summary.kind === 'application'
      ? projectDashboardApplicationDefinition({ run, records: allItems, material })
      : { status: 'missing' as const };
  const result: DashboardApplicationRunDetail = {
    ...empty,
    ...proof,
    sequence: run.sequence,
    workflow: { id: run.workflow.id, version: run.workflow.version },
    records: labelDashboardApplicationRecords(items, definition),
    recordPage: { total: recordPage.total, nextCursor: recordPage.nextCursor },
    currentIds: items.filter((r) => r.active).map((r) => r.id),
    artifacts: artifacts(entry, items),
    definitionStatus: 'observed',
    definition,
    material: material
      ? { status: material.status, message: material.message }
      : { status: 'not-generated' },
    fixedIdentity: fixed,
    children: run.children.map((c) => ({
      ...c,
      locator: childLocators.get(c.runId) ?? null,
    })),
    inspection:
      entry.summary.kind === 'creator'
        ? {
            commandArgs: [
              'comet',
              'creator',
              'status',
              run.runId,
              '--project',
              path.resolve(projectRoot),
              '--json',
            ],
            request: null,
          }
        : fixed
          ? {
              commandArgs: [
                'comet',
                'runtime',
                'dispatch',
                '--application',
                fixed.id,
                '--project-root',
                path.resolve(projectRoot),
                '--request',
                '<request-json-file>',
                '--json',
              ],
              request: { operation: 'inspect', runId: run.runId },
            }
          : null,
  };
  for (const e of result.evidence)
    if (e.report)
      result.artifacts.push({
        id: hash(['evidence', e.kind, e.report]),
        label: '模型评估报告',
        recordId: null,
        uri: e.report,
        sha256: null,
      });
  if (fixed) {
    const workflow =
      fixed.base === 'native' ? 'native' : fixed.base.startsWith('classic-') ? 'classic' : null;
    if (workflow) {
      const owner = await readChangeRuntimeOwner(projectRoot, workflow, run.runId).catch(
        () => null,
      );
      if (owner?.format === 'sdk' && owner.application === fixed.id && owner.runId === run.runId) {
        const page =
          workflow === 'native'
            ? await collectNativeDashboardChangePage(projectRoot, {
                status: 'all',
                query: run.runId,
              }).catch(() => null)
            : await collectDashboardChangePage(projectRoot, {
                status: 'all',
                query: run.runId,
              }).catch(() => null);
        const match = page?.items.find((item) => item.name === run.runId);
        if (match)
          result.relatedChange = {
            workflow,
            locator: match.locator,
            name: match.name,
            status: match.status,
          };
      }
    }
  }
  return result;
}

export async function collectDashboardApplicationRunRecords(
  projectRoot: string,
  locator: string,
  query: { limit?: number; cursor?: string } = {},
) {
  const size = limit(query.limit);
  if (!/^(?:creator|application):[a-f0-9]{64}$/u.test(locator))
    throw new DashboardApplicationQueryError('运行记录定位信息无效');
  const data = await detailDataset(projectRoot, locator);
  const entry = data.entries.find((item) => item.summary.locator === locator);
  if (!entry?.run) return null;
  const childLocators = new Map(
    data.entries
      .filter((item) => item.summary.runId)
      .map((item) => [item.summary.runId!, item.summary.locator]),
  );
  const fingerprint = hash([path.resolve(projectRoot), locator, entry.run.revision]);
  const allRecords = records(entry, childLocators);
  const selected = page(allRecords, fingerprint, query.cursor, size);
  let material: Awaited<ReturnType<typeof inspectWorkflowApplicationMaterial>> | null = null;
  if (entry.summary.kind === 'application') {
    if (entry.archive) {
      const archive = entry.archive.archive;
      try {
        const inspected = await inspectProtectedProjectPath(
          projectRoot,
          `${evalArchiveRoot(archive.id)}/${archive.application.root}/application.json`,
          { expected: 'file', label: '归档固定应用' },
        );
        material = await inspectWorkflowApplicationPackage(
          path.dirname(inspected.target),
          archive.application.packageHash,
        );
      } catch (error) {
        material = { status: 'unavailable', message: String(error) };
      }
    } else if (entry.application?.record?.application) {
      material = await inspectWorkflowApplicationMaterial(entry.application.record.application);
    }
  }
  const definition = projectDashboardApplicationDefinition({
    run: entry.run,
    records: allRecords,
    material,
  });
  const items = labelDashboardApplicationRecords(selected.items, definition).map((record) => ({
    ...record,
    data: sanitizeApplicationObservation(record.data),
  }));
  return {
    ...selected,
    items,
    artifacts: artifacts(entry, items),
    locator,
    revision: entry.run.revision,
    readAt: new Date().toISOString(),
  };
}

/** 用户选择的是已绑定的工件身份；API 不接受任意文件路径。 */
export async function readDashboardApplicationArtifact(
  projectRoot: string,
  locator: string,
  artifactId: string,
) {
  const data = await detailDataset(projectRoot, locator);
  const entry = data.entries.find((item) => item.summary.locator === locator);
  if (!entry?.run) return null;
  const detail = await collectDashboardApplicationRunDetail(projectRoot, locator, {
    recordLimit: 1,
  });
  if (!detail) return null;
  const artifact =
    artifacts(entry, records(entry, new Map()), false).find((a) => a.id === artifactId) ??
    detail.artifacts.find((a) => a.id === artifactId);
  if (!artifact)
    throw new DashboardApplicationQueryError('当前记录没有这个工件', 404, 'ARTIFACT_NOT_FOUND');
  if (artifact.value !== undefined) {
    const source =
      typeof artifact.value === 'string'
        ? artifact.value
        : JSON.stringify(sanitizeApplicationObservation(artifact.value), null, 2);
    return {
      key: artifact.id,
      label: artifact.label,
      path: artifact.label,
      exists: true,
      content: source.slice(0, 256 * 1024),
      truncated: source.length > 256 * 1024,
      status: 'recorded',
      sha256: artifact.sha256,
    };
  }
  if (!artifact.uri) throw new DashboardApplicationQueryError('工件缺少可读取引用');
  if (detail.archive) {
    const archives = await listEvalArchives(projectRoot);
    const archive = archives.items.find((item) => item.archive.id === detail.archive!.id)?.archive;
    if (!archive) throw new DashboardApplicationQueryError('历史归档无法读取', 409);
    const prefix = `${evalArchiveRoot(archive.id)}/`;
    if (!artifact.uri.startsWith(prefix))
      throw new DashboardApplicationQueryError('工件引用超出归档范围', 403);
    const bytes = await readEvalArchiveFile(
      projectRoot,
      archive,
      artifact.uri.slice(prefix.length),
    );
    const content = bytes.toString('utf8');
    return {
      key: artifact.id,
      label: artifact.label,
      path: artifact.uri,
      exists: true,
      content: content.slice(0, 256 * 1024),
      truncated: content.length > 256 * 1024,
      status: 'matched',
      sha256: artifact.sha256,
    };
  }
  if (
    /^[a-z][a-z\d+.-]*:/iu.test(artifact.uri) &&
    !artifact.uri.startsWith('file:') &&
    !/^[A-Za-z]:[\\/]/u.test(artifact.uri)
  )
    throw new DashboardApplicationQueryError('工件引用不是本地文件');
  let target: string;
  try {
    target = artifact.uri.startsWith('file:')
      ? fileURLToPath(artifact.uri)
      : path.resolve(projectRoot, artifact.uri);
  } catch {
    throw new DashboardApplicationQueryError('工件引用不是本地文件');
  }
  const roots = [
    path.resolve(projectRoot),
    ...(detail.fixedIdentity ? [detail.fixedIdentity.packageRoot] : []),
  ];
  const root = roots.find((r) => {
    const rel = path.relative(r, target);
    return rel !== '' && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`);
  });
  if (!root)
    throw new DashboardApplicationQueryError(
      '工件引用超出项目与固定应用包范围',
      403,
      'ARTIFACT_OUTSIDE_ROOT',
    );
  const ref = path.relative(root, target).replaceAll('\\', '/');
  try {
    const file = await readProtectedProjectFile(root, ref, 2 * 1024 * 1024, {
      label: 'Dashboard application artifact',
    });
    const digest = createHash('sha256').update(file.bytes).digest('hex');
    const source = file.bytes.toString('utf8');
    return {
      key: artifact.id,
      label: artifact.label,
      path: target,
      exists: true,
      content: source.slice(0, 256 * 1024),
      truncated: source.length > 256 * 1024,
      status: artifact.sha256 && digest !== artifact.sha256 ? 'changed' : 'matched',
      sha256: artifact.sha256,
      currentHash: digest,
    };
  } catch (error) {
    return {
      key: artifact.id,
      label: artifact.label,
      path: target,
      exists: false,
      status: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
