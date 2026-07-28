import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const [secretRoot, tokenFile] = process.argv.slice(2);
if (!secretRoot || !tokenFile) throw new Error('signer secret root and token file are required');
const token = readFileSync(tokenFile, 'utf8').trim();
const canonical = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};
const hash = (tag, value) =>
  createHash('sha256')
    .update(`${tag}\n${canonical(value)}`)
    .digest('hex');
const roles = Object.freeze({
  implementation: {
    file: 'implementation-key.json',
    schema: 'comet.native.implementation-preparation.v1',
    tag: 'comet.native.implementation-attestation.v1',
  },
  reviewer: {
    file: 'reviewer-key.json',
    schema: 'comet.native.review-approval.v1',
    tag: 'comet.native.independent-review-attestation.v1',
  },
  waiver: {
    file: 'waiver-key.json',
    schema: 'comet.native.waiver-sign-request.v1',
    tag: 'comet.native.waiver-attestation.v1',
  },
});
const keyPairs = Object.fromEntries(
  Object.entries(roles).map(([role, config]) => [
    role,
    JSON.parse(readFileSync(path.join(secretRoot, config.file), 'utf8')),
  ]),
);
const send = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};
const readJson = async (request) => {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1024 * 1024) throw new Error('request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};
const signDocument = (role, document) => {
  const config = roles[role];
  const pair = keyPairs[role];
  if (!config || !pair || document?.schema !== config.schema) {
    throw new Error('operation or signed document schema is not allowed');
  }
  let payload;
  let suppliedHash;
  if (role === 'implementation') {
    const { receipt } = document;
    payload = {
      bindings: receipt.bindings,
      status: receipt.status,
      acceptanceIds: [...receipt.acceptanceIds].sort(),
      issuedAt: receipt.issuedAt,
      evidence: receipt.evidence,
    };
    suppliedHash = document.payloadHash;
    if (receipt.evidence.implementationIdentity.keyId !== pair.identity.keyId) {
      throw new Error('implementation identity mismatch');
    }
  } else if (role === 'reviewer') {
    const { receipt } = document;
    payload = {
      bindings: receipt.bindings,
      status: receipt.status,
      acceptanceIds: [...receipt.acceptanceIds].sort(),
      issuedAt: receipt.issuedAt,
      evidence: receipt.evidence,
    };
    suppliedHash = document.payloadHash;
    if (receipt.evidence.reviewerIdentity.keyId !== pair.identity.keyId) {
      throw new Error('reviewer identity mismatch');
    }
  } else {
    const { waiver } = document;
    const { schema: _schema, ...content } = waiver;
    payload = { ...content, alternativeReceiptRefs: [...content.alternativeReceiptRefs].sort() };
    suppliedHash = document.payloadHash;
    if (waiver.signerIdentity.keyId !== pair.identity.keyId) {
      throw new Error('waiver identity mismatch');
    }
  }
  const payloadHash = hash(config.tag, payload);
  if (payloadHash !== suppliedHash) throw new Error('signed payload hash mismatch');
  const signature = sign(
    null,
    Buffer.concat([
      Buffer.from('comet.native.review-payload.v1\0'),
      Buffer.from(payloadHash, 'hex'),
    ]),
    createPrivateKey({
      key: Buffer.from(pair.privateKey, 'base64'),
      format: 'der',
      type: 'pkcs8',
    }),
  ).toString('base64');
  return {
    schema: 'comet.native.review-signature.v1',
    algorithm: 'ed25519',
    keyId: pair.identity.keyId,
    payloadHash,
    signature,
  };
};

http
  .createServer(async (request, response) => {
    try {
      if (
        request.method !== 'POST' ||
        request.url !== '/sign' ||
        request.headers.authorization !== `Bearer ${token}`
      ) {
        send(response, 404, { error: 'not found' });
        return;
      }
      const body = await readJson(request);
      send(response, 200, signDocument(body.role, body.document));
    } catch (error) {
      send(response, 400, { error: error.message });
    }
  })
  .listen(4317, '0.0.0.0');
