import path from 'node:path';

import { canonicalHash } from './native-canonical-hash.js';

export const NATIVE_CHECK_RECEIPT_SCHEMA = 'comet.native.check-receipt.v1' as const;
export const NATIVE_CHECK_RECEIPT_HASH_TAG = 'comet.native.check-receipt.v1';
export const NATIVE_CHECK_POLICY = 'scoped-text-safety' as const;
export const NATIVE_CHECK_POLICY_VERSION = 1 as const;
export const NATIVE_CHECK_LIMITS = Object.freeze({
  maxFiles: 256,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxIssues: 128,
} as const);

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const CHANGE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const CHECKER_HASH_TAG = 'comet.native.checker-policy.v1';
const CHECK_INPUT_HASH_TAG = 'comet.native.check-input.v1';
const MAX_ISSUE_PATH_BYTES = 2_048;

export const NATIVE_CHECKER_HASH = canonicalHash(CHECKER_HASH_TAG, {
  policy: NATIVE_CHECK_POLICY,
  version: NATIVE_CHECK_POLICY_VERSION,
  limits: NATIVE_CHECK_LIMITS,
  checks: ['conflict-marker', 'space-before-tab', 'trailing-whitespace'],
  binaryHandling: 'skip-and-count',
});

export type NativeCheckReceiptStatus = 'passed' | 'failed';
export type NativeCheckIssueKind =
  | 'conflict-marker'
  | 'trailing-whitespace'
  | 'space-before-tab'
  | 'scope-mismatch'
  | 'unsafe-file'
  | 'scan-limit';

export type NativeCheckReceiptStaleReason =
  | 'contract-before-does-not-match-scope'
  | 'implementation-before-does-not-match-scope'
  | 'contract-changed-during-check'
  | 'implementation-changed-during-check'
  | 'contract-after-does-not-match-scope'
  | 'implementation-after-does-not-match-scope';

export interface NativeCheckIssue {
  path: string;
  line: number;
  kind: NativeCheckIssueKind;
}

export interface NativeCheckReceipt {
  schema: typeof NATIVE_CHECK_RECEIPT_SCHEMA;
  change: string;
  sourceRevision: number;
  checker: {
    policy: typeof NATIVE_CHECK_POLICY;
    version: typeof NATIVE_CHECK_POLICY_VERSION;
    hash: string;
    limits: typeof NATIVE_CHECK_LIMITS;
  };
  inputHash: string;
  status: NativeCheckReceiptStatus;
  startedAt: string;
  endedAt: string;
  contract: {
    expectedHash: string;
    beforeHash: string;
    afterHash: string;
  };
  implementation: {
    scopeHash: string;
    expectedSnapshotHash: string;
    beforeSnapshotHash: string;
    afterSnapshotHash: string;
  };
  counts: {
    filesSelected: number;
    filesScanned: number;
    binaryFilesSkipped: number;
    bytesScanned: number;
    issueCount: number;
    recordedIssueCount: number;
  };
  issues: NativeCheckIssue[];
  issuesTruncated: boolean;
  stale: boolean;
  staleReasons: NativeCheckReceiptStaleReason[];
  receiptHash: string;
}

export type NativeCheckReceiptBuildInput = Omit<
  NativeCheckReceipt,
  'schema' | 'checker' | 'inputHash' | 'receiptHash'
>;
type NativeCheckReceiptContent = Omit<NativeCheckReceipt, 'receiptHash'>;

const ISSUE_KINDS = new Set<NativeCheckIssueKind>([
  'conflict-marker',
  'trailing-whitespace',
  'space-before-tab',
  'scope-mismatch',
  'unsafe-file',
  'scan-limit',
]);
const ISSUE_KIND_ORDER: readonly NativeCheckIssueKind[] = [
  'conflict-marker',
  'trailing-whitespace',
  'space-before-tab',
  'scope-mismatch',
  'unsafe-file',
  'scan-limit',
];
const STALE_REASON_ORDER: readonly NativeCheckReceiptStaleReason[] = [
  'contract-before-does-not-match-scope',
  'implementation-before-does-not-match-scope',
  'contract-changed-during-check',
  'implementation-changed-during-check',
  'contract-after-does-not-match-scope',
  'implementation-after-does-not-match-scope',
];
const STALE_REASONS = new Set(STALE_REASON_ORDER);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = new Set(expected);
  const unknown = Object.keys(value).filter((key) => !keys.has(key));
  const missing = expected.filter((key) => !(key in value));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}`);
  if (missing.length > 0) throw new Error(`${label} is missing field(s): ${missing.join(', ')}`);
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error(`${label} must be a SHA-256 hash`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = nonNegativeInteger(value, label);
  if (parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function isoTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be an ISO timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

function projectRelativePath(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAX_ISSUE_PATH_BYTES ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.endsWith('/') ||
    /^[a-zA-Z]:/u.test(value)
  ) {
    throw new Error(`${label} must be a bounded normalized project-relative path`);
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

function parseChecker(value: unknown): NativeCheckReceipt['checker'] {
  const checker = record(value, 'Native check receipt checker');
  exactKeys(checker, ['policy', 'version', 'hash', 'limits'], 'Native check receipt checker');
  const limits = record(checker.limits, 'Native check receipt limits');
  exactKeys(
    limits,
    ['maxFiles', 'maxFileBytes', 'maxTotalBytes', 'maxIssues'],
    'Native check receipt limits',
  );
  if (
    checker.policy !== NATIVE_CHECK_POLICY ||
    checker.version !== NATIVE_CHECK_POLICY_VERSION ||
    checker.hash !== NATIVE_CHECKER_HASH ||
    limits.maxFiles !== NATIVE_CHECK_LIMITS.maxFiles ||
    limits.maxFileBytes !== NATIVE_CHECK_LIMITS.maxFileBytes ||
    limits.maxTotalBytes !== NATIVE_CHECK_LIMITS.maxTotalBytes ||
    limits.maxIssues !== NATIVE_CHECK_LIMITS.maxIssues
  ) {
    throw new Error('Native check receipt checker policy is unsupported');
  }
  return {
    policy: NATIVE_CHECK_POLICY,
    version: NATIVE_CHECK_POLICY_VERSION,
    hash: NATIVE_CHECKER_HASH,
    limits: { ...NATIVE_CHECK_LIMITS },
  };
}

function parseContract(value: unknown): NativeCheckReceipt['contract'] {
  const contract = record(value, 'Native check receipt contract');
  exactKeys(contract, ['expectedHash', 'beforeHash', 'afterHash'], 'Native check receipt contract');
  return {
    expectedHash: hash(contract.expectedHash, 'Native check expected contract hash'),
    beforeHash: hash(contract.beforeHash, 'Native check before contract hash'),
    afterHash: hash(contract.afterHash, 'Native check after contract hash'),
  };
}

function parseImplementation(value: unknown): NativeCheckReceipt['implementation'] {
  const implementation = record(value, 'Native check receipt implementation');
  exactKeys(
    implementation,
    ['scopeHash', 'expectedSnapshotHash', 'beforeSnapshotHash', 'afterSnapshotHash'],
    'Native check receipt implementation',
  );
  return {
    scopeHash: hash(implementation.scopeHash, 'Native check scope hash'),
    expectedSnapshotHash: hash(
      implementation.expectedSnapshotHash,
      'Native check expected snapshot hash',
    ),
    beforeSnapshotHash: hash(
      implementation.beforeSnapshotHash,
      'Native check before snapshot hash',
    ),
    afterSnapshotHash: hash(implementation.afterSnapshotHash, 'Native check after snapshot hash'),
  };
}

function parseCounts(value: unknown): NativeCheckReceipt['counts'] {
  const counts = record(value, 'Native check receipt counts');
  exactKeys(
    counts,
    [
      'filesSelected',
      'filesScanned',
      'binaryFilesSkipped',
      'bytesScanned',
      'issueCount',
      'recordedIssueCount',
    ],
    'Native check receipt counts',
  );
  const parsed = {
    filesSelected: nonNegativeInteger(counts.filesSelected, 'Native check filesSelected'),
    filesScanned: nonNegativeInteger(counts.filesScanned, 'Native check filesScanned'),
    binaryFilesSkipped: nonNegativeInteger(
      counts.binaryFilesSkipped,
      'Native check binaryFilesSkipped',
    ),
    bytesScanned: nonNegativeInteger(counts.bytesScanned, 'Native check bytesScanned'),
    issueCount: nonNegativeInteger(counts.issueCount, 'Native check issueCount'),
    recordedIssueCount: nonNegativeInteger(
      counts.recordedIssueCount,
      'Native check recordedIssueCount',
    ),
  };
  if (
    parsed.filesScanned + parsed.binaryFilesSkipped > parsed.filesSelected ||
    parsed.filesScanned + parsed.binaryFilesSkipped > NATIVE_CHECK_LIMITS.maxFiles ||
    parsed.bytesScanned > NATIVE_CHECK_LIMITS.maxTotalBytes ||
    parsed.recordedIssueCount > parsed.issueCount ||
    parsed.recordedIssueCount > NATIVE_CHECK_LIMITS.maxIssues
  ) {
    throw new Error('Native check receipt count accounting is invalid');
  }
  return parsed;
}

function compareIssues(left: NativeCheckIssue, right: NativeCheckIssue): number {
  return (
    left.path.localeCompare(right.path, 'en') ||
    left.line - right.line ||
    ISSUE_KIND_ORDER.indexOf(left.kind) - ISSUE_KIND_ORDER.indexOf(right.kind)
  );
}

function parseIssues(value: unknown): NativeCheckIssue[] {
  if (!Array.isArray(value) || value.length > NATIVE_CHECK_LIMITS.maxIssues) {
    throw new Error('Native check receipt issues must be a bounded array');
  }
  const issues = value.map((entry, index): NativeCheckIssue => {
    const issue = record(entry, `Native check issue ${index}`);
    exactKeys(issue, ['path', 'line', 'kind'], `Native check issue ${index}`);
    if (typeof issue.kind !== 'string' || !ISSUE_KINDS.has(issue.kind as NativeCheckIssueKind)) {
      throw new Error(`Native check issue ${index} kind is invalid`);
    }
    return {
      path: projectRelativePath(issue.path, `Native check issue ${index} path`),
      line: positiveInteger(issue.line, `Native check issue ${index} line`),
      kind: issue.kind as NativeCheckIssueKind,
    };
  });
  const canonical = [...issues].sort(compareIssues);
  if (JSON.stringify(canonical) !== JSON.stringify(issues)) {
    throw new Error('Native check receipt issues must be canonical');
  }
  return issues;
}

function parseStaleReasons(value: unknown): NativeCheckReceiptStaleReason[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (entry) =>
        typeof entry !== 'string' || !STALE_REASONS.has(entry as NativeCheckReceiptStaleReason),
    )
  ) {
    throw new Error('Native check receipt stale reasons are invalid');
  }
  const reasons = value as NativeCheckReceiptStaleReason[];
  const canonical = STALE_REASON_ORDER.filter((reason) => reasons.includes(reason));
  if (
    new Set(reasons).size !== reasons.length ||
    JSON.stringify(canonical) !== JSON.stringify(reasons)
  ) {
    throw new Error('Native check receipt stale reasons must be canonical');
  }
  return [...reasons];
}

function nativeCheckInputHash(value: {
  change: string;
  sourceRevision: number;
  checkerHash: string;
  contractHash: string;
  scopeHash: string;
  snapshotHash: string;
}): string {
  return canonicalHash(CHECK_INPUT_HASH_TAG, value);
}

/** Parse a persisted receipt and recompute all policy and content-bound identities. */
export function parseNativeCheckReceipt(value: unknown): NativeCheckReceipt {
  const receipt = record(value, 'Native check receipt');
  exactKeys(
    receipt,
    [
      'schema',
      'change',
      'sourceRevision',
      'checker',
      'inputHash',
      'status',
      'startedAt',
      'endedAt',
      'contract',
      'implementation',
      'counts',
      'issues',
      'issuesTruncated',
      'stale',
      'staleReasons',
      'receiptHash',
    ],
    'Native check receipt',
  );
  if (receipt.schema !== NATIVE_CHECK_RECEIPT_SCHEMA) {
    throw new Error('Native check receipt schema is invalid');
  }
  if (
    typeof receipt.change !== 'string' ||
    Buffer.byteLength(receipt.change, 'utf8') > 128 ||
    !CHANGE_NAME_PATTERN.test(receipt.change)
  ) {
    throw new Error('Native check receipt change name is invalid');
  }
  const sourceRevision = positiveInteger(receipt.sourceRevision, 'Native check source revision');
  const checker = parseChecker(receipt.checker);
  const contract = parseContract(receipt.contract);
  const implementation = parseImplementation(receipt.implementation);
  const expectedInputHash = nativeCheckInputHash({
    change: receipt.change,
    sourceRevision,
    checkerHash: checker.hash,
    contractHash: contract.expectedHash,
    scopeHash: implementation.scopeHash,
    snapshotHash: implementation.expectedSnapshotHash,
  });
  if (hash(receipt.inputHash, 'Native check input hash') !== expectedInputHash) {
    throw new Error('Native check receipt input hash mismatch');
  }
  if (receipt.status !== 'passed' && receipt.status !== 'failed') {
    throw new Error('Native check receipt status is invalid');
  }
  const startedAt = isoTimestamp(receipt.startedAt, 'Native check receipt startedAt');
  const endedAt = isoTimestamp(receipt.endedAt, 'Native check receipt endedAt');
  if (endedAt < startedAt) throw new Error('Native check receipt endedAt precedes startedAt');
  const counts = parseCounts(receipt.counts);
  const issues = parseIssues(receipt.issues);
  if (counts.recordedIssueCount !== issues.length) {
    throw new Error('Native check receipt recorded issue count is inconsistent');
  }
  if (
    typeof receipt.issuesTruncated !== 'boolean' ||
    receipt.issuesTruncated !== counts.issueCount > issues.length
  ) {
    throw new Error('Native check receipt issue truncation flag is inconsistent');
  }
  const staleReasons = parseStaleReasons(receipt.staleReasons);
  if (typeof receipt.stale !== 'boolean' || receipt.stale !== staleReasons.length > 0) {
    throw new Error('Native check receipt stale flag is inconsistent');
  }
  const expectedStatus: NativeCheckReceiptStatus =
    counts.issueCount === 0 && !receipt.stale ? 'passed' : 'failed';
  if (receipt.status !== expectedStatus) {
    throw new Error('Native check receipt status is inconsistent with its evidence');
  }
  if (
    receipt.status === 'passed' &&
    (counts.filesSelected > NATIVE_CHECK_LIMITS.maxFiles ||
      counts.filesScanned + counts.binaryFilesSkipped !== counts.filesSelected)
  ) {
    throw new Error('Passed Native check receipt must cover every selected file');
  }
  if (
    counts.filesSelected > NATIVE_CHECK_LIMITS.maxFiles &&
    !issues.some((issue) => issue.kind === 'scan-limit')
  ) {
    throw new Error('Native check receipt exceeds its file budget without a scan-limit issue');
  }
  const content: NativeCheckReceiptContent = {
    schema: NATIVE_CHECK_RECEIPT_SCHEMA,
    change: receipt.change,
    sourceRevision,
    checker,
    inputHash: expectedInputHash,
    status: receipt.status,
    startedAt,
    endedAt,
    contract,
    implementation,
    counts,
    issues,
    issuesTruncated: receipt.issuesTruncated,
    stale: receipt.stale,
    staleReasons,
  };
  const receiptHash = hash(receipt.receiptHash, 'Native check receipt content hash');
  if (canonicalHash(NATIVE_CHECK_RECEIPT_HASH_TAG, content) !== receiptHash) {
    throw new Error('Native check receipt content hash mismatch');
  }
  return { ...content, receiptHash };
}

export function buildNativeCheckReceipt(input: NativeCheckReceiptBuildInput): NativeCheckReceipt {
  const checker: NativeCheckReceipt['checker'] = {
    policy: NATIVE_CHECK_POLICY,
    version: NATIVE_CHECK_POLICY_VERSION,
    hash: NATIVE_CHECKER_HASH,
    limits: { ...NATIVE_CHECK_LIMITS },
  };
  const content: NativeCheckReceiptContent = {
    schema: NATIVE_CHECK_RECEIPT_SCHEMA,
    ...input,
    checker,
    inputHash: nativeCheckInputHash({
      change: input.change,
      sourceRevision: input.sourceRevision,
      checkerHash: checker.hash,
      contractHash: input.contract.expectedHash,
      scopeHash: input.implementation.scopeHash,
      snapshotHash: input.implementation.expectedSnapshotHash,
    }),
  };
  return parseNativeCheckReceipt({
    ...content,
    receiptHash: canonicalHash(NATIVE_CHECK_RECEIPT_HASH_TAG, content),
  });
}
