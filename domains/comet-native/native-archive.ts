import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { decideWithResolver, recordOutcomeWithResolver } from '../engine/loop.js';
import { readTrajectory } from '../engine/run-store.js';
import { NATIVE_RUN_STORAGE } from '../engine/storage-layout.js';
import { readRunStateAt, writeRunStateAt } from '../engine/storage-run.js';
import {
  canonicalSpecPath,
  resolveNativeArtifactFile,
  validateNativeBrief,
  validateNativeVerification,
} from './native-artifacts.js';
import {
  nativeChangeDir,
  readNativeChange,
  readNativeChangeFile,
  writeNativeChangeFile,
} from './native-change.js';
import { sha256File, sha256Text } from './native-hash.js';
import { acquireNativeLock, releaseNativeLock } from './native-lock.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { resolveContainedNativePath } from './native-paths.js';
import { NATIVE_RUNTIME_PACKAGE, nativePhaseResolver } from './native-runtime-package.js';
import { clearNativeSelectionIfLocked } from './native-selection.js';
import {
  applyNativeTransaction,
  createNativeTransaction,
  finalizeNativeTransaction,
  nativeRootRef,
  readNativeTransaction,
  readNativeTransactionEvents,
  resolveNativeTransactionPaths,
  rollbackNativeTransaction,
} from './native-transaction.js';
import { appendNativeTrajectoryEvent, writeNativeCheckpoint } from './native-trajectory.js';
import {
  continueNativeTransitionLocked,
  withNativeTransitionLock,
} from './native-transition-journal.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
  NativeSpecChange,
  NativeTransactionHooks,
  NativeTransactionJournal,
  NativeTransactionOperation,
} from './native-types.js';

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
}): Promise<NativeTransactionJournal> {
  const { paths, state, now, transactionId } = options;
  const target = archiveTarget(paths, state.name, now);
  if (await pathExists(target)) throw new Error(`Native archive target already exists: ${target}`);

  const tx = await resolveNativeTransactionPaths(paths, transactionId);
  const operations: NativeTransactionOperation[] = [];
  for (const [index, change] of state.spec_changes.entries()) {
    await assertSpecBase(paths, change);
    const canonical = canonicalSpecPath(paths, change.capability);
    const backup = path.join(tx.backups, 'specs', change.capability, 'spec.md');
    if (change.operation === 'remove') {
      operations.push({
        id: `spec-${index + 1}-${change.capability}`,
        type: 'remove',
        target: nativeRootRef(paths, canonical),
        backup: nativeRootRef(paths, backup),
      });
      continue;
    }
    const source = await resolveNativeArtifactFile(
      nativeChangeDir(paths, state.name),
      change.source!,
    );
    const staged = path.join(tx.staged, 'specs', change.capability, 'spec.md');
    await fs.mkdir(path.dirname(staged), { recursive: true });
    await fs.copyFile(source, staged);
    const [sourceHash, stagedHash] = await Promise.all([sha256File(source), sha256File(staged)]);
    if (sourceHash !== stagedHash) throw new Error(`Failed to stage spec ${change.capability}`);
    operations.push({
      id: `spec-${index + 1}-${change.capability}`,
      type: 'write',
      target: nativeRootRef(paths, canonical),
      staged: nativeRootRef(paths, staged),
      ...(change.operation === 'replace' ? { backup: nativeRootRef(paths, backup) } : {}),
    });
  }
  operations.push({
    id: 'archive-change',
    type: 'move',
    source: nativeRootRef(paths, nativeChangeDir(paths, state.name)),
    target: nativeRootRef(paths, target),
  });
  return {
    schema: 'comet.native.transaction.v1',
    id: transactionId,
    kind: 'archive',
    status: 'prepared',
    projectRoot: paths.projectRoot,
    nativeRoot: paths.nativeRoot,
    change: state.name,
    createdAt: now.toISOString(),
    operations,
  };
}

function archiveDirectoryFromJournal(
  paths: NativeProjectPaths,
  journal: NativeTransactionJournal,
): string {
  const operation = journal.operations.find((item) => item.id === 'archive-change');
  if (!operation || operation.type !== 'move') {
    throw new Error(`Archive transaction ${journal.id} has no archive move`);
  }
  return path.resolve(paths.nativeRoot, ...operation.target.split('/'));
}

async function finalizeArchive(
  paths: NativeProjectPaths,
  journal: NativeTransactionJournal,
): Promise<void> {
  const events = await readNativeTransactionEvents(paths, journal.id);
  if (events.some((event) => event.type === 'archive-finalized')) return;
  if (!events.some((event) => event.type === 'archive-finalization-started')) {
    await finalizeNativeTransaction(paths, journal, 'archive-finalization-started');
  }
  const archiveDir = archiveDirectoryFromJournal(paths, journal);
  const stateFile = path.join(archiveDir, 'change.yaml');
  const state = await readNativeChangeFile(stateFile);
  if (!journal.change || state.name !== journal.change) {
    throw new Error(`Archive transaction ${journal.id} change mismatch`);
  }
  const run = await readRunStateAt(archiveDir, NATIVE_RUN_STORAGE);
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
  const updated = { ...state, archived: true };
  await writeNativeChangeFile(stateFile, updated);
  const trajectory = await readTrajectory(archiveDir, completed.trajectoryRef);
  let event = trajectory.find(
    (item) => item.type === 'state_transitioned' && item.data.transactionId === journal.id,
  );
  if (!event) {
    event = await appendNativeTrajectoryEvent({
      changeDir: archiveDir,
      run: completed,
      type: 'state_transitioned',
      data: {
        previousPhase: 'archive',
        nextPhase: null,
        evidenceHash,
        summary: `Archived Native change ${state.name}`,
        transactionId: journal.id,
      },
    });
  }
  await writeNativeCheckpoint({
    changeDir: archiveDir,
    run: completed,
    trajectoryOffset: event.sequence,
    evidenceHash,
  });
  await writeRunStateAt(archiveDir, completed, NATIVE_RUN_STORAGE);
  await clearNativeSelectionIfLocked(paths, state.name);
  await finalizeNativeTransaction(paths, journal, 'archive-finalized');
}

async function continueArchive(
  paths: NativeProjectPaths,
  journal: NativeTransactionJournal,
  hooks?: NativeTransactionHooks,
): Promise<NativeTransactionJournal> {
  const applied = await applyNativeTransaction(paths, journal, hooks);
  await finalizeArchive(paths, applied);
  return finalizeNativeTransaction(paths, applied, 'commit');
}

function assertMatchingJournal(paths: NativeProjectPaths, journal: NativeTransactionJournal): void {
  if (journal.kind !== 'archive') throw new Error(`Transaction ${journal.id} is not an archive`);
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
  now?: Date;
  hooks?: NativeTransactionHooks;
}): Promise<{ archiveDir: string; transactionId: string }> {
  return withNativeMutationLock(options.paths, `archive ${options.name}`, () =>
    withNativeTransitionLock(options.paths, options.name, `archive ${options.name}`, async () => {
      await continueNativeTransitionLocked(options.paths, options.name);
      const lock = await acquireNativeLock(options.paths, 'archive', `archive ${options.name}`);
      try {
        const state = await readNativeChange(options.paths, options.name);
        assertArchiveReady(state);
        await assertArchiveArtifacts(options.paths, state);
        const now = options.now ?? new Date();
        const transactionId = randomUUID();
        const journal = await buildArchiveJournal({
          paths: options.paths,
          state,
          now,
          transactionId,
        });
        await createNativeTransaction(options.paths, journal);
        await options.hooks?.afterPrepared?.(journal);
        await continueArchive(options.paths, journal, options.hooks);
        return { archiveDir: archiveDirectoryFromJournal(options.paths, journal), transactionId };
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
}): Promise<NativeTransactionJournal> {
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
        const journal = await readNativeTransaction(options.paths, options.transactionId);
        assertMatchingJournal(options.paths, journal);
        if (journal.status === 'committed' || journal.status === 'rolled-back') return journal;
        return options.strategy === 'continue'
          ? continueArchive(options.paths, journal)
          : rollbackNativeTransaction(options.paths, journal);
      } finally {
        await releaseNativeLock(lock);
      }
    },
    { allowedTransactionId: options.transactionId },
  );
}
