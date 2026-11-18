import { promises as fs } from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { resolveStableProjectId } from '../../platform/paths/project-identity.js';

export interface DashboardIndexStoreOptions {
  readonly projectRoot: string;
  readonly cacheRoot?: string;
}

export interface DashboardNativeIndexQuery {
  readonly status: 'active' | 'archived' | 'all';
  readonly query?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface DashboardNativeIndexQueryResult<T> {
  readonly rows: T[];
  readonly total: number;
  readonly indexed: boolean;
}

function defaultCacheRoot(): string {
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches');
  }
  return process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache');
}

export function resolveDashboardIndexPath(
  projectRoot: string,
  cacheRoot = defaultCacheRoot(),
): string {
  const repositoryId = resolveStableProjectId(projectRoot);
  const productDirectory = process.platform === 'linux' ? 'comet' : 'Comet';
  // 同一个 origin 的克隆和 worktree 有不同的当前目录与 Eval 数据。
  let workspaceRoot = path.resolve(projectRoot);
  try {
    workspaceRoot = realpathSync.native(workspaceRoot);
  } catch {
    // 尚不存在的目录也保留独立缓存身份。
  }
  const workspaceId = createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 24);
  return path.join(
    cacheRoot,
    productDirectory,
    'dashboard',
    `${repositoryId}-${workspaceId}.sqlite`,
  );
}

export class DashboardIndexStore {
  readonly databasePath: string;
  private database: DatabaseSync | null = null;

  constructor(options: DashboardIndexStoreOptions) {
    this.databasePath = resolveDashboardIndexPath(options.projectRoot, options.cacheRoot);
  }

  async open(): Promise<void> {
    if (this.database) return;
    await fs.mkdir(path.dirname(this.databasePath), { recursive: true });
    const database = new DatabaseSync(this.databasePath);
    try {
      database.exec('PRAGMA journal_mode = WAL;');
      database.exec('PRAGMA busy_timeout = 2500;');
      database.exec(
        [
          'CREATE TABLE IF NOT EXISTS dashboard_index_native (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);',
          'CREATE TABLE IF NOT EXISTS dashboard_index_native_entries (locator TEXT PRIMARY KEY, status TEXT NOT NULL, name TEXT NOT NULL, archive_name TEXT, search_text TEXT NOT NULL, position INTEGER NOT NULL, root INTEGER NOT NULL, payload TEXT NOT NULL);',
          'CREATE INDEX IF NOT EXISTS dashboard_index_native_entries_query ON dashboard_index_native_entries (root, status, position);',
        ].join('\n'),
      );
      this.database = database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  async readNativeIndex<T>(): Promise<T | null> {
    const row = this.requireDatabase()
      .prepare('SELECT payload FROM dashboard_index_native WHERE id = 1')
      .get() as { payload?: string } | undefined;
    if (!row?.payload) return null;
    return JSON.parse(row.payload) as T;
  }

  async replaceNativeIndex(value: unknown): Promise<void> {
    const database = this.requireDatabase();
    const index = value as {
      active?: unknown[];
      archived?: unknown[];
      all?: unknown[];
    };
    const active = Array.isArray(index.active) ? index.active : [];
    const archived = Array.isArray(index.archived) ? index.archived : [];
    const all = Array.isArray(index.all) ? index.all : [];
    const rows = new Map<
      string,
      { value: Record<string, unknown>; root: boolean; position: number }
    >();
    for (const value of all) {
      const candidate = value as Record<string, unknown>;
      const locator = typeof candidate.locator === 'string' ? candidate.locator : null;
      if (locator) rows.set(locator, { value: candidate, root: false, position: -1 });
    }
    [...active, ...archived].forEach((value, position) => {
      const candidate = value as Record<string, unknown>;
      const locator = typeof candidate.locator === 'string' ? candidate.locator : null;
      if (locator) rows.set(locator, { value: candidate, root: true, position });
    });
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec('DELETE FROM dashboard_index_native_entries;');
      const insert = database.prepare(
        'INSERT INTO dashboard_index_native_entries (locator, status, name, archive_name, search_text, position, root, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const { value: candidate, root, position } of rows.values()) {
        const entry = (candidate.entry ?? {}) as Record<string, unknown>;
        const source = (candidate.source ?? {}) as Record<string, unknown>;
        const workspace = (source.workspace ?? {}) as Record<string, unknown>;
        const children = Array.isArray(candidate.children) ? candidate.children : [];
        const searchText = [
          entry.name,
          workspace.label,
          workspace.branch,
          ...children.flatMap((child) => {
            const item = child as Record<string, unknown>;
            const childWorkspace = (item.workspace ?? {}) as Record<string, unknown>;
            return [item.name, childWorkspace.label, childWorkspace.branch, item.message];
          }),
        ]
          .filter((item): item is string => typeof item === 'string')
          .join(' ')
          .toLowerCase();
        insert.run(
          String(candidate.locator),
          String(entry.status ?? 'active'),
          String(entry.name ?? ''),
          typeof entry.archiveName === 'string' ? entry.archiveName : null,
          searchText,
          position,
          root ? 1 : 0,
          JSON.stringify(candidate),
        );
      }
      database
        .prepare(
          'INSERT INTO dashboard_index_native (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload',
        )
        .run(JSON.stringify(value));
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  async queryNativeIndex<T>(
    options: DashboardNativeIndexQuery,
  ): Promise<DashboardNativeIndexQueryResult<T>> {
    const database = this.requireDatabase();
    const where = ['root = 1'];
    const parameters: Array<string | number> = [];
    if (options.status !== 'all') {
      where.push('status = ?');
      parameters.push(options.status);
    }
    const query = options.query?.trim().toLowerCase() ?? '';
    if (query) {
      where.push('search_text LIKE ?');
      parameters.push(`%${query}%`);
    }
    const predicate = where.join(' AND ');
    const count = database
      .prepare(`SELECT COUNT(*) AS total FROM dashboard_index_native_entries WHERE ${predicate}`)
      .get(...parameters) as { total: number };
    const indexed = database
      .prepare('SELECT COUNT(*) AS total FROM dashboard_index_native_entries WHERE root = 1')
      .get() as { total: number };
    const offset = options.offset ?? 0;
    const rows = database
      .prepare(
        `SELECT payload FROM dashboard_index_native_entries WHERE ${predicate} ORDER BY position LIMIT ? OFFSET ?`,
      )
      .all(...parameters, options.limit ?? Number.MAX_SAFE_INTEGER, offset)
      .map((row) => JSON.parse((row as { payload: string }).payload) as T);
    return { rows, total: Number(count.total), indexed: Number(indexed.total) > 0 };
  }

  async close(): Promise<void> {
    this.database?.close();
    this.database = null;
  }

  private requireDatabase(): DatabaseSync {
    if (!this.database) throw new Error('DashboardIndexStore is not open');
    return this.database;
  }
}
