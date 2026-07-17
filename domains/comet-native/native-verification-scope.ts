import path from 'path';

import { canonicalHash } from './native-canonical-hash.js';
import type {
  NativeContentSnapshotManifest,
  NativeSnapshotEntry,
  NativeSnapshotOmission,
} from './native-types.js';

export const NATIVE_IMPLEMENTATION_SCOPE_SCHEMA = 'comet.native.implementation-scope.v1' as const;

const SNAPSHOT_PROJECTION_HASH_TAG = 'comet.native.content-snapshot-projection.v1';
const IMPLEMENTATION_SCOPE_HASH_TAG = 'comet.native.implementation-scope.v1';
const UNRESOLVED_SCOPE_ID_TAG = 'comet.native.unresolved-scope-id.v1';

export interface NativeDeclaredArtifact {
  path: string;
  kind: 'file' | 'directory';
}

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
  baselineProjectionHash: string;
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

interface SnapshotProjection {
  schema: NativeContentSnapshotManifest['schema'];
  origin: NativeContentSnapshotManifest['origin'];
  complete: boolean;
  limits: NativeContentSnapshotManifest['limits'];
  entries: NativeSnapshotEntry[];
  omitted: NativeSnapshotOmission[];
  omittedCount: number;
  omissionOverflow?: NativeContentSnapshotManifest['omissionOverflow'];
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

function snapshotProjection(manifest: NativeContentSnapshotManifest): SnapshotProjection {
  const entries = manifest.entries.map((entry, index) =>
    normalizeEntry(entry, `Snapshot entry ${index}`),
  );
  entries.sort(compareEntries);
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) {
    throw new Error('Snapshot entries must not contain duplicate paths');
  }

  const omitted = manifest.omitted.map((omission, index) =>
    normalizeOmission(omission, `Snapshot omission ${index}`),
  );
  omitted.sort(compareOmissions);

  return {
    schema: manifest.schema,
    origin: manifest.origin,
    complete: manifest.complete,
    limits: {
      maxFiles: manifest.limits.maxFiles,
      maxFileBytes: manifest.limits.maxFileBytes,
      maxTotalBytes: manifest.limits.maxTotalBytes,
      maxManifestBytes: manifest.limits.maxManifestBytes,
    },
    entries,
    omitted,
    omittedCount: manifest.omittedCount,
    ...(manifest.omissionOverflow
      ? {
          omissionOverflow: {
            ref: manifest.omissionOverflow.ref,
            hash: manifest.omissionOverflow.hash,
            count: manifest.omissionOverflow.count,
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
  baseline: SnapshotProjection,
  current: SnapshotProjection,
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
  projection: SnapshotProjection,
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

/**
 * Derive the implementation scope from content snapshots.
 *
 * Snapshot contents are authoritative. Git paths are deliberately emitted as advisory data and
 * never change completeness or create/resolve an implementation change.
 */
export function buildNativeImplementationScope(
  input: BuildNativeImplementationScopeInput,
): NativeImplementationScope {
  if (typeof input.contractHash !== 'string' || input.contractHash.trim().length === 0) {
    throw new Error('Contract hash must be non-empty');
  }
  const contractHash = input.contractHash.trim();
  const baseline = snapshotProjection(input.baseline);
  const current = snapshotProjection(input.current);
  const declaredArtifacts = normalizeDeclaredArtifacts(input.declaredArtifacts);
  const changes = deriveChanges(baseline, current, declaredArtifacts);
  const unattributed = changes.filter((change) => change.attributedTo.length === 0);
  const noCodeReason = input.noCodeReason?.trim() || null;

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
            baselineProjectionHash: canonicalHash(SNAPSHOT_PROJECTION_HASH_TAG, baseline),
            currentProjectionHash: canonicalHash(SNAPSHOT_PROJECTION_HASH_TAG, current),
          },
        },
        'A non-empty no-code reason is required when the snapshots contain no changes',
      ),
    );
  }

  const baselineProjectionHash = canonicalHash(SNAPSHOT_PROJECTION_HASH_TAG, baseline);
  const currentProjectionHash = canonicalHash(SNAPSHOT_PROJECTION_HASH_TAG, current);
  const unresolvedScopes = uniqueUnresolvedScopes(unresolved);
  const gitChangedPaths =
    input.gitChangedPaths === undefined
      ? undefined
      : normalizeGitChangedPaths(input.gitChangedPaths);
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
    baselineProjectionHash,
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
