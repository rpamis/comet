import { nativeWorkspaceIsClean, removeNativeWorkspaceConfig } from './native-workspace-config.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';

import { atomicWriteJson } from './native-atomic-file.js';
import { canonicalHash } from './native-canonical-hash.js';
import {
  executeNativeCheck,
  preflightNativeCheckPlans,
  type NativeCheckPlan,
  type NativeExecutedCheck,
} from './native-check-executor.js';
import {
  validateNativeVerifierFinalResultConsistency,
  type NativeVerifierAcceptanceResult,
} from './native-verifier-protocol.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { nativePreferredChangeRuntimeDir } from './native-paths.js';
import {
  completedNativeSupervisorCheckState,
  nativeSupervisorCheckInputFingerprint,
  nativeSupervisorCheckMachineId,
  nativeSupervisorExecutedCheckFromState,
  plannedNativeSupervisorCheckState,
} from './native-supervisor-check-binding.js';
import { readProjectConfig } from './native-config.js';
import {
  inspectGitWorktree,
  isLocalGitBranch,
  listGitWorktreeRoots,
  resolveGitRef,
} from '../../platform/paths/git-worktree.js';
import { resolvePortablePath } from '../../platform/paths/portable-path.js';
import { runGitCommand } from '../../platform/process/git.js';
import {
  processInstanceMayBeAlive,
  readProcessIdentity,
} from '../../platform/process/process-identity.js';
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
  acceptance?: NativeVerifierAcceptanceResult[];
  receiptRef?: string;
  execution?: NativeSupervisorTask;
}

export interface NativeSupervisorIntegrationCheck {
  name: string;
  status: 'passed' | 'failed' | 'incomplete';
  reason?: string | null;
  receiptRef?: string;
}

export interface NativeSupervisorCheckExecutionState {
  id: string;
  name: string;
  status: 'planned' | 'running' | 'passed' | 'failed' | 'interrupted';
  repeatable: boolean;
  executionCount: number;
  argvDisplay: string[];
  cwdRef: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  startedAt: string | null;
  completedAt: string | null;
  logRef: string | null;
}

export interface NativeSupervisorTask {
  role: 'builder' | 'verifier';
  child: string;
  projectRoot: string;
  baseCommit: string;
  runId: string;
  acceptance?: Array<{ id: string; source: string; text: string }>;
  contractHash?: string;
  verificationBoundary?: 'child-scope-parent-reverifies-all';
  checksReason?: 'not-run' | 'running' | 'completed';
  checkExecution?: {
    operationId: string;
    key: string;
    status: 'running' | 'completed' | 'interrupted';
    ownerPid: number;
    ownerIdentity?: string;
    activeProcess?:
      | null
      | { status: 'starting'; checkId: string }
      | { status: 'running'; checkId: string; pid: number; identity?: string };
    startedAt: string;
    expiresAt?: string;
    receiptRef?: string;
    machineId?: string;
    inputFingerprint?: string;
    checkStates?: NativeSupervisorCheckExecutionState[];
  };
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
  acceptanceScope?: Array<{ id: string; source: string; text: string }>;
  contractHash?: string;
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
    checkExecution?: NonNullable<NativeSupervisorTask['checkExecution']> & {
      child: string;
      candidateCommit: string;
      integrationCommit: string;
      checks?: NativeSupervisorIntegrationCheck[];
      error?: string;
    };
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
    if (key === 'checkExecution') continue;
    if (typeof valueToCheck !== 'string' || valueToCheck.length === 0) {
      throw new Error(`Native Supervisor integration field ${key} is invalid`);
    }
  }
  assertCommit(state.integration.targetCommit, 'Native Supervisor target commit');
  assertCommit(state.integration.headCommit, 'Native Supervisor integration head commit');
  if (state.integration.checkExecution) {
    const execution = state.integration.checkExecution;
    if (
      !execution.operationId ||
      !execution.key ||
      !execution.child ||
      !['running', 'completed', 'interrupted'].includes(execution.status) ||
      !Number.isSafeInteger(execution.ownerPid) ||
      execution.ownerPid <= 0
    ) {
      throw new Error('Native Supervisor integration check execution is invalid');
    }
    assertCommit(execution.candidateCommit, 'Native Supervisor integration candidate commit');
    assertCommit(execution.integrationCommit, 'Native Supervisor integration check commit');
    assertSupervisorCheckStates(execution.checkStates, 'Native Supervisor integration');
  }
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
      if (child.task.checkExecution) {
        assertSupervisorCheckStates(
          child.task.checkExecution.checkStates,
          `Native Supervisor child ${child.name}`,
        );
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
  options: { diagnostics?: boolean } = {},
): Promise<NativeSupervisorState | null> {
  try {
    const source = await fs.readFile(nativeSupervisorStateFile(paths, parent), 'utf8');
    const parsed: unknown = JSON.parse(source);
    assertSupervisorState(parsed);
    if (
      parsed.children.some(
        (child) => !child.acceptanceScope || (child.task && !child.task.acceptance),
      )
    ) {
      try {
        const projectPaths = paths as NativeProjectPaths;
        if (!projectPaths.changesDir)
          throw new Error(
            'Native Supervisor upgrade requires full project paths to recover confirmed acceptance',
          );
        const { readNativeChildrenContract, nativeChildrenAcceptanceValidation } =
          await import('./native-children.js');
        const { readNativePortableState } = await import('./native-portable-state.js');
        const portable = await readNativePortableState(
          path.join(projectPaths.changesDir, parent, 'comet-state.yaml'),
        );
        const document = await readNativeChildrenContract({
          changeDir: path.join(projectPaths.changesDir, parent),
          acceptanceIds: portable.acceptance.map(({ id }) => id),
          validation: nativeChildrenAcceptanceValidation(portable),
        });
        if (!document)
          throw new Error('Native Supervisor upgrade requires the confirmed children contract');
        for (const child of parsed.children) {
          if (!document.contract.children.some(({ name }) => name === child.name)) continue;
          child.acceptanceScope = supervisorAcceptanceScope(document.contract, child.name);
          child.contractHash = canonicalHash(
            'comet.native.supervisor-contract.v1',
            document.contract,
          );
          if (child.task) {
            child.task.acceptance = structuredClone(child.acceptanceScope);
            child.task.contractHash = child.contractHash;
            child.task.verificationBoundary = 'child-scope-parent-reverifies-all';
            child.task.checksReason = 'not-run';
          }
        }
      } catch (error) {
        // Diagnostics must retain the persisted tasks and worktree identities even
        // when the formal contract needed for an upgrade is unavailable.
        // Mutation callers keep the strict default and cannot use unknown scope.
        if (!options.diagnostics) throw error;
      }
    }
    // Older releases delivered directly to the eventual finish target. The
    // portable binding owns that choice: Supervisor delivers to the parent
    // change branch, and Archive performs the separately selected finish.
    const projectPaths = paths as NativeProjectPaths;
    if (projectPaths.changesDir) {
      try {
        const { readNativePortableState } = await import('./native-portable-state.js');
        const portable = await readNativePortableState(
          path.join(projectPaths.changesDir, parent, 'comet-state.yaml'),
        );
        if (portable.workspace.change_branch) {
          parsed.integration.targetBranch = portable.workspace.change_branch;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
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

function assertSupervisorCheckStates(
  states: NativeSupervisorCheckExecutionState[] | undefined,
  label: string,
): void {
  if (states === undefined) return;
  if (!Array.isArray(states) || states.length === 0) {
    throw new Error(`${label} check states are invalid`);
  }
  const ids = new Set<string>();
  for (const state of states) {
    if (
      !state ||
      typeof state.id !== 'string' ||
      !state.id ||
      ids.has(state.id) ||
      typeof state.name !== 'string' ||
      !['planned', 'running', 'passed', 'failed', 'interrupted'].includes(state.status) ||
      typeof state.repeatable !== 'boolean' ||
      !Number.isSafeInteger(state.executionCount) ||
      state.executionCount < 0 ||
      !Array.isArray(state.argvDisplay) ||
      !state.argvDisplay.every((entry) => typeof entry === 'string') ||
      typeof state.cwdRef !== 'string' ||
      !Number.isSafeInteger(state.durationMs) ||
      state.durationMs < 0 ||
      (state.exitCode !== null && !Number.isSafeInteger(state.exitCode)) ||
      (state.signal !== null && typeof state.signal !== 'string') ||
      typeof state.timedOut !== 'boolean' ||
      (state.startedAt !== null && typeof state.startedAt !== 'string') ||
      (state.completedAt !== null && typeof state.completedAt !== 'string') ||
      (state.logRef !== null && typeof state.logRef !== 'string')
    ) {
      throw new Error(`${label} check state is invalid`);
    }
    ids.add(state.id);
  }
}

function supervisorRetryIds(value: readonly string[] | undefined): Set<string> | null {
  if (value === undefined) return null;
  const result = new Set(value);
  if (result.size === 0 || result.size !== value.length) {
    throw new Error('Native Supervisor retry IDs must be non-empty and unique');
  }
  return result;
}

function assertSupervisorRetryableStates(
  states: readonly NativeSupervisorCheckExecutionState[] | undefined,
  plans: readonly NativeCheckPlan[],
  requested: ReadonlySet<string>,
): void {
  if (!states) {
    throw new Error('Native Supervisor check retry requires per-check Runtime state');
  }
  const plansById = new Map(plans.map((plan) => [plan.id, plan]));
  for (const id of requested) {
    const state = states.find((entry) => entry.id === id);
    const plan = plansById.get(id);
    if (!state || !plan || state.status !== 'interrupted') {
      throw new Error(`Native Supervisor retry ID is not an interrupted current check: ${id}`);
    }
    if (!state.repeatable || !plan.repeatable) {
      throw new Error(`Native Supervisor check ${id} is not repeatable and cannot be retried`);
    }
    if (state.executionCount >= 3) {
      throw new Error(`Native Supervisor check retry limit (3) reached: ${id}`);
    }
  }
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
    acceptanceScope: supervisorAcceptanceScope(options.contract, child.name),
    contractHash: canonicalHash('comet.native.supervisor-contract.v1', options.contract),
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

function supervisorAcceptanceScope(contract: NativeChildrenContract, name: string) {
  const child = contract.children.find((entry) => entry.name === name)!;
  return child.covers.length > 0
    ? child.covers.map((id) => ({
        id,
        source: contract.acceptance_index?.[id]?.source ?? 'brief.md',
        text: contract.acceptance_index?.[id]?.text ?? id,
      }))
    : [{ id: `child:${name}`, source: 'children.yaml', text: child.summary ?? name }];
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
    const nextScope = supervisorAcceptanceScope(options.contract, child.name);
    const nextContractHash = canonicalHash('comet.native.supervisor-contract.v1', options.contract);
    if (
      child.contractHash &&
      child.contractHash !== nextContractHash &&
      child.status !== 'integrated' &&
      child.status !== 'archived'
    ) {
      child.task = null;
      child.verifiedCommit = null;
      child.verification = null;
      child.checks = [];
      child.status = child.candidateCommit ? 'needs-reverify' : 'ready';
      child.blocker =
        'Confirmed Supervisor contract changed; verify the current acceptance scope again.';
    }
    child.acceptanceScope = nextScope;
    child.contractHash = nextContractHash;
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
      acceptanceScope: supervisorAcceptanceScope(options.contract, definition.name),
      contractHash: canonicalHash('comet.native.supervisor-contract.v1', options.contract),
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
  validateNativeVerifierFinalResultConsistency(
    { verdict: 'pass', acceptance: options.evidence.acceptance ?? [] },
    {
      acceptanceIds: child.acceptanceScope?.map(({ id }) => id) ?? [`child:${child.name}`],
      requiredChecksPassed: options.evidence.checks.length > 0,
    },
  );
  child.status = 'verified';
  child.baseCommit = options.baseCommit;
  child.candidateCommit = options.verifiedCommit;
  child.verifiedCommit = options.verifiedCommit;
  child.verification = {
    ...structuredClone(options.evidence),
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

/** Build return instructions from current task facts, including the latest receipt. */
export function projectNativeSupervisorTask(
  task: NativeSupervisorTask,
  parent: string,
  controlProjectRoot: string,
) {
  const identity = { child: task.child, runId: task.runId };
  const retryCheckIds = (task.checkExecution?.checkStates ?? [])
    .filter(({ status }) => status === 'interrupted')
    .map(({ id }) => id);
  const templates =
    task.role === 'builder'
      ? [
          { kind: 'supervisor-builder-result', ...identity, candidateCommit: '<candidate-commit>' },
          { kind: 'supervisor-builder-failure', ...identity, reason: '<failure-reason>' },
        ]
      : [
          {
            kind: 'supervisor-checks',
            ...identity,
            checks: [
              {
                id: '<check-id>',
                name: '<check-name>',
                executable: '<executable>',
                argv: [],
                cwdRef: '.',
                timeoutMs: 120000,
                repeatable: true,
              },
            ],
            materials: [],
            ...(retryCheckIds.length > 0 ? { retry_check_ids: retryCheckIds } : {}),
          },
          {
            kind: 'supervisor-verifier-result',
            ...identity,
            verdict: 'blocked',
            evidence: {
              summary: '<verification-summary>',
              checks: [],
              acceptance: (task.acceptance ?? []).map(({ id }) => ({
                id,
                result: 'blocked',
                reason: '<evidence>',
              })),
              receiptRef: task.checkExecution?.receiptRef ?? null,
            },
          },
        ];
  return {
    ...task,
    controlProjectRoot,
    returnAction: {
      cwd: controlProjectRoot,
      commandArgs: [
        'comet',
        'native',
        'next',
        parent,
        '--runner-input',
        '<temporary-json-file>',
        '--json',
      ],
      inputOptions: templates.map((template) => ({
        name: template.kind,
        exclusiveGroup: 'runner-input',
        template,
      })),
    },
  };
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
  const task: NativeSupervisorTask = {
    ...options,
    baseCommit,
    acceptance: child.acceptanceScope ?? [
      { id: `child:${child.name}`, source: 'children.yaml', text: child.summary ?? child.name },
    ],
    contractHash: child.contractHash,
    verificationBoundary: 'child-scope-parent-reverifies-all',
    checksReason: 'not-run',
  };
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

function assertNativeSupervisorIntegrationWorkspace(state: NativeSupervisorState): string {
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

function assertNativeSupervisorVerifierWorkspace(
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
    verdict: 'pass' | 'fail' | 'blocked';
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
  validateNativeVerifierFinalResultConsistency(
    { verdict: options.verdict, acceptance: options.evidence.acceptance ?? [] },
    {
      acceptanceIds: child.task.acceptance?.map(({ id }) => id) ??
        child.acceptanceScope?.map(({ id }) => id) ?? [`child:${child.name}`],
      requiredChecksPassed: options.evidence.checks.length > 0,
    },
  );
  child.verification = {
    ...structuredClone(options.evidence),
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
  checkPlans?: NativeCheckPlan[];
  retryCheckIds?: readonly string[];
}): Promise<NativeSupervisorState> {
  const requestedRetryIds = supervisorRetryIds(options.retryCheckIds);
  const prepared = await withNativeMutationLock(
    options.paths,
    `integrate Native Supervisor child ${options.name}`,
    async () => {
      const persisted = await readNativeSupervisorState(options.paths, options.state.parent);
      const state = persisted ?? options.state;
      const previous = state.integration.checkExecution;
      if (previous?.status === 'running') {
        if (await processInstanceMayBeAlive(previous.ownerPid, previous.ownerIdentity)) {
          throw new Error(
            'Native Supervisor integration checks are already running; wait for the original execution',
          );
        }
        if (previous.activeProcess === undefined || previous.activeProcess?.status === 'starting') {
          throw new Error(
            'Native Supervisor integration check launch was interrupted; inspect the original check process before retrying',
          );
        }
        if (
          previous.activeProcess &&
          (await processInstanceMayBeAlive(
            previous.activeProcess.pid,
            previous.activeProcess.identity,
          ))
        ) {
          throw new Error(
            'Native Supervisor integration check process is still running after its owner stopped; wait for that process before retrying',
          );
        }
      }
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
      if (options.checkPlans) {
        if (options.checkPlans.some(({ repeatable }) => !repeatable))
          throw new Error(
            'Native Supervisor integration checks must be repeatable for safe recovery',
          );
        if (
          options.checkPlans.length === 0 ||
          new Set(options.checkPlans.map(({ id }) => id)).size !== options.checkPlans.length
        )
          throw new Error(
            'Native Supervisor integration requires non-empty checks with unique IDs',
          );
        // Do all command and platform validation before the integration check
        // reservation is persisted. Invalid plans must not consume a lease or
        // leave a recovery record behind.
        preflightNativeCheckPlans(state.integration.worktree, options.checkPlans);
        if (!child.verification?.receiptRef || !child.verification.execution)
          throw new Error(
            'Native Supervisor integration requires current Runtime verification evidence; reverify the child',
          );
        const { readNativeSupervisorCheckEvidence } =
          await import('./native-supervisor-evidence.js');
        const evidence = await readNativeSupervisorCheckEvidence({
          paths: options.paths,
          parent: state.parent,
          task: child.verification.execution,
          receiptRef: child.verification.receiptRef,
        });
        if (
          evidence.candidateCommit !== child.verifiedCommit ||
          evidence.checks.some(({ status }) => status !== 'passed')
        )
          throw new Error('Native Supervisor integration verification evidence is stale or failed');
      }
      let head = assertNativeSupervisorIntegrationWorkspace(state);
      const resumeExistingCheck =
        options.checkPlans !== undefined &&
        previous?.status === 'interrupted' &&
        previous.child === options.name &&
        previous.candidateCommit === child.verifiedCommit &&
        head !== state.integration.headCommit &&
        head === previous.integrationCommit;
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
      if (head === state.integration.headCommit && !resumeExistingCheck) {
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
      if (options.checkPlans) {
        const machineId = nativeSupervisorCheckMachineId();
        const inputFingerprint = await nativeSupervisorCheckInputFingerprint({
          kind: 'integration',
          parent: state.parent,
          child: options.name,
          runId: child.verification?.execution?.runId ?? `integration:${options.name}`,
          projectRoot: state.integration.worktree,
          candidateCommit: child.verifiedCommit,
          integrationCommit,
          contractHash: child.contractHash ?? null,
          plans: options.checkPlans,
          materials: [],
        });
        const key = canonicalHash('comet.native.supervisor-integration-plan.v2', {
          machineId,
          inputFingerprint,
        });
        const sameBinding =
          previous?.key === key &&
          previous.machineId === machineId &&
          previous.inputFingerprint === inputFingerprint &&
          previous.child === options.name &&
          previous.candidateCommit === child.verifiedCommit &&
          previous.integrationCommit === integrationCommit;
        if (requestedRetryIds) {
          if (!sameBinding || previous?.status !== 'interrupted') {
            throw new Error(
              'Native Supervisor integration retry requires the interrupted current plan on the same candidate, machine and workspace',
            );
          }
          assertSupervisorRetryableStates(
            previous.checkStates,
            options.checkPlans,
            requestedRetryIds,
          );
        } else if (previous?.status === 'interrupted' && sameBinding) {
          return { completed: state };
        }
        const priorStates =
          requestedRetryIds && previous?.checkStates
            ? previous.checkStates.map((check) =>
                requestedRetryIds.has(check.id)
                  ? {
                      ...check,
                      status: 'planned' as const,
                      exitCode: null,
                      signal: null,
                      timedOut: false,
                      durationMs: 0,
                      startedAt: null,
                      completedAt: null,
                      logRef: null,
                    }
                  : { ...check },
              )
            : options.checkPlans.map(plannedNativeSupervisorCheckState);
        const checkStates = options.checkPlans.map(
          (plan) =>
            priorStates.find((check) => check.id === plan.id) ??
            plannedNativeSupervisorCheckState(plan),
        );
        const operationId = randomUUID();
        state.integration.checkExecution = {
          operationId,
          key,
          child: options.name,
          candidateCommit: child.verifiedCommit,
          integrationCommit,
          status: 'running',
          ownerPid: process.pid,
          ownerIdentity: (await readProcessIdentity(process.pid)) ?? undefined,
          startedAt: new Date().toISOString(),
          activeProcess: null,
          machineId,
          inputFingerprint,
          checkStates,
        };
        state.stateVersion += 1;
        await writeNativeSupervisorState(options.paths, state);
        return {
          pending: {
            state,
            candidateCommit: child.verifiedCommit,
            integrationCommit,
            operationId,
            key,
            machineId,
            inputFingerprint,
            plansToExecute: options.checkPlans.filter(
              (plan) => !requestedRetryIds || requestedRetryIds.has(plan.id),
            ),
          },
        };
      }
      const next = integrateNativeSupervisorChild(state, {
        name: options.name,
        integrationCommit,
        checks: options.checks,
      });
      await writeNativeSupervisorState(options.paths, next);
      return { completed: next };
    },
  );
  if (prepared.completed) return prepared.completed;
  const { state, candidateCommit, integrationCommit, operationId, key } = prepared.pending!;
  const { writeNativeVerificationReportSnapshot } = await import('./native-evidence-storage.js');
  const { createHash } = await import('node:crypto');
  const recordActiveProcess = async (
    activeProcess: NonNullable<NativeSupervisorTask['checkExecution']>['activeProcess'],
  ) =>
    withNativeMutationLock(
      options.paths,
      'record Supervisor integration check process',
      async () => {
        const current = await readNativeSupervisorState(options.paths, state.parent);
        const execution = current?.integration.checkExecution;
        if (
          !current ||
          execution?.operationId !== operationId ||
          execution.key !== key ||
          execution.status !== 'running'
        )
          throw new Error('Native Supervisor integration check operation is stale');
        if (activeProcess?.status === 'starting') {
          const check = execution.checkStates?.find(({ id }) => id === activeProcess.checkId);
          if (!check || check.status !== 'planned') {
            throw new Error(`Native Supervisor check ${activeProcess.checkId} is not planned`);
          }
          check.status = 'running';
          check.executionCount += 1;
          check.startedAt = new Date().toISOString();
          check.completedAt = null;
          check.logRef = null;
        }
        execution.activeProcess = activeProcess;
        current.stateVersion += 1;
        await writeNativeSupervisorState(options.paths, current);
      },
    );
  const recordCheckResult = async (result: NativeExecutedCheck) =>
    withNativeMutationLock(
      options.paths,
      'record Supervisor integration check result',
      async () => {
        const current = await readNativeSupervisorState(options.paths, state.parent);
        const execution = current?.integration.checkExecution;
        if (
          !current ||
          execution?.operationId !== operationId ||
          execution.key !== key ||
          execution.status !== 'running'
        )
          throw new Error('Native Supervisor integration check operation is stale');
        const check = execution.checkStates?.find(({ id }) => id === result.id);
        if (!check) throw new Error(`Native Supervisor check state is missing: ${result.id}`);
        Object.assign(check, completedNativeSupervisorCheckState(check, result));
        execution.activeProcess = null;
        current.stateVersion += 1;
        await writeNativeSupervisorState(options.paths, current);
      },
    );
  try {
    for (const plan of prepared.pending!.plansToExecute!) {
      await recordActiveProcess({ status: 'starting', checkId: plan.id });
      const result = await executeNativeCheck({
        projectRoot: state.integration.worktree,
        runtimeDir: nativePreferredChangeRuntimeDir(options.paths, state.parent),
        operationId,
        plan,
        onSpawn: async ({ pid }) =>
          recordActiveProcess({
            status: 'running',
            checkId: plan.id,
            pid,
            identity: (await readProcessIdentity(pid)) ?? undefined,
          }),
      });
      await recordCheckResult(result);
      if (result.status === 'interrupted') {
        throw new Error(
          `Native Supervisor integration check ${result.id} was interrupted; retry only the listed repeatable check after the process has exited`,
        );
      }
    }
    const latest = await readNativeSupervisorState(options.paths, state.parent);
    const latestExecution = latest?.integration.checkExecution;
    const checkStates = latestExecution?.checkStates;
    if (
      !latest ||
      !checkStates ||
      checkStates.some(({ status }) => !['passed', 'failed'].includes(status))
    ) {
      throw new Error(
        'Native Supervisor integration check plan remains incomplete; retry each interrupted check explicitly',
      );
    }
    const results = checkStates.map(nativeSupervisorExecutedCheckFromState);
    const text = JSON.stringify({
      schema: 'comet.native.supervisor-integration-checks.v1',
      parent: state.parent,
      child: options.name,
      candidateCommit,
      integrationCommit,
      operationId,
      planHash: key,
      results,
    });
    const receiptRef = await writeNativeVerificationReportSnapshot({
      paths: options.paths,
      name: state.parent,
      hash: createHash('sha256').update(text).digest('hex'),
      text,
    });
    const checks: NativeSupervisorIntegrationCheck[] = results.map((result) => ({
      name: result.name,
      status: result.status === 'interrupted' ? 'incomplete' : result.status,
      reason:
        result.status === 'passed'
          ? null
          : result.timedOut
            ? 'timed out'
            : `exit ${result.exitCode ?? result.signal ?? 'interrupted'}`,
      receiptRef,
    }));
    const unsuccessful = checks.filter(({ status }) => status !== 'passed');
    return await withNativeMutationLock(
      options.paths,
      'complete Supervisor integration checks',
      async () => {
        const current = await readNativeSupervisorState(options.paths, state.parent);
        const child = current?.children.find(({ name }) => name === options.name);
        const execution = current?.integration.checkExecution;
        if (
          !current ||
          !child ||
          execution?.operationId !== operationId ||
          execution.key !== key ||
          execution.status !== 'running' ||
          execution.child !== options.name ||
          execution.candidateCommit !== candidateCommit ||
          execution.integrationCommit !== integrationCommit ||
          child.verifiedCommit !== candidateCommit ||
          assertNativeSupervisorIntegrationWorkspace(current) !== integrationCommit
        )
          throw new Error('Native Supervisor integration changed during checks');
        execution.receiptRef = receiptRef;
        execution.checks = checks;
        if (unsuccessful.length > 0) {
          const message = `Native Supervisor integration checks did not pass (${unsuccessful.map(({ name, reason }) => `${name}: ${reason}`).join('; ')}); receipt ${receiptRef}`;
          execution.status = 'interrupted';
          execution.error = message;
          child.blocker = message;
          current.stateVersion += 1;
          await writeNativeSupervisorState(options.paths, current);
          throw new Error(message);
        }
        execution.status = 'completed';
        const next = integrateNativeSupervisorChild(current, {
          name: options.name,
          integrationCommit,
          checks,
        });
        await writeNativeSupervisorState(options.paths, next);
        return next;
      },
    );
  } catch (error) {
    await withNativeMutationLock(
      options.paths,
      'interrupt Supervisor integration checks',
      async () => {
        const current = await readNativeSupervisorState(options.paths, state.parent);
        const execution = current?.integration.checkExecution;
        if (
          current &&
          execution?.operationId === operationId &&
          execution.key === key &&
          execution.status === 'running'
        ) {
          execution.status = 'interrupted';
          execution.error = (error as Error).message;
          execution.activeProcess = null;
          for (const check of execution.checkStates ?? []) {
            if (check.status === 'planned' || check.status === 'running') {
              check.status = 'interrupted';
            }
          }
          current.stateVersion += 1;
          await writeNativeSupervisorState(options.paths, current);
        }
      },
    );
    throw error;
  }
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
  archiveOwnedPaths?: readonly string[];
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
  const archiveOwned =
    path.resolve(targetRoot) === path.resolve(options.paths.projectRoot)
      ? [
          path
            .relative(targetRoot, path.join(options.paths.changesDir, state.parent))
            .replaceAll('\\', '/'),
          '.comet/current-change.json',
          ...(options.archiveOwnedPaths ?? []),
        ]
      : [];
  if (!nativeWorkspaceIsClean(targetRoot, archiveOwned)) {
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
    await executeNativeSupervisorCleanup({ paths: options.paths, plan, targetRoot });
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
  await executeNativeSupervisorCleanup({
    paths: options.paths,
    plan: cleanupPlan,
    targetRoot,
  });
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
    ...options.state.children.map(({ name, projectRoot, task }) => ({
      root:
        projectRoot ??
        task?.projectRoot ??
        nativeSupervisorChildWorktree(
          inspectGitWorktree(options.paths.projectRoot).primaryWorktreeRoot ??
            options.paths.projectRoot,
          options.state.parent,
          name,
        ),
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
    if (!nativeWorkspaceIsClean(candidate.root)) {
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
  targetRoot: string;
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
    await removeNativeWorkspaceConfig(worktree);
    runGitCommand(options.paths.projectRoot, ['worktree', 'remove', worktree]);
  }
  for (const branch of options.plan.branches) {
    if (!isLocalGitBranch(options.paths.projectRoot, branch)) continue;
    runGitCommand(options.targetRoot, ['branch', '-d', branch]);
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
  const confirmed = state.children.every(
    (child) =>
      child.acceptanceScope &&
      child.acceptanceScope.length > 0 &&
      (!child.task || (child.task.acceptance && child.task.acceptance.length > 0)),
  );
  const children: NativeChildStatusProjection[] = state.children.map((child) => ({
    name: child.name,
    summary: child.summary,
    dependsOn: [...child.dependsOn],
    covers: child.acceptanceScope?.map(({ id }) => id) ?? [],
    status:
      child.status === 'ready' &&
      child.blocker &&
      [...state.history].reverse().find((event) => event.child === child.name)?.kind ===
        'task-blocked'
        ? 'blocked'
        : child.status,
    phase: null,
    projectRoot: child.projectRoot ?? child.task?.projectRoot ?? null,
    message: confirmed
      ? child.blocker
      : 'Supervisor acceptance scope is unavailable; restore children.yaml and confirm Shape before continuing',
  }));
  return {
    contractHash: null,
    confirmed,
    parentBranch: state.integration.branch,
    children,
    readyChildren: confirmed
      ? children.filter(({ status }) => status === 'ready').map(({ name }) => name)
      : [],
    allDone:
      confirmed && children.every(({ status }) => status === 'integrated' || status === 'archived'),
  };
}
