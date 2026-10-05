import {
  hashRuntimeValue,
  type CreateRuntimeOptions,
  type WorkflowRun,
} from '../engine/runtime.js';
import { inspectGitWorktree, resolveGitRef, samePath } from '../../platform/paths/git-worktree.js';
import { gitWorktreeIsClean } from '../../platform/process/git.js';
import { parseNativePortableState } from './native-portable-state.js';
import { nativeProjectPaths } from './native-paths.js';
import {
  inspectNativePortableAcceptanceDrift,
  nativePortableShapeConfirmationHash,
} from './native-portable-requirements.js';
import { currentNativeSdkSupervisorActions } from './native-sdk-supervisor-plan.js';
import { nativeSdkSupervisorChildCheckSummaries } from './native-sdk-checks.js';

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
    !state.children_contract_hash ||
    !state.shape_confirmation_hash ||
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
    activation.contractHash !== state.children_contract_hash ||
    typeof activation.worktree !== 'string' ||
    typeof activation.branch !== 'string' ||
    typeof activation.checkActionId !== 'string' ||
    typeof activation.builderSessionId !== 'string' ||
    !action.claim?.sessionId ||
    action.claim.sessionId === activation.builderSessionId ||
    output.candidateCommit !== activation.candidateCommit
  )
    return null;
  const input = run.input as { artifactRootRef: string };
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef);
  const confirmed = run.outputs['shape.revalidate']?.value as
    { formalHash?: string; children?: { hash: string } | null } | undefined;
  const drift = await inspectNativePortableAcceptanceDrift({ paths, state });
  if (
    !confirmed?.formalHash ||
    drift.drifted ||
    state.shape_confirmation_hash !==
      nativePortableShapeConfirmationHash({
        formalHash: confirmed.formalHash,
        childrenHash: confirmed.children?.hash ?? null,
        coordinationMode: state.coordination_mode,
      })
  )
    throw new Error('Native blocked 恢复的 Shape 确认已变化，请先核对需求');
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
      shapeHash: state.shape_confirmation_hash,
      contractHash: state.children_contract_hash,
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
