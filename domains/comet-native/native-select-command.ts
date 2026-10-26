import { inspectGitWorktree, samePath } from '../../platform/paths/git-worktree.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { createNativeSdkStateStore } from './native-sdk-state-store.js';
import { parseNativePortableState } from './native-portable-state.js';
import type { WorkflowRun, RuntimeValue } from '../engine/runtime.js';
import { isNativeSdkRunRecoveryRequiredError } from './native-sdk-state-store.js';
import { resolveNativeChangeRuntimeOwner } from './native-runtime-ownership.js';
import {
  inspectDiscoveredNativeStatus,
  NativePristineSdkRunRecoverableError,
} from './native-status-discovery.js';
import { selectNativeChange } from './native-selection.js';
import {
  assertNoArguments,
  configuredPaths,
  requiredPositional,
  success,
  takeFlag,
  type DispatchResult,
} from './native-cli-shared.js';

/** 明确接管当前分支；只改变绑定，原执行和批准仍由同一个 Run 保存。 */
async function rebindNativeSdkWork(projectRoot: string, name: string): Promise<WorkflowRun> {
  const git = inspectGitWorktree(projectRoot);
  if (
    !git.currentBranch ||
    !git.currentWorktreeRoot ||
    !samePath(git.currentWorktreeRoot, projectRoot)
  )
    throw new Error(
      'Native rebind requires the checked-out branch in the original working directory',
    );
  const owner = await readSdkChangeOwner(projectRoot, 'native', name, { readOnly: true });
  if (owner?.application !== 'native' || owner.runId !== name)
    throw new Error('Native rebind requires the original built-in Native Run');
  const store = createNativeSdkStateStore(projectRoot, { allowBranchRebind: true });
  const run = await store.read(name);
  if (!run)
    throw new Error('Native rebind requires the original Run or its validated portable checkpoint');
  const state = parseNativePortableState(run.state);
  if (
    state.archived ||
    ['completed', 'cancelled'].includes(run.status) ||
    run.actions.some(
      (action) =>
        ['running', 'unknown'].includes(action.status) ||
        (action.status === 'cancelled' &&
          action.claim &&
          !action.cancellation &&
          !action.executionStop),
    )
  )
    throw new Error('Native rebind requires all original executions to have stopped and settled');
  if (state.workspace.change_branch === git.currentBranch) return run;
  if (
    state.children_contract_hash &&
    run.actions.some(
      (action) => action.stepId === 'supervisor.prepare' && action.status === 'succeeded',
    )
  )
    throw new Error(
      'Native Supervisor already owns integration worktrees; restore its recorded target branch or use native transfer for its active Child Build',
    );
  const nextState = parseNativePortableState({
    ...state,
    state_version: state.state_version + 1,
    workspace: {
      ...state.workspace,
      change_branch: git.currentBranch,
      target_branch:
        state.workspace.target_branch === state.workspace.change_branch
          ? git.currentBranch
          : state.workspace.target_branch,
    },
  });
  const next = { ...run, revision: run.revision + 1, state: nextState as unknown as RuntimeValue };
  if (inspectGitWorktree(projectRoot).currentBranch !== git.currentBranch)
    throw new Error('Git branch changed during Native rebind');
  if (!(await store.compareAndSwap(name, run.revision, next)))
    throw new Error('Native Run changed during rebind; read the current continuation');
  return next;
}

export async function nativeSelectCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const name = requiredPositional(args, 'change name');
  const rebind = takeFlag(args, '--rebind');
  assertNoArguments(args);
  await configuredPaths(projectRoot);
  if (rebind) await rebindNativeSdkWork(projectRoot, name);
  // The discovered projection carries the workspace that owns the change, so
  // selecting a worktree-bound change from the primary root routes both the
  // recorded selection and the caller into the right workspace (the compact
  // form dropped everything but the continuation).
  let executionCwd = projectRoot;
  const inspect = () =>
    inspectDiscoveredNativeStatus({
      projectRoot,
      name,
      onSelectedRoot: (selectedRoot) => {
        executionCwd = selectedRoot;
      },
    });
  let status;
  try {
    status = await inspect();
  } catch (error) {
    if (
      !(error instanceof NativePristineSdkRunRecoverableError) &&
      !isNativeSdkRunRecoveryRequiredError(error)
    )
      throw error;
    const owner = await resolveNativeChangeRuntimeOwner(
      (await configuredPaths(error.projectRoot)).paths,
      name,
    );
    if (owner?.format !== 'sdk') throw error;
    status = await inspect();
  }
  await selectNativeChange((await configuredPaths(executionCwd)).paths, name);
  return {
    ...success('select', { selected: name, ...status }),
    executionCwd,
  };
}
