import path from 'node:path';
import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';
import { createFileRuntimeStore, type WorkflowRun } from '../engine/runtime.js';
import { readWorkflowApplicationStorageDisposition } from '../workflow-application/application.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { resolveWorkspaceRuntimeRootSync } from '../workflow-contract/workspace-runtime.js';
import { parseNativePortableState } from './native-portable-state.js';
import { recoverCancelledNativeSdkArchive } from './native-sdk-archive.js';
import { inspectNativeSdkCancellation } from './native-sdk-cancellation.js';
/** 只读区分状态可读、执行核对和存储收尾；正常用户等待不是损坏。 */
export async function inspectNativeSdkRunDiagnostics(
  projectRoot: string,
  run: WorkflowRun,
  _options: object = {},
) {
  const owner = await readSdkChangeOwner(projectRoot, 'native', run.runId, { readOnly: true });
  const disposition =
    owner && owner.application !== 'native'
      ? await readWorkflowApplicationStorageDisposition(projectRoot, owner.application, run.runId)
      : await createFileRuntimeStore<WorkflowRun>({
          singleWriter: true,
          rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs/native'),
        }).readPartitionMetadata(run.runId);
  const storageSettled = ['active', 'closed'].includes(disposition);
  const unknown = run.actions.filter((action) => action.status === 'unknown');
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
  if (preflight?.status === 'failed')
    candidateIssues.push({
      code: 'native-archive-preflight-blocked',
      runId: run.runId,
      message:
        (
          preflight.outcome?.output as {
            message?: string;
          }
        )?.message ?? 'Native Archive 预检未通过，请核对原 Action',
      nextCommand: 'comet native status ' + run.runId + ' --json',
    });
  const cancellation =
    run.status === 'cancelled'
      ? await inspectNativeSdkCancellation({ projectRoot, run, ownerObservation: owner })
      : null;
  const closedCancellation =
    owner?.application === 'native' &&
    disposition === 'closed' &&
    cancellation?.status === 'cancelled';
  const state = parseNativePortableState(run.state);
  const issues = [
    ...(!closedCancellation &&
    !state.archived &&
    state.workspace.change_branch &&
    inspectGitWorktree(projectRoot).currentBranch !== state.workspace.change_branch
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
    ...(cancellation?.cleanupRequired
      ? [
          {
            code: 'sdk-cancellation-cleanup-pending',
            runId: run.runId,
            message: cancellation.cleanup?.reason ?? '原 Run 的业务取消尚未完成工作区收尾',
            nextCommand:
              cancellation.cleanup?.finishCommand ??
              `comet native doctor ${run.runId} --repair --json`,
          },
        ]
      : cancellation?.status === 'cancelling'
        ? [
            {
              code: 'sdk-cancellation-business-pending',
              runId: run.runId,
              message: '原 Run 仍有未核对结果的业务任务，请检查原任务后再完成取消',
              nextCommand: `comet native status ${run.runId} --details --json`,
            },
          ]
        : []),
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
    ...unknown.map((action) => ({
      code: 'native-execution-outcome-unresolved',
      runId: run.runId,
      actionId: action.id,
      message: '原执行结果尚未核对，不能重放执行',
      nextCommand:
        action.stepId === 'archive.finalize'
          ? `comet native archive ${run.runId} --recover --json`
          : `comet native status ${run.runId} --details --json`,
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
    executionReconciled: unknown.length === 0,
    storageSettled,
    healthy: issues.length === 0,
    issues,
  };
}
