import { canonicalHash } from './native-canonical-hash.js';
import { NATIVE_CHECK_POLICY } from './native-check-receipt-model.js';
import { redactNativeCredentialText } from './native-redaction.js';
import type { NativeDeclaredArtifact } from './native-verification-scope.js';

export const NATIVE_VERIFICATION_RECEIPT_SCHEMA = 'comet.native.verification-receipt.v3' as const;
const VERIFICATION_RECEIPT_HASH_TAG = NATIVE_VERIFICATION_RECEIPT_SCHEMA;
const ARTIFACT_BINDING_HASH_TAG = 'comet.native.declared-artifacts.v1';
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const ACCEPTANCE_ID_PATTERN = /^acceptance-[a-f0-9]{64}$/u;
const CHANGE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const CHECK_RECEIPT_REF_PATTERN = /^runtime\/evidence\/check-receipts\/([a-f0-9]{64})\.json$/u;
const MAX_TEXT = 4_096;
const MAX_LIST = 256;
const MAX_ACCEPTANCE_IDS = 1_024;

export type NativeVerificationReceiptKind =
  | 'automated-check'
  | 'static-inspection'
  | 'manual-evidence';

export type NativeVerificationReceiptStatus = 'passed' | 'failed' | 'skipped' | 'blocked';

export interface NativeVerificationReceiptBindings {
  change: string;
  sourceRevision: number;
  contractHash: string;
  scopeHash: string;
  snapshotHash: string;
  artifactHash: string;
}

export interface NativeAutomatedCheckEvidence {
  executable: string;
  args: string[];
  cwd: string;
  exitCode: number;
  signal: string | null;
  timedOut: boolean;
  timeoutMs: number;
  startedAt: string;
  endedAt: string;
  worktree: {
    provider: 'git' | 'none';
    root: string;
    beforeCommit: string | null;
    afterCommit: string | null;
  };
  afterFence: {
    snapshotHash: string;
    scopeHash: string;
    matched: boolean;
  };
  outputHash: string;
  outputSummary: string;
  outputTruncated: boolean;
}

export interface NativeStaticInspectionEvidence {
  subjects: string[];
  rule: string;
  resultSummary: string;
  checkReceiptRef: string;
  checkReceiptHash: string;
}

export interface NativeManualEvidence {
  steps: string[];
  observations: string[];
}

type NativeVerificationReceiptEvidenceByKind = {
  'automated-check': NativeAutomatedCheckEvidence;
  'static-inspection': NativeStaticInspectionEvidence;
  'manual-evidence': NativeManualEvidence;
};

export type NativeVerificationReceipt = {
  [K in NativeVerificationReceiptKind]: {
    schema: typeof NATIVE_VERIFICATION_RECEIPT_SCHEMA;
    kind: K;
    role: 'required-check' | 'acceptance-evidence';
    status: NativeVerificationReceiptStatus;
    bindings: NativeVerificationReceiptBindings;
    acceptanceIds: string[];
    actor: string;
    issuedAt: string;
    evidence: NativeVerificationReceiptEvidenceByKind[K];
    receiptHash: string;
  };
}[NativeVerificationReceiptKind];

export type NativeVerificationReceiptInput = {
  [K in NativeVerificationReceiptKind]: Omit<
    Extract<NativeVerificationReceipt, { kind: K }>,
    'schema' | 'receiptHash'
  >;
}[NativeVerificationReceiptKind];

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new Error(`${label} fields are invalid`);
  }
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error(`${label} must be a SHA-256 hash`);
  }
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const normalized = redactNativeCredentialText(value).trim();
  if (!normalized || normalized.length > MAX_TEXT || normalized !== value.trim()) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function timestamp(value: unknown, label: string): string {
  const normalized = text(value, label);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(`${label} must be a canonical timestamp`);
  }
  return normalized;
}

function stringList(
  value: unknown,
  label: string,
  normalize: (entry: unknown, entryLabel: string) => string = text,
  allowEmpty = false,
  maxItems = MAX_LIST,
): string[] {
  if (!Array.isArray(value) || value.length > maxItems || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be a bounded non-empty array`);
  }
  const entries = value.map((entry, index) => normalize(entry, `${label} ${index}`));
  if (new Set(entries).size !== entries.length) throw new Error(`${label} has duplicates`);
  return entries;
}

function acceptanceId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ACCEPTANCE_ID_PATTERN.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function bindings(value: unknown): NativeVerificationReceiptBindings {
  const root = record(value, 'Native verification receipt bindings');
  exactKeys(
    root,
    ['change', 'sourceRevision', 'contractHash', 'scopeHash', 'snapshotHash', 'artifactHash'],
    'Native verification receipt bindings',
  );
  if (
    typeof root.change !== 'string' ||
    !CHANGE_NAME_PATTERN.test(root.change) ||
    !Number.isSafeInteger(root.sourceRevision) ||
    (root.sourceRevision as number) < 1
  ) {
    throw new Error('Native verification receipt bindings are invalid');
  }
  return {
    change: root.change,
    sourceRevision: root.sourceRevision as number,
    contractHash: hash(root.contractHash, 'Native verification receipt contract hash'),
    scopeHash: hash(root.scopeHash, 'Native verification receipt scope hash'),
    snapshotHash: hash(root.snapshotHash, 'Native verification receipt snapshot hash'),
    artifactHash: hash(root.artifactHash, 'Native verification receipt artifact hash'),
  };
}

function checkReceiptRef(value: unknown): { ref: string; hash: string } {
  if (typeof value !== 'string') throw new Error('Native static check receipt ref is invalid');
  const match = CHECK_RECEIPT_REF_PATTERN.exec(value);
  if (!match) throw new Error('Native static check receipt ref is invalid');
  return { ref: value, hash: match[1] };
}

function parseEvidence(
  kind: NativeVerificationReceiptKind,
  value: unknown,
  status: NativeVerificationReceiptStatus,
  role: NativeVerificationReceipt['role'],
): NativeVerificationReceipt['evidence'] {
  const evidence = record(value, `Native ${kind} evidence`);
  if (kind === 'automated-check') {
    exactKeys(
      evidence,
      [
        'executable',
        'args',
        'cwd',
        'exitCode',
        'signal',
        'timedOut',
        'timeoutMs',
        'startedAt',
        'endedAt',
        'worktree',
        'afterFence',
        'outputHash',
        'outputSummary',
        'outputTruncated',
      ],
      'Native automated-check evidence',
    );
    if (
      !Number.isSafeInteger(evidence.exitCode) ||
      !Number.isSafeInteger(evidence.timeoutMs) ||
      (evidence.timeoutMs as number) < 1 ||
      (evidence.timeoutMs as number) > 60 * 60 * 1_000 ||
      typeof evidence.timedOut !== 'boolean' ||
      typeof evidence.outputTruncated !== 'boolean' ||
      (evidence.signal !== null && typeof evidence.signal !== 'string')
    ) {
      throw new Error('Native automated-check exit code is invalid');
    }
    const startedAt = timestamp(evidence.startedAt, 'Native automated-check start time');
    const endedAt = timestamp(evidence.endedAt, 'Native automated-check end time');
    if (Date.parse(endedAt) < Date.parse(startedAt)) {
      throw new Error('Native automated-check time range is invalid');
    }
    if (
      (status === 'passed' && evidence.exitCode !== 0) ||
      (status === 'failed' && evidence.exitCode === 0) ||
      (status === 'passed' && (evidence.timedOut || evidence.signal !== null))
    ) {
      throw new Error('Native automated-check status does not match its exit code');
    }
    const worktree = record(evidence.worktree, 'Native automated-check worktree');
    exactKeys(
      worktree,
      ['provider', 'root', 'beforeCommit', 'afterCommit'],
      'Native automated-check worktree',
    );
    if (
      (worktree.provider !== 'git' && worktree.provider !== 'none') ||
      (worktree.beforeCommit !== null &&
        (typeof worktree.beforeCommit !== 'string' ||
          !/^[a-f0-9]{40,64}$/u.test(worktree.beforeCommit))) ||
      (worktree.afterCommit !== null &&
        (typeof worktree.afterCommit !== 'string' ||
          !/^[a-f0-9]{40,64}$/u.test(worktree.afterCommit)))
    ) {
      throw new Error('Native automated-check worktree identity is invalid');
    }
    const afterFence = record(evidence.afterFence, 'Native automated-check after fence');
    exactKeys(
      afterFence,
      ['snapshotHash', 'scopeHash', 'matched'],
      'Native automated-check after fence',
    );
    if (typeof afterFence.matched !== 'boolean') {
      throw new Error('Native automated-check after fence is invalid');
    }
    if (status === 'passed' && afterFence.matched !== true) {
      throw new Error('Native automated-check pass requires a matching after fence');
    }
    return {
      executable: text(evidence.executable, 'Native automated-check executable'),
      args: stringList(evidence.args, 'Native automated-check arguments', text, true),
      cwd: text(evidence.cwd, 'Native automated-check cwd'),
      exitCode: evidence.exitCode as number,
      signal: evidence.signal as string | null,
      timedOut: evidence.timedOut,
      timeoutMs: evidence.timeoutMs as number,
      startedAt,
      endedAt,
      worktree: {
        provider: worktree.provider,
        root: text(worktree.root, 'Native automated-check worktree root'),
        beforeCommit: worktree.beforeCommit,
        afterCommit: worktree.afterCommit,
      } as NativeAutomatedCheckEvidence['worktree'],
      afterFence: {
        snapshotHash: hash(afterFence.snapshotHash, 'Native automated-check after snapshot hash'),
        scopeHash: hash(afterFence.scopeHash, 'Native automated-check after scope hash'),
        matched: afterFence.matched,
      },
      outputHash: hash(evidence.outputHash, 'Native automated-check output hash'),
      outputSummary: text(evidence.outputSummary, 'Native automated-check output summary'),
      outputTruncated: evidence.outputTruncated,
    };
  }
  if (kind === 'static-inspection') {
    exactKeys(
      evidence,
      ['subjects', 'rule', 'resultSummary', 'checkReceiptRef', 'checkReceiptHash'],
      'Native static-inspection evidence',
    );
    const check = checkReceiptRef(evidence.checkReceiptRef);
    if (hash(evidence.checkReceiptHash, 'Native static check receipt hash') !== check.hash) {
      throw new Error('Native static check receipt ref/hash mismatch');
    }
    return {
      subjects: stringList(
        evidence.subjects,
        'Native static inspection subjects',
        text,
        role === 'required-check',
      ),
      rule: text(evidence.rule, 'Native static inspection rule'),
      resultSummary: text(evidence.resultSummary, 'Native static inspection result'),
      checkReceiptRef: check.ref,
      checkReceiptHash: check.hash,
    };
  }
  if (kind === 'manual-evidence') {
    exactKeys(evidence, ['steps', 'observations'], 'Native manual-evidence evidence');
    return {
      steps: stringList(evidence.steps, 'Native manual evidence steps'),
      observations: stringList(evidence.observations, 'Native manual evidence observations'),
    };
  }
  throw new Error(`Native verification receipt kind is unsupported: ${kind satisfies never}`);
}

function receiptContent(value: unknown): Omit<NativeVerificationReceipt, 'receiptHash'> {
  const root = record(value, 'Native verification receipt');
  exactKeys(
    root,
    [
      'schema',
      'kind',
      'role',
      'status',
      'bindings',
      'acceptanceIds',
      'actor',
      'issuedAt',
      'evidence',
    ],
    'Native verification receipt input',
  );
  if (
    !['automated-check', 'static-inspection', 'manual-evidence'].includes(root.kind as string) ||
    (root.role !== 'required-check' && root.role !== 'acceptance-evidence') ||
    !['passed', 'failed', 'skipped', 'blocked'].includes(root.status as string)
  ) {
    throw new Error('Native verification receipt kind or status is invalid');
  }
  const kind = root.kind as NativeVerificationReceiptKind;
  const role = root.role as NativeVerificationReceipt['role'];
  const status = root.status as NativeVerificationReceiptStatus;
  const actor = text(root.actor, 'Native verification receipt actor');
  const acceptanceIds = stringList(
    root.acceptanceIds,
    'Native receipt acceptance IDs',
    acceptanceId,
    role === 'required-check',
    MAX_ACCEPTANCE_IDS,
  ).sort();
  if (
    (role === 'required-check' && acceptanceIds.length !== 0) ||
    (role === 'acceptance-evidence' && acceptanceIds.length === 0)
  ) {
    throw new Error('Native verification receipt role/acceptance coverage is invalid');
  }
  if (role === 'required-check' && kind !== 'static-inspection') {
    throw new Error('Native required check must be the built-in static inspection');
  }
  const content = {
    schema: NATIVE_VERIFICATION_RECEIPT_SCHEMA,
    kind,
    role,
    status,
    bindings: bindings(root.bindings),
    acceptanceIds,
    actor,
    issuedAt: timestamp(root.issuedAt, 'Native verification receipt issue time'),
    evidence: parseEvidence(kind, root.evidence, status, role),
  } as Omit<NativeVerificationReceipt, 'receiptHash'>;
  if (
    role === 'required-check' &&
    content.kind === 'static-inspection' &&
    ((
      content as Omit<
        Extract<NativeVerificationReceipt, { kind: 'static-inspection' }>,
        'receiptHash'
      >
    ).evidence.rule !== NATIVE_CHECK_POLICY ||
      content.actor !== `native-runtime:${NATIVE_CHECK_POLICY}`)
  ) {
    throw new Error('Native required check policy identity is invalid');
  }
  return content;
}

export function buildNativeVerificationReceipt(
  input: NativeVerificationReceiptInput,
): NativeVerificationReceipt {
  const content = receiptContent({ schema: NATIVE_VERIFICATION_RECEIPT_SCHEMA, ...input });
  return {
    ...content,
    receiptHash: canonicalHash(VERIFICATION_RECEIPT_HASH_TAG, content),
  } as NativeVerificationReceipt;
}

export function parseNativeVerificationReceipt(value: unknown): NativeVerificationReceipt {
  const root = record(value, 'Native verification receipt');
  exactKeys(
    root,
    [
      'schema',
      'kind',
      'role',
      'status',
      'bindings',
      'acceptanceIds',
      'actor',
      'issuedAt',
      'evidence',
      'receiptHash',
    ],
    'Native verification receipt',
  );
  if (root.schema !== NATIVE_VERIFICATION_RECEIPT_SCHEMA) {
    throw new Error('Native verification receipt schema is invalid');
  }
  const { receiptHash: _receiptHash, ...input } = root;
  void _receiptHash;
  const content = receiptContent(input);
  const receiptHash = hash(root.receiptHash, 'Native verification receipt hash');
  if (canonicalHash(VERIFICATION_RECEIPT_HASH_TAG, content) !== receiptHash) {
    throw new Error('Native verification receipt content hash mismatch');
  }
  return { ...content, receiptHash } as NativeVerificationReceipt;
}

export function nativeArtifactBindingHash(
  declaredArtifacts: readonly NativeDeclaredArtifact[],
): string {
  return canonicalHash(
    ARTIFACT_BINDING_HASH_TAG,
    [...declaredArtifacts]
      .map((artifact) => ({ path: artifact.path, kind: artifact.kind }))
      .sort(
        (left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind),
      ),
  );
}

export function nativeVerificationReceiptRef(hashValue: string): string {
  return `runtime/evidence/receipts/${hash(hashValue, 'Native verification receipt hash')}.json`;
}

export function nativeFailedCheckId(receipt: NativeVerificationReceipt): string {
  if (receipt.kind === 'static-inspection') return `static:${receipt.evidence.rule}`;
  if (receipt.kind === 'automated-check') {
    return `automated:${canonicalHash('comet.native.failed-check.v1', {
      executable: receipt.evidence.executable,
      args: receipt.evidence.args,
      acceptanceIds: receipt.acceptanceIds,
    })}`;
  }
  return `manual:${canonicalHash('comet.native.failed-check.v1', {
    acceptanceIds: receipt.acceptanceIds,
  })}`;
}
