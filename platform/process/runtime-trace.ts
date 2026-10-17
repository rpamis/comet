import { AsyncLocalStorage } from 'node:async_hooks';
import { access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { openSqliteDatabase } from '../fs/sqlite.js';
import { runtimeObservabilityDatabasePath } from './runtime-observability-store.js';
import { redactCommandOutput } from './redact-command-output.js';

export interface RuntimeTraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  workflow: 'native' | 'classic';
  change: string;
  runId: string;
  kind: 'workflow' | 'action' | 'wait' | 'evidence' | 'command' | 'check' | 'retrieval';
  name: string;
  status: 'pending' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
  revision: number;
  attempt?: number;
  summary?: string;
  attributes?: Record<string, string | number | boolean | string[] | null>;
}

const DAY = 86400000;
const MAX_SPANS = 10000;
interface TraceContext {
  traceId: string;
  spanId: string;
  binding: { workflow: 'native' | 'classic'; change?: string; runId?: string };
  spans: RuntimeTraceSpan[];
  startedAt: string;
  kind: 'command' | 'check' | 'retrieval';
  name: string;
  projectRoot: () => string | Promise<string>;
  parent?: TraceContext;
}
const context = new AsyncLocalStorage<TraceContext>();

/** 只关联已经由调用方验证的 Run 身份，不读取工作流状态或创建观测文件。 */
export function bindRuntimeTrace(binding: {
  workflow: 'native' | 'classic';
  change: string;
  runId: string;
}): void {
  const current = context.getStore();
  if (
    current &&
    current.binding.workflow === binding.workflow &&
    (!current.binding.runId || current.binding.runId === binding.runId)
  )
    Object.assign(current.binding, binding);
}

function safeText(value: string, limit: number): string {
  return redactCommandOutput(value).slice(0, limit);
}

/** SQLite 中只保存有界的观测副本；同一节点的旧版本不能覆盖较新结果。 */
export async function recordRuntimeTraceSpans(projectRoot: string, spans: RuntimeTraceSpan[]) {
  if (!spans.length) return;
  const db = openSqliteDatabase(await runtimeObservabilityDatabasePath(projectRoot, true));
  try {
    db.exec(`PRAGMA busy_timeout=25; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS trace_spans (
        id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, workflow TEXT NOT NULL,
        change_name TEXT NOT NULL, run_id TEXT NOT NULL, span_id TEXT NOT NULL,
        parent_span_id TEXT, kind TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL,
        started_at TEXT, ended_at TEXT, updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS trace_spans_time ON trace_spans(updated_at);
      CREATE INDEX IF NOT EXISTS trace_spans_trace ON trace_spans(trace_id);
      BEGIN IMMEDIATE;`);
    const insert = db.prepare(`INSERT INTO trace_spans VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=CASE WHEN excluded.revision >= trace_spans.revision THEN excluded.status ELSE trace_spans.status END,
      started_at=COALESCE(trace_spans.started_at,excluded.started_at),
      ended_at=CASE WHEN excluded.revision < trace_spans.revision THEN trace_spans.ended_at
        WHEN excluded.status IN ('running','pending','waiting','unknown') THEN NULL
        ELSE COALESCE(trace_spans.ended_at,excluded.ended_at) END, updated_at=MAX(trace_spans.updated_at,excluded.updated_at),
      revision=MAX(trace_spans.revision,excluded.revision),
      data=CASE WHEN excluded.revision >= trace_spans.revision THEN excluded.data ELSE trace_spans.data END
      WHERE excluded.revision >= trace_spans.revision OR (trace_spans.started_at IS NULL AND excluded.started_at IS NOT NULL)`);
    const selected =
      spans.length > 1000
        ? [
            ...spans.filter((span) => span.parentSpanId === null),
            ...spans.filter((span) => span.parentSpanId !== null).slice(-999),
          ].slice(0, 1000)
        : spans;
    for (const span of selected) {
      if (
        !span.change ||
        !span.runId ||
        !span.traceId ||
        !span.spanId ||
        span.change.length > 240 ||
        span.runId.length > 240 ||
        span.traceId.length > 512 ||
        span.spanId.length > 512 ||
        (span.parentSpanId?.length ?? 0) > 512
      )
        continue;
      const safe = {
        ...span,
        name: safeText(span.name, 240),
        summary: span.summary ? safeText(span.summary, 1000) : undefined,
        attributes: Object.fromEntries(
          Object.entries(span.attributes ?? {})
            .slice(0, 20)
            .map(([key, value]) => [
              safeText(key, 80),
              Array.isArray(value)
                ? value.slice(0, 30).map((item) => safeText(item, 240))
                : typeof value === 'string'
                  ? safeText(value, 2000)
                  : value,
            ]),
        ),
      };
      if (spans.length > 1000 && span.parentSpanId === null) safe.attributes.truncated = true;
      let payload = JSON.stringify(safe);
      while (Buffer.byteLength(payload, 'utf8') > 4096) {
        const key = Object.keys(safe.attributes)
          .reverse()
          .find((name) => name !== 'truncated');
        if (key) delete safe.attributes[key];
        else if (safe.summary)
          safe.summary = safe.summary.slice(0, Math.floor(safe.summary.length * 0.75));
        else break;
        payload = JSON.stringify(safe);
      }
      if (Buffer.byteLength(payload, 'utf8') > 4096) continue;
      const id = createHash('sha256')
        .update(JSON.stringify([span.traceId, span.spanId]))
        .digest('hex');
      insert.run(
        id,
        span.traceId,
        span.workflow,
        span.change,
        span.runId,
        span.spanId,
        span.parentSpanId,
        span.kind,
        safe.name,
        span.status,
        span.startedAt,
        span.endedAt,
        span.updatedAt,
        span.revision,
        payload,
      );
    }
    db.prepare('DELETE FROM trace_spans WHERE updated_at < ?').run(
      new Date(Date.now() - 7 * DAY).toISOString(),
    );
    db.prepare(
      'DELETE FROM trace_spans WHERE id IN (SELECT id FROM trace_spans ORDER BY updated_at DESC, id DESC LIMIT -1 OFFSET ?)',
    ).run(MAX_SPANS);
    db.exec('COMMIT');
  } finally {
    db.close();
  }
}

export async function readRuntimeTraceSpans(
  projectRoot: string,
  options: { traceId?: string; limit?: number } = {},
) {
  const limit = Math.max(1, Math.min(5000, options.limit ?? 5000));
  const empty = { spans: [] as RuntimeTraceSpan[], truncated: false, days: 7, limit };
  let file: string;
  try {
    file = await runtimeObservabilityDatabasePath(projectRoot, false);
    await access(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty;
    throw error;
  }
  const db = openSqliteDatabase(file, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=25');
    if (
      !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trace_spans'").get()
    )
      return empty;
    const rows = db
      .prepare(
        `SELECT data,started_at,ended_at FROM trace_spans
      WHERE updated_at >= ? AND updated_at <= ? ${options.traceId ? 'AND trace_id = ?' : ''}
      ORDER BY updated_at DESC,id DESC LIMIT ?`,
      )
      .all(
        new Date(Date.now() - 7 * DAY).toISOString(),
        new Date().toISOString(),
        ...(options.traceId ? [options.traceId] : []),
        limit + 1,
      ) as { data: string; started_at: string | null; ended_at: string | null }[];
    return {
      ...empty,
      truncated: rows.length > limit,
      spans: rows.slice(0, limit).map((row) => ({
        ...(JSON.parse(row.data) as RuntimeTraceSpan),
        startedAt: row.started_at,
        endedAt: row.ended_at,
      })),
    };
  } finally {
    db.close();
  }
}

/** 同一工作区的嵌套命令和检查共享 trace；保存失败不改变原操作的结果或异常。 */
export async function observeRuntimeSpan<T>(
  options: {
    projectRoot: () => string | Promise<string>;
    workflow: 'native' | 'classic';
    kind: 'command' | 'check' | 'retrieval';
    name: string;
    change?: string;
    runId?: string;
    status?: (value: T) => RuntimeTraceSpan['status'];
  },
  operation: () => Promise<T>,
): Promise<T> {
  const inherited = context.getStore();
  let parent = inherited?.binding.workflow === options.workflow ? inherited : undefined;
  if (parent) {
    try {
      const roots = await Promise.all([options.projectRoot(), parent.projectRoot()]);
      const keys = roots.map((root) => {
        const absolute = path.resolve(root);
        return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
      });
      if (
        keys[0] !== keys[1] ||
        (options.runId && parent.binding.runId && options.runId !== parent.binding.runId)
      )
        parent = undefined;
    } catch {
      parent = undefined;
    }
  }
  const startedAt = new Date().toISOString();
  const current: TraceContext = {
    traceId: parent?.traceId ?? randomUUID(),
    spanId: randomUUID(),
    binding: parent?.binding ?? {
      workflow: options.workflow,
      change: options.change,
      runId: options.runId,
    },
    spans: parent?.spans ?? [],
    startedAt,
    kind: options.kind,
    name: options.name,
    projectRoot: options.projectRoot,
    parent,
  };
  if (current.binding.change && current.binding.runId) {
    const started: RuntimeTraceSpan[] = [];
    for (let frame: TraceContext | undefined = current; frame; frame = frame.parent)
      started.push({
        traceId: frame.traceId,
        spanId: frame.spanId,
        parentSpanId: frame.parent?.spanId ?? null,
        workflow: current.binding.workflow,
        change: current.binding.change,
        runId: current.binding.runId,
        kind: frame.kind,
        name: frame.name,
        status: 'running',
        startedAt: frame.startedAt,
        endedAt: null,
        updatedAt: startedAt,
        revision: 0,
      });
    try {
      await recordRuntimeTraceSpans(await options.projectRoot(), started);
    } catch {
      /* 保持原执行路径。 */
    }
  }
  let value: T | undefined;
  let error: unknown;
  let failed = false;
  try {
    value = await context.run(current, operation);
  } catch (caught) {
    failed = true;
    error = caught;
  }
  const endedAt = new Date().toISOString();
  let status: RuntimeTraceSpan['status'] = failed ? 'failed' : 'succeeded';
  try {
    if (!failed && options.status) status = options.status(value!);
  } catch {
    status = 'unknown';
  }
  if (current.binding.change && current.binding.runId) {
    current.spans.push({
      traceId: current.traceId,
      spanId: current.spanId,
      parentSpanId: parent?.spanId ?? null,
      workflow: current.binding.workflow,
      change: current.binding.change,
      runId: current.binding.runId,
      kind: options.kind,
      name: options.name,
      startedAt,
      endedAt,
      updatedAt: endedAt,
      revision: 1,
      status,
    });
  }
  if (!parent && current.spans.length) {
    try {
      await recordRuntimeTraceSpans(await options.projectRoot(), current.spans);
    } catch {
      /* 观测失败不影响执行。 */
    }
  }
  if (failed) throw error;
  return value!;
}

/** 只有已建立 Change 归属的执行上下文才采集插件子节点。 */
export function observeRuntimeChildSpan<T>(
  name: string,
  operation: () => Promise<T>,
  status?: (value: T) => RuntimeTraceSpan['status'],
): Promise<T> {
  const parent = context.getStore();
  if (!parent) return operation();
  return observeRuntimeSpan(
    {
      projectRoot: parent.projectRoot,
      workflow: parent.binding.workflow,
      kind: 'retrieval',
      name,
      status,
    },
    operation,
  );
}
