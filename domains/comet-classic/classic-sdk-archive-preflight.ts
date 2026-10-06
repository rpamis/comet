import { randomUUID } from 'node:crypto';
import { classicSdkRunMatchesProfile } from './classic-sdk-profile.js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { samePath } from '../../platform/paths/git-worktree.js';
import type {
  RuntimeAction,
  RuntimeExecutor,
  RuntimeOutcome,
  WorkflowRun,
  WorkflowRuntime,
} from '../engine/runtime.js';
import {
  hashProtectedProjectFile,
  inspectProtectedProjectPath,
} from '../workflow-contract/protected-project-path.js';
import { liveGitBranch } from './classic-branch-binding.js';
import { classicSdkRemoteIdentity } from './classic-sdk-remote.js';
import { checkEnvironmentFingerprint, collectCheckSnapshot } from './classic-check-snapshot.js';
import { readCheckPolicy } from './classic-check-policy.js';
import type { ClassicState } from './classic-state.js';

interface ClassicSdkArchivePreflightInput {
  runId: string;
  projectRoot: string;
}

interface ClassicSdkArchiveApproval {
  action: 'local' | 'push' | 'pr';
  targetBranch: string;
  remote?: string;
  prBaseBranch?: string;
}

function archiveApproval(run: WorkflowRun): ClassicSdkArchiveApproval {
  const profile = (run.state as ClassicState | undefined)?.workflow;
  const wait = run.waits
    .slice()
    .reverse()
    .find(
      (candidate) =>
        candidate.stepId === `${profile}.archive.confirm` &&
        candidate.status === 'resolved' &&
        ['local', 'push', 'pr'].includes(candidate.decision?.choice ?? ''),
    );
  const proposed = (wait?.proposal as { outputs?: Record<string, unknown> } | undefined)?.outputs?.[
    `${profile}.archive.prepare`
  ] as { targetBranch?: unknown; remote?: unknown; prBaseBranch?: unknown } | undefined;
  if (
    !wait?.decision ||
    !proposed ||
    typeof proposed.targetBranch !== 'string' ||
    !proposed.targetBranch ||
    (wait.decision.choice !== 'local' &&
      (typeof proposed.remote !== 'string' || !proposed.remote)) ||
    (wait.decision.choice === 'pr' &&
      (typeof proposed.prBaseBranch !== 'string' || !proposed.prBaseBranch))
  ) {
    throw new Error('Classic Archive has no current delivery approval');
  }
  return {
    action: wait.decision.choice as 'local' | 'push' | 'pr',
    targetBranch: proposed.targetBranch,
    ...(typeof proposed.remote === 'string' ? { remote: proposed.remote } : {}),
    ...(typeof proposed.prBaseBranch === 'string' ? { prBaseBranch: proposed.prBaseBranch } : {}),
  };
}

/** Revalidate the approved target and Verify evidence at the side-effect boundary. */
export async function assertClassicSdkArchiveReady(
  run: WorkflowRun,
  projectRoot: string,
): Promise<ClassicSdkArchiveApproval> {
  const state = run.state as ClassicState | undefined;
  if (
    !state ||
    !classicSdkRunMatchesProfile(run, state.workflow) ||
    run.status !== 'running' ||
    state?.phase !== 'archive' ||
    state.verifyResult !== 'pass' ||
    state.archiveConfirmation !== 'confirmed' ||
    state.archived
  ) {
    throw new Error('Classic SDK Run is not ready to Archive');
  }
  const approved = archiveApproval(run);
  const branch = liveGitBranch(projectRoot);
  if (!branch || branch !== state.boundBranch || branch !== approved.targetBranch) {
    throw new Error('Classic Archive branch differs from the approved bound branch');
  }
  await assertVerifyEvidenceCurrent(run, projectRoot, state);
  return approved;
}

export async function assertVerifyEvidenceCurrent(
  run: WorkflowRun,
  projectRoot: string,
  state: ClassicState,
  acceptedEpochDelta = 2,
): Promise<void> {
  const changeDirRef =
    run.input !== null &&
    typeof run.input === 'object' &&
    !Array.isArray(run.input) &&
    typeof run.input.changeDir === 'string'
      ? run.input.changeDir
      : null;
  if (!changeDirRef || !state.verificationReport) {
    throw new Error('Classic Archive is missing the current change or Verify report');
  }
  const reportReceipt = run.evidenceWaits
    ?.slice()
    .reverse()
    .find(
      (wait) =>
        wait.stepId === `${state.workflow}.verify.report.evidence` && wait.status === 'resolved',
    )?.receipt;
  const checkReceipt = run.evidenceWaits
    ?.slice()
    .reverse()
    .find(
      (wait) =>
        wait.stepId === `${state.workflow}.verify.check.evidence` && wait.status === 'resolved',
    )?.receipt;
  const checkAction = run.actions
    .slice()
    .reverse()
    .find(
      (action) =>
        action.stepId === `${state.workflow}.verify.check` && action.status === 'succeeded',
    );
  const output = checkAction?.outcome?.output as Record<string, unknown> | undefined;
  if (
    !reportReceipt ||
    reportReceipt.ref !== state.verificationReport ||
    !checkReceipt ||
    !checkAction ||
    checkAction.claim?.executorId !== 'comet-classic-check' ||
    !output ||
    output.scope !== 'verify' ||
    output.receiptRef !== checkReceipt.ref ||
    output.contentHash !== checkReceipt.contentHash ||
    typeof output.checkEpoch !== 'number' ||
    // Verify acceptance advances the epoch; Archive authorization advances it once more.
    output.checkEpoch + acceptedEpochDelta !== state.checkEpoch ||
    typeof output.inputAfter !== 'string' ||
    typeof output.environment !== 'string' ||
    !Array.isArray(output.argv) ||
    output.argv.length === 0 ||
    output.argv.some((arg) => typeof arg !== 'string') ||
    typeof output.cwd !== 'string'
  ) {
    throw new Error('Classic Archive Verify evidence is missing or stale');
  }
  const report = await hashProtectedProjectFile(projectRoot, reportReceipt.ref, {
    label: 'Classic Archive Verify report',
  });
  if (report.digest !== reportReceipt.contentHash) {
    throw new Error('Classic Archive Verify report changed');
  }
  const log = await hashProtectedProjectFile(projectRoot, checkReceipt.ref, {
    label: 'Classic Archive Verify check log',
  });
  if (log.digest !== checkReceipt.contentHash) {
    throw new Error('Classic Archive Verify check log changed');
  }
  const change = await inspectProtectedProjectPath(projectRoot, changeDirRef, {
    label: 'Classic Archive change',
    expected: 'directory',
  });
  const cwd =
    output.cwd === '.'
      ? { exists: true, target: projectRoot, relative: '.' }
      : await inspectProtectedProjectPath(projectRoot, output.cwd, {
          label: 'Classic Archive check cwd',
          expected: 'directory',
        });
  if (!change.exists || !cwd.exists) throw new Error('Classic Archive check paths changed');
  const identity = { argv: output.argv as string[], cwd: cwd.relative || '.' };
  const policy = await readCheckPolicy(projectRoot, identity);
  const environment = await checkEnvironmentFingerprint(identity.argv, cwd.target, policy);
  if (environment !== output.environment)
    throw new Error('Classic Archive check environment changed');
  const snapshot = await collectCheckSnapshot(projectRoot, change.target, identity, {
    verificationReport: state.verificationReport,
  });
  if (snapshot.digest !== output.inputAfter) {
    throw new Error('Classic Archive check inputs changed');
  }
}

export async function runClassicSdkArchivePreflight(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  requestedRoot: string,
): Promise<Pick<RuntimeOutcome, 'status' | 'output'>> {
  const projectRoot = path.resolve(requestedRoot);
  const profile = (run.state as unknown as ClassicState).workflow;
  if (
    action.runId !== run.runId ||
    action.stepId !== profile + '.archive.preflight' ||
    action.type !== 'call_tool' ||
    action.ref !== 'classic-archive-preflight'
  )
    throw new Error('Current Classic SDK Run has no Archive preflight Action');
  const approved = await assertClassicSdkArchiveReady(run, projectRoot);
  const branch = approved.targetBranch;
  const remoteIdentity = approved.remote
    ? classicSdkRemoteIdentity(projectRoot, approved.remote)
    : undefined;
  const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).trim();
  if (liveGitBranch(projectRoot) !== branch)
    throw new Error('Classic Archive branch changed during preflight');
  return {
    status: 'succeeded',
    output: {
      deliveryAction: approved.action,
      targetBranch: approved.targetBranch,
      verifiedBranch: branch,
      baseCommit,
      ...(approved.remote ? { remote: approved.remote, remoteIdentity } : {}),
      ...(approved.prBaseBranch ? { prBaseBranch: approved.prBaseBranch } : {}),
    },
  };
}
export function createClassicSdkArchivePreflightExecutor(projectRoot: string): RuntimeExecutor {
  const bound = (context: { projectRoot?: string } | undefined) => {
    if (!context?.projectRoot || !samePath(context.projectRoot, projectRoot))
      throw new Error('Classic Archive preflight requires its bound project');
  };
  return {
    id: 'comet-classic-archive-preflight',
    capabilities: [],
    supports: (action) => action.type === 'call_tool' && action.ref === 'classic-archive-preflight',
    async preflight(action, context, run) {
      bound(context);
      if (!run) throw new Error('Classic Archive requires a Run');
      await runClassicSdkArchivePreflight(run, action, projectRoot);
    },
    async execute(action, context, run) {
      bound(context);
      if (!run) throw new Error('Classic Archive requires a Run');
      return runClassicSdkArchivePreflight(run, action, projectRoot);
    },
  };
}
/** 旧 CLI 保留领取与回传；实际领域核对和默认机器端口共用。 */
export async function executeClassicSdkArchivePreflight(
  runtime: Pick<WorkflowRuntime, 'inspect' | 'claim' | 'recordOutcome' | 'markUnknown'>,
  input: ClassicSdkArchivePreflightInput,
): Promise<WorkflowRun> {
  const projectRoot = path.resolve(input.projectRoot),
    run = await runtime.inspect(input.runId);
  const profile = (run.state as unknown as ClassicState).workflow;
  const action = run.actions
    .slice()
    .reverse()
    .find(
      (candidate) =>
        candidate.stepId === profile + '.archive.preflight' && candidate.status === 'pending',
    );
  if (!action) throw new Error('Current Classic SDK Run has no pending Archive preflight Action');
  const result = await runClassicSdkArchivePreflight(run, action, projectRoot);
  const output = result.output as { verifiedBranch: string; baseCommit: string };
  const token = randomUUID(),
    requestId = randomUUID();
  await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-classic-archive-preflight',
    claimToken: token,
    expectedRevision: run.revision,
    context: { requestId, projectRoot },
  });
  try {
    if (
      liveGitBranch(projectRoot) !== output.verifiedBranch ||
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim() !==
        output.baseCommit
    )
      throw new Error('Classic Archive branch or HEAD changed during preflight');
    return await runtime.recordOutcome({
      runId: run.runId,
      context: { requestId, projectRoot },
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: token,
        outcomeId: randomUUID(),
        ...result,
      },
    });
  } catch (error) {
    const current = await runtime.inspect(run.runId);
    const latest = current.actions.find((candidate) => candidate.id === action.id);
    if (latest?.status === 'running' && latest.attempt === action.attempt)
      await runtime.markUnknown({
        runId: run.runId,
        actionId: action.id,
        attempt: action.attempt,
        reason: error instanceof Error ? error.message : String(error),
      });
    throw error;
  }
}
