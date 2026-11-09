import { inspectGitWorktree, resolveGitRef, samePath } from '../../platform/paths/git-worktree.js';
import { gitWorktreeIsClean } from '../../platform/process/git.js';
import {
  hashRuntimeValue,
  type CreateRuntimeOptions,
  type WorkflowRun,
} from '../engine/runtime.js';
import { nativeSupervisorContractRef } from './native-children-contract.js';
import { parseNativePortableState } from './native-portable-state.js';
import { nativeSdkSupervisorChildCheckSummaries } from './native-sdk-checks.js';
import { currentNativeSdkSupervisorActions } from './native-sdk-supervisor-plan.js';

/** 只解释原 blocked 结果；后继修复提交需要由新 Builder 回交并重新检查。 */
export async function inspectNativeSdkSupervisorRecovery(
  run: Readonly<WorkflowRun>,
  projectRoot: string,
): Promise<{ actionId: string; attempt: number; proposalHash: string } | null> {
  const state = parseNativePortableState(run.state);
  if (
    run.workflow.id !== 'comet-native' ||
    run.workflow.version !== '1' ||
    run.status !== 'completed' ||
    state.phase !== 'build' ||
    state.status !== 'active' ||
    state.archived ||
    !state.children_contract_ref ||
    run.actions.some((action) => ['pending', 'running', 'unknown'].includes(action.status)) ||
    run.waits.some((wait) => wait.status === 'pending') ||
    run.evidenceWaits?.some((wait) => wait.status === 'pending')
  )
    return null;
  const action = currentNativeSdkSupervisorActions(run).at(-1);
  const output = action?.outcome?.output as { verdict?: string; candidateCommit?: string } | null;
  const activation = (action?.input as { activation?: Record<string, unknown> } | undefined)
    ?.activation;
  if (
    !action ||
    action.stepId !== 'supervisor.child.verifier' ||
    action.status !== 'succeeded' ||
    action.outcome?.status !== 'succeeded' ||
    output?.verdict !== 'blocked' ||
    !activation ||
    nativeSupervisorContractRef(activation) !== state.children_contract_ref ||
    typeof activation.worktree !== 'string' ||
    typeof activation.branch !== 'string' ||
    typeof activation.checkActionId !== 'string' ||
    typeof activation.builderSessionId !== 'string' ||
    !action.claim?.sessionId ||
    action.claim.sessionId === activation.builderSessionId ||
    output.candidateCommit !== activation.candidateCommit
  )
    return null;

  const confirmed = run.outputs['shape.revalidate']?.value as
    { formalHash?: string; children?: { hash: string } | null } | undefined;
  if (!confirmed?.children) throw new Error('Native blocked 恢复缺少原已批准的子任务方案');
  const checked = await nativeSdkSupervisorChildCheckSummaries({
    run,
    checkActionId: activation.checkActionId,
    projectRoot,
    allowCandidateSuccessor: true,
  });
  const worktree = inspectGitWorktree(activation.worktree);
  if (
    checked.child !== activation.child ||
    checked.candidateCommit !== output.candidateCommit ||
    !worktree.primaryWorktreeRoot ||
    !samePath(worktree.primaryWorktreeRoot, projectRoot) ||
    !gitWorktreeIsClean(activation.worktree)
  )
    throw new Error('Native blocked 恢复的原候选、检查或工作区已变化');
  const currentCommit = resolveGitRef(activation.worktree, activation.branch);
  const checkAction = run.actions.find((item) => item.id === activation.checkActionId)!;
  return {
    actionId: action.id,
    attempt: action.attempt,
    proposalHash: hashRuntimeValue({
      runId: run.runId,
      revision: run.revision,
      stateVersion: state.state_version,
      actionId: action.id,
      inputHash: action.inputHash,
      outcome: action.outcome,
      checkActionId: checkAction.id,
      checkInputHash: checkAction.inputHash,
      checkOutcomeId: checkAction.outcome!.outcomeId,
      contractRef: state.children_contract_ref,
      currentCommit,
    }),
  };
}

export const validateNativeSdkSupervisorRecovery: NonNullable<
  CreateRuntimeOptions['validateRecovery']
> = async ({ run, action, context, proposalHash }) => {
  try {
    if (!context?.projectRoot)
      return { accepted: false, reason: 'Native blocked 恢复缺少实际项目' };
    const recovery = await inspectNativeSdkSupervisorRecovery(run, context.projectRoot);
    return {
      accepted: recovery?.actionId === action.id && recovery.proposalHash === proposalHash,
      reason: '当前结果不是可恢复的 Native Child blocked 现场',
    };
  } catch (error) {
    return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
  }
};
