import { createHash } from 'node:crypto';
import path from 'node:path';

import { canonicalHash, canonicalJson } from './native-canonical-hash.js';
import type { NativeContractSpecSnapshot } from './native-contract.js';
import type { NativeDeclaredArtifact } from './native-verification-scope.js';

export const NATIVE_CONFLICT_RADAR_SCHEMA = 'comet.native.conflict-radar.v1' as const;

export const NATIVE_CONFLICT_RADAR_LIMITS = Object.freeze({
  maxChanges: 32,
  maxSpecsPerChange: 64,
  maxArtifactsPerChange: 128,
  maxTotalSpecs: 512,
  maxTotalArtifacts: 1_024,
  maxSignalsPerRelationship: 8,
  maxRelationships: 256,
  maxSerializedBytes: 64 * 1_024,
  maxNameBytes: 128,
  maxCapabilityBytes: 128,
  maxArtifactPathBytes: 512,
});

const RADAR_HASH_TAG = 'comet.native.conflict-radar.v1';
const SIGNAL_SET_HASH_TAG = 'comet.native.conflict-radar-signals.v1';
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const CHANGE_KEYS = new Set([
  'name',
  'revision',
  'specs',
  'declaredArtifacts',
  'workspaceIdentityHash',
]);
const SPEC_KEYS = new Set(['capability', 'operation', 'baseHash']);
const ARTIFACT_KEYS = new Set(['path', 'kind']);

export type NativeConflictClassification = 'definite-conflict' | 'possible-overlap' | 'disjoint';

export type NativeWorkspaceRelationship = 'same' | 'different' | 'unknown';

export interface NativeConflictRadarChangeInput {
  name: string;
  revision: number;
  specs: readonly Pick<NativeContractSpecSnapshot, 'capability' | 'operation' | 'baseHash'>[];
  declaredArtifacts: readonly NativeDeclaredArtifact[];
  /** Opaque, already-redacted identity. It is never returned and never affects classification. */
  workspaceIdentityHash?: string | null;
}

export interface NativeCapabilityConflictSignal {
  kind: 'capability';
  certainty: Exclude<NativeConflictClassification, 'disjoint'>;
  capability: string;
  leftOperation: NativeContractSpecSnapshot['operation'];
  rightOperation: NativeContractSpecSnapshot['operation'];
  leftBaseHash: string | null;
  rightBaseHash: string | null;
}

export interface NativeArtifactConflictSignal {
  kind: 'artifact';
  certainty: Exclude<NativeConflictClassification, 'disjoint'>;
  leftArtifact: NativeDeclaredArtifact;
  rightArtifact: NativeDeclaredArtifact;
}

export type NativeConflictSignal = NativeCapabilityConflictSignal | NativeArtifactConflictSignal;

export interface NativeConflictRelationship {
  left: string;
  right: string;
  classification: NativeConflictClassification;
  workspaceRelationship: NativeWorkspaceRelationship;
  signalCount: number;
  signalHash: string;
  signals: NativeConflictSignal[];
  signalsTruncated: boolean;
}

export interface NativeConflictRadarSnapshot {
  schema: typeof NATIVE_CONFLICT_RADAR_SCHEMA;
  workspaceIdentityAdvisoryOnly: true;
  changeCount: number;
  relationshipCount: number;
  counts: {
    definiteConflict: number;
    possibleOverlap: number;
    disjoint: number;
  };
  relationships: NativeConflictRelationship[];
  relationshipsTruncated: boolean;
  omittedRelationshipCount: number;
  radarHash: string;
}

interface NormalizedSpec {
  capability: string;
  operation: NativeContractSpecSnapshot['operation'];
  baseHash: string | null;
}

interface NormalizedChange {
  name: string;
  revision: number;
  specs: NormalizedSpec[];
  declaredArtifacts: NativeDeclaredArtifact[];
  workspaceIdentityHash: string | null;
}

type FullRelationship = NativeConflictRelationship;

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function strictRecord(value: unknown, keys: ReadonlySet<string>, label: string) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !keys.has(key));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}`);
  return record;
}

function boundedText(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
  if (byteLength(value) > maxBytes) throw new Error(`${label} exceeds its byte budget`);
  return value;
}

function normalizedProjectPath(value: unknown, label: string): string {
  const candidate = boundedText(value, label, NATIVE_CONFLICT_RADAR_LIMITS.maxArtifactPathBytes);
  const normalized = path.posix.normalize(candidate);
  if (
    candidate.includes('\\') ||
    Array.from(candidate).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    }) ||
    /^(?:[A-Za-z]:|~)/u.test(candidate) ||
    path.posix.isAbsolute(normalized) ||
    candidate.split('/').includes('..') ||
    normalized !== candidate ||
    normalized === '.' ||
    candidate.endsWith('/')
  ) {
    throw new Error(`${label} must be a normalized project-relative path`);
  }
  return candidate;
}

function normalizedHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error(`${label} must be a SHA-256 hash`);
  }
  return value;
}

function normalizeSpec(value: NativeConflictRadarChangeInput['specs'][number], label: string) {
  const record = strictRecord(value, SPEC_KEYS, label);
  const capability = boundedText(
    record.capability,
    `${label} capability`,
    NATIVE_CONFLICT_RADAR_LIMITS.maxCapabilityBytes,
  );
  if (!NAME_PATTERN.test(capability)) throw new Error(`${label} capability is invalid`);
  if (
    record.operation !== 'create' &&
    record.operation !== 'replace' &&
    record.operation !== 'remove'
  ) {
    throw new Error(`${label} operation is invalid`);
  }
  const baseHash =
    record.baseHash === null
      ? null
      : normalizedHash(record.baseHash, `${label} canonical base hash`);
  if (record.operation === 'create' && baseHash !== null) {
    throw new Error(`${label} create operation requires a null canonical base hash`);
  }
  if (record.operation !== 'create' && baseHash === null) {
    throw new Error(`${label} ${record.operation} operation requires a canonical base hash`);
  }
  return { capability, operation: record.operation, baseHash } satisfies NormalizedSpec;
}

function normalizeArtifact(value: NativeDeclaredArtifact, label: string): NativeDeclaredArtifact {
  const record = strictRecord(value, ARTIFACT_KEYS, label);
  if (record.kind !== 'file' && record.kind !== 'directory') {
    throw new Error(`${label} kind is invalid`);
  }
  return { path: normalizedProjectPath(record.path, `${label} path`), kind: record.kind };
}

function normalizeChange(value: NativeConflictRadarChangeInput, index: number): NormalizedChange {
  const record = strictRecord(value, CHANGE_KEYS, `Conflict radar change ${index}`);
  const name = boundedText(
    record.name,
    `Conflict radar change ${index} name`,
    NATIVE_CONFLICT_RADAR_LIMITS.maxNameBytes,
  );
  if (!NAME_PATTERN.test(name)) throw new Error(`Conflict radar change ${index} name is invalid`);
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 1) {
    throw new Error(`Conflict radar change ${name} revision must be a positive safe integer`);
  }
  if (!Array.isArray(record.specs)) {
    throw new Error(`Conflict radar change ${name} specs must be an array`);
  }
  if (record.specs.length > NATIVE_CONFLICT_RADAR_LIMITS.maxSpecsPerChange) {
    throw new Error(`Conflict radar change ${name} exceeds the spec budget`);
  }
  if (!Array.isArray(record.declaredArtifacts)) {
    throw new Error(`Conflict radar change ${name} declared artifacts must be an array`);
  }
  if (record.declaredArtifacts.length > NATIVE_CONFLICT_RADAR_LIMITS.maxArtifactsPerChange) {
    throw new Error(`Conflict radar change ${name} exceeds the declared artifact budget`);
  }

  const specs = (record.specs as NativeConflictRadarChangeInput['specs'])
    .map((spec, specIndex) =>
      normalizeSpec(spec, `Conflict radar change ${name} spec ${specIndex}`),
    )
    .sort((left, right) => compareText(left.capability, right.capability));
  if (new Set(specs.map((spec) => spec.capability)).size !== specs.length) {
    throw new Error(`Conflict radar change ${name} has duplicate capabilities`);
  }

  const declaredArtifacts = (record.declaredArtifacts as NativeDeclaredArtifact[])
    .map((artifact, artifactIndex) =>
      normalizeArtifact(artifact, `Conflict radar change ${name} artifact ${artifactIndex}`),
    )
    .sort(
      (left, right) => compareText(left.path, right.path) || compareText(left.kind, right.kind),
    );
  const artifactPaths = declaredArtifacts.map((artifact) => artifact.path);
  if (new Set(artifactPaths).size !== artifactPaths.length) {
    throw new Error(`Conflict radar change ${name} has duplicate or conflicting artifact paths`);
  }

  const workspaceIdentityHash =
    record.workspaceIdentityHash === undefined || record.workspaceIdentityHash === null
      ? null
      : normalizedHash(
          record.workspaceIdentityHash,
          `Conflict radar change ${name} workspace identity hash`,
        );
  return {
    name,
    revision: record.revision as number,
    specs,
    declaredArtifacts,
    workspaceIdentityHash,
  };
}

function normalizeChanges(input: readonly NativeConflictRadarChangeInput[]): NormalizedChange[] {
  if (!Array.isArray(input)) throw new Error('Native conflict radar input must be an array');
  if (input.length > NATIVE_CONFLICT_RADAR_LIMITS.maxChanges) {
    throw new Error('Native conflict radar exceeds the change budget');
  }
  const changes = input
    .map(normalizeChange)
    .sort((left, right) => compareText(left.name, right.name));
  if (new Set(changes.map((change) => change.name)).size !== changes.length) {
    throw new Error('Native conflict radar contains duplicate change names');
  }
  const specCount = changes.reduce((total, change) => total + change.specs.length, 0);
  if (specCount > NATIVE_CONFLICT_RADAR_LIMITS.maxTotalSpecs) {
    throw new Error('Native conflict radar exceeds the total spec budget');
  }
  const artifactCount = changes.reduce(
    (total, change) => total + change.declaredArtifacts.length,
    0,
  );
  if (artifactCount > NATIVE_CONFLICT_RADAR_LIMITS.maxTotalArtifacts) {
    throw new Error('Native conflict radar exceeds the total declared artifact budget');
  }
  return changes;
}

function capabilitySignal(
  left: NormalizedSpec,
  right: NormalizedSpec,
): NativeCapabilityConflictSignal {
  const sameCanonicalBase = left.baseHash !== null && left.baseHash === right.baseHash;
  const certainty =
    left.operation === 'create' || right.operation === 'create' || sameCanonicalBase
      ? 'definite-conflict'
      : 'possible-overlap';
  return {
    kind: 'capability',
    certainty,
    capability: left.capability,
    leftOperation: left.operation,
    rightOperation: right.operation,
    leftBaseHash: left.baseHash,
    rightBaseHash: right.baseHash,
  };
}

function artifactOverlap(
  left: NativeDeclaredArtifact,
  right: NativeDeclaredArtifact,
): NativeArtifactConflictSignal | null {
  const leftOwnsRight =
    left.kind === 'directory' &&
    (right.path === left.path || right.path.startsWith(`${left.path}/`));
  const rightOwnsLeft =
    right.kind === 'directory' &&
    (left.path === right.path || left.path.startsWith(`${right.path}/`));
  const sameFile = left.kind === 'file' && right.kind === 'file' && left.path === right.path;
  if (!leftOwnsRight && !rightOwnsLeft && !sameFile) return null;
  return {
    kind: 'artifact',
    certainty: sameFile ? 'definite-conflict' : 'possible-overlap',
    leftArtifact: left,
    rightArtifact: right,
  };
}

function workspaceRelationship(
  left: NormalizedChange,
  right: NormalizedChange,
): NativeWorkspaceRelationship {
  if (left.workspaceIdentityHash === null || right.workspaceIdentityHash === null) return 'unknown';
  return left.workspaceIdentityHash === right.workspaceIdentityHash ? 'same' : 'different';
}

function relationship(left: NormalizedChange, right: NormalizedChange): FullRelationship {
  const visibleSignals: NativeConflictSignal[] = [];
  const signalHasher = createHash('sha256').update(`${SIGNAL_SET_HASH_TAG}\n[`);
  let signalCount = 0;
  let hasDefiniteConflict = false;
  const addSignal = (signal: NativeConflictSignal) => {
    if (signalCount > 0) signalHasher.update(',');
    signalHasher.update(canonicalJson(signal));
    signalCount += 1;
    if (signal.certainty === 'definite-conflict') hasDefiniteConflict = true;
    if (visibleSignals.length < NATIVE_CONFLICT_RADAR_LIMITS.maxSignalsPerRelationship) {
      visibleSignals.push(signal);
    }
  };
  const rightSpecs = new Map(right.specs.map((spec) => [spec.capability, spec]));
  for (const leftSpec of left.specs) {
    const rightSpec = rightSpecs.get(leftSpec.capability);
    if (rightSpec) addSignal(capabilitySignal(leftSpec, rightSpec));
  }
  for (const leftArtifact of left.declaredArtifacts) {
    for (const rightArtifact of right.declaredArtifacts) {
      const signal = artifactOverlap(leftArtifact, rightArtifact);
      if (signal) addSignal(signal);
    }
  }
  const classification = hasDefiniteConflict
    ? 'definite-conflict'
    : signalCount > 0
      ? 'possible-overlap'
      : 'disjoint';
  signalHasher.update(']');
  return {
    left: left.name,
    right: right.name,
    classification,
    workspaceRelationship: workspaceRelationship(left, right),
    signalCount,
    signalHash: signalHasher.digest('hex'),
    signals: visibleSignals,
    signalsTruncated: visibleSignals.length !== signalCount,
  };
}

function classificationRank(value: NativeConflictClassification): number {
  if (value === 'definite-conflict') return 0;
  if (value === 'possible-overlap') return 1;
  return 2;
}

function compareRelationships(left: FullRelationship, right: FullRelationship): number {
  return (
    classificationRank(left.classification) - classificationRank(right.classification) ||
    compareText(left.left, right.left) ||
    compareText(left.right, right.right)
  );
}

function snapshot(
  changes: NormalizedChange[],
  allRelationships: FullRelationship[],
  relationships: NativeConflictRelationship[],
  radarHash: string,
): NativeConflictRadarSnapshot {
  const counts = {
    definiteConflict: allRelationships.filter(
      ({ classification }) => classification === 'definite-conflict',
    ).length,
    possibleOverlap: allRelationships.filter(
      ({ classification }) => classification === 'possible-overlap',
    ).length,
    disjoint: allRelationships.filter(({ classification }) => classification === 'disjoint').length,
  };
  return {
    schema: NATIVE_CONFLICT_RADAR_SCHEMA,
    workspaceIdentityAdvisoryOnly: true,
    changeCount: changes.length,
    relationshipCount: allRelationships.length,
    counts,
    relationships,
    relationshipsTruncated: relationships.length !== allRelationships.length,
    omittedRelationshipCount: allRelationships.length - relationships.length,
    radarHash,
  };
}

/**
 * Compare already-visible changes from one physical Native root.
 *
 * Collection and filesystem identity stay outside this pure module. Workspace identity is an
 * optional advisory projection and cannot change conflict classification.
 */
export function buildNativeConflictRadar(
  input: readonly NativeConflictRadarChangeInput[],
): NativeConflictRadarSnapshot {
  const changes = normalizeChanges(input);
  const allRelationships: FullRelationship[] = [];
  for (let leftIndex = 0; leftIndex < changes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < changes.length; rightIndex += 1) {
      allRelationships.push(relationship(changes[leftIndex], changes[rightIndex]));
    }
  }
  allRelationships.sort(compareRelationships);
  const hashRelationships = allRelationships.map((value) => ({
    left: value.left,
    right: value.right,
    classification: value.classification,
    workspaceRelationship: value.workspaceRelationship,
    signalCount: value.signalCount,
    signalHash: value.signalHash,
  }));
  const radarHash = canonicalHash(RADAR_HASH_TAG, { changes, relationships: hashRelationships });
  let relationships = allRelationships
    .slice(0, NATIVE_CONFLICT_RADAR_LIMITS.maxRelationships)
    .map((value) => ({ ...value, signals: [...value.signals] }));
  let result = snapshot(changes, allRelationships, relationships, radarHash);
  while (
    relationships.length > 0 &&
    byteLength(JSON.stringify(result)) > NATIVE_CONFLICT_RADAR_LIMITS.maxSerializedBytes
  ) {
    relationships = relationships.slice(0, -1);
    result = snapshot(changes, allRelationships, relationships, radarHash);
  }
  if (byteLength(JSON.stringify(result)) > NATIVE_CONFLICT_RADAR_LIMITS.maxSerializedBytes) {
    throw new Error('Native conflict radar summary exceeds its serialized output budget');
  }
  return result;
}
