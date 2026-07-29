import path from 'node:path';

import {
  parseNativeVerificationMachineBlock,
  type NativeAcceptanceEvidenceEntry,
} from './native-acceptance.js';
import type {
  NativeArchiveEvidenceFact,
  NativeVerificationFreshness,
} from './native-archive-preflight.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { isNativeHighRiskScope } from './native-independent-review.js';
import { loadNativeReviewTrustPolicy, trustedNativeIdentity } from './native-review-trust.js';
import { nativeChangeDir } from './native-change.js';
import type { NativeCheckReceipt } from './native-check-receipt.js';
import type { NativeContractSnapshot } from './native-contract.js';
import { collectNativeContractFiles } from './native-contract-files.js';
import {
  readNativeImplementationScopeBundle,
  readNativePartialAllowance,
  readNativeVerificationEvidence,
  readNativeVerificationReceipt,
  readNativeWaiverReceipt,
  nativeEvidenceRef,
  writeNativeVerificationReportSnapshot,
  writeNativeVerificationEvidence,
} from './native-evidence-storage.js';
import { createNativeCurrentContentSnapshot } from './native-snapshot.js';
import type {
  NativeChangeState,
  NativeContentSnapshotManifest,
  NativeProjectPaths,
} from './native-types.js';
import {
  buildNativeImplementationScopeBundle,
  type NativeImplementationScopeBundle,
  type NativeSnapshotProjection,
} from './native-verification-scope.js';
import {
  buildNativeAcceptanceEvidenceTrace,
  buildNativeVerificationEvidenceEnvelope,
  type NativeVerificationEvidenceEnvelope,
} from './native-verification-evidence.js';
import {
  nativeReceiptBindingsMatch,
  validateNativeReviewEvidenceGraph,
  validateNativeStaticReceiptDependency,
} from './native-verification-receipt-runtime.js';
import {
  nativeArtifactBindingHash,
  nativeBlockedCheckId,
  type NativeVerificationReceipt,
  type NativeVerificationReceiptBindings,
} from './native-verification-receipt.js';

export type NativeVerificationFreshnessFindingCode =
  | 'verification-contract-stale'
  | 'verification-implementation-stale'
  | 'verification-report-stale'
  | 'verification-receipt-stale'
  | 'verification-receipt-invalid'
  | 'verification-receipt-outcome-mismatch'
  | 'verification-independent-review-missing'
  | 'verification-independent-review-stale'
  | 'verification-waiver-unconfirmed'
  | 'verification-protocol-legacy'
  | 'verification-state-mismatch'
  | 'verification-evidence-missing'
  | 'verification-evidence-invalid';

export interface NativeVerificationPreparation {
  ready: boolean;
  findingCodes: NativeVerificationFreshnessFindingCode[];
  envelope: NativeVerificationEvidenceEnvelope | null;
  evidenceRef: string | null;
  reportSnapshot: { hash: string; text: string } | null;
}

export interface NativeVerificationFreshnessInspection {
  freshness: NativeVerificationFreshness;
  findingCodes: NativeVerificationFreshnessFindingCode[];
  evidence: NativeArchiveEvidenceFact;
  envelope: NativeVerificationEvidenceEnvelope | null;
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

function nativeRootRef(paths: NativeProjectPaths): string {
  const value = path.relative(paths.projectRoot, paths.nativeRoot).replaceAll('\\', '/');
  if (!value || value === '..' || value.startsWith('../') || path.posix.isAbsolute(value)) {
    throw new Error('Native root is outside the project root');
  }
  return value;
}

async function currentProjectionHash(options: {
  paths: NativeProjectPaths;
  bundle: NativeImplementationScopeBundle;
  now?: Date;
}): Promise<string> {
  const baseline = projectionManifest(options.bundle.baseline);
  const current = await createNativeCurrentContentSnapshot(options.paths, baseline, {
    origin: 'explicit',
    now: options.now,
  });
  return buildNativeImplementationScopeBundle({
    baseline,
    current,
    contractHash: options.bundle.scope.contractHash,
    declaredArtifacts: options.bundle.scope.declaredArtifacts,
    noCodeReason: options.bundle.scope.noCodeReason,
  }).scope.currentProjectionHash;
}

async function inspectCurrentScopeFacts(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  now?: Date;
}): Promise<{
  bundle: NativeImplementationScopeBundle;
  contract: NativeContractSnapshot;
  contractHash: string;
  acceptanceHash: string;
  findingCodes: NativeVerificationFreshnessFindingCode[];
}> {
  if (!options.state.implementation_scope) {
    throw new Error('Native change has no implementation scope');
  }
  const bundle = await readNativeImplementationScopeBundle(
    options.paths,
    options.state.name,
    options.state.implementation_scope,
  );
  const contract = await collectNativeContractFiles({
    changeDir: nativeChangeDir(options.paths, options.state.name),
    briefRef: options.state.brief,
    specChanges: options.state.spec_changes,
  });
  const currentHash = await currentProjectionHash({
    paths: options.paths,
    bundle,
    now: options.now,
  });
  const findingCodes: NativeVerificationFreshnessFindingCode[] = [];
  if (contract.contract.contractHash !== bundle.scope.contractHash) {
    findingCodes.push('verification-contract-stale');
  }
  if (currentHash !== bundle.scope.currentProjectionHash) {
    findingCodes.push('verification-implementation-stale');
  }
  return {
    bundle,
    contract: contract.contract,
    contractHash: contract.contract.contractHash,
    acceptanceHash: contract.contract.acceptanceHash,
    findingCodes,
  };
}

export interface NativeImplementationScopeFreshnessInspection {
  freshness: 'fresh' | 'stale' | 'missing' | 'invalid';
  findingCodes: NativeVerificationFreshnessFindingCode[];
}

/**
 * Recomputes the facts bound by the Build implementation scope without requiring a Verify report.
 * Verify uses this to retreat safely when its contract or project snapshot changes before an
 * evidence envelope can be created.
 */
export async function inspectNativeImplementationScopeFreshness(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  now?: Date;
}): Promise<NativeImplementationScopeFreshnessInspection> {
  if (!options.state.implementation_scope) {
    return { freshness: 'missing', findingCodes: ['verification-evidence-missing'] };
  }
  try {
    const facts = await inspectCurrentScopeFacts(options);
    const findingCodes = [...new Set(facts.findingCodes)].sort();
    return {
      freshness: findingCodes.length === 0 ? 'fresh' : 'stale',
      findingCodes,
    };
  } catch {
    return { freshness: 'invalid', findingCodes: ['verification-evidence-invalid'] };
  }
}

async function reportEvidence(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  reportRef: string;
}): Promise<{
  ref: string;
  hash: string;
  text: string;
  entries: NativeAcceptanceEvidenceEntry[];
}> {
  const report = await readNativeBoundedTextFile({
    root: nativeChangeDir(options.paths, options.state.name),
    ref: options.reportRef,
  });
  return {
    ref: report.ref,
    hash: report.hash,
    text: report.text,
    entries: parseNativeVerificationMachineBlock(report.text),
  };
}

function checkReceiptBindingCodes(options: {
  receipt: NativeCheckReceipt;
  sourceRevision: number;
  result: 'pass' | 'fail';
  contractHash: string;
  implementationScope: NativeImplementationScopeBundle;
}): NativeVerificationFreshnessFindingCode[] {
  const { receipt, implementationScope } = options;
  const codes: NativeVerificationFreshnessFindingCode[] = [];
  const selectedFiles = implementationScope.scope.changes.filter((change) => change.after !== null);
  const selectedBytes = selectedFiles.reduce((total, change) => total + change.after!.size, 0);
  if (
    receipt.stale ||
    receipt.sourceRevision !== options.sourceRevision ||
    receipt.contract.expectedHash !== options.contractHash ||
    receipt.contract.beforeHash !== options.contractHash ||
    receipt.contract.afterHash !== options.contractHash ||
    receipt.implementation.scopeHash !== implementationScope.scope.scopeHash ||
    receipt.implementation.expectedSnapshotHash !==
      implementationScope.scope.currentProjectionHash ||
    receipt.implementation.beforeSnapshotHash !== implementationScope.scope.currentProjectionHash ||
    receipt.implementation.afterSnapshotHash !== implementationScope.scope.currentProjectionHash ||
    receipt.counts.filesSelected !== selectedFiles.length ||
    (receipt.status === 'passed' &&
      (receipt.counts.filesScanned + receipt.counts.binaryFilesSkipped !== selectedFiles.length ||
        receipt.counts.bytesScanned !== selectedBytes))
  ) {
    codes.push('verification-receipt-stale');
  }
  if (options.result === 'pass' && receipt.status !== 'passed') {
    codes.push('verification-receipt-outcome-mismatch');
  }
  return codes;
}

function verificationReceiptBindings(options: {
  state: NativeChangeState;
  contractHash: string;
  implementationScope: NativeImplementationScopeBundle;
  sourceRevision?: number;
}): NativeVerificationReceiptBindings {
  return {
    change: options.state.name,
    sourceRevision: options.sourceRevision ?? options.state.revision,
    contractHash: options.contractHash,
    scopeHash: options.implementationScope.scope.scopeHash,
    snapshotHash: options.implementationScope.scope.currentProjectionHash,
    artifactHash: nativeArtifactBindingHash(options.implementationScope.scope.declaredArtifacts),
  };
}

async function validateTypedReceipt(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  ref: string;
  expectedBindings: NativeVerificationReceiptBindings;
  acceptanceId?: string;
  role: NativeVerificationReceipt['role'];
  contractHash: string;
  implementationScope: NativeImplementationScopeBundle;
  result: 'pass' | 'fail';
}): Promise<NativeVerificationReceipt> {
  const receipt = await readNativeVerificationReceipt(
    options.paths,
    options.state.name,
    options.ref,
  );
  if (
    receipt.role !== options.role ||
    !nativeReceiptBindingsMatch(receipt, options.expectedBindings) ||
    (options.acceptanceId !== undefined && !receipt.acceptanceIds.includes(options.acceptanceId))
  ) {
    throw new Error('Native verification receipt coverage or binding is invalid');
  }
  if (options.result === 'pass' && receipt.status !== 'passed') {
    throw new Error(`Native verification receipt is ${receipt.status}`);
  }
  const check = await validateNativeStaticReceiptDependency({
    paths: options.paths,
    state: options.state,
    receipt,
  });
  if (check) {
    const codes = checkReceiptBindingCodes({
      receipt: check,
      sourceRevision: options.expectedBindings.sourceRevision,
      result: options.result,
      contractHash: options.contractHash,
      implementationScope: options.implementationScope,
    });
    if (codes.length > 0) {
      throw new Error(`Native static receipt dependency is invalid: ${codes.join(', ')}`);
    }
  }
  return receipt;
}

async function validateV2ReceiptGraph(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  result: 'pass' | 'fail';
  trace: ReturnType<typeof buildNativeAcceptanceEvidenceTrace>;
  requiredReceiptRefs: readonly string[];
  independentReviewReceiptRef?: string | null;
  contractHash: string;
  implementationScope: NativeImplementationScopeBundle;
  sourceRevision?: number;
}): Promise<{
  independentReviewReceiptRef: string | null;
  independentReviewChecked:
    | Extract<NativeVerificationReceipt, { kind: 'independent-review' }>['evidence']['checked']
    | null;
}> {
  const expectedBindings = verificationReceiptBindings({
    state: options.state,
    contractHash: options.contractHash,
    implementationScope: options.implementationScope,
    sourceRevision: options.sourceRevision,
  });
  const requiredReceipts = new Map<string, NativeVerificationReceipt>();
  const reviewedReceiptRefs = new Set<string>(options.requiredReceiptRefs);
  const reviewedWaiverRefs = new Set<string>();
  for (const ref of options.requiredReceiptRefs) {
    const receipt = await validateTypedReceipt({
      ...options,
      ref,
      expectedBindings,
      role: 'required-check',
      result: 'fail',
    });
    requiredReceipts.set(ref, receipt);
  }
  let independentReviewReceiptRef: string | null = null;
  let independentReviewChecked:
    | Extract<NativeVerificationReceipt, { kind: 'independent-review' }>['evidence']['checked']
    | null = null;
  let reviewPolicy: Awaited<ReturnType<typeof loadNativeReviewTrustPolicy>> | null = null;
  const requireReviewPolicy = async () => {
    reviewPolicy ??= await loadNativeReviewTrustPolicy({
      paths: options.paths,
      scope: options.implementationScope,
    });
    return reviewPolicy;
  };
  const waivedBlockedReceiptCoverage = new Map<string, Set<string>>();
  const completeAcceptanceIds = options.trace.entries.map((entry) => entry.acceptanceId).sort();
  const acceptReviewReceipt = async (
    ref: string,
    receipt: NativeVerificationReceipt,
  ): Promise<void> => {
    if (receipt.kind !== 'independent-review') {
      throw new Error('Native applicability review ref is not an independent-review receipt');
    }
    if (
      JSON.stringify([...receipt.acceptanceIds].sort()) !== JSON.stringify(completeAcceptanceIds)
    ) {
      throw new Error('Native independent review must cover the complete current acceptance set');
    }
    const policy = await requireReviewPolicy();
    if (
      receipt.evidence.reviewPolicyHash !== policy.policyHash ||
      receipt.evidence.implementationKeyId !== policy.implementationKeyId
    ) {
      throw new Error('Native independent review trust policy is stale');
    }
    trustedNativeIdentity(policy, 'reviewer', receipt.evidence.reviewerIdentity.keyId);
    const implementationReceipt = await readNativeVerificationReceipt(
      options.paths,
      options.state.name,
      receipt.evidence.implementationReceiptRef,
    );
    const expectedExecutionId = options.state.run_id
      ? `run:${options.state.run_id}`
      : `scope:${options.implementationScope.scope.scopeHash}`;
    if (
      implementationReceipt.kind !== 'implementation-attestation' ||
      implementationReceipt.status !== 'passed' ||
      !nativeReceiptBindingsMatch(implementationReceipt, expectedBindings) ||
      JSON.stringify(implementationReceipt.acceptanceIds) !==
        JSON.stringify(completeAcceptanceIds) ||
      implementationReceipt.evidence.implementationIdentity.keyId !== policy.implementationKeyId ||
      implementationReceipt.evidence.reviewPolicyHash !== policy.policyHash ||
      implementationReceipt.evidence.implementationExecutionId !== expectedExecutionId
    ) {
      throw new Error('Native independent review implementation attestation is stale or invalid');
    }
    const highRisk =
      !options.implementationScope.scope.complete ||
      isNativeHighRiskScope(options.implementationScope.scope.changes);
    const checkedRefs = [
      ['unifiedIo', receipt.evidence.checked.unifiedIo],
      ['adversarialPaths', receipt.evidence.checked.adversarialPaths],
      ['generatedAssets', receipt.evidence.checked.generatedAssets],
      ['lifecycleEval', receipt.evidence.checked.lifecycleEval],
    ] as const;
    if (highRisk && checkedRefs.some(([, checkedRef]) => checkedRef === null)) {
      throw new Error('Native high-risk independent review has incomplete required checks');
    }
    for (const [name, checkedRef] of checkedRefs) {
      if (checkedRef === null) continue;
      const checkedReceipt = await readNativeVerificationReceipt(
        options.paths,
        options.state.name,
        checkedRef,
      );
      const allowed =
        name === 'unifiedIo'
          ? checkedReceipt.kind === 'static-inspection' || checkedReceipt.kind === 'manual-evidence'
          : checkedReceipt.kind === 'automated-check' || checkedReceipt.kind === 'manual-evidence';
      if (
        !allowed ||
        checkedReceipt.status !== 'passed' ||
        !nativeReceiptBindingsMatch(checkedReceipt, expectedBindings)
      ) {
        throw new Error(`Native ${name} review check lacks valid typed evidence`);
      }
      if (checkedReceipt.kind === 'static-inspection') {
        const check = await validateNativeStaticReceiptDependency({
          paths: options.paths,
          state: options.state,
          receipt: checkedReceipt,
        });
        if (
          !check ||
          checkReceiptBindingCodes({
            receipt: check,
            sourceRevision: expectedBindings.sourceRevision,
            result: 'pass',
            contractHash: options.contractHash,
            implementationScope: options.implementationScope,
          }).length > 0
        ) {
          throw new Error('Native unified-I/O static review check is stale');
        }
      }
      reviewedReceiptRefs.add(checkedRef);
    }
    const matrix = options.trace.entries.map(
      (entry): NativeAcceptanceEvidenceEntry => ({
        acceptance_id: entry.acceptanceId,
        status: entry.status === 'missing' ? 'failed' : entry.status,
        evidence_refs: [...entry.evidenceRefs],
        ...(entry.status === 'missing'
          ? { skipped_reason: 'Acceptance evidence is missing' }
          : entry.skippedReason === null
            ? {}
            : { skipped_reason: entry.skippedReason }),
        ...(entry.waiverRef === null ? {} : { waiver_ref: entry.waiverRef }),
      }),
    );
    await validateNativeReviewEvidenceGraph({
      paths: options.paths,
      state: options.state,
      reviewReceipt: receipt,
      matrix,
      expectedReceiptRefs: [...reviewedReceiptRefs],
      expectedWaiverRefs: [...reviewedWaiverRefs],
    });
    if (independentReviewReceiptRef !== null && independentReviewReceiptRef !== ref) {
      throw new Error('Native verification contains multiple independent review receipts');
    }
    independentReviewReceiptRef = ref;
    independentReviewChecked = receipt.evidence.checked;
  };
  for (const entry of options.trace.entries) {
    if (entry.status === 'failed' || entry.status === 'missing') {
      if (options.result === 'pass') {
        throw new Error(
          'Native passing verification cannot include failed or missing acceptance criteria',
        );
      }
      continue;
    }
    if (entry.status === 'waived') {
      const waiver = await readNativeWaiverReceipt(
        options.paths,
        options.state.name,
        entry.waiverRef!,
      );
      if (
        waiver.acceptanceId !== entry.acceptanceId ||
        JSON.stringify(waiver.bindings) !== JSON.stringify(expectedBindings)
      ) {
        throw new Error('Native waiver receipt does not match its acceptance or current bindings');
      }
      reviewedWaiverRefs.add(entry.waiverRef!);
      const blockedReceipt = await readNativeVerificationReceipt(
        options.paths,
        options.state.name,
        waiver.blockedReceiptRef,
      );
      if (
        blockedReceipt.status === 'passed' ||
        !nativeReceiptBindingsMatch(blockedReceipt, expectedBindings) ||
        (blockedReceipt.role === 'acceptance-evidence' &&
          !blockedReceipt.acceptanceIds.includes(entry.acceptanceId)) ||
        waiver.blockedCheckId !== nativeBlockedCheckId(blockedReceipt)
      ) {
        throw new Error('Native waiver does not bind a current blocking receipt');
      }
      reviewedReceiptRefs.add(waiver.blockedReceiptRef);
      const policy = await requireReviewPolicy();
      if (waiver.reviewPolicyHash !== policy.policyHash) {
        throw new Error('Native waiver trust policy is stale');
      }
      trustedNativeIdentity(policy, 'waiver', waiver.signerIdentity.keyId);
      const waiverCoverage =
        waivedBlockedReceiptCoverage.get(waiver.blockedReceiptRef) ?? new Set<string>();
      waiverCoverage.add(entry.acceptanceId);
      waivedBlockedReceiptCoverage.set(waiver.blockedReceiptRef, waiverCoverage);
      for (const alternativeRef of waiver.alternativeReceiptRefs) {
        const alternativeReceipt = await validateTypedReceipt({
          ...options,
          ref: alternativeRef,
          expectedBindings,
          acceptanceId: entry.acceptanceId,
          role: 'acceptance-evidence',
        });
        if (
          alternativeReceipt.kind !== 'automated-check' &&
          alternativeReceipt.kind !== 'manual-evidence'
        ) {
          throw new Error('Native waiver alternative must be automated-check or manual-evidence');
        }
        reviewedReceiptRefs.add(alternativeRef);
      }
      continue;
    }
    for (const ref of entry.evidenceRefs) {
      const receipt = await validateTypedReceipt({
        ...options,
        ref,
        expectedBindings,
        acceptanceId: entry.acceptanceId,
        role: 'acceptance-evidence',
      });
      if (receipt.kind !== 'automated-check' && receipt.kind !== 'manual-evidence') {
        throw new Error('Native acceptance evidence must be automated-check or manual-evidence');
      }
      reviewedReceiptRefs.add(ref);
    }
  }
  if (
    options.independentReviewReceiptRef &&
    options.independentReviewReceiptRef !== independentReviewReceiptRef
  ) {
    const receipt = await validateTypedReceipt({
      ...options,
      ref: options.independentReviewReceiptRef,
      expectedBindings,
      role: 'acceptance-evidence',
    });
    await acceptReviewReceipt(options.independentReviewReceiptRef, receipt);
  }
  if (
    options.result === 'pass' &&
    [...requiredReceipts.entries()].some(
      ([ref, receipt]) =>
        receipt.status !== 'passed' &&
        !completeAcceptanceIds.every((acceptanceId) =>
          waivedBlockedReceiptCoverage.get(ref)?.has(acceptanceId),
        ),
    )
  ) {
    throw new Error('Native required check is not passed or covered by a current waiver');
  }
  return { independentReviewReceiptRef, independentReviewChecked };
}

export interface NativeVerificationEvidenceOptions {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  result: 'pass' | 'fail';
  reportRef: string;
  receiptRef?: string | null;
  receiptRefs?: readonly string[];
  waiverRefs?: readonly string[];
  independentReviewReceiptRef?: string | null;
  now?: Date;
}

function sortedRefs(refs: readonly string[] | undefined): string[] {
  return [...(refs ?? [])].sort();
}

/** Build and validate an envelope without mutating the Native evidence store. */
export async function inspectNativeVerificationEvidence(
  options: NativeVerificationEvidenceOptions,
): Promise<NativeVerificationPreparation> {
  if (options.state.phase !== 'verify') {
    throw new Error(`Native verification evidence requires Verify, got ${options.state.phase}`);
  }
  const facts = await inspectCurrentScopeFacts(options);
  if (facts.findingCodes.length > 0) {
    return {
      ready: false,
      findingCodes: facts.findingCodes,
      envelope: null,
      evidenceRef: null,
      reportSnapshot: null,
    };
  }
  const report = await reportEvidence(options);
  if (options.result === 'pass' && !options.receiptRef) {
    throw new Error('Native passing verification requires a typed required-check receipt');
  }
  const requiredReceiptRefs = options.receiptRef ? [options.receiptRef] : [];
  const trace = buildNativeAcceptanceEvidenceTrace(facts.contract.acceptance, report.entries, {
    nativeRootRef: nativeRootRef(options.paths),
    allowMissing: options.result === 'fail',
  });
  if (
    options.result === 'pass' &&
    trace.entries.some((entry) => entry.status === 'failed' || entry.status === 'missing')
  ) {
    throw new Error(
      'Native passing verification cannot include failed or missing acceptance criteria',
    );
  }
  const receiptGraph = await validateV2ReceiptGraph({
    paths: options.paths,
    state: options.state,
    result: options.result,
    trace,
    requiredReceiptRefs,
    independentReviewReceiptRef: options.independentReviewReceiptRef,
    contractHash: facts.contractHash,
    implementationScope: facts.bundle,
  });
  const independentReviewRequired =
    !facts.bundle.scope.complete || isNativeHighRiskScope(facts.bundle.scope.changes);
  if (
    independentReviewRequired &&
    options.result === 'pass' &&
    receiptGraph.independentReviewReceiptRef === null
  ) {
    throw new Error(
      'Native passing verification requires a signed acceptance-applicability review receipt',
    );
  }
  const allowance = options.state.partial_allowance
    ? await readNativePartialAllowance(
        options.paths,
        options.state.name,
        options.state.partial_allowance,
      )
    : null;
  const envelope = buildNativeVerificationEvidenceEnvelope({
    change: options.state.name,
    sourceRevision: options.state.revision,
    result: options.result,
    contractHash: facts.contractHash,
    acceptanceHash: facts.acceptanceHash,
    implementationScope: {
      ref: options.state.implementation_scope!,
      bundle: facts.bundle,
    },
    reportRef: report.ref,
    reportHash: report.hash,
    requiredReceiptRefs,
    independentReviewReceiptRef: receiptGraph.independentReviewReceiptRef,
    acceptanceTrace: trace,
    partialAllowance:
      options.state.partial_allowance && allowance
        ? { ref: options.state.partial_allowance, allowance }
        : null,
    now: options.now,
  });
  if (
    (options.receiptRefs !== undefined &&
      JSON.stringify(sortedRefs(options.receiptRefs)) !== JSON.stringify(envelope.receiptRefs)) ||
    (options.waiverRefs !== undefined &&
      JSON.stringify(sortedRefs(options.waiverRefs)) !== JSON.stringify(envelope.waiverRefs)) ||
    (options.independentReviewReceiptRef !== undefined &&
      options.independentReviewReceiptRef !== envelope.independentReviewReceiptRef)
  ) {
    throw new Error(
      'Native verification receipt, waiver, or independent-review refs do not exactly match the report',
    );
  }
  const evidenceRef = nativeEvidenceRef('verifications', envelope.envelopeHash);
  return {
    ready: true,
    findingCodes: [],
    envelope,
    evidenceRef,
    reportSnapshot: { hash: report.hash, text: report.text },
  };
}

export async function persistNativeVerificationEvidence(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  preparation: NativeVerificationPreparation;
}): Promise<void> {
  if (
    !options.preparation.ready ||
    options.preparation.envelope === null ||
    options.preparation.evidenceRef === null ||
    options.preparation.reportSnapshot === null
  ) {
    throw new Error('Native verification evidence is not ready to persist');
  }
  await writeNativeVerificationReportSnapshot({
    paths: options.paths,
    name: options.state.name,
    ...options.preparation.reportSnapshot,
  });
  const evidenceRef = await writeNativeVerificationEvidence({
    paths: options.paths,
    name: options.state.name,
    evidence: options.preparation.envelope,
  });
  if (evidenceRef !== options.preparation.evidenceRef) {
    throw new Error('Native verification evidence persistence ref changed');
  }
}

/** Backwards-compatible one-shot API for callers that explicitly want durable evidence. */
export async function prepareNativeVerificationEvidence(
  options: NativeVerificationEvidenceOptions,
): Promise<NativeVerificationPreparation> {
  const preparation = await inspectNativeVerificationEvidence(options);
  if (preparation.ready) {
    await persistNativeVerificationEvidence({
      paths: options.paths,
      state: options.state,
      preparation,
    });
  }
  return preparation;
}

function emptyEvidence(
  result: NativeChangeState['verification_result'],
  freshness: NativeVerificationFreshness,
): NativeArchiveEvidenceFact {
  return {
    result,
    freshness,
    contractHash: null,
    acceptanceHash: null,
    implementationScopeHash: null,
    reportHash: null,
    envelopeHash: null,
    partialAllowanceHash: null,
    skippedAcceptanceCount: 0,
  };
}

/** Recompute every freshness boundary used by status, Archive preview, and Archive commit. */
export async function inspectNativeVerificationFreshness(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  now?: Date;
}): Promise<NativeVerificationFreshnessInspection> {
  if (
    !options.state.implementation_scope ||
    !options.state.verification_evidence ||
    !options.state.verification_report
  ) {
    return {
      freshness: 'missing',
      findingCodes: ['verification-evidence-missing'],
      evidence: emptyEvidence(options.state.verification_result, 'missing'),
      envelope: null,
    };
  }
  try {
    const [facts, envelope] = await Promise.all([
      inspectCurrentScopeFacts(options),
      readNativeVerificationEvidence(
        options.paths,
        options.state.name,
        options.state.verification_evidence,
      ),
    ]);
    if (envelope.schema !== 'comet.native.verification-evidence.v2') {
      return {
        freshness: 'stale',
        findingCodes: ['verification-protocol-legacy'],
        evidence: emptyEvidence(options.state.verification_result, 'stale'),
        envelope: null,
      };
    }
    const report = await reportEvidence({
      paths: options.paths,
      state: options.state,
      reportRef: options.state.verification_report,
    });
    const findingCodes = [...facts.findingCodes];
    if (report.hash !== envelope.reportHash || report.ref !== envelope.reportRef) {
      findingCodes.push('verification-report-stale');
    }
    if (
      envelope.result !== options.state.verification_result ||
      envelope.implementationScopeRef !== options.state.implementation_scope ||
      envelope.partialAllowanceRef !== options.state.partial_allowance ||
      envelope.sourceRevision >= options.state.revision ||
      envelope.contractHash !== facts.bundle.scope.contractHash ||
      envelope.acceptanceCriteriaHash !== facts.acceptanceHash
    ) {
      findingCodes.push('verification-state-mismatch');
    }
    try {
      const graph = await validateV2ReceiptGraph({
        paths: options.paths,
        state: options.state,
        result: envelope.result,
        trace: envelope.acceptanceTrace,
        requiredReceiptRefs: envelope.requiredReceiptRefs,
        independentReviewReceiptRef: envelope.independentReviewReceiptRef,
        contractHash: envelope.contractHash,
        implementationScope: facts.bundle,
        sourceRevision: envelope.sourceRevision,
      });
      if (graph.independentReviewReceiptRef !== envelope.independentReviewReceiptRef) {
        findingCodes.push('verification-independent-review-stale');
      }
    } catch {
      findingCodes.push('verification-receipt-invalid');
    }
    if (
      (!facts.bundle.scope.complete || isNativeHighRiskScope(facts.bundle.scope.changes)) &&
      envelope.result === 'pass' &&
      envelope.independentReviewReceiptRef === null
    ) {
      findingCodes.push('verification-independent-review-missing');
    }
    const uniqueCodes = [...new Set(findingCodes)].sort();
    const freshness: NativeVerificationFreshness =
      uniqueCodes.length > 0 ? 'stale' : envelope.freshness;
    return {
      freshness,
      findingCodes: uniqueCodes,
      evidence: {
        result: options.state.verification_result,
        freshness,
        contractHash: envelope.contractHash,
        acceptanceHash: envelope.acceptanceCriteriaHash,
        implementationScopeHash: envelope.implementationScopeHash,
        reportHash: envelope.reportHash,
        envelopeHash: envelope.envelopeHash,
        partialAllowanceHash: envelope.partialAllowanceHash,
        skippedAcceptanceCount: envelope.acceptanceTrace.skipped,
      },
      envelope,
    };
  } catch {
    return {
      freshness: 'invalid',
      findingCodes: ['verification-evidence-invalid'],
      evidence: emptyEvidence(options.state.verification_result, 'invalid'),
      envelope: null,
    };
  }
}
