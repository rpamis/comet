import {
  hashRuntimeValue,
  type RuntimeAction,
  type RuntimeValue,
  type WorkflowRun,
  type RuntimeWait,
} from '../engine/runtime.js';
import { nativeSupervisorContractRef } from './native-children-contract.js';
import { parseNativePortableState } from './native-portable-state.js';
import { currentNativeSdkSupervisorActions } from './native-sdk-supervisor-plan.js';
import { currentNativeSdkSupervisorPlan } from './native-sdk-supervisor-prepare.js';
/** 失败 Action 保持原 claim 和 outcome；重试创建新 Verifier，不改写成未执行。 */
export function nativeSdkFailedChildVerifierActivation(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
): Record<string, RuntimeValue> {
  const state = parseNativePortableState(run.state);
  const activation = (
    action.input as {
      activation?: Record<string, RuntimeValue>;
    }
  ).activation;
  if (
    state.phase !== 'build' ||
    state.archived ||
    !state.children_contract_ref ||
    action.stepId !== 'supervisor.child.verifier' ||
    action.status !== 'failed' ||
    action.outcome?.status !== 'failed' ||
    !action.claim ||
    !activation ||
    nativeSupervisorContractRef(activation, run) !== state.children_contract_ref ||
    typeof activation.child !== 'string' ||
    typeof activation.candidateCommit !== 'string' ||
    typeof activation.builderSessionId !== 'string' ||
    !currentNativeSdkSupervisorActions(run).some((candidate) => candidate.id === action.id)
  )
    throw new Error('Native Child Verifier recovery requires a known failed current execution');
  return { ...activation, failedVerifierActionId: action.id };
}
/** 只读核对同一候选、实际检查收据和当前 Shape，拒绝过期或被修改的证据。 */
export async function validateNativeSdkFailedChildVerifier(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
): Promise<void> {
  const activation = nativeSdkFailedChildVerifierActivation(run, action);
  const plan = await currentNativeSdkSupervisorPlan(run, projectRoot);
  if (!plan.contract.children.some((child) => child.name === activation.child))
    throw new Error('Native failed Child Verifier is outside the confirmed plan');
  return;
}
export function nativeSdkChildVerifierRetryWaits(run: Readonly<WorkflowRun>) {
  return run.waits.filter((wait) => {
    if (wait.status !== 'pending' || wait.stepId !== 'supervisor.child.verifier-retry')
      return false;
    const activation = (
      wait.proposal as {
        activation?: Record<string, RuntimeValue>;
      }
    ).activation;
    if (nativeSdkLegacyChildFailureForWait(run, wait)) return true;
    const action = run.actions.find((entry) => entry.id === activation?.failedVerifierActionId);
    return (
      action !== undefined &&
      hashRuntimeValue(nativeSdkFailedChildVerifierActivation(run, action)) ===
        hashRuntimeValue(activation)
    );
  });
}

/** 旧待决定事项只沿原失败结果读取；不创建新检查或停止收据。 */
export function nativeSdkLegacyChildFailureForWait(
  run: Readonly<WorkflowRun>,
  wait: Pick<RuntimeWait, 'results'>,
): RuntimeAction | undefined {
  return run.actions.find(
    (action) =>
      ['supervisor.child.checks', 'supervisor.child.integration-checks'].includes(action.stepId) &&
      action.status === 'failed' &&
      action.outcome?.status === 'failed' &&
      action.executionOrigin &&
      ['1', '2', '3'].includes(action.executionOrigin.workflow.version) &&
      run.actionContexts[action.id].sequence === wait.results[action.stepId]?.sequence,
  );
}
