import { promises as fs } from 'node:fs';

import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';

import { inspectNativeChildren, type NativeChildStatusProjection } from './native-children.js';
import { readNativeSupervisorState, type NativeSupervisorState } from './native-supervisor.js';
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
  builderHandoff?: NativePortableState['builder_handoff'];
  verification?: NativePortableState['verification'];
  history?: NativePortableState['history'];
  historyOverflow?: NativePortableState['history_overflow'];
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
  supervisor?: NativeSupervisorStatusProjection;
  continuation: ReturnType<typeof nativePortableContinuation>;
  details?: {
    acceptance: NativePortableState['acceptance'];
    specChanges: NativePortableState['spec_changes'];
    workspace: NativePortableState['workspace'];
    verificationReport: NativePortableState['verification_report'];
    supervisor?: NativeSupervisorState & {
      history: NativeSupervisorState['history'];
      nextCursor: string | null;
    };
  };
}

export interface NativeSupervisorStatusProjection {
  schema: NativeSupervisorState['schema'];
  parent: string;
  integration: Pick<NativeSupervisorState['integration'], 'branch' | 'targetBranch'>;
  tasks: Array<
    Pick<
      NonNullable<NativeSupervisorState['children'][number]['task']>,
      'role' | 'child' | 'projectRoot'
    >
  >;
  finalVerification: Pick<NativeSupervisorState['finalVerification'], 'status' | 'summary'>;
  summary: {
    targetSpecs: number;
    implementationChildren: number;
    waiting: number;
    working: number;
    integrated: number;
    blocked: number;
    active: Array<{
      name: string;
      summary: string | null;
      projectRoot: string | null;
      reason: string | null;
    }>;
    agents: { working: number; completed: number };
    risks: string[];
    nextAction: string | null;
  };
}

function supervisorDetailsCursor(stateVersion: number, offset: number): string {
  return `native-supervisor-details-v1.${stateVersion}.${offset.toString(36)}`;
}

function supervisorDetailsOffset(cursor: string | undefined, stateVersion: number): number {
  if (!cursor) return 0;
  const match = /^native-supervisor-details-v1\.(\d+)\.([0-9a-z]+)$/u.exec(cursor);
  if (!match || Number(match[1]) !== stateVersion) {
    throw new Error('Native Supervisor details cursor is stale or invalid');
  }
  const offset = Number.parseInt(match[2], 36);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('Native Supervisor details cursor offset is invalid');
  }
  return offset;
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
    projectRoot: '.',
    isolation: state.workspace.isolation,
    bindingState: message === null ? ('aligned' as const) : ('mismatch' as const),
    changeBranch: state.workspace.change_branch,
    targetBranch: state.workspace.target_branch,
    finish: state.workspace.finish,
    message,
  };
}

function supervisorPublicRoots(paths: NativeProjectPaths, state: NativeSupervisorState): string[] {
  return [
    paths.projectRoot,
    state.integration.worktree,
    ...state.children.flatMap((child) => [child.projectRoot, child.task?.projectRoot]),
  ]
    .filter((root): root is string => Boolean(root))
    .map((root) => root.replaceAll('/', '\\'))
    .sort((left, right) => right.length - left.length);
}

function redactSupervisorText(value: string | null, roots: readonly string[]): string | null {
  if (value === null) return null;
  return roots.reduce(
    (result, root) =>
      result.replaceAll(root, '<worktree>').replaceAll(root.replaceAll('\\', '/'), '<worktree>'),
    value,
  );
}

function redactSupervisorChildren(
  children: readonly NativeChildStatusProjection[],
  roots: readonly string[],
): NativeChildStatusProjection[] {
  return children.map((child) => ({
    ...child,
    projectRoot: child.projectRoot ? '<worktree>' : null,
    message: redactSupervisorText(child.message, roots),
  }));
}

function redactSupervisorDetails(
  state: NativeSupervisorState,
  history: NativeSupervisorState['history'],
  nextCursor: string | null,
  roots: readonly string[],
) {
  return {
    ...state,
    integration: {
      ...state.integration,
      worktree: '<worktree>',
      targetCommit: '<redacted>',
      headCommit: '<redacted>',
    },
    children: state.children.map((child) => ({
      ...child,
      projectRoot: child.projectRoot ? '<worktree>' : null,
      baseCommit: child.baseCommit ? '<redacted>' : null,
      candidateCommit: child.candidateCommit ? '<redacted>' : null,
      verifiedCommit: child.verifiedCommit ? '<redacted>' : null,
      integrationCommit: child.integrationCommit ? '<redacted>' : null,
      blocker: redactSupervisorText(child.blocker, roots),
      task: child.task
        ? {
            ...child.task,
            projectRoot: '<worktree>',
            baseCommit: '<redacted>',
          }
        : null,
    })),
    history: history.map((event) => ({
      ...event,
      summary: redactSupervisorText(event.summary, roots) ?? '',
    })),
    nextCursor,
  };
}

export async function inspectNativePortableStatus(options: {
  paths: NativeProjectPaths;
  name: string;
  details?: boolean;
  cursor?: string;
}): Promise<NativePortableStatusProjection> {
  const runtime = await readNativePortableRuntime(options);
  const localExpected = runtime.state.status === 'active' && runtime.state.loop.stage !== 'done';
  const workspace = workspaceProjection(options.paths, runtime.state);
  const children = await inspectNativeChildren({ paths: options.paths, state: runtime.state });
  const supervisor = await readNativeSupervisorState(options.paths, options.name);
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
  const supervisorRoots = supervisor ? supervisorPublicRoots(options.paths, supervisor) : [];
  const supervisorSummary = supervisor
    ? (() => {
        const waiting = supervisor.children.filter(
          ({ status }) => status === 'pending' || status === 'ready',
        ).length;
        const working = supervisor.children.filter(
          ({ status }) => status === 'active' || status === 'verified',
        ).length;
        const integrated = supervisor.children.filter(
          ({ status }) => status === 'integrated' || status === 'archived',
        ).length;
        const blocked = supervisor.children.filter(
          ({ status }) => status === 'blocked' || status === 'needs-reverify',
        ).length;
        const active = supervisor.children
          .filter(
            ({ status }) =>
              status === 'active' || status === 'blocked' || status === 'needs-reverify',
          )
          .slice(0, 16)
          .map((child) => ({
            name: child.name,
            summary: child.summary,
            projectRoot: (child.task?.projectRoot ?? child.projectRoot) ? '<worktree>' : null,
            reason: redactSupervisorText(child.blocker, supervisorRoots),
          }));
        const risks = supervisor.children
          .flatMap(({ blocker }) => {
            const redacted = redactSupervisorText(blocker, supervisorRoots);
            return redacted ? [redacted] : [];
          })
          .slice(0, 16);
        return {
          targetSpecs: runtime.state.spec_changes.length,
          implementationChildren: supervisor.children.length,
          waiting,
          working,
          integrated,
          blocked,
          active,
          agents: {
            working: supervisor.children.filter(({ task }) => task !== null).length,
            completed: integrated,
          },
          risks,
          nextAction:
            supervisor.finalVerification.status === 'passed'
              ? 'final-delivery'
              : supervisor.finalVerification.status === 'pending' &&
                  integrated === supervisor.children.length
                ? 'parent-verification'
                : waiting > 0
                  ? 'dispatch-ready-child'
                  : blocked > 0
                    ? 'resolve-blocker'
                    : 'continue-supervisor',
        };
      })()
    : null;
  const supervisorHistory = supervisor
    ? (() => {
        const pageSize = 32;
        const offset = supervisorDetailsOffset(options.cursor, supervisor.stateVersion);
        const history = supervisor.history.slice(offset, offset + pageSize);
        return {
          history,
          nextCursor:
            offset + history.length < supervisor.history.length
              ? supervisorDetailsCursor(supervisor.stateVersion, offset + history.length)
              : null,
        };
      })()
    : null;
  const supervisorProjection = supervisor
    ? {
        schema: supervisor.schema,
        parent: supervisor.parent,
        integration: {
          branch: supervisor.integration.branch,
          targetBranch: supervisor.integration.targetBranch,
        },
        tasks: supervisor.children.flatMap((child) =>
          child.task
            ? [
                {
                  role: child.task.role,
                  child: child.task.child,
                  projectRoot: '<worktree>',
                },
              ]
            : [],
        ),
        finalVerification: {
          status: supervisor.finalVerification.status,
          summary: supervisor.finalVerification.summary,
        },
        summary: supervisorSummary!,
      }
    : null;
  return {
    schema: 'comet.native.status.v2',
    name: runtime.state.name,
    phase: runtime.state.phase,
    status: runtime.state.status,
    stateVersion: runtime.state.state_version,
    loop: runtime.state.loop,
    acceptance: counts(runtime.state),
    verificationResult: runtime.state.verification_result,
    blockers: supervisor ? [] : runtime.state.blockers,
    ...(supervisor
      ? {}
      : {
          builderHandoff: runtime.state.builder_handoff,
          verification: runtime.state.verification,
          history: runtime.state.history,
          historyOverflow: runtime.state.history_overflow,
        }),
    workspace,
    localExecution: {
      status: localExpected ? runtime.localStatus : 'not-expected',
      operation: runtime.localStatus === 'available' ? (runtime.local?.execution ?? null) : null,
    },
    ...(children
      ? {
          children: redactSupervisorChildren(children.children, supervisorRoots),
          readyChildren: children.readyChildren,
        }
      : {}),
    ...(supervisorProjection ? { supervisor: supervisorProjection } : {}),
    continuation: effectiveContinuation,
    ...(options.details
      ? {
          details: {
            acceptance: runtime.state.acceptance,
            specChanges: runtime.state.spec_changes,
            workspace: runtime.state.workspace,
            verificationReport: runtime.state.verification_report,
            ...(supervisor
              ? {
                  supervisor: redactSupervisorDetails(
                    supervisor,
                    supervisorHistory!.history,
                    supervisorHistory!.nextCursor,
                    supervisorRoots,
                  ),
                }
              : {}),
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
