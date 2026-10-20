import type { WorkflowRun } from '../engine/runtime.js';
/** 取消调度不代表原宿主已停止；领取过的取消动作需要原领取方的停止证明。 */
export function isClassicSdkCancellationComplete(run: WorkflowRun): boolean {
  return (
    run.status === 'cancelled' &&
    // 内置 Classic 不创建子 Run；未知扩展子任务不能在此推定已停止。
    run.children.length === 0 &&
    run.actions.every(
      (action) =>
        !['pending', 'running', 'unknown'].includes(action.status) &&
        !(
          action.status === 'cancelled' &&
          action.claim &&
          !action.cancellation &&
          !action.executionStop
        ),
    ) &&
    run.waits.every((wait) => wait.status !== 'pending') &&
    (run.evidenceWaits ?? []).every((wait) => wait.status !== 'pending') &&
    run.ready.length === 0
  );
}
