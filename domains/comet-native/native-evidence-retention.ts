import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

import { parseNativeCheckReceipt } from './native-check-receipt-model.js';
import { nativeChangeDir, inspectNativeChange } from './native-change.js';
import { readNativeCheckpointJournal } from './native-checkpoint-storage.js';
import { readProjectConfig } from './native-config.js';
import {
  MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES,
  nativeEvidenceRef,
  nativeReportEvidenceRef,
  type NativeEvidenceKind,
} from './native-evidence-storage.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { isInsidePath, resolveContainedNativePath } from './native-paths.js';
import { inspectPendingNativeSchemaMigration } from './native-schema-migration.js';
import { inspectPendingNativeTransition } from './native-transition-journal.js';
import { readNativeTransaction } from './native-transaction.js';
import { sameNativeFileObject } from './native-file-identity.js';
import type { NativeDoctorFinding, NativeProjectPaths } from './native-types.js';
import {
  parseNativeImplementationScope,
  parseNativeSnapshotProjection,
} from './native-verification-scope.js';
import {
  parseNativePartialAllowance,
  parseNativeVerificationEvidenceEnvelope,
} from './native-verification-evidence.js';

export const NATIVE_EVIDENCE_RETENTION_POLICY = Object.freeze({
  minimumAgeMs: 30 * 24 * 60 * 60 * 1_000,
  keepLatestUnreferencedPerKind: 32,
  maxDocuments: 4_096,
  maxScannedBytes: 256 * 1024 * 1024,
  maxReportedRefs: 8,
  maxReportMessageBytes: 4_096,
} as const);

const MAX_NATIVE_CHECK_RECEIPT_BYTES = 512 * 1024;
const HASH_FILE_PATTERN = /^([a-f0-9]{64})\.json$/u;
const CLEANUP_QUARANTINE_PATTERN =
  /^\.([a-f0-9]{64}\.json)\.([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.gc$/u;
const MANAGED_REF_PATTERN =
  /^runtime\/evidence\/(snapshots|scopes|allowances|verifications|reports|check-receipts)\/[a-f0-9]{64}\.json$/u;
const MANAGED_KINDS = [
  'snapshots',
  'scopes',
  'allowances',
  'verifications',
  'reports',
  'check-receipts',
] as const;

type NativeManagedEvidenceKind = (typeof MANAGED_KINDS)[number];

interface NativeFileIdentity {
  dev: number;
  ino: number;
  birthtimeMs: number;
  ctimeMs: number;
  mtimeMs: number;
  size: number;
}

interface NativeDirectoryIdentity extends NativeFileIdentity {
  path: string;
  realPath: string;
}

interface NativeEvidenceDocument {
  ref: string;
  kind: NativeManagedEvidenceKind;
  change: string;
  changeRoot: string;
  file: string;
  size: number;
  mtimeMs: number;
  identity: NativeFileIdentity;
  directoryChain: NativeDirectoryIdentity[];
  dependencies: string[];
}

export interface NativeEvidenceRetentionHooks {
  beforeDelete?: (candidate: { ref: string; file: string }) => void | Promise<void>;
  afterRecoveryLink?: (recovery: {
    ref: string;
    original: string;
    quarantine: string;
  }) => void | Promise<void>;
}

export interface NativeEvidenceRetentionOptions {
  paths: NativeProjectPaths;
  name?: string;
  repair?: boolean;
  now?: Date;
  /** Archive/root-move recovery can relocate a whole change, so all collection is deferred. */
  deferAll?: boolean;
  hooks?: NativeEvidenceRetentionHooks;
}

interface NativeEvidenceRetentionPlan {
  candidates: NativeEvidenceDocument[];
  candidateBytes: number;
}

interface NativeCleanupRecoveryResult {
  findings: NativeDoctorFinding[];
  pending: boolean;
}

function sameObjectIdentity(
  left: NativeFileIdentity,
  right: Pick<import('node:fs').Stats, keyof NativeFileIdentity>,
): boolean {
  return sameNativeFileObject(
    { ...left, birthtime: left.birthtimeMs },
    {
      ...right,
      birthtime: right.birthtimeMs,
    },
  );
}

function sameIdentity(
  left: NativeFileIdentity,
  right: Pick<import('node:fs').Stats, keyof NativeFileIdentity>,
): boolean {
  return (
    sameObjectIdentity(left, right) &&
    left.birthtimeMs === right.birthtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size
  );
}

function sameContentVersionAfterLinkOrRename(
  left: NativeFileIdentity,
  right: Pick<import('node:fs').Stats, keyof NativeFileIdentity>,
): boolean {
  return (
    sameObjectIdentity(left, right) &&
    left.birthtimeMs === right.birthtimeMs &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size
  );
}

function fileIdentity(stat: import('node:fs').Stats): NativeFileIdentity {
  return {
    dev: stat.dev,
    ino: stat.ino,
    birthtimeMs: stat.birthtimeMs,
    ctimeMs: stat.ctimeMs,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function portableProjectRef(paths: NativeProjectPaths, target: string): string {
  const relative = path.relative(paths.projectRoot, target);
  if (
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error('Native evidence retention finding path is outside the project');
  }
  return relative.split(path.sep).join('/');
}

function evidenceRootPath(paths: NativeProjectPaths, name: string): string {
  return path.join(nativeChangeDir(paths, name), 'runtime', 'evidence');
}

function evidenceRootRef(paths: NativeProjectPaths, name: string): string {
  return portableProjectRef(paths, evidenceRootPath(paths, name));
}

async function captureDirectoryChain(
  managedRoot: string,
  directory: string,
): Promise<NativeDirectoryIdentity[]> {
  const root = path.resolve(managedRoot);
  const target = path.resolve(directory);
  if (!isInsidePath(root, target)) {
    throw new Error('Native evidence retention path escapes its managed change');
  }
  const segments = path.relative(root, target).split(path.sep).filter(Boolean);
  const chain: NativeDirectoryIdentity[] = [];
  let cursor = root;
  for (const segment of ['', ...segments]) {
    if (segment) cursor = path.join(cursor, segment);
    const stat = await fs.lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Native evidence retention parent must be a real directory: ${cursor}`);
    }
    const realPath = await fs.realpath(cursor);
    if (chain.length > 0 && !isInsidePath(chain[0].realPath, realPath)) {
      throw new Error(`Native evidence retention parent resolves outside its change: ${cursor}`);
    }
    chain.push({ path: cursor, realPath, ...fileIdentity(stat) });
  }
  return chain;
}

async function verifyDirectoryChain(chain: readonly NativeDirectoryIdentity[]): Promise<void> {
  for (const identity of chain) {
    const stat = await fs.lstat(identity.path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !sameObjectIdentity(identity, stat) ||
      (await fs.realpath(identity.path)) !== identity.realPath
    ) {
      throw new Error(`Native evidence retention parent changed: ${identity.path}`);
    }
  }
}

function refForKind(kind: NativeManagedEvidenceKind, hash: string): string {
  return kind === 'check-receipts'
    ? `runtime/evidence/check-receipts/${hash}.json`
    : nativeEvidenceRef(kind as NativeEvidenceKind, hash);
}

function managedDependency(value: string | null): string[] {
  return value !== null && MANAGED_REF_PATTERN.test(value) ? [value] : [];
}

function parseDocument(
  kind: NativeManagedEvidenceKind,
  hash: string,
  value: unknown,
  expectedChange: string,
): { canonical: unknown; dependencies: string[] } {
  if (kind === 'snapshots') {
    return {
      canonical: parseNativeSnapshotProjection(value, hash),
      dependencies: [],
    };
  }
  if (kind === 'scopes') {
    const scope = parseNativeImplementationScope(value);
    if (scope.scopeHash !== hash) throw new Error('Native scope filename does not match its hash');
    return {
      canonical: scope,
      dependencies: [scope.baselineProjectionRef, scope.currentProjectionRef],
    };
  }
  if (kind === 'allowances') {
    const allowance = parseNativePartialAllowance(value);
    if (allowance.change !== expectedChange || allowance.allowanceHash !== hash) {
      throw new Error('Native allowance filename/change does not match its content');
    }
    return {
      canonical: allowance,
      dependencies: [nativeEvidenceRef('scopes', allowance.scopeHash)],
    };
  }
  if (kind === 'verifications') {
    const evidence = parseNativeVerificationEvidenceEnvelope(value);
    if (evidence.change !== expectedChange || evidence.envelopeHash !== hash) {
      throw new Error('Native verification filename/change does not match its content');
    }
    const traceDependencies = evidence.acceptanceTrace.entries.flatMap((entry) =>
      entry.evidenceRefs.flatMap(managedDependency),
    );
    return {
      canonical: evidence,
      dependencies: [
        evidence.implementationScopeRef,
        nativeReportEvidenceRef(evidence.reportHash),
        ...managedDependency(evidence.partialAllowanceRef),
        ...managedDependency(evidence.receiptRef),
        ...traceDependencies,
      ],
    };
  }
  if (kind === 'reports') {
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
      throw new Error('Native report evidence filename/hash does not match its content');
    }
    return { canonical: report, dependencies: [] };
  }
  const receipt = parseNativeCheckReceipt(value);
  if (receipt.change !== expectedChange || receipt.receiptHash !== hash) {
    throw new Error('Native check receipt filename/change does not match its content');
  }
  return { canonical: receipt, dependencies: [] };
}

async function readCanonicalDocument(options: {
  changeRoot: string;
  file: string;
  ref: string;
  kind: NativeManagedEvidenceKind;
  hash: string;
  name: string;
  directoryChain: NativeDirectoryIdentity[];
}): Promise<NativeEvidenceDocument> {
  const before = await fs.lstat(options.file);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`Native evidence entry is not a regular file: ${options.ref}`);
  }
  const maximumBytes =
    options.kind === 'check-receipts'
      ? MAX_NATIVE_CHECK_RECEIPT_BYTES
      : MAX_NATIVE_EVIDENCE_DOCUMENT_BYTES;
  if (before.size > maximumBytes) {
    throw new Error(`Native evidence entry exceeds its byte budget: ${options.ref}`);
  }
  const beforeRealPath = await fs.realpath(options.file);
  if (!isInsidePath(options.directoryChain[0].realPath, beforeRealPath)) {
    throw new Error(`Native evidence entry resolves outside its change: ${options.ref}`);
  }
  const openFlags =
    process.platform === 'win32'
      ? 'r'
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
  const handle = await fs.open(options.file, openFlags).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ELOOP' || error.code === 'ENXIO') {
      throw new Error(`Native evidence entry became unsafe while opening: ${options.ref}`);
    }
    throw error;
  });
  try {
    const [opened, pathAfterOpen, realPathAfterOpen] = await Promise.all([
      handle.stat(),
      fs.lstat(options.file),
      fs.realpath(options.file),
    ]);
    await verifyDirectoryChain(options.directoryChain);
    if (
      !opened.isFile() ||
      !pathAfterOpen.isFile() ||
      pathAfterOpen.isSymbolicLink() ||
      realPathAfterOpen !== beforeRealPath ||
      !sameIdentity(fileIdentity(before), opened) ||
      !sameIdentity(fileIdentity(opened), pathAfterOpen)
    ) {
      throw new Error(`Native evidence entry changed while opening: ${options.ref}`);
    }
    const chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    while (true) {
      const remaining = maximumBytes + 1 - total;
      const read = await handle.read(buffer, 0, Math.min(buffer.length, remaining), null);
      if (read.bytesRead === 0) break;
      total += read.bytesRead;
      if (total > maximumBytes) {
        throw new Error(`Native evidence entry exceeds its byte budget: ${options.ref}`);
      }
      chunks.push(Buffer.from(buffer.subarray(0, read.bytesRead)));
    }
    const [afterHandle, afterPath, afterRealPath] = await Promise.all([
      handle.stat(),
      fs.lstat(options.file),
      fs.realpath(options.file),
    ]);
    await verifyDirectoryChain(options.directoryChain);
    if (
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      afterRealPath !== beforeRealPath ||
      !sameIdentity(fileIdentity(opened), afterHandle) ||
      !sameIdentity(fileIdentity(opened), afterPath)
    ) {
      throw new Error(`Native evidence entry changed while reading: ${options.ref}`);
    }
    const text = Buffer.concat(chunks, total).toString('utf8');
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch (error) {
      throw new Error(`Native evidence entry is not valid JSON: ${options.ref}`, {
        cause: error,
      });
    }
    const parsed = parseDocument(options.kind, options.hash, json, options.name);
    if (text !== JSON.stringify(parsed.canonical, null, 2) + '\n') {
      throw new Error(`Native evidence entry is not canonically serialized: ${options.ref}`);
    }
    return {
      ref: options.ref,
      kind: options.kind,
      change: options.name,
      changeRoot: options.changeRoot,
      file: options.file,
      size: total,
      mtimeMs: afterHandle.mtimeMs,
      identity: fileIdentity(afterHandle),
      directoryChain: options.directoryChain,
      dependencies: [...new Set(parsed.dependencies)].sort(compareText),
    };
  } finally {
    await handle.close();
  }
}

async function pathIsMissing(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

async function inspectCleanupQuarantines(options: {
  paths: NativeProjectPaths;
  name: string;
  repair: boolean;
  hooks: NativeEvidenceRetentionHooks;
}): Promise<NativeCleanupRecoveryResult> {
  const changeRoot = nativeChangeDir(options.paths, options.name);
  const evidenceRoot = evidenceRootPath(options.paths, options.name);
  await resolveContainedNativePath(options.paths.nativeRoot, evidenceRoot);
  let rootEntries;
  try {
    const rootChain = await captureDirectoryChain(changeRoot, evidenceRoot);
    rootEntries = await fs.readdir(evidenceRoot, { withFileTypes: true });
    await verifyDirectoryChain(rootChain);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { findings: [], pending: false };
    }
    throw error;
  }

  const recoveries: Array<{
    ref: string;
    original: string;
    quarantine: string;
    document: NativeEvidenceDocument;
    action: 'restore-original' | 'finish-linked-recovery';
    originalDocument: NativeEvidenceDocument | null;
  }> = [];
  for (const kind of MANAGED_KINDS) {
    if (!rootEntries.some((entry) => entry.name === kind)) continue;
    const directory = path.join(evidenceRoot, kind);
    const directoryChain = await captureDirectoryChain(changeRoot, directory);
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) =>
      compareText(left.name, right.name),
    );
    const byOriginal = new Map<string, (typeof entries)[number][]>();
    for (const entry of entries) {
      const match = CLEANUP_QUARANTINE_PATTERN.exec(entry.name);
      if (!match) continue;
      const grouped = byOriginal.get(match[1]) ?? [];
      grouped.push(entry);
      byOriginal.set(match[1], grouped);
    }
    for (const [originalName, entriesForOriginal] of [...byOriginal.entries()].sort(
      ([left], [right]) => compareText(left, right),
    )) {
      if (entriesForOriginal.length !== 1) {
        throw new Error(
          `Native evidence cleanup has multiple quarantines for ${kind}/${originalName}`,
        );
      }
      const entry = entriesForOriginal[0];
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error(
          `Native evidence cleanup quarantine is not a regular file: ${kind}/${entry.name}`,
        );
      }
      const original = path.join(directory, originalName);
      const hash = HASH_FILE_PATTERN.exec(originalName)?.[1];
      if (!hash)
        throw new Error(`Native evidence cleanup quarantine name is invalid: ${entry.name}`);
      const ref = refForKind(kind, hash);
      const quarantine = path.join(directory, entry.name);
      const document = await readCanonicalDocument({
        changeRoot,
        file: quarantine,
        ref,
        kind,
        hash,
        name: options.name,
        directoryChain,
      });
      const originalMissing = await pathIsMissing(original);
      const originalDocument = originalMissing
        ? null
        : await readCanonicalDocument({
            changeRoot,
            file: original,
            ref,
            kind,
            hash,
            name: options.name,
            directoryChain,
          });
      recoveries.push({
        ref,
        original,
        quarantine,
        document,
        action: originalMissing ? 'restore-original' : 'finish-linked-recovery',
        originalDocument,
      });
    }
  }
  if (recoveries.length === 0) return { findings: [], pending: false };
  const refs = recoveries.map((recovery) => recovery.ref).sort(compareText);
  if (!options.repair) {
    return {
      pending: true,
      findings: [
        {
          severity: 'warning',
          code: 'evidence-retention-recovery-required',
          message: boundedMessage(
            `Native evidence cleanup has ${refs.length} safely recoverable quarantined document(s) for ${options.name}: ${boundedRefs(refs)}`,
          ),
          path: evidenceRootRef(options.paths, options.name),
        },
      ],
    };
  }
  for (const recovery of recoveries.sort((left, right) => compareText(left.ref, right.ref))) {
    await verifyDirectoryChain(recovery.document.directoryChain);
    if (recovery.action === 'finish-linked-recovery') {
      const original = await readCanonicalDocument({
        changeRoot,
        file: recovery.original,
        ref: recovery.ref,
        kind: recovery.document.kind,
        hash: HASH_FILE_PATTERN.exec(path.basename(recovery.original))![1],
        name: options.name,
        directoryChain: recovery.document.directoryChain,
      });
      const quarantine = await readCanonicalDocument({
        changeRoot,
        file: recovery.quarantine,
        ref: recovery.ref,
        kind: recovery.document.kind,
        hash: HASH_FILE_PATTERN.exec(path.basename(recovery.original))![1],
        name: options.name,
        directoryChain: recovery.document.directoryChain,
      });
      if (
        !recovery.originalDocument ||
        !sameIdentity(recovery.originalDocument.identity, original.identity) ||
        !sameIdentity(recovery.document.identity, quarantine.identity)
      ) {
        throw new Error(
          `Native evidence cleanup original or quarantine changed during recovery: ${recovery.ref}`,
        );
      }
      await fs.rm(recovery.quarantine);
      await verifyDirectoryChain(recovery.document.directoryChain);
      continue;
    }
    if (!(await pathIsMissing(recovery.original))) {
      throw new Error(`Native evidence cleanup original appeared during recovery: ${recovery.ref}`);
    }
    const quarantineStat = await fs.lstat(recovery.quarantine);
    if (
      !quarantineStat.isFile() ||
      quarantineStat.isSymbolicLink() ||
      !sameIdentity(recovery.document.identity, quarantineStat)
    ) {
      throw new Error(
        `Native evidence cleanup quarantine changed during recovery: ${recovery.ref}`,
      );
    }
    // A hard link provides portable no-overwrite placement: EEXIST is fail-closed instead of
    // replacing a concurrently created original as rename() would on POSIX.
    await fs.link(recovery.quarantine, recovery.original);
    await options.hooks.afterRecoveryLink?.({
      ref: recovery.ref,
      original: recovery.original,
      quarantine: recovery.quarantine,
    });
    const restored = await readCanonicalDocument({
      changeRoot,
      file: recovery.original,
      ref: recovery.ref,
      kind: recovery.document.kind,
      hash: HASH_FILE_PATTERN.exec(path.basename(recovery.original))![1],
      name: options.name,
      directoryChain: recovery.document.directoryChain,
    });
    const linkedQuarantine = await readCanonicalDocument({
      changeRoot,
      file: recovery.quarantine,
      ref: recovery.ref,
      kind: recovery.document.kind,
      hash: HASH_FILE_PATTERN.exec(path.basename(recovery.original))![1],
      name: options.name,
      directoryChain: recovery.document.directoryChain,
    });
    if (
      !sameContentVersionAfterLinkOrRename(recovery.document.identity, restored.identity) ||
      !sameIdentity(restored.identity, linkedQuarantine.identity)
    ) {
      throw new Error(`Native evidence cleanup recovery identity changed: ${recovery.ref}`);
    }
    await fs.rm(recovery.quarantine);
    await verifyDirectoryChain(recovery.document.directoryChain);
  }
  return {
    pending: false,
    findings: [
      {
        severity: 'info',
        code: 'evidence-retention-cleanup-recovered',
        message: boundedMessage(
          `Recovered ${refs.length} interrupted Native evidence cleanup document(s) for ${options.name}: ${boundedRefs(refs)}`,
        ),
        path: evidenceRootRef(options.paths, options.name),
      },
    ],
  };
}

async function scanEvidenceStore(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeEvidenceDocument[]> {
  const changeRoot = nativeChangeDir(paths, name);
  const evidenceRoot = path.join(changeRoot, 'runtime', 'evidence');
  await resolveContainedNativePath(paths.nativeRoot, evidenceRoot);
  let rootEntries;
  try {
    const rootChain = await captureDirectoryChain(changeRoot, evidenceRoot);
    rootEntries = await fs.readdir(evidenceRoot, { withFileTypes: true });
    await verifyDirectoryChain(rootChain);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const unknownRootEntries = rootEntries
    .filter(
      (entry) =>
        !MANAGED_KINDS.includes(entry.name as NativeManagedEvidenceKind) ||
        !entry.isDirectory() ||
        entry.isSymbolicLink(),
    )
    .map((entry) => entry.name)
    .sort(compareText);
  if (unknownRootEntries.length > 0) {
    throw new Error(
      `Native evidence root has unknown or special entries: ${boundedRefs(unknownRootEntries)}`,
    );
  }

  const documents: NativeEvidenceDocument[] = [];
  let scannedBytes = 0;
  for (const kind of MANAGED_KINDS) {
    if (!rootEntries.some((entry) => entry.name === kind)) continue;
    const directory = path.join(evidenceRoot, kind);
    const directoryChain = await captureDirectoryChain(changeRoot, directory);
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) =>
      compareText(left.name, right.name),
    );
    await verifyDirectoryChain(directoryChain);
    for (const entry of entries) {
      if (documents.length >= NATIVE_EVIDENCE_RETENTION_POLICY.maxDocuments) {
        throw new Error(
          `Native evidence store exceeds ${NATIVE_EVIDENCE_RETENTION_POLICY.maxDocuments} documents`,
        );
      }
      const match = HASH_FILE_PATTERN.exec(entry.name);
      if (!match || !entry.isFile() || entry.isSymbolicLink()) {
        throw new Error(
          `Native evidence kind ${kind} has an unknown or special entry: ${entry.name}`,
        );
      }
      const ref = refForKind(kind, match[1]);
      const file = path.join(directory, entry.name);
      await resolveContainedNativePath(paths.nativeRoot, file);
      const document = await readCanonicalDocument({
        changeRoot,
        file,
        ref,
        kind,
        hash: match[1],
        name,
        directoryChain,
      });
      scannedBytes += document.size;
      if (scannedBytes > NATIVE_EVIDENCE_RETENTION_POLICY.maxScannedBytes) {
        throw new Error(
          `Native evidence store exceeds ${NATIVE_EVIDENCE_RETENTION_POLICY.maxScannedBytes} scanned bytes`,
        );
      }
      documents.push(document);
    }
    await verifyDirectoryChain(directoryChain);
  }
  return documents;
}

function closeDependencies(
  seeds: Iterable<string>,
  documents: ReadonlyMap<string, NativeEvidenceDocument>,
): Set<string> {
  const retained = new Set<string>();
  const pending = [...seeds].sort(compareText).reverse();
  while (pending.length > 0) {
    const ref = pending.pop()!;
    if (retained.has(ref)) continue;
    const document = documents.get(ref);
    if (!document) throw new Error(`Native evidence dependency is missing: ${ref}`);
    retained.add(ref);
    for (const dependency of [...document.dependencies].sort(compareText).reverse()) {
      if (!retained.has(dependency)) pending.push(dependency);
    }
  }
  return retained;
}

function dependentsBeforeDependencies(
  candidates: NativeEvidenceDocument[],
): NativeEvidenceDocument[] {
  const byRef = new Map(candidates.map((candidate) => [candidate.ref, candidate]));
  const dependencyCounts = new Map(candidates.map((candidate) => [candidate.ref, 0]));
  for (const candidate of candidates) {
    for (const dependency of candidate.dependencies) {
      if (byRef.has(dependency)) {
        dependencyCounts.set(dependency, (dependencyCounts.get(dependency) ?? 0) + 1);
      }
    }
  }
  const ready = [...dependencyCounts]
    .filter(([, count]) => count === 0)
    .map(([ref]) => ref)
    .sort(compareText);
  const ordered: NativeEvidenceDocument[] = [];
  while (ready.length > 0) {
    const ref = ready.shift()!;
    const candidate = byRef.get(ref)!;
    ordered.push(candidate);
    for (const dependency of candidate.dependencies) {
      const count = dependencyCounts.get(dependency);
      if (count === undefined) continue;
      const next = count - 1;
      dependencyCounts.set(dependency, next);
      if (next === 0) {
        ready.push(dependency);
        ready.sort(compareText);
      }
    }
  }
  if (ordered.length !== candidates.length) {
    throw new Error('Native evidence candidate dependency graph contains a cycle');
  }
  return ordered;
}

function planRetention(
  documents: NativeEvidenceDocument[],
  rootRefs: readonly string[],
  nowMs: number,
): NativeEvidenceRetentionPlan {
  const byRef = new Map(documents.map((document) => [document.ref, document]));
  if (byRef.size !== documents.length) throw new Error('Native evidence store has duplicate refs');
  // A damaged orphan is not safe to reason about either: every managed dependency must exist.
  for (const document of documents) {
    for (const dependency of document.dependencies) {
      if (!byRef.has(dependency)) {
        throw new Error(`Native evidence dependency is missing: ${dependency}`);
      }
    }
  }
  const rootClosure = closeDependencies(rootRefs, byRef);
  const retainedSeeds = new Set(rootClosure);
  for (const document of documents) {
    if (nowMs - document.mtimeMs < NATIVE_EVIDENCE_RETENTION_POLICY.minimumAgeMs) {
      retainedSeeds.add(document.ref);
    }
  }
  for (const kind of MANAGED_KINDS) {
    const newestUnreferenced = documents
      .filter((document) => document.kind === kind && !rootClosure.has(document.ref))
      .sort((left, right) => right.mtimeMs - left.mtimeMs || compareText(left.ref, right.ref))
      .slice(0, NATIVE_EVIDENCE_RETENTION_POLICY.keepLatestUnreferencedPerKind);
    for (const document of newestUnreferenced) retainedSeeds.add(document.ref);
  }
  const retained = closeDependencies(retainedSeeds, byRef);
  const candidates = documents
    .filter(
      (document) =>
        !retained.has(document.ref) &&
        nowMs - document.mtimeMs >= NATIVE_EVIDENCE_RETENTION_POLICY.minimumAgeMs,
    )
    .sort((left, right) => compareText(left.ref, right.ref));
  return {
    candidates: dependentsBeforeDependencies(candidates),
    candidateBytes: candidates.reduce((total, candidate) => total + candidate.size, 0),
  };
}

function boundedRefs(refs: readonly string[]): string {
  const shown = refs.slice(0, NATIVE_EVIDENCE_RETENTION_POLICY.maxReportedRefs);
  const omitted = refs.length - shown.length;
  return `${shown.join(', ')}${omitted > 0 ? `, ... (${omitted} more)` : ''}`;
}

function boundedMessage(message: string): string {
  const maximum = NATIVE_EVIDENCE_RETENTION_POLICY.maxReportMessageBytes;
  if (Buffer.byteLength(message, 'utf8') <= maximum) return message;
  let result = message;
  while (result.length > 0 && Buffer.byteLength(`${result}...`, 'utf8') > maximum) {
    result = result.slice(0, -1);
  }
  return `${result}...`;
}

function summaryFinding(
  name: string,
  plan: NativeEvidenceRetentionPlan,
  repaired: boolean,
  evidenceRoot: string,
): NativeDoctorFinding {
  const refs = plan.candidates.map((candidate) => candidate.ref).sort(compareText);
  return {
    severity: 'info',
    code: repaired ? 'evidence-retention-cleaned' : 'evidence-retention-candidates',
    message: boundedMessage(
      `${repaired ? 'Removed' : 'Found'} ${plan.candidates.length} old unreferenced Native evidence document(s) (${plan.candidateBytes} bytes) for ${name}: ${boundedRefs(refs)}`,
    ),
    path: evidenceRoot,
  };
}

async function restoreQuarantineIfSafe(quarantine: string, original: string): Promise<void> {
  try {
    await fs.lstat(original);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
  }
  try {
    await fs.rename(quarantine, original);
  } catch {
    // Leave the uniquely named file in the already-validated managed directory. Never delete it.
  }
}

async function deleteCandidate(
  candidate: NativeEvidenceDocument,
  hooks: NativeEvidenceRetentionHooks,
): Promise<void> {
  await hooks.beforeDelete?.({ ref: candidate.ref, file: candidate.file });
  await verifyDirectoryChain(candidate.directoryChain);
  const beforeDocument = await readCanonicalDocument({
    changeRoot: candidate.changeRoot,
    file: candidate.file,
    ref: candidate.ref,
    kind: candidate.kind,
    hash: HASH_FILE_PATTERN.exec(path.basename(candidate.file))![1],
    name: candidate.change,
    directoryChain: candidate.directoryChain,
  });
  const before = await fs.lstat(candidate.file);
  const beforeRealPath = await fs.realpath(candidate.file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    !sameIdentity(candidate.identity, before) ||
    !sameIdentity(candidate.identity, beforeDocument.identity) ||
    !isInsidePath(candidate.directoryChain[0].realPath, beforeRealPath)
  ) {
    throw new Error(`Native evidence candidate changed before cleanup: ${candidate.ref}`);
  }
  const quarantine = path.join(
    path.dirname(candidate.file),
    `.${path.basename(candidate.file)}.${randomUUID()}.gc`,
  );
  await fs.rename(candidate.file, quarantine);
  try {
    const [moved, movedRealPath] = await Promise.all([
      fs.lstat(quarantine),
      fs.realpath(quarantine),
    ]);
    await verifyDirectoryChain(candidate.directoryChain);
    if (
      !moved.isFile() ||
      moved.isSymbolicLink() ||
      !sameContentVersionAfterLinkOrRename(candidate.identity, moved) ||
      !isInsidePath(candidate.directoryChain[0].realPath, movedRealPath)
    ) {
      await restoreQuarantineIfSafe(quarantine, candidate.file);
      throw new Error(`Native evidence candidate changed during cleanup: ${candidate.ref}`);
    }
    await fs.rm(quarantine);
    await verifyDirectoryChain(candidate.directoryChain);
  } catch (error) {
    await restoreQuarantineIfSafe(quarantine, candidate.file);
    throw error;
  }
}

async function hasPendingRelocationOrArchive(paths: NativeProjectPaths): Promise<boolean> {
  const config = await readProjectConfig(paths.projectRoot);
  if (config?.native.pending_root_move) return true;
  let entries;
  try {
    entries = await fs.readdir(paths.transactionsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) return true;
    try {
      const transaction = await readNativeTransaction(paths, entry.name);
      if (transaction.status !== 'committed' && transaction.status !== 'rolled-back') return true;
    } catch {
      return true;
    }
  }
  return false;
}

async function changeNames(paths: NativeProjectPaths, requested?: string): Promise<string[]> {
  if (requested) return [requested];
  let entries;
  try {
    entries = await fs.readdir(paths.changesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort(compareText);
}

async function retentionDeferred(paths: NativeProjectPaths, name: string): Promise<boolean> {
  const inspection = await inspectNativeChange(paths, name);
  if (inspection.status !== 'current' || !inspection.state || inspection.state.archived)
    return true;
  const [transition, migration, checkpoint] = await Promise.all([
    inspectPendingNativeTransition(paths, name),
    inspectPendingNativeSchemaMigration(paths, name),
    readNativeCheckpointJournal(paths, name),
  ]);
  return transition !== null || migration !== null || checkpoint !== null;
}

async function collectChangeRetention(options: {
  paths: NativeProjectPaths;
  name: string;
  repair: boolean;
  nowMs: number;
  hooks: NativeEvidenceRetentionHooks;
}): Promise<NativeDoctorFinding[]> {
  if (await retentionDeferred(options.paths, options.name)) return [];
  const inspection = await inspectNativeChange(options.paths, options.name);
  if (inspection.status !== 'current' || !inspection.state) return [];
  if (!('implementation_scope' in inspection.state)) return [];
  const cleanupRecovery = await inspectCleanupQuarantines({
    paths: options.paths,
    name: options.name,
    repair: options.repair,
    hooks: options.hooks,
  });
  if (cleanupRecovery.pending) return cleanupRecovery.findings;
  const rootRefs: string[] = [];
  for (const value of [
    inspection.state.implementation_scope,
    inspection.state.partial_allowance,
    inspection.state.verification_evidence,
  ]) {
    if (value !== null) rootRefs.push(value);
  }
  const documents = await scanEvidenceStore(options.paths, options.name);
  const plan = planRetention(documents, rootRefs, options.nowMs);
  if (plan.candidates.length === 0) return cleanupRecovery.findings;
  const evidenceRef = evidenceRootRef(options.paths, options.name);
  if (!options.repair) {
    return [...cleanupRecovery.findings, summaryFinding(options.name, plan, false, evidenceRef)];
  }
  const deleted: NativeEvidenceDocument[] = [];
  for (const candidate of plan.candidates) {
    try {
      await deleteCandidate(candidate, options.hooks);
      deleted.push(candidate);
    } catch (error) {
      const deletedBytes = deleted.reduce((total, item) => total + item.size, 0);
      return [
        ...cleanupRecovery.findings,
        ...(deleted.length > 0
          ? [
              summaryFinding(
                options.name,
                { candidates: deleted, candidateBytes: deletedBytes },
                true,
                evidenceRef,
              ),
            ]
          : []),
        {
          severity: 'error',
          code: 'evidence-retention-cleanup-failed',
          message: boundedMessage(
            `Native evidence cleanup stopped safely for ${options.name}: ${(error as Error).message}`,
          ),
          path: evidenceRef,
        },
      ];
    }
  }
  return [...cleanupRecovery.findings, summaryFinding(options.name, plan, true, evidenceRef)];
}

/**
 * Inspect or explicitly prune old unreferenced Native-owned evidence.
 *
 * The default path is read-only. Repair repeats the complete scan and plan while holding the
 * project mutation lock, then deletes only documents whose identities remain unchanged.
 */
export async function inspectNativeEvidenceRetention(
  options: NativeEvidenceRetentionOptions,
): Promise<NativeDoctorFinding[]> {
  if (options.deferAll || (await hasPendingRelocationOrArchive(options.paths))) return [];
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Native evidence retention time is invalid');
  const run = async (repair: boolean): Promise<NativeDoctorFinding[]> => {
    const findings: NativeDoctorFinding[] = [];
    for (const name of await changeNames(options.paths, options.name)) {
      try {
        findings.push(
          ...(await collectChangeRetention({
            paths: options.paths,
            name,
            repair,
            nowMs: now.getTime(),
            hooks: options.hooks ?? {},
          })),
        );
      } catch (error) {
        findings.push({
          severity: 'error',
          code: 'evidence-retention-unsafe',
          message: boundedMessage(
            `Native evidence retention refused to clean ${name}: ${(error as Error).message}`,
          ),
          path: evidenceRootRef(options.paths, name),
        });
      }
    }
    return findings;
  };
  if (!(options.repair ?? false)) return run(false);
  // Avoid acquiring a mutation lock when there is nothing to prune. This also lets doctor
  // diagnose and clear unrelated proven-stale locks without retention changing that flow.
  const preflight = await run(false);
  if (preflight.some((finding) => finding.severity === 'error')) return preflight;
  if (
    !preflight.some(
      (finding) =>
        finding.code === 'evidence-retention-candidates' ||
        finding.code === 'evidence-retention-recovery-required',
    )
  ) {
    return preflight;
  }
  try {
    return await withNativeMutationLock(options.paths, 'prune Native evidence', () => run(true));
  } catch (error) {
    return [
      {
        severity: 'info',
        code: 'evidence-retention-cleanup-deferred',
        message: boundedMessage(
          `Native evidence cleanup was deferred until the project mutation lock is available: ${(error as Error).message}`,
        ),
      },
    ];
  }
}
