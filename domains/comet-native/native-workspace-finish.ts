import { promises as fs } from 'node:fs';
import path from 'node:path';

import { runExternalCommand } from '../../platform/process/external-command.js';
import {
  gitBranchRemote,
  gitStatusPaths,
  gitWorktreeIsClean,
  runGitCommand,
} from '../../platform/process/git.js';
import { inspectGitWorktree, listGitWorktreeRoots } from '../../platform/paths/git-worktree.js';

import { canonicalSpecPath } from './native-artifacts.js';
import { nativeChangeDir } from './native-change.js';
import type { NativePortableState } from './native-portable-types.js';
import { nativeSelectionFile } from './native-selection.js';
import type { NativeChangeState, NativeProjectPaths } from './native-types.js';
import type { NativeWorkspaceFinish, NativeWorkspaceIdentityV3 } from './native-workspace.js';
import { inspectNativeWorkspaceBinding } from './native-workspace.js';

export interface NativeWorkspaceFinishPlan {
  finish: NativeWorkspaceFinish;
  changeRoot: string;
  primaryRoot: string;
  changeBranch: string;
  targetBranch: string;
  targetRoot: string | null;
  remote: string | null;
  isolation: 'branch' | 'worktree';
}

export interface NativeWorkspaceFinishResult {
  action: NativeWorkspaceFinish;
  status: 'completed' | 'kept' | 'blocked';
  commit: string | null;
  remote: string | null;
  pushed: boolean;
  pullRequestUrl: string | null;
  merged: boolean;
  targetRoot: string | null;
  cleanup: {
    performed: boolean;
    reason: string | null;
  };
  message: string | null;
  recoveryArgs: string[] | null;
}

export class NativeWorkspaceFinishError extends Error {
  constructor(readonly result: NativeWorkspaceFinishResult) {
    super(result.message ?? 'Native workspace finish is blocked');
    this.name = 'NativeWorkspaceFinishError';
  }
}

type NativeWorkspaceFinishState =
  | Pick<NativeChangeState, 'name' | 'spec_changes'>
  | Pick<NativePortableState, 'name' | 'spec_changes'>;

function pathContains(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function portableRelative(projectRoot: string, target: string): string {
  const relative = path.relative(projectRoot, target).replaceAll('\\', '/');
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error(`Native workspace finish path escaped the project: ${target}`);
  }
  return relative;
}

function pathCovered(candidate: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => candidate === entry || candidate.startsWith(`${entry}/`));
}

function assertGitIdentity(projectRoot: string): void {
  try {
    if (
      runGitCommand(projectRoot, ['config', '--get', 'user.name']) &&
      runGitCommand(projectRoot, ['config', '--get', 'user.email'])
    ) {
      return;
    }
  } catch {
    // Fall through to the stable user-facing error below.
  }
  throw new Error('Native workspace finish requires configured Git user.name and user.email');
}

function findTargetRoot(primaryRoot: string, targetBranch: string): string | null {
  for (const root of listGitWorktreeRoots(primaryRoot)) {
    const context = inspectGitWorktree(root);
    if (context.currentBranch === targetBranch) return root;
  }
  return null;
}

function assertCommandAvailable(command: string, args: readonly string[]): void {
  try {
    runExternalCommand(command, args, { timeoutMs: 10_000 });
  } catch (error) {
    throw new Error(`${command} is required for the selected Native workspace finish`, {
      cause: error,
    });
  }
}

export async function prepareNativeWorkspaceFinish(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  workspace: NativeWorkspaceIdentityV3;
}): Promise<NativeWorkspaceFinishPlan | null> {
  const { paths, workspace } = options;
  if (workspace.isolation === 'current') return null;
  if (!workspace.finish || !workspace.changeBranch || !workspace.targetBranch) {
    throw new Error('Native isolated workspace finish is not persisted');
  }
  if (workspace.changeBranch === workspace.targetBranch) {
    throw new Error('Native change and target branches must be different for workspace finish');
  }
  const inspection = await inspectNativeWorkspaceBinding({ paths, identity: workspace });
  if (inspection.state !== 'aligned') {
    throw new Error(`Native workspace finish is blocked: ${inspection.message ?? inspection.code}`);
  }
  const context = inspectGitWorktree(paths.projectRoot);
  if (!context.primaryWorktreeRoot) {
    throw new Error('Native workspace finish requires a registered Git worktree');
  }
  assertGitIdentity(paths.projectRoot);
  const allowedBeforeArchive = [portableRelative(paths.projectRoot, nativeSelectionFile(paths))];
  const unrelated = gitStatusPaths(paths.projectRoot).filter(
    (candidate) => !pathCovered(candidate, allowedBeforeArchive),
  );
  if (unrelated.length > 0) {
    throw new Error(
      `Native workspace finish is blocked until change-owned implementation and artifacts are committed; remaining paths: ${unrelated.slice(0, 20).join(', ')}${unrelated.length > 20 ? ', ...' : ''}`,
    );
  }
  const targetRoot =
    workspace.isolation === 'branch'
      ? paths.projectRoot
      : findTargetRoot(context.primaryWorktreeRoot, workspace.targetBranch);
  if (workspace.finish === 'merge' && workspace.isolation === 'worktree') {
    if (!targetRoot) {
      throw new Error(
        `Native merge finish requires a registered worktree on target branch ${workspace.targetBranch}`,
      );
    }
    if (!gitWorktreeIsClean(targetRoot)) {
      throw new Error(`Native merge target worktree is not clean: ${targetRoot}`);
    }
  }
  const remote =
    workspace.finish === 'push' || workspace.finish === 'pull-request'
      ? gitBranchRemote(paths.projectRoot, workspace.changeBranch)
      : null;
  if (workspace.finish === 'pull-request') assertCommandAvailable('gh', ['--version']);
  return {
    finish: workspace.finish,
    changeRoot: paths.projectRoot,
    primaryRoot: context.primaryWorktreeRoot,
    changeBranch: workspace.changeBranch,
    targetBranch: workspace.targetBranch,
    targetRoot,
    remote,
    isolation: workspace.isolation,
  };
}

/**
 * Prepare Git finishing directly from the portable YAML binding.
 *
 * Unlike the legacy workspace identity this deliberately does not create or
 * compare root hashes. The current Git worktree registration and branch are
 * the only local facts needed before the user-authorized finish action.
 */
export async function prepareNativePortableWorkspaceFinish(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  archiveDir?: string;
}): Promise<NativeWorkspaceFinishPlan | null> {
  const { paths, state } = options;
  const workspace = state.workspace;
  if (workspace.isolation === 'current') return null;
  if (!workspace.finish || !workspace.change_branch || !workspace.target_branch) {
    throw new Error('Native isolated workspace finish is not persisted');
  }
  if (workspace.change_branch === workspace.target_branch) {
    throw new Error('Native change and target branches must be different for workspace finish');
  }
  const context = inspectGitWorktree(paths.projectRoot);
  if (!context.primaryWorktreeRoot || context.currentBranch !== workspace.change_branch) {
    throw new Error(
      `Native workspace finish requires branch ${workspace.change_branch} in the current registered worktree`,
    );
  }
  assertGitIdentity(paths.projectRoot);
  const allowedBeforeArchive = [portableRelative(paths.projectRoot, nativeSelectionFile(paths))];
  if (options.archiveDir) {
    allowedBeforeArchive.push(
      portableRelative(paths.projectRoot, nativeChangeDir(paths, state.name)),
      portableRelative(paths.projectRoot, options.archiveDir),
    );
  }
  const unrelated = gitStatusPaths(paths.projectRoot).filter(
    (candidate) => !pathCovered(candidate, allowedBeforeArchive),
  );
  if (unrelated.length > 0) {
    throw new Error(
      `Native workspace finish is blocked until change-owned implementation and artifacts are committed; remaining paths: ${unrelated.slice(0, 20).join(', ')}${unrelated.length > 20 ? ', ...' : ''}`,
    );
  }
  const targetRoot =
    workspace.isolation === 'branch'
      ? paths.projectRoot
      : findTargetRoot(context.primaryWorktreeRoot, workspace.target_branch);
  if (workspace.finish === 'merge' && workspace.isolation === 'worktree') {
    if (!targetRoot) {
      throw new Error(
        `Native merge finish requires a registered worktree on target branch ${workspace.target_branch}`,
      );
    }
    if (!gitWorktreeIsClean(targetRoot)) {
      throw new Error(`Native merge target worktree is not clean: ${targetRoot}`);
    }
  }
  const remote =
    workspace.finish === 'push' || workspace.finish === 'pull-request'
      ? gitBranchRemote(paths.projectRoot, workspace.change_branch)
      : null;
  if (workspace.finish === 'pull-request') assertCommandAvailable('gh', ['--version']);
  return {
    finish: workspace.finish,
    changeRoot: paths.projectRoot,
    primaryRoot: context.primaryWorktreeRoot,
    changeBranch: workspace.change_branch,
    targetBranch: workspace.target_branch,
    targetRoot,
    remote,
    isolation: workspace.isolation,
  };
}

function runGh(projectRoot: string, args: readonly string[]): string {
  try {
    return runExternalCommand('gh', args, { cwd: projectRoot, timeoutMs: 60_000 }).trim();
  } catch (error) {
    throw new Error(`gh ${args.join(' ')} failed: ${(error as Error).message}`, { cause: error });
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function baseResult(plan: NativeWorkspaceFinishPlan): NativeWorkspaceFinishResult {
  return {
    action: plan.finish,
    status: plan.finish === 'keep' ? 'kept' : 'completed',
    commit: null,
    remote: plan.remote,
    pushed: false,
    pullRequestUrl: null,
    merged: false,
    targetRoot: plan.targetRoot,
    cleanup: { performed: false, reason: null },
    message: null,
    recoveryArgs: null,
  };
}

export async function finishArchivedNativeWorkspace(options: {
  paths: NativeProjectPaths;
  state: NativeWorkspaceFinishState;
  name: string;
  archiveDir: string;
  transactionId: string;
  plan: NativeWorkspaceFinishPlan;
}): Promise<NativeWorkspaceFinishResult> {
  const result = baseResult(options.plan);
  let switchedMergeRoot: string | null = null;
  try {
    const allowedPaths = [
      portableRelative(options.paths.projectRoot, nativeChangeDir(options.paths, options.name)),
      portableRelative(options.paths.projectRoot, options.archiveDir),
      ...options.state.spec_changes.map((change) =>
        portableRelative(
          options.paths.projectRoot,
          canonicalSpecPath(options.paths, change.capability),
        ),
      ),
      portableRelative(options.paths.projectRoot, nativeSelectionFile(options.paths)),
    ];
    const unexpected = gitStatusPaths(options.plan.changeRoot).filter(
      (candidate) => !pathCovered(candidate, allowedPaths),
    );
    if (unexpected.length > 0) {
      throw new Error(
        `Native Archive produced or encountered paths outside the authorized finish scope: ${unexpected.slice(0, 20).join(', ')}${unexpected.length > 20 ? ', ...' : ''}`,
      );
    }
    const stageable: string[] = [];
    for (const candidate of allowedPaths) {
      const absolute = path.resolve(options.paths.projectRoot, ...candidate.split('/'));
      const tracked = runGitCommand(options.plan.changeRoot, ['ls-files', '--', candidate]) !== '';
      if ((await pathExists(absolute)) || tracked) stageable.push(candidate);
    }
    if (stageable.length > 0) {
      runGitCommand(options.plan.changeRoot, ['add', '-A', '--', ...stageable]);
    }
    const staged = runGitCommand(options.plan.changeRoot, [
      'diff',
      '--cached',
      '--name-only',
      '-z',
    ]);
    if (staged) {
      runGitCommand(options.plan.changeRoot, [
        'commit',
        '-m',
        `chore(native): archive ${options.name}`,
      ]);
    }
    result.commit = runGitCommand(options.plan.changeRoot, ['rev-parse', 'HEAD']);
    if (!gitWorktreeIsClean(options.plan.changeRoot)) {
      throw new Error('Native archive commit left unexpected working-tree changes');
    }

    if (options.plan.finish === 'keep') return result;
    if (options.plan.finish === 'push' || options.plan.finish === 'pull-request') {
      runGitCommand(options.plan.changeRoot, [
        'push',
        '--set-upstream',
        options.plan.remote!,
        options.plan.changeBranch,
      ]);
      result.pushed = true;
      if (options.plan.finish === 'pull-request') {
        result.pullRequestUrl =
          runGh(options.plan.changeRoot, [
            'pr',
            'create',
            '--base',
            options.plan.targetBranch,
            '--head',
            options.plan.changeBranch,
            '--fill',
          ])
            .split(/\r?\n/u)
            .find((line) => /^https?:\/\//u.test(line.trim())) ?? null;
        if (!result.pullRequestUrl) {
          throw new Error('GitHub CLI did not return a pull request URL');
        }
      }
      const cwdInsideChangeRoot = pathContains(options.plan.changeRoot, process.cwd());
      if (options.plan.isolation === 'worktree' && !cwdInsideChangeRoot) {
        runGitCommand(options.plan.primaryRoot, ['worktree', 'remove', options.plan.changeRoot]);
        result.cleanup = { performed: true, reason: null };
      } else if (options.plan.isolation === 'worktree') {
        result.cleanup = {
          performed: false,
          reason: 'invocation-working-directory-is-the-change-worktree',
        };
      }
      return result;
    }

    const mergeRoot = options.plan.targetRoot ?? options.plan.changeRoot;
    if (options.plan.isolation === 'branch') {
      runGitCommand(mergeRoot, ['switch', options.plan.targetBranch]);
      switchedMergeRoot = mergeRoot;
    }
    runGitCommand(mergeRoot, ['merge', '--no-ff', '--no-edit', options.plan.changeBranch]);
    result.merged = true;
    result.targetRoot = mergeRoot;
    result.cleanup = {
      performed: false,
      reason: 'post-merge-validation-required-before-cleanup',
    };
    return result;
  } catch (error) {
    if (switchedMergeRoot !== null) {
      let restored: boolean;
      try {
        runGitCommand(switchedMergeRoot, ['merge', '--abort']);
      } catch {
        // The failed merge may not have left an in-progress merge to abort.
      }
      try {
        if (inspectGitWorktree(switchedMergeRoot).currentBranch === options.plan.targetBranch) {
          runGitCommand(switchedMergeRoot, ['switch', options.plan.changeBranch]);
        }
        restored =
          inspectGitWorktree(switchedMergeRoot).currentBranch === options.plan.changeBranch;
      } catch {
        restored = false;
      }
      if (!restored) result.targetRoot = switchedMergeRoot;
    }
    result.status = 'blocked';
    result.message = (error as Error).message;
    result.recoveryArgs =
      options.plan.finish === 'merge' && result.targetRoot
        ? ['git', '-C', result.targetRoot, 'status', '--short']
        : ['git', '-C', options.plan.changeRoot, 'status', '--short'];
    throw new NativeWorkspaceFinishError(result);
  }
}
