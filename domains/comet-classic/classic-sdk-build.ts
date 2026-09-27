import { randomUUID } from 'node:crypto';

import type { WorkflowRun } from '../engine/runtime.js';
import { evaluateBranchBinding, isGitWorkTree, liveGitBranch } from './classic-branch-binding.js';
import { classicConfigurationReadiness } from './classic-build-configuration.js';
import { readClassicProjectFile } from './classic-protected-path.js';
import { assertClassicBuildReady, classicPlanEvidenceReceipt } from './classic-sdk-application.js';
import { inspectClassicSdkRun } from './classic-sdk-status.js';
import type { ClassicState } from './classic-state.js';

type BuildMode = 'subagent-driven-development' | 'executing-plans' | 'direct' | 'autonomous';
type TddMode = 'tdd' | 'direct';
type ReviewMode = 'off' | 'standard' | 'thorough';

function assertBuildBranchBinding(projectRoot: string, state: ClassicState): void {
  if (!state.isolation) {
    throw new Error('Classic Build requires workspace isolation selected in Open');
  }
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

function parseBuildConfiguration(source: string): {
  buildMode: BuildMode;
  tddMode: TddMode;
  reviewMode: ReviewMode;
  subagentDispatch: 'confirmed' | null;
  directOverride: boolean;
} {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Classic Build configuration must be a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  const allowed = new Set([
    'build_mode',
    'tdd_mode',
    'review_mode',
    'subagent_dispatch',
    'direct_override',
  ]);
  if (Object.keys(record).some((field) => !allowed.has(field))) {
    throw new Error('Classic Build configuration contains unknown fields');
  }
  if (
    !['subagent-driven-development', 'executing-plans', 'direct', 'autonomous'].includes(
      String(record.build_mode),
    ) ||
    !['tdd', 'direct'].includes(String(record.tdd_mode)) ||
    !['off', 'standard', 'thorough'].includes(String(record.review_mode)) ||
    !Object.hasOwn(record, 'subagent_dispatch') ||
    (record.subagent_dispatch !== null && record.subagent_dispatch !== 'confirmed') ||
    (record.direct_override !== undefined && typeof record.direct_override !== 'boolean')
  ) {
    throw new Error('Classic Build configuration fields are missing or invalid');
  }
  const buildMode = record.build_mode as BuildMode;
  const subagentDispatch = record.subagent_dispatch as 'confirmed' | null;
  if ((buildMode === 'subagent-driven-development') !== (subagentDispatch === 'confirmed')) {
    throw new Error('Classic Build subagent dispatch must match the selected execution mode');
  }
  return {
    buildMode,
    tddMode: record.tdd_mode as TddMode,
    reviewMode: record.review_mode as ReviewMode,
    subagentDispatch,
    directOverride: record.direct_override === true,
  };
}

/** Record the whole Build decision as one Action, leaving its Wait for the user. */
export async function proposeClassicSdkBuild(options: {
  projectRoot: string;
  change: string;
  configurationRef: string;
}): Promise<WorkflowRun> {
  const { projectRoot, change } = options;
  const { run, state, runtime, profile } = await inspectClassicSdkRun(projectRoot, change);
  if (profile !== 'full' || state.phase !== 'build') {
    throw new Error('Classic Build configuration requires a full SDK change in Build');
  }
  assertBuildBranchBinding(projectRoot, state);
  if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
    throw new Error('Classic SDK has a claimed Action with an unknown outcome');
  }
  const action = run.actions.find(
    (candidate) => candidate.stepId === 'full.build.configure' && candidate.status === 'pending',
  );
  if (!action) throw new Error('Classic SDK Run has no pending Build configuration Action');
  const configuration = parseBuildConfiguration(
    await readClassicProjectFile(projectRoot, options.configurationRef, {
      label: 'Classic Build configuration proposal',
    }),
  );
  const output = {
    ...configuration,
    isolation: state.isolation,
    boundBranch: state.boundBranch,
  };
  const readiness = classicConfigurationReadiness({ ...state, ...output });
  if (readiness.missingFields.length || readiness.invalidFields.length) {
    throw new Error(
      [
        ...readiness.missingFields.map((field) => `${field} is missing`),
        ...readiness.invalidFields.map(({ reason }) => reason),
      ].join('\n'),
    );
  }
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

/** Resolve only the latest Build proposal; the SDK binds it to the Run revision. */
export async function decideClassicSdkBuild(options: {
  projectRoot: string;
  change: string;
  proposalHash: string;
  choice: 'approved' | 'rejected';
}): Promise<WorkflowRun> {
  const { run, state, runtime, profile } = await inspectClassicSdkRun(
    options.projectRoot,
    options.change,
  );
  if (profile !== 'full' || state.phase !== 'build') {
    throw new Error('Classic Build decision requires a full SDK change in Build');
  }
  assertBuildBranchBinding(options.projectRoot, state);
  if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
    throw new Error('Classic SDK has a claimed Action with an unknown outcome');
  }
  const wait = run.waits
    .slice()
    .reverse()
    .find((candidate) => candidate.stepId === 'full.build.confirm');
  if (!wait || wait.status !== 'pending' || wait.proposalHash !== options.proposalHash) {
    throw new Error('Classic Build decision does not match the pending proposal');
  }
  return runtime.resolveWait({
    runId: run.runId,
    expectedRevision: run.revision,
    waitId: wait.id,
    proposalHash: options.proposalHash,
    decisionId: `classic-build-${options.proposalHash}-${options.choice}`,
    choice: options.choice,
  });
}

/** Register a validated plan and its task-authority evidence in the same SDK Run. */
export async function submitClassicSdkBuildPlan(options: {
  projectRoot: string;
  change: string;
  planRef: string;
  pause: boolean;
}): Promise<WorkflowRun> {
  const { projectRoot, change, planRef, pause } = options;
  const {
    run: inspected,
    state,
    runtime,
    profile,
  } = await inspectClassicSdkRun(projectRoot, change);
  if (profile !== 'full' || state.phase !== 'build') {
    throw new Error('Classic Build plan requires a full SDK change in Build');
  }
  assertBuildBranchBinding(projectRoot, state);
  if (
    inspected.actions.some((action) => action.status === 'running' || action.status === 'unknown')
  ) {
    throw new Error('Classic SDK has a claimed Action with an unknown outcome');
  }
  const action = inspected.actions.find(
    (candidate) => candidate.stepId === 'full.build.plan' && candidate.status === 'pending',
  );
  const pendingEvidence = inspected.evidenceWaits?.find(
    (wait) => wait.stepId === 'full.build.plan.evidence' && wait.status === 'pending',
  );
  if (!action && !pendingEvidence) {
    throw new Error('Classic SDK Run has no pending Build plan Action or evidence');
  }
  if (
    pendingEvidence &&
    (state.plan !== planRef || (state.buildPause === 'plan-ready') !== pause)
  ) {
    throw new Error('Classic Build plan submission does not match the recorded Action');
  }
  const changeDirRef =
    inspected.input &&
    typeof inspected.input === 'object' &&
    !Array.isArray(inspected.input) &&
    typeof inspected.input.changeDir === 'string'
      ? inspected.input.changeDir
      : null;
  if (!changeDirRef) throw new Error('Classic SDK Run has no change directory');
  const receipt = await classicPlanEvidenceReceipt(projectRoot, planRef, changeDirRef);

  let run = inspected;
  if (action) {
    const claimToken = randomUUID();
    run = await runtime.claim({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'comet-classic-state',
      claimToken,
    });
    run = await runtime.recordOutcome({
      runId: run.runId,
      expectedRevision: run.revision,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken,
        outcomeId: randomUUID(),
        status: 'succeeded',
        output: { plan: planRef, ...(pause ? { buildPause: 'plan-ready' } : {}) },
      },
      context: { requestId: randomUUID(), projectRoot },
    });
  }
  const evidence = run.evidenceWaits?.find(
    (wait) => wait.stepId === 'full.build.plan.evidence' && wait.status === 'pending',
  );
  if (!evidence) throw new Error('Classic SDK Run has no pending Build plan evidence');
  return runtime.recordEvidence({
    runId: run.runId,
    expectedRevision: run.revision,
    evidenceId: evidence.id,
    kind: evidence.kind,
    ref: receipt.ref,
    contentHash: receipt.contentHash,
    submissionId: randomUUID(),
    context: { requestId: randomUUID(), projectRoot },
  });
}

/** Continue only the approved pause and revalidate the existing plan before execution. */
export async function continueClassicSdkBuildPlan(options: {
  projectRoot: string;
  change: string;
  proposalHash: string;
}): Promise<WorkflowRun> {
  const { projectRoot, change, proposalHash } = options;
  const {
    run: inspected,
    state,
    runtime,
    profile,
  } = await inspectClassicSdkRun(projectRoot, change);
  if (profile !== 'full' || state.phase !== 'build' || !state.plan) {
    throw new Error('Classic Build continuation requires a full SDK plan in Build');
  }
  assertBuildBranchBinding(projectRoot, state);
  if (
    inspected.actions.some((action) => action.status === 'running' || action.status === 'unknown')
  ) {
    throw new Error('Classic SDK has a claimed Action with an unknown outcome');
  }
  const wait = inspected.waits
    .slice()
    .reverse()
    .find((candidate) => candidate.stepId === 'full.build.plan-ready');
  const recoveringEvidence = inspected.evidenceWaits?.some(
    (candidate) =>
      candidate.stepId === 'full.build.plan.evidence' && candidate.status === 'pending',
  );
  if (
    !wait ||
    wait.proposalHash !== proposalHash ||
    (wait.status !== 'pending' && !(wait.status === 'resolved' && recoveringEvidence))
  ) {
    throw new Error('Classic Build continuation does not match the pending plan-ready decision');
  }
  const changeDirRef =
    inspected.input &&
    typeof inspected.input === 'object' &&
    !Array.isArray(inspected.input) &&
    typeof inspected.input.changeDir === 'string'
      ? inspected.input.changeDir
      : null;
  if (!changeDirRef) throw new Error('Classic SDK Run has no change directory');
  const receipt = await classicPlanEvidenceReceipt(projectRoot, state.plan, changeDirRef);
  const acceptedPlan = inspected.evidenceWaits
    ?.slice()
    .reverse()
    .find(
      (candidate) =>
        candidate.stepId === 'full.build.plan.evidence' && candidate.status === 'resolved',
    )?.receipt;
  if (
    !acceptedPlan ||
    acceptedPlan.ref !== receipt.ref ||
    acceptedPlan.contentHash !== receipt.contentHash
  ) {
    throw new Error('Classic Build plan or tasks changed after the plan-ready pause');
  }
  let run = inspected;
  if (wait.status === 'pending') {
    run = await runtime.resolveWait({
      runId: run.runId,
      expectedRevision: run.revision,
      waitId: wait.id,
      proposalHash,
      decisionId: `classic-plan-ready-${proposalHash}-continue`,
      choice: 'continue',
    });
  }
  const evidence = run.evidenceWaits?.find(
    (candidate) =>
      candidate.stepId === 'full.build.plan.evidence' && candidate.status === 'pending',
  );
  if (!evidence) throw new Error('Classic SDK Run has no pending Build plan evidence');
  return runtime.recordEvidence({
    runId: run.runId,
    expectedRevision: run.revision,
    evidenceId: evidence.id,
    kind: evidence.kind,
    ref: receipt.ref,
    contentHash: receipt.contentHash,
    submissionId: randomUUID(),
    context: { requestId: randomUUID(), projectRoot },
  });
}

/** Complete the external Build work only after the current tasks and plan are ready. */
export async function completeClassicSdkBuild(options: {
  projectRoot: string;
  change: string;
}): Promise<WorkflowRun> {
  const { projectRoot, change } = options;
  const { run, state, runtime, profile } = await inspectClassicSdkRun(projectRoot, change);
  if (state.phase !== 'build') {
    throw new Error('Classic Build completion requires an SDK change in Build');
  }
  if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
    throw new Error('Classic SDK has a claimed Action with an unknown outcome');
  }
  const action = run.actions.find(
    (candidate) =>
      candidate.stepId === `${profile}.build.execute` && candidate.status === 'pending',
  );
  if (!action) throw new Error('Classic SDK Run has no pending Build execution Action');
  const changeDirRef =
    run.input &&
    typeof run.input === 'object' &&
    !Array.isArray(run.input) &&
    typeof run.input.changeDir === 'string'
      ? run.input.changeDir
      : null;
  if (!changeDirRef) throw new Error('Classic SDK Run has no change directory');
  await assertClassicBuildReady(projectRoot, changeDirRef, state, run);
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
      output: { event: 'build-complete' },
    },
    context: { requestId: randomUUID(), projectRoot },
  });
}
