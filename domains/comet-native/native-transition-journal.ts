import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { readTrajectory } from '../engine/run-store.js';
import { NATIVE_RUN_STORAGE } from '../engine/storage-layout.js';
import { writeRunStateAt } from '../engine/storage-run.js';
import { atomicWriteJson } from './native-atomic-file.js';
import { nativeChangeDir, parseNativeChangeValue, writeNativeChange } from './native-change.js';
import {
  acquireNativeLock,
  diagnoseNativeLock,
  releaseNativeLock,
  type NativeLock,
} from './native-lock.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { resolveContainedNativePath } from './native-paths.js';
import { appendNativeTrajectoryEvent, writeNativeCheckpoint } from './native-trajectory.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
  NativeTransitionHooks,
  NativeTransitionJournal,
} from './native-types.js';

export function nativeTransitionJournalFile(paths: NativeProjectPaths, name: string): string {
  return path.join(nativeChangeDir(paths, name), 'runtime', 'transition.json');
}

function nativeTransitionLockName(name: string): string {
  return `transition-${name}`;
}

async function acquireNativeTransitionLock(
  paths: NativeProjectPaths,
  name: string,
  operation: string,
): Promise<NativeLock> {
  const lockName = nativeTransitionLockName(name);
  try {
    return await acquireNativeLock(paths, lockName, operation);
  } catch (error) {
    const file = path.join(paths.locksDir, `${lockName}.lock`);
    const diagnosis = await diagnoseNativeLock(file);
    if (diagnosis.status !== 'stale') throw error;
    await fs.rm(file, { force: true });
    return acquireNativeLock(paths, lockName, operation);
  }
}

export async function withNativeTransitionLock<T>(
  paths: NativeProjectPaths,
  name: string,
  operation: string,
  work: () => Promise<T>,
): Promise<T> {
  const lock = await acquireNativeTransitionLock(paths, name, operation);
  try {
    return await work();
  } finally {
    await releaseNativeLock(lock);
  }
}

function parseJournal(value: unknown, expectedName: string): NativeTransitionJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native transition journal must be an object');
  }
  const journal = value as Partial<NativeTransitionJournal>;
  if (journal.schema !== 'comet.native.transition.v1') {
    throw new Error('Unsupported Native transition journal schema');
  }
  if (journal.change !== expectedName) throw new Error('Native transition journal change mismatch');
  if (typeof journal.id !== 'string' || journal.id.length === 0) {
    throw new Error('Native transition journal id is invalid');
  }
  if (typeof journal.evidenceHash !== 'string' || !/^[a-f0-9]{64}$/u.test(journal.evidenceHash)) {
    throw new Error('Native transition journal evidence hash is invalid');
  }
  if (typeof journal.createdAt !== 'string' || Number.isNaN(Date.parse(journal.createdAt))) {
    throw new Error('Native transition journal timestamp is invalid');
  }
  const previousState = parseNativeChangeValue(journal.previousState);
  const nextState = parseNativeChangeValue(journal.nextState);
  if (previousState.name !== expectedName || nextState.name !== expectedName) {
    throw new Error('Native transition journal state mismatch');
  }
  if (!journal.nextRun || typeof journal.nextRun !== 'object') {
    throw new Error('Native transition journal next Run is invalid');
  }
  if (
    journal.nextRun.runId !== nextState.run_id ||
    journal.nextRun.currentStep !== nextState.phase
  ) {
    throw new Error('Native transition journal Run/state mismatch');
  }
  if (
    !journal.eventData ||
    typeof journal.eventData !== 'object' ||
    Array.isArray(journal.eventData)
  ) {
    throw new Error('Native transition journal event data is invalid');
  }
  return {
    schema: 'comet.native.transition.v1',
    id: journal.id,
    change: expectedName,
    evidenceHash: journal.evidenceHash,
    createdAt: journal.createdAt,
    previousState,
    nextState,
    previousRun: journal.previousRun ?? null,
    nextRun: journal.nextRun,
    eventData: journal.eventData,
  };
}

export async function inspectPendingNativeTransition(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeTransitionJournal | null> {
  const file = nativeTransitionJournalFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    return parseJournal(JSON.parse(await fs.readFile(file, 'utf8')), name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function prepareNativeTransition(options: {
  paths: NativeProjectPaths;
  previousState: NativeChangeState;
  nextState: NativeChangeState;
  previousRun: NativeTransitionJournal['previousRun'];
  nextRun: NativeTransitionJournal['nextRun'];
  evidenceHash: string;
  eventData: Record<string, unknown>;
  now?: Date;
  transitionId?: () => string;
}): Promise<NativeTransitionJournal> {
  const journal: NativeTransitionJournal = {
    schema: 'comet.native.transition.v1',
    id: options.transitionId?.() ?? randomUUID(),
    change: options.nextState.name,
    evidenceHash: options.evidenceHash,
    createdAt: (options.now ?? new Date()).toISOString(),
    previousState: options.previousState,
    nextState: options.nextState,
    previousRun: options.previousRun,
    nextRun: options.nextRun,
    eventData: options.eventData,
  };
  const file = nativeTransitionJournalFile(options.paths, journal.change);
  await resolveContainedNativePath(options.paths.nativeRoot, file);
  if (await inspectPendingNativeTransition(options.paths, journal.change)) {
    throw new Error(`Native transition recovery is already pending for ${journal.change}`);
  }
  await atomicWriteJson(file, journal);
  return journal;
}

export async function continueNativeTransitionLocked(
  paths: NativeProjectPaths,
  name: string,
  hooks?: NativeTransitionHooks,
): Promise<NativeChangeState | null> {
  const journal = await inspectPendingNativeTransition(paths, name);
  if (!journal) return null;
  const changeDir = nativeChangeDir(paths, name);
  await writeRunStateAt(changeDir, journal.nextRun, NATIVE_RUN_STORAGE);
  await hooks?.afterRunStateWritten?.(journal);
  await writeNativeChange(paths, journal.nextState);
  await hooks?.afterChangeStateWritten?.(journal);

  let trajectory = await readTrajectory(changeDir, journal.nextRun.trajectoryRef);
  if (journal.previousRun === null) {
    let started = trajectory.find(
      (item) => item.type === 'run_started' && item.data.transitionId === journal.id,
    );
    if (!started) {
      started = await appendNativeTrajectoryEvent({
        changeDir,
        run: journal.nextRun,
        type: 'run_started',
        data: {
          runtime: 'comet-native',
          phase: journal.previousState.phase,
          transitionId: journal.id,
        },
        now: new Date(journal.createdAt),
      });
      trajectory = [...trajectory, started];
    }
  }
  let event = trajectory.find(
    (item) => item.type === 'state_transitioned' && item.data.transitionId === journal.id,
  );
  if (!event) {
    event = await appendNativeTrajectoryEvent({
      changeDir,
      run: journal.nextRun,
      type: 'state_transitioned',
      data: { ...journal.eventData, transitionId: journal.id },
      now: new Date(journal.createdAt),
    });
  }
  await writeNativeCheckpoint({
    changeDir,
    run: journal.nextRun,
    trajectoryOffset: event.sequence,
    evidenceHash: journal.evidenceHash,
    now: new Date(journal.createdAt),
  });
  await fs.rm(nativeTransitionJournalFile(paths, name), { force: true });
  return journal.nextState;
}

export async function continueNativeTransition(
  paths: NativeProjectPaths,
  name: string,
  hooks?: NativeTransitionHooks,
): Promise<NativeChangeState | null> {
  return withNativeMutationLock(paths, `continue transition ${name}`, () =>
    withNativeTransitionLock(paths, name, `continue transition ${name}`, () =>
      continueNativeTransitionLocked(paths, name, hooks),
    ),
  );
}
