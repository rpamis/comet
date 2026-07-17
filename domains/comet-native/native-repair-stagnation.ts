import { canonicalHash } from './native-canonical-hash.js';

export const NATIVE_REPAIR_SIGNATURE_SCHEMA = 'comet.native.repair-signature.v1' as const;
export const NATIVE_REPAIR_STAGNATION_LIMITS = {
  warningAtConsecutiveFailures: 2,
  manualStopAtConsecutiveFailures: 3,
  maxRepairIterations: 12,
  maxHistoryRecords: 64,
  maxCategories: 16,
  maxFailedCheckIds: 128,
  maxOverrideSummaryCharacters: 2_000,
} as const;

const SIGNATURE_HASH_TAG = 'comet.native.repair-signature.v1';
const OVERRIDE_SUMMARY_HASH_TAG = 'comet.native.repair-override-summary.v1';
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,255}$/u;

export interface NativeRepairFailureFacts {
  contractHash: string;
  implementationScopeHash: string;
  artifactSnapshotHash: string;
  categories: readonly string[];
  failedCheckIds: readonly string[];
}

export interface NativeRepairSignature {
  schema: typeof NATIVE_REPAIR_SIGNATURE_SCHEMA;
  contractHash: string;
  implementationScopeHash: string;
  artifactSnapshotHash: string;
  categories: string[];
  failedCheckIds: string[];
  signatureHash: string;
}

export interface NativeRepairFailureRecord {
  kind: 'failure';
  revision: number;
  iteration: number;
  signatureHash: string;
}

export interface NativeRepairOverrideRecord {
  kind: 'override';
  revision: number;
  iteration: number;
  signatureHash: string;
  summaryHash: string;
}

export type NativeRepairHistoryRecord = NativeRepairFailureRecord | NativeRepairOverrideRecord;

export interface NativeRepairOverrideRequest {
  expectedSignatureHash: string;
  summary: string;
}

export interface NativeRepairStagnationDecision {
  disposition: 'continue' | 'warn' | 'manual-stop' | 'hard-stop';
  reasonCode:
    | 'new-failure-signature'
    | 'repeated-failure-warning'
    | 'repeated-failure-stop'
    | 'override-accepted'
    | 'override-already-used'
    | 'repair-iteration-limit';
  signature: NativeRepairSignature;
  consecutiveFailures: number;
  totalRepairFailures: number;
  remainingIterations: number;
  overrideAccepted: boolean;
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

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function normalizedTokens(
  values: readonly string[],
  label: string,
  max: number,
  allowEmpty: boolean,
): string[] {
  if (!Array.isArray(values) || values.length > max || (!allowEmpty && values.length === 0)) {
    throw new Error(`${label} exceeds its count boundary`);
  }
  const tokens = values.map((value) => {
    if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
      throw new Error(`${label} contains an invalid token: ${String(value)}`);
    }
    return value;
  });
  return [...new Set(tokens)].sort(compareText);
}

export function normalizeNativeRepairFailureTokens(options: {
  categories?: readonly string[];
  failedCheckIds?: readonly string[];
}): { categories: string[]; failedCheckIds: string[] } {
  const categories =
    options.categories && options.categories.length > 0
      ? options.categories
      : ['verification-failed'];
  return {
    categories: normalizedTokens(
      categories,
      'Native repair categories',
      NATIVE_REPAIR_STAGNATION_LIMITS.maxCategories,
      false,
    ),
    failedCheckIds: normalizedTokens(
      options.failedCheckIds ?? [],
      'Native repair failed check IDs',
      NATIVE_REPAIR_STAGNATION_LIMITS.maxFailedCheckIds,
      true,
    ),
  };
}

export function buildNativeRepairSignature(facts: NativeRepairFailureFacts): NativeRepairSignature {
  const tokens = normalizeNativeRepairFailureTokens(facts);
  const content = {
    schema: NATIVE_REPAIR_SIGNATURE_SCHEMA,
    contractHash: hash(facts.contractHash, 'Native repair contract hash'),
    implementationScopeHash: hash(
      facts.implementationScopeHash,
      'Native repair implementation scope hash',
    ),
    artifactSnapshotHash: hash(facts.artifactSnapshotHash, 'Native repair artifact snapshot hash'),
    categories: tokens.categories,
    failedCheckIds: tokens.failedCheckIds,
  };
  return {
    ...content,
    signatureHash: canonicalHash(SIGNATURE_HASH_TAG, content),
  };
}

function normalizeHistory(
  history: readonly NativeRepairHistoryRecord[],
): NativeRepairHistoryRecord[] {
  if (
    !Array.isArray(history) ||
    history.length > NATIVE_REPAIR_STAGNATION_LIMITS.maxHistoryRecords
  ) {
    throw new Error('Native repair history exceeds its record boundary');
  }
  let previousIteration = 0;
  let previousRevision = 0;
  return history.map((record, index) => {
    if (!record || (record.kind !== 'failure' && record.kind !== 'override')) {
      throw new Error(`Native repair history record ${index} is invalid`);
    }
    const expectedKeys =
      record.kind === 'failure'
        ? ['iteration', 'kind', 'revision', 'signatureHash']
        : ['iteration', 'kind', 'revision', 'signatureHash', 'summaryHash'];
    const keys = Object.keys(record).sort(compareText);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key, keyIndex) => key !== expectedKeys[keyIndex])
    ) {
      throw new Error(`Native repair history record ${index} fields are invalid`);
    }
    const iteration = positiveInteger(record.iteration, `Native repair history ${index} iteration`);
    const revision = positiveInteger(record.revision, `Native repair history ${index} revision`);
    const previous = index > 0 ? history[index - 1] : null;
    const pairedOverride =
      record.kind === 'override' &&
      previous?.kind === 'failure' &&
      iteration === previousIteration &&
      revision >= previousRevision &&
      record.signatureHash === previous.signatureHash;
    if (!pairedOverride && (iteration <= previousIteration || revision <= previousRevision)) {
      throw new Error('Native repair history must be strictly ordered by revision and iteration');
    }
    previousIteration = iteration;
    previousRevision = revision;
    const signatureHash = hash(record.signatureHash, `Native repair history ${index} signature`);
    if (record.kind === 'failure') return { kind: 'failure', iteration, revision, signatureHash };
    return {
      kind: 'override',
      iteration,
      revision,
      signatureHash,
      summaryHash: hash(record.summaryHash, `Native repair history ${index} summary`),
    };
  });
}

function overrideSummary(value: string): string {
  const summary = value.trim();
  if (
    summary.length === 0 ||
    summary.length > NATIVE_REPAIR_STAGNATION_LIMITS.maxOverrideSummaryCharacters
  ) {
    throw new Error('Native repair override summary is invalid');
  }
  return summary;
}

export function hashNativeRepairOverrideSummary(summary: string): string {
  return canonicalHash(OVERRIDE_SUMMARY_HASH_TAG, {
    summary: overrideSummary(summary),
  });
}

/**
 * Decide an override for a failure that was already committed as a manual stop.
 *
 * Unlike `decideNativeRepairStagnation`, this function does not add another failure attempt. The
 * accepted override belongs to the following Build-to-Verify transition.
 */
export function decideNativeRepairOverride(options: {
  facts: NativeRepairFailureFacts;
  history: readonly NativeRepairHistoryRecord[];
  override: NativeRepairOverrideRequest;
}): NativeRepairStagnationDecision {
  const signature = buildNativeRepairSignature(options.facts);
  const history = normalizeHistory(options.history);
  const failures = history.filter(
    (record): record is NativeRepairFailureRecord => record.kind === 'failure',
  );
  const totalRepairFailures = failures.length;
  const remainingIterations = Math.max(
    0,
    NATIVE_REPAIR_STAGNATION_LIMITS.maxRepairIterations - totalRepairFailures,
  );
  let consecutiveFailures = 0;
  for (let index = failures.length - 1; index >= 0; index -= 1) {
    if (failures[index].signatureHash !== signature.signatureHash) break;
    consecutiveFailures += 1;
  }
  if (totalRepairFailures >= NATIVE_REPAIR_STAGNATION_LIMITS.maxRepairIterations) {
    return {
      disposition: 'hard-stop',
      reasonCode: 'repair-iteration-limit',
      signature,
      consecutiveFailures,
      totalRepairFailures,
      remainingIterations,
      overrideAccepted: false,
    };
  }
  if (
    failures.at(-1)?.signatureHash !== signature.signatureHash ||
    consecutiveFailures < NATIVE_REPAIR_STAGNATION_LIMITS.manualStopAtConsecutiveFailures
  ) {
    throw new Error('Native repair override is only available for the latest manual stop');
  }
  const expected = hash(
    options.override.expectedSignatureHash,
    'Native repair override expected signature',
  );
  if (expected !== signature.signatureHash) {
    throw new Error('Native repair override does not match the current failure signature');
  }
  overrideSummary(options.override.summary);
  const alreadyUsed = history.some(
    (record) => record.kind === 'override' && record.signatureHash === signature.signatureHash,
  );
  return {
    disposition: alreadyUsed ? 'manual-stop' : 'continue',
    reasonCode: alreadyUsed ? 'override-already-used' : 'override-accepted',
    signature,
    consecutiveFailures,
    totalRepairFailures,
    remainingIterations,
    overrideAccepted: !alreadyUsed,
  };
}

/**
 * Decide whether another Verify-fail repair loop is useful.
 *
 * The caller persists failure/override events; this pure function never weakens a test, changes a
 * phase, or invents a pass result.
 */
export function decideNativeRepairStagnation(options: {
  facts: NativeRepairFailureFacts;
  history: readonly NativeRepairHistoryRecord[];
  override?: NativeRepairOverrideRequest | null;
}): NativeRepairStagnationDecision {
  const signature = buildNativeRepairSignature(options.facts);
  const history = normalizeHistory(options.history);
  const failures = history.filter(
    (record): record is NativeRepairFailureRecord => record.kind === 'failure',
  );
  const totalRepairFailures = failures.length + 1;
  const remainingIterations = Math.max(
    0,
    NATIVE_REPAIR_STAGNATION_LIMITS.maxRepairIterations - totalRepairFailures,
  );
  let consecutiveFailures = 1;
  for (let index = failures.length - 1; index >= 0; index -= 1) {
    if (failures[index].signatureHash !== signature.signatureHash) break;
    consecutiveFailures += 1;
  }
  if (totalRepairFailures >= NATIVE_REPAIR_STAGNATION_LIMITS.maxRepairIterations) {
    return {
      disposition: 'hard-stop',
      reasonCode: 'repair-iteration-limit',
      signature,
      consecutiveFailures,
      totalRepairFailures,
      remainingIterations,
      overrideAccepted: false,
    };
  }
  if (consecutiveFailures < NATIVE_REPAIR_STAGNATION_LIMITS.warningAtConsecutiveFailures) {
    return {
      disposition: 'continue',
      reasonCode: 'new-failure-signature',
      signature,
      consecutiveFailures,
      totalRepairFailures,
      remainingIterations,
      overrideAccepted: false,
    };
  }
  if (consecutiveFailures < NATIVE_REPAIR_STAGNATION_LIMITS.manualStopAtConsecutiveFailures) {
    return {
      disposition: 'warn',
      reasonCode: 'repeated-failure-warning',
      signature,
      consecutiveFailures,
      totalRepairFailures,
      remainingIterations,
      overrideAccepted: false,
    };
  }
  if (options.override) {
    const expected = hash(
      options.override.expectedSignatureHash,
      'Native repair override expected signature',
    );
    if (expected !== signature.signatureHash) {
      throw new Error('Native repair override does not match the current failure signature');
    }
    overrideSummary(options.override.summary);
    const alreadyUsed = history.some(
      (record) => record.kind === 'override' && record.signatureHash === signature.signatureHash,
    );
    return {
      disposition: alreadyUsed ? 'manual-stop' : 'continue',
      reasonCode: alreadyUsed ? 'override-already-used' : 'override-accepted',
      signature,
      consecutiveFailures,
      totalRepairFailures,
      remainingIterations,
      overrideAccepted: !alreadyUsed,
    };
  }
  const alreadyUsed = history.some(
    (record) => record.kind === 'override' && record.signatureHash === signature.signatureHash,
  );
  return {
    disposition: 'manual-stop',
    reasonCode: alreadyUsed ? 'override-already-used' : 'repeated-failure-stop',
    signature,
    consecutiveFailures,
    totalRepairFailures,
    remainingIterations,
    overrideAccepted: false,
  };
}
