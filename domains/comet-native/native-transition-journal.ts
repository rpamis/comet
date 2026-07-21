import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { isDeepStrictEqual } from 'util';

import { NATIVE_RUN_STORAGE } from '../engine/storage-layout.js';
import { atomicWriteJson } from './native-atomic-file.js';
import {
  hasPendingNativeSchemaMigration,
  compareAndSwapNativeChangeLocked,
  nativeChangeDir,
  parseLegacyNativeChangeValue,
  parseNativeChangeValue,
  parseV2NativeChangeValue,
  readNativeChange,
} from './native-change.js';
import { sha256Text } from './native-hash.js';
import { acquireNativeLock, releaseNativeLock, type NativeLock } from './native-lock.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { resolveContainedNativePath } from './native-paths.js';
import { readNativeProtectedFile } from './native-protected-file.js';
import { redactNativeCredentialText } from './native-redaction.js';
import {
  parseNativeRepairTrajectoryProjection,
  type NativeRepairTrajectoryProjection,
} from './native-repair-runtime.js';
import { assertNativeTrajectoryText } from './native-trajectory-limits.js';
import {
  isCompatibleNativeRuntimeIdentity,
  NATIVE_RUNTIME_HASH,
  NATIVE_RUNTIME_PACKAGE,
} from './native-runtime-package.js';
import {
  parseNativeStoredRunStateValue,
  readNativeRunState,
  readNativeTrajectory,
  writeNativeRunState,
} from './native-run-store.js';
import { appendNativeTrajectoryEvent, writeNativeCheckpoint } from './native-trajectory.js';
import { nativeAdvanceEvidenceHash } from './native-transition-evidence.js';
import { assertNativeTrajectoryHealthy } from './native-trajectory-recovery.js';
import type {
  NativeChangeState,
  NativeLegacyTransitionJournal,
  NativeProjectPaths,
  NativeReadableChangeState,
  NativeTransitionHooks,
  NativeTransitionJournal,
  NativeTransitionOperation,
  NativeTransitionSchemaInspection,
  NativeV2TransitionJournal,
} from './native-types.js';
import {
  NATIVE_LEGACY_TRANSITION_SCHEMA,
  NATIVE_RUNTIME_PROTOCOL_VERSION,
  NATIVE_TRANSITION_SCHEMA,
  NATIVE_V2_TRANSITION_SCHEMA,
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
const V2_JOURNAL_KEYS = new Set<string>([
  ...COMMON_JOURNAL_KEYS,
  'minimum_runtime_version',
  'revision',
]);
const CURRENT_JOURNAL_KEYS = new Set<string>([...V2_JOURNAL_KEYS, 'operation']);
export const NATIVE_TRANSITION_JOURNAL_MAX_BYTES = 512 * 1024;
const REQUIRED_TRANSITION_EVENT_DATA_KEYS = new Set([
  'previousPhase',
  'nextPhase',
  'evidenceHash',
  'summary',
  'artifacts',
  'noCodeReason',
  'verificationResult',
]);
const TRANSITION_EVENT_DATA_KEYS = new Set([
  ...REQUIRED_TRANSITION_EVENT_DATA_KEYS,
  'implementationScopeHash',
  'repairScopeHash',
  'repairStagnation',
]);

interface NativeTransitionEventData extends Record<string, unknown> {
  previousPhase: NativeReadableChangeState['phase'];
  nextPhase: NativeReadableChangeState['phase'];
  evidenceHash: string;
  summary: string;
  artifacts: string[];
  noCodeReason: string | null;
  verificationResult: 'pass' | 'fail' | null;
  implementationScopeHash?: string;
  repairScopeHash?: string;
  repairStagnation?: NativeRepairTrajectoryProjection;
}

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
  return acquireNativeLock(paths, lockName, operation);
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

function sameValue(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

function parseTransitionEventData(value: unknown, evidenceHash: string): NativeTransitionEventData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native transition journal event data is invalid');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const unknown = keys.find((key) => !TRANSITION_EVENT_DATA_KEYS.has(key));
  const missing = [...REQUIRED_TRANSITION_EVENT_DATA_KEYS].find(
    (key) => !Object.hasOwn(record, key),
  );
  const expectedSize =
    REQUIRED_TRANSITION_EVENT_DATA_KEYS.size +
    (Object.hasOwn(record, 'implementationScopeHash') ? 1 : 0) +
    (Object.hasOwn(record, 'repairScopeHash') ? 1 : 0) +
    (Object.hasOwn(record, 'repairStagnation') ? 1 : 0);
  if (unknown || missing || keys.length !== expectedSize) {
    throw new Error(
      `Native transition journal event data keys are invalid${unknown ? `: ${unknown}` : missing ? `: missing ${missing}` : ''}`,
    );
  }
  if (
    !['shape', 'build', 'verify', 'archive'].includes(record.previousPhase as string) ||
    !['shape', 'build', 'verify', 'archive'].includes(record.nextPhase as string)
  ) {
    throw new Error('Native transition journal event phases are invalid');
  }
  if (record.evidenceHash !== evidenceHash) {
    throw new Error('Native transition journal event evidence hash mismatch');
  }
  assertNativeTrajectoryText(record.summary, 'Native transition journal event summary');
  if (redactNativeCredentialText(record.summary) !== record.summary) {
    throw new Error('Native transition journal event summary contains unredacted credentials');
  }
  if (
    !Array.isArray(record.artifacts) ||
    record.artifacts.length > 128 ||
    record.artifacts.some(
      (artifact) =>
        typeof artifact !== 'string' ||
        artifact.length === 0 ||
        Buffer.byteLength(artifact, 'utf8') > 512,
    )
  ) {
    throw new Error('Native transition journal event artifacts are invalid');
  }
  if (record.noCodeReason !== null) {
    assertNativeTrajectoryText(
      record.noCodeReason,
      'Native transition journal event no-code reason',
    );
    if (redactNativeCredentialText(record.noCodeReason) !== record.noCodeReason) {
      throw new Error(
        'Native transition journal event no-code reason contains unredacted credentials',
      );
    }
  }
  if (
    record.verificationResult !== null &&
    record.verificationResult !== 'pass' &&
    record.verificationResult !== 'fail'
  ) {
    throw new Error('Native transition journal event verification result is invalid');
  }
  const implementationScopeHash = Object.hasOwn(record, 'implementationScopeHash')
    ? record.implementationScopeHash
    : null;
  if (
    implementationScopeHash !== null &&
    (typeof implementationScopeHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(implementationScopeHash) ||
      (record.previousPhase !== 'build' && record.previousPhase !== 'verify'))
  ) {
    throw new Error('Native transition journal implementation scope hash is invalid');
  }
  const repairStagnation = Object.hasOwn(record, 'repairStagnation')
    ? parseNativeRepairTrajectoryProjection(record.repairStagnation)
    : null;
  if (repairStagnation) {
    const failureProjection = repairStagnation.overrideSummaryHash === null;
    if (
      (failureProjection &&
        (record.previousPhase !== 'verify' ||
          record.nextPhase !== 'build' ||
          record.verificationResult !== 'fail')) ||
      (!failureProjection &&
        (record.previousPhase !== 'build' ||
          record.nextPhase !== 'verify' ||
          record.verificationResult !== null))
    ) {
      throw new Error('Native transition journal repair projection does not match its phase');
    }
  }
  const repairScopeHash = Object.hasOwn(record, 'repairScopeHash') ? record.repairScopeHash : null;
  if (
    repairScopeHash !== null &&
    (typeof repairScopeHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(repairScopeHash) ||
      (record.previousPhase !== 'build' && record.previousPhase !== 'verify') ||
      implementationScopeHash === null)
  ) {
    throw new Error('Native transition journal repair scope hash is invalid');
  }
  return {
    previousPhase: record.previousPhase as NativeTransitionEventData['previousPhase'],
    nextPhase: record.nextPhase as NativeTransitionEventData['nextPhase'],
    evidenceHash,
    summary: record.summary,
    artifacts: [...record.artifacts] as string[],
    noCodeReason: record.noCodeReason as string | null,
    verificationResult: record.verificationResult as 'pass' | 'fail' | null,
    ...(implementationScopeHash ? { implementationScopeHash } : {}),
    ...(repairScopeHash ? { repairScopeHash } : {}),
    ...(repairStagnation ? { repairStagnation } : {}),
  };
}

function parseLegacyTransitionEventData(
  value: unknown,
  evidenceHash: string,
): NativeTransitionEventData {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    const legacyRebaseKeys = new Set([
      'previousPhase',
      'nextPhase',
      'evidenceHash',
      'summary',
      'reason',
    ]);
    if (
      keys.length === legacyRebaseKeys.size &&
      keys.every((key) => legacyRebaseKeys.has(key)) &&
      record.reason === 'spec-rebase'
    ) {
      return parseTransitionEventData(
        {
          previousPhase: record.previousPhase,
          nextPhase: record.nextPhase,
          evidenceHash: record.evidenceHash,
          summary: record.summary,
          artifacts: [],
          noCodeReason: null,
          verificationResult: null,
        },
        evidenceHash,
      );
    }
  }
  return parseTransitionEventData(value, evidenceHash);
}

function validateJournalEnvelope(
  journal: Record<string, unknown>,
  expectedName: string,
  legacyEventData = false,
): {
  id: string;
  evidenceHash: string;
  createdAt: string;
  previousRun: NativeTransitionJournal['previousRun'];
  nextRun: NativeTransitionJournal['nextRun'];
  eventData: NativeTransitionEventData;
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
  const eventData = legacyEventData
    ? parseLegacyTransitionEventData(journal.eventData, journal.evidenceHash)
    : parseTransitionEventData(journal.eventData, journal.evidenceHash);
  const nextRun = parseNativeStoredRunStateValue(journal.nextRun);
  const previousRun =
    journal.previousRun === null ? null : parseNativeStoredRunStateValue(journal.previousRun);
  return {
    id: journal.id,
    evidenceHash: journal.evidenceHash,
    createdAt: journal.createdAt,
    previousRun,
    nextRun,
    eventData,
  };
}

function assertNativeRunMetadata(
  run: NativeTransitionJournal['nextRun'],
  label: string,
  allowCompatibleLegacyIdentity = false,
): void {
  if (
    run.skill !== NATIVE_RUNTIME_PACKAGE.definition.metadata.name ||
    (allowCompatibleLegacyIdentity
      ? !isCompatibleNativeRuntimeIdentity(run)
      : run.skillVersion !== NATIVE_RUNTIME_PACKAGE.definition.metadata.version ||
        run.skillHash !== NATIVE_RUNTIME_HASH) ||
    run.orchestration !== NATIVE_RUNTIME_PACKAGE.definition.orchestration.mode ||
    run.pendingRef !== NATIVE_RUN_STORAGE.pendingRef ||
    run.trajectoryRef !== NATIVE_RUN_STORAGE.trajectoryRef ||
    run.contextRef !== NATIVE_RUN_STORAGE.contextRef ||
    run.artifactsRef !== NATIVE_RUN_STORAGE.artifactsRef ||
    run.checkpointRef !== NATIVE_RUN_STORAGE.checkpointRef
  ) {
    throw new Error(`Native transition journal ${label} metadata or storage refs are invalid`);
  }
}

function runInvariantProjection(run: NativeTransitionJournal['nextRun']): Record<string, unknown> {
  return {
    runId: run.runId,
    skill: run.skill,
    skillVersion: run.skillVersion,
    skillHash: run.skillHash,
    orchestration: run.orchestration,
    pendingRef: run.pendingRef,
    trajectoryRef: run.trajectoryRef,
    contextRef: run.contextRef,
    artifactsRef: run.artifactsRef,
    checkpointRef: run.checkpointRef,
    retries: run.retries,
  };
}

function assertCommittableRun(run: NativeTransitionJournal['nextRun'], label: string): void {
  if (run.status !== 'running') {
    throw new Error(`Native transition journal ${label} status must be running`);
  }
  if (run.pending !== null) {
    throw new Error(`Native transition journal ${label} pending action must be null`);
  }
}

function validateTransitionRunSemantics(
  previousState: NativeReadableChangeState,
  nextState: NativeReadableChangeState,
  envelope: ReturnType<typeof validateJournalEnvelope>,
  allowCompatibleLegacyIdentity = false,
): void {
  const { previousRun, nextRun } = envelope;
  assertNativeRunMetadata(
    nextRun,
    'next Run',
    allowCompatibleLegacyIdentity || previousRun !== null,
  );
  assertCommittableRun(nextRun, 'next Run');
  if (nextRun.runId !== nextState.run_id || nextRun.currentStep !== nextState.phase) {
    throw new Error('Native transition journal next Run does not match the next change state');
  }

  if (previousRun === null) {
    if (
      previousState.run_id !== null ||
      previousState.phase !== 'shape' ||
      nextRun.iteration !== 1 ||
      Object.keys(nextRun.retries).length !== 0
    ) {
      throw new Error('Native transition journal first Run transition is invalid');
    }
    return;
  }

  assertNativeRunMetadata(previousRun, 'previous Run', true);
  assertCommittableRun(previousRun, 'previous Run');
  if (
    previousState.run_id !== previousRun.runId ||
    previousRun.currentStep !== previousState.phase ||
    nextState.run_id !== previousRun.runId
  ) {
    throw new Error('Native transition journal previous Run does not match the change state');
  }
  if (nextRun.iteration !== previousRun.iteration + 1) {
    throw new Error('Native transition journal next Run iteration must advance exactly once');
  }
  if (!isDeepStrictEqual(runInvariantProjection(previousRun), runInvariantProjection(nextRun))) {
    throw new Error('Native transition journal Run identity or storage invariants changed');
  }
}

function specRebaseEvidenceHash(
  name: string,
  summary: string,
  specChanges: NativeReadableChangeState['spec_changes'],
): string {
  return sha256Text(
    JSON.stringify({
      operation: 'spec-rebase',
      change: name,
      summary,
      specChanges,
    }),
  );
}

function inferredLegacyTransitionOperation(
  previousState: NativeReadableChangeState,
  nextState: NativeReadableChangeState,
  event: NativeTransitionEventData,
): NativeTransitionOperation {
  return previousState.phase !== 'shape' &&
    nextState.phase === 'build' &&
    event.verificationResult === null
    ? 'spec-rebase'
    : 'advance';
}

function currentStateRefs(
  state: NativeReadableChangeState,
): Pick<
  NativeChangeState,
  'implementation_scope' | 'verification_evidence' | 'partial_allowance'
> | null {
  return 'implementation_scope' in state
    ? {
        implementation_scope: state.implementation_scope,
        verification_evidence: state.verification_evidence,
        partial_allowance: state.partial_allowance,
      }
    : null;
}

function validateTransitionStateSemantics(
  previousState: NativeReadableChangeState,
  nextState: NativeReadableChangeState,
  envelope: ReturnType<typeof validateJournalEnvelope>,
  operation: NativeTransitionOperation,
  legacyOperation = false,
): void {
  const event = envelope.eventData;
  const previousRefs = currentStateRefs(previousState);
  const nextRefs = currentStateRefs(nextState);
  if (event.previousPhase !== previousState.phase || event.nextPhase !== nextState.phase) {
    throw new Error('Native transition journal event phases do not match its states');
  }
  if (previousState.archived || nextState.archived) {
    throw new Error('Native transition journal cannot mutate an archived change');
  }

  if (operation === 'evidence-retreat') {
    const sameIdentity =
      previousState.name === nextState.name &&
      previousState.language === nextState.language &&
      previousState.brief === nextState.brief &&
      previousState.approval === nextState.approval &&
      ('approved_contract_hash' in previousState
        ? 'approved_contract_hash' in nextState &&
          previousState.approved_contract_hash === nextState.approved_contract_hash
        : !('approved_contract_hash' in nextState)) &&
      previousState.created_at === nextState.created_at &&
      previousState.run_id === nextState.run_id &&
      isDeepStrictEqual(previousState.spec_changes, nextState.spec_changes);
    const expectedHash = nativeAdvanceEvidenceHash({ summary: event.summary });
    const validSourcePhase =
      (previousState.phase === 'archive' && previousState.verification_result === 'pass') ||
      (previousState.phase === 'verify' && previousState.verification_result === 'pending');
    if (
      !validSourcePhase ||
      nextState.phase !== 'build' ||
      nextState.verification_result !== 'pending' ||
      nextState.verification_report !== null ||
      event.verificationResult !== null ||
      event.artifacts.length !== 0 ||
      event.noCodeReason !== null ||
      envelope.evidenceHash !== expectedHash ||
      !sameIdentity ||
      previousRefs === null ||
      nextRefs === null ||
      nextRefs.implementation_scope !== null ||
      nextRefs.verification_evidence !== null ||
      nextRefs.partial_allowance !== null
    ) {
      throw new Error('Native transition journal evidence retreat semantics are invalid');
    }
    return;
  }

  if (operation === 'spec-rebase') {
    const currentHash = specRebaseEvidenceHash(
      previousState.name,
      event.summary,
      nextState.spec_changes,
    );
    const legacyHash = sha256Text(`spec-rebase:${previousState.name}:${event.summary}`);
    if (
      previousState.phase === 'shape' ||
      nextState.phase !== 'build' ||
      event.verificationResult !== null ||
      event.artifacts.length !== 0 ||
      event.noCodeReason !== null ||
      nextState.verification_result !== 'pending' ||
      nextState.verification_report !== null ||
      (!legacyOperation && envelope.evidenceHash !== currentHash) ||
      (legacyOperation &&
        envelope.evidenceHash !== currentHash &&
        envelope.evidenceHash !== legacyHash) ||
      ('implementation_scope' in nextState &&
        (nextState.implementation_scope !== null ||
          nextState.verification_evidence !== null ||
          nextState.partial_allowance !== null))
    ) {
      throw new Error('Native transition journal spec rebase semantics are invalid');
    }
    return;
  }

  if (previousState.phase === 'shape') {
    if (
      nextState.phase !== 'build' ||
      event.verificationResult !== null ||
      event.artifacts.length !== 0 ||
      event.noCodeReason !== null ||
      previousState.verification_result !== 'pending' ||
      nextState.verification_result !== 'pending' ||
      previousState.verification_report !== null ||
      nextState.verification_report !== null ||
      (previousRefs !== null &&
        nextRefs !== null &&
        (previousRefs.implementation_scope !== null ||
          previousRefs.verification_evidence !== null ||
          previousRefs.partial_allowance !== null ||
          nextRefs.implementation_scope !== null ||
          nextRefs.verification_evidence !== null ||
          nextRefs.partial_allowance !== null))
    ) {
      throw new Error('Native transition journal Shape to Build semantics are invalid');
    }
    return;
  }

  if (previousState.phase === 'build') {
    if (
      nextState.phase !== 'verify' ||
      event.verificationResult !== null ||
      (event.artifacts.length === 0 && event.noCodeReason === null) ||
      nextState.verification_result !== 'pending' ||
      nextState.verification_report !== null ||
      (previousRefs !== null &&
        nextRefs !== null &&
        (nextRefs.implementation_scope === null ||
          nextRefs.verification_evidence !== null ||
          (nextRefs.implementation_scope !== previousRefs.implementation_scope &&
            nextRefs.partial_allowance !== null &&
            nextRefs.partial_allowance === previousRefs.partial_allowance)))
    ) {
      throw new Error('Native transition journal Build to Verify semantics are invalid');
    }
    return;
  }

  if (previousState.phase === 'verify') {
    const expectedNext = event.verificationResult === 'pass' ? 'archive' : 'build';
    if (
      (event.verificationResult !== 'pass' && event.verificationResult !== 'fail') ||
      nextState.phase !== expectedNext ||
      event.artifacts.length !== 0 ||
      event.noCodeReason !== null ||
      nextState.verification_result !== event.verificationResult ||
      nextState.verification_report === null ||
      (previousRefs !== null &&
        nextRefs !== null &&
        (previousRefs.implementation_scope === null ||
          nextRefs.implementation_scope !== previousRefs.implementation_scope ||
          nextRefs.partial_allowance !== previousRefs.partial_allowance ||
          previousRefs.verification_evidence !== null ||
          nextRefs.verification_evidence === null))
    ) {
      throw new Error('Native transition journal Verify outcome semantics are invalid');
    }
    return;
  }

  throw new Error('Native transition journal cannot advance from Archive');
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
  if (
    journal.operation !== 'advance' &&
    journal.operation !== 'spec-rebase' &&
    journal.operation !== 'evidence-retreat'
  ) {
    throw new Error('Native transition journal operation is invalid');
  }
  const envelope = validateJournalEnvelope(journal, expectedName);
  const previousState = parseNativeChangeValue(journal.previousState);
  const nextState = parseNativeChangeValue(journal.nextState);
  if (previousState.name !== expectedName || nextState.name !== expectedName) {
    throw new Error('Native transition journal state mismatch');
  }
  validateTransitionStateSemantics(previousState, nextState, envelope, journal.operation);
  validateTransitionRunSemantics(previousState, nextState, envelope);
  if (nextState.revision !== previousState.revision + 1) {
    throw new Error('Native transition journal state revision must advance exactly once');
  }
  return {
    schema: NATIVE_TRANSITION_SCHEMA,
    minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
    revision,
    operation: journal.operation,
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
  const envelope = validateJournalEnvelope(journal, expectedName, true);
  const previousState = parseLegacyNativeChangeValue(journal.previousState);
  const nextState = parseLegacyNativeChangeValue(journal.nextState);
  if (previousState.name !== expectedName || nextState.name !== expectedName) {
    throw new Error('Native transition journal state mismatch');
  }
  validateTransitionStateSemantics(
    previousState,
    nextState,
    envelope,
    inferredLegacyTransitionOperation(previousState, nextState, envelope.eventData),
    true,
  );
  validateTransitionRunSemantics(previousState, nextState, envelope, true);
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

export function parseV2NativeTransitionJournalValue(
  value: unknown,
  expectedName: string,
): NativeV2TransitionJournal {
  const journal = journalRecord(value);
  rejectUnknownJournalFields(journal, V2_JOURNAL_KEYS);
  if (journal.schema !== NATIVE_V2_TRANSITION_SCHEMA) {
    throw new Error(`Expected Native transition schema ${NATIVE_V2_TRANSITION_SCHEMA}`);
  }
  const minimumRuntimeVersion = positiveInteger(
    journal.minimum_runtime_version,
    'Native v2 transition minimum_runtime_version',
  );
  if (minimumRuntimeVersion !== 2) {
    throw new Error(
      `Native transition ${NATIVE_V2_TRANSITION_SCHEMA} minimum_runtime_version must be 2`,
    );
  }
  const revision = positiveInteger(journal.revision, 'Native v2 transition revision');
  if (revision !== 1) throw new Error('Native v2 transition journal revision must be 1');
  const envelope = validateJournalEnvelope(journal, expectedName, true);
  const previousState = parseV2NativeChangeValue(journal.previousState);
  const nextState = parseV2NativeChangeValue(journal.nextState);
  if (previousState.name !== expectedName || nextState.name !== expectedName) {
    throw new Error('Native v2 transition journal state mismatch');
  }
  validateTransitionStateSemantics(
    previousState,
    nextState,
    envelope,
    inferredLegacyTransitionOperation(previousState, nextState, envelope.eventData),
    true,
  );
  validateTransitionRunSemantics(previousState, nextState, envelope, true);
  if (nextState.revision !== previousState.revision + 1) {
    throw new Error('Native v2 transition journal state revision must advance exactly once');
  }
  return {
    schema: NATIVE_V2_TRANSITION_SCHEMA,
    minimum_runtime_version: 2,
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
  if (journal.schema === NATIVE_V2_TRANSITION_SCHEMA) {
    return {
      status: 'migration-required',
      journal: parseV2NativeTransitionJournalValue(journal, expectedName),
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
    const snapshot = await readNativeProtectedFile({
      root: paths.nativeRoot,
      file,
      maxBytes: NATIVE_TRANSITION_JOURNAL_MAX_BYTES,
      label: `Native transition journal ${name}`,
    });
    return inspectNativeTransitionJournalValue(JSON.parse(snapshot.bytes.toString('utf8')), name);
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
  operation?: NativeTransitionOperation;
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
    operation: options.operation ?? 'advance',
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
  const validated = parseNativeTransitionJournalValue(journal, journal.change);
  const file = nativeTransitionJournalFile(options.paths, validated.change);
  await resolveContainedNativePath(options.paths.nativeRoot, file);
  if (await inspectPendingNativeTransition(options.paths, validated.change)) {
    throw new Error(`Native transition recovery is already pending for ${validated.change}`);
  }
  await atomicWriteJson(file, validated);
  return validated;
}

function assertRunRecoverySource(
  actual: Awaited<ReturnType<typeof readNativeRunState>>,
  journal: NativeTransitionJournal,
): 'previous' | 'next' {
  if (sameValue(actual, journal.nextRun)) return 'next';
  if (journal.previousRun === null) {
    if (actual === null) return 'previous';
  } else if (sameValue(actual, journal.previousRun)) {
    return 'previous';
  }
  throw new Error(
    `Native transition Run content changed for ${journal.change}; recovery journal was preserved`,
  );
}

function assertChangeRecoverySource(
  actual: NativeChangeState,
  journal: NativeTransitionJournal,
): 'previous' | 'next' {
  if (sameValue(actual, journal.nextState)) return 'next';
  if (sameValue(actual, journal.previousState)) return 'previous';
  throw new Error(
    `Native transition change content changed for ${journal.change}; recovery journal was preserved`,
  );
}

function expectedTrajectoryEvent(options: {
  sequence: number;
  journal: NativeTransitionJournal;
  type: 'run_started' | 'state_transitioned';
}): ReturnType<typeof trajectoryEventForComparison> {
  const { journal } = options;
  return trajectoryEventForComparison({
    sequence: options.sequence,
    timestamp: journal.createdAt,
    type: options.type,
    runId: journal.nextRun.runId,
    data:
      options.type === 'run_started'
        ? {
            runtime: 'comet-native',
            phase: journal.previousState.phase,
            transitionId: journal.id,
          }
        : { ...journal.eventData, transitionId: journal.id },
  });
}

function trajectoryEventForComparison(event: {
  sequence: number;
  timestamp: string;
  type: string;
  runId: string;
  data: Record<string, unknown>;
}): {
  sequence: number;
  timestamp: string;
  type: string;
  runId: string;
  data: Record<string, unknown>;
} {
  return {
    sequence: event.sequence,
    timestamp: event.timestamp,
    type: event.type,
    runId: event.runId,
    data: event.data,
  };
}

function inspectExistingTransitionEvents(
  trajectory: Awaited<ReturnType<typeof readNativeTrajectory>>,
  journal: NativeTransitionJournal,
): {
  started: (typeof trajectory)[number] | null;
  transitioned: (typeof trajectory)[number] | null;
} {
  const collisions = trajectory
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.data.transitionId === journal.id);
  const started = collisions.filter(({ event }) => event.type === 'run_started');
  const transitioned = collisions.filter(({ event }) => event.type === 'state_transitioned');
  if (
    collisions.length !== started.length + transitioned.length ||
    started.length > (journal.previousRun === null ? 1 : 0) ||
    transitioned.length > 1 ||
    (journal.previousRun === null &&
      transitioned.length === 1 &&
      (started.length !== 1 || started[0].index >= transitioned[0].index))
  ) {
    throw new Error(
      `Native trajectory transition id collision for ${journal.change}; recovery journal was preserved`,
    );
  }
  for (const item of [...started, ...transitioned]) {
    const expected = expectedTrajectoryEvent({
      sequence: item.index + 1,
      journal,
      type: item.event.type as 'run_started' | 'state_transitioned',
    });
    if (!sameValue(trajectoryEventForComparison(item.event), expected)) {
      throw new Error(
        `Native trajectory event changed for transition ${journal.id}; recovery journal was preserved`,
      );
    }
  }
  return {
    started: started[0]?.event ?? null,
    transitioned: transitioned[0]?.event ?? null,
  };
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
  const initialEvents = inspectExistingTransitionEvents(
    await readNativeTrajectory(changeDir, journal.nextRun.trajectoryRef),
    journal,
  );
  const [actualRun, actualChange] = await Promise.all([
    readNativeRunState(changeDir),
    readNativeChange(paths, name),
  ]);
  const runSource = assertRunRecoverySource(actualRun, journal);
  const changeSource = assertChangeRecoverySource(actualChange, journal);
  if (
    (initialEvents.started || initialEvents.transitioned) &&
    (runSource !== 'next' || changeSource !== 'next')
  ) {
    throw new Error(
      `Native trajectory is ahead of transition state for ${journal.change}; recovery journal was preserved`,
    );
  }

  if (runSource === 'previous') {
    await writeNativeRunState(changeDir, journal.nextRun);
    await hooks?.afterRunStateWritten?.(journal);
  }
  if (!sameValue(await readNativeRunState(changeDir), journal.nextRun)) {
    throw new Error(
      `Native transition Run content changed while continuing ${journal.change}; recovery journal was preserved`,
    );
  }
  if (changeSource === 'previous') {
    const persisted = await compareAndSwapNativeChangeLocked(
      paths,
      journal.nextState,
      journal.previousState.revision,
    );
    if (!sameValue(persisted, journal.nextState)) {
      throw new Error(
        `Native transition change write diverged for ${journal.change}; recovery journal was preserved`,
      );
    }
    await hooks?.afterChangeStateWritten?.(journal);
  }
  if (!sameValue(await readNativeChange(paths, name), journal.nextState)) {
    throw new Error(
      `Native transition change content changed while continuing ${journal.change}; recovery journal was preserved`,
    );
  }
  const activeJournal = await inspectPendingNativeTransition(paths, name);
  if (!activeJournal || !sameValue(activeJournal, journal)) {
    throw new Error(
      `Native transition journal changed while continuing ${journal.change}; it was preserved`,
    );
  }

  const existingEvents = inspectExistingTransitionEvents(
    await readNativeTrajectory(changeDir, journal.nextRun.trajectoryRef),
    journal,
  );
  if (journal.previousRun === null) {
    if (!existingEvents.started) {
      await appendNativeTrajectoryEvent({
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
    }
  }
  let event = existingEvents.transitioned;
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
  const [finalRun, finalChange] = await Promise.all([
    readNativeRunState(changeDir),
    readNativeChange(paths, name),
  ]);
  assertRunRecoverySource(finalRun, { ...journal, previousRun: journal.nextRun });
  assertChangeRecoverySource(finalChange, {
    ...journal,
    previousState: journal.nextState,
  });
  const finalJournal = await inspectPendingNativeTransition(paths, name);
  if (!finalJournal || !sameValue(finalJournal, journal)) {
    throw new Error(
      `Native transition journal changed while continuing ${journal.change}; it was not removed`,
    );
  }
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
