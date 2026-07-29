import path from 'node:path';

import { canonicalHash } from './native-canonical-hash.js';
import { readNativeProtectedTextFile } from './native-protected-file.js';
import {
  parseNativeReviewIdentity,
  parseNativeReviewSignature,
  signNativeReviewPayloadHash,
  verifyNativeReviewPayloadHash,
  type NativeReviewIdentity,
  type NativeReviewSignature,
} from './native-review-identity.js';
import { readNativeControllerTrustProject } from './native-controller-trust.js';
import type { NativeProjectPaths } from './native-types.js';
import type { NativeImplementationScopeBundle } from './native-verification-scope.js';
import { NATIVE_REVIEW_TRUST_POLICY_REF } from './native-review-contract.js';

export const NATIVE_REVIEW_TRUST_POLICY_SCHEMA = 'comet.native.review-trust-policy.v2' as const;
export { NATIVE_REVIEW_TRUST_POLICY_REF } from './native-review-contract.js';
const POLICY_HASH_TAG = NATIVE_REVIEW_TRUST_POLICY_SCHEMA;
const MAX_POLICY_BYTES = 64 * 1024;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export interface NativeReviewTrustPolicy {
  schema: typeof NATIVE_REVIEW_TRUST_POLICY_SCHEMA;
  controllerKeyId: string;
  implementationKeyId: string;
  trustedReviewers: NativeReviewIdentity[];
  trustedWaiverSigners: NativeReviewIdentity[];
  policyHash: string;
  controllerSignature: NativeReviewSignature;
}

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
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(canonical)) {
    throw new Error(`${label} fields are invalid`);
  }
}

function identities(value: unknown, label: string): NativeReviewIdentity[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new Error(`${label} must be a bounded non-empty array`);
  }
  const parsed = value
    .map(parseNativeReviewIdentity)
    .sort((left, right) => left.keyId.localeCompare(right.keyId, 'en'));
  if (
    new Set(parsed.map((identity) => identity.keyId)).size !== parsed.length ||
    JSON.stringify(value) !== JSON.stringify(parsed)
  ) {
    throw new Error(`${label} must be sorted and unique`);
  }
  return parsed;
}

export function buildNativeReviewTrustPolicy(input: {
  controllerIdentity: NativeReviewIdentity;
  controllerPrivateKey: string;
  implementationKeyId: string;
  trustedReviewers: readonly NativeReviewIdentity[];
  trustedWaiverSigners: readonly NativeReviewIdentity[];
}): NativeReviewTrustPolicy {
  const content = {
    schema: NATIVE_REVIEW_TRUST_POLICY_SCHEMA,
    controllerKeyId: input.controllerIdentity.keyId,
    implementationKeyId: input.implementationKeyId,
    trustedReviewers: [...input.trustedReviewers].sort((left, right) =>
      left.keyId.localeCompare(right.keyId, 'en'),
    ),
    trustedWaiverSigners: [...input.trustedWaiverSigners].sort((left, right) =>
      left.keyId.localeCompare(right.keyId, 'en'),
    ),
  };
  const policyHash = canonicalHash(POLICY_HASH_TAG, content);
  return parseNativeReviewTrustPolicy({
    ...content,
    policyHash,
    controllerSignature: signNativeReviewPayloadHash({
      identity: input.controllerIdentity,
      privateKey: input.controllerPrivateKey,
      payloadHash: policyHash,
    }),
  });
}

export function parseNativeReviewTrustPolicy(value: unknown): NativeReviewTrustPolicy {
  const root = record(value, 'Native review trust policy');
  exactKeys(
    root,
    [
      'schema',
      'controllerKeyId',
      'implementationKeyId',
      'trustedReviewers',
      'trustedWaiverSigners',
      'policyHash',
      'controllerSignature',
    ],
    'Native review trust policy',
  );
  if (
    root.schema !== NATIVE_REVIEW_TRUST_POLICY_SCHEMA ||
    typeof root.controllerKeyId !== 'string' ||
    !HASH_PATTERN.test(root.controllerKeyId) ||
    typeof root.implementationKeyId !== 'string' ||
    !HASH_PATTERN.test(root.implementationKeyId) ||
    typeof root.policyHash !== 'string' ||
    !HASH_PATTERN.test(root.policyHash)
  ) {
    throw new Error('Native review trust policy identity or hash is invalid');
  }
  const trustedReviewers = identities(root.trustedReviewers, 'Native trusted reviewers');
  const trustedWaiverSigners = identities(
    root.trustedWaiverSigners,
    'Native trusted waiver signers',
  );
  if (
    trustedReviewers.some((identity) => identity.keyId === root.implementationKeyId) ||
    trustedWaiverSigners.some((identity) => identity.keyId === root.implementationKeyId) ||
    new Set([
      root.controllerKeyId,
      root.implementationKeyId,
      ...trustedReviewers.map((identity) => identity.keyId),
      ...trustedWaiverSigners.map((identity) => identity.keyId),
    ]).size !==
      2 + trustedReviewers.length + trustedWaiverSigners.length
  ) {
    throw new Error(
      'Native controller, implementation, reviewer, and waiver signer identities must be globally distinct',
    );
  }
  const content = {
    schema: NATIVE_REVIEW_TRUST_POLICY_SCHEMA,
    controllerKeyId: root.controllerKeyId,
    implementationKeyId: root.implementationKeyId,
    trustedReviewers,
    trustedWaiverSigners,
  };
  const policyHash = canonicalHash(POLICY_HASH_TAG, content);
  if (policyHash !== root.policyHash) {
    throw new Error('Native review trust policy hash mismatch');
  }
  const controllerSignature = parseNativeReviewSignature(root.controllerSignature);
  if (
    controllerSignature.keyId !== root.controllerKeyId ||
    controllerSignature.payloadHash !== policyHash
  ) {
    throw new Error('Native review trust policy controller signature binding is invalid');
  }
  return { ...content, policyHash, controllerSignature };
}

export function verifyNativeReviewTrustPolicy(
  value: unknown,
  controllerIdentity: NativeReviewIdentity,
): NativeReviewTrustPolicy {
  const policy = parseNativeReviewTrustPolicy(value);
  if (policy.controllerKeyId !== controllerIdentity.keyId) {
    throw new Error('Native review trust policy controller is not host-trusted');
  }
  verifyNativeReviewPayloadHash({
    identity: controllerIdentity,
    payloadHash: policy.policyHash,
    proof: policy.controllerSignature,
  });
  return policy;
}

/** Read the public trust policy when external review evidence is required. */
export async function readNativeReviewTrustPolicy(
  paths: NativeProjectPaths,
): Promise<NativeReviewTrustPolicy> {
  const file = await readNativeProtectedTextFile({
    root: paths.projectRoot,
    file: path.join(paths.projectRoot, ...NATIVE_REVIEW_TRUST_POLICY_REF.split('/')),
    maxBytes: MAX_POLICY_BYTES,
    label: NATIVE_REVIEW_TRUST_POLICY_REF,
  });
  try {
    const controllerTrust = await readNativeControllerTrustProject(paths.projectRoot);
    if (!controllerTrust) throw new Error('Native project has no controller-owned trust root');
    return verifyNativeReviewTrustPolicy(JSON.parse(file.text), controllerTrust.controllerIdentity);
  } catch (error) {
    throw new Error('Native review trust policy is not valid canonical JSON', { cause: error });
  }
}

/**
 * Load the pre-trusted policy and prove that it existed unchanged in both the change-open
 * baseline and the Build snapshot. Private key material is deliberately not part of this file.
 */
export async function loadNativeReviewTrustPolicy(options: {
  paths: NativeProjectPaths;
  scope: NativeImplementationScopeBundle;
}): Promise<NativeReviewTrustPolicy> {
  const baseline = options.scope.baseline.entries.find(
    (entry) => entry.path === NATIVE_REVIEW_TRUST_POLICY_REF,
  );
  const current = options.scope.current.entries.find(
    (entry) => entry.path === NATIVE_REVIEW_TRUST_POLICY_REF,
  );
  if (!baseline || !current || baseline.hash !== current.hash || baseline.size !== current.size) {
    throw new Error(
      'Native review trust policy must exist unchanged from change creation through Build',
    );
  }
  const file = await readNativeProtectedTextFile({
    root: options.paths.projectRoot,
    file: path.join(options.paths.projectRoot, ...NATIVE_REVIEW_TRUST_POLICY_REF.split('/')),
    maxBytes: MAX_POLICY_BYTES,
    label: NATIVE_REVIEW_TRUST_POLICY_REF,
  });
  if (file.hash !== current.hash || file.size !== current.size) {
    throw new Error('Native review trust policy changed after Build');
  }
  let value: unknown;
  try {
    value = JSON.parse(file.text);
  } catch (error) {
    throw new Error('Native review trust policy is not valid JSON', { cause: error });
  }
  const controllerTrust = await readNativeControllerTrustProject(options.paths.projectRoot);
  if (!controllerTrust) throw new Error('Native project has no controller-owned trust root');
  return verifyNativeReviewTrustPolicy(value, controllerTrust.controllerIdentity);
}

export function trustedNativeIdentity(
  policy: NativeReviewTrustPolicy,
  kind: 'reviewer' | 'waiver',
  keyId: string,
): NativeReviewIdentity {
  const identities = kind === 'reviewer' ? policy.trustedReviewers : policy.trustedWaiverSigners;
  const identity = identities.find((candidate) => candidate.keyId === keyId);
  if (!identity) throw new Error(`Native ${kind} identity is not pre-trusted`);
  return identity;
}
