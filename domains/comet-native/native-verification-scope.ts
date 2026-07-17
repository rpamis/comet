import path from 'path';

import { canonicalHash } from './native-canonical-hash.js';
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
const SHA256_HASH_PATTERN = /^[a-f0-9]{64}$/u;

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
    path: projectRelativePath(omission.path, `${label} path`),
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

  return {
    schema: NATIVE_SNAPSHOT_PROJECTION_SCHEMA,
    origin: parsed.origin,
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
  };
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

function deriveChanges(
  baseline: NativeSnapshotProjection,
  current: NativeSnapshotProjection,
  declaredArtifacts: NativeDeclaredArtifact[],
): NativeImplementationChange[] {
  const beforeByPath = new Map(baseline.entries.map((entry) => [entry.path, entry]));
  const afterByPath = new Map(current.entries.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].sort(compareText);
  const changes: NativeImplementationChange[] = [];

  for (const changedPath of paths) {
    const before = beforeByPath.get(changedPath);
    const after = afterByPath.get(changedPath);
    if (before && after && before.hash === after.hash && before.size === after.size) continue;
    changes.push({
      path: changedPath,
      kind: before ? (after ? 'modified' : 'removed') : 'added',
      before: fileIdentity(before),
      after: fileIdentity(after),
      attributedTo: declaredArtifacts.filter((artifact) => artifactOwnsPath(artifact, changedPath)),
    });
  }
  return changes;
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

function buildScopeFromProjections(
  baseline: NativeSnapshotProjection,
  current: NativeSnapshotProjection,
  authority: NativeImplementationScopeAuthority,
): NativeImplementationScope {
  const { contractHash, declaredArtifacts, noCodeReason } = authority;
  const changes = deriveChanges(baseline, current, declaredArtifacts);
  const unattributed = changes.filter((change) => change.attributedTo.length === 0);
  const baselineProjectionHash = canonicalHash(SNAPSHOT_PROJECTION_HASH_TAG, baseline);
  const currentProjectionHash = canonicalHash(SNAPSHOT_PROJECTION_HASH_TAG, current);

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
    ...omissionScopes('baseline', baseline),
    ...omissionScopes('current', current),
  ];
  if (changes.length === 0 && noCodeReason === null) {
    unresolved.push(
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
    );
  }

  const unresolvedScopes = uniqueUnresolvedScopes(unresolved);
  const gitChangedPaths = authority.gitChangedPaths;
  const snapshotChangePaths = new Set(changes.map((change) => change.path));
  const gitAdvisory =
    gitChangedPaths === undefined
      ? undefined
      : {
          advisoryOnly: true as const,
          changedPaths: gitChangedPaths,
          pathsPresentInSnapshotChanges: gitChangedPaths.filter((value) =>
            snapshotChangePaths.has(value),
          ),
          pathsAbsentFromSnapshotChanges: gitChangedPaths.filter(
            (value) => !snapshotChangePaths.has(value),
          ),
        };

  const scopeContent = {
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
  return {
    ...scopeContent,
    scopeHash: canonicalHash(IMPLEMENTATION_SCOPE_HASH_TAG, scopeContent),
  };
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
    ['omissionOverflow'],
    'Native snapshot projection',
  );
  if (root.schema !== NATIVE_SNAPSHOT_PROJECTION_SCHEMA) {
    throw new Error('Native snapshot projection schema is invalid');
  }
  const parsedManifest = parseNativeContentSnapshotManifest({
    schema: 'comet.native.content-snapshot.v1',
    origin: root.origin,
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
    ...(changes.length === 0 && noCodeReason === null
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
    if (
      JSON.stringify(partition) !== JSON.stringify(changedPaths) ||
      pathsPresentInSnapshotChanges.some(
        (entry) => !changes.some((change) => change.path === entry),
      ) ||
      pathsAbsentFromSnapshotChanges.some((entry) =>
        changes.some((change) => change.path === entry),
      )
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
