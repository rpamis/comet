import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';

export const NATIVE_REVIEW_IDENTITY_SCHEMA = 'comet.native.review-identity.v1' as const;
export const NATIVE_REVIEW_KEYPAIR_SCHEMA = 'comet.native.review-keypair.v1' as const;
export const NATIVE_REVIEW_SIGNATURE_SCHEMA = 'comet.native.review-signature.v1' as const;

const ALGORITHM = 'ed25519' as const;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_PUBLIC_KEY_TEXT = 512;
const MAX_PRIVATE_KEY_TEXT = 16_384;
const MAX_SIGNATURE_TEXT = 256;
const SIGNATURE_CONTEXT = Buffer.from('comet.native.review-payload.v1\0', 'utf8');

export interface NativeReviewIdentity {
  schema: typeof NATIVE_REVIEW_IDENTITY_SCHEMA;
  algorithm: typeof ALGORITHM;
  keyId: string;
  publicKey: string;
}

export interface NativeReviewKeyPair {
  schema: typeof NATIVE_REVIEW_KEYPAIR_SCHEMA;
  identity: NativeReviewIdentity;
  privateKey: string;
}

export interface NativeReviewSignature {
  schema: typeof NATIVE_REVIEW_SIGNATURE_SCHEMA;
  algorithm: typeof ALGORITHM;
  keyId: string;
  payloadHash: string;
  signature: string;
}

/**
 * Native can verify owner-only file modes on POSIX. Windows ACL inheritance is not equivalent to
 * mode 0600, so the built-in generator must not persist private keys there.
 */
export function nativeReviewPrivateKeyFilePersistenceSupported(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform !== 'win32';
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

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function payloadHash(value: unknown, label = 'Native review payloadHash'): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 hash`);
  }
  return value;
}

function canonicalBase64(
  value: unknown,
  label: string,
  maxCharacters: number,
  expectedBytes?: number,
): Buffer {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxCharacters ||
    value.length % 4 !== 0
  ) {
    throw new Error(`${label} is invalid`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (
    bytes.length === 0 ||
    bytes.toString('base64') !== value ||
    (expectedBytes !== undefined && bytes.length !== expectedBytes)
  ) {
    throw new Error(`${label} must use canonical base64`);
  }
  return bytes;
}

function publicKeyMaterial(value: unknown): { key: KeyObject; der: Buffer; text: string } {
  const supplied = canonicalBase64(value, 'Native review public key', MAX_PUBLIC_KEY_TEXT);
  let key: KeyObject;
  try {
    key = createPublicKey({ key: supplied, format: 'der', type: 'spki' });
  } catch (error) {
    throw new Error('Native review public key is invalid', { cause: error });
  }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Native review public key must be Ed25519');
  }
  const der = key.export({ format: 'der', type: 'spki' });
  if (!Buffer.isBuffer(der) || !supplied.equals(der)) {
    throw new Error('Native review public key must use canonical SPKI DER');
  }
  return { key, der, text: der.toString('base64') };
}

function privateKeyMaterial(value: unknown): { key: KeyObject; der: Buffer } {
  const supplied = canonicalBase64(value, 'Native review private key', MAX_PRIVATE_KEY_TEXT);
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: supplied, format: 'der', type: 'pkcs8' });
  } catch (error) {
    throw new Error('Native review private key is invalid', { cause: error });
  }
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Native review private key must be Ed25519');
  }
  const der = key.export({ format: 'der', type: 'pkcs8' });
  if (!Buffer.isBuffer(der) || !supplied.equals(der)) {
    throw new Error('Native review private key must use canonical PKCS8 DER');
  }
  return { key, der };
}

function signaturePayload(hash: string): Buffer {
  return Buffer.concat([SIGNATURE_CONTEXT, Buffer.from(hash, 'hex')]);
}

export function parseNativeReviewSignature(value: unknown): NativeReviewSignature {
  const root = record(value, 'Native review signature');
  exactKeys(
    root,
    ['schema', 'algorithm', 'keyId', 'payloadHash', 'signature'],
    'Native review signature',
  );
  if (
    root.schema !== NATIVE_REVIEW_SIGNATURE_SCHEMA ||
    root.algorithm !== ALGORITHM ||
    typeof root.keyId !== 'string' ||
    !HASH_PATTERN.test(root.keyId)
  ) {
    throw new Error('Native review signature identity is invalid');
  }
  const hash = payloadHash(root.payloadHash);
  const signature = canonicalBase64(
    root.signature,
    'Native review signature',
    MAX_SIGNATURE_TEXT,
    64,
  ).toString('base64');
  return {
    schema: NATIVE_REVIEW_SIGNATURE_SCHEMA,
    algorithm: ALGORITHM,
    keyId: root.keyId,
    payloadHash: hash,
    signature,
  };
}

/** Derive the stable public identity from a canonical base64-encoded SPKI public key. */
export function nativeReviewKeyIdFromPublicKey(publicKey: string): string {
  return sha256(publicKeyMaterial(publicKey).der);
}

/** Parse an identity and recompute its content-derived key ID. */
export function parseNativeReviewIdentity(value: unknown): NativeReviewIdentity {
  const root = record(value, 'Native review identity');
  exactKeys(root, ['schema', 'algorithm', 'keyId', 'publicKey'], 'Native review identity');
  if (
    root.schema !== NATIVE_REVIEW_IDENTITY_SCHEMA ||
    root.algorithm !== ALGORITHM ||
    typeof root.keyId !== 'string' ||
    !HASH_PATTERN.test(root.keyId)
  ) {
    throw new Error('Native review identity keyId is invalid');
  }
  const publicKey = publicKeyMaterial(root.publicKey);
  const keyId = sha256(publicKey.der);
  if (root.keyId !== keyId) {
    throw new Error('Native review identity keyId does not match its public key');
  }
  return {
    schema: NATIVE_REVIEW_IDENTITY_SCHEMA,
    algorithm: ALGORITHM,
    keyId,
    publicKey: publicKey.text,
  };
}

/** Generate portable canonical key material without choosing where it is persisted. */
export function generateNativeReviewKeyPair(): NativeReviewKeyPair {
  const generated = generateKeyPairSync('ed25519');
  const publicKey = generated.publicKey.export({ format: 'der', type: 'spki' });
  const privateKey = generated.privateKey.export({ format: 'der', type: 'pkcs8' });
  if (!Buffer.isBuffer(publicKey) || !Buffer.isBuffer(privateKey)) {
    throw new Error('Native review key generation returned unsupported key material');
  }
  const identity: NativeReviewIdentity = {
    schema: NATIVE_REVIEW_IDENTITY_SCHEMA,
    algorithm: ALGORITHM,
    keyId: sha256(publicKey),
    publicKey: publicKey.toString('base64'),
  };
  return {
    schema: NATIVE_REVIEW_KEYPAIR_SCHEMA,
    identity,
    privateKey: privateKey.toString('base64'),
  };
}

/** Derive the portable public identity for private material held by an external secret store. */
export function nativeReviewIdentityFromPrivateKey(privateKeyValue: string): NativeReviewIdentity {
  const privateKey = privateKeyMaterial(privateKeyValue);
  const publicKey = createPublicKey(privateKey.key).export({ format: 'der', type: 'spki' });
  if (!Buffer.isBuffer(publicKey)) {
    throw new Error('Native review private key returned unsupported public key material');
  }
  return {
    schema: NATIVE_REVIEW_IDENTITY_SCHEMA,
    algorithm: ALGORITHM,
    keyId: sha256(publicKey),
    publicKey: publicKey.toString('base64'),
  };
}

/** Sign a domain-separated payload hash after proving the private key matches the identity. */
export function signNativeReviewPayloadHash(options: {
  identity: unknown;
  privateKey: string;
  payloadHash: string;
}): NativeReviewSignature {
  const identity = parseNativeReviewIdentity(options.identity);
  const hash = payloadHash(options.payloadHash);
  const privateKey = privateKeyMaterial(options.privateKey);
  const derivedPublicKey = createPublicKey(privateKey.key).export({ format: 'der', type: 'spki' });
  if (
    !Buffer.isBuffer(derivedPublicKey) ||
    !derivedPublicKey.equals(Buffer.from(identity.publicKey, 'base64'))
  ) {
    throw new Error('Native review private key does not match the public identity');
  }
  return {
    schema: NATIVE_REVIEW_SIGNATURE_SCHEMA,
    algorithm: ALGORITHM,
    keyId: identity.keyId,
    payloadHash: hash,
    signature: cryptoSign(null, signaturePayload(hash), privateKey.key).toString('base64'),
  };
}

/** Verify a proof and return its canonical plain-data representation. */
export function verifyNativeReviewPayloadHash(options: {
  identity: unknown;
  payloadHash: string;
  proof: unknown;
}): NativeReviewSignature {
  const identity = parseNativeReviewIdentity(options.identity);
  const hash = payloadHash(options.payloadHash);
  const proof = parseNativeReviewSignature(options.proof);
  if (proof.payloadHash !== hash) {
    throw new Error('Native review signature payloadHash does not match the expected payloadHash');
  }
  if (proof.keyId !== identity.keyId) {
    throw new Error('Native review signature keyId does not match the public identity');
  }
  const signature = canonicalBase64(
    proof.signature,
    'Native review signature',
    MAX_SIGNATURE_TEXT,
    64,
  );
  const publicKey = publicKeyMaterial(identity.publicKey);
  if (!cryptoVerify(null, signaturePayload(hash), publicKey.key, signature)) {
    throw new Error('Native review signature is invalid');
  }
  return proof;
}
