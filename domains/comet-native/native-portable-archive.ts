import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { listGitWorktreeRoots } from '../../platform/paths/git-worktree.js';

import { atomicWriteJson, atomicWriteText } from './native-atomic-file.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import {
  mergeNativeDeltaAgainstCurrent,
  nativeTotalSpecHash,
  parseNativeDelta,
  type NativeDeltaOperationResult,
} from './native-delta-spec.js';
import { inspectNativeChangeStateDocument } from './native-change.js';
import { readProjectConfig } from './native-config.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import {
  inspectNativePortableAcceptanceDrift,
  nativePortableChangeDir,
  nativePortableStateFile,
  readNativePortableChange,
  rebaseNativePortableDeltasLocked,
  recoverNativeSupervisorFinalVerificationLocked,
  returnNativePortableStateToFinalVerificationLocked,
  returnNativePortableStateToShapeLocked,
} from './native-portable-runtime.js';
import {
  finalizeNativeSupervisorDeliveryLocked,
  readNativeSupervisorState,
} from './native-supervisor.js';
import {
  compareAndSwapNativePortableState,
  readNativePortableState,
} from './native-portable-state.js';
import {
  NATIVE_PORTABLE_ARCHIVE_TRANSACTION_SCHEMA,
  nativePortableTransactionFile,
  readNativePortableTransaction,
  type NativePortableArchiveTransaction,
  type NativePortableArchiveSpecChange,
} from './native-portable-transactions.js';
import type { NativePortableSpecChange, NativePortableState } from './native-portable-types.js';
import {
  inspectNativeVerificationReportAlignment,
  writeNativeVerificationReport,
} from './native-verification-report-v2.js';
import {
  isInsidePath,
  nativePreferredChangeRuntimeDir,
  nativeProjectPaths,
} from './native-paths.js';
import { clearNativeSelectionIfLocked } from './native-selection.js';
import type { NativeProjectPaths } from './native-types.js';

export interface NativePortableArchiveHooks {
  afterSpecApplied?: (index: number) => void | Promise<void>;
  afterFinalState?: () => void | Promise<void>;
  afterReportAligned?: () => void | Promise<void>;
  afterMove?: () => void | Promise<void>;
  afterRuntimeCleanup?: () => void | Promise<void>;
}

export interface NativePortableArchiveResult {
  change: string;
  archiveDir: string;
  transactionId: string;
  state: NativePortableState;
}

export interface NativePortableArchiveSpecPreview {
  readonly capability: string;
  readonly operation: NativePortableSpecChange['operation'];
  readonly source: string | null;
  readonly current_hash: string | null;
  readonly target_hash: string | null;
  readonly delta_source?: string;
  readonly delta_operations?: readonly NativeDeltaOperationResult[];
}

export class NativePortableArchiveOrderRequiredError extends Error {
  readonly peers: string[];

  constructor(peers: readonly string[]) {
    super(
      peers.length === 0
        ? 'Native Archive serial capability decision is stale'
        : `Native Archive requires a serial capability decision: ${peers.join(', ')}`,
    );
    this.name = 'NativePortableArchiveOrderRequiredError';
    this.peers = [...peers];
  }
}

export class NativePortableArchiveRequiresReverificationError extends Error {
  readonly state: NativePortableState;

  constructor(state: NativePortableState) {
    super(
      'Native canonical Spec changed independently; the merged delta requires fresh verification',
    );
    this.name = 'NativePortableArchiveRequiresReverificationError';
    this.state = state;
  }
}

function archiveRef(state: NativePortableState): string {
  const date = (state.verification?.completed_at ?? state.created_at).slice(0, 10);
  return `${date}-${state.name}`;
}

function archiveDirectory(paths: NativeProjectPaths, ref: string): string {
  if (!/^\d{4}-\d{2}-\d{2}-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(ref)) {
    throw new Error('Native portable Archive ref is invalid');
  }
  const target = path.join(paths.archiveDir, ref);
  if (!isInsidePath(paths.archiveDir, target)) throw new Error('Native Archive path escaped');
  return target;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(path.resolve(left));
  const normalizedRight = path.normalize(path.resolve(right));
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function findArchivedPortableChange(
  paths: NativeProjectPaths,
  name: string,
): Promise<{ dir: string; state: NativePortableState } | null> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(paths.archiveDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const matches: Array<{ dir: string; state: NativePortableState }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const dir = path.join(paths.archiveDir, entry.name);
    try {
      const state = await readNativePortableState(path.join(dir, 'comet-state.yaml'));
      if (state.name === name) matches.push({ dir, state });
    } catch {
      // Legacy archives and unrelated invalid entries are handled by their
      // own diagnostics; they cannot authorize a portable recovery.
    }
  }
  if (matches.length > 1) {
    throw new Error(`Multiple Native portable archives exist for ${name}`);
  }
  return matches[0] ?? null;
}

async function readTransaction(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativePortableArchiveTransaction | null> {
  const transaction = await readNativePortableTransaction(paths, { kind: 'archive', change: name });
  return transaction?.kind === 'archive' ? transaction.journal : null;
}

async function archiveTransactionNeedsReverification(
  paths: NativeProjectPaths,
  transaction: NativePortableArchiveTransaction,
): Promise<boolean> {
  if (transaction.status !== 'prepared' && transaction.status !== 'specs-applied') return false;
  for (const [index, change] of transaction.spec_changes.entries()) {
    const current = await readOptionalCanonicalSpec(paths, change.capability);
    if (
      change.operation !== 'remove' &&
      (change.expected_target_hash === undefined || change.result_hash === undefined)
    ) {
      return true;
    }
    if (change.operation === 'remove' && change.expected_target_hash === undefined) {
      return true;
    }
    const resultHash =
      change.operation === 'remove'
        ? null
        : (change.result_hash ??
          (change.content === null ? null : nativeTotalSpecHash(change.content)));
    if (index < transaction.next_spec_index) {
      if (current.hash !== resultHash) return true;
      continue;
    }
    if (current.hash === resultHash) continue;
    if (change.operation === 'remove' && current.hash === null) continue;
    if (change.expected_target_hash === undefined) return true;
    if (current.hash !== change.expected_target_hash) return true;
  }
  return false;
}

export async function hasNativePortableArchiveRecovery(
  paths: NativeProjectPaths,
  name: string,
): Promise<boolean> {
  return (
    (await readTransaction(paths, name)) !== null ||
    (await findArchivedPortableChange(paths, name)) !== null
  );
}

async function writeTransaction(
  paths: NativeProjectPaths,
  transaction: NativePortableArchiveTransaction,
): Promise<void> {
  await fs.mkdir(paths.transactionsDir, { recursive: true });
  await atomicWriteJson(
    nativePortableTransactionFile(paths, { kind: 'archive', change: transaction.change }),
    transaction,
    {
      containedRoot: paths.runtimeDir,
    },
  );
}

async function otherPortableCapabilityOwners(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<string[]> {
  const capabilities = new Set(options.state.spec_changes.map(({ capability }) => capability));
  if (capabilities.size === 0) return [];
  const roots = listGitWorktreeRoots(options.paths.projectRoot);
  if (!roots.some((root) => samePath(root, options.paths.projectRoot))) {
    roots.push(options.paths.projectRoot);
  }
  const workspacePaths: NativeProjectPaths[] = [];
  for (const root of roots) {
    const config = await readProjectConfig(root);
    if (!config) continue;
    const sourcePaths = await nativeProjectPaths(root, config.native.artifact_root);
    if (!workspacePaths.some((entry) => samePath(entry.changesDir, sourcePaths.changesDir))) {
      workspacePaths.push(sourcePaths);
    }
  }
  if (workspacePaths.length === 0) workspacePaths.push(options.paths);

  const peers = new Set<string>();
  for (const sourcePaths of workspacePaths) {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(sourcePaths.changesDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === options.state.name) {
        continue;
      }
      try {
        const peer = await readNativePortableState(
          path.join(sourcePaths.changesDir, entry.name, 'comet-state.yaml'),
        );
        if (
          peer.status !== 'done' &&
          peer.spec_changes.some(({ capability }) => capabilities.has(capability))
        ) {
          peers.add(peer.name);
        }
      } catch {
        const legacy = await inspectNativeChangeStateDocument(sourcePaths, entry.name).catch(
          () => null,
        );
        if (
          legacy?.state &&
          legacy.state.spec_changes.some(({ capability }) => capabilities.has(capability))
        ) {
          peers.add(legacy.state.name);
        }
      }
    }
  }
  return [...peers].sort((left, right) => left.localeCompare(right, 'en'));
}

function normalizeSerialDecision(change: string | undefined): string | null {
  if (change === undefined) return null;
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(change)) {
    throw new Error('Native Archive serial capability decision is invalid');
  }
  return change;
}

async function readOptionalCanonicalSpec(
  paths: NativeProjectPaths,
  capability: string,
): Promise<{ text: string; hash: string | null }> {
  const capabilityDirectory = path.join(paths.specsDir, capability);
  const target = path.join(capabilityDirectory, 'spec.md');
  if (!isInsidePath(paths.specsDir, target)) {
    throw new Error('Native canonical spec path escaped');
  }
  let specsRootStat: import('node:fs').Stats;
  try {
    specsRootStat = await fs.lstat(paths.specsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: '', hash: null };
    throw error;
  }
  if (!specsRootStat.isDirectory() || specsRootStat.isSymbolicLink()) {
    throw new Error('Native canonical specs root is unsafe');
  }
  let capabilityStat: import('node:fs').Stats;
  try {
    capabilityStat = await fs.lstat(capabilityDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: '', hash: null };
    throw error;
  }
  if (!capabilityStat.isDirectory() || capabilityStat.isSymbolicLink()) {
    throw new Error(`Canonical Native capability directory is unsafe: ${capability}`);
  }
  const [realSpecsRoot, realCapabilityDirectory] = await Promise.all([
    fs.realpath(paths.specsDir),
    fs.realpath(capabilityDirectory),
  ]);
  if (!isInsidePath(realSpecsRoot, realCapabilityDirectory)) {
    throw new Error(`Canonical Native capability directory is unsafe: ${capability}`);
  }
  let targetStat: import('node:fs').Stats;
  try {
    targetStat = await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: '', hash: null };
    throw error;
  }
  if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
    throw new Error(`Canonical Native spec is unsafe: ${capability}`);
  }
  if (!isInsidePath(realCapabilityDirectory, await fs.realpath(target))) {
    throw new Error(`Canonical Native spec is unsafe: ${capability}`);
  }
  try {
    const result = await readNativeBoundedTextFile({
      root: paths.specsDir,
      ref: `${capability}/spec.md`,
      maxBytes: null,
      includeHash: false,
    });
    return { text: result.text, hash: nativeTotalSpecHash(result.text) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: '', hash: null };
    throw error;
  }
}

async function applySpecChange(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  change: NativePortableArchiveSpecChange;
}): Promise<void> {
  const capabilityDirectory = path.join(options.paths.specsDir, options.change.capability);
  const target = path.join(capabilityDirectory, 'spec.md');
  if (!isInsidePath(options.paths.specsDir, target)) {
    throw new Error('Native canonical spec path escaped');
  }
  if (options.change.operation === 'remove') {
    const current = await readOptionalCanonicalSpec(options.paths, options.change.capability);
    if (options.change.expected_target_hash === undefined) {
      if (current.hash === null) return;
      throw new Error(
        `Native Archive transaction is missing the canonical target binding for ${options.change.capability}; fresh verification is required`,
      );
    }
    if (current.hash === null) return;
    if (current.hash !== options.change.expected_target_hash) {
      throw new Error(
        `Native canonical Spec changed after Archive preflight: ${options.change.capability}`,
      );
    }
    let specsRootStat: import('node:fs').Stats;
    try {
      specsRootStat = await fs.lstat(options.paths.specsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (!specsRootStat.isDirectory() || specsRootStat.isSymbolicLink()) {
      throw new Error('Native canonical specs root is unsafe');
    }
    let capabilityStat: import('node:fs').Stats;
    try {
      capabilityStat = await fs.lstat(capabilityDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (!capabilityStat.isDirectory() || capabilityStat.isSymbolicLink()) {
      throw new Error(
        `Canonical Native capability directory is unsafe: ${options.change.capability}`,
      );
    }
    const [realSpecsRoot, realCapabilityDirectory] = await Promise.all([
      fs.realpath(options.paths.specsDir),
      fs.realpath(capabilityDirectory),
    ]);
    if (!isInsidePath(realSpecsRoot, realCapabilityDirectory)) {
      throw new Error('Native canonical capability path escaped');
    }
    try {
      const targetStat = await fs.lstat(target);
      if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
        throw new Error(`Canonical Native spec is unsafe: ${options.change.capability}`);
      }
      await fs.unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await fs.rmdir(capabilityDirectory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
    });
    return;
  }
  if (options.change.source === null || options.change.content === null) {
    throw new Error(`Native ${options.change.operation} spec requires frozen source content`);
  }
  if (options.change.expected_target_hash === undefined) {
    throw new Error(
      `Native Archive transaction is missing the canonical target binding for ${options.change.capability}; fresh verification is required`,
    );
  }
  const current = await readOptionalCanonicalSpec(options.paths, options.change.capability);
  const resultHash = options.change.result_hash ?? nativeTotalSpecHash(options.change.content);
  if (current.hash === resultHash) return;
  if (current.hash !== options.change.expected_target_hash) {
    throw new Error(
      `Native canonical Spec changed after Archive preflight: ${options.change.capability}`,
    );
  }
  const sourceTarget = path.join(
    nativePortableChangeDir(options.paths, options.state.name),
    options.change.source,
  );
  await atomicWriteText(sourceTarget, options.change.source_content ?? options.change.content, {
    containedRoot: options.paths.nativeRoot,
  });
  await fs.mkdir(capabilityDirectory, { recursive: true });
  await atomicWriteText(target, options.change.content, {
    containedRoot: options.paths.nativeRoot,
  });
}

function assertArchiveReady(state: NativePortableState): void {
  if (
    state.phase !== 'archive' ||
    state.status !== 'active' ||
    state.loop.stage !== 'archive-ready' ||
    state.verification_result !== 'pass' ||
    state.verification?.verdict !== 'pass' ||
    state.verification_report !== 'verification.md'
  ) {
    throw new Error(`Native change ${state.name} is not archive-ready`);
  }
}

async function freezeArchiveSpecChanges(
  paths: NativeProjectPaths,
  state: NativePortableState,
): Promise<NativePortableArchiveSpecChange[]> {
  const changeRoot = nativePortableChangeDir(paths, state.name);
  const frozen: NativePortableArchiveSpecChange[] = [];
  for (const change of state.spec_changes) {
    if (change.source === null) {
      const current = await readOptionalCanonicalSpec(paths, change.capability);
      frozen.push({ ...change, content: null, expected_target_hash: current.hash });
      continue;
    }
    const source = await readNativeBoundedTextFile({
      root: changeRoot,
      ref: change.source,
      maxBytes: null,
      includeHash: false,
    });
    if (change.delta_source) {
      const deltaSource = await readNativeBoundedTextFile({
        root: changeRoot,
        ref: change.delta_source,
        maxBytes: null,
        includeHash: false,
      });
      const delta = parseNativeDelta(deltaSource.text);
      if (delta.capability !== change.capability) {
        throw new Error(
          `Native delta capability ${delta.capability} does not match ${change.capability}`,
        );
      }
      const current = await readOptionalCanonicalSpec(paths, change.capability);
      const merged = mergeNativeDeltaAgainstCurrent({
        currentMarkdown: current.text,
        delta,
      });
      frozen.push({
        ...change,
        content: merged.markdown,
        delta_content: deltaSource.text,
        source_content: source.text,
        expected_target_hash: current.hash,
        result_hash: merged.result_hash,
      });
      continue;
    }
    const current = await readOptionalCanonicalSpec(paths, change.capability);
    frozen.push({
      ...change,
      content: source.text,
      expected_target_hash: current.hash,
      result_hash: nativeTotalSpecHash(source.text),
    });
  }
  return frozen;
}

function assertTransactionState(
  transaction: NativePortableArchiveTransaction,
  state: NativePortableState,
): void {
  if (state.archived) {
    if (
      state.status !== 'done' ||
      state.loop.stage !== 'done' ||
      state.state_version !== transaction.start_state_version + 1
    ) {
      throw new Error('Native Archive transaction no longer matches the finalized portable state');
    }
    return;
  }
  if (state.state_version !== transaction.start_state_version) {
    throw new Error('Native Archive transaction is stale for the current portable state');
  }
  assertArchiveReady(state);
  if (transaction.status !== 'prepared' && transaction.status !== 'specs-applied') {
    throw new Error(
      `Native Archive transaction ${transaction.status} requires a finalized portable state`,
    );
  }
}

async function assertAppliedSpecsUnchanged(
  paths: NativeProjectPaths,
  transaction: NativePortableArchiveTransaction,
): Promise<void> {
  for (const change of transaction.spec_changes.slice(0, transaction.next_spec_index)) {
    const ref = `${change.capability}/spec.md`;
    const target = path.join(paths.specsDir, ref);
    if (change.operation === 'remove') {
      if (change.expected_target_hash === undefined && !(await exists(target))) continue;
      const current = await readOptionalCanonicalSpec(paths, change.capability);
      if (change.expected_target_hash !== undefined && current.hash === null) continue;
    } else {
      try {
        const current = await readNativeBoundedTextFile({
          root: paths.specsDir,
          ref,
          maxBytes: null,
          includeHash: false,
        });
        if (current.text === change.content) continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    throw new Error(
      `Canonical Spec ${ref} changed after Archive applied it; preserve the concurrent edit and resolve it before resuming Archive`,
    );
  }
}

async function inspectNativePortableDeltaChanges(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<{
  blockers: string[];
  requiresReverification: boolean;
  specPreview: NativePortableArchiveSpecPreview[];
}> {
  const blockers: string[] = [];
  let requiresReverification = false;
  const specPreview: NativePortableArchiveSpecPreview[] = [];
  const changeRoot = nativePortableChangeDir(options.paths, options.state.name);
  for (const change of options.state.spec_changes) {
    try {
      const current = await readOptionalCanonicalSpec(options.paths, change.capability);
      if (!change.delta_source) {
        let targetHash: string | null = null;
        if (change.source !== null) {
          const source = await readNativeBoundedTextFile({
            root: changeRoot,
            ref: change.source,
            maxBytes: null,
            includeHash: false,
          });
          targetHash = nativeTotalSpecHash(source.text);
        }
        specPreview.push({
          capability: change.capability,
          operation: change.operation,
          source: change.source,
          current_hash: current.hash,
          target_hash: targetHash,
        });
        continue;
      }
      const source = await readNativeBoundedTextFile({
        root: changeRoot,
        ref: change.delta_source,
        maxBytes: null,
        includeHash: false,
      });
      const delta = parseNativeDelta(source.text);
      if (delta.capability !== change.capability) {
        throw new Error(
          `Native delta capability ${delta.capability} does not match ${change.capability}`,
        );
      }
      const merged = mergeNativeDeltaAgainstCurrent({ currentMarkdown: current.text, delta });
      if (merged.rebased) {
        requiresReverification = true;
        blockers.push(
          `Native canonical Spec changed independently for ${change.capability}; the merged delta requires fresh verification`,
        );
      }
      specPreview.push({
        capability: change.capability,
        operation: change.operation,
        source: change.source,
        current_hash: current.hash,
        target_hash: merged.result_hash,
        delta_source: change.delta_source,
        delta_operations: merged.operationResults,
      });
    } catch (error) {
      blockers.push((error as Error).message);
    }
  }
  return { blockers, requiresReverification, specPreview };
}

export async function inspectNativePortableArchive(options: {
  paths: NativeProjectPaths;
  name: string;
}): Promise<{
  ready: boolean;
  blockers: string[];
  capabilityPeers: string[];
  archiveDir: string;
  stateVersion: number;
  requiresReverification: boolean;
  specPreview: NativePortableArchiveSpecPreview[];
}> {
  const state = await readNativePortableChange(options.paths, options.name);
  const blockers: string[] = [];
  let requiresReverification = false;
  let specPreview: NativePortableArchiveSpecPreview[];
  try {
    assertArchiveReady(state);
  } catch (error) {
    blockers.push((error as Error).message);
  }
  const transaction = await readTransaction(options.paths, options.name);
  if (transaction) {
    try {
      if (await archiveTransactionNeedsReverification(options.paths, transaction)) {
        requiresReverification = true;
        blockers.push(
          'The interrupted Native Archive transaction is missing a safe canonical binding or has drifted; fresh verification is required',
        );
      }
      await assertAppliedSpecsUnchanged(options.paths, transaction);
    } catch (error) {
      blockers.push((error as Error).message);
    }
  }
  if (transaction === null) {
    try {
      const drift = await inspectNativePortableAcceptanceDrift({
        paths: options.paths,
        state,
      });
      if (drift.drifted) blockers.push(drift.reason ?? 'Native confirmed requirements changed');
    } catch (error) {
      blockers.push((error as Error).message);
    }
    const deltaInspection = await inspectNativePortableDeltaChanges({
      paths: options.paths,
      state,
    });
    blockers.push(...deltaInspection.blockers);
    requiresReverification = deltaInspection.requiresReverification;
    specPreview = deltaInspection.specPreview;
  } else {
    specPreview = transaction.spec_changes.map((change) => ({
      capability: change.capability,
      operation: change.operation,
      source: change.source,
      current_hash: change.expected_target_hash ?? null,
      target_hash: change.content === null ? null : nativeTotalSpecHash(change.content),
      ...(change.delta_source === undefined ? {} : { delta_source: change.delta_source }),
      ...(change.delta_content
        ? {
            delta_operations: parseNativeDelta(change.delta_content).operations.map(
              (operation) => ({
                id: operation.id,
                operation: operation.operation,
                status: 'changed' as const,
                targetIds:
                  operation.operation === 'rename'
                    ? [operation.id, operation.to_id!]
                    : [operation.id],
              }),
            ),
          }
        : {}),
    }));
  }
  const alignment =
    state.verification === null
      ? 'missing'
      : await inspectNativeVerificationReportAlignment({
          file: path.join(nativePortableChangeDir(options.paths, state.name), 'verification.md'),
          stateVersion: state.state_version,
        });
  if (alignment !== 'aligned') blockers.push(`verification.md is ${alignment}`);
  const peers = await otherPortableCapabilityOwners({ paths: options.paths, state });
  if (peers.length > 0) blockers.push(`capabilities are also declared by: ${peers.join(', ')}`);
  return {
    ready: blockers.length === 0,
    blockers,
    requiresReverification,
    specPreview,
    capabilityPeers: peers,
    archiveDir: archiveDirectory(options.paths, archiveRef(state)),
    stateVersion: state.state_version,
  };
}

export async function archiveNativePortableChange(options: {
  paths: NativeProjectPaths;
  name: string;
  serialFirstChange?: string;
  hooks?: NativePortableArchiveHooks;
}): Promise<NativePortableArchiveResult> {
  return withNativeMutationLock(
    options.paths,
    `archive portable change ${options.name}`,
    async () => {
      const serialDecision = normalizeSerialDecision(options.serialFirstChange);
      if (serialDecision !== null && serialDecision !== options.name) {
        throw new Error('Native Archive --serial-first must name the change being archived');
      }
      let transaction = await readTransaction(options.paths, options.name);
      const activeDir = nativePortableChangeDir(options.paths, options.name);
      const activeExists = await exists(activeDir);
      const archived = activeExists
        ? null
        : await findArchivedPortableChange(options.paths, options.name);
      let state: NativePortableState;
      if (activeExists) {
        state = await readNativePortableChange(options.paths, options.name);
      } else if (transaction) {
        state = await readNativePortableState(
          path.join(archiveDirectory(options.paths, transaction.archive_ref), 'comet-state.yaml'),
        );
      } else if (archived) {
        state = archived.state;
      } else {
        throw new Error(`Native active change is missing: ${options.name}`);
      }
      if (
        activeExists &&
        transaction !== null &&
        !state.archived &&
        state.phase === 'verify' &&
        state.verification_result === 'pending' &&
        state.loop.stage === 'verify-ready' &&
        state.state_version > transaction.start_state_version
      ) {
        // The recovery state is authoritative once it has been persisted. If
        // local execution bookkeeping failed after that write, discard the
        // now-stale Archive journal before the next Archive attempt.
        await fs.rm(
          nativePortableTransactionFile(options.paths, {
            kind: 'archive',
            change: options.name,
          }),
          { force: true },
        );
        transaction = null;
      }
      let supervisor = await readNativeSupervisorState(options.paths, options.name);
      if (
        activeExists &&
        !state.archived &&
        transaction !== null &&
        state.phase === 'archive' &&
        state.verification_result === 'pass' &&
        state.verification !== null &&
        (await archiveTransactionNeedsReverification(options.paths, transaction))
      ) {
        const rebased = await rebaseNativePortableDeltasLocked({
          paths: options.paths,
          state,
        });
        const recovered = await returnNativePortableStateToFinalVerificationLocked({
          paths: options.paths,
          state: rebased.state,
          reason: rebased.rebased
            ? 'Native canonical Spec changed independently after Archive preparation; the delta was re-based before fresh verification.'
            : 'Native canonical Spec changed after Archive preparation; fresh verification is required before resuming Archive.',
        });
        await fs.rm(
          nativePortableTransactionFile(options.paths, {
            kind: 'archive',
            change: options.name,
          }),
          { force: true },
        );
        throw new NativePortableArchiveRequiresReverificationError(recovered);
      }
      if (activeExists && !state.archived && transaction === null) {
        const drift = await inspectNativePortableAcceptanceDrift({
          paths: options.paths,
          state,
        });
        if (drift.drifted) {
          const reason = drift.reason ?? 'Native confirmed requirements changed';
          await returnNativePortableStateToShapeLocked({
            paths: options.paths,
            state,
            reason,
          });
          throw new Error(`${reason}; Native change returned to Shape and requires confirmation`);
        }
        if (
          state.phase === 'archive' &&
          state.verification_result === 'pass' &&
          state.verification !== null
        ) {
          const deltaInspection = await inspectNativePortableDeltaChanges({
            paths: options.paths,
            state,
          });
          if (deltaInspection.requiresReverification) {
            const rebased = await rebaseNativePortableDeltasLocked({
              paths: options.paths,
              state,
            });
            const recovered = await returnNativePortableStateToFinalVerificationLocked({
              paths: options.paths,
              state: rebased.state,
              reason:
                'Native canonical Spec changed independently; the delta was re-based before fresh verification.',
            });
            throw new NativePortableArchiveRequiresReverificationError(recovered);
          }
        }
      }
      if (
        activeExists &&
        !state.archived &&
        supervisor?.finalVerification.status === 'pending' &&
        state.verification_result === 'pass'
      ) {
        const supervisorRecovery = await recoverNativeSupervisorFinalVerificationLocked({
          paths: options.paths,
          name: options.name,
        });
        state = supervisorRecovery.state;
        if (supervisorRecovery.action === 'rerun-final-verification') {
          throw new Error(
            'Native Supervisor final verification must be rerun for the current integration commit',
          );
        }
        if (supervisorRecovery.action === 'recorded-final-verification') {
          supervisor = await readNativeSupervisorState(options.paths, options.name);
        }
      }
      const target = archiveDirectory(options.paths, transaction?.archive_ref ?? archiveRef(state));
      const targetExists = await exists(target);
      if (transaction) assertTransactionState(transaction, state);
      if (activeExists && targetExists) {
        throw new Error(
          'Native active and archive directories both exist; doctor intervention is required',
        );
      }
      if (!activeExists && !transaction && archived) {
        if (!state.archived || state.status !== 'done' || state.loop.stage !== 'done') {
          throw new Error('Native archive exists without a completed portable state');
        }
        await clearNativeSelectionIfLocked(options.paths, state.name);
        await fs.rm(nativePreferredChangeRuntimeDir(options.paths, state.name), {
          recursive: true,
          force: true,
        });
        return {
          change: state.name,
          archiveDir: archived.dir,
          transactionId: `recovered-${state.state_version}`,
          state,
        };
      }
      if (!transaction) {
        if (!state.archived) {
          assertArchiveReady(state);
        } else if (state.status !== 'done' || state.loop.stage !== 'done') {
          throw new Error('Native active archived state is inconsistent');
        }
        const peers = await otherPortableCapabilityOwners({ paths: options.paths, state });
        if (!state.archived && peers.length > 0 && serialDecision !== state.name) {
          throw new NativePortableArchiveOrderRequiredError(peers);
        }
        transaction = {
          schema: NATIVE_PORTABLE_ARCHIVE_TRANSACTION_SCHEMA,
          id: randomUUID(),
          change: state.name,
          start_state_version: state.archived ? state.state_version - 1 : state.state_version,
          archive_ref: archiveRef(state),
          status: state.archived ? 'state-finalized' : 'prepared',
          next_spec_index: state.archived ? state.spec_changes.length : 0,
          spec_changes: await freezeArchiveSpecChanges(options.paths, state),
          created_at: new Date().toISOString(),
        };
        await writeTransaction(options.paths, transaction);
      }

      if (!activeExists && targetExists && transaction.status === 'report-aligned') {
        transaction = { ...transaction, status: 'moved' };
        await writeTransaction(options.paths, transaction);
      } else if (!activeExists && targetExists && transaction.status !== 'moved') {
        throw new Error(
          `Native Archive layout contradicts transaction state ${transaction.status}; doctor intervention is required`,
        );
      }

      await assertAppliedSpecsUnchanged(options.paths, transaction);
      const archiveOwnedPaths = transaction.spec_changes
        .slice(0, transaction.next_spec_index)
        .map(({ capability }) =>
          path
            .relative(
              options.paths.projectRoot,
              path.join(options.paths.specsDir, capability, 'spec.md'),
            )
            .replaceAll('\\', '/'),
        );
      let supervisorDelivered = false;
      if (transaction.status === 'prepared' && supervisor && !state.archived) {
        // Do not publish the parent's canonical Specs before Supervisor has
        // delivered its verified integration result to the real target.
        const delivered = await finalizeNativeSupervisorDeliveryLocked({
          paths: options.paths,
          state: supervisor,
          archiveOwnedPaths,
        });
        supervisor = delivered.state;
        supervisorDelivered = true;
      }
      if (transaction.status === 'prepared') {
        for (
          let index = transaction.next_spec_index;
          index < transaction.spec_changes.length;
          index += 1
        ) {
          await applySpecChange({
            paths: options.paths,
            state,
            change: transaction.spec_changes[index],
          });
          transaction = { ...transaction, next_spec_index: index + 1 };
          await writeTransaction(options.paths, transaction);
          await options.hooks?.afterSpecApplied?.(index);
        }
        transaction = { ...transaction, status: 'specs-applied' };
        await writeTransaction(options.paths, transaction);
      }

      await assertAppliedSpecsUnchanged(options.paths, transaction);

      if (transaction.status === 'specs-applied') {
        // Supervisor delivery is the parent-level commit boundary. Do it before
        // finalizing the portable parent as archived so a target-drift blocker
        // cannot expose a false archived state while delivery is still pending.
        if (supervisor && !state.archived && !supervisorDelivered) {
          const delivered = await finalizeNativeSupervisorDeliveryLocked({
            paths: options.paths,
            state: supervisor,
            archiveOwnedPaths,
          });
          supervisor = delivered.state;
          supervisorDelivered = true;
        }
        if (!state.archived) {
          const next: NativePortableState = {
            ...state,
            phase: 'archive',
            status: 'done',
            state_version: state.state_version + 1,
            archived: true,
            blockers: [],
            loop: { ...state.loop, stage: 'done', next_action: null },
          };
          state = await compareAndSwapNativePortableState({
            file: nativePortableStateFile(options.paths, state.name),
            expectedStateVersion: state.state_version,
            next,
            containedRoot: options.paths.nativeRoot,
          });
        }
        transaction = { ...transaction, status: 'state-finalized' };
        await writeTransaction(options.paths, transaction);
        await options.hooks?.afterFinalState?.();
      }

      if (transaction.status === 'state-finalized') {
        const reportRoot = (await exists(activeDir)) ? activeDir : target;
        await writeNativeVerificationReport({
          file: path.join(reportRoot, 'verification.md'),
          state,
          ...(supervisor ? { supervisor } : {}),
        });
        const alignment = await inspectNativeVerificationReportAlignment({
          file: path.join(reportRoot, 'verification.md'),
          stateVersion: state.state_version,
        });
        if (alignment !== 'aligned')
          throw new Error('Native final verification report is not aligned');
        transaction = { ...transaction, status: 'report-aligned' };
        await writeTransaction(options.paths, transaction);
        if (supervisor && !supervisorDelivered) {
          await finalizeNativeSupervisorDeliveryLocked({
            paths: options.paths,
            state: supervisor,
            archiveOwnedPaths,
          });
          supervisorDelivered = true;
        }
        await options.hooks?.afterReportAligned?.();
      }

      if (transaction.status === 'report-aligned') {
        if (supervisor && !supervisorDelivered) {
          await finalizeNativeSupervisorDeliveryLocked({
            paths: options.paths,
            state: supervisor,
            archiveOwnedPaths,
          });
        }
        await fs.mkdir(options.paths.archiveDir, { recursive: true });
        if (await exists(target)) {
          throw new Error(`Native Archive target already exists: ${target}`);
        }
        await fs.rename(activeDir, target);
        transaction = { ...transaction, status: 'moved' };
        await writeTransaction(options.paths, transaction);
        await options.hooks?.afterMove?.();
      }

      if (transaction.status === 'moved') {
        await clearNativeSelectionIfLocked(options.paths, state.name);
        await fs.rm(nativePreferredChangeRuntimeDir(options.paths, state.name), {
          recursive: true,
          force: true,
        });
        await options.hooks?.afterRuntimeCleanup?.();
        await fs.rm(
          nativePortableTransactionFile(options.paths, {
            kind: 'archive',
            change: state.name,
          }),
          { force: true },
        );
      }

      return {
        change: state.name,
        archiveDir: target,
        transactionId: transaction.id,
        state,
      };
    },
    { allowedPortableTransaction: { kind: 'archive', change: options.name } },
  );
}
