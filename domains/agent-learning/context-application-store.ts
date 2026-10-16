import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { openSqliteDatabase } from '../../platform/fs/sqlite.js';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';
import { throwIfOperationAborted } from '../../platform/process/operation-budget.js';
import {
  StorageAgentContextApplicationStore,
  validateAgentContextApplicationRecord,
} from './context-director.js';
import type {
  AgentContextApplicationStore,
  AgentContextApplicationStorage,
  AgentContextApplicationQuery,
  AgentContextApplicationPage,
  AgentContextApplicationRecord,
  AgentContextRequest,
  AgentContextSelectionHistory,
  AgentContextOutcomeEvidence,
  AgentContextOutcomeUpdate,
} from './context-director.js';
import type { AgentContextCandidate, AgentContextOutcomeStatus } from './types.js';

/** 应用历史独立存储；页面和任务读取使用索引，旧 JSON 只在首次打开时导入。 */
export class SqliteAgentContextApplicationStore implements AgentContextApplicationStore {
  private migrationSource?: Promise<{ hash: string; records: unknown[] }>;
  public constructor(
    private readonly file: string,
    private readonly legacy?: AgentContextApplicationStorage,
  ) {}

  private async database<T>(operation: (database: DatabaseSync) => T | Promise<T>): Promise<T> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const database = openSqliteDatabase(this.file);
    try {
      database.exec(`PRAGMA busy_timeout=150; PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS application_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS applications (
          sequence INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, candidate TEXT NOT NULL,
          scope TEXT NOT NULL, project TEXT, context_project TEXT, session TEXT, task TEXT NOT NULL,
          phase TEXT, path TEXT, operation TEXT, applied TEXT NOT NULL, outcome TEXT, pending INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS application_candidate ON applications(owner,candidate,scope,project,sequence);
        CREATE INDEX IF NOT EXISTS application_recent ON applications(owner,applied DESC,id DESC);
        CREATE INDEX IF NOT EXISTS application_session ON applications(owner,candidate,session,context_project,task,phase,path,operation);
        CREATE INDEX IF NOT EXISTS application_pending ON applications(pending,scope,context_project,project);`);
      if (!database.prepare("SELECT 1 FROM application_meta WHERE key='legacy-imported'").get()) {
        await withRecoverableFileLock(`${this.file}.migration.lock`, async () => {
          if (database.prepare("SELECT 1 FROM application_meta WHERE key='legacy-imported'").get())
            return;
          this.migrationSource ??= (async () => {
            const raw = await this.legacy?.read();
            if (raw === undefined || raw === null) return { hash: 'empty', records: [] };
            const state = raw as { version?: unknown; records?: unknown };
            if (state.version !== 5 || !Array.isArray(state.records))
              throw new Error('Context application state is incompatible');
            return {
              hash: createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
              records: state.records,
            };
          })();
          const source = await this.migrationSource;
          const storedHash = database
            .prepare("SELECT value FROM application_meta WHERE key='legacy-hash'")
            .get()?.value;
          if (
            storedHash === undefined &&
            Number(database.prepare('SELECT COUNT(*) AS count FROM applications').get()?.count) > 0
          )
            throw new Error(
              'Context history migration metadata is missing; preserve the database and restore its metadata before retrying.',
            );
          if (storedHash !== source.hash) {
            database.exec('BEGIN IMMEDIATE');
            try {
              database.exec('DELETE FROM applications');
              database
                .prepare("INSERT OR REPLACE INTO application_meta VALUES('legacy-hash',?)")
                .run(source.hash);
              database
                .prepare("INSERT OR REPLACE INTO application_meta VALUES('legacy-offset','0')")
                .run();
              database.exec('COMMIT');
            } catch (error) {
              database.exec('ROLLBACK');
              throw error;
            }
          }
          let offset = Number(
            database.prepare("SELECT value FROM application_meta WHERE key='legacy-offset'").get()
              ?.value ?? 0,
          );
          while (offset < source.records.length) {
            throwIfOperationAborted();
            const next = Math.min(source.records.length, offset + 256);
            database.exec('BEGIN IMMEDIATE');
            try {
              for (let index = offset; index < next; index++)
                this.insert(database, validateAgentContextApplicationRecord(source.records[index]));
              database
                .prepare("INSERT OR REPLACE INTO application_meta VALUES('legacy-offset',?)")
                .run(String(next));
              database.exec('COMMIT');
              offset = next;
            } catch (error) {
              database.exec('ROLLBACK');
              throw error;
            }
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
          database.prepare("INSERT INTO application_meta VALUES('legacy-imported','1')").run();
          this.migrationSource = undefined;
        });
      }
      return await operation(database);
    } finally {
      database.close();
    }
  }

  private insert(database: DatabaseSync, record: AgentContextApplicationRecord): void {
    database
      .prepare(
        `INSERT INTO applications (id,owner,candidate,scope,project,context_project,session,task,phase,path,operation,applied,outcome,pending,data)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
      )
      .run(...this.values(record));
  }

  private values(record: AgentContextApplicationRecord): SQLInputValue[] {
    return [
      record.applicationId,
      record.owner,
      record.candidateId,
      record.scope,
      record.projectId ?? null,
      record.contextProjectId ?? null,
      record.sessionId ?? null,
      record.task,
      record.phase ?? null,
      record.path ?? null,
      record.operation ?? null,
      record.appliedAt,
      record.outcome ?? null,
      record.appliedEventDispatchedAt === undefined ||
      record.outcomeEvents?.some((event) => event.dispatchedAt === undefined)
        ? 1
        : 0,
      JSON.stringify(record),
    ];
  }

  public async list(candidateId?: string): Promise<readonly AgentContextApplicationRecord[]> {
    return this.database((database) =>
      database
        .prepare(
          `SELECT data FROM applications ${candidateId === undefined ? '' : 'WHERE candidate=?'} ORDER BY sequence`,
        )
        .all(...(candidateId === undefined ? [] : [candidateId]))
        .map((row) => validateAgentContextApplicationRecord(JSON.parse(String(row.data)))),
    );
  }

  public query(query: AgentContextApplicationQuery): Promise<AgentContextApplicationPage> {
    return this.database((database) => {
      const conditions: string[] = [];
      const args: SQLInputValue[] = [];
      if (query.owner !== undefined) {
        conditions.push('owner=?');
        args.push(query.owner);
      }
      if (query.candidateId !== undefined) {
        conditions.push('candidate=?');
        args.push(query.candidateId);
      }
      if (query.projectId !== undefined) {
        conditions.push("(scope='user' OR project=?)");
        args.push(query.projectId);
      }
      if (query.contextProjectId !== undefined) {
        conditions.push("(scope='project' OR context_project IS NULL OR context_project=?)");
        args.push(query.contextProjectId);
      }
      if (query.undispatched) {
        conditions.push('pending=1');
        if (query.projectId !== undefined) {
          conditions.push("(scope='project' OR context_project IS NULL OR context_project=?)");
          args.push(query.projectId);
        }
      }
      if (query.applicationIds) {
        if (!query.applicationIds.length) return { items: [], total: 0 };
        conditions.push('id IN (SELECT value FROM json_each(?))');
        args.push(JSON.stringify(query.applicationIds));
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const total = Number(
        database.prepare(`SELECT COUNT(*) AS count FROM applications ${where}`).get(...args)!.count,
      );
      if (query.cursor !== undefined) {
        let cursor: unknown;
        try {
          cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        } catch {
          throw new Error('Invalid context application cursor');
        }
        if (
          !Array.isArray(cursor) ||
          cursor.length !== 2 ||
          cursor.some((value) => typeof value !== 'string')
        )
          throw new Error('Invalid context application cursor');
        conditions.push('(applied < ? OR (applied = ? AND id < ?))');
        args.push(cursor[0], cursor[0], cursor[1]);
      }
      const limit = Math.min(
        100,
        Math.max(1, Number.isSafeInteger(query.limit) ? query.limit! : 20),
      );
      const rows = database
        .prepare(
          `SELECT data FROM applications ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY applied DESC,id DESC LIMIT ?`,
        )
        .all(...args, limit + 1);
      const items = rows
        .slice(0, limit)
        .map((row) => validateAgentContextApplicationRecord(JSON.parse(String(row.data))));
      const last = items.at(-1);
      return {
        items,
        total,
        ...(rows.length > limit && last
          ? {
              nextCursor: Buffer.from(
                JSON.stringify([last.appliedAt, last.applicationId]),
              ).toString('base64url'),
            }
          : {}),
      };
    });
  }

  public selectionHistory(
    candidates: readonly AgentContextCandidate[],
    request: AgentContextRequest,
  ): Promise<AgentContextSelectionHistory> {
    return this.database((database) => {
      const records = new Map<string, AgentContextApplicationRecord>();
      const feedbackScores: Record<string, number> = {};
      for (const candidate of candidates) {
        const where = "owner=? AND candidate=? AND scope=? AND (scope='user' OR project IS ?)";
        const args = [candidate.owner, candidate.id, candidate.scope, request.projectId ?? null];
        const aggregate = database
          .prepare(
            `SELECT SUM(CASE outcome WHEN 'used-successfully' THEN 20 WHEN 'ignored' THEN -2 WHEN 'corrected' THEN -80 WHEN 'contributed-to-failure' THEN -80 ELSE 0 END) AS score FROM applications WHERE ${where}`,
          )
          .get(...args);
        feedbackScores[`${candidate.owner}:${candidate.id}`] = Number(aggregate?.score ?? 0);
        const latest = database
          .prepare(
            `SELECT data FROM applications WHERE ${where} AND outcome IS NOT NULL ORDER BY sequence DESC LIMIT 1`,
          )
          .get(...args);
        const delivered =
          request.sessionId === undefined
            ? undefined
            : database
                .prepare(
                  `SELECT data FROM applications WHERE ${where} AND session=? AND task=? AND phase IS ? AND path IS ? AND operation IS ? AND (scope='project' OR context_project IS ?) ORDER BY sequence DESC LIMIT 1`,
                )
                .get(
                  ...args,
                  request.sessionId,
                  request.task,
                  request.phase ?? null,
                  request.path ?? null,
                  request.operation ?? null,
                  request.projectId ?? null,
                );
        for (const row of [latest, delivered])
          if (row) {
            const record = validateAgentContextApplicationRecord(JSON.parse(String(row.data)));
            records.set(record.applicationId, record);
          }
      }
      return { records: [...records.values()], feedbackScores };
    });
  }

  public append(record: AgentContextApplicationRecord): Promise<void> {
    return this.appendMany([record]);
  }
  public async appendMany(records: readonly AgentContextApplicationRecord[]): Promise<void> {
    const valid = records.map(validateAgentContextApplicationRecord);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await withRecoverableFileLock(`${this.file}.write.lock`, () =>
      this.database((database) => {
        database.exec('BEGIN IMMEDIATE');
        try {
          for (const record of valid) this.insert(database, record);
          database.exec('COMMIT');
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      }),
    );
  }

  private async mutate<T>(
    ids: readonly string[],
    operation: (store: StorageAgentContextApplicationStore) => Promise<T>,
  ): Promise<T> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    return withRecoverableFileLock(`${this.file}.write.lock`, () =>
      this.database(async (database) => {
        database.exec('BEGIN IMMEDIATE');
        try {
          let state: unknown = {
            version: 5,
            records: database
              .prepare(
                'SELECT data FROM applications WHERE id IN (SELECT value FROM json_each(?)) ORDER BY sequence',
              )
              .all(JSON.stringify(ids))
              .map((row) => JSON.parse(String(row.data))),
          };
          const store = new StorageAgentContextApplicationStore({
            read: async () => state,
            write: async (next) => {
              state = next;
            },
          });
          const result = await operation(store);
          for (const record of await store.list()) {
            const values = this.values(record);
            database
              .prepare(
                'UPDATE applications SET owner=?,candidate=?,scope=?,project=?,context_project=?,session=?,task=?,phase=?,path=?,operation=?,applied=?,outcome=?,pending=?,data=? WHERE id=?',
              )
              .run(...values.slice(1), values[0]);
          }
          database.exec('COMMIT');
          return result;
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      }),
    );
  }

  public setOutcome(
    id: string,
    outcome: AgentContextOutcomeStatus,
    projectId?: string,
    evidence?: AgentContextOutcomeEvidence,
  ): Promise<AgentContextOutcomeUpdate | null> {
    return this.mutate([id], (store) => store.setOutcome(id, outcome, projectId, evidence));
  }
  public markAppliedEventDispatched(id: string, at?: string): Promise<void> {
    return this.mutate([id], (store) => store.markAppliedEventDispatched(id, at));
  }
  public markOutcomeEventDispatched(id: string, revision: number, at?: string): Promise<void> {
    return this.mutate([id], (store) => store.markOutcomeEventDispatched(id, revision, at));
  }
  public markEventsDispatched(
    events: readonly { readonly applicationId: string; readonly outcomeRevision?: number }[],
    at?: string,
  ): Promise<void> {
    return this.mutate(
      events.map((event) => event.applicationId),
      (store) => store.markEventsDispatched(events, at),
    );
  }
}
