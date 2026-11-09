import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { readCurrentLocalExecution } from './native-portable-checks.js';
import { isNativeSdkChangeCancellationComplete } from './native-sdk-cancellation.js';

import { listGitWorktreeRoots } from '../../platform/paths/git-worktree.js';

import { atomicWriteJson, atomicWriteText } from './native-atomic-file.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { inspectNativeChangeStateDocument } from './native-change.js';
import { readProjectConfig } from './native-config.js';
import {
  mergeNativeDeltaAgainstCurrent,
  parseNativeDelta,
  type NativeDeltaOperationResult,
} from './native-delta-spec.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import {
  isInsidePath,
  nativePreferredChangeRuntimeDir,
  nativeProjectPaths,
} from './native-paths.js';
import { validateNativePortableDocuments } from './native-portable-requirements.js';
import {
  nativePortableChangeDir,
  nativePortableStateFile,
  readNativePortableChange,
  rebaseNativePortableDeltasLocked,
  recoverNativeSupervisorFinalVerificationLocked,
  returnNativePortableStateToFinalVerificationLocked,
} from './native-portable-runtime.js';
import {
  compareAndSwapNativePortableState,
  readNativePortableState,
} from './native-portable-state.js';
import {
  NATIVE_PORTABLE_ARCHIVE_TRANSACTION_SCHEMA,
  nativePortableTransactionFile,
  readNativePortableTransaction,
  type NativePortableArchiveSpecChange,
  type NativePortableArchiveTransaction,
} from './native-portable-transactions.js';
import type { NativePortableSpecChange, NativePortableState } from './native-portable-types.js';
import { clearNativeSelectionIfLocked } from './native-selection.js';
import {
  finalizeNativeSupervisorDeliveryLocked,
  readNativeSupervisorState,
} from './native-supervisor.js';
import type { NativeProjectPaths } from './native-types.js';
import {
  inspectNativeVerificationReportAlignment,
  writeNativeVerificationReport,
} from './native-verification-report-v2.js';

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

export function nativePortableArchiveDirectory(
  paths: NativeProjectPaths,
  state: NativePortableState,
): string {
  return archiveDirectory(paths, archiveRef(state));
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
    const sourcePaths = await nativeProjectPaths(root, config.native.artifact_root, {
      readOnly: true,
    });
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
      if (await isNativeSdkChangeCancellationComplete(sourcePaths.projectRoot, entry.name))
        continue;
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
): Promise<{ text: string; exists: boolean }> {
  const capabilityDirectory = path.join(paths.specsDir, capability);
  const target = path.join(capabilityDirectory, 'spec.md');
  if (!isInsidePath(paths.specsDir, target)) {
    throw new Error('Native canonical spec path escaped');
  }
  let specsRootStat: import('node:fs').Stats;
  try {
    specsRootStat = await fs.lstat(paths.specsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: '', exists: false };
    throw error;
  }
  if (!specsRootStat.isDirectory() || specsRootStat.isSymbolicLink()) {
    throw new Error('Native canonical specs root is unsafe');
  }
  let capabilityStat: import('node:fs').Stats;
  try {
    capabilityStat = await fs.lstat(capabilityDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: '', exists: false };
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: '', exists: false };
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
    return { text: result.text, exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: '', exists: false };
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

  const sourceTarget = path.join(
    nativePortableChangeDir(options.paths, options.state.name),
    options.change.source,
  );
  await atomicWriteText(sourceTarget, options.change.source_content ?? options.change.content, {
    containedRoot: options.paths.nativeRoot,
  });
  const current = await readOptionalCanonicalSpec(options.paths, options.change.capability);
  if (current.exists && current.text === options.change.content) return;
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
      frozen.push({ ...change, content: null });
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
      });
      continue;
    }

    frozen.push({
      ...change,
      content: source.text,
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

async function inspectNativePortableDeltaChanges(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<{
  blockers: string[];
  requiresReverification: boolean;
  specPreview: NativePortableArchiveSpecPreview[];
}> {
  const blockers: string[] = [];
  const specPreview: NativePortableArchiveSpecPreview[] = [];
  for (const change of options.state.spec_changes) {
    try {
      const changeRoot = nativePortableChangeDir(options.paths, options.state.name);
      if (change.source)
        await readNativeBoundedTextFile({
          root: changeRoot,
          ref: change.source,
          maxBytes: null,
          includeHash: false,
        });
      let operations: import('./native-delta-spec.js').NativeDeltaOperationResult[] | undefined;
      if (change.delta_source) {
        const source = await readNativeBoundedTextFile({
          root: changeRoot,
          ref: change.delta_source,
          maxBytes: null,
          includeHash: false,
        });
        const delta = parseNativeDelta(source.text);
        if (delta.capability !== change.capability)
          throw new Error('Native delta capability does not match its target');

        const current = await readOptionalCanonicalSpec(options.paths, change.capability);
        operations = [
          ...mergeNativeDeltaAgainstCurrent({ currentMarkdown: current.text, delta })
            .operationResults,
        ];
      }
      specPreview.push({
        capability: change.capability,
        operation: change.operation,
        source: change.source,
        ...(change.delta_source
          ? { delta_source: change.delta_source, delta_operations: operations }
          : {}),
      });
    } catch (error) {
      blockers.push((error as Error).message);
    }
  }
  return { blockers, requiresReverification: false, specPreview };
}

async function assertPortableChecksCompleted(
  paths: NativeProjectPaths,
  state: NativePortableState,
) {
  const local = await readCurrentLocalExecution({ paths, state });
  if (
    local?.execution?.status === 'running' ||
    local?.checks.some((check) => check.status !== 'passed' || check.exitCode !== 0)
  )
    throw new Error('Native 最新检查未通过或尚未结束；保留实际结果，完成所选检查后再归档');
}

export async function inspectNativePortableArchive(options: {
  paths: NativeProjectPaths;
  name: string;
  /** SDK Run state is authoritative for new changes; legacy callers omit this. */
  state?: NativePortableState;
  /** Confirmed SDK candidates must stay current even during transaction recovery. */
  requireCurrentAcceptance?: boolean;
  /** SDK 已校验用户确认报告的 hash，沿用该报告的版本，不在预检中改写。 */
  verificationReportStateVersion?: number;
  /** 新 SDK 在提交时比较实际 Spec，旧流程保留同能力的串行安排。 */
  checkCapabilityOwners?: boolean;
  derivedReport?: boolean;
}): Promise<{
  ready: boolean;
  blockers: string[];
  capabilityPeers: string[];
  archiveDir: string;
  stateVersion: number;
  requiresReverification: boolean;
  specPreview: NativePortableArchiveSpecPreview[];
}> {
  const state = options.state ?? (await readNativePortableChange(options.paths, options.name));
  if (state.name !== options.name)
    throw new Error('Native Archive state belongs to another change');
  const blockers: string[] = [];
  let requiresReverification = false;
  let specPreview: NativePortableArchiveSpecPreview[];
  if (state.document_constraints_version === 1) {
    const documents = await validateNativePortableDocuments({
      paths: options.paths,
      state,
    });
    blockers.push(...documents.findings.map(({ message }) => message));
  }
  try {
    assertArchiveReady(state);
  } catch (error) {
    blockers.push((error as Error).message);
  }
  const transaction = await readTransaction(options.paths, options.name);
  if (!options.state && transaction === null) {
    try {
      await assertPortableChecksCompleted(options.paths, state);
    } catch (error) {
      blockers.push((error as Error).message);
    }
  }

  if (transaction === null) {
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
  const alignment = options.derivedReport
    ? 'aligned'
    : state.verification === null
      ? 'missing'
      : await inspectNativeVerificationReportAlignment({
          file: path.join(nativePortableChangeDir(options.paths, state.name), 'verification.md'),
          stateVersion: options.verificationReportStateVersion ?? state.state_version,
        });
  if (alignment !== 'aligned') blockers.push(`verification.md is ${alignment}`);
  const peers =
    options.checkCapabilityOwners === false
      ? []
      : await otherPortableCapabilityOwners({ paths: options.paths, state });
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

/** Apply canonical Specs for an SDK-owned Run without committing a second workflow state file. */
export async function applyNativeSdkArchiveSpecs(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  verificationReportStateVersion?: number;
  checkCapabilityOwners?: boolean;
  derivedReport?: boolean;
}): Promise<NativePortableArchiveTransaction> {
  const { paths, state } = options;
  return withNativeMutationLock(
    paths,
    `apply SDK Archive specs ${state.name}`,
    async () => {
      assertArchiveReady(state);
      let transaction = await readTransaction(paths, state.name);
      if (!transaction) {
        const preflight = await inspectNativePortableArchive({
          paths,
          name: state.name,
          state,
          verificationReportStateVersion: options.verificationReportStateVersion,
          checkCapabilityOwners: options.checkCapabilityOwners,
          derivedReport: options.derivedReport,
        });
        if (!preflight.ready) {
          throw new Error(
            `Native SDK Archive preflight is blocked: ${preflight.blockers.join('; ')}`,
          );
        }
        transaction = {
          schema: NATIVE_PORTABLE_ARCHIVE_TRANSACTION_SCHEMA,
          id: randomUUID(),
          change: state.name,
          start_state_version: state.state_version,
          archive_ref: archiveRef(state),
          status: 'prepared',
          next_spec_index: 0,
          spec_changes: await freezeArchiveSpecChanges(paths, state),
          created_at: new Date().toISOString(),
        };
        await writeTransaction(paths, transaction);
      } else {
        assertTransactionState(transaction, state);
      }
      if (transaction.status === 'prepared') {
        for (
          let index = transaction.next_spec_index;
          index < transaction.spec_changes.length;
          index += 1
        ) {
          await applySpecChange({ paths, state, change: transaction.spec_changes[index] });
          transaction = { ...transaction, next_spec_index: index + 1 };
          await writeTransaction(paths, transaction);
        }
        transaction = { ...transaction, status: 'specs-applied' };
        await writeTransaction(paths, transaction);
      }
      return transaction;
    },
    { allowedPortableTransaction: { kind: 'archive', change: state.name } },
  );
}

export async function inspectNativeSdkArchiveSpecs(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<{
  transactionId: string;
  archiveRef: string;
  stateVersion: number;
  specCount: number;
}> {
  const transaction = await readTransaction(options.paths, options.state.name);
  if (!transaction || transaction.status !== 'specs-applied') {
    throw new Error('Native SDK Archive Specs have not been applied');
  }
  assertTransactionState(transaction, options.state);
  if (transaction.next_spec_index !== transaction.spec_changes.length) {
    throw new Error('Native SDK Archive Spec transaction is incomplete');
  }
  return {
    transactionId: transaction.id,
    archiveRef: transaction.archive_ref,
    stateVersion: transaction.start_state_version,
    specCount: transaction.spec_changes.length,
  };
}

interface NativeSdkArchiveReceipt {
  runId: string;
  change: string;
  archiveRef: string;
  transactionId: string;
  stateVersion: number;
  reportSha256?: string | null;
  verificationResultHash?: string;
  preservedReportsRef?: string;
  specs: Array<{ capability: string; operation?: string; resultHash?: string | null }>;
}

const PORTABLE_ARCHIVE_RECEIPT_KEY = 'archive_receipt';

async function writePortableArchiveReceipt(
  paths: NativeProjectPaths,
  archiveRef: string,
  receipt: NativeSdkArchiveReceipt,
): Promise<void> {
  const file = path.join(archiveDirectory(paths, archiveRef), 'comet-state.yaml');
  let source: string;
  try {
    source = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!source.startsWith('# comet-execution: managed-run\n')) {
    return; // External SDK stores do not project a built-in portable state file.
  }
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) throw new Error('Native SDK Archive state is invalid');
  document.set(PORTABLE_ARCHIVE_RECEIPT_KEY, receipt);
  await atomicWriteText(file, document.toString(), { containedRoot: paths.nativeRoot });
}

async function readPortableArchiveReceipt(
  paths: NativeProjectPaths,
  archiveRef: string,
): Promise<NativeSdkArchiveReceipt> {
  const file = path.join(archiveDirectory(paths, archiveRef), 'comet-state.yaml');
  const source = await readNativeBoundedTextFile({
    root: paths.nativeRoot,
    ref: path.relative(paths.nativeRoot, file).replaceAll('\\', '/'),
    maxBytes: null,
  });
  if (!source.text.startsWith('# comet-execution: managed-run\n')) {
    throw new Error('Native SDK Archive portable receipt has no managed Run');
  }
  const document = parseDocument(source.text, { uniqueKeys: true });
  if (document.errors.length > 0) throw new Error('Native SDK Archive state is invalid');
  return (document.toJS() as Record<string, unknown>)[
    PORTABLE_ARCHIVE_RECEIPT_KEY
  ] as NativeSdkArchiveReceipt;
}

function sdkArchiveReceiptFile(paths: NativeProjectPaths, runId: string): string {
  if (!runId.trim()) throw new Error('Native SDK Archive Run ID is missing');
  const key = createHash('sha256').update(runId).digest('hex');
  return path.join(paths.runtimeDir, 'sdk-archive-receipts', `${key}.json`);
}

export async function finalizeNativeSdkArchive(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  runId: string;
  transactionId: string;
  archiveRef: string;
  priorReportSha256?: string;
  /** 已持有 mutation lock；只核对候选，不再获取同一锁。 */
  validateCandidate?: () => Promise<void>;
  derivedReport?: {
    preservedReportsRef: string;
    optionalView?: boolean;
    write: (file: string) => Promise<unknown>;
  };
}): Promise<NativeSdkArchiveReceipt> {
  const { paths, state, runId } = options;
  return withNativeMutationLock(
    paths,
    'finalize SDK Archive ' + state.name,
    async () => {
      if (
        state.phase !== 'archive' ||
        state.status !== 'done' ||
        !state.archived ||
        state.loop.stage !== 'done'
      )
        throw new Error('Native SDK Archive finalization requires committed done state');
      let transaction = await readTransaction(paths, state.name);
      if (!transaction) {
        const receipt = await inspectNativeSdkArchiveFinalization({
          paths,
          state,
          runId,
          archiveRef: options.archiveRef,
        });
        if (receipt.transactionId !== options.transactionId)
          throw new Error('Native Archive recovery belongs to another transaction');
        return receipt;
      }
      assertTransactionState(transaction, state);
      if (
        transaction.id !== options.transactionId ||
        transaction.archive_ref !== options.archiveRef ||
        transaction.next_spec_index !== transaction.spec_changes.length ||
        transaction.spec_changes.length !== state.spec_changes.length ||
        transaction.spec_changes.some(
          (change, index) =>
            change.capability !== state.spec_changes[index]?.capability ||
            change.operation !== state.spec_changes[index]?.operation ||
            change.source !== state.spec_changes[index]?.source,
        ) ||
        !['specs-applied', 'report-aligned', 'moved'].includes(transaction.status)
      )
        throw new Error('Native SDK Archive recovery does not match its completed Spec operations');
      const activeDir = nativePortableChangeDir(paths, state.name);
      const target = archiveDirectory(paths, transaction.archive_ref);
      if (transaction.status === 'specs-applied') {
        if (!(await exists(activeDir)) || (await exists(target)))
          throw new Error('Native Archive layout contradicts its transaction');
        const report = path.join(activeDir, 'verification.md');
        if (!(await exists(report))) {
          if (options.derivedReport) await options.derivedReport.write(report);
          else await writeNativeVerificationReport({ file: report, state });
        }
        transaction = { ...transaction, status: 'report-aligned' };
        await writeTransaction(paths, transaction);
      }
      if (transaction.status === 'report-aligned') {
        const active = await exists(activeDir),
          archived = await exists(target);
        if (active === archived)
          throw new Error('Native Archive layout contradicts its transaction');
        if (active) {
          await fs.mkdir(paths.archiveDir, { recursive: true });
          await fs.rename(activeDir, target);
        }
        transaction = { ...transaction, status: 'moved' };
        await writeTransaction(paths, transaction);
      }
      if (transaction.status !== 'moved' || (await exists(activeDir)) || !(await exists(target)))
        throw new Error('Native SDK Archive has not moved the change');
      const receipt: NativeSdkArchiveReceipt = {
        runId,
        change: state.name,
        archiveRef: transaction.archive_ref,
        transactionId: transaction.id,
        stateVersion: state.state_version,
        specs: transaction.spec_changes.map((change) => ({
          capability: change.capability,
          operation: change.operation,
        })),
      };
      await writePortableArchiveReceipt(paths, transaction.archive_ref, receipt);
      const receiptFile = sdkArchiveReceiptFile(paths, runId);
      await fs.mkdir(path.dirname(receiptFile), { recursive: true });
      await atomicWriteJson(receiptFile, receipt, { containedRoot: paths.runtimeDir });
      await fs.rm(nativePortableTransactionFile(paths, { kind: 'archive', change: state.name }), {
        force: true,
      });
      return receipt;
    },
    { allowedPortableTransaction: { kind: 'archive', change: state.name } },
  );
}

export async function inspectNativeSdkArchiveFinalization(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  runId: string;
  archiveRef?: string;
  history?: boolean;
  verificationResultHash?: string;
  allowMissingReport?: boolean;
}): Promise<NativeSdkArchiveReceipt> {
  const { paths, state, runId } = options;
  let receipt: NativeSdkArchiveReceipt;
  try {
    receipt = JSON.parse(await fs.readFile(sdkArchiveReceiptFile(paths, runId), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !options.archiveRef) throw error;
    receipt = await readPortableArchiveReceipt(paths, options.archiveRef);
  }
  if (
    !receipt ||
    receipt.runId !== runId ||
    receipt.change !== state.name ||
    receipt.stateVersion !== state.state_version ||
    (options.archiveRef !== undefined && receipt.archiveRef !== options.archiveRef) ||
    typeof receipt.transactionId !== 'string' ||
    !Array.isArray(receipt.specs) ||
    receipt.specs.length !== state.spec_changes.length ||
    receipt.specs.some(
      (spec, index) =>
        spec?.capability !== state.spec_changes[index]?.capability ||
        (spec.operation !== undefined && spec.operation !== state.spec_changes[index]?.operation),
    ) ||
    (await readTransaction(paths, state.name)) ||
    (await exists(nativePortableChangeDir(paths, state.name)))
  )
    throw new Error('Native SDK Archive completion record does not match its Run or transaction');
  if (!(await exists(archiveDirectory(paths, receipt.archiveRef))))
    throw new Error('Native SDK Archive destination is missing');
  return receipt;
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

      if (activeExists && !state.archived && transaction === null) {
        await assertPortableChecksCompleted(options.paths, state);
        if (
          state.phase === 'archive' &&
          state.verification_result === 'pass' &&
          state.verification !== null
        ) {
          const deltaInspection = await inspectNativePortableDeltaChanges({
            paths: options.paths,
            state,
          });
          if (!deltaInspection.requiresReverification && deltaInspection.blockers.length)
            throw new Error(deltaInspection.blockers.join('\n'));
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
          if (state.builder_handoff?.raw_input_ref) {
            const local = await readCurrentLocalExecution({ paths: options.paths, state });
            if (!local) throw new Error('Native 原始执行记录缺失；不能直接归档旧摘要');
          }
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
      const archiveOwnedPaths = transaction.spec_changes.map(({ capability }) =>
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
          deferCleanup: true,
        });
        supervisor = delivered.state;
      }
      if (transaction.status === 'prepared') {
        if (!state.archived && state.builder_handoff?.raw_input_ref) {
          const local = await readCurrentLocalExecution({ paths: options.paths, state });
          if (!local) throw new Error('Native 原始执行记录缺失；保留原归档事务并恢复证据');
        }
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

      if (transaction.status === 'specs-applied') {
        if (!state.archived && state.builder_handoff?.raw_input_ref) {
          const local = await readCurrentLocalExecution({ paths: options.paths, state });
          if (!local) throw new Error('Native 原始执行记录缺失；保留已应用步骤并恢复证据');
        }
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
