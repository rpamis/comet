import path from 'node:path';
import { promises as fs } from 'node:fs';

import { atomicWriteJson } from './native-atomic-file.js';
import { canonicalHash } from './native-canonical-hash.js';
import {
  nativeChildrenAcceptanceValidation,
  readNativeChildrenContract,
} from './native-children-contract.js';
import { nativePreferredChangeRuntimeDir } from './native-paths.js';
import {
  NATIVE_SUPERVISOR_SCHEMA,
  assertCommit,
  supervisorAcceptanceScope,
  type NativeSupervisorCheckExecutionState,
  type NativeSupervisorState,
} from './native-supervisor-model.js';
import type { NativeProjectPaths } from './native-types.js';
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
