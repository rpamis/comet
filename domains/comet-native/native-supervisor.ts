import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';

import { atomicWriteJson } from './native-atomic-file.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { nativePreferredChangeRuntimeDir } from './native-paths.js';
import { readProjectConfig } from './native-config.js';
import {
  inspectGitWorktree,
  isLocalGitBranch,
  listGitWorktreeRoots,
  resolveGitRef,
} from '../../platform/paths/git-worktree.js';
import { resolvePortablePath } from '../../platform/paths/portable-path.js';
import { gitWorktreeIsClean, runGitCommand } from '../../platform/process/git.js';
import {
  prepareNativeWorkspace,
  type PreparedNativeWorkspace,
} from './native-workspace-preparation.js';
import type { CometProjectConfig } from './native-types.js';
import type { NativePortableState } from './native-portable-types.js';
import type {
  NativeChildStatusProjection,
  NativeChildrenContract,
  NativeChildrenInspection,
} from './native-children.js';
import type { NativeProjectPaths } from './native-types.js';

export const NATIVE_SUPERVISOR_SCHEMA = 'comet.native.supervisor.v2' as const;

export type NativeSupervisorChildStatus =
  | 'pending'
  | 'ready'
  | 'active'
  | 'verified'
  | 'integrated'
  | 'archived'
  | 'blocked'
  | 'needs-reverify';

export interface NativeSupervisorVerificationEvidence {
  summary: string;
  checks: string[];
}

export interface NativeSupervisorIntegrationCheck {
  name: string;
  status: 'passed' | 'failed' | 'incomplete';
  reason?: string | null;
}

export interface NativeSupervisorTask {
  role: 'builder' | 'verifier';
  child: string;
  projectRoot: string;
  baseCommit: string;
  runId: string;
}

export interface NativeSupervisorEvent {
  kind:
    | 'task-dispatched'
    | 'task-reconnected'
    | 'task-cancelled'
    | 'task-blocked'
    | 'builder-result'
    | 'verifier-result'
    | 'child-integrated'
    | 'child-verified'
    | 'integration-head-reconciled'
    | 'target-refreshed'
    | 'delivery-reconciled';
  child: string | null;
  runId: string | null;
  summary: string;
  at: string;
}

export interface NativeSupervisorChildState {
  name: string;
  summary: string | null;
  dependsOn: string[];
  status: NativeSupervisorChildStatus;
  baseCommit: string | null;
  candidateCommit: string | null;
  verifiedCommit: string | null;
  integrationCommit: string | null;
  verification: NativeSupervisorVerificationEvidence | null;
  checks: NativeSupervisorIntegrationCheck[];
  blocker: string | null;
  /** Last known Child worktree; retained after a task completes for recovery/status. */
  projectRoot?: string | null;
  task: NativeSupervisorTask | null;
}

export interface NativeSupervisorState {
  schema: typeof NATIVE_SUPERVISOR_SCHEMA;
  stateVersion: number;
  parent: string;
  integration: {
    branch: string;
    worktree: string;
    targetBranch: string;
    targetCommit: string;
    headCommit: string;
  };
  children: NativeSupervisorChildState[];
  history: NativeSupervisorEvent[];
  finalVerification: {
    status: 'pending' | 'passed' | 'failed' | 'incomplete';
    summary: string | null;
    layers?: {
      childVerification: 'complete' | 'incomplete';
      parentIntegration: 'complete' | 'incomplete';
      parentChecks: string[];
      notRerun: string[];
      incomplete: string[];
    };
  };
}

const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

function isPathInside(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === '' || (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`));
}

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

export function nativeSupervisorRuntimeDir(
  paths: Pick<NativeProjectPaths, 'changesRuntimeDir'>,
  parent: string,
): string {
  return path.join(
    nativePreferredChangeRuntimeDir(paths as NativeProjectPaths, parent),
    'supervisor',
  );
}

export function nativeSupervisorStateFile(
  paths: Pick<NativeProjectPaths, 'changesRuntimeDir'>,
  parent: string,
): string {
  return path.join(nativeSupervisorRuntimeDir(paths, parent), 'state.json');
}

function assertSupervisorState(value: unknown): asserts value is NativeSupervisorState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Native Supervisor state must be an object');
  }
  const state = value as Partial<NativeSupervisorState>;
  if (state.schema !== NATIVE_SUPERVISOR_SCHEMA) {
    throw new Error(`Native Supervisor state schema must be ${NATIVE_SUPERVISOR_SCHEMA}`);
  }
  if (
    !Number.isSafeInteger(state.stateVersion) ||
    typeof state.stateVersion !== 'number' ||
    state.stateVersion < 1
  ) {
    throw new Error('Native Supervisor state version is invalid');
  }
  if (typeof state.parent !== 'string' || !state.parent) {
    throw new Error('Native Supervisor state parent is invalid');
  }
  if (!state.integration || typeof state.integration !== 'object') {
    throw new Error('Native Supervisor integration state is missing');
  }
  for (const [key, valueToCheck] of Object.entries(state.integration)) {
    if (typeof valueToCheck !== 'string' || valueToCheck.length === 0) {
      throw new Error(`Native Supervisor integration field ${key} is invalid`);
    }
  }
  assertCommit(state.integration.targetCommit, 'Native Supervisor target commit');
  assertCommit(state.integration.headCommit, 'Native Supervisor integration head commit');
  if (!Array.isArray(state.children)) throw new Error('Native Supervisor children are invalid');
  if (!Array.isArray(state.history)) throw new Error('Native Supervisor history is invalid');
  if (
    !state.finalVerification ||
    !['pending', 'passed', 'failed', 'incomplete'].includes(state.finalVerification.status) ||
    (state.finalVerification.summary !== null &&
      typeof state.finalVerification.summary !== 'string')
  ) {
    throw new Error('Native Supervisor final verification is invalid');
  }
  if (state.finalVerification.layers) {
    const layers = state.finalVerification.layers;
    if (
      !['complete', 'incomplete'].includes(layers.childVerification) ||
      !['complete', 'incomplete'].includes(layers.parentIntegration) ||
      !Array.isArray(layers.parentChecks) ||
      !layers.parentChecks.every((entry) => typeof entry === 'string') ||
      !Array.isArray(layers.notRerun) ||
      !layers.notRerun.every((entry) => typeof entry === 'string') ||
      !Array.isArray(layers.incomplete) ||
      !layers.incomplete.every((entry) => typeof entry === 'string')
    ) {
      throw new Error('Native Supervisor final verification layers are invalid');
    }
  }
  for (const event of state.history) {
    if (
      !event ||
      typeof event !== 'object' ||
      typeof event.kind !== 'string' ||
      typeof event.summary !== 'string' ||
      typeof event.at !== 'string' ||
      (event.child !== null && typeof event.child !== 'string') ||
      (event.runId !== null && typeof event.runId !== 'string')
    ) {
      throw new Error('Native Supervisor history event is invalid');
    }
  }
  const names = new Set<string>();
  const runIds = new Set<string>();
  for (const child of state.children) {
    if (!child || typeof child !== 'object' || typeof child.name !== 'string') {
      throw new Error('Native Supervisor child state is invalid');
    }
    if (names.has(child.name))
      throw new Error(`Native Supervisor child ${child.name} is duplicated`);
    names.add(child.name);
    if (
      !Array.isArray(child.dependsOn) ||
      !child.dependsOn.every((item) => typeof item === 'string')
    ) {
      throw new Error(`Native Supervisor child ${child.name} dependencies are invalid`);
    }
    if (typeof child.summary !== 'string' && child.summary !== null) {
      throw new Error(`Native Supervisor child ${child.name} summary is invalid`);
    }
    if (
      child.projectRoot !== undefined &&
      child.projectRoot !== null &&
      (typeof child.projectRoot !== 'string' || child.projectRoot.length === 0)
    ) {
      throw new Error(`Native Supervisor child ${child.name} projectRoot is invalid`);
    }
    for (const [label, commit] of [
      ['base', child.baseCommit],
      ['candidate', child.candidateCommit],
      ['verified', child.verifiedCommit],
      ['integration', child.integrationCommit],
    ] as const) {
      if (commit !== null)
        assertCommit(commit, `Native Supervisor child ${child.name} ${label} commit`);
    }
    if (!Array.isArray(child.checks) || !Array.isArray(child.verification?.checks ?? [])) {
      throw new Error(`Native Supervisor child ${child.name} evidence is invalid`);
    }
    if (child.task !== null) {
      if (!child.task || typeof child.task !== 'object') {
        throw new Error(`Native Supervisor child ${child.name} task is invalid`);
      }
      if (
        !['builder', 'verifier'].includes(child.task.role) ||
        child.task.child !== child.name ||
        typeof child.task.projectRoot !== 'string' ||
        child.task.projectRoot.length === 0 ||
        typeof child.task.runId !== 'string' ||
        child.task.runId.length === 0
      ) {
        throw new Error(`Native Supervisor child ${child.name} task identity is invalid`);
      }
      assertCommit(child.task.baseCommit, `Native Supervisor child ${child.name} task base commit`);
      if (runIds.has(child.task.runId)) {
        throw new Error(`Native Supervisor task runId ${child.task.runId} is duplicated`);
      }
      runIds.add(child.task.runId);
      if (child.task.role === 'verifier' && child.task.baseCommit !== child.candidateCommit) {
        throw new Error(`Native Supervisor child ${child.name} verifier base commit is invalid`);
      }
      if (child.task.projectRoot !== child.projectRoot) {
        throw new Error(`Native Supervisor child ${child.name} task projectRoot is invalid`);
      }
      if (
        (child.task.role === 'builder' && child.status !== 'active') ||
        (child.task.role === 'verifier' && !['active', 'needs-reverify'].includes(child.status))
      ) {
        throw new Error(`Native Supervisor child ${child.name} task status is invalid`);
      }
    }
  }
}

export async function readNativeSupervisorState(
  paths: Pick<NativeProjectPaths, 'changesRuntimeDir'>,
  parent: string,
): Promise<NativeSupervisorState | null> {
  try {
    const source = await fs.readFile(nativeSupervisorStateFile(paths, parent), 'utf8');
    const parsed: unknown = JSON.parse(source);
    assertSupervisorState(parsed);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeNativeSupervisorState(
  paths: Pick<NativeProjectPaths, 'changesRuntimeDir'>,
  state: NativeSupervisorState,
): Promise<void> {
  assertSupervisorState(state);
  await fs.mkdir(paths.changesRuntimeDir, { recursive: true });
  await atomicWriteJson(nativeSupervisorStateFile(paths, state.parent), state, {
    containedRoot: paths.changesRuntimeDir,
  });
}

function assertCommit(value: string, label: string): void {
  if (!COMMIT_PATTERN.test(value)) throw new Error(`${label} must be a Git commit`);
}

function cloneState(state: NativeSupervisorState): NativeSupervisorState {
  return structuredClone(state);
}

function recordEvent(state: NativeSupervisorState, event: Omit<NativeSupervisorEvent, 'at'>): void {
  state.history.push({ ...event, at: new Date().toISOString() });
  if (state.history.length > 256) state.history.splice(0, state.history.length - 256);
}

function assertChildDependenciesIntegrated(
  state: NativeSupervisorState,
  child: NativeSupervisorChildState,
): void {
  for (const dependency of child.dependsOn) {
    const record = state.children.find(({ name }) => name === dependency);
    if (!record || record.status !== 'integrated') {
      throw new Error(
        `Native Supervisor child ${child.name} dependency ${dependency} is not integrated`,
      );
    }
  }
}

function stableSupervisorIntegrationOrder(
  state: NativeSupervisorState,
): NativeSupervisorChildState[] {
  const remaining = new Set(state.children.map(({ name }) => name));
  const ordered: NativeSupervisorChildState[] = [];
  while (remaining.size > 0) {
    const candidate = state.children.find(
      (child) =>
        remaining.has(child.name) &&
        child.dependsOn.every((dependency) => !remaining.has(dependency)),
    );
    if (!candidate) {
      throw new Error('Native Supervisor Child dependencies contain a cycle');
    }
    ordered.push(candidate);
    remaining.delete(candidate.name);
  }
  return ordered;
}

export function createNativeSupervisorState(options: {
  parent: string;
  targetBranch: string;
  targetCommit: string;
  integrationBranch: string;
  integrationWorktree: string;
  contract: NativeChildrenContract;
}): NativeSupervisorState {
  assertCommit(options.targetCommit, 'Native Supervisor target commit');
  const names = new Set(options.contract.children.map(({ name }) => name));
  const children = options.contract.children.map((child) => ({
    name: child.name,
    summary: child.summary,
    dependsOn: [...child.depends_on],
    status: child.depends_on.length === 0 ? ('ready' as const) : ('pending' as const),
    baseCommit: null,
    candidateCommit: null,
    verifiedCommit: null,
    integrationCommit: null,
    verification: null,
    checks: [],
    blocker: null,
    projectRoot: null,
    task: null,
  }));
  for (const child of children) {
    for (const dependency of child.dependsOn) {
      if (!names.has(dependency)) {
        throw new Error(
          `Native Supervisor child ${child.name} depends on unknown child ${dependency}`,
        );
      }
    }
  }
  return {
    schema: NATIVE_SUPERVISOR_SCHEMA,
    stateVersion: 1,
    parent: options.parent,
    integration: {
      branch: options.integrationBranch,
      worktree: options.integrationWorktree,
      targetBranch: options.targetBranch,
      targetCommit: options.targetCommit,
      headCommit: options.targetCommit,
    },
    children,
    history: [],
    finalVerification: { status: 'pending', summary: null },
  };
}

/**
 * Reconstruct a Supervisor state when the machine-only runtime file was lost.
 * Git can prove the integration branch/worktree, but without portable Child
 * verification evidence it must not invent `verified` or `integrated` facts.
 */
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

export function reconcileNativeSupervisorState(options: {
  state: NativeSupervisorState;
  contract: NativeChildrenContract;
}): NativeSupervisorState {
  const next = cloneState(options.state);
  const declared = new Map(options.contract.children.map((child) => [child.name, child]));
  const existing = new Map(next.children.map((child) => [child.name, child]));
  for (const child of next.children) {
    const definition = declared.get(child.name);
    if (!definition) {
      if (child.status !== 'archived') {
        throw new Error(`Native Supervisor child ${child.name} cannot be removed before Archive`);
      }
      continue;
    }
    if (child.status === 'integrated' || child.status === 'archived') {
      if (
        definition.summary !== child.summary ||
        definition.depends_on.join('\0') !== child.dependsOn.join('\0')
      ) {
        throw new Error(`Native Supervisor integrated child ${child.name} history is immutable`);
      }
    }
    child.summary = definition.summary;
    child.dependsOn = [...definition.depends_on];
  }
  for (const definition of options.contract.children) {
    if (existing.has(definition.name)) continue;
    next.children.push({
      name: definition.name,
      summary: definition.summary,
      dependsOn: [...definition.depends_on],
      status: definition.depends_on.every((dependency) =>
        next.children.some(({ name, status }) => name === dependency && status === 'integrated'),
      )
        ? 'ready'
        : 'pending',
      baseCommit: null,
      candidateCommit: null,
      verifiedCommit: null,
      integrationCommit: null,
      verification: null,
      checks: [],
      blocker: null,
      projectRoot: null,
      task: null,
    });
  }
  next.stateVersion += 1;
  return next;
}

export function markNativeSupervisorChildVerified(
  state: NativeSupervisorState,
  options: {
    name: string;
    baseCommit: string;
    verifiedCommit: string;
    evidence: NativeSupervisorVerificationEvidence;
  },
): NativeSupervisorState {
  assertCommit(options.baseCommit, 'Native Supervisor child base commit');
  assertCommit(options.verifiedCommit, 'Native Supervisor verified commit');
  if (options.evidence.summary.trim().length === 0) {
    throw new Error('Native Supervisor verification summary must not be empty');
  }
  if (options.evidence.checks.length === 0) {
    throw new Error('Native Supervisor verification requires at least one check');
  }
  const next = cloneState(state);
  const child = next.children.find(({ name }) => name === options.name);
  if (!child) throw new Error(`Native Supervisor child ${options.name} does not exist`);
  if (child.status !== 'ready' && child.status !== 'active') {
    throw new Error(`Native Supervisor child ${options.name} is not ready for verification`);
  }
  assertChildDependenciesIntegrated(next, child);
  if (options.baseCommit !== next.integration.headCommit) {
    throw new Error(`Native Supervisor child ${options.name} base commit is stale`);
  }
  child.status = 'verified';
  child.baseCommit = options.baseCommit;
  child.candidateCommit = options.verifiedCommit;
  child.verifiedCommit = options.verifiedCommit;
  child.verification = {
    summary: options.evidence.summary,
    checks: [...options.evidence.checks],
  };
  child.blocker = null;
  recordEvent(next, {
    kind: 'child-verified',
    child: child.name,
    runId: null,
    summary: options.evidence.summary,
  });
  next.stateVersion += 1;
  return next;
}

export function createNativeSupervisorTask(
  state: NativeSupervisorState,
  options: Omit<NativeSupervisorTask, 'baseCommit'>,
): { state: NativeSupervisorState; task: NativeSupervisorTask } {
  if (!options.projectRoot.trim() || !options.runId.trim()) {
    throw new Error('Native Supervisor task projectRoot and runId are required');
  }
  const next = cloneState(state);
  const child = next.children.find(({ name }) => name === options.child);
  if (!child) throw new Error(`Native Supervisor child ${options.child} does not exist`);
  if (child.task)
    throw new Error(`Native Supervisor child ${options.child} already has an active task`);
  let baseCommit: string;
  if (options.role === 'builder') {
    if (child.status !== 'ready') {
      throw new Error(`Native Supervisor child ${options.child} is not ready for a Builder task`);
    }
    assertChildDependenciesIntegrated(next, child);
    baseCommit = next.integration.headCommit;
    child.status = 'active';
  } else {
    if (
      (child.status !== 'active' && child.status !== 'needs-reverify') ||
      !child.candidateCommit
    ) {
      throw new Error(`Native Supervisor child ${options.child} is not ready for a Verifier task`);
    }
    baseCommit = child.candidateCommit;
  }
  const task = { ...options, baseCommit };
  child.projectRoot = options.projectRoot;
  child.task = task;
  child.blocker = null;
  recordEvent(next, {
    kind: 'task-dispatched',
    child: child.name,
    runId: task.runId,
    summary: `${task.role} task dispatched`,
  });
  next.stateVersion += 1;
  return { state: next, task };
}

export function reconnectNativeSupervisorTask(
  state: NativeSupervisorState,
  options: { child: string; runId: string },
): NativeSupervisorTask {
  const child = state.children.find(({ name }) => name === options.child);
  if (!child?.task || child.task.runId !== options.runId) {
    throw new Error(`Native Supervisor task runId is not current for ${options.child}`);
  }
  return structuredClone(child.task);
}

/** Reconnect a task and return the auditable state transition for persistence. */
export function reconnectNativeSupervisorTaskWithState(
  state: NativeSupervisorState,
  options: { child: string; runId: string },
): { state: NativeSupervisorState; task: NativeSupervisorTask } {
  const task = reconnectNativeSupervisorTask(state, options);
  const next = cloneState(state);
  recordEvent(next, {
    kind: 'task-reconnected',
    child: options.child,
    runId: options.runId,
    summary: 'existing task reconnected',
  });
  next.stateVersion += 1;
  return { state: next, task };
}

function refreshNativeSupervisorBuilderWorkspace(
  workspaceRoot: string,
  expectedBranch: string,
  integrationHead: string,
): void {
  const identity = inspectGitWorktree(workspaceRoot);
  if (!identity.isGitWorktree || identity.currentBranch !== expectedBranch) {
    throw new Error(`Native Supervisor child worktree identity is not ${expectedBranch}`);
  }
  if (!gitWorktreeIsClean(workspaceRoot)) {
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

function assertNativeSupervisorIntegrationWorkspace(state: NativeSupervisorState): string {
  if (!gitWorktreeIsClean(state.integration.worktree)) {
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

function assertNativeSupervisorVerifierWorkspace(
  workspaceRoot: string,
  expectedBranch: string,
  expectedCommit: string,
): void {
  const identity = inspectGitWorktree(workspaceRoot);
  if (!identity.isGitWorktree || identity.currentBranch !== expectedBranch) {
    throw new Error(`Native Supervisor Verifier worktree identity is not ${expectedBranch}`);
  }
  if (!gitWorktreeIsClean(workspaceRoot)) {
    throw new Error(`Native Supervisor Verifier worktree is not clean: ${workspaceRoot}`);
  }
  const head = runGitCommand(workspaceRoot, ['rev-parse', 'HEAD']);
  if (head !== expectedCommit) {
    throw new Error('Native Supervisor Verifier worktree is not at its candidate commit');
  }
}

export function cancelNativeSupervisorTask(
  state: NativeSupervisorState,
  options: { child: string; runId: string; reason: string },
): NativeSupervisorState {
  if (options.reason.trim().length === 0)
    throw new Error('Native Supervisor cancellation reason is required');
  const next = cloneState(state);
  const child = next.children.find(({ name }) => name === options.child);
  if (!child?.task || child.task.runId !== options.runId) {
    throw new Error(`Native Supervisor task runId is not current for ${options.child}`);
  }
  if (child.task.role === 'builder') {
    child.status = 'ready';
    child.candidateCommit = null;
  } else {
    // A cancelled Verifier keeps the candidate and can be safely redispatched
    // without rebuilding it. `active` has no dispatch path and would strand
    // the Child after a normal cancellation.
    child.status = 'needs-reverify';
  }
  child.task = null;
  child.blocker = options.reason;
  recordEvent(next, {
    kind: 'task-cancelled',
    child: options.child,
    runId: options.runId,
    summary: options.reason,
  });
  next.stateVersion += 1;
  return next;
}

export function blockNativeSupervisorTask(
  state: NativeSupervisorState,
  options: { child: string; runId: string; reason: string },
): NativeSupervisorState {
  if (options.reason.trim().length === 0)
    throw new Error('Native Supervisor blocker reason is required');
  const next = cloneState(state);
  const child = next.children.find(({ name }) => name === options.child);
  if (!child?.task || child.task.runId !== options.runId) {
    throw new Error(`Native Supervisor task runId is not current for ${options.child}`);
  }
  child.blocker = options.reason;
  recordEvent(next, {
    kind: 'task-blocked',
    child: options.child,
    runId: options.runId,
    summary: options.reason,
  });
  next.stateVersion += 1;
  return next;
}

export async function dispatchNativeSupervisorReadyTasks(options: {
  paths: NativeProjectPaths;
  parent: string;
  maxParallel?: number;
}): Promise<{ state: NativeSupervisorState; tasks: NativeSupervisorTask[] }> {
  return withNativeMutationLock(
    options.paths,
    `dispatch Native Supervisor children ${options.parent}`,
    async () => {
      const state = await readNativeSupervisorState(options.paths, options.parent);
      if (!state) throw new Error(`Native Supervisor state is missing for ${options.parent}`);
      const maxParallel = options.maxParallel ?? 2;
      if (!Number.isSafeInteger(maxParallel) || maxParallel < 1) {
        throw new Error('Native Supervisor maxParallel must be a positive integer');
      }
      const activeTasks = state.children.filter(({ task }) => task !== null).length;
      const capacity = Math.max(0, maxParallel - activeTasks);
      if (capacity === 0) return { state, tasks: [] };
      const sourceConfig = await readProjectConfig(options.paths.projectRoot);
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
    },
  );
}

export function applyNativeSupervisorBuilderResult(
  state: NativeSupervisorState,
  options: { child: string; runId: string; candidateCommit: string },
): NativeSupervisorState {
  assertCommit(options.candidateCommit, 'Native Supervisor candidate commit');
  const next = cloneState(state);
  const child = next.children.find(({ name }) => name === options.child);
  if (!child) throw new Error(`Native Supervisor child ${options.child} does not exist`);
  if (!child.task || child.task.role !== 'builder' || child.task.runId !== options.runId) {
    throw new Error(`Native Supervisor Builder result runId is not current for ${options.child}`);
  }
  if (child.status !== 'active') {
    throw new Error(`Native Supervisor child ${options.child} is not active for Builder result`);
  }
  child.candidateCommit = options.candidateCommit;
  child.task = null;
  child.blocker = null;
  recordEvent(next, {
    kind: 'builder-result',
    child: child.name,
    runId: options.runId,
    summary: 'Builder candidate recorded',
  });
  next.stateVersion += 1;
  return next;
}

export function applyNativeSupervisorVerifierResult(
  state: NativeSupervisorState,
  options: {
    child: string;
    runId: string;
    verdict: 'pass' | 'fail' | 'incomplete';
    evidence: NativeSupervisorVerificationEvidence;
  },
): NativeSupervisorState {
  if (options.evidence.summary.trim().length === 0) {
    throw new Error('Native Supervisor verification summary must not be empty');
  }
  if (options.verdict === 'pass' && options.evidence.checks.length === 0) {
    throw new Error('Native Supervisor verification pass requires at least one check');
  }
  const next = cloneState(state);
  const child = next.children.find(({ name }) => name === options.child);
  if (!child) throw new Error(`Native Supervisor child ${options.child} does not exist`);
  if (!child.task || child.task.role !== 'verifier' || child.task.runId !== options.runId) {
    throw new Error(`Native Supervisor Verifier result runId is not current for ${options.child}`);
  }
  if ((child.status !== 'active' && child.status !== 'needs-reverify') || !child.candidateCommit) {
    throw new Error(`Native Supervisor child ${options.child} is not ready for Verifier result`);
  }
  child.verification = {
    summary: options.evidence.summary,
    checks: [...options.evidence.checks],
  };
  child.task = null;
  if (options.verdict === 'pass') {
    child.status = 'verified';
    child.verifiedCommit = child.candidateCommit;
    child.blocker = null;
  } else {
    child.status = 'needs-reverify';
    child.blocker = options.evidence.summary;
  }
  recordEvent(next, {
    kind: 'verifier-result',
    child: child.name,
    runId: options.runId,
    summary: options.evidence.summary,
  });
  next.stateVersion += 1;
  return next;
}

export function integrateNativeSupervisorChild(
  state: NativeSupervisorState,
  options: {
    name: string;
    integrationCommit: string;
    checks: NativeSupervisorIntegrationCheck[];
  },
): NativeSupervisorState {
  assertCommit(options.integrationCommit, 'Native Supervisor integration commit');
  const next = cloneState(state);
  const child = next.children.find(({ name }) => name === options.name);
  if (!child) throw new Error(`Native Supervisor child ${options.name} does not exist`);
  if (child.status !== 'verified' || !child.verifiedCommit) {
    throw new Error(`Native Supervisor child ${options.name} must be verified before integration`);
  }
  if (options.checks.length === 0 || options.checks.some(({ status }) => status !== 'passed')) {
    throw new Error(`Native Supervisor child ${options.name} integration checks are incomplete`);
  }
  child.status = 'integrated';
  child.integrationCommit = options.integrationCommit;
  child.checks = structuredClone(options.checks);
  child.blocker = null;
  next.integration.headCommit = options.integrationCommit;
  recordEvent(next, {
    kind: 'child-integrated',
    child: child.name,
    runId: null,
    summary: 'Child integrated into the Supervisor branch',
  });
  for (const candidate of next.children) {
    if (candidate.status !== 'pending') continue;
    if (
      candidate.dependsOn.every((dependency) =>
        next.children.some(({ name, status }) => name === dependency && status === 'integrated'),
      )
    ) {
      candidate.status = 'ready';
    }
  }
  next.stateVersion += 1;
  return next;
}

/**
 * Merge one verified Child into the dedicated integration worktree.
 *
 * Git is the source of truth for the resulting integration commit. A failed
 * merge deliberately leaves the worktree in place for diagnosis and does not
 * advance the persisted Supervisor state.
 */
export async function integrateNativeSupervisorChildWorkspace(options: {
  paths: NativeProjectPaths;
  state: NativeSupervisorState;
  name: string;
  checks: NativeSupervisorIntegrationCheck[];
}): Promise<NativeSupervisorState> {
  return withNativeMutationLock(
    options.paths,
    `integrate Native Supervisor child ${options.name}`,
    async () => {
      const persisted = await readNativeSupervisorState(options.paths, options.state.parent);
      const state = persisted ?? options.state;
      if (state.stateVersion !== options.state.stateVersion) {
        throw new Error('Native Supervisor state changed before integration; reload status first');
      }
      const child = state.children.find(({ name }) => name === options.name);
      if (!child) throw new Error(`Native Supervisor child ${options.name} does not exist`);
      // Keep integration deterministic using a stable topological order with
      // declaration order as the same-level tie-breaker.
      const nextInIntegrationOrder = stableSupervisorIntegrationOrder(state).find(
        ({ status }) => status !== 'integrated' && status !== 'archived',
      );
      if (nextInIntegrationOrder && nextInIntegrationOrder.name !== options.name) {
        throw new Error(
          `Native Supervisor integration order requires ${nextInIntegrationOrder.name} before ${options.name}`,
        );
      }
      if (child.status !== 'verified' || !child.verifiedCommit) {
        throw new Error(
          `Native Supervisor child ${options.name} must be verified before integration`,
        );
      }
      let head = assertNativeSupervisorIntegrationWorkspace(state);
      if (head !== state.integration.headCommit) {
        // A process can die after Git has committed the merge but before the
        // atomic Supervisor state write. Reconcile that fact instead of
        // attempting a second merge or rejecting the recoverable operation.
        const oldHeadIsAncestor = (() => {
          try {
            runGitCommand(state.integration.worktree, [
              'merge-base',
              '--is-ancestor',
              state.integration.headCommit,
              head,
            ]);
            return true;
          } catch {
            return false;
          }
        })();
        const verifiedIsAncestor = (() => {
          try {
            runGitCommand(state.integration.worktree, [
              'merge-base',
              '--is-ancestor',
              child.verifiedCommit,
              head,
            ]);
            return true;
          } catch {
            return false;
          }
        })();
        if (!oldHeadIsAncestor || !verifiedIsAncestor) {
          throw new Error(
            `Native Supervisor integration head drifted: expected ${state.integration.headCommit}, got ${head}`,
          );
        }
      }
      try {
        runGitCommand(state.integration.worktree, [
          'cat-file',
          '-e',
          `${child.verifiedCommit}^{commit}`,
        ]);
      } catch (error) {
        throw new Error(
          `Native Supervisor verified commit is unavailable: ${child.verifiedCommit}`,
          { cause: error },
        );
      }
      if (head === state.integration.headCommit) {
        try {
          runGitCommand(state.integration.worktree, [
            'merge',
            '--no-ff',
            '--no-edit',
            child.verifiedCommit,
          ]);
        } catch (error) {
          throw new Error(
            `Native Supervisor integration conflict preserved in ${state.integration.worktree}`,
            { cause: error },
          );
        }
        head = runGitCommand(state.integration.worktree, ['rev-parse', 'HEAD']);
      }
      const integrationCommit = head;
      const next = integrateNativeSupervisorChild(state, {
        name: options.name,
        integrationCommit,
        checks: options.checks,
      });
      await writeNativeSupervisorState(options.paths, next);
      return next;
    },
  );
}

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

/**
 * Bring a drifted target into the isolated integration branch. The target is
 * never modified here; the caller must rerun parent checks before delivery.
 */
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

export function recordNativeSupervisorFinalVerification(
  state: NativeSupervisorState,
  options: {
    status: 'passed' | 'failed' | 'incomplete';
    summary: string;
    headCommit: string;
    layers: NonNullable<NativeSupervisorState['finalVerification']['layers']>;
  },
): NativeSupervisorState {
  assertCommit(options.headCommit, 'Native Supervisor final verification head commit');
  if (options.summary.trim().length === 0) {
    throw new Error('Native Supervisor final verification summary must not be empty');
  }
  const next = cloneState(state);
  if (options.headCommit !== next.integration.headCommit) {
    throw new Error('Native Supervisor final verification head is stale');
  }
  if (options.status === 'passed') {
    if (next.children.some(({ status }) => status !== 'integrated')) {
      throw new Error(
        'Native Supervisor cannot pass final verification before all children integrate',
      );
    }
    if (options.layers.parentChecks.length === 0) {
      throw new Error('Native Supervisor parent verification requires executed parent checks');
    }
    if (
      options.layers.childVerification !== 'complete' ||
      options.layers.parentIntegration !== 'complete' ||
      options.layers.incomplete.length > 0
    ) {
      throw new Error('Native Supervisor final verification evidence is incomplete');
    }
  }
  next.finalVerification = {
    status: options.status,
    summary: options.summary,
    layers: {
      childVerification: options.layers.childVerification,
      parentIntegration: options.layers.parentIntegration,
      parentChecks: [...options.layers.parentChecks],
      notRerun: [...options.layers.notRerun],
      incomplete: [...options.layers.incomplete],
    },
  };
  next.stateVersion += 1;
  return next;
}

/**
 * Record a final verification against the actual integration workspace HEAD.
 * Parent-level review fixes may legitimately advance that branch after the
 * final Child integration, but only a clean forward descendant can become the
 * verified delivery commit.
 */
export function advanceNativeSupervisorFinalVerificationHead(
  state: NativeSupervisorState,
): NativeSupervisorState {
  const workspaceHead = assertNativeSupervisorIntegrationWorkspace(state);
  if (workspaceHead === state.integration.headCommit) return state;
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
  recordEvent(reconciled, {
    kind: 'integration-head-reconciled',
    child: null,
    runId: null,
    summary: 'Parent-level commits were included in final verification',
  });
  reconciled.stateVersion += 1;
  return reconciled;
}

/** Recover the Supervisor half of a final result already persisted in Portable State. */
export function recordNativeSupervisorPortableFinalVerification(
  state: NativeSupervisorState,
  portable: NativePortableState,
): NativeSupervisorState {
  const verification = portable.verification;
  if (verification === null || portable.verification_result === 'pending') {
    throw new Error('Native Supervisor final verification has no persisted Portable result');
  }
  const headCommit = assertNativeSupervisorIntegrationWorkspace(state);
  const childVerification = state.children.every(
    ({ status, verification: childEvidence }) =>
      (status === 'integrated' || status === 'archived') && childEvidence !== null,
  );
  const parentIntegration =
    verification.checks.length > 0 &&
    verification.checks.every(({ status }) => status === 'passed');
  return recordNativeSupervisorFinalVerification(state, {
    status:
      portable.verification_result === 'pass'
        ? 'passed'
        : portable.verification_result === 'blocked'
          ? 'incomplete'
          : 'failed',
    summary: verification.summary.text,
    headCommit,
    layers: {
      childVerification: childVerification ? 'complete' : 'incomplete',
      parentIntegration: parentIntegration ? 'complete' : 'incomplete',
      parentChecks: verification.checks.map(({ name }) => name.text),
      notRerun: state.children.flatMap(
        ({ verification: childEvidence }) => childEvidence?.checks ?? [],
      ),
      incomplete: verification.checks
        .filter(({ status }) => status !== 'passed')
        .map(({ name }) => name.text),
    },
  });
}

async function finalizeNativeSupervisorDeliveryLocked(options: {
  paths: NativeProjectPaths;
  state: NativeSupervisorState;
}): Promise<{ state: NativeSupervisorState; targetRoot: string; targetCommit: string }> {
  const persisted = await readNativeSupervisorState(options.paths, options.state.parent);
  const state = persisted ?? options.state;
  if (state.stateVersion !== options.state.stateVersion) {
    throw new Error('Native Supervisor state changed before delivery; reload status first');
  }
  if (state.finalVerification.status !== 'passed') {
    throw new Error('Native Supervisor delivery requires a passed final verification');
  }
  const allChildrenIntegrated = state.children.every(
    ({ status }) => status === 'integrated' || status === 'archived',
  );
  if (!allChildrenIntegrated) {
    throw new Error('Native Supervisor delivery requires every child to be integrated');
  }
  const targetRoot = listGitWorktreeRoots(options.paths.projectRoot)
    .map((root) => path.resolve(root))
    .find((root) => inspectGitWorktree(root).currentBranch === state.integration.targetBranch);
  if (!targetRoot) {
    throw new Error(
      `Native Supervisor target branch worktree is unavailable: ${state.integration.targetBranch}`,
    );
  }
  if (!gitWorktreeIsClean(targetRoot)) {
    throw new Error(`Native Supervisor target worktree is not clean: ${targetRoot}`);
  }
  const targetHeadBeforeDelivery = runGitCommand(targetRoot, ['rev-parse', 'HEAD']);
  const targetContainsIntegration = (() => {
    try {
      runGitCommand(targetRoot, [
        'merge-base',
        '--is-ancestor',
        state.integration.headCommit,
        targetHeadBeforeDelivery,
      ]);
      return true;
    } catch {
      return false;
    }
  })();
  const alreadyDelivered = targetContainsIntegration;
  if (alreadyDelivered) {
    const plan = await loadOrPreflightNativeSupervisorCleanup({
      paths: options.paths,
      state,
      targetCommit: targetHeadBeforeDelivery,
    });
    await executeNativeSupervisorCleanup({ paths: options.paths, plan });
    if (state.children.every(({ status }) => status === 'archived')) {
      await clearNativeSupervisorCleanupJournal(options.paths, state.parent);
      return { state, targetRoot, targetCommit: targetHeadBeforeDelivery };
    }
    const next = cloneState(state);
    for (const child of next.children) child.status = 'archived';
    next.stateVersion += 1;
    await writeNativeSupervisorState(options.paths, next);
    await clearNativeSupervisorCleanupJournal(options.paths, state.parent);
    return { state: next, targetRoot, targetCommit: targetHeadBeforeDelivery };
  }

  const integrationHead = assertNativeSupervisorIntegrationWorkspace(state);
  if (integrationHead !== state.integration.headCommit) {
    throw new Error('Native Supervisor integration head changed after final verification');
  }
  const targetRefBeforeDelivery = resolveGitRef(
    options.paths.projectRoot,
    state.integration.targetBranch,
  );
  const targetAlreadyIncluded = (() => {
    if (!targetRefBeforeDelivery) return false;
    try {
      runGitCommand(state.integration.worktree, [
        'merge-base',
        '--is-ancestor',
        targetRefBeforeDelivery,
        integrationHead,
      ]);
      return true;
    } catch {
      return false;
    }
  })();
  if (targetRefBeforeDelivery !== integrationHead) {
    if (!targetAlreadyIncluded && targetRefBeforeDelivery !== state.integration.targetCommit) {
      const refreshed = await refreshNativeSupervisorTarget({ paths: options.paths, state });
      if (refreshed) {
        throw new Error(
          'Native Supervisor target changed; parent integration checks must be rerun before delivery',
        );
      }
    }
  }
  const cleanupPlan = await loadOrPreflightNativeSupervisorCleanup({
    paths: options.paths,
    state,
    targetCommit: integrationHead,
  });
  if (targetRefBeforeDelivery !== integrationHead) {
    runGitCommand(targetRoot, ['merge', '--ff-only', state.integration.branch]);
  }
  const targetCommit = runGitCommand(targetRoot, ['rev-parse', 'HEAD']);
  if (targetCommit !== integrationHead) {
    throw new Error('Native Supervisor target did not receive the verified integration head');
  }
  const next = cloneState(state);
  for (const child of next.children) child.status = 'archived';
  await executeNativeSupervisorCleanup({ paths: options.paths, plan: cleanupPlan });
  next.stateVersion += 1;
  await writeNativeSupervisorState(options.paths, next);
  await clearNativeSupervisorCleanupJournal(options.paths, state.parent);
  return { state: next, targetRoot, targetCommit };
}

interface NativeSupervisorCleanupPlan {
  parent: string;
  targetCommit: string;
  worktrees: string[];
  expectedBranches: Record<string, string>;
  branches: string[];
}

function nativeSupervisorCleanupJournalFile(
  paths: Pick<NativeProjectPaths, 'changesRuntimeDir'>,
  parent: string,
): string {
  return path.join(nativeSupervisorRuntimeDir(paths, parent), 'cleanup.json');
}

function preflightNativeSupervisorCleanup(options: {
  paths: NativeProjectPaths;
  state: NativeSupervisorState;
  targetCommit: string;
}): NativeSupervisorCleanupPlan {
  const roots = listGitWorktreeRoots(options.paths.projectRoot).map((root) => path.resolve(root));
  const currentRoot = path.resolve(process.cwd());
  const candidateSpecs = [
    {
      root: options.state.integration.worktree,
      branch: options.state.integration.branch,
    },
    ...options.state.children.map(({ name }) => ({
      root: nativeSupervisorChildWorktree(options.paths.projectRoot, options.state.parent, name),
      branch: `comet/supervisor/${options.state.parent}/${name}`,
    })),
  ].map((candidate) => ({ ...candidate, root: path.resolve(candidate.root) }));
  const targetCommit = options.targetCommit;
  const branches = [
    options.state.integration.branch,
    ...options.state.children.map(({ name }) => `comet/supervisor/${options.state.parent}/${name}`),
  ];

  const registeredCandidates = candidateSpecs.flatMap((candidate) => {
    const registered = roots.find((root) => root === candidate.root);
    return registered ? [{ ...candidate, root: registered }] : [];
  });

  // Complete all safety checks before removing anything. A clean worktree is
  // not sufficient: its branch must also be fully contained in the delivered
  // target commit, otherwise cleanup would discard an unintegrated commit.
  for (const candidate of registeredCandidates) {
    if (isPathInside(candidate.root, currentRoot)) {
      throw new Error(`Native Supervisor cannot clean the current worktree: ${candidate.root}`);
    }
    if (!gitWorktreeIsClean(candidate.root)) {
      throw new Error(`Native Supervisor cleanup requires a clean worktree: ${candidate.root}`);
    }
    const branch = inspectGitWorktree(candidate.root).currentBranch;
    if (!branch) throw new Error(`Native Supervisor worktree is detached: ${candidate.root}`);
    if (branch !== candidate.branch) {
      throw new Error(
        `Native Supervisor cleanup found unexpected branch ${branch} for ${candidate.root}; expected ${candidate.branch}`,
      );
    }
    try {
      runGitCommand(options.paths.projectRoot, [
        'merge-base',
        '--is-ancestor',
        branch,
        targetCommit,
      ]);
    } catch {
      throw new Error(`Native Supervisor cleanup found unintegrated branch ${branch}`);
    }
  }
  for (const branch of branches) {
    if (!isLocalGitBranch(options.paths.projectRoot, branch)) continue;
    try {
      runGitCommand(options.paths.projectRoot, [
        'merge-base',
        '--is-ancestor',
        branch,
        targetCommit,
      ]);
    } catch {
      throw new Error(`Native Supervisor cleanup found unintegrated branch ${branch}`);
    }
  }

  return {
    parent: options.state.parent,
    targetCommit: options.targetCommit,
    worktrees: registeredCandidates.map(({ root }) => root),
    expectedBranches: Object.fromEntries(
      registeredCandidates.map(({ root, branch }) => [root, branch]),
    ),
    branches,
  };
}

async function loadOrPreflightNativeSupervisorCleanup(options: {
  paths: NativeProjectPaths;
  state: NativeSupervisorState;
  targetCommit: string;
}): Promise<NativeSupervisorCleanupPlan> {
  const journal = nativeSupervisorCleanupJournalFile(options.paths, options.state.parent);
  try {
    const parsed = JSON.parse(await fs.readFile(journal, 'utf8')) as NativeSupervisorCleanupPlan;
    if (
      parsed.parent === options.state.parent &&
      parsed.targetCommit === options.targetCommit &&
      Array.isArray(parsed.worktrees) &&
      parsed.expectedBranches &&
      typeof parsed.expectedBranches === 'object' &&
      Array.isArray(parsed.branches)
    ) {
      // A journal makes execution resumable, but it never bypasses the
      // safety preflight: a worktree may have become dirty while a previous
      // cleanup attempt was interrupted.
      const refreshed = preflightNativeSupervisorCleanup(options);
      return {
        parent: parsed.parent,
        targetCommit: parsed.targetCommit,
        worktrees: [...new Set([...parsed.worktrees, ...refreshed.worktrees])],
        expectedBranches: {
          ...parsed.expectedBranches,
          ...refreshed.expectedBranches,
        },
        branches: [...new Set([...parsed.branches, ...refreshed.branches])],
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const plan = preflightNativeSupervisorCleanup(options);
  await atomicWriteJson(journal, plan, { containedRoot: options.paths.changesRuntimeDir });
  return plan;
}

async function executeNativeSupervisorCleanup(options: {
  paths: NativeProjectPaths;
  plan: NativeSupervisorCleanupPlan;
}): Promise<void> {
  for (const worktree of options.plan.worktrees) {
    const registered = listGitWorktreeRoots(options.paths.projectRoot)
      .map((root) => path.resolve(root))
      .includes(path.resolve(worktree));
    if (!registered) continue;
    const expectedBranch = options.plan.expectedBranches[worktree];
    if (!expectedBranch) {
      throw new Error(`Native Supervisor cleanup has no expected branch for ${worktree}`);
    }
    const currentBranch = inspectGitWorktree(worktree).currentBranch;
    if (currentBranch !== expectedBranch) {
      throw new Error(
        `Native Supervisor cleanup found unexpected branch ${currentBranch ?? '(detached)'} for ${worktree}; expected ${expectedBranch}`,
      );
    }
    runGitCommand(options.paths.projectRoot, ['worktree', 'remove', worktree]);
  }
  for (const branch of options.plan.branches) {
    if (!isLocalGitBranch(options.paths.projectRoot, branch)) continue;
    runGitCommand(options.paths.projectRoot, ['branch', '-d', branch]);
  }
}

async function clearNativeSupervisorCleanupJournal(
  paths: Pick<NativeProjectPaths, 'changesRuntimeDir'>,
  parent: string,
): Promise<void> {
  await fs.rm(nativeSupervisorCleanupJournalFile(paths, parent), { force: true });
}

export async function finalizeNativeSupervisorDelivery(options: {
  paths: NativeProjectPaths;
  state: NativeSupervisorState;
}): Promise<{ state: NativeSupervisorState; targetRoot: string; targetCommit: string }> {
  return withNativeMutationLock(
    options.paths,
    `deliver Native Supervisor ${options.state.parent}`,
    () => finalizeNativeSupervisorDeliveryLocked(options),
  );
}

/**
 * Run the final target delivery while an enclosing Portable Archive transaction
 * already owns the Native mutation lock.
 */
export { finalizeNativeSupervisorDeliveryLocked };

export function projectNativeSupervisorChildren(
  state: NativeSupervisorState,
): NativeChildrenInspection {
  const children: NativeChildStatusProjection[] = state.children.map((child) => ({
    name: child.name,
    summary: child.summary,
    dependsOn: [...child.dependsOn],
    covers: [],
    status: child.status,
    phase: null,
    projectRoot: child.projectRoot ?? child.task?.projectRoot ?? null,
    message: child.blocker,
  }));
  return {
    contractHash: null,
    confirmed: true,
    parentBranch: state.integration.branch,
    children,
    readyChildren: children.filter(({ status }) => status === 'ready').map(({ name }) => name),
    allDone: children.every(({ status }) => status === 'integrated' || status === 'archived'),
  };
}
