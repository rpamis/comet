import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

import { resolveStableProjectId } from '../../platform/paths/project-identity.js';
import { runBoundedRipgrep, type RipgrepRunResult } from '../../platform/process/ripgrep.js';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import { knowledgeDocumentKindRank } from './corpus.js';
import type { ProjectKnowledgeIndexStatus } from './index-store.js';
import { ProjectKnowledgeLocalStore } from './local-store.js';
import { queryContainsTerm, queryHasStrongMatch } from './query.js';
import {
  parseProjectKnowledgeRecord,
  projectKnowledgeRecordFamily,
  type ProjectKnowledgeRecord,
  type ProjectKnowledgeRecordType,
} from './records.js';
import type {
  ProjectKnowledgeDocument,
  ProjectKnowledgeApplyResult,
  ProjectKnowledgeDiagnosticReporter,
  ProjectKnowledgeProvider,
  ProjectKnowledgeMutation,
  ProjectKnowledgeProviderOptions,
  ProjectKnowledgeQuery,
  ProjectKnowledgeQueryRequest,
  ProjectKnowledgeQueryResult,
  ProjectKnowledgeResult,
  ProjectKnowledgeStatus,
} from './types.js';

const MAX_RG_OUTPUT_BYTES = 1024 * 1024;
const MAX_RG_MATCHES = 500;
const MAX_DOCUMENT_BYTES = 256 * 1024;

interface LocalCandidate extends ProjectKnowledgeResult {
  readonly document: ProjectKnowledgeDocument;
  readonly title: string;
  readonly matchedTerms: ReadonlySet<string>;
  readonly matchCount: number;
  readonly strong: boolean;
  readonly pathAssociation: boolean;
  readonly line: number;
}

export interface LocalProjectKnowledgeProviderOptions extends ProjectKnowledgeProviderOptions {
  readonly runRipgrep?: (args: readonly string[]) => Promise<RipgrepRunResult>;
  readonly rgCommand?: string;
  readonly cacheRoot?: string;
  readonly localStore?: ProjectKnowledgeLocalStore;
  /** Retrieval-eval seam for measuring the bounded rg baseline. */
  readonly indexEnabled?: boolean;
}

function bundledRipgrepPath(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const value = require('@vscode/ripgrep') as { rgPath?: unknown };
    return typeof value.rgPath === 'string' && value.rgPath.length > 0 ? value.rgPath : null;
  } catch {
    return null;
  }
}

function titleAndSnippet(content: string, lineNumber: number): { title: string; snippet: string } {
  const lines = content.replaceAll('\r\n', '\n').split('\n');
  const index = Math.max(0, Math.min(lines.length - 1, lineNumber - 1));
  let heading = index;
  while (heading >= 0 && !/^\s{0,3}#{1,6}\s+\S/u.test(lines[heading])) heading -= 1;
  const title =
    heading >= 0 ? lines[heading].replace(/^\s{0,3}#{1,6}\s+/u, '').trim() : 'Project knowledge';
  let start = heading >= 0 ? heading : index;
  while (start > 0 && lines[start - 1].trim() !== '') start -= 1;
  let end = Math.max(index, heading >= 0 ? heading : index);
  if (heading >= 0 && index === heading) {
    while (end + 1 < lines.length && lines[end + 1].trim() === '') end += 1;
  }
  while (
    end + 1 < lines.length &&
    lines[end + 1].trim() !== '' &&
    !/^\s{0,3}#{1,6}\s+/u.test(lines[end + 1])
  )
    end += 1;
  const snippet = lines
    .slice(start, end + 1)
    .join('\n')
    .trim()
    .slice(0, 1600);
  return { title: title.slice(0, 200), snippet };
}

function eventPath(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null;
  const data = (event as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const value = (data as { path?: { text?: unknown } }).path?.text;
  return typeof value === 'string' ? value : null;
}

function eventLine(event: unknown): number {
  if (!event || typeof event !== 'object') return 1;
  const value = (event as { data?: { line_number?: unknown } }).data?.line_number;
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : 1;
}

function eventText(event: unknown): string {
  if (!event || typeof event !== 'object') return '';
  const value = (event as { data?: { lines?: { text?: unknown } } }).data?.lines?.text;
  return typeof value === 'string' ? value : '';
}

function documentForPath(
  projectRoot: string,
  value: string,
  documents: ReadonlyMap<string, ProjectKnowledgeDocument>,
): ProjectKnowledgeDocument | null {
  const absolute = path.resolve(projectRoot, value);
  return documents.get(absolute) ?? documents.get(path.resolve(value)) ?? null;
}

function candidateSort(
  left: LocalCandidate,
  right: LocalCandidate,
  query: ProjectKnowledgeQuery,
): number {
  const leftCoverage = left.matchedTerms.size / Math.max(1, query.terms.length);
  const rightCoverage = right.matchedTerms.size / Math.max(1, query.terms.length);
  if (left.strong !== right.strong) return left.strong ? -1 : 1;
  if (leftCoverage !== rightCoverage) return rightCoverage - leftCoverage;
  if (left.pathAssociation !== right.pathAssociation) return left.pathAssociation ? -1 : 1;
  const kind =
    knowledgeDocumentKindRank(left.document.kind) - knowledgeDocumentKindRank(right.document.kind);
  if (kind !== 0) return kind;
  if (left.matchCount !== right.matchCount) return right.matchCount - left.matchCount;
  const archive = (right.document.archivedAt ?? '').localeCompare(left.document.archivedAt ?? '');
  if (archive !== 0) return archive;
  return left.document.source.localeCompare(right.document.source);
}

export class LocalProjectKnowledgeProvider implements ProjectKnowledgeProvider {
  private readonly options: LocalProjectKnowledgeProviderOptions;
  private readonly reportDiagnostic: ProjectKnowledgeDiagnosticReporter | undefined;
  private localStore: ProjectKnowledgeLocalStore | null;
  private recordStoreError: { code: string; message: string } | null = null;

  public constructor(options: LocalProjectKnowledgeProviderOptions) {
    this.options = options;
    this.reportDiagnostic = options.reportDiagnostic;
    this.localStore = options.localStore ?? null;
  }

  private recordStore(): ProjectKnowledgeLocalStore | null {
    if (this.localStore) return this.localStore;
    if (this.recordStoreError) return null;
    try {
      return (this.localStore ??= new ProjectKnowledgeLocalStore({
        projectRoot: this.options.projectRoot,
        ...(this.options.cacheRoot ? { cacheRoot: this.options.cacheRoot } : {}),
        ...(this.options.reportDiagnostic
          ? { reportDiagnostic: this.options.reportDiagnostic }
          : {}),
      }));
    } catch {
      this.recordStoreError = {
        code: 'records-unavailable',
        message: 'Local project knowledge records are unavailable; using document search only.',
      };
      this.reportDiagnostic?.(this.recordStoreError);
      return null;
    }
  }

  public async status(): Promise<ProjectKnowledgeStatus> {
    const store = this.recordStore();
    if (!store) {
      return {
        provider: 'local',
        healthy: false,
        writable: false,
        diagnostics: [this.recordStoreError!],
      };
    }
    return store.status();
  }

  public async indexStatus(): Promise<ProjectKnowledgeIndexStatus | null> {
    const store = this.recordStore();
    if (!store) return null;
    try {
      return await store.indexStatus();
    } catch {
      this.reportDiagnostic?.({
        code: 'index-unavailable',
        message: 'Local project knowledge section index is unavailable.',
      });
      return null;
    }
  }

  public async query(request: ProjectKnowledgeQueryRequest): Promise<ProjectKnowledgeQueryResult> {
    const store = this.recordStore();
    if (request.kind === 'manifest') {
      const records =
        store?.list({
          ...(request.projectId ? { projectId: request.projectId } : {}),
          ...(request.state && request.state !== 'all' ? { state: request.state } : {}),
          limit: request.limit ?? 100,
        }) ?? [];
      const active =
        request.state === 'all'
          ? records
          : records.filter((record) => record.state !== 'superseded');
      return {
        kind: 'manifest',
        items: active.map((record) => ({
          id: record.id,
          memoryType: projectKnowledgeRecordFamily(record.type),
          type: record.type,
          state: record.state,
          authority: record.authority,
          title: record.title,
          summary: record.summary,
          applicablePaths: [...record.applicablePaths],
          operations: [...record.operations],
          phases: [...(record.phases ?? [])],
          sourceTypes: [
            ...new Set(
              record.conclusions.flatMap((conclusion) =>
                conclusion.sources.map((source) => source.source),
              ),
            ),
          ],
          verification: record.verification.map((verification) => ({ ...verification })),
        })),
        truncated: request.limit !== undefined && records.length >= request.limit,
        diagnostics: store ? [] : [this.recordStoreError!],
      };
    }
    if (request.kind === 'expand') {
      if (store) {
        await store.apply({
          kind: 'refresh',
          id: request.id,
          ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
        });
      }
      const record = store?.read(request.id) ?? null;
      return {
        kind: 'expand',
        record:
          record &&
          record.state !== 'superseded' &&
          (!request.projectId || record.projectId === request.projectId)
            ? record
            : null,
        diagnostics: store ? [] : [this.recordStoreError!],
      };
    }
    if (request.kind === 'list') {
      const records =
        store?.list({
          ...(request.projectId ? { projectId: request.projectId } : {}),
          ...(request.type ? { type: request.type } : {}),
          ...(request.state && request.state !== 'all' ? { state: request.state } : {}),
          ...(request.authority ? { authority: request.authority } : {}),
          ...(request.limit ? { limit: request.limit } : {}),
        }) ?? [];
      return {
        kind: 'list',
        records,
        truncated: request.limit !== undefined && records.length >= request.limit,
        diagnostics: store ? [] : [this.recordStoreError!],
      };
    }
    if (request.kind === 'get') {
      const record = store?.read(request.id) ?? null;
      return {
        kind: 'get',
        record:
          record && (!request.projectId || record.projectId === request.projectId) ? record : null,
        diagnostics: store ? [] : [this.recordStoreError!],
      };
    }

    const diagnostics: Array<{ code: string; message: string }> = [];
    if (store) await store.apply({ kind: 'refresh' });
    else {
      diagnostics.push(this.recordStoreError!);
      const indexDiagnostic = {
        code: 'index-unavailable',
        message: 'Local project knowledge section index is unavailable.',
      };
      diagnostics.push(indexDiagnostic);
      this.reportDiagnostic?.(indexDiagnostic);
    }
    let sections: readonly ProjectKnowledgeResult[] = [];
    let refreshedSources: readonly ProjectKnowledgeDocument[] = [];
    let indexSynced = false;
    if (this.options.indexEnabled !== false && store) {
      try {
        const sync = await store.syncCorpus(this.options.corpus);
        refreshedSources = [...sync.refreshedSources, ...sync.changedSources];
        sections = await this.readCurrentSections(store.searchSections(request.query), diagnostics);
        indexSynced = true;
      } catch {
        refreshedSources = [...this.options.corpus];
        diagnostics.push({
          code: 'index-unavailable',
          message: 'Local project knowledge section index is unavailable.',
        });
      }
    }
    const exact =
      indexSynced && refreshedSources.length === 0 && this.options.runRipgrep === undefined
        ? []
        : await this.searchWithRipgrep(request.query, [...refreshedSources]);
    sections = await this.readCurrentSections(sections, diagnostics);
    const recordResults = store?.searchRecords(request.query) ?? [];
    const channels = [recordResults, sections, exact];
    const fused = new Map<string, { result: ProjectKnowledgeResult; score: number }>();
    for (const [channel, channelResults] of channels.entries()) {
      channelResults.forEach((result, rank) => {
        const key = `${result.source}\u0000${result.title ?? ''}`;
        const previous = fused.get(key);
        const score =
          (previous?.score ?? 0) +
          1 / (60 + rank + 1) +
          (channel === 1 ? 0.025 : channel === 2 ? 0.03 : 0);
        fused.set(key, { result: previous?.result ?? result, score });
      });
    }
    const results = new Map<string, ProjectKnowledgeResult>();
    for (const { result } of [...fused.values()]
      .sort(
        (left, right) =>
          right.score - left.score || left.result.source.localeCompare(right.result.source),
      )
      .map(({ result, score }) => ({ result: { ...result, score }, score }))) {
      const key = `${result.source}\u0000${result.title ?? ''}`;
      if (!results.has(key)) results.set(key, result);
    }
    const limit = Math.max(1, Math.min(40, request.limit ?? 8));
    const bounded = [...results.values()].slice(0, limit);
    const records = recordResults.flatMap((result) => (result.record ? [result.record] : []));
    return {
      kind: 'search',
      hits: records.map((record) => ({ record })),
      results: bounded,
      records,
      truncated: results.size > bounded.length,
      diagnostics,
    };
  }

  public async apply(mutation: ProjectKnowledgeMutation): Promise<ProjectKnowledgeApplyResult> {
    const store = this.recordStore();
    if (!store) {
      return {
        kind: mutation.kind,
        changed: false,
        diagnostics: [this.recordStoreError!],
      };
    }
    if (
      mutation.kind === 'experience-delta' &&
      (await store.mutationApplied(mutation.idempotencyKey))
    ) {
      return {
        kind: mutation.kind,
        changed: false,
        ...(mutation.delta.targetId === undefined
          ? {}
          : { record: store.read(mutation.delta.targetId) }),
        diagnostics: [],
      };
    }
    const normalizedMutation =
      mutation.kind === 'experience-delta'
        ? projectKnowledgeMutationFromDelta(
            mutation,
            store.read(mutation.delta.targetId ?? ''),
            resolveStableProjectId(this.options.projectRoot),
          )
        : mutation;
    if (normalizedMutation === null) {
      return { kind: mutation.kind, changed: false, diagnostics: [] };
    }
    const result = await store.apply(
      mutation.kind === 'experience-delta' && normalizedMutation.kind === 'feedback'
        ? { ...normalizedMutation, idempotencyKey: mutation.idempotencyKey }
        : normalizedMutation,
    );
    if (mutation.kind === 'experience-delta') {
      await store.markMutationApplied(mutation.idempotencyKey, mutation.updatedAt);
    }
    if (mutation.kind === 'refresh' && !mutation.id) {
      try {
        await store.rebuildWorkspace(this.options.corpus);
      } catch {
        this.reportDiagnostic?.({
          code: 'index-rebuild',
          message: 'Local project knowledge workspace index could not be rebuilt.',
        });
      }
    }
    return mutation.kind === 'experience-delta' ? { ...result, kind: mutation.kind } : result;
  }

  public close(): void {
    this.localStore?.close();
    this.localStore = null;
  }

  private async readCurrentSections(
    sections: readonly ProjectKnowledgeResult[],
    diagnostics: Array<{ code: string; message: string }>,
  ): Promise<readonly ProjectKnowledgeResult[]> {
    const checked = await Promise.all(
      sections.map(async (section) => {
        const source = section.document?.source;
        if (!source) return section;
        try {
          await readProtectedProjectFile(this.options.projectRoot, source, MAX_DOCUMENT_BYTES, {
            label: source,
          });
          return section;
        } catch {
          diagnostics.push({
            code: 'local-document',
            message: 'Local project knowledge source is unavailable.',
          });
          return null;
        }
      }),
    );
    return checked.filter((section): section is ProjectKnowledgeResult => section !== null);
  }

  private async searchWithRipgrep(
    query: ProjectKnowledgeQuery,
    refreshedSources: readonly ProjectKnowledgeDocument[] = [],
  ): Promise<readonly ProjectKnowledgeResult[]> {
    if (query.terms.length === 0 || this.options.corpus.length === 0) return [];
    const documents = new Map(
      this.options.corpus.map((document) => [path.resolve(document.absolutePath), document]),
    );
    const targets =
      refreshedSources.length > 0
        ? refreshedSources.map((document) => document.absolutePath)
        : this.searchTargets();
    const exactTerms = [...query.strongTerms, ...query.phraseTerms].slice(0, 16);
    if (exactTerms.length === 0) exactTerms.push(...query.weakTerms.slice(0, 4));
    const args = [
      '--json',
      '--fixed-strings',
      '--ignore-case',
      '--no-messages',
      '--iglob',
      '*.md',
      ...exactTerms.flatMap((term) => ['-e', term]),
      '--',
      ...targets,
    ];
    const bundled = this.options.rgCommand ?? bundledRipgrepPath();
    let run = this.options.runRipgrep
      ? await this.options.runRipgrep(args)
      : await runBoundedRipgrep({
          cwd: this.options.projectRoot,
          args,
          command: bundled ?? 'rg',
          timeoutMs: 2000,
          maxOutputBytes: MAX_RG_OUTPUT_BYTES,
          maxMatches: MAX_RG_MATCHES,
        });
    if (!this.options.runRipgrep && run.error && bundled && bundled !== 'rg') {
      run = await runBoundedRipgrep({
        cwd: this.options.projectRoot,
        args,
        command: 'rg',
        timeoutMs: 2000,
        maxOutputBytes: MAX_RG_OUTPUT_BYTES,
        maxMatches: MAX_RG_MATCHES,
      });
    }
    if (run.error && !run.stdout && !run.timedOut && !run.truncated) {
      this.reportDiagnostic?.({
        code: 'local-tool-missing',
        message:
          'Local project knowledge search is unavailable; install ripgrep or keep the bundled binary available.',
      });
      return [];
    }
    if (run.exitCode !== null && run.exitCode > 1) {
      this.reportDiagnostic?.({
        code: 'local-tool',
        message: `Project knowledge local search failed with exit code ${run.exitCode}.`,
      });
      return [];
    }
    if (run.error || run.timedOut || run.truncated) {
      this.reportDiagnostic?.({
        code: run.timedOut ? 'local-timeout' : run.truncated ? 'local-output-limit' : 'local-tool',
        message: run.timedOut
          ? 'Project knowledge local search timed out.'
          : 'Project knowledge local search was bounded before completion.',
      });
    }
    const candidates = new Map<string, LocalCandidate>();
    let invalidJson = false;
    const outputLines = run.stdout.split(/\r?\n/u);
    for (const [index, line] of outputLines.entries()) {
      if (!line.trim()) continue;
      let event: unknown;
      try {
        event = JSON.parse(line) as unknown;
      } catch {
        const incompleteBoundedTail =
          index === outputLines.length - 1 &&
          !/\r?\n$/u.test(run.stdout) &&
          (run.truncated || run.timedOut || run.matchLimitReached);
        if (incompleteBoundedTail) continue;
        if (!invalidJson) {
          this.reportDiagnostic?.({
            code: 'local-invalid-json',
            message: 'Local project knowledge search returned invalid JSON.',
          });
        }
        invalidJson = true;
        continue;
      }
      if (!event || typeof event !== 'object' || (event as { type?: unknown }).type !== 'match')
        continue;
      const relative = eventPath(event);
      if (!relative) continue;
      const document = documentForPath(this.options.projectRoot, relative, documents);
      if (!document) continue;
      let content: string;
      try {
        content = (
          await readProtectedProjectFile(
            this.options.projectRoot,
            document.source,
            MAX_DOCUMENT_BYTES,
            { label: document.source },
          )
        ).bytes.toString('utf8');
      } catch {
        this.reportDiagnostic?.({
          code: 'local-document',
          message: `Project knowledge document was skipped: ${document.source}`,
        });
        continue;
      }
      const text = eventText(event);
      const { title, snippet } = titleAndSnippet(content, eventLine(event));
      const matched = new Set(
        query.terms.filter(
          (term) =>
            queryContainsTerm(text, term) ||
            queryContainsTerm(title, term) ||
            queryContainsTerm(document.source, term),
        ),
      );
      const key = `${document.source}\u0000${title}`;
      const previous = candidates.get(key);
      const combined = new Set(previous?.matchedTerms ?? []);
      for (const term of matched) combined.add(term);
      const searchable = `${title}\n${document.source}\n${snippet}`;
      const strong = queryHasStrongMatch(query, searchable);
      candidates.set(key, {
        content: previous?.content ?? snippet,
        source: document.source,
        title,
        document,
        matchedTerms: combined,
        matchCount: (previous?.matchCount ?? 0) + 1,
        strong,
        pathAssociation: Boolean(
          query.path &&
          (document.source.toLowerCase().includes(query.path.toLowerCase()) ||
            title.toLowerCase().includes(query.path.toLowerCase())),
        ),
        line: previous?.line ?? eventLine(event),
      });
    }
    if (invalidJson) return [];
    return [...candidates.values()]
      .filter((candidate) => candidate.strong || candidate.matchedTerms.size >= 2)
      .sort((left, right) => candidateSort(left, right, query))
      .slice(0, 8);
  }

  private searchTargets(): string[] {
    const directories = new Set<string>();
    const files: string[] = [];
    for (const document of this.options.corpus) {
      if (document.kind === 'superpowers')
        files.push(path.relative(this.options.projectRoot, document.absolutePath));
      else
        directories.add(
          path.dirname(path.relative(this.options.projectRoot, document.absolutePath)),
        );
    }
    return [...directories, ...files].map((value) => value.replaceAll(path.sep, '/')).sort();
  }
}

function projectKnowledgeMutationFromDelta(
  mutation: Extract<ProjectKnowledgeMutation, { readonly kind: 'experience-delta' }>,
  current: ProjectKnowledgeRecord | null,
  fallbackProjectId: string,
): Exclude<ProjectKnowledgeMutation, { readonly kind: 'experience-delta' }> | null {
  const { delta, updatedAt } = mutation;
  if (delta.owner !== 'project-knowledge' && delta.owner !== 'comet.project-knowledge') {
    throw new Error('Learning Delta owner does not match Project Knowledge');
  }
  if (delta.feedback !== undefined) {
    if (!delta.targetId) throw new Error('Learning Delta feedback target is required');
    return {
      kind: 'feedback',
      id: delta.targetId,
      projectId: delta.applicability.projectId ?? current?.projectId ?? fallbackProjectId,
      outcome: delta.feedback.status,
      ...(delta.feedback.previousStatus === undefined
        ? {}
        : { previousOutcome: delta.feedback.previousStatus }),
      applicationId: delta.feedback.applicationId,
      revision: delta.feedback.revision,
      updatedAt,
    };
  }
  if (delta.payload?.kind === 'record') {
    return {
      kind: 'upsert',
      record: parseProjectKnowledgeRecord(delta.payload.record),
    };
  }
  if (delta.payload?.kind === 'verify') {
    const payload = delta.payload as {
      readonly projectId?: unknown;
      readonly commands?: unknown;
      readonly updatedAt?: unknown;
    };
    if (
      typeof payload.projectId !== 'string' ||
      !Array.isArray(payload.commands) ||
      !payload.commands.every((command) => typeof command === 'string')
    ) {
      throw new Error('Learning Delta verification payload is invalid');
    }
    return {
      kind: 'verify',
      projectId: payload.projectId,
      commands: payload.commands,
      updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : updatedAt,
    };
  }
  if (delta.action === 'noop') return null;
  const projectId = delta.applicability.projectId ?? current?.projectId ?? fallbackProjectId;
  if (delta.action === 'supersede' || delta.action === 'forget') {
    if (!delta.targetId) throw new Error('Learning Delta target is required');
    return {
      kind: 'supersede',
      id: delta.targetId,
      projectId,
      updatedAt,
      reason: delta.statement,
    };
  }
  const type = projectKnowledgeTypeFromDelta(delta.kind, delta.memoryType, current?.type);
  const authority =
    delta.authority === 'user' || delta.authority === 'explicit'
      ? ('user' as const)
      : delta.authority === 'repository'
        ? ('repository' as const)
        : ('automatic' as const);
  const state =
    delta.recommendedState === 'enforced' && (delta.verification?.length ?? 0) === 0
      ? ('proven' as const)
      : delta.recommendedState;
  const id =
    delta.targetId ??
    `learned-${createHash('sha256')
      .update(`${projectId}\u0000${type}\u0000${delta.statement}`)
      .digest('hex')
      .slice(0, 24)}`;
  const sources = delta.evidence.flatMap((entry) =>
    entry.source
      ? [
          {
            source: entry.source,
            ...(entry.anchor === undefined ? {} : { anchor: entry.anchor }),
            evidence: entry.summary,
          },
        ]
      : [],
  );
  const record = parseProjectKnowledgeRecord({
    id,
    projectId,
    type,
    state,
    authority,
    title: delta.title ?? delta.statement.slice(0, 200),
    summary: delta.statement,
    applicablePaths: delta.applicability.paths ?? current?.applicablePaths ?? [],
    operations: delta.applicability.operations ?? current?.operations ?? [],
    phases: delta.applicability.phases ?? current?.phases ?? [],
    conclusions: sources.length > 0 ? [{ text: delta.statement, sources }] : [],
    relations: current?.relations ?? [],
    verification: delta.verification ?? current?.verification ?? [],
    sourceVersions: current?.sourceVersions ?? [],
    applicationCount: current?.applicationCount ?? 0,
    successCount: current?.successCount ?? 0,
    failureCount: current?.failureCount ?? 0,
    ...(current?.lastAppliedAt === undefined ? {} : { lastAppliedAt: current.lastAppliedAt }),
    updatedAt,
  });
  return { kind: 'upsert', record };
}

function projectKnowledgeTypeFromDelta(
  kind: string,
  memoryType: import('../agent-learning/index.js').AgentMemoryType,
  current?: ProjectKnowledgeRecordType,
): ProjectKnowledgeRecordType {
  const known = new Set<ProjectKnowledgeRecordType>([
    'topology',
    'fact',
    'dependency',
    'decision',
    'pattern',
    'procedure',
    'constraint',
    'failure-resolution',
  ]);
  if (known.has(kind as ProjectKnowledgeRecordType)) return kind as ProjectKnowledgeRecordType;
  if (current !== undefined) return current;
  return memoryType === 'project-model' ? 'fact' : 'pattern';
}

export { MAX_RG_MATCHES, MAX_RG_OUTPUT_BYTES };
