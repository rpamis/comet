import type { NativeArchivePreflight } from '../comet-native/native-archive-preflight.js';
import type {
  NativeConflictClassification,
  NativeConflictRadarSnapshot,
  NativeWorkspaceRelationship,
} from '../comet-native/native-conflict-radar.js';
import type {
  NativeContinuationAction,
  NativeContinuationDisposition,
  NativeFindingSummary,
  NativePhase,
  NativeStatusProjection,
  NativeVerificationResult,
} from '../comet-native/native-types.js';

export const NATIVE_DASHBOARD_SCHEMA = 'comet.dashboard.native.v1' as const;

export const NATIVE_DASHBOARD_LIMITS = Object.freeze({
  maxChanges: 32,
  maxFindingCodes: 8,
  maxArchiveFindingCodes: 8,
  maxRequiredInputs: 8,
  maxConflictPeers: 8,
  maxArtifactPreviews: 8,
  maxArtifactPreviewBytes: 48 * 1024,
  maxCapabilities: 8,
  maxNameBytes: 128,
  maxCodeBytes: 64,
  maxCommandBytes: 512,
  maxSerializedBytes: 16 * 1024 * 1024,
});

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const CODE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export type NativeDashboardVerificationFreshness =
  | 'missing'
  | 'invalid'
  | 'stale'
  | 'complete'
  | 'partial'
  | 'unknown';

export interface NativeDashboardContinuation {
  disposition: NativeContinuationDisposition;
  action: NativeContinuationAction;
  command: string | null;
  requiresUserDecision: boolean;
  requiredInputs: string[];
  requiredInputsTruncated: boolean;
}

export interface NativeDashboardFindingSummary extends NativeFindingSummary {
  codes: string[];
}

export interface NativeDashboardArchiveSummary {
  ready: boolean;
  evidenceFreshness: NativeDashboardVerificationFreshness;
  operationCount: number;
  findingCodes: string[];
  findingCodesTruncated: boolean;
  preflightHash: string | null;
}

export interface NativeDashboardConflictPeer {
  change: string;
  classification: Exclude<NativeConflictClassification, 'disjoint'>;
  workspaceRelationship: NativeWorkspaceRelationship;
  signalCount: number;
}

export interface NativeDashboardChangeConflictSummary {
  visibleDefiniteConflict: number;
  visiblePossibleOverlap: number;
  peers: NativeDashboardConflictPeer[];
  peersTruncated: boolean;
}

export interface NativeDashboardArtifactPreview {
  key: string;
  label: string;
  path: string;
  exists: boolean;
  content?: string;
  truncated?: boolean;
  size?: number;
  updatedAt?: string;
}

export interface NativeDashboardProgressSummary {
  createdAt: string | null;
  checkpointAt: string | null;
  checkpointPhase: NativePhase | null;
  summary: string | null;
  nextAction: string | null;
  artifactCount: number;
}

export interface NativeDashboardSpecSummary {
  total: number;
  create: number;
  replace: number;
  remove: number;
  capabilities: Array<{ capability: string; operation: 'create' | 'replace' | 'remove' }>;
  capabilitiesTruncated: boolean;
}

export interface NativeDashboardAcceptanceSummary {
  total: number;
  evidenced: number;
  skipped: number;
  missing: number;
}

export interface NativeDashboardImplementationSummary {
  complete: boolean;
  declaredArtifactCount: number;
  changeCount: number;
  unattributedCount: number;
  unresolvedCount: number;
}

export interface NativeDashboardRepairSummary {
  disposition: 'manual-stop' | 'hard-stop';
  overrideRecorded: boolean;
}

export interface NativeDashboardChangeProjection {
  workflow: 'native';
  name: string;
  status: 'active' | 'archived';
  archivedAt: string | null;
  phase: NativePhase | 'invalid';
  revision: number | null;
  selected: boolean;
  approval: 'implicit' | 'confirmed' | null;
  nextCommand: string | null;
  verificationResult: NativeVerificationResult;
  verificationFreshness: NativeDashboardVerificationFreshness;
  archiveReady: boolean;
  continuation: NativeDashboardContinuation | null;
  findings: NativeDashboardFindingSummary;
  archive: NativeDashboardArchiveSummary;
  conflicts: NativeDashboardChangeConflictSummary;
  artifacts: NativeDashboardArtifactPreview[];
  progress: NativeDashboardProgressSummary;
  specs: NativeDashboardSpecSummary;
  acceptance: NativeDashboardAcceptanceSummary | null;
  implementation: NativeDashboardImplementationSummary | null;
  repair: NativeDashboardRepairSummary | null;
}

export interface NativeDashboardConflictSummary {
  available: boolean;
  definiteConflict: number;
  possibleOverlap: number;
  disjoint: number;
  relationshipCount: number;
  visibleRelationshipCount: number;
  omittedRelationshipCount: number;
  relationshipsTruncated: boolean;
}

export interface NativeDashboardProjection {
  schema: typeof NATIVE_DASHBOARD_SCHEMA;
  generatedAt: string;
  totalChangeCount: number;
  visibleChangeCount: number;
  omittedChangeCount: number;
  changesTruncated: boolean;
  changes: NativeDashboardChangeProjection[];
  conflicts: NativeDashboardConflictSummary;
}

export interface NativeDashboardAdapterInput {
  generatedAt: string;
  statuses: readonly NativeStatusProjection[];
  preflights?: Readonly<Record<string, NativeArchivePreflight | null | undefined>>;
  conflictRadar?: NativeConflictRadarSnapshot | null;
  /** Changes omitted by an upstream bounded collector before this adapter ran. */
  omittedSourceChangeCount?: number;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function nonNegativeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0;
}

function normalizeGeneratedAt(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 40 ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error('Native Dashboard generatedAt must be a canonical ISO timestamp');
  }
  return value;
}

function isSafeName(value: string): boolean {
  return NAME_PATTERN.test(value) && byteLength(value) <= NATIVE_DASHBOARD_LIMITS.maxNameBytes;
}

function normalizeCodes(
  values: readonly string[],
  limit: number,
): { codes: string[]; truncated: boolean } {
  const accepted: string[] = [];
  let rejected = false;
  for (const value of values) {
    if (
      typeof value !== 'string' ||
      !CODE_PATTERN.test(value) ||
      byteLength(value) > NATIVE_DASHBOARD_LIMITS.maxCodeBytes
    ) {
      rejected = true;
      continue;
    }
    if (!accepted.includes(value)) accepted.push(value);
  }
  accepted.sort();
  return {
    codes: accepted.slice(0, limit),
    truncated: rejected || accepted.length > limit,
  };
}

function safeNativeCommand(value: string | null, name: string): string | null {
  if (value === null || byteLength(value) > NATIVE_DASHBOARD_LIMITS.maxCommandBytes) return null;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const allowed = new RegExp(
    `^comet native (?:next ${escapedName} --summary "<summary>"|archive ${escapedName} --dry-run|status ${escapedName} --details|doctor ${escapedName} --repair(?: --strategy continue)?)$`,
    'u',
  );
  return allowed.test(value) ? value : null;
}

function normalizePhase(value: NativeStatusProjection['phase']): NativePhase | 'invalid' {
  return value === 'shape' || value === 'build' || value === 'verify' || value === 'archive'
    ? value
    : 'invalid';
}

function normalizeFreshness(value: unknown): NativeDashboardVerificationFreshness {
  return value === 'missing' ||
    value === 'invalid' ||
    value === 'stale' ||
    value === 'complete' ||
    value === 'partial'
    ? value
    : 'unknown';
}

function validContinuationDisposition(value: unknown): value is NativeContinuationDisposition {
  return value === 'continue' || value === 'await-user' || value === 'blocked' || value === 'done';
}

function validContinuationAction(value: unknown): value is NativeContinuationAction {
  return (
    value === 'work-phase' ||
    value === 'advance-phase' ||
    value === 'repair' ||
    value === 'archive' ||
    value === 'none'
  );
}

function findingSummary(value: NativeFindingSummary): NativeDashboardFindingSummary {
  const normalized = normalizeCodes(value.codes, NATIVE_DASHBOARD_LIMITS.maxFindingCodes);
  return {
    total: nonNegativeInteger(value.total),
    errors: nonNegativeInteger(value.errors),
    warnings: nonNegativeInteger(value.warnings),
    info: nonNegativeInteger(value.info),
    requiresUserDecision: value.requiresUserDecision === true,
    codes: normalized.codes,
    truncated: value.truncated === true || normalized.truncated,
  };
}

function continuation(status: NativeStatusProjection): NativeDashboardContinuation | null {
  const value = status.continuation;
  if (
    !value ||
    value.change !== status.name ||
    value.phase !== status.phase ||
    value.revision !== status.revision ||
    !validContinuationDisposition(value.disposition) ||
    !validContinuationAction(value.action)
  ) {
    return null;
  }
  const requiredInputs = normalizeCodes(
    value.requiredInputs,
    NATIVE_DASHBOARD_LIMITS.maxRequiredInputs,
  );
  return {
    disposition: value.disposition,
    action: value.action,
    command: safeNativeCommand(value.command, status.name),
    requiresUserDecision: value.requiresUserDecision === true,
    requiredInputs: requiredInputs.codes,
    requiredInputsTruncated: requiredInputs.truncated,
  };
}

function unavailableArchive(code: string): NativeDashboardArchiveSummary {
  return {
    ready: false,
    evidenceFreshness: 'unknown',
    operationCount: 0,
    findingCodes: [code],
    findingCodesTruncated: false,
    preflightHash: null,
  };
}

function archiveSummary(
  status: NativeStatusProjection,
  preflight: NativeArchivePreflight | null | undefined,
): NativeDashboardArchiveSummary {
  if (!preflight) return unavailableArchive('dashboard-preflight-unavailable');
  if (preflight.change !== status.name || preflight.revision !== status.revision) {
    return unavailableArchive('dashboard-preflight-mismatch');
  }
  const findingCodes = normalizeCodes(
    preflight.findingCodes,
    NATIVE_DASHBOARD_LIMITS.maxArchiveFindingCodes,
  );
  const hashValid = HASH_PATTERN.test(preflight.preflightHash);
  const evidenceFreshness = normalizeFreshness(preflight.evidenceFreshness);
  return {
    ready:
      preflight.ready === true &&
      preflight.findingCodes.length === 0 &&
      !findingCodes.truncated &&
      hashValid &&
      (evidenceFreshness === 'complete' || evidenceFreshness === 'partial'),
    evidenceFreshness,
    operationCount: nonNegativeInteger(preflight.operationCount),
    findingCodes: findingCodes.codes,
    findingCodesTruncated: findingCodes.truncated,
    preflightHash: hashValid ? preflight.preflightHash : null,
  };
}

function relationshipRank(value: NativeConflictClassification): number {
  if (value === 'definite-conflict') return 0;
  if (value === 'possible-overlap') return 1;
  return 2;
}

function changeConflictSummary(
  name: string,
  radar: NativeConflictRadarSnapshot | null | undefined,
): NativeDashboardChangeConflictSummary {
  if (!radar) {
    return {
      visibleDefiniteConflict: 0,
      visiblePossibleOverlap: 0,
      peers: [],
      peersTruncated: false,
    };
  }
  const visible = radar.relationships
    .filter(
      (relationship) =>
        (relationship.classification === 'definite-conflict' ||
          relationship.classification === 'possible-overlap') &&
        (relationship.left === name || relationship.right === name),
    )
    .map(
      (relationship): NativeDashboardConflictPeer => ({
        change: relationship.left === name ? relationship.right : relationship.left,
        classification: relationship.classification as Exclude<
          NativeConflictClassification,
          'disjoint'
        >,
        workspaceRelationship:
          relationship.workspaceRelationship === 'same' ||
          relationship.workspaceRelationship === 'different'
            ? relationship.workspaceRelationship
            : 'unknown',
        signalCount: nonNegativeInteger(relationship.signalCount),
      }),
    )
    .filter((peer) => isSafeName(peer.change))
    .sort(
      (left, right) =>
        relationshipRank(left.classification) - relationshipRank(right.classification) ||
        left.change.localeCompare(right.change),
    );
  return {
    visibleDefiniteConflict: visible.filter(
      ({ classification }) => classification === 'definite-conflict',
    ).length,
    visiblePossibleOverlap: visible.filter(
      ({ classification }) => classification === 'possible-overlap',
    ).length,
    peers: visible.slice(0, NATIVE_DASHBOARD_LIMITS.maxConflictPeers),
    peersTruncated:
      radar.relationshipsTruncated || visible.length > NATIVE_DASHBOARD_LIMITS.maxConflictPeers,
  };
}

function conflictSummary(
  radar: NativeConflictRadarSnapshot | null | undefined,
): NativeDashboardConflictSummary {
  if (!radar) {
    return {
      available: false,
      definiteConflict: 0,
      possibleOverlap: 0,
      disjoint: 0,
      relationshipCount: 0,
      visibleRelationshipCount: 0,
      omittedRelationshipCount: 0,
      relationshipsTruncated: false,
    };
  }
  return {
    available: true,
    definiteConflict: nonNegativeInteger(radar.counts.definiteConflict),
    possibleOverlap: nonNegativeInteger(radar.counts.possibleOverlap),
    disjoint: nonNegativeInteger(radar.counts.disjoint),
    relationshipCount: nonNegativeInteger(radar.relationshipCount),
    visibleRelationshipCount: radar.relationships.length,
    omittedRelationshipCount: nonNegativeInteger(radar.omittedRelationshipCount),
    relationshipsTruncated: radar.relationshipsTruncated === true,
  };
}

function verificationResult(value: NativeVerificationResult): NativeVerificationResult {
  return value === 'pass' || value === 'fail' ? value : 'pending';
}

function projectChange(
  status: NativeStatusProjection,
  preflight: NativeArchivePreflight | null | undefined,
  radar: NativeConflictRadarSnapshot | null | undefined,
): NativeDashboardChangeProjection {
  const archive = archiveSummary(status, preflight);
  const checkpoint = status.checkpoint;
  const repair = status.repair;
  return {
    workflow: 'native',
    name: status.name,
    status: 'active',
    archivedAt: null,
    phase: normalizePhase(status.phase),
    revision:
      Number.isSafeInteger(status.revision) && (status.revision ?? 0) > 0 ? status.revision : null,
    selected: status.selected === true,
    approval:
      status.approval === 'implicit' || status.approval === 'confirmed' ? status.approval : null,
    nextCommand: safeNativeCommand(status.nextCommand, status.name),
    verificationResult: verificationResult(status.verificationResult),
    verificationFreshness: archive.evidenceFreshness,
    archiveReady: archive.ready,
    continuation: continuation(status),
    findings: findingSummary(status.findingSummary),
    archive,
    conflicts: changeConflictSummary(status.name, radar),
    artifacts: [],
    progress: {
      createdAt: null,
      checkpointAt: checkpoint?.createdAt ?? null,
      checkpointPhase: checkpoint?.phase ?? null,
      summary: checkpoint?.summary ?? null,
      nextAction: checkpoint?.nextAction ?? null,
      artifactCount: nonNegativeInteger(checkpoint?.artifactCount),
    },
    specs: {
      total: nonNegativeInteger(status.specChanges),
      create: 0,
      replace: 0,
      remove: 0,
      capabilities: [],
      capabilitiesTruncated: false,
    },
    acceptance: null,
    implementation: null,
    repair:
      repair?.disposition === 'manual-stop' || repair?.disposition === 'hard-stop'
        ? { disposition: repair.disposition, overrideRecorded: repair.overrideRecorded === true }
        : null,
  };
}

/**
 * Convert Native's existing read-only Runtime projections into a bounded Dashboard payload.
 *
 * The adapter intentionally projects only machine-level summaries. The collector may add bounded,
 * user-authored Markdown previews, but detailed findings, absolute Native root paths, conflict
 * signals, and evidence envelopes never cross this boundary.
 */
export function adaptNativeDashboardProjection(
  input: NativeDashboardAdapterInput,
): NativeDashboardProjection {
  const omittedSourceChangeCount = nonNegativeInteger(input.omittedSourceChangeCount);
  const names = new Set<string>();
  let rejectedOrDuplicate = 0;
  const accepted = [...input.statuses]
    .sort((left, right) => left.name.localeCompare(right.name))
    .filter((status) => {
      if (!isSafeName(status.name) || names.has(status.name)) {
        rejectedOrDuplicate += 1;
        return false;
      }
      names.add(status.name);
      return true;
    });
  const visibleStatuses = accepted.slice(0, NATIVE_DASHBOARD_LIMITS.maxChanges);
  const budgetOmissions = accepted.length - visibleStatuses.length;
  const changes = visibleStatuses.map((status) =>
    projectChange(status, input.preflights?.[status.name], input.conflictRadar),
  );
  const omittedChangeCount = omittedSourceChangeCount + rejectedOrDuplicate + budgetOmissions;
  const projection: NativeDashboardProjection = {
    schema: NATIVE_DASHBOARD_SCHEMA,
    generatedAt: normalizeGeneratedAt(input.generatedAt),
    totalChangeCount: changes.length + omittedChangeCount,
    visibleChangeCount: changes.length,
    omittedChangeCount,
    changesTruncated: omittedChangeCount > 0,
    changes,
    conflicts: conflictSummary(input.conflictRadar),
  };
  if (byteLength(JSON.stringify(projection)) > NATIVE_DASHBOARD_LIMITS.maxSerializedBytes) {
    throw new Error('Native Dashboard projection exceeds its serialized output budget');
  }
  return projection;
}
