import { randomUUID } from 'node:crypto';

import { hashRuntimeValue } from '../engine/runtime.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import { loadOwnedNativeSdkRuntime, inspectNativeSdkRun } from './native-runtime-ownership.js';
import { success, type DispatchResult } from './native-cli-shared.js';

export function assertNativeSdkRemovalResult(
  status: 'pending' | 'running' | 'unknown' | 'failed' | 'succeeded' | 'cancelled',
  recorded: boolean,
  capability: string,
): void {
  if (status === 'running' || status === 'unknown' || status === 'pending') {
    throw new Error('Native SDK capability removal outcome is unknown; reconcile its Action');
  }
  if (status !== 'succeeded') throw new Error('Native SDK capability removal failed');
  if (!recorded) {
    throw new Error(`Native SDK capability removal did not update ${capability}`);
  }
}

export async function removeNativeSdkCapability(options: {
  projectRoot: string;
  name: string;
  capability: string;
}): Promise<DispatchResult> {
  const { run, state } = await inspectNativeSdkRun(options.projectRoot, options.name);
  if (
    state.spec_changes.some(
      (change) => change.capability === options.capability && change.operation === 'remove',
    )
  ) {
    return success(
      'spec remove',
      { ...state, continuation: nativePortableContinuation(state) },
      `Marked Native capability ${options.capability} for removal in ${options.name}\n`,
    );
  }
  const { runtime } = await loadOwnedNativeSdkRuntime(options.projectRoot, options.name);
  const commandId = hashRuntimeValue({
    runId: run.runId,
    name: 'remove-capability',
    capability: options.capability,
    stateVersion: state.state_version,
  });
  const dispatched = await runtime.dispatchCommand({
    runId: run.runId,
    expectedRevision: run.revision,
    commandId,
    name: 'remove-capability',
    input: { capability: options.capability, expectedStateVersion: state.state_version },
    context: { requestId: randomUUID(), projectRoot: options.projectRoot },
  });
  const receipt = dispatched.commands?.find((command) => command.id === commandId);
  const action = dispatched.actions.find((candidate) => candidate.id === receipt?.actionId);
  if (!action) throw new Error('Native SDK capability removal Action is missing');
  if (action.status === 'pending') {
    await runtime.execute({
      runId: run.runId,
      actionId: action.id,
      executorId: 'comet-native-remove',
      context: { requestId: randomUUID(), projectRoot: options.projectRoot },
    });
  }
  const current = await inspectNativeSdkRun(options.projectRoot, options.name);
  const finalAction = current.run.actions.find((candidate) => candidate.id === action.id);
  if (!finalAction) throw new Error('Native SDK capability removal Action is missing');
  assertNativeSdkRemovalResult(
    finalAction.status,
    current.state.spec_changes.some(
      (change) => change.capability === options.capability && change.operation === 'remove',
    ),
    options.capability,
  );
  return success(
    'spec remove',
    { ...current.state, continuation: nativePortableContinuation(current.state) },
    `Marked Native capability ${options.capability} for removal in ${options.name}\n`,
  );
}
