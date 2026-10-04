import { inspectGitWorktree, resolveGitRef, samePath } from '../../platform/paths/git-worktree.js';
import type { WorkflowRun } from '../engine/runtime.js';
import { parseNativePortableState } from './native-portable-state.js';
import {
  nativeSupervisorChildWorktree,
  nativeSupervisorIntegrationBranch,
  nativeSupervisorIntegrationWorktree,
} from './native-supervisor-workspace.js';

export type NativeSupervisorRevisionWorkspace = {
  kind: 'integration' | 'child';
  child: string | null;
  worktree: string;
  branch: string;
  head: string;
};

/** 修订 Action 真实读取已准备的 Git 工作区，供重新确认后的准备步骤重新绑定。 */
export function collectNativeSupervisorRevisionWorkspaces(
  run: Readonly<WorkflowRun>,
  projectRoot: string,
): NativeSupervisorRevisionWorkspace[] {
  const state = parseNativePortableState(run.state);
  const workspaces = new Map<string, NativeSupervisorRevisionWorkspace>();
  // 恢复绑定包含历史中已经准备过的工作区；本轮尚未重做的 Child 也要保留。
  for (const action of run.actions) {
    if (action.status !== 'succeeded') continue;
    const output = action.outcome?.output as Record<string, unknown> | null;
    if (action.stepId === 'supervisor.prepare') {
      const worktree = nativeSupervisorIntegrationWorktree(projectRoot, state.name);
      const branch = nativeSupervisorIntegrationBranch(state.name);
      if (
        typeof output?.integrationWorktree !== 'string' ||
        !samePath(output.integrationWorktree, worktree) ||
        output.integrationBranch !== branch
      )
        throw new Error('Native 需求修订的集成工作区归属不一致');
      workspaces.set(branch, { kind: 'integration', child: null, worktree, branch, head: '' });
    }
    if (action.stepId === 'supervisor.child.prepare') {
      if (typeof output?.child !== 'string') throw new Error('Native 需求修订缺少 Child 归属');
      const child = output.child;
      const worktree = nativeSupervisorChildWorktree(projectRoot, state.name, child);
      const branch = `comet/supervisor/${state.name}/${child}`;
      if (
        typeof output.worktree !== 'string' ||
        !samePath(output.worktree, worktree) ||
        output.branch !== branch
      )
        throw new Error('Native 需求修订的 Child 工作区归属不一致');
      workspaces.set(branch, { kind: 'child', child, worktree, branch, head: '' });
    }
  }
  return [...workspaces.values()].map((workspace) => {
    const actual = inspectGitWorktree(workspace.worktree);
    const head = resolveGitRef(workspace.worktree, workspace.branch);
    if (
      actual.currentBranch !== workspace.branch ||
      !actual.primaryWorktreeRoot ||
      !samePath(actual.primaryWorktreeRoot, projectRoot) ||
      !head
    )
      throw new Error('Native 需求修订的 Git 工作区身份已变化');
    return { ...workspace, head };
  });
}

/** 只解释原修订 Action 的已验证结果，不把旧检查恢复为本轮通过。 */
export function nativeSupervisorRevisionWorkspace(
  run: Readonly<WorkflowRun>,
  worktree: string,
  branch: string,
): NativeSupervisorRevisionWorkspace | null {
  const revision = [...run.actions]
    .reverse()
    .find((action) => action.stepId === 'shape.revise' && action.status === 'succeeded');
  const workspaces = (
    revision?.outcome?.output as { workspaces?: NativeSupervisorRevisionWorkspace[] } | null
  )?.workspaces;
  const workspace = workspaces?.find(
    (candidate) =>
      typeof candidate.worktree === 'string' &&
      samePath(candidate.worktree, worktree) &&
      candidate.branch === branch,
  );
  if (!workspace) return null;
  if (resolveGitRef(worktree, branch) !== workspace.head)
    throw new Error('Native 修订后保留的工作区提交已变化，请核对原现场');
  return workspace;
}
