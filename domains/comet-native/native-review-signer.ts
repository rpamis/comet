import {
  parseNativeReviewIdentity,
  signNativeReviewPayloadHash,
  type NativeReviewIdentity,
  type NativeReviewSignature,
} from './native-review-identity.js';
import {
  nativeImplementationAttestationHash,
  nativeIndependentReviewAttestationHash,
  type NativeVerificationReceipt,
} from './native-verification-receipt.js';
import type {
  NativeImplementationPreparation,
  NativeIndependentReviewApproval,
} from './native-verification-receipt-runtime.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw new Error(`${label} has unexpected fields`);
  }
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function parseNativeIndependentReviewApproval(
  value: unknown,
): NativeIndependentReviewApproval {
  const root = record(value, 'Native review approval');
  exactKeys(
    root,
    ['schema', 'preparationHash', 'receipt', 'payloadHash'],
    'Native review approval',
  );
  if (root.schema !== 'comet.native.review-approval.v1') {
    throw new Error('Native review approval schema is invalid');
  }
  const receipt = record(root.receipt, 'Native review approval receipt');
  exactKeys(
    receipt,
    ['kind', 'role', 'status', 'bindings', 'acceptanceIds', 'actor', 'issuedAt', 'evidence'],
    'Native review approval receipt',
  );
  if (
    receipt.kind !== 'independent-review' ||
    receipt.role !== 'acceptance-evidence' ||
    (receipt.status !== 'passed' && receipt.status !== 'blocked') ||
    !Array.isArray(receipt.acceptanceIds) ||
    receipt.acceptanceIds.some((entry) => typeof entry !== 'string') ||
    typeof receipt.actor !== 'string' ||
    typeof receipt.issuedAt !== 'string'
  ) {
    throw new Error('Native review approval receipt is invalid');
  }
  const evidence = record(receipt.evidence, 'Native review approval receipt evidence');
  const reviewerIdentity = parseNativeReviewIdentity(evidence.reviewerIdentity);
  if (receipt.actor !== `review-key:${reviewerIdentity.keyId}`) {
    throw new Error('Native review approval actor/reviewer identity mismatch');
  }
  const approval = {
    schema: 'comet.native.review-approval.v1' as const,
    preparationHash: hash(root.preparationHash, 'Native review approval preparation hash'),
    receipt: receipt as unknown as NativeIndependentReviewApproval['receipt'],
    payloadHash: hash(root.payloadHash, 'Native review approval payload hash'),
  };
  const expectedPayloadHash = nativeIndependentReviewAttestationHash({
    bindings: approval.receipt.bindings,
    status: approval.receipt.status,
    acceptanceIds: approval.receipt.acceptanceIds,
    issuedAt: approval.receipt.issuedAt,
    evidence: approval.receipt.evidence,
  });
  if (approval.payloadHash !== expectedPayloadHash) {
    throw new Error('Native review approval payload hash mismatch');
  }
  return approval;
}

/**
 * Project-agnostic signer boundary. The caller supplies a complete approval
 * document, never an arbitrary payload hash. This module performs no file,
 * workspace, Git, or process access.
 */
export function signNativeIndependentReviewApproval(options: {
  approval: unknown;
  identity: NativeReviewIdentity;
  privateKey: string;
}): NativeReviewSignature {
  const approval = parseNativeIndependentReviewApproval(options.approval);
  const identity = parseNativeReviewIdentity(options.identity);
  const reviewerIdentity = approval.receipt.evidence.reviewerIdentity;
  if (
    reviewerIdentity.keyId !== identity.keyId ||
    reviewerIdentity.publicKey !== identity.publicKey
  ) {
    throw new Error('Native review signer identity does not match the approval reviewer');
  }
  return signNativeReviewPayloadHash({
    identity,
    privateKey: options.privateKey,
    payloadHash: approval.payloadHash,
  });
}

export function parseNativeImplementationPreparation(
  value: unknown,
): NativeImplementationPreparation {
  const root = record(value, 'Native implementation preparation');
  exactKeys(
    root,
    ['schema', 'receipt', 'payloadHash', 'preparationHash'],
    'Native implementation preparation',
  );
  if (root.schema !== 'comet.native.implementation-preparation.v1') {
    throw new Error('Native implementation preparation schema is invalid');
  }
  const receipt = record(root.receipt, 'Native implementation preparation receipt');
  exactKeys(
    receipt,
    ['kind', 'role', 'status', 'bindings', 'acceptanceIds', 'actor', 'issuedAt', 'evidence'],
    'Native implementation preparation receipt',
  );
  if (
    receipt.kind !== 'implementation-attestation' ||
    receipt.role !== 'acceptance-evidence' ||
    receipt.status !== 'passed'
  ) {
    throw new Error('Native implementation preparation receipt is invalid');
  }
  const preparation = {
    schema: 'comet.native.implementation-preparation.v1' as const,
    receipt: receipt as unknown as NativeImplementationPreparation['receipt'],
    payloadHash: hash(root.payloadHash, 'Native implementation preparation payload hash'),
    preparationHash: hash(root.preparationHash, 'Native implementation preparation hash'),
  };
  const expectedPayloadHash = nativeImplementationAttestationHash({
    bindings: preparation.receipt.bindings,
    status: preparation.receipt.status,
    acceptanceIds: preparation.receipt.acceptanceIds,
    issuedAt: preparation.receipt.issuedAt,
    evidence: preparation.receipt.evidence,
  });
  if (preparation.payloadHash !== expectedPayloadHash) {
    throw new Error('Native implementation preparation payload hash mismatch');
  }
  return preparation;
}

export function signNativeImplementationPreparation(options: {
  preparation: unknown;
  identity: NativeReviewIdentity;
  privateKey: string;
}): NativeReviewSignature {
  const preparation = parseNativeImplementationPreparation(options.preparation);
  const identity = parseNativeReviewIdentity(options.identity);
  const implementationIdentity = preparation.receipt.evidence.implementationIdentity;
  if (
    implementationIdentity.keyId !== identity.keyId ||
    implementationIdentity.publicKey !== identity.publicKey
  ) {
    throw new Error('Native implementation signer identity does not match the preparation');
  }
  return signNativeReviewPayloadHash({
    identity,
    privateKey: options.privateKey,
    payloadHash: preparation.payloadHash,
  });
}

export type NativeUnsignedIndependentReviewReceipt = Omit<
  Extract<NativeVerificationReceipt, { kind: 'independent-review' }>,
  'schema' | 'receiptHash'
>;
