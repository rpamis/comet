import { collectClassicSdkDeliveryInputs } from './classic-sdk-delivery-inputs.js';
import { acceptedClassicLegacyVerifyCheck } from './classic-sdk-run-upgrade.js';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { samePath } from '../../platform/paths/git-worktree.js';
import type {
  RuntimeAction,
  RuntimeExecutor,
  RuntimeOutcome,
  WorkflowRun,
  WorkflowRuntime,
} from '../engine/runtime.js';
import { liveGitBranch } from './classic-branch-binding.js';
import {
  assertClassicBuildReady,
  assertClassicAgentCheckReports,
  assertClassicPresetRequirementsCurrent,
} from './classic-sdk-application.js';
import { classicArchiveDocumentOutputs } from './classic-sdk-archive-documents.js';
import { classicSdkRunMatchesProfile } from './classic-sdk-profile.js';
import { classicSdkRemoteIdentity } from './classic-sdk-remote.js';
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
  deliveryPaths?: string[];
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
  const proposed = (
    wait?.proposal as
      | {
          outputs?: Record<string, unknown>;
        }
      | undefined
  )?.outputs?.[`${profile}.archive.prepare`] as
    | {
        targetBranch?: unknown;
        remote?: unknown;
        prBaseBranch?: unknown;
        deliveryPaths?: string[];
      }
    | undefined;
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
    ...(proposed.deliveryPaths ? { deliveryPaths: proposed.deliveryPaths } : {}),
  };
}
/** 仅表示 claim 前的准备检查失败，不包含执行或恢复失败。 */
export class ClassicSdkArchiveReadinessError extends Error {}
/** Revalidate the approved target and Verify evidence at the side-effect boundary. */
export async function assertClassicSdkArchiveReady(
  run: WorkflowRun,
  projectRoot: string,
): Promise<ClassicSdkArchiveApproval> {
  try {
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
    await assertClassicPresetRequirementsCurrent(
      projectRoot,
      String(
        (
          run.input as {
            changeDir: string;
          }
        ).changeDir,
      ),
      run,
    );
    const pendingArchive = run.actions.find(
      (action) =>
        ['pending', 'running'].includes(action.status) &&
        [`${state.workflow}.archive.preflight`, `${state.workflow}.archive.execute`].includes(
          action.stepId,
        ),
    );
    if (state.workflow === 'full' && pendingArchive) {
      const documents = classicArchiveDocumentOutputs(run, pendingArchive);
      const plan = documents.outputs['full.build.plan'] as
        | {
            plan?: unknown;
            designEvidence?: {
              ref?: unknown;
            };
          }
        | undefined;
      const design =
        (
          documents.outputs['full.design.document'] as
            | {
                designDoc?: unknown;
              }
            | undefined
        )?.designDoc ?? plan?.designEvidence?.ref;
      if (typeof plan?.plan !== 'string' || typeof design !== 'string')
        throw new Error('Classic Archive documents are missing');
      if (documents.recovered)
        await assertClassicBuildReady(
          projectRoot,
          String(
            (
              run.input as {
                changeDir: string;
              }
            ).changeDir,
          ),
          state,
          run,
        );
    }
    const branch = liveGitBranch(projectRoot);
    if (!branch || branch !== state.boundBranch || branch !== approved.targetBranch) {
      throw new Error('Classic Archive branch differs from the approved bound branch');
    }
    await assertVerifyEvidenceCurrent(run, projectRoot, state);
    return approved;
  } catch (error) {
    throw new ClassicSdkArchiveReadinessError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}
export async function assertVerifyEvidenceCurrent(
  run: WorkflowRun,
  projectRoot: string,
  state: ClassicState,
  _acceptedEpochDelta = 2,
): Promise<void> {
  const report = run.evidenceWaits
    ?.slice()
    .reverse()
    .find(
      (wait) =>
        wait.stepId === state.workflow + '.verify.report.evidence' && wait.status === 'resolved',
    )?.receipt;
  {
    const latest = [...run.actions]
      .reverse()
      .find((action) => action.stepId === state.workflow + '.verify.run');
    const output = latest?.outcome?.output as
      | {
          event?: string;
          verificationReport?: string;
          checks?: Array<{
            name: string;
            result: string;
            note?: string;
          }>;
          checksReason?: string;
        }
      | undefined;
    if (
      !report ||
      report.ref !== state.verificationReport ||
      latest?.status !== 'succeeded' ||
      output?.event !== 'verification-ready' ||
      output.verificationReport !== state.verificationReport
    )
      throw new Error('Classic Archive requires the latest accepted Verify report');
    if (!acceptedClassicLegacyVerifyCheck(run)) assertClassicAgentCheckReports(output);
    return;
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
      deliveryPaths: await collectClassicSdkDeliveryInputs(
        projectRoot,
        run,
        approved.deliveryPaths,
      ),
      ...(approved.remote ? { remote: approved.remote, remoteIdentity } : {}),
      ...(approved.prBaseBranch ? { prBaseBranch: approved.prBaseBranch } : {}),
    },
  };
}
export function createClassicSdkArchivePreflightExecutor(projectRoot: string): RuntimeExecutor {
  const bound = (
    context:
      | {
          projectRoot?: string;
        }
      | undefined,
  ) => {
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
  const output = result.output as {
    verifiedBranch: string;
    baseCommit: string;
  };
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
