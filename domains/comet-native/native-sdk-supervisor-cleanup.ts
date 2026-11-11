import { nativeSupervisorContractRef } from './native-children-contract.js';

import {
  inspectGitWorktree,
  listGitWorktreeRoots,
  resolveGitRef,
  samePath,
} from '../../platform/paths/git-worktree.js';
import type {
  RuntimeAction,
  RuntimeExecutor,
  RuntimeValidator,
  WorkflowRun,
  WorkflowRuntime,
} from '../engine/runtime.js';
import { parseNativePortableState } from './native-portable-state.js';
import { currentNativeSdkSupervisorActions } from './native-sdk-supervisor-plan.js';
import {
  executeNativeSupervisorCleanup as executeCleanup,
  nativeSupervisorCleanupComplete as cleanupComplete,
  preflightNativeSupervisorCleanup as preflightCleanup,
  type NativeSupervisorCleanupBinding as CleanupBinding,
  type NativeSupervisorCleanupCandidate as CleanupCandidate,
  nativeSupervisorChildWorktree,
  nativeSupervisorIntegrationBranch,
  nativeSupervisorIntegrationWorktree,
} from './native-supervisor-workspace.js';

function outputOf(run: Readonly<WorkflowRun>, stepId: string): Record<string, unknown> | null {
  const action = [...run.actions]
    .reverse()
    .find((item) => item.stepId === stepId && item.status === 'succeeded');
  const output = action?.outcome?.output;
  return output && typeof output === 'object' && !Array.isArray(output)
    ? (output as Record<string, unknown>)
    : null;
}

function cleanupCandidates(
  run: Readonly<WorkflowRun>,
  projectRoot: string,
  state: ReturnType<typeof parseNativePortableState>,
): CleanupCandidate[] {
  const prepared = outputOf(run, 'supervisor.prepare');
  const integrationRoot = nativeSupervisorIntegrationWorktree(projectRoot, state.name);
  const integrationBranch = nativeSupervisorIntegrationBranch(state.name);
  if (
    !prepared ||
    nativeSupervisorContractRef(prepared, run) !== state.children_contract_ref ||
    typeof prepared.integrationWorktree !== 'string' ||
    !samePath(prepared.integrationWorktree, integrationRoot) ||
    prepared.integrationBranch !== integrationBranch
  ) {
    throw new Error('Native SDK Supervisor cleanup lacks its integration workspace');
  }
  const children = new Map<string, CleanupCandidate>();
  for (const item of currentNativeSdkSupervisorActions(run)) {
    if (item.stepId !== 'supervisor.child.prepare' || item.status !== 'succeeded') continue;
    const output = item.outcome?.output;
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      throw new Error('Native SDK Supervisor cleanup has an invalid Child receipt');
    }
    const receipt = output as Record<string, unknown>;
    if (
      typeof receipt.child !== 'string' ||
      typeof receipt.worktree !== 'string' ||
      nativeSupervisorContractRef(receipt, run) !== state.children_contract_ref ||
      !samePath(
        receipt.worktree,
        nativeSupervisorChildWorktree(projectRoot, state.name, receipt.child),
      ) ||
      receipt.branch !== `comet/supervisor/${state.name}/${receipt.child}`
    ) {
      throw new Error('Native SDK Supervisor cleanup has a mismatched Child receipt');
    }
    children.set(receipt.child, {
      root: receipt.worktree,
      branch: receipt.branch,
    });
  }
  if (children.size === 0) {
    throw new Error('Native SDK Supervisor cleanup has no prepared Children');
  }
  return [...children.values(), { root: integrationRoot, branch: integrationBranch }];
}

function cleanupBinding(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
): CleanupBinding {
  const state = parseNativePortableState(run.state);
  const delivery = outputOf(run, 'supervisor.parent.deliver');
  if (
    action.stepId !== 'supervisor.cleanup' ||
    state.status !== 'done' ||
    !state.archived ||
    !state.children_contract_ref ||
    !outputOf(run, 'archive.finalize') ||
    !delivery ||
    typeof delivery.targetRoot !== 'string' ||
    typeof delivery.targetBranch !== 'string' ||
    typeof delivery.targetCommit !== 'string' ||
    delivery.targetCommit !== delivery.integrationCommit ||
    !listGitWorktreeRoots(projectRoot).some((root) =>
      samePath(root, delivery.targetRoot as string),
    ) ||
    inspectGitWorktree(delivery.targetRoot).currentBranch !== delivery.targetBranch ||
    resolveGitRef(delivery.targetRoot, delivery.targetBranch) !== delivery.targetCommit
  ) {
    throw new Error('Native SDK Supervisor cleanup lacks the verified delivery');
  }
  return {
    projectRoot,
    targetRoot: delivery.targetRoot,
    targetBranch: delivery.targetBranch,
    targetCommit: delivery.targetCommit,
    candidates: cleanupCandidates(run, projectRoot, state),
  };
}

/** Preflight the exact temporary worktrees before delivery changes the user target. */
export function preflightNativeSdkSupervisorDeliveryCleanup(
  run: Readonly<WorkflowRun>,
  projectRoot: string,
  integrationCommit: string,
  state: ReturnType<typeof parseNativePortableState>,
): void {
  preflightCleanup({
    projectRoot,
    targetRoot: nativeSupervisorIntegrationWorktree(projectRoot, state.name),
    targetBranch: nativeSupervisorIntegrationBranch(state.name),
    targetCommit: integrationCommit,
    candidates: cleanupCandidates(run, projectRoot, state),
  });
}

function cleanupOutput(binding: CleanupBinding) {
  return {
    targetBranch: binding.targetBranch,
    targetCommit: binding.targetCommit,
  };
}

export const nativeSdkSupervisorCleanupExecutor: RuntimeExecutor = {
  id: 'native-supervisor-cleanup',
  capabilities: [],
  supports(action) {
    return action.stepId === 'supervisor.cleanup' && action.type === 'call_tool';
  },
  async execute(action, context, run) {
    if (!context?.projectRoot || !run || !this.supports(action)) {
      throw new Error('Native SDK Supervisor cleanup requires a bound Run and project');
    }
    const binding = cleanupBinding(run, action, context.projectRoot);
    await executeCleanup(binding);
    return { status: 'succeeded', output: cleanupOutput(binding) };
  },
};

export const nativeSdkSupervisorCleanupValidator: RuntimeValidator = {
  id: 'native-supervisor-cleanup-outcome',
  version: '1',
  validate({ run, action, outcome, context }) {
    if (
      !context?.projectRoot ||
      action.claim?.executorId !== nativeSdkSupervisorCleanupExecutor.id ||
      outcome.status !== 'succeeded'
    ) {
      return {
        accepted: false,
        reason: 'Native SDK Supervisor cleanup was not executed by Runtime',
      };
    }
    try {
      const binding = cleanupBinding(run, action, context.projectRoot);
      const output = outcome.output as Record<string, unknown> | null;
      if (
        !output ||
        output.targetBranch !== binding.targetBranch ||
        output.targetCommit !== binding.targetCommit ||
        !cleanupComplete(binding)
      ) {
        throw new Error('Native SDK Supervisor cleanup outcome does not match the worktrees');
      }
      return { accepted: true };
    } catch (error) {
      return {
        accepted: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/** Continue the original cleanup Action after confirming that its host was lost. */
export async function recoverNativeSdkSupervisorCleanupOutcome(options: {
  runtime: WorkflowRuntime;
  runId: string;
  projectRoot: string;
}): Promise<WorkflowRun> {
  const run = await options.runtime.inspect(options.runId);
  const action = [...run.actions]
    .reverse()
    .find((item) => item.stepId === 'supervisor.cleanup' && item.status === 'unknown');
  if (!action?.claim || action.claim.executorId !== nativeSdkSupervisorCleanupExecutor.id) {
    throw new Error('Native SDK Supervisor has no lost cleanup Action to recover');
  }
  const binding = cleanupBinding(run, action, options.projectRoot);
  await executeCleanup(binding);
  return options.runtime.recordOutcome({
    runId: run.runId,
    context: {
      requestId: `native-sdk-supervisor-cleanup-recovery:${run.runId}:${action.id}`,
      projectRoot: options.projectRoot,
    },
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: action.claim.token,
      outcomeId: `${action.id}:${action.attempt}:executor-result`,
      status: 'succeeded',
      output: cleanupOutput(binding),
    },
  });
}
