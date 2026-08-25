import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveProjectKnowledgeStorageLocation } from '../../platform/paths/project-knowledge-storage.js';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import { openProjectKnowledgeDatabase, type ProjectKnowledgeDatabase } from './sqlite.js';
import type {
  ProjectKnowledgeDocument,
  ProjectKnowledgeDiagnosticReporter,
  ProjectKnowledgeQuery,
  ProjectKnowledgeResult,
} from './types.js';

const INDEX_SCHEMA = 'comet.project-knowledge.index.v2';
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_SECTION_CHARS = 16_000;
const MAX_LEXICAL_TERMS = 256;
const MAX_SYNC_MS = 2_000;

export interface ProjectKnowledgeIndexOptions {
  readonly projectRoot: string;
  readonly cacheRoot?: string;
  readonly storageRoot?: string;
  readonly reportDiagnostic?: ProjectKnowledgeDiagnosticReporter;
}

export interface ProjectKnowledgeIndexStatus {
  readonly schema: typeof INDEX_SCHEMA;
  readonly available: boolean;
  readonly databasePath: string;
  readonly repositoryId: string;
  readonly workspaceId: string;
  readonly sourceCount: number;
  readonly sources: readonly ProjectKnowledgeIndexSource[];
  readonly sectionCount: number;
  readonly updatedAt?: string;
  readonly lastQueryMs?: number;
  readonly lastCandidateCount?: number;
  readonly channels: readonly string[];
  readonly diagnostic?: string;
}

export interface ProjectKnowledgeIndexSource {
  readonly source: string;
  readonly kind: ProjectKnowledgeDocument['kind'];
  readonly archivedAt?: string;
  readonly updatedAt: string;
}

export interface ProjectKnowledgeIndexSyncResult {
  readonly changedSources: readonly ProjectKnowledgeDocument[];
  /** Sources successfully refreshed during this sync; used to bound the rg fallback. */
  readonly refreshedSources: readonly ProjectKnowledgeDocument[];
  readonly status: ProjectKnowledgeIndexStatus;
}

interface ParsedSection {
  readonly anchor: string;
  readonly title: string;
  readonly headingPath: string;
  readonly body: string;
  readonly lexicalTerms: string;
}

interface IndexedSectionRow {
  readonly id: number;
  readonly anchor: string;
  readonly title: string;
  readonly heading_path: string;
  readonly body: string;
  readonly lexical_terms: string;
}

interface SearchRow {
  readonly id: number;
  readonly source: string;
  readonly kind: ProjectKnowledgeDocument['kind'];
  readonly archived_at: string | null;
  readonly title: string;
  readonly heading_path: string;
  readonly body: string;
  readonly rank: number;
}

function countValue(value: unknown): number {
  return typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : 0;
}

function metaMap(database: ProjectKnowledgeDatabase): Map<string, string> {
  const rows = database.prepare('SELECT key, value FROM pk_meta').all() as Array<{
    key: string;
    value: string;
  }>;
  return new Map(rows.map(({ key, value }) => [key, value]));
}

function setMeta(database: ProjectKnowledgeDatabase, key: string, value: string): void {
  database
    .prepare(
      'INSERT INTO pk_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(key, value);
}

function quoteFts(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function ftsExpression(values: readonly string[]): string | null {
  const terms = [
    ...new Set(values.map((value) => value.trim()).filter((value) => value.length >= 2)),
  ];
  return terms.length > 0 ? terms.map(quoteFts).join(' OR ') : null;
}

function normalizedLines(markdown: string): string[] {
  return markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
}

function anchorPart(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return normalized.slice(0, 100) || 'section';
}

function lexicalTerms(value: string): string {
  const terms: string[] = [];
  const add = (term: string): void => {
    const normalized = term.trim().toLocaleLowerCase();
    if (normalized.length < 2 || terms.includes(normalized) || terms.length >= MAX_LEXICAL_TERMS)
      return;
    terms.push(normalized);
  };
  for (const match of value.matchAll(/[A-Za-z][A-Za-z0-9_./:-]*/gu)) {
    add(match[0]);
    for (const segment of match[0].split(/[./:-]/u)) add(segment);
  }
  for (const match of value.matchAll(/[\u3400-\u9fff]{2,}/gu)) {
    const phrase = match[0];
    add(phrase);
    for (let width = Math.min(4, phrase.length); width >= 2; width -= 1) {
      for (let index = 0; index + width <= phrase.length; index += 1) {
        add(phrase.slice(index, index + width));
      }
    }
  }
  return terms.join(' ');
}

export function parseProjectKnowledgeSections(
  source: string,
  markdown: string,
): readonly ParsedSection[] {
  const lines = normalizedLines(markdown);
  let contentStart = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.slice(1).findIndex((line) => line.trim() === '---');
    if (end >= 0) contentStart = end + 2;
  }
  const headings: Array<{ line: number; level: number; title: string; path: string }> = [];
  const stack: string[] = [];
  for (let index = contentStart; index < lines.length; index += 1) {
    const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(lines[index] ?? '');
    if (!match) continue;
    const level = match[1].length;
    const title = match[2].trim().slice(0, 200);
    stack.length = level - 1;
    stack[level - 1] = title;
    headings.push({ line: index, level, title, path: stack.filter(Boolean).join(' > ') });
  }
  if (headings.length === 0) {
    const body = lines.slice(contentStart).join('\n').trim().slice(0, MAX_SECTION_CHARS);
    if (!body) return [];
    const title = path.posix.basename(source, path.posix.extname(source));
    return [
      {
        anchor: 'document',
        title,
        headingPath: title,
        body,
        lexicalTerms: lexicalTerms(`${source}\n${title}\n${body}`),
      },
    ];
  }
  const occurrences = new Map<string, number>();
  return headings.map((heading, index) => {
    const body = lines
      .slice(heading.line, headings[index + 1]?.line ?? lines.length)
      .join('\n')
      .trim()
      .slice(0, MAX_SECTION_CHARS);
    const base = heading.path.split(' > ').map(anchorPart).join('/');
    const ordinal = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, ordinal);
    const anchor = ordinal === 1 ? base : `${base}-${ordinal}`;
    return {
      anchor,
      title: heading.title,
      headingPath: heading.path,
      body,
      lexicalTerms: lexicalTerms(`${source}\n${heading.path}\n${body}`),
    };
  });
}

export class ProjectKnowledgeIndexStore {
  readonly databasePath: string;
  readonly repositoryId: string;
  readonly workspaceId: string;
  lastSyncReadBytes = 0;

  private readonly projectRoot: string;
  private readonly reportDiagnostic: ProjectKnowledgeDiagnosticReporter | undefined;
  private database: ProjectKnowledgeDatabase | null = null;

  constructor(options: ProjectKnowledgeIndexOptions) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.reportDiagnostic = options.reportDiagnostic;
    const location = resolveProjectKnowledgeStorageLocation(
      this.projectRoot,
      options.storageRoot ?? options.cacheRoot,
    );
    this.databasePath = location.databasePath;
    this.repositoryId = location.repositoryId;
    this.workspaceId = location.workspaceId;
  }

  async open(): Promise<void> {
    if (this.database) return;
    await fs.mkdir(path.dirname(this.databasePath), { recursive: true });
    let database: ProjectKnowledgeDatabase | null = null;
    try {
      database = openProjectKnowledgeDatabase(this.databasePath);
      database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 250;');
      database.exec(
        'CREATE TABLE IF NOT EXISTS pk_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
      );
      const existingMeta = metaMap(database);
      if (existingMeta.size > 0 && existingMeta.get('schema') !== INDEX_SCHEMA) {
        database.exec(
          [
            'DROP TABLE IF EXISTS pk_fts_terms;',
            'DROP TABLE IF EXISTS pk_fts_trigram;',
            'DROP TABLE IF EXISTS pk_sections;',
            'DROP TABLE IF EXISTS pk_sources;',
          ].join('\n'),
        );
        database.prepare("DELETE FROM pk_meta WHERE key IN ('schema', 'workspaceId')").run();
      }
      database.exec(
        [
          'CREATE TABLE IF NOT EXISTS pk_sources (workspace_id TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, archived_at TEXT, size INTEGER NOT NULL, modified_at REAL NOT NULL, indexed_at TEXT NOT NULL, PRIMARY KEY(workspace_id, source));',
          'CREATE TABLE IF NOT EXISTS pk_sections (id INTEGER PRIMARY KEY, workspace_id TEXT NOT NULL, source TEXT NOT NULL, anchor TEXT NOT NULL, title TEXT NOT NULL, heading_path TEXT NOT NULL, body TEXT NOT NULL, lexical_terms TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(workspace_id, source, anchor));',
          'CREATE INDEX IF NOT EXISTS pk_sections_workspace_source ON pk_sections(workspace_id, source);',
          "CREATE VIRTUAL TABLE IF NOT EXISTS pk_fts_terms USING fts5(workspace_id UNINDEXED, source UNINDEXED, title, heading_path, body, lexical_terms, tokenize='unicode61');",
          "CREATE VIRTUAL TABLE IF NOT EXISTS pk_fts_trigram USING fts5(workspace_id UNINDEXED, source UNINDEXED, title, heading_path, body, tokenize='trigram');",
        ].join('\n'),
      );
      const meta = metaMap(database);
      if (meta.get('repositoryId') && meta.get('repositoryId') !== this.repositoryId) {
        throw new Error('Project knowledge index identity or structure is incompatible');
      }
      setMeta(database, 'schema', INDEX_SCHEMA);
      setMeta(database, 'repositoryId', this.repositoryId);
      setMeta(database, 'tokenizer', 'unicode61+trigram');
      database.prepare("SELECT rowid FROM pk_fts_terms WHERE pk_fts_terms MATCH 'probe'").all();
      this.database = database;
    } catch (error) {
      let projectionRecovered = false;
      if (database) {
        try {
          database.exec(
            [
              'DROP TABLE IF EXISTS pk_fts_terms;',
              'DROP TABLE IF EXISTS pk_fts_trigram;',
              'DROP TABLE IF EXISTS pk_sections;',
              'DROP TABLE IF EXISTS pk_sources;',
              'CREATE TABLE pk_sources (workspace_id TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, archived_at TEXT, size INTEGER NOT NULL, modified_at REAL NOT NULL, indexed_at TEXT NOT NULL, PRIMARY KEY(workspace_id, source));',
              'CREATE TABLE pk_sections (id INTEGER PRIMARY KEY, workspace_id TEXT NOT NULL, source TEXT NOT NULL, anchor TEXT NOT NULL, title TEXT NOT NULL, heading_path TEXT NOT NULL, body TEXT NOT NULL, lexical_terms TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(workspace_id, source, anchor));',
              'CREATE INDEX pk_sections_workspace_source ON pk_sections(workspace_id, source);',
              "CREATE VIRTUAL TABLE pk_fts_terms USING fts5(workspace_id UNINDEXED, source UNINDEXED, title, heading_path, body, lexical_terms, tokenize='unicode61');",
              "CREATE VIRTUAL TABLE pk_fts_trigram USING fts5(workspace_id UNINDEXED, source UNINDEXED, title, heading_path, body, tokenize='trigram');",
            ].join('\n'),
          );
          setMeta(database, 'schema', INDEX_SCHEMA);
          setMeta(database, 'repositoryId', this.repositoryId);
          setMeta(database, 'tokenizer', 'unicode61+trigram');
          projectionRecovered = true;
          this.reportDiagnostic?.({
            code: 'index-recovered',
            message: 'Project knowledge section and FTS projection was rebuilt in place.',
          });
        } catch {
          // Leave the shared database at its original path. If it cannot be
          // opened, the provider can use its bounded fallback without moving
          // or deleting the authoritative record table.
        }
      }
      database?.close();
      if (!projectionRecovered) {
        this.reportDiagnostic?.({
          code: 'index-unavailable',
          message:
            'Project knowledge section index is unavailable; authoritative records were retained.',
        });
      }
      throw error;
    }
  }

  close(): void {
    this.database?.close();
    this.database = null;
  }

  async syncCorpus(
    corpus: readonly ProjectKnowledgeDocument[],
  ): Promise<ProjectKnowledgeIndexSyncResult> {
    const deadline = Date.now() + MAX_SYNC_MS;
    await this.open();
    const database = this.requireDatabase();
    const known = new Map(
      (
        database
          .prepare('SELECT source, size, modified_at FROM pk_sources WHERE workspace_id = ?')
          .all(this.workspaceId) as Array<{
          source: string;
          size: number;
          modified_at: number;
        }>
      ).map((entry) => [entry.source, entry]),
    );
    const corpusSources = new Set(corpus.map((document) => document.source));
    for (const source of known.keys()) {
      if (!corpusSources.has(source)) this.removeSource(database, this.workspaceId, source);
    }
    const changedSources: ProjectKnowledgeDocument[] = [];
    const refreshedSources: ProjectKnowledgeDocument[] = [];
    this.lastSyncReadBytes = 0;
    for (let index = 0; index < corpus.length; index += 1) {
      const document = corpus[index];
      if (Date.now() > deadline) {
        this.reportDiagnostic?.({
          code: 'index-budget',
          message:
            'Project knowledge index refresh reached its time budget; remaining sources were deferred.',
        });
        changedSources.push(...corpus.slice(index));
        break;
      }
      let stat;
      try {
        stat = await fs.lstat(document.absolutePath);
      } catch {
        if (known.has(document.source))
          this.removeSource(database, this.workspaceId, document.source);
        continue;
      }
      const previous = known.get(document.source);
      if (previous && previous.size === stat.size && previous.modified_at === stat.mtimeMs)
        continue;
      try {
        const read = await readProtectedProjectFile(
          this.projectRoot,
          document.source,
          MAX_SOURCE_BYTES,
          { label: document.source },
        );
        this.lastSyncReadBytes += read.bytes.length;
        if (Date.now() > deadline) throw new Error('index refresh exceeded time budget');
        const afterRead = await fs.lstat(document.absolutePath);
        if (afterRead.size !== read.stat.size || afterRead.mtimeMs !== read.stat.mtimeMs) {
          throw new Error('source changed while it was being indexed');
        }
        const sections = parseProjectKnowledgeSections(
          document.source,
          read.bytes.toString('utf8'),
        );
        if (Date.now() > deadline) throw new Error('index refresh exceeded time budget');
        this.applySourceDelta(
          database,
          document,
          Number(read.stat.size),
          Number(read.stat.mtimeMs),
          sections,
        );
        refreshedSources.push(document);
      } catch {
        // A failed refresh must not leave the previous projection searchable.
        if (previous) {
          try {
            this.removeSource(database, this.workspaceId, document.source);
          } catch {
            // Preserve the original bounded diagnostic below.
          }
        }
        changedSources.push(document);
        this.reportDiagnostic?.({
          code: 'index-source',
          message: `Project knowledge index skipped a changing or unreadable source: ${document.source}`,
        });
      }
    }
    return { changedSources, refreshedSources, status: this.status() };
  }

  search(query: ProjectKnowledgeQuery): readonly ProjectKnowledgeResult[] {
    const started = performance.now();
    const database = this.requireDatabase();
    const channels: Array<{ name: string; rows: SearchRow[] }> = [];
    const terms = ftsExpression([...query.strongTerms, ...query.phraseTerms, ...query.weakTerms]);
    if (terms)
      channels.push({
        name: 'fts-terms',
        rows: this.searchChannel(database, this.workspaceId, 'terms', terms, 40),
      });
    const trigram = ftsExpression(
      [...query.phraseTerms, ...query.weakTerms].filter((term) => [...term].length >= 3),
    );
    if (trigram)
      channels.push({
        name: 'fts-trigram',
        rows: this.searchChannel(database, this.workspaceId, 'trigram', trigram, 20),
      });

    const fused = new Map<number, { row: SearchRow; score: number; channels: Set<string> }>();
    for (const channel of channels) {
      channel.rows.forEach((row, index) => {
        const previous = fused.get(row.id);
        const score = (previous?.score ?? 0) + 1 / (60 + index + 1);
        const names = new Set(previous?.channels ?? []);
        names.add(channel.name);
        fused.set(row.id, { row, score, channels: names });
      });
    }
    const results = [...fused.values()]
      .map(({ row, score, channels: names }) => {
        const searchable =
          `${row.source}\n${row.title}\n${row.heading_path}\n${row.body}`.toLocaleLowerCase();
        const strong = query.strongTerms.some((term) =>
          searchable.includes(term.toLocaleLowerCase()),
        );
        const phrase = query.phraseTerms.some((term) =>
          searchable.includes(term.toLocaleLowerCase()),
        );
        const matchedTerms = query.terms.filter((term) =>
          searchable.includes(term.toLocaleLowerCase()),
        ).length;
        const pathAssociation = Boolean(
          query.path && row.source.toLocaleLowerCase().includes(query.path.toLocaleLowerCase()),
        );
        const kindRank = row.kind.endsWith('-spec') ? 0 : row.kind.endsWith('-archive') ? 1 : 2;
        return {
          row,
          reliable: strong || phrase || matchedTerms >= 2,
          score:
            score +
            (strong ? 0.05 : 0) +
            (phrase ? 0.025 : 0) +
            (pathAssociation ? 0.03 : 0) -
            kindRank * 0.05,
          names,
        };
      })
      .filter((candidate) => candidate.reliable)
      .sort(
        (left, right) =>
          right.score - left.score || left.row.source.localeCompare(right.row.source),
      )
      .slice(0, 40);
    const elapsed = Math.round((performance.now() - started) * 100) / 100;
    setMeta(database, 'lastQueryMs', String(elapsed));
    setMeta(database, 'lastCandidateCount', String(results.length));
    setMeta(database, 'lastChannels', channels.map((channel) => channel.name).join(','));
    return results.map(({ row, score }) => ({
      source: row.source,
      title: row.title,
      content: row.body.slice(0, 1600),
      score,
      document: {
        absolutePath: path.join(this.projectRoot, ...row.source.split('/')),
        source: row.source,
        kind: row.kind,
        ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
      },
    }));
  }

  status(): ProjectKnowledgeIndexStatus {
    const database = this.requireDatabase();
    const meta = metaMap(database);
    const sources = (
      database
        .prepare(
          'SELECT source, kind, archived_at, indexed_at FROM pk_sources WHERE workspace_id = ? ORDER BY source',
        )
        .all(this.workspaceId) as Array<{
        source: string;
        kind: ProjectKnowledgeDocument['kind'];
        archived_at: string | null;
        indexed_at: string;
      }>
    ).map((row) => ({
      source: row.source,
      kind: row.kind,
      ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
      updatedAt: row.indexed_at,
    }));
    const sourceCount = countValue(
      (
        database
          .prepare('SELECT COUNT(*) AS count FROM pk_sources WHERE workspace_id = ?')
          .get(this.workspaceId) as {
          count?: unknown;
        }
      ).count,
    );
    const sectionCount = countValue(
      (
        database
          .prepare('SELECT COUNT(*) AS count FROM pk_sections WHERE workspace_id = ?')
          .get(this.workspaceId) as {
          count?: unknown;
        }
      ).count,
    );
    return {
      schema: INDEX_SCHEMA,
      available: true,
      databasePath: this.databasePath,
      repositoryId: this.repositoryId,
      workspaceId: this.workspaceId,
      sourceCount,
      sources,
      sectionCount,
      ...(meta.get('updatedAt') ? { updatedAt: meta.get('updatedAt') } : {}),
      ...(Number.isFinite(Number(meta.get('lastQueryMs')))
        ? { lastQueryMs: Number(meta.get('lastQueryMs')) }
        : {}),
      ...(Number.isSafeInteger(Number(meta.get('lastCandidateCount')))
        ? { lastCandidateCount: Number(meta.get('lastCandidateCount')) }
        : {}),
      channels: (meta.get('lastChannels') ?? '').split(',').filter(Boolean),
    };
  }

  async rebuild(corpus: readonly ProjectKnowledgeDocument[]): Promise<ProjectKnowledgeIndexStatus> {
    await this.open();
    const database = this.requireDatabase();
    this.removeWorkspace(database);
    return (await this.syncCorpus(corpus)).status;
  }

  private applySourceDelta(
    database: ProjectKnowledgeDatabase,
    document: ProjectKnowledgeDocument,
    size: number,
    modifiedAt: number,
    sections: readonly ParsedSection[],
  ): void {
    const now = new Date().toISOString();
    database.exec('BEGIN IMMEDIATE;');
    try {
      database
        .prepare(
          'INSERT INTO pk_sources(workspace_id, source, kind, archived_at, size, modified_at, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, source) DO UPDATE SET kind = excluded.kind, archived_at = excluded.archived_at, size = excluded.size, modified_at = excluded.modified_at, indexed_at = excluded.indexed_at',
        )
        .run(
          this.workspaceId,
          document.source,
          document.kind,
          document.archivedAt ?? null,
          size,
          modifiedAt,
          now,
        );
      const existing = new Map(
        (
          database
            .prepare(
              'SELECT id, anchor, title, heading_path, body, lexical_terms FROM pk_sections WHERE workspace_id = ? AND source = ?',
            )
            .all(this.workspaceId, document.source) as unknown as IndexedSectionRow[]
        ).map((row) => [row.anchor, row]),
      );
      const incoming = new Set(sections.map((section) => section.anchor));
      for (const row of existing.values()) {
        if (incoming.has(row.anchor)) continue;
        database.prepare('DELETE FROM pk_fts_terms WHERE rowid = ?').run(row.id);
        database.prepare('DELETE FROM pk_fts_trigram WHERE rowid = ?').run(row.id);
        database.prepare('DELETE FROM pk_sections WHERE id = ?').run(row.id);
      }
      for (const section of sections) {
        const previous = existing.get(section.anchor);
        const unchanged =
          previous &&
          previous.title === section.title &&
          previous.heading_path === section.headingPath &&
          previous.body === section.body &&
          previous.lexical_terms === section.lexicalTerms;
        if (unchanged) continue;
        let id: number;
        if (previous) {
          id = previous.id;
          database
            .prepare(
              'UPDATE pk_sections SET title = ?, heading_path = ?, body = ?, lexical_terms = ?, updated_at = ? WHERE id = ?',
            )
            .run(section.title, section.headingPath, section.body, section.lexicalTerms, now, id);
          database.prepare('DELETE FROM pk_fts_terms WHERE rowid = ?').run(id);
          database.prepare('DELETE FROM pk_fts_trigram WHERE rowid = ?').run(id);
        } else {
          const result = database
            .prepare(
              'INSERT INTO pk_sections(workspace_id, source, anchor, title, heading_path, body, lexical_terms, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
              this.workspaceId,
              document.source,
              section.anchor,
              section.title,
              section.headingPath,
              section.body,
              section.lexicalTerms,
              now,
            );
          id = Number(result.lastInsertRowid);
        }
        database
          .prepare(
            'INSERT INTO pk_fts_terms(rowid, workspace_id, source, title, heading_path, body, lexical_terms) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            this.workspaceId,
            document.source,
            section.title,
            section.headingPath,
            section.body,
            section.lexicalTerms,
          );
        database
          .prepare(
            'INSERT INTO pk_fts_trigram(rowid, workspace_id, source, title, heading_path, body) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            this.workspaceId,
            document.source,
            section.title,
            section.headingPath,
            section.body,
          );
      }
      setMeta(database, 'updatedAt', now);
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  private removeSource(
    database: ProjectKnowledgeDatabase,
    workspaceId: string,
    source: string,
  ): void {
    const rows = database
      .prepare('SELECT id FROM pk_sections WHERE workspace_id = ? AND source = ?')
      .all(workspaceId, source) as Array<{
      id: number;
    }>;
    database.exec('BEGIN IMMEDIATE;');
    try {
      for (const { id } of rows) {
        database.prepare('DELETE FROM pk_fts_terms WHERE rowid = ?').run(id);
        database.prepare('DELETE FROM pk_fts_trigram WHERE rowid = ?').run(id);
      }
      database
        .prepare('DELETE FROM pk_sections WHERE workspace_id = ? AND source = ?')
        .run(workspaceId, source);
      database
        .prepare('DELETE FROM pk_sources WHERE workspace_id = ? AND source = ?')
        .run(workspaceId, source);
      setMeta(database, 'updatedAt', new Date().toISOString());
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  private removeWorkspace(database: ProjectKnowledgeDatabase): void {
    const rows = database
      .prepare('SELECT id FROM pk_sections WHERE workspace_id = ?')
      .all(this.workspaceId) as Array<{ id: number }>;
    database.exec('BEGIN IMMEDIATE;');
    try {
      for (const { id } of rows) {
        database.prepare('DELETE FROM pk_fts_terms WHERE rowid = ?').run(id);
        database.prepare('DELETE FROM pk_fts_trigram WHERE rowid = ?').run(id);
      }
      database.prepare('DELETE FROM pk_sections WHERE workspace_id = ?').run(this.workspaceId);
      database.prepare('DELETE FROM pk_sources WHERE workspace_id = ?').run(this.workspaceId);
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  private searchChannel(
    database: ProjectKnowledgeDatabase,
    workspaceId: string,
    channel: 'terms' | 'trigram',
    expression: string,
    limit: number,
  ): SearchRow[] {
    const table = channel === 'terms' ? 'pk_fts_terms' : 'pk_fts_trigram';
    const weights =
      channel === 'terms' ? '0.0, 0.0, 1.0, 3.0, 2.0, 0.8, 1.5' : '0.0, 0.0, 1.0, 2.5, 1.8, 0.7';
    return database
      .prepare(
        `SELECT s.id, s.source, p.kind, p.archived_at, s.title, s.heading_path, s.body, bm25(${table}, ${weights}) AS rank FROM ${table} JOIN pk_sections s ON s.id = ${table}.rowid JOIN pk_sources p ON p.workspace_id = s.workspace_id AND p.source = s.source WHERE ${table} MATCH ? AND s.workspace_id = ? ORDER BY rank LIMIT ?`,
      )
      .all(expression, workspaceId, limit) as unknown as SearchRow[];
  }

  private requireDatabase(): ProjectKnowledgeDatabase {
    if (!this.database) throw new Error('Project knowledge index is not open');
    return this.database;
  }
}

export async function readProjectKnowledgeIndexStatus(
  options: ProjectKnowledgeIndexOptions,
): Promise<ProjectKnowledgeIndexStatus> {
  const store = new ProjectKnowledgeIndexStore(options);
  try {
    await fs.access(store.databasePath);
    const database = openProjectKnowledgeDatabase(store.databasePath, { readOnly: true });
    try {
      const meta = metaMap(database);
      if (meta.get('schema') !== INDEX_SCHEMA || meta.get('repositoryId') !== store.repositoryId) {
        throw new Error('Project knowledge index identity or structure is incompatible');
      }
      const sourceCount = countValue(
        (
          database
            .prepare('SELECT COUNT(*) AS count FROM pk_sources WHERE workspace_id = ?')
            .get(store.workspaceId) as {
            count?: unknown;
          }
        ).count,
      );
      const sectionCount = countValue(
        (
          database
            .prepare('SELECT COUNT(*) AS count FROM pk_sections WHERE workspace_id = ?')
            .get(store.workspaceId) as {
            count?: unknown;
          }
        ).count,
      );
      const sources = (
        database
          .prepare(
            'SELECT source, kind, archived_at, indexed_at FROM pk_sources WHERE workspace_id = ? ORDER BY source',
          )
          .all(store.workspaceId) as Array<{
          source: string;
          kind: ProjectKnowledgeDocument['kind'];
          archived_at: string | null;
          indexed_at: string;
        }>
      ).map((row) => ({
        source: row.source,
        kind: row.kind,
        ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
        updatedAt: row.indexed_at,
      }));
      return {
        schema: INDEX_SCHEMA,
        available: true,
        databasePath: store.databasePath,
        repositoryId: store.repositoryId,
        workspaceId: store.workspaceId,
        sourceCount,
        sources,
        sectionCount,
        ...(meta.get('updatedAt') ? { updatedAt: meta.get('updatedAt') } : {}),
        ...(Number.isFinite(Number(meta.get('lastQueryMs')))
          ? { lastQueryMs: Number(meta.get('lastQueryMs')) }
          : {}),
        ...(Number.isSafeInteger(Number(meta.get('lastCandidateCount')))
          ? { lastCandidateCount: Number(meta.get('lastCandidateCount')) }
          : {}),
        channels: (meta.get('lastChannels') ?? '').split(',').filter(Boolean),
      };
    } finally {
      database.close();
    }
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return {
      schema: INDEX_SCHEMA,
      available: false,
      databasePath: store.databasePath,
      repositoryId: store.repositoryId,
      workspaceId: store.workspaceId,
      sourceCount: 0,
      sources: [],
      sectionCount: 0,
      channels: [],
      ...(missing ? {} : { diagnostic: 'Project knowledge index is unavailable or incompatible.' }),
    };
  }
}

export { INDEX_SCHEMA, MAX_SOURCE_BYTES };
