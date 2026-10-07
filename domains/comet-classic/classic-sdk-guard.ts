import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { WorkflowRun } from '../engine/runtime.js';
import type { ClassicCommandResult } from './classic-cli.js';
import { evaluateBranchBinding, isGitWorkTree, liveGitBranch } from './classic-branch-binding.js';
import { classicIssue } from './classic-issues.js';
import { classicOpenContentProblem } from './classic-open-content.js';
import { assertClassicBuildReady, classicOpenEvidenceReceipt } from './classic-sdk-application.js';
import { completeClassicSdkBuild } from './classic-sdk-build.js';
import { classicCheckCommand } from './classic-check-command.js';
import { inspectAndCompleteClassicSdkDesign } from './classic-sdk-design.js';
import { classicSdkNextAction, inspectClassicSdkRun } from './classic-sdk-status.js';
import { classicVerificationReportReceipt } from './classic-verification-report.js';
import { executeClassicSdkArchive } from './classic-sdk-archive.js';
import {
  assertClassicSdkArchiveReady,
  ClassicSdkArchiveReadinessError,
  executeClassicSdkArchivePreflight,
} from './classic-sdk-archive-preflight.js';

interface ClassicSdkOpenGuardOptions {
  projectRoot: string;
  change: string;
  apply: boolean;
  approvalHash?: string;
}

function guardResult(
  change: string,
  phase: string,
  projectRoot: string,
  approvalHash: string | null,
  issue?: string,
  run?: WorkflowRun,
): ClassicCommandResult {
  const blocked = issue !== undefined;
  return {
    exitCode: blocked ? 1 : 0,
    data: {
      change,
      phase,
      projectRoot,
      ...(approvalHash === null ? {} : { approvalHash }),
      checks: { passed: blocked ? 0 : 1, total: 1, blocked },
      issues: blocked ? [classicIssue(issue)] : [],
      ...(run
        ? {
            run: { id: run.runId, revision: run.revision, status: run.status },
            nextAction: classicSdkNextAction(run),
          }
        : {}),
    },
    stderr: blocked
      ? `BLOCKED — ${issue}\n`
      : `ALL CHECKS PASSED — ${phase === 'open' ? 'approval required before applying' : `phase=${phase}`}\n`,
  };
}

function changeDirRef(run: WorkflowRun): string {
  const input = run.input;
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    typeof input.changeDir !== 'string'
  ) {
    throw new Error('Classic SDK Run has no change directory');
  }
  return input.changeDir;
}

function sdkCheckCwd(projectRoot: string, invocationCwd: string, recorded?: string): string {
  if (recorded !== undefined) return recorded;
  const relative = path.relative(projectRoot, invocationCwd);
  return path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)
    ? '.'
    : relative.replaceAll('\\', '/') || '.';
}

export async function classicSdkOpenGuard(
  options: ClassicSdkOpenGuardOptions,
): Promise<ClassicCommandResult> {
  const { projectRoot, change, apply, approvalHash } = options;
  const inspected = await inspectClassicSdkRun(projectRoot, change);
  let { run } = inspected;
  const { state, runtime, profile } = inspected;
  if (state.phase !== 'open') {
    return guardResult(
      change,
      state.phase,
      projectRoot,
      null,
      `Classic SDK change is in ${state.phase}, not open`,
    );
  }
  const branch = liveGitBranch(projectRoot);
  const binding = evaluateBranchBinding({
    isolation: state.isolation,
    boundBranch: state.boundBranch,
    currentBranch: branch,
    gitWorkTree: isGitWorkTree(projectRoot),
  });
  if (binding.status !== 'ok' && binding.status !== 'not-applicable') {
    return guardResult(
      change,
      'open',
      projectRoot,
      null,
      `Classic SDK branch binding is ${binding.status}`,
    );
  }
  if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
    return guardResult(
      change,
      'open',
      projectRoot,
      null,
      'Classic SDK has a claimed Action with an unknown outcome',
    );
  }
  const ref = changeDirRef(run);
  const receipt = await classicOpenEvidenceReceipt(projectRoot, ref);
  const contentIssue = await classicOpenContentProblem(projectRoot, ref, state.language);
  if (contentIssue) return guardResult(change, 'open', projectRoot, null, contentIssue);
  if (!apply) return guardResult(change, 'open', projectRoot, receipt.contentHash);
  if (!approvalHash || !/^[a-f0-9]{64}$/u.test(approvalHash)) {
    return guardResult(
      change,
      'open',
      projectRoot,
      receipt.contentHash,
      'An approved Open artifact hash is required',
    );
  }
  if (approvalHash !== receipt.contentHash) {
    return guardResult(
      change,
      'open',
      projectRoot,
      receipt.contentHash,
      'Classic Open artifacts changed after approval',
    );
  }

  const context = { requestId: randomUUID(), projectRoot };
  const openStep = `${profile}.open`;
  const openAction = run.actions.find(
    (action) => action.stepId === openStep && action.status === 'pending',
  );
  if (openAction) {
    const claimToken = randomUUID();
    run = await runtime.claim({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: openAction.id,
      attempt: openAction.attempt,
      inputHash: openAction.inputHash,
      executorId: 'comet-classic-guard',
      claimToken,
    });
    run = await runtime.recordOutcome({
      runId: run.runId,
      expectedRevision: run.revision,
      outcome: {
        actionId: openAction.id,
        attempt: openAction.attempt,
        inputHash: openAction.inputHash,
        claimToken,
        outcomeId: randomUUID(),
        status: 'succeeded',
        output: { event: 'open-complete' },
      },
      context,
    });
  }
  const evidence = run.evidenceWaits?.find(
    (wait) => wait.kind === 'classic-open-artifacts' && wait.status === 'pending',
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
      context,
    });
  }
  if (profile === 'full') {
    const wait = run.waits.find(
      (candidate) => candidate.stepId === 'full.open.confirm' && candidate.status === 'pending',
    );
    if (wait) {
      const approvedEvidence =
        wait.proposal &&
        typeof wait.proposal === 'object' &&
        !Array.isArray(wait.proposal) &&
        'outputs' in wait.proposal &&
        wait.proposal.outputs &&
        typeof wait.proposal.outputs === 'object' &&
        !Array.isArray(wait.proposal.outputs)
          ? wait.proposal.outputs['full.open.evidence']
          : null;
      if (
        !approvedEvidence ||
        typeof approvedEvidence !== 'object' ||
        Array.isArray(approvedEvidence) ||
        approvedEvidence.ref !== receipt.ref ||
        approvedEvidence.contentHash !== approvalHash
      ) {
        return guardResult(
          change,
          'open',
          projectRoot,
          receipt.contentHash,
          'The pending Open decision does not match approved artifacts',
        );
      }
      run = await runtime.resolveWait({
        runId: run.runId,
        expectedRevision: run.revision,
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: `classic-open-${approvalHash}`,
        choice: 'approved',
      });
    }
    const revalidation = run.actions.find(
      (action) => action.stepId === 'full.open.revalidate' && action.status === 'pending',
    );
    if (revalidation) {
      run = await runtime.execute({
        runId: run.runId,
        expectedRevision: run.revision,
        actionId: revalidation.id,
        executorId: 'comet-classic-open-revalidate',
        context,
      });
    }
  }
  const current = run.state as { phase?: unknown } | null;
  if (current?.phase === 'open') {
    return guardResult(
      change,
      'open',
      projectRoot,
      receipt.contentHash,
      'Classic Open remains pending in the SDK Run',
    );
  }
  return guardResult(
    change,
    String(current?.phase ?? 'unknown'),
    projectRoot,
    receipt.contentHash,
    undefined,
    run,
  );
}

/** Preview or commit a full-workflow Design decision using the same SDK preflight. */
export async function classicSdkDesignGuard(options: {
  projectRoot: string;
  change: string;
  designDoc: string;
  apply: boolean;
  approvalHash?: string;
}): Promise<ClassicCommandResult> {
  const { projectRoot, change, designDoc, apply, approvalHash } = options;
  const { inspected, completed } = await inspectAndCompleteClassicSdkDesign({
    projectRoot,
    change,
    designDoc,
    apply,
    approvalHash,
  });
  if (inspected.state.phase !== 'design') {
    return guardResult(
      change,
      inspected.state.phase,
      projectRoot,
      inspected.decision.proposalHash,
      'Classic SDK Design has already advanced',
    );
  }
  if (!apply) return guardResult(change, 'design', projectRoot, inspected.decision.proposalHash);
  if (!approvalHash || approvalHash !== inspected.decision.proposalHash) {
    return guardResult(
      change,
      'design',
      projectRoot,
      inspected.decision.proposalHash,
      'Classic Design approval does not match the pending proposal',
    );
  }
  const run = completed!;
  return guardResult(
    change,
    String((run.state as { phase?: unknown } | null)?.phase ?? 'unknown'),
    projectRoot,
    approvalHash,
    undefined,
    run,
  );
}

/** Preview or finish the current Build through its SDK Action and check receipt. */
export async function classicSdkBuildGuard(options: {
  projectRoot: string;
  invocationCwd: string;
  change: string;
  apply: boolean;
  argv?: string[];
  checkCwd?: string;
}): Promise<ClassicCommandResult> {
  const { projectRoot, invocationCwd, change, apply, argv } = options;
  const inspected = await inspectClassicSdkRun(projectRoot, change);
  const { run, state, profile } = inspected;
  if (state.phase !== 'build') {
    return guardResult(
      change,
      state.phase,
      projectRoot,
      null,
      `Classic SDK Build Guard requires Build; current phase is ${state.phase}`,
    );
  }
  if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
    return guardResult(
      change,
      'build',
      projectRoot,
      null,
      'Classic SDK has a claimed Action with an unknown outcome',
    );
  }
  const input = run.input as { changeDir?: unknown } | null;
  if (typeof input?.changeDir !== 'string') {
    return guardResult(
      change,
      'build',
      projectRoot,
      null,
      'Classic SDK Run has no change directory',
    );
  }
  try {
    await assertClassicBuildReady(projectRoot, input.changeDir, state, run);
  } catch (error) {
    return guardResult(
      change,
      'build',
      projectRoot,
      null,
      error instanceof Error ? error.message : String(error),
    );
  }
  const buildPending = run.actions.some(
    (action) => action.stepId === `${profile}.build.execute` && action.status === 'pending',
  );
  const checkPending = run.actions.some(
    (action) => action.stepId === `${profile}.build.check` && action.status === 'pending',
  );
  const evidencePending = run.evidenceWaits?.some(
    (wait) => wait.stepId === `${profile}.build.check.evidence` && wait.status === 'pending',
  );
  if (!buildPending && !checkPending && !evidencePending) {
    return guardResult(
      change,
      'build',
      projectRoot,
      null,
      'Classic SDK has no pending Build Action',
    );
  }
  if (!apply) return guardResult(change, 'build', projectRoot, null);
  if (!argv?.length) {
    return guardResult(
      change,
      'build',
      projectRoot,
      null,
      'A literal Build check command is required',
    );
  }
  if (buildPending) await completeClassicSdkBuild({ projectRoot, change });
  const cwd = sdkCheckCwd(projectRoot, invocationCwd, options.checkCwd);
  const checked = await classicCheckCommand(['run', change, 'build', '--cwd', cwd, '--', ...argv], {
    json: false,
    invocationCwd,
    projectRoot,
  });
  if (checked.exitCode !== 0) {
    return guardResult(
      change,
      'build',
      projectRoot,
      null,
      checked.stderr?.trim() || checked.stdout?.trim() || 'Classic Build check failed',
    );
  }
  const finished = await inspectClassicSdkRun(projectRoot, change);
  return finished.state.phase === 'verify'
    ? guardResult(change, 'verify', projectRoot, null, undefined, finished.run)
    : guardResult(change, 'build', projectRoot, null, 'Classic SDK Build check remains pending');
}

/** Preview or finish Verify through report evidence and a real SDK check. */
export async function classicSdkVerifyGuard(options: {
  projectRoot: string;
  invocationCwd: string;
  change: string;
  reportRef: string;
  apply: boolean;
  argv?: string[];
  checkCwd?: string;
}): Promise<ClassicCommandResult> {
  const { projectRoot, invocationCwd, change, reportRef, apply, argv } = options;
  const inspected = await inspectClassicSdkRun(projectRoot, change);
  let { run } = inspected;
  const { state, runtime, profile } = inspected;
  if (state.phase !== 'verify') {
    return guardResult(
      change,
      state.phase,
      projectRoot,
      null,
      `Classic SDK Verify Guard requires Verify; current phase is ${state.phase}`,
    );
  }
  if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
    return guardResult(
      change,
      'verify',
      projectRoot,
      null,
      'Classic SDK has a claimed Action with an unknown outcome',
    );
  }
  let receipt: Awaited<ReturnType<typeof classicVerificationReportReceipt>>;
  try {
    await assertClassicBuildReady(projectRoot, changeDirRef(run), state, run);
    receipt = await classicVerificationReportReceipt(projectRoot, reportRef, state.language);
  } catch (error) {
    return guardResult(
      change,
      'verify',
      projectRoot,
      null,
      error instanceof Error ? error.message : String(error),
    );
  }
  const verifyStep = `${profile}.verify.run`;
  const currentVerify = run.actions
    .slice()
    .reverse()
    .find((action) => action.stepId === verifyStep);
  const verifyAction = currentVerify?.status === 'pending' ? currentVerify : undefined;
  const verifySequence = currentVerify ? run.actionContexts[currentVerify.id]?.sequence : undefined;
  // 新一轮由新的 Verify Action 确定报告；历史收据只约束其来源轮次。
  if (!verifyAction && state.verificationReport && state.verificationReport !== receipt.ref) {
    return guardResult(
      change,
      'verify',
      projectRoot,
      null,
      'Classic SDK Verify report does not match the current Run',
    );
  }
  const acceptedReport = run.evidenceWaits
    ?.slice()
    .reverse()
    .find(
      (wait) =>
        wait.stepId === `${profile}.verify.report.evidence` &&
        wait.status === 'resolved' &&
        verifySequence !== undefined &&
        wait.results[verifyStep]?.sequence === verifySequence,
    )?.receipt;
  if (acceptedReport && acceptedReport.contentHash !== receipt.contentHash) {
    return guardResult(
      change,
      'verify',
      projectRoot,
      null,
      'Classic SDK Verify report changed after accepted evidence',
    );
  }
  const reportWait = run.evidenceWaits?.find(
    (wait) => wait.stepId === `${profile}.verify.report.evidence` && wait.status === 'pending',
  );
  const checkAction = run.actions.find(
    (action) => action.stepId === `${profile}.verify.check` && action.status === 'pending',
  );
  const checkWait = run.evidenceWaits?.find(
    (wait) => wait.stepId === `${profile}.verify.check.evidence` && wait.status === 'pending',
  );
  if (!verifyAction && !reportWait && !checkAction && !checkWait) {
    return guardResult(
      change,
      'verify',
      projectRoot,
      null,
      'Classic SDK has no pending Verify Action',
    );
  }
  if (!apply) return guardResult(change, 'verify', projectRoot, null);
  if (!argv?.length) {
    return guardResult(
      change,
      'verify',
      projectRoot,
      null,
      'A literal Verify check command is required',
    );
  }
  const context = { requestId: randomUUID(), projectRoot };
  if (verifyAction) {
    const claimToken = randomUUID();
    run = await runtime.claim({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: verifyAction.id,
      attempt: verifyAction.attempt,
      inputHash: verifyAction.inputHash,
      executorId: 'comet-classic-guard',
      claimToken,
    });
    run = await runtime.recordOutcome({
      runId: run.runId,
      expectedRevision: run.revision,
      outcome: {
        actionId: verifyAction.id,
        attempt: verifyAction.attempt,
        inputHash: verifyAction.inputHash,
        claimToken,
        outcomeId: randomUUID(),
        status: 'succeeded',
        output: { event: 'verification-ready', verificationReport: receipt.ref },
      },
      context,
    });
  }
  const pendingReport = run.evidenceWaits?.find(
    (wait) => wait.stepId === `${profile}.verify.report.evidence` && wait.status === 'pending',
  );
  if (pendingReport) {
    await runtime.recordEvidence({
      runId: run.runId,
      expectedRevision: run.revision,
      evidenceId: pendingReport.id,
      kind: pendingReport.kind,
      ref: receipt.ref,
      contentHash: receipt.contentHash,
      submissionId: randomUUID(),
      context,
    });
  }
  const cwd = sdkCheckCwd(projectRoot, invocationCwd, options.checkCwd);
  const checked = await classicCheckCommand(
    ['run', change, 'verify', '--cwd', cwd, '--', ...argv],
    {
      json: false,
      invocationCwd,
      projectRoot,
    },
  );
  const finished = await inspectClassicSdkRun(projectRoot, change);
  if (checked.exitCode !== 0) {
    const failed = guardResult(
      change,
      finished.state.phase,
      projectRoot,
      null,
      checked.stderr?.trim() || checked.stdout?.trim() || 'Classic Verify check failed',
      finished.run,
    );
    return {
      ...failed,
      data: {
        ...(checked.data as Record<string, unknown>),
        ...(failed.data as Record<string, unknown>),
      },
    };
  }
  return finished.state.phase === 'archive'
    ? guardResult(change, 'archive', projectRoot, null, undefined, finished.run)
    : guardResult(change, 'verify', projectRoot, null, 'Classic SDK Verify check remains pending');
}

/** Preview or execute only an explicitly approved SDK Archive; delivery remains separate. */
export async function classicSdkArchiveGuard(options: {
  projectRoot: string;
  change: string;
  apply: boolean;
}): Promise<ClassicCommandResult> {
  const { projectRoot, change, apply } = options;
  const inspected = await inspectClassicSdkRun(projectRoot, change);
  const { run, state, runtime, profile } = inspected;
  if (state.phase !== 'archive') {
    return guardResult(
      change,
      state.phase,
      projectRoot,
      null,
      `Classic SDK Archive Guard requires Archive; current phase is ${state.phase}`,
    );
  }
  if (state.archived) {
    return guardResult(
      change,
      'archive',
      projectRoot,
      null,
      'Classic SDK change is already archived; finish its pending delivery Action',
    );
  }
  if (run.actions.some((action) => action.status === 'running' || action.status === 'unknown')) {
    return guardResult(
      change,
      'archive',
      projectRoot,
      null,
      'Classic SDK has a claimed Action with an unknown outcome',
    );
  }
  try {
    // apply 的执行器会在各自副作用边界重新检查；预览仍需独立检查。
    if (!apply) await assertClassicSdkArchiveReady(run, projectRoot);
  } catch (error) {
    return guardResult(
      change,
      'archive',
      projectRoot,
      null,
      error instanceof Error ? error.message : String(error),
    );
  }
  const preflightPending = run.actions.some(
    (action) => action.stepId === `${profile}.archive.preflight` && action.status === 'pending',
  );
  const archivePending = run.actions.some(
    (action) => action.stepId === `${profile}.archive.execute` && action.status === 'pending',
  );
  if (!preflightPending && !archivePending) {
    return guardResult(
      change,
      'archive',
      projectRoot,
      null,
      'Classic SDK has no pending Archive Action',
    );
  }
  if (!apply) return guardResult(change, 'archive', projectRoot, null);
  let archived: WorkflowRun;
  try {
    if (preflightPending) {
      await executeClassicSdkArchivePreflight(runtime, { runId: run.runId, projectRoot });
    }
    archived = await executeClassicSdkArchive(runtime, { runId: run.runId, projectRoot });
  } catch (error) {
    if (!(error instanceof ClassicSdkArchiveReadinessError)) throw error;
    return guardResult(change, 'archive', projectRoot, null, error.message);
  }
  const archivedState = archived.state as { archived?: unknown } | null;
  return archivedState?.archived === true
    ? guardResult(change, 'archive', projectRoot, null, undefined, archived)
    : guardResult(change, 'archive', projectRoot, null, 'Classic SDK Archive did not complete');
}
