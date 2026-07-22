import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { atomicWriteJson } from './native-atomic-file.js';
import { nativeChangeDir } from './native-change.js';
import { resolveContainedNativePath } from './native-paths.js';
import { hasComparableNativeFileObject, sameNativeFileObject } from './native-file-identity.js';
import type { NativeProjectPaths } from './native-types.js';
import {
  parseNativeImplementationScopeBundle,
  parseNativeImplementationScope,
  parseNativeSnapshotProjection,
  rebuildNativeImplementationScopeBundle,
  MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES,
  type NativeImplementationScopeBundle,
  type NativeImplementationScope,
  type NativeSnapshotProjection,
} from './native-verification-scope.js';
import {
  parseNativePartialAllowance,
  parseNativeVerificationEvidenceEnvelope,
  type NativePartialAllowance,
  type NativeVerificationEvidenceEnvelope,
} from './native-verification-evidence.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
export const MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES = MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES;
/** Retained for callers that size transient bundles; persistence is governed per document. */
export const MAX_NATIVE_IMPLEMENTATION_SCOPE_BUNDLE_BYTES = 3 * MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES;

export type NativeEvidenceKind =
  | 'snapshots'
  | 'scopes'
  | 'allowances'
  | 'verifications'
  | 'reports';

export interface NativeEvidenceReadHooks {
  afterParentChainCaptured?: () => void | Promise<void>;
  afterOpen?: () => void | Promise<void>;
  beforeFinalCheck?: () => void | Promise<void>;
}

interface DirectoryIdentity {
  path: string;
  realPath: string;
  dev: number;
  ino: number;
  birthtimeMs: number;
}

function isInside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function sameDirectoryIdentity(
  identity: DirectoryIdentity,
  stat: import('node:fs').Stats,
): boolean {
  return sameNativeFileObject(
    { ...identity, birthtime: identity.birthtimeMs },
    {
      ...stat,
      birthtime: stat.birthtimeMs,
    },
  );
}

function sameFileIdentity(left: import('node:fs').Stats, right: import('node:fs').Stats): boolean {
  const leftObject = { ...left, birthtime: left.birthtimeMs };
  const rightObject = { ...right, birthtime: right.birthtimeMs };
  if (hasComparableNativeFileObject(leftObject, rightObject)) {
    return sameNativeFileObject(leftObject, rightObject);
  }
  return (
    sameNativeFileObject(leftObject, rightObject) &&
    left.birthtimeMs === right.birthtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.size === right.size
  );
}

async function captureDirectoryIdentity(directory: string): Promise<DirectoryIdentity> {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Native evidence parent must be a real directory: ${directory}`);
  }
  return {
    path: directory,
    realPath: await fs.realpath(directory),
    dev: stat.dev,
    ino: stat.ino,
    birthtimeMs: stat.birthtimeMs,
  };
}

async function captureDirectoryChain(
  root: string,
  directory: string,
): Promise<DirectoryIdentity[]> {
  const lexicalRoot = path.resolve(root);
  const lexicalDirectory = path.resolve(directory);
  if (!isInside(lexicalRoot, lexicalDirectory)) {
    throw new Error('Native evidence path is outside its change');
  }
  const chain = [await captureDirectoryIdentity(lexicalRoot)];
  let cursor = lexicalRoot;
  for (const segment of path
    .relative(lexicalRoot, lexicalDirectory)
    .split(path.sep)
    .filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const identity = await captureDirectoryIdentity(cursor);
    if (!isInside(chain[0].realPath, identity.realPath)) {
      throw new Error(`Native evidence parent resolves outside its change: ${cursor}`);
    }
    chain.push(identity);
  }
  return chain;
}

async function verifyDirectoryChain(chain: readonly DirectoryIdentity[]): Promise<void> {
  for (const identity of chain) {
    const stat = await fs.lstat(identity.path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !sameDirectoryIdentity(identity, stat) ||
      (await fs.realpath(identity.path)) !== identity.realPath
    ) {
      throw new Error(`Native evidence parent changed while reading: ${identity.path}`);
    }
  }
}

async function readBoundedEvidenceJson(
  file: string,
  changeRoot: string,
  hooks: NativeEvidenceReadHooks = {},
): Promise<unknown> {
  const chain = await captureDirectoryChain(changeRoot, path.dirname(file));
  await hooks.afterParentChainCaptured?.();
  const lexical = await fs.lstat(file);
  if (!lexical.isFile() || lexical.isSymbolicLink()) {
    throw new Error('Native evidence document must be a regular file');
  }
  const realPath = await fs.realpath(file);
  if (!isInside(chain[0].realPath, realPath)) {
    throw new Error('Native evidence document resolves outside its change');
  }
  const handle = await fs.open(file, 'r');
  try {
    const [opened, pathAfterOpen, realPathAfterOpen] = await Promise.all([
      handle.stat(),
      fs.lstat(file),
      fs.realpath(file),
    ]);
    await verifyDirectoryChain(chain);
    if (
      !opened.isFile() ||
      !pathAfterOpen.isFile() ||
      pathAfterOpen.isSymbolicLink() ||
      realPathAfterOpen !== realPath ||
      !sameFileIdentity(opened, lexical) ||
      !sameFileIdentity(opened, pathAfterOpen)
    ) {
      throw new Error('Native evidence document changed while opening');
    }
    if (opened.size > MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES) {
      throw new Error(
        `Native evidence document exceeds ${MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES} bytes`,
      );
    }
    await hooks.afterOpen?.();
    const chunks: Buffer[] = [];
    let total = 0;
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      const remaining = MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES + 1 - total;
      const read = await handle.read(buffer, 0, Math.min(buffer.length, remaining), null);
      if (read.bytesRead === 0) break;
      total += read.bytesRead;
      if (total > MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES) {
        throw new Error(
          `Native evidence document exceeds ${MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES} bytes`,
        );
      }
      chunks.push(Buffer.from(buffer.subarray(0, read.bytesRead)));
    }
    await hooks.beforeFinalCheck?.();
    const [afterHandle, afterPath, afterRealPath] = await Promise.all([
      handle.stat(),
      fs.lstat(file),
      fs.realpath(file),
    ]);
    await verifyDirectoryChain(chain);
    if (
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      afterRealPath !== realPath ||
      !sameFileIdentity(opened, afterHandle) ||
      !sameFileIdentity(opened, afterPath)
    ) {
      throw new Error('Native evidence document changed while reading');
    }
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8')) as unknown;
  } finally {
    await handle.close();
  }
}

export function nativeEvidenceRef(kind: NativeEvidenceKind, hash: string): string {
  if (!HASH_PATTERN.test(hash)) throw new Error('Native evidence hash is invalid');
  return `runtime/evidence/${kind}/${hash}.json`;
}

export function nativeReportEvidenceRef(hash: string): string {
  return nativeEvidenceRef('reports', hash);
}

export async function writeNativeVerificationReportSnapshot(options: {
  paths: NativeProjectPaths;
  name: string;
  hash: string;
  text: string;
}): Promise<string> {
  const encoded = Buffer.from(options.text, 'utf8');
  if (
    encoded.byteLength > MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES ||
    createHash('sha256').update(encoded).digest('hex') !== options.hash
  ) {
    throw new Error('Native verification report snapshot hash or size is invalid');
  }
  return writeEvidenceDocument({
    paths: options.paths,
    name: options.name,
    kind: 'reports',
    hash: options.hash,
    value: {
      schema: 'comet.native.verification-report.v1',
      reportHash: options.hash,
      content: options.text,
    },
  });
}

export async function readNativeVerificationReportSnapshot(
  paths: NativeProjectPaths,
  name: string,
  hash: string,
): Promise<string> {
  if (!HASH_PATTERN.test(hash)) throw new Error('Native report evidence hash is invalid');
  const value = await readEvidenceDocument({ paths, name, kind: 'reports', hash });
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native report evidence must be an object');
  }
  const report = value as Record<string, unknown>;
  if (
    Object.keys(report).sort().join(',') !== 'content,reportHash,schema' ||
    report.schema !== 'comet.native.verification-report.v1' ||
    report.reportHash !== hash ||
    typeof report.content !== 'string' ||
    createHash('sha256').update(Buffer.from(report.content, 'utf8')).digest('hex') !== hash
  ) {
    throw new Error('Native report evidence does not match its hash');
  }
  return report.content;
}

function parseEvidenceRef(ref: string, expectedKind: NativeEvidenceKind): string {
  const match =
    /^runtime\/evidence\/(snapshots|scopes|allowances|verifications|reports)\/([a-f0-9]{64})\.json$/u.exec(
      ref,
    );
  if (!match || match[1] !== expectedKind) {
    throw new Error(`Native evidence ref is invalid for ${expectedKind}`);
  }
  return match[2];
}

function evidenceFile(
  paths: NativeProjectPaths,
  name: string,
  kind: NativeEvidenceKind,
  hash: string,
): string {
  return path.join(nativeChangeDir(paths, name), ...nativeEvidenceRef(kind, hash).split('/'));
}

async function readEvidenceDocument(options: {
  paths: NativeProjectPaths;
  name: string;
  kind: NativeEvidenceKind;
  hash: string;
  hooks?: NativeEvidenceReadHooks;
}): Promise<unknown> {
  const file = evidenceFile(options.paths, options.name, options.kind, options.hash);
  await resolveContainedNativePath(options.paths.nativeRoot, file);
  return readBoundedEvidenceJson(file, nativeChangeDir(options.paths, options.name), options.hooks);
}

async function writeEvidenceDocument(options: {
  paths: NativeProjectPaths;
  name: string;
  kind: NativeEvidenceKind;
  hash: string;
  value: unknown;
}): Promise<string> {
  assertEvidenceDocumentBudget(options.value);
  const file = evidenceFile(options.paths, options.name, options.kind, options.hash);
  await resolveContainedNativePath(options.paths.nativeRoot, file);
  try {
    const existing = await readEvidenceDocument(options);
    if (JSON.stringify(existing) !== JSON.stringify(options.value)) {
      throw new Error(`Native evidence hash collision for ${options.hash}`);
    }
    return nativeEvidenceRef(options.kind, options.hash);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await atomicWriteJson(file, options.value, { containedRoot: options.paths.nativeRoot });
  const persisted = await readEvidenceDocument(options);
  if (JSON.stringify(persisted) !== JSON.stringify(options.value)) {
    throw new Error(`Native evidence changed during commit for ${options.hash}`);
  }
  return nativeEvidenceRef(options.kind, options.hash);
}

function assertEvidenceDocumentBudget(value: unknown): void {
  if (serializedEvidenceBytes(value) > MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES) {
    throw new Error(`Native evidence document exceeds ${MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES} bytes`);
  }
}

function serializedEvidenceBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function parseSnapshot(value: unknown, expectedHash: string): NativeSnapshotProjection {
  return parseNativeSnapshotProjection(value, expectedHash);
}

function parseScope(value: unknown, expectedHash: string): NativeImplementationScope {
  const scope = parseNativeImplementationScope(value);
  if (scope.scopeHash !== expectedHash) {
    throw new Error('Native implementation scope ref/hash mismatch');
  }
  return scope;
}

function parseAllowance(
  value: unknown,
  expectedName: string,
  expectedHash: string,
): NativePartialAllowance {
  const allowance = parseNativePartialAllowance(value);
  if (allowance.change !== expectedName || allowance.allowanceHash !== expectedHash) {
    throw new Error('Native partial allowance ref/hash/change mismatch');
  }
  return allowance;
}

function parseEnvelope(
  value: unknown,
  expectedName: string,
  expectedHash: string,
): NativeVerificationEvidenceEnvelope {
  const evidence = parseNativeVerificationEvidenceEnvelope(value);
  if (evidence.change !== expectedName || evidence.envelopeHash !== expectedHash) {
    throw new Error('Native verification evidence ref/hash/change mismatch');
  }
  return evidence;
}

async function assertEnvelopeDependencies(
  paths: NativeProjectPaths,
  name: string,
  evidence: NativeVerificationEvidenceEnvelope,
  requireReportSnapshot = false,
): Promise<void> {
  const scope = await readNativeImplementationScope(paths, name, evidence.implementationScopeRef);
  if (requireReportSnapshot) {
    await readNativeVerificationReportSnapshot(paths, name, evidence.reportHash);
  }
  if (
    scope.scopeHash !== evidence.implementationScopeHash ||
    scope.contractHash !== evidence.contractHash ||
    (scope.complete ? 'complete' : 'partial') !== evidence.freshness
  ) {
    throw new Error('Native verification evidence does not match its implementation scope');
  }
  if (evidence.partialAllowanceRef === null) return;
  const allowance = await readNativePartialAllowance(paths, name, evidence.partialAllowanceRef);
  if (
    allowance.allowanceHash !== evidence.partialAllowanceHash ||
    allowance.scopeHash !== scope.scopeHash ||
    JSON.stringify(allowance.scopeIds) !==
      JSON.stringify(scope.unresolvedScopes.map((entry) => entry.id).sort()) ||
    allowance.sourceRevision >= evidence.sourceRevision
  ) {
    throw new Error('Native verification evidence does not match its partial allowance');
  }
}

export async function writeNativeImplementationScope(options: {
  paths: NativeProjectPaths;
  name: string;
  bundle: NativeImplementationScopeBundle;
}): Promise<string> {
  const bundle = parseNativeImplementationScopeBundle(options.bundle);
  const { baseline, current, scope } = bundle;
  assertEvidenceDocumentBudget(baseline);
  assertEvidenceDocumentBudget(current);
  assertEvidenceDocumentBudget(scope);
  await writeEvidenceDocument({
    paths: options.paths,
    name: options.name,
    kind: 'snapshots',
    hash: scope.baselineProjectionHash,
    value: baseline,
  });
  await writeEvidenceDocument({
    paths: options.paths,
    name: options.name,
    kind: 'snapshots',
    hash: scope.currentProjectionHash,
    value: current,
  });
  return writeEvidenceDocument({
    paths: options.paths,
    name: options.name,
    kind: 'scopes',
    hash: scope.scopeHash,
    value: scope,
  });
}

export async function readNativeImplementationScopeBundle(
  paths: NativeProjectPaths,
  name: string,
  ref: string,
  hooks?: NativeEvidenceReadHooks,
): Promise<NativeImplementationScopeBundle> {
  const hash = parseEvidenceRef(ref, 'scopes');
  const scope = parseScope(
    await readEvidenceDocument({ paths, name, kind: 'scopes', hash, hooks }),
    hash,
  );
  const baselineHash = parseEvidenceRef(scope.baselineProjectionRef, 'snapshots');
  const currentHash = parseEvidenceRef(scope.currentProjectionRef, 'snapshots');
  const [baseline, current] = await Promise.all([
    readEvidenceDocument({ paths, name, kind: 'snapshots', hash: baselineHash }).then((value) =>
      parseSnapshot(value, baselineHash),
    ),
    readEvidenceDocument({ paths, name, kind: 'snapshots', hash: currentHash }).then((value) =>
      parseSnapshot(value, currentHash),
    ),
  ]);
  return rebuildNativeImplementationScopeBundle({ baseline, current, scope });
}

export async function readNativeImplementationScope(
  paths: NativeProjectPaths,
  name: string,
  ref: string,
  hooks?: NativeEvidenceReadHooks,
): Promise<NativeImplementationScope> {
  return (await readNativeImplementationScopeBundle(paths, name, ref, hooks)).scope;
}

export async function writeNativePartialAllowance(options: {
  paths: NativeProjectPaths;
  name: string;
  allowance: NativePartialAllowance;
}): Promise<string> {
  const allowance = parseAllowance(
    options.allowance,
    options.name,
    options.allowance.allowanceHash,
  );
  const scope = await readNativeImplementationScope(
    options.paths,
    options.name,
    nativeEvidenceRef('scopes', allowance.scopeHash),
  );
  const unresolvedScopeIds = scope.unresolvedScopes.map((entry) => entry.id).sort();
  if (scope.complete || JSON.stringify(unresolvedScopeIds) !== JSON.stringify(allowance.scopeIds)) {
    throw new Error('Native partial allowance does not match a persisted partial scope');
  }
  return writeEvidenceDocument({
    ...options,
    kind: 'allowances',
    hash: allowance.allowanceHash,
    value: allowance,
  });
}

export async function readNativePartialAllowance(
  paths: NativeProjectPaths,
  name: string,
  ref: string,
  hooks?: NativeEvidenceReadHooks,
): Promise<NativePartialAllowance> {
  const hash = parseEvidenceRef(ref, 'allowances');
  return parseAllowance(
    await readEvidenceDocument({ paths, name, kind: 'allowances', hash, hooks }),
    name,
    hash,
  );
}

export async function writeNativeVerificationEvidence(options: {
  paths: NativeProjectPaths;
  name: string;
  evidence: NativeVerificationEvidenceEnvelope;
}): Promise<string> {
  const evidence = parseEnvelope(options.evidence, options.name, options.evidence.envelopeHash);
  await assertEnvelopeDependencies(options.paths, options.name, evidence, true);
  return writeEvidenceDocument({
    ...options,
    kind: 'verifications',
    hash: evidence.envelopeHash,
    value: evidence,
  });
}

export async function readNativeVerificationEvidence(
  paths: NativeProjectPaths,
  name: string,
  ref: string,
  hooks?: NativeEvidenceReadHooks,
): Promise<NativeVerificationEvidenceEnvelope> {
  const hash = parseEvidenceRef(ref, 'verifications');
  const evidence = parseEnvelope(
    await readEvidenceDocument({ paths, name, kind: 'verifications', hash, hooks }),
    name,
    hash,
  );
  await assertEnvelopeDependencies(paths, name, evidence);
  return evidence;
}
