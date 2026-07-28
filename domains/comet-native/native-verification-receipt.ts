import { canonicalHash } from './native-canonical-hash.js';
import { NATIVE_CHECK_POLICY } from './native-check-receipt-model.js';
import { redactNativeCredentialText } from './native-redaction.js';
import {
  parseNativeReviewIdentity,
  parseNativeReviewSignature,
  verifyNativeReviewPayloadHash,
  type NativeReviewIdentity,
  type NativeReviewSignature,
} from './native-review-identity.js';
import type { NativeDeclaredArtifact } from './native-verification-scope.js';

export const NATIVE_VERIFICATION_RECEIPT_SCHEMA = 'comet.native.verification-receipt.v2' as const;
export const NATIVE_WAIVER_RECEIPT_SCHEMA = 'comet.native.waiver-receipt.v2' as const;
const VERIFICATION_RECEIPT_HASH_TAG = NATIVE_VERIFICATION_RECEIPT_SCHEMA;
const WAIVER_RECEIPT_HASH_TAG = NATIVE_WAIVER_RECEIPT_SCHEMA;
const ARTIFACT_BINDING_HASH_TAG = 'comet.native.declared-artifacts.v1';
const INDEPENDENT_REVIEW_PAYLOAD_HASH_TAG = 'comet.native.independent-review-attestation.v1';
const IMPLEMENTATION_PAYLOAD_HASH_TAG = 'comet.native.implementation-attestation.v1';
const WAIVER_PAYLOAD_HASH_TAG = 'comet.native.waiver-attestation.v1';
const REVIEW_MATRIX_HASH_TAG = 'comet.native.review-acceptance-matrix.v1';
const REVIEW_EVIDENCE_GRAPH_HASH_TAG = 'comet.native.review-evidence-graph.v1';
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const ACCEPTANCE_ID_PATTERN = /^acceptance-[a-f0-9]{64}$/u;
const CHANGE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const RECEIPT_REF_PATTERN = /^runtime\/evidence\/receipts\/([a-f0-9]{64})\.json$/u;
const WAIVER_REF_PATTERN = /^runtime\/evidence\/waivers\/([a-f0-9]{64})\.json$/u;
const CHECK_RECEIPT_REF_PATTERN = /^runtime\/evidence\/check-receipts\/([a-f0-9]{64})\.json$/u;
const MAX_TEXT = 4_096;
const MAX_LIST = 256;
const MAX_ACCEPTANCE_IDS = 1_024;

export type NativeVerificationReceiptKind =
  | 'automated-check'
  | 'static-inspection'
  | 'manual-evidence'
  | 'implementation-attestation'
  | 'independent-review';

export type NativeVerificationReceiptStatus = 'passed' | 'failed' | 'skipped' | 'blocked';

export interface NativeVerificationReceiptBindings {
  change: string;
  sourceRevision: number;
  contractHash: string;
  scopeHash: string;
  snapshotHash: string;
  artifactHash: string;
}

export interface NativeReviewFinding {
  severity: 'P0' | 'P1' | 'P2';
  status: 'resolved' | 'open';
  summary: string;
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
  responsible: string;
}

export interface NativeImplementationAttestationEvidence {
  implementationExecutionId: string;
  reviewPolicyHash: string;
  implementationIdentity: NativeReviewIdentity;
  attestation: NativeReviewSignature;
}

export interface NativeIndependentReviewEvidence {
  preparationHash: string;
  implementationKeyId: string;
  implementationReceiptRef: string;
  reviewPolicyHash: string;
  reviewerIdentity: NativeReviewIdentity;
  matrixHash: string;
  checked: {
    acceptanceApplicability: boolean;
    unifiedIo: string | null;
    adversarialPaths: string | null;
    generatedAssets: string | null;
    lifecycleEval: string | null;
  };
  evidenceGraph: NativeReviewEvidenceGraph;
  findings: NativeReviewFinding[];
  attestation: NativeReviewSignature;
}

export interface NativeReviewEvidenceGraph {
  schema: 'comet.native.review-evidence-graph.v1';
  reviewedReceiptRefs: string[];
  reviewedWaiverRefs: string[];
  automatedReplays: Array<{ sourceRef: string; replayRef: string }>;
  staticReplays: Array<{ sourceRef: string; replayRef: string }>;
  manualAttestationRefs: string[];
  graphHash: string;
}

type NativeVerificationReceiptEvidenceByKind = {
  'automated-check': NativeAutomatedCheckEvidence;
  'static-inspection': NativeStaticInspectionEvidence;
  'manual-evidence': NativeManualEvidence;
  'implementation-attestation': NativeImplementationAttestationEvidence;
  'independent-review': NativeIndependentReviewEvidence;
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

export interface NativeWaiverReceipt {
  schema: typeof NATIVE_WAIVER_RECEIPT_SCHEMA;
  bindings: NativeVerificationReceiptBindings;
  acceptanceId: string;
  blockedReceiptRef: string;
  blockedCheckId: string;
  reason: string;
  risk: string;
  alternativeReceiptRefs: string[];
  reviewPolicyHash: string;
  signerIdentity: NativeReviewIdentity;
  confirmedAt: string;
  attestation: NativeReviewSignature;
  waiverHash: string;
}

export type NativeWaiverReceiptInput = Omit<NativeWaiverReceipt, 'schema' | 'waiverHash'>;

export function nativeIndependentReviewAttestationHash(input: {
  bindings: NativeVerificationReceiptBindings;
  status: NativeVerificationReceiptStatus;
  acceptanceIds: readonly string[];
  issuedAt: string;
  evidence: Omit<NativeIndependentReviewEvidence, 'attestation'>;
}): string {
  return canonicalHash(INDEPENDENT_REVIEW_PAYLOAD_HASH_TAG, {
    bindings: input.bindings,
    status: input.status,
    acceptanceIds: [...input.acceptanceIds].sort(),
    issuedAt: input.issuedAt,
    evidence: input.evidence,
  });
}

export function nativeImplementationAttestationHash(input: {
  bindings: NativeVerificationReceiptBindings;
  status: NativeVerificationReceiptStatus;
  acceptanceIds: readonly string[];
  issuedAt: string;
  evidence: Omit<NativeImplementationAttestationEvidence, 'attestation'>;
}): string {
  return canonicalHash(IMPLEMENTATION_PAYLOAD_HASH_TAG, {
    bindings: input.bindings,
    status: input.status,
    acceptanceIds: [...input.acceptanceIds].sort(),
    issuedAt: input.issuedAt,
    evidence: input.evidence,
  });
}

export function nativeWaiverAttestationHash(
  input:
    | Omit<NativeWaiverReceiptInput, 'attestation'>
    | Omit<NativeWaiverReceipt, 'attestation' | 'waiverHash'>,
): string {
  const { schema: _schema, ...content } = input as Omit<
    NativeWaiverReceipt,
    'attestation' | 'waiverHash'
  >;
  void _schema;
  return canonicalHash(WAIVER_PAYLOAD_HASH_TAG, {
    ...content,
    alternativeReceiptRefs: [...content.alternativeReceiptRefs].sort(),
  });
}

export function nativeReviewAcceptanceMatrixHash(matrix: unknown): string {
  return canonicalHash(REVIEW_MATRIX_HASH_TAG, matrix);
}

export function buildNativeReviewEvidenceGraph(
  input: Omit<NativeReviewEvidenceGraph, 'schema' | 'graphHash'>,
): NativeReviewEvidenceGraph {
  const content = {
    schema: 'comet.native.review-evidence-graph.v1' as const,
    reviewedReceiptRefs: [...input.reviewedReceiptRefs].sort(),
    reviewedWaiverRefs: [...input.reviewedWaiverRefs].sort(),
    automatedReplays: [...input.automatedReplays].sort((left, right) =>
      left.sourceRef.localeCompare(right.sourceRef, 'en'),
    ),
    staticReplays: [...input.staticReplays].sort((left, right) =>
      left.sourceRef.localeCompare(right.sourceRef, 'en'),
    ),
    manualAttestationRefs: [...input.manualAttestationRefs].sort(),
  };
  return parseNativeReviewEvidenceGraph({
    ...content,
    graphHash: canonicalHash(REVIEW_EVIDENCE_GRAPH_HASH_TAG, content),
  });
}

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

function receiptRef(value: unknown, label: string): string {
  if (typeof value !== 'string' || !RECEIPT_REF_PATTERN.test(value)) {
    throw new Error(`${label} must identify a content-addressed typed receipt`);
  }
  return value;
}

function waiverRef(value: unknown, label: string): string {
  if (typeof value !== 'string' || !WAIVER_REF_PATTERN.test(value)) {
    throw new Error(`${label} must identify a content-addressed waiver`);
  }
  return value;
}

function sortedRefList(
  value: unknown,
  label: string,
  normalize: (entry: unknown, entryLabel: string) => string,
): string[] {
  const refs = stringList(value, label, normalize, true, 4_096);
  if (JSON.stringify(refs) !== JSON.stringify([...refs].sort())) {
    throw new Error(`${label} must be sorted`);
  }
  return refs;
}

function parseReplayList(
  value: unknown,
  label: string,
): Array<{ sourceRef: string; replayRef: string }> {
  if (!Array.isArray(value) || value.length > 4_096) {
    throw new Error(`${label} must be a bounded array`);
  }
  const replays = value.map((entry, index) => {
    const replay = record(entry, `${label} ${index}`);
    exactKeys(replay, ['sourceRef', 'replayRef'], `${label} ${index}`);
    return {
      sourceRef: receiptRef(replay.sourceRef, `${label} ${index} source`),
      replayRef: receiptRef(replay.replayRef, `${label} ${index} replay`),
    };
  });
  if (
    new Set(replays.map((replay) => replay.sourceRef)).size !== replays.length ||
    JSON.stringify(replays) !==
      JSON.stringify(
        [...replays].sort((left, right) => left.sourceRef.localeCompare(right.sourceRef, 'en')),
      )
  ) {
    throw new Error(`${label} must be sorted with unique sources`);
  }
  return replays;
}

export function parseNativeReviewEvidenceGraph(value: unknown): NativeReviewEvidenceGraph {
  const root = record(value, 'Native review evidence graph');
  exactKeys(
    root,
    [
      'schema',
      'reviewedReceiptRefs',
      'reviewedWaiverRefs',
      'automatedReplays',
      'staticReplays',
      'manualAttestationRefs',
      'graphHash',
    ],
    'Native review evidence graph',
  );
  if (root.schema !== 'comet.native.review-evidence-graph.v1') {
    throw new Error('Native review evidence graph schema is invalid');
  }
  const content = {
    schema: 'comet.native.review-evidence-graph.v1' as const,
    reviewedReceiptRefs: sortedRefList(
      root.reviewedReceiptRefs,
      'Native reviewed receipt refs',
      receiptRef,
    ),
    reviewedWaiverRefs: sortedRefList(
      root.reviewedWaiverRefs,
      'Native reviewed waiver refs',
      waiverRef,
    ),
    automatedReplays: parseReplayList(root.automatedReplays, 'Native automated review replays'),
    staticReplays: parseReplayList(root.staticReplays, 'Native static review replays'),
    manualAttestationRefs: sortedRefList(
      root.manualAttestationRefs,
      'Native manual review attestations',
      receiptRef,
    ),
  };
  const graphHash = hash(root.graphHash, 'Native review evidence graph hash');
  if (canonicalHash(REVIEW_EVIDENCE_GRAPH_HASH_TAG, content) !== graphHash) {
    throw new Error('Native review evidence graph hash mismatch');
  }
  return { ...content, graphHash };
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

function parseFindings(value: unknown, allowOpenBlocking: boolean): NativeReviewFinding[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw new Error('Native independent review findings are invalid');
  }
  const findings = value.map((entry, index): NativeReviewFinding => {
    const finding = record(entry, `Native independent review finding ${index}`);
    exactKeys(
      finding,
      ['severity', 'status', 'summary'],
      `Native independent review finding ${index}`,
    );
    if (
      !['P0', 'P1', 'P2'].includes(finding.severity as string) ||
      !['resolved', 'open'].includes(finding.status as string)
    ) {
      throw new Error(`Native independent review finding ${index} is invalid`);
    }
    return {
      severity: finding.severity as NativeReviewFinding['severity'],
      status: finding.status as NativeReviewFinding['status'],
      summary: text(finding.summary, `Native independent review finding ${index} summary`),
    };
  });
  if (
    !allowOpenBlocking &&
    findings.some(
      (finding) =>
        finding.status === 'open' && (finding.severity === 'P0' || finding.severity === 'P1'),
    )
  ) {
    throw new Error('Native independent review has unresolved P0/P1 findings');
  }
  return findings;
}

function parseEvidence(
  kind: NativeVerificationReceiptKind,
  value: unknown,
  actor: string,
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
    exactKeys(
      evidence,
      ['steps', 'observations', 'responsible'],
      'Native manual-evidence evidence',
    );
    const responsible = text(evidence.responsible, 'Native manual evidence responsible');
    if (responsible !== actor) throw new Error('Native manual evidence actor/responsible mismatch');
    return {
      steps: stringList(evidence.steps, 'Native manual evidence steps'),
      observations: stringList(evidence.observations, 'Native manual evidence observations'),
      responsible,
    };
  }
  if (kind === 'implementation-attestation') {
    exactKeys(
      evidence,
      ['implementationExecutionId', 'reviewPolicyHash', 'implementationIdentity', 'attestation'],
      'Native implementation-attestation evidence',
    );
    const implementationIdentity = parseNativeReviewIdentity(evidence.implementationIdentity);
    if (actor !== `implementation-key:${implementationIdentity.keyId}`) {
      throw new Error('Native implementation attestation actor/identity mismatch');
    }
    if (status !== 'passed') {
      throw new Error('Native implementation attestation must be passed');
    }
    return {
      implementationExecutionId: text(
        evidence.implementationExecutionId,
        'Native implementation execution ID',
      ),
      reviewPolicyHash: hash(evidence.reviewPolicyHash, 'Native review trust policy hash'),
      implementationIdentity,
      attestation: parseNativeReviewSignature(evidence.attestation),
    };
  }
  exactKeys(
    evidence,
    [
      'preparationHash',
      'implementationKeyId',
      'implementationReceiptRef',
      'reviewPolicyHash',
      'reviewerIdentity',
      'matrixHash',
      'checked',
      'evidenceGraph',
      'findings',
      'attestation',
    ],
    'Native independent-review evidence',
  );
  const preparationHash = hash(evidence.preparationHash, 'Native review preparation hash');
  const implementationKeyId = hash(evidence.implementationKeyId, 'Native implementation identity');
  const reviewPolicyHash = hash(evidence.reviewPolicyHash, 'Native review trust policy hash');
  const implementationReceipt = receiptRef(
    evidence.implementationReceiptRef,
    'Native implementation attestation receipt ref',
  );
  const reviewerIdentity = parseNativeReviewIdentity(evidence.reviewerIdentity);
  const matrixHash = hash(evidence.matrixHash, 'Native reviewed acceptance matrix hash');
  if (reviewerIdentity.keyId === implementationKeyId) {
    throw new Error('Native independent reviewer must differ from implementation identity');
  }
  if (actor !== `review-key:${reviewerIdentity.keyId}`) {
    throw new Error('Native independent review actor/reviewer identity mismatch');
  }
  const checked = record(evidence.checked, 'Native independent review checks');
  exactKeys(
    checked,
    [
      'acceptanceApplicability',
      'unifiedIo',
      'adversarialPaths',
      'generatedAssets',
      'lifecycleEval',
    ],
    'Native independent review checks',
  );
  if (
    typeof checked.acceptanceApplicability !== 'boolean' ||
    [
      checked.unifiedIo,
      checked.adversarialPaths,
      checked.generatedAssets,
      checked.lifecycleEval,
    ].some((entry) => entry !== null && typeof entry !== 'string')
  ) {
    throw new Error('Native independent review check evidence refs are invalid');
  }
  if (status === 'passed' && checked.acceptanceApplicability !== true) {
    throw new Error('Native passing independent review must confirm acceptance applicability');
  }
  return {
    preparationHash,
    implementationKeyId,
    implementationReceiptRef: implementationReceipt,
    reviewPolicyHash,
    reviewerIdentity,
    matrixHash,
    checked: {
      acceptanceApplicability: checked.acceptanceApplicability as boolean,
      unifiedIo:
        checked.unifiedIo === null
          ? null
          : receiptRef(checked.unifiedIo, 'Native unified-I/O evidence ref'),
      adversarialPaths:
        checked.adversarialPaths === null
          ? null
          : receiptRef(checked.adversarialPaths, 'Native adversarial-path evidence ref'),
      generatedAssets:
        checked.generatedAssets === null
          ? null
          : receiptRef(checked.generatedAssets, 'Native generated-assets evidence ref'),
      lifecycleEval:
        checked.lifecycleEval === null
          ? null
          : receiptRef(checked.lifecycleEval, 'Native lifecycle-Eval evidence ref'),
    },
    evidenceGraph: parseNativeReviewEvidenceGraph(evidence.evidenceGraph),
    findings: parseFindings(evidence.findings, status !== 'passed'),
    attestation: parseNativeReviewSignature(evidence.attestation),
  };
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
    ![
      'automated-check',
      'static-inspection',
      'manual-evidence',
      'implementation-attestation',
      'independent-review',
    ].includes(root.kind as string) ||
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
    evidence: parseEvidence(kind, root.evidence, actor, status, role),
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
  if (kind === 'independent-review') {
    const reviewContent = content as Omit<
      Extract<NativeVerificationReceipt, { kind: 'independent-review' }>,
      'receiptHash'
    >;
    const { attestation, ...reviewEvidence } = reviewContent.evidence;
    const payloadHash = nativeIndependentReviewAttestationHash({
      bindings: reviewContent.bindings,
      status: reviewContent.status,
      acceptanceIds: reviewContent.acceptanceIds,
      issuedAt: reviewContent.issuedAt,
      evidence: reviewEvidence,
    });
    verifyNativeReviewPayloadHash({
      identity: reviewContent.evidence.reviewerIdentity,
      payloadHash,
      proof: attestation,
    });
  }
  if (kind === 'implementation-attestation') {
    const implementationContent = content as Omit<
      Extract<NativeVerificationReceipt, { kind: 'implementation-attestation' }>,
      'receiptHash'
    >;
    const { attestation, ...implementationEvidence } = implementationContent.evidence;
    verifyNativeReviewPayloadHash({
      identity: implementationEvidence.implementationIdentity,
      payloadHash: nativeImplementationAttestationHash({
        bindings: implementationContent.bindings,
        status: implementationContent.status,
        acceptanceIds: implementationContent.acceptanceIds,
        issuedAt: implementationContent.issuedAt,
        evidence: implementationEvidence,
      }),
      proof: attestation,
    });
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

function waiverContent(value: unknown): Omit<NativeWaiverReceipt, 'waiverHash'> {
  const root = record(value, 'Native waiver receipt');
  exactKeys(
    root,
    [
      'schema',
      'bindings',
      'acceptanceId',
      'blockedReceiptRef',
      'blockedCheckId',
      'reason',
      'risk',
      'alternativeReceiptRefs',
      'reviewPolicyHash',
      'signerIdentity',
      'confirmedAt',
      'attestation',
    ],
    'Native waiver receipt input',
  );
  const content = {
    schema: NATIVE_WAIVER_RECEIPT_SCHEMA,
    bindings: bindings(root.bindings),
    acceptanceId: acceptanceId(root.acceptanceId, 'Native waiver acceptance ID'),
    blockedReceiptRef: receiptRef(root.blockedReceiptRef, 'Native waiver blocked receipt ref'),
    blockedCheckId: text(root.blockedCheckId, 'Native waiver blocked check ID'),
    reason: text(root.reason, 'Native waiver reason'),
    risk: text(root.risk, 'Native waiver risk'),
    alternativeReceiptRefs: stringList(
      root.alternativeReceiptRefs,
      'Native waiver alternative receipt refs',
      receiptRef,
    ).sort(),
    reviewPolicyHash: hash(root.reviewPolicyHash, 'Native waiver trust policy hash'),
    signerIdentity: parseNativeReviewIdentity(root.signerIdentity),
    confirmedAt: timestamp(root.confirmedAt, 'Native waiver confirmation time'),
    attestation: parseNativeReviewSignature(root.attestation),
  };
  const { attestation, ...payload } = content;
  verifyNativeReviewPayloadHash({
    identity: content.signerIdentity,
    payloadHash: nativeWaiverAttestationHash(payload),
    proof: attestation,
  });
  return content;
}

export function buildNativeWaiverReceipt(input: NativeWaiverReceiptInput): NativeWaiverReceipt {
  const content = waiverContent({ schema: NATIVE_WAIVER_RECEIPT_SCHEMA, ...input });
  return { ...content, waiverHash: canonicalHash(WAIVER_RECEIPT_HASH_TAG, content) };
}

export function parseNativeWaiverReceipt(value: unknown): NativeWaiverReceipt {
  const root = record(value, 'Native waiver receipt');
  exactKeys(
    root,
    [
      'schema',
      'bindings',
      'acceptanceId',
      'blockedReceiptRef',
      'blockedCheckId',
      'reason',
      'risk',
      'alternativeReceiptRefs',
      'reviewPolicyHash',
      'signerIdentity',
      'confirmedAt',
      'attestation',
      'waiverHash',
    ],
    'Native waiver receipt',
  );
  if (root.schema !== NATIVE_WAIVER_RECEIPT_SCHEMA) {
    throw new Error('Native waiver receipt schema is invalid');
  }
  const { waiverHash: _waiverHash, ...input } = root;
  void _waiverHash;
  const content = waiverContent(input);
  const waiverHash = hash(root.waiverHash, 'Native waiver receipt hash');
  if (canonicalHash(WAIVER_RECEIPT_HASH_TAG, content) !== waiverHash) {
    throw new Error('Native waiver receipt content hash mismatch');
  }
  return { ...content, waiverHash };
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

export function nativeBlockedCheckId(
  receipt: Pick<NativeVerificationReceipt, 'receiptHash'>,
): string {
  return `receipt:${hash(receipt.receiptHash, 'Native blocked receipt hash')}`;
}

export function nativeWaiverReceiptRef(hashValue: string): string {
  return `runtime/evidence/waivers/${hash(hashValue, 'Native waiver receipt hash')}.json`;
}
