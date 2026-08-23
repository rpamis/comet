import { closeSync, mkdirSync, openSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { resolveProjectKnowledgeStorageLocation } from '../../platform/paths/project-knowledge-storage.js';
import type {
  ProjectKnowledgeApplyResult,
  ProjectKnowledgeQuery,
  ProjectKnowledgeResult,
  ProjectKnowledgeStatus,
  ProjectKnowledgeMutation,
} from './types.js';
import {
  mergeProjectKnowledgeRecord,
  parseProjectKnowledgeRecord,
  type ProjectKnowledgeRecord,
  type ProjectKnowledgeRecordSource,
  type ProjectKnowledgeRecordSourceVersion,
} from './records.js';
import {
  ProjectKnowledgeIndexStore,
  type ProjectKnowledgeIndexStatus,
  type ProjectKnowledgeIndexSyncResult,
  type ProjectKnowledgeIndexOptions,
} from './index-store.js';
import type { ProjectKnowledgeDocument } from './types.js';
import { projectKnowledgeSourceReferenceMatchesText } from './source-validity.js';

export interface ProjectKnowledgeLocalStoreOptions extends Omit<
  ProjectKnowledgeIndexOptions,
  'cacheRoot' | 'storageRoot'
> {
  readonly storageRoot?: string;
  readonly cacheRoot?: string;
}

export interface ProjectKnowledgeRecordListOptions {
  readonly projectId?: string;
  readonly type?: ProjectKnowledgeRecord['type'];
  readonly state?: ProjectKnowledgeRecord['state'];
  readonly authority?: ProjectKnowledgeRecord['authority'];
  readonly limit?: number;
}

interface StoredRecordRow {
  readonly payload_json: string;
}

interface SharedDatabaseEntry {
  database: DatabaseSync | null;
  refs: number;
}

const MAX_SOURCE_VALIDATION_BYTES = 1024 * 1024;

function equalSourceVersions(left: ProjectKnowledgeRecord, right: ProjectKnowledgeRecord): boolean {
  return JSON.stringify(left.sourceVersions) === JSON.stringify(right.sourceVersions);
}

function recordSourceReferences(
  record: ProjectKnowledgeRecord,
): readonly ProjectKnowledgeRecordSource[] {
  return [
    ...record.conclusions.flatMap((conclusion) => conclusion.sources),
    ...record.relations.flatMap((relation) => relation.sources),
  ];
}

function sourceReferenceIsCurrent(
  absolutePath: string,
  source: ProjectKnowledgeRecordSource,
): boolean {
  if (
    source.anchor === undefined &&
    source.lineStart === undefined &&
    source.lineEnd === undefined
  ) {
    return true;
  }
  const stat = statSync(absolutePath);
  const byteLength = Math.min(Number(stat.size), MAX_SOURCE_VALIDATION_BYTES);
  const buffer = Buffer.alloc(byteLength);
  const descriptor = openSync(absolutePath, 'r');
  try {
    readSync(descriptor, buffer, 0, byteLength, 0);
  } finally {
    closeSync(descriptor);
  }
  const text = buffer.toString('utf8');
  return projectKnowledgeSourceReferenceMatchesText(text, source);
}

interface SourceInspection {
  readonly current: boolean;
  readonly sourceVersions: readonly ProjectKnowledgeRecordSourceVersion[];
}

function inspectRecordSources(
  projectRoot: string,
  record: ProjectKnowledgeRecord,
  acceptCurrentVersions: boolean,
): SourceInspection {
  const references = recordSourceReferences(record);
  const referenceSources = new Set(references.map((reference) => reference.source));
  const sources = [
    ...referenceSources,
    ...record.sourceVersions
      .map((version) => version.source)
      .filter((source) => !referenceSources.has(source)),
  ];
  if (sources.length === 0) return { current: false, sourceVersions: record.sourceVersions };
  const storedVersions = new Map(record.sourceVersions.map((version) => [version.source, version]));
  const sourceVersions: ProjectKnowledgeRecordSourceVersion[] = [];
  for (const source of sources) {
    try {
      const absolutePath = path.join(projectRoot, ...source.split('/'));
      const current = statSync(absolutePath);
      if (!current.isFile()) return { current: false, sourceVersions: record.sourceVersions };
      const version = {
        source,
        size: current.size,
        modifiedAt: Math.trunc(current.mtimeMs),
      };
      sourceVersions.push(version);
      if (
        !references
          .filter((reference) => reference.source === source)
          .every((reference) => sourceReferenceIsCurrent(absolutePath, reference))
      ) {
        return { current: false, sourceVersions: record.sourceVersions };
      }
      const stored = storedVersions.get(source);
      if (
        !acceptCurrentVersions &&
        (stored === undefined ||
          stored.size !== version.size ||
          stored.modifiedAt !== version.modifiedAt)
      ) {
        return { current: false, sourceVersions: record.sourceVersions };
      }
    } catch {
      return { current: false, sourceVersions: record.sourceVersions };
    }
  }
  return { current: true, sourceVersions };
}

function recordUsesSourceEvidence(record: ProjectKnowledgeRecord): boolean {
  return recordSourceReferences(record).length > 0 || record.sourceVersions.length > 0;
}

function recordResultSource(record: ProjectKnowledgeRecord): string {
  const source = recordSourceReferences(record)[0];
  if (source === undefined) return `record:${record.id}`;
  return sourceReferenceLabel(source);
}

function sourceReferenceLabel(source: ProjectKnowledgeRecordSource): string {
  if (source.anchor !== undefined) return `${source.source}#${source.anchor}`;
  if (source.lineStart !== undefined) {
    return `${source.source}#L${source.lineStart}${source.lineEnd ? `-L${source.lineEnd}` : ''}`;
  }
  return source.source;
}

function recordSearchText(record: ProjectKnowledgeRecord): string {
  return [
    record.title,
    record.summary,
    ...record.applicablePaths,
    ...record.operations,
    ...record.conclusions.map((conclusion) => conclusion.text),
  ]
    .join('\n')
    .toLocaleLowerCase();
}

const RECORD_TYPE_RANK: Readonly<Record<ProjectKnowledgeRecord['type'], number>> = {
  'project-map': 0,
  'module-overview': 1,
  'integration-path': 2,
  'behavior-note': 3,
  'change-impact': 4,
  'build-test': 5,
};

function normalizedProjectPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '').toLocaleLowerCase();
}

function recordHasPathAssociation(
  record: ProjectKnowledgeRecord,
  query: ProjectKnowledgeQuery,
): boolean {
  if (!query.path) return false;
  const queryPath = normalizedProjectPath(query.path);
  return [
    ...record.applicablePaths,
    ...recordSourceReferences(record).map((source) => source.source),
  ]
    .map(normalizedProjectPath)
    .some(
      (candidate) =>
        candidate === queryPath ||
        candidate.startsWith(`${queryPath}/`) ||
        queryPath.startsWith(candidate.endsWith('/') ? candidate : `${candidate}/`),
    );
}

function recordHasOperationAssociation(
  record: ProjectKnowledgeRecord,
  query: ProjectKnowledgeQuery,
): boolean {
  if (!query.operation) return false;
  const operation = query.operation.toLocaleLowerCase();
  return record.operations.some((candidate) => candidate.toLocaleLowerCase() === operation);
}

function toIndexStatus(status: ProjectKnowledgeIndexStatus): ProjectKnowledgeStatus {
  return {
    provider: 'local',
    healthy: status.available,
    writable: true,
    diagnostics: status.diagnostic
      ? [{ code: 'index-unavailable', message: status.diagnostic }]
      : [],
    updatedAt: status.updatedAt,
  };
}

export class ProjectKnowledgeLocalStore {
  private static readonly sharedDatabases = new Map<string, SharedDatabaseEntry>();

  readonly databasePath: string;
  readonly repositoryId: string;
  readonly workspaceId: string;

  private readonly projectRoot: string;
  private database: DatabaseSync | null;
  private readonly indexStore: ProjectKnowledgeIndexStore;
  private closed = false;

  constructor(options: ProjectKnowledgeLocalStoreOptions) {
    this.projectRoot = path.resolve(options.projectRoot);
    const location = resolveProjectKnowledgeStorageLocation(
      this.projectRoot,
      options.storageRoot ?? options.cacheRoot,
    );
    this.databasePath = location.databasePath;
    this.repositoryId = location.repositoryId;
    this.workspaceId = location.workspaceId;
    mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.database = this.acquireDatabase();
    this.database.exec(
      [
        'CREATE TABLE IF NOT EXISTS pk_records (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, state TEXT NOT NULL, authority TEXT NOT NULL, payload_json TEXT NOT NULL, source_versions_json TEXT NOT NULL, updated_at TEXT NOT NULL);',
        'CREATE INDEX IF NOT EXISTS pk_records_project ON pk_records(project_id);',
        'CREATE INDEX IF NOT EXISTS pk_records_state ON pk_records(state, authority);',
      ].join('\n'),
    );
    this.indexStore = new ProjectKnowledgeIndexStore({
      projectRoot: options.projectRoot,
      ...(options.storageRoot ? { cacheRoot: options.storageRoot } : {}),
      ...(options.cacheRoot ? { cacheRoot: options.cacheRoot } : {}),
      ...(options.reportDiagnostic ? { reportDiagnostic: options.reportDiagnostic } : {}),
    });
  }

  status(): ProjectKnowledgeStatus {
    const row = this.requireDatabase()
      .prepare('SELECT COUNT(*) AS count, MAX(updated_at) AS updated_at FROM pk_records')
      .get() as { count?: number | bigint; updated_at?: string | null };
    return {
      provider: 'local',
      healthy: true,
      writable: true,
      recordCount: typeof row.count === 'bigint' ? Number(row.count) : (row.count ?? 0),
      ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
      diagnostics: [],
    };
  }

  list(options: ProjectKnowledgeRecordListOptions = {}): readonly ProjectKnowledgeRecord[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (options.projectId) {
      clauses.push('project_id = ?');
      values.push(options.projectId);
    }
    if (options.type) {
      clauses.push('type = ?');
      values.push(options.type);
    }
    if (options.state) {
      clauses.push('state = ?');
      values.push(options.state);
    }
    if (options.authority) {
      clauses.push('authority = ?');
      values.push(options.authority);
    }
    const limit = Math.max(1, Math.min(500, options.limit ?? 500));
    const rows = this.requireDatabase()
      .prepare(
        `SELECT payload_json FROM pk_records${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC, id LIMIT ?`,
      )
      .all(...values, limit) as unknown as StoredRecordRow[];
    return rows.map((row) => parseProjectKnowledgeRecord(JSON.parse(row.payload_json)));
  }

  read(id: string): ProjectKnowledgeRecord | null {
    const row = this.requireDatabase()
      .prepare('SELECT payload_json FROM pk_records WHERE id = ?')
      .get(id) as StoredRecordRow | undefined;
    return row ? parseProjectKnowledgeRecord(JSON.parse(row.payload_json)) : null;
  }

  searchRecords(query: ProjectKnowledgeQuery): readonly ProjectKnowledgeResult[] {
    const terms = [...query.terms, ...query.strongTerms, ...query.phraseTerms]
      .map((term) => term.toLocaleLowerCase())
      .filter(Boolean);
    const activeRecords = this.list({ state: 'active' });
    const direct = activeRecords
      .map((record) => {
        const text = recordSearchText(record);
        const matches = terms.filter((term) => text.includes(term)).length;
        return {
          record,
          matches,
          pathAssociation: recordHasPathAssociation(record, query),
          operationAssociation: recordHasOperationAssociation(record, query),
        };
      })
      .filter(({ matches }) => terms.length === 0 || matches > 0)
      .sort((left, right) => {
        if (left.pathAssociation !== right.pathAssociation) return left.pathAssociation ? -1 : 1;
        if (left.operationAssociation !== right.operationAssociation)
          return left.operationAssociation ? -1 : 1;
        if (left.matches !== right.matches) return right.matches - left.matches;
        const type = RECORD_TYPE_RANK[left.record.type] - RECORD_TYPE_RANK[right.record.type];
        if (type !== 0) return type;
        const source = recordResultSource(left.record).localeCompare(
          recordResultSource(right.record),
        );
        return source !== 0 ? source : left.record.id.localeCompare(right.record.id);
      });
    const recordsById = new Map(activeRecords.map((record) => [record.id, record]));
    const ranked: Array<{
      record: ProjectKnowledgeRecord;
      matches: number;
      relationSource?: ProjectKnowledgeRecordSource;
    }> = direct.map(({ record, matches }) => ({ record, matches }));
    const seen = new Set(ranked.map(({ record }) => record.id));
    for (const { record } of direct) {
      for (const relation of record.relations) {
        const related = recordsById.get(relation.targetId);
        if (!related || seen.has(related.id)) continue;
        ranked.push({ record: related, matches: 0, relationSource: relation.sources[0] });
        seen.add(related.id);
      }
    }
    return ranked.slice(0, 40).map(({ record, matches, relationSource }) => ({
      source: relationSource ? sourceReferenceLabel(relationSource) : recordResultSource(record),
      title: record.title,
      record,
      content:
        `${record.summary}\n${record.conclusions.map((conclusion) => conclusion.text).join('\n')}`.slice(
          0,
          1600,
        ),
      score: matches,
    }));
  }

  async apply(mutation: ProjectKnowledgeMutation): Promise<ProjectKnowledgeApplyResult> {
    if (mutation.kind === 'refresh') {
      const candidates = this.list({ projectId: mutation.projectId });
      let changed = false;
      for (const candidate of candidates) {
        if (candidate.state === 'retired' || (mutation.id && mutation.id !== candidate.id))
          continue;
        const inspection = inspectRecordSources(
          this.projectRoot,
          candidate,
          candidate.state === 'needs-review',
        );
        const state =
          candidate.authority === 'user' && !recordUsesSourceEvidence(candidate)
            ? 'active'
            : inspection.current
              ? 'active'
              : 'needs-review';
        if (
          state !== candidate.state ||
          (inspection.current &&
            JSON.stringify(inspection.sourceVersions) !== JSON.stringify(candidate.sourceVersions))
        ) {
          this.write({
            ...candidate,
            state,
            sourceVersions: inspection.current
              ? inspection.sourceVersions
              : candidate.sourceVersions,
            updatedAt: new Date().toISOString(),
          });
          changed = true;
        }
      }
      const records = this.list({ projectId: mutation.projectId });
      return { kind: mutation.kind, changed, records, diagnostics: [] };
    }
    const current = this.read(mutation.kind === 'upsert' ? mutation.record.id : mutation.id);
    if (mutation.kind === 'upsert') {
      const incoming = parseProjectKnowledgeRecord(mutation.record);
      if (
        current?.state === 'retired' &&
        incoming.authority === 'automatic' &&
        equalSourceVersions(current, incoming)
      ) {
        return { kind: mutation.kind, changed: false, record: current, diagnostics: [] };
      }
      const next =
        current?.state === 'retired' && incoming.authority === 'automatic'
          ? incoming
          : current
            ? mergeProjectKnowledgeRecord(current, incoming)
            : incoming;
      this.write(next);
      return {
        kind: mutation.kind,
        changed: !current || JSON.stringify(current) !== JSON.stringify(next),
        record: next,
        diagnostics: [],
      };
    }
    if (!current || current.projectId !== mutation.projectId) {
      return {
        kind: mutation.kind,
        changed: false,
        record: null,
        diagnostics: [
          {
            code: 'record-not-found',
            message: `Project knowledge record not found: ${mutation.id}`,
          },
        ],
      };
    }
    if (mutation.kind === 'retire') {
      const next = parseProjectKnowledgeRecord({
        ...current,
        state: 'retired',
        updatedAt: mutation.updatedAt,
      });
      this.write(next);
      return { kind: mutation.kind, changed: true, record: next, diagnostics: [] };
    }
    const corrected = parseProjectKnowledgeRecord({
      ...current,
      ...(mutation.title !== undefined ? { title: mutation.title } : {}),
      ...(mutation.summary !== undefined ? { summary: mutation.summary } : {}),
      ...(mutation.applicablePaths !== undefined
        ? { applicablePaths: mutation.applicablePaths }
        : {}),
      ...(mutation.operations !== undefined ? { operations: mutation.operations } : {}),
      ...(mutation.conclusions !== undefined ? { conclusions: mutation.conclusions } : {}),
      ...(mutation.relations !== undefined ? { relations: mutation.relations } : {}),
      ...(mutation.verification !== undefined ? { verification: mutation.verification } : {}),
      authority: 'user',
      state: 'active',
      updatedAt: mutation.updatedAt,
    });
    const inspection = inspectRecordSources(this.projectRoot, corrected, true);
    const next = parseProjectKnowledgeRecord({
      ...corrected,
      state:
        corrected.authority === 'user' && !recordUsesSourceEvidence(corrected)
          ? 'active'
          : inspection.current
            ? 'active'
            : 'needs-review',
      sourceVersions: inspection.current ? inspection.sourceVersions : corrected.sourceVersions,
    });
    this.write(next);
    return { kind: mutation.kind, changed: true, record: next, diagnostics: [] };
  }

  async syncCorpus(
    corpus: readonly ProjectKnowledgeDocument[],
  ): Promise<ProjectKnowledgeIndexSyncResult> {
    return this.indexStore.syncCorpus(corpus);
  }

  async indexStatus(): Promise<ProjectKnowledgeIndexStatus> {
    await this.indexStore.open();
    return this.indexStore.status();
  }

  searchSections(query: ProjectKnowledgeQuery): readonly ProjectKnowledgeResult[] {
    return this.indexStore.search(query);
  }

  async rebuildWorkspace(
    corpus: readonly ProjectKnowledgeDocument[],
  ): Promise<ProjectKnowledgeStatus> {
    return toIndexStatus(await this.indexStore.rebuild(corpus));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.indexStore.close();
    ProjectKnowledgeLocalStore.releaseDatabase(this.databasePath);
    this.database = null;
  }

  private write(record: ProjectKnowledgeRecord): void {
    const payload = JSON.stringify(record);
    const database = this.requireDatabase();
    database.exec('BEGIN IMMEDIATE;');
    try {
      database
        .prepare(
          'INSERT INTO pk_records(id, project_id, type, state, authority, payload_json, source_versions_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, type = excluded.type, state = excluded.state, authority = excluded.authority, payload_json = excluded.payload_json, source_versions_json = excluded.source_versions_json, updated_at = excluded.updated_at',
        )
        .run(
          record.id,
          record.projectId,
          record.type,
          record.state,
          record.authority,
          payload,
          JSON.stringify(record.sourceVersions),
          record.updatedAt,
        );
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  private acquireDatabase(): DatabaseSync {
    const shared = ProjectKnowledgeLocalStore.sharedDatabases.get(this.databasePath);
    if (shared) {
      shared.refs += 1;
      if (!shared.database) throw new Error('Project knowledge local store database is closed');
      return shared.database;
    }
    const database = new DatabaseSync(this.databasePath);
    database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 250;');
    ProjectKnowledgeLocalStore.sharedDatabases.set(this.databasePath, { database, refs: 1 });
    return database;
  }

  private static releaseDatabase(databasePath: string): void {
    const shared = ProjectKnowledgeLocalStore.sharedDatabases.get(databasePath);
    if (!shared) return;
    shared.refs -= 1;
    if (shared.refs > 0) return;
    ProjectKnowledgeLocalStore.sharedDatabases.delete(databasePath);
    const database = shared.database;
    shared.database = null;
    database?.close();
  }

  private requireDatabase(): DatabaseSync {
    if (!this.database) throw new Error('Project knowledge local store is closed');
    return this.database;
  }
}
