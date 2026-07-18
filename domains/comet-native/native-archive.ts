import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { isDeepStrictEqual } from 'util';

import { decideWithResolver, recordOutcomeWithResolver } from '../engine/loop.js';
import {
  canonicalSpecPath,
  resolveNativeArtifactFile,
  validateNativeBrief,
  validateNativeVerification,
} from './native-artifacts.js';
import {
  readNativeRunState,
  readNativeTrajectory,
  writeNativeRunState,
} from './native-run-store.js';
import { inspectNativeArchivePreflight } from './native-archive-inspection.js';
import type { NativeArchivePreflight } from './native-archive-preflight.js';
import { hashNativeArchiveTree, inspectNativeArchiveContent } from './native-archive-content.js';
import {
  applyNativeArchiveTransactionV2,
  createNativeArchiveTransactionV2,
  finalizeNativeArchiveTransactionV2,
  readNativeArchiveTransactionV2,
  rollbackNativeArchiveTransactionV2,
  type NativeArchiveTransactionHooksV2,
} from './native-archive-transaction.js';
import {
  NATIVE_CHANGE_STATE_FILE,
  nativeChangeDir,
  readNativeChange,
  readNativeChangeFile,
  writeNativeChangeFile,
} from './native-change.js';
import { settleNativeChangeJournalsLocked } from './native-change-recovery.js';
import { sha256File, sha256Text } from './native-hash.js';
import { acquireNativeLock, releaseNativeLock } from './native-lock.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { resolveContainedNativePath } from './native-paths.js';
import { copyNativeProtectedFile } from './native-protected-file.js';
import { NATIVE_RUNTIME_PACKAGE, nativePhaseResolver } from './native-runtime-package.js';
import { clearNativeSelectionIfLocked } from './native-selection.js';
import {
  applyNativeTransaction,
  finalizeNativeTransaction,
  nativeRootRef,
  readNativeTransaction,
  readNativeTransactionEvents,
  resolveNativeTransactionPaths,
  rollbackNativeTransaction,
  type NativeArchiveTransactionJournalV2,
  type NativeArchiveTransactionOperationV2,
} from './native-transaction.js';
import { appendNativeTrajectoryEvent, writeNativeCheckpoint } from './native-trajectory.js';
import { withNativeTransitionLock } from './native-transition-journal.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
  NativeSpecChange,
  NativeTransactionJournal,
} from './native-types.js';

type AnyArchiveTransactionJournal = NativeTransactionJournal | NativeArchiveTransactionJournalV2;

const NATIVE_ARCHIVE_COPY_MAX_BYTES = 16 * 1024 * 1024;

export class NativeSpecConflictError extends Error {
  readonly code = 'native-spec-conflict';

  constructor(
    readonly capability: string,
    readonly expectedHash: string | null,
    readonly actualHash: string | null,
    readonly canonicalPath: string,
  ) {
    super(
      `Canonical spec conflict for ${capability}: expected ${expectedHash ?? '(missing)'}, actual ${actualHash ?? '(missing)'}`,
    );
    this.name = 'NativeSpecConflictError';
  }
}

export class NativeArchivePreflightError extends Error {
  readonly code = 'native-archive-preflight';

  constructor(
    readonly preflight: NativeArchivePreflight,
    message = preflight.ready
      ? 'Native Archive preflight no longer matches the expected hash'
      : `Native Archive preflight is blocked: ${preflight.findingCodes.join(', ')}`,
  ) {
    super(message);
    this.name = 'NativeArchivePreflightError';
  }
}

async function optionalHash(file: string): Promise<string | null> {
  try {
    return await sha256File(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function assertArchiveReady(state: NativeChangeState): void {
  if (state.phase !== 'archive') throw new Error(`Native change ${state.name} is not in Archive`);
  if (state.verification_result !== 'pass') {
    throw new Error(`Native change ${state.name} has not passed verification`);
  }
  if (!state.verification_report) {
    throw new Error(`Native change ${state.name} has no verification report`);
  }
  if (state.archived) throw new Error(`Native change ${state.name} is already archived`);
}

async function assertArchiveArtifacts(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<void> {
  const changeDir = nativeChangeDir(paths, state.name);
  const brief = await validateNativeBrief(changeDir, state.brief);
  const verification = await validateNativeVerification(changeDir, state.verification_report!);
  const findings = [...brief.findings, ...verification.findings];
  if (findings.length > 0) {
    throw new Error(`Native archive artifacts are invalid: ${findings[0].message}`);
  }
}

async function assertSpecBase(paths: NativeProjectPaths, change: NativeSpecChange): Promise<void> {
  const canonical = canonicalSpecPath(paths, change.capability);
  await resolveContainedNativePath(paths.nativeRoot, canonical);
  const actual = await optionalHash(canonical);
  const expected = change.operation === 'create' ? null : change.base_hash;
  if (actual !== expected) {
    throw new NativeSpecConflictError(change.capability, expected, actual, canonical);
  }
}

function archiveTarget(paths: NativeProjectPaths, name: string, now: Date): string {
  return path.join(paths.archiveDir, `${now.toISOString().slice(0, 10)}-${name}`);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function buildArchiveJournal(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  now: Date;
  transactionId: string;
  preflight: NativeArchivePreflight;
  hooks?: NativeArchiveTransactionHooksV2;
}): Promise<NativeArchiveTransactionJournalV2> {
  const { paths, state, now, transactionId, preflight } = options;
  const target = archiveTarget(paths, state.name, now);
  if (await pathExists(target)) throw new Error(`Native archive target already exists: ${target}`);
  if (nativeRootRef(paths, target) !== preflight.targetRef) {
    throw new Error('Native Archive target changed after preflight');
  }

  const tx = await resolveNativeTransactionPaths(paths, transactionId);
  const operations: NativeArchiveTransactionOperationV2[] = [];
  for (const [index, change] of state.spec_changes.entries()) {
    await assertSpecBase(paths, change);
    const canonical = canonicalSpecPath(paths, change.capability);
    const preview = preflight.operations.find(
      (operation) =>
        operation.capability === change.capability && operation.operation === change.operation,
    );
    if (!preview) {
      throw new Error(`Native Archive preflight has no operation for ${change.capability}`);
    }
    if (change.operation !== 'remove' && preview.proposedHash === null) {
      throw new Error(`Native Archive preflight has no proposed hash for ${change.capability}`);
    }
    const backup = path.join(tx.backups, 'specs', change.capability, 'spec.md');
    if (change.operation === 'remove') {
      operations.push({
        id: `spec-${index + 1}-${change.capability}`,
        type: 'remove',
        target: nativeRootRef(paths, canonical),
        backup: nativeRootRef(paths, backup),
        expectedTargetHash: change.base_hash,
      });
      continue;
    }
    const changeDir = nativeChangeDir(paths, state.name);
    await resolveNativeArtifactFile(changeDir, change.source!);
    const source = path.resolve(changeDir, ...change.source!.split(/[\\/]/u));
    const staged = path.join(tx.staged, 'specs', change.capability, 'spec.md');
    const stagedSnapshot = await copyNativeProtectedFile({
      sourceRoot: changeDir,
      source,
      targetRoot: paths.nativeRoot,
      target: staged,
      maxBytes: NATIVE_ARCHIVE_COPY_MAX_BYTES,
      label: `Native Archive proposed spec ${change.capability}`,
      expectedHash: preview.proposedHash!,
      expectedTargetHash: null,
      exclusive: true,
      hooks: {
        afterParentChainCaptured: () =>
          options.hooks?.afterProtectedCopySourceParentCaptured?.('stage', change.source!),
      },
    });
    const stagedHash = stagedSnapshot.hash;
    if (stagedHash !== preview.proposedHash) {
      throw new Error(`Proposed Native spec changed after preflight: ${change.capability}`);
    }
    operations.push({
      id: `spec-${index + 1}-${change.capability}`,
      type: 'write',
      target: nativeRootRef(paths, canonical),
      staged: nativeRootRef(paths, staged),
      ...(change.operation === 'replace' ? { backup: nativeRootRef(paths, backup) } : {}),
      expectedTargetHash: change.operation === 'create' ? null : change.base_hash,
      stagedHash,
    });
  }
  const source = nativeChangeDir(paths, state.name);
  operations.push({
    id: 'archive-change',
    type: 'move',
    source: nativeRootRef(paths, source),
    target: nativeRootRef(paths, target),
    expectedSourceHash: await hashNativeArchiveTree(source),
    expectedTargetHash: null,
  });
  return {
    schema: 'comet.native.transaction.v2',
    id: transactionId,
    kind: 'archive',
    status: 'prepared',
    change: state.name,
    createdAt: now.toISOString(),
    preflightHash: preflight.preflightHash,
    operations,
  };
}

function archiveDirectoryFromJournal(
  paths: NativeProjectPaths,
  journal: AnyArchiveTransactionJournal,
): string {
  const operation = journal.operations.find((item) => item.id === 'archive-change');
  if (!operation || operation.type !== 'move') {
    throw new Error(`Archive transaction ${journal.id} has no archive move`);
  }
  return path.resolve(paths.nativeRoot, ...operation.target.split('/'));
}

async function finalizeArchive(
  paths: NativeProjectPaths,
  journal: AnyArchiveTransactionJournal,
  hooks?: NativeArchiveTransactionHooksV2,
): Promise<void> {
  const events = await readNativeTransactionEvents(paths, journal.id);
  if (events.some((event) => event.type === 'archive-finalized')) return;
  const finalizationStarted = events.some((event) => event.type === 'archive-finalization-started');
  if (journal.schema === 'comet.native.transaction.v2' && !finalizationStarted) {
    const move = journal.operations.find((operation) => operation.id === 'archive-change');
    if (!move || move.type !== 'move' || !move.expectedSourceHash) {
      throw new Error(`Archive transaction ${journal.id} has no content-bound archive move`);
    }
    const archiveContent = await inspectNativeArchiveContent(
      archiveDirectoryFromJournal(paths, journal),
    );
    if (archiveContent?.kind !== 'directory' || archiveContent.hash !== move.expectedSourceHash) {
      throw new Error(
        `Native Archive content changed before finalization for transaction ${journal.id}`,
      );
    }
  }
  const archiveDir = archiveDirectoryFromJournal(paths, journal);
  const stateFile = path.join(archiveDir, NATIVE_CHANGE_STATE_FILE);
  const state = await readNativeChangeFile(stateFile);
  if (!journal.change || state.name !== journal.change) {
    throw new Error(`Archive transaction ${journal.id} change mismatch`);
  }
  const run = await readNativeRunState(archiveDir);
  if (
    !run ||
    run.runId !== state.run_id ||
    (run.currentStep !== 'archive' && !(run.currentStep === null && run.status === 'completed'))
  ) {
    throw new Error(`Native archive Run state is missing or inconsistent for ${state.name}`);
  }
  let completed = run;
  if (run.currentStep === 'archive') {
    const decision = decideWithResolver(
      NATIVE_RUNTIME_PACKAGE,
      run,
      new Set(),
      nativePhaseResolver,
      undefined,
    );
    if (!decision.action) throw new Error(decision.reason ?? 'Native archive produced no action');
    completed = recordOutcomeWithResolver(
      NATIVE_RUNTIME_PACKAGE,
      decision.state,
      {
        actionId: decision.action.id,
        status: 'succeeded',
        summary: `Archived Native change ${state.name}`,
      },
      nativePhaseResolver,
      undefined,
    );
  }
  const evidenceHash = sha256Text(`archive:${journal.id}:${state.name}`);
  const trajectory = await readNativeTrajectory(archiveDir, completed.trajectoryRef);
  const transactionEvents = trajectory.filter((item) => item.data.transactionId === journal.id);
  if (
    journal.schema === 'comet.native.transaction.v2' &&
    (transactionEvents.length > 1 ||
      transactionEvents.some((item) => item.type !== 'state_transitioned'))
  ) {
    throw new Error(`Native Archive trajectory has a transaction id collision: ${journal.id}`);
  }
  let event = transactionEvents.find((item) => item.type === 'state_transitioned');
  const eventData = {
    previousPhase: 'archive',
    nextPhase: null,
    evidenceHash,
    summary: `Archived Native change ${state.name}`,
    transactionId: journal.id,
  };
  if (
    event &&
    journal.schema === 'comet.native.transaction.v2' &&
    (!isDeepStrictEqual(event.data, eventData) ||
      event.runId !== completed.runId ||
      event.timestamp !== journal.createdAt ||
      event !== trajectory.at(-1))
  ) {
    throw new Error(`Native Archive trajectory event changed for transaction ${journal.id}`);
  }
  if (
    !finalizationStarted &&
    (state.archived || run.currentStep === null || transactionEvents.length > 0)
  ) {
    throw new Error(
      `Native Archive finalization state changed before its irreversible marker: ${journal.id}`,
    );
  }

  // Everything above is read-only and repeatable. Only after the state, Run and trajectory have
  // been proven coherent do we cross the transaction's no-rollback boundary.
  if (!finalizationStarted) {
    if (journal.schema === 'comet.native.transaction.v2') {
      await finalizeNativeArchiveTransactionV2(paths, journal, 'archive-finalization-started');
      await hooks?.afterFinalizationStarted?.(journal);
    } else {
      await finalizeNativeTransaction(paths, journal, 'archive-finalization-started');
    }
  }
  if (!state.archived) {
    const updated = { ...state, archived: true };
    await writeNativeChangeFile(stateFile, updated);
  }
  if (!event) {
    event = await appendNativeTrajectoryEvent({
      changeDir: archiveDir,
      run: completed,
      type: 'state_transitioned',
      data: eventData,
      ...(journal.schema === 'comet.native.transaction.v2'
        ? { now: new Date(journal.createdAt) }
        : {}),
    });
  }
  await writeNativeCheckpoint({
    changeDir: archiveDir,
    run: completed,
    trajectoryOffset: event.sequence,
    evidenceHash,
    ...(journal.schema === 'comet.native.transaction.v2'
      ? { now: new Date(journal.createdAt) }
      : {}),
  });
  await writeNativeRunState(archiveDir, completed);
  await clearNativeSelectionIfLocked(paths, state.name);
  if (journal.schema === 'comet.native.transaction.v2') {
    await finalizeNativeArchiveTransactionV2(paths, journal, 'archive-finalized');
  } else {
    await finalizeNativeTransaction(paths, journal, 'archive-finalized');
  }
}

async function continueArchive(
  paths: NativeProjectPaths,
  journal: AnyArchiveTransactionJournal,
  hooks?: NativeArchiveTransactionHooksV2,
): Promise<AnyArchiveTransactionJournal> {
  if (journal.schema === 'comet.native.transaction.v2') {
    const events = await readNativeTransactionEvents(paths, journal.id);
    if (!events.some((event) => event.type === 'operation-started')) {
      const preflight = await inspectNativeArchivePreflight({
        paths,
        name: journal.change,
        now: new Date(journal.createdAt),
      });
      if (!preflight.ready || preflight.preflightHash !== journal.preflightHash) {
        throw new NativeArchivePreflightError(
          preflight,
          'Native Archive facts changed before the first transaction operation',
        );
      }
    }
    const applied = await applyNativeArchiveTransactionV2(paths, journal, hooks);
    await finalizeArchive(paths, applied, hooks);
    return finalizeNativeArchiveTransactionV2(paths, applied, 'commit');
  }
  const applied = await applyNativeTransaction(paths, journal);
  await finalizeArchive(paths, applied, hooks);
  return finalizeNativeTransaction(paths, applied, 'commit');
}

function assertMatchingJournal(
  paths: NativeProjectPaths,
  journal: AnyArchiveTransactionJournal,
): void {
  if (journal.kind !== 'archive') throw new Error(`Transaction ${journal.id} is not an archive`);
  if (journal.schema === 'comet.native.transaction.v2') {
    if (!journal.change) throw new Error(`Archive transaction ${journal.id} has no change`);
    return;
  }
  if (
    path.resolve(journal.projectRoot) !== path.resolve(paths.projectRoot) ||
    path.resolve(journal.nativeRoot) !== path.resolve(paths.nativeRoot)
  ) {
    throw new Error(`Transaction ${journal.id} belongs to a different Native root`);
  }
}

export async function archiveNativeChange(options: {
  paths: NativeProjectPaths;
  name: string;
  expectedPreflightHash: string;
  now?: Date;
  hooks?: NativeArchiveTransactionHooksV2;
}): Promise<{ archiveDir: string; transactionId: string; preflightHash: string }> {
  return withNativeMutationLock(options.paths, `archive ${options.name}`, () =>
    withNativeTransitionLock(options.paths, options.name, `archive ${options.name}`, async () => {
      await settleNativeChangeJournalsLocked(options.paths, options.name);
      const lock = await acquireNativeLock(options.paths, 'archive', `archive ${options.name}`);
      try {
        if (!/^[a-f0-9]{64}$/u.test(options.expectedPreflightHash)) {
          throw new Error('Native Archive expected preflight must be a SHA-256 hash');
        }
        const now = options.now ?? new Date();
        const preflight = await inspectNativeArchivePreflight({
          paths: options.paths,
          name: options.name,
          now,
        });
        if (!preflight.ready || preflight.preflightHash !== options.expectedPreflightHash) {
          throw new NativeArchivePreflightError(preflight);
        }
        const state = await readNativeChange(options.paths, options.name);
        assertArchiveReady(state);
        await assertArchiveArtifacts(options.paths, state);
        const transactionId = randomUUID();
        const journal = await buildArchiveJournal({
          paths: options.paths,
          state,
          now,
          transactionId,
          preflight,
          hooks: options.hooks,
        });
        await createNativeArchiveTransactionV2(options.paths, journal);
        await options.hooks?.afterPrepared?.(journal);
        await continueArchive(options.paths, journal, options.hooks);
        return {
          archiveDir: archiveDirectoryFromJournal(options.paths, journal),
          transactionId,
          preflightHash: preflight.preflightHash,
        };
      } finally {
        await releaseNativeLock(lock);
      }
    }),
  );
}

export async function recoverArchiveTransaction(options: {
  paths: NativeProjectPaths;
  transactionId: string;
  strategy: 'continue' | 'rollback';
}): Promise<AnyArchiveTransactionJournal> {
  return withNativeMutationLock(
    options.paths,
    `recover archive ${options.transactionId}`,
    async () => {
      const lock = await acquireNativeLock(
        options.paths,
        'archive',
        `recover archive ${options.transactionId}`,
      );
      try {
        const generic = await readNativeTransaction(options.paths, options.transactionId);
        const journal: AnyArchiveTransactionJournal =
          (generic as unknown as { schema: string }).schema === 'comet.native.transaction.v2'
            ? await readNativeArchiveTransactionV2(options.paths, options.transactionId)
            : generic;
        assertMatchingJournal(options.paths, journal);
        if (journal.status === 'committed' || journal.status === 'rolled-back') return journal;
        return options.strategy === 'continue'
          ? continueArchive(options.paths, journal)
          : journal.schema === 'comet.native.transaction.v2'
            ? rollbackNativeArchiveTransactionV2(options.paths, journal)
            : rollbackNativeTransaction(options.paths, journal);
      } finally {
        await releaseNativeLock(lock);
      }
    },
    { allowedTransactionId: options.transactionId },
  );
}
