import path from 'node:path';

import { canonicalHash } from './native-canonical-hash.js';
import type { NativePhase, NativeSpecOperation } from './native-types.js';

export const NATIVE_ARCHIVE_PREFLIGHT_SCHEMA = 'comet.native.archive-preflight.v1' as const;

const PREFLIGHT_HASH_TAG = 'comet.native.archive-preflight.v1';
const OPERATION_HASH_TAG = 'comet.native.archive-operation.v1';
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const FINDING_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export type NativeVerificationFreshness = 'missing' | 'invalid' | 'stale' | 'complete' | 'partial';

export interface NativeArchiveSpecFact {
  capability: string;
  operation: NativeSpecOperation;
  expectedBaseHash: string | null;
  actualBaseHash: string | null;
  proposedHash: string | null;
}

export interface NativeArchiveEvidenceFact {
  result: 'pending' | 'pass' | 'fail';
  freshness: NativeVerificationFreshness;
  contractHash: string | null;
  acceptanceHash: string | null;
  implementationScopeHash: string | null;
  reportHash: string | null;
  envelopeHash: string | null;
  partialAllowanceHash: string | null;
  skippedAcceptanceCount: number;
}

export interface NativeArchivePreflightInput {
  change: string;
  stateSchema: string;
  revision: number;
  phase: NativePhase;
  archived: boolean;
  pendingJournal: boolean;
  targetRef: string;
  targetExists: boolean;
  specs: readonly NativeArchiveSpecFact[];
  evidence: NativeArchiveEvidenceFact;
  findingCodes?: readonly string[];
}

export interface NativeArchiveOperationPreview extends NativeArchiveSpecFact {
  operationHash: string;
}

export interface NativeArchivePreflight {
  schema: typeof NATIVE_ARCHIVE_PREFLIGHT_SCHEMA;
  change: string;
  revision: number;
  targetRef: string;
  ready: boolean;
  evidenceFreshness: NativeVerificationFreshness;
  operationCount: number;
  operations: NativeArchiveOperationPreview[];
  findingCodes: string[];
  preflightHash: string;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error(`${label} must be a SHA-256 hash`);
  }
  return value;
}

function optionalHash(value: unknown, label: string): string | null {
  return value === null ? null : hash(value, label);
}

function normalizedRef(value: string, label: string): string {
  const normalized = path.posix.normalize(value);
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    value.includes('\\') ||
    path.posix.isAbsolute(normalized) ||
    /^(?:[A-Za-z]:|~)/u.test(value) ||
    value.split('/').includes('..') ||
    normalized !== value ||
    normalized === '.' ||
    value.endsWith('/')
  ) {
    throw new Error(`${label} must be a normalized Native-relative ref`);
  }
  return value;
}

function positiveRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Native archive preflight revision must be a positive integer');
  }
  return value;
}

function normalizeSpec(value: NativeArchiveSpecFact, index: number): NativeArchiveSpecFact {
  if (!NAME_PATTERN.test(value.capability)) {
    throw new Error(`Native archive spec ${index} capability is invalid`);
  }
  if (
    value.operation !== 'create' &&
    value.operation !== 'replace' &&
    value.operation !== 'remove'
  ) {
    throw new Error(`Native archive spec ${value.capability} operation is invalid`);
  }
  const expectedBaseHash = optionalHash(
    value.expectedBaseHash,
    `Native archive spec ${value.capability} expected base`,
  );
  const actualBaseHash = optionalHash(
    value.actualBaseHash,
    `Native archive spec ${value.capability} actual base`,
  );
  const proposedHash = optionalHash(
    value.proposedHash,
    `Native archive spec ${value.capability} proposed content`,
  );
  if (value.operation === 'create' && expectedBaseHash !== null) {
    throw new Error(`Native archive create ${value.capability} must expect no canonical base`);
  }
  if (value.operation !== 'create' && expectedBaseHash === null) {
    throw new Error(`Native archive ${value.operation} ${value.capability} requires a base hash`);
  }
  if ((value.operation === 'remove') !== (proposedHash === null)) {
    throw new Error(
      `Native archive ${value.operation} ${value.capability} proposed hash is invalid`,
    );
  }
  return {
    capability: value.capability,
    operation: value.operation,
    expectedBaseHash,
    actualBaseHash,
    proposedHash,
  };
}

function normalizeEvidence(value: NativeArchiveEvidenceFact): NativeArchiveEvidenceFact {
  if (value.result !== 'pending' && value.result !== 'pass' && value.result !== 'fail') {
    throw new Error('Native archive verification result is invalid');
  }
  if (!['missing', 'invalid', 'stale', 'complete', 'partial'].includes(value.freshness)) {
    throw new Error('Native archive verification freshness is invalid');
  }
  if (!Number.isSafeInteger(value.skippedAcceptanceCount) || value.skippedAcceptanceCount < 0) {
    throw new Error('Native archive skipped acceptance count is invalid');
  }
  const normalized = {
    result: value.result,
    freshness: value.freshness,
    contractHash: optionalHash(value.contractHash, 'Native archive contract hash'),
    acceptanceHash: optionalHash(value.acceptanceHash, 'Native archive acceptance hash'),
    implementationScopeHash: optionalHash(
      value.implementationScopeHash,
      'Native archive implementation scope hash',
    ),
    reportHash: optionalHash(value.reportHash, 'Native archive report hash'),
    envelopeHash: optionalHash(value.envelopeHash, 'Native archive envelope hash'),
    partialAllowanceHash: optionalHash(
      value.partialAllowanceHash,
      'Native archive partial allowance hash',
    ),
    skippedAcceptanceCount: value.skippedAcceptanceCount,
  };
  if (
    (value.freshness === 'complete' || value.freshness === 'partial') &&
    [
      normalized.contractHash,
      normalized.acceptanceHash,
      normalized.implementationScopeHash,
      normalized.reportHash,
      normalized.envelopeHash,
    ].some((entry) => entry === null)
  ) {
    throw new Error('Fresh Native archive evidence requires every bound content hash');
  }
  if (
    (value.freshness === 'partial' && normalized.partialAllowanceHash === null) ||
    (value.freshness === 'complete' && normalized.partialAllowanceHash !== null)
  ) {
    throw new Error('Native archive partial evidence allowance state is invalid');
  }
  return normalized;
}

function normalizeFindingCodes(values: readonly string[]): string[] {
  if (values.length > 64) throw new Error('Native archive preflight has too many findings');
  const codes = values.map((value) => {
    if (typeof value !== 'string' || !FINDING_PATTERN.test(value)) {
      throw new Error(`Native archive preflight finding code is invalid: ${String(value)}`);
    }
    return value;
  });
  const normalized = [...new Set(codes)].sort(compareText);
  if (normalized.length !== codes.length) {
    throw new Error('Native archive preflight has duplicate finding codes');
  }
  return normalized;
}

function derivedFindings(input: {
  phase: NativePhase;
  archived: boolean;
  pendingJournal: boolean;
  targetExists: boolean;
  specs: readonly NativeArchiveSpecFact[];
  evidence: NativeArchiveEvidenceFact;
}): string[] {
  const findings: string[] = [];
  if (input.phase !== 'archive') findings.push('archive-phase-required');
  if (input.archived) findings.push('change-already-archived');
  if (input.pendingJournal) findings.push('pending-journal');
  if (input.targetExists) findings.push('archive-target-exists');
  if (input.evidence.result !== 'pass') findings.push('verification-not-passed');
  if (input.evidence.freshness === 'missing') findings.push('verification-evidence-missing');
  if (input.evidence.freshness === 'invalid') findings.push('verification-evidence-invalid');
  if (input.evidence.freshness === 'stale') findings.push('verification-evidence-stale');
  for (const spec of input.specs) {
    if (spec.actualBaseHash !== spec.expectedBaseHash) findings.push('spec-base-conflict');
  }
  return [...new Set(findings)].sort(compareText);
}

/** Build a pure, content-bound Archive preview. No path is read or written here. */
export function buildNativeArchivePreflight(
  input: NativeArchivePreflightInput,
): NativeArchivePreflight {
  if (!NAME_PATTERN.test(input.change)) throw new Error('Native archive change name is invalid');
  if (typeof input.stateSchema !== 'string' || input.stateSchema.length === 0) {
    throw new Error('Native archive state schema is invalid');
  }
  if (!Array.isArray(input.specs) || input.specs.length > 64) {
    throw new Error('Native archive preflight exceeds its spec budget');
  }
  const specs = input.specs
    .map(normalizeSpec)
    .sort((left, right) => compareText(left.capability, right.capability));
  if (new Set(specs.map((spec) => spec.capability)).size !== specs.length) {
    throw new Error('Native archive preflight contains duplicate capabilities');
  }
  const operations = specs.map((spec) => ({
    ...spec,
    operationHash: canonicalHash(OPERATION_HASH_TAG, spec),
  }));
  const evidence = normalizeEvidence(input.evidence);
  const findingCodes = [
    ...new Set([
      ...normalizeFindingCodes(input.findingCodes ?? []),
      ...derivedFindings({
        phase: input.phase,
        archived: input.archived,
        pendingJournal: input.pendingJournal,
        targetExists: input.targetExists,
        specs,
        evidence,
      }),
    ]),
  ].sort(compareText);
  const revision = positiveRevision(input.revision);
  const targetRef = normalizedRef(input.targetRef, 'Native archive target');
  const facts = {
    stateSchema: input.stateSchema,
    change: input.change,
    revision,
    phase: input.phase,
    archived: input.archived,
    pendingJournal: input.pendingJournal,
    targetRef,
    targetExists: input.targetExists,
    operations,
    evidence,
    findingCodes,
  };
  return {
    schema: NATIVE_ARCHIVE_PREFLIGHT_SCHEMA,
    change: input.change,
    revision,
    targetRef,
    ready: findingCodes.length === 0,
    evidenceFreshness: evidence.freshness,
    operationCount: operations.length,
    operations,
    findingCodes,
    preflightHash: canonicalHash(PREFLIGHT_HASH_TAG, facts),
  };
}
