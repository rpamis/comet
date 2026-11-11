import {
  defineWorkflow,
  hashRuntimeValue,
  type DefineWorkflowOptions,
  type WorkflowRun,
} from '../engine/runtime.js';
export function nativeSdkRecoverableFailureReason(reason: string | undefined): boolean {
  return [
    'archive.prepare',
    'archive.execute',
    'supervisor.child.verifier',
    'supervisor.child.integration-repair',
  ].some((step) => reason === 'ACTION_FAILED: ' + step);
}
/** 当前定义身份使用 SDK 自身的协议计算，不保留旧执行定义或额外缓存。 */
export function nativeSdkMatchesRun(
  workflow: DefineWorkflowOptions,
  run: Pick<WorkflowRun, 'workflow'> | null | undefined,
) {
  return run?.workflow.hash === hashRuntimeValue(defineWorkflow(workflow));
}
