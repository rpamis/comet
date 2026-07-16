import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { readTrajectory } from '../engine/run-store.js';
import { NATIVE_RUN_STORAGE } from '../engine/storage-layout.js';
import { writeRunStateAt } from '../engine/storage-run.js';
import { atomicWriteJson } from './native-atomic-file.js';
import {
  hasPendingNativeSchemaMigration,
  compareAndSwapNativeChangeLocked,
  nativeChangeDir,
  parseLegacyNativeChangeValue,
  parseNativeChangeValue,
} from './native-change.js';
import {
  acquireNativeLock,
  diagnoseNativeLock,
  releaseNativeLock,
  type NativeLock,
} from './native-lock.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { resolveContainedNativePath } from './native-paths.js';
import { appendNativeTrajectoryEvent, writeNativeCheckpoint } from './native-trajectory.js';
import { assertNativeTrajectoryHealthy } from './native-trajectory-recovery.js';
import type {
  NativeChangeState,
  NativeLegacyTransitionJournal,
  NativeProjectPaths,
  NativeTransitionHooks,
  NativeTransitionJournal,
  NativeTransitionSchemaInspection,
} from './native-types.js';
import {
  NATIVE_LEGACY_TRANSITION_SCHEMA,
  NATIVE_RUNTIME_PROTOCOL_VERSION,
  NATIVE_TRANSITION_SCHEMA,
} from './native-types.js';

const COMMON_JOURNAL_KEYS = [
  'schema',
  'id',
  'change',
  'evidenceHash',
  'createdAt',
  'previousState',
  'nextState',
  'previousRun',
  'nextRun',
  'eventData',
] as const;
const LEGACY_JOURNAL_KEYS = new Set<string>(COMMON_JOURNAL_KEYS);
const CURRENT_JOURNAL_KEYS = new Set<string>([
  ...COMMON_JOURNAL_KEYS,
  'minimum_runtime_version',
  'revision',
]);

export class NativeTransitionMigrationRequiredError extends Error {
  readonly code = 'native-transition-migration-required';

  constructor(readonly change: string) {
    super(`Native transition for ${change} requires doctor migration before recovery`);
    this.name = 'NativeTransitionMigrationRequiredError';
  }
}

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

function journalRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native transition journal must be an object');
  }
  return value as Record<string, unknown>;
}

function rejectUnknownJournalFields(journal: Record<string, unknown>, known: Set<string>): void {
  const unknown = Object.keys(journal).find((key) => !known.has(key));
  if (unknown) throw new Error(`Native transition journal contains unknown field: ${unknown}`);
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value as number;
}

function validateJournalEnvelope(
  journal: Record<string, unknown>,
  expectedName: string,
): {
  id: string;
  evidenceHash: string;
  createdAt: string;
  previousRun: NativeTransitionJournal['previousRun'];
  nextRun: NativeTransitionJournal['nextRun'];
  eventData: Record<string, unknown>;
} {
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
  if (!journal.nextRun || typeof journal.nextRun !== 'object') {
    throw new Error('Native transition journal next Run is invalid');
  }
  if (
    !journal.eventData ||
    typeof journal.eventData !== 'object' ||
    Array.isArray(journal.eventData)
  ) {
    throw new Error('Native transition journal event data is invalid');
  }
  if (
    journal.previousRun !== null &&
    (typeof journal.previousRun !== 'object' || Array.isArray(journal.previousRun))
  ) {
    throw new Error('Native transition journal previous Run is invalid');
  }
  return {
    id: journal.id,
    evidenceHash: journal.evidenceHash,
    createdAt: journal.createdAt,
    previousRun: (journal.previousRun ?? null) as NativeTransitionJournal['previousRun'],
    nextRun: journal.nextRun as NativeTransitionJournal['nextRun'],
    eventData: journal.eventData as Record<string, unknown>,
  };
}

export function parseNativeTransitionJournalValue(
  value: unknown,
  expectedName: string,
): NativeTransitionJournal {
  const journal = journalRecord(value);
  rejectUnknownJournalFields(journal, CURRENT_JOURNAL_KEYS);
  if (journal.schema !== NATIVE_TRANSITION_SCHEMA) {
    throw new Error(`Expected Native transition schema ${NATIVE_TRANSITION_SCHEMA}`);
  }
  const minimumRuntimeVersion = positiveInteger(
    journal.minimum_runtime_version,
    'Native transition minimum_runtime_version',
  );
  if (minimumRuntimeVersion > NATIVE_RUNTIME_PROTOCOL_VERSION) {
    throw new Error(
      `Native transition requires runtime protocol ${minimumRuntimeVersion}; current protocol is ${NATIVE_RUNTIME_PROTOCOL_VERSION}`,
    );
  }
  if (minimumRuntimeVersion !== NATIVE_RUNTIME_PROTOCOL_VERSION) {
    throw new Error(
      `Native transition ${NATIVE_TRANSITION_SCHEMA} minimum_runtime_version must be ${NATIVE_RUNTIME_PROTOCOL_VERSION}`,
    );
  }
  const revision = positiveInteger(journal.revision, 'Native transition revision');
  if (revision !== 1) throw new Error('Native transition journal revision must be 1');
  const envelope = validateJournalEnvelope(journal, expectedName);
  const previousState = parseNativeChangeValue(journal.previousState);
  const nextState = parseNativeChangeValue(journal.nextState);
  if (previousState.name !== expectedName || nextState.name !== expectedName) {
    throw new Error('Native transition journal state mismatch');
  }
  if (
    envelope.nextRun.runId !== nextState.run_id ||
    envelope.nextRun.currentStep !== nextState.phase ||
    nextState.revision !== previousState.revision + 1
  ) {
    throw new Error('Native transition journal Run/state mismatch');
  }
  return {
    schema: NATIVE_TRANSITION_SCHEMA,
    minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
    revision,
    id: envelope.id,
    change: expectedName,
    evidenceHash: envelope.evidenceHash,
    createdAt: envelope.createdAt,
    previousState,
    nextState,
    previousRun: envelope.previousRun,
    nextRun: envelope.nextRun,
    eventData: envelope.eventData,
  };
}

export function parseLegacyNativeTransitionJournalValue(
  value: unknown,
  expectedName: string,
): NativeLegacyTransitionJournal {
  const journal = journalRecord(value);
  rejectUnknownJournalFields(journal, LEGACY_JOURNAL_KEYS);
  if (journal.schema !== NATIVE_LEGACY_TRANSITION_SCHEMA) {
    throw new Error(`Expected Native transition schema ${NATIVE_LEGACY_TRANSITION_SCHEMA}`);
  }
  const envelope = validateJournalEnvelope(journal, expectedName);
  const previousState = parseLegacyNativeChangeValue(journal.previousState);
  const nextState = parseLegacyNativeChangeValue(journal.nextState);
  if (previousState.name !== expectedName || nextState.name !== expectedName) {
    throw new Error('Native transition journal state mismatch');
  }
  if (
    envelope.nextRun.runId !== nextState.run_id ||
    envelope.nextRun.currentStep !== nextState.phase
  ) {
    throw new Error('Native transition journal Run/state mismatch');
  }
  return {
    schema: NATIVE_LEGACY_TRANSITION_SCHEMA,
    id: envelope.id,
    change: expectedName,
    evidenceHash: envelope.evidenceHash,
    createdAt: envelope.createdAt,
    previousState,
    nextState,
    previousRun: envelope.previousRun,
    nextRun: envelope.nextRun,
    eventData: envelope.eventData,
  };
}

export function inspectNativeTransitionJournalValue(
  value: unknown,
  expectedName: string,
): NativeTransitionSchemaInspection {
  const journal = journalRecord(value);
  if (journal.schema === NATIVE_TRANSITION_SCHEMA) {
    return { status: 'current', journal: parseNativeTransitionJournalValue(journal, expectedName) };
  }
  if (journal.schema === NATIVE_LEGACY_TRANSITION_SCHEMA) {
    return {
      status: 'migration-required',
      journal: parseLegacyNativeTransitionJournalValue(journal, expectedName),
    };
  }
  throw new Error(`Unsupported Native transition journal schema: ${String(journal.schema)}`);
}

export async function inspectPendingNativeTransitionSchema(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeTransitionSchemaInspection | null> {
  const file = nativeTransitionJournalFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    return inspectNativeTransitionJournalValue(JSON.parse(await fs.readFile(file, 'utf8')), name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function inspectPendingNativeTransition(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeTransitionJournal | null> {
  const inspection = await inspectPendingNativeTransitionSchema(paths, name);
  if (!inspection) return null;
  if (inspection.status === 'migration-required') {
    throw new NativeTransitionMigrationRequiredError(name);
  }
  return inspection.journal;
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
  if (await hasPendingNativeSchemaMigration(options.paths, options.nextState.name)) {
    throw new Error(
      `Native schema migration is incomplete for ${options.nextState.name}; run doctor --repair`,
    );
  }
  await assertNativeTrajectoryHealthy(options.paths, options.nextState.name);
  const journal: NativeTransitionJournal = {
    schema: NATIVE_TRANSITION_SCHEMA,
    minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
    revision: 1,
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
  if (await hasPendingNativeSchemaMigration(paths, name)) {
    throw new Error(`Native schema migration is incomplete for ${name}; run doctor --repair`);
  }
  await assertNativeTrajectoryHealthy(paths, name);
  const journal = await inspectPendingNativeTransition(paths, name);
  if (!journal) return null;
  const changeDir = nativeChangeDir(paths, name);
  await writeRunStateAt(changeDir, journal.nextRun, NATIVE_RUN_STORAGE);
  await hooks?.afterRunStateWritten?.(journal);
  await compareAndSwapNativeChangeLocked(paths, journal.nextState, journal.previousState.revision);
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
