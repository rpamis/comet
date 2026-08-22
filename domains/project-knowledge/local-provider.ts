import { createRequire } from 'node:module';
import path from 'node:path';

import { runBoundedRipgrep, type RipgrepRunResult } from '../../platform/process/ripgrep.js';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import { knowledgeDocumentKindRank } from './corpus.js';
import { ProjectKnowledgeIndexStore } from './index-store.js';
import { ProjectKnowledgeLocalStore } from './local-store.js';
import {
  ProjectKnowledgeUnitRepository,
  expandProjectKnowledgeRelations,
  validateProjectKnowledgeUnitSources,
} from './units.js';
import { extractDeterministicProjectUnits } from './deterministic-extractors.js';
import { queryContainsTerm, queryHasStrongMatch } from './query.js';
import type {
  ProjectKnowledgeDocument,
  ProjectKnowledgeApplyResult,
  ProjectKnowledgeDiagnosticReporter,
  ProjectKnowledgeLegacyProvider,
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
  readonly indexStore?: ProjectKnowledgeIndexStore;
  readonly localStore?: ProjectKnowledgeLocalStore;
  /** Retrieval-eval seam for measuring the bounded rg baseline. */
  readonly indexEnabled?: boolean;
  readonly unitRepository?: ProjectKnowledgeUnitRepository;
  readonly changedPaths?: readonly string[];
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

export class LocalProjectKnowledgeProvider implements ProjectKnowledgeLegacyProvider {
  private readonly options: LocalProjectKnowledgeProviderOptions;
  private readonly reportDiagnostic: ProjectKnowledgeDiagnosticReporter | undefined;
  private readonly indexStore: ProjectKnowledgeIndexStore;
  private localStore: ProjectKnowledgeLocalStore | null;
  private readonly unitRepository: ProjectKnowledgeUnitRepository;
  private deterministicUnitsReady = false;

  public constructor(options: LocalProjectKnowledgeProviderOptions) {
    this.options = options;
    this.reportDiagnostic = options.reportDiagnostic;
    this.localStore = options.localStore ?? null;
    this.indexStore =
      options.indexStore ??
      new ProjectKnowledgeIndexStore({
        projectRoot: options.projectRoot,
        ...(options.cacheRoot ? { cacheRoot: options.cacheRoot } : {}),
        reportDiagnostic: options.reportDiagnostic,
      });
    this.unitRepository =
      options.unitRepository ??
      new ProjectKnowledgeUnitRepository({
        projectRoot: options.projectRoot,
        ...(options.cacheRoot ? { cacheRoot: options.cacheRoot } : {}),
        reportDiagnostic: options.reportDiagnostic,
      });
  }

  private recordStore(): ProjectKnowledgeLocalStore {
    return (this.localStore ??= new ProjectKnowledgeLocalStore({
      projectRoot: this.options.projectRoot,
      ...(this.options.cacheRoot ? { cacheRoot: this.options.cacheRoot } : {}),
      ...(this.options.reportDiagnostic ? { reportDiagnostic: this.options.reportDiagnostic } : {}),
    }));
  }

  public async status(): Promise<ProjectKnowledgeStatus> {
    return this.recordStore().status();
  }

  public async query(request: ProjectKnowledgeQueryRequest): Promise<ProjectKnowledgeQueryResult> {
    if (request.kind === 'list') {
      const records = this.recordStore().list({
        ...(request.projectId ? { projectId: request.projectId } : {}),
        ...(request.type ? { type: request.type } : {}),
        ...(request.state && request.state !== 'all' ? { state: request.state } : {}),
        ...(request.authority ? { authority: request.authority } : {}),
        ...(request.limit ? { limit: request.limit } : {}),
      });
      return {
        kind: 'list',
        records,
        truncated: request.limit !== undefined && records.length >= request.limit,
        diagnostics: [],
      };
    }
    if (request.kind === 'get') {
      const record = this.recordStore().read(request.id);
      return {
        kind: 'get',
        record:
          record && (!request.projectId || record.projectId === request.projectId) ? record : null,
        diagnostics: [],
      };
    }

    const diagnostics: Array<{ code: string; message: string }> = [];
    await this.recordStore().apply({ kind: 'refresh' });
    let sections: readonly ProjectKnowledgeResult[] = [];
    let refreshedSources: readonly ProjectKnowledgeDocument[] = [];
    let indexSynced = false;
    if (this.options.indexEnabled !== false) {
      try {
        const sync = await this.recordStore().syncCorpus(this.options.corpus);
        refreshedSources = [...sync.refreshedSources, ...sync.changedSources];
        sections = this.recordStore().searchSections(request.query);
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
        : await this.retrieveWithRipgrep(request.query, [...refreshedSources]);
    const recordResults = this.recordStore().searchRecords(request.query);
    const results = new Map<string, ProjectKnowledgeResult>();
    for (const result of [...recordResults, ...sections, ...exact]) {
      const key = `${result.source}\u0000${result.title ?? ''}`;
      if (!results.has(key)) results.set(key, result);
    }
    const bounded = [...results.values()].slice(0, 8);
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
    const result = await this.recordStore().apply(mutation);
    if (mutation.kind === 'refresh' && !mutation.id) {
      try {
        await this.recordStore().rebuildWorkspace(this.options.corpus);
      } catch {
        this.reportDiagnostic?.({
          code: 'index-rebuild',
          message: 'Local project knowledge workspace index could not be rebuilt.',
        });
      }
    }
    return result;
  }

  public close(): void {
    this.indexStore.close();
    this.localStore?.close();
    this.localStore = null;
  }

  public async retrieve(query: ProjectKnowledgeQuery): Promise<readonly ProjectKnowledgeResult[]> {
    let indexed: readonly ProjectKnowledgeResult[] = [];
    let refreshedSources: readonly ProjectKnowledgeDocument[] = [];
    let indexSynced = false;
    if (this.options.indexEnabled !== false) {
      try {
        const sync = await this.indexStore.syncCorpus(this.options.corpus);
        refreshedSources = [...sync.refreshedSources, ...sync.changedSources];
        indexed = this.indexStore.search(query);
        indexSynced = true;
      } catch {
        // A failed index cannot provide a trustworthy target list. Use the
        // bounded corpus files for this request so recovery still returns
        // current evidence instead of silently returning no context.
        refreshedSources = [...this.options.corpus];
        this.reportDiagnostic?.({
          code: 'index-unavailable',
          message:
            'Project knowledge index is unavailable; bounded ripgrep retrieval remains active.',
        });
      } finally {
        this.indexStore.close();
      }
    }
    const hintedSources = this.options.changedPaths
      ? this.options.corpus.filter((document) =>
          this.options.changedPaths!.some(
            (changed) =>
              document.source === changed ||
              document.source.startsWith(`${changed.replaceAll('\\', '/').replace(/\/$/u, '')}/`),
          ),
        )
      : [];
    const exact =
      indexSynced && refreshedSources.length === 0 && this.options.runRipgrep === undefined
        ? []
        : await this.retrieveWithRipgrep(query, [...refreshedSources, ...hintedSources]);
    const units = this.options.unitRepository ? await this.retrieveUnits(query) : [];
    const fused = new Map<string, { result: ProjectKnowledgeResult; score: number }>();
    for (const [channel, results] of [units, indexed, exact].entries()) {
      results.forEach((result, rank) => {
        const key = result.unit
          ? `unit\u0000${result.unit.id}`
          : `${result.source}\u0000${result.title ?? ''}`;
        const previous = fused.get(key);
        fused.set(key, {
          result: previous?.result ?? result,
          score:
            (previous?.score ?? 0) +
            1 / (60 + rank + 1) +
            (channel === 2 ? 0.002 : channel === 0 ? 0.025 : 0) +
            (result.unit?.origin === 'maintained' ? 0.04 : result.unit ? 0.01 : 0) +
            (result.document?.kind.endsWith('-spec')
              ? 0.1
              : result.document?.kind.endsWith('-archive')
                ? 0.01
                : 0),
        });
      });
    }
    const ranked = [...fused.values()]
      .sort(
        (left, right) =>
          right.score - left.score || left.result.source.localeCompare(right.result.source),
      )
      .slice(0, 8)
      .map(({ result, score }) => ({ ...result, score }));
    const validated: ProjectKnowledgeResult[] = [];
    for (const result of ranked) {
      try {
        if (result.unit) {
          const validation = await validateProjectKnowledgeUnitSources(result.unit, {
            projectRoot: this.options.projectRoot,
          });
          if (!validation.valid) throw new Error('project knowledge unit source is not current');
        } else {
          await readProtectedProjectFile(
            this.options.projectRoot,
            result.source,
            MAX_DOCUMENT_BYTES,
            { label: result.source },
          );
        }
        validated.push(result);
      } catch {
        this.reportDiagnostic?.({
          code: 'local-document',
          message: `Project knowledge document was skipped: ${result.source}`,
        });
      }
    }
    return validated;
  }

  private async retrieveUnits(
    query: ProjectKnowledgeQuery,
  ): Promise<readonly ProjectKnowledgeResult[]> {
    if (!this.deterministicUnitsReady) {
      try {
        const existing = await this.unitRepository.list({ origin: 'generated' });
        const generated = await extractDeterministicProjectUnits({
          projectRoot: this.options.projectRoot,
          ...(this.options.changedPaths ? { changedPaths: this.options.changedPaths } : {}),
        });
        const targetedRefresh = (this.options.changedPaths?.length ?? 0) > 0;
        for (const unit of generated) {
          // A changed-path extraction is intentionally partial. Do not replace a
          // workspace-wide deterministic unit with a view containing only the
          // changed module; the next unhinted pass will rebuild it completely.
          if (targetedRefresh) continue;
          const active = { ...unit, state: 'active' as const };
          const current = existing.find((candidate) => candidate.id === unit.id);
          if (current && current.state !== 'active') continue;
          const currentComparable = current ? { ...current, sourceVersions: undefined } : {};
          if (
            current?.origin === 'generated' &&
            current.state === 'active' &&
            JSON.stringify(currentComparable) === JSON.stringify(active)
          ) {
            continue;
          }
          const validation = await validateProjectKnowledgeUnitSources(active, {
            projectRoot: this.options.projectRoot,
          });
          if (validation.valid) {
            await this.unitRepository.writeGenerated(active);
          } else {
            for (const diagnostic of validation.diagnostics) {
              this.reportDiagnostic?.({
                code: diagnostic.code,
                message: `${unit.id}: ${diagnostic.message}${diagnostic.source ? ` (${diagnostic.source})` : ''}`,
              });
            }
          }
        }
        this.deterministicUnitsReady = true;
      } catch {
        this.reportDiagnostic?.({
          code: 'deterministic-extractor',
          message: 'Deterministic project knowledge extraction was skipped for this request.',
        });
      }
    }
    const units = await this.unitRepository.list({ state: 'active' });
    try {
      await this.indexStore.replaceUnitRelations(units);
      this.indexStore.close();
    } catch {
      this.reportDiagnostic?.({
        code: 'unit-relations',
        message: 'Project knowledge unit relations were not written to the local index.',
      });
      this.indexStore.close();
    }
    const results: ProjectKnowledgeResult[] = [];
    for (const unit of units) {
      const searchable = [
        unit.id,
        unit.kind,
        unit.title,
        unit.summary,
        ...unit.applicablePaths,
        ...unit.operations,
        ...unit.conclusions.map((conclusion) => conclusion.text),
      ].join('\n');
      const matched = query.terms.filter((term) =>
        searchable.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
      );
      if (matched.length === 0) continue;
      const validation = await validateProjectKnowledgeUnitSources(unit, {
        projectRoot: this.options.projectRoot,
      });
      if (!validation.valid) {
        for (const diagnostic of validation.diagnostics) {
          this.reportDiagnostic?.({ code: diagnostic.code, message: diagnostic.message });
        }
        continue;
      }
      results.push({
        source: `unit:${unit.id}`,
        title: unit.title,
        content:
          `${unit.summary}\n\n${unit.conclusions.map((conclusion) => conclusion.text).join('\n')}`.slice(
            0,
            1600,
          ),
        score: matched.length / Math.max(1, query.terms.length),
        unit,
      });
    }
    const matchedIds = results.map((result) => result.unit?.id).filter((id): id is string => !!id);
    const related = expandProjectKnowledgeRelations({
      units,
      matchedIds,
    });
    for (const unit of related) {
      if (results.some((result) => result.unit?.id === unit.id)) continue;
      results.push({
        source: `unit:${unit.id}`,
        title: unit.title,
        content:
          `${unit.summary}\n\n${unit.conclusions.map((conclusion) => conclusion.text).join('\n')}`.slice(
            0,
            1600,
          ),
        score: 0.2,
        unit,
      });
    }
    return results.sort((left, right) => (right.score ?? 0) - (left.score ?? 0)).slice(0, 8);
  }

  private async retrieveWithRipgrep(
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

export { MAX_RG_MATCHES, MAX_RG_OUTPUT_BYTES };
