import type { NativePortableState } from './native-portable-types.js';
import path from 'node:path';
import {
  inspectGitWorktree,
  listGitWorktreeRoots,
  resolveGitRef,
  samePath,
} from '../../platform/paths/git-worktree.js';
import { resolvePortablePath } from '../../platform/paths/portable-path.js';
import { runGitCommand } from '../../platform/process/git.js';
import { cloneState, recordEvent, type NativeSupervisorState } from './native-supervisor-model.js';
import {
  readNativeSupervisorState,
  writeNativeSupervisorState,
} from './native-supervisor-state.js';
import type { CometProjectConfig, NativeProjectPaths } from './native-types.js';
import { nativeWorkspaceIsClean, removeNativeWorkspaceConfig } from './native-workspace-config.js';
import {
  prepareNativeWorkspace,
  type PreparedNativeWorkspace,
} from './native-workspace-preparation.js';
export function nativeSupervisorIntegrationBranch(parent: string): string {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(parent)) {
    throw new Error(`Invalid Native Supervisor parent name: ${parent}`);
  }
  return `comet/supervisor/${parent}/integration`;
}
export function nativeSupervisorIntegrationWorktree(projectRoot: string, parent: string): string {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(parent)) {
    throw new Error(`Invalid Native Supervisor parent name: ${parent}`);
  }
  return resolvePortablePath(projectRoot, '.worktrees', `${parent}-integration`);
}
export function nativeSupervisorChildWorktree(
  projectRoot: string,
  parent: string,
  child: string,
): string {
  if (
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(parent) ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(child)
  ) {
    throw new Error('Native Supervisor parent and child names are invalid');
  }
  return resolvePortablePath(projectRoot, '.worktrees', `${parent}-${child}`);
}
export async function prepareNativeSupervisorIntegrationWorkspace(options: {
  projectRoot: string;
  parent: string;
  targetBranch: string;
  sourceConfig: CometProjectConfig | null;
}): Promise<PreparedNativeWorkspace> {
  const worktreePath = path.join('.worktrees', `${options.parent}-integration`);
  return prepareNativeWorkspace({
    projectRoot: options.projectRoot,
    name: `${options.parent}-integration`,
    isolation: 'worktree',
    changeBranch: nativeSupervisorIntegrationBranch(options.parent),
    targetBranch: options.targetBranch,
    worktreePath,
    sourceConfig: options.sourceConfig,
  });
}
export async function prepareNativeSupervisorChildWorkspace(options: {
  projectRoot: string;
  parent: string;
  child: string;
  targetBranch: string;
  sourceConfig: CometProjectConfig | null;
}): Promise<PreparedNativeWorkspace> {
  if (
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(options.parent) ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(options.child)
  ) {
    throw new Error('Native Supervisor parent and child names are invalid');
  }
  return prepareNativeWorkspace({
    projectRoot: options.projectRoot,
    name: `${options.parent}-${options.child}`,
    isolation: 'worktree',
    changeBranch: `comet/supervisor/${options.parent}/${options.child}`,
    targetBranch: options.targetBranch,
    worktreePath: path.join('.worktrees', `${options.parent}-${options.child}`),
    sourceConfig: options.sourceConfig,
  });
}
export function refreshNativeSupervisorBuilderWorkspace(
  workspaceRoot: string,
  expectedBranch: string,
  integrationHead: string,
): void {
  const identity = inspectGitWorktree(workspaceRoot);
  if (!identity.isGitWorktree || identity.currentBranch !== expectedBranch) {
    throw new Error(`Native Supervisor child worktree identity is not ${expectedBranch}`);
  }
  if (!nativeWorkspaceIsClean(workspaceRoot)) {
    throw new Error(`Native Supervisor child worktree is not clean: ${workspaceRoot}`);
  }
  const currentHead = runGitCommand(workspaceRoot, ['rev-parse', 'HEAD']);
  if (currentHead === integrationHead) return;
  const integrationContainsCurrent = (() => {
    try {
      runGitCommand(workspaceRoot, ['merge-base', '--is-ancestor', currentHead, integrationHead]);
      return true;
    } catch {
      return false;
    }
  })();
  if (!integrationContainsCurrent) {
    throw new Error(
      `Native Supervisor child worktree ${workspaceRoot} cannot be refreshed from integration HEAD`,
    );
  }
  const childContainsIntegration = (() => {
    try {
      runGitCommand(workspaceRoot, ['merge-base', '--is-ancestor', integrationHead, currentHead]);
      return true;
    } catch {
      return false;
    }
  })();
  if (childContainsIntegration) {
    throw new Error(
      `Native Supervisor child worktree ${workspaceRoot} contains unintegrated commits`,
    );
  }
  runGitCommand(workspaceRoot, ['merge', '--ff-only', integrationHead]);
  const refreshedHead = runGitCommand(workspaceRoot, ['rev-parse', 'HEAD']);
  if (refreshedHead !== integrationHead) {
    throw new Error(`Native Supervisor child worktree did not reach integration HEAD`);
  }
}
export function assertNativeSupervisorIntegrationWorkspace(state: NativeSupervisorState): string {
  if (!nativeWorkspaceIsClean(state.integration.worktree)) {
    throw new Error('Native Supervisor integration worktree must be clean');
  }
  const root = runGitCommand(state.integration.worktree, ['rev-parse', '--show-toplevel']);
  if (path.resolve(root) !== path.resolve(state.integration.worktree)) {
    throw new Error('Native Supervisor integration worktree identity is invalid');
  }
  const branch = runGitCommand(state.integration.worktree, ['branch', '--show-current']);
  if (branch !== state.integration.branch) {
    throw new Error(
      `Native Supervisor integration branch mismatch: expected ${state.integration.branch}, got ${branch || '(detached)'}`,
    );
  }
  return runGitCommand(state.integration.worktree, ['rev-parse', 'HEAD']);
}
export function assertNativeSupervisorVerifierWorkspace(
  workspaceRoot: string,
  expectedBranch: string,
  expectedCommit: string,
): void {
  const identity = inspectGitWorktree(workspaceRoot);
  if (!identity.isGitWorktree || identity.currentBranch !== expectedBranch) {
    throw new Error(`Native Supervisor Verifier worktree identity is not ${expectedBranch}`);
  }
  if (!nativeWorkspaceIsClean(workspaceRoot)) {
    throw new Error(`Native Supervisor Verifier worktree is not clean: ${workspaceRoot}`);
  }
  const head = runGitCommand(workspaceRoot, ['rev-parse', 'HEAD']);
  if (head !== expectedCommit) {
    throw new Error('Native Supervisor Verifier worktree is not at its candidate commit');
  }
}
/**
 * Bring a drifted target into the isolated integration branch. The target is
 * never modified here; the caller must rerun parent checks before delivery.
 */
export function assertNativeSupervisorTargetUnchanged(
  projectRoot: string,
  state: NativeSupervisorState,
): string {
  const target = resolveGitRef(projectRoot, state.integration.targetBranch);
  if (target !== state.integration.targetCommit) {
    throw new Error(
      `Native Supervisor target branch drifted: expected ${state.integration.targetCommit}, got ${target ?? '(missing)'}`,
    );
  }
  return target;
}
export async function refreshNativeSupervisorTarget(options: {
  paths: NativeProjectPaths;
  state: NativeSupervisorState;
}): Promise<NativeSupervisorState | null> {
  const target = resolveGitRef(options.paths.projectRoot, options.state.integration.targetBranch);
  if (!target || target === options.state.integration.targetCommit) return null;
  const state = options.state;
  const integrationHead = assertNativeSupervisorIntegrationWorkspace(state);
  if (integrationHead !== state.integration.headCommit) {
    throw new Error('Native Supervisor integration head changed before target refresh');
  }
  try {
    runGitCommand(state.integration.worktree, [
      'merge',
      '--no-edit',
      state.integration.targetBranch,
    ]);
  } catch (error) {
    throw new Error(
      `Native Supervisor target drift requires conflict resolution in ${state.integration.worktree}`,
      { cause: error },
    );
  }
  const headCommit = runGitCommand(state.integration.worktree, ['rev-parse', 'HEAD']);
  const next = cloneState(state);
  next.integration.headCommit = headCommit;
  next.finalVerification = { status: 'pending', summary: null };
  recordEvent(next, {
    kind: 'target-refreshed',
    child: null,
    runId: null,
    summary: `Target ${state.integration.targetBranch} was refreshed before delivery`,
  });
  next.stateVersion += 1;
  await writeNativeSupervisorState(options.paths, next);
  return next;
}

export interface NativeSupervisorCleanupCandidate {
  root: string;
  branch: string;
}

export interface NativeSupervisorCleanupBinding {
  projectRoot: string;
  targetRoot: string;
  targetBranch: string;
  targetCommit: string;
  candidates: NativeSupervisorCleanupCandidate[];
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

function assertDeliveredTarget(binding: NativeSupervisorCleanupBinding): void {
  if (
    inspectGitWorktree(binding.targetRoot).currentBranch !== binding.targetBranch ||
    resolveGitRef(binding.targetRoot, binding.targetBranch) !== binding.targetCommit
  ) {
    throw new Error('Native Supervisor target branch changed during cleanup');
  }
}

export function preflightNativeSupervisorCleanup(binding: NativeSupervisorCleanupBinding): void {
  assertDeliveredTarget(binding);
  const registered = listGitWorktreeRoots(binding.projectRoot);
  for (const candidate of binding.candidates) {
    if (registered.some((root) => samePath(root, candidate.root))) {
      if (containsPath(candidate.root, process.cwd())) {
        throw new Error(`Native Supervisor cannot clean the current worktree: ${candidate.root}`);
      }
      if (
        inspectGitWorktree(candidate.root).currentBranch !== candidate.branch ||
        !nativeWorkspaceIsClean(candidate.root)
      ) {
        throw new Error(`Native Supervisor cleanup found a changed worktree: ${candidate.root}`);
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
          `Native Supervisor cleanup found an unintegrated branch: ${candidate.branch}`,
        );
      }
    }
  }
}

export function nativeSupervisorCleanupComplete(binding: NativeSupervisorCleanupBinding): boolean {
  const registered = listGitWorktreeRoots(binding.projectRoot);
  return binding.candidates.every(
    (candidate) =>
      !registered.some((root) => samePath(root, candidate.root)) &&
      !localBranchExists(binding.projectRoot, candidate.branch),
  );
}

export async function executeNativeSupervisorCleanup(
  binding: NativeSupervisorCleanupBinding,
): Promise<void> {
  if (nativeSupervisorCleanupComplete(binding)) return;
  preflightNativeSupervisorCleanup(binding);
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
  if (!nativeSupervisorCleanupComplete(binding)) {
    throw new Error('Native Supervisor cleanup did not remove every temporary worktree');
  }
}

/** Only the original Compat Supervisor workspaces are eligible for cleanup. */
export async function nativePortableSupervisorCleanupBinding(
  paths: NativeProjectPaths,
  state: NativePortableState,
): Promise<NativeSupervisorCleanupBinding | null> {
  const supervisor = await readNativeSupervisorState(paths, state.name, {
    diagnostics: true,
  });
  if (!supervisor) return null;
  const workspaceRoot =
    inspectGitWorktree(paths.projectRoot).primaryWorktreeRoot ?? paths.projectRoot;
  const integrationRoot = nativeSupervisorIntegrationWorktree(workspaceRoot, state.name);
  const integrationBranch = nativeSupervisorIntegrationBranch(state.name);
  if (
    supervisor.parent !== state.name ||
    !samePath(supervisor.integration.worktree, integrationRoot) ||
    supervisor.integration.branch !== integrationBranch ||
    !state.workspace.change_branch
  ) {
    throw new Error('Native Supervisor cleanup lacks its original parent workspace');
  }
  const candidates: NativeSupervisorCleanupCandidate[] = supervisor.children.map((child) => {
    const root =
      child.projectRoot ?? child.task?.projectRoot ?? child.verification?.execution?.projectRoot;
    const expected = nativeSupervisorChildWorktree(workspaceRoot, state.name, child.name);
    if (!root || !samePath(root, expected) || !['integrated', 'archived'].includes(child.status)) {
      throw new Error(
        'Native Supervisor cleanup requires its original integrated Child workspace: ' + child.name,
      );
    }
    return {
      root,
      branch: 'comet/supervisor/' + state.name + '/' + child.name,
    };
  });
  candidates.push({ root: integrationRoot, branch: integrationBranch });
  return {
    projectRoot: paths.projectRoot,
    targetRoot: paths.projectRoot,
    targetBranch: state.workspace.change_branch,
    targetCommit: supervisor.integration.headCommit,
    candidates,
  };
}
