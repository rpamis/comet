import { createRequire } from 'node:module';
import path from 'node:path';

import { readFileRaceSafe } from '../../platform/fs/race-safe-read.js';
import { runBoundedRipgrep, type RipgrepRunResult } from '../../platform/process/ripgrep.js';
import { knowledgeDocumentKindRank } from './corpus.js';
import { queryContainsTerm, queryHasStrongMatch } from './query.js';
import type {
  ProjectKnowledgeDocument,
  ProjectKnowledgeDiagnosticReporter,
  ProjectKnowledgeProvider,
  ProjectKnowledgeProviderOptions,
  ProjectKnowledgeQuery,
  ProjectKnowledgeResult,
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

  public constructor(options: LocalProjectKnowledgeProviderOptions) {
    this.options = options;
    this.reportDiagnostic = options.reportDiagnostic;
  }

  public async retrieve(query: ProjectKnowledgeQuery): Promise<readonly ProjectKnowledgeResult[]> {
    if (query.terms.length === 0 || this.options.corpus.length === 0) return [];
    const documents = new Map(
      this.options.corpus.map((document) => [path.resolve(document.absolutePath), document]),
    );
    const targets = this.searchTargets();
    const args = [
      '--json',
      '--fixed-strings',
      '--ignore-case',
      '--no-messages',
      '--glob',
      '*.md',
      ...query.terms.flatMap((term) => ['-e', term]),
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
    for (const line of run.stdout.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      let event: unknown;
      try {
        event = JSON.parse(line) as unknown;
      } catch {
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
      const absolutePath = path.resolve(document.absolutePath);
      let content: string;
      try {
        content = (
          await readFileRaceSafe(absolutePath, MAX_DOCUMENT_BYTES, { label: document.source })
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
