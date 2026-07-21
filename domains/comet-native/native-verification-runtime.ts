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
import { nativeChangeDir } from './native-change.js';
import type { NativeCheckReceipt } from './native-check-receipt.js';
import { readNativeCheckReceipt } from './native-check-receipt-storage.js';
import type { NativeContractSnapshot } from './native-contract.js';
import { collectNativeContractFiles } from './native-contract-files.js';
import {
  readNativeImplementationScopeBundle,
  readNativePartialAllowance,
  readNativeVerificationEvidence,
  nativeEvidenceRef,
  writeNativeVerificationReportSnapshot,
  writeNativeVerificationEvidence,
} from './native-evidence-storage.js';
import { createNativeContentSnapshot } from './native-snapshot.js';
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

export type NativeVerificationFreshnessFindingCode =
  | 'verification-contract-stale'
  | 'verification-implementation-stale'
  | 'verification-report-stale'
  | 'verification-receipt-stale'
  | 'verification-receipt-invalid'
  | 'verification-receipt-outcome-mismatch'
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
    createdAt: '1970-01-01T00:00:00.000Z',
    complete: projection.complete,
    limits: projection.limits,
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
  const current = await createNativeContentSnapshot(options.paths, {
    origin: 'explicit',
    now: options.now,
  });
  return buildNativeImplementationScopeBundle({
    baseline: projectionManifest(options.bundle.baseline),
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

export interface NativeVerificationEvidenceOptions {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  result: 'pass' | 'fail';
  reportRef: string;
  receiptRef?: string | null;
  now?: Date;
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
  let receiptRef: string | null = null;
  if (options.receiptRef) {
    const receipt = await readNativeCheckReceipt(
      options.paths,
      options.state.name,
      options.receiptRef,
    );
    const receiptCodes = checkReceiptBindingCodes({
      receipt,
      sourceRevision: options.state.revision,
      result: options.result,
      contractHash: facts.contractHash,
      implementationScope: facts.bundle,
    });
    if (receiptCodes.length > 0) {
      throw new Error(`Native verification receipt is not admissible: ${receiptCodes.join(', ')}`);
    }
    receiptRef = options.receiptRef;
  }
  const trace = buildNativeAcceptanceEvidenceTrace(facts.contract.acceptance, report.entries, {
    nativeRootRef: nativeRootRef(options.paths),
  });
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
    receiptRef,
    acceptanceTrace: trace,
    partialAllowance:
      options.state.partial_allowance && allowance
        ? { ref: options.state.partial_allowance, allowance }
        : null,
    now: options.now,
  });
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
    const [facts, envelope, report] = await Promise.all([
      inspectCurrentScopeFacts(options),
      readNativeVerificationEvidence(
        options.paths,
        options.state.name,
        options.state.verification_evidence,
      ),
      reportEvidence({
        paths: options.paths,
        state: options.state,
        reportRef: options.state.verification_report,
      }),
    ]);
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
    if (envelope.receiptRef) {
      try {
        const receipt = await readNativeCheckReceipt(
          options.paths,
          options.state.name,
          envelope.receiptRef,
        );
        findingCodes.push(
          ...checkReceiptBindingCodes({
            receipt,
            sourceRevision: envelope.sourceRevision,
            result: envelope.result,
            contractHash: envelope.contractHash,
            implementationScope: facts.bundle,
          }),
        );
      } catch {
        findingCodes.push('verification-receipt-invalid');
      }
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
