import path from 'node:path';
import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';
import { parseNativePortableState } from './native-portable-state.js';
import { createFileRuntimeStore, type WorkflowRun } from '../engine/runtime.js';
import { resolveWorkspaceRuntimeRootSync } from '../workflow-contract/workspace-runtime.js';
import { readWorkflowApplicationStorageDisposition } from '../workflow-application/index.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import {
  inspectNativeSdkCheckExecutions,
  hasNativeSdkPortableStopEvidence,
  type NativeSdkCheckExecutionInspection,
} from './native-sdk-check-execution.js';
import { recoverCancelledNativeSdkArchive } from './native-sdk-archive.js';
import { assertNativeSdkCandidateUnchanged } from './native-sdk-checks.js';

/** 只读区分状态可读、执行核对和存储收尾；正常用户等待不是损坏。 */
export async function inspectNativeSdkRunDiagnostics(
  projectRoot: string,
  run: WorkflowRun,
  options: { checkExecutionObservation?: readonly NativeSdkCheckExecutionInspection[] } = {},
) {
  const owner = await readSdkChangeOwner(projectRoot, 'native', run.runId, { readOnly: true });
  const disposition =
    owner && owner.application !== 'native'
      ? await readWorkflowApplicationStorageDisposition(projectRoot, owner.application, run.runId)
      : await createFileRuntimeStore<WorkflowRun>({
          rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs/native'),
        }).readPartitionMetadata(run.runId);
  const storageSettled = ['active', 'closed'].includes(disposition);
  const checks =
    options.checkExecutionObservation ??
    (await inspectNativeSdkCheckExecutions({ projectRoot, run, includeSettled: true }));
  const missingStops = checks.filter((item) => {
    const action = run.actions.find((entry) => entry.id === item.actionId)!;
    return (
      ['succeeded', 'failed', 'cancelled'].includes(action.status) &&
      (!item.quiescent || !hasNativeSdkPortableStopEvidence(run, action))
    );
  });
  const unknown = run.actions.filter((action) => action.status === 'unknown');
  const recoveries = checks.filter(
    (item) =>
      item.recoveryRequired &&
      !missingStops.includes(item) &&
      !unknown.some((action) => action.id === item.actionId),
  );
  let cancelledArchive = run.actions.some(
    (action) =>
      action.stepId === 'archive.finalize' && action.status === 'cancelled' && !action.outcome,
  );
  if (cancelledArchive) {
    try {
      await recoverCancelledNativeSdkArchive({
        projectRoot,
        run,
        readOnly: true,
        checkExecutionObservation: checks,
      });
      cancelledArchive = false;
    } catch {
      // 保留需要核对的归档义务；只读诊断不能完成事务。
    }
  }
  const candidateIssues: Array<{
    code: string;
    runId: string;
    message: string;
    nextCommand: string;
  }> = [];
  const preflight = [...run.actions]
    .reverse()
    .find((action) => action.stepId === 'archive.prepare');
  const state = parseNativePortableState(run.state);
  const candidateId = state.builder_handoff?.candidate_id;
  const currentCheck = [...run.actions]
    .reverse()
    .find(
      (action) =>
        candidateId &&
        ['verify.checks', 'verify.requested-checks'].includes(action.stepId) &&
        action.status === 'succeeded' &&
        (action.outcome?.output as { candidateId?: unknown } | undefined)?.candidateId ===
          candidateId,
    );
  const failedCandidateCapture =
    (currentCheck?.outcome?.output as { candidateInputFingerprintGate?: unknown } | undefined)
      ?.candidateInputFingerprintGate === null;
  if (
    failedCandidateCapture ||
    (state.phase === 'archive' &&
      preflight &&
      ['pending', 'failed'].includes(preflight.status) &&
      !run.actions
        .slice(run.actions.indexOf(preflight) + 1)
        .some(
          (action) =>
            ['build.builder', 'verify.checks', 'verify.requested-checks'].includes(action.stepId) &&
            action.status === 'succeeded',
        ))
  ) {
    try {
      await assertNativeSdkCandidateUnchanged({ run, projectRoot, requireEvidence: true });
    } catch (error) {
      candidateIssues.push({
        code: failedCandidateCapture
          ? 'native-check-candidate-unavailable'
          : 'native-archive-candidate-unavailable',
        runId: run.runId,
        message: (error as Error).message,
        nextCommand: `comet native status ${run.runId} --json`,
      });
    }
    if (preflight?.status === 'failed' && candidateIssues.length === 0) {
      const output = preflight.outcome?.output as { message?: string; reason?: string } | undefined;
      candidateIssues.push({
        code: 'native-archive-preflight-blocked',
        runId: run.runId,
        message: output?.message ?? 'Native Archive 预检未通过，请核对原 Action',
        nextCommand: `comet native status ${run.runId} --json`,
      });
    }
  }
  const issues = [
    ...(!parseNativePortableState(run.state).archived &&
    parseNativePortableState(run.state).workspace.change_branch &&
    inspectGitWorktree(projectRoot).currentBranch !==
      parseNativePortableState(run.state).workspace.change_branch
      ? [
          {
            code: 'native-workspace-branch-mismatch',
            runId: run.runId,
            message: '当前分支与原 Run 绑定不一致；切回原分支，或确认接管并核对原执行已结束。',
            nextCommand: `comet native select ${run.runId} --rebind --json`,
          },
        ]
      : []),
    ...candidateIssues,
    ...(!storageSettled
      ? [
          {
            code: disposition === 'missing' ? 'storage-run-missing' : 'storage-transaction-pending',
            runId: run.runId,
            message: `Native 存储状态为 ${disposition}，尚未完成核对或收尾`,
            nextCommand: `comet native doctor ${run.runId} --repair --json`,
          },
        ]
      : []),
    ...missingStops.map((item) => ({
      code: 'native-execution-stop-unconfirmed',
      runId: run.runId,
      actionId: item.actionId,
      message: item.reason ?? '释放工作区前，必须核验并持久化原执行的停止事实',
      nextCommand: `comet native doctor ${run.runId} --repair --json`,
    })),
    ...unknown.map((action) => ({
      code: 'native-execution-outcome-unresolved',
      runId: run.runId,
      actionId: action.id,
      message: '原执行结果尚未核对，不能重放执行',
      nextCommand: `comet native doctor ${run.runId} --json`,
    })),
    ...recoveries.map((item) => ({
      code: 'native-execution-recovery-required',
      runId: run.runId,
      actionId: item.actionId,
      message: item.reason ?? '原受管执行记录尚未与权威结果核对',
      nextCommand: `comet native doctor ${run.runId} --repair --json`,
    })),
    ...(cancelledArchive
      ? [
          {
            code: 'native-cancelled-archive-finalization-unresolved',
            runId: run.runId,
            message: '已取消的归档仍保留未核对的原收据，需要恢复历史事务收尾',
            nextCommand: `comet native archive ${run.runId} --recover --json`,
          },
        ]
      : []),
  ];
  return {
    stateReadable: true,
    executionReconciled:
      missingStops.length === 0 && unknown.length === 0 && recoveries.length === 0,
    storageSettled,
    healthy: issues.length === 0,
    issues,
  };
}
