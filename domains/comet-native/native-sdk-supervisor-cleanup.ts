import path from 'node:path';

import {
  inspectGitWorktree,
  listGitWorktreeRoots,
  resolveGitRef,
  samePath,
} from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';
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
  nativeSupervisorChildWorktree,
  nativeSupervisorIntegrationBranch,
  nativeSupervisorIntegrationWorktree,
} from './native-supervisor-workspace.js';
import { nativeWorkspaceIsClean, removeNativeWorkspaceConfig } from './native-workspace-config.js';

interface CleanupCandidate {
  root: string;
  branch: string;
}

interface CleanupBinding {
  projectRoot: string;
  targetRoot: string;
  targetBranch: string;
  targetCommit: string;
  candidates: CleanupCandidate[];
}

function outputOf(run: Readonly<WorkflowRun>, stepId: string): Record<string, unknown> | null {
  const action = [...run.actions]
    .reverse()
    .find((item) => item.stepId === stepId && item.status === 'succeeded');
  const output = action?.outcome?.output;
  return output && typeof output === 'object' && !Array.isArray(output)
    ? (output as Record<string, unknown>)
    : null;
}

function localBranchExists(projectRoot: string, branch: string): boolean {
  try {
    runGitCommand(projectRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`));
}

function assertDeliveredTarget(binding: CleanupBinding): void {
  if (
    inspectGitWorktree(binding.targetRoot).currentBranch !== binding.targetBranch ||
    resolveGitRef(binding.targetRoot, binding.targetBranch) !== binding.targetCommit
  ) {
    throw new Error('Native SDK Supervisor target branch changed during cleanup');
  }
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
    !state.children_contract_hash ||
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
  const prepared = outputOf(run, 'supervisor.prepare');
  const integrationRoot = nativeSupervisorIntegrationWorktree(projectRoot, state.name);
  const integrationBranch = nativeSupervisorIntegrationBranch(state.name);
  if (
    !prepared ||
    prepared.contractHash !== state.children_contract_hash ||
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
      receipt.contractHash !== state.children_contract_hash ||
      !samePath(
        receipt.worktree,
        nativeSupervisorChildWorktree(projectRoot, state.name, receipt.child),
      ) ||
      receipt.branch !== `comet/supervisor/${state.name}/${receipt.child}`
    ) {
      throw new Error('Native SDK Supervisor cleanup has a mismatched Child receipt');
    }
    children.set(receipt.child, { root: receipt.worktree, branch: receipt.branch });
  }
  if (children.size === 0) {
    throw new Error('Native SDK Supervisor cleanup has no prepared Children');
  }
  return {
    projectRoot,
    targetRoot: delivery.targetRoot,
    targetBranch: delivery.targetBranch,
    targetCommit: delivery.targetCommit,
    candidates: [...children.values(), { root: integrationRoot, branch: integrationBranch }],
  };
}

function preflightCleanup(binding: CleanupBinding): void {
  assertDeliveredTarget(binding);
  const registered = listGitWorktreeRoots(binding.projectRoot);
  for (const candidate of binding.candidates) {
    if (registered.some((root) => samePath(root, candidate.root))) {
      if (containsPath(candidate.root, process.cwd())) {
        throw new Error(
          `Native SDK Supervisor cannot clean the current worktree: ${candidate.root}`,
        );
      }
      if (
        inspectGitWorktree(candidate.root).currentBranch !== candidate.branch ||
        !nativeWorkspaceIsClean(candidate.root)
      ) {
        throw new Error(
          `Native SDK Supervisor cleanup found a changed worktree: ${candidate.root}`,
        );
      }
    }
    if (localBranchExists(binding.projectRoot, candidate.branch)) {
      try {
        runGitCommand(binding.projectRoot, [
          'merge-base',
          '--is-ancestor',
          candidate.branch,
          binding.targetCommit,
        ]);
      } catch {
        throw new Error(
          `Native SDK Supervisor cleanup found an unintegrated branch: ${candidate.branch}`,
        );
      }
    }
  }
}

function cleanupComplete(binding: CleanupBinding): boolean {
  const registered = listGitWorktreeRoots(binding.projectRoot);
  return binding.candidates.every(
    (candidate) =>
      !registered.some((root) => samePath(root, candidate.root)) &&
      !localBranchExists(binding.projectRoot, candidate.branch),
  );
}

async function executeCleanup(binding: CleanupBinding): Promise<void> {
  preflightCleanup(binding);
  for (const candidate of binding.candidates) {
    assertDeliveredTarget(binding);
    if (!listGitWorktreeRoots(binding.projectRoot).some((root) => samePath(root, candidate.root))) {
      continue;
    }
    await removeNativeWorkspaceConfig(candidate.root);
    runGitCommand(binding.projectRoot, ['worktree', 'remove', candidate.root]);
  }
  for (const candidate of binding.candidates) {
    assertDeliveredTarget(binding);
    if (localBranchExists(binding.projectRoot, candidate.branch)) {
      runGitCommand(binding.targetRoot, ['branch', '-d', candidate.branch]);
    }
  }
  if (!cleanupComplete(binding)) {
    throw new Error('Native SDK Supervisor cleanup did not remove every temporary worktree');
  }
}

function cleanupOutput(binding: CleanupBinding) {
  return { targetBranch: binding.targetBranch, targetCommit: binding.targetCommit };
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
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
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
