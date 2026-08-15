import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { resolveStableProjectId } from '../../platform/paths/project-identity.js';

export interface DashboardIndexWorkspace {
  readonly id: string;
  readonly projectRoot: string;
  readonly branch: string | null;
  readonly head: string | null;
  readonly current: boolean;
  readonly generation: number;
}

export interface DashboardIndexChange {
  readonly locator: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly status: string;
  readonly phase: string | null;
  readonly archiveName: string | null;
  readonly parentLocator: string | null;
  readonly generation: number;
}

export interface DashboardIndexSupervisorChild {
  readonly parentLocator: string;
  readonly childName: string;
  readonly dependsOn: readonly string[];
  readonly status: string;
  readonly phase: string | null;
  readonly message: string | null;
  readonly generation: number;
}

export interface DashboardIndexArtifact {
  readonly locator: string;
  readonly key: string;
  readonly kind: string;
  readonly filePath: string;
  readonly size: number | null;
  readonly modifiedAt: number | null;
}

export interface DashboardIndexSnapshot {
  readonly schema: 'comet.dashboard.index.v1';
  readonly repositoryId: string;
  readonly generation: number;
  readonly refreshedAt: string;
  readonly workspaces: readonly DashboardIndexWorkspace[];
  readonly changes: readonly DashboardIndexChange[];
  readonly supervisorChildren: readonly DashboardIndexSupervisorChild[];
  readonly artifacts: readonly DashboardIndexArtifact[];
}

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
  return path.join(cacheRoot, productDirectory, 'dashboard', repositoryId + '.sqlite');
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
          'CREATE TABLE IF NOT EXISTS dashboard_index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
          'CREATE TABLE IF NOT EXISTS dashboard_index_workspaces (id TEXT PRIMARY KEY, project_root TEXT NOT NULL, branch TEXT, head TEXT, current INTEGER NOT NULL, generation INTEGER NOT NULL);',
          'CREATE TABLE IF NOT EXISTS dashboard_index_changes (locator TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, phase TEXT, archive_name TEXT, parent_locator TEXT, generation INTEGER NOT NULL);',
          'CREATE TABLE IF NOT EXISTS dashboard_index_supervisor_children (parent_locator TEXT NOT NULL, child_name TEXT NOT NULL, depends_on TEXT NOT NULL, status TEXT NOT NULL, phase TEXT, message TEXT, generation INTEGER NOT NULL, PRIMARY KEY (parent_locator, child_name));',
          'CREATE TABLE IF NOT EXISTS dashboard_index_artifacts (locator TEXT NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL, file_path TEXT NOT NULL, size INTEGER, modified_at INTEGER, PRIMARY KEY (locator, key));',
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

  async readSnapshot(): Promise<DashboardIndexSnapshot | null> {
    const database = this.requireDatabase();
    const metaRows = database
      .prepare('SELECT key, value FROM dashboard_index_meta')
      .all() as Array<{ key: string; value: string }>;
    const meta = new Map(metaRows.map(({ key, value }) => [key, value]));
    const schema = meta.get('schema');
    const repositoryId = meta.get('repositoryId');
    const generation = Number(meta.get('generation'));
    const refreshedAt = meta.get('refreshedAt');
    if (
      schema !== 'comet.dashboard.index.v1' ||
      !repositoryId ||
      !Number.isSafeInteger(generation) ||
      !refreshedAt
    ) {
      return null;
    }

    const workspaces = database
      .prepare(
        'SELECT id, project_root, branch, head, current, generation FROM dashboard_index_workspaces ORDER BY id',
      )
      .all()
      .map((row) => {
        const item = row as {
          id: string;
          project_root: string;
          branch: string | null;
          head: string | null;
          current: number;
          generation: number;
        };
        return {
          id: item.id,
          projectRoot: item.project_root,
          branch: item.branch,
          head: item.head,
          current: item.current === 1,
          generation: item.generation,
        };
      });
    const changes = database
      .prepare(
        'SELECT locator, workspace_id, name, status, phase, archive_name, parent_locator, generation FROM dashboard_index_changes ORDER BY locator',
      )
      .all()
      .map((row) => {
        const item = row as {
          locator: string;
          workspace_id: string;
          name: string;
          status: string;
          phase: string | null;
          archive_name: string | null;
          parent_locator: string | null;
          generation: number;
        };
        return {
          locator: item.locator,
          workspaceId: item.workspace_id,
          name: item.name,
          status: item.status,
          phase: item.phase,
          archiveName: item.archive_name,
          parentLocator: item.parent_locator,
          generation: item.generation,
        };
      });
    const supervisorChildren = database
      .prepare(
        'SELECT parent_locator, child_name, depends_on, status, phase, message, generation FROM dashboard_index_supervisor_children ORDER BY parent_locator, child_name',
      )
      .all()
      .map((row) => {
        const item = row as {
          parent_locator: string;
          child_name: string;
          depends_on: string;
          status: string;
          phase: string | null;
          message: string | null;
          generation: number;
        };
        return {
          parentLocator: item.parent_locator,
          childName: item.child_name,
          dependsOn: JSON.parse(item.depends_on) as string[],
          status: item.status,
          phase: item.phase,
          message: item.message,
          generation: item.generation,
        };
      });
    const artifacts = database
      .prepare(
        'SELECT locator, key, kind, file_path, size, modified_at FROM dashboard_index_artifacts ORDER BY locator, key',
      )
      .all()
      .map((row) => {
        const item = row as {
          locator: string;
          key: string;
          kind: string;
          file_path: string;
          size: number | null;
          modified_at: number | null;
        };
        return {
          locator: item.locator,
          key: item.key,
          kind: item.kind,
          filePath: item.file_path,
          size: item.size,
          modifiedAt: item.modified_at,
        };
      });
    return {
      schema: 'comet.dashboard.index.v1',
      repositoryId,
      generation,
      refreshedAt,
      workspaces,
      changes,
      supervisorChildren,
      artifacts,
    };
  }

  async replaceSnapshot(snapshot: DashboardIndexSnapshot): Promise<void> {
    const database = this.requireDatabase();
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(
        [
          'DELETE FROM dashboard_index_meta;',
          'DELETE FROM dashboard_index_workspaces;',
          'DELETE FROM dashboard_index_changes;',
          'DELETE FROM dashboard_index_supervisor_children;',
          'DELETE FROM dashboard_index_artifacts;',
        ].join('\n'),
      );
      const meta = database.prepare('INSERT INTO dashboard_index_meta (key, value) VALUES (?, ?)');
      meta.run('schema', snapshot.schema);
      meta.run('repositoryId', snapshot.repositoryId);
      meta.run('generation', String(snapshot.generation));
      meta.run('refreshedAt', snapshot.refreshedAt);

      const workspace = database.prepare(
        'INSERT INTO dashboard_index_workspaces (id, project_root, branch, head, current, generation) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const item of snapshot.workspaces) {
        workspace.run(
          item.id,
          item.projectRoot,
          item.branch,
          item.head,
          item.current ? 1 : 0,
          item.generation,
        );
      }
      const change = database.prepare(
        'INSERT INTO dashboard_index_changes (locator, workspace_id, name, status, phase, archive_name, parent_locator, generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const item of snapshot.changes) {
        change.run(
          item.locator,
          item.workspaceId,
          item.name,
          item.status,
          item.phase,
          item.archiveName,
          item.parentLocator,
          item.generation,
        );
      }
      const child = database.prepare(
        'INSERT INTO dashboard_index_supervisor_children (parent_locator, child_name, depends_on, status, phase, message, generation) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      for (const item of snapshot.supervisorChildren) {
        child.run(
          item.parentLocator,
          item.childName,
          JSON.stringify(item.dependsOn),
          item.status,
          item.phase,
          item.message,
          item.generation,
        );
      }
      const artifact = database.prepare(
        'INSERT INTO dashboard_index_artifacts (locator, key, kind, file_path, size, modified_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const item of snapshot.artifacts) {
        artifact.run(item.locator, item.key, item.kind, item.filePath, item.size, item.modifiedAt);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
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
