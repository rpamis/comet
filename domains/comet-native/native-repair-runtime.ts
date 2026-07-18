import type { TrajectoryEvent } from '../engine/types.js';
import { canonicalHash } from './native-canonical-hash.js';
import {
  buildNativeRepairSignature,
  decideNativeRepairOverride,
  decideNativeRepairStagnation,
  hashNativeRepairOverrideSummary,
  NATIVE_REPAIR_STAGNATION_LIMITS,
  normalizeNativeRepairFailureTokens,
  type NativeRepairFailureFacts,
  type NativeRepairHistoryRecord,
  type NativeRepairOverrideRequest,
  type NativeRepairStagnationDecision,
} from './native-repair-stagnation.js';
import {
  parseNativeVerificationEvidenceEnvelope,
  type NativeVerificationEvidenceEnvelope,
} from './native-verification-evidence.js';
import {
  parseNativeImplementationScopeBundle,
  type NativeImplementationScopeBundle,
} from './native-verification-scope.js';
import { NATIVE_TRAJECTORY_MAX_TEXT_CHARACTERS } from './native-trajectory-limits.js';

export const NATIVE_REPAIR_TRAJECTORY_FIELD = 'repairStagnation' as const;
export const NATIVE_REPAIR_TRAJECTORY_LIMITS = {
  maxEvents: 4_096,
  maxDataDepth: 8,
  maxDataNodes: 4_096,
  maxTotalDataNodes: 65_536,
  maxObjectFields: 64,
  maxArrayEntries: 256,
  maxKeyCharacters: 128,
  maxTextCharacters: NATIVE_TRAJECTORY_MAX_TEXT_CHARACTERS,
  maxEventDataCharacters: 65_536,
  maxTotalDataCharacters: 1_048_576,
  maxRunIdCharacters: 256,
} as const;

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const REPAIR_SCOPE_HASH_TAG = 'comet.native.repair-scope.v1';
const EVENT_TYPES = new Set<TrajectoryEvent['type']>([
  'run_started',
  'action_proposed',
  'action_completed',
  'eval_completed',
  'checkpoint',
  'state_migrated',
  'state_transitioned',
  'command_check_recorded',
  'recovery_reconciled',
]);
const EVENT_KEYS = ['data', 'runId', 'sequence', 'timestamp', 'type'] as const;
const PROJECTION_KEYS = ['disposition', 'overrideSummaryHash', 'signatureHash'] as const;

export interface NativeRepairTrajectoryProjection {
  signatureHash: string;
  disposition: 'continue' | 'warn' | 'manual-stop' | 'hard-stop';
  overrideSummaryHash: string | null;
}

export interface NativeCommittedRepairTrajectory {
  trajectory: readonly unknown[];
  committedTrajectoryOffset: number;
  runId: string;
}

export interface NativeRepairEvidenceInput {
  envelope: NativeVerificationEvidenceEnvelope;
  implementationScope: NativeImplementationScopeBundle;
  categories?: readonly string[];
  failedCheckIds?: readonly string[];
}

export interface NativeRepairRuntimeInput
  extends NativeCommittedRepairTrajectory, NativeRepairEvidenceInput {}

export interface NativeRepairRuntimeResult {
  facts: NativeRepairFailureFacts;
  history: NativeRepairHistoryRecord[];
  decision: NativeRepairStagnationDecision;
  eventProjection: NativeRepairTrajectoryProjection | null;
}

export interface NativeRepairResumeInput extends NativeRepairRuntimeInput {
  currentImplementationScope: NativeImplementationScopeBundle;
}

export interface NativeRepairResumeInspection {
  disposition: 'proceed' | 'override-required' | 'hard-stop';
  reason:
    | 'scope-progress'
    | 'no-stopped-failure'
    | 'override-required'
    | 'override-already-applied'
    | 'hard-stop';
  signatureHash: string;
  history: NativeRepairHistoryRecord[];
}

export interface NativeRepairOverrideProjectionResult {
  history: NativeRepairHistoryRecord[];
  eventProjection: NativeRepairTrajectoryProjection;
}

interface NativeRepairHistoryProjection {
  history: NativeRepairHistoryRecord[];
  latestProjection: NativeRepairTrajectoryProjection | null;
}

interface DataBudget {
  nodes: number;
  characters: number;
  ancestors: Set<object>;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields are invalid`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error(`${label} must be a SHA-256 hash`);
  }
  return value;
}

/**
 * Identify repair progress from the executable contract and project snapshot, not from
 * content-addressed evidence prose such as `noCodeReason`.
 */
export function nativeRepairScopeHash(bundle: NativeImplementationScopeBundle): string {
  const scope = parseNativeImplementationScopeBundle(bundle).scope;
  return canonicalHash(REPAIR_SCOPE_HASH_TAG, {
    schema: REPAIR_SCOPE_HASH_TAG,
    contractHash: scope.contractHash,
    artifactSnapshotHash: scope.currentProjectionHash,
  });
}

function boundedRunId(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > NATIVE_REPAIR_TRAJECTORY_LIMITS.maxRunIdCharacters ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new Error('Native repair trajectory run ID is invalid');
  }
  return value;
}

function boundedData(
  value: unknown,
  depth: number,
  budget: DataBudget,
  label: string,
  legacyTransitionText = false,
): void {
  budget.nodes += 1;
  if (budget.nodes > NATIVE_REPAIR_TRAJECTORY_LIMITS.maxDataNodes) {
    throw new Error('Native repair trajectory event data exceeds its node boundary');
  }
  if (depth > NATIVE_REPAIR_TRAJECTORY_LIMITS.maxDataDepth) {
    throw new Error('Native repair trajectory event data exceeds its depth boundary');
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} contains a non-finite number`);
    }
    return;
  }
  if (typeof value === 'string') {
    if (
      value.length > NATIVE_REPAIR_TRAJECTORY_LIMITS.maxTextCharacters &&
      (!legacyTransitionText ||
        value.length > NATIVE_REPAIR_TRAJECTORY_LIMITS.maxEventDataCharacters)
    ) {
      throw new Error(`${label} contains oversized text`);
    }
    budget.characters += value.length;
    if (budget.characters > NATIVE_REPAIR_TRAJECTORY_LIMITS.maxEventDataCharacters) {
      throw new Error('Native repair trajectory event data exceeds its text boundary');
    }
    return;
  }
  if (typeof value !== 'object') {
    throw new Error(`${label} contains a non-JSON value`);
  }
  if (budget.ancestors.has(value)) throw new Error(`${label} contains a cycle`);
  budget.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > NATIVE_REPAIR_TRAJECTORY_LIMITS.maxArrayEntries) {
        throw new Error(`${label} contains an oversized array`);
      }
      value.forEach((entry, index) => boundedData(entry, depth + 1, budget, `${label}[${index}]`));
      return;
    }
    const object = record(value, label);
    const keys = Object.keys(object);
    if (keys.length > NATIVE_REPAIR_TRAJECTORY_LIMITS.maxObjectFields) {
      throw new Error(`${label} contains too many fields`);
    }
    for (const key of keys) {
      if (key.length === 0 || key.length > NATIVE_REPAIR_TRAJECTORY_LIMITS.maxKeyCharacters) {
        throw new Error(`${label} contains an invalid field name`);
      }
      budget.characters += key.length;
      if (budget.characters > NATIVE_REPAIR_TRAJECTORY_LIMITS.maxEventDataCharacters) {
        throw new Error('Native repair trajectory event data exceeds its text boundary');
      }
      boundedData(
        object[key],
        depth + 1,
        budget,
        `${label}.${key}`,
        depth === 0 && (key === 'summary' || key === 'noCodeReason'),
      );
    }
  } finally {
    budget.ancestors.delete(value);
  }
}

function parseTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64) {
    throw new Error('Native repair trajectory timestamp is invalid');
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error('Native repair trajectory timestamp is invalid');
  }
  return value;
}

function parseEvent(
  value: unknown,
  index: number,
  runId: string,
): { event: TrajectoryEvent; dataNodes: number; dataCharacters: number } {
  const event = record(value, `Native repair trajectory event ${index + 1}`);
  exactKeys(event, EVENT_KEYS, `Native repair trajectory event ${index + 1}`);
  if (!Number.isSafeInteger(event.sequence) || event.sequence !== index + 1) {
    throw new Error('Native repair trajectory sequence is invalid');
  }
  parseTimestamp(event.timestamp);
  if (typeof event.type !== 'string' || !EVENT_TYPES.has(event.type as TrajectoryEvent['type'])) {
    throw new Error('Native repair trajectory event type is invalid');
  }
  if (boundedRunId(event.runId as string) !== runId) {
    throw new Error('Native repair trajectory run ID changed inside the committed prefix');
  }
  const budget = { nodes: 0, characters: 0, ancestors: new Set<object>() };
  boundedData(event.data, 0, budget, 'Native trajectory event data');
  record(event.data, 'Native repair trajectory event data');
  return {
    event: event as unknown as TrajectoryEvent,
    dataNodes: budget.nodes,
    dataCharacters: budget.characters,
  };
}

export function parseNativeRepairTrajectoryProjection(
  value: unknown,
): NativeRepairTrajectoryProjection {
  const projection = record(value, 'Native repair trajectory projection');
  exactKeys(projection, PROJECTION_KEYS, 'Native repair trajectory projection');
  const signatureHash = hash(projection.signatureHash, 'Native repair trajectory signature hash');
  if (
    projection.disposition !== 'continue' &&
    projection.disposition !== 'warn' &&
    projection.disposition !== 'manual-stop' &&
    projection.disposition !== 'hard-stop'
  ) {
    throw new Error('Native repair trajectory disposition is invalid');
  }
  const overrideSummaryHash =
    projection.overrideSummaryHash === null
      ? null
      : hash(projection.overrideSummaryHash, 'Native repair trajectory override summary hash');
  if (overrideSummaryHash !== null && projection.disposition !== 'continue') {
    throw new Error('Native repair trajectory override must continue exactly once');
  }
  return {
    signatureHash,
    disposition: projection.disposition,
    overrideSummaryHash,
  };
}

function assertProjectionTransition(
  data: Record<string, unknown>,
  projection: NativeRepairTrajectoryProjection,
): void {
  if (projection.overrideSummaryHash === null) {
    if (
      data.previousPhase !== 'verify' ||
      data.nextPhase !== 'build' ||
      data.verificationResult !== 'fail'
    ) {
      throw new Error(
        'Native repair failure projection is only valid on a failed Verify-to-Build transition',
      );
    }
    return;
  }
  if (
    projection.disposition !== 'continue' ||
    data.previousPhase !== 'build' ||
    data.nextPhase !== 'verify' ||
    data.verificationResult !== null
  ) {
    throw new Error(
      'Native repair override projection is only valid on a Build-to-Verify transition',
    );
  }
}

function assertCommittedFailureProjection(
  projection: NativeRepairTrajectoryProjection,
  history: readonly NativeRepairHistoryRecord[],
): void {
  const failures = history.filter((entry) => entry.kind === 'failure');
  const total = failures.length + 1;
  if (total > NATIVE_REPAIR_STAGNATION_LIMITS.maxRepairIterations) {
    throw new Error('Native repair trajectory commits a failure beyond the hard-stop boundary');
  }
  let consecutive = 1;
  for (let index = failures.length - 1; index >= 0; index -= 1) {
    if (failures[index].signatureHash !== projection.signatureHash) break;
    consecutive += 1;
  }
  const expectedDisposition =
    total >= NATIVE_REPAIR_STAGNATION_LIMITS.maxRepairIterations
      ? 'hard-stop'
      : consecutive < NATIVE_REPAIR_STAGNATION_LIMITS.warningAtConsecutiveFailures
        ? 'continue'
        : consecutive < NATIVE_REPAIR_STAGNATION_LIMITS.manualStopAtConsecutiveFailures
          ? 'warn'
          : 'manual-stop';
  if (projection.disposition !== expectedDisposition || projection.overrideSummaryHash !== null) {
    throw new Error(
      `Native repair trajectory failure disposition is invalid: expected ${expectedDisposition}`,
    );
  }
}

function assertCommittedOverrideProjection(
  projection: NativeRepairTrajectoryProjection,
  history: readonly NativeRepairHistoryRecord[],
  latestProjection: NativeRepairTrajectoryProjection | null,
): void {
  const failures = history.filter((entry) => entry.kind === 'failure');
  if (failures.length >= NATIVE_REPAIR_STAGNATION_LIMITS.maxRepairIterations) {
    throw new Error('Native repair trajectory cannot override a hard stop');
  }
  if (
    latestProjection?.disposition !== 'manual-stop' ||
    latestProjection.signatureHash !== projection.signatureHash ||
    failures.at(-1)?.signatureHash !== projection.signatureHash
  ) {
    throw new Error('Native repair trajectory override does not match the latest manual stop');
  }
  if (
    history.some(
      (entry) => entry.kind === 'override' && entry.signatureHash === projection.signatureHash,
    )
  ) {
    throw new Error('Native repair trajectory signature was already overridden');
  }
}

function projectNativeRepairHistory(
  options: NativeCommittedRepairTrajectory,
): NativeRepairHistoryProjection {
  if (
    !Array.isArray(options.trajectory) ||
    options.trajectory.length > NATIVE_REPAIR_TRAJECTORY_LIMITS.maxEvents
  ) {
    throw new Error('Native repair trajectory exceeds its event boundary');
  }
  const runId = boundedRunId(options.runId);
  if (
    !Number.isSafeInteger(options.committedTrajectoryOffset) ||
    options.committedTrajectoryOffset < 0 ||
    options.committedTrajectoryOffset > options.trajectory.length
  ) {
    throw new Error('Native repair committed trajectory offset is invalid');
  }
  const history: NativeRepairHistoryRecord[] = [];
  let latestProjection: NativeRepairTrajectoryProjection | null = null;
  let activeScopeHash: string | null = null;
  let iteration = 0;
  let totalDataNodes = 0;
  let totalDataCharacters = 0;
  for (let index = 0; index < options.committedTrajectoryOffset; index += 1) {
    const parsed = parseEvent(options.trajectory[index], index, runId);
    const { event } = parsed;
    totalDataNodes += parsed.dataNodes;
    totalDataCharacters += parsed.dataCharacters;
    if (
      totalDataNodes > NATIVE_REPAIR_TRAJECTORY_LIMITS.maxTotalDataNodes ||
      totalDataCharacters > NATIVE_REPAIR_TRAJECTORY_LIMITS.maxTotalDataCharacters
    ) {
      throw new Error('Native repair committed trajectory exceeds its aggregate data boundary');
    }
    const data = event.data;
    const eventScopeHash = Object.hasOwn(data, 'repairScopeHash')
      ? hash(data.repairScopeHash, 'Native repair trajectory repair scope hash')
      : Object.hasOwn(data, 'implementationScopeHash')
        ? hash(data.implementationScopeHash, 'Native repair trajectory implementation scope hash')
        : null;
    if (!Object.hasOwn(data, NATIVE_REPAIR_TRAJECTORY_FIELD)) {
      if (
        event.type === 'state_transitioned' &&
        data.previousPhase === 'build' &&
        data.nextPhase === 'verify' &&
        ((eventScopeHash !== null &&
          activeScopeHash !== null &&
          eventScopeHash !== activeScopeHash) ||
          (eventScopeHash === null &&
            (latestProjection?.disposition === 'manual-stop' ||
              latestProjection?.disposition === 'hard-stop')))
      ) {
        // Every real implementation-scope change starts a fresh semantic repair episode. Legacy
        // trajectories did not persist the scope hash, so only their manual/hard-stop transitions
        // can be inferred safely from the Build guard.
        history.length = 0;
        latestProjection = null;
        activeScopeHash = eventScopeHash;
        iteration = 0;
        continue;
      }
      if (
        event.type === 'state_transitioned' &&
        data.previousPhase === 'verify' &&
        data.nextPhase === 'archive' &&
        data.verificationResult === 'pass'
      ) {
        // A committed passing verification closes the prior repair episode. The raw trajectory
        // still retains its history, while future failures start fresh if Archive later retreats.
        history.length = 0;
        latestProjection = null;
        activeScopeHash = null;
        iteration = 0;
      }
      continue;
    }
    if (event.type !== 'state_transitioned') {
      throw new Error('Native repair projection must belong to a state_transitioned event');
    }
    const projection = parseNativeRepairTrajectoryProjection(data[NATIVE_REPAIR_TRAJECTORY_FIELD]);
    assertProjectionTransition(data, projection);
    if (projection.overrideSummaryHash === null) {
      if (
        eventScopeHash !== null &&
        activeScopeHash !== null &&
        eventScopeHash !== activeScopeHash
      ) {
        history.length = 0;
        iteration = 0;
      }
      if (eventScopeHash !== null) activeScopeHash = eventScopeHash;
      assertCommittedFailureProjection(projection, history);
      iteration += 1;
      history.push({
        kind: 'failure',
        revision: event.sequence,
        iteration,
        signatureHash: projection.signatureHash,
      });
    } else {
      if (
        eventScopeHash !== null &&
        activeScopeHash !== null &&
        eventScopeHash !== activeScopeHash
      ) {
        throw new Error('Native repair override cannot cross implementation scope progress');
      }
      assertCommittedOverrideProjection(projection, history, latestProjection);
      const failure = history.at(-1);
      if (!failure || failure.kind !== 'failure') {
        throw new Error('Native repair trajectory override has no failure history');
      }
      history.push({
        kind: 'override',
        revision: event.sequence,
        iteration: failure.iteration,
        signatureHash: projection.signatureHash,
        summaryHash: projection.overrideSummaryHash,
      });
    }
    latestProjection = projection;
    if (history.length > NATIVE_REPAIR_STAGNATION_LIMITS.maxHistoryRecords) {
      throw new Error('Native repair trajectory history exceeds its record boundary');
    }
  }
  return { history, latestProjection };
}

export function rebuildNativeRepairHistory(
  options: NativeCommittedRepairTrajectory,
): NativeRepairHistoryRecord[] {
  return projectNativeRepairHistory(options).history;
}

export function inspectLatestNativeRepairProjection(
  options: NativeCommittedRepairTrajectory,
): NativeRepairTrajectoryProjection | null {
  const projection = projectNativeRepairHistory(options).latestProjection;
  return projection ? { ...projection } : null;
}

export function acceptLatestNativeRepairOverride(
  options: NativeCommittedRepairTrajectory & { override: NativeRepairOverrideRequest },
): NativeRepairOverrideProjectionResult {
  const projected = projectNativeRepairHistory(options);
  const request = record(options.override, 'Native repair override request');
  exactKeys(request, ['expectedSignatureHash', 'summary'], 'Native repair override request');
  const expectedSignatureHash = hash(
    request.expectedSignatureHash,
    'Native repair override expected signature',
  );
  if (typeof request.summary !== 'string') {
    throw new Error('Native repair override summary is invalid');
  }
  if (projected.latestProjection?.disposition === 'hard-stop') {
    throw new Error('Native repair hard stop cannot be overridden');
  }
  if (
    projected.latestProjection?.disposition !== 'manual-stop' ||
    projected.latestProjection.signatureHash !== expectedSignatureHash
  ) {
    throw new Error('Native repair override does not match the latest manual stop');
  }
  if (
    projected.history.some(
      (entry) => entry.kind === 'override' && entry.signatureHash === expectedSignatureHash,
    )
  ) {
    throw new Error('Native repair signature was already overridden');
  }
  const overrideSummaryHash = hashNativeRepairOverrideSummary(request.summary);
  return {
    history: projected.history,
    eventProjection: {
      signatureHash: expectedSignatureHash,
      disposition: 'continue',
      overrideSummaryHash,
    },
  };
}

export function nativeRepairFailureFacts(
  input: NativeRepairEvidenceInput,
): NativeRepairFailureFacts {
  const envelope = parseNativeVerificationEvidenceEnvelope(input.envelope);
  const bundle = parseNativeImplementationScopeBundle(input.implementationScope);
  if (envelope.result !== 'fail') {
    throw new Error('Native repair stagnation requires a failed verification envelope');
  }
  if (
    envelope.contractHash !== bundle.scope.contractHash ||
    envelope.implementationScopeHash !== bundle.scope.scopeHash
  ) {
    throw new Error('Native repair evidence does not match the implementation scope authority');
  }
  const tokens = normalizeNativeRepairFailureTokens({
    categories: input.categories,
    failedCheckIds: input.failedCheckIds,
  });
  return {
    contractHash: bundle.scope.contractHash,
    implementationScopeHash: nativeRepairScopeHash(bundle),
    artifactSnapshotHash: bundle.scope.currentProjectionHash,
    categories: tokens.categories,
    failedCheckIds: tokens.failedCheckIds,
  };
}

function projectionForDecision(
  decision: NativeRepairStagnationDecision,
  overrideSummaryHash: string | null,
): NativeRepairTrajectoryProjection {
  return {
    signatureHash: decision.signature.signatureHash,
    disposition: decision.disposition,
    overrideSummaryHash,
  };
}

function runtimeContext(input: NativeRepairRuntimeInput): {
  facts: NativeRepairFailureFacts;
  history: NativeRepairHistoryRecord[];
} {
  return {
    facts: nativeRepairFailureFacts(input),
    history: rebuildNativeRepairHistory(input),
  };
}

export function inspectNativeRepairResume(
  input: NativeRepairResumeInput,
): NativeRepairResumeInspection {
  const projected = projectNativeRepairHistory(input);
  const facts = nativeRepairFailureFacts(input);
  const latestProjection = projected.latestProjection;
  const signatureHash = buildNativeRepairSignature(facts).signatureHash;
  const currentScope = parseNativeImplementationScopeBundle(input.currentImplementationScope);
  if (nativeRepairScopeHash(currentScope) !== nativeRepairScopeHash(input.implementationScope)) {
    return {
      disposition: 'proceed',
      reason: 'scope-progress',
      signatureHash,
      history: projected.history,
    };
  }
  if (latestProjection?.disposition === 'hard-stop') {
    return {
      disposition: 'hard-stop',
      reason: 'hard-stop',
      signatureHash: latestProjection.signatureHash,
      history: projected.history,
    };
  }
  if (latestProjection?.disposition !== 'manual-stop') {
    return {
      disposition: 'proceed',
      reason:
        latestProjection === null || latestProjection.overrideSummaryHash === null
          ? 'no-stopped-failure'
          : 'override-already-applied',
      signatureHash,
      history: projected.history,
    };
  }
  if (latestProjection.signatureHash !== signatureHash) {
    throw new Error('Native repair current evidence does not match the latest manual stop');
  }
  const alreadyUsed = projected.history.some(
    (entry) => entry.kind === 'override' && entry.signatureHash === signatureHash,
  );
  return {
    disposition: alreadyUsed ? 'hard-stop' : 'override-required',
    reason: alreadyUsed ? 'override-already-applied' : 'override-required',
    signatureHash,
    history: projected.history,
  };
}

export function inspectNativeRepairFailure(
  input: NativeRepairRuntimeInput,
): NativeRepairRuntimeResult {
  const context = runtimeContext(input);
  const decision = decideNativeRepairStagnation(context);
  return {
    ...context,
    decision,
    eventProjection: projectionForDecision(decision, null),
  };
}

export function acceptNativeRepairOverride(
  input: NativeRepairRuntimeInput & { override: NativeRepairOverrideRequest },
): NativeRepairRuntimeResult {
  const context = runtimeContext(input);
  const decision = decideNativeRepairOverride({ ...context, override: input.override });
  const summaryHash = decision.overrideAccepted
    ? hashNativeRepairOverrideSummary(input.override.summary)
    : null;
  return {
    ...context,
    decision,
    eventProjection: decision.overrideAccepted
      ? projectionForDecision(decision, summaryHash)
      : null,
  };
}

export function buildNativeRepairSignatureFromEvidence(
  input: NativeRepairEvidenceInput,
): ReturnType<typeof buildNativeRepairSignature> {
  return buildNativeRepairSignature(nativeRepairFailureFacts(input));
}
