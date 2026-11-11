import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from './native-atomic-file.js';
import {
  nativeChildrenAcceptanceValidation,
  readNativeChildrenContract,
} from './native-children-contract.js';
import { nativePreferredChangeRuntimeDir } from './native-paths.js';
import {
  NATIVE_SUPERVISOR_SCHEMA,
  assertCommit,
  supervisorAcceptanceScope,
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
      child.builderFailureCount !== undefined &&
      (!Number.isSafeInteger(child.builderFailureCount) || child.builderFailureCount < 0)
    ) {
      throw new Error(`Native Supervisor child ${child.name} Builder failure count is invalid`);
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
  options: {
    diagnostics?: boolean;
  } = {},
): Promise<NativeSupervisorState | null> {
  try {
    const source = await fs.readFile(nativeSupervisorStateFile(paths, parent), 'utf8');
    const parsed: unknown = JSON.parse(source);
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray(
        (
          parsed as {
            children?: unknown;
          }
        ).children,
      )
    ) {
      for (const child of (
        parsed as {
          children: Array<{
            contractRef?: string;
            contractHash?: string;
            task?: {
              contractRef?: string;
              contractHash?: string;
            };
          }>;
        }
      ).children) {
        if (child.contractRef === undefined && typeof child.contractHash === 'string')
          child.contractRef = child.contractHash;
        if (
          child.task &&
          child.task.contractRef === undefined &&
          typeof child.task.contractHash === 'string'
        )
          child.task.contractRef = child.task.contractHash;
      }
    }
    // 旧检查执行元数据只留在原文件历史中，不进入当前业务状态。
    if (parsed && typeof parsed === 'object') {
      const legacy = parsed as {
        integration?: Record<string, unknown>;
        children?: Array<{
          task?: Record<string, unknown>;
        }>;
      };
      if (legacy.integration) delete legacy.integration.checkExecution;
      if (Array.isArray(legacy.children))
        for (const child of legacy.children)
          if (child.task) {
            delete child.task.checkExecution;
            delete child.task.checksReason;
          }
    }
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
          if (child.task) {
            child.task.acceptance = structuredClone(child.acceptanceScope);
            child.task.contractRef = child.contractRef;
            child.task.verificationBoundary = 'child-scope-parent-reverifies-all';
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
export async function assertNoActiveNativeSupervisorTasks(
  paths: Pick<NativeProjectPaths, 'changesRuntimeDir'>,
  parent: string,
): Promise<void> {
  const active = await activeNativeSupervisorTaskNames(paths, parent);
  if (active.length > 0) {
    throw new Error(
      `Native Supervisor Git binding cannot change while active child tasks exist: ${active.join(', ')}`,
    );
  }
}
export async function activeNativeSupervisorTaskNames(
  paths: Pick<NativeProjectPaths, 'changesRuntimeDir'>,
  parent: string,
): Promise<string[]> {
  const state = await readNativeSupervisorState(paths, parent, { diagnostics: true });
  return state?.children.filter(({ task }) => task !== null).map(({ name }) => name) ?? [];
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
