import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

import { terminateProcessTree } from '../../platform/process/terminate-process-tree.js';

import { canonicalHash } from './native-canonical-hash.js';
import { nativeChangeDir, readNativeChange } from './native-change.js';
import {
  parseNativeVerificationMachineBlock,
  type NativeAcceptanceEvidenceEntry,
} from './native-acceptance.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { settleNativeChangeJournalsLocked } from './native-change-recovery.js';
import { executeNativeCheckReceipt, type NativeCheckReceipt } from './native-check-receipt.js';
import { readNativeCheckReceipt } from './native-check-receipt-storage.js';
import { collectNativeContractFiles } from './native-contract-files.js';
import {
  parseNativeReviewIdentity,
  signNativeReviewPayloadHash,
  type NativeReviewIdentity,
  type NativeReviewSignature,
} from './native-review-identity.js';
import { loadNativeReviewTrustPolicy, trustedNativeIdentity } from './native-review-trust.js';
import { isNativeHighRiskScope } from './native-independent-review.js';
import {
  readNativeImplementationScopeBundle,
  readNativeVerificationReceipt,
  readNativeWaiverReceipt,
  writeNativeVerificationReceipt,
  writeNativeWaiverReceipt,
} from './native-evidence-storage.js';
import type { NativeChangeState, NativeProjectPaths } from './native-types.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { withNativeTransitionLock } from './native-transition-journal.js';
import type { NativeContentSnapshotManifest } from './native-types.js';
import { createNativeCurrentContentSnapshot } from './native-snapshot.js';
import {
  buildNativeVerificationReceipt,
  buildNativeReviewEvidenceGraph,
  buildNativeWaiverReceipt,
  nativeBlockedCheckId,
  nativeArtifactBindingHash,
  nativeImplementationAttestationHash,
  nativeIndependentReviewAttestationHash,
  nativeReviewAcceptanceMatrixHash,
  nativeWaiverAttestationHash,
  type NativeReviewFinding,
  type NativeVerificationReceipt,
  type NativeVerificationReceiptBindings,
  type NativeWaiverReceipt,
} from './native-verification-receipt.js';
import {
  buildNativeImplementationScopeBundle,
  type NativeImplementationScopeBundle,
  type NativeSnapshotProjection,
} from './native-verification-scope.js';

const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
export const MAX_NATIVE_AUTOMATED_COMMAND_TIMEOUT_MS = 60 * 60 * 1_000;
const AUTOMATED_COMMAND_TERMINATION_WAIT_MS = 4_000;
const execFileAsync = promisify(execFile);
const REVIEW_PREPARATION_SCHEMA = 'comet.native.review-preparation.v1' as const;
const REVIEW_APPROVAL_SCHEMA = 'comet.native.review-approval.v1' as const;
const IMPLEMENTATION_PREPARATION_SCHEMA = 'comet.native.implementation-preparation.v1' as const;

export interface NativeIndependentReviewPreparation {
  schema: typeof REVIEW_PREPARATION_SCHEMA;
  bindings: NativeVerificationReceiptBindings;
  acceptanceIds: string[];
  implementationReceiptRef: string;
  reportRef: string;
  requiredReceiptRefs: string[];
  reviewerIdentity: NativeReviewIdentity;
  checkedEvidence: {
    unifiedIo: string | null;
    adversarialPaths: string | null;
    generatedAssets: string | null;
    lifecycleEval: string | null;
  };
  preparationHash: string;
}

type UnsignedIndependentReviewReceipt = Omit<
  Extract<NativeVerificationReceipt, { kind: 'independent-review' }>,
  'schema' | 'receiptHash' | 'evidence'
> & {
  evidence: Omit<
    Extract<NativeVerificationReceipt, { kind: 'independent-review' }>['evidence'],
    'attestation'
  >;
};

export interface NativeIndependentReviewApproval {
  schema: typeof REVIEW_APPROVAL_SCHEMA;
  preparationHash: string;
  receipt: UnsignedIndependentReviewReceipt;
  payloadHash: string;
}

type UnsignedImplementationReceipt = Omit<
  Extract<NativeVerificationReceipt, { kind: 'implementation-attestation' }>,
  'schema' | 'receiptHash' | 'evidence'
> & {
  evidence: Omit<
    Extract<NativeVerificationReceipt, { kind: 'implementation-attestation' }>['evidence'],
    'attestation'
  >;
};

export interface NativeImplementationPreparation {
  schema: typeof IMPLEMENTATION_PREPARATION_SCHEMA;
  receipt: UnsignedImplementationReceipt;
  payloadHash: string;
  preparationHash: string;
}

async function withNativeReceiptIssuanceLock<T>(options: {
  paths: NativeProjectPaths;
  name: string;
  operation: string;
  issue: (state: NativeChangeState) => Promise<T>;
}): Promise<T> {
  return withNativeMutationLock(options.paths, options.operation, () =>
    withNativeTransitionLock(options.paths, options.name, options.operation, async () => {
      await settleNativeChangeJournalsLocked(options.paths, options.name);
      return options.issue(await readNativeChange(options.paths, options.name));
    }),
  );
}

export interface NativeVerificationReceiptContext {
  bindings: NativeVerificationReceiptBindings;
  acceptanceIds: string[];
  implementationAuthor: string;
  implementationExecutionId: string;
  scope: NativeImplementationScopeBundle;
}

function boundedText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > MAX_COMMAND_OUTPUT_BYTES) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function normalizeAcceptanceIds(values: readonly string[], expected: readonly string[]): string[] {
  const acceptanceIds = [...values].sort();
  if (
    acceptanceIds.length === 0 ||
    new Set(acceptanceIds).size !== acceptanceIds.length ||
    acceptanceIds.some((id) => !expected.includes(id))
  ) {
    throw new Error('Native receipt acceptance IDs do not match the current contract');
  }
  return acceptanceIds;
}

export async function loadNativeVerificationReceiptContext(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeVerificationReceiptContext> {
  if (state.phase !== 'verify') {
    throw new Error(`Native verification receipt issuance requires Verify, got ${state.phase}`);
  }
  if (!state.implementation_scope) {
    throw new Error('Native verification receipt issuance requires an implementation scope');
  }
  const [scope, contract] = await Promise.all([
    readNativeImplementationScopeBundle(paths, state.name, state.implementation_scope),
    collectNativeContractFiles({
      changeDir: nativeChangeDir(paths, state.name),
      briefRef: state.brief,
      specChanges: state.spec_changes,
    }),
  ]);
  if (scope.scope.contractHash !== contract.contract.contractHash) {
    throw new Error('Native verification receipt contract/scope mismatch');
  }
  const implementationExecutionId = state.run_id
    ? `run:${state.run_id}`
    : `scope:${scope.scope.scopeHash}`;
  return {
    bindings: {
      change: state.name,
      sourceRevision: state.revision,
      contractHash: contract.contract.contractHash,
      scopeHash: scope.scope.scopeHash,
      snapshotHash: scope.scope.currentProjectionHash,
      artifactHash: nativeArtifactBindingHash(scope.scope.declaredArtifacts),
    },
    acceptanceIds: contract.contract.acceptance.map((criterion) => criterion.id).sort(),
    implementationAuthor: `native-implementation:${implementationExecutionId}`,
    implementationExecutionId,
    scope,
  };
}

export function nativeReceiptBindingsMatch(
  receipt: Pick<NativeVerificationReceipt, 'bindings'>,
  expected: NativeVerificationReceiptBindings,
): boolean {
  return JSON.stringify(receipt.bindings) === JSON.stringify(expected);
}

export async function persistNativeStaticInspectionReceipt(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  checkReceipt: NativeCheckReceipt;
  checkReceiptRef: string;
}): Promise<{ receipt: NativeVerificationReceipt; ref: string }> {
  const context = await loadNativeVerificationReceiptContext(options.paths, options.state);
  const blocked =
    options.checkReceipt.stale ||
    options.checkReceipt.issues.some((issue) =>
      ['scan-limit', 'scope-mismatch', 'unsafe-file', 'binary-skipped'].includes(issue.kind),
    );
  const status =
    options.checkReceipt.status === 'passed' ? 'passed' : blocked ? 'blocked' : 'failed';
  const receipt = buildNativeVerificationReceipt({
    kind: 'static-inspection',
    role: 'required-check',
    status,
    bindings: context.bindings,
    acceptanceIds: [],
    actor: `native-runtime:${options.checkReceipt.checker.policy}`,
    issuedAt: options.checkReceipt.endedAt,
    evidence: {
      subjects: context.scope.scope.changes.map((change) => change.path).sort(),
      rule: options.checkReceipt.checker.policy,
      resultSummary:
        status === 'passed'
          ? 'The built-in scoped inspection passed without skipped or blocking input.'
          : `The built-in scoped inspection recorded ${options.checkReceipt.counts.issueCount} blocking issue(s).`,
      checkReceiptRef: options.checkReceiptRef,
      checkReceiptHash: options.checkReceipt.receiptHash,
    },
  });
  const ref = await writeNativeVerificationReceipt({
    paths: options.paths,
    name: options.state.name,
    receipt,
  });
  return { receipt, ref };
}

export async function issueNativeManualEvidenceReceipt(options: {
  paths: NativeProjectPaths;
  name: string;
  acceptanceIds: readonly string[];
  responsible: string;
  steps: readonly string[];
  observations: readonly string[];
  confirmed: boolean;
  now?: Date;
}): Promise<{ receipt: NativeVerificationReceipt; ref: string }> {
  return withNativeReceiptIssuanceLock({
    paths: options.paths,
    name: options.name,
    operation: `issue manual receipt ${options.name}`,
    issue: (state) => issueNativeManualEvidenceReceiptLocked({ ...options, state }),
  });
}

async function issueNativeManualEvidenceReceiptLocked(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  acceptanceIds: readonly string[];
  responsible: string;
  steps: readonly string[];
  observations: readonly string[];
  confirmed: boolean;
  now?: Date;
}): Promise<{ receipt: NativeVerificationReceipt; ref: string }> {
  if (!options.confirmed) {
    throw new Error('Native manual evidence issuance requires explicit confirmation');
  }
  const context = await loadNativeVerificationReceiptContext(options.paths, options.state);
  const receipt = buildNativeVerificationReceipt({
    kind: 'manual-evidence',
    role: 'acceptance-evidence',
    status: 'passed',
    bindings: context.bindings,
    acceptanceIds: normalizeAcceptanceIds(options.acceptanceIds, context.acceptanceIds),
    actor: options.responsible,
    issuedAt: (options.now ?? new Date()).toISOString(),
    evidence: {
      steps: [...options.steps],
      observations: [...options.observations],
      responsible: options.responsible,
    },
  });
  return {
    receipt,
    ref: await writeNativeVerificationReceipt({
      paths: options.paths,
      name: options.state.name,
      receipt,
    }),
  };
}

function buildReviewPreparation(
  input: Omit<NativeIndependentReviewPreparation, 'schema' | 'preparationHash'>,
): NativeIndependentReviewPreparation {
  const content = {
    schema: REVIEW_PREPARATION_SCHEMA,
    bindings: input.bindings,
    acceptanceIds: [...input.acceptanceIds].sort(),
    implementationReceiptRef: input.implementationReceiptRef,
    reportRef: input.reportRef,
    requiredReceiptRefs: [...input.requiredReceiptRefs].sort(),
    reviewerIdentity: parseNativeReviewIdentity(input.reviewerIdentity),
    checkedEvidence: { ...input.checkedEvidence },
  };
  return { ...content, preparationHash: canonicalHash(REVIEW_PREPARATION_SCHEMA, content) };
}

async function prepareNativeImplementationLocked(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  implementationIdentity: NativeReviewIdentity;
  now?: Date;
}): Promise<NativeImplementationPreparation> {
  const context = await loadNativeVerificationReceiptContext(options.paths, options.state);
  const policy = await loadNativeReviewTrustPolicy({
    paths: options.paths,
    scope: context.scope,
  });
  const implementationIdentity = parseNativeReviewIdentity(options.implementationIdentity);
  if (implementationIdentity.keyId !== policy.implementationKeyId) {
    throw new Error('Native implementation identity is not the pre-trusted implementation key');
  }
  const receipt: UnsignedImplementationReceipt = {
    kind: 'implementation-attestation',
    role: 'acceptance-evidence',
    status: 'passed',
    bindings: context.bindings,
    acceptanceIds: context.acceptanceIds,
    actor: `implementation-key:${implementationIdentity.keyId}`,
    issuedAt: (options.now ?? new Date()).toISOString(),
    evidence: {
      implementationExecutionId: context.implementationExecutionId,
      reviewPolicyHash: policy.policyHash,
      implementationIdentity,
    },
  };
  const payloadHash = nativeImplementationAttestationHash({
    bindings: receipt.bindings,
    status: receipt.status,
    acceptanceIds: receipt.acceptanceIds,
    issuedAt: receipt.issuedAt,
    evidence: receipt.evidence,
  });
  const content = {
    schema: IMPLEMENTATION_PREPARATION_SCHEMA,
    receipt,
    payloadHash,
  };
  return {
    ...content,
    preparationHash: canonicalHash(IMPLEMENTATION_PREPARATION_SCHEMA, content),
  };
}

export async function prepareNativeImplementationAttestation(options: {
  paths: NativeProjectPaths;
  name: string;
  implementationIdentity: NativeReviewIdentity;
  now?: Date;
}): Promise<NativeImplementationPreparation> {
  return withNativeReceiptIssuanceLock({
    paths: options.paths,
    name: options.name,
    operation: `prepare implementation attestation ${options.name}`,
    issue: (state) => prepareNativeImplementationLocked({ ...options, state }),
  });
}

export async function finalizeNativeImplementationAttestation(options: {
  paths: NativeProjectPaths;
  name: string;
  preparation: NativeImplementationPreparation;
  attestation: NativeReviewSignature;
  confirmed: boolean;
}): Promise<{ receipt: NativeVerificationReceipt; ref: string }> {
  return withNativeReceiptIssuanceLock({
    paths: options.paths,
    name: options.name,
    operation: `finalize implementation attestation ${options.name}`,
    issue: async (state) => {
      if (!options.confirmed) {
        throw new Error('Native implementation attestation requires explicit confirmation');
      }
      const context = await loadNativeVerificationReceiptContext(options.paths, state);
      const policy = await loadNativeReviewTrustPolicy({
        paths: options.paths,
        scope: context.scope,
      });
      const preparation = options.preparation;
      const content = {
        schema: IMPLEMENTATION_PREPARATION_SCHEMA,
        receipt: preparation.receipt,
        payloadHash: preparation.payloadHash,
      };
      const expectedPayloadHash = nativeImplementationAttestationHash({
        bindings: preparation.receipt.bindings,
        status: preparation.receipt.status,
        acceptanceIds: preparation.receipt.acceptanceIds,
        issuedAt: preparation.receipt.issuedAt,
        evidence: preparation.receipt.evidence,
      });
      if (
        preparation.schema !== IMPLEMENTATION_PREPARATION_SCHEMA ||
        preparation.preparationHash !== canonicalHash(IMPLEMENTATION_PREPARATION_SCHEMA, content) ||
        preparation.payloadHash !== expectedPayloadHash ||
        JSON.stringify(preparation.receipt.bindings) !== JSON.stringify(context.bindings) ||
        JSON.stringify(preparation.receipt.acceptanceIds) !==
          JSON.stringify(context.acceptanceIds) ||
        preparation.receipt.evidence.implementationExecutionId !==
          context.implementationExecutionId ||
        preparation.receipt.evidence.reviewPolicyHash !== policy.policyHash ||
        preparation.receipt.evidence.implementationIdentity.keyId !== policy.implementationKeyId
      ) {
        throw new Error('Native implementation preparation is stale or invalid');
      }
      const receipt = buildNativeVerificationReceipt({
        ...preparation.receipt,
        evidence: { ...preparation.receipt.evidence, attestation: options.attestation },
      });
      return {
        receipt,
        ref: await writeNativeVerificationReceipt({
          paths: options.paths,
          name: state.name,
          receipt,
        }),
      };
    },
  });
}

async function prepareNativeIndependentReviewLocked(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  implementationReceiptRef: string;
  reportRef: string;
  requiredReceiptRefs: readonly string[];
  reviewerIdentity: NativeReviewIdentity;
  checkedEvidence: NativeIndependentReviewPreparation['checkedEvidence'];
}): Promise<NativeIndependentReviewPreparation> {
  const context = await loadNativeVerificationReceiptContext(options.paths, options.state);
  const policy = await loadNativeReviewTrustPolicy({
    paths: options.paths,
    scope: context.scope,
  });
  const reviewerIdentity = parseNativeReviewIdentity(options.reviewerIdentity);
  trustedNativeIdentity(policy, 'reviewer', reviewerIdentity.keyId);
  if (reviewerIdentity.keyId === policy.implementationKeyId) {
    throw new Error('Native independent reviewer must differ from implementation identity');
  }
  const implementationReceipt = await readNativeVerificationReceipt(
    options.paths,
    options.state.name,
    options.implementationReceiptRef,
  );
  if (
    implementationReceipt.kind !== 'implementation-attestation' ||
    implementationReceipt.status !== 'passed' ||
    !nativeReceiptBindingsMatch(implementationReceipt, context.bindings) ||
    JSON.stringify(implementationReceipt.acceptanceIds) !== JSON.stringify(context.acceptanceIds) ||
    implementationReceipt.evidence.implementationIdentity.keyId !== policy.implementationKeyId ||
    implementationReceipt.evidence.reviewPolicyHash !== policy.policyHash ||
    implementationReceipt.evidence.implementationExecutionId !== context.implementationExecutionId
  ) {
    throw new Error('Native independent review requires a current implementation attestation');
  }
  return buildReviewPreparation({
    bindings: context.bindings,
    acceptanceIds: context.acceptanceIds,
    implementationReceiptRef: options.implementationReceiptRef,
    reportRef: options.reportRef,
    requiredReceiptRefs: [...options.requiredReceiptRefs],
    reviewerIdentity,
    checkedEvidence: options.checkedEvidence,
  });
}

export async function prepareNativeIndependentReview(options: {
  paths: NativeProjectPaths;
  name: string;
  implementationReceiptRef: string;
  reportRef: string;
  requiredReceiptRefs: readonly string[];
  reviewerIdentity: NativeReviewIdentity;
  checkedEvidence: NativeIndependentReviewPreparation['checkedEvidence'];
}): Promise<NativeIndependentReviewPreparation> {
  return withNativeReceiptIssuanceLock({
    paths: options.paths,
    name: options.name,
    operation: `prepare review ${options.name}`,
    issue: (state) => prepareNativeIndependentReviewLocked({ ...options, state }),
  });
}

export async function approveNativeIndependentReviewPreparation(options: {
  paths: NativeProjectPaths;
  name: string;
  preparation: NativeIndependentReviewPreparation;
  acceptanceApplicability: boolean;
  manualAttestationRefs: readonly string[];
  findings: readonly NativeReviewFinding[];
  now?: Date;
}): Promise<NativeIndependentReviewApproval> {
  return withNativeReceiptIssuanceLock({
    paths: options.paths,
    name: options.name,
    operation: `approve review ${options.name}`,
    issue: async (state) => {
      const expected = await prepareNativeIndependentReviewLocked({
        paths: options.paths,
        state,
        implementationReceiptRef: options.preparation.implementationReceiptRef,
        reportRef: options.preparation.reportRef,
        requiredReceiptRefs: options.preparation.requiredReceiptRefs,
        reviewerIdentity: options.preparation.reviewerIdentity,
        checkedEvidence: options.preparation.checkedEvidence,
      });
      if (JSON.stringify(expected) !== JSON.stringify(options.preparation)) {
        throw new Error('Native review preparation is not Runtime-derived from current evidence');
      }
      const context = await loadNativeVerificationReceiptContext(options.paths, state);
      const policy = await loadNativeReviewTrustPolicy({
        paths: options.paths,
        scope: context.scope,
      });
      const reviewed = await buildReviewedEvidenceGraph({
        paths: options.paths,
        state,
        context,
        policy,
        reportRef: expected.reportRef,
        requiredReceiptRefs: expected.requiredReceiptRefs,
        checked: {
          acceptanceApplicability: options.acceptanceApplicability,
          ...expected.checkedEvidence,
        },
        manualAttestationRefs: options.manualAttestationRefs,
      });
      const issuedAt = (options.now ?? new Date()).toISOString();
      const status =
        options.acceptanceApplicability &&
        !reviewed.hasFailedAcceptance &&
        !options.findings.some(
          (finding) =>
            finding.status === 'open' && (finding.severity === 'P0' || finding.severity === 'P1'),
        )
          ? 'passed'
          : 'blocked';
      const reviewEvidence = {
        preparationHash: expected.preparationHash,
        implementationKeyId: policy.implementationKeyId,
        implementationReceiptRef: expected.implementationReceiptRef,
        reviewPolicyHash: policy.policyHash,
        reviewerIdentity: expected.reviewerIdentity,
        matrixHash: reviewed.matrixHash,
        checked: {
          acceptanceApplicability: options.acceptanceApplicability,
          ...expected.checkedEvidence,
        },
        evidenceGraph: reviewed.evidenceGraph,
        findings: [...options.findings],
      };
      const receipt: UnsignedIndependentReviewReceipt = {
        kind: 'independent-review',
        role: 'acceptance-evidence',
        status,
        bindings: context.bindings,
        acceptanceIds: context.acceptanceIds,
        actor: `review-key:${expected.reviewerIdentity.keyId}`,
        issuedAt,
        evidence: reviewEvidence,
      };
      return {
        schema: REVIEW_APPROVAL_SCHEMA,
        preparationHash: expected.preparationHash,
        receipt,
        payloadHash: nativeIndependentReviewAttestationHash({
          bindings: receipt.bindings,
          status: receipt.status,
          acceptanceIds: receipt.acceptanceIds,
          issuedAt: receipt.issuedAt,
          evidence: receipt.evidence,
        }),
      };
    },
  });
}

export async function finalizeNativeIndependentReviewReceipt(options: {
  paths: NativeProjectPaths;
  name: string;
  preparation: NativeIndependentReviewPreparation;
  approval: NativeIndependentReviewApproval;
  attestation: NativeReviewSignature;
  confirmed: boolean;
}): Promise<{ receipt: NativeVerificationReceipt; ref: string }> {
  return withNativeReceiptIssuanceLock({
    paths: options.paths,
    name: options.name,
    operation: `finalize review ${options.name}`,
    issue: async (state) => {
      if (!options.confirmed) {
        throw new Error('Native independent review finalization requires explicit confirmation');
      }
      const expected = await prepareNativeIndependentReviewLocked({
        paths: options.paths,
        state,
        implementationReceiptRef: options.preparation.implementationReceiptRef,
        reportRef: options.preparation.reportRef,
        requiredReceiptRefs: options.preparation.requiredReceiptRefs,
        reviewerIdentity: options.preparation.reviewerIdentity,
        checkedEvidence: options.preparation.checkedEvidence,
      });
      if (
        JSON.stringify(expected) !== JSON.stringify(options.preparation) ||
        options.approval.schema !== REVIEW_APPROVAL_SCHEMA ||
        options.approval.preparationHash !== expected.preparationHash ||
        options.approval.receipt.evidence.preparationHash !== expected.preparationHash
      ) {
        throw new Error('Native review approval does not match the current preparation');
      }
      const payloadHash = nativeIndependentReviewAttestationHash({
        bindings: options.approval.receipt.bindings,
        status: options.approval.receipt.status,
        acceptanceIds: options.approval.receipt.acceptanceIds,
        issuedAt: options.approval.receipt.issuedAt,
        evidence: options.approval.receipt.evidence,
      });
      if (payloadHash !== options.approval.payloadHash) {
        throw new Error('Native review approval payload hash mismatch');
      }
      const receipt = buildNativeVerificationReceipt({
        ...options.approval.receipt,
        evidence: { ...options.approval.receipt.evidence, attestation: options.attestation },
      });
      const report = await readNativeBoundedTextFile({
        root: nativeChangeDir(options.paths, state.name),
        ref: expected.reportRef,
        maxBytes: 1024 * 1024,
      });
      const reviewReceipt = receipt as Extract<
        NativeVerificationReceipt,
        { kind: 'independent-review' }
      >;
      await validateNativeReviewEvidenceGraph({
        paths: options.paths,
        state,
        reviewReceipt,
        matrix: parseNativeVerificationMachineBlock(report.text),
        expectedReceiptRefs: reviewReceipt.evidence.evidenceGraph.reviewedReceiptRefs,
        expectedWaiverRefs: reviewReceipt.evidence.evidenceGraph.reviewedWaiverRefs,
      });
      return {
        receipt,
        ref: await writeNativeVerificationReceipt({
          paths: options.paths,
          name: state.name,
          receipt,
        }),
      };
    },
  });
}

export async function issueNativeImplementationAttestationReceipt(options: {
  paths: NativeProjectPaths;
  name: string;
  implementationIdentity: NativeReviewIdentity;
  privateKey: string;
  confirmed: boolean;
  now?: Date;
}): Promise<{ receipt: NativeVerificationReceipt; ref: string }> {
  return withNativeReceiptIssuanceLock({
    paths: options.paths,
    name: options.name,
    operation: `issue implementation attestation ${options.name}`,
    issue: async (state) => {
      if (!options.confirmed) {
        throw new Error('Native implementation attestation requires explicit confirmation');
      }
      const context = await loadNativeVerificationReceiptContext(options.paths, state);
      const policy = await loadNativeReviewTrustPolicy({
        paths: options.paths,
        scope: context.scope,
      });
      const implementationIdentity = parseNativeReviewIdentity(options.implementationIdentity);
      if (implementationIdentity.keyId !== policy.implementationKeyId) {
        throw new Error('Native implementation identity is not the pre-trusted implementation key');
      }
      const issuedAt = (options.now ?? new Date()).toISOString();
      const implementationEvidence = {
        implementationExecutionId: context.implementationExecutionId,
        reviewPolicyHash: policy.policyHash,
        implementationIdentity,
      };
      const receipt = buildNativeVerificationReceipt({
        kind: 'implementation-attestation',
        role: 'acceptance-evidence',
        status: 'passed',
        bindings: context.bindings,
        acceptanceIds: context.acceptanceIds,
        actor: `implementation-key:${implementationIdentity.keyId}`,
        issuedAt,
        evidence: {
          ...implementationEvidence,
          attestation: signNativeReviewPayloadHash({
            identity: implementationIdentity,
            privateKey: options.privateKey,
            payloadHash: nativeImplementationAttestationHash({
              bindings: context.bindings,
              status: 'passed',
              acceptanceIds: context.acceptanceIds,
              issuedAt,
              evidence: implementationEvidence,
            }),
          }),
        },
      });
      return {
        receipt,
        ref: await writeNativeVerificationReceipt({
          paths: options.paths,
          name: state.name,
          receipt,
        }),
      };
    },
  });
}

function automatedReplayMatches(
  source: Extract<NativeVerificationReceipt, { kind: 'automated-check' }>,
  replay: Extract<NativeVerificationReceipt, { kind: 'automated-check' }>,
): boolean {
  return (
    source.status === replay.status &&
    JSON.stringify(source.acceptanceIds) === JSON.stringify(replay.acceptanceIds) &&
    source.evidence.executable === replay.evidence.executable &&
    JSON.stringify(source.evidence.args) === JSON.stringify(replay.evidence.args) &&
    source.evidence.exitCode === replay.evidence.exitCode &&
    source.evidence.signal === replay.evidence.signal &&
    source.evidence.timedOut === replay.evidence.timedOut &&
    source.evidence.timeoutMs === replay.evidence.timeoutMs &&
    source.evidence.outputHash === replay.evidence.outputHash &&
    source.evidence.afterFence.matched === replay.evidence.afterFence.matched &&
    source.evidence.afterFence.scopeHash === replay.evidence.afterFence.scopeHash &&
    source.evidence.afterFence.snapshotHash === replay.evidence.afterFence.snapshotHash &&
    source.evidence.worktree.provider === replay.evidence.worktree.provider &&
    source.evidence.worktree.root === replay.evidence.worktree.root &&
    source.evidence.worktree.beforeCommit === replay.evidence.worktree.beforeCommit &&
    source.evidence.worktree.afterCommit === replay.evidence.worktree.afterCommit
  );
}

function staticReplayMatches(source: NativeCheckReceipt, replay: NativeCheckReceipt): boolean {
  return (
    JSON.stringify({
      status: source.status,
      checker: source.checker,
      contract: source.contract,
      implementation: source.implementation,
      counts: source.counts,
      issues: source.issues,
      issuesTruncated: source.issuesTruncated,
      stale: source.stale,
      staleReasons: source.staleReasons,
    }) ===
    JSON.stringify({
      status: replay.status,
      checker: replay.checker,
      contract: replay.contract,
      implementation: replay.implementation,
      counts: replay.counts,
      issues: replay.issues,
      issuesTruncated: replay.issuesTruncated,
      stale: replay.stale,
      staleReasons: replay.staleReasons,
    })
  );
}

function sameSortedRefs(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

/**
 * Revalidates the reviewer's signed matrix and every recorded evidence replay.
 * Verify and Archive both call this through the shared v2 receipt-graph validator.
 */
export async function validateNativeReviewEvidenceGraph(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  reviewReceipt: Extract<NativeVerificationReceipt, { kind: 'independent-review' }>;
  matrix: readonly NativeAcceptanceEvidenceEntry[];
  expectedReceiptRefs: readonly string[];
  expectedWaiverRefs: readonly string[];
}): Promise<void> {
  const { evidenceGraph } = options.reviewReceipt.evidence;
  if (
    options.reviewReceipt.evidence.matrixHash !== nativeReviewAcceptanceMatrixHash(options.matrix)
  ) {
    throw new Error('Native independent review acceptance matrix is stale');
  }
  if (
    !sameSortedRefs(evidenceGraph.reviewedReceiptRefs, options.expectedReceiptRefs) ||
    !sameSortedRefs(evidenceGraph.reviewedWaiverRefs, options.expectedWaiverRefs)
  ) {
    throw new Error('Native independent review evidence graph is stale');
  }

  const automatedReplays = new Map(
    evidenceGraph.automatedReplays.map((replay) => [replay.sourceRef, replay.replayRef]),
  );
  const staticReplays = new Map(
    evidenceGraph.staticReplays.map((replay) => [replay.sourceRef, replay.replayRef]),
  );
  const manualAttestations = new Set(evidenceGraph.manualAttestationRefs);
  const reviewedRefs = new Set(evidenceGraph.reviewedReceiptRefs);
  const replayRefs = [
    ...evidenceGraph.automatedReplays.map((replay) => replay.replayRef),
    ...evidenceGraph.staticReplays.map((replay) => replay.replayRef),
  ];
  if (
    new Set(replayRefs).size !== replayRefs.length ||
    replayRefs.some((ref) => reviewedRefs.has(ref))
  ) {
    throw new Error('Native independent review replay refs are not independent artifacts');
  }

  for (const sourceRef of evidenceGraph.reviewedReceiptRefs) {
    const source = await readNativeVerificationReceipt(
      options.paths,
      options.state.name,
      sourceRef,
    );
    if (!nativeReceiptBindingsMatch(source, options.reviewReceipt.bindings)) {
      throw new Error('Native reviewed evidence replay source is stale');
    }
    if (source.kind === 'automated-check') {
      const replayRef = automatedReplays.get(sourceRef);
      if (
        !replayRef ||
        staticReplays.has(sourceRef) ||
        manualAttestations.has(sourceRef) ||
        replayRef === sourceRef
      ) {
        throw new Error('Native automated review evidence has no independent replay');
      }
      const replay = await readNativeVerificationReceipt(
        options.paths,
        options.state.name,
        replayRef,
      );
      if (
        replay.kind !== 'automated-check' ||
        !nativeReceiptBindingsMatch(replay, options.reviewReceipt.bindings) ||
        !automatedReplayMatches(source, replay) ||
        Date.parse(replay.issuedAt) < Date.parse(source.issuedAt) ||
        Date.parse(replay.issuedAt) > Date.parse(options.reviewReceipt.issuedAt)
      ) {
        throw new Error('Native automated review evidence replay is invalid');
      }
      continue;
    }
    if (source.kind === 'static-inspection') {
      const replayRef = staticReplays.get(sourceRef);
      if (
        !replayRef ||
        automatedReplays.has(sourceRef) ||
        manualAttestations.has(sourceRef) ||
        replayRef === sourceRef
      ) {
        throw new Error('Native static review evidence has no independent replay');
      }
      const replay = await readNativeVerificationReceipt(
        options.paths,
        options.state.name,
        replayRef,
      );
      if (
        replay.kind !== 'static-inspection' ||
        !nativeReceiptBindingsMatch(replay, options.reviewReceipt.bindings) ||
        Date.parse(replay.issuedAt) < Date.parse(source.issuedAt) ||
        Date.parse(replay.issuedAt) > Date.parse(options.reviewReceipt.issuedAt)
      ) {
        throw new Error('Native static review evidence replay is invalid');
      }
      const [sourceCheck, replayCheck] = await Promise.all([
        readNativeCheckReceipt(options.paths, options.state.name, source.evidence.checkReceiptRef),
        readNativeCheckReceipt(options.paths, options.state.name, replay.evidence.checkReceiptRef),
      ]);
      if (
        sourceCheck.receiptHash !== source.evidence.checkReceiptHash ||
        replayCheck.receiptHash !== replay.evidence.checkReceiptHash ||
        !staticReplayMatches(sourceCheck, replayCheck)
      ) {
        throw new Error('Native static review evidence replay result changed');
      }
      continue;
    }
    if (source.kind === 'manual-evidence') {
      if (
        !manualAttestations.has(sourceRef) ||
        automatedReplays.has(sourceRef) ||
        staticReplays.has(sourceRef)
      ) {
        throw new Error('Native manual review evidence was not attested by the reviewer');
      }
      continue;
    }
    throw new Error(
      'Native reviewed evidence graph may contain only automated, manual, or static receipts',
    );
  }
  if (automatedReplays.size + staticReplays.size + manualAttestations.size !== reviewedRefs.size) {
    throw new Error('Native independent review evidence graph contains extra replay sources');
  }
}

async function buildReviewedEvidenceGraph(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  context: NativeVerificationReceiptContext;
  policy: Awaited<ReturnType<typeof loadNativeReviewTrustPolicy>>;
  reportRef: string;
  requiredReceiptRefs: readonly string[];
  checked: {
    acceptanceApplicability: boolean;
    unifiedIo: string | null;
    adversarialPaths: string | null;
    generatedAssets: string | null;
    lifecycleEval: string | null;
  };
  manualAttestationRefs?: readonly string[];
}): Promise<{
  matrixHash: string;
  evidenceGraph: ReturnType<typeof buildNativeReviewEvidenceGraph>;
  hasFailedAcceptance: boolean;
}> {
  const report = await readNativeBoundedTextFile({
    root: nativeChangeDir(options.paths, options.state.name),
    ref: options.reportRef,
    maxBytes: 1024 * 1024,
  });
  const matrix = parseNativeVerificationMachineBlock(report.text);
  if (
    JSON.stringify(matrix.map((entry) => entry.acceptance_id).sort()) !==
    JSON.stringify(options.context.acceptanceIds)
  ) {
    throw new Error('Native independent review report must cover the complete acceptance set');
  }
  const reviewedReceiptRefs = new Set<string>();
  const reviewedWaiverRefs = new Set<string>();
  const receipts = new Map<string, NativeVerificationReceipt>();
  const addReceipt = async (ref: string): Promise<NativeVerificationReceipt> => {
    const existing = receipts.get(ref);
    if (existing) return existing;
    const receipt = await readNativeVerificationReceipt(options.paths, options.state.name, ref);
    if (!nativeReceiptBindingsMatch(receipt, options.context.bindings)) {
      throw new Error('Native reviewed receipt does not match current bindings');
    }
    receipts.set(ref, receipt);
    reviewedReceiptRefs.add(ref);
    return receipt;
  };
  for (const ref of options.requiredReceiptRefs) {
    const receipt = await addReceipt(ref);
    if (receipt.kind !== 'static-inspection' || receipt.role !== 'required-check') {
      throw new Error('Native reviewed required receipt must be a static inspection');
    }
  }
  for (const entry of matrix) {
    if (entry.status === 'passed') {
      for (const ref of entry.evidence_refs) {
        const receipt = await addReceipt(ref);
        if (
          (receipt.kind !== 'automated-check' && receipt.kind !== 'manual-evidence') ||
          receipt.role !== 'acceptance-evidence' ||
          receipt.status !== 'passed' ||
          !receipt.acceptanceIds.includes(entry.acceptance_id)
        ) {
          throw new Error(
            'Native reviewed acceptance evidence must be a current passed automated-check or manual-evidence receipt',
          );
        }
      }
      continue;
    }
    if (entry.status !== 'waived') continue;
    const waiver = await readNativeWaiverReceipt(
      options.paths,
      options.state.name,
      entry.waiver_ref!,
    );
    if (
      waiver.acceptanceId !== entry.acceptance_id ||
      JSON.stringify(waiver.bindings) !== JSON.stringify(options.context.bindings) ||
      waiver.reviewPolicyHash !== options.policy.policyHash
    ) {
      throw new Error('Native reviewed waiver does not match current bindings/policy');
    }
    trustedNativeIdentity(options.policy, 'waiver', waiver.signerIdentity.keyId);
    reviewedWaiverRefs.add(entry.waiver_ref!);
    const blocked = await addReceipt(waiver.blockedReceiptRef);
    if (
      blocked.status === 'passed' ||
      (blocked.role === 'acceptance-evidence' &&
        !blocked.acceptanceIds.includes(entry.acceptance_id)) ||
      waiver.blockedCheckId !== nativeBlockedCheckId(blocked)
    ) {
      throw new Error('Native reviewed waiver blocking receipt is invalid');
    }
    for (const ref of waiver.alternativeReceiptRefs) {
      const alternative = await addReceipt(ref);
      if (
        (alternative.kind !== 'automated-check' && alternative.kind !== 'manual-evidence') ||
        alternative.status !== 'passed' ||
        !alternative.acceptanceIds.includes(entry.acceptance_id)
      ) {
        throw new Error(
          'Native reviewed waiver alternative must be passed automated/manual evidence',
        );
      }
    }
  }
  const highRisk =
    !options.context.scope.scope.complete ||
    isNativeHighRiskScope(options.context.scope.scope.changes);
  const highRiskChecks = [
    ['unifiedIo', options.checked.unifiedIo],
    ['adversarialPaths', options.checked.adversarialPaths],
    ['generatedAssets', options.checked.generatedAssets],
    ['lifecycleEval', options.checked.lifecycleEval],
  ] as const;
  if (highRisk && highRiskChecks.some(([, ref]) => ref === null)) {
    throw new Error('Native high-risk review requires typed evidence for all four checks');
  }
  for (const [name, ref] of highRiskChecks) {
    if (ref === null) continue;
    const receipt = await addReceipt(ref);
    const allowed =
      name === 'unifiedIo'
        ? receipt.kind === 'static-inspection' || receipt.kind === 'manual-evidence'
        : receipt.kind === 'automated-check' || receipt.kind === 'manual-evidence';
    if (!allowed || receipt.status !== 'passed') {
      throw new Error(`Native ${name} review check lacks valid typed evidence`);
    }
  }

  const automatedReplays: Array<{ sourceRef: string; replayRef: string }> = [];
  const staticReplays: Array<{ sourceRef: string; replayRef: string }> = [];
  const requiredManualAttestations =
    options.manualAttestationRefs === undefined ? null : new Set(options.manualAttestationRefs);
  const manualAttestationRefs: string[] = [];
  for (const [sourceRef, receipt] of [...receipts.entries()].sort(([left], [right]) =>
    left.localeCompare(right, 'en'),
  )) {
    if (receipt.kind === 'automated-check') {
      const replay = await issueNativeAutomatedCheckReceiptLocked({
        paths: options.paths,
        state: options.state,
        acceptanceIds: receipt.acceptanceIds,
        command: receipt.evidence.executable,
        args: receipt.evidence.args,
        timeoutMs: receipt.evidence.timeoutMs,
      });
      if (
        replay.receipt.kind !== 'automated-check' ||
        !automatedReplayMatches(receipt, replay.receipt)
      ) {
        throw new Error('Native automated evidence replay did not reproduce its receipt');
      }
      automatedReplays.push({ sourceRef, replayRef: replay.ref });
    } else if (receipt.kind === 'static-inspection') {
      const sourceCheck = await readNativeCheckReceipt(
        options.paths,
        options.state.name,
        receipt.evidence.checkReceiptRef,
      );
      const replayCheck = await executeNativeCheckReceipt({
        paths: options.paths,
        state: options.state,
      });
      if (!staticReplayMatches(sourceCheck, replayCheck.receipt)) {
        throw new Error('Native static evidence replay did not reproduce its receipt');
      }
      const replay = await persistNativeStaticInspectionReceipt({
        paths: options.paths,
        state: options.state,
        checkReceipt: replayCheck.receipt,
        checkReceiptRef: replayCheck.ref,
      });
      staticReplays.push({ sourceRef, replayRef: replay.ref });
    } else if (receipt.kind === 'manual-evidence') {
      if (requiredManualAttestations !== null && !requiredManualAttestations.has(sourceRef)) {
        throw new Error(
          'Native manual review evidence requires explicit external reviewer attestation',
        );
      }
      manualAttestationRefs.push(sourceRef);
    } else {
      throw new Error(
        'Native reviewed evidence graph may contain only automated, manual, or static receipts',
      );
    }
  }
  if (
    requiredManualAttestations !== null &&
    (requiredManualAttestations.size !== manualAttestationRefs.length ||
      manualAttestationRefs.some((ref) => !requiredManualAttestations.has(ref)))
  ) {
    throw new Error('Native manual review attestation refs do not exactly match reviewed evidence');
  }
  return {
    matrixHash: nativeReviewAcceptanceMatrixHash(matrix),
    evidenceGraph: buildNativeReviewEvidenceGraph({
      reviewedReceiptRefs: [...reviewedReceiptRefs],
      reviewedWaiverRefs: [...reviewedWaiverRefs],
      automatedReplays,
      staticReplays,
      manualAttestationRefs,
    }),
    hasFailedAcceptance: matrix.some((entry) => entry.status === 'failed'),
  };
}

function projectionManifest(projection: NativeSnapshotProjection): NativeContentSnapshotManifest {
  return {
    schema: 'comet.native.content-snapshot.v1',
    origin: projection.origin,
    ...(projection.capture ? { capture: projection.capture } : {}),
    createdAt: '1970-01-01T00:00:00.000Z',
    complete: projection.complete,
    limits: projection.limits,
    ...(projection.policy ? { policy: projection.policy } : {}),
    entries: projection.entries,
    omitted: projection.omitted,
    omittedCount: projection.omittedCount,
    ...(projection.omissionOverflow ? { omissionOverflow: projection.omissionOverflow } : {}),
  };
}

async function currentReceiptFence(options: {
  paths: NativeProjectPaths;
  context: NativeVerificationReceiptContext;
  now?: Date;
}): Promise<{ snapshotHash: string; scopeHash: string; matched: boolean }> {
  const baseline = projectionManifest(options.context.scope.baseline);
  const current = await createNativeCurrentContentSnapshot(options.paths, baseline, {
    origin: 'explicit',
    now: options.now,
  });
  const bundle = buildNativeImplementationScopeBundle({
    baseline,
    current,
    contractHash: options.context.bindings.contractHash,
    declaredArtifacts: options.context.scope.scope.declaredArtifacts,
    noCodeReason: options.context.scope.scope.noCodeReason,
    gitChangedPaths: options.context.scope.authority.gitChangedPaths,
  });
  return {
    snapshotHash: bundle.scope.currentProjectionHash,
    scopeHash: bundle.scope.scopeHash,
    matched:
      bundle.scope.currentProjectionHash === options.context.bindings.snapshotHash &&
      bundle.scope.scopeHash === options.context.bindings.scopeHash,
  };
}

async function gitWorktreeIdentity(projectRoot: string): Promise<{
  provider: 'git' | 'none';
  root: string;
  commit: string | null;
}> {
  try {
    const [{ stdout: rootOutput }, { stdout: commitOutput }] = await Promise.all([
      execFileAsync('git', ['-C', projectRoot, 'rev-parse', '--show-toplevel'], {
        windowsHide: true,
        timeout: 10_000,
      }),
      execFileAsync('git', ['-C', projectRoot, 'rev-parse', 'HEAD'], {
        windowsHide: true,
        timeout: 10_000,
      }),
    ]);
    const absoluteRoot = path.resolve(rootOutput.trim());
    const relativeRoot = path.relative(projectRoot, absoluteRoot).replaceAll('\\', '/');
    if (
      relativeRoot === '..' ||
      relativeRoot.startsWith('../') ||
      path.posix.isAbsolute(relativeRoot)
    ) {
      throw new Error('Git worktree is outside the Native project root');
    }
    const commit = commitOutput.trim().toLowerCase();
    if (!/^[a-f0-9]{40,64}$/u.test(commit)) throw new Error('Git commit identity is invalid');
    return { provider: 'git', root: relativeRoot || '.', commit };
  } catch {
    return { provider: 'none', root: '.', commit: null };
  }
}

function sanitizedAutomatedCommandEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    'APPDATA',
    'CI',
    'COMSPEC',
    'COMMONPROGRAMFILES',
    'COMMONPROGRAMFILES(X86)',
    'HOME',
    'HOMEDRIVE',
    'HOMEPATH',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'LOCALAPPDATA',
    'NUMBER_OF_PROCESSORS',
    'PATH',
    'PATHEXT',
    'PROCESSOR_ARCHITECTURE',
    'PROGRAMDATA',
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'SYSTEMDRIVE',
    'SYSTEMROOT',
    'TEMP',
    'TERM',
    'TMP',
    'TMPDIR',
    'USERPROFILE',
    'WINDIR',
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name, value]) => value !== undefined && allowed.has(name.toUpperCase()),
    ),
  );
}

export async function issueNativeAutomatedCheckReceipt(options: {
  paths: NativeProjectPaths;
  name: string;
  acceptanceIds: readonly string[];
  command: string;
  args: readonly string[];
  timeoutMs?: number;
  now?: () => Date;
}): Promise<{ receipt: NativeVerificationReceipt; ref: string }> {
  return withNativeReceiptIssuanceLock({
    paths: options.paths,
    name: options.name,
    operation: `issue automated receipt ${options.name}`,
    issue: (state) => issueNativeAutomatedCheckReceiptLocked({ ...options, state }),
  });
}

async function issueNativeAutomatedCheckReceiptLocked(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  acceptanceIds: readonly string[];
  command: string;
  args: readonly string[];
  timeoutMs?: number;
  now?: () => Date;
}): Promise<{ receipt: NativeVerificationReceipt; ref: string }> {
  const context = await loadNativeVerificationReceiptContext(options.paths, options.state);
  const beforeWorktree = await gitWorktreeIdentity(options.paths.projectRoot);
  const startedAt = (options.now?.() ?? new Date()).toISOString();
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_NATIVE_AUTOMATED_COMMAND_TIMEOUT_MS
  ) {
    throw new Error(
      `Native automated command timeout must be an integer from 1 through ${MAX_NATIVE_AUTOMATED_COMMAND_TIMEOUT_MS}`,
    );
  }
  const output: Buffer[] = [];
  let outputBytes = 0;
  let totalOutputBytes = 0;
  const outputHasher = createHash('sha256');
  let timedOut = false;
  const child = spawn(options.command, [...options.args], {
    cwd: options.paths.projectRoot,
    env: sanitizedAutomatedCommandEnvironment(),
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk: Buffer): void => {
    outputHasher.update(chunk);
    totalOutputBytes += chunk.byteLength;
    if (outputBytes >= MAX_COMMAND_OUTPUT_BYTES) return;
    const remaining = MAX_COMMAND_OUTPUT_BYTES - outputBytes;
    const bounded = chunk.subarray(0, remaining);
    output.push(Buffer.from(bounded));
    outputBytes += bounded.byteLength;
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const outcome = await new Promise<{ exitCode: number; signal: string | null }>(
    (resolve, reject) => {
      let finished = false;
      let termination: Promise<void> | null = null;
      let terminationTimer: NodeJS.Timeout | null = null;
      const finish = (result: { exitCode: number; signal: string | null }): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (terminationTimer) clearTimeout(terminationTimer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        termination = terminateProcessTree(child).catch(() => {
          child.kill('SIGKILL');
          child.stdout?.destroy();
          child.stderr?.destroy();
        });
        terminationTimer = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish({ exitCode: 124, signal: 'SIGKILL' });
        }, AUTOMATED_COMMAND_TERMINATION_WAIT_MS);
      }, timeoutMs);
      child.once('error', (error) => {
        if (timedOut) {
          void (termination ?? Promise.resolve()).then(() =>
            finish({ exitCode: 124, signal: 'SIGKILL' }),
          );
          return;
        }
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (terminationTimer) clearTimeout(terminationTimer);
        reject(error);
      });
      child.once('close', (code, signal) => {
        void (termination ?? Promise.resolve()).then(() =>
          finish({
            exitCode: timedOut ? 124 : (code ?? 1),
            signal: signal ?? (timedOut ? 'SIGKILL' : null),
          }),
        );
      });
    },
  );
  const endedAt = (options.now?.() ?? new Date()).toISOString();
  const [afterWorktree, afterFence] = await Promise.all([
    gitWorktreeIdentity(options.paths.projectRoot),
    currentReceiptFence({
      paths: options.paths,
      context,
      now: options.now?.(),
    }),
  ]);
  const capture = context.scope.current.capture;
  const requiresGitIdentity =
    capture?.provider === 'git' ||
    (capture?.provider === 'physical-tree' && capture.projection?.provider === 'git');
  const worktreeMatched =
    (!requiresGitIdentity || beforeWorktree.provider === 'git') &&
    beforeWorktree.provider === afterWorktree.provider &&
    beforeWorktree.root === afterWorktree.root &&
    beforeWorktree.commit === afterWorktree.commit;
  const status =
    timedOut || !afterFence.matched || !worktreeMatched
      ? 'blocked'
      : outcome.exitCode === 0
        ? 'passed'
        : 'failed';
  const summary = Buffer.concat(output, outputBytes).toString('utf8').trim();
  const receipt = buildNativeVerificationReceipt({
    kind: 'automated-check',
    role: 'acceptance-evidence',
    status,
    bindings: context.bindings,
    acceptanceIds: normalizeAcceptanceIds(options.acceptanceIds, context.acceptanceIds),
    actor: `native-runtime:command:${options.command}`,
    issuedAt: endedAt,
    evidence: {
      executable: options.command,
      args: [...options.args],
      cwd: '.',
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut,
      timeoutMs,
      startedAt,
      endedAt,
      worktree: {
        provider: beforeWorktree.provider,
        root: beforeWorktree.root,
        beforeCommit: beforeWorktree.commit,
        afterCommit: afterWorktree.commit,
      },
      afterFence: {
        ...afterFence,
        matched: afterFence.matched && worktreeMatched,
      },
      outputHash: outputHasher.digest('hex'),
      outputSummary: boundedText(
        summary || `(exit ${outcome.exitCode})`,
        'Native command output summary',
      ),
      outputTruncated: totalOutputBytes > outputBytes,
    },
  });
  return {
    receipt,
    ref: await writeNativeVerificationReceipt({
      paths: options.paths,
      name: options.state.name,
      receipt,
    }),
  };
}

export async function issueNativeWaiverReceipt(options: {
  paths: NativeProjectPaths;
  name: string;
  acceptanceId: string;
  blockedReceiptRef: string;
  reason: string;
  risk: string;
  alternativeReceiptRefs: readonly string[];
  signerIdentity: NativeReviewIdentity;
  privateKey: string;
  confirmed: boolean;
  now?: Date;
}): Promise<{ waiver: NativeWaiverReceipt; ref: string }> {
  return withNativeReceiptIssuanceLock({
    paths: options.paths,
    name: options.name,
    operation: `issue waiver receipt ${options.name}`,
    issue: (state) => issueNativeWaiverReceiptLocked({ ...options, state }),
  });
}

async function issueNativeWaiverReceiptLocked(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  acceptanceId: string;
  blockedReceiptRef: string;
  reason: string;
  risk: string;
  alternativeReceiptRefs: readonly string[];
  signerIdentity: NativeReviewIdentity;
  privateKey: string;
  confirmed: boolean;
  now?: Date;
}): Promise<{ waiver: NativeWaiverReceipt; ref: string }> {
  if (!options.confirmed) throw new Error('Native waiver issuance requires explicit confirmation');
  const context = await loadNativeVerificationReceiptContext(options.paths, options.state);
  if (!context.acceptanceIds.includes(options.acceptanceId)) {
    throw new Error('Native waiver acceptance ID does not match the current contract');
  }
  const blockedReceipt = await readNativeVerificationReceipt(
    options.paths,
    options.state.name,
    options.blockedReceiptRef,
  );
  if (
    blockedReceipt.status === 'passed' ||
    !nativeReceiptBindingsMatch(blockedReceipt, context.bindings) ||
    (blockedReceipt.role === 'acceptance-evidence' &&
      !blockedReceipt.acceptanceIds.includes(options.acceptanceId))
  ) {
    throw new Error('Native waiver must bind a current failed, skipped, or blocked receipt');
  }
  const policy = await loadNativeReviewTrustPolicy({
    paths: options.paths,
    scope: context.scope,
  });
  const signerIdentity = parseNativeReviewIdentity(options.signerIdentity);
  trustedNativeIdentity(policy, 'waiver', signerIdentity.keyId);
  for (const ref of options.alternativeReceiptRefs) {
    const receipt = await readNativeVerificationReceipt(options.paths, options.state.name, ref);
    if (
      receipt.status !== 'passed' ||
      !nativeReceiptBindingsMatch(receipt, context.bindings) ||
      !receipt.acceptanceIds.includes(options.acceptanceId) ||
      (receipt.kind !== 'automated-check' && receipt.kind !== 'manual-evidence')
    ) {
      throw new Error(
        'Native waiver alternative receipt must be a current passed automated-check or manual-evidence receipt',
      );
    }
  }
  const unsigned = {
    bindings: context.bindings,
    acceptanceId: options.acceptanceId,
    blockedReceiptRef: options.blockedReceiptRef,
    blockedCheckId: nativeBlockedCheckId(blockedReceipt),
    reason: options.reason,
    risk: options.risk,
    alternativeReceiptRefs: [...options.alternativeReceiptRefs],
    reviewPolicyHash: policy.policyHash,
    signerIdentity,
    confirmedAt: (options.now ?? new Date()).toISOString(),
  };
  const waiver = buildNativeWaiverReceipt({
    ...unsigned,
    attestation: signNativeReviewPayloadHash({
      identity: signerIdentity,
      privateKey: options.privateKey,
      payloadHash: nativeWaiverAttestationHash(unsigned),
    }),
  });
  return {
    waiver,
    ref: await writeNativeWaiverReceipt({
      paths: options.paths,
      name: options.state.name,
      waiver,
    }),
  };
}

export async function validateNativeStaticReceiptDependency(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  receipt: NativeVerificationReceipt;
}): Promise<NativeCheckReceipt | null> {
  if (options.receipt.kind !== 'static-inspection') return null;
  const check = await readNativeCheckReceipt(
    options.paths,
    options.state.name,
    options.receipt.evidence.checkReceiptRef,
  );
  if (check.receiptHash !== options.receipt.evidence.checkReceiptHash) {
    throw new Error('Native static receipt dependency hash mismatch');
  }
  return check;
}
