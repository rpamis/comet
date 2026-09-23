import {
  claimRuntimeAction,
  createRuntimeAction,
  recordRuntimeOutcome,
  type RuntimeAction,
} from '../engine/runtime-action.js';
import { hashRuntimeValue } from '../engine/runtime-json.js';
import type { NativeLocalExecutionState, NativePortableState } from './native-portable-types.js';

interface NativeVerifierActionInput {
  candidateId: string;
  identityProvider: string;
  builderExecutionRef: string;
  verifierExecutionRef: string | null;
  iteration: number;
  goalCycle: number;
  registeredAt: string;
}

export function nativeVerifierActionInput(action: RuntimeAction): NativeVerifierActionInput {
  const input = action.input as unknown as NativeVerifierActionInput;
  if (
    !input ||
    typeof input !== 'object' ||
    typeof input.candidateId !== 'string' ||
    !input.candidateId ||
    typeof input.identityProvider !== 'string' ||
    !input.identityProvider ||
    typeof input.builderExecutionRef !== 'string' ||
    !input.builderExecutionRef ||
    (input.verifierExecutionRef !== null && typeof input.verifierExecutionRef !== 'string') ||
    !Number.isSafeInteger(input.iteration) ||
    input.iteration < 1 ||
    !Number.isSafeInteger(input.goalCycle) ||
    input.goalCycle < 1 ||
    typeof input.registeredAt !== 'string' ||
    Number.isNaN(Date.parse(input.registeredAt)) ||
    action.type !== 'handoff' ||
    action.ref !== 'native-verifier' ||
    action.stepId !== 'native-verifier' ||
    (input.verifierExecutionRef !== null &&
      input.verifierExecutionRef === input.builderExecutionRef) ||
    (action.claim &&
      (action.claim.executorId !== input.identityProvider ||
        action.claim.token === input.builderExecutionRef ||
        (input.verifierExecutionRef !== null && action.claim.token !== input.verifierExecutionRef)))
  )
    throw new Error('Native Verifier action binding is invalid');
  return input;
}

export function createNativeVerifierAction(options: {
  state: NativePortableState;
  operationId: string;
  executionRef: string | null;
  registeredAt: string;
}): RuntimeAction {
  const { state } = options;
  if (!state.builder_handoff) throw new Error('Native Verifier action requires a candidate');
  const action = createRuntimeAction({
    id: options.operationId,
    runId: state.name,
    stepId: 'native-verifier',
    type: 'handoff',
    ref: 'native-verifier',
    attempt: state.loop.attempt,
    retry: 'manual',
    input: {
      candidateId: state.builder_handoff.candidate_id,
      identityProvider: state.builder_handoff.identity_provider,
      builderExecutionRef: state.builder_handoff.builder_execution_ref,
      verifierExecutionRef: options.executionRef,
      iteration: state.loop.iteration,
      goalCycle: state.loop.goal_cycle,
      registeredAt: options.registeredAt,
    },
  });
  nativeVerifierActionInput(action);
  return action;
}

export function nativeVerifierActionMatchesState(
  state: NativePortableState,
  action: RuntimeAction,
): boolean {
  const input = nativeVerifierActionInput(action);
  return (
    action.runId === state.name &&
    input.candidateId === state.builder_handoff?.candidate_id &&
    input.identityProvider === state.builder_handoff.identity_provider &&
    input.builderExecutionRef === state.builder_handoff.builder_execution_ref &&
    input.iteration === state.loop.iteration &&
    input.goalCycle === state.loop.goal_cycle &&
    action.attempt === state.loop.attempt
  );
}

export function activeNativeVerifierAction(state: NativePortableState): RuntimeAction | undefined {
  const action = state.verifier_action;
  return action &&
    state.phase === 'verify' &&
    state.status === 'active' &&
    state.loop.next_action === 'await-verifier-result' &&
    ['pending', 'running', 'unknown'].includes(action.status) &&
    nativeVerifierActionMatchesState(state, action)
    ? action
    : undefined;
}

export function nativeVerifierActionExecutionRef(action: RuntimeAction): string | null {
  return action.claim?.token ?? nativeVerifierActionInput(action).verifierExecutionRef;
}

/** Read legacy execution metadata only at a verified, current attempt boundary. */
export function currentNativeVerifierAction(
  state: NativePortableState,
  local: NativeLocalExecutionState | null,
): RuntimeAction {
  if (state.verifier_action) {
    if (!nativeVerifierActionMatchesState(state, state.verifier_action)) {
      throw new Error('Native Verifier action is stale for the current candidate or attempt');
    }
    return state.verifier_action;
  }
  const execution = local?.execution;
  if (
    !local ||
    local.change !== state.name ||
    local.basedOnStateVersion !== state.state_version ||
    (local.candidateId !== undefined &&
      local.candidateId !== state.builder_handoff?.candidate_id) ||
    !execution ||
    execution.stage !== 'verifying' ||
    execution.actor !== 'verifier' ||
    execution.status !== 'running'
  ) {
    throw new Error('Native Verifier action has no current legacy execution binding');
  }
  const action = createNativeVerifierAction({
    state,
    operationId: execution.operationId,
    executionRef: execution.executionId,
    registeredAt: execution.startedAt,
  });
  return execution.verifierStartedAt && execution.executionId
    ? startNativeVerifierAction(action, execution.executionId)
    : action;
}

export function startNativeVerifierAction(
  action: RuntimeAction,
  executionRef: string,
): RuntimeAction {
  const input = nativeVerifierActionInput(action);
  if (
    executionRef === input.builderExecutionRef ||
    (input.verifierExecutionRef !== null && executionRef !== input.verifierExecutionRef)
  ) {
    throw new Error('Native Verifier action execution identity is stale or not independent');
  }
  if (action.status === 'unknown' && action.claim?.token === executionRef) {
    return structuredClone(action);
  }
  return claimRuntimeAction(action, {
    executorId: input.identityProvider,
    token: executionRef,
    attempt: action.attempt,
    inputHash: action.inputHash,
  });
}

export function completeNativeVerifierAction(options: {
  action: RuntimeAction;
  executionRef: string;
  response: unknown;
  status?: 'succeeded' | 'failed';
}): { action: RuntimeAction; duplicate: boolean } {
  const action =
    options.action.status === 'pending'
      ? startNativeVerifierAction(options.action, options.executionRef)
      : options.action;
  return recordRuntimeOutcome(action, {
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: options.executionRef,
    outcomeId: hashRuntimeValue(options.response),
    status: options.status ?? 'succeeded',
    output: { responseHash: hashRuntimeValue(options.response) },
  });
}

export function isDuplicateNativeVerifierResponse(options: {
  state: NativePortableState;
  candidateId: string;
  executionRef: string;
  response: unknown;
}): boolean {
  const action = options.state.verifier_action;
  if (
    !action ||
    !['succeeded', 'failed'].includes(action.status) ||
    nativeVerifierActionInput(action).candidateId !== options.candidateId ||
    options.state.builder_handoff?.candidate_id !== options.candidateId ||
    nativeVerifierActionExecutionRef(action) !== options.executionRef
  )
    return false;
  return completeNativeVerifierAction({
    action,
    executionRef: options.executionRef,
    response: options.response,
  }).duplicate;
}
