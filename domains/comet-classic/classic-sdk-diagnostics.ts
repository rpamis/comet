import path from 'node:path';
import { createFileRuntimeStore, type WorkflowRun } from '../engine/runtime.js';
import { resolveWorkspaceRuntimeRootSync } from '../workflow-contract/workspace-runtime.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { readWorkflowApplicationStorageDisposition } from '../workflow-application/index.js';

/** 各只读入口共用的诊断；等待用户批准或正常执行不属于状态损坏。 */
export async function inspectClassicSdkRunDiagnostics(projectRoot: string, run: WorkflowRun) {
  const owner = await readSdkChangeOwner(projectRoot, 'classic', run.runId, { readOnly: true });
  const disposition =
    owner && !['classic-full', 'classic-hotfix', 'classic-tweak'].includes(owner.application)
      ? await readWorkflowApplicationStorageDisposition(projectRoot, owner.application, run.runId)
      : await createFileRuntimeStore<WorkflowRun>({
          rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs/classic'),
        }).readPartitionMetadata(run.runId);
  const storageSettled = ['active', 'closed'].includes(disposition);
  const unresolved = run.actions.filter(
    (action) =>
      action.status === 'unknown' ||
      (action.status === 'running' && (action.rejectedOutcomes?.length ?? 0) > 0) ||
      (action.status === 'cancelled' &&
        action.claim &&
        !action.cancellation &&
        !action.executionStop),
  );
  const issues = [
    ...(!storageSettled
      ? [
          {
            code: 'storage-transaction-pending',
            runId: run.runId,
            message: `Classic 存储状态为 ${disposition}，尚未完成核对或收尾`,
          },
        ]
      : []),
    ...unresolved.map((action) => ({
      code: 'classic-execution-unresolved',
      runId: run.runId,
      actionId: action.id,
      message: '原执行结果或停止事实尚未核对，不能重放执行',
    })),
  ];
  return {
    stateReadable: true,
    executionReconciled: unresolved.length === 0,
    storageSettled,
    healthy: issues.length === 0,
    issues,
  };
}
