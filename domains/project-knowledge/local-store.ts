import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

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
import { openProjectKnowledgeDatabase, type ProjectKnowledgeDatabase } from './sqlite.js';
import type { AgentContextOutcomeStatus } from '../agent-learning/index.js';

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

interface StoredAppliedMutationRow {
  readonly mutation_key: string;
  readonly applied_at: string;
}

interface StoredApplicationOutcomeRow {
  readonly record_id: string;
  readonly application_id: string;
  readonly status: AgentContextOutcomeStatus;
  readonly revision: number;
}

interface StoredFeedbackStateRow {
  readonly record_id: string;
  readonly base_state: ProjectKnowledgeRecord['state'];
}

export interface ProjectKnowledgeStoreSnapshot {
  readonly records: readonly ProjectKnowledgeRecord[];
  readonly appliedMutations: readonly {
    readonly mutationKey: string;
    readonly appliedAt: string;
  }[];
  readonly applicationOutcomes: readonly {
    readonly recordId: string;
    readonly applicationId: string;
    readonly status: AgentContextOutcomeStatus;
    readonly revision: number;
  }[];
  readonly feedbackStates: readonly {
    readonly recordId: string;
    readonly baseState: ProjectKnowledgeRecord['state'];
  }[];
}

interface SharedDatabaseEntry {
  database: ProjectKnowledgeDatabase | null;
  refs: number;
}

const MAX_SOURCE_VALIDATION_BYTES = 1024 * 1024;
const PROJECT_KNOWLEDGE_SCHEMA_VERSION = '4';

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

function verificationCommandsAreAvailable(
  projectRoot: string,
  record: ProjectKnowledgeRecord,
): boolean {
  return record.verification.every(
    (entry) => verificationCommandStatus(projectRoot, entry.command) !== 'missing',
  );
}

function verificationCommandsAreConfirmed(
  projectRoot: string,
  record: ProjectKnowledgeRecord,
): boolean {
  return (
    record.verification.length > 0 &&
    record.verification.every(
      (entry) => verificationCommandStatus(projectRoot, entry.command) === 'current',
    )
  );
}

type VerificationCommandStatus = 'current' | 'missing' | 'unknown';

function verificationCommandStatus(
  projectRoot: string,
  command: string,
): VerificationCommandStatus {
  const normalized = command.trim().replace(/\s+/gu, ' ');
  if (/^comet (?:native check|classic guard)(?:\s|$)/u.test(normalized)) return 'current';
  const explicitRun = /^(?:pnpm|npm|yarn|bun) run ([A-Za-z0-9:_-]+)(?:\s|$)/u.exec(normalized);
  const directScript = /^(?:pnpm|yarn) ([A-Za-z0-9:_-]+)(?:\s|$)/u.exec(normalized);
  const npmLifecycle = /^npm (test|start|stop|restart)(?:\s|$)/u.exec(normalized);
  const scriptName = explicitRun?.[1] ?? directScript?.[1] ?? npmLifecycle?.[1];
  if (scriptName !== undefined) {
    try {
      const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
        scripts?: Record<string, unknown>;
      };
      return typeof manifest.scripts?.[scriptName] === 'string' ? 'current' : 'missing';
    } catch {
      return 'missing';
    }
  }

  const executable = normalized.split(' ')[0]?.replaceAll('\\', '/') ?? '';
  if (/^(?:\.\/)?(?:mvnw(?:\.cmd)?|gradlew(?:\.bat)?)$/iu.test(executable)) {
    return projectFileExists(projectRoot, executable.replace(/^\.\//u, '')) ? 'current' : 'missing';
  }
  if (/^\.\/[A-Za-z0-9._/-]+$/u.test(executable)) {
    return projectFileExists(projectRoot, executable.slice(2)) ? 'current' : 'missing';
  }
  if (/^(?:mvn|mvn\.cmd)$/iu.test(executable)) {
    return projectFileExists(projectRoot, 'pom.xml') ? 'current' : 'unknown';
  }
  if (/^(?:gradle|gradle\.bat)$/iu.test(executable)) {
    return ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].some(
      (marker) => projectFileExists(projectRoot, marker),
    )
      ? 'current'
      : 'unknown';
  }
  if (
    executable === 'pytest' ||
    (/^(?:python|python3|py)$/iu.test(executable) && /^\S+ -m pytest(?:\s|$)/u.test(normalized))
  ) {
    return ['pyproject.toml', 'pytest.ini', 'setup.cfg', 'tox.ini'].some((marker) =>
      projectFileExists(projectRoot, marker),
    )
      ? 'current'
      : 'unknown';
  }
  return 'unknown';
}

function projectFileExists(projectRoot: string, relativePath: string): boolean {
  try {
    return statSync(path.join(projectRoot, ...relativePath.split('/'))).isFile();
  } catch {
    return false;
  }
}

function negativeProjectKnowledgeOutcome(
  outcome: import('../agent-learning/index.js').AgentContextOutcomeStatus | undefined,
): boolean {
  return outcome === 'corrected' || outcome === 'contributed-to-failure';
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
    ...(record.phases ?? []),
    ...record.conclusions.map((conclusion) => conclusion.text),
  ]
    .join('\n')
    .toLocaleLowerCase();
}

const RECORD_TYPE_RANK: Readonly<Record<ProjectKnowledgeRecord['type'], number>> = {
  topology: 0,
  fact: 1,
  dependency: 2,
  constraint: 3,
  decision: 4,
  pattern: 5,
  procedure: 6,
  'failure-resolution': 7,
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

function recordMatchesApplicablePath(
  record: ProjectKnowledgeRecord,
  query: ProjectKnowledgeQuery,
): boolean {
  if (!query.path) return false;
  const queryPath = normalizedProjectPath(query.path);
  return record.applicablePaths
    .map(normalizedProjectPath)
    .some((candidate) => projectPathSelectorMatches(candidate, queryPath));
}

function projectPathSelectorMatches(selector: string, projectPath: string): boolean {
  if (!/[?*]/u.test(selector)) {
    return (
      selector === projectPath ||
      projectPath.startsWith(selector.endsWith('/') ? selector : `${selector}/`)
    );
  }
  let pattern = '^';
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index]!;
    const next = selector[index + 1];
    if (character === '*' && next === '*') {
      if (selector[index + 2] === '/') {
        pattern += '(?:.*/)?';
        index += 2;
      } else {
        pattern += '.*';
        index += 1;
      }
    } else if (character === '*') pattern += '[^/]*';
    else if (character === '?') pattern += '[^/]';
    else pattern += character.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
  }
  return new RegExp(`${pattern}$`, 'u').test(projectPath);
}

function recordHasOperationAssociation(
  record: ProjectKnowledgeRecord,
  query: ProjectKnowledgeQuery,
): boolean {
  if (!query.operation) return false;
  const operation = query.operation.toLocaleLowerCase();
  return record.operations.some((candidate) => candidate.toLocaleLowerCase() === operation);
}

function recordMatchesSelectors(
  record: ProjectKnowledgeRecord,
  query: ProjectKnowledgeQuery,
): boolean {
  if (record.applicablePaths.length > 0) {
    if (!query.path || !recordMatchesApplicablePath(record, query)) return false;
  }
  if (record.operations.length > 0) {
    if (!query.operation || !recordHasOperationAssociation(record, query)) return false;
  }
  const phases = record.phases ?? [];
  if (phases.length > 0) {
    if (!query.phase) return false;
    const phase = query.phase.toLocaleLowerCase();
    if (!phases.some((candidate) => candidate.toLocaleLowerCase() === phase)) return false;
  }
  return true;
}

function recordLifecycleRank(record: ProjectKnowledgeRecord): number {
  return record.state === 'enforced' ? 3 : record.state === 'proven' ? 2 : 1;
}

function recordAuthorityRank(record: ProjectKnowledgeRecord): number {
  return record.authority === 'user' ? 3 : record.authority === 'repository' ? 2 : 1;
}

function recordFeedbackRank(record: ProjectKnowledgeRecord): number {
  return Math.min(record.successCount, 10) * 4 - Math.min(record.failureCount, 10) * 8;
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
  private database: ProjectKnowledgeDatabase | null;
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
    this.initializeSchema();
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

  importNewerRecords(records: readonly ProjectKnowledgeRecord[]): number {
    const statement = this.requireDatabase().prepare(
      'INSERT INTO pk_records(id, project_id, type, state, authority, payload_json, source_versions_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, type = excluded.type, state = excluded.state, authority = excluded.authority, payload_json = excluded.payload_json, source_versions_json = excluded.source_versions_json, updated_at = excluded.updated_at WHERE pk_records.updated_at < excluded.updated_at',
    );
    let imported = 0;
    for (const incoming of records) {
      const result = statement.run(
        incoming.id,
        incoming.projectId,
        incoming.type,
        incoming.state,
        incoming.authority,
        JSON.stringify(incoming),
        JSON.stringify(incoming.sourceVersions),
        incoming.updatedAt,
      );
      imported += Number(result.changes);
    }
    return imported;
  }

  importSnapshot(snapshot: ProjectKnowledgeStoreSnapshot, migrationKey?: string): boolean {
    const records = snapshot.records.map((incoming) => [
      incoming.id,
      incoming.projectId,
      incoming.type,
      incoming.state,
      incoming.authority,
      JSON.stringify(incoming),
      JSON.stringify(incoming.sourceVersions),
      incoming.updatedAt,
    ]);
    const database = this.requireDatabase();
    database.exec('BEGIN IMMEDIATE;');
    try {
      if (
        migrationKey !== undefined &&
        database.prepare('SELECT value FROM pk_meta WHERE key = ?').get(migrationKey)
      ) {
        database.exec('COMMIT;');
        return false;
      }
      const recordStatement = database.prepare(
        'INSERT INTO pk_records(id, project_id, type, state, authority, payload_json, source_versions_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, type = excluded.type, state = excluded.state, authority = excluded.authority, payload_json = excluded.payload_json, source_versions_json = excluded.source_versions_json, updated_at = excluded.updated_at WHERE pk_records.updated_at < excluded.updated_at',
      );
      for (const values of records) recordStatement.run(...values);

      const mutationStatement = database.prepare(
        'INSERT OR IGNORE INTO pk_applied_mutations(mutation_key, applied_at) VALUES (?, ?)',
      );
      for (const mutation of snapshot.appliedMutations) {
        mutationStatement.run(mutation.mutationKey, mutation.appliedAt);
      }

      const outcomeStatement = database.prepare(
        'INSERT INTO pk_application_outcomes(record_id, application_id, status, revision) VALUES (?, ?, ?, ?) ON CONFLICT(record_id, application_id) DO UPDATE SET status = excluded.status, revision = excluded.revision WHERE pk_application_outcomes.revision < excluded.revision',
      );
      for (const outcome of snapshot.applicationOutcomes) {
        outcomeStatement.run(
          outcome.recordId,
          outcome.applicationId,
          outcome.status,
          outcome.revision,
        );
      }

      const feedbackStatement = database.prepare(
        'INSERT OR IGNORE INTO pk_feedback_state(record_id, base_state) VALUES (?, ?)',
      );
      for (const feedback of snapshot.feedbackStates) {
        feedbackStatement.run(feedback.recordId, feedback.baseState);
      }
      if (migrationKey !== undefined) {
        database
          .prepare('INSERT INTO pk_meta(key, value) VALUES (?, ?)')
          .run(migrationKey, 'complete');
      }
      database.exec('COMMIT;');
      return true;
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  searchRecords(query: ProjectKnowledgeQuery): readonly ProjectKnowledgeResult[] {
    const terms = [...query.terms, ...query.strongTerms, ...query.phraseTerms]
      .map((term) => term.toLocaleLowerCase())
      .filter(Boolean);
    const applicableRecords = this.list().filter(
      (record) => record.state !== 'superseded' && recordMatchesSelectors(record, query),
    );
    const direct = applicableRecords
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
        const lifecycle = recordLifecycleRank(right.record) - recordLifecycleRank(left.record);
        if (lifecycle !== 0) return lifecycle;
        const authority = recordAuthorityRank(right.record) - recordAuthorityRank(left.record);
        if (authority !== 0) return authority;
        const feedback = recordFeedbackRank(right.record) - recordFeedbackRank(left.record);
        if (feedback !== 0) return feedback;
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
    const recordsById = new Map(applicableRecords.map((record) => [record.id, record]));
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

  async apply(
    mutation: Exclude<ProjectKnowledgeMutation, { readonly kind: 'experience-delta' }>,
  ): Promise<ProjectKnowledgeApplyResult> {
    if (mutation.kind === 'refresh') {
      const candidates = this.list({ projectId: mutation.projectId });
      let changed = false;
      for (const candidate of candidates) {
        if (candidate.state === 'superseded' || (mutation.id && mutation.id !== candidate.id))
          continue;
        const inspection = inspectRecordSources(this.projectRoot, candidate, false);
        const verificationCurrent = verificationCommandsAreAvailable(this.projectRoot, candidate);
        const state: ProjectKnowledgeRecord['state'] = !verificationCurrent
          ? 'superseded'
          : candidate.authority === 'user' && !recordUsesSourceEvidence(candidate)
            ? candidate.state === 'enforced'
              ? 'enforced'
              : 'proven'
            : inspection.current
              ? candidate.state === 'enforced'
                ? 'enforced'
                : 'proven'
              : 'superseded';
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
    if (mutation.kind === 'verify') {
      const successful = new Set(mutation.commands.map((command) => command.trim()));
      const candidates = this.list({ projectId: mutation.projectId, type: 'constraint' });
      let changed = false;
      for (const candidate of candidates) {
        if (
          candidate.state === 'superseded' ||
          candidate.verification.length === 0 ||
          !candidate.verification.every(
            (entry) =>
              successful.has(entry.command.trim()) &&
              verificationCommandStatus(this.projectRoot, entry.command) !== 'missing',
          )
        )
          continue;
        if (candidate.state !== 'enforced') {
          this.write({ ...candidate, state: 'enforced', updatedAt: mutation.updatedAt });
          changed = true;
        }
      }
      return {
        kind: mutation.kind,
        changed,
        records: this.list({ projectId: mutation.projectId }),
        diagnostics: [],
      };
    }
    if (mutation.kind === 'feedback') return this.applyFeedback(mutation);
    const current = this.read(mutation.kind === 'upsert' ? mutation.record.id : mutation.id);
    if (mutation.kind === 'upsert') {
      const parsedIncoming = parseProjectKnowledgeRecord(mutation.record);
      const incoming =
        parsedIncoming.state === 'enforced' &&
        !verificationCommandsAreConfirmed(this.projectRoot, parsedIncoming)
          ? parseProjectKnowledgeRecord({ ...parsedIncoming, state: 'proven' })
          : parsedIncoming;
      if (
        current?.state === 'superseded' &&
        incoming.authority !== 'user' &&
        equalSourceVersions(current, incoming)
      ) {
        return { kind: mutation.kind, changed: false, record: current, diagnostics: [] };
      }
      if (current?.state === 'superseded' && incoming.authority !== 'user') {
        const versioned = versionProjectKnowledgeRecord(current, incoming);
        const existingVersion = this.read(versioned.id);
        const next = existingVersion
          ? mergeProjectKnowledgeRecord(existingVersion, versioned)
          : versioned;
        this.write(next);
        return {
          kind: mutation.kind,
          changed: !existingVersion || JSON.stringify(existingVersion) !== JSON.stringify(next),
          record: next,
          diagnostics: [],
        };
      }
      const next = current ? mergeProjectKnowledgeRecord(current, incoming) : incoming;
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
    if (mutation.kind === 'supersede') {
      const next = parseProjectKnowledgeRecord({
        ...current,
        state: 'superseded',
        updatedAt: mutation.updatedAt,
      });
      this.write(next);
      return { kind: mutation.kind, changed: true, record: next, diagnostics: [] };
    }
    const correctedBase = parseProjectKnowledgeRecord({
      ...current,
      ...(mutation.title !== undefined ? { title: mutation.title } : {}),
      ...(mutation.summary !== undefined ? { summary: mutation.summary } : {}),
      ...(mutation.applicablePaths !== undefined
        ? { applicablePaths: mutation.applicablePaths }
        : {}),
      ...(mutation.operations !== undefined ? { operations: mutation.operations } : {}),
      ...(mutation.phases !== undefined ? { phases: mutation.phases } : {}),
      ...(mutation.conclusions !== undefined ? { conclusions: mutation.conclusions } : {}),
      ...(mutation.relations !== undefined ? { relations: mutation.relations } : {}),
      ...(mutation.verification !== undefined ? { verification: mutation.verification } : {}),
      authority: 'user',
      state: 'proven',
      updatedAt: mutation.updatedAt,
    });
    const corrected = parseProjectKnowledgeRecord({ ...correctedBase, state: 'proven' });
    const inspection = inspectRecordSources(this.projectRoot, corrected, true);
    const next = parseProjectKnowledgeRecord({
      ...corrected,
      state:
        corrected.authority === 'user' && !recordUsesSourceEvidence(corrected)
          ? corrected.state
          : inspection.current
            ? corrected.state
            : 'trial',
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

  async mutationApplied(idempotencyKey: string): Promise<boolean> {
    return Boolean(
      this.requireDatabase()
        .prepare('SELECT mutation_key FROM pk_applied_mutations WHERE mutation_key = ?')
        .get(idempotencyKey),
    );
  }

  async markMutationApplied(idempotencyKey: string, appliedAt: string): Promise<void> {
    const database = this.requireDatabase();
    database.exec('BEGIN IMMEDIATE;');
    try {
      database
        .prepare(
          'INSERT OR IGNORE INTO pk_applied_mutations(mutation_key, applied_at) VALUES (?, ?)',
        )
        .run(idempotencyKey, appliedAt);
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
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
    const database = this.requireDatabase();
    database.exec('BEGIN IMMEDIATE;');
    try {
      this.writeRecord(database, record);
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  private applyFeedback(
    mutation: Extract<ProjectKnowledgeMutation, { readonly kind: 'feedback' }>,
  ): ProjectKnowledgeApplyResult {
    const database = this.requireDatabase();
    database.exec('BEGIN IMMEDIATE;');
    try {
      if (
        mutation.idempotencyKey !== undefined &&
        database
          .prepare('SELECT mutation_key FROM pk_applied_mutations WHERE mutation_key = ?')
          .get(mutation.idempotencyKey)
      ) {
        const current = this.read(mutation.id);
        database.exec('COMMIT;');
        return { kind: mutation.kind, changed: false, record: current, diagnostics: [] };
      }
      const current = this.read(mutation.id);
      if (!current || current.projectId !== mutation.projectId) {
        database.exec('COMMIT;');
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
      const successful = mutation.outcome === 'used-successfully';
      const failed = negativeProjectKnowledgeOutcome(mutation.outcome);
      const storedOutcome =
        mutation.applicationId === undefined
          ? undefined
          : (database
              .prepare(
                'SELECT status, revision FROM pk_application_outcomes WHERE record_id = ? AND application_id = ?',
              )
              .get(current.id, mutation.applicationId) as
              | {
                  status: import('../agent-learning/index.js').AgentContextOutcomeStatus;
                  revision: number;
                }
              | undefined);
      const revision = mutation.revision ?? (storedOutcome?.revision ?? 0) + 1;
      if (storedOutcome !== undefined && revision <= storedOutcome.revision) {
        if (mutation.idempotencyKey !== undefined) {
          database
            .prepare(
              'INSERT OR IGNORE INTO pk_applied_mutations(mutation_key, applied_at) VALUES (?, ?)',
            )
            .run(mutation.idempotencyKey, mutation.updatedAt);
        }
        database.exec('COMMIT;');
        return { kind: mutation.kind, changed: false, record: current, diagnostics: [] };
      }
      const previousOutcome =
        storedOutcome?.status ??
        (mutation.applicationId === undefined ? mutation.previousOutcome : undefined);
      const previousSuccessful = previousOutcome === 'used-successfully';
      const previousFailed = negativeProjectKnowledgeOutcome(previousOutcome);
      if (mutation.applicationId !== undefined) {
        database
          .prepare(
            [
              'INSERT INTO pk_application_outcomes(record_id, application_id, status, revision)',
              'VALUES (?, ?, ?, ?)',
              'ON CONFLICT(record_id, application_id) DO UPDATE SET status = excluded.status, revision = excluded.revision',
            ].join(' '),
          )
          .run(current.id, mutation.applicationId, mutation.outcome, revision);
      }
      const feedbackState = database
        .prepare('SELECT base_state FROM pk_feedback_state WHERE record_id = ?')
        .get(current.id) as { base_state: ProjectKnowledgeRecord['state'] } | undefined;
      if (
        current.authority === 'automatic' &&
        failed &&
        current.state !== 'superseded' &&
        feedbackState === undefined
      ) {
        database
          .prepare('INSERT INTO pk_feedback_state(record_id, base_state) VALUES (?, ?)')
          .run(current.id, current.state);
      }
      const negativeOutcomeCount = (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM pk_application_outcomes WHERE record_id = ? AND status IN ('corrected', 'contributed-to-failure')",
          )
          .get(current.id) as { count: number }
      ).count;
      const shouldRestore =
        !failed && feedbackState !== undefined && Number(negativeOutcomeCount) === 0;
      const restoredState = shouldRestore ? feedbackState.base_state : current.state;
      const next = parseProjectKnowledgeRecord({
        ...current,
        state:
          current.authority === 'automatic' && failed
            ? 'superseded'
            : restoredState === 'trial' && successful
              ? 'proven'
              : restoredState,
        applicationCount:
          current.applicationCount +
          Number(
            mutation.applicationId === undefined
              ? mutation.previousOutcome === undefined
              : storedOutcome === undefined,
          ),
        successCount: Math.max(
          0,
          current.successCount + Number(successful) - Number(previousSuccessful),
        ),
        failureCount: Math.max(0, current.failureCount + Number(failed) - Number(previousFailed)),
        lastAppliedAt: mutation.updatedAt,
        updatedAt: mutation.updatedAt,
      });
      this.writeRecord(database, next);
      if (shouldRestore) {
        database.prepare('DELETE FROM pk_feedback_state WHERE record_id = ?').run(current.id);
      }
      if (mutation.idempotencyKey !== undefined) {
        database
          .prepare(
            'INSERT OR IGNORE INTO pk_applied_mutations(mutation_key, applied_at) VALUES (?, ?)',
          )
          .run(mutation.idempotencyKey, mutation.updatedAt);
      }
      database.exec('COMMIT;');
      return { kind: mutation.kind, changed: true, record: next, diagnostics: [] };
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  private writeRecord(database: ProjectKnowledgeDatabase, record: ProjectKnowledgeRecord): void {
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
        JSON.stringify(record),
        JSON.stringify(record.sourceVersions),
        record.updatedAt,
      );
  }

  private initializeSchema(): void {
    const database = this.requireDatabase();
    database.exec(
      'CREATE TABLE IF NOT EXISTS pk_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
    );
    const metadata = database
      .prepare("SELECT value FROM pk_meta WHERE key = 'schema_version'")
      .get() as { value?: string } | undefined;
    if (metadata?.value === PROJECT_KNOWLEDGE_SCHEMA_VERSION) {
      this.createRecordSchema(database);
      return;
    }
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(
        [
          'DROP TABLE IF EXISTS pk_records;',
          'DROP TABLE IF EXISTS pk_applied_mutations;',
          'DROP TABLE IF EXISTS pk_application_outcomes;',
          'DROP TABLE IF EXISTS pk_feedback_state;',
          'DELETE FROM pk_meta;',
        ].join('\n'),
      );
      this.createRecordSchema(database);
      database
        .prepare("INSERT INTO pk_meta(key, value) VALUES ('schema_version', ?)")
        .run(PROJECT_KNOWLEDGE_SCHEMA_VERSION);
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  private createRecordSchema(database: ProjectKnowledgeDatabase): void {
    database.exec(
      [
        'CREATE TABLE IF NOT EXISTS pk_records (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, state TEXT NOT NULL, authority TEXT NOT NULL, payload_json TEXT NOT NULL, source_versions_json TEXT NOT NULL, updated_at TEXT NOT NULL);',
        'CREATE INDEX IF NOT EXISTS pk_records_project ON pk_records(project_id);',
        'CREATE INDEX IF NOT EXISTS pk_records_state ON pk_records(state, authority);',
        'CREATE TABLE IF NOT EXISTS pk_applied_mutations (mutation_key TEXT PRIMARY KEY, applied_at TEXT NOT NULL);',
        'CREATE TABLE IF NOT EXISTS pk_application_outcomes (record_id TEXT NOT NULL, application_id TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(record_id, application_id));',
        'CREATE TABLE IF NOT EXISTS pk_feedback_state (record_id TEXT PRIMARY KEY, base_state TEXT NOT NULL);',
      ].join('\n'),
    );
  }

  private acquireDatabase(): ProjectKnowledgeDatabase {
    const shared = ProjectKnowledgeLocalStore.sharedDatabases.get(this.databasePath);
    if (shared) {
      shared.refs += 1;
      if (!shared.database) throw new Error('Project knowledge local store database is closed');
      return shared.database;
    }
    const database = openProjectKnowledgeDatabase(this.databasePath);
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

  private requireDatabase(): ProjectKnowledgeDatabase {
    if (!this.database) throw new Error('Project knowledge local store is closed');
    return this.database;
  }
}

export function readProjectKnowledgeStoreSnapshot(
  databasePath: string,
): ProjectKnowledgeStoreSnapshot {
  const database = openProjectKnowledgeDatabase(databasePath, { readOnly: true });
  try {
    database.exec('BEGIN;');
    try {
      const records = (
        database
          .prepare('SELECT payload_json FROM pk_records')
          .all() as unknown as StoredRecordRow[]
      ).flatMap((row) => {
        try {
          return [parseProjectKnowledgeRecord(JSON.parse(row.payload_json))];
        } catch {
          return [];
        }
      });
      const appliedMutations = (
        database
          .prepare('SELECT mutation_key, applied_at FROM pk_applied_mutations')
          .all() as unknown as StoredAppliedMutationRow[]
      ).map((row) => ({ mutationKey: row.mutation_key, appliedAt: row.applied_at }));
      const applicationOutcomes = (
        database
          .prepare(
            'SELECT record_id, application_id, status, revision FROM pk_application_outcomes',
          )
          .all() as unknown as StoredApplicationOutcomeRow[]
      ).map((row) => ({
        recordId: row.record_id,
        applicationId: row.application_id,
        status: row.status,
        revision: row.revision,
      }));
      const feedbackStates = (
        database
          .prepare('SELECT record_id, base_state FROM pk_feedback_state')
          .all() as unknown as StoredFeedbackStateRow[]
      ).map((row) => ({ recordId: row.record_id, baseState: row.base_state }));
      database.exec('COMMIT;');
      return { records, appliedMutations, applicationOutcomes, feedbackStates };
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  } finally {
    database.close();
  }
}

function versionProjectKnowledgeRecord(
  superseded: ProjectKnowledgeRecord,
  incoming: ProjectKnowledgeRecord,
): ProjectKnowledgeRecord {
  const signature = createHash('sha256')
    .update(
      JSON.stringify({
        type: incoming.type,
        title: incoming.title,
        summary: incoming.summary,
        conclusions: incoming.conclusions,
        verification: incoming.verification,
        sourceVersions: incoming.sourceVersions,
      }),
    )
    .digest('hex')
    .slice(0, 12);
  const id = `${incoming.id.slice(0, 112)}-v-${signature}`;
  const source =
    recordSourceReferences(incoming)[0] ??
    (incoming.sourceVersions[0] === undefined
      ? undefined
      : { source: incoming.sourceVersions[0].source });
  const retainedRelations = incoming.relations.filter(
    (relation) => relation.type !== 'supersedes' || relation.targetId !== superseded.id,
  );
  return parseProjectKnowledgeRecord({
    ...incoming,
    id,
    relations:
      source === undefined
        ? incoming.relations
        : [
            ...retainedRelations.slice(0, 15),
            { type: 'supersedes', targetId: superseded.id, sources: [source] },
          ],
  });
}
