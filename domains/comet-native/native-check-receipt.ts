import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import { nativeChangeDir } from './native-change.js';
import {
  buildNativeCheckReceipt,
  NATIVE_CHECK_LIMITS,
  parseNativeCheckReceipt,
  type NativeCheckIssue,
  type NativeCheckIssueKind,
  type NativeCheckReceipt,
  type NativeCheckReceiptStaleReason,
} from './native-check-receipt-model.js';
import { writeNativeCheckReceipt } from './native-check-receipt-storage.js';
import { collectNativeContractFiles } from './native-contract-files.js';
import { readNativeImplementationScopeBundle } from './native-evidence-storage.js';
import { isInsidePath } from './native-paths.js';
import { createNativeContentSnapshot } from './native-snapshot.js';
import type {
  NativeChangeState,
  NativeContentSnapshotManifest,
  NativeProjectPaths,
} from './native-types.js';
import {
  buildNativeImplementationScopeBundle,
  type NativeImplementationFileIdentity,
  type NativeImplementationScopeBundle,
  type NativeSnapshotProjection,
} from './native-verification-scope.js';

export {
  NATIVE_CHECK_LIMITS,
  NATIVE_CHECK_POLICY,
  NATIVE_CHECK_POLICY_VERSION,
  NATIVE_CHECK_RECEIPT_SCHEMA,
  NATIVE_CHECKER_HASH,
  parseNativeCheckReceipt,
  type NativeCheckIssue,
  type NativeCheckIssueKind,
  type NativeCheckReceipt,
  type NativeCheckReceiptStaleReason,
} from './native-check-receipt-model.js';

interface BoundFacts {
  contractHash: string;
  snapshotHash: string;
}

interface ScopedFile {
  path: string;
  expected: NativeImplementationFileIdentity;
}

interface DirectoryIdentity {
  path: string;
  realPath: string;
  dev: number;
  ino: number;
  birthtimeMs: number;
  ctimeMs: number;
}

interface ScannedFile {
  bytes: number;
  text: string | null;
}

const ISSUE_KIND_RANK: Record<NativeCheckIssueKind, number> = {
  'conflict-marker': 0,
  'trailing-whitespace': 1,
  'space-before-tab': 2,
  'scope-mismatch': 3,
  'unsafe-file': 4,
  'scan-limit': 5,
};

class ScopedFileError extends Error {
  constructor(
    readonly kind: 'scope-mismatch' | 'unsafe-file',
    message: string,
  ) {
    super(message);
  }
}

export interface ExecutedNativeCheckReceipt {
  receipt: NativeCheckReceipt;
  ref: string;
}

function projectionManifest(projection: NativeSnapshotProjection): NativeContentSnapshotManifest {
  return {
    schema: 'comet.native.content-snapshot.v1',
    origin: projection.origin,
    ...(projection.capture ? { capture: projection.capture } : {}),
    createdAt: '1970-01-01T00:00:00.000Z',
    complete: projection.complete,
    limits: projection.limits,
    entries: projection.entries,
    omitted: projection.omitted,
    omittedCount: projection.omittedCount,
    ...(projection.omissionOverflow ? { omissionOverflow: projection.omissionOverflow } : {}),
  };
}

async function collectBoundFacts(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  scope: NativeImplementationScopeBundle;
}): Promise<BoundFacts> {
  const [contract, snapshot] = await Promise.all([
    collectNativeContractFiles({
      changeDir: nativeChangeDir(options.paths, options.state.name),
      briefRef: options.state.brief,
      specChanges: options.state.spec_changes,
    }),
    createNativeContentSnapshot(options.paths, { origin: 'explicit' }),
  ]);
  const currentBundle = buildNativeImplementationScopeBundle({
    baseline: projectionManifest(options.scope.baseline),
    current: snapshot,
    contractHash: options.scope.authority.contractHash,
    declaredArtifacts: options.scope.authority.declaredArtifacts,
    noCodeReason: options.scope.authority.noCodeReason,
    ...(options.scope.authority.gitChangedPaths
      ? { gitChangedPaths: options.scope.authority.gitChangedPaths }
      : {}),
  });
  return {
    contractHash: contract.contract.contractHash,
    snapshotHash: currentBundle.scope.currentProjectionHash,
  };
}

function receiptTime(clock: (() => Date) | undefined, label: string): string {
  const value = (clock ?? (() => new Date()))();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`Native check ${label} time is invalid`);
  }
  return value.toISOString();
}

function staleReasons(
  before: BoundFacts,
  after: BoundFacts,
  scope: NativeImplementationScopeBundle,
): NativeCheckReceiptStaleReason[] {
  const reasons: NativeCheckReceiptStaleReason[] = [];
  const expectedContractHash = scope.scope.contractHash;
  const expectedSnapshotHash = scope.scope.currentProjectionHash;
  if (before.contractHash !== expectedContractHash) {
    reasons.push('contract-before-does-not-match-scope');
  }
  if (before.snapshotHash !== expectedSnapshotHash) {
    reasons.push('implementation-before-does-not-match-scope');
  }
  if (after.contractHash !== before.contractHash) {
    reasons.push('contract-changed-during-check');
  }
  if (after.snapshotHash !== before.snapshotHash) {
    reasons.push('implementation-changed-during-check');
  }
  if (after.contractHash === before.contractHash && after.contractHash !== expectedContractHash) {
    reasons.push('contract-after-does-not-match-scope');
  }
  if (after.snapshotHash === before.snapshotHash && after.snapshotHash !== expectedSnapshotHash) {
    reasons.push('implementation-after-does-not-match-scope');
  }
  return reasons;
}

function sameDirectoryIdentity(
  identity: DirectoryIdentity,
  stat: import('node:fs').Stats,
): boolean {
  const stableMetadata =
    identity.birthtimeMs === stat.birthtimeMs && identity.ctimeMs === stat.ctimeMs;
  if (identity.dev !== 0 || identity.ino !== 0 || stat.dev !== 0 || stat.ino !== 0) {
    return stableMetadata && identity.dev === stat.dev && identity.ino === stat.ino;
  }
  return stableMetadata;
}

function sameFileIdentity(left: import('node:fs').Stats, right: import('node:fs').Stats): boolean {
  const stableMetadata =
    left.birthtimeMs === right.birthtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size;
  if (left.dev !== 0 || left.ino !== 0 || right.dev !== 0 || right.ino !== 0) {
    return stableMetadata && left.dev === right.dev && left.ino === right.ino;
  }
  return stableMetadata;
}

async function captureProjectDirectoryChain(
  projectRoot: string,
  directory: string,
): Promise<{ physicalRoot: string; chain: DirectoryIdentity[] }> {
  const lexicalRoot = path.resolve(projectRoot);
  const lexicalDirectory = path.resolve(directory);
  if (!isInsidePath(lexicalRoot, lexicalDirectory)) {
    throw new ScopedFileError('unsafe-file', 'Scoped file parent escapes the project root');
  }
  const chain: DirectoryIdentity[] = [];
  let cursor = lexicalRoot;
  for (const segment of [
    '',
    ...path.relative(lexicalRoot, lexicalDirectory).split(path.sep).filter(Boolean),
  ]) {
    if (segment) cursor = path.join(cursor, segment);
    let stat: import('node:fs').Stats;
    try {
      stat = await fs.lstat(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ScopedFileError('scope-mismatch', 'Scoped file parent no longer exists');
      }
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new ScopedFileError('unsafe-file', 'Scoped file parent is not a real directory');
    }
    const realPath = await fs.realpath(cursor);
    if (chain.length > 0 && !isInsidePath(chain[0].realPath, realPath)) {
      throw new ScopedFileError('unsafe-file', 'Scoped file parent resolves outside the project');
    }
    chain.push({
      path: cursor,
      realPath,
      dev: stat.dev,
      ino: stat.ino,
      birthtimeMs: stat.birthtimeMs,
      ctimeMs: stat.ctimeMs,
    });
  }
  return { physicalRoot: chain[0].realPath, chain };
}

async function verifyProjectDirectoryChain(chain: readonly DirectoryIdentity[]): Promise<void> {
  for (const identity of chain) {
    let stat: import('node:fs').Stats;
    try {
      stat = await fs.lstat(identity.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ScopedFileError('unsafe-file', 'Scoped file parent changed while reading');
      }
      throw error;
    }
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !sameDirectoryIdentity(identity, stat) ||
      (await fs.realpath(identity.path)) !== identity.realPath
    ) {
      throw new ScopedFileError('unsafe-file', 'Scoped file parent changed while reading');
    }
  }
}

async function readScopedFile(options: {
  projectRoot: string;
  file: ScopedFile;
}): Promise<ScannedFile> {
  const lexicalFile = path.resolve(options.projectRoot, ...options.file.path.split('/'));
  if (!isInsidePath(options.projectRoot, lexicalFile)) {
    throw new ScopedFileError('unsafe-file', 'Scoped file path escapes the project root');
  }
  const { physicalRoot, chain } = await captureProjectDirectoryChain(
    options.projectRoot,
    path.dirname(lexicalFile),
  );
  let before: import('node:fs').Stats;
  try {
    before = await fs.lstat(lexicalFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ScopedFileError('scope-mismatch', 'Scoped file no longer exists');
    }
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new ScopedFileError('unsafe-file', 'Scoped file is not a real regular file');
  }
  if (before.size !== options.file.expected.size) {
    throw new ScopedFileError(
      'scope-mismatch',
      'Scoped file size no longer matches its projection',
    );
  }
  const beforeRealPath = await fs.realpath(lexicalFile);
  if (!isInsidePath(physicalRoot, beforeRealPath)) {
    throw new ScopedFileError('unsafe-file', 'Scoped file resolves outside the project root');
  }
  const openFlags =
    process.platform === 'win32'
      ? 'r'
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
  const handle = await fs.open(lexicalFile, openFlags).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      throw new ScopedFileError('scope-mismatch', 'Scoped file no longer exists');
    }
    if (error.code === 'ELOOP' || error.code === 'ENXIO') {
      throw new ScopedFileError('unsafe-file', 'Scoped file became unsafe while opening');
    }
    throw error;
  });
  try {
    const [opened, pathAfterOpen, realPathAfterOpen] = await Promise.all([
      handle.stat(),
      fs.lstat(lexicalFile),
      fs.realpath(lexicalFile),
    ]);
    await verifyProjectDirectoryChain(chain);
    if (
      !opened.isFile() ||
      !pathAfterOpen.isFile() ||
      pathAfterOpen.isSymbolicLink() ||
      realPathAfterOpen !== beforeRealPath ||
      !sameFileIdentity(before, opened) ||
      !sameFileIdentity(opened, pathAfterOpen)
    ) {
      throw new ScopedFileError('unsafe-file', 'Scoped file changed while opening');
    }
    const chunks: Buffer[] = [];
    const digest = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    while (true) {
      const remaining = options.file.expected.size + 1 - total;
      if (remaining < 1) {
        throw new ScopedFileError('scope-mismatch', 'Scoped file exceeds its projected size');
      }
      const read = await handle.read(buffer, 0, Math.min(buffer.length, remaining), null);
      if (read.bytesRead === 0) break;
      total += read.bytesRead;
      if (total > options.file.expected.size) {
        throw new ScopedFileError('scope-mismatch', 'Scoped file exceeds its projected size');
      }
      const chunk = Buffer.from(buffer.subarray(0, read.bytesRead));
      chunks.push(chunk);
      digest.update(chunk);
    }
    const [afterHandle, afterPath, afterRealPath] = await Promise.all([
      handle.stat(),
      fs.lstat(lexicalFile),
      fs.realpath(lexicalFile),
    ]);
    await verifyProjectDirectoryChain(chain);
    if (
      total !== options.file.expected.size ||
      digest.digest('hex') !== options.file.expected.hash
    ) {
      throw new ScopedFileError(
        'scope-mismatch',
        'Scoped file content no longer matches its projection',
      );
    }
    if (
      !afterHandle.isFile() ||
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      afterRealPath !== beforeRealPath ||
      !isInsidePath(physicalRoot, afterRealPath) ||
      !sameFileIdentity(opened, afterHandle) ||
      !sameFileIdentity(opened, afterPath)
    ) {
      throw new ScopedFileError('unsafe-file', 'Scoped file changed while reading');
    }
    const content = Buffer.concat(chunks, total);
    if (content.includes(0)) return { bytes: total, text: null };
    try {
      return { bytes: total, text: new TextDecoder('utf-8', { fatal: true }).decode(content) };
    } catch {
      return { bytes: total, text: null };
    }
  } finally {
    await handle.close();
  }
}

function selectedScopedFiles(scope: NativeImplementationScopeBundle): {
  files: ScopedFile[];
  mismatches: string[];
} {
  const current = new Map(scope.current.entries.map((entry) => [entry.path, entry]));
  const files: ScopedFile[] = [];
  const mismatches: string[] = [];
  for (const change of scope.scope.changes) {
    if (!change.after) continue;
    const entry = current.get(change.path);
    if (
      !entry ||
      entry.hash !== change.after.hash ||
      entry.size !== change.after.size ||
      entry.type !== 'file'
    ) {
      mismatches.push(change.path);
      continue;
    }
    files.push({ path: change.path, expected: change.after });
  }
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  mismatches.sort((left, right) => left.localeCompare(right, 'en'));
  return { files, mismatches };
}

function inspectText(
  pathRef: string,
  text: string,
  addIssue: (issue: NativeCheckIssue) => void,
): void {
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].endsWith('\r') ? lines[index].slice(0, -1) : lines[index];
    const lineNumber = index + 1;
    if (/^(?:<{7}|={7}|>{7})(?: |$)/u.test(line)) {
      addIssue({ path: pathRef, line: lineNumber, kind: 'conflict-marker' });
    }
    if (/[ \t]+$/u.test(line)) {
      addIssue({ path: pathRef, line: lineNumber, kind: 'trailing-whitespace' });
    }
    if (/^ +\t/u.test(line)) {
      addIssue({ path: pathRef, line: lineNumber, kind: 'space-before-tab' });
    }
  }
}

/**
 * Run Comet's bounded text-safety policy against the current implementation scope.
 *
 * This function executes no command and reads no path outside the content-addressed scope. Binary
 * files are hash-checked and counted as skipped because this policy makes no claim about them.
 */
export async function executeNativeCheckReceipt(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  clock?: () => Date;
}): Promise<ExecutedNativeCheckReceipt> {
  if (!options.state.implementation_scope) {
    throw new Error('Native scoped check requires an implementation scope');
  }
  const scope = await readNativeImplementationScopeBundle(
    options.paths,
    options.state.name,
    options.state.implementation_scope,
  );
  const before = await collectBoundFacts({ paths: options.paths, state: options.state, scope });
  const startedAt = receiptTime(options.clock, 'start');
  const selected = selectedScopedFiles(scope);
  const issues: NativeCheckIssue[] = [];
  let issueCount = 0;
  const addIssue = (issue: NativeCheckIssue): void => {
    issueCount += 1;
    if (issues.length < NATIVE_CHECK_LIMITS.maxIssues) issues.push(issue);
  };
  let candidates = selected.files;
  const selectedCount = selected.files.length + selected.mismatches.length;
  const scopeDetailOverflow = scope.scope.unresolvedScopes.some(
    (unresolved) => unresolved.kind === 'scope-detail-overflow',
  );
  if (scopeDetailOverflow) {
    const overflowPath =
      scope.scope.changes.at(-1)?.path ??
      scope.current.entries.at(-1)?.path ??
      scope.baseline.entries.at(-1)?.path;
    if (!overflowPath) {
      throw new Error('Native implementation scope overflow has no bounded diagnostic path');
    }
    addIssue({ path: overflowPath, line: 1, kind: 'scan-limit' });
    candidates = [];
  } else if (selectedCount > NATIVE_CHECK_LIMITS.maxFiles) {
    const selectedPaths = [...selected.files.map((file) => file.path), ...selected.mismatches].sort(
      (left, right) => left.localeCompare(right, 'en'),
    );
    addIssue({
      path: selectedPaths[NATIVE_CHECK_LIMITS.maxFiles],
      line: 1,
      kind: 'scan-limit',
    });
    candidates = [];
  } else {
    let total = 0;
    for (const file of selected.files) {
      if (file.expected.size > NATIVE_CHECK_LIMITS.maxFileBytes) {
        addIssue({ path: file.path, line: 1, kind: 'scan-limit' });
        candidates = [];
        break;
      }
      total += file.expected.size;
      if (total > NATIVE_CHECK_LIMITS.maxTotalBytes) {
        addIssue({ path: file.path, line: 1, kind: 'scan-limit' });
        candidates = [];
        break;
      }
    }
  }
  for (const mismatch of selected.mismatches) {
    addIssue({ path: mismatch, line: 1, kind: 'scope-mismatch' });
  }

  let filesScanned = 0;
  let binaryFilesSkipped = 0;
  let bytesScanned = 0;
  for (const file of candidates) {
    try {
      const scanned = await readScopedFile({ projectRoot: options.paths.projectRoot, file });
      bytesScanned += scanned.bytes;
      if (scanned.text === null) {
        binaryFilesSkipped += 1;
      } else {
        filesScanned += 1;
        inspectText(file.path, scanned.text, addIssue);
      }
    } catch (error) {
      if (!(error instanceof ScopedFileError)) throw error;
      addIssue({ path: file.path, line: 1, kind: error.kind });
    }
  }
  const after = await collectBoundFacts({ paths: options.paths, state: options.state, scope });
  const endedAt = receiptTime(options.clock, 'end');
  const reasons = staleReasons(before, after, scope);
  issues.sort(
    (left, right) =>
      left.path.localeCompare(right.path, 'en') ||
      left.line - right.line ||
      ISSUE_KIND_RANK[left.kind] - ISSUE_KIND_RANK[right.kind],
  );
  const receipt = buildNativeCheckReceipt({
    change: options.state.name,
    sourceRevision: options.state.revision,
    status: issueCount === 0 && reasons.length === 0 ? 'passed' : 'failed',
    startedAt,
    endedAt,
    contract: {
      expectedHash: scope.scope.contractHash,
      beforeHash: before.contractHash,
      afterHash: after.contractHash,
    },
    implementation: {
      scopeHash: scope.scope.scopeHash,
      expectedSnapshotHash: scope.scope.currentProjectionHash,
      beforeSnapshotHash: before.snapshotHash,
      afterSnapshotHash: after.snapshotHash,
    },
    counts: {
      filesSelected: selectedCount,
      filesScanned,
      binaryFilesSkipped,
      bytesScanned,
      issueCount,
      recordedIssueCount: issues.length,
    },
    issues,
    issuesTruncated: issueCount > issues.length,
    stale: reasons.length > 0,
    staleReasons: reasons,
  });
  const ref = await writeNativeCheckReceipt({
    paths: options.paths,
    name: options.state.name,
    receipt,
  });
  return { receipt: parseNativeCheckReceipt(receipt), ref };
}
