import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  inspectNativeChildren,
  nativeChildrenAcceptanceValidation,
  readNativeChildrenContract,
} from './native-children.js';
import {
  applyNativeVerifierEnvelope,
  confirmNativeVerifierUnavailable,
  NATIVE_MAX_VERIFIER_EXECUTION_FAILURES,
  recordNativeVerifierUnavailable,
  resolveNativeVerifierBlocker,
  returnNativeCandidateToBuild,
  reserveNativeVerifierAttempt,
  retryNativeVerifier,
  submitNativeBuilderCandidate,
  type NativeBuilderCandidateInput,
} from './native-loop-runtime.js';
import {
  readOrRebuildNativeLocalExecution,
  rebuildNativeLocalExecution,
  writeNativeLocalExecution,
} from './native-local-execution.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import type {
  NativeLocalExecutionState,
  NativePortableCheckSummary,
  NativePortableState,
} from './native-portable-types.js';
import type { NativeTrustedVerifierEnvelope } from './native-runner-protocol.js';
import {
  parseNativeVerifierResponse,
  type NativeVerifierResponse,
} from './native-verifier-protocol.js';
import {
  inspectNativeVerificationReportAlignment,
  writeNativeVerificationReport,
} from './native-verification-report-v2.js';
import type { NativeProjectPaths } from './native-types.js';
import { isNativeTrustedVerifierEnvelope } from './native-runner-protocol.js';
import {
  currentBranch,
  nativeLocalExecutionFile,
  nativePortableChangeDir,
  readNativePortableChange,
  writePortableMutation,
} from './native-portable-storage.js';
import {
  assertNativePortableExpectedContinuationLocked,
  ensureNativePortableAcceptanceCurrentLocked,
  type NativePortableExpectedContinuation,
} from './native-portable-requirements.js';
import {
  authoritativePortableChecks,
  executeReservedVerifierRequestedChecks,
  persistVerifierExecutionError,
  preservedLocalChecksForVersion,
  readCurrentLocalExecution,
  reserveVerifierRequestedChecks,
  type NativePortableRequestChecksOutcome,
} from './native-portable-checks.js';

export interface NativeVerifierAttemptBinding {
  stateVersion: number;
  iteration: number;
  attempt: number;
  verifierExecutionRef: string;
}

export function assertCurrentVerifierAttempt(options: {
  state: NativePortableState;
  local: NativeLocalExecutionState | null;
  expected: NativeVerifierAttemptBinding;
}): NativeLocalExecutionState {
  const { state, local, expected } = options;
  if (
    state.state_version !== expected.stateVersion ||
    state.phase !== 'verify' ||
    state.status !== 'active' ||
    state.loop.next_action !== 'await-verifier-result' ||
    state.loop.iteration !== expected.iteration ||
    state.loop.attempt !== expected.attempt ||
    state.builder_handoff === null ||
    local === null ||
    local.basedOnStateVersion !== state.state_version ||
    local.execution === null ||
    local.execution.stage !== 'verifying' ||
    local.execution.actor !== 'verifier' ||
    local.execution.status !== 'running' ||
    local.execution.executionId !== expected.verifierExecutionRef
  ) {
    throw new Error('Native Verifier execution message is stale for the current attempt');
  }
  return local;
}

export function assertCurrentVerifierEnvelope(options: {
  state: NativePortableState;
  local: NativeLocalExecutionState | null;
  envelope: NativeTrustedVerifierEnvelope<unknown> | unknown;
}): NativeTrustedVerifierEnvelope<unknown> {
  const { state, local, envelope } = options;
  if (!isNativeTrustedVerifierEnvelope(envelope)) {
    throw new Error('Native Verifier result must come from the trusted Runner channel');
  }
  if (
    state.phase !== 'verify' ||
    state.status !== 'active' ||
    state.loop.next_action !== 'await-verifier-result' ||
    state.builder_handoff === null
  ) {
    throw new Error('Native Verifier result is stale for the current workflow state');
  }
  if (
    envelope.candidateId !== state.builder_handoff.candidate_id ||
    envelope.identityProvider !== state.builder_handoff.identity_provider ||
    envelope.verifierExecutionRef === state.builder_handoff.builder_execution_ref
  ) {
    throw new Error('Native Verifier result is stale for the current candidate or identity');
  }
  if (
    local === null ||
    local.execution === null ||
    local.execution.stage !== 'verifying' ||
    local.execution.actor !== 'verifier' ||
    local.execution.status !== 'running' ||
    (local.execution.executionId !== null &&
      local.execution.executionId !== envelope.verifierExecutionRef)
  ) {
    throw new Error('Native Verifier result is stale for the active execution');
  }
  return envelope;
}

export function nativeVerifierResponsePosition(response: NativeVerifierResponse): {
  iteration: number;
  attempt: number;
} {
  return response.kind === 'final-result'
    ? { iteration: response.result.iteration, attempt: response.result.attempt }
    : { iteration: response.iteration, attempt: response.attempt };
}

export async function submitNativePortableBuilderCandidate(options: {
  paths: NativeProjectPaths;
  name: string;
  input: NativeBuilderCandidateInput;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `submit portable candidate ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      const children = await readNativeChildrenContract({
        changeDir: nativePortableChangeDir(options.paths, state.name),
        acceptanceIds: state.acceptance.map(({ id }) => id),
        validation: nativeChildrenAcceptanceValidation(state),
      });
      if (children || state.children_contract_hash) {
        const childStatus = await inspectNativeChildren({ paths: options.paths, state });
        if (!childStatus?.confirmed || !childStatus.allDone) {
          throw new Error('Native parent Build advances child changes before parent review');
        }
        if (state.loop.stage === 'repairing' && state.verification_result === 'fail') {
          throw new Error('Native parent verification failed; complete the repair child first');
        }
      }
      const next = submitNativeBuilderCandidate({ state, input: options.input });
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        rebuildNativeLocalExecution({
          portableState: written,
          projectRoot: options.paths.projectRoot,
          branch: currentBranch(options.paths.projectRoot),
        }),
        { containedRoot: options.paths.runtimeDir },
      );
      return written;
    },
  );
}

export async function dispatchNativePortableVerifier(options: {
  paths: NativeProjectPaths;
  name: string;
  checks: NativePortableCheckSummary[];
  verifierExecutionId?: string | null;
  projectRoot?: string;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `dispatch portable verifier ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      const projectRoot = options.projectRoot ?? options.paths.projectRoot;
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      const localBeforeDispatch = (
        await readOrRebuildNativeLocalExecution({
          file: nativeLocalExecutionFile(options.paths, state.name),
          portableState: state,
          projectRoot,
          branch: currentBranch(projectRoot),
          containedRoot: options.paths.runtimeDir,
        })
      ).state;
      if (
        localBeforeDispatch.execution?.stage !== 'checking' ||
        localBeforeDispatch.execution.actor !== 'runtime' ||
        localBeforeDispatch.execution.status !== 'completed'
      ) {
        throw new Error('Native check plan must be explicitly resolved before Verifier dispatch');
      }
      authoritativePortableChecks({
        local: localBeforeDispatch,
        projectRoot,
        supplied: options.checks,
      });
      const next = reserveNativeVerifierAttempt(state);
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      const file = nativeLocalExecutionFile(options.paths, state.name);
      const operationId = randomUUID();
      await writeNativeLocalExecution(
        file,
        {
          ...localBeforeDispatch,
          basedOnStateVersion: written.state_version,
          execution: {
            operationId,
            stage: 'verifying',
            actor: 'verifier',
            executionId: options.verifierExecutionId ?? null,
            status: 'running',
            startedAt: new Date().toISOString(),
            requestCheckRounds: 0,
          },
          checks: localBeforeDispatch.checks.map((check) => ({ ...check, operationId })),
        },
        { containedRoot: options.paths.runtimeDir },
      );
      return written;
    },
  );
}

export async function submitNativePortableVerifierResult(options: {
  paths: NativeProjectPaths;
  name: string;
  envelope: NativeTrustedVerifierEnvelope<unknown> | unknown;
  checks: NativePortableCheckSummary[];
  maxVerifyFailures: number;
  projectRoot?: string;
}): Promise<{
  state: NativePortableState;
  response: NativeVerifierResponse;
  checks: NativePortableCheckSummary[];
  requestChecks: NativePortableRequestChecksOutcome | null;
}> {
  if (!Number.isSafeInteger(options.maxVerifyFailures) || options.maxVerifyFailures < 1) {
    throw new Error('Native max Verify failures must be a positive integer');
  }
  const prepared = await withNativeMutationLock(
    options.paths,
    `apply portable verifier ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      const projectRoot = options.projectRoot ?? options.paths.projectRoot;
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      const local = await readCurrentLocalExecution({ paths: options.paths, state });
      const trustedEnvelope = assertCurrentVerifierEnvelope({
        state,
        local,
        envelope: options.envelope,
      });
      let parsedResponse: NativeVerifierResponse;
      try {
        parsedResponse = parseNativeVerifierResponse(trustedEnvelope.payload);
      } catch (error) {
        const summary = `Native Verifier response was invalid: ${(error as Error).message}`;
        const failed = await persistVerifierExecutionError({
          paths: options.paths,
          state,
          summary,
        });
        throw new Error(
          `${summary}; execution error ${failed.loop.execution_failure_count}/${NATIVE_MAX_VERIFIER_EXECUTION_FAILURES} was recorded`,
          { cause: error },
        );
      }
      const position = nativeVerifierResponsePosition(parsedResponse);
      if (position.iteration !== state.loop.iteration || position.attempt !== state.loop.attempt) {
        throw new Error('Native Verifier result is stale for the current iteration or attempt');
      }
      let runtimeChecks: NativePortableCheckSummary[] = [];
      let finalResult: ReturnType<typeof applyNativeVerifierEnvelope>;
      try {
        if (local !== null) {
          runtimeChecks = authoritativePortableChecks({
            local,
            projectRoot,
            supplied: options.checks,
          });
        }
        const result = applyNativeVerifierEnvelope({
          state,
          envelope: trustedEnvelope,
          checks: runtimeChecks,
          maxVerifyFailures: options.maxVerifyFailures,
        });
        if (result.response.kind === 'request-checks') {
          if (local === null) {
            throw new Error('Native Verifier request-checks has no active local execution');
          }
          const reservation = await reserveVerifierRequestedChecks({
            paths: options.paths,
            projectRoot,
            state,
            local,
            envelope: trustedEnvelope,
            response: result.response,
            suppliedChecks: runtimeChecks,
          });
          return {
            kind: 'request-checks' as const,
            state,
            response: result.response,
            reservation,
          };
        }
        if (
          local === null ||
          local.execution === null ||
          local.execution.stage !== 'verifying' ||
          local.execution.actor !== 'verifier' ||
          local.execution.status !== 'running'
        ) {
          throw new Error('Native Verifier final result has no active local execution');
        }
        if (
          local.execution.executionId !== null &&
          local.execution.executionId !== trustedEnvelope.verifierExecutionRef
        ) {
          throw new Error('Native Verifier final result changed execution within the same attempt');
        }
        finalResult = result;
      } catch (error) {
        const summary = `Native Verifier response was invalid: ${(error as Error).message}`;
        const failed = await persistVerifierExecutionError({
          paths: options.paths,
          state,
          summary,
        });
        throw new Error(
          `${summary}; execution error ${failed.loop.execution_failure_count}/${NATIVE_MAX_VERIFIER_EXECUTION_FAILURES} was recorded`,
          { cause: error },
        );
      }
      const written = await writePortableMutation({
        paths: options.paths,
        previous: state,
        next: finalResult.state,
      });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        written.loop.next_action === 'resolve-verifier-blocker' ||
          written.loop.next_action === 'run-final-full-verification'
          ? preservedLocalChecksForVersion({
              local,
              state: written,
              projectRoot,
            })
          : rebuildNativeLocalExecution({
              portableState: written,
              projectRoot,
              branch: currentBranch(projectRoot),
            }),
        { containedRoot: options.paths.runtimeDir },
      );
      if (written.verification !== null) {
        await writeNativeVerificationReport({
          file: path.join(nativePortableChangeDir(options.paths, state.name), 'verification.md'),
          state: written,
        });
      }
      return {
        kind: 'final-result' as const,
        result: {
          state: written,
          response: finalResult.response,
          checks: runtimeChecks,
          requestChecks: null,
        },
      };
    },
  );
  if (prepared.kind === 'final-result') return prepared.result;

  try {
    const requested = await executeReservedVerifierRequestedChecks({
      paths: options.paths,
      projectRoot: options.projectRoot ?? options.paths.projectRoot,
      reservation: prepared.reservation,
    });
    return {
      state: prepared.state,
      response: prepared.response,
      checks: requested.checks,
      requestChecks: requested.requestChecks,
    };
  } catch (error) {
    const summary = `Native Verifier response was invalid: ${(error as Error).message}`;
    const failed = await withNativeMutationLock(
      options.paths,
      `record Verifier-requested check failure ${options.name}`,
      async () => {
        const current = await readNativePortableChange(options.paths, options.name);
        if (current.state_version !== prepared.state.state_version) return null;
        return persistVerifierExecutionError({
          paths: options.paths,
          state: current,
          summary,
        });
      },
    );
    throw new Error(
      failed
        ? `${summary}; execution error ${failed.loop.execution_failure_count}/${NATIVE_MAX_VERIFIER_EXECUTION_FAILURES} was recorded`
        : `${summary}; the portable state changed before the execution error could be recorded`,
      { cause: error },
    );
  }
}

export async function recordNativePortableVerifierFailure(options: {
  paths: NativeProjectPaths;
  name: string;
  summary: string;
  expected: NativeVerifierAttemptBinding;
  requireSkillCoordination?: boolean;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `record portable verifier failure ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      const local = await readCurrentLocalExecution({ paths: options.paths, state });
      assertCurrentVerifierAttempt({ state, local, expected: options.expected });
      if (
        options.requireSkillCoordination &&
        state.builder_handoff?.identity_provider !== 'skill-coordinated'
      ) {
        throw new Error('Native Skill coordination has no current generic Builder candidate');
      }
      return persistVerifierExecutionError({
        paths: options.paths,
        state,
        summary: options.summary,
      });
    },
  );
}

export async function recordNativePortableVerifierUnavailable(options: {
  paths: NativeProjectPaths;
  name: string;
  summary: string;
  expected: NativeVerifierAttemptBinding;
  requireSkillCoordination?: boolean;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `record unavailable portable verifier ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      const local = await readCurrentLocalExecution({ paths: options.paths, state });
      const activeLocal = assertCurrentVerifierAttempt({
        state,
        local,
        expected: options.expected,
      });
      if (
        options.requireSkillCoordination &&
        state.builder_handoff?.identity_provider !== 'skill-coordinated'
      ) {
        throw new Error('Native Skill coordination has no current generic Builder candidate');
      }
      const checks = authoritativePortableChecks({
        local: activeLocal,
        projectRoot: options.paths.projectRoot,
        supplied: [],
      });
      const next = recordNativeVerifierUnavailable({
        state,
        checks,
        verifierExecutionRef: activeLocal.execution!.executionId!,
        summary: options.summary,
      });
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        preservedLocalChecksForVersion({
          local: activeLocal,
          state: written,
          projectRoot: options.paths.projectRoot,
        }),
        { containedRoot: options.paths.runtimeDir },
      );
      await writeNativeVerificationReport({
        file: path.join(nativePortableChangeDir(options.paths, state.name), 'verification.md'),
        state: written,
      });
      return written;
    },
  );
}

export async function confirmNativePortableVerifierUnavailable(options: {
  paths: NativeProjectPaths;
  name: string;
  summary: string;
  expectedContinuation?: NativePortableExpectedContinuation;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `confirm unavailable portable verifier ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      assertNativePortableExpectedContinuationLocked({
        state,
        expected: options.expectedContinuation,
        action: 'confirm-verifier-unavailable',
      });
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      const next = confirmNativeVerifierUnavailable({ state, summary: options.summary });
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        rebuildNativeLocalExecution({
          portableState: written,
          projectRoot: options.paths.projectRoot,
          branch: currentBranch(options.paths.projectRoot),
        }),
        { containedRoot: options.paths.runtimeDir },
      );
      await writeNativeVerificationReport({
        file: path.join(nativePortableChangeDir(options.paths, state.name), 'verification.md'),
        state: written,
      });
      return written;
    },
  );
}

export async function resolveNativePortableVerifierBlocker(options: {
  paths: NativeProjectPaths;
  name: string;
  reason?: string;
  expectedContinuation?: NativePortableExpectedContinuation;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `resolve portable verifier blocker ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      assertNativePortableExpectedContinuationLocked({
        state,
        expected: options.expectedContinuation,
        action: 'resolve-verifier-blocker',
      });
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      const local = await readCurrentLocalExecution({ paths: options.paths, state });
      const next = resolveNativeVerifierBlocker(state, { reason: options.reason });
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        preservedLocalChecksForVersion({
          local,
          state: written,
          projectRoot: options.paths.projectRoot,
        }),
        { containedRoot: options.paths.runtimeDir },
      );
      return written;
    },
  );
}

export async function retryNativePortableVerifier(options: {
  paths: NativeProjectPaths;
  name: string;
  expectedContinuation?: NativePortableExpectedContinuation;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `retry portable verifier ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      assertNativePortableExpectedContinuationLocked({
        state,
        expected: options.expectedContinuation,
        action: 'retry-verifier',
      });
      const local = await readCurrentLocalExecution({ paths: options.paths, state });
      const next = retryNativeVerifier(state);
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        preservedLocalChecksForVersion({
          local,
          state: written,
          projectRoot: options.paths.projectRoot,
        }),
        { containedRoot: options.paths.runtimeDir },
      );
      return written;
    },
  );
}

export async function returnNativePortableChangeToBuild(options: {
  paths: NativeProjectPaths;
  name: string;
  reason: string;
  expectedContinuation?: NativePortableExpectedContinuation;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `return portable change ${options.name} to Build`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      assertNativePortableExpectedContinuationLocked({
        state,
        expected: options.expectedContinuation,
        action: 'revise-implementation',
      });
      if (state.phase === 'build') return state;
      const next = returnNativeCandidateToBuild({ state, reason: options.reason });
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        rebuildNativeLocalExecution({
          portableState: written,
          projectRoot: options.paths.projectRoot,
          branch: currentBranch(options.paths.projectRoot),
        }),
        { containedRoot: options.paths.runtimeDir },
      );
      return written;
    },
  );
}

export async function ensureNativePortableReport(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<'aligned' | 'rebuilt' | 'not-applicable'> {
  if (options.state.verification === null) return 'not-applicable';
  const file = path.join(
    nativePortableChangeDir(options.paths, options.state.name),
    'verification.md',
  );
  const alignment = await inspectNativeVerificationReportAlignment({
    file,
    stateVersion: options.state.state_version,
  });
  if (alignment === 'aligned') return 'aligned';
  await writeNativeVerificationReport({ file, state: options.state });
  return 'rebuilt';
}
