import { promises as fs } from 'node:fs';
import path from 'node:path';

import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';

import { inspectNativeChildren } from './native-children.js';
import { readNativeSupervisorState, type NativeSupervisorState } from './native-supervisor.js';
import { inspectNativeSupervisorOverlay } from './native-supervisor-overlay.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import { nativePortableChangeDir, readNativePortableRuntime } from './native-portable-runtime.js';
import { nativePortableStateSummary } from './native-portable-summary.js';
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
  coordinationMode?: NativePortableState['coordination_mode'];
  loop: NativePortableState['loop'];
  acceptance: NativePortableAcceptanceCounts;
  unresolvedAcceptanceIds: string[];
  verificationResult: NativePortableState['verification_result'];
  blockers: ReturnType<typeof nativePortableStateSummary>['blockers'];
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
  childSummary?: Record<string, number>;
  readyChildren?: string[];
  supervisorOverlay?: {
    status: 'repairable-legacy-overlay' | 'incompatible';
    message: string;
    repairCommand: string | null;
  };
  supervisor?: NativeSupervisorStatusProjection;
  continuation: ReturnType<typeof nativePortableContinuation>;
  details?: {
    stateVersion: number;
    supervisorStateVersion?: number;
    items: NativePortableStatusDetailItem[];
    nextCursor: string | null;
    nextPageArgs: string[] | null;
  };
}

export interface NativePortableStatusDetailItem {
  kind:
    | 'acceptance'
    | 'spec-change'
    | 'builder-handoff'
    | 'verification'
    | 'history'
    | 'history-overflow'
    | 'workspace'
    | 'verification-report'
    | 'supervisor-integration'
    | 'supervisor-final-verification'
    | 'supervisor-child'
    | 'supervisor-history';
  value: unknown;
}

export interface NativeSupervisorStatusProjection {
  schema: NativeSupervisorState['schema'];
  parent: string;
  integration: Pick<NativeSupervisorState['integration'], 'branch' | 'targetBranch'>;
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

function detailsCursor(
  stateVersion: number,
  supervisorStateVersion: number,
  offset: number,
): string {
  return `native-details-v2.${stateVersion}.${supervisorStateVersion}.${offset.toString(36)}`;
}

function detailsOffset(
  cursor: string | undefined,
  stateVersion: number,
  supervisorStateVersion: number,
): number {
  if (!cursor) return 0;
  const match = /^native-details-v2\.(\d+)\.(\d+)\.([0-9a-z]+)$/u.exec(cursor);
  if (!match || Number(match[1]) !== stateVersion || Number(match[2]) !== supervisorStateVersion) {
    throw new Error('Native details cursor is stale or invalid');
  }
  const offset = Number.parseInt(match[3], 36);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('Native details cursor offset is invalid');
  }
  return offset;
}

function detailItems(
  state: NativePortableState,
  supervisor: NativeSupervisorState | null,
  supervisorRoots: readonly string[],
): NativePortableStatusDetailItem[] {
  return [
    ...state.acceptance.map((value) => ({ kind: 'acceptance' as const, value })),
    ...state.spec_changes.map((value) => ({ kind: 'spec-change' as const, value })),
    ...(state.builder_handoff
      ? [{ kind: 'builder-handoff' as const, value: state.builder_handoff }]
      : []),
    ...(state.verification ? [{ kind: 'verification' as const, value: state.verification }] : []),
    ...state.history.map((value) => ({ kind: 'history' as const, value })),
    { kind: 'history-overflow' as const, value: state.history_overflow },
    { kind: 'workspace' as const, value: state.workspace },
    ...(state.verification_report
      ? [{ kind: 'verification-report' as const, value: state.verification_report }]
      : []),
    ...(supervisor
      ? [
          {
            kind: 'supervisor-integration' as const,
            value: {
              ...supervisor.integration,
              worktree: '<worktree>',
              targetCommit: '<redacted>',
              headCommit: '<redacted>',
            },
          },
          {
            kind: 'supervisor-final-verification' as const,
            value: supervisor.finalVerification,
          },
          ...supervisor.children.map((value) => ({
            kind: 'supervisor-child' as const,
            value: redactSupervisorChild(value, supervisorRoots),
          })),
          ...supervisor.history.map((value) => ({
            kind: 'supervisor-history' as const,
            value: redactSupervisorHistory(value, supervisorRoots),
          })),
        ]
      : []),
  ];
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
    projectRoot: path.resolve(paths.projectRoot),
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

function redactSupervisorChild(
  child: NativeSupervisorState['children'][number],
  roots: readonly string[],
) {
  return {
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
          runId: '<redacted>',
        }
      : null,
  };
}

function redactSupervisorHistory(
  event: NativeSupervisorState['history'][number],
  roots: readonly string[],
) {
  return {
    ...event,
    runId: event.runId ? '<redacted>' : null,
    summary: redactSupervisorText(event.summary, roots) ?? '',
  };
}

export async function inspectNativePortableStatus(options: {
  paths: NativeProjectPaths;
  name: string;
  details?: boolean;
  cursor?: string;
}): Promise<NativePortableStatusProjection> {
  const runtime = await readNativePortableRuntime(options);
  const stateSummary = nativePortableStateSummary(runtime.state);
  const localExpected = runtime.state.status === 'active' && runtime.state.loop.stage !== 'done';
  const children = await inspectNativeChildren({ paths: options.paths, state: runtime.state });
  const supervisorOverlay = await inspectNativeSupervisorOverlay({
    paths: options.paths,
    state: runtime.state,
  });
  const supervisor =
    supervisorOverlay.status === 'repairable-legacy-overlay' ||
    supervisorOverlay.status === 'incompatible'
      ? null
      : await readNativeSupervisorState(options.paths, options.name);
  const workspace = supervisor
    ? { ...workspaceProjection(options.paths, runtime.state), projectRoot: '.' }
    : workspaceProjection(options.paths, runtime.state);
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
  const detailProjection = options.details
    ? (() => {
        const supervisorStateVersion = supervisor?.stateVersion ?? 0;
        const allDetails = detailItems(runtime.state, supervisor, supervisorRoots);
        const offset = detailsOffset(
          options.cursor,
          runtime.state.state_version,
          supervisorStateVersion,
        );
        const items = allDetails.slice(offset, offset + 32);
        const nextCursor =
          offset + items.length < allDetails.length
            ? detailsCursor(
                runtime.state.state_version,
                supervisorStateVersion,
                offset + items.length,
              )
            : null;
        return { items, nextCursor, supervisorStateVersion };
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
    ...(runtime.state.coordination_mode === undefined
      ? {}
      : { coordinationMode: runtime.state.coordination_mode }),
    loop: runtime.state.loop,
    acceptance: counts(runtime.state),
    unresolvedAcceptanceIds: stateSummary.unresolved_acceptance_ids,
    verificationResult: runtime.state.verification_result,
    blockers: supervisor ? [] : stateSummary.blockers,
    workspace,
    localExecution: {
      status: localExpected ? runtime.localStatus : 'not-expected',
      operation: runtime.localStatus === 'available' ? (runtime.local?.execution ?? null) : null,
    },
    ...(children
      ? {
          childSummary: children.children.reduce<Record<string, number>>(
            (summary, child) => ({
              ...summary,
              [child.status]: (summary[child.status] ?? 0) + 1,
            }),
            { total: children.children.length },
          ),
          readyChildren: children.readyChildren,
        }
      : {}),
    ...(supervisorProjection ? { supervisor: supervisorProjection } : {}),
    ...(supervisorOverlay.status === 'repairable-legacy-overlay' ||
    supervisorOverlay.status === 'incompatible'
      ? {
          supervisorOverlay: {
            status: supervisorOverlay.status,
            message: supervisorOverlay.message,
            repairCommand:
              supervisorOverlay.status === 'repairable-legacy-overlay'
                ? `comet native doctor ${options.name} --repair`
                : null,
          },
        }
      : {}),
    continuation: effectiveContinuation,
    ...(options.details
      ? {
          details: {
            stateVersion: runtime.state.state_version,
            ...(supervisor
              ? { supervisorStateVersion: detailProjection!.supervisorStateVersion }
              : {}),
            items: detailProjection!.items,
            nextCursor: detailProjection!.nextCursor,
            nextPageArgs: detailProjection!.nextCursor
              ? [
                  'comet',
                  'native',
                  'status',
                  runtime.state.name,
                  '--details',
                  '--cursor',
                  detailProjection!.nextCursor,
                  '--json',
                  '--project-root',
                  options.paths.projectRoot,
                ]
              : null,
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
