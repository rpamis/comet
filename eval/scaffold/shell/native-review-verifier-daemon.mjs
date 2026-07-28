import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const [signerUrl, tokenFile] = process.argv.slice(2);
if (!signerUrl || !tokenFile) throw new Error('signer URL and token file are required');
const token = readFileSync(tokenFile, 'utf8').trim();
const runtime = '/workspace/_eval_trusted_oracles/comet-native-runtime.mjs';
const oracle = '/workspace/_eval_trusted_oracles';
const allowedChange = JSON.parse(
  readFileSync(path.join(oracle, 'native-review-fixture.json'), 'utf8'),
).change;
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
const run = (args) => {
  const result = spawnSync(process.execPath, [runtime, ...args], {
    cwd: '/workspace',
    encoding: 'utf8',
    env: { HOME: '/home/agent', PATH: process.env.PATH, LANG: 'C.UTF-8' },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Runtime exited ${result.status}`);
  }
  return result.stdout;
};
const signDocument = async (role, document) => {
  const response = await fetch(`${signerUrl}/sign`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ role, document }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'signer rejected request');
  return value;
};
const optionValues = (args, name) => {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[++index]);
  }
  return values;
};
const one = (args, name) => optionValues(args, name)[0];
const invoke = async ({ role, change, args = [] }) => {
  if (change !== allowedChange || !Array.isArray(args)) throw new Error('request is out of scope');
  const temp = mkdtempSync(path.join(os.tmpdir(), 'comet-native-verifier-'));
  if (role === 'implementation') {
    const preparation = path.join(temp, 'implementation-preparation.json');
    const attestation = path.join(temp, 'implementation-attestation.json');
    run([
      'receipt',
      'implement',
      change,
      'prepare',
      '--identity',
      path.join(oracle, 'implementation-identity.json'),
      '--output',
      preparation,
    ]);
    const proof = await signDocument(
      'implementation',
      JSON.parse(readFileSync(preparation, 'utf8')),
    );
    writeFileSync(attestation, JSON.stringify(proof));
    return run([
      'receipt',
      'implement',
      change,
      'finalize',
      '--preparation',
      preparation,
      '--attestation',
      attestation,
      '--confirmed',
    ]);
  }
  if (role === 'reviewer') {
    const implementationReceipt = one(args, '--implementation-receipt');
    const report = one(args, '--report');
    const required = optionValues(args, '--required-receipt');
    const manual = optionValues(args, '--attest-manual');
    if (!implementationReceipt || !report || required.length === 0) {
      throw new Error('review request is incomplete');
    }
    if (manual.length > 0) {
      throw new Error(
        'manual evidence requires an external human reviewer and is not enabled for this Eval',
      );
    }
    const preparation = path.join(temp, 'review-preparation.json');
    const approval = path.join(temp, 'review-approval.json');
    const attestation = path.join(temp, 'review-attestation.json');
    const checkedNames = [
      '--unified-io-receipt',
      '--adversarial-paths-receipt',
      '--generated-assets-receipt',
      '--lifecycle-eval-receipt',
    ];
    const checked = checkedNames.flatMap((name) => {
      const value = one(args, name);
      return value ? [name, value] : [];
    });
    run([
      'receipt',
      'review',
      change,
      'prepare',
      '--implementation-receipt',
      implementationReceipt,
      '--report',
      report,
      ...required.flatMap((value) => ['--required-receipt', value]),
      '--identity',
      path.join(oracle, 'reviewer-identity.json'),
      ...checked,
      '--output',
      preparation,
    ]);
    run([
      'receipt',
      'review',
      change,
      'approve',
      '--preparation',
      preparation,
      '--checked-acceptance-applicability',
      '--output',
      approval,
    ]);
    const proof = await signDocument('reviewer', JSON.parse(readFileSync(approval, 'utf8')));
    writeFileSync(attestation, JSON.stringify(proof));
    return run([
      'receipt',
      'review',
      change,
      'finalize',
      '--preparation',
      preparation,
      '--approval',
      approval,
      '--attestation',
      attestation,
      '--confirmed',
    ]);
  }
  throw new Error('operation is not enabled for this Eval');
};

http
  .createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/invoke') {
        send(response, 404, { error: 'not found' });
        return;
      }
      send(response, 200, { stdout: await invoke(await readJson(request)) });
    } catch (error) {
      send(response, 400, { error: error.message });
    }
  })
  .listen(4318, '0.0.0.0');
