import type { RuntimeAction, WorkflowRun } from '../engine/runtime.js';
export function isUnresolvedClassicArchiveAction(action: Readonly<RuntimeAction>): boolean {
  return (
    action.ref === 'classic-archive' &&
    (action.status === 'running' ||
      action.status === 'unknown' ||
      (action.status === 'cancelled' && !!action.claim && !action.outcome))
  );
}
/** 普通任务由 Agent 平台取消；这里只保留未完成的业务归档及子 Run 约束。 */
export function isClassicSdkCancellationComplete(run: WorkflowRun): boolean {
  return (
    run.status === 'cancelled' &&
    // 内置 Classic 不创建子 Run；未知扩展子任务不能推定业务已结束。
    run.children.length === 0 &&
    run.actions.every(
      (action) =>
        !['pending', 'running', 'unknown'].includes(action.status) &&
        !isUnresolvedClassicArchiveAction(action),
    ) &&
    run.waits.every((wait) => wait.status !== 'pending') &&
    (run.evidenceWaits ?? []).every((wait) => wait.status !== 'pending') &&
    run.ready.length === 0
  );
}
