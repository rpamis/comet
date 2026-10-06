import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { WorkflowRun } from '../engine/runtime.js';
import { evaluateBranchBinding, isGitWorkTree, liveGitBranch } from './classic-branch-binding.js';
import { inspectClassicDesignReadiness } from './classic-design-readiness.js';
import { classicDocumentLanguageMismatch } from './classic-document-language.js';
import {
  validateClassicSdkDesignContext,
  writeClassicSdkDesignContext,
} from './classic-handoff.js';
import { readClassicProjectFile } from './classic-protected-path.js';
import {
  classicDesignEvidenceReceipt,
  classicOpenEvidenceReceipt,
} from './classic-sdk-application.js';
import { inspectClassicSdkRun } from './classic-sdk-status.js';
import type { ClassicState } from './classic-state.js';

async function assertDesignProposalSourcesCurrent(options: {
  projectRoot: string;
  change: string;
  run: WorkflowRun;
  state: ClassicState;
}): Promise<void> {
  const { projectRoot, change, run, state } = options;
  const input = run.input as { changeDir: string };
  const approvedOpen = run.outputs['full.open.evidence']?.value as
    { ref?: unknown; contentHash?: unknown } | undefined;
  const currentOpen = await classicOpenEvidenceReceipt(projectRoot, input.changeDir);
  if (
    !approvedOpen ||
    approvedOpen.ref !== currentOpen.ref ||
    approvedOpen.contentHash !== currentOpen.contentHash
  ) {
    throw new Error('Classic Design OpenSpec artifacts changed after the approved proposal');
  }
  if (
    !state.handoffContext ||
    !state.handoffHash ||
    !(await validateClassicSdkDesignContext({
      projectRoot,
      changeDir: path.join(projectRoot, input.changeDir),
      change,
      contextCompression: state.contextCompression,
      handoffContext: state.handoffContext,
      handoffHash: state.handoffHash,
    }))
  ) {
    throw new Error('Classic Design handoff changed after the approved proposal');
  }
}

/** Persist an Agent-authored Design proposal before a user decision is requested. */
export async function proposeClassicSdkDesign(options: {
  projectRoot: string;
  change: string;
  proposal: string;
}): Promise<WorkflowRun> {
  const { projectRoot, change } = options;
  const proposal = options.proposal.trim();
  if (!proposal) throw new Error('Classic Design proposal must not be empty');
  const { run, state, runtime, profile } = await inspectClassicSdkRun(projectRoot, change);
  if (profile !== 'full' || state.phase !== 'design') {
    throw new Error('Classic Design proposal requires a full SDK change in Design');
  }
  const branch = evaluateBranchBinding({
    isolation: state.isolation,
    boundBranch: state.boundBranch,
    currentBranch: liveGitBranch(projectRoot),
    gitWorkTree: isGitWorkTree(projectRoot),
  });
  if (branch.status !== 'ok' && branch.status !== 'not-applicable') {
    throw new Error(`Classic SDK branch binding is ${branch.status}`);
  }
  if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
    throw new Error('Classic SDK has a claimed Action with an unknown outcome');
  }
  const action = run.actions.find(
    (candidate) => candidate.stepId === 'full.design.handoff' && candidate.status === 'pending',
  );
  if (!action) throw new Error('Classic SDK Run has no pending Design proposal Action');
  const input = run.input as { changeDir: string };
  const handoff = await writeClassicSdkDesignContext({
    projectRoot,
    changeDir: path.join(projectRoot, input.changeDir),
    change,
    contextCompression: state.contextCompression,
  });
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
      output: { proposal, ...handoff },
    },
    context: { requestId: randomUUID(), projectRoot },
  });
}

/** Record the user's decision about exactly the current Design proposal. */
export async function decideClassicSdkDesign(options: {
  projectRoot: string;
  change: string;
  proposalHash: string;
  choice: 'approved' | 'rejected';
}): Promise<WorkflowRun> {
  const { projectRoot, change, proposalHash, choice } = options;
  const { run, state, runtime, profile } = await inspectClassicSdkRun(projectRoot, change);
  if (profile !== 'full' || state.phase !== 'design') {
    throw new Error('Classic Design decision requires a full SDK change in Design');
  }
  const branch = evaluateBranchBinding({
    isolation: state.isolation,
    boundBranch: state.boundBranch,
    currentBranch: liveGitBranch(projectRoot),
    gitWorkTree: isGitWorkTree(projectRoot),
  });
  if (branch.status !== 'ok' && branch.status !== 'not-applicable') {
    throw new Error(`Classic SDK branch binding is ${branch.status}`);
  }
  if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
    throw new Error('Classic SDK has a claimed Action with an unknown outcome');
  }
  const wait = run.waits
    .slice()
    .reverse()
    .find((candidate) => candidate.stepId === 'full.design.confirm');
  if (!wait || wait.proposalHash !== proposalHash) {
    throw new Error('Classic Design decision does not match the pending proposal');
  }
  if (wait.status === 'resolved' && wait.decision?.choice === choice) return run;
  if (wait.status !== 'pending') {
    throw new Error('Classic Design proposal already has a different decision');
  }
  if (choice === 'approved') {
    await assertDesignProposalSourcesCurrent({ projectRoot, change, run, state });
  }
  return runtime.resolveWait({
    runId: run.runId,
    expectedRevision: run.revision,
    waitId: wait.id,
    proposalHash,
    decisionId: `classic-design-${proposalHash}-${choice}`,
    choice,
  });
}

/** Read-only Design preflight shared by the Guard preview and the Run commit. */
export async function inspectClassicSdkDesign(options: {
  projectRoot: string;
  change: string;
  designDoc: string;
}) {
  const { projectRoot, change, designDoc } = options;
  const inspected = await inspectClassicSdkRun(projectRoot, change);
  const { run, state, profile } = inspected;
  if (profile !== 'full' || !['design', 'build'].includes(state.phase)) {
    throw new Error('Classic Design completion requires a full SDK change in Design');
  }
  if (state.designDoc && state.designDoc !== designDoc) {
    throw new Error('Classic Design must preserve its registered document');
  }
  const branch = evaluateBranchBinding({
    isolation: state.isolation,
    boundBranch: state.boundBranch,
    currentBranch: liveGitBranch(projectRoot),
    gitWorkTree: isGitWorkTree(projectRoot),
  });
  if (branch.status !== 'ok' && branch.status !== 'not-applicable') {
    throw new Error(`Classic SDK branch binding is ${branch.status}`);
  }
  if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
    throw new Error('Classic SDK has a claimed Action with an unknown outcome');
  }
  const decision = run.waits
    .slice()
    .reverse()
    .find((wait) => wait.stepId === 'full.design.confirm');
  if (!decision) throw new Error('Classic Design has no pending proposal');
  if (decision.status === 'resolved' && decision.decision?.choice !== 'approved') {
    throw new Error('Classic Design proposal was not approved');
  }
  await assertDesignProposalSourcesCurrent({ projectRoot, change, run, state });
  const input = run.input as { changeDir: string };
  const readiness = await inspectClassicDesignReadiness(
    projectRoot,
    path.join(projectRoot, input.changeDir),
    { ...state, designDoc },
  );
  if (readiness.design !== 'ready') {
    throw new Error(
      readiness.issues.map((issue) => issue.message).join('\n') ||
        'Classic Design document is not ready',
    );
  }
  if (state.language !== 'en' && state.language !== 'zh-CN') {
    throw new Error('Classic change language is not set');
  }
  const source = await readClassicProjectFile(projectRoot, designDoc, {
    label: 'Classic Design document',
  });
  const languageIssue = classicDocumentLanguageMismatch(source, state.language, designDoc);
  if (languageIssue) throw new Error(languageIssue);
  const receipt = await classicDesignEvidenceReceipt(projectRoot, designDoc);
  return { ...inspected, decision, receipt };
}

/** Guard 在一次预检后立即完成批准；后续 evidence validator 仍独立验证。 */
export async function inspectAndCompleteClassicSdkDesign(options: {
  projectRoot: string;
  change: string;
  designDoc: string;
  apply: boolean;
  approvalHash?: string;
}) {
  const inspected = await inspectClassicSdkDesign(options);
  const completed =
    options.apply &&
    inspected.state.phase === 'design' &&
    options.approvalHash === inspected.decision.proposalHash
      ? await completeInspectedClassicSdkDesign(inspected, {
          projectRoot: options.projectRoot,
          designDoc: options.designDoc,
          approvalHash: options.approvalHash,
        })
      : null;
  return { inspected, completed };
}

/** Submit an approved Design Doc to the authoritative SDK Run, resumably. */
export async function completeClassicSdkDesign(options: {
  projectRoot: string;
  change: string;
  designDoc: string;
  approvalHash: string;
}): Promise<WorkflowRun> {
  const { projectRoot, change, designDoc, approvalHash } = options;
  if (!/^[a-f0-9]{64}$/u.test(approvalHash)) {
    throw new Error('Classic Design requires the approved proposal hash');
  }
  const inspected = await inspectClassicSdkDesign({ projectRoot, change, designDoc });
  return completeInspectedClassicSdkDesign(inspected, { projectRoot, designDoc, approvalHash });
}

async function completeInspectedClassicSdkDesign(
  inspected: Awaited<ReturnType<typeof inspectClassicSdkDesign>>,
  options: { projectRoot: string; designDoc: string; approvalHash: string },
): Promise<WorkflowRun> {
  const { projectRoot, designDoc, approvalHash } = options;
  let { run } = inspected;
  const { runtime, decision, receipt } = inspected;
  if (decision.proposalHash !== approvalHash) {
    throw new Error('Classic Design approval does not match the pending proposal');
  }
  if (decision.status === 'pending') {
    run = await runtime.resolveWait({
      runId: run.runId,
      expectedRevision: run.revision,
      waitId: decision.id,
      proposalHash: approvalHash,
      decisionId: `classic-design-${approvalHash}`,
      choice: 'approved',
    });
  }
  const action = run.actions.find(
    (candidate) => candidate.stepId === 'full.design.document' && candidate.status === 'pending',
  );
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
        output: { designDoc },
      },
      context: { requestId: randomUUID(), projectRoot },
    });
  }
  const evidence = run.evidenceWaits?.find(
    (wait) => wait.stepId === 'full.design.evidence' && wait.status === 'pending',
  );
  if (evidence) {
    run = await runtime.recordEvidence({
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
  if ((run.state as { phase?: unknown } | null)?.phase !== 'build') {
    throw new Error('Classic Design remains pending in the SDK Run');
  }
  return run;
}
