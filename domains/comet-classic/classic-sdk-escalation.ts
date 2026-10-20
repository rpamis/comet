import { randomUUID } from 'node:crypto';

import {
  createRuntime,
  defineWorkflow,
  hashRuntimeValue,
  preserveRuntimeExecutionOrigins,
  type WorkflowRun,
} from '../engine/runtime.js';
import { isDeepStrictEqual } from 'node:util';
import {
  assertClassicPresetRequirementsCurrent,
  classicOpenEvidenceReceipt,
} from './classic-sdk-application.js';
import { classicSdkApplicationForRun } from './classic-sdk-revision-application.js';
import { createClassicSdkStateStore } from './classic-sdk-state-store.js';
import { evaluateBranchBinding, isGitWorkTree, liveGitBranch } from './classic-branch-binding.js';
import { inspectClassicSdkRun } from './classic-sdk-status.js';
import type { ClassicState } from './classic-state.js';

function assertEscalationBranch(
  projectRoot: string,
  state: Pick<ClassicState, 'isolation' | 'boundBranch'>,
): void {
  const binding = evaluateBranchBinding({
    isolation: state.isolation,
    boundBranch: state.boundBranch,
    currentBranch: liveGitBranch(projectRoot),
    gitWorkTree: isGitWorkTree(projectRoot),
  });
  if (binding.status !== 'ok' && binding.status !== 'not-applicable') {
    throw new Error(`Classic SDK branch binding is ${binding.status}`);
  }
}

/** Ask the user whether this preset change should continue or enter full Design. */
export async function proposeClassicSdkEscalation(options: {
  projectRoot: string;
  change: string;
  reason: string;
}): Promise<WorkflowRun> {
  const reason = options.reason.trim();
  if (!reason) throw new Error('Classic SDK escalation requires a concrete reason');
  const initial = await inspectClassicSdkRun(options.projectRoot, options.change);
  const { state } = initial;
  let { run, runtime, profile } = initial;
  if (profile === 'full' || state.phase !== 'build') {
    throw new Error('Classic SDK escalation requires a hotfix or tweak in Build');
  }
  assertEscalationBranch(options.projectRoot, state);
  if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
    throw new Error('Classic SDK has a claimed Action with an unknown outcome');
  }
  const application = classicSdkApplicationForRun(profile, run, {
    upgradePresetRequirements: true,
  });
  const definition = defineWorkflow(application.workflow);
  const hash = hashRuntimeValue(definition);
  if (run.workflow.hash !== hash) {
    const upgraded = preserveRuntimeExecutionOrigins(run);
    upgraded.workflow.hash = hash;
    upgraded.definitionHashes[JSON.stringify([definition.id, definition.version])] = hash;
    await createRuntime({
      ...application,
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      store: { read: async () => upgraded, compareAndSwap: async () => false },
    }).inspect(run.runId);
    upgraded.revision = run.revision + 1;
    if (
      !(await createClassicSdkStateStore(options.projectRoot).compareAndSwap(
        run.runId,
        run.revision,
        upgraded,
      ))
    )
      throw new Error('Classic Run changed while upgrading preset scope validation');
    ({ run, runtime, profile } = await inspectClassicSdkRun(options.projectRoot, options.change));
  }
  const requirementsEvidence = await classicOpenEvidenceReceipt(
    options.projectRoot,
    (run.input as { changeDir: string }).changeDir,
    { presetRequirements: true },
  );
  const action = run.actions.find(
    (candidate) =>
      candidate.stepId === `${profile}.build.execute` && candidate.status === 'pending',
  );
  if (!action) throw new Error('Classic SDK Run has no pending preset Build Action');
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
      output: { event: 'escalation-requested', proposal: reason, requirementsEvidence },
    },
    context: { requestId: randomUUID(), projectRoot: options.projectRoot },
  });
}

/** Apply only the current user decision; an upgrade keeps the original Run and workspace. */
export async function decideClassicSdkEscalation(options: {
  projectRoot: string;
  change: string;
  proposalHash: string;
  choice: 'continue' | 'upgrade';
}): Promise<WorkflowRun> {
  const { run, state, runtime } = await inspectClassicSdkRun(options.projectRoot, options.change);
  assertEscalationBranch(options.projectRoot, state);
  if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
    throw new Error('Classic SDK has a claimed Action with an unknown outcome');
  }
  const wait = run.waits
    .slice()
    .reverse()
    .find((candidate) => candidate.stepId.endsWith('.build.escalation-confirm'));
  if (!wait || wait.proposalHash !== options.proposalHash) {
    throw new Error('Classic SDK escalation decision does not match the current proposal');
  }
  if (wait.status === 'resolved' && wait.decision?.choice === options.choice) return run;
  if (wait.status !== 'pending' || state.phase !== 'build' || state.workflow === 'full') {
    throw new Error('Classic SDK escalation proposal already has a different decision');
  }
  if (options.choice === 'continue') {
    const expected = (
      wait.proposal as { outputs?: Record<string, { requirementsEvidence?: unknown }> }
    ).outputs?.[`${state.workflow}.build.execute`]?.requirementsEvidence;
    const current = await classicOpenEvidenceReceipt(
      options.projectRoot,
      (run.input as { changeDir: string }).changeDir,
      { presetRequirements: true },
    );
    if (!expected) {
      await assertClassicPresetRequirementsCurrent(
        options.projectRoot,
        (run.input as { changeDir: string }).changeDir,
        run,
      );
    } else if (!isDeepStrictEqual(expected, current))
      throw new Error(
        'Classic preset requirements changed after the scope proposal; restore the proposed artifacts or choose upgrade for a newly confirmed full Design',
      );
  }
  return runtime.resolveWait({
    runId: run.runId,
    expectedRevision: run.revision,
    waitId: wait.id,
    proposalHash: options.proposalHash,
    decisionId: `classic-escalation-${options.proposalHash}-${options.choice}`,
    choice: options.choice,
  });
}
