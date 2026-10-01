import { randomUUID } from 'node:crypto';

import type { WorkflowRun } from '../engine/runtime.js';
import { liveGitBranch } from './classic-branch-binding.js';
import { assertVerifyEvidenceCurrent } from './classic-sdk-archive-preflight.js';
import { inspectClassicSdkRun } from './classic-sdk-status.js';

/** Record the delivery proposal in the Run without performing an Archive side effect. */
export async function proposeClassicSdkArchive(options: {
  projectRoot: string;
  change: string;
  summary: string;
  remote?: string;
  prBaseBranch?: string;
}): Promise<WorkflowRun> {
  const { projectRoot, change } = options;
  const { run, state, runtime, profile } = await inspectClassicSdkRun(projectRoot, change);
  if (state.phase !== 'archive' || state.archived || state.verifyResult !== 'pass') {
    throw new Error('Classic SDK Archive proposal requires a verified, active change');
  }
  if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
    throw new Error('Classic SDK has a claimed Action with an unknown outcome');
  }
  const action = run.actions.find(
    (candidate) =>
      candidate.stepId === `${profile}.archive.prepare` && candidate.status === 'pending',
  );
  if (!action) throw new Error('Classic SDK Run has no pending Archive proposal Action');
  if (
    !state.boundBranch ||
    liveGitBranch(projectRoot) !== state.boundBranch ||
    !options.summary.trim() ||
    (options.remote !== undefined && !options.remote.trim()) ||
    (options.prBaseBranch !== undefined && !options.prBaseBranch.trim()) ||
    (options.prBaseBranch !== undefined && !options.remote)
  ) {
    throw new Error('Classic Archive proposal branch or delivery fields are invalid');
  }
  // A proposal must remain available when Verify evidence has become stale:
  // the user can choose reverify without authorizing a delivery side effect.
  // Delivery choices and the Archive preflight still revalidate the evidence.
  const output = {
    targetBranch: state.boundBranch,
    summary: options.summary.trim(),
    ...(options.remote ? { remote: options.remote.trim() } : {}),
    ...(options.prBaseBranch ? { prBaseBranch: options.prBaseBranch.trim() } : {}),
  };
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
      output,
    },
    context: { requestId: randomUUID(), projectRoot },
  });
}

/** Resolve only the current Archive proposal; stale hashes cannot authorize delivery. */
export async function decideClassicSdkArchive(options: {
  projectRoot: string;
  change: string;
  proposalHash: string;
  choice: 'local' | 'push' | 'pr' | 'reverify' | 'later';
}): Promise<WorkflowRun> {
  const { run, state, runtime, profile } = await inspectClassicSdkRun(
    options.projectRoot,
    options.change,
  );
  if (state.phase !== 'archive' || state.archived || state.verifyResult !== 'pass') {
    throw new Error('Classic SDK Archive decision requires a verified, active change');
  }
  if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
    throw new Error('Classic SDK has a claimed Action with an unknown outcome');
  }
  const wait = run.waits
    .slice()
    .reverse()
    .find((candidate) => candidate.stepId === `${profile}.archive.confirm`);
  if (!wait || wait.status !== 'pending' || wait.proposalHash !== options.proposalHash) {
    throw new Error('Classic Archive decision does not match the pending proposal');
  }
  const proposed = (wait.proposal as { outputs?: Record<string, unknown> } | undefined)?.outputs?.[
    `${profile}.archive.prepare`
  ] as { targetBranch?: unknown; remote?: unknown; prBaseBranch?: unknown } | undefined;
  if (
    !proposed ||
    proposed.targetBranch !== state.boundBranch ||
    liveGitBranch(options.projectRoot) !== state.boundBranch ||
    (options.choice !== 'local' &&
      options.choice !== 'reverify' &&
      options.choice !== 'later' &&
      typeof proposed.remote !== 'string') ||
    (options.choice === 'pr' && typeof proposed.prBaseBranch !== 'string')
  ) {
    throw new Error('Classic Archive proposal no longer matches the delivery target');
  }
  if (!['reverify', 'later'].includes(options.choice)) {
    try {
      await assertVerifyEvidenceCurrent(run, options.projectRoot, state, 1);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${reason}\nRevalidate before delivery: comet state decide-archive ${options.change} --proposal-hash ${options.proposalHash} --choice reverify`,
        { cause: error },
      );
    }
  }
  return runtime.resolveWait({
    runId: run.runId,
    expectedRevision: run.revision,
    waitId: wait.id,
    proposalHash: options.proposalHash,
    decisionId: `classic-archive-${options.proposalHash}-${options.choice}`,
    choice: options.choice,
  });
}
