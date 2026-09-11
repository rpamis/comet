import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';
import { RemoteProjectKnowledgeProvider } from '../project-knowledge/remote-provider.js';
import type {
  ProjectKnowledgeApplyResult,
  ProjectKnowledgeDiagnostic,
  ProjectKnowledgeDocument,
  ProjectKnowledgeProvider,
  ProjectKnowledgeMutation,
  ProjectKnowledgeQueryRequest,
  ProjectKnowledgeQueryResult,
  ProjectKnowledgeResult,
  ProjectKnowledgeStatus,
} from '../project-knowledge/types.js';
import type {
  WorkflowCapabilityDiscoveryResult,
  WorkflowCapabilityDiscoveryScope,
} from '../project-knowledge/capability-discovery.js';

const NATIVE_KNOWLEDGE_MAX_DOCUMENTS = 512;
const NATIVE_KNOWLEDGE_MAX_DOCUMENT_BYTES = 256 * 1024;
const NATIVE_KNOWLEDGE_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const NATIVE_KNOWLEDGE_MAX_DISCOVERY_MS = 2_000;
const NATIVE_KNOWLEDGE_CACHE_FILE = path.join(
  '.comet',
  'runtime',
  'native',
  'capability-discovery-cache.json',
);
const NATIVE_KNOWLEDGE_CACHE_SCHEMA = 'comet.native.capability-cache.v1';
const NATIVE_KNOWLEDGE_CACHE_MAX_BYTES = 512 * 1024;
const NATIVE_KNOWLEDGE_CACHE_MAX_ENTRIES = 32;

interface NativeKnowledgeSource {
  readonly absolutePath: string;
  readonly source: string;
  readonly kind: 'native-spec' | 'native-archive';
  readonly size: number;
  readonly mtimeMs: number;
  readonly contentHash: string;
}

interface NativeKnowledgeManifest {
  readonly sources: readonly NativeKnowledgeSource[];
  readonly fingerprint: string;
  readonly complete: boolean;
}

interface NativeCapabilityCacheEntry {
  readonly key: string;
  readonly fingerprint: string;
  readonly result: WorkflowCapabilityDiscoveryResult;
}

interface NativeCapabilityCacheFile {
  readonly schema: typeof NATIVE_KNOWLEDGE_CACHE_SCHEMA;
  readonly entries: readonly NativeCapabilityCacheEntry[];
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function relativeSource(projectRoot: string, target: string): string {
  return path.relative(projectRoot, target).replaceAll(path.sep, '/');
}

function report(
  reporter: ((diagnostic: ProjectKnowledgeDiagnostic) => void) | undefined,
  code: string,
  message: string,
): void {
  reporter?.({ code, message });
}

async function realDirectory(root: string, projectRoot: string): Promise<boolean> {
  if (!isInside(projectRoot, root)) return false;
  try {
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    return isInside(await fs.realpath(projectRoot), await fs.realpath(root));
  } catch {
    return false;
  }
}

async function collectNativeKnowledgeManifest(options: {
  readonly projectRoot: string;
  readonly scope: WorkflowCapabilityDiscoveryScope;
  readonly reportDiagnostic?: (diagnostic: ProjectKnowledgeDiagnostic) => void;
}): Promise<NativeKnowledgeManifest> {
  const projectRoot = path.resolve(options.projectRoot);
  const deadline = Date.now() + NATIVE_KNOWLEDGE_MAX_DISCOVERY_MS;
  const sources: NativeKnowledgeSource[] = [];
  let complete = true;
  let manifestBytes = 0;

  const visit = async (root: string, kind: NativeKnowledgeSource['kind']): Promise<void> => {
    if (Date.now() > deadline) {
      complete = false;
      return;
    }
    if (!(await realDirectory(root, projectRoot))) return;
    const walk = async (directory: string): Promise<void> => {
      if (Date.now() > deadline || sources.length >= NATIVE_KNOWLEDGE_MAX_DOCUMENTS) {
        complete = false;
        return;
      }
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        complete = false;
        return;
      }
      for (const entry of entries.sort((left, right) =>
        left.name.localeCompare(right.name, 'en'),
      )) {
        if (Date.now() > deadline) {
          complete = false;
          return;
        }
        if (entry.isSymbolicLink()) continue;
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(target);
          continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
        if (!isInside(projectRoot, target)) continue;
        const stat = await fs.stat(target);
        if (stat.size > NATIVE_KNOWLEDGE_MAX_DOCUMENT_BYTES) continue;
        if (manifestBytes + stat.size > NATIVE_KNOWLEDGE_MAX_TOTAL_BYTES) {
          complete = false;
          return;
        }
        if (Date.now() > deadline) {
          complete = false;
          return;
        }
        const source = relativeSource(projectRoot, target);
        let content: { bytes: Buffer };
        try {
          content = await readProtectedProjectFile(
            projectRoot,
            source,
            NATIVE_KNOWLEDGE_MAX_DOCUMENT_BYTES,
            { label: `${kind} capability Spec` },
          );
        } catch {
          complete = false;
          continue;
        }
        manifestBytes += content.bytes.length;
        sources.push({
          absolutePath: target,
          source,
          kind,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          contentHash: createHash('sha256').update(content.bytes).digest('hex'),
        });
        if (sources.length >= NATIVE_KNOWLEDGE_MAX_DOCUMENTS) {
          complete = false;
          return;
        }
      }
    };
    await walk(root);
  };

  await visit(
    path.resolve(projectRoot, ...options.scope.currentSpecRoot.split('/')),
    'native-spec',
  );
  await visit(path.resolve(projectRoot, ...options.scope.archiveRoot.split('/')), 'native-archive');
  sources.sort((left, right) => left.source.localeCompare(right.source, 'en'));
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify(
        sources.map(({ source, kind, size, mtimeMs, contentHash }) => ({
          source,
          kind,
          size,
          mtimeMs,
          contentHash,
        })),
      ),
    )
    .digest('hex');
  if (!complete) {
    report(
      options.reportDiagnostic,
      'capability-corpus-limit',
      '能力候选语料发现达到时间或文件数量上限，当前结果可能不完整。',
    );
  }
  return { sources, fingerprint, complete };
}

function titleFromMarkdown(content: string): string | undefined {
  return /^(?:#)\s+(.+)$/mu.exec(content)?.[1]?.trim();
}

function searchScore(content: string, source: string, terms: readonly string[]): number {
  const searchable = `${source}\n${content}`.toLocaleLowerCase();
  return terms.reduce(
    (score, term) => score + (searchable.includes(term.toLocaleLowerCase()) ? 1 : 0),
    0,
  );
}

class NativeCapabilityKnowledgeProvider implements ProjectKnowledgeProvider {
  public constructor(
    private readonly projectRoot: string,
    private readonly manifest: NativeKnowledgeManifest,
    private readonly reportDiagnostic?: (diagnostic: ProjectKnowledgeDiagnostic) => void,
  ) {}

  public async status(): Promise<ProjectKnowledgeStatus> {
    return {
      provider: 'local',
      healthy: true,
      writable: false,
      diagnostics: [],
    };
  }

  public async query(request: ProjectKnowledgeQueryRequest): Promise<ProjectKnowledgeQueryResult> {
    if (request.kind !== 'search') {
      throw new Error('Native capability discovery only supports search queries');
    }
    const diagnostics: ProjectKnowledgeDiagnostic[] = [];
    const results: Array<ProjectKnowledgeResult & { readonly score: number }> = [];
    let totalBytes = 0;
    for (const source of this.manifest.sources) {
      if (totalBytes + source.size > NATIVE_KNOWLEDGE_MAX_TOTAL_BYTES) {
        diagnostics.push({
          code: 'capability-corpus-bytes',
          message: '能力候选语料达到总字节预算，剩余来源不会参与本次召回。',
        });
        break;
      }
      try {
        const read = await readProtectedProjectFile(
          this.projectRoot,
          source.source,
          NATIVE_KNOWLEDGE_MAX_DOCUMENT_BYTES,
          { label: `${source.kind} capability Spec` },
        );
        totalBytes += read.bytes.length;
        const content = read.bytes.toString('utf8');
        const score = searchScore(content, source.source, request.query.terms);
        if (score === 0) continue;
        const document: ProjectKnowledgeDocument = {
          absolutePath: source.absolutePath,
          source: source.source,
          kind: source.kind,
        };
        results.push({
          content,
          source: source.source,
          ...(titleFromMarkdown(content) ? { title: titleFromMarkdown(content) } : {}),
          score,
          document,
        });
      } catch (error) {
        const diagnostic = {
          code: 'capability-corpus-read',
          message: `能力候选来源无法读取，已跳过 ${source.source}：${error instanceof Error ? error.message : String(error)}`,
        };
        diagnostics.push(diagnostic);
        this.reportDiagnostic?.(diagnostic);
      }
    }
    results.sort(
      (left, right) => right.score - left.score || left.source.localeCompare(right.source),
    );
    return {
      kind: 'search',
      hits: [],
      results,
      records: [],
      truncated: !this.manifest.complete,
      diagnostics,
    };
  }

  public async apply(_mutation: ProjectKnowledgeMutation): Promise<ProjectKnowledgeApplyResult> {
    throw new Error('Native capability discovery is read-only');
  }
}

export async function createNativeCapabilityKnowledgeProvider(options: {
  readonly projectRoot: string;
  readonly scope: WorkflowCapabilityDiscoveryScope;
  readonly reportDiagnostic?: (diagnostic: ProjectKnowledgeDiagnostic) => void;
}): Promise<ProjectKnowledgeProvider> {
  const config = await readWorkflowProjectConfig(options.projectRoot);
  const knowledge = config?.knowledge;
  if (knowledge?.provider === 'remote') {
    if (!knowledge.remote) {
      throw new Error('Configured remote Project Knowledge provider is missing remote settings');
    }
    return new RemoteProjectKnowledgeProvider({
      config: knowledge.remote,
      projectRoot: options.projectRoot,
      ...(options.reportDiagnostic ? { reportDiagnostic: options.reportDiagnostic } : {}),
    });
  }
  const manifest = await collectNativeKnowledgeManifest(options);
  return new NativeCapabilityKnowledgeProvider(
    path.resolve(options.projectRoot),
    manifest,
    options.reportDiagnostic,
  );
}

function cacheKey(options: {
  readonly scope: WorkflowCapabilityDiscoveryScope;
  readonly task: string;
}): string {
  return JSON.stringify({
    workflow: options.scope.workflow,
    currentSpecRoot: options.scope.currentSpecRoot,
    archiveRoot: options.scope.archiveRoot,
    task: options.task.trim(),
  });
}

function validCachedResult(value: unknown): value is WorkflowCapabilityDiscoveryResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;
  return (
    root.workflow === 'native' &&
    (root.query === null || (typeof root.query === 'object' && root.query !== null)) &&
    Array.isArray(root.candidates) &&
    root.candidates.length <= 5 &&
    (root.associationDraft === null ||
      (typeof root.associationDraft === 'object' && root.associationDraft !== null)) &&
    Array.isArray(root.diagnostics) &&
    typeof root.searched === 'boolean' &&
    root.providerLimit === 40
  );
}

function parseCache(value: unknown): NativeCapabilityCacheFile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  if (root.schema !== NATIVE_KNOWLEDGE_CACHE_SCHEMA || !Array.isArray(root.entries)) return null;
  if (root.entries.length > NATIVE_KNOWLEDGE_CACHE_MAX_ENTRIES) return null;
  const entries: NativeCapabilityCacheEntry[] = [];
  for (const entry of root.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const record = entry as Record<string, unknown>;
    if (
      typeof record.key !== 'string' ||
      typeof record.fingerprint !== 'string' ||
      !validCachedResult(record.result)
    )
      return null;
    entries.push({
      key: record.key,
      fingerprint: record.fingerprint,
      result: record.result,
    });
  }
  return { schema: NATIVE_KNOWLEDGE_CACHE_SCHEMA, entries };
}

async function readCache(projectRoot: string): Promise<NativeCapabilityCacheFile | null> {
  try {
    const source = await fs.readFile(path.join(projectRoot, NATIVE_KNOWLEDGE_CACHE_FILE), 'utf8');
    if (Buffer.byteLength(source, 'utf8') > NATIVE_KNOWLEDGE_CACHE_MAX_BYTES) return null;
    return parseCache(JSON.parse(source));
  } catch {
    return null;
  }
}

export async function readNativeCapabilityDiscoveryCache(options: {
  readonly projectRoot: string;
  readonly scope: WorkflowCapabilityDiscoveryScope;
  readonly task: string;
}): Promise<WorkflowCapabilityDiscoveryResult | null> {
  const projectRoot = path.resolve(options.projectRoot);
  const config = await readWorkflowProjectConfig(projectRoot);
  if (config?.knowledge?.provider === 'remote') return null;
  const manifest = await collectNativeKnowledgeManifest({
    projectRoot,
    scope: options.scope,
  });
  if (!manifest.complete) return null;
  const cache = await readCache(projectRoot);
  const entry = cache?.entries.find(
    (candidate) =>
      candidate.key === cacheKey(options) && candidate.fingerprint === manifest.fingerprint,
  );
  return entry?.result ?? null;
}

export async function writeNativeCapabilityDiscoveryCache(options: {
  readonly projectRoot: string;
  readonly scope: WorkflowCapabilityDiscoveryScope;
  readonly task: string;
  readonly result: WorkflowCapabilityDiscoveryResult;
}): Promise<void> {
  const projectRoot = path.resolve(options.projectRoot);
  const config = await readWorkflowProjectConfig(projectRoot);
  if (config?.knowledge?.provider === 'remote') return;
  const manifest = await collectNativeKnowledgeManifest({
    projectRoot,
    scope: options.scope,
  });
  if (!manifest.complete) return;
  const cache: NativeCapabilityCacheFile = (await readCache(projectRoot)) ?? {
    schema: NATIVE_KNOWLEDGE_CACHE_SCHEMA,
    entries: [],
  };
  const key = cacheKey(options);
  const entries = [
    {
      key,
      fingerprint: manifest.fingerprint,
      result: options.result,
    },
    ...cache.entries.filter(
      (entry) => !(entry.key === key && entry.fingerprint === manifest.fingerprint),
    ),
  ].slice(0, NATIVE_KNOWLEDGE_CACHE_MAX_ENTRIES);
  const serialized = JSON.stringify({ schema: NATIVE_KNOWLEDGE_CACHE_SCHEMA, entries });
  if (Buffer.byteLength(serialized, 'utf8') > NATIVE_KNOWLEDGE_CACHE_MAX_BYTES) return;
  const { atomicWriteJson } = await import('./native-atomic-file.js');
  await atomicWriteJson(
    path.join(projectRoot, NATIVE_KNOWLEDGE_CACHE_FILE),
    { schema: NATIVE_KNOWLEDGE_CACHE_SCHEMA, entries },
    { containedRoot: path.join(projectRoot, '.comet', 'runtime', 'native') },
  );
}
