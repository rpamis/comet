import { createHash, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  generateNativeReviewKeyPair,
  nativeReviewIdentityFromPrivateKey,
  nativeReviewKeyIdFromPublicKey,
  nativeReviewPrivateKeyFilePersistenceSupported,
  parseNativeReviewIdentity,
  signNativeReviewPayloadHash,
  verifyNativeReviewPayloadHash,
} from '../../../domains/comet-native/native-review-identity.js';

const PAYLOAD_HASH = 'a'.repeat(64);

describe('Native review identities', () => {
  it('permits verified owner-only private-key files only on POSIX platforms', () => {
    expect(nativeReviewPrivateKeyFilePersistenceSupported('linux')).toBe(true);
    expect(nativeReviewPrivateKeyFilePersistenceSupported('darwin')).toBe(true);
    expect(nativeReviewPrivateKeyFilePersistenceSupported('win32')).toBe(false);
  });

  it('generates a canonical Ed25519 identity and matching PKCS8 private key', () => {
    const keyPair = generateNativeReviewKeyPair();
    const publicKey = Buffer.from(keyPair.identity.publicKey, 'base64');

    expect(keyPair).toEqual({
      schema: 'comet.native.review-keypair.v1',
      identity: {
        schema: 'comet.native.review-identity.v1',
        algorithm: 'ed25519',
        keyId: createHash('sha256').update(publicKey).digest('hex'),
        publicKey: publicKey.toString('base64'),
      },
      privateKey: expect.any(String),
    });
    expect(parseNativeReviewIdentity(keyPair.identity)).toEqual(keyPair.identity);
    expect(nativeReviewIdentityFromPrivateKey(keyPair.privateKey)).toEqual(keyPair.identity);
    expect(nativeReviewKeyIdFromPublicKey(keyPair.identity.publicKey)).toBe(keyPair.identity.keyId);
    expect(generateNativeReviewKeyPair().identity.keyId).not.toBe(keyPair.identity.keyId);
  });

  it('signs a payload hash with the matching private key and verifies the proof', () => {
    const keyPair = generateNativeReviewKeyPair();
    const proof = signNativeReviewPayloadHash({
      identity: keyPair.identity,
      privateKey: keyPair.privateKey,
      payloadHash: PAYLOAD_HASH,
    });

    expect(proof).toEqual({
      schema: 'comet.native.review-signature.v1',
      algorithm: 'ed25519',
      keyId: keyPair.identity.keyId,
      payloadHash: PAYLOAD_HASH,
      signature: expect.any(String),
    });
    expect(
      verifyNativeReviewPayloadHash({
        identity: keyPair.identity,
        payloadHash: PAYLOAD_HASH,
        proof,
      }),
    ).toEqual(proof);
  });

  it('rejects non-canonical, malformed, oversized, and non-Ed25519 public identities', () => {
    const keyPair = generateNativeReviewKeyPair();
    expect(() => parseNativeReviewIdentity({ ...keyPair.identity, keyId: 'f'.repeat(64) })).toThrow(
      'keyId',
    );
    expect(() =>
      parseNativeReviewIdentity({
        ...keyPair.identity,
        publicKey: `${keyPair.identity.publicKey}\n`,
      }),
    ).toThrow('public key');
    expect(() =>
      parseNativeReviewIdentity({ ...keyPair.identity, publicKey: 'A'.repeat(4_100) }),
    ).toThrow('public key');
    expect(() => parseNativeReviewIdentity({ ...keyPair.identity, unexpected: true })).toThrow(
      'fields',
    );

    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaPublicKey = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    expect(() =>
      parseNativeReviewIdentity({
        ...keyPair.identity,
        publicKey: rsaPublicKey,
        keyId: createHash('sha256').update(Buffer.from(rsaPublicKey, 'base64')).digest('hex'),
      }),
    ).toThrow('Ed25519');
  });

  it('rejects malformed hashes, private keys, and a private key from another identity', () => {
    const first = generateNativeReviewKeyPair();
    const second = generateNativeReviewKeyPair();

    expect(() =>
      signNativeReviewPayloadHash({
        identity: first.identity,
        privateKey: first.privateKey,
        payloadHash: 'A'.repeat(64),
      }),
    ).toThrow('payloadHash');
    expect(() =>
      signNativeReviewPayloadHash({
        identity: first.identity,
        privateKey: 'not-base64',
        payloadHash: PAYLOAD_HASH,
      }),
    ).toThrow('private key');
    expect(() =>
      signNativeReviewPayloadHash({
        identity: first.identity,
        privateKey: second.privateKey,
        payloadHash: PAYLOAD_HASH,
      }),
    ).toThrow('does not match');
    expect(() =>
      signNativeReviewPayloadHash({
        identity: first.identity,
        privateKey: 'A'.repeat(16_500),
        payloadHash: PAYLOAD_HASH,
      }),
    ).toThrow('private key');

    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() =>
      signNativeReviewPayloadHash({
        identity: first.identity,
        privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
        payloadHash: PAYLOAD_HASH,
      }),
    ).toThrow('Ed25519');
  });

  it('rejects altered, mismatched, malformed, and oversized signature proofs', () => {
    const first = generateNativeReviewKeyPair();
    const second = generateNativeReviewKeyPair();
    const proof = signNativeReviewPayloadHash({
      identity: first.identity,
      privateKey: first.privateKey,
      payloadHash: PAYLOAD_HASH,
    });
    const secondProof = signNativeReviewPayloadHash({
      identity: second.identity,
      privateKey: second.privateKey,
      payloadHash: PAYLOAD_HASH,
    });

    expect(() =>
      verifyNativeReviewPayloadHash({
        identity: first.identity,
        payloadHash: 'b'.repeat(64),
        proof,
      }),
    ).toThrow('payloadHash');
    expect(() =>
      verifyNativeReviewPayloadHash({
        identity: first.identity,
        payloadHash: PAYLOAD_HASH,
        proof: { ...proof, keyId: second.identity.keyId },
      }),
    ).toThrow('keyId');
    expect(() =>
      verifyNativeReviewPayloadHash({
        identity: first.identity,
        payloadHash: PAYLOAD_HASH,
        proof: secondProof,
      }),
    ).toThrow('keyId');
    expect(() =>
      verifyNativeReviewPayloadHash({
        identity: first.identity,
        payloadHash: PAYLOAD_HASH,
        proof: { ...proof, signature: 'not-base64' },
      }),
    ).toThrow('signature');
    expect(() =>
      verifyNativeReviewPayloadHash({
        identity: first.identity,
        payloadHash: PAYLOAD_HASH,
        proof: { ...proof, signature: 'A'.repeat(4_100) },
      }),
    ).toThrow('signature');

    const signature = Buffer.from(proof.signature, 'base64');
    signature[0] ^= 1;
    expect(() =>
      verifyNativeReviewPayloadHash({
        identity: first.identity,
        payloadHash: PAYLOAD_HASH,
        proof: { ...proof, signature: signature.toString('base64') },
      }),
    ).toThrow('invalid');
  });
});
