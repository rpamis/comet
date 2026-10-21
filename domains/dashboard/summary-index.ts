import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
interface RefreshScan {
  iterator: AsyncIterator<DashboardSummarySource>;
  seen: Set<string>;
  pending: Map<string, DashboardSummarySource>;
  complete: boolean;
  knownCount?: number;
}
const scans = new Map<string, RefreshScan>();
const failedSources = new Map<
  string,
  Map<
    string,
    {
      fingerprint: string;
      message: string;
      attempts: number;
      retryAt: number;
    }
  >
>();
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
      discover(): AsyncIterable<DashboardSummarySource> | Promise<DashboardSummarySource[]>;
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
    if (dirty.has(this.lockKey)) {
      const previous = scans.get(this.lockKey);
      scans.delete(this.lockKey);
      void previous?.iterator.return?.().catch(() => undefined);
    }
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
    let scan = scans.get(this.lockKey);
    if (!scan) {
      const discover = this.options.discover;
      const iterator = (async function* () {
        const discovered = discover();
        if (Symbol.asyncIterator in discovered) yield* discovered;
        else {
          const sources = await discovered;
          scan!.knownCount = sources.length;
          yield* sources;
        }
      })()[Symbol.asyncIterator]();
      scan = { iterator, seen: new Set(), pending: new Map(), complete: false };
      scans.set(this.lockKey, scan);
    }
    const cached = await this.database(
      (db) =>
        new Map(
          (
            db
              .prepare(
                `SELECT s.source_key, s.fingerprint, COALESCE(MAX(r.volatile),0) AS volatile
        FROM dashboard_summary_sources s LEFT JOIN dashboard_summary_rows r
        ON r.namespace=s.namespace AND r.source_key=s.source_key WHERE s.namespace=?
        GROUP BY s.source_key`,
              )
              .all(this.options.namespace) as {
              source_key: string;
              fingerprint: string;
              volatile: number;
            }[]
          ).map((source) => [source.source_key, source]),
        ),
    );
    const updates: { source: DashboardSummarySource; records: DashboardSummaryRecord[] }[] = [];
    const errors: string[] = [];
    let attempted = 0;
    const failures = failedSources.get(this.lockKey) ?? new Map();
    failedSources.set(this.lockKey, failures);
    // 预算同时覆盖发现、指纹读取和来源读取；至少推进一个来源，随后保留迭代位置。
    while (
      attempted < (options.maxSources ?? Infinity) &&
      (attempted === 0 || Date.now() < deadline)
    ) {
      const batch: DashboardSummarySource[] = [];
      const concurrency = options.budgetMs === undefined ? 4 : 1;
      while (
        batch.length < concurrency &&
        attempted < (options.maxSources ?? Infinity) &&
        (attempted === 0 || Date.now() < deadline)
      ) {
        let source: DashboardSummarySource;
        {
          if (scan.complete) break;
          try {
            const next = await scan.iterator.next();
            if (next.done) {
              scan.complete = true;
              break;
            }
            source = next.value;
          } catch (error) {
            scans.delete(this.lockKey);
            throw error;
          }
          scan.seen.add(source.key);
        }
        attempted++;
        const failure = failures.get(source.key);
        if (
          options.budgetMs !== undefined &&
          failure?.fingerprint === source.fingerprint &&
          failure.retryAt > Date.now()
        ) {
          errors.push(failure.message);
          scan.pending.set(source.key, source);
          continue;
        }
        if (
          cached.get(source.key)?.fingerprint === source.fingerprint &&
          cached.get(source.key)?.volatile !== 1 &&
          !scan.pending.has(source.key)
        )
          continue;
        scan.pending.set(source.key, source);
        batch.push(source);
      }
      if (!batch.length) {
        if (scan.complete) break;
        continue;
      }
      const results = await Promise.all(
        batch.map(async (source) => {
          try {
            return { source, records: await source.read() };
          } catch (error) {
            return {
              source,
              error: `${source.key}: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        }),
      );
      for (const result of results) {
        if ('records' in result && result.records) {
          updates.push({ source: result.source, records: result.records });
          scan.pending.delete(result.source.key);
          failures.delete(result.source.key);
        } else {
          errors.push(result.error!);
          const previous = failures.get(result.source.key);
          const attempts =
            previous?.fingerprint === result.source.fingerprint ? previous.attempts + 1 : 1;
          failures.set(result.source.key, {
            fingerprint: result.source.fingerprint,
            message: result.error!,
            attempts,
            retryAt: Date.now() + Math.min(60000, 1000 * 2 ** Math.min(attempts - 1, 6)),
          });
        }
      }
      if (scan.complete) break;
    }
    const currentScan = scan;
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
          if (currentScan.complete && !currentScan.seen.has(key)) {
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
          const before = db
            .prepare(
              `SELECT record_key, sort_key, search, status, kind,
            group_id, attention, volatile, payload FROM dashboard_summary_rows
            WHERE namespace=? AND source_key=? ORDER BY record_key`,
            )
            .all(this.options.namespace, source.key);
          const after = records
            .map((record) => ({
              record_key: record.key,
              sort_key: record.sortKey,
              search: record.search.toLocaleLowerCase(),
              status: record.status,
              kind: record.kind ?? '',
              group_id: record.group ?? null,
              attention: Number(Boolean(record.attention)),
              volatile: Number(Boolean(record.volatile)),
              payload: JSON.stringify(record.payload),
            }))
            .sort((a, b) =>
              a.record_key < b.record_key ? -1 : a.record_key > b.record_key ? 1 : 0,
            );
          if (JSON.stringify(before) !== JSON.stringify(after)) removed = true;
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
        const generation = !removed && previousGeneration ? previousGeneration : randomUUID();
        const metadata: IndexMetadata = {
          sourceCount: currentScan.complete
            ? currentScan.seen.size
            : Math.max(currentScan.knownCount ?? 0, currentScan.seen.size, cached.size),
          indexedCount: indexed.count,
          indexing: !currentScan.complete || currentScan.pending.size > 0,
          errors,
          generation,
        };
        db.prepare('INSERT OR REPLACE INTO dashboard_summary_meta VALUES (?,?)').run(
          this.options.namespace,
          JSON.stringify(metadata),
        );
        db.exec('COMMIT;');
        // 失败来源只影响自身重试；每次完整发现后释放迭代器，以便发现新增和删除。
        if (currentScan.complete) {
          scans.delete(this.lockKey);
          for (const key of failures.keys()) if (!currentScan.seen.has(key)) failures.delete(key);
          if (!failures.size) failedSources.delete(this.lockKey);
        }
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
          void this.refresh({ maxSources: 20, budgetMs: 500 })
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
