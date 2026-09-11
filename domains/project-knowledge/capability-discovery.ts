import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseDocument, stringify } from 'yaml';

import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import { createProjectKnowledgeQuery, queryContainsTerm } from './query.js';
import type {
  ProjectKnowledgeDiagnostic,
  ProjectKnowledgeProvider,
  ProjectKnowledgeQuery,
  ProjectKnowledgeResult,
} from './types.js';

const MAX_CANDIDATES = 5;
const MAX_PROVIDER_RESULTS = 40;
const MAX_EVIDENCE = 5;
const MAX_SNIPPET_CHARS = 600;
const MAX_SPEC_BYTES = 256 * 1024;
const CAPABILITY_SEGMENT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const CLASSIC_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export const CAPABILITY_ASSOCIATION_FILE = 'capability-association.yaml';

export type WorkflowCapability = 'native' | 'classic';
export type CapabilityCandidateConfidence = 'high' | 'medium' | 'low';

export interface WorkflowCapabilityDiscoveryScope {
  readonly workflow: WorkflowCapability;
  /** Project-relative directory containing the current `spec.md` files. */
  readonly currentSpecRoot: string;
  /** Project-relative directory containing archived changes. */
  readonly archiveRoot: string;
}

export interface WorkflowCapabilityEvidence {
  readonly source: string;
  readonly kind: string;
  readonly title?: string;
  readonly snippet?: string;
}

export interface WorkflowCapabilityCandidate {
  readonly workflow: WorkflowCapability;
  readonly capability: string;
  readonly currentSpec: {
    readonly source: string;
    readonly hash: string;
  };
  readonly historicalSources: readonly string[];
  readonly matchedTerms: readonly string[];
  readonly confidence: CapabilityCandidateConfidence;
  readonly score: number;
  readonly reason: string;
  readonly evidence: readonly WorkflowCapabilityEvidence[];
}

export interface CapabilityAssociationDraft {
  readonly schema: 'comet.capability-association.v1';
  readonly status: 'suggested' | 'explicit';
  readonly workflow: WorkflowCapability;
  readonly capability: string;
  readonly current_spec: string;
  readonly current_hash: string;
  readonly confidence: CapabilityCandidateConfidence;
  readonly query?: string;
  readonly reason: string;
  readonly historical_sources: readonly string[];
  readonly evidence: readonly WorkflowCapabilityEvidence[];
}

export interface WorkflowCapabilityDiscoveryResult {
  readonly workflow: WorkflowCapability;
  readonly query: ProjectKnowledgeQuery | null;
  readonly candidates: readonly WorkflowCapabilityCandidate[];
  readonly associationDraft: CapabilityAssociationDraft | null;
  readonly diagnostics: readonly ProjectKnowledgeDiagnostic[];
  readonly searched: boolean;
  readonly providerLimit: number;
}

const ASSOCIATION_HASH_PATTERN = /^[a-f0-9]{64}$/iu;

function associationRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function associationString(value: unknown, label: string, maxLength = 4096): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string within the association limit`);
  }
  return value;
}

function associationPath(value: unknown, label: string): string {
  const normalized = associationString(value, label).replaceAll('\\', '/');
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`${label} must be a project-relative path`);
  }
  return normalized;
}

function associationHash(value: unknown, label: string): string {
  const result = associationString(value, label, 64).toLowerCase();
  if (!ASSOCIATION_HASH_PATTERN.test(result)) throw new Error(`${label} must be a SHA-256 hash`);
  return result;
}

function parseAssociationEvidence(value: unknown, index: number): WorkflowCapabilityEvidence {
  const label = `Capability association evidence[${index}]`;
  const root = associationRecord(value, label);
  const unknown = Object.keys(root).filter(
    (key) => !new Set(['source', 'kind', 'title', 'snippet']).has(key),
  );
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}`);
  return {
    source: associationPath(root.source, `${label}.source`),
    kind: associationString(root.kind, `${label}.kind`, 128),
    ...(root.title === undefined ? {} : { title: associationString(root.title, `${label}.title`) }),
    ...(root.snippet === undefined
      ? {}
      : { snippet: associationString(root.snippet, `${label}.snippet`, MAX_SNIPPET_CHARS) }),
  };
}

/** Parse and validate the persisted association draft before it contributes to Shape. */
export function parseCapabilityAssociationDraft(value: unknown): CapabilityAssociationDraft {
  const parsed =
    typeof value === 'string'
      ? (() => {
          if (value.length > 64 * 1024)
            throw new Error('Capability association exceeds the size limit');
          const document = parseDocument(value, { uniqueKeys: true });
          if (document.errors.length > 0) throw new Error(document.errors[0].message);
          return document.toJS({ mapAsMap: false });
        })()
      : value;
  const root = associationRecord(parsed, 'Capability association');
  const unknown = Object.keys(root).filter(
    (key) =>
      !new Set([
        'schema',
        'status',
        'workflow',
        'capability',
        'current_spec',
        'current_hash',
        'confidence',
        'query',
        'reason',
        'historical_sources',
        'evidence',
      ]).has(key),
  );
  if (unknown.length > 0)
    throw new Error(`Capability association has unknown field(s): ${unknown.join(', ')}`);
  if (root.schema !== 'comet.capability-association.v1') {
    throw new Error('Unsupported capability association schema');
  }
  const workflow = root.workflow;
  if (workflow !== 'native' && workflow !== 'classic') {
    throw new Error('Capability association workflow is invalid');
  }
  const capability = safeCapability(
    associationString(root.capability, 'Capability association capability'),
    workflow,
  );
  if (!Array.isArray(root.historical_sources)) {
    throw new Error('Capability association historical_sources must be an array');
  }
  const historical_sources = root.historical_sources.map((source, index) =>
    associationPath(source, `Capability association historical_sources[${index}]`),
  );
  if (!Array.isArray(root.evidence) || root.evidence.length > MAX_EVIDENCE) {
    throw new Error(`Capability association evidence must contain at most ${MAX_EVIDENCE} entries`);
  }
  const status = root.status;
  if (status !== 'suggested' && status !== 'explicit') {
    throw new Error('Capability association status is invalid');
  }
  const confidence = root.confidence;
  if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') {
    throw new Error('Capability association confidence is invalid');
  }
  return {
    schema: 'comet.capability-association.v1',
    status,
    workflow,
    capability,
    current_spec: associationPath(root.current_spec, 'Capability association current_spec'),
    current_hash: associationHash(root.current_hash, 'Capability association current_hash'),
    confidence,
    ...(root.query === undefined
      ? {}
      : { query: associationString(root.query, 'Capability association query') }),
    reason: associationString(root.reason, 'Capability association reason', 2048),
    historical_sources,
    evidence: root.evidence.map(parseAssociationEvidence),
  };
}

interface ParsedCapabilitySource {
  readonly kind: 'current' | 'archive';
  readonly capability: string;
  readonly source: string;
}

interface EvidenceInput {
  readonly source: string;
  readonly kind: string;
  readonly title?: string;
  readonly snippet?: string;
  readonly searchableText: string;
  readonly resultScore: number;
  readonly resultRank: number;
}

interface CandidateAccumulator {
  readonly workflow: WorkflowCapability;
  readonly capability: string;
  readonly historicalSources: Set<string>;
  readonly matchedTerms: Set<string>;
  readonly evidence: Map<string, WorkflowCapabilityEvidence>;
  currentHits: number;
  historicalHits: number;
  bestScore: number;
  bestRank: number;
}

function normalizedRelative(value: string, label: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`${label} must be a project-relative path`);
  }
  return normalized;
}

function safeCapability(capability: string, workflow: WorkflowCapability): string {
  const normalized = capability.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '');
  const segments = normalized.split('/');
  const pattern = workflow === 'native' ? CAPABILITY_SEGMENT : CLASSIC_SEGMENT;
  if (!normalized || segments.some((segment) => !pattern.test(segment))) {
    throw new Error(`Invalid ${workflow} capability: ${capability}`);
  }
  return segments.join('/');
}

function sourceFromPath(
  scope: WorkflowCapabilityDiscoveryScope,
  source: string,
): ParsedCapabilitySource | null {
  const normalized = source.replaceAll('\\', '/').replace(/^\.\//u, '');
  const currentPrefix = `${normalizedRelative(scope.currentSpecRoot, 'current Spec root')}/`;
  if (normalized.startsWith(currentPrefix) && normalized.endsWith('/spec.md')) {
    const capability = normalized.slice(currentPrefix.length, -'/spec.md'.length);
    try {
      return {
        kind: 'current',
        capability: safeCapability(capability, scope.workflow),
        source: normalized,
      };
    } catch {
      return null;
    }
  }

  const archivePrefix = `${normalizedRelative(scope.archiveRoot, 'archive root')}/`;
  if (!normalized.startsWith(archivePrefix)) return null;
  const tail = normalized.slice(archivePrefix.length).split('/');
  if (tail.length < 4 || tail[1] !== 'specs' || tail.at(-1) !== 'spec.md') return null;
  const capability = tail.slice(2, -1).join('/');
  try {
    return {
      kind: 'archive',
      capability: safeCapability(capability, scope.workflow),
      source: normalized,
    };
  } catch {
    return null;
  }
}

function currentSpecSource(scope: WorkflowCapabilityDiscoveryScope, capability: string): string {
  return `${normalizedRelative(scope.currentSpecRoot, 'current Spec root')}/${safeCapability(capability, scope.workflow)}/spec.md`;
}

function semanticSpecHash(bytes: Buffer): string {
  return createHash('sha256')
    .update(bytes.toString('utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n'))
    .digest('hex');
}

function sourceEvidence(result: ProjectKnowledgeResult): EvidenceInput[] {
  const resultScore =
    typeof result.score === 'number' && Number.isFinite(result.score) ? result.score : 0;
  const base: EvidenceInput = {
    source: result.source,
    kind: result.document?.kind ?? 'project-knowledge',
    ...(result.title ? { title: result.title } : {}),
    snippet: result.content.slice(0, MAX_SNIPPET_CHARS),
    searchableText: [
      result.source,
      result.title ?? '',
      result.content,
      result.record?.summary ?? '',
    ].join('\n'),
    resultScore,
    resultRank: 0,
  };
  const references = result.record
    ? [...result.record.conclusions, ...result.record.relations].flatMap((entry) => entry.sources)
    : [];
  return [
    base,
    ...references.map((reference, index) => ({
      source: reference.source,
      kind: 'record-reference',
      searchableText: [
        reference.source,
        result.title ?? '',
        result.content,
        result.record?.summary ?? '',
      ].join('\n'),
      resultScore,
      resultRank: index + 1,
    })),
  ];
}

function accumulatorFor(
  accumulators: Map<string, CandidateAccumulator>,
  scope: WorkflowCapabilityDiscoveryScope,
  capability: string,
): CandidateAccumulator {
  const key = `${scope.workflow}\u0000${capability}`;
  const existing = accumulators.get(key);
  if (existing) return existing;
  const created: CandidateAccumulator = {
    workflow: scope.workflow,
    capability,
    historicalSources: new Set(),
    matchedTerms: new Set(),
    evidence: new Map(),
    currentHits: 0,
    historicalHits: 0,
    bestScore: 0,
    bestRank: Number.MAX_SAFE_INTEGER,
  };
  accumulators.set(key, created);
  return created;
}

function candidateConfidence(
  accumulator: CandidateAccumulator,
  query: ProjectKnowledgeQuery,
): CapabilityCandidateConfidence {
  const exactCapability = query.terms.some(
    (term) => term.toLocaleLowerCase() === accumulator.capability.toLocaleLowerCase(),
  );
  if (accumulator.currentHits > 0 && (accumulator.matchedTerms.size >= 2 || exactCapability)) {
    return 'high';
  }
  if (accumulator.currentHits > 0) return 'medium';
  return 'low';
}

function candidateReason(
  accumulator: CandidateAccumulator,
  confidence: CapabilityCandidateConfidence,
): string {
  const current = accumulator.currentHits > 0 ? '当前总 Spec 已命中' : '检索命中历史 change';
  const history = accumulator.historicalSources.size
    ? `，并找到 ${accumulator.historicalSources.size} 个历史来源`
    : '';
  return `${current}${history}；已核对当前能力文件，匹配 ${accumulator.matchedTerms.size} 个查询词（${confidence}）`;
}

function candidateScore(accumulator: CandidateAccumulator, query: ProjectKnowledgeQuery): number {
  const coverage = accumulator.matchedTerms.size / Math.max(1, query.terms.length);
  return Math.min(
    1,
    (accumulator.currentHits > 0 ? 0.5 : 0.15) +
      Math.min(0.3, coverage * 0.3) +
      Math.min(0.15, Math.max(0, accumulator.bestScore) * 0.15) +
      Math.min(0.05, accumulator.historicalSources.size * 0.02),
  );
}

function sortedEvidence(
  evidence: Map<string, WorkflowCapabilityEvidence>,
): WorkflowCapabilityEvidence[] {
  return [...evidence.values()]
    .sort((left, right) => {
      const leftCurrent = left.kind.endsWith('-spec') ? 0 : 1;
      const rightCurrent = right.kind.endsWith('-spec') ? 0 : 1;
      return leftCurrent - rightCurrent || left.source.localeCompare(right.source);
    })
    .slice(0, MAX_EVIDENCE);
}

function draftForCandidate(
  candidate: WorkflowCapabilityCandidate,
  query: ProjectKnowledgeQuery | null,
  status: 'suggested' | 'explicit',
): CapabilityAssociationDraft {
  return {
    schema: 'comet.capability-association.v1',
    status,
    workflow: candidate.workflow,
    capability: candidate.capability,
    current_spec: candidate.currentSpec.source,
    current_hash: candidate.currentSpec.hash,
    confidence: candidate.confidence,
    ...(query ? { query: query.task } : {}),
    reason: candidate.reason,
    historical_sources: [...candidate.historicalSources],
    evidence: candidate.evidence,
  };
}

async function validateCurrentSpec(
  projectRoot: string,
  scope: WorkflowCapabilityDiscoveryScope,
  capability: string,
): Promise<{ source: string; hash: string }> {
  const source = currentSpecSource(scope, capability);
  const read = await readProtectedProjectFile(projectRoot, source, MAX_SPEC_BYTES, {
    label: `${scope.workflow} current capability Spec`,
  });
  return { source, hash: semanticSpecHash(read.bytes) };
}

function emptyResult(
  scope: WorkflowCapabilityDiscoveryScope,
  query: ProjectKnowledgeQuery | null,
  diagnostics: readonly ProjectKnowledgeDiagnostic[],
  searched: boolean,
): WorkflowCapabilityDiscoveryResult {
  return {
    workflow: scope.workflow,
    query,
    candidates: [],
    associationDraft: null,
    diagnostics,
    searched,
    providerLimit: MAX_PROVIDER_RESULTS,
  };
}

export async function discoverWorkflowCapabilityCandidates(options: {
  readonly projectRoot: string;
  readonly scope: WorkflowCapabilityDiscoveryScope;
  readonly provider?: ProjectKnowledgeProvider;
  readonly task?: string;
  readonly capability?: string;
  readonly limit?: number;
}): Promise<WorkflowCapabilityDiscoveryResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const diagnostics: ProjectKnowledgeDiagnostic[] = [];
  const explicit = options.capability?.trim();
  if (!explicit && !options.task?.trim()) {
    throw new Error('Capability discovery requires task or capability');
  }

  const query = options.task?.trim()
    ? createProjectKnowledgeQuery({ task: options.task.trim(), operation: 'associate capability' })
    : null;
  if (explicit) {
    const capability = safeCapability(explicit, options.scope.workflow);
    const currentSpec = await validateCurrentSpec(projectRoot, options.scope, capability);
    const candidate: WorkflowCapabilityCandidate = {
      workflow: options.scope.workflow,
      capability,
      currentSpec,
      historicalSources: [],
      matchedTerms: [capability],
      confidence: 'high',
      score: 1,
      reason: '用户显式指定能力，已直接核对当前总 Spec 路径。',
      evidence: [
        {
          source: currentSpec.source,
          kind: `${options.scope.workflow}-spec`,
        },
      ],
    };
    return {
      workflow: options.scope.workflow,
      query,
      candidates: [candidate],
      associationDraft: draftForCandidate(candidate, query, 'explicit'),
      diagnostics,
      searched: false,
      providerLimit: MAX_PROVIDER_RESULTS,
    };
  }

  if (!options.provider)
    throw new Error('Capability discovery requires a Project Knowledge provider for task search');
  let response;
  try {
    response = await options.provider.query({
      kind: 'search',
      query: query!,
      limit: MAX_PROVIDER_RESULTS,
    });
  } catch (error) {
    diagnostics.push({
      code: 'capability-discovery',
      message: `能力候选召回不可用，未自动关联：${error instanceof Error ? error.message : String(error)}`,
    });
    return emptyResult(options.scope, query, diagnostics, true);
  }
  if (response.kind !== 'search')
    return emptyResult(options.scope, query, response.diagnostics, true);
  diagnostics.push(...response.diagnostics);
  const accumulators = new Map<string, CandidateAccumulator>();
  for (const [resultRank, result] of response.results.entries()) {
    for (const evidence of sourceEvidence(result)) {
      const parsed = sourceFromPath(options.scope, evidence.source);
      if (!parsed) continue;
      const accumulator = accumulatorFor(accumulators, options.scope, parsed.capability);
      const matched = query!.terms.filter((term) =>
        queryContainsTerm(evidence.searchableText, term),
      );
      for (const term of matched) accumulator.matchedTerms.add(term);
      accumulator.bestScore = Math.max(accumulator.bestScore, evidence.resultScore);
      accumulator.bestRank = Math.min(accumulator.bestRank, resultRank);
      if (parsed.kind === 'current') accumulator.currentHits += 1;
      else {
        accumulator.historicalHits += 1;
        accumulator.historicalSources.add(parsed.source);
      }
      if (!accumulator.evidence.has(parsed.source)) {
        accumulator.evidence.set(parsed.source, {
          source: parsed.source,
          kind:
            parsed.kind === 'current'
              ? `${options.scope.workflow}-spec`
              : `${options.scope.workflow}-archive`,
          ...(evidence.title ? { title: evidence.title } : {}),
          ...(evidence.snippet ? { snippet: evidence.snippet } : {}),
        });
      }
    }
  }

  const limit = Math.max(1, Math.min(MAX_CANDIDATES, options.limit ?? MAX_CANDIDATES));
  const candidates: WorkflowCapabilityCandidate[] = [];
  const ordered = [...accumulators.values()].sort(
    (left, right) =>
      right.currentHits - left.currentHits ||
      right.matchedTerms.size - left.matchedTerms.size ||
      right.bestScore - left.bestScore ||
      left.bestRank - right.bestRank ||
      left.capability.localeCompare(right.capability),
  );
  for (const accumulator of ordered.slice(0, limit)) {
    let currentSpec;
    try {
      currentSpec = await validateCurrentSpec(projectRoot, options.scope, accumulator.capability);
    } catch (error) {
      diagnostics.push({
        code: 'capability-stale',
        message: `候选 ${accumulator.capability} 没有可核对的当前总 Spec，已排除：${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    const confidence = candidateConfidence(accumulator, query!);
    const candidate: WorkflowCapabilityCandidate = {
      workflow: options.scope.workflow,
      capability: accumulator.capability,
      currentSpec,
      historicalSources: [...accumulator.historicalSources].sort(),
      matchedTerms: [...accumulator.matchedTerms],
      confidence,
      score: candidateScore(accumulator, query!),
      reason: candidateReason(accumulator, confidence),
      evidence: sortedEvidence(accumulator.evidence),
    };
    candidates.push(candidate);
  }
  candidates.sort(
    (left, right) => right.score - left.score || left.capability.localeCompare(right.capability),
  );
  const associationDraft =
    candidates.length === 1 && candidates[0].confidence === 'high'
      ? draftForCandidate(candidates[0], query, 'suggested')
      : null;
  return {
    workflow: options.scope.workflow,
    query,
    candidates,
    associationDraft,
    diagnostics,
    searched: true,
    providerLimit: MAX_PROVIDER_RESULTS,
  };
}

export function renderCapabilityAssociationDraft(draft: CapabilityAssociationDraft): string {
  return stringify({
    schema: draft.schema,
    status: draft.status,
    workflow: draft.workflow,
    capability: draft.capability,
    current_spec: draft.current_spec,
    current_hash: draft.current_hash,
    confidence: draft.confidence,
    ...(draft.query === undefined ? {} : { query: draft.query }),
    reason: draft.reason,
    historical_sources: [...draft.historical_sources],
    evidence: draft.evidence.map((evidence) => ({
      source: evidence.source,
      kind: evidence.kind,
      ...(evidence.title === undefined ? {} : { title: evidence.title }),
      ...(evidence.snippet === undefined ? {} : { snippet: evidence.snippet }),
    })),
  });
}
