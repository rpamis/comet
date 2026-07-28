import { canonicalHash } from './native-canonical-hash.js';
import {
  nativeControllerProjectRootHash,
  readNativeControllerTrustProject,
} from './native-controller-trust.js';
import {
  parseNativeReviewSignature,
  signNativeReviewPayloadHash,
  verifyNativeReviewPayloadHash,
  type NativeReviewIdentity,
  type NativeReviewSignature,
} from './native-review-identity.js';
import type { NativeProjectPaths } from './native-types.js';

export const NATIVE_CREATION_AUTHORIZATION_SCHEMA =
  'comet.native.creation-authorization.v1' as const;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const CHANGE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export interface NativeCreationAuthorization {
  schema: typeof NATIVE_CREATION_AUTHORIZATION_SCHEMA;
  controllerKeyId: string;
  projectRootHash: string;
  policyHash: string;
  protocol: 'signed-v2';
  change: string;
  issuedAt: string;
  authorizationHash: string;
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

export function buildNativeCreationAuthorization(input: {
  controllerIdentity: NativeReviewIdentity;
  controllerPrivateKey: string;
  projectRootHash: string;
  policyHash: string;
  change: string;
  now?: Date;
}): NativeCreationAuthorization {
  const content = {
    schema: NATIVE_CREATION_AUTHORIZATION_SCHEMA,
    controllerKeyId: input.controllerIdentity.keyId,
    projectRootHash: input.projectRootHash,
    policyHash: input.policyHash,
    protocol: 'signed-v2' as const,
    change: input.change,
    issuedAt: (input.now ?? new Date()).toISOString(),
  };
  const authorizationHash = canonicalHash(NATIVE_CREATION_AUTHORIZATION_SCHEMA, content);
  return parseNativeCreationAuthorization({
    ...content,
    authorizationHash,
    controllerSignature: signNativeReviewPayloadHash({
      identity: input.controllerIdentity,
      privateKey: input.controllerPrivateKey,
      payloadHash: authorizationHash,
    }),
  });
}

export function parseNativeCreationAuthorization(value: unknown): NativeCreationAuthorization {
  const root = record(value, 'Native creation authorization');
  exactKeys(
    root,
    [
      'schema',
      'controllerKeyId',
      'projectRootHash',
      'policyHash',
      'protocol',
      'change',
      'issuedAt',
      'authorizationHash',
      'controllerSignature',
    ],
    'Native creation authorization',
  );
  if (
    root.schema !== NATIVE_CREATION_AUTHORIZATION_SCHEMA ||
    typeof root.controllerKeyId !== 'string' ||
    !HASH_PATTERN.test(root.controllerKeyId) ||
    typeof root.projectRootHash !== 'string' ||
    !HASH_PATTERN.test(root.projectRootHash) ||
    typeof root.policyHash !== 'string' ||
    !HASH_PATTERN.test(root.policyHash) ||
    root.protocol !== 'signed-v2' ||
    typeof root.change !== 'string' ||
    !CHANGE_NAME_PATTERN.test(root.change) ||
    typeof root.issuedAt !== 'string' ||
    Number.isNaN(Date.parse(root.issuedAt)) ||
    typeof root.authorizationHash !== 'string' ||
    !HASH_PATTERN.test(root.authorizationHash)
  ) {
    throw new Error('Native creation authorization is invalid');
  }
  const content = {
    schema: NATIVE_CREATION_AUTHORIZATION_SCHEMA,
    controllerKeyId: root.controllerKeyId,
    projectRootHash: root.projectRootHash,
    policyHash: root.policyHash,
    protocol: 'signed-v2' as const,
    change: root.change,
    issuedAt: root.issuedAt,
  };
  const authorizationHash = canonicalHash(NATIVE_CREATION_AUTHORIZATION_SCHEMA, content);
  if (authorizationHash !== root.authorizationHash) {
    throw new Error('Native creation authorization hash mismatch');
  }
  const controllerSignature = parseNativeReviewSignature(root.controllerSignature);
  if (
    controllerSignature.keyId !== root.controllerKeyId ||
    controllerSignature.payloadHash !== authorizationHash
  ) {
    throw new Error('Native creation authorization signature binding is invalid');
  }
  return { ...content, authorizationHash, controllerSignature };
}

export async function verifyNativeCreationAuthorization(options: {
  paths: NativeProjectPaths;
  policyHash: string;
  authorization: unknown;
  change: string;
}): Promise<NativeCreationAuthorization> {
  const controllerTrust = await readNativeControllerTrustProject(options.paths.projectRoot);
  if (!controllerTrust) {
    throw new Error('Native project has no controller-owned trust root');
  }
  const authorization = parseNativeCreationAuthorization(options.authorization);
  const projectRootHash = await nativeControllerProjectRootHash(options.paths.projectRoot);
  if (
    authorization.controllerKeyId !== controllerTrust.controllerIdentity.keyId ||
    authorization.projectRootHash !== projectRootHash ||
    authorization.policyHash !== options.policyHash ||
    authorization.change !== options.change
  ) {
    throw new Error('Native creation authorization does not match the trusted project/change');
  }
  verifyNativeReviewPayloadHash({
    identity: controllerTrust.controllerIdentity,
    payloadHash: authorization.authorizationHash,
    proof: authorization.controllerSignature,
  });
  return authorization;
}
