import { randomUUID } from 'crypto';
import { promises as fs, type Dirent } from 'fs';
import path from 'path';

import { defaultProjectConfig, readProjectConfig, writeProjectConfig } from './native-config.js';
import { sha256File } from './native-hash.js';
import { acquireNativeLock, releaseNativeLock } from './native-lock.js';
import { isInsidePath, nativeProjectPaths, normalizeArtifactRootRef } from './native-paths.js';
import {
  createNativeTransaction,
  finalizeNativeTransaction,
  readNativeTransaction,
  rollbackNativeTransaction,
} from './native-transaction.js';
import type {
  CometProjectConfig,
  NativePendingRootMove,
  NativeProjectPaths,
  NativeTransactionHooks,
  NativeTransactionJournal,
} from './native-types.js';

interface TreeFile {
  ref: string;
  size: number;
  hash: string;
}

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

async function walkTree(
  root: string,
  options: { rejectSymlinks: boolean; excludedFiles?: ReadonlySet<string> },
): Promise<TreeFile[]> {
  const files: TreeFile[] = [];
  async function visit(directory: string): Promise<void> {
    const entries: Dirent[] = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (options.excludedFiles?.has(path.resolve(target))) continue;
      if (entry.isSymbolicLink()) {
        if (options.rejectSymlinks) throw new Error(`Native root contains a symlink: ${target}`);
        continue;
      }
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile()) {
        const stat = await fs.stat(target);
        files.push({
          ref: path.relative(root, target).split(path.sep).join('/'),
          size: stat.size,
          hash: await sha256File(target),
        });
      }
    }
  }
  await visit(root);
  return files;
}

async function copyTree(source: string, target: string, excludedFile: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.mkdir(target, { recursive: false });
  async function copyDirectory(from: string, to: string): Promise<void> {
    const entries = await fs.readdir(from, { withFileTypes: true });
    for (const entry of entries) {
      const sourceEntry = path.join(from, entry.name);
      if (path.resolve(sourceEntry) === path.resolve(excludedFile)) continue;
      if (entry.isSymbolicLink()) throw new Error(`Native root contains a symlink: ${sourceEntry}`);
      const targetEntry = path.join(to, entry.name);
      if (entry.isDirectory()) {
        await fs.mkdir(targetEntry);
        await copyDirectory(sourceEntry, targetEntry);
      } else if (entry.isFile()) {
        await fs.copyFile(sourceEntry, targetEntry);
      }
    }
  }
  await copyDirectory(source, target);
}

async function assertEquivalentTrees(
  source: string,
  target: string,
  excludedSourceLock?: string,
): Promise<void> {
  const sourceFiles = await walkTree(source, {
    rejectSymlinks: true,
    excludedFiles: excludedSourceLock ? new Set([path.resolve(excludedSourceLock)]) : undefined,
  });
  const targetFiles = await walkTree(target, { rejectSymlinks: true });
  if (JSON.stringify(sourceFiles) !== JSON.stringify(targetFiles)) {
    throw new Error(
      `Native root copies differ; preserve both trees for manual recovery: ${source} and ${target}`,
    );
  }
}

function stagingDirectory(targetPaths: NativeProjectPaths, id: string): string {
  return path.join(targetPaths.artifactRoot, `.comet-native-move-${id}`);
}

function pendingConfig(
  config: CometProjectConfig,
  pending: NativePendingRootMove,
  activeArtifactRoot = config.native.artifact_root,
): CometProjectConfig {
  return {
    ...config,
    native: { artifact_root: activeArtifactRoot, pending_root_move: pending },
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
    const journal = JSON.parse(await fs.readFile(stageJournal, 'utf8')) as NativeTransactionJournal;
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
    if (await exists(options.staging)) await fs.rm(options.staging, { recursive: true });
    await walkTree(options.sourcePaths.nativeRoot, {
      rejectSymlinks: true,
      excludedFiles: new Set([path.resolve(options.lockFile)]),
    });
    await copyTree(options.sourcePaths.nativeRoot, options.staging, options.lockFile);
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
  if (await exists(options.sourcePaths.nativeRoot)) {
    await assertEquivalentTrees(
      options.sourcePaths.nativeRoot,
      options.destinationPaths.nativeRoot,
      options.lockFile,
    );
    await fs.rm(options.sourcePaths.nativeRoot, { recursive: true });
  }
  const destinationJournal = await readNativeTransaction(
    options.destinationPaths,
    options.pending.id,
  );
  await finalizeNativeTransaction(options.destinationPaths, destinationJournal, 'commit');
  const committed: CometProjectConfig = {
    ...config,
    native: { artifact_root: options.pending.toArtifactRoot },
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
  const current = (await readProjectConfig(options.projectRoot)) ?? defaultProjectConfig('.');
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
}): Promise<{ activeNativeRoot: string; config: CometProjectConfig }> {
  const config = await readProjectConfig(options.projectRoot);
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
      });
      return { activeNativeRoot: destinationPaths.nativeRoot, config: committed };
    }

    if (!(await exists(sourcePaths.nativeRoot))) {
      throw new Error('Cannot roll back after the old Native root was removed; continue recovery');
    }
    if (await exists(destinationPaths.nativeRoot)) {
      await assertEquivalentTrees(sourcePaths.nativeRoot, destinationPaths.nativeRoot, lock.file);
      await fs.rm(destinationPaths.nativeRoot, { recursive: true });
    }
    if (await exists(staging)) {
      await assertEquivalentTrees(sourcePaths.nativeRoot, staging, lock.file);
      await fs.rm(staging, { recursive: true });
    }
    const sourceJournal = await readNativeTransaction(sourcePaths, pending.id);
    await rollbackNativeTransaction(sourcePaths, sourceJournal);
    const restored: CometProjectConfig = {
      ...config,
      native: { artifact_root: pending.fromArtifactRoot },
    };
    await writeProjectConfig(options.projectRoot, restored);
    return { activeNativeRoot: sourcePaths.nativeRoot, config: restored };
  } finally {
    await releaseNativeLock(lock);
  }
}
