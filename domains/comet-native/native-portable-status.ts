import { promises as fs } from 'node:fs';

import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';

import { inspectNativeChildren, type NativeChildStatusProjection } from './native-children.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import { nativePortableChangeDir, readNativePortableRuntime } from './native-portable-runtime.js';
import type { NativeLocalExecutionState, NativePortableState } from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';

export interface NativePortableAcceptanceCounts {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  pending: number;
}

export interface NativePortableStatusProjection {
  schema: 'comet.native.status.v2';
  name: string;
  phase: NativePortableState['phase'];
  status: NativePortableState['status'];
  stateVersion: number;
  loop: NativePortableState['loop'];
  acceptance: NativePortableAcceptanceCounts;
  verificationResult: NativePortableState['verification_result'];
  blockers: NativePortableState['blockers'];
  builderHandoff: NativePortableState['builder_handoff'];
  verification: NativePortableState['verification'];
  history: NativePortableState['history'];
  historyOverflow: NativePortableState['history_overflow'];
  workspace: {
    projectRoot: string;
    isolation: NativePortableState['workspace']['isolation'];
    bindingState: 'aligned' | 'mismatch';
    changeBranch: string | null;
    targetBranch: string | null;
    finish: NativePortableState['workspace']['finish'];
    message: string | null;
  };
  localExecution: {
    status: 'available' | 'missing' | 'invalid' | 'stale' | 'not-expected';
    operation: NativeLocalExecutionState['execution'];
  };
  children?: NativeChildStatusProjection[];
  readyChildren?: string[];
  continuation: ReturnType<typeof nativePortableContinuation>;
  details?: {
    acceptance: NativePortableState['acceptance'];
    specChanges: NativePortableState['spec_changes'];
    workspace: NativePortableState['workspace'];
    verificationReport: NativePortableState['verification_report'];
  };
}

function counts(state: NativePortableState): NativePortableAcceptanceCounts {
  return state.acceptance.reduce<NativePortableAcceptanceCounts>(
    (result, entry) => ({ ...result, [entry.result]: result[entry.result] + 1 }),
    { total: state.acceptance.length, passed: 0, failed: 0, blocked: 0, pending: 0 },
  );
}

function workspaceProjection(paths: NativeProjectPaths, state: NativePortableState) {
  const context = inspectGitWorktree(paths.projectRoot);
  let message: string | null = null;
  if (state.workspace.change_branch !== null) {
    if (!context.isGitWorktree) {
      message = 'The Native change requires a registered Git worktree.';
    } else if (context.currentBranch !== state.workspace.change_branch) {
      message = `Expected branch ${state.workspace.change_branch}, current branch is ${context.currentBranch ?? '(detached)'}.`;
    }
  }
  if (
    message === null &&
    state.workspace.isolation === 'worktree' &&
    !context.isSecondaryWorktree
  ) {
    message = 'The Native change requires its linked worktree.';
  }
  return {
    projectRoot: paths.projectRoot,
    isolation: state.workspace.isolation,
    bindingState: message === null ? ('aligned' as const) : ('mismatch' as const),
    changeBranch: state.workspace.change_branch,
    targetBranch: state.workspace.target_branch,
    finish: state.workspace.finish,
    message,
  };
}

export async function inspectNativePortableStatus(options: {
  paths: NativeProjectPaths;
  name: string;
  details?: boolean;
}): Promise<NativePortableStatusProjection> {
  const runtime = await readNativePortableRuntime(options);
  const localExpected = runtime.state.status === 'active' && runtime.state.loop.stage !== 'done';
  const workspace = workspaceProjection(options.paths, runtime.state);
  const children = await inspectNativeChildren({ paths: options.paths, state: runtime.state });
  const continuation = nativePortableContinuation(runtime.state, children);
  const effectiveContinuation =
    workspace.bindingState === 'mismatch'
      ? {
          ...continuation,
          disposition: 'await-user' as const,
          action: 'none' as const,
          commandArgs: null,
          requiredInputs: ['return-to-bound-workspace'],
          runnerAction: {
            ...continuation.runnerAction,
            kind: 'none' as const,
          },
        }
      : continuation;
  return {
    schema: 'comet.native.status.v2',
    name: runtime.state.name,
    phase: runtime.state.phase,
    status: runtime.state.status,
    stateVersion: runtime.state.state_version,
    loop: runtime.state.loop,
    acceptance: counts(runtime.state),
    verificationResult: runtime.state.verification_result,
    blockers: runtime.state.blockers,
    builderHandoff: runtime.state.builder_handoff,
    verification: runtime.state.verification,
    history: runtime.state.history,
    historyOverflow: runtime.state.history_overflow,
    workspace,
    localExecution: {
      status: localExpected ? runtime.localStatus : 'not-expected',
      operation: runtime.localStatus === 'available' ? (runtime.local?.execution ?? null) : null,
    },
    ...(children
      ? {
          children: children.children,
          readyChildren: children.readyChildren,
        }
      : {}),
    continuation: effectiveContinuation,
    ...(options.details
      ? {
          details: {
            acceptance: runtime.state.acceptance,
            specChanges: runtime.state.spec_changes,
            workspace: runtime.state.workspace,
            verificationReport: runtime.state.verification_report,
          },
        }
      : {}),
  };
}

export async function listNativePortableChangeNames(paths: NativeProjectPaths): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(paths.changesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    try {
      const source = await fs.readFile(
        `${nativePortableChangeDir(paths, entry.name)}/comet-state.yaml`,
        'utf8',
      );
      if (/^schema:\s*comet\.native\.v4\s*$/mu.test(source)) names.push(entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return names.sort((left, right) => left.localeCompare(right, 'en'));
}

export async function listNativePortableStatus(options: {
  paths: NativeProjectPaths;
  offset?: number;
  limit?: number;
}): Promise<{
  schema: 'comet.native.status-page.v2';
  items: NativePortableStatusProjection[];
  total: number;
  nextOffset: number | null;
}> {
  const names = await listNativePortableChangeNames(options.paths);
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 32;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('Native status page bounds are invalid');
  }
  const selected = names.slice(offset, offset + limit);
  return {
    schema: 'comet.native.status-page.v2',
    items: await Promise.all(
      selected.map((name) => inspectNativePortableStatus({ paths: options.paths, name })),
    ),
    total: names.length,
    nextOffset: offset + selected.length < names.length ? offset + selected.length : null,
  };
}
