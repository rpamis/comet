import { randomUUID } from 'node:crypto';
import type { WorkflowRun } from '../engine/runtime.js';

import { evaluateBranchBinding, isGitWorkTree, liveGitBranch } from './classic-branch-binding.js';
import { inspectClassicSdkRun } from './classic-sdk-status.js';

/** Record an assessed Verify failure as the current SDK Action outcome. */
export async function failClassicSdkVerify(options: {
  projectRoot: string;
  change: string;
  reason: string;
}): Promise<WorkflowRun> {
  const reason = options.reason.trim();
  if (!reason) throw new Error('Classic SDK Verify failure requires a reason');
  const { run, state, runtime, profile } = await inspectClassicSdkRun(
    options.projectRoot,
    options.change,
  );
  if (state.phase !== 'verify') {
    throw new Error('Classic SDK Verify failure requires a change in Verify');
  }
  const binding = evaluateBranchBinding({
    isolation: state.isolation,
    boundBranch: state.boundBranch,
    currentBranch: liveGitBranch(options.projectRoot),
    gitWorkTree: isGitWorkTree(options.projectRoot),
  });
  if (binding.status !== 'ok' && binding.status !== 'not-applicable') {
    throw new Error(`Classic SDK branch binding is ${binding.status}`);
  }
  if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
    throw new Error('Classic SDK has a claimed Action with an unknown outcome');
  }
  const action = run.actions.find(
    (candidate) => candidate.stepId === `${profile}.verify.run` && candidate.status === 'pending',
  );
  if (!action) throw new Error('Classic SDK Run has no pending Verify Action');
  const claimToken = randomUUID();
  const claimed = await runtime.claim({
    runId: run.runId,
    expectedRevision: run.revision,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-classic-state',
    claimToken,
  });
  return runtime.recordOutcome({
    runId: run.runId,
    expectedRevision: claimed.revision,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken,
      outcomeId: randomUUID(),
      status: 'succeeded',
      output: { event: 'verify-fail', reason },
    },
    context: { requestId: randomUUID(), projectRoot: options.projectRoot },
  });
}
