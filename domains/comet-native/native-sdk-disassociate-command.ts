import { randomUUID } from 'node:crypto';

import { hashRuntimeValue } from '../engine/runtime.js';
import { projectNativeSdkStatus } from './native-sdk-status.js';
import { assertNativePortableExpectedContinuationLocked } from './native-portable-requirements.js';
import { loadOwnedNativeSdkRuntime, inspectNativeSdkRun } from './native-runtime-ownership.js';
import { success, type DispatchResult } from './native-cli-shared.js';

export async function disassociateNativeSdkCapability(options: {
  projectRoot: string;
  name: string;
  expectedStateVersion: number;
}): Promise<DispatchResult> {
  const { run, state } = await inspectNativeSdkRun(options.projectRoot, options.name);
  assertNativePortableExpectedContinuationLocked({
    state,
    expected: { stateVersion: options.expectedStateVersion, action: 'disassociate-capability' },
    action: 'disassociate-capability',
  });
  if (state.phase !== 'shape' || state.archived) {
    throw new Error('Native SDK capability association can only be revoked during Shape');
  }
  const { runtime } = await loadOwnedNativeSdkRuntime(options.projectRoot, options.name);
  const commandId = hashRuntimeValue({
    runId: run.runId,
    name: 'disassociate-capability',
    stateVersion: options.expectedStateVersion,
  });
  const dispatched = await runtime.dispatchCommand({
    runId: run.runId,
    expectedRevision: run.revision,
    commandId,
    name: 'disassociate-capability',
    input: { expectedStateVersion: options.expectedStateVersion },
    context: { requestId: randomUUID(), projectRoot: options.projectRoot },
  });
  const receipt = dispatched.commands?.find((command) => command.id === commandId);
  const action = dispatched.actions.find((candidate) => candidate.id === receipt?.actionId);
  if (!action) throw new Error('Native SDK capability revocation Action is missing');
  if (action.status === 'unknown' || action.status === 'running') {
    throw new Error('Native SDK capability revocation outcome is unknown; reconcile its Action');
  }
  if (action.status === 'failed') throw new Error('Native SDK capability revocation failed');
  const updated =
    action.status === 'pending'
      ? await runtime.execute({
          runId: run.runId,
          actionId: action.id,
          executorId: 'comet-native-disassociate',
          context: { requestId: randomUUID(), projectRoot: options.projectRoot },
        })
      : dispatched;
  const current = await inspectNativeSdkRun(options.projectRoot, options.name);
  const nextState = current.state;
  if (updated.status === 'failed') throw new Error('Native SDK capability revocation failed');
  return success(
    'spec disassociate',
    { ...(await projectNativeSdkStatus(options, current)), ...nextState },
    `Revoked Native capability association in ${options.name}\n`,
  );
}
