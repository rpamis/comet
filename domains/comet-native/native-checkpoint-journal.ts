import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';

import { compareAndSwapNativeChangeLocked } from './native-change.js';
import {
  nativeCheckpointJournalFile,
  readNativeCheckpointJournal,
  writeNativeCheckpointJournal,
  writeNativeCheckpointManifest,
  writeNativeProgressCheckpoint,
} from './native-checkpoint-storage.js';
import type {
  NativeChangeState,
  NativeCheckpointHooks,
  NativeCheckpointJournal,
  NativeCheckpointManifest,
  NativeProgressCheckpoint,
  NativeProjectPaths,
} from './native-types.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import {
  continueNativeTransitionLocked,
  withNativeTransitionLock,
} from './native-transition-journal.js';

export async function prepareNativeCheckpointJournal(options: {
  paths: NativeProjectPaths;
  previousState: NativeChangeState;
  nextState: NativeChangeState;
  checkpoint: NativeProgressCheckpoint;
  manifest: NativeCheckpointManifest;
  now?: Date;
  checkpointId?: () => string;
}): Promise<NativeCheckpointJournal> {
  const createdAt = (options.now ?? new Date()).toISOString();
  const id = options.checkpointId?.() ?? randomUUID();
  const checkpoint: NativeProgressCheckpoint = {
    ...options.checkpoint,
    id,
    createdAt,
  };
  const journal: NativeCheckpointJournal = {
    schema: 'comet.native.checkpoint-journal.v1',
    id,
    change: options.previousState.name,
    inputHash: checkpoint.inputHash,
    createdAt,
    previousState: options.previousState,
    nextState: options.nextState,
    checkpoint,
    manifest: options.manifest,
  };
  await writeNativeCheckpointManifest(options.paths, options.previousState.name, options.manifest);
  await writeNativeCheckpointJournal(options.paths, journal);
  return journal;
}

export async function continueNativeCheckpointLocked(
  paths: NativeProjectPaths,
  name: string,
  hooks?: NativeCheckpointHooks,
): Promise<NativeCheckpointJournal | null> {
  const journal = await readNativeCheckpointJournal(paths, name);
  if (!journal) return null;
  const manifestHash = await writeNativeCheckpointManifest(paths, journal.change, journal.manifest);
  if (manifestHash !== journal.checkpoint.manifestHash) {
    throw new Error('Native checkpoint recovery manifest hash mismatch');
  }
  await compareAndSwapNativeChangeLocked(paths, journal.nextState, journal.previousState.revision, {
    allowPendingCheckpointRecovery: true,
  });
  await hooks?.afterStateWritten?.(journal);
  await writeNativeProgressCheckpoint(paths, journal.checkpoint);
  await hooks?.afterProgressWritten?.(journal);
  await fs.rm(nativeCheckpointJournalFile(paths, name), { force: true });
  return journal;
}

export async function continueNativeCheckpoint(
  paths: NativeProjectPaths,
  name: string,
  hooks?: NativeCheckpointHooks,
): Promise<NativeCheckpointJournal | null> {
  return withNativeMutationLock(paths, `continue checkpoint ${name}`, () =>
    withNativeTransitionLock(paths, name, `continue checkpoint ${name}`, async () => {
      await continueNativeTransitionLocked(paths, name);
      return continueNativeCheckpointLocked(paths, name, hooks);
    }),
  );
}
