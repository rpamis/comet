import path from 'node:path';

import type {
  NativeAcceptanceCriterion,
  NativeAcceptanceEvidenceEntry,
} from './native-acceptance.js';
import { canonicalHash } from './native-canonical-hash.js';
import { redactNativeCredentialText } from './native-redaction.js';
import { nativeSensitiveRelativePathReason } from './native-sensitive-paths.js';
import {
  parseNativeImplementationScopeBundle,
  type NativeImplementationScopeBundle,
} from './native-verification-scope.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MISSING_ACCEPTANCE_DETAIL_LIMIT = 8;
const ACCEPTANCE_TRACE_HASH_TAG = 'comet.native.acceptance-trace.v1';
const PARTIAL_ALLOWANCE_HASH_TAG = 'comet.native.partial-allowance.v1';
const VERIFICATION_ENVELOPE_HASH_TAG = 'comet.native.verification-evidence.v1';

export interface NativeAcceptanceTraceEntry {
  acceptanceId: string;
  kind: NativeAcceptanceCriterion['kind'];
  source: string;
  evidenceRefs: string[];
  skippedReason: string | null;
}

export interface NativeAcceptanceEvidenceTrace {
  schema: 'comet.native.acceptance-trace.v1';
  nativeRootRef: string;
  criteriaHash: string;
  total: number;
  evidenced: number;
  skipped: number;
  entries: NativeAcceptanceTraceEntry[];
  traceHash: string;
}

export interface NativePartialAllowance {
  schema: 'comet.native.partial-allowance.v1';
  change: string;
  scopeHash: string;
  scopeIds: string[];
  reason: string;
  confirmedSummary: string;
  sourceRevision: number;
  confirmedAt: string;
  allowanceHash: string;
}

export interface NativeVerificationEvidenceEnvelope {
  schema: 'comet.native.verification-evidence.v1';
  change: string;
  sourceRevision: number;
  result: 'pass' | 'fail';
  freshness: 'complete' | 'partial';
  contractHash: string;
  acceptanceCriteriaHash: string;
  implementationScopeRef: string;
  implementationScopeHash: string;
  reportRef: string;
  reportHash: string;
  acceptanceTrace: NativeAcceptanceEvidenceTrace;
  partialAllowanceRef: string | null;
  partialAllowanceHash: string | null;
  receiptRef: string | null;
  createdAt: string;
  envelopeHash: string;
}

function hash(value: string, label: string): string {
  if (!HASH_PATTERN.test(value)) throw new Error(`${label} must be a SHA-256 hash`);
  return value;
}

function positiveRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Native evidence source revision must be a positive integer');
  }
  return value;
}

function changeName(value: string): string {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value)) {
    throw new Error(`Invalid Native evidence change name: ${value}`);
  }
  return value;
}

function requiredText(value: string, label: string, max = 2_000): string {
  const normalized = redactNativeCredentialText(value).trim();
  if (normalized.length === 0 || normalized.length > max) {
    throw new Error(`${label} must be between 1 and ${max} characters`);
  }
  return normalized;
}

function portableRef(value: string, label: string): string {
  const normalized = path.posix.normalize(value);
  if (
    value.length === 0 ||
    value !== value.trim() ||
    value.includes('\\') ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    }) ||
    path.posix.isAbsolute(normalized) ||
    /^(?:[A-Za-z]:|~)/u.test(value) ||
    value.split('/').includes('..') ||
    normalized !== value ||
    normalized === '.' ||
    value.endsWith('/')
  ) {
    throw new Error(`${label} must be a normalized relative ref`);
  }
  return value;
}

function portableEvidenceRef(value: string, label: string, nativeRootRef?: string): string {
  const reference = portableRef(value, label);
  const sensitiveReason = nativeSensitiveRelativePathReason(reference);
  const lowerReference = reference.toLowerCase();
  const lowerNativeRoot = nativeRootRef
    ? portableRef(nativeRootRef, 'Native root ref').toLowerCase()
    : null;
  if (
    sensitiveReason ||
    lowerReference === 'runtime' ||
    lowerReference.startsWith('runtime/') ||
    (lowerNativeRoot !== null &&
      (lowerReference === lowerNativeRoot || lowerReference.startsWith(`${lowerNativeRoot}/`)))
  ) {
    throw new Error(
      `${label} is excluded as sensitive (${sensitiveReason ?? 'native-runtime'}): ${reference}`,
    );
  }
  return reference;
}

function checkReceiptRef(value: string): string {
  const reference = portableRef(value, 'Verification receipt ref');
  if (!/^runtime\/evidence\/check-receipts\/[a-f0-9]{64}\.json$/u.test(reference)) {
    throw new Error('Verification receipt ref must identify a Native check receipt');
  }
  return reference;
}

function timestamp(value: Date): string {
  const result = value.toISOString();
  if (Number.isNaN(Date.parse(result))) throw new Error('Native evidence timestamp is invalid');
  return result;
}

function acceptanceCriteriaHash(criteria: readonly NativeAcceptanceCriterion[]): string {
  return canonicalHash(
    'comet.native.acceptance-set.v1',
    [...criteria].sort((left, right) => compareText(left.id, right.id)),
  );
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Build an exact, order-independent trace. Unknown, duplicate, or missing criteria fail closed. */
export function buildNativeAcceptanceEvidenceTrace(
  criteria: readonly NativeAcceptanceCriterion[],
  evidence: readonly NativeAcceptanceEvidenceEntry[],
  options: { nativeRootRef: string },
): NativeAcceptanceEvidenceTrace {
  const nativeRootRef = portableRef(options.nativeRootRef, 'Native root ref');
  const byId = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  if (byId.size !== criteria.length)
    throw new Error('Native contract has duplicate acceptance IDs');
  const evidenceById = new Map<string, NativeAcceptanceEvidenceEntry>();
  for (const entry of evidence) {
    if (!byId.has(entry.acceptance_id)) {
      throw new Error(`Verification references unknown acceptance ID: ${entry.acceptance_id}`);
    }
    if (evidenceById.has(entry.acceptance_id)) {
      throw new Error(`Verification repeats acceptance ID: ${entry.acceptance_id}`);
    }
    evidenceById.set(entry.acceptance_id, entry);
  }
  const missing = [...byId.keys()].filter((id) => !evidenceById.has(id));
  if (missing.length > 0) {
    const shown = missing.slice(0, MISSING_ACCEPTANCE_DETAIL_LIMIT);
    const remainder = missing.length - shown.length;
    throw new Error(
      `Verification is missing ${missing.length} acceptance evidence entr${missing.length === 1 ? 'y' : 'ies'}: ${shown.join(', ')}${remainder > 0 ? `, ... (${remainder} more)` : ''}`,
    );
  }

  const entries = [...byId.values()]
    .sort((left, right) => compareText(left.id, right.id))
    .map((criterion): NativeAcceptanceTraceEntry => {
      const entry = evidenceById.get(criterion.id)!;
      const evidenceRefs = [...entry.evidence_refs]
        .map((reference) =>
          portableEvidenceRef(reference, `Evidence ref for ${criterion.id}`, nativeRootRef),
        )
        .sort();
      if (new Set(evidenceRefs).size !== evidenceRefs.length) {
        throw new Error(`Verification repeats an evidence ref for ${criterion.id}`);
      }
      const rawSkippedReason = entry.skipped_reason?.trim() || null;
      const skippedReason =
        rawSkippedReason === null
          ? null
          : requiredText(rawSkippedReason, `Skipped reason for ${criterion.id}`);
      if ((evidenceRefs.length === 0) === (skippedReason === null)) {
        throw new Error(
          `Acceptance ${criterion.id} requires exactly one of evidence refs or skipped reason`,
        );
      }
      return {
        acceptanceId: criterion.id,
        kind: criterion.kind,
        source: portableRef(criterion.source, `Acceptance source for ${criterion.id}`),
        evidenceRefs,
        skippedReason,
      };
    });
  const criteriaHash = acceptanceCriteriaHash(criteria);
  const content = {
    schema: 'comet.native.acceptance-trace.v1' as const,
    nativeRootRef,
    criteriaHash,
    total: entries.length,
    evidenced: entries.filter((entry) => entry.evidenceRefs.length > 0).length,
    skipped: entries.filter((entry) => entry.skippedReason !== null).length,
    entries,
  };
  return {
    ...content,
    traceHash: canonicalHash(ACCEPTANCE_TRACE_HASH_TAG, content),
  };
}

export function buildNativePartialAllowance(input: {
  change: string;
  scopeBundle: NativeImplementationScopeBundle;
  allowedScopeIds: readonly string[];
  reason: string;
  confirmedSummary: string;
  sourceRevision: number;
  now?: Date;
}): NativePartialAllowance {
  const scope = parseNativeImplementationScopeBundle(input.scopeBundle).scope;
  if (scope.complete) throw new Error('Complete implementation scope cannot be partially allowed');
  const unresolved = new Set(scope.unresolvedScopes.map((entry) => entry.id));
  if (new Set(input.allowedScopeIds).size !== input.allowedScopeIds.length) {
    throw new Error('Partial allowance has duplicate allowed scope IDs');
  }
  const scopeIds = [...input.allowedScopeIds].sort(compareText);
  if (scopeIds.length === 0) throw new Error('Partial allowance requires at least one scope ID');
  if ([...unresolved, ...scopeIds].some((id) => !/^scope:[a-f0-9]{64}$/u.test(id))) {
    throw new Error('Partial allowance scope IDs are invalid');
  }
  const unknown = scopeIds.filter((id) => !unresolved.has(id));
  const missing = [...unresolved].filter((id) => !scopeIds.includes(id));
  if (unknown.length > 0) throw new Error(`Partial allowance has unknown scope IDs: ${unknown}`);
  if (missing.length > 0) throw new Error(`Partial allowance is missing scope IDs: ${missing}`);

  const content = {
    schema: 'comet.native.partial-allowance.v1' as const,
    change: changeName(input.change),
    scopeHash: scope.scopeHash,
    scopeIds,
    reason: requiredText(input.reason, 'Partial allowance reason'),
    confirmedSummary: requiredText(input.confirmedSummary, 'Partial allowance confirmation'),
    sourceRevision: positiveRevision(input.sourceRevision),
    confirmedAt: timestamp(input.now ?? new Date()),
  };
  return {
    ...content,
    allowanceHash: canonicalHash(PARTIAL_ALLOWANCE_HASH_TAG, content),
  };
}

export function buildNativeVerificationEvidenceEnvelope(input: {
  change: string;
  sourceRevision: number;
  result: 'pass' | 'fail';
  contractHash: string;
  acceptanceHash: string;
  implementationScope: { ref: string; bundle: NativeImplementationScopeBundle };
  reportRef: string;
  reportHash: string;
  acceptanceTrace: NativeAcceptanceEvidenceTrace;
  partialAllowance?: { ref: string; allowance: NativePartialAllowance } | null;
  receiptRef?: string | null;
  now?: Date;
}): NativeVerificationEvidenceEnvelope {
  if (input.result !== 'pass' && input.result !== 'fail') {
    throw new Error('Native verification evidence result is invalid');
  }
  const acceptanceTrace = parseNativeAcceptanceEvidenceTrace(input.acceptanceTrace);
  const implementationScope = parseNativeImplementationScopeBundle(
    input.implementationScope.bundle,
  ).scope;
  const implementationScopeRef = evidenceDocumentRef(
    input.implementationScope.ref,
    'scopes',
    implementationScope.scopeHash,
  );
  if (implementationScope.contractHash !== input.contractHash) {
    throw new Error('Implementation scope does not match the verification contract');
  }
  const allowanceInput = input.partialAllowance ?? null;
  const parsedAllowance = allowanceInput
    ? parseNativePartialAllowance(allowanceInput.allowance)
    : null;
  const allowance =
    allowanceInput && parsedAllowance
      ? {
          ref: evidenceDocumentRef(allowanceInput.ref, 'allowances', parsedAllowance.allowanceHash),
          allowance: parsedAllowance,
        }
      : null;
  if (implementationScope.complete && allowance !== null) {
    throw new Error('Complete implementation scope must not use a partial allowance');
  }
  if (!implementationScope.complete && allowance === null) {
    throw new Error('Partial implementation scope requires a confirmed allowance');
  }
  const unresolvedScopeIds = implementationScope.unresolvedScopes
    .map((entry) => entry.id)
    .sort(compareText);
  if (
    allowance &&
    (allowance.allowance.change !== input.change ||
      allowance.allowance.scopeHash !== implementationScope.scopeHash ||
      JSON.stringify(allowance.allowance.scopeIds) !== JSON.stringify(unresolvedScopeIds))
  ) {
    throw new Error('Partial allowance does not match the verification scope');
  }
  if (acceptanceTrace.criteriaHash !== input.acceptanceHash) {
    throw new Error('Acceptance trace does not match the verification contract');
  }
  if (allowance && allowance.allowance.sourceRevision >= input.sourceRevision) {
    throw new Error('Partial allowance must precede the verification evidence revision');
  }

  const content = {
    schema: 'comet.native.verification-evidence.v1' as const,
    change: changeName(input.change),
    sourceRevision: positiveRevision(input.sourceRevision),
    result: input.result,
    freshness: implementationScope.complete ? ('complete' as const) : ('partial' as const),
    contractHash: hash(input.contractHash, 'Verification contractHash'),
    acceptanceCriteriaHash: hash(input.acceptanceHash, 'Verification acceptanceHash'),
    implementationScopeRef,
    implementationScopeHash: implementationScope.scopeHash,
    reportRef: portableEvidenceRef(input.reportRef, 'Verification report ref'),
    reportHash: hash(input.reportHash, 'Verification report hash'),
    acceptanceTrace,
    partialAllowanceRef: allowance?.ref ?? null,
    partialAllowanceHash: allowance?.allowance.allowanceHash ?? null,
    receiptRef: input.receiptRef ? checkReceiptRef(input.receiptRef) : null,
    createdAt: timestamp(input.now ?? new Date()),
  };
  return {
    ...content,
    envelopeHash: canonicalHash(VERIFICATION_ENVELOPE_HASH_TAG, content),
  };
}

function evidenceRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactEvidenceKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const expected = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in value));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}`);
  if (missing.length > 0) throw new Error(`${label} is missing field(s): ${missing.join(', ')}`);
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is invalid`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function evidenceDocumentRef(value: unknown, kind: 'scopes' | 'allowances', hash: string): string {
  if (typeof value !== 'string') throw new Error(`Native ${kind} evidence ref is invalid`);
  const expected = `runtime/evidence/${kind}/${hash}.json`;
  if (value !== expected) throw new Error(`Native ${kind} evidence ref/hash mismatch`);
  return value;
}

export function parseNativeAcceptanceEvidenceTrace(value: unknown): NativeAcceptanceEvidenceTrace {
  const root = evidenceRecord(value, 'Native acceptance trace');
  exactEvidenceKeys(
    root,
    [
      'schema',
      'nativeRootRef',
      'criteriaHash',
      'total',
      'evidenced',
      'skipped',
      'entries',
      'traceHash',
    ],
    'Native acceptance trace',
  );
  if (
    root.schema !== 'comet.native.acceptance-trace.v1' ||
    typeof root.nativeRootRef !== 'string' ||
    typeof root.criteriaHash !== 'string' ||
    !HASH_PATTERN.test(root.criteriaHash) ||
    !Number.isSafeInteger(root.total) ||
    !Number.isSafeInteger(root.evidenced) ||
    !Number.isSafeInteger(root.skipped) ||
    !Array.isArray(root.entries)
  ) {
    throw new Error('Native acceptance trace is invalid');
  }
  const nativeRootRef = portableRef(root.nativeRootRef as string, 'Native root ref');
  const entries = root.entries.map((value, index): NativeAcceptanceTraceEntry => {
    const entry = evidenceRecord(value, `Native acceptance trace entry ${index}`);
    exactEvidenceKeys(
      entry,
      ['acceptanceId', 'kind', 'source', 'evidenceRefs', 'skippedReason'],
      `Native acceptance trace entry ${index}`,
    );
    if (
      typeof entry.acceptanceId !== 'string' ||
      !/^acceptance-[a-f0-9]{64}$/u.test(entry.acceptanceId) ||
      (entry.kind !== 'brief-example' && entry.kind !== 'spec-scenario') ||
      typeof entry.source !== 'string' ||
      !Array.isArray(entry.evidenceRefs) ||
      entry.evidenceRefs.some((reference) => typeof reference !== 'string') ||
      (entry.skippedReason !== null &&
        (typeof entry.skippedReason !== 'string' ||
          entry.skippedReason.length === 0 ||
          entry.skippedReason.trim() !== entry.skippedReason))
    ) {
      throw new Error(`Native acceptance trace entry ${index} is invalid`);
    }
    const evidenceRefs = (entry.evidenceRefs as string[]).map((reference) =>
      portableEvidenceRef(
        reference,
        `Native acceptance trace entry ${index} evidence ref`,
        nativeRootRef,
      ),
    );
    if (
      JSON.stringify(evidenceRefs) !==
        JSON.stringify([...new Set(evidenceRefs)].sort(compareText)) ||
      (evidenceRefs.length === 0) === (entry.skippedReason === null)
    ) {
      throw new Error(`Native acceptance trace entry ${index} evidence state is invalid`);
    }
    return {
      acceptanceId: entry.acceptanceId,
      kind: entry.kind,
      source: portableRef(entry.source, `Native acceptance trace entry ${index} source`),
      evidenceRefs,
      skippedReason:
        entry.skippedReason === null
          ? null
          : requiredText(
              entry.skippedReason as string,
              `Native acceptance trace entry ${index} skipped reason`,
            ),
    };
  });
  if (
    JSON.stringify(entries) !==
      JSON.stringify(
        [...entries].sort((left, right) => compareText(left.acceptanceId, right.acceptanceId)),
      ) ||
    new Set(entries.map((entry) => entry.acceptanceId)).size !== entries.length ||
    root.total !== entries.length ||
    root.evidenced !== entries.filter((entry) => entry.evidenceRefs.length > 0).length ||
    root.skipped !== entries.filter((entry) => entry.skippedReason !== null).length
  ) {
    throw new Error('Native acceptance trace entries are inconsistent');
  }
  const content = {
    schema: 'comet.native.acceptance-trace.v1' as const,
    nativeRootRef,
    criteriaHash: root.criteriaHash,
    total: root.total,
    evidenced: root.evidenced,
    skipped: root.skipped,
    entries,
  };
  const traceHash = hash(root.traceHash as string, 'Native acceptance trace hash');
  if (canonicalHash(ACCEPTANCE_TRACE_HASH_TAG, content) !== traceHash) {
    throw new Error('Native acceptance trace content hash mismatch');
  }
  return { ...content, traceHash };
}

export function parseNativePartialAllowance(value: unknown): NativePartialAllowance {
  const root = evidenceRecord(value, 'Native partial allowance');
  exactEvidenceKeys(
    root,
    [
      'schema',
      'change',
      'scopeHash',
      'scopeIds',
      'reason',
      'confirmedSummary',
      'sourceRevision',
      'confirmedAt',
      'allowanceHash',
    ],
    'Native partial allowance',
  );
  if (
    root.schema !== 'comet.native.partial-allowance.v1' ||
    typeof root.change !== 'string' ||
    typeof root.scopeHash !== 'string' ||
    !Array.isArray(root.scopeIds) ||
    root.scopeIds.length === 0 ||
    root.scopeIds.some((id) => typeof id !== 'string' || !/^scope:[a-f0-9]{64}$/u.test(id)) ||
    JSON.stringify(root.scopeIds) !==
      JSON.stringify([...new Set(root.scopeIds as string[])].sort(compareText)) ||
    typeof root.reason !== 'string' ||
    typeof root.confirmedSummary !== 'string'
  ) {
    throw new Error('Native partial allowance is invalid');
  }
  const content = {
    schema: 'comet.native.partial-allowance.v1' as const,
    change: changeName(root.change),
    scopeHash: hash(root.scopeHash, 'Native partial allowance scopeHash'),
    scopeIds: root.scopeIds as string[],
    reason: requiredText(root.reason, 'Partial allowance reason'),
    confirmedSummary: requiredText(root.confirmedSummary, 'Partial allowance confirmation'),
    sourceRevision: positiveRevision(root.sourceRevision as number),
    confirmedAt: canonicalTimestamp(root.confirmedAt, 'Native partial allowance timestamp'),
  };
  if (content.reason !== root.reason || content.confirmedSummary !== root.confirmedSummary) {
    throw new Error('Native partial allowance text is not canonical');
  }
  const allowanceHash = hash(root.allowanceHash as string, 'Native partial allowance hash');
  if (canonicalHash(PARTIAL_ALLOWANCE_HASH_TAG, content) !== allowanceHash) {
    throw new Error('Native partial allowance content hash mismatch');
  }
  return { ...content, allowanceHash };
}

export function parseNativeVerificationEvidenceEnvelope(
  value: unknown,
): NativeVerificationEvidenceEnvelope {
  const root = evidenceRecord(value, 'Native verification evidence');
  exactEvidenceKeys(
    root,
    [
      'schema',
      'change',
      'sourceRevision',
      'result',
      'freshness',
      'contractHash',
      'acceptanceCriteriaHash',
      'implementationScopeRef',
      'implementationScopeHash',
      'reportRef',
      'reportHash',
      'acceptanceTrace',
      'partialAllowanceRef',
      'partialAllowanceHash',
      'receiptRef',
      'createdAt',
      'envelopeHash',
    ],
    'Native verification evidence',
  );
  if (
    root.schema !== 'comet.native.verification-evidence.v1' ||
    typeof root.change !== 'string' ||
    (root.result !== 'pass' && root.result !== 'fail') ||
    (root.freshness !== 'complete' && root.freshness !== 'partial') ||
    typeof root.implementationScopeHash !== 'string' ||
    typeof root.reportRef !== 'string' ||
    (root.receiptRef !== null && typeof root.receiptRef !== 'string')
  ) {
    throw new Error('Native verification evidence is invalid');
  }
  const implementationScopeHash = hash(
    root.implementationScopeHash,
    'Native verification implementation scope hash',
  );
  const acceptanceTrace = parseNativeAcceptanceEvidenceTrace(root.acceptanceTrace);
  const acceptanceCriteriaHash = hash(
    root.acceptanceCriteriaHash as string,
    'Native verification acceptance criteria hash',
  );
  if (acceptanceTrace.criteriaHash !== acceptanceCriteriaHash) {
    throw new Error('Native verification acceptance trace does not match its criteria hash');
  }
  const hasAllowance = root.partialAllowanceRef !== null || root.partialAllowanceHash !== null;
  if (
    (root.partialAllowanceRef === null) !== (root.partialAllowanceHash === null) ||
    (root.freshness === 'complete' && hasAllowance) ||
    (root.freshness === 'partial' && !hasAllowance)
  ) {
    throw new Error('Native verification partial allowance state is invalid');
  }
  const partialAllowanceHash =
    root.partialAllowanceHash === null
      ? null
      : hash(root.partialAllowanceHash as string, 'Native verification allowance hash');
  const result: NativeVerificationEvidenceEnvelope['result'] = root.result;
  const freshness: NativeVerificationEvidenceEnvelope['freshness'] = root.freshness;
  const content = {
    schema: 'comet.native.verification-evidence.v1' as const,
    change: changeName(root.change),
    sourceRevision: positiveRevision(root.sourceRevision as number),
    result,
    freshness,
    contractHash: hash(root.contractHash as string, 'Native verification contract hash'),
    acceptanceCriteriaHash,
    implementationScopeRef: evidenceDocumentRef(
      root.implementationScopeRef,
      'scopes',
      implementationScopeHash,
    ),
    implementationScopeHash,
    reportRef: portableEvidenceRef(root.reportRef, 'Native verification report ref'),
    reportHash: hash(root.reportHash as string, 'Native verification report hash'),
    acceptanceTrace,
    partialAllowanceRef:
      partialAllowanceHash === null
        ? null
        : evidenceDocumentRef(root.partialAllowanceRef, 'allowances', partialAllowanceHash),
    partialAllowanceHash,
    receiptRef: root.receiptRef === null ? null : checkReceiptRef(root.receiptRef),
    createdAt: canonicalTimestamp(root.createdAt, 'Native verification timestamp'),
  };
  const envelopeHash = hash(root.envelopeHash as string, 'Native verification envelope hash');
  if (canonicalHash(VERIFICATION_ENVELOPE_HASH_TAG, content) !== envelopeHash) {
    throw new Error('Native verification evidence content hash mismatch');
  }
  return { ...content, envelopeHash };
}
