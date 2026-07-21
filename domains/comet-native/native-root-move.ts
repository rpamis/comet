import { createHash, randomUUID } from 'crypto';
import { promises as fs, type Dirent } from 'fs';
import path from 'path';

import { atomicWriteText } from './native-atomic-file.js';
import { defaultProjectConfig, readProjectConfig, writeProjectConfig } from './native-config.js';
import { inspectNativeChange } from './native-change.js';
import { acquireNativeLock, releaseNativeLock } from './native-lock.js';
import { isInsidePath, nativeProjectPaths, normalizeArtifactRootRef } from './native-paths.js';
import {
  copyNativeProtectedFile,
  ensureNativeProtectedDirectory,
  quarantineNativeProtectedDirectory,
  readNativeProtectedDirectory,
  readNativeProtectedFile,
  removeNativeProtectedEmptyDirectory,
  removeNativeProtectedFile,
} from './native-protected-file.js';
import {
  createNativeTransaction,
  finalizeNativeTransaction,
  nativeTransactionPaths,
  readNativeTransaction,
  rollbackNativeTransaction,
} from './native-transaction.js';
import { writeNativeWorkspaceIdentity } from './native-workspace.js';
import type {
  CometProjectConfig,
  NativePendingRootMove,
  NativeProjectPaths,
  NativeRootMoveCleanup,
  NativeRootMoveCleanupKind,
  NativeTransactionHooks,
  NativeTransactionJournal,
} from './native-types.js';

interface TreeDirectory {
  ref: string;
  type: 'directory';
}

interface TreeFile {
  ref: string;
  type: 'file';
  size: number;
  hash: string;
}

type TreeEntry = TreeDirectory | TreeFile;

interface RootMoveCleanupManifest {
  schema: 'comet.native.root-move-cleanup.v1';
  transactionId: string;
  kind: NativeRootMoveCleanupKind;
  entries: TreeEntry[];
}

const NATIVE_ROOT_MOVE_MAX_FILE_BYTES = 64 * 1024 * 1024;
const NATIVE_ROOT_MOVE_MAX_JOURNAL_BYTES = 256 * 1024;
const NATIVE_ROOT_MOVE_MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function assertNoUnfinishedTransactions(paths: NativeProjectPaths): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(paths.transactionsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    let journal: NativeTransactionJournal;
    try {
      journal = await readNativeTransaction(paths, entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `Native transaction ${entry.name} has no journal; run doctor before moving`,
          { cause: error },
        );
      }
      throw error;
    }
    if (journal.status !== 'committed' && journal.status !== 'rolled-back') {
      throw new Error(`Native transaction ${journal.id} is unfinished; recover it before moving`);
    }
  }
}

async function assertNoOtherLocks(paths: NativeProjectPaths, ownedLock: string): Promise<void> {
  for (const entry of await fs.readdir(paths.locksDir, { withFileTypes: true })) {
    const file = path.join(paths.locksDir, entry.name);
    if (path.resolve(file) === path.resolve(ownedLock)) continue;
    if (entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Native lock must be diagnosed before moving the root: ${file}`);
    }
  }
}

async function refreshNativeWorkspaceIdentities(paths: NativeProjectPaths): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(paths.changesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    let inspection: Awaited<ReturnType<typeof inspectNativeChange>>;
    try {
      inspection = await inspectNativeChange(paths, entry.name);
    } catch {
      // Workspace identity is advisory. Invalid user-authored change data must not strand a
      // completed root move after the source tree has already been removed.
      continue;
    }
    if (inspection.status !== 'current' || !inspection.state || !('revision' in inspection.state)) {
      continue;
    }
    await writeNativeWorkspaceIdentity({
      paths,
      name: entry.name,
      revision: inspection.state.revision,
    });
  }
}

async function walkTree(
  root: string,
  options: { rejectSymlinks: boolean; excludedFiles?: ReadonlySet<string> },
): Promise<TreeEntry[]> {
  const treeEntries: TreeEntry[] = [];
  async function visit(directory: string): Promise<void> {
    const protectedDirectory = await readNativeProtectedDirectory({
      root,
      directory,
      label: 'Native root tree',
    });
    const entries: Dirent[] = protectedDirectory.entries;
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      await protectedDirectory.verify();
      const target = path.join(directory, entry.name);
      if (options.excludedFiles?.has(path.resolve(target))) {
        await protectedDirectory.verify();
        continue;
      }
      const stat = await fs.lstat(target);
      if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
        if (options.rejectSymlinks) throw new Error(`Native root contains a symlink: ${target}`);
        await protectedDirectory.verify();
        continue;
      }
      if (entry.isDirectory() && stat.isDirectory()) {
        treeEntries.push({
          ref: path.relative(root, target).split(path.sep).join('/'),
          type: 'directory',
        });
        await visit(target);
      } else if (entry.isFile() && stat.isFile()) {
        const snapshot = await readNativeProtectedFile({
          root,
          file: target,
          maxBytes: NATIVE_ROOT_MOVE_MAX_FILE_BYTES,
          label: `Native root file ${path.relative(root, target)}`,
        });
        treeEntries.push({
          ref: path.relative(root, target).split(path.sep).join('/'),
          type: 'file',
          size: snapshot.size,
          hash: snapshot.hash,
        });
      } else {
        throw new Error(`Native root contains an unsupported file type: ${target}`);
      }
      await protectedDirectory.verify();
    }
  }
  await visit(root);
  return treeEntries.sort((left, right) => left.ref.localeCompare(right.ref));
}

async function copyTree(
  source: string,
  target: string,
  excludedFile: string,
  targetRoot: string,
): Promise<void> {
  await ensureNativeProtectedDirectory({
    root: targetRoot,
    directory: target,
    label: 'Native root move staging directory',
  });
  async function copyDirectory(from: string, to: string): Promise<void> {
    const protectedDirectory = await readNativeProtectedDirectory({
      root: source,
      directory: from,
      label: 'Native root move source directory',
    });
    const entries = protectedDirectory.entries;
    for (const entry of entries) {
      await protectedDirectory.verify();
      const sourceEntry = path.join(from, entry.name);
      if (path.resolve(sourceEntry) === path.resolve(excludedFile)) {
        await protectedDirectory.verify();
        continue;
      }
      const stat = await fs.lstat(sourceEntry);
      if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
        throw new Error(`Native root contains a symlink: ${sourceEntry}`);
      }
      const targetEntry = path.join(to, entry.name);
      if (entry.isDirectory() && stat.isDirectory()) {
        await ensureNativeProtectedDirectory({
          root: targetRoot,
          directory: targetEntry,
          label: 'Native root move staging directory',
        });
        await copyDirectory(sourceEntry, targetEntry);
      } else if (entry.isFile() && stat.isFile()) {
        await copyNativeProtectedFile({
          sourceRoot: source,
          source: sourceEntry,
          targetRoot,
          target: targetEntry,
          maxBytes: NATIVE_ROOT_MOVE_MAX_FILE_BYTES,
          label: `Native root move file ${path.relative(source, sourceEntry)}`,
          exclusive: true,
          expectedTargetHash: null,
        });
      } else {
        throw new Error(`Native root contains an unsupported file type: ${sourceEntry}`);
      }
      await protectedDirectory.verify();
    }
  }
  await copyDirectory(source, target);
}

async function assertEquivalentTrees(
  source: string,
  target: string,
  excludedSourceLock?: string,
  excludedTargetLock?: string,
): Promise<void> {
  const sourceFiles = await walkTree(source, {
    rejectSymlinks: true,
    excludedFiles: excludedSourceLock ? new Set([path.resolve(excludedSourceLock)]) : undefined,
  });
  const targetFiles = await walkTree(target, {
    rejectSymlinks: true,
    excludedFiles: excludedTargetLock ? new Set([path.resolve(excludedTargetLock)]) : undefined,
  });
  if (JSON.stringify(sourceFiles) !== JSON.stringify(targetFiles)) {
    throw new Error(
      `Native root copies differ; preserve both trees for manual recovery: ${source} and ${target}`,
    );
  }
}

function stagingDirectory(targetPaths: NativeProjectPaths, id: string): string {
  return path.join(targetPaths.artifactRoot, `.comet-native-move-${id}`);
}

function sourceRemovalDirectory(sourcePaths: NativeProjectPaths, id: string): string {
  return path.join(sourcePaths.artifactRoot, `.comet-native-source-${id}.removing`);
}

function stagingRemovalDirectory(staging: string): string {
  return `${staging}.removing`;
}

function rollbackRemovalDirectory(target: string, id: string): string {
  return path.join(path.dirname(target), `.${path.basename(target)}.${id}.rollback-removing`);
}

function cleanupManifestFile(
  paths: NativeProjectPaths,
  id: string,
  kind: NativeRootMoveCleanupKind,
): string {
  return path.join(nativeTransactionPaths(paths, id).directory, `root-move-cleanup-${kind}.json`);
}

function cleanupManifestSource(manifest: RootMoveCleanupManifest): string {
  return JSON.stringify(manifest, null, 2) + '\n';
}

function cleanupManifestHash(source: string | Buffer): string {
  return createHash('sha256').update(source).digest('hex');
}

function parseCleanupManifestEntry(value: unknown, index: number): TreeEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Native root-move cleanup manifest entry ${index} must be an object`);
  }
  const entry = value as Record<string, unknown>;
  const keys = Object.keys(entry).sort();
  const expectedKeys = entry.type === 'file' ? ['hash', 'ref', 'size', 'type'] : ['ref', 'type'];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`Native root-move cleanup manifest entry ${index} has invalid fields`);
  }
  if (
    typeof entry.ref !== 'string' ||
    entry.ref.length === 0 ||
    entry.ref.includes('\\') ||
    path.posix.normalize(entry.ref) !== entry.ref ||
    entry.ref.startsWith('/') ||
    entry.ref.split('/').includes('..') ||
    Buffer.byteLength(entry.ref, 'utf8') > 4096
  ) {
    throw new Error(`Native root-move cleanup manifest entry ${index} has an invalid ref`);
  }
  if (entry.type === 'directory') return { ref: entry.ref, type: 'directory' };
  if (
    entry.type !== 'file' ||
    typeof entry.size !== 'number' ||
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    typeof entry.hash !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(entry.hash)
  ) {
    throw new Error(`Native root-move cleanup manifest entry ${index} is invalid`);
  }
  return { ref: entry.ref, type: 'file', size: entry.size, hash: entry.hash };
}

function parseCleanupManifest(
  value: unknown,
  id: string,
  kind: NativeRootMoveCleanupKind,
): RootMoveCleanupManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native root-move cleanup manifest must be an object');
  }
  const manifest = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(manifest).sort()) !==
      JSON.stringify(['entries', 'kind', 'schema', 'transactionId']) ||
    manifest.schema !== 'comet.native.root-move-cleanup.v1' ||
    manifest.transactionId !== id ||
    manifest.kind !== kind ||
    !Array.isArray(manifest.entries)
  ) {
    throw new Error('Native root-move cleanup manifest binding is invalid');
  }
  const entries = manifest.entries.map(parseCleanupManifestEntry);
  for (let index = 0; index < entries.length; index += 1) {
    if (index > 0 && entries[index - 1].ref.localeCompare(entries[index].ref) >= 0) {
      throw new Error('Native root-move cleanup manifest refs must be unique and sorted');
    }
    const parent = path.posix.dirname(entries[index].ref);
    if (
      parent !== '.' &&
      !entries.some((candidate) => candidate.ref === parent && candidate.type === 'directory')
    ) {
      throw new Error(`Native root-move cleanup manifest parent is missing: ${parent}`);
    }
  }
  return {
    schema: 'comet.native.root-move-cleanup.v1',
    transactionId: id,
    kind,
    entries,
  };
}

async function writeCleanupManifest(options: {
  paths: NativeProjectPaths;
  id: string;
  kind: NativeRootMoveCleanupKind;
  entries: TreeEntry[];
}): Promise<string> {
  const manifest: RootMoveCleanupManifest = {
    schema: 'comet.native.root-move-cleanup.v1',
    transactionId: options.id,
    kind: options.kind,
    entries: options.entries,
  };
  const source = cleanupManifestSource(manifest);
  if (Buffer.byteLength(source, 'utf8') > NATIVE_ROOT_MOVE_MAX_MANIFEST_BYTES) {
    throw new Error('Native root-move cleanup manifest exceeds its byte budget');
  }
  await atomicWriteText(cleanupManifestFile(options.paths, options.id, options.kind), source, {
    containedRoot: options.paths.nativeRoot,
  });
  return cleanupManifestHash(source);
}

async function readCleanupManifest(options: {
  paths: NativeProjectPaths;
  id: string;
  cleanup: NativeRootMoveCleanup;
}): Promise<RootMoveCleanupManifest> {
  const snapshot = await readNativeProtectedFile({
    root: options.paths.nativeRoot,
    file: cleanupManifestFile(options.paths, options.id, options.cleanup.kind),
    maxBytes: NATIVE_ROOT_MOVE_MAX_MANIFEST_BYTES,
    label: `Native root-move cleanup manifest ${options.cleanup.kind}`,
  });
  if (snapshot.hash !== options.cleanup.manifestHash) {
    throw new Error('Native root-move cleanup manifest hash changed');
  }
  return parseCleanupManifest(
    JSON.parse(snapshot.bytes.toString('utf8')) as unknown,
    options.id,
    options.cleanup.kind,
  );
}

async function assertCleanupManifestMatch(options: {
  quarantine: string;
  manifest: RootMoveCleanupManifest;
  exact: boolean;
}): Promise<TreeEntry[]> {
  const current = await walkTree(options.quarantine, { rejectSymlinks: true });
  const expected = new Map(options.manifest.entries.map((entry) => [entry.ref, entry]));
  for (const entry of current) {
    const bound = expected.get(entry.ref);
    if (!bound || JSON.stringify(bound) !== JSON.stringify(entry)) {
      throw new Error(
        `Native root-move cleanup quarantine differs from its bound manifest: ${entry.ref}`,
      );
    }
  }
  if (options.exact && current.length !== options.manifest.entries.length) {
    throw new Error('Native root-move cleanup quarantine is incomplete before deletion');
  }
  return current;
}

function treeEntryDepth(entry: TreeEntry): number {
  return entry.ref.split('/').length;
}

async function deleteCleanupManifestSubset(options: {
  projectRoot: string;
  quarantine: string;
  manifest: RootMoveCleanupManifest;
  hooks?: NativeTransactionHooks;
}): Promise<void> {
  const current = await assertCleanupManifestMatch({
    quarantine: options.quarantine,
    manifest: options.manifest,
    exact: false,
  });
  const ordered = [...current].sort(
    (left, right) =>
      treeEntryDepth(right) - treeEntryDepth(left) ||
      (left.type === right.type
        ? right.ref.localeCompare(left.ref)
        : left.type === 'file'
          ? -1
          : 1),
  );
  let removedCount = 0;
  for (const entry of ordered) {
    const target = path.join(options.quarantine, ...entry.ref.split('/'));
    if (entry.type === 'file') {
      await removeNativeProtectedFile({
        root: options.projectRoot,
        file: target,
        maxBytes: NATIVE_ROOT_MOVE_MAX_FILE_BYTES,
        expectedHash: entry.hash,
        expectedSize: entry.size,
        label: `Native root-move cleanup file ${entry.ref}`,
      });
    } else {
      await removeNativeProtectedEmptyDirectory({
        root: options.projectRoot,
        directory: target,
        label: `Native root-move cleanup directory ${entry.ref}`,
      });
    }
    removedCount += 1;
    await options.hooks?.afterRootMoveCleanupEntryRemoved?.(
      options.manifest.kind,
      entry.ref,
      removedCount,
    );
  }
  await assertCleanupManifestMatch({
    quarantine: options.quarantine,
    manifest: options.manifest,
    exact: false,
  });
  await removeNativeProtectedEmptyDirectory({
    root: options.projectRoot,
    directory: options.quarantine,
    label: `Native root-move cleanup quarantine ${options.manifest.kind}`,
  });
}

function pendingConfig(
  config: CometProjectConfig,
  pending: NativePendingRootMove,
  activeArtifactRoot = config.native.artifact_root,
): CometProjectConfig {
  return {
    ...config,
    native: { ...config.native, artifact_root: activeArtifactRoot, pending_root_move: pending },
  };
}

function rootMoveJournal(options: {
  id: string;
  paths: NativeProjectPaths;
  now: Date;
}): NativeTransactionJournal {
  return {
    schema: 'comet.native.transaction.v1',
    id: options.id,
    kind: 'root-move',
    status: 'prepared',
    projectRoot: options.paths.projectRoot,
    nativeRoot: options.paths.nativeRoot,
    createdAt: options.now.toISOString(),
    operations: [],
  };
}

async function readRootMoveJournal(
  sourcePaths: NativeProjectPaths,
  destinationPaths: NativeProjectPaths,
  stage: string,
  id: string,
): Promise<{ journal: NativeTransactionJournal; paths: NativeProjectPaths }> {
  for (const paths of [sourcePaths, destinationPaths]) {
    try {
      const journal = await readNativeTransaction(paths, id);
      if (journal.kind !== 'root-move') throw new Error(`Transaction ${id} is not a root move`);
      return { journal, paths };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const stageJournal = path.join(stage, 'runtime', 'transactions', id, 'transaction.json');
  try {
    const snapshot = await readNativeProtectedFile({
      root: stage,
      file: stageJournal,
      maxBytes: NATIVE_ROOT_MOVE_MAX_JOURNAL_BYTES,
      label: `Staged Native root-move journal ${id}`,
    });
    const journal = JSON.parse(snapshot.bytes.toString('utf8')) as NativeTransactionJournal;
    if (journal.schema !== 'comet.native.transaction.v1' || journal.kind !== 'root-move') {
      throw new Error(`Invalid staged root-move journal: ${id}`);
    }
    return { journal, paths: destinationPaths };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new Error(`Native root-move journal is missing: ${id}`, { cause: error });
  }
}

async function setPendingStage(options: {
  projectRoot: string;
  config: CometProjectConfig;
  pending: NativePendingRootMove;
  stage: NativePendingRootMove['stage'];
  activeArtifactRoot?: string;
}): Promise<CometProjectConfig> {
  const updated = pendingConfig(
    options.config,
    { ...options.pending, stage: options.stage },
    options.activeArtifactRoot,
  );
  await writeProjectConfig(options.projectRoot, updated);
  return updated;
}

async function setPendingCleanup(options: {
  projectRoot: string;
  config: CometProjectConfig;
  id: string;
  cleanup?: NativeRootMoveCleanup;
}): Promise<CometProjectConfig> {
  const pending = options.config.native.pending_root_move;
  if (!pending || pending.id !== options.id) {
    throw new Error(`Native root-move cleanup ${options.id} lost its pending configuration`);
  }
  const updated = pendingConfig(
    options.config,
    {
      id: pending.id,
      fromArtifactRoot: pending.fromArtifactRoot,
      toArtifactRoot: pending.toArtifactRoot,
      stage: pending.stage,
      ...(options.cleanup ? { cleanup: options.cleanup } : {}),
    },
    options.config.native.artifact_root,
  );
  await writeProjectConfig(options.projectRoot, updated);
  return updated;
}

async function cleanupRootMoveTree(options: {
  projectRoot: string;
  config: CometProjectConfig;
  id: string;
  kind: NativeRootMoveCleanupKind;
  stablePaths: NativeProjectPaths;
  target: string;
  quarantine: string;
  label: string;
  beforeQuarantine?: () => void | Promise<void>;
  afterQuarantine?: (quarantine: string) => void | Promise<void>;
  hooks?: NativeTransactionHooks;
}): Promise<CometProjectConfig> {
  let config = options.config;
  const pending = config.native.pending_root_move;
  if (!pending || pending.id !== options.id) {
    throw new Error(`Native root-move cleanup ${options.id} lost its pending configuration`);
  }
  let cleanup = pending.cleanup;
  if (cleanup && cleanup.kind !== options.kind) {
    throw new Error(
      `Native root move has unfinished ${cleanup.kind} cleanup; cannot start ${options.kind}`,
    );
  }

  let targetExists = await exists(options.target);
  let quarantineExists = await exists(options.quarantine);
  if (targetExists && quarantineExists) {
    throw new Error(`Native root-move cleanup target and quarantine both exist: ${options.kind}`);
  }
  if (!cleanup) {
    if (!targetExists && !quarantineExists) return config;
    if (!targetExists && quarantineExists) {
      throw new Error(
        `Native root-move cleanup quarantine is not transaction-bound: ${options.kind}`,
      );
    }
    const manifestHash = await writeCleanupManifest({
      paths: options.stablePaths,
      id: options.id,
      kind: options.kind,
      entries: await walkTree(options.target, { rejectSymlinks: true }),
    });
    cleanup = { kind: options.kind, state: 'prepared', manifestHash };
    config = await setPendingCleanup({
      projectRoot: options.projectRoot,
      config,
      id: options.id,
      cleanup,
    });
  }

  const manifest = await readCleanupManifest({
    paths: options.stablePaths,
    id: options.id,
    cleanup,
  });
  targetExists = await exists(options.target);
  quarantineExists = await exists(options.quarantine);
  if (targetExists && quarantineExists) {
    throw new Error(`Native root-move cleanup target and quarantine both exist: ${options.kind}`);
  }
  if (targetExists) {
    if (cleanup.state !== 'prepared') {
      throw new Error(
        `Native root-move cleanup target reappeared after quarantine: ${options.kind}`,
      );
    }
    await quarantineNativeProtectedDirectory({
      root: options.projectRoot,
      directory: options.target,
      quarantine: options.quarantine,
      label: options.label,
      beforeQuarantine: options.beforeQuarantine,
      afterQuarantine: options.afterQuarantine,
    });
    quarantineExists = true;
  }

  if (!quarantineExists) {
    if (cleanup.state !== 'deleting') {
      throw new Error(`Native root-move cleanup quarantine disappeared: ${options.kind}`);
    }
    return setPendingCleanup({
      projectRoot: options.projectRoot,
      config,
      id: options.id,
    });
  }

  await assertCleanupManifestMatch({
    quarantine: options.quarantine,
    manifest,
    exact: cleanup.state !== 'deleting',
  });
  if (cleanup.state === 'prepared') {
    cleanup = { ...cleanup, state: 'quarantined' };
    config = await setPendingCleanup({
      projectRoot: options.projectRoot,
      config,
      id: options.id,
      cleanup,
    });
  }
  if (cleanup.state === 'quarantined') {
    cleanup = { ...cleanup, state: 'deleting' };
    config = await setPendingCleanup({
      projectRoot: options.projectRoot,
      config,
      id: options.id,
      cleanup,
    });
  }
  await deleteCleanupManifestSubset({
    projectRoot: options.projectRoot,
    quarantine: options.quarantine,
    manifest,
    hooks: options.hooks,
  });
  return setPendingCleanup({
    projectRoot: options.projectRoot,
    config,
    id: options.id,
  });
}

async function finishForwardMove(options: {
  projectRoot: string;
  config: CometProjectConfig;
  pending: NativePendingRootMove;
  sourcePaths: NativeProjectPaths;
  destinationPaths: NativeProjectPaths;
  staging: string;
  journal: NativeTransactionJournal;
  lockFile: string;
  hooks?: NativeTransactionHooks;
}): Promise<CometProjectConfig> {
  let config = options.config;
  let stage = config.native.pending_root_move!.stage;
  if (stage === 'copying') {
    if (!(await exists(options.sourcePaths.nativeRoot))) {
      throw new Error(`Native source root is missing: ${options.sourcePaths.nativeRoot}`);
    }
    const stagingRemoval = stagingRemovalDirectory(options.staging);
    config = await cleanupRootMoveTree({
      projectRoot: options.projectRoot,
      config,
      id: options.pending.id,
      kind: 'restart-staging',
      stablePaths: options.sourcePaths,
      target: options.staging,
      quarantine: stagingRemoval,
      label: 'Native root move stale staging removal',
      hooks: options.hooks,
    });
    await walkTree(options.sourcePaths.nativeRoot, {
      rejectSymlinks: true,
      excludedFiles: new Set([path.resolve(options.lockFile)]),
    });
    await copyTree(
      options.sourcePaths.nativeRoot,
      options.staging,
      options.lockFile,
      options.destinationPaths.projectRoot,
    );
    await assertEquivalentTrees(options.sourcePaths.nativeRoot, options.staging, options.lockFile);
    config = await setPendingStage({
      projectRoot: options.projectRoot,
      config,
      pending: options.pending,
      stage: 'ready',
    });
    stage = 'ready';
    await options.hooks?.afterRootMoveStage?.('ready', options.journal);
  }
  if (stage === 'ready') {
    if (await exists(options.destinationPaths.nativeRoot)) {
      if (await exists(options.staging)) {
        throw new Error(`Native destination is occupied: ${options.destinationPaths.nativeRoot}`);
      }
      await assertEquivalentTrees(
        options.sourcePaths.nativeRoot,
        options.destinationPaths.nativeRoot,
        options.lockFile,
      );
    } else {
      if (!(await exists(options.staging))) throw new Error(`Native move staging tree is missing`);
      await assertEquivalentTrees(
        options.sourcePaths.nativeRoot,
        options.staging,
        options.lockFile,
      );
      await fs.rename(options.staging, options.destinationPaths.nativeRoot);
    }
    config = await setPendingStage({
      projectRoot: options.projectRoot,
      config,
      pending: options.pending,
      stage: 'switched',
      activeArtifactRoot: options.pending.toArtifactRoot,
    });
    stage = 'switched';
    await options.hooks?.afterRootMoveStage?.('switched', options.journal);
  }
  if (stage !== 'switched') throw new Error(`Unsupported Native root-move stage: ${stage}`);
  if (!(await exists(options.destinationPaths.nativeRoot))) {
    throw new Error(`Native destination root is missing: ${options.destinationPaths.nativeRoot}`);
  }
  const sourceRemoval = sourceRemovalDirectory(options.sourcePaths, options.pending.id);
  if (!config.native.pending_root_move?.cleanup && (await exists(options.sourcePaths.nativeRoot))) {
    await assertEquivalentTrees(
      options.sourcePaths.nativeRoot,
      options.destinationPaths.nativeRoot,
      options.lockFile,
    );
  }
  config = await cleanupRootMoveTree({
    projectRoot: options.projectRoot,
    config,
    id: options.pending.id,
    kind: 'forward-source',
    stablePaths: options.destinationPaths,
    target: options.sourcePaths.nativeRoot,
    quarantine: sourceRemoval,
    label: 'Native root move source removal',
    beforeQuarantine: () =>
      options.hooks?.beforeRootMoveSourceRemove?.(options.sourcePaths.nativeRoot),
    afterQuarantine: (quarantine) => options.hooks?.afterRootMoveSourceQuarantined?.(quarantine),
    hooks: options.hooks,
  });
  await refreshNativeWorkspaceIdentities(options.destinationPaths);
  const destinationJournal = await readNativeTransaction(
    options.destinationPaths,
    options.pending.id,
  );
  await finalizeNativeTransaction(options.destinationPaths, destinationJournal, 'commit');
  const stableNative = {
    artifact_root: config.native.artifact_root,
    language: config.native.language,
    clarification_mode: config.native.clarification_mode,
  };
  const committed: CometProjectConfig = {
    ...config,
    native: { ...stableNative, artifact_root: options.pending.toArtifactRoot },
  };
  await writeProjectConfig(options.projectRoot, committed);
  return committed;
}

export async function moveNativeRoot(options: {
  projectRoot: string;
  toArtifactRoot: string;
  now?: Date;
  hooks?: NativeTransactionHooks;
}): Promise<{ fromNativeRoot: string; toNativeRoot: string; transactionId: string }> {
  const current = (await readProjectConfig(options.projectRoot)) ?? defaultProjectConfig('docs');
  if (current.native.pending_root_move) {
    throw new Error(
      `Native root move ${current.native.pending_root_move.id} is already incomplete`,
    );
  }
  const toArtifactRoot = normalizeArtifactRootRef(options.toArtifactRoot);
  if (toArtifactRoot === current.native.artifact_root) {
    throw new Error(`Native artifact root is already ${toArtifactRoot}`);
  }
  const sourcePaths = await nativeProjectPaths(options.projectRoot, current.native.artifact_root);
  const destinationPaths = await nativeProjectPaths(options.projectRoot, toArtifactRoot);
  if (
    isInsidePath(sourcePaths.nativeRoot, destinationPaths.nativeRoot) ||
    isInsidePath(destinationPaths.nativeRoot, sourcePaths.nativeRoot)
  ) {
    throw new Error('Native source and destination roots must not overlap');
  }
  if (!(await exists(sourcePaths.nativeRoot))) {
    throw new Error(`Native source root does not exist: ${sourcePaths.nativeRoot}`);
  }
  await assertNoUnfinishedTransactions(sourcePaths);
  if (await exists(destinationPaths.nativeRoot)) {
    throw new Error(`Native destination is occupied: ${destinationPaths.nativeRoot}`);
  }
  const lock = await acquireNativeLock(sourcePaths, 'root-move', `move root to ${toArtifactRoot}`);
  const id = randomUUID();
  const pending: NativePendingRootMove = {
    id,
    fromArtifactRoot: current.native.artifact_root,
    toArtifactRoot,
    stage: 'copying',
  };
  const journal = rootMoveJournal({ id, paths: sourcePaths, now: options.now ?? new Date() });
  const staging = stagingDirectory(destinationPaths, id);
  try {
    await assertNoOtherLocks(sourcePaths, lock.file);
    if (await exists(staging)) throw new Error(`Native move staging path is occupied: ${staging}`);
    await writeProjectConfig(options.projectRoot, pendingConfig(current, pending));
    await createNativeTransaction(sourcePaths, journal);
    await options.hooks?.afterRootMoveStage?.('copying', journal);
    await finishForwardMove({
      projectRoot: options.projectRoot,
      config: pendingConfig(current, pending),
      pending,
      sourcePaths,
      destinationPaths,
      staging,
      journal,
      lockFile: lock.file,
      hooks: options.hooks,
    });
    return {
      fromNativeRoot: sourcePaths.nativeRoot,
      toNativeRoot: destinationPaths.nativeRoot,
      transactionId: id,
    };
  } finally {
    await releaseNativeLock(lock);
  }
}

export async function recoverNativeRootMove(options: {
  projectRoot: string;
  strategy: 'continue' | 'rollback';
  hooks?: NativeTransactionHooks;
}): Promise<{ activeNativeRoot: string; config: CometProjectConfig }> {
  let config = await readProjectConfig(options.projectRoot);
  const pending = config?.native.pending_root_move;
  if (!config || !pending) throw new Error('No pending Native root move was found');
  const sourcePaths = await nativeProjectPaths(options.projectRoot, pending.fromArtifactRoot);
  const destinationPaths = await nativeProjectPaths(options.projectRoot, pending.toArtifactRoot);
  const staging = stagingDirectory(destinationPaths, pending.id);
  const lockPaths = (await exists(sourcePaths.nativeRoot)) ? sourcePaths : destinationPaths;
  const lock = await acquireNativeLock(lockPaths, 'root-move', `recover root ${pending.id}`);
  try {
    let journalInfo: { journal: NativeTransactionJournal; paths: NativeProjectPaths };
    try {
      journalInfo = await readRootMoveJournal(sourcePaths, destinationPaths, staging, pending.id);
    } catch (error) {
      if (pending.stage !== 'copying' || !(await exists(sourcePaths.nativeRoot))) throw error;
      const journal = rootMoveJournal({ id: pending.id, paths: sourcePaths, now: new Date() });
      await createNativeTransaction(sourcePaths, journal);
      journalInfo = { journal, paths: sourcePaths };
    }
    if (options.strategy === 'continue') {
      const committed = await finishForwardMove({
        projectRoot: options.projectRoot,
        config,
        pending,
        sourcePaths,
        destinationPaths,
        staging,
        journal: journalInfo.journal,
        lockFile: lock.file,
        hooks: options.hooks,
      });
      return { activeNativeRoot: destinationPaths.nativeRoot, config: committed };
    }

    if (!(await exists(sourcePaths.nativeRoot))) {
      throw new Error('Cannot roll back after the old Native root was removed; continue recovery');
    }
    const destinationRemoval = rollbackRemovalDirectory(destinationPaths.nativeRoot, pending.id);
    if (!config.native.pending_root_move?.cleanup && (await exists(destinationPaths.nativeRoot))) {
      await assertEquivalentTrees(sourcePaths.nativeRoot, destinationPaths.nativeRoot, lock.file);
    }
    if (
      !config.native.pending_root_move?.cleanup ||
      config.native.pending_root_move.cleanup.kind === 'rollback-destination'
    ) {
      config = await cleanupRootMoveTree({
        projectRoot: options.projectRoot,
        config,
        id: pending.id,
        kind: 'rollback-destination',
        stablePaths: sourcePaths,
        target: destinationPaths.nativeRoot,
        quarantine: destinationRemoval,
        label: 'Native root move rollback destination removal',
        hooks: options.hooks,
      });
    }
    const stagingRemoval = rollbackRemovalDirectory(staging, pending.id);
    if (!config.native.pending_root_move?.cleanup && (await exists(staging))) {
      await assertEquivalentTrees(sourcePaths.nativeRoot, staging, lock.file);
    }
    if (
      !config.native.pending_root_move?.cleanup ||
      config.native.pending_root_move.cleanup.kind === 'rollback-staging'
    ) {
      config = await cleanupRootMoveTree({
        projectRoot: options.projectRoot,
        config,
        id: pending.id,
        kind: 'rollback-staging',
        stablePaths: sourcePaths,
        target: staging,
        quarantine: stagingRemoval,
        label: 'Native root move rollback staging removal',
        hooks: options.hooks,
      });
    }
    const sourceJournal = await readNativeTransaction(sourcePaths, pending.id);
    await rollbackNativeTransaction(sourcePaths, sourceJournal);
    const stableNative = {
      artifact_root: config.native.artifact_root,
      language: config.native.language,
      clarification_mode: config.native.clarification_mode,
    };
    const restored: CometProjectConfig = {
      ...config,
      native: { ...stableNative, artifact_root: pending.fromArtifactRoot },
    };
    await writeProjectConfig(options.projectRoot, restored);
    return { activeNativeRoot: sourcePaths.nativeRoot, config: restored };
  } finally {
    await releaseNativeLock(lock);
  }
}
