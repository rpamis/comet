import { createHash, type Hash } from 'node:crypto';
import path from 'path';

import { canonicalHash, canonicalJson } from './native-canonical-hash.js';
import { parseNativeContentSnapshotManifest } from './native-snapshot.js';
import type {
  NativeContentSnapshotManifest,
  NativeSnapshotEntry,
  NativeSnapshotOmission,
} from './native-types.js';

export const NATIVE_IMPLEMENTATION_SCOPE_SCHEMA = 'comet.native.implementation-scope.v2' as const;
export const NATIVE_SNAPSHOT_PROJECTION_SCHEMA =
  'comet.native.content-snapshot-projection.v1' as const;

const SNAPSHOT_PROJECTION_HASH_TAG = 'comet.native.content-snapshot-projection.v1';
const IMPLEMENTATION_SCOPE_HASH_TAG = 'comet.native.implementation-scope.v2';
const UNRESOLVED_SCOPE_ID_TAG = 'comet.native.unresolved-scope-id.v1';
const SCOPE_DETAIL_OVERFLOW_HASH_TAG = 'comet.native.scope-detail-overflow.v1';
const SNAPSHOT_PROJECTION_OVERFLOW_HASH_TAG = 'comet.native.snapshot-projection-overflow.v2';
const SHA256_HASH_PATTERN = /^[a-f0-9]{64}$/u;
export const MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES = 1024 * 1024;
export const MAX_NATIVE_DETAILED_SCOPE_CHANGES = 128;
export const MAX_NATIVE_DETAILED_UNRESOLVED_SCOPES = 128;

export interface NativeDeclaredArtifact {
  path: string;
  kind: 'file' | 'directory';
}

export type NativeSnapshotProjectionRef = `runtime/evidence/snapshots/${string}.json`;

export interface NativeImplementationChange {
  path: string;
  kind: 'added' | 'modified' | 'removed';
  before: NativeImplementationFileIdentity | null;
  after: NativeImplementationFileIdentity | null;
  attributedTo: NativeDeclaredArtifact[];
}

export interface NativeImplementationFileIdentity {
  hash: string;
  size: number;
}

export type NativeUnresolvedScopeKind =
  | 'unattributed-change'
  | 'snapshot-omission'
  | 'snapshot-incomplete'
  | 'snapshot-omission-overflow'
  | 'scope-detail-overflow'
  | 'missing-no-code-reason';

export interface NativeUnresolvedScope {
  id: string;
  kind: NativeUnresolvedScopeKind;
  source: 'baseline' | 'current' | 'implementation-scope';
  path: string | null;
  reason: string;
}

export interface NativeGitScopeAdvisory {
  advisoryOnly: true;
  changedPaths: string[];
  pathsPresentInSnapshotChanges: string[];
  pathsAbsentFromSnapshotChanges: string[];
}

export interface NativeImplementationScope {
  schema: typeof NATIVE_IMPLEMENTATION_SCOPE_SCHEMA;
  contractHash: string;
  baselineProjectionRef: NativeSnapshotProjectionRef;
  baselineProjectionHash: string;
  currentProjectionRef: NativeSnapshotProjectionRef;
  currentProjectionHash: string;
  complete: boolean;
  declaredArtifacts: NativeDeclaredArtifact[];
  changes: NativeImplementationChange[];
  unattributed: NativeImplementationChange[];
  unresolvedScopes: NativeUnresolvedScope[];
  noCodeReason: string | null;
  gitAdvisory?: NativeGitScopeAdvisory;
  scopeHash: string;
}

export interface BuildNativeImplementationScopeInput {
  baseline: NativeContentSnapshotManifest;
  current: NativeContentSnapshotManifest;
  contractHash: string;
  declaredArtifacts: readonly NativeDeclaredArtifact[];
  noCodeReason?: string | null;
  gitChangedPaths?: readonly string[];
}

export interface NativeSnapshotProjection {
  schema: typeof NATIVE_SNAPSHOT_PROJECTION_SCHEMA;
  origin: NativeContentSnapshotManifest['origin'];
  capture?: NativeContentSnapshotManifest['capture'];
  complete: boolean;
  limits: NativeContentSnapshotManifest['limits'];
  entries: NativeSnapshotEntry[];
  omitted: NativeSnapshotOmission[];
  omittedCount: number;
  omissionOverflow?: NativeContentSnapshotManifest['omissionOverflow'];
}

export interface NativeImplementationScopeAuthority {
  contractHash: string;
  declaredArtifacts: NativeDeclaredArtifact[];
  noCodeReason: string | null;
  gitChangedPaths?: string[];
}

/**
 * In-memory authority bundle produced from bounded snapshot manifests.
 *
 * Storage accepts this bundle rather than a standalone scope so it can rebuild every derived
 * scope field before persisting it.
 */
export interface NativeImplementationScopeBundle {
  authority: NativeImplementationScopeAuthority;
  baseline: NativeSnapshotProjection;
  current: NativeSnapshotProjection;
  scope: NativeImplementationScope;
}

interface UnresolvedScopeIdentity {
  kind: NativeUnresolvedScopeKind;
  source: NativeUnresolvedScope['source'];
  path: string | null;
  evidence: Record<string, unknown>;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function nativeSnapshotProjectionRef(hash: string): NativeSnapshotProjectionRef {
  if (!SHA256_HASH_PATTERN.test(hash)) {
    throw new Error('Native snapshot projection hash must be a SHA-256 hash');
  }
  return `runtime/evidence/snapshots/${hash}.json`;
}

function compareNullableText(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return compareText(left, right);
}

function projectRelativePath(value: string, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.endsWith('/') ||
    /^[a-zA-Z]:/u.test(value)
  ) {
    throw new Error(`${label} must be a normalized project-relative path`);
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(`${label} must stay inside the project root`);
  }
  return value;
}

function snapshotOmissionPath(value: string, label: string): string {
  return value === '.' ? value : projectRelativePath(value, label);
}

function nonNegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function normalizeEntry(entry: NativeSnapshotEntry, label: string): NativeSnapshotEntry {
  if (entry.type !== 'file') throw new Error(`${label} must describe a file`);
  if (typeof entry.hash !== 'string' || entry.hash.length === 0) {
    throw new Error(`${label} hash must be non-empty`);
  }
  return {
    path: projectRelativePath(entry.path, `${label} path`),
    hash: entry.hash,
    size: nonNegativeSafeInteger(entry.size, `${label} size`),
    type: 'file',
  };
}

function normalizeOmission(
  omission: NativeSnapshotOmission,
  label: string,
): NativeSnapshotOmission {
  return {
    path: snapshotOmissionPath(omission.path, `${label} path`),
    size: omission.size === null ? null : nonNegativeSafeInteger(omission.size, `${label} size`),
    type: omission.type,
    reason: omission.reason,
  };
}

function compareEntries(left: NativeSnapshotEntry, right: NativeSnapshotEntry): number {
  return (
    compareText(left.path, right.path) ||
    compareText(left.hash, right.hash) ||
    left.size - right.size
  );
}

function compareOmissions(left: NativeSnapshotOmission, right: NativeSnapshotOmission): number {
  return (
    compareText(left.path, right.path) ||
    compareText(left.reason, right.reason) ||
    compareText(left.type, right.type) ||
    (left.size ?? -1) - (right.size ?? -1)
  );
}

function serializedEvidenceBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function updateFramedHash(hash: Hash, kind: string, value: unknown): void {
  const encoded = `${kind}\n${canonicalJson(value)}`;
  hash.update(`${Buffer.byteLength(encoded, 'utf8')}:`);
  hash.update(encoded);
}

/**
 * Snapshot manifests have their own byte limit, but their timestamp-free evidence projection has
 * slightly different metadata. Compact it before returning the bundle so persistence can never be
 * the first place that discovers a one-megabyte projection overflow.
 */
function fitSnapshotProjectionBudget(value: NativeSnapshotProjection): NativeSnapshotProjection {
  if (serializedEvidenceBytes(value) <= MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES) {
    return value;
  }

  const entries = [...value.entries];
  const omitted = [...value.omitted];
  let omittedCount = value.omittedCount;
  let overflowCount = value.omissionOverflow?.count ?? 0;
  const overflowHash = createHash('sha256');
  overflowHash.update(`${SNAPSHOT_PROJECTION_OVERFLOW_HASH_TAG}\n`);
  if (value.omissionOverflow) {
    updateFramedHash(overflowHash, 'existing-overflow', value.omissionOverflow);
  }

  const foldOmission = (omission: NativeSnapshotOmission, alreadyCounted: boolean): void => {
    if (!alreadyCounted) omittedCount += 1;
    overflowCount += 1;
    updateFramedHash(overflowHash, 'omission', omission);
  };
  const foldEntry = (entry: NativeSnapshotEntry): void => {
    omittedCount += 1;
    overflowCount += 1;
    // The projection overflow is part of snapshot freshness. Bind the full entry, including its
    // content hash, rather than reducing it to omission-style path/size metadata.
    updateFramedHash(overflowHash, 'entry', entry);
  };
  const takeCompactableOmission = (): NativeSnapshotOmission | null => {
    for (let index = omitted.length - 1; index >= 0; index -= 1) {
      const omission = omitted[index]!;
      if (
        omission.reason === 'git-enumeration-limit' ||
        omission.reason === 'git-selection-changed' ||
        omission.reason === 'physical-enumeration-limit' ||
        omission.reason === 'physical-selection-changed'
      ) {
        continue;
      }
      omitted.splice(index, 1);
      return omission;
    }
    return null;
  };
  const candidate = (): NativeSnapshotProjection => ({
    ...value,
    complete: omittedCount === 0,
    entries,
    omitted,
    omittedCount,
    omissionOverflow: {
      ref: `native-snapshot://omitted-overflow/${'0'.repeat(64)}`,
      hash: '0'.repeat(64),
      count: overflowCount,
    },
  });

  let projection = candidate();
  while (serializedEvidenceBytes(projection) > MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES) {
    const compactableOmissionCount = omitted.filter(
      (omission) =>
        omission.reason !== 'git-enumeration-limit' &&
        omission.reason !== 'git-selection-changed' &&
        omission.reason !== 'physical-enumeration-limit' &&
        omission.reason !== 'physical-selection-changed',
    ).length;
    if (compactableOmissionCount > 0) {
      const removeCount = Math.max(1, Math.ceil(omitted.length / 4));
      for (let removed = 0; removed < removeCount; removed += 1) {
        const omission = takeCompactableOmission();
        if (omission === null) break;
        foldOmission(omission, true);
      }
    } else if (entries.length > 0) {
      const removeCount = Math.max(1, Math.ceil(entries.length / 4));
      for (const entry of entries.splice(-removeCount)) {
        foldEntry(entry);
      }
    } else {
      throw new Error('Native snapshot projection metadata exceeds its evidence byte budget');
    }
    projection = candidate();
  }

  const digest = overflowHash.digest('hex');
  return {
    ...projection,
    omissionOverflow: {
      ref: `native-snapshot://omitted-overflow/${digest}`,
      hash: digest,
      count: overflowCount,
    },
  };
}

function snapshotProjection(manifest: NativeContentSnapshotManifest): NativeSnapshotProjection {
  const parsed = parseNativeContentSnapshotManifest(manifest);
  const entries = parsed.entries.map((entry, index) =>
    normalizeEntry(entry, `Snapshot entry ${index}`),
  );
  entries.sort(compareEntries);
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) {
    throw new Error('Snapshot entries must not contain duplicate paths');
  }

  const omitted = parsed.omitted.map((omission, index) =>
    normalizeOmission(omission, `Snapshot omission ${index}`),
  );
  omitted.sort(compareOmissions);

  return fitSnapshotProjectionBudget({
    schema: NATIVE_SNAPSHOT_PROJECTION_SCHEMA,
    origin: parsed.origin,
    ...(parsed.capture ? { capture: parsed.capture } : {}),
    complete: parsed.complete,
    limits: {
      maxFiles: parsed.limits.maxFiles,
      maxFileBytes: parsed.limits.maxFileBytes,
      maxTotalBytes: parsed.limits.maxTotalBytes,
      maxManifestBytes: parsed.limits.maxManifestBytes,
    },
    entries,
    omitted,
    omittedCount: parsed.omittedCount,
    ...(parsed.omissionOverflow
      ? {
          omissionOverflow: {
            ref: parsed.omissionOverflow.ref,
            hash: parsed.omissionOverflow.hash,
            count: parsed.omissionOverflow.count,
          },
        }
      : {}),
  });
}

function normalizeDeclaredArtifacts(
  artifacts: readonly NativeDeclaredArtifact[],
): NativeDeclaredArtifact[] {
  const byPath = new Map<string, NativeDeclaredArtifact>();
  for (const [index, artifact] of artifacts.entries()) {
    if (artifact.kind !== 'file' && artifact.kind !== 'directory') {
      throw new Error(`Declared artifact ${index} kind is invalid`);
    }
    const normalized: NativeDeclaredArtifact = {
      path: projectRelativePath(artifact.path, `Declared artifact ${index} path`),
      kind: artifact.kind,
    };
    const existing = byPath.get(normalized.path);
    if (existing && existing.kind !== normalized.kind) {
      throw new Error(`Declared artifact path has conflicting kinds: ${normalized.path}`);
    }
    byPath.set(normalized.path, normalized);
  }
  return [...byPath.values()].sort(
    (left, right) => compareText(left.path, right.path) || compareText(left.kind, right.kind),
  );
}

function artifactOwnsPath(artifact: NativeDeclaredArtifact, changedPath: string): boolean {
  if (artifact.kind === 'file') return artifact.path === changedPath;
  return changedPath === artifact.path || changedPath.startsWith(`${artifact.path}/`);
}

function fileIdentity(
  entry: NativeSnapshotEntry | undefined,
): NativeImplementationFileIdentity | null {
  return entry ? { hash: entry.hash, size: entry.size } : null;
}

interface NativeImplementationChangeCore {
  path: string;
  kind: NativeImplementationChange['kind'];
  before: NativeImplementationFileIdentity | null;
  after: NativeImplementationFileIdentity | null;
}

function visitDerivedChanges(
  baseline: NativeSnapshotProjection,
  current: NativeSnapshotProjection,
  visitor: (change: NativeImplementationChangeCore) => void,
): void {
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < baseline.entries.length || afterIndex < current.entries.length) {
    const beforeCandidate = baseline.entries[beforeIndex];
    const afterCandidate = current.entries[afterIndex];
    const order =
      beforeCandidate === undefined
        ? 1
        : afterCandidate === undefined
          ? -1
          : compareText(beforeCandidate.path, afterCandidate.path);
    const before = order <= 0 ? beforeCandidate : undefined;
    const after = order >= 0 ? afterCandidate : undefined;
    if (order <= 0) beforeIndex += 1;
    if (order >= 0) afterIndex += 1;
    if (before && after && before.hash === after.hash && before.size === after.size) continue;
    if (before && !after && !current.complete) continue;
    const changedPath = before?.path ?? after?.path;
    if (changedPath === undefined) continue;
    visitor({
      path: changedPath,
      kind: before ? (after ? 'modified' : 'removed') : 'added',
      before: fileIdentity(before),
      after: fileIdentity(after),
    });
  }
}

function materializeChange(
  core: NativeImplementationChangeCore,
  declaredArtifacts: NativeDeclaredArtifact[],
): NativeImplementationChange {
  return {
    ...core,
    attributedTo: declaredArtifacts.filter((artifact) => artifactOwnsPath(artifact, core.path)),
  };
}

function unresolvedScope(identity: UnresolvedScopeIdentity, reason: string): NativeUnresolvedScope {
  return {
    id: `scope:${canonicalHash(UNRESOLVED_SCOPE_ID_TAG, identity)}`,
    kind: identity.kind,
    source: identity.source,
    path: identity.path,
    reason,
  };
}

function omissionScopes(
  source: 'baseline' | 'current',
  projection: NativeSnapshotProjection,
): NativeUnresolvedScope[] {
  const scopes = projection.omitted.map((omission) =>
    unresolvedScope(
      {
        kind: 'snapshot-omission',
        source,
        path: omission.path,
        evidence: {
          reason: omission.reason,
          size: omission.size,
          type: omission.type,
        },
      },
      `${source} snapshot omitted ${omission.path}: ${omission.reason}`,
    ),
  );
  if (!projection.complete) {
    scopes.push(
      unresolvedScope(
        {
          kind: 'snapshot-incomplete',
          source,
          path: null,
          evidence: { omittedCount: projection.omittedCount },
        },
        `${source} snapshot is incomplete`,
      ),
    );
  }
  if (projection.omissionOverflow) {
    scopes.push(
      unresolvedScope(
        {
          kind: 'snapshot-omission-overflow',
          source,
          path: null,
          evidence: {
            count: projection.omissionOverflow.count,
            hash: projection.omissionOverflow.hash,
            ref: projection.omissionOverflow.ref,
          },
        },
        `${source} snapshot has ${projection.omissionOverflow.count} unlisted omissions`,
      ),
    );
  }
  return scopes;
}

function omissionSummaryScopes(
  source: 'baseline' | 'current',
  projection: NativeSnapshotProjection,
): NativeUnresolvedScope[] {
  return omissionScopes(source, { ...projection, omitted: [] }).filter(
    (scope) => scope.kind !== 'snapshot-omission',
  );
}

function compareUnresolvedScopes(
  left: NativeUnresolvedScope,
  right: NativeUnresolvedScope,
): number {
  return (
    compareText(left.kind, right.kind) ||
    compareText(left.source, right.source) ||
    compareNullableText(left.path, right.path) ||
    compareText(left.id, right.id)
  );
}

function uniqueUnresolvedScopes(scopes: NativeUnresolvedScope[]): NativeUnresolvedScope[] {
  const byId = new Map(scopes.map((scope) => [scope.id, scope]));
  return [...byId.values()].sort(compareUnresolvedScopes);
}

function normalizeGitChangedPaths(paths: readonly string[]): string[] {
  return [
    ...new Set(paths.map((value, index) => projectRelativePath(value, `Git path ${index}`))),
  ].sort(compareText);
}

function normalizeScopeAuthority(
  input: Pick<
    BuildNativeImplementationScopeInput,
    'contractHash' | 'declaredArtifacts' | 'noCodeReason' | 'gitChangedPaths'
  >,
): NativeImplementationScopeAuthority {
  if (typeof input.contractHash !== 'string' || !SHA256_HASH_PATTERN.test(input.contractHash)) {
    throw new Error('Contract hash must be a SHA-256 hash');
  }
  return {
    contractHash: input.contractHash,
    declaredArtifacts: normalizeDeclaredArtifacts(input.declaredArtifacts),
    noCodeReason: input.noCodeReason?.trim() || null,
    ...(input.gitChangedPaths === undefined
      ? {}
      : { gitChangedPaths: normalizeGitChangedPaths(input.gitChangedPaths) }),
  };
}

interface NativeScopeChangeScan {
  candidates: NativeImplementationChange[];
  gitPathsPresentInChanges: string[];
  totalChanges: number;
  totalUnattributed: number;
}

function scanScopeChanges(
  baseline: NativeSnapshotProjection,
  current: NativeSnapshotProjection,
  declaredArtifacts: NativeDeclaredArtifact[],
  gitChangedPaths?: string[],
): NativeScopeChangeScan {
  const candidates: NativeImplementationChange[] = [];
  const gitChangedPathSet = gitChangedPaths === undefined ? null : new Set(gitChangedPaths);
  const gitPathsPresentInChanges: string[] = [];
  let candidateBytes = 0;
  let candidateBudgetExhausted = false;
  let totalChanges = 0;
  let totalUnattributed = 0;
  visitDerivedChanges(baseline, current, (core) => {
    const attributed = declaredArtifacts.some((artifact) => artifactOwnsPath(artifact, core.path));
    totalChanges += 1;
    if (!attributed) totalUnattributed += 1;
    if (gitChangedPathSet?.has(core.path)) gitPathsPresentInChanges.push(core.path);
    if (!candidateBudgetExhausted && candidates.length < MAX_NATIVE_DETAILED_SCOPE_CHANGES) {
      const candidate = materializeChange(core, declaredArtifacts);
      const nextBytes = serializedEvidenceBytes(candidate);
      if (candidateBytes + nextBytes <= MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES) {
        candidates.push(candidate);
        candidateBytes += nextBytes;
      } else {
        candidateBudgetExhausted = true;
      }
    }
  });
  return { candidates, gitPathsPresentInChanges, totalChanges, totalUnattributed };
}

function scopeDetailOverflow(
  hash: string,
  counts: { changes: number; unattributed: number; unresolved: number },
): NativeUnresolvedScope {
  return unresolvedScope(
    {
      kind: 'scope-detail-overflow',
      source: 'implementation-scope',
      path: null,
      evidence: {
        changeCount: counts.changes,
        hash,
        unattributedCount: counts.unattributed,
        unresolvedCount: counts.unresolved,
      },
    },
    `Implementation scope summarized ${counts.changes} additional change details and ${counts.unresolved} unresolved details (${counts.unattributed} unattributed); overflow hash ${hash}`,
  );
}

function parseScopeDetailOverflow(scope: NativeUnresolvedScope): {
  changes: number;
  hash: string;
  unattributed: number;
  unresolved: number;
} {
  const match =
    /^Implementation scope summarized ([0-9]+) additional change details and ([0-9]+) unresolved details \(([0-9]+) unattributed\); overflow hash ([a-f0-9]{64})$/u.exec(
      scope.reason,
    );
  if (!match) throw new Error('Implementation scope detail overflow is invalid');
  const counts = {
    changes: nonNegativeSafeInteger(Number(match[1]), 'Scope overflow change count'),
    unresolved: nonNegativeSafeInteger(Number(match[2]), 'Scope overflow unresolved count'),
    unattributed: nonNegativeSafeInteger(Number(match[3]), 'Scope overflow unattributed count'),
  };
  const hash = scopeHashValue(match[4], 'Scope detail overflow hash');
  if (JSON.stringify(scope) !== JSON.stringify(scopeDetailOverflow(hash, counts))) {
    throw new Error('Implementation scope detail overflow is inconsistent');
  }
  return { ...counts, hash };
}

function hashScopeDetailOverflow(options: {
  baseline: NativeSnapshotProjection;
  current: NativeSnapshotProjection;
  declaredArtifacts: NativeDeclaredArtifact[];
  detailedChangeCount: number;
  detailedOmissionCount: number;
}): string {
  const hash = createHash('sha256');
  hash.update(`${SCOPE_DETAIL_OVERFLOW_HASH_TAG}\n`);
  let changeIndex = 0;
  visitDerivedChanges(options.baseline, options.current, (core) => {
    if (changeIndex >= options.detailedChangeCount) {
      updateFramedHash(hash, 'change', core);
      let attributionCount = 0;
      for (const artifact of options.declaredArtifacts) {
        if (!artifactOwnsPath(artifact, core.path)) continue;
        attributionCount += 1;
        updateFramedHash(hash, 'change-attribution', artifact);
      }
      updateFramedHash(hash, 'change-end', { attributionCount });
      if (attributionCount === 0) {
        updateFramedHash(hash, 'unattributed-change', {
          after: core.after,
          before: core.before,
          changeKind: core.kind,
          path: core.path,
        });
      }
    }
    changeIndex += 1;
  });

  let omissionIndex = 0;
  for (const [source, projection] of [
    ['baseline', options.baseline],
    ['current', options.current],
  ] as const) {
    for (const omission of projection.omitted) {
      if (omissionIndex >= options.detailedOmissionCount) {
        updateFramedHash(hash, 'snapshot-omission', { source, ...omission });
      }
      omissionIndex += 1;
    }
  }
  return hash.digest('hex');
}

function buildScopeFromProjections(
  baseline: NativeSnapshotProjection,
  current: NativeSnapshotProjection,
  authority: NativeImplementationScopeAuthority,
): NativeImplementationScope {
  const { contractHash, declaredArtifacts, noCodeReason } = authority;
  const changeScan = scanScopeChanges(
    baseline,
    current,
    declaredArtifacts,
    authority.gitChangedPaths,
  );
  const baselineProjectionHash = canonicalHash(SNAPSHOT_PROJECTION_HASH_TAG, baseline);
  const currentProjectionHash = canonicalHash(SNAPSHOT_PROJECTION_HASH_TAG, current);
  const omissionCandidates: NativeUnresolvedScope[] = [];
  for (const [source, projection] of [
    ['baseline', baseline],
    ['current', current],
  ] as const) {
    for (const omission of projection.omitted) {
      if (omissionCandidates.length >= MAX_NATIVE_DETAILED_UNRESOLVED_SCOPES) break;
      omissionCandidates.push(
        unresolvedScope(
          {
            kind: 'snapshot-omission',
            source,
            path: omission.path,
            evidence: {
              reason: omission.reason,
              size: omission.size,
              type: omission.type,
            },
          },
          `${source} snapshot omitted ${omission.path}: ${omission.reason}`,
        ),
      );
    }
  }
  const totalOmissionDetails = baseline.omitted.length + current.omitted.length;
  const essentialScopes = [
    ...omissionSummaryScopes('baseline', baseline),
    ...omissionSummaryScopes('current', current),
    ...(changeScan.totalChanges === 0 && noCodeReason === null
      ? [
          unresolvedScope(
            {
              kind: 'missing-no-code-reason',
              source: 'implementation-scope',
              path: null,
              evidence: {
                baselineProjectionHash,
                currentProjectionHash,
              },
            },
            'A non-empty no-code reason is required when the snapshots contain no changes',
          ),
        ]
      : []),
  ];

  const buildGitAdvisory = (): NativeGitScopeAdvisory | undefined => {
    if (authority.gitChangedPaths === undefined) return undefined;
    const snapshotChangePaths = new Set(changeScan.gitPathsPresentInChanges);
    return {
      advisoryOnly: true,
      changedPaths: authority.gitChangedPaths,
      pathsPresentInSnapshotChanges: authority.gitChangedPaths.filter((value) =>
        snapshotChangePaths.has(value),
      ),
      pathsAbsentFromSnapshotChanges: authority.gitChangedPaths.filter(
        (value) => !snapshotChangePaths.has(value),
      ),
    };
  };

  const buildScopeContent = (options: {
    detailedChangeCount: number;
    detailedOmissionCount: number;
    includeGitAdvisory: boolean;
    overflowHash: string;
  }) => {
    const changes = changeScan.candidates.slice(0, options.detailedChangeCount);
    const unattributed = changes.filter((change) => change.attributedTo.length === 0);
    const overflowChanges = changeScan.totalChanges - changes.length;
    const overflowUnattributed = changeScan.totalUnattributed - unattributed.length;
    const overflowOmissions = totalOmissionDetails - options.detailedOmissionCount;
    const overflowUnresolved = overflowUnattributed + overflowOmissions;
    const unresolved = [
      ...unattributed.map((change) =>
        unresolvedScope(
          {
            kind: 'unattributed-change',
            source: 'implementation-scope',
            path: change.path,
            evidence: {
              after: change.after,
              before: change.before,
              changeKind: change.kind,
            },
          },
          `Changed path is not covered by a declared artifact: ${change.path}`,
        ),
      ),
      ...omissionCandidates.slice(0, options.detailedOmissionCount),
      ...essentialScopes,
      ...(overflowChanges > 0 || overflowUnresolved > 0
        ? [
            scopeDetailOverflow(options.overflowHash, {
              changes: overflowChanges,
              unattributed: overflowUnattributed,
              unresolved: overflowUnresolved,
            }),
          ]
        : []),
    ];
    const unresolvedScopes = uniqueUnresolvedScopes(unresolved);
    const gitAdvisory = options.includeGitAdvisory ? buildGitAdvisory() : undefined;
    return {
      schema: NATIVE_IMPLEMENTATION_SCOPE_SCHEMA,
      contractHash,
      baselineProjectionRef: nativeSnapshotProjectionRef(baselineProjectionHash),
      baselineProjectionHash,
      currentProjectionRef: nativeSnapshotProjectionRef(currentProjectionHash),
      currentProjectionHash,
      complete: unresolvedScopes.length === 0,
      declaredArtifacts,
      changes,
      unattributed,
      unresolvedScopes,
      noCodeReason,
      ...(gitAdvisory ? { gitAdvisory } : {}),
    };
  };

  let detailedChangeCount = changeScan.candidates.length;
  let detailedOmissionCount = omissionCandidates.length;
  let includeGitAdvisory = authority.gitChangedPaths !== undefined;
  const placeholderHash = '0'.repeat(64);
  while (true) {
    const candidate = buildScopeContent({
      detailedChangeCount,
      detailedOmissionCount,
      includeGitAdvisory,
      overflowHash: placeholderHash,
    });
    if (
      serializedEvidenceBytes({ ...candidate, scopeHash: placeholderHash }) <=
      MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES
    ) {
      break;
    }
    if (includeGitAdvisory) {
      includeGitAdvisory = false;
      continue;
    }
    if (detailedOmissionCount > 0) {
      detailedOmissionCount -= Math.max(1, Math.ceil(detailedOmissionCount / 4));
      continue;
    }
    if (detailedChangeCount > 0) {
      const removable = detailedChangeCount;
      detailedChangeCount -= Math.max(1, Math.ceil(removable / 4));
      continue;
    }
    throw new Error('Native implementation scope metadata exceeds its evidence byte budget');
  }

  const hasOverflow =
    changeScan.totalChanges > detailedChangeCount || totalOmissionDetails > detailedOmissionCount;
  const overflowHash = hasOverflow
    ? hashScopeDetailOverflow({
        baseline,
        current,
        declaredArtifacts,
        detailedChangeCount,
        detailedOmissionCount,
      })
    : placeholderHash;
  const scopeContent = buildScopeContent({
    detailedChangeCount,
    detailedOmissionCount,
    includeGitAdvisory,
    overflowHash,
  });
  const scope = {
    ...scopeContent,
    scopeHash: canonicalHash(IMPLEMENTATION_SCOPE_HASH_TAG, scopeContent),
  };
  if (serializedEvidenceBytes(scope) > MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES) {
    throw new Error('Native implementation scope exceeded its evidence byte budget after fitting');
  }
  return scope;
}

/**
 * Build the authority bundle consumed by Native evidence storage.
 * Snapshot timestamps are parsed but deliberately excluded from the normalized projections.
 */
export function buildNativeImplementationScopeBundle(
  input: BuildNativeImplementationScopeInput,
): NativeImplementationScopeBundle {
  const baseline = snapshotProjection(input.baseline);
  const current = snapshotProjection(input.current);
  const authority = normalizeScopeAuthority(input);
  return {
    authority,
    baseline,
    current,
    scope: buildScopeFromProjections(baseline, current, authority),
  };
}

/** Derive the implementation scope while preserving the existing pure-call interface. */
export function buildNativeImplementationScope(
  input: BuildNativeImplementationScopeInput,
): NativeImplementationScope {
  return buildNativeImplementationScopeBundle(input).scope;
}

const SCOPE_KEYS = new Set([
  'schema',
  'contractHash',
  'baselineProjectionRef',
  'baselineProjectionHash',
  'currentProjectionRef',
  'currentProjectionHash',
  'complete',
  'declaredArtifacts',
  'changes',
  'unattributed',
  'unresolvedScopes',
  'noCodeReason',
  'gitAdvisory',
  'scopeHash',
]);

function scopeRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactScopeKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !(key in value));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}`);
  if (missing.length > 0) throw new Error(`${label} is missing field(s): ${missing.join(', ')}`);
}

function scopeHashValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_HASH_PATTERN.test(value)) {
    throw new Error(`${label} must be a SHA-256 hash`);
  }
  return value;
}

function snapshotProjectionRefValue(
  value: unknown,
  hash: string,
  label: string,
): NativeSnapshotProjectionRef {
  const expected = nativeSnapshotProjectionRef(hash);
  if (value !== expected) throw new Error(`${label} ref/hash mismatch`);
  return expected;
}

/** Parse the timestamp-free, content-addressed projection persisted beside a scope. */
export function parseNativeSnapshotProjection(
  value: unknown,
  expectedHash?: string,
): NativeSnapshotProjection {
  const root = scopeRecord(value, 'Native snapshot projection');
  exactScopeKeys(
    root,
    ['schema', 'origin', 'complete', 'limits', 'entries', 'omitted', 'omittedCount'],
    ['capture', 'omissionOverflow'],
    'Native snapshot projection',
  );
  if (root.schema !== NATIVE_SNAPSHOT_PROJECTION_SCHEMA) {
    throw new Error('Native snapshot projection schema is invalid');
  }
  const parsedManifest = parseNativeContentSnapshotManifest({
    schema: 'comet.native.content-snapshot.v1',
    origin: root.origin,
    ...(root.capture === undefined ? {} : { capture: root.capture }),
    createdAt: '1970-01-01T00:00:00.000Z',
    complete: root.complete,
    limits: root.limits,
    entries: root.entries,
    omitted: root.omitted,
    omittedCount: root.omittedCount,
    ...(root.omissionOverflow === undefined ? {} : { omissionOverflow: root.omissionOverflow }),
  });
  const projection = snapshotProjection(parsedManifest);
  if (
    canonicalHash(SNAPSHOT_PROJECTION_HASH_TAG, root) !==
    canonicalHash(SNAPSHOT_PROJECTION_HASH_TAG, projection)
  ) {
    throw new Error('Native snapshot projection is not canonical');
  }
  const projectionHash = canonicalHash(SNAPSHOT_PROJECTION_HASH_TAG, projection);
  if (
    expectedHash !== undefined &&
    scopeHashValue(expectedHash, 'Snapshot projection hash') !== projectionHash
  ) {
    throw new Error('Native snapshot projection content hash mismatch');
  }
  return projection;
}

function parseDeclaredArtifact(value: unknown, index: number): NativeDeclaredArtifact {
  const artifact = scopeRecord(value, `Declared artifact ${index}`);
  exactScopeKeys(artifact, ['path', 'kind'], [], `Declared artifact ${index}`);
  if (artifact.kind !== 'file' && artifact.kind !== 'directory') {
    throw new Error(`Declared artifact ${index} kind is invalid`);
  }
  return {
    path: projectRelativePath(artifact.path as string, `Declared artifact ${index} path`),
    kind: artifact.kind,
  };
}

function parseFileIdentity(value: unknown, label: string): NativeImplementationFileIdentity | null {
  if (value === null) return null;
  const identity = scopeRecord(value, label);
  exactScopeKeys(identity, ['hash', 'size'], [], label);
  return {
    hash: scopeHashValue(identity.hash, `${label} hash`),
    size: nonNegativeSafeInteger(identity.size as number, `${label} size`),
  };
}

function parseImplementationChange(value: unknown, index: number): NativeImplementationChange {
  const change = scopeRecord(value, `Implementation change ${index}`);
  exactScopeKeys(
    change,
    ['path', 'kind', 'before', 'after', 'attributedTo'],
    [],
    `Implementation change ${index}`,
  );
  if (change.kind !== 'added' && change.kind !== 'modified' && change.kind !== 'removed') {
    throw new Error(`Implementation change ${index} kind is invalid`);
  }
  if (!Array.isArray(change.attributedTo)) {
    throw new Error(`Implementation change ${index} attributedTo must be an array`);
  }
  const attributedTo = change.attributedTo.map(parseDeclaredArtifact);
  const normalizedAttribution = normalizeDeclaredArtifacts(attributedTo);
  if (JSON.stringify(attributedTo) !== JSON.stringify(normalizedAttribution)) {
    throw new Error(`Implementation change ${index} attribution must be sorted and unique`);
  }
  const before = parseFileIdentity(change.before, `Implementation change ${index} before`);
  const after = parseFileIdentity(change.after, `Implementation change ${index} after`);
  if (
    (change.kind === 'added' && (before !== null || after === null)) ||
    (change.kind === 'removed' && (before === null || after !== null)) ||
    (change.kind === 'modified' &&
      (before === null || after === null || JSON.stringify(before) === JSON.stringify(after)))
  ) {
    throw new Error(`Implementation change ${index} before/after state is invalid`);
  }
  return {
    path: projectRelativePath(change.path as string, `Implementation change ${index} path`),
    kind: change.kind,
    before,
    after,
    attributedTo,
  };
}

function parseUnresolvedScope(value: unknown, index: number): NativeUnresolvedScope {
  const scope = scopeRecord(value, `Unresolved scope ${index}`);
  exactScopeKeys(
    scope,
    ['id', 'kind', 'source', 'path', 'reason'],
    [],
    `Unresolved scope ${index}`,
  );
  const kinds = new Set<NativeUnresolvedScopeKind>([
    'unattributed-change',
    'snapshot-omission',
    'snapshot-incomplete',
    'snapshot-omission-overflow',
    'scope-detail-overflow',
    'missing-no-code-reason',
  ]);
  if (typeof scope.kind !== 'string' || !kinds.has(scope.kind as NativeUnresolvedScopeKind)) {
    throw new Error(`Unresolved scope ${index} kind is invalid`);
  }
  if (
    scope.source !== 'baseline' &&
    scope.source !== 'current' &&
    scope.source !== 'implementation-scope'
  ) {
    throw new Error(`Unresolved scope ${index} source is invalid`);
  }
  if (typeof scope.id !== 'string' || !/^scope:[a-f0-9]{64}$/u.test(scope.id)) {
    throw new Error(`Unresolved scope ${index} id is invalid`);
  }
  if (scope.path !== null && typeof scope.path !== 'string') {
    throw new Error(`Unresolved scope ${index} path is invalid`);
  }
  if (
    typeof scope.reason !== 'string' ||
    scope.reason.length === 0 ||
    scope.reason.trim() !== scope.reason
  ) {
    throw new Error(`Unresolved scope ${index} reason is invalid`);
  }
  return {
    id: scope.id,
    kind: scope.kind as NativeUnresolvedScopeKind,
    source: scope.source,
    path:
      scope.path === null
        ? null
        : scope.kind === 'snapshot-omission'
          ? snapshotOmissionPath(scope.path, `Unresolved scope ${index} path`)
          : projectRelativePath(scope.path, `Unresolved scope ${index} path`),
    reason: scope.reason,
  };
}

function parseSortedPaths(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be an array of paths`);
  }
  const paths = value.map((entry, index) => projectRelativePath(entry, `${label} ${index}`));
  const normalized = [...new Set(paths)].sort(compareText);
  if (JSON.stringify(paths) !== JSON.stringify(normalized)) {
    throw new Error(`${label} must be sorted and unique`);
  }
  return paths;
}

/**
 * Parse a persisted scope and re-check its self-contained invariants.
 * Storage additionally calls `rebuildNativeImplementationScopeBundle` so snapshot-derived facts
 * are verified against the two projections instead of trusted from this document.
 */
export function parseNativeImplementationScope(value: unknown): NativeImplementationScope {
  const root = scopeRecord(value, 'Native implementation scope');
  const required = [...SCOPE_KEYS].filter((key) => key !== 'gitAdvisory');
  exactScopeKeys(root, required, ['gitAdvisory'], 'Native implementation scope');
  if (root.schema !== NATIVE_IMPLEMENTATION_SCOPE_SCHEMA) {
    throw new Error('Native implementation scope schema is invalid');
  }
  const contractHash = scopeHashValue(root.contractHash, 'Implementation scope contractHash');
  const baselineProjectionHash = scopeHashValue(
    root.baselineProjectionHash,
    'Implementation scope baselineProjectionHash',
  );
  const baselineProjectionRef = snapshotProjectionRefValue(
    root.baselineProjectionRef,
    baselineProjectionHash,
    'Implementation scope baseline projection',
  );
  const currentProjectionHash = scopeHashValue(
    root.currentProjectionHash,
    'Implementation scope currentProjectionHash',
  );
  const currentProjectionRef = snapshotProjectionRefValue(
    root.currentProjectionRef,
    currentProjectionHash,
    'Implementation scope current projection',
  );
  if (typeof root.complete !== 'boolean') {
    throw new Error('Implementation scope complete flag is invalid');
  }
  if (
    !Array.isArray(root.declaredArtifacts) ||
    !Array.isArray(root.changes) ||
    !Array.isArray(root.unattributed) ||
    !Array.isArray(root.unresolvedScopes)
  ) {
    throw new Error('Implementation scope collections are invalid');
  }
  const declaredArtifacts = root.declaredArtifacts.map(parseDeclaredArtifact);
  if (
    JSON.stringify(declaredArtifacts) !==
    JSON.stringify(normalizeDeclaredArtifacts(declaredArtifacts))
  ) {
    throw new Error('Implementation scope declared artifacts must be sorted and unique');
  }
  const changes = root.changes.map(parseImplementationChange);
  const sortedChanges = [...changes].sort((left, right) => compareText(left.path, right.path));
  if (
    JSON.stringify(changes) !== JSON.stringify(sortedChanges) ||
    new Set(changes.map((change) => change.path)).size !== changes.length
  ) {
    throw new Error('Implementation scope changes must be sorted and unique');
  }
  const declaredByIdentity = new Set(
    declaredArtifacts.map((artifact) => `${artifact.kind}:${artifact.path}`),
  );
  if (
    changes.some((change) =>
      change.attributedTo.some(
        (artifact) => !declaredByIdentity.has(`${artifact.kind}:${artifact.path}`),
      ),
    )
  ) {
    throw new Error('Implementation scope change references an undeclared artifact');
  }
  if (
    changes.some(
      (change) =>
        JSON.stringify(change.attributedTo) !==
        JSON.stringify(
          declaredArtifacts.filter((artifact) => artifactOwnsPath(artifact, change.path)),
        ),
    )
  ) {
    throw new Error('Implementation scope change attribution is inconsistent');
  }
  const unattributed = root.unattributed.map(parseImplementationChange);
  const expectedUnattributed = changes.filter((change) => change.attributedTo.length === 0);
  if (JSON.stringify(unattributed) !== JSON.stringify(expectedUnattributed)) {
    throw new Error('Implementation scope unattributed changes are inconsistent');
  }
  const unresolvedScopes = root.unresolvedScopes.map(parseUnresolvedScope);
  const detailOverflowScopes = unresolvedScopes.filter(
    (scope) => scope.kind === 'scope-detail-overflow',
  );
  if (detailOverflowScopes.length > 1) {
    throw new Error('Implementation scope has multiple detail overflow records');
  }
  const detailOverflow =
    detailOverflowScopes[0] === undefined
      ? null
      : parseScopeDetailOverflow(detailOverflowScopes[0]);
  if (
    detailOverflow &&
    (detailOverflow.changes + detailOverflow.unresolved === 0 ||
      detailOverflow.unattributed > detailOverflow.changes ||
      detailOverflow.unattributed > detailOverflow.unresolved)
  ) {
    throw new Error('Implementation scope detail overflow counts are inconsistent');
  }
  const noCodeReason = root.noCodeReason as string | null;
  const expectedDerivedScopes = [
    ...expectedUnattributed.map((change) =>
      unresolvedScope(
        {
          kind: 'unattributed-change',
          source: 'implementation-scope',
          path: change.path,
          evidence: {
            after: change.after,
            before: change.before,
            changeKind: change.kind,
          },
        },
        `Changed path is not covered by a declared artifact: ${change.path}`,
      ),
    ),
    ...(changes.length + (detailOverflow?.changes ?? 0) === 0 && noCodeReason === null
      ? [
          unresolvedScope(
            {
              kind: 'missing-no-code-reason',
              source: 'implementation-scope',
              path: null,
              evidence: { baselineProjectionHash, currentProjectionHash },
            },
            'A non-empty no-code reason is required when the snapshots contain no changes',
          ),
        ]
      : []),
  ];
  const actualDerivedScopes = unresolvedScopes.filter(
    (scope) => scope.kind === 'unattributed-change' || scope.kind === 'missing-no-code-reason',
  );
  if (
    JSON.stringify(unresolvedScopes) !==
      JSON.stringify([...unresolvedScopes].sort(compareUnresolvedScopes)) ||
    new Set(unresolvedScopes.map((scope) => scope.id)).size !== unresolvedScopes.length ||
    JSON.stringify(actualDerivedScopes) !==
      JSON.stringify(expectedDerivedScopes.sort(compareUnresolvedScopes)) ||
    root.complete !== (unresolvedScopes.length === 0)
  ) {
    throw new Error('Implementation scope unresolved scopes are inconsistent');
  }
  if (
    root.noCodeReason !== null &&
    (typeof root.noCodeReason !== 'string' ||
      root.noCodeReason.length === 0 ||
      root.noCodeReason.trim() !== root.noCodeReason)
  ) {
    throw new Error('Implementation scope no-code reason is invalid');
  }

  let gitAdvisory: NativeGitScopeAdvisory | undefined;
  if (root.gitAdvisory !== undefined) {
    const advisory = scopeRecord(root.gitAdvisory, 'Implementation scope Git advisory');
    exactScopeKeys(
      advisory,
      [
        'advisoryOnly',
        'changedPaths',
        'pathsPresentInSnapshotChanges',
        'pathsAbsentFromSnapshotChanges',
      ],
      [],
      'Implementation scope Git advisory',
    );
    if (advisory.advisoryOnly !== true) {
      throw new Error('Implementation scope Git advisory must remain advisory-only');
    }
    const changedPaths = parseSortedPaths(advisory.changedPaths, 'Git changed paths');
    const pathsPresentInSnapshotChanges = parseSortedPaths(
      advisory.pathsPresentInSnapshotChanges,
      'Git present paths',
    );
    const pathsAbsentFromSnapshotChanges = parseSortedPaths(
      advisory.pathsAbsentFromSnapshotChanges,
      'Git absent paths',
    );
    const partition = [...pathsPresentInSnapshotChanges, ...pathsAbsentFromSnapshotChanges].sort(
      compareText,
    );
    const detailedChangePaths = new Set(changes.map((change) => change.path));
    if (
      JSON.stringify(partition) !== JSON.stringify(changedPaths) ||
      ((detailOverflow?.changes ?? 0) === 0 &&
        pathsPresentInSnapshotChanges.some((entry) => !detailedChangePaths.has(entry))) ||
      pathsAbsentFromSnapshotChanges.some((entry) => detailedChangePaths.has(entry))
    ) {
      throw new Error('Implementation scope Git advisory partition is invalid');
    }
    gitAdvisory = {
      advisoryOnly: true,
      changedPaths,
      pathsPresentInSnapshotChanges,
      pathsAbsentFromSnapshotChanges,
    };
  }

  const content = {
    schema: NATIVE_IMPLEMENTATION_SCOPE_SCHEMA,
    contractHash,
    baselineProjectionRef,
    baselineProjectionHash,
    currentProjectionRef,
    currentProjectionHash,
    complete: root.complete,
    declaredArtifacts,
    changes,
    unattributed,
    unresolvedScopes,
    noCodeReason,
    ...(gitAdvisory ? { gitAdvisory } : {}),
  };
  const scopeHash = scopeHashValue(root.scopeHash, 'Implementation scope scopeHash');
  if (canonicalHash(IMPLEMENTATION_SCOPE_HASH_TAG, content) !== scopeHash) {
    throw new Error('Implementation scope content hash mismatch');
  }
  return { ...content, scopeHash };
}

function parseScopeAuthority(value: unknown): NativeImplementationScopeAuthority {
  const root = scopeRecord(value, 'Native implementation scope authority');
  exactScopeKeys(
    root,
    ['contractHash', 'declaredArtifacts', 'noCodeReason'],
    ['gitChangedPaths'],
    'Native implementation scope authority',
  );
  if (!Array.isArray(root.declaredArtifacts)) {
    throw new Error('Native implementation scope authority declarations must be an array');
  }
  const declaredArtifacts = root.declaredArtifacts.map(parseDeclaredArtifact);
  if (
    JSON.stringify(declaredArtifacts) !==
    JSON.stringify(normalizeDeclaredArtifacts(declaredArtifacts))
  ) {
    throw new Error('Native implementation scope authority declarations must be canonical');
  }
  if (
    root.noCodeReason !== null &&
    (typeof root.noCodeReason !== 'string' ||
      root.noCodeReason.length === 0 ||
      root.noCodeReason.trim() !== root.noCodeReason)
  ) {
    throw new Error('Native implementation scope authority no-code reason is invalid');
  }
  let gitChangedPaths: string[] | undefined;
  if (root.gitChangedPaths !== undefined) {
    gitChangedPaths = parseSortedPaths(
      root.gitChangedPaths,
      'Native implementation scope authority Git paths',
    );
  }
  const authority = normalizeScopeAuthority({
    contractHash: root.contractHash as string,
    declaredArtifacts,
    noCodeReason: root.noCodeReason as string | null,
    ...(gitChangedPaths === undefined ? {} : { gitChangedPaths }),
  });
  if (authority.contractHash !== root.contractHash) {
    throw new Error('Native implementation scope authority contract hash is not canonical');
  }
  return authority;
}

/**
 * Rebuild and verify a bundle at the storage seam. The supplied scope is never authoritative:
 * normalized projections plus the independently retained build authority must reproduce it.
 */
export function parseNativeImplementationScopeBundle(
  value: unknown,
): NativeImplementationScopeBundle {
  const root = scopeRecord(value, 'Native implementation scope bundle');
  exactScopeKeys(
    root,
    ['authority', 'baseline', 'current', 'scope'],
    [],
    'Native implementation scope bundle',
  );
  const authority = parseScopeAuthority(root.authority);
  const baseline = parseNativeSnapshotProjection(root.baseline);
  const current = parseNativeSnapshotProjection(root.current);
  const suppliedScope = parseNativeImplementationScope(root.scope);
  const rebuiltScope = buildScopeFromProjections(baseline, current, authority);
  if (JSON.stringify(suppliedScope) !== JSON.stringify(rebuiltScope)) {
    throw new Error('Native implementation scope does not match its authoritative bundle');
  }
  return { authority, baseline, current, scope: rebuiltScope };
}

/** Rebuild a persisted scope from the two content-addressed projections it names. */
export function rebuildNativeImplementationScopeBundle(input: {
  baseline: NativeSnapshotProjection;
  current: NativeSnapshotProjection;
  scope: NativeImplementationScope;
}): NativeImplementationScopeBundle {
  const suppliedScope = parseNativeImplementationScope(input.scope);
  return parseNativeImplementationScopeBundle({
    authority: {
      contractHash: suppliedScope.contractHash,
      declaredArtifacts: suppliedScope.declaredArtifacts,
      noCodeReason: suppliedScope.noCodeReason,
      ...(suppliedScope.gitAdvisory
        ? { gitChangedPaths: suppliedScope.gitAdvisory.changedPaths }
        : {}),
    },
    baseline: input.baseline,
    current: input.current,
    scope: suppliedScope,
  });
}
