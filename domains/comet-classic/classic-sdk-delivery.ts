import { randomUUID } from 'node:crypto';

import { validateClassicSdkDeliveryCandidate } from './classic-sdk-application.js';
import { inspectClassicSdkRun } from './classic-sdk-status.js';

/** Submit an already performed Git delivery only after its approved evidence validates. */
export async function completeClassicSdkDelivery(options: {
  projectRoot: string;
  change: string;
  commit: string;
  prUrl?: string;
}) {
  const { projectRoot, change } = options;
  const { run, state, runtime, profile } = await inspectClassicSdkRun(projectRoot, change);
  if (state.phase !== 'archive' || !state.archived || run.status !== 'running') {
    throw new Error('Classic SDK delivery requires an archived, running change');
  }
  if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
    throw new Error('Classic SDK has a claimed Action with an unknown outcome');
  }
  const action = run.actions.find(
    (candidate) =>
      candidate.stepId === `${profile}.archive.deliver` && candidate.status === 'pending',
  );
  if (!action) throw new Error('Classic SDK Run has no pending delivery Action');
  const approved = run.outputs[`${profile}.archive.preflight`]?.value as
    { deliveryAction?: unknown; targetBranch?: unknown; remote?: unknown } | undefined;
  if (
    !approved ||
    !['local', 'push', 'pr'].includes(String(approved.deliveryAction)) ||
    typeof approved.targetBranch !== 'string' ||
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(options.commit) ||
    (approved.deliveryAction !== 'local' && typeof approved.remote !== 'string') ||
    (approved.deliveryAction === 'pr' && !options.prUrl) ||
    (approved.deliveryAction !== 'pr' && options.prUrl !== undefined)
  ) {
    throw new Error('Classic SDK delivery input does not match the approved target');
  }
  const output = {
    action: approved.deliveryAction as 'local' | 'push' | 'pr',
    targetBranch: approved.targetBranch,
    commit: options.commit,
    ...(typeof approved.remote === 'string' && approved.deliveryAction !== 'local'
      ? { remote: approved.remote }
      : {}),
    ...(options.prUrl ? { prUrl: options.prUrl } : {}),
  };
  const validation = await validateClassicSdkDeliveryCandidate(run, action, output, projectRoot);
  if (!validation.accepted) {
    throw new Error(validation.reason ?? 'Classic SDK delivery evidence was rejected');
  }
  const claimToken = randomUUID();
  const requestId = randomUUID();
  await runtime.claim({
    runId: run.runId,
    expectedRevision: run.revision,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-classic-delivery',
    claimToken,
    context: { requestId, projectRoot },
  });
  try {
    return await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken,
        outcomeId: randomUUID(),
        status: 'succeeded',
        output,
      },
      context: { requestId, projectRoot },
    });
  } catch (error) {
    const current = await runtime.inspect(run.runId);
    const latest = current.actions.find((candidate) => candidate.id === action.id);
    if (latest?.status === 'running' && latest.attempt === action.attempt) {
      await runtime.markUnknown({
        runId: run.runId,
        actionId: action.id,
        attempt: action.attempt,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}
