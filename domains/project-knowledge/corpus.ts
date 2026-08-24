import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';
import {
  protectedProjectFileExists,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import type { WorkflowProjectConfig } from '../workflow-contract/types.js';
import type {
  ProjectKnowledgeCorpusOptions,
  ProjectKnowledgeDiagnosticReporter,
  ProjectKnowledgeDocument,
} from './types.js';

const MAX_REFERENCE_BYTES = 64 * 1024;
const MAX_CORPUS_FILES = 512;
const MAX_CORPUS_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_CORPUS_DISCOVERY_MS = 2_000;
const SUPERPOWER_ROOTS = new Set([
  'docs/superpowers/specs',
  'docs/superpowers/plans',
  'docs/superpowers/reports',
]);

interface DiscoveryBudget {
  readonly deadline: number;
  timedOut: boolean;
}

type MarkdownMatcher = (source: string) => boolean;

function budgetExpired(budget: DiscoveryBudget): boolean {
  if (Date.now() <= budget.deadline) return false;
  budget.timedOut = true;
  return true;
}

function report(
  reporter: ProjectKnowledgeDiagnosticReporter | undefined,
  code: string,
  message: string,
): void {
  reporter?.({ code, message });
}

function relativeSource(projectRoot: string, file: string): string {
  return path.relative(projectRoot, file).replaceAll(path.sep, '/');
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

async function safeDirectory(
  root: string,
  projectRoot: string,
  budget?: DiscoveryBudget,
): Promise<boolean> {
  if (budget && budgetExpired(budget)) return false;
  if (!isInside(projectRoot, root)) return false;
  try {
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    const realRoot = await fs.realpath(root);
    return isInside(projectRoot, realRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      report(undefined, 'corpus-root', `Unable to inspect ${relativeSource(projectRoot, root)}`);
    }
    return false;
  }
}

async function walkMarkdown(
  root: string,
  projectRoot: string,
  kind: ProjectKnowledgeDocument['kind'],
  archivedAt: string | undefined,
  reporter?: ProjectKnowledgeDiagnosticReporter,
  budget?: DiscoveryBudget,
  matcher?: MarkdownMatcher,
): Promise<ProjectKnowledgeDocument[]> {
  if (!(await safeDirectory(root, projectRoot, budget))) return [];
  const result: ProjectKnowledgeDocument[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (budget && budgetExpired(budget)) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      report(
        reporter,
        'corpus-read',
        `Unable to inspect ${relativeSource(projectRoot, directory)}`,
      );
      return;
    }
    for (const entry of entries) {
      if (budget && budgetExpired(budget)) return;
      if (entry.name.startsWith('.') && entry.name !== '.comet.yaml') continue;
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(target);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      if (!isInside(projectRoot, target)) continue;
      const source = relativeSource(projectRoot, target);
      if (matcher && !matcher(source)) continue;
      result.push({
        absolutePath: target,
        source,
        kind,
        ...((archivedAt ?? archiveDateFromPath(target))
          ? { archivedAt: archivedAt ?? archiveDateFromPath(target) }
          : {}),
      });
    }
  };
  await visit(root);
  return result;
}

function globRegExp(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          source += '(?:[^/]+/)*';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[\\^$+?.()|[\]{}]/gu, '\\$&');
    }
  }
  return new RegExp(`${source}$`, 'iu');
}

function customCorpusRoot(projectRoot: string, pattern: string): string {
  const segments = pattern.split('/');
  const wildcardIndex = segments.findIndex((segment) => /[*?]/u.test(segment));
  const literalSegments =
    wildcardIndex === -1 ? segments.slice(0, -1) : segments.slice(0, wildcardIndex);
  return path.join(projectRoot, ...literalSegments);
}

async function discoverCustomMarkdown(
  projectRoot: string,
  patterns: readonly string[],
  reporter?: ProjectKnowledgeDiagnosticReporter,
  budget?: DiscoveryBudget,
): Promise<ProjectKnowledgeDocument[]> {
  const documents: ProjectKnowledgeDocument[] = [];
  const matchers = patterns.map((pattern) => globRegExp(pattern));
  const roots = new Map<string, MarkdownMatcher>();
  for (const [index, pattern] of patterns.entries()) {
    const root = customCorpusRoot(projectRoot, pattern);
    const matcher = matchers[index];
    const previous = roots.get(root);
    roots.set(
      root,
      previous
        ? (source) => previous(source) || matcher.test(source)
        : (source) => matcher.test(source),
    );
  }
  for (const [root, matcher] of roots) {
    documents.push(
      ...(await walkMarkdown(root, projectRoot, 'custom', undefined, reporter, budget, matcher)),
    );
    if (budget && budgetExpired(budget)) break;
  }
  return documents;
}

function classicRoot(projectRoot: string, layout: 'legacy' | 'docs'): string {
  return path.join(projectRoot, layout === 'docs' ? 'docs' : '', 'openspec');
}

function archiveDateFromPath(file: string): string | undefined {
  return /(?:^|[\\/])(\d{4}-\d{2}-\d{2})-/u.exec(file)?.[1];
}

function referenceValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

function relativeReference(projectRoot: string, value: string): string | null {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) return null;
  const target = path.resolve(projectRoot, ...normalized.split('/'));
  if (!isInside(projectRoot, target)) return null;
  const relative = relativeSource(projectRoot, target);
  return SUPERPOWER_ROOTS.has(relative.slice(0, relative.lastIndexOf('/')))
    ? relative
    : [...SUPERPOWER_ROOTS].some((root) => relative === root || relative.startsWith(`${root}/`))
      ? relative
      : null;
}

async function discoverSuperpowers(
  projectRoot: string,
  archiveRoot: string,
  reporter?: ProjectKnowledgeDiagnosticReporter,
  budget?: DiscoveryBudget,
): Promise<ProjectKnowledgeDocument[]> {
  const changes = await walkDirectories(archiveRoot, projectRoot, budget);
  const references = new Set<string>();
  for (const change of changes) {
    if (budget && budgetExpired(budget)) break;
    const state = path.join(change, '.comet.yaml');
    try {
      const source = relativeSource(projectRoot, state);
      const bytes = await readProtectedProjectFile(projectRoot, source, MAX_REFERENCE_BYTES, {
        label: `${relativeSource(projectRoot, state)} state`,
      });
      const parsed = parse(bytes.bytes.toString('utf8')) as Record<string, unknown>;
      for (const key of ['design_doc', 'plan', 'verification_report']) {
        for (const value of referenceValues(parsed?.[key])) {
          const relative = relativeReference(projectRoot, value);
          if (relative) references.add(relative);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        report(
          reporter,
          'superpowers-state',
          `Unable to read archived Classic state ${relativeSource(projectRoot, state)}`,
        );
      }
    }
  }
  const documents: ProjectKnowledgeDocument[] = [];
  for (const relative of [...references].sort()) {
    if (budget && budgetExpired(budget)) break;
    const absolutePath = path.join(projectRoot, ...relative.split('/'));
    try {
      if (!(await protectedProjectFileExists(projectRoot, relative, { label: relative }))) continue;
      documents.push({ absolutePath, source: relative, kind: 'superpowers' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        report(reporter, 'superpowers-file', `Unable to inspect ${relative}`);
    }
  }
  return documents;
}

async function walkDirectories(
  root: string,
  projectRoot: string,
  budget?: DiscoveryBudget,
): Promise<string[]> {
  if (!(await safeDirectory(root, projectRoot, budget))) return [];
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (budget && budgetExpired(budget)) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (budget && budgetExpired(budget)) return;
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
      const target = path.join(directory, entry.name);
      if (!isInside(projectRoot, target)) continue;
      try {
        const state = await fs.lstat(path.join(target, '.comet.yaml'));
        if (state.isFile() && !state.isSymbolicLink()) result.push(target);
      } catch {
        // Only archived Classic Change directories with state are references.
      }
      await visit(target);
    }
  };
  await visit(root);
  return result.sort();
}

export async function discoverProjectKnowledgeCorpus(
  options: ProjectKnowledgeCorpusOptions,
): Promise<readonly ProjectKnowledgeDocument[]> {
  const projectRoot = path.resolve(options.projectRoot);
  const budget: DiscoveryBudget = {
    deadline: Date.now() + MAX_CORPUS_DISCOVERY_MS,
    timedOut: false,
  };
  let config: WorkflowProjectConfig | null;
  try {
    config = await readWorkflowProjectConfig(projectRoot);
  } catch (error) {
    report(
      options.reportDiagnostic,
      'config',
      `Project knowledge configuration is invalid: ${(error as Error).message}`,
    );
    return [];
  }
  if (!config || budgetExpired(budget)) return [];
  const enabledWorkflows = new Set(config.workflows ?? [config.default_workflow]);
  const documents: ProjectKnowledgeDocument[] = [];
  if (config.native && enabledWorkflows.has('native')) {
    const nativeRoot = path.join(projectRoot, config.native.artifact_root, 'comet');
    documents.push(
      ...(await walkMarkdown(
        path.join(nativeRoot, 'specs'),
        projectRoot,
        'native-spec',
        undefined,
        options.reportDiagnostic,
        budget,
      )),
      ...(await walkMarkdown(
        path.join(nativeRoot, 'archive'),
        projectRoot,
        'native-archive',
        undefined,
        options.reportDiagnostic,
        budget,
      )),
    );
  }
  if (config.classic && enabledWorkflows.has('classic')) {
    const root = classicRoot(projectRoot, config.classic.artifact_layout ?? 'legacy');
    const archiveRoot = path.join(root, 'changes', 'archive');
    documents.push(
      ...(await walkMarkdown(
        path.join(root, 'specs'),
        projectRoot,
        'classic-spec',
        undefined,
        options.reportDiagnostic,
        budget,
      )),
      ...(await walkMarkdown(
        path.join(archiveRoot),
        projectRoot,
        'classic-archive',
        undefined,
        options.reportDiagnostic,
        budget,
      )),
      ...(await discoverSuperpowers(projectRoot, archiveRoot, options.reportDiagnostic, budget)),
    );
  }
  if (config.knowledge?.provider === 'local' && config.knowledge.local?.include.length) {
    documents.push(
      ...(await discoverCustomMarkdown(
        projectRoot,
        config.knowledge.local.include,
        options.reportDiagnostic,
        budget,
      )),
    );
  }
  const unique = new Map<string, ProjectKnowledgeDocument>();
  for (const document of documents) {
    const existing = unique.get(document.source);
    if (
      existing === undefined ||
      knowledgeDocumentKindRank(document.kind) < knowledgeDocumentKindRank(existing.kind)
    ) {
      unique.set(document.source, document);
    }
  }
  const bounded: ProjectKnowledgeDocument[] = [];
  let totalBytes = 0;
  for (const document of [...unique.values()].sort((left, right) =>
    left.source.localeCompare(right.source),
  )) {
    if (budgetExpired(budget)) break;
    if (bounded.length >= MAX_CORPUS_FILES) {
      report(
        options.reportDiagnostic,
        'corpus-limit',
        `Project knowledge corpus is limited to ${MAX_CORPUS_FILES} files`,
      );
      break;
    }
    try {
      const size = (await fs.stat(document.absolutePath)).size;
      if (size > MAX_REFERENCE_BYTES || totalBytes + size > MAX_CORPUS_TOTAL_BYTES) {
        report(
          options.reportDiagnostic,
          'corpus-bytes',
          `Project knowledge corpus byte budget skipped ${document.source}`,
        );
        continue;
      }
      totalBytes += size;
      bounded.push(document);
    } catch {
      report(options.reportDiagnostic, 'corpus-read', `Unable to inspect ${document.source}`);
    }
  }
  if (budget.timedOut) {
    report(
      options.reportDiagnostic,
      'corpus-timeout',
      'Project knowledge corpus discovery exceeded its time budget',
    );
  }
  return bounded;
}

export function knowledgeDocumentKindRank(kind: ProjectKnowledgeDocument['kind']): number {
  return kind === 'native-spec' || kind === 'classic-spec'
    ? 0
    : kind === 'native-archive' || kind === 'classic-archive'
      ? 1
      : kind === 'custom'
        ? 2
        : 3;
}
