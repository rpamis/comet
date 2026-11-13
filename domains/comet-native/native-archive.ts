import path from 'path';
import { isDeepStrictEqual } from 'util';
import { decideWithResolver, recordOutcomeWithResolver } from '../engine/loop.js';
import {
  readNativeRunState,
  readNativeTrajectory,
  writeNativeRunState,
} from './native-run-store.js';
import { inspectNativeArchiveContent } from './native-archive-content.js';
import {
  applyNativeArchiveTransactionV2,
  finalizeNativeArchiveTransactionV2,
  readNativeArchiveTransactionV2,
  rollbackNativeArchiveTransactionV2,
  type NativeArchiveTransactionHooksV2,
} from './native-archive-transaction.js';
import {
  NATIVE_CHANGE_STATE_FILE,
  readNativeChange,
  readNativeChangeFile,
  writeNativeChangeFile,
} from './native-change.js';
import { sha256Text } from './native-hash.js';

import { withNativeMutation } from './native-mutation.js';
import { nativeChangeRuntimeDir } from './native-paths.js';
import { NATIVE_RUNTIME_PACKAGE, nativePhaseResolver } from './native-runtime-package.js';
import { clearNativeSelectionIfLocked } from './native-selection.js';
import {
  applyNativeTransaction,
  finalizeNativeTransaction,
  readNativeTransaction,
  readNativeTransactionEvents,
  rollbackNativeTransaction,
  type NativeArchiveTransactionJournalV2,
} from './native-transaction.js';
import { appendNativeTrajectoryEvent, writeNativeCheckpoint } from './native-trajectory.js';
import type { NativeProjectPaths, NativeTransactionJournal } from './native-types.js';
type AnyArchiveTransactionJournal = NativeTransactionJournal | NativeArchiveTransactionJournalV2;
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
  const runtimeDir = nativeChangeRuntimeDir(paths, state.name);
  const run = await readNativeRunState(runtimeDir);
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
  const trajectory = await readNativeTrajectory(runtimeDir, completed.trajectoryRef);
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
      changeDir: runtimeDir,
      run: completed,
      type: 'state_transitioned',
      data: eventData,
      ...(journal.schema === 'comet.native.transaction.v2'
        ? { now: new Date(journal.createdAt) }
        : {}),
    });
  }
  await writeNativeCheckpoint({
    changeDir: runtimeDir,
    run: completed,
    trajectoryOffset: event.sequence,
    evidenceHash,
    ...(journal.schema === 'comet.native.transaction.v2'
      ? { now: new Date(journal.createdAt) }
      : {}),
  });
  await writeNativeRunState(runtimeDir, completed);
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
    const applied = await applyNativeArchiveTransactionV2(paths, journal, {
      ...hooks,
      beforeArchiveChangeMove: async (operation) => {
        await hooks?.beforeArchiveChangeMove?.(operation);
        const state = await readNativeChange(paths, journal.change);
        if (state.phase !== 'archive' || state.archived || state.verification_result !== 'pass')
          throw new Error(
            'Legacy Archive state changed; preserve the original transaction and approved materials',
          );
      },
    });
    await finalizeArchive(paths, applied, hooks);
    const committed = await finalizeNativeArchiveTransactionV2(paths, applied, 'commit');
    return committed;
  }
  const applied = await applyNativeTransaction(paths, journal);
  await finalizeArchive(paths, applied, hooks);
  const committed = await finalizeNativeTransaction(paths, applied, 'commit');
  return committed;
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
export async function recoverArchiveTransaction(options: {
  paths: NativeProjectPaths;
  transactionId: string;
  strategy: 'continue' | 'rollback';
}): Promise<AnyArchiveTransactionJournal> {
  return withNativeMutation(
    options.paths,
    async () => {
      const generic = await readNativeTransaction(options.paths, options.transactionId);
      const journal: AnyArchiveTransactionJournal =
        (
          generic as unknown as {
            schema: string;
          }
        ).schema === 'comet.native.transaction.v2'
          ? await readNativeArchiveTransactionV2(options.paths, options.transactionId)
          : generic;
      assertMatchingJournal(options.paths, journal);
      if (journal.status === 'committed') {
        return journal;
      }
      if (journal.status === 'rolled-back') return journal;
      return options.strategy === 'continue'
        ? await continueArchive(options.paths, journal)
        : journal.schema === 'comet.native.transaction.v2'
          ? rollbackNativeArchiveTransactionV2(options.paths, journal)
          : rollbackNativeTransaction(options.paths, journal);
    },
    { allowedTransactionId: options.transactionId },
  );
}
