import type { RuntimeStore, WorkflowRun } from '../engine/runtime.js';
import {
  nativePortableSupervisorCleanupBinding,
  preflightNativeSupervisorCleanup,
  executeNativeSupervisorCleanup,
  nativeSupervisorCleanupComplete,
} from './native-supervisor-workspace.js';
import { writePortableMutation } from './native-portable-storage.js';
import { clearNativeSelectionIfLocked } from './native-selection.js';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { renameWithRetry } from '../../platform/fs/transient-retry.js';
import { hasNativeManagedRunMarker } from './native-state-document.js';

import { atomicWriteJson, atomicWriteText } from './native-atomic-file.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';

import {
  mergeNativeDeltaAgainstCurrent,
  parseNativeDelta,
  type NativeDeltaOperationResult,
} from './native-delta-spec.js';
import { withNativeMutation } from './native-mutation.js';
import { isInsidePath, nativeProjectPaths } from './native-paths.js';
import { validateNativePortableDocuments } from './native-portable-requirements.js';
import { nativePortableChangeDir, readNativePortableChange } from './native-portable-storage.js';
import { readNativePortableState } from './native-portable-state.js';
import {
  NATIVE_PORTABLE_ARCHIVE_TRANSACTION_SCHEMA,
  nativePortableTransactionFile,
  readNativePortableTransaction,
  type NativePortableArchiveSpecChange,
  type NativePortableArchiveTransaction,
} from './native-portable-transactions.js';
import type { NativePortableSpecChange, NativePortableState } from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';
import {
  inspectNativeVerificationReportAlignment,
  writeNativeVerificationReport,
} from './native-verification-report-v2.js';
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
async function findArchivedPortableChange(
  paths: NativeProjectPaths,
  name: string,
): Promise<{
  dir: string;
  state: NativePortableState;
} | null> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(paths.archiveDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const matches: Array<{
    dir: string;
    state: NativePortableState;
  }> = [];
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
  const transaction = await readNativePortableTransaction(paths, {
    kind: 'archive',
    change: name,
  });
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
    nativePortableTransactionFile(paths, {
      kind: 'archive',
      change: transaction.change,
    }),
    transaction,
    {
      containedRoot: paths.runtimeDir,
    },
  );
}
async function readOptionalCanonicalSpec(
  paths: NativeProjectPaths,
  capability: string,
): Promise<{
  text: string;
  exists: boolean;
}> {
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
  const current = await readOptionalCanonicalSpec(options.paths, options.change.capability);
  const content = options.change.delta_content
    ? mergeNativeDeltaAgainstCurrent({
        currentMarkdown: current.text,
        delta: parseNativeDelta(options.change.delta_content),
      }).markdown
    : options.change.content;
  const alreadyApplied = current.exists && current.text === content;
  if (options.change.operation === 'create' && current.exists && !alreadyApplied) {
    throw new Error(
      `Canonical Native spec conflicts with the pending create: ${options.change.capability}`,
    );
  }
  const sourceTarget = path.join(
    nativePortableChangeDir(options.paths, options.state.name),
    options.change.source,
  );
  await atomicWriteText(sourceTarget, options.change.source_content ?? options.change.content, {
    containedRoot: options.paths.nativeRoot,
  });
  if (alreadyApplied) return;
  await fs.mkdir(capabilityDirectory, { recursive: true });
  await atomicWriteText(target, content, {
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
          ...mergeNativeDeltaAgainstCurrent({
            currentMarkdown: current.text,
            delta,
          }).operationResults,
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
export async function inspectNativePortableArchive(options: {
  paths: NativeProjectPaths;
  name: string;
  /** SDK Run state is authoritative for new changes; legacy callers omit this. */
  state?: NativePortableState;
  /** Confirmed SDK candidates must stay current even during transaction recovery. */
  requireCurrentAcceptance?: boolean;
  /** SDK 已校验用户确认报告的 hash，沿用该报告的版本，不在预检中改写。 */
  verificationReportStateVersion?: number;

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
  if (options.state === undefined) {
    try {
      const cleanup = await nativePortableSupervisorCleanupBinding(options.paths, state);
      if (cleanup && !nativeSupervisorCleanupComplete(cleanup))
        preflightNativeSupervisorCleanup(cleanup);
    } catch (error) {
      blockers.push((error as Error).message);
    }
  }
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
  if (transaction === null) {
    const target = archiveDirectory(options.paths, archiveRef(state));
    if (await exists(target)) blockers.push(`Native Archive target already exists: ${target}`);
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
  return {
    ready: blockers.length === 0,
    blockers,
    requiresReverification,
    specPreview,
    capabilityPeers: [],
    archiveDir: archiveDirectory(options.paths, archiveRef(state)),
    stateVersion: state.state_version,
  };
}
/** Apply canonical Specs for an SDK-owned Run without committing a second workflow state file. */
export async function applyNativeSdkArchiveSpecs(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  verificationReportStateVersion?: number;

  derivedReport?: boolean;
}): Promise<NativePortableArchiveTransaction> {
  const { paths, state } = options;
  return withNativeMutation(
    paths,
    async () => {
      assertArchiveReady(state);
      let transaction = await readTransaction(paths, state.name);
      if (!transaction) {
        const preflight = await inspectNativePortableArchive({
          paths,
          name: state.name,
          state,
          verificationReportStateVersion: options.verificationReportStateVersion,

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
          await applySpecChange({
            paths,
            state,
            change: transaction.spec_changes[index],
          });
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
  specs: Array<{
    capability: string;
    operation?: string;
    resultHash?: string | null;
  }>;
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
  if (!hasNativeManagedRunMarker(source)) {
    return; // External SDK stores do not project a built-in portable state file.
  }
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) throw new Error('Native SDK Archive state is invalid');
  document.set(PORTABLE_ARCHIVE_RECEIPT_KEY, receipt);
  await atomicWriteText(file, document.toString(), {
    containedRoot: paths.nativeRoot,
  });
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
  if (!hasNativeManagedRunMarker(source.text)) {
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
  return withNativeMutation(
    paths,
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
          try {
            if (options.derivedReport) await options.derivedReport.write(report);
            else await writeNativeVerificationReport({ file: report, state });
          } catch (error) {
            // SDK v3/v4 keep the accepted Run result even when its optional view cannot render.
            if (!options.derivedReport?.optionalView) throw error;
          }
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
          await renameWithRetry(activeDir, target);
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
      await atomicWriteJson(receiptFile, receipt, {
        containedRoot: paths.runtimeDir,
      });
      await fs.rm(
        nativePortableTransactionFile(paths, {
          kind: 'archive',
          change: state.name,
        }),
        {
          force: true,
        },
      );
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
/** 旧文档流程复用当前 Spec/归档事务，只转换业务状态，不恢复检查执行。 */
export async function archiveNativePortableChange(options: {
  paths: NativeProjectPaths;
  name: string;
}): Promise<NativePortableArchiveResult> {
  const { paths, name } = options;
  let transaction = await readTransaction(paths, name);
  let state: NativePortableState;
  try {
    state = await readNativePortableChange(paths, name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (transaction) {
      state = await readNativePortableState(
        path.join(archiveDirectory(paths, transaction.archive_ref), 'comet-state.yaml'),
      );
      if (state.name !== name || !state.archived || state.status !== 'done')
        throw new Error('Moved Archive does not match its original transaction', { cause: error });
    } else {
      const archived = await findArchivedPortableChange(paths, name);
      if (!archived) throw error;
      state = archived.state;
      const receipt = await inspectNativeSdkArchiveFinalization({
        paths,
        state,
        runId: name,
        archiveRef: path.basename(archived.dir),
        history: true,
      });
      const cleanup = await nativePortableSupervisorCleanupBinding(paths, state);
      if (cleanup) await executeNativeSupervisorCleanup(cleanup);
      return {
        change: name,
        state,
        transactionId: receipt.transactionId,
        archiveDir: archived.dir,
      };
    }
  }
  const cleanup = await nativePortableSupervisorCleanupBinding(paths, state);
  if (cleanup && !nativeSupervisorCleanupComplete(cleanup))
    preflightNativeSupervisorCleanup(cleanup);
  if (!state.archived) {
    transaction = await applyNativeSdkArchiveSpecs({ paths, state });
    state = await withNativeMutation(
      paths,
      async () => {
        const current = await readNativePortableChange(paths, name);
        if (current.state_version !== state.state_version)
          throw new Error('Archive state changed; retain the original transaction and retry');
        return writePortableMutation({
          paths,
          previous: current,
          next: {
            ...current,
            status: 'done',
            archived: true,
            state_version: current.state_version + 1,
            blockers: [],
            loop: { ...current.loop, stage: 'done', next_action: null },
          },
        });
      },
      { allowedPortableTransaction: { kind: 'archive', change: name } },
    );
  }
  if (!transaction)
    throw new Error(
      'Original Archive transaction is unavailable; inspect its retained receipt before continuing',
    );
  await finalizeNativeSdkArchive({
    paths,
    state,
    runId: name,
    transactionId: transaction.id,
    archiveRef: transaction.archive_ref,
  });
  if (cleanup) await executeNativeSupervisorCleanup(cleanup);
  await withNativeMutation(paths, () => clearNativeSelectionIfLocked(paths, name));
  return {
    change: name,
    state,
    transactionId: transaction.id,
    archiveDir: archiveDirectory(paths, transaction.archive_ref),
  };
}

/** Commit a recovered prewrite failure only while no Archive writer has started. */
export async function commitNativeSdkArchiveFailure(options: {
  projectRoot: string;
  store: RuntimeStore<WorkflowRun>;
  runId: string;
  expectedRevision: number | null;
  next: WorkflowRun;
  actionId: string;
  state: NativePortableState;
}): Promise<boolean> {
  const { projectRoot, store, runId, expectedRevision, next, actionId, state } = options;
  const paths = await nativeProjectPaths(
    projectRoot,
    (next.input as { artifactRootRef: string }).artifactRootRef,
  );
  return withNativeMutation(
    paths,
    async () => {
      const current = await store.read(runId);
      if (current?.revision !== expectedRevision) return false;
      const previous = current.actions.find((action) => action.id === actionId);
      if (
        previous?.status === 'unknown' &&
        (await readNativePortableTransaction(paths, { kind: 'archive', change: state.name }))
      ) {
        throw new Error(
          'Native Archive has a transaction; recover its actual progress with archive --recover',
        );
      }
      return store.compareAndSwap(runId, expectedRevision, next);
    },
    { allowedPortableTransaction: { kind: 'archive', change: state.name } },
  );
}
