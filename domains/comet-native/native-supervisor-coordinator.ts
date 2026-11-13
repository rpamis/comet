import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  inspectGitWorktree,
  listGitWorktreeRoots,
  resolveGitRef,
} from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';
import type { NativeChildrenContract } from './native-children-contract.js';
import { DEFAULT_NATIVE_MAX_PARALLEL_CHILDREN, readProjectConfig } from './native-config.js';
import { withNativeMutation } from './native-mutation.js';
import {
  cloneState,
  createNativeSupervisorState,
  createNativeSupervisorTask,
  recordEvent,
  type NativeSupervisorState,
  type NativeSupervisorTask,
} from './native-supervisor-model.js';
import {
  readNativeSupervisorState,
  writeNativeSupervisorState,
} from './native-supervisor-state.js';
import type { NativeProjectPaths } from './native-types.js';
import type { PreparedNativeWorkspace } from './native-workspace-preparation.js';
/**
 * Reconstruct a Supervisor state when the machine-only runtime file was lost.
 * Git can prove the integration branch/worktree, but without portable Child
 * verification evidence it must not invent `verified` or `integrated` facts.
 */
import {
  assertNativeSupervisorIntegrationWorkspace,
  assertNativeSupervisorVerifierWorkspace,
  nativeSupervisorIntegrationBranch,
  prepareNativeSupervisorChildWorkspace,
  refreshNativeSupervisorBuilderWorkspace,
} from './native-supervisor-workspace.js';
export async function rebuildNativeSupervisorStateFromFacts(options: {
  paths: NativeProjectPaths;
  parent: string;
  targetBranch: string;
  contract: NativeChildrenContract;
}): Promise<NativeSupervisorState | null> {
  const integrationBranch = nativeSupervisorIntegrationBranch(options.parent);
  const integrationHead = resolveGitRef(options.paths.projectRoot, integrationBranch);
  if (!integrationHead) return null;
  const targetCommit = resolveGitRef(options.paths.projectRoot, options.targetBranch);
  if (!targetCommit) return null;
  const integrationWorktree = listGitWorktreeRoots(options.paths.projectRoot)
    .map((root) => path.resolve(root))
    .find((root) => inspectGitWorktree(root).currentBranch === integrationBranch);
  if (!integrationWorktree) return null;
  const state = createNativeSupervisorState({
    parent: options.parent,
    targetBranch: options.targetBranch,
    targetCommit,
    integrationBranch,
    integrationWorktree,
    contract: options.contract,
  });
  if (integrationHead !== targetCommit) {
    for (const child of state.children) {
      // Git can prove only the integration branch. Without a portable Child
      // candidate there is nothing safe to reverify; expose an explicit
      // blocker instead of creating a needs-reverify state that can never be
      // dispatched.
      child.status = child.dependsOn.length === 0 ? 'blocked' : 'pending';
      child.blocker =
        child.status === 'blocked'
          ? 'Supervisor Runtime was lost; portable Child verification evidence is required.'
          : null;
    }
    state.integration.headCommit = integrationHead;
  }
  recordEvent(state, {
    kind: 'delivery-reconciled',
    child: null,
    runId: null,
    summary: 'Supervisor state rebuilt from Git worktree facts',
  });
  return state;
}

export async function dispatchNativeSupervisorReadyTasks(options: {
  paths: NativeProjectPaths;
  parent: string;
  maxParallel?: number;
}): Promise<{ state: NativeSupervisorState; tasks: NativeSupervisorTask[] }> {
  return withNativeMutation(options.paths, async () => {
    const state = await readNativeSupervisorState(options.paths, options.parent);
    if (!state) throw new Error(`Native Supervisor state is missing for ${options.parent}`);
    const sourceConfig = await readProjectConfig(options.paths.projectRoot);
    const maxParallel =
      options.maxParallel ??
      sourceConfig?.native.max_parallel_children ??
      DEFAULT_NATIVE_MAX_PARALLEL_CHILDREN;
    if (!Number.isSafeInteger(maxParallel) || maxParallel < 1) {
      throw new Error('Native Supervisor maxParallel must be a positive integer');
    }
    const activeTasks = state.children.filter(({ task }) => task !== null).length;
    const capacity = Math.max(0, maxParallel - activeTasks);
    if (capacity === 0) return { state, tasks: [] };
    let next = state;
    const tasks: NativeSupervisorTask[] = [];
    let stateChanged = false;
    for (const child of state.children) {
      if (tasks.length >= capacity) break;
      if (child.task !== null) continue;
      const reverify = child.status === 'needs-reverify' && child.candidateCommit !== null;
      if (child.status !== 'ready' && !reverify) continue;
      let workspace: PreparedNativeWorkspace;
      try {
        workspace = await prepareNativeSupervisorChildWorkspace({
          projectRoot: options.paths.projectRoot,
          parent: state.parent,
          child: child.name,
          targetBranch: state.integration.branch,
          sourceConfig,
        });
        if (!reverify) {
          refreshNativeSupervisorBuilderWorkspace(
            workspace.projectRoot,
            `comet/supervisor/${state.parent}/${child.name}`,
            state.integration.headCommit,
          );
        } else {
          assertNativeSupervisorVerifierWorkspace(
            workspace.projectRoot,
            `comet/supervisor/${state.parent}/${child.name}`,
            child.candidateCommit!,
          );
        }
      } catch (error) {
        const blocked = cloneState(next);
        const blockedChild = blocked.children.find(({ name }) => name === child.name);
        if (blockedChild) {
          blockedChild.blocker = (error as Error).message;
          recordEvent(blocked, {
            kind: 'task-blocked',
            child: child.name,
            runId: null,
            summary: blockedChild.blocker,
          });
          blocked.stateVersion += 1;
          next = blocked;
          stateChanged = true;
        }
        continue;
      }
      const created = createNativeSupervisorTask(next, {
        role: reverify ? 'verifier' : 'builder',
        child: child.name,
        projectRoot: workspace.projectRoot,
        runId: randomUUID(),
      });
      next = created.state;
      tasks.push(created.task);
    }
    if (tasks.length > 0 || stateChanged) await writeNativeSupervisorState(options.paths, next);
    return { state: next, tasks };
  });
}

export function advanceNativeSupervisorIntegrationHead(
  state: NativeSupervisorState,
): NativeSupervisorState {
  const workspaceHead = assertNativeSupervisorIntegrationWorkspace(state);
  const targetCommit = resolveGitRef(state.integration.worktree, state.integration.targetBranch);
  if (!targetCommit) throw new Error('Native Supervisor target branch has no commit');
  try {
    runGitCommand(state.integration.worktree, [
      'merge-base',
      '--is-ancestor',
      targetCommit,
      workspaceHead,
    ]);
  } catch {
    throw new Error(
      'Native Supervisor target branch drift requires Agent integration and fresh verification',
    );
  }
  if (
    workspaceHead === state.integration.headCommit &&
    targetCommit === state.integration.targetCommit
  )
    return state;
  try {
    runGitCommand(state.integration.worktree, [
      'merge-base',
      '--is-ancestor',
      state.integration.headCommit,
      workspaceHead,
    ]);
  } catch {
    throw new Error(
      'Native Supervisor integration head is not a descendant of the recorded integration head',
    );
  }
  const reconciled = cloneState(state);
  reconciled.integration.headCommit = workspaceHead;
  reconciled.integration.targetCommit = targetCommit;
  recordEvent(reconciled, {
    kind: 'integration-head-reconciled',
    child: null,
    runId: null,
    summary: 'Parent-level commits were included in final verification',
  });
  reconciled.stateVersion += 1;
  return reconciled;
}
