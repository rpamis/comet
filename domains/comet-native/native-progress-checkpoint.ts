import { randomUUID } from 'crypto';

import { NativeChangeRevisionConflictError, readNativeChange } from './native-change.js';
import { settleNativeChangeJournalsLocked } from './native-change-recovery.js';
import {
  continueNativeCheckpointLocked,
  prepareNativeCheckpointJournal,
} from './native-checkpoint-journal.js';
import {
  createNativeCheckpointManifest,
  hashNativeCheckpointManifest,
  nativeCheckpointManifestRef,
  readNativeProgressCheckpoint,
} from './native-checkpoint-storage.js';
import { nativeContinuation } from './native-continuation.js';
import { sha256Text } from './native-hash.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { redactNativeCredentialText } from './native-redaction.js';
import { withNativeTransitionLock } from './native-transition-journal.js';
import type {
  NativeCheckpointHooks,
  NativeCheckpointResult,
  NativeProgressCheckpoint,
  NativeProjectPaths,
} from './native-types.js';

function requiredText(value: string, label: string): string {
  const normalized = redactNativeCredentialText(value).trim();
  if (normalized.length === 0 || normalized.length > 2_000) {
    throw new Error(`${label} must be between 1 and 2000 characters`);
  }
  return normalized;
}

function expectedRevisionValue(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Native expected revision must be a positive integer');
  }
  return value;
}

export async function checkpointNativeChange(options: {
  paths: NativeProjectPaths;
  name: string;
  summary: string;
  nextAction: string;
  artifacts?: readonly string[];
  expectedRevision?: number;
  now?: Date;
  checkpointId?: () => string;
  hooks?: NativeCheckpointHooks;
}): Promise<NativeCheckpointResult> {
  const summary = requiredText(options.summary, 'Checkpoint summary');
  const nextAction = requiredText(options.nextAction, 'Checkpoint next action');
  const expectedRevision = expectedRevisionValue(options.expectedRevision);
  return withNativeMutationLock(options.paths, `checkpoint ${options.name}`, () =>
    withNativeTransitionLock(
      options.paths,
      options.name,
      `checkpoint ${options.name}`,
      async () => {
        await settleNativeChangeJournalsLocked(options.paths, options.name);
        const state = await readNativeChange(options.paths, options.name);
        const manifest = await createNativeCheckpointManifest(
          options.paths,
          options.name,
          options.artifacts ?? [],
        );
        const manifestHash = hashNativeCheckpointManifest(manifest);
        const inputHash = sha256Text(
          JSON.stringify({
            summary,
            nextAction,
            artifacts: manifest.artifacts,
          }),
        );
        const existing = await readNativeProgressCheckpoint(options.paths, options.name);
        if (
          existing?.inputHash === inputHash &&
          existing.stateRevision === state.revision &&
          existing.phase === state.phase
        ) {
          if (
            expectedRevision !== undefined &&
            expectedRevision !== existing.previousRevision &&
            expectedRevision !== state.revision
          ) {
            throw new NativeChangeRevisionConflictError(
              state.name,
              expectedRevision,
              state.revision,
            );
          }
          return {
            change: state,
            checkpoint: existing,
            idempotent: true,
            expectedRevision: expectedRevision ?? existing.previousRevision,
            previousRevision: existing.previousRevision,
            revision: state.revision,
            outcome: 'idempotent',
            continuation: nativeContinuation({ state }),
          };
        }
        if (expectedRevision !== undefined && state.revision !== expectedRevision) {
          throw new NativeChangeRevisionConflictError(state.name, expectedRevision, state.revision);
        }
        const nextState = { ...state, revision: state.revision + 1 };
        const checkpoint: NativeProgressCheckpoint = {
          schema: 'comet.native.progress-checkpoint.v1',
          id: options.checkpointId?.() ?? randomUUID(),
          change: state.name,
          phase: state.phase,
          previousRevision: state.revision,
          stateRevision: nextState.revision,
          summary,
          nextAction,
          inputHash,
          manifestHash,
          manifestRef: nativeCheckpointManifestRef(manifestHash),
          artifactCount: manifest.artifacts.length,
          createdAt: (options.now ?? new Date()).toISOString(),
        };
        const journal = await prepareNativeCheckpointJournal({
          paths: options.paths,
          previousState: state,
          nextState,
          checkpoint,
          manifest,
          now: options.now,
          checkpointId: () => checkpoint.id,
        });
        await options.hooks?.afterPrepared?.(journal);
        const persisted = await continueNativeCheckpointLocked(
          options.paths,
          options.name,
          options.hooks,
        );
        if (!persisted) throw new Error('Native checkpoint journal disappeared before completion');
        return {
          change: persisted.nextState,
          checkpoint: persisted.checkpoint,
          idempotent: false,
          expectedRevision: expectedRevision ?? persisted.checkpoint.previousRevision,
          previousRevision: persisted.checkpoint.previousRevision,
          revision: persisted.nextState.revision,
          outcome: 'recorded',
          continuation: nativeContinuation({ state: persisted.nextState }),
        };
      },
    ),
  );
}
