import { advanceNativeSupervisorIntegrationHead } from './native-supervisor-coordinator.js';
import {
  readNativeSupervisorState,
  writeNativeSupervisorState,
} from './native-supervisor-state.js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  applyNativeVerifierEnvelope,
  confirmNativeVerifierUnavailable,
  recordNativeVerifierExecutionError,
  reserveNativeVerifierAttempt,
  resolveNativeVerifierBlocker,
  retryNativeVerifier,
  returnNativeCandidateToBuild,
  submitNativeBuilderCandidate,
  type NativeBuilderCandidateInput,
} from './native-loop-runtime.js';
import { withNativeMutation } from './native-mutation.js';
import {
  assertNativePortableExpectedContinuationLocked,
  type NativePortableExpectedContinuation,
} from './native-portable-requirements.js';
import {
  nativePortableChangeDir,
  readNativePortableChange,
  writePortableMutation,
} from './native-portable-storage.js';
import type { NativePortableState } from './native-portable-types.js';
import {
  isNativeTrustedVerifierEnvelope,
  type NativeTrustedVerifierEnvelope,
} from './native-runner-protocol.js';
import type { NativeProjectPaths } from './native-types.js';
import { inspectNativeVerificationReportAlignment } from './native-verification-report-v2.js';
import { writeNativeSdkVerificationReport } from './native-sdk-report.js';
import {
  activeNativeVerifierAction,
  completeNativeVerifierAction,
  createNativeVerifierAction,
  isDuplicateNativeVerifierResponse,
  nativeVerifierActionExecutionRef,
  startNativeVerifierAction,
} from './native-verifier-action.js';
import {
  parseNativeVerifierResponse,
  type NativeVerifierResponse,
} from './native-verifier-protocol.js';

export interface NativeVerifierAttemptBinding {
  stateVersion: number;
  iteration: number;
  attempt: number;
  verifierExecutionRef: string;
}
type Change = { paths: NativeProjectPaths; name: string };
export function assertCurrentVerifierAttempt(options: {
  state: NativePortableState;
  expected: NativeVerifierAttemptBinding;
}): void {
  const { state, expected } = options;
  const action = activeNativeVerifierAction(state);
  if (
    state.state_version !== expected.stateVersion ||
    state.phase !== 'verify' ||
    state.status !== 'active' ||
    state.loop.next_action !== 'await-verifier-result' ||
    state.loop.iteration !== expected.iteration ||
    state.loop.attempt !== expected.attempt ||
    (action && nativeVerifierActionExecutionRef(action) !== expected.verifierExecutionRef)
  )
    throw new Error('Native Verifier message is stale for the current task');
}
export function assertCurrentVerifierEnvelope(options: {
  state: NativePortableState;
  envelope: unknown;
}): NativeTrustedVerifierEnvelope<unknown> {
  const { state, envelope } = options;
  if (!isNativeTrustedVerifierEnvelope(envelope))
    throw new Error('Native Verifier result requires its platform task identity');
  const action = activeNativeVerifierAction(state);
  if (
    state.phase !== 'verify' ||
    state.status !== 'active' ||
    state.loop.next_action !== 'await-verifier-result' ||
    !state.builder_handoff ||
    envelope.candidateId !== state.builder_handoff.candidate_id ||
    envelope.identityProvider !== state.builder_handoff.identity_provider ||
    envelope.verifierExecutionRef === state.builder_handoff.builder_execution_ref ||
    (action &&
      nativeVerifierActionExecutionRef(action) !== null &&
      nativeVerifierActionExecutionRef(action) !== envelope.verifierExecutionRef)
  )
    throw new Error('Native Verifier result does not match the current candidate and task');
  return envelope;
}
export function nativeVerifierResponsePosition(response: NativeVerifierResponse) {
  return {
    iteration: response.result.iteration,
    attempt: response.result.attempt,
  };
}
async function mutate(
  options: Change,
  apply: (state: NativePortableState) => NativePortableState | Promise<NativePortableState>,
) {
  return withNativeMutation(options.paths, async () => {
    const state = await readNativePortableChange(options.paths, options.name);
    const next = await apply(state);
    if (next === state) return state;
    return writePortableMutation({
      paths: options.paths,
      previous: state,
      next,
    });
  });
}
export async function submitNativePortableBuilderCandidate(
  options: Change & {
    input: NativeBuilderCandidateInput;
    projectRoot?: string;
  },
): Promise<NativePortableState> {
  return mutate(options, (state) => submitNativeBuilderCandidate({ state, input: options.input }));
}
export async function dispatchNativePortableVerifier(
  options: Change & {
    verifierExecutionId?: string | null;
    projectRoot?: string;
  },
): Promise<NativePortableState> {
  return mutate(options, async (state) => {
    const supervisor = state.children_contract_ref
      ? await readNativeSupervisorState(options.paths, options.name)
      : null;
    if (supervisor) {
      const current = advanceNativeSupervisorIntegrationHead(supervisor);
      if (current !== supervisor) await writeNativeSupervisorState(options.paths, current);
    }
    const next = reserveNativeVerifierAttempt(state);
    next.verifier_action = createNativeVerifierAction({
      state: next,
      operationId: randomUUID(),
      executionRef: options.verifierExecutionId ?? null,
      registeredAt: new Date().toISOString(),
    });
    return next;
  });
}
export async function confirmNativePortableVerifierStart(
  options: Change & {
    expected: NativeVerifierAttemptBinding;
    projectRoot?: string;
  },
): Promise<NativePortableState> {
  return mutate(options, (state) => {
    assertCurrentVerifierAttempt({ state, expected: options.expected });
    if (
      state.verifier_action?.status === 'running' &&
      state.verifier_action.claim?.token === options.expected.verifierExecutionRef
    )
      return state;
    const action =
      state.verifier_action ??
      createNativeVerifierAction({
        state,
        operationId: randomUUID(),
        executionRef: options.expected.verifierExecutionRef,
        registeredAt: new Date().toISOString(),
      });
    return {
      ...state,
      state_version: state.state_version + 1,
      verifier_action: startNativeVerifierAction(action, options.expected.verifierExecutionRef),
    };
  });
}
export async function submitNativePortableVerifierResult(
  options: Change & {
    envelope: unknown;
    maxVerifyFailures: number;
    projectRoot?: string;
  },
) {
  return withNativeMutation(options.paths, async () => {
    const state = await readNativePortableChange(options.paths, options.name);
    if (
      isNativeTrustedVerifierEnvelope(options.envelope) &&
      isDuplicateNativeVerifierResponse({
        state,
        candidateId: options.envelope.candidateId,
        executionRef: options.envelope.verifierExecutionRef,
        response: options.envelope.payload,
      })
    )
      return { state, response: parseNativeVerifierResponse(options.envelope.payload) };
    const envelope = assertCurrentVerifierEnvelope({ state, envelope: options.envelope });
    const applied = applyNativeVerifierEnvelope({
      state,
      envelope,
      maxVerifyFailures: options.maxVerifyFailures,
      reportedChecks: state.builder_handoff?.checks,
    });
    const action =
      state.verifier_action ??
      createNativeVerifierAction({
        state,
        operationId: randomUUID(),
        executionRef: envelope.verifierExecutionRef,
        registeredAt: new Date().toISOString(),
      });
    const written = await writePortableMutation({
      paths: options.paths,
      previous: state,
      next: {
        ...applied.state,
        verifier_action: completeNativeVerifierAction({
          action,
          executionRef: envelope.verifierExecutionRef,
          response: envelope.payload,
        }).action,
      },
    });
    if (written.verification)
      await writeNativeSdkVerificationReport({
        paths: options.paths,
        runId: state.name,
        file: path.join(nativePortableChangeDir(options.paths, state.name), 'verification.md'),
        state: written,
      });
    return { state: written, response: applied.response };
  });
}
export async function recordNativePortableVerifierFailure(
  options: Change & {
    summary: string;
    expected: NativeVerifierAttemptBinding;
    requireSkillCoordination?: boolean;
  },
) {
  return mutate(options, (state) => {
    assertCurrentVerifierAttempt({ state, expected: options.expected });
    return recordNativeVerifierExecutionError({
      state,
      summary: options.summary,
    });
  });
}
// 旧 unavailable 回报只记录未取得验收结果，不替 Agent 生成通过结论。
export const recordNativePortableVerifierUnavailable = recordNativePortableVerifierFailure;
export async function confirmNativePortableVerifierUnavailable(
  options: Change & {
    summary: string;
    expectedContinuation?: NativePortableExpectedContinuation;
  },
) {
  return mutate(options, (state) => {
    assertNativePortableExpectedContinuationLocked({
      state,
      expected: options.expectedContinuation,
      action: 'confirm-verifier-unavailable',
    });
    return confirmNativeVerifierUnavailable({
      state,
      summary: options.summary,
    });
  });
}
export async function resolveNativePortableVerifierBlocker(
  options: Change & {
    reason?: string;
    expectedContinuation?: NativePortableExpectedContinuation;
  },
) {
  return mutate(options, (state) => {
    assertNativePortableExpectedContinuationLocked({
      state,
      expected: options.expectedContinuation,
      action: 'resolve-verifier-blocker',
    });
    return resolveNativeVerifierBlocker(state, { reason: options.reason });
  });
}
export async function retryNativePortableVerifier(
  options: Change & {
    expectedContinuation?: NativePortableExpectedContinuation;
  },
) {
  return mutate(options, (state) => {
    assertNativePortableExpectedContinuationLocked({
      state,
      expected: options.expectedContinuation,
      action: 'retry-verifier',
    });
    return retryNativeVerifier(state);
  });
}
export async function returnNativePortableChangeToBuild(
  options: Change & {
    reason: string;
    expectedContinuation?: NativePortableExpectedContinuation;
    failureBudget?: { maxVerifyFailures: number };
  },
) {
  return mutate(options, (state) => {
    assertNativePortableExpectedContinuationLocked({
      state,
      expected: options.expectedContinuation,
      action: 'revise-implementation',
    });
    return state.phase === 'build'
      ? state
      : returnNativeCandidateToBuild({
          state,
          reason: options.reason,
          ...(options.failureBudget ? { failureBudget: options.failureBudget } : {}),
        });
  });
}
export async function ensureNativePortableReport(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<'aligned' | 'rebuilt' | 'not-applicable'> {
  if (!options.state.verification) return 'not-applicable';
  const file = path.join(
    nativePortableChangeDir(options.paths, options.state.name),
    'verification.md',
  );
  if (
    (await inspectNativeVerificationReportAlignment({
      file,
      stateVersion: options.state.state_version,
    })) === 'aligned'
  )
    return 'aligned';
  await writeNativeSdkVerificationReport({
    paths: options.paths,
    runId: options.state.name,
    file,
    state: options.state,
  });
  return 'rebuilt';
}
