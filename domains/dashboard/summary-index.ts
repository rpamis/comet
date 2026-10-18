import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolveDashboardIndexPath } from './index-store.js';

export interface DashboardSummaryRecord {
  key: string;
  sortKey: string;
  search: string;
  status: string;
  kind?: string;
  group?: string | null;
  attention?: boolean;
  volatile?: boolean;
  payload: unknown;
}
export interface DashboardSummarySource {
  key: string;
  fingerprint: string;
  read(): Promise<DashboardSummaryRecord[]>;
}
interface IndexMetadata {
  sourceCount: number;
  indexedCount: number;
  indexing: boolean;
  errors: string[];
  generation: string;
}
export interface DashboardSummaryQuery {
  limit?: number;
  offset?: number;
  search?: string;
  statuses?: string[];
  kind?: string;
  group?: string;
  hasGroup?: boolean;
  attention?: boolean;
  keys?: string[];
  descending?: boolean;
}
const inFlight = new Map<string, Promise<void>>();
const lastRefreshFinished = new Map<string, number>();
const dirty = new Set<string>();
const scheduled = new Set<string>();
export class DashboardSummaryIndexError extends Error {}
export function markDashboardSummaryIndexDirty(projectRoot: string, namespace: string): void {
  dirty.add(`${resolveDashboardIndexPath(projectRoot)}:${namespace}`);
}

/** Rebuildable display summaries. Callers retain authority over reads and mutations. */
export class DashboardSummaryIndex {
  readonly databasePath: string;
  private readonly lockKey: string;
  constructor(
    private readonly options: {
      projectRoot: string;
      namespace: string;
      cacheRoot?: string;
      refreshIntervalMs?: number;
      discover(): Promise<DashboardSummarySource[]>;
    },
  ) {
    this.databasePath = resolveDashboardIndexPath(options.projectRoot, options.cacheRoot);
    this.lockKey = `${this.databasePath}:${options.namespace}`;
  }

  private async database<T>(operation: (db: DatabaseSync) => T): Promise<T> {
    let db: DatabaseSync | null = null;
    try {
      await fs.mkdir(path.dirname(this.databasePath), { recursive: true });
      db = new DatabaseSync(this.databasePath);
      db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=100;');
      db.exec(`CREATE TABLE IF NOT EXISTS dashboard_summary_sources (namespace TEXT NOT NULL, source_key TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(namespace,source_key));
        CREATE TABLE IF NOT EXISTS dashboard_summary_rows (namespace TEXT NOT NULL, record_key TEXT NOT NULL, source_key TEXT NOT NULL, sort_key TEXT NOT NULL, search TEXT NOT NULL, status TEXT NOT NULL, kind TEXT NOT NULL, group_id TEXT, attention INTEGER NOT NULL, volatile INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(namespace,record_key));
        CREATE INDEX IF NOT EXISTS dashboard_summary_source ON dashboard_summary_rows(namespace,source_key);
        CREATE INDEX IF NOT EXISTS dashboard_summary_order ON dashboard_summary_rows(namespace,sort_key);
        CREATE INDEX IF NOT EXISTS dashboard_summary_status ON dashboard_summary_rows(namespace,status,sort_key);
        CREATE INDEX IF NOT EXISTS dashboard_summary_group ON dashboard_summary_rows(namespace,group_id);
        CREATE TABLE IF NOT EXISTS dashboard_summary_meta (namespace TEXT PRIMARY KEY, payload TEXT NOT NULL);`);
      return operation(db);
    } catch (error) {
      throw new DashboardSummaryIndexError('Dashboard 列表缓存不可用', { cause: error });
    } finally {
      db?.close();
    }
  }

  async refresh(options: { maxSources?: number; budgetMs?: number } = {}): Promise<void> {
    const existing = inFlight.get(this.lockKey);
    if (existing) return existing;
    const task = this.refreshSources(options)
      .catch(async (error) => {
        try {
          const metadata = await this.metadata();
          if (metadata)
            await this.database((db) =>
              db.prepare('UPDATE dashboard_summary_meta SET payload=? WHERE namespace=?').run(
                JSON.stringify({
                  ...metadata,
                  indexing: false,
                  errors: [error instanceof Error ? error.message : String(error)],
                }),
                this.options.namespace,
              ),
            );
        } catch {
          // Keep the original refresh error when the cache cannot record it.
        }
        throw error;
      })
      .finally(() => {
        lastRefreshFinished.set(this.lockKey, Date.now());
        inFlight.delete(this.lockKey);
      });
    inFlight.set(this.lockKey, task);
    dirty.delete(this.lockKey);
    return task;
  }

  private async refreshSources(options: { maxSources?: number; budgetMs?: number }): Promise<void> {
    const deadline = Date.now() + (options.budgetMs ?? Infinity);
    const sources = await this.options.discover();
    const cached = await this.database(
      (db) =>
        new Map(
          (
            db
              .prepare(
                `SELECT s.source_key, s.fingerprint, COALESCE(MAX(r.volatile),0) AS volatile FROM dashboard_summary_sources s LEFT JOIN dashboard_summary_rows r ON r.namespace=s.namespace AND r.source_key=s.source_key WHERE s.namespace=? GROUP BY s.source_key`,
              )
              .all(this.options.namespace) as {
              source_key: string;
              fingerprint: string;
              volatile: number;
            }[]
          ).map((s) => [s.source_key, s]),
        ),
    );
    const changed = sources
      .filter(
        (source) =>
          cached.get(source.key)?.fingerprint !== source.fingerprint ||
          cached.get(source.key)?.volatile === 1,
      )
      .sort((a, b) => Number(cached.has(a.key)) - Number(cached.has(b.key)));
    const updates: { source: DashboardSummarySource; records: DashboardSummaryRecord[] }[] = [];
    const errors: string[] = [];
    let attempted = 0;
    while (attempted < changed.length) {
      if (
        attempted >= (options.maxSources ?? Infinity) ||
        (attempted > 0 && Date.now() >= deadline)
      )
        break;
      // 有预算时先读一个来源保障进展；其后每批最多四个，并等待整批完成。
      const concurrency = options.budgetMs !== undefined && attempted === 0 ? 1 : 4;
      const batch = changed
        .slice(attempted, attempted + concurrency)
        .filter((_source, index) => !(attempted + index >= (options.maxSources ?? Infinity)));
      attempted += batch.length;
      const results = await Promise.all(
        batch.map(async (source) => {
          try {
            return { ok: true as const, source, records: await source.read() };
          } catch (error) {
            return {
              ok: false as const,
              error: `${source.key}: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        }),
      );
      // Promise.all 保持发现顺序，完成先后不会改变覆盖顺序或错误列表。
      for (const result of results) {
        if (result.ok) updates.push({ source: result.source, records: result.records });
        else errors.push(result.error);
      }
    }
    const present = new Set(sources.map((s) => s.key));
    await this.database((db) => {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const removeRows = db.prepare(
          'DELETE FROM dashboard_summary_rows WHERE namespace=? AND source_key=?',
        );
        const removeSource = db.prepare(
          'DELETE FROM dashboard_summary_sources WHERE namespace=? AND source_key=?',
        );
        let removed = false;
        for (const key of cached.keys())
          if (!present.has(key)) {
            removed = true;
            removeRows.run(this.options.namespace, key);
            removeSource.run(this.options.namespace, key);
          }
        const insert = db.prepare(
          'INSERT OR REPLACE INTO dashboard_summary_rows VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        );
        const sourceStatement = db.prepare(
          'INSERT OR REPLACE INTO dashboard_summary_sources VALUES (?,?,?)',
        );
        for (const { source, records } of updates) {
          removeRows.run(this.options.namespace, source.key);
          for (const record of records)
            insert.run(
              this.options.namespace,
              record.key,
              source.key,
              record.sortKey,
              record.search.toLocaleLowerCase(),
              record.status,
              record.kind ?? '',
              record.group ?? null,
              Number(Boolean(record.attention)),
              Number(Boolean(record.volatile)),
              JSON.stringify(record.payload),
            );
          sourceStatement.run(this.options.namespace, source.key, source.fingerprint);
        }
        const indexed = db
          .prepare('SELECT COUNT(*) AS count FROM dashboard_summary_sources WHERE namespace=?')
          .get(this.options.namespace) as { count: number };
        const previous = db
          .prepare('SELECT payload FROM dashboard_summary_meta WHERE namespace=?')
          .get(this.options.namespace) as { payload: string } | undefined;
        const previousGeneration = previous
          ? (JSON.parse(previous.payload) as IndexMetadata).generation
          : undefined;
        const generation =
          !removed && updates.length === 0 && previousGeneration
            ? previousGeneration
            : createHash('sha256')
                .update(
                  JSON.stringify(
                    db
                      .prepare(
                        'SELECT record_key,payload FROM dashboard_summary_rows WHERE namespace=? ORDER BY record_key',
                      )
                      .all(this.options.namespace),
                  ),
                )
                .digest('hex');
        const metadata: IndexMetadata = {
          sourceCount: sources.length,
          indexedCount: indexed.count,
          indexing: attempted < changed.length,
          errors,
          generation,
        };
        db.prepare('INSERT OR REPLACE INTO dashboard_summary_meta VALUES (?,?)').run(
          this.options.namespace,
          JSON.stringify(metadata),
        );
        db.exec('COMMIT;');
      } catch (error) {
        db.exec('ROLLBACK;');
        throw error;
      }
    });
  }

  async ensure({ fresh = false } = {}): Promise<void> {
    const metadata = await this.metadata();
    if (fresh) return this.refresh();
    if (!metadata || dirty.has(this.lockKey)) await this.refresh({ maxSources: 20, budgetMs: 500 });
    const current = await this.metadata();
    if (
      current?.indexing ||
      Date.now() - (lastRefreshFinished.get(this.lockKey) ?? 0) >=
        (this.options.refreshIntervalMs ?? 5000)
    ) {
      if (!scheduled.has(this.lockKey) && !inFlight.has(this.lockKey)) {
        scheduled.add(this.lockKey);
        const timer = setTimeout(() => {
          void this.refresh()
            .catch(() => undefined)
            .finally(() => scheduled.delete(this.lockKey));
        }, 0);
        timer.unref();
      }
    }
  }

  async metadata(): Promise<IndexMetadata | null> {
    return this.database((db) => {
      const row = db
        .prepare('SELECT payload FROM dashboard_summary_meta WHERE namespace=?')
        .get(this.options.namespace) as { payload: string } | undefined;
      return row ? (JSON.parse(row.payload) as IndexMetadata) : null;
    });
  }

  async query<T = unknown>(
    query: DashboardSummaryQuery = {},
  ): Promise<{
    items: T[];
    total: number;
    indexing: boolean;
    sourceCount: number;
    indexedCount: number;
    errors: string[];
    generation: string;
  }> {
    return this.database((db) => {
      const parameters: (string | number)[] = [this.options.namespace];
      const predicates = ['namespace=?'];
      if (query.search) {
        predicates.push("search LIKE ? ESCAPE '\\'");
        parameters.push(`%${query.search.toLocaleLowerCase().replace(/[\\%_]/gu, '\\$&')}%`);
      }
      for (const [column, value] of [
        ['kind', query.kind],
        ['group_id', query.group],
      ] as const)
        if (value !== undefined) {
          predicates.push(`${column}=?`);
          parameters.push(value);
        }
      if (query.attention !== undefined) {
        predicates.push('attention=?');
        parameters.push(Number(query.attention));
      }
      if (query.hasGroup !== undefined)
        predicates.push(`group_id IS ${query.hasGroup ? 'NOT ' : ''}NULL`);
      for (const [column, values] of [
        ['status', query.statuses],
        ['record_key', query.keys],
      ] as const)
        if (values) {
          predicates.push(
            values.length ? `${column} IN (${values.map(() => '?').join(',')})` : '0',
          );
          parameters.push(...values);
        }
      const where = predicates.join(' AND ');
      const total = (
        db
          .prepare(`SELECT COUNT(*) AS count FROM dashboard_summary_rows WHERE ${where}`)
          .get(...parameters) as { count: number }
      ).count;
      const rows = db
        .prepare(
          `SELECT payload FROM dashboard_summary_rows WHERE ${where} ORDER BY sort_key ${query.descending ? 'DESC' : 'ASC'}, record_key ${query.descending ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`,
        )
        .all(...parameters, query.limit ?? Number.MAX_SAFE_INTEGER, query.offset ?? 0) as {
        payload: string;
      }[];
      const meta = db
        .prepare('SELECT payload FROM dashboard_summary_meta WHERE namespace=?')
        .get(this.options.namespace) as { payload: string } | undefined;
      const metadata: IndexMetadata = meta
        ? JSON.parse(meta.payload)
        : { sourceCount: 0, indexedCount: 0, indexing: true, errors: [], generation: '' };
      return {
        items: rows.map((r) => JSON.parse(r.payload) as T),
        total,
        ...metadata,
        indexing:
          metadata.indexing ||
          (metadata.sourceCount === 0 &&
            (scheduled.has(this.lockKey) || inFlight.has(this.lockKey))),
      };
    });
  }

  async find<T = unknown>(key: string): Promise<T | null> {
    return (await this.query<T>({ keys: [key], limit: 1 })).items[0] ?? null;
  }
}
