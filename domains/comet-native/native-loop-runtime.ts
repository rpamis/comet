import { randomUUID } from 'node:crypto';

import { appendNativePortableHistory, parseNativePortableState } from './native-portable-state.js';
import { toNativePortableText } from './native-portable-text.js';
import type {
  NativeBuilderCheckSummary,
  NativePortableAcceptanceState,
  NativePortableCheckSummary,
  NativePortableHistoryEntry,
  NativePortableState,
  NativePortableVerificationState,
} from './native-portable-types.js';
import {
  isNativeTrustedExecutionIdentity,
  NATIVE_SKILL_COORDINATION,
  type NativeTrustedExecutionIdentity,
  type NativeTrustedVerifierEnvelope,
} from './native-runner-protocol.js';
import {
  validateNativeTrustedVerifierEnvelope,
  type NativeVerifierResponse,
} from './native-verifier-protocol.js';

export const NATIVE_MAX_VERIFIER_EXECUTION_FAILURES = 3;
export const NATIVE_MAX_REQUEST_CHECK_ROUNDS = 2;

export interface NativeBuilderCandidateInput {
  identity: NativeTrustedExecutionIdentity;
  summary: string;
  addressedAcceptanceIds: string[];
  checks?: Array<{ name: string; result: 'passed' | 'failed' | 'not-run'; note?: string | null }>;
  knownLimits?: string[];
  candidateId?: string;
  now?: Date;
}

function nextVersion(state: NativePortableState): number {
  return state.state_version + 1;
}

function uniqueKnownIds(
  values: readonly string[],
  acceptance: readonly NativePortableAcceptanceState[],
  label: string,
): string[] {
  const ids = [...values];
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate IDs`);
  const known = new Set(acceptance.map(({ id }) => id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`${label} contains unknown IDs: ${unknown.join(', ')}`);
  return ids;
}

function pendingAcceptance(
  acceptance: readonly NativePortableAcceptanceState[],
): NativePortableAcceptanceState[] {
  return acceptance.map((entry) => ({ ...entry, result: 'pending', reason: null }));
}

function builderChecks(checks: NativeBuilderCandidateInput['checks']): NativeBuilderCheckSummary[] {
  return (checks ?? []).map((check) => ({
    name: toNativePortableText(check.name),
    result: check.result,
    note: check.note ? toNativePortableText(check.note) : null,
  }));
}

function historyEntry(options: {
  state: NativePortableState;
  outcome: NativePortableHistoryEntry['outcome'];
  unresolvedIds?: string[];
  summary: string;
  completedAt: string;
}): NativePortableHistoryEntry {
  return {
    goal_cycle: options.state.loop.goal_cycle,
    iteration: options.state.loop.iteration,
    attempt: options.state.loop.attempt,
    outcome: options.outcome,
    unresolved_ids: options.unresolvedIds ?? [],
    summary: toNativePortableText(options.summary),
    completed_at: options.completedAt,
  };
}

export function confirmNativePortableAcceptance(options: {
  state: NativePortableState;
  acceptance: Array<Pick<NativePortableAcceptanceState, 'id' | 'source' | 'text'>>;
}): NativePortableState {
  const state = parseNativePortableState(options.state);
  if (state.phase !== 'shape' || state.status !== 'active') {
    throw new Error('Native acceptance can only be confirmed from active Shape');
  }
  if (options.acceptance.length === 0) {
    throw new Error('Native acceptance cannot be empty');
  }
  const ids = options.acceptance.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error('Native acceptance IDs must be unique');
  return parseNativePortableState({
    ...state,
    phase: 'build',
    state_version: nextVersion(state),
    loop: {
      ...state.loop,
      stage: 'building',
      iteration: 1,
      attempt: 0,
      next_action: 'submit-builder-candidate',
    },
    acceptance: options.acceptance.map((entry) => ({ ...entry, result: 'pending', reason: null })),
  });
}

export function submitNativeBuilderCandidate(options: {
  state: NativePortableState;
  input: NativeBuilderCandidateInput;
}): NativePortableState {
  const state = parseNativePortableState(options.state);
  const { input } = options;
  if (state.phase !== 'build' || state.status !== 'active') {
    throw new Error('Native candidate can only be submitted from active Build');
  }
  if (!isNativeTrustedExecutionIdentity(input.identity)) {
    throw new Error('Native Builder identity must come from the trusted Runner channel');
  }
  const addressed = uniqueKnownIds(
    input.addressedAcceptanceIds,
    state.acceptance,
    'Native Builder addressed acceptance',
  );
  const now = (input.now ?? new Date()).toISOString();
  return parseNativePortableState({
    ...state,
    phase: 'verify',
    state_version: nextVersion(state),
    verification_result: 'pending',
    verification_report: null,
    verification: null,
    blockers: [],
    acceptance: pendingAcceptance(state.acceptance),
    builder_handoff: {
      candidate_id: input.candidateId ?? randomUUID(),
      identity_provider: input.identity.identityProvider,
      builder_execution_ref: input.identity.executionRef,
      iteration: state.loop.iteration,
      summary: toNativePortableText(input.summary),
      addressed_acceptance_ids: addressed,
      checks: builderChecks(input.checks),
      checks_truncated: false,
      known_limits: (input.knownLimits ?? []).map((entry) => toNativePortableText(entry)),
      known_limits_truncated: false,
      submitted_at: now,
    },
    loop: {
      ...state.loop,
      stage: 'verify-ready',
      attempt: 0,
      execution_failure_count: 0,
      next_action: 'run-required-checks-and-dispatch-verifier',
    },
  });
}

export function reserveNativeVerifierAttempt(stateInput: NativePortableState): NativePortableState {
  const state = parseNativePortableState(stateInput);
  if (
    state.phase !== 'verify' ||
    state.status !== 'active' ||
    state.loop.stage !== 'verify-ready' ||
    state.builder_handoff === null
  ) {
    throw new Error('Native Verifier attempt is not ready to dispatch');
  }
  return parseNativePortableState({
    ...state,
    state_version: nextVersion(state),
    loop: {
      ...state.loop,
      attempt: state.loop.attempt + 1,
      next_action: 'await-verifier-result',
    },
  });
}

function progressCounters(state: NativePortableState, unresolvedIds: string[]): number {
  const previous = state.loop.previous_unresolved_ids;
  if (previous.length === 0) return 0;
  const previousSet = new Set(previous);
  const currentSet = new Set(unresolvedIds);
  const strictSubset =
    currentSet.size < previousSet.size && [...currentSet].every((id) => previousSet.has(id));
  return strictSubset ? 0 : state.loop.no_progress_count + 1;
}

function verificationState(options: {
  state: NativePortableState;
  envelope: NativeTrustedVerifierEnvelope<unknown>;
  response: Extract<NativeVerifierResponse, { kind: 'final-result' }>;
  checks: NativePortableCheckSummary[];
  completedAt: string;
}): NativePortableVerificationState {
  return {
    candidate_id: options.envelope.candidateId,
    identity_provider: options.envelope.identityProvider,
    verifier_execution_ref: options.envelope.verifierExecutionRef,
    iteration: options.state.loop.iteration,
    attempt: options.state.loop.attempt,
    assurance:
      options.envelope.identityProvider === NATIVE_SKILL_COORDINATION
        ? 'skill-coordinated'
        : 'host-attested',
    verdict: options.response.result.verdict,
    checks: options.checks,
    summary: toNativePortableText(options.response.result.summary),
    risks: options.response.result.risks.map((risk) => toNativePortableText(risk)),
    risks_truncated: false,
    completed_at: options.completedAt,
  };
}

export function applyNativeVerifierEnvelope(options: {
  state: NativePortableState;
  envelope: NativeTrustedVerifierEnvelope<unknown> | unknown;
  checks: NativePortableCheckSummary[];
  maxVerifyFailures: number;
  now?: Date;
}): { state: NativePortableState; response: NativeVerifierResponse } {
  const state = parseNativePortableState(options.state);
  if (state.phase !== 'verify' || state.builder_handoff === null || state.loop.attempt < 1) {
    throw new Error('Native change is not awaiting a Verifier result');
  }
  const response = validateNativeTrustedVerifierEnvelope({
    envelope: options.envelope,
    binding: {
      candidateId: state.builder_handoff.candidate_id,
      identityProvider: state.builder_handoff.identity_provider,
      builderExecutionRef: state.builder_handoff.builder_execution_ref,
      iteration: state.loop.iteration,
      attempt: state.loop.attempt,
      acceptanceIds: state.acceptance.map(({ id }) => id),
      requiredChecksPassed: options.checks.every(({ status }) => status === 'passed'),
    },
  });
  if (response.kind === 'request-checks') return { state, response };

  if (!Number.isSafeInteger(options.maxVerifyFailures) || options.maxVerifyFailures < 1) {
    throw new Error('Native max Verify failures must be a positive integer');
  }
  const completedAt = (options.now ?? new Date()).toISOString();
  const acceptanceById = new Map(response.result.acceptance.map((entry) => [entry.id, entry]));
  const acceptance = state.acceptance.map((entry) => {
    const result = acceptanceById.get(entry.id)!;
    return {
      ...entry,
      result: result.result,
      reason: toNativePortableText(result.reason),
    };
  });
  const unresolvedIds = acceptance
    .filter(({ result }) => result === 'failed' || result === 'blocked')
    .map(({ id }) => id);
  const verification = verificationState({
    state,
    envelope: options.envelope as NativeTrustedVerifierEnvelope<unknown>,
    response,
    checks: options.checks,
    completedAt,
  });

  if (response.result.verdict === 'pass') {
    const withHistory = appendNativePortableHistory(
      { ...state, acceptance, verification } as NativePortableState,
      historyEntry({
        state,
        outcome: 'pass',
        summary: response.result.summary,
        completedAt,
      }),
    );
    const skillCoordinated = state.builder_handoff.identity_provider === NATIVE_SKILL_COORDINATION;
    return {
      response,
      state: parseNativePortableState({
        ...withHistory,
        phase: skillCoordinated ? 'verify' : 'archive',
        status: skillCoordinated ? 'await-user' : 'active',
        state_version: nextVersion(state),
        verification_result: 'pass',
        verification_report: 'verification.md',
        blockers: skillCoordinated
          ? [
              {
                owner: 'user',
                reason: toNativePortableText(
                  'The generic Skill bridge cannot prove an independent Verifier execution; user confirmation is required before Archive.',
                ),
                acceptance_ids: [],
                resolution_action: 'await-user',
              },
            ]
          : [],
        loop: {
          ...state.loop,
          stage: skillCoordinated ? 'await-user' : 'archive-ready',
          execution_failure_count: 0,
          previous_unresolved_ids: [],
          no_progress_count: 0,
          next_action: skillCoordinated ? 'confirm-skill-coordinated-pass' : 'archive',
        },
      }),
    };
  }

  if (response.result.verdict === 'blocked') {
    const withHistory = appendNativePortableHistory(
      { ...state, acceptance, verification } as NativePortableState,
      historyEntry({
        state,
        outcome: 'blocked',
        unresolvedIds,
        summary: response.result.summary,
        completedAt,
      }),
    );
    return {
      response,
      state: parseNativePortableState({
        ...withHistory,
        status: 'await-user',
        state_version: nextVersion(state),
        verification_result: 'blocked',
        verification_report: 'verification.md',
        blockers: [
          {
            owner: 'user',
            reason: toNativePortableText(response.result.summary),
            acceptance_ids: unresolvedIds,
            resolution_action: 'resolve-verifier-blocker',
          },
        ],
        loop: {
          ...state.loop,
          stage: 'await-user',
          execution_failure_count: 0,
          previous_unresolved_ids: unresolvedIds,
          next_action: 'resolve-verifier-blocker',
        },
      }),
    };
  }

  const failedIterationCount = state.loop.failed_iteration_count + 1;
  const noProgressCount = progressCounters(state, unresolvedIds);
  const limitReached = failedIterationCount >= options.maxVerifyFailures;
  const stalled = noProgressCount >= 3;
  const stop = limitReached || stalled;
  const withHistory = appendNativePortableHistory(
    { ...state, acceptance, verification } as NativePortableState,
    historyEntry({
      state,
      outcome: 'fail',
      unresolvedIds,
      summary: response.result.summary,
      completedAt,
    }),
  );
  return {
    response,
    state: parseNativePortableState({
      ...withHistory,
      phase: stop ? 'verify' : 'build',
      status: stop ? 'await-user' : 'active',
      state_version: nextVersion(state),
      verification_result: 'fail',
      verification_report: 'verification.md',
      // Keep the failed candidate handoff while Build repairs it so zero-context
      // recovery and Dashboard can explain the previous conclusion. The next
      // candidate submission replaces this handoff atomically.
      builder_handoff: state.builder_handoff,
      blockers: stop
        ? [
            {
              owner: 'user',
              reason: toNativePortableText(
                limitReached
                  ? 'Native verification reached the configured failed iteration limit.'
                  : 'Native verification did not strictly reduce the unresolved acceptance set three times.',
              ),
              acceptance_ids: unresolvedIds,
              resolution_action: 'await-user',
            },
          ]
        : noProgressCount >= 2
          ? [
              {
                owner: 'builder',
                reason: toNativePortableText(
                  'Native verification has not made reliable progress twice; use a different repair hypothesis before resubmitting.',
                ),
                acceptance_ids: unresolvedIds,
                resolution_action: 'return-build',
              },
            ]
          : [],
      loop: {
        ...state.loop,
        stage: stop ? 'await-user' : 'repairing',
        iteration: stop ? state.loop.iteration : state.loop.iteration + 1,
        attempt: stop ? state.loop.attempt : 0,
        failed_iteration_count: failedIterationCount,
        no_progress_count: noProgressCount,
        execution_failure_count: 0,
        previous_unresolved_ids: unresolvedIds,
        next_action: stop ? 'await-user' : 'repair-failed-acceptance',
      },
    }),
  };
}

export function confirmNativeSkillCoordinatedPass(
  stateInput: NativePortableState,
): NativePortableState {
  const state = parseNativePortableState(stateInput);
  if (
    state.phase !== 'verify' ||
    state.status !== 'await-user' ||
    state.verification_result !== 'pass' ||
    state.verification === null ||
    state.builder_handoff?.identity_provider !== NATIVE_SKILL_COORDINATION ||
    state.loop.stage !== 'await-user' ||
    state.loop.next_action !== 'confirm-skill-coordinated-pass'
  ) {
    throw new Error('Native change is not awaiting Skill-coordinated pass confirmation');
  }
  return parseNativePortableState({
    ...state,
    phase: 'archive',
    status: 'active',
    state_version: nextVersion(state),
    blockers: [],
    loop: {
      ...state.loop,
      stage: 'archive-ready',
      next_action: 'archive',
    },
  });
}

export function recordNativeVerifierUnavailable(options: {
  state: NativePortableState;
  checks: NativePortableCheckSummary[];
  verifierExecutionRef: string;
  summary: string;
  now?: Date;
}): NativePortableState {
  const state = parseNativePortableState(options.state);
  if (
    state.phase !== 'verify' ||
    state.status !== 'active' ||
    state.builder_handoff?.identity_provider !== NATIVE_SKILL_COORDINATION ||
    state.loop.attempt < 1 ||
    state.loop.next_action !== 'await-verifier-result'
  ) {
    throw new Error('Native semantic verification unavailability requires an active Skill attempt');
  }
  if (options.checks.some(({ status }) => status !== 'passed')) {
    throw new Error(
      'Native semantic verification unavailability requires every resolved Runtime check to pass',
    );
  }
  const completedAt = (options.now ?? new Date()).toISOString();
  const acceptanceIds = state.acceptance.map(({ id }) => id);
  const withHistory = appendNativePortableHistory(
    state,
    historyEntry({
      state,
      outcome: 'blocked',
      unresolvedIds: acceptanceIds,
      summary: options.summary,
      completedAt,
    }),
  );
  return parseNativePortableState({
    ...withHistory,
    status: 'await-user',
    state_version: nextVersion(state),
    verification_result: 'blocked',
    verification_report: 'verification.md',
    verification: {
      candidate_id: state.builder_handoff.candidate_id,
      identity_provider: state.builder_handoff.identity_provider,
      verifier_execution_ref: options.verifierExecutionRef,
      iteration: state.loop.iteration,
      attempt: state.loop.attempt,
      assurance: 'semantic-verification-unavailable',
      verdict: 'blocked',
      checks: options.checks,
      summary: toNativePortableText(options.summary),
      risks: [
        toNativePortableText(
          'No independent semantic Verifier execution was available; Runtime checks alone do not cover acceptance semantics.',
        ),
      ],
      risks_truncated: false,
      completed_at: completedAt,
    },
    blockers: [
      {
        owner: 'user',
        reason: toNativePortableText(
          'Independent semantic verification is unavailable on this platform; only completed Runtime checks are available, so explicit user confirmation is required before Archive.',
        ),
        acceptance_ids: acceptanceIds,
        resolution_action: 'confirm-verifier-unavailable',
      },
    ],
    loop: {
      ...state.loop,
      stage: 'await-user',
      previous_unresolved_ids: acceptanceIds,
      execution_failure_count: 0,
      next_action: 'confirm-verifier-unavailable',
    },
  });
}

export function confirmNativeVerifierUnavailable(options: {
  state: NativePortableState;
  summary: string;
  now?: Date;
}): NativePortableState {
  const state = parseNativePortableState(options.state);
  if (
    state.phase !== 'verify' ||
    state.status !== 'await-user' ||
    state.verification_result !== 'blocked' ||
    state.verification?.assurance !== 'semantic-verification-unavailable' ||
    state.loop.stage !== 'await-user' ||
    state.loop.next_action !== 'confirm-verifier-unavailable'
  ) {
    throw new Error('Native change is not awaiting degraded verification confirmation');
  }
  const completedAt = (options.now ?? new Date()).toISOString();
  const confirmation = toNativePortableText(options.summary);
  const withHistory = appendNativePortableHistory(
    state,
    historyEntry({
      state,
      outcome: 'pass',
      summary: options.summary,
      completedAt,
    }),
  );
  return parseNativePortableState({
    ...withHistory,
    phase: 'archive',
    status: 'active',
    state_version: nextVersion(state),
    verification_result: 'pass',
    verification: {
      ...state.verification,
      assurance: 'user-confirmed-degraded',
      verdict: 'pass',
      summary: confirmation,
      completed_at: completedAt,
    },
    acceptance: state.acceptance.map((entry) => ({
      ...entry,
      result: 'passed',
      reason: toNativePortableText(
        `User confirmed degraded completion without independent semantic verification: ${options.summary}`,
      ),
    })),
    blockers: [],
    loop: {
      ...state.loop,
      stage: 'archive-ready',
      previous_unresolved_ids: [],
      next_action: 'archive',
    },
  });
}

export function resolveNativeVerifierBlocker(stateInput: NativePortableState): NativePortableState {
  const state = parseNativePortableState(stateInput);
  if (
    state.phase !== 'verify' ||
    state.status !== 'await-user' ||
    state.verification_result !== 'blocked' ||
    state.verification?.verdict !== 'blocked' ||
    state.verification.assurance === 'semantic-verification-unavailable' ||
    state.loop.stage !== 'await-user' ||
    state.loop.next_action !== 'resolve-verifier-blocker' ||
    !state.blockers.some(
      ({ resolution_action }) => resolution_action === 'resolve-verifier-blocker',
    )
  ) {
    throw new Error('Native change is not awaiting resolution of a semantic Verifier blocker');
  }
  return parseNativePortableState({
    ...state,
    status: 'active',
    state_version: nextVersion(state),
    verification_result: 'pending',
    verification_report: null,
    verification: null,
    acceptance: pendingAcceptance(state.acceptance),
    blockers: [],
    loop: {
      ...state.loop,
      stage: 'verify-ready',
      retry_epoch: state.loop.retry_epoch + 1,
      execution_failure_count: 0,
      next_action: 'dispatch-new-verifier',
    },
  });
}

export function recordNativeVerifierExecutionError(options: {
  state: NativePortableState;
  summary: string;
  now?: Date;
}): NativePortableState {
  const state = parseNativePortableState(options.state);
  if (
    state.phase !== 'verify' ||
    state.status !== 'active' ||
    state.loop.attempt < 1 ||
    state.loop.next_action !== 'await-verifier-result'
  ) {
    throw new Error('Native Verifier execution error requires an active Verify attempt');
  }
  const completedAt = (options.now ?? new Date()).toISOString();
  const failureCount = state.loop.execution_failure_count + 1;
  const blocked = failureCount >= NATIVE_MAX_VERIFIER_EXECUTION_FAILURES;
  const withHistory = appendNativePortableHistory(
    state,
    historyEntry({
      state,
      outcome: 'execution-error',
      summary: options.summary,
      completedAt,
    }),
  );
  return parseNativePortableState({
    ...withHistory,
    status: blocked ? 'blocked' : 'active',
    state_version: nextVersion(state),
    blockers: blocked
      ? [
          {
            owner: 'runtime',
            reason: toNativePortableText(options.summary),
            acceptance_ids: [],
            resolution_action: 'retry-verifier',
          },
        ]
      : [],
    loop: {
      ...state.loop,
      stage: blocked ? 'blocked' : 'verify-ready',
      execution_failure_count: failureCount,
      next_action: blocked ? 'retry-verifier' : 'dispatch-new-verifier',
    },
  });
}

export function retryNativeVerifier(stateInput: NativePortableState): NativePortableState {
  const state = parseNativePortableState(stateInput);
  if (
    state.phase !== 'verify' ||
    state.status !== 'blocked' ||
    !state.blockers.some(({ resolution_action }) => resolution_action === 'retry-verifier')
  ) {
    throw new Error('Native change is not blocked on Verifier infrastructure');
  }
  return parseNativePortableState({
    ...state,
    status: 'active',
    state_version: nextVersion(state),
    blockers: [],
    loop: {
      ...state.loop,
      stage: 'verify-ready',
      retry_epoch: state.loop.retry_epoch + 1,
      execution_failure_count: 0,
      next_action: 'dispatch-new-verifier',
    },
  });
}

export function returnNativeCandidateToBuild(options: {
  state: NativePortableState;
  reason: string;
  now?: Date;
}): NativePortableState {
  const state = parseNativePortableState(options.state);
  if (state.phase !== 'verify' && state.phase !== 'archive') {
    throw new Error('Only Verify or Archive can return a candidate to Build');
  }
  const completedAt = (options.now ?? new Date()).toISOString();
  const withHistory = appendNativePortableHistory(
    state,
    historyEntry({
      state,
      outcome: 'recovery',
      summary: options.reason,
      completedAt,
    }),
  );
  return parseNativePortableState({
    ...withHistory,
    phase: 'build',
    status: 'active',
    state_version: nextVersion(state),
    verification_result: 'pending',
    verification_report: null,
    verification: null,
    builder_handoff: null,
    blockers: [],
    acceptance: pendingAcceptance(state.acceptance),
    loop: {
      ...state.loop,
      stage: 'repairing',
      iteration: state.loop.iteration + 1,
      attempt: 0,
      execution_failure_count: 0,
      next_action: 'submit-builder-candidate',
    },
  });
}
