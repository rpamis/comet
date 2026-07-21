import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { isDeepStrictEqual } from 'util';
import { stringify } from 'yaml';

import type { RunState } from '../engine/types.js';
import { atomicWriteJson, atomicWriteText } from './native-atomic-file.js';
import {
  hasPendingNativeCheckpointRecovery,
  inspectNativeChange,
  NativeBaselineIncompleteError,
  NATIVE_CHANGE_STATE_FILE,
  nativeChangeDir,
  nativeChangeDocument,
  nativeV2ChangeDocument,
  parseNativeChangeValue,
  parseV2NativeChangeValue,
} from './native-change.js';
import { sha256File, sha256Text } from './native-hash.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { resolveContainedNativePath } from './native-paths.js';
import { readNativeProtectedTextFile } from './native-protected-file.js';
import { NATIVE_RUNTIME_HASH, NATIVE_RUNTIME_PACKAGE } from './native-runtime-package.js';
import {
  parseNativeStoredRunStateValue,
  readNativeCheckpoint,
  readNativeRunState,
  readNativeTrajectory,
  writeNativeRunState,
} from './native-run-store.js';
import {
  createNativeContentSnapshot,
  filterNativeContentSnapshotToProjectScope,
  inspectNativeContentSnapshotHealth,
  readNativeBaselineManifest,
  writeNativeBaselineManifest,
} from './native-snapshot.js';
import { appendNativeTrajectoryEvent, writeNativeCheckpoint } from './native-trajectory.js';
import {
  inspectPendingNativeTransitionSchema,
  nativeTransitionJournalFile,
  parseNativeTransitionJournalValue,
  parseV2NativeTransitionJournalValue,
  withNativeTransitionLock,
} from './native-transition-journal.js';
import type {
  NativeChangeState,
  NativeLegacyChangeState,
  NativeLegacyTransitionJournal,
  NativeProjectPaths,
  NativeReadableChangeState,
  NativeSchemaMigrationHooks,
  NativeSchemaMigrationJournal,
  NativeTransitionJournal,
  NativeV2ChangeState,
  NativeV2TransitionJournal,
} from './native-types.js';
import {
  NATIVE_CHANGE_SCHEMA,
  NATIVE_LEGACY_CHANGE_SCHEMA,
  NATIVE_LEGACY_TRANSITION_SCHEMA,
  NATIVE_RUNTIME_PROTOCOL_VERSION,
  NATIVE_TRANSITION_SCHEMA,
  NATIVE_V2_CHANGE_SCHEMA,
  NATIVE_V2_TRANSITION_SCHEMA,
} from './native-types.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MIGRATION_JOURNAL_KEYS = new Set([
  'schema',
  'id',
  'change',
  'fromSchema',
  'toSchema',
  'sourceHash',
  'targetHash',
  'createdAt',
  'nextState',
  'transition',
  'transitionSupersede',
  'runRetreat',
]);
const MIGRATION_TRANSITION_KEYS = new Set(['sourceHash', 'targetHash', 'nextJournal']);
const MIGRATION_TRANSITION_SUPERSEDE_KEYS = new Set([
  'sourceHash',
  'transitionId',
  'previousRun',
  'nextRun',
  'evidenceHash',
  'eventData',
]);
const MIGRATION_SUPERSEDE_EVENT_KEYS = new Set([
  'fromSchema',
  'toSchema',
  'previousPhase',
  'nextPhase',
  'reason',
  'supersededTransitionId',
]);
const MIGRATION_RUN_RETREAT_KEYS = new Set(['previousRun', 'nextRun', 'evidenceHash', 'eventData']);

function rejectUnknownFields(
  value: Record<string, unknown>,
  keys: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown) throw new Error(`${label} contains unknown field: ${unknown}`);
}

function transitionContent(journal: NativeV2TransitionJournal | NativeTransitionJournal): string {
  return JSON.stringify(journal, null, 2) + '\n';
}

function migrationStateDocument(
  state: NativeV2ChangeState | NativeChangeState,
): Record<string, unknown> {
  return state.schema === NATIVE_V2_CHANGE_SCHEMA
    ? nativeV2ChangeDocument(state)
    : nativeChangeDocument(state);
}

function upgradeV1StateToV2(state: NativeLegacyChangeState, revision: number): NativeV2ChangeState {
  return {
    ...state,
    schema: NATIVE_V2_CHANGE_SCHEMA,
    minimum_runtime_version: 2,
    revision,
  };
}

function upgradeV1TransitionToV2(
  journal: NativeLegacyTransitionJournal,
): NativeV2TransitionJournal {
  return {
    ...journal,
    schema: NATIVE_V2_TRANSITION_SCHEMA,
    minimum_runtime_version: 2,
    revision: 1,
    previousState: upgradeV1StateToV2(journal.previousState, 1),
    nextState: upgradeV1StateToV2(journal.nextState, 2),
  };
}

function upgradeV2StateToV3(
  state: NativeV2ChangeState,
  options?: { retreatEvidencePhase?: boolean; incrementRetreatRevision?: boolean },
): NativeChangeState {
  const retreat =
    options?.retreatEvidencePhase === true &&
    (state.phase === 'verify' || state.phase === 'archive');
  return {
    ...state,
    schema: NATIVE_CHANGE_SCHEMA,
    minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
    revision: state.revision + (retreat && options?.incrementRetreatRevision ? 1 : 0),
    phase: retreat ? 'build' : state.phase,
    verification_result: retreat ? 'pending' : state.verification_result,
    verification_report: retreat ? null : state.verification_report,
    approved_contract_hash: null,
    implementation_scope: null,
    verification_evidence: null,
    partial_allowance: null,
    archived: retreat ? false : state.archived,
  };
}

function upgradeV2TransitionToV3(journal: NativeV2TransitionJournal): NativeTransitionJournal {
  if (journal.nextState.phase === 'archive') {
    throw new Error('Native v2 Archive transition must be superseded by schema migration');
  }
  const specRebase =
    journal.previousState.phase !== 'shape' &&
    journal.nextState.phase === 'build' &&
    journal.eventData.verificationResult === null;
  const evidenceHash = specRebase
    ? sha256Text(
        JSON.stringify({
          operation: 'spec-rebase',
          change: journal.change,
          summary: journal.eventData.summary,
          specChanges: journal.nextState.spec_changes,
        }),
      )
    : journal.evidenceHash;
  return {
    ...journal,
    schema: NATIVE_TRANSITION_SCHEMA,
    minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
    revision: 1,
    operation: specRebase ? 'spec-rebase' : 'advance',
    evidenceHash,
    previousState: upgradeV2StateToV3(journal.previousState),
    nextState: {
      ...upgradeV2StateToV3(journal.nextState),
      ...(specRebase
        ? {
            implementation_scope: null,
            verification_evidence: null,
            partial_allowance: null,
          }
        : {}),
    },
    eventData: { ...journal.eventData, evidenceHash },
    nextRun:
      journal.previousRun === null
        ? {
            ...journal.nextRun,
            skillVersion: NATIVE_RUNTIME_PACKAGE.definition.metadata.version,
            skillHash: NATIVE_RUNTIME_HASH,
          }
        : journal.nextRun,
  };
}

function sameV1State(left: NativeLegacyChangeState, right: NativeLegacyChangeState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameV2State(left: NativeV2ChangeState, right: NativeV2ChangeState): boolean {
  return (
    JSON.stringify(nativeV2ChangeDocument(left)) === JSON.stringify(nativeV2ChangeDocument(right))
  );
}

function sameCurrentState(left: NativeChangeState, right: NativeChangeState): boolean {
  return JSON.stringify(nativeChangeDocument(left)) === JSON.stringify(nativeChangeDocument(right));
}

function sameRunState(left: RunState, right: RunState): boolean {
  return isDeepStrictEqual(left, right);
}

function parseTransitionSupersede(
  value: unknown,
  expectedName: string,
  nextState: NativeChangeState,
  migrationId: string,
): NonNullable<NativeSchemaMigrationJournal['transitionSupersede']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Schema migration transition supersede plan is invalid');
  }
  const record = value as Record<string, unknown>;
  rejectUnknownFields(
    record,
    MIGRATION_TRANSITION_SUPERSEDE_KEYS,
    'Schema migration transition supersede plan',
  );
  if (typeof record.sourceHash !== 'string' || !HASH_PATTERN.test(record.sourceHash)) {
    throw new Error('Schema migration transition supersede source hash is invalid');
  }
  if (typeof record.transitionId !== 'string' || record.transitionId.length === 0) {
    throw new Error('Schema migration superseded transition id is invalid');
  }
  if (typeof record.evidenceHash !== 'string' || !HASH_PATTERN.test(record.evidenceHash)) {
    throw new Error('Schema migration transition supersede evidence hash is invalid');
  }
  const previousRun = parseNativeStoredRunStateValue(record.previousRun);
  const nextRun = parseNativeStoredRunStateValue(record.nextRun);
  if (
    previousRun.runId !== nextRun.runId ||
    nextState.run_id !== nextRun.runId ||
    (nextState.phase !== 'build' && nextState.phase !== 'verify') ||
    nextRun.currentStep !== nextState.phase ||
    nextRun.pending !== null ||
    nextRun.status !== 'running' ||
    nextState.verification_result !== 'pending' ||
    nextState.verification_report !== null ||
    nextState.implementation_scope !== null ||
    nextState.verification_evidence !== null ||
    nextState.partial_allowance !== null
  ) {
    throw new Error('Schema migration transition supersede Run does not match target state');
  }
  const retreatAllowed =
    (previousRun.currentStep === 'verify' && nextState.phase === 'build') ||
    (previousRun.currentStep === 'archive' && nextState.phase === 'build');
  const expectedNextRun =
    previousRun.currentStep === nextState.phase
      ? previousRun
      : retreatAllowed
        ? {
            ...previousRun,
            currentStep: nextState.phase,
            iteration: previousRun.iteration + 1,
            pending: null,
            status: 'running' as const,
          }
        : null;
  if (!expectedNextRun || !sameRunState(expectedNextRun, nextRun)) {
    throw new Error('Schema migration transition supersede Run retreat is invalid');
  }
  if (
    !record.eventData ||
    typeof record.eventData !== 'object' ||
    Array.isArray(record.eventData)
  ) {
    throw new Error('Schema migration transition supersede event is invalid');
  }
  const eventData = record.eventData as Record<string, unknown>;
  const eventKeys = Object.keys(eventData);
  if (
    eventKeys.length !== MIGRATION_SUPERSEDE_EVENT_KEYS.size ||
    eventKeys.some((key) => !MIGRATION_SUPERSEDE_EVENT_KEYS.has(key)) ||
    eventData.fromSchema !== NATIVE_V2_CHANGE_SCHEMA ||
    eventData.toSchema !== NATIVE_CHANGE_SCHEMA ||
    !['build', 'verify', 'archive'].includes(eventData.previousPhase as string) ||
    eventData.nextPhase !== nextState.phase ||
    eventData.reason !==
      (nextState.phase === 'build'
        ? 'implementation-scope-required'
        : 'verification-evidence-required') ||
    eventData.supersededTransitionId !== record.transitionId
  ) {
    throw new Error('Schema migration transition supersede event semantics are invalid');
  }
  if (nextState.name !== expectedName) {
    throw new Error('Schema migration transition supersede change mismatch');
  }
  const expectedEvidenceHash = sha256Text(
    JSON.stringify({
      operation: 'supersede-v2-evidence-transition',
      change: expectedName,
      transitionId: record.transitionId,
      migrationId,
      previousPhase: eventData.previousPhase,
      nextPhase: eventData.nextPhase,
      reason: eventData.reason,
      previousIteration: previousRun.iteration,
      nextRevision: nextState.revision,
    }),
  );
  if (record.evidenceHash !== expectedEvidenceHash) {
    throw new Error('Schema migration transition supersede evidence hash mismatch');
  }
  return {
    sourceHash: record.sourceHash,
    transitionId: record.transitionId,
    previousRun,
    nextRun,
    evidenceHash: record.evidenceHash,
    eventData,
  };
}

export function nativeSchemaMigrationJournalFile(paths: NativeProjectPaths, name: string): string {
  return path.join(nativeChangeDir(paths, name), 'runtime', 'schema-migration.json');
}

function parseMigrationJournal(value: unknown, expectedName: string): NativeSchemaMigrationJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native schema migration journal must be an object');
  }
  rejectUnknownFields(
    value as Record<string, unknown>,
    MIGRATION_JOURNAL_KEYS,
    'Native schema migration journal',
  );
  const journal = value as Partial<NativeSchemaMigrationJournal>;
  if (journal.schema !== 'comet.native.schema-migration.v1') {
    throw new Error('Unsupported Native schema migration journal');
  }
  if (journal.change !== expectedName) throw new Error('Schema migration change mismatch');
  const v1ToV2 =
    journal.fromSchema === NATIVE_LEGACY_CHANGE_SCHEMA &&
    journal.toSchema === NATIVE_V2_CHANGE_SCHEMA;
  const v2ToV3 =
    journal.fromSchema === NATIVE_V2_CHANGE_SCHEMA && journal.toSchema === NATIVE_CHANGE_SCHEMA;
  if (!v1ToV2 && !v2ToV3) throw new Error('Schema migration route is unsupported');
  if (typeof journal.id !== 'string' || journal.id.length === 0) {
    throw new Error('Schema migration id is invalid');
  }
  if (
    typeof journal.sourceHash !== 'string' ||
    !HASH_PATTERN.test(journal.sourceHash) ||
    typeof journal.targetHash !== 'string' ||
    !HASH_PATTERN.test(journal.targetHash)
  ) {
    throw new Error('Schema migration hash is invalid');
  }
  if (typeof journal.createdAt !== 'string' || Number.isNaN(Date.parse(journal.createdAt))) {
    throw new Error('Schema migration timestamp is invalid');
  }
  const nextState = v1ToV2
    ? parseV2NativeChangeValue(journal.nextState)
    : parseNativeChangeValue(journal.nextState);
  if (nextState.name !== expectedName) {
    throw new Error('Schema migration target state change mismatch');
  }
  if (sha256Text(stringify(migrationStateDocument(nextState))) !== journal.targetHash) {
    throw new Error('Schema migration state target hash does not match its document');
  }
  let transition: NativeSchemaMigrationJournal['transition'];
  if (journal.transition !== undefined) {
    if (!journal.transition || typeof journal.transition !== 'object') {
      throw new Error('Schema migration transition target is invalid');
    }
    rejectUnknownFields(
      journal.transition as unknown as Record<string, unknown>,
      MIGRATION_TRANSITION_KEYS,
      'Schema migration transition target',
    );
    const transitionValue = journal.transition as Partial<
      NonNullable<NativeSchemaMigrationJournal['transition']>
    >;
    if (
      typeof transitionValue.sourceHash !== 'string' ||
      !HASH_PATTERN.test(transitionValue.sourceHash) ||
      typeof transitionValue.targetHash !== 'string' ||
      !HASH_PATTERN.test(transitionValue.targetHash)
    ) {
      throw new Error('Schema migration transition hash is invalid');
    }
    const parsedNextJournal = v1ToV2
      ? parseV2NativeTransitionJournalValue(transitionValue.nextJournal, expectedName)
      : parseNativeTransitionJournalValue(transitionValue.nextJournal, expectedName);
    if (
      sha256Text(JSON.stringify(transitionValue.nextJournal, null, 2) + '\n') !==
      transitionValue.targetHash
    ) {
      throw new Error('Schema migration transition target hash does not match its journal');
    }
    const matches =
      v1ToV2 && nextState.schema === NATIVE_V2_CHANGE_SCHEMA
        ? sameV2State(nextState, (parsedNextJournal as NativeV2TransitionJournal).previousState) ||
          sameV2State(nextState, (parsedNextJournal as NativeV2TransitionJournal).nextState)
        : nextState.schema === NATIVE_CHANGE_SCHEMA &&
          (sameCurrentState(
            nextState,
            (parsedNextJournal as NativeTransitionJournal).previousState,
          ) ||
            sameCurrentState(nextState, (parsedNextJournal as NativeTransitionJournal).nextState));
    if (!matches) throw new Error('Schema migration state/transition target mismatch');
    transition = {
      sourceHash: transitionValue.sourceHash,
      targetHash: transitionValue.targetHash,
      nextJournal: transitionValue.nextJournal as
        | NativeV2TransitionJournal
        | NativeTransitionJournal,
    };
  }
  if (
    v1ToV2 &&
    ((!transition && nextState.revision !== 1) ||
      (transition && nextState.revision !== 1 && nextState.revision !== 2))
  ) {
    throw new Error('Schema migration v1 target revision is invalid');
  }
  let transitionSupersede: NativeSchemaMigrationJournal['transitionSupersede'];
  if (journal.transitionSupersede !== undefined) {
    if (!v2ToV3 || transition) {
      throw new Error('Schema migration transition supersede plan is not valid for this route');
    }
    if (nextState.schema !== NATIVE_CHANGE_SCHEMA) {
      throw new Error('Schema migration transition supersede target schema is invalid');
    }
    transitionSupersede = parseTransitionSupersede(
      journal.transitionSupersede,
      expectedName,
      nextState,
      journal.id,
    );
  }
  let runRetreat: NativeSchemaMigrationJournal['runRetreat'];
  if (journal.runRetreat !== undefined) {
    if (!v2ToV3 || transition || transitionSupersede) {
      throw new Error('Schema migration Run retreat is not valid for this route');
    }
    if (!journal.runRetreat || typeof journal.runRetreat !== 'object') {
      throw new Error('Schema migration Run retreat is invalid');
    }
    rejectUnknownFields(
      journal.runRetreat as unknown as Record<string, unknown>,
      MIGRATION_RUN_RETREAT_KEYS,
      'Schema migration Run retreat',
    );
    const retreat = journal.runRetreat as Partial<
      NonNullable<NativeSchemaMigrationJournal['runRetreat']>
    >;
    let previousRun: RunState;
    let nextRun: RunState;
    try {
      previousRun = parseNativeStoredRunStateValue(retreat.previousRun);
      nextRun = parseNativeStoredRunStateValue(retreat.nextRun);
    } catch (error) {
      throw new Error('Schema migration Run retreat is invalid', { cause: error });
    }
    if (
      typeof retreat.evidenceHash !== 'string' ||
      !HASH_PATTERN.test(retreat.evidenceHash) ||
      !retreat.eventData ||
      typeof retreat.eventData !== 'object' ||
      Array.isArray(retreat.eventData)
    ) {
      throw new Error('Schema migration Run retreat is invalid');
    }
    if (
      nextState.schema !== NATIVE_CHANGE_SCHEMA ||
      nextState.phase !== 'build' ||
      nextState.run_id !== nextRun.runId ||
      previousRun.runId !== nextRun.runId ||
      (previousRun.currentStep !== 'verify' && previousRun.currentStep !== 'archive') ||
      nextRun.currentStep !== 'build' ||
      nextRun.iteration !== previousRun.iteration + 1
    ) {
      throw new Error('Schema migration Run retreat does not match target state');
    }
    runRetreat = {
      previousRun,
      nextRun,
      evidenceHash: retreat.evidenceHash,
      eventData: retreat.eventData as Record<string, unknown>,
    };
  }
  if ((transition && runRetreat) || (transitionSupersede && runRetreat)) {
    throw new Error('Schema migration has conflicting recovery plans');
  }
  return {
    schema: 'comet.native.schema-migration.v1',
    id: journal.id,
    change: expectedName,
    fromSchema: journal.fromSchema!,
    toSchema: journal.toSchema!,
    sourceHash: journal.sourceHash,
    targetHash: journal.targetHash,
    createdAt: journal.createdAt,
    nextState,
    ...(transition ? { transition } : {}),
    ...(transitionSupersede ? { transitionSupersede } : {}),
    ...(runRetreat ? { runRetreat } : {}),
  };
}

export async function inspectPendingNativeSchemaMigration(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeSchemaMigrationJournal | null> {
  const file = nativeSchemaMigrationJournalFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    const source = await readNativeProtectedTextFile({
      root: paths.nativeRoot,
      file,
      maxBytes: 512 * 1024,
      label: 'Native schema migration journal',
    });
    return parseMigrationJournal(JSON.parse(source.text), name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function ensureMigrationBaseline(
  paths: NativeProjectPaths,
  name: string,
  createdAt: string,
): Promise<void> {
  const stored = await readNativeBaselineManifest(paths, name);
  const baseline = stored
    ? await filterNativeContentSnapshotToProjectScope(paths, stored)
    : await createNativeContentSnapshot(paths, {
        now: new Date(createdAt),
        origin: 'legacy-migration',
      });
  if (!baseline.complete) {
    const health = inspectNativeContentSnapshotHealth(baseline);
    const omittedByReason = baseline.omitted.reduce<Record<string, number>>((counts, item) => {
      counts[item.reason] = (counts[item.reason] ?? 0) + 1;
      return counts;
    }, {});
    const overflowCount = baseline.omissionOverflow?.count ?? 0;
    if (overflowCount > 0) omittedByReason.overflow = overflowCount;
    throw new NativeBaselineIncompleteError(
      name,
      baseline.omittedCount,
      omittedByReason,
      health.samplePaths,
      health.sampleTruncated,
    );
  }
  if (stored === null) await writeNativeBaselineManifest(paths, name, baseline);
}

async function optionalFileHash(file: string): Promise<string | null> {
  try {
    return await sha256File(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function expectedSupersedeEvent(
  journal: NativeSchemaMigrationJournal,
  sequence: number,
): Record<string, unknown> {
  const supersede = journal.transitionSupersede!;
  return {
    sequence,
    timestamp: journal.createdAt,
    type: 'state_migrated',
    runId: supersede.nextRun.runId,
    data: {
      ...supersede.eventData,
      migrationId: journal.id,
      evidenceHash: supersede.evidenceHash,
    },
  };
}

async function inspectSupersedeEvent(
  paths: NativeProjectPaths,
  journal: NativeSchemaMigrationJournal,
): Promise<{ trajectoryLength: number; sequence: number | null }> {
  const supersede = journal.transitionSupersede!;
  const changeDir = nativeChangeDir(paths, journal.change);
  const trajectory = await readNativeTrajectory(changeDir, supersede.nextRun.trajectoryRef);
  const matches = trajectory
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.data.migrationId === journal.id);
  if (matches.length > 1) {
    throw new Error(`Native schema migration event ${journal.id} is duplicated`);
  }
  const match = matches[0];
  if (match && !isDeepStrictEqual(match.event, expectedSupersedeEvent(journal, match.index + 1))) {
    throw new Error(`Native schema migration event ${journal.id} changed`);
  }
  return { trajectoryLength: trajectory.length, sequence: match?.event.sequence ?? null };
}

async function assertSupersedeSourceBeforeMutation(
  paths: NativeProjectPaths,
  journal: NativeSchemaMigrationJournal,
  stateAtTarget: boolean,
): Promise<void> {
  if (!journal.transitionSupersede) return;
  const transitionFile = nativeTransitionJournalFile(paths, journal.change);
  const actualHash = await optionalFileHash(transitionFile);
  if (actualHash === journal.transitionSupersede.sourceHash) return;
  if (actualHash !== null) {
    throw new Error(
      `Native superseded transition source changed for ${journal.change}: expected ${journal.transitionSupersede.sourceHash}, actual ${actualHash}`,
    );
  }
  const run = await readNativeRunState(nativeChangeDir(paths, journal.change));
  const event = await inspectSupersedeEvent(paths, journal);
  const checkpoint = await readNativeCheckpoint(
    nativeChangeDir(paths, journal.change),
    journal.transitionSupersede.nextRun.checkpointRef,
  );
  if (
    !stateAtTarget ||
    !run ||
    !sameRunState(run, journal.transitionSupersede.nextRun) ||
    event.sequence === null ||
    !checkpoint ||
    checkpoint.runId !== journal.transitionSupersede.nextRun.runId ||
    checkpoint.stateVersion !== journal.transitionSupersede.nextRun.iteration ||
    checkpoint.trajectoryOffset !== event.sequence ||
    checkpoint.contextHash !== null ||
    checkpoint.artifactsHash !== sha256Text(journal.transitionSupersede.evidenceHash) ||
    checkpoint.createdAt !== journal.createdAt
  ) {
    throw new Error(
      `Native superseded transition disappeared before migration ${journal.id} was durable`,
    );
  }
}

async function continueTransitionSupersede(
  paths: NativeProjectPaths,
  journal: NativeSchemaMigrationJournal,
  hooks?: NativeSchemaMigrationHooks,
): Promise<void> {
  const supersede = journal.transitionSupersede;
  if (!supersede) return;
  const changeDir = nativeChangeDir(paths, journal.change);
  const currentRun = await readNativeRunState(changeDir);
  if (!currentRun) {
    throw new Error(`Native schema migration Run state disappeared for ${journal.change}`);
  }
  if (!sameRunState(currentRun, supersede.nextRun)) {
    if (!sameRunState(currentRun, supersede.previousRun)) {
      throw new Error(`Native schema migration Run source changed for ${journal.change}`);
    }
    await writeNativeRunState(changeDir, supersede.nextRun);
    await hooks?.afterRunStateWritten?.(journal);
  }
  if (!sameRunState((await readNativeRunState(changeDir))!, supersede.nextRun)) {
    throw new Error(`Native schema migration Run write diverged for ${journal.change}`);
  }

  let event = await inspectSupersedeEvent(paths, journal);
  if (event.sequence === null) {
    const appended = await appendNativeTrajectoryEvent({
      changeDir,
      run: supersede.nextRun,
      type: 'state_migrated',
      data: {
        ...supersede.eventData,
        migrationId: journal.id,
        evidenceHash: supersede.evidenceHash,
      },
      now: new Date(journal.createdAt),
    });
    event = { trajectoryLength: appended.sequence, sequence: appended.sequence };
  }
  await hooks?.afterTrajectoryWritten?.(journal);
  await writeNativeCheckpoint({
    changeDir,
    run: supersede.nextRun,
    trajectoryOffset: event.sequence!,
    evidenceHash: supersede.evidenceHash,
    now: new Date(journal.createdAt),
  });
  await hooks?.afterCheckpointWritten?.(journal);

  const transitionFile = nativeTransitionJournalFile(paths, journal.change);
  const transitionHash = await optionalFileHash(transitionFile);
  if (transitionHash !== null) {
    if (transitionHash !== supersede.sourceHash) {
      throw new Error(`Native superseded transition changed before removal for ${journal.change}`);
    }
    await fs.rm(transitionFile);
    await hooks?.afterTransitionSuperseded?.(journal);
  }
}

async function continueRunRetreat(
  paths: NativeProjectPaths,
  journal: NativeSchemaMigrationJournal,
  hooks?: NativeSchemaMigrationHooks,
): Promise<void> {
  if (!journal.runRetreat) return;
  const changeDir = nativeChangeDir(paths, journal.change);
  const currentRun = await readNativeRunState(changeDir);
  if (!currentRun) {
    throw new Error(`Native schema migration Run state disappeared for ${journal.change}`);
  }
  if (!sameRunState(currentRun, journal.runRetreat.nextRun)) {
    if (!sameRunState(currentRun, journal.runRetreat.previousRun)) {
      throw new Error(`Native schema migration Run source changed for ${journal.change}`);
    }
    await writeNativeRunState(changeDir, journal.runRetreat.nextRun);
    await hooks?.afterRunStateWritten?.(journal);
  }
  let trajectory = await readNativeTrajectory(changeDir, journal.runRetreat.nextRun.trajectoryRef);
  let event = trajectory.find(
    (item) => item.type === 'state_migrated' && item.data.migrationId === journal.id,
  );
  if (!event) {
    event = await appendNativeTrajectoryEvent({
      changeDir,
      run: journal.runRetreat.nextRun,
      type: 'state_migrated',
      data: {
        ...journal.runRetreat.eventData,
        migrationId: journal.id,
        evidenceHash: journal.runRetreat.evidenceHash,
      },
      now: new Date(journal.createdAt),
    });
    trajectory = [...trajectory, event];
  }
  await hooks?.afterTrajectoryWritten?.(journal);
  await writeNativeCheckpoint({
    changeDir,
    run: journal.runRetreat.nextRun,
    trajectoryOffset: trajectory.length,
    evidenceHash: journal.runRetreat.evidenceHash,
    now: new Date(journal.createdAt),
  });
  await hooks?.afterCheckpointWritten?.(journal);
}

async function continueNativeSchemaMigrationLocked(
  paths: NativeProjectPaths,
  name: string,
  hooks?: NativeSchemaMigrationHooks,
): Promise<NativeV2ChangeState | NativeChangeState | null> {
  const journal = await inspectPendingNativeSchemaMigration(paths, name);
  if (!journal) return null;
  if (await hasPendingNativeCheckpointRecovery(paths, name)) {
    throw new Error(
      `Native change ${name} has a pending progress checkpoint; recover it with its v2 runtime before schema migration`,
    );
  }
  const changeFile = path.join(nativeChangeDir(paths, name), NATIVE_CHANGE_STATE_FILE);
  const actualHash = await sha256File(changeFile);
  await assertSupersedeSourceBeforeMutation(paths, journal, actualHash === journal.targetHash);
  // Baseline safety must be established before writing state, Run, trajectory, or checkpoint.
  // A failed capture leaves only the prepared migration journal and the original state, so retry
  // remains deterministic after the project omission is resolved.
  await ensureMigrationBaseline(paths, name, journal.createdAt);
  if (actualHash !== journal.targetHash) {
    if (actualHash !== journal.sourceHash) {
      throw new Error(
        `Native schema migration source changed for ${name}: expected ${journal.sourceHash}, actual ${actualHash}`,
      );
    }
    await atomicWriteText(changeFile, stringify(migrationStateDocument(journal.nextState)));
    await hooks?.afterStateWritten?.(journal);
  }
  if (journal.transition) {
    const transitionFile = nativeTransitionJournalFile(paths, name);
    const actualTransitionHash = await sha256File(transitionFile);
    if (actualTransitionHash !== journal.transition.targetHash) {
      if (actualTransitionHash !== journal.transition.sourceHash) {
        throw new Error(
          `Native transition migration source changed for ${name}: expected ${journal.transition.sourceHash}, actual ${actualTransitionHash}`,
        );
      }
      await atomicWriteJson(transitionFile, journal.transition.nextJournal);
      await hooks?.afterTransitionWritten?.(journal);
    }
  }
  await continueTransitionSupersede(paths, journal, hooks);
  await continueRunRetreat(paths, journal, hooks);
  await fs.rm(nativeSchemaMigrationJournalFile(paths, name), { force: true });
  return journal.nextState;
}

async function stableEvidenceRetreat(options: {
  paths: NativeProjectPaths;
  state: NativeV2ChangeState;
  migrationId: string;
}): Promise<NonNullable<NativeSchemaMigrationJournal['runRetreat']>> {
  const changeDir = nativeChangeDir(options.paths, options.state.name);
  const run = await readNativeRunState(changeDir);
  if (
    !run ||
    run.runId !== options.state.run_id ||
    run.currentStep !== options.state.phase ||
    (run.currentStep !== 'verify' && run.currentStep !== 'archive') ||
    run.pending !== null
  ) {
    throw new Error(
      `Native v2 ${options.state.phase} change ${options.state.name} has no consistent Run state for safe Build retreat`,
    );
  }
  const nextRun: RunState = {
    ...run,
    currentStep: 'build',
    iteration: run.iteration + 1,
    pending: null,
    status: 'running',
  };
  const evidenceHash = sha256Text(
    `schema-v3-evidence-retreat:${options.state.name}:${options.state.revision}:${options.migrationId}`,
  );
  return {
    previousRun: run,
    nextRun,
    evidenceHash,
    eventData: {
      fromSchema: NATIVE_V2_CHANGE_SCHEMA,
      toSchema: NATIVE_CHANGE_SCHEMA,
      previousPhase: options.state.phase,
      nextPhase: 'build',
      reason: 'implementation-scope-required',
    },
  };
}

async function pendingEvidenceTransitionSupersede(options: {
  paths: NativeProjectPaths;
  state: NativeV2ChangeState;
  journal: NativeV2TransitionJournal;
  migrationId: string;
}): Promise<{
  nextState: NativeChangeState;
  plan: NonNullable<NativeSchemaMigrationJournal['transitionSupersede']>;
}> {
  const { journal, state } = options;
  const requiresV3Evidence =
    (journal.previousState.phase === 'build' && journal.nextState.phase === 'verify') ||
    (journal.previousState.phase === 'verify' &&
      (journal.nextState.phase === 'build' || journal.nextState.phase === 'archive'));
  if (!requiresV3Evidence) {
    throw new Error('Only a pending v2 evidence-bearing transition can be superseded');
  }
  const stateIsPrevious = sameV2State(state, journal.previousState);
  const stateIsNext = sameV2State(state, journal.nextState);
  if (!stateIsPrevious && !stateIsNext) {
    throw new Error(`Native change ${state.name} does not match its v2 evidence transition`);
  }
  const changeDir = nativeChangeDir(options.paths, state.name);
  const currentRun = await readNativeRunState(changeDir);
  if (!currentRun) throw new Error(`Native v2 transition Run is missing for ${state.name}`);
  const runIsPrevious =
    journal.previousRun !== null && sameRunState(currentRun, journal.previousRun);
  const runIsNext = sameRunState(currentRun, journal.nextRun);
  if ((!runIsPrevious && !runIsNext) || (stateIsNext && !runIsNext)) {
    throw new Error(`Native v2 transition Run does not match its durable state for ${state.name}`);
  }

  const trajectory = await readNativeTrajectory(changeDir, journal.nextRun.trajectoryRef);
  const collisions = trajectory
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.data.transitionId === journal.id);
  if (collisions.length > 1) {
    throw new Error(`Native v2 evidence transition ${journal.id} has duplicate trajectory events`);
  }
  const durable = collisions[0];
  if (durable) {
    const expected = {
      sequence: durable.index + 1,
      timestamp: journal.createdAt,
      type: 'state_transitioned',
      runId: journal.nextRun.runId,
      data: { ...journal.eventData, transitionId: journal.id },
    };
    if (!isDeepStrictEqual(durable.event, expected) || !stateIsNext || !runIsNext) {
      throw new Error(
        `Native v2 evidence transition ${journal.id} trajectory event does not match its journal`,
      );
    }
  }

  const nextState: NativeChangeState = {
    ...upgradeV2StateToV3(state),
    revision: state.revision + (state.phase === 'build' ? 0 : 1),
    phase: 'build',
    verification_result: 'pending',
    verification_report: null,
    implementation_scope: null,
    verification_evidence: null,
    partial_allowance: null,
    archived: false,
  };
  const previousRun = currentRun;
  const nextRun: RunState =
    currentRun.currentStep !== 'build'
      ? {
          ...currentRun,
          currentStep: 'build',
          iteration: currentRun.iteration + 1,
          pending: null,
          status: 'running',
        }
      : currentRun;
  const evidenceHash = sha256Text(
    JSON.stringify({
      operation: 'supersede-v2-evidence-transition',
      change: state.name,
      transitionId: journal.id,
      migrationId: options.migrationId,
      previousPhase: state.phase,
      nextPhase: 'build',
      reason: 'implementation-scope-required',
      previousIteration: currentRun.iteration,
      nextRevision: nextState.revision,
    }),
  );
  return {
    nextState,
    plan: {
      sourceHash: await sha256File(nativeTransitionJournalFile(options.paths, state.name)),
      transitionId: journal.id,
      previousRun,
      nextRun,
      evidenceHash,
      eventData: {
        fromSchema: NATIVE_V2_CHANGE_SCHEMA,
        toSchema: NATIVE_CHANGE_SCHEMA,
        previousPhase: state.phase,
        nextPhase: 'build',
        reason: 'implementation-scope-required',
        supersededTransitionId: journal.id,
      },
    },
  };
}

async function prepareNextMigration(options: {
  paths: NativeProjectPaths;
  name: string;
  state: NativeLegacyChangeState | NativeV2ChangeState;
  pendingTransition: Awaited<ReturnType<typeof inspectPendingNativeTransitionSchema>>;
  now: Date;
  id: string;
}): Promise<NativeSchemaMigrationJournal> {
  let nextState: NativeV2ChangeState | NativeChangeState;
  let transition: NativeSchemaMigrationJournal['transition'];
  let transitionSupersede: NativeSchemaMigrationJournal['transitionSupersede'];
  let runRetreat: NativeSchemaMigrationJournal['runRetreat'];
  if (options.state.schema === NATIVE_LEGACY_CHANGE_SCHEMA) {
    nextState = upgradeV1StateToV2(options.state, 1);
    if (options.pendingTransition) {
      if (options.pendingTransition.journal.schema !== NATIVE_LEGACY_TRANSITION_SCHEMA) {
        throw new Error('Native v1 change has a transition from another schema generation');
      }
      const nextJournal = upgradeV1TransitionToV2(options.pendingTransition.journal);
      if (sameV1State(options.state, options.pendingTransition.journal.previousState)) {
        nextState = nextJournal.previousState;
      } else if (sameV1State(options.state, options.pendingTransition.journal.nextState)) {
        nextState = nextJournal.nextState;
      } else {
        throw new Error(
          `Native change ${options.name} does not match either state in its v1 transition journal`,
        );
      }
      const transitionFile = nativeTransitionJournalFile(options.paths, options.name);
      transition = {
        sourceHash: await sha256File(transitionFile),
        targetHash: sha256Text(transitionContent(nextJournal)),
        nextJournal,
      };
    }
  } else {
    if (options.pendingTransition) {
      if (options.pendingTransition.journal.schema !== NATIVE_V2_TRANSITION_SCHEMA) {
        throw new Error('Native v2 change has a transition from another schema generation');
      }
      const v2Journal = options.pendingTransition.journal;
      const requiresV3Evidence =
        (v2Journal.previousState.phase === 'build' && v2Journal.nextState.phase === 'verify') ||
        (v2Journal.previousState.phase === 'verify' &&
          (v2Journal.nextState.phase === 'build' || v2Journal.nextState.phase === 'archive'));
      if (requiresV3Evidence) {
        const supersede = await pendingEvidenceTransitionSupersede({
          paths: options.paths,
          state: options.state,
          journal: v2Journal,
          migrationId: options.id,
        });
        nextState = supersede.nextState;
        transitionSupersede = supersede.plan;
      } else {
        const nextJournal = upgradeV2TransitionToV3(v2Journal);
        if (sameV2State(options.state, options.pendingTransition.journal.previousState)) {
          nextState = nextJournal.previousState;
        } else if (sameV2State(options.state, options.pendingTransition.journal.nextState)) {
          nextState = nextJournal.nextState;
        } else {
          throw new Error(
            `Native change ${options.name} does not match either state in its v2 transition journal`,
          );
        }
        const transitionFile = nativeTransitionJournalFile(options.paths, options.name);
        transition = {
          sourceHash: await sha256File(transitionFile),
          targetHash: sha256Text(transitionContent(nextJournal)),
          nextJournal,
        };
      }
    } else {
      nextState = upgradeV2StateToV3(options.state, {
        retreatEvidencePhase: true,
        incrementRetreatRevision: true,
      });
      if (options.state.phase === 'verify' || options.state.phase === 'archive') {
        runRetreat = await stableEvidenceRetreat({
          paths: options.paths,
          state: options.state,
          migrationId: options.id,
        });
      }
    }
  }
  const changeFile = path.join(
    nativeChangeDir(options.paths, options.name),
    NATIVE_CHANGE_STATE_FILE,
  );
  const targetContent = stringify(migrationStateDocument(nextState));
  return {
    schema: 'comet.native.schema-migration.v1',
    id: options.id,
    change: options.name,
    fromSchema: options.state.schema,
    toSchema:
      options.state.schema === NATIVE_LEGACY_CHANGE_SCHEMA
        ? NATIVE_V2_CHANGE_SCHEMA
        : NATIVE_CHANGE_SCHEMA,
    sourceHash: await sha256File(changeFile),
    targetHash: sha256Text(targetContent),
    createdAt: options.now.toISOString(),
    nextState,
    ...(transition ? { transition } : {}),
    ...(transitionSupersede ? { transitionSupersede } : {}),
    ...(runRetreat ? { runRetreat } : {}),
  };
}

export async function migrateNativeChange(options: {
  paths: NativeProjectPaths;
  name: string;
  now?: Date;
  id?: () => string;
  hooks?: NativeSchemaMigrationHooks;
}): Promise<NativeChangeState> {
  return withNativeMutationLock(options.paths, `migrate schema for ${options.name}`, () =>
    withNativeTransitionLock(
      options.paths,
      options.name,
      `migrate schema for ${options.name}`,
      async () => {
        for (let step = 0; step < 3; step += 1) {
          const continued = await continueNativeSchemaMigrationLocked(
            options.paths,
            options.name,
            options.hooks,
          );
          if (continued?.schema === NATIVE_CHANGE_SCHEMA) return continued;

          const inspection = await inspectNativeChange(options.paths, options.name);
          if (inspection.status === 'current' && inspection.state) {
            return inspection.state as NativeChangeState;
          }
          if (inspection.status !== 'migration-required' || !inspection.state) {
            throw new Error(
              inspection.message ?? `Native change ${options.name} cannot be migrated`,
            );
          }
          if (await hasPendingNativeCheckpointRecovery(options.paths, options.name)) {
            throw new Error(
              `Native change ${options.name} has a pending progress checkpoint; recover it with its v2 runtime before schema migration`,
            );
          }
          const state = inspection.state as NativeReadableChangeState;
          if (
            state.schema !== NATIVE_LEGACY_CHANGE_SCHEMA &&
            state.schema !== NATIVE_V2_CHANGE_SCHEMA
          ) {
            throw new Error(`Native change ${options.name} has no supported migration route`);
          }
          const pendingTransition = await inspectPendingNativeTransitionSchema(
            options.paths,
            options.name,
          );
          if (pendingTransition?.status === 'current') {
            throw new Error(
              `Native change ${options.name} has a current-schema pending transition; recover it before schema migration`,
            );
          }
          const journal = await prepareNextMigration({
            paths: options.paths,
            name: options.name,
            state,
            pendingTransition,
            now: options.now ?? new Date(),
            id: options.id?.() ?? randomUUID(),
          });
          const journalFile = nativeSchemaMigrationJournalFile(options.paths, options.name);
          await resolveContainedNativePath(options.paths.nativeRoot, journalFile);
          await atomicWriteJson(journalFile, journal);
          await options.hooks?.afterPrepared?.(journal);
        }
        throw new Error(
          `Native change ${options.name} exceeded the supported schema migration path`,
        );
      },
    ),
  );
}
