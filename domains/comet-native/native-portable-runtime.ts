import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { inspectGitWorktree, resolveGitRef } from '../../platform/paths/git-worktree.js';

import { atomicWriteText } from './native-atomic-file.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import {
  findNativeV1SupervisorParents,
  hashNativeParentContract,
  inspectNativeChildren,
  nativeChildrenAcceptanceValidation,
  readNativeChildrenContract,
  readNativeSupervisorShapeIntent,
} from './native-children.js';
import {
  createNativeSupervisorState,
  prepareNativeSupervisorIntegrationWorkspace,
  rebuildNativeSupervisorStateFromFacts,
  readNativeSupervisorState,
  reconcileNativeSupervisorState,
  writeNativeSupervisorState,
} from './native-supervisor.js';
import {
  listActiveNativeChangesOwnedByWorkspace,
  NativeWorkspaceIsolationRequiredError,
} from './native-change.js';
import {
  executeNativeCheck,
  nativeCheckPlanKey,
  nativePortableArgvDisplay,
  resolveNativeCheckCwd,
  validateNativeCheckPlan,
  type NativeCheckPlan,
} from './native-check-executor.js';
import {
  applyNativeVerifierEnvelope,
  confirmNativeSkillCoordinatedPass,
  confirmNativePortableAcceptance,
  confirmNativeVerifierUnavailable,
  NATIVE_MAX_REQUEST_CHECK_ROUNDS,
  NATIVE_MAX_VERIFIER_EXECUTION_FAILURES,
  recordNativeVerifierUnavailable,
  recordNativeVerifierExecutionError,
  resolveNativeVerifierBlocker,
  returnNativeCandidateToBuild,
  reserveNativeVerifierAttempt,
  retryNativeVerifier,
  submitNativeBuilderCandidate,
  type NativeBuilderCandidateInput,
} from './native-loop-runtime.js';
import {
  readNativeLocalExecution,
  readOrRebuildNativeLocalExecution,
  rebuildNativeLocalExecution,
  writeNativeLocalExecution,
} from './native-local-execution.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import {
  buildNativePortableAcceptance,
  sameNativePortableAcceptance,
} from './native-portable-acceptance.js';
import {
  appendNativePortableHistory,
  compareAndSwapNativePortableState,
  createNativePortableState,
  readNativePortableState,
  writeNativePortableState,
} from './native-portable-state.js';
import { toNativePortableText } from './native-portable-text.js';
import type {
  NativeLocalCheckState,
  NativeLocalExecutionState,
  NativePortableCheckSummary,
  NativePortablePhase,
  NativePortableSpecChange,
  NativePortableState,
  NativePortableWorkspace,
} from './native-portable-types.js';
import {
  isNativeTrustedVerifierEnvelope,
  type NativeTrustedVerifierEnvelope,
} from './native-runner-protocol.js';
import {
  parseNativeVerifierResponse,
  type NativeVerifierCheckRequest,
  type NativeVerifierResponse,
} from './native-verifier-protocol.js';
import {
  inspectNativeVerificationReportAlignment,
  writeNativeVerificationReport,
} from './native-verification-report-v2.js';
import {
  isInsidePath,
  nativePreferredChangeRuntimeDir,
  resolveContainedNativePath,
} from './native-paths.js';
import { nativeBriefTemplate } from './native-artifact-language.js';
import type { CometProjectConfig, NativeProjectPaths } from './native-types.js';
import type { NativeSupervisorCoordinationMode } from './native-portable-types.js';
import type { NativeWorkspaceBinding } from './native-workspace.js';
import { readProjectConfig, writeProjectConfig } from './native-config.js';

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
export const NATIVE_PORTABLE_STATE_FILE = 'comet-state.yaml';
export const NATIVE_LOCAL_EXECUTION_FILE = 'state.json';

export const NATIVE_PORTABLE_BRIEF_TEMPLATE = nativeBriefTemplate('en');

export type NativePortableExpectedContinuationAction =
  | 'confirm-shape'
  | 'accept-result'
  | 'confirm-verifier-unavailable'
  | 'revise-implementation'
  | 'revise-requirements'
  | 'retry-verifier'
  | 'resolve-verifier-blocker';

export interface NativePortableExpectedContinuation {
  stateVersion: number;
  action: NativePortableExpectedContinuationAction;
}

function assertNativePortableExpectedContinuationLocked(options: {
  state: NativePortableState;
  expected?: NativePortableExpectedContinuation;
  action: NativePortableExpectedContinuationAction;
}): void {
  const expected = options.expected;
  if (!expected) return;
  if (options.state.state_version !== expected.stateVersion) {
    throw new Error(
      `Native continuation is stale for state version ${expected.stateVersion}; current state version is ${options.state.state_version}`,
    );
  }
  if (expected.action !== options.action) {
    throw new Error(
      `Native continuation expected ${expected.action} cannot be used for ${options.action}`,
    );
  }
}

export function nativePortableChangeDir(paths: NativeProjectPaths, name: string): string {
  if (!NAME_PATTERN.test(name)) throw new Error(`Invalid Native change name: ${name}`);
  const target = path.join(paths.changesDir, name);
  if (!isInsidePath(paths.changesDir, target)) throw new Error('Native change path escaped');
  return target;
}

export function nativePortableStateFile(paths: NativeProjectPaths, name: string): string {
  return path.join(nativePortableChangeDir(paths, name), NATIVE_PORTABLE_STATE_FILE);
}

export function nativeLocalExecutionFile(paths: NativeProjectPaths, name: string): string {
  return path.join(nativePreferredChangeRuntimeDir(paths, name), NATIVE_LOCAL_EXECUTION_FILE);
}

export async function isNativePortableChange(
  paths: NativeProjectPaths,
  name: string,
): Promise<boolean> {
  try {
    const source = await fs.readFile(nativePortableStateFile(paths, name), 'utf8');
    return /^schema:\s*comet\.native\.v4\s*$/mu.test(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function portableWorkspace(binding?: NativeWorkspaceBinding): NativePortableWorkspace {
  return {
    isolation: binding?.isolation ?? 'current',
    change_branch: binding?.changeBranch ?? null,
    target_branch: binding?.targetBranch ?? null,
    finish: null,
  };
}

function currentBranch(projectRoot: string): string | null {
  const inspection = inspectGitWorktree(projectRoot);
  return inspection.currentBranch;
}

function assertPortableWorkspaceBindingCurrent(
  projectRoot: string,
  binding: NativeWorkspaceBinding | undefined,
): void {
  if (!binding) return;
  const inspection = inspectGitWorktree(projectRoot);
  if (
    binding.changeBranch !== null &&
    (!inspection.isGitWorktree || inspection.currentBranch !== binding.changeBranch)
  ) {
    throw new Error(
      `Native workspace binding ${binding.changeBranch ?? '(missing)'} does not match the current branch ${inspection.currentBranch ?? '(detached)'}`,
    );
  }
  if (binding.isolation === 'worktree' && !inspection.isSecondaryWorktree) {
    throw new Error('Native worktree isolation must use a linked Git worktree');
  }
}

export async function createNativePortableChange(options: {
  paths: NativeProjectPaths;
  name: string;
  language: 'en' | 'zh-CN';
  workspaceBinding?: NativeWorkspaceBinding;
  initialProjectConfig?: CometProjectConfig;
  now?: Date;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `create portable change ${options.name}`,
    async () => {
      if (!NAME_PATTERN.test(options.name))
        throw new Error(`Invalid Native change name: ${options.name}`);
      if (
        options.initialProjectConfig &&
        (await readProjectConfig(options.paths.projectRoot)) === null
      ) {
        await writeProjectConfig(options.paths.projectRoot, options.initialProjectConfig);
      }
      assertPortableWorkspaceBindingCurrent(options.paths.projectRoot, options.workspaceBinding);
      const activeChanges = (await listActiveNativeChangesOwnedByWorkspace(options.paths)).filter(
        (name) => name !== options.name,
      );
      if (activeChanges.length > 0) {
        throw new NativeWorkspaceIsolationRequiredError(
          options.workspaceBinding?.isolation ?? 'current',
          activeChanges,
        );
      }
      const changeDir = nativePortableChangeDir(options.paths, options.name);
      const runtimeDir = nativePreferredChangeRuntimeDir(options.paths, options.name);
      await Promise.all([
        resolveContainedNativePath(options.paths.nativeRoot, changeDir),
        resolveContainedNativePath(options.paths.runtimeDir, runtimeDir),
      ]);
      let createdChange = false;
      let createdRuntime = false;
      try {
        await fs.mkdir(options.paths.changesDir, { recursive: true });
        await fs.mkdir(changeDir, { recursive: false });
        createdChange = true;
        await fs.mkdir(options.paths.changesRuntimeDir, { recursive: true });
        await fs.mkdir(runtimeDir, { recursive: false });
        createdRuntime = true;
        await fs.mkdir(path.join(changeDir, 'specs'), { recursive: true });
        await atomicWriteText(
          path.join(changeDir, 'brief.md'),
          nativeBriefTemplate(options.language),
        );
        const state = createNativePortableState({
          name: options.name,
          language: options.language,
          workspace: portableWorkspace(options.workspaceBinding),
          createdAt: options.now,
          nextAction: 'confirm-shape',
        });
        await writeNativePortableState(
          nativePortableStateFile(options.paths, options.name),
          state,
          {
            containedRoot: options.paths.nativeRoot,
          },
        );
        await writeNativeLocalExecution(
          nativeLocalExecutionFile(options.paths, options.name),
          rebuildNativeLocalExecution({
            portableState: state,
            projectRoot: options.paths.projectRoot,
            branch: currentBranch(options.paths.projectRoot),
          }),
          { containedRoot: options.paths.runtimeDir },
        );
        return state;
      } catch (error) {
        if (createdRuntime) await fs.rm(runtimeDir, { recursive: true, force: true });
        if (createdChange) await fs.rm(changeDir, { recursive: true, force: true });
        throw error;
      }
    },
  );
}

export async function readNativePortableChange(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativePortableState> {
  return readNativePortableState(nativePortableStateFile(paths, name));
}

async function writePortableMutation(options: {
  paths: NativeProjectPaths;
  previous: NativePortableState;
  next: NativePortableState;
}): Promise<NativePortableState> {
  const written = await compareAndSwapNativePortableState({
    file: nativePortableStateFile(options.paths, options.previous.name),
    expectedStateVersion: options.previous.state_version,
    next: options.next,
    containedRoot: options.paths.nativeRoot,
  });
  if (written.verification === null && written.verification_report === null) {
    const report = path.join(
      nativePortableChangeDir(options.paths, written.name),
      'verification.md',
    );
    await resolveContainedNativePath(options.paths.nativeRoot, report);
    await fs.rm(report, { force: true });
  }
  return written;
}

async function discoverNativePortableSpecChanges(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<NativePortableSpecChange[]> {
  const changeDir = nativePortableChangeDir(options.paths, options.state.name);
  const specsDir = path.join(changeDir, 'specs');
  const removals = new Map(
    options.state.spec_changes
      .filter(({ operation }) => operation === 'remove')
      .map((entry) => [entry.capability, entry]),
  );
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(specsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') entries = [];
    else throw error;
  }
  const changes: NativePortableSpecChange[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    if (entry.isSymbolicLink()) throw new Error(`Native spec capability is unsafe: ${entry.name}`);
    if (!entry.isDirectory()) continue;
    if (!NAME_PATTERN.test(entry.name)) throw new Error(`Invalid Native capability: ${entry.name}`);
    if (removals.has(entry.name)) {
      throw new Error(`Capability ${entry.name} cannot be proposed and removed together`);
    }
    const source = `specs/${entry.name}/spec.md`;
    const file = path.join(changeDir, ...source.split('/'));
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Native proposed spec must be a regular file: ${source}`);
    }
    const canonical = path.join(options.paths.specsDir, entry.name, 'spec.md');
    let operation: 'create' | 'modify' = 'create';
    try {
      const canonicalStat = await fs.lstat(canonical);
      if (!canonicalStat.isFile() || canonicalStat.isSymbolicLink()) {
        throw new Error(`Canonical Native spec is unsafe: ${entry.name}`);
      }
      operation = 'modify';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    changes.push({ capability: entry.name, operation, source });
  }
  changes.push(...removals.values());
  return changes.sort((left, right) => left.capability.localeCompare(right.capability, 'en'));
}

async function readNativePortableAcceptance(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  specChanges: readonly NativePortableSpecChange[];
}) {
  const changeDir = nativePortableChangeDir(options.paths, options.state.name);
  const brief = await readNativeBoundedTextFile({
    root: changeDir,
    ref: 'brief.md',
    maxBytes: null,
    includeHash: false,
  });
  const specs = [];
  for (const spec of options.specChanges) {
    if (spec.source === null) continue;
    const source = await readNativeBoundedTextFile({
      root: changeDir,
      ref: spec.source,
      maxBytes: null,
      includeHash: false,
    });
    specs.push({ capability: spec.capability, source: source.ref, markdown: source.text });
  }
  return buildNativePortableAcceptance({ briefMarkdown: brief.text, specs });
}

export async function confirmNativePortableShape(options: {
  paths: NativeProjectPaths;
  name: string;
  coordinationMode?: NativeSupervisorCoordinationMode;
  expectedContinuation?: NativePortableExpectedContinuation;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `confirm portable shape ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      assertNativePortableExpectedContinuationLocked({
        state,
        expected: options.expectedContinuation,
        action: 'confirm-shape',
      });
      const specChanges = await discoverNativePortableSpecChanges({ paths: options.paths, state });
      const acceptance = await readNativePortableAcceptance({
        paths: options.paths,
        state,
        specChanges,
      });
      const children = await readNativeChildrenContract({
        changeDir: nativePortableChangeDir(options.paths, state.name),
        acceptanceIds: acceptance.map(({ id }) => id),
        validation: nativeChildrenAcceptanceValidation({
          ...state,
          acceptance,
        }),
      });
      if (children && state.workspace.change_branch === null) {
        throw new Error('Native parent changes require a Git integration branch');
      }
      const coordinationRequired =
        (await readNativeSupervisorShapeIntent(
          nativePortableChangeDir(options.paths, state.name),
        )) ||
        (children?.contract.schema === 'comet.native.children.v2' &&
          children.contract.children.length >= 2);
      const coordinationMode = options.coordinationMode ?? state.coordination_mode;
      if (coordinationRequired && !children) {
        throw new Error('Native Supervisor Shape requires children.yaml before confirmation');
      }
      if (coordinationRequired && coordinationMode === undefined) {
        throw new Error(
          'Native Supervisor Shape requires --coordination-mode multi-session or single-session',
        );
      }
      if (!coordinationRequired && options.coordinationMode !== undefined) {
        throw new Error(
          '--coordination-mode is only valid for a multi-child Native Supervisor Shape',
        );
      }
      const next = confirmNativePortableAcceptance({
        state: { ...state, spec_changes: specChanges },
        acceptance: acceptance.map((entry) => ({ ...entry })),
      });
      delete next.children_contract_hash;
      delete next.coordination_mode;
      if (children) {
        next.children_contract_hash = hashNativeParentContract({
          acceptance: next.acceptance,
          children: children.contract,
        });
        if (coordinationRequired) next.coordination_mode = coordinationMode;
        const latestDecision = [...state.history]
          .reverse()
          .find(({ outcome }) => outcome === 'pass' || outcome === 'fail');
        if (latestDecision?.outcome === 'fail' && latestDecision.unresolved_ids.length > 0) {
          const inspection = await inspectNativeChildren({ paths: options.paths, state: next });
          const repairCoverage = new Set(
            (inspection?.children ?? [])
              .filter(({ status }) => status !== 'done')
              .flatMap(({ covers }) => covers),
          );
          const missing = latestDecision.unresolved_ids.filter((id) => !repairCoverage.has(id));
          if (missing.length > 0) {
            throw new Error(
              `Native parent repair plan requires an unfinished child covering: ${missing.join(', ')}`,
            );
          }
        }
      }
      let supervisorWorkspace: Awaited<
        ReturnType<typeof prepareNativeSupervisorIntegrationWorkspace>
      > | null = null;
      let existingSupervisor =
        children?.contract.schema === 'comet.native.children.v2'
          ? await readNativeSupervisorState(options.paths, state.name)
          : null;
      let supervisorTargetBranch: string | null = null;
      let supervisorTargetCommit: string | null = null;
      if (children?.contract.schema === 'comet.native.children.v2') {
        supervisorTargetBranch = state.workspace.target_branch ?? state.workspace.change_branch;
        if (!supervisorTargetBranch) {
          throw new Error('Native Supervisor v2 requires a target branch');
        }
        supervisorTargetCommit = resolveGitRef(options.paths.projectRoot, supervisorTargetBranch);
        if (!supervisorTargetCommit) {
          throw new Error(
            `Native Supervisor target branch has no commit: ${supervisorTargetBranch}`,
          );
        }
        if (!existingSupervisor) {
          existingSupervisor = await rebuildNativeSupervisorStateFromFacts({
            paths: options.paths,
            parent: state.name,
            targetBranch: supervisorTargetBranch,
            contract: children.contract,
          });
        }
        if (!existingSupervisor) {
          supervisorWorkspace = await prepareNativeSupervisorIntegrationWorkspace({
            projectRoot: options.paths.projectRoot,
            parent: state.name,
            targetBranch: supervisorTargetBranch,
            sourceConfig: await readProjectConfig(options.paths.projectRoot),
          });
        }
      }
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        rebuildNativeLocalExecution({
          portableState: written,
          projectRoot: options.paths.projectRoot,
          branch: currentBranch(options.paths.projectRoot),
        }),
        { containedRoot: options.paths.runtimeDir },
      );
      if (
        children?.contract.schema === 'comet.native.children.v2' &&
        supervisorTargetBranch &&
        supervisorTargetCommit
      ) {
        const supervisorState = existingSupervisor
          ? reconcileNativeSupervisorState({
              state: existingSupervisor,
              contract: children.contract,
            })
          : supervisorWorkspace
            ? createNativeSupervisorState({
                parent: written.name,
                targetBranch: supervisorTargetBranch,
                targetCommit: supervisorTargetCommit,
                integrationBranch: supervisorWorkspace.binding.changeBranch!,
                integrationWorktree: supervisorWorkspace.projectRoot,
                contract: children.contract,
              })
            : null;
        if (!supervisorState) throw new Error('Native Supervisor integration state is unavailable');
        await writeNativeSupervisorState(options.paths, supervisorState);
      }
      return written;
    },
  );
}

export async function inspectNativePortableAcceptanceDrift(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  ignoreSpecOperationFor?: ReadonlySet<string>;
}): Promise<{ drifted: boolean; reason: string | null }> {
  const specChanges = await discoverNativePortableSpecChanges(options);
  const ignoredOperations =
    options.ignoreSpecOperationFor ??
    (options.state.children_contract_hash
      ? new Set(options.state.spec_changes.map(({ capability }) => capability))
      : undefined);
  const declarationsMatch =
    specChanges.length === options.state.spec_changes.length &&
    specChanges.every((actual, index) => {
      const expected = options.state.spec_changes[index];
      return (
        expected !== undefined &&
        actual.capability === expected.capability &&
        actual.source === expected.source &&
        (actual.operation === expected.operation ||
          ignoredOperations?.has(actual.capability) === true)
      );
    });
  if (!declarationsMatch) {
    return { drifted: true, reason: 'Native target specification declarations changed' };
  }
  const acceptance = await readNativePortableAcceptance({ ...options, specChanges });
  const expected = options.state.acceptance.map(({ source, text }) => ({ source, text }));
  if (!sameNativePortableAcceptance(expected, acceptance)) {
    return { drifted: true, reason: 'Native confirmed acceptance criteria changed' };
  }
  let children;
  try {
    children = await readNativeChildrenContract({
      changeDir: nativePortableChangeDir(options.paths, options.state.name),
      acceptanceIds: acceptance.map(({ id }) => id),
      validation: nativeChildrenAcceptanceValidation({
        ...options.state,
        acceptance,
      }),
    });
  } catch {
    return { drifted: true, reason: 'Native child declarations changed' };
  }
  const currentHash = children
    ? hashNativeParentContract({ acceptance, children: children.contract })
    : null;
  return currentHash === (options.state.children_contract_hash ?? null)
    ? { drifted: false, reason: null }
    : { drifted: true, reason: 'Native child declarations changed' };
}

export async function ensureNativePortableAcceptanceCurrentLocked(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<void> {
  const drift = await inspectNativePortableAcceptanceDrift(options);
  if (!drift.drifted) return;
  const reason = drift.reason ?? 'Native confirmed requirements changed';
  await returnNativePortableStateToShapeLocked({
    paths: options.paths,
    state: options.state,
    reason,
  });
  throw new Error(`${reason}; Native change returned to Shape and requires confirmation`);
}

export async function submitNativePortableBuilderCandidate(options: {
  paths: NativeProjectPaths;
  name: string;
  input: NativeBuilderCandidateInput;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `submit portable candidate ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      const children = await readNativeChildrenContract({
        changeDir: nativePortableChangeDir(options.paths, state.name),
        acceptanceIds: state.acceptance.map(({ id }) => id),
        validation: nativeChildrenAcceptanceValidation(state),
      });
      if (children || state.children_contract_hash) {
        const childStatus = await inspectNativeChildren({ paths: options.paths, state });
        if (!childStatus?.confirmed || !childStatus.allDone) {
          throw new Error('Native parent Build advances child changes before parent review');
        }
        if (state.loop.stage === 'repairing' && state.verification_result === 'fail') {
          throw new Error('Native parent verification failed; complete the repair child first');
        }
      }
      const next = submitNativeBuilderCandidate({ state, input: options.input });
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        rebuildNativeLocalExecution({
          portableState: written,
          projectRoot: options.paths.projectRoot,
          branch: currentBranch(options.paths.projectRoot),
        }),
        { containedRoot: options.paths.runtimeDir },
      );
      return written;
    },
  );
}

export interface NativeSupervisorParentAdvance {
  trigger: 'v2-integrate' | 'v1-archive' | 'recovery';
  parent: string | null;
  advanced: boolean;
  message: string | null;
  blocker: string | null;
}

/**
 * Recompute whether every Child is integrated and the parent is ready for an
 * independent reviewed handoff. This inspection does not advance the phase.
 */
export async function inspectNativeSupervisorParentReviewReadiness(options: {
  paths: NativeProjectPaths;
  name: string;
  trigger: NativeSupervisorParentAdvance['trigger'];
}): Promise<{ state: NativePortableState; parentAdvance: NativeSupervisorParentAdvance }> {
  const state = await readNativePortableChange(options.paths, options.name);
  const base = {
    trigger: options.trigger,
    parent: options.name,
    advanced: false,
    message: null,
    blocker: null,
  } satisfies NativeSupervisorParentAdvance;
  if (state.phase !== 'build' || state.status !== 'active') {
    return { state, parentAdvance: base };
  }
  const children = await inspectNativeChildren({ paths: options.paths, state });
  if (!children || !children.confirmed || !children.allDone) {
    return {
      state,
      parentAdvance: {
        ...base,
        blocker:
          children && !children.confirmed
            ? 'Supervisor child declarations require Shape confirmation'
            : null,
      },
    };
  }
  if (state.loop.stage === 'repairing' && state.verification_result === 'fail') {
    return {
      state,
      parentAdvance: {
        ...base,
        blocker: 'Native parent verification failed; add and confirm a repair child',
      },
    };
  }
  const message =
    state.language === 'zh-CN'
      ? '全部 Child 已完成；Supervisor 父级候选需要独立代码审查后再进入验证'
      : 'All Children are complete; the Supervisor parent candidate needs an independent code review before verification.';
  return {
    state,
    parentAdvance: {
      ...base,
      message,
    },
  };
}

export async function tryAutoAdvanceNativeV1SupervisorParent(options: {
  childState: NativePortableState;
  childPaths: NativeProjectPaths;
}): Promise<{
  parentAdvance: NativeSupervisorParentAdvance;
  parentState: NativePortableState | null;
}> {
  const discovery = await findNativeV1SupervisorParents({
    paths: options.childPaths,
    childName: options.childState.name,
    targetBranch: options.childState.workspace.target_branch,
  });
  if (!discovery.candidate) {
    return {
      parentState: null,
      parentAdvance: {
        trigger: 'v1-archive',
        parent: null,
        advanced: false,
        message: null,
        blocker: discovery.blockers.length > 0 ? discovery.blockers.join('; ') : null,
      },
    };
  }
  const result = await inspectNativeSupervisorParentReviewReadiness({
    paths: discovery.candidate.paths,
    name: discovery.candidate.state.name,
    trigger: 'v1-archive',
  });
  return { parentState: result.state, parentAdvance: result.parentAdvance };
}

function localCheck(
  plan: NativeCheckPlan,
  operationId: string,
  projectRoot: string,
): NativeLocalCheckState {
  return {
    id: plan.id,
    name: plan.name,
    operationId,
    status: 'planned',
    repeatable: plan.repeatable,
    timeoutMs: plan.timeoutMs,
    executionCount: 0,
    argv: [plan.executable, ...plan.argv],
    cwd: resolveNativeCheckCwd(projectRoot, plan.cwdRef),
    exitCode: null,
    startedAt: null,
    completedAt: null,
    log: `logs/checks/${operationId}-${plan.id}.log`,
  };
}

function resetInterruptedCheck(
  previous: NativeLocalCheckState,
  plan: NativeCheckPlan,
  operationId: string,
  projectRoot: string,
): NativeLocalCheckState {
  if (!previous.repeatable) {
    throw new Error(
      `Native check ${previous.id} was interrupted and is not repeatable; user resolution is required`,
    );
  }
  return {
    ...localCheck(plan, operationId, projectRoot),
    executionCount: previous.executionCount,
  };
}

function localCheckCwdRef(projectRoot: string, cwd: string): string {
  const relative = path.relative(path.resolve(projectRoot), path.resolve(cwd));
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('Native local check cwd escaped the project root');
  }
  const cwdRef = relative.length === 0 ? '.' : relative.split(path.sep).join('/');
  resolveNativeCheckCwd(projectRoot, cwdRef);
  return cwdRef;
}

function localCheckPlanKey(check: NativeLocalCheckState, projectRoot: string): string {
  const [executable, ...argv] = check.argv;
  if (!executable) throw new Error(`Native local check ${check.id} has no executable`);
  return nativeCheckPlanKey({
    id: check.id,
    name: check.id,
    executable,
    argv,
    cwdRef: localCheckCwdRef(projectRoot, check.cwd),
    timeoutMs: check.timeoutMs,
    repeatable: check.repeatable,
  });
}

function completedCheckDuration(check: NativeLocalCheckState): number {
  if (check.startedAt === null || check.completedAt === null) return 0;
  return Math.max(0, Date.parse(check.completedAt) - Date.parse(check.startedAt));
}

function authoritativePortableChecks(options: {
  local: NativeLocalExecutionState;
  projectRoot: string;
  supplied: readonly NativePortableCheckSummary[];
  requestedNames?: ReadonlyMap<string, string>;
}): NativePortableCheckSummary[] {
  const suppliedById = new Map<string, NativePortableCheckSummary>();
  for (const check of options.supplied) {
    if (suppliedById.has(check.id)) {
      throw new Error(`Native Runtime check summaries contain duplicate ID ${check.id}`);
    }
    suppliedById.set(check.id, check);
  }
  return options.local.checks.map((check) => {
    if (check.status === 'planned' || check.status === 'running') {
      throw new Error(`Native Runtime check ${check.id} has not completed`);
    }
    const name = options.requestedNames?.get(check.id) ?? check.name;
    return {
      id: check.id,
      name: toNativePortableText(name),
      argv_display: nativePortableArgvDisplay(check.argv.slice(1)).map((entry) =>
        toNativePortableText(entry),
      ),
      argv_truncated: false,
      cwd_ref: localCheckCwdRef(options.projectRoot, check.cwd),
      status: check.status,
      exit_code: check.exitCode,
      duration_ms: completedCheckDuration(check),
    };
  });
}

function requestCheckPlan(request: NativeVerifierCheckRequest): NativeCheckPlan {
  return {
    id: request.id,
    name: request.name,
    executable: request.executable,
    argv: [...request.argv],
    cwdRef: request.cwdRef,
    timeoutMs: request.timeoutMs,
    repeatable: request.repeatable,
  };
}

function preservedLocalChecksForVersion(options: {
  local: NativeLocalExecutionState | null;
  state: NativePortableState;
  projectRoot: string;
}): NativeLocalExecutionState {
  if (options.local === null || options.local.change !== options.state.name) {
    return rebuildNativeLocalExecution({
      portableState: options.state,
      projectRoot: options.projectRoot,
      branch: currentBranch(options.projectRoot),
    });
  }
  const operationId = options.local.execution?.operationId ?? randomUUID();
  return {
    ...options.local,
    basedOnStateVersion: options.state.state_version,
    execution: {
      operationId,
      stage: 'checking',
      actor: 'runtime',
      executionId: null,
      status: 'completed',
      startedAt: options.local.execution?.startedAt ?? new Date().toISOString(),
      requestCheckRounds: 0,
    },
    checks: options.local.checks.map((check) =>
      check.status === 'running' || check.status === 'planned'
        ? { ...check, operationId, status: 'interrupted' as const }
        : { ...check, operationId },
    ),
  };
}

async function readCurrentLocalExecution(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<NativeLocalExecutionState | null> {
  try {
    const local = await readNativeLocalExecution(
      nativeLocalExecutionFile(options.paths, options.state.name),
    );
    if (
      local === null ||
      local.change !== options.state.name ||
      local.basedOnStateVersion !== options.state.state_version
    ) {
      return null;
    }
    return local;
  } catch {
    return null;
  }
}

export interface NativeVerifierAttemptBinding {
  stateVersion: number;
  iteration: number;
  attempt: number;
  verifierExecutionRef: string;
}

function assertCurrentVerifierAttempt(options: {
  state: NativePortableState;
  local: NativeLocalExecutionState | null;
  expected: NativeVerifierAttemptBinding;
}): NativeLocalExecutionState {
  const { state, local, expected } = options;
  if (
    state.state_version !== expected.stateVersion ||
    state.phase !== 'verify' ||
    state.status !== 'active' ||
    state.loop.next_action !== 'await-verifier-result' ||
    state.loop.iteration !== expected.iteration ||
    state.loop.attempt !== expected.attempt ||
    state.builder_handoff === null ||
    local === null ||
    local.basedOnStateVersion !== state.state_version ||
    local.execution === null ||
    local.execution.stage !== 'verifying' ||
    local.execution.actor !== 'verifier' ||
    local.execution.status !== 'running' ||
    local.execution.executionId !== expected.verifierExecutionRef
  ) {
    throw new Error('Native Verifier execution message is stale for the current attempt');
  }
  return local;
}

function assertCurrentVerifierEnvelope(options: {
  state: NativePortableState;
  local: NativeLocalExecutionState | null;
  envelope: NativeTrustedVerifierEnvelope<unknown> | unknown;
}): NativeTrustedVerifierEnvelope<unknown> {
  const { state, local, envelope } = options;
  if (!isNativeTrustedVerifierEnvelope(envelope)) {
    throw new Error('Native Verifier result must come from the trusted Runner channel');
  }
  if (
    state.phase !== 'verify' ||
    state.status !== 'active' ||
    state.loop.next_action !== 'await-verifier-result' ||
    state.builder_handoff === null
  ) {
    throw new Error('Native Verifier result is stale for the current workflow state');
  }
  if (
    envelope.candidateId !== state.builder_handoff.candidate_id ||
    envelope.identityProvider !== state.builder_handoff.identity_provider ||
    envelope.verifierExecutionRef === state.builder_handoff.builder_execution_ref
  ) {
    throw new Error('Native Verifier result is stale for the current candidate or identity');
  }
  if (
    local === null ||
    local.execution === null ||
    local.execution.stage !== 'verifying' ||
    local.execution.actor !== 'verifier' ||
    local.execution.status !== 'running' ||
    (local.execution.executionId !== null &&
      local.execution.executionId !== envelope.verifierExecutionRef)
  ) {
    throw new Error('Native Verifier result is stale for the active execution');
  }
  return envelope;
}

function nativeVerifierResponsePosition(response: NativeVerifierResponse): {
  iteration: number;
  attempt: number;
} {
  return response.kind === 'final-result'
    ? { iteration: response.result.iteration, attempt: response.result.attempt }
    : { iteration: response.iteration, attempt: response.attempt };
}

async function persistVerifierExecutionError(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  summary: string;
}): Promise<NativePortableState> {
  const local = await readCurrentLocalExecution({ paths: options.paths, state: options.state });
  const next = recordNativeVerifierExecutionError({
    state: options.state,
    summary: options.summary,
  });
  const written = await writePortableMutation({
    paths: options.paths,
    previous: options.state,
    next,
  });
  await writeNativeLocalExecution(
    nativeLocalExecutionFile(options.paths, options.state.name),
    preservedLocalChecksForVersion({
      local,
      state: written,
      projectRoot: options.paths.projectRoot,
    }),
    { containedRoot: options.paths.runtimeDir },
  );
  return written;
}

function sameNativeCheckPlan(
  local: NativeLocalExecutionState,
  plans: readonly NativeCheckPlan[],
  projectRoot: string,
): boolean {
  if (local.checks.length !== plans.length) return false;
  return local.checks.every(
    (check, index) => localCheckPlanKey(check, projectRoot) === nativeCheckPlanKey(plans[index]),
  );
}

async function reserveNativePortableCheckPlan(options: {
  paths: NativeProjectPaths;
  name: string;
  plans: NativeCheckPlan[];
  projectRoot: string;
}): Promise<
  | {
      kind: 'execute';
      state: NativePortableState;
      local: NativeLocalExecutionState;
      plans: NativeCheckPlan[];
    }
  | { kind: 'reuse'; state: NativePortableState; checks: NativePortableCheckSummary[] }
> {
  return withNativeMutationLock(
    options.paths,
    `reserve portable checks ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      if (state.phase !== 'verify' || state.loop.stage !== 'verify-ready') {
        throw new Error('Native checks require Verify ready state');
      }
      const file = nativeLocalExecutionFile(options.paths, state.name);
      const local = (
        await readOrRebuildNativeLocalExecution({
          file,
          portableState: state,
          projectRoot: options.projectRoot,
          branch: currentBranch(options.projectRoot),
          containedRoot: options.paths.runtimeDir,
        })
      ).state;
      if (
        local.execution?.stage === 'checking' &&
        local.execution.actor === 'runtime' &&
        sameNativeCheckPlan(local, options.plans, options.projectRoot)
      ) {
        const execution = local.execution;
        if (execution.status === 'running') {
          throw new Error('Native check plan is already in progress');
        }
        const interrupted = local.checks.filter((check) => check.status === 'interrupted');
        if (interrupted.length === 0 && execution.status === 'completed') {
          const requestedNames = new Map(options.plans.map(({ id, name }) => [id, name] as const));
          return {
            kind: 'reuse',
            state,
            checks: authoritativePortableChecks({
              local,
              projectRoot: options.projectRoot,
              supplied: [],
              requestedNames,
            }),
          };
        }
        if (interrupted.length > 0 && interrupted.some((check) => !check.repeatable)) {
          const next = returnNativeCandidateToBuild({
            state,
            reason: `A non-repeatable Runtime check was interrupted (${interrupted
              .filter((check) => !check.repeatable)
              .map(({ id }) => id)
              .join(', ')}); a new Builder candidate is required before it can run again.`,
          });
          const written = await writePortableMutation({
            paths: options.paths,
            previous: state,
            next,
          });
          await writeNativeLocalExecution(
            nativeLocalExecutionFile(options.paths, state.name),
            rebuildNativeLocalExecution({
              portableState: written,
              projectRoot: options.paths.projectRoot,
              branch: currentBranch(options.paths.projectRoot),
            }),
            { containedRoot: options.paths.runtimeDir },
          );
          throw new Error(
            `Native check ${interrupted.find((check) => !check.repeatable)!.id} was interrupted and is not repeatable; the change returned to Build for a new candidate`,
          );
        }
      }
      if (local.execution !== null && local.checks.length > 0) {
        const sameInterruptedPlan =
          local.execution.stage === 'checking' &&
          local.execution.actor === 'runtime' &&
          local.checks.some((check) => check.status === 'interrupted') &&
          sameNativeCheckPlan(local, options.plans, options.projectRoot);
        if (!sameInterruptedPlan) {
          throw new Error('Native check plan was already resolved with a different plan');
        }
      } else if (local.execution !== null || local.checks.length > 0) {
        throw new Error('Native check plan was already resolved with a different plan');
      }
      const operationId = randomUUID();
      const operation: NativeLocalExecutionState = {
        ...local,
        execution: {
          operationId,
          stage: 'checking',
          actor: 'runtime',
          executionId: null,
          status: 'running',
          startedAt: new Date().toISOString(),
          requestCheckRounds: 0,
        },
        checks: options.plans.map((plan) => {
          const previous = local.checks.find((check) => check.id === plan.id);
          if (previous?.status === 'interrupted') {
            return resetInterruptedCheck(previous, plan, operationId, options.projectRoot);
          }
          if (previous) return { ...previous, operationId };
          return localCheck(plan, operationId, options.projectRoot);
        }),
      };
      await writeNativeLocalExecution(file, operation, { containedRoot: options.paths.runtimeDir });
      return {
        kind: 'execute',
        state,
        local: operation,
        plans: options.plans.filter((plan) => {
          const previous = local.checks.find((check) => check.id === plan.id);
          return previous === undefined || previous.status === 'interrupted';
        }),
      };
    },
  );
}

async function updateReservedNativeCheckPlan(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  operationId: string;
  update: (local: NativeLocalExecutionState) => NativeLocalExecutionState;
}): Promise<NativeLocalExecutionState> {
  return withNativeMutationLock(
    options.paths,
    `update portable checks ${options.state.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.state.name);
      if (
        state.state_version !== options.state.state_version ||
        state.phase !== 'verify' ||
        state.loop.stage !== 'verify-ready'
      ) {
        throw new Error('Native check plan state changed during execution');
      }
      const file = nativeLocalExecutionFile(options.paths, state.name);
      const local = await readNativeLocalExecution(file);
      if (
        local === null ||
        local.basedOnStateVersion !== state.state_version ||
        local.execution?.operationId !== options.operationId ||
        local.execution.stage !== 'checking' ||
        local.execution.actor !== 'runtime' ||
        local.execution.status !== 'running'
      ) {
        throw new Error('Native check plan reservation changed during execution');
      }
      const next = options.update(local);
      await writeNativeLocalExecution(file, next, { containedRoot: options.paths.runtimeDir });
      return next;
    },
  );
}

export async function executeNativePortableCheckPlan(options: {
  paths: NativeProjectPaths;
  name: string;
  plans: NativeCheckPlan[];
  projectRoot?: string;
}): Promise<{ state: NativePortableState; checks: NativePortableCheckSummary[] }> {
  const projectRoot = options.projectRoot ?? options.paths.projectRoot;
  if (new Set(options.plans.map(({ id }) => id)).size !== options.plans.length) {
    throw new Error('Native check plan contains duplicate IDs');
  }
  const normalizedPlans: NativeCheckPlan[] = [];
  const seenPlanKeys = new Set<string>();
  for (const plan of options.plans) {
    validateNativeCheckPlan(projectRoot, plan);
    const key = nativeCheckPlanKey(plan);
    if (seenPlanKeys.has(key)) continue;
    seenPlanKeys.add(key);
    normalizedPlans.push(plan);
  }
  const reservation = await reserveNativePortableCheckPlan({
    ...options,
    plans: normalizedPlans,
    projectRoot,
  });
  if (reservation.kind === 'reuse') return reservation;

  const operationId = reservation.local.execution!.operationId;
  const runtimeDir = nativePreferredChangeRuntimeDir(options.paths, reservation.state.name);
  try {
    for (const plan of reservation.plans) {
      const startedAt = new Date().toISOString();
      await updateReservedNativeCheckPlan({
        paths: options.paths,
        state: reservation.state,
        operationId,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) =>
            check.id === plan.id
              ? {
                  ...check,
                  status: 'running',
                  executionCount: check.executionCount + 1,
                  startedAt,
                }
              : check,
          ),
        }),
      });
      const result = await executeNativeCheck({
        projectRoot,
        runtimeDir,
        operationId,
        plan,
      });
      await updateReservedNativeCheckPlan({
        paths: options.paths,
        state: reservation.state,
        operationId,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) =>
            check.id === plan.id
              ? {
                  ...check,
                  status: result.status,
                  exitCode: result.exitCode,
                  startedAt: result.startedAt,
                  completedAt: result.completedAt,
                  log: result.logRef,
                }
              : check,
          ),
        }),
      });
    }
    await updateReservedNativeCheckPlan({
      paths: options.paths,
      state: reservation.state,
      operationId,
      update: (local) => ({
        ...local,
        execution: { ...local.execution!, status: 'completed' },
      }),
    });
  } catch (error) {
    try {
      await updateReservedNativeCheckPlan({
        paths: options.paths,
        state: reservation.state,
        operationId,
        update: (local) => ({
          ...local,
          execution: { ...local.execution!, status: 'interrupted' },
          checks: local.checks.map((check) =>
            check.status === 'planned' || check.status === 'running'
              ? { ...check, status: 'interrupted' as const }
              : check,
          ),
        }),
      });
    } catch {
      // Preserve the original execution failure; recovery will inspect the overlay.
    }
    throw error;
  }
  const finalLocal = await readNativeLocalExecution(
    nativeLocalExecutionFile(options.paths, reservation.state.name),
  );
  if (finalLocal === null)
    throw new Error('Native Runtime check state disappeared after execution');
  return {
    state: reservation.state,
    checks: authoritativePortableChecks({
      local: finalLocal,
      projectRoot,
      supplied: [],
    }),
  };
}

export interface NativePortableRequestChecksOutcome {
  round: number;
  reusedCheckIds: string[];
  executedCheckIds: string[];
}

interface NativeVerifierRequestedCheckReservation {
  state: NativePortableState;
  local: NativeLocalExecutionState;
  verifierExecutionRef: string;
  round: number;
  novelPlans: NativeCheckPlan[];
  requestedNames: ReadonlyMap<string, string>;
  reusedCheckIds: string[];
  suppliedChecks: readonly NativePortableCheckSummary[];
}

async function reserveVerifierRequestedChecks(options: {
  paths: NativeProjectPaths;
  projectRoot: string;
  state: NativePortableState;
  local: NativeLocalExecutionState;
  envelope: NativeTrustedVerifierEnvelope<unknown>;
  response: Extract<NativeVerifierResponse, { kind: 'request-checks' }>;
  suppliedChecks: readonly NativePortableCheckSummary[];
}): Promise<NativeVerifierRequestedCheckReservation> {
  const file = nativeLocalExecutionFile(options.paths, options.state.name);
  const local = options.local;
  if (
    local === null ||
    local.change !== options.state.name ||
    local.basedOnStateVersion !== options.state.state_version ||
    local.execution === null ||
    local.execution.stage !== 'verifying' ||
    local.execution.actor !== 'verifier' ||
    local.execution.status !== 'running'
  ) {
    throw new Error('Native Verifier request-checks has no active local execution');
  }
  if (
    local.execution.executionId !== null &&
    local.execution.executionId !== options.envelope.verifierExecutionRef
  ) {
    throw new Error('Native Verifier request-checks changed execution within the same attempt');
  }
  if (local.execution.requestCheckRounds >= NATIVE_MAX_REQUEST_CHECK_ROUNDS) {
    throw new Error(
      `Native Verifier request-checks exceeded ${NATIVE_MAX_REQUEST_CHECK_ROUNDS} rounds for this attempt`,
    );
  }

  const existingByKey = new Map<string, NativeLocalCheckState>();
  const existingByKeyAll = new Map<string, NativeLocalCheckState>();
  const existingKeyById = new Map<string, string>();
  for (const check of local.checks) {
    const key = localCheckPlanKey(check, options.projectRoot);
    existingByKeyAll.set(key, check);
    if (check.status !== 'interrupted') existingByKey.set(key, check);
    existingKeyById.set(check.id, key);
  }

  const requestedByKey = new Map<string, NativeCheckPlan>();
  const requestedKeyById = new Map<string, string>();
  for (const request of options.response.checks) {
    const plan = requestCheckPlan(request);
    validateNativeCheckPlan(options.projectRoot, plan);
    const key = nativeCheckPlanKey(plan);
    const previousRequestKey = requestedKeyById.get(plan.id);
    if (previousRequestKey !== undefined && previousRequestKey !== key) {
      throw new Error(`Native Verifier check ID ${plan.id} refers to conflicting commands`);
    }
    const existingKey = existingKeyById.get(plan.id);
    if (existingKey !== undefined && existingKey !== key) {
      throw new Error(`Native Verifier check ID ${plan.id} conflicts with a Runtime check`);
    }
    requestedKeyById.set(plan.id, key);
    const existing = existingByKeyAll.get(key);
    if (existing?.status === 'interrupted' && !existing.repeatable) {
      throw new Error(
        `Native check ${existing.id} was interrupted and is not repeatable; user resolution is required`,
      );
    }
    if (!requestedByKey.has(key)) requestedByKey.set(key, plan);
  }

  const requested = [...requestedByKey.entries()];
  const novel = requested.filter(([key]) => !existingByKey.has(key));
  if (local.execution.requestCheckRounds > 0 && novel.length === 0) {
    throw new Error('Native Verifier repeatedly requested only equivalent checks');
  }

  const round = local.execution.requestCheckRounds + 1;
  const requestedNames = new Map(requested.map(([, plan]) => [plan.id, plan.name] as const));
  const operation: NativeLocalExecutionState = {
    ...local,
    execution: {
      ...local.execution,
      stage: 'checking',
      actor: 'runtime',
      executionId: options.envelope.verifierExecutionRef,
      requestCheckRounds: round,
    },
    checks: [
      ...local.checks.map((check) => {
        const key = localCheckPlanKey(check, options.projectRoot);
        const plan = requestedByKey.get(key);
        return plan && check.status === 'interrupted'
          ? resetInterruptedCheck(check, plan, local.execution!.operationId, options.projectRoot)
          : check;
      }),
      ...novel
        .filter(([key]) => !existingByKeyAll.has(key))
        .map(([, plan]) => localCheck(plan, local.execution!.operationId, options.projectRoot)),
    ],
  };
  await writeNativeLocalExecution(file, operation, { containedRoot: options.paths.runtimeDir });

  return {
    state: options.state,
    local: operation,
    verifierExecutionRef: options.envelope.verifierExecutionRef,
    round,
    novelPlans: novel.map(([, plan]) => plan),
    requestedNames,
    reusedCheckIds: requested.filter(([key]) => existingByKey.has(key)).map(([, plan]) => plan.id),
    suppliedChecks: options.suppliedChecks,
  };
}

async function updateReservedVerifierRequestedChecks(options: {
  paths: NativeProjectPaths;
  reservation: NativeVerifierRequestedCheckReservation;
  update: (local: NativeLocalExecutionState) => NativeLocalExecutionState;
}): Promise<NativeLocalExecutionState> {
  return withNativeMutationLock(
    options.paths,
    `update Verifier-requested checks ${options.reservation.state.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.reservation.state.name);
      if (
        state.state_version !== options.reservation.state.state_version ||
        state.phase !== 'verify' ||
        state.loop.next_action !== 'await-verifier-result'
      ) {
        throw new Error('Native Verifier request-checks state changed during execution');
      }
      const file = nativeLocalExecutionFile(options.paths, state.name);
      const local = await readNativeLocalExecution(file);
      const execution = local?.execution;
      if (
        local === null ||
        local.basedOnStateVersion !== state.state_version ||
        execution === null ||
        execution === undefined ||
        execution.operationId !== options.reservation.local.execution?.operationId ||
        execution.stage !== 'checking' ||
        execution.actor !== 'runtime' ||
        execution.status !== 'running' ||
        execution.executionId !== options.reservation.verifierExecutionRef ||
        execution.requestCheckRounds !== options.reservation.round
      ) {
        throw new Error('Native Verifier request-checks reservation changed during execution');
      }
      const next = options.update(local);
      await writeNativeLocalExecution(file, next, { containedRoot: options.paths.runtimeDir });
      return next;
    },
  );
}

async function executeReservedVerifierRequestedChecks(options: {
  paths: NativeProjectPaths;
  projectRoot: string;
  reservation: NativeVerifierRequestedCheckReservation;
}): Promise<{
  checks: NativePortableCheckSummary[];
  requestChecks: NativePortableRequestChecksOutcome;
}> {
  let operation: NativeLocalExecutionState;
  try {
    for (const plan of options.reservation.novelPlans) {
      const startedAt = new Date().toISOString();
      operation = await updateReservedVerifierRequestedChecks({
        paths: options.paths,
        reservation: options.reservation,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) =>
            check.id === plan.id
              ? {
                  ...check,
                  status: 'running',
                  executionCount: check.executionCount + 1,
                  startedAt,
                }
              : check,
          ),
        }),
      });
      const result = await executeNativeCheck({
        projectRoot: options.projectRoot,
        runtimeDir: nativePreferredChangeRuntimeDir(options.paths, options.reservation.state.name),
        operationId: options.reservation.local.execution!.operationId,
        plan,
      });
      operation = await updateReservedVerifierRequestedChecks({
        paths: options.paths,
        reservation: options.reservation,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) =>
            check.id === plan.id
              ? {
                  ...check,
                  status: result.status,
                  exitCode: result.exitCode,
                  startedAt: result.startedAt,
                  completedAt: result.completedAt,
                  log: result.logRef,
                }
              : check,
          ),
        }),
      });
    }

    operation = await updateReservedVerifierRequestedChecks({
      paths: options.paths,
      reservation: options.reservation,
      update: (local) => ({
        ...local,
        execution: {
          ...local.execution!,
          stage: 'verifying',
          actor: 'verifier',
          executionId: options.reservation.verifierExecutionRef,
        },
      }),
    });
  } catch (error) {
    try {
      await updateReservedVerifierRequestedChecks({
        paths: options.paths,
        reservation: options.reservation,
        update: (local) => ({
          ...local,
          execution: { ...local.execution!, status: 'interrupted' },
          checks: local.checks.map((check) =>
            check.status === 'planned' || check.status === 'running'
              ? { ...check, status: 'interrupted' as const }
              : check,
          ),
        }),
      });
    } catch {
      // Preserve the original execution failure; recovery will inspect the overlay.
    }
    throw error;
  }
  return {
    checks: authoritativePortableChecks({
      local: operation,
      projectRoot: options.projectRoot,
      supplied: options.reservation.suppliedChecks,
      requestedNames: options.reservation.requestedNames,
    }),
    requestChecks: {
      round: options.reservation.round,
      reusedCheckIds: options.reservation.reusedCheckIds,
      executedCheckIds: options.reservation.novelPlans.map(({ id }) => id),
    },
  };
}

export async function dispatchNativePortableVerifier(options: {
  paths: NativeProjectPaths;
  name: string;
  checks: NativePortableCheckSummary[];
  verifierExecutionId?: string | null;
  projectRoot?: string;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `dispatch portable verifier ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      const projectRoot = options.projectRoot ?? options.paths.projectRoot;
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      const localBeforeDispatch = (
        await readOrRebuildNativeLocalExecution({
          file: nativeLocalExecutionFile(options.paths, state.name),
          portableState: state,
          projectRoot,
          branch: currentBranch(projectRoot),
          containedRoot: options.paths.runtimeDir,
        })
      ).state;
      if (
        localBeforeDispatch.execution?.stage !== 'checking' ||
        localBeforeDispatch.execution.actor !== 'runtime' ||
        localBeforeDispatch.execution.status !== 'completed'
      ) {
        throw new Error('Native check plan must be explicitly resolved before Verifier dispatch');
      }
      authoritativePortableChecks({
        local: localBeforeDispatch,
        projectRoot,
        supplied: options.checks,
      });
      const next = reserveNativeVerifierAttempt(state);
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      const file = nativeLocalExecutionFile(options.paths, state.name);
      const operationId = randomUUID();
      await writeNativeLocalExecution(
        file,
        {
          ...localBeforeDispatch,
          basedOnStateVersion: written.state_version,
          execution: {
            operationId,
            stage: 'verifying',
            actor: 'verifier',
            executionId: options.verifierExecutionId ?? null,
            status: 'running',
            startedAt: new Date().toISOString(),
            requestCheckRounds: 0,
          },
          checks: localBeforeDispatch.checks.map((check) => ({ ...check, operationId })),
        },
        { containedRoot: options.paths.runtimeDir },
      );
      return written;
    },
  );
}

export async function submitNativePortableVerifierResult(options: {
  paths: NativeProjectPaths;
  name: string;
  envelope: NativeTrustedVerifierEnvelope<unknown> | unknown;
  checks: NativePortableCheckSummary[];
  maxVerifyFailures: number;
  projectRoot?: string;
}): Promise<{
  state: NativePortableState;
  response: NativeVerifierResponse;
  checks: NativePortableCheckSummary[];
  requestChecks: NativePortableRequestChecksOutcome | null;
}> {
  if (!Number.isSafeInteger(options.maxVerifyFailures) || options.maxVerifyFailures < 1) {
    throw new Error('Native max Verify failures must be a positive integer');
  }
  const prepared = await withNativeMutationLock(
    options.paths,
    `apply portable verifier ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      const projectRoot = options.projectRoot ?? options.paths.projectRoot;
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      const local = await readCurrentLocalExecution({ paths: options.paths, state });
      const trustedEnvelope = assertCurrentVerifierEnvelope({
        state,
        local,
        envelope: options.envelope,
      });
      let parsedResponse: NativeVerifierResponse;
      try {
        parsedResponse = parseNativeVerifierResponse(trustedEnvelope.payload);
      } catch (error) {
        const summary = `Native Verifier response was invalid: ${(error as Error).message}`;
        const failed = await persistVerifierExecutionError({
          paths: options.paths,
          state,
          summary,
        });
        throw new Error(
          `${summary}; execution error ${failed.loop.execution_failure_count}/${NATIVE_MAX_VERIFIER_EXECUTION_FAILURES} was recorded`,
          { cause: error },
        );
      }
      const position = nativeVerifierResponsePosition(parsedResponse);
      if (position.iteration !== state.loop.iteration || position.attempt !== state.loop.attempt) {
        throw new Error('Native Verifier result is stale for the current iteration or attempt');
      }
      let runtimeChecks: NativePortableCheckSummary[] = [];
      let finalResult: ReturnType<typeof applyNativeVerifierEnvelope>;
      try {
        if (local !== null) {
          runtimeChecks = authoritativePortableChecks({
            local,
            projectRoot,
            supplied: options.checks,
          });
        }
        const result = applyNativeVerifierEnvelope({
          state,
          envelope: trustedEnvelope,
          checks: runtimeChecks,
          maxVerifyFailures: options.maxVerifyFailures,
        });
        if (result.response.kind === 'request-checks') {
          if (local === null) {
            throw new Error('Native Verifier request-checks has no active local execution');
          }
          const reservation = await reserveVerifierRequestedChecks({
            paths: options.paths,
            projectRoot,
            state,
            local,
            envelope: trustedEnvelope,
            response: result.response,
            suppliedChecks: runtimeChecks,
          });
          return {
            kind: 'request-checks' as const,
            state,
            response: result.response,
            reservation,
          };
        }
        if (
          local === null ||
          local.execution === null ||
          local.execution.stage !== 'verifying' ||
          local.execution.actor !== 'verifier' ||
          local.execution.status !== 'running'
        ) {
          throw new Error('Native Verifier final result has no active local execution');
        }
        if (
          local.execution.executionId !== null &&
          local.execution.executionId !== trustedEnvelope.verifierExecutionRef
        ) {
          throw new Error('Native Verifier final result changed execution within the same attempt');
        }
        finalResult = result;
      } catch (error) {
        const summary = `Native Verifier response was invalid: ${(error as Error).message}`;
        const failed = await persistVerifierExecutionError({
          paths: options.paths,
          state,
          summary,
        });
        throw new Error(
          `${summary}; execution error ${failed.loop.execution_failure_count}/${NATIVE_MAX_VERIFIER_EXECUTION_FAILURES} was recorded`,
          { cause: error },
        );
      }
      const written = await writePortableMutation({
        paths: options.paths,
        previous: state,
        next: finalResult.state,
      });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        written.loop.next_action === 'resolve-verifier-blocker' ||
          written.loop.next_action === 'run-final-full-verification'
          ? preservedLocalChecksForVersion({
              local,
              state: written,
              projectRoot,
            })
          : rebuildNativeLocalExecution({
              portableState: written,
              projectRoot,
              branch: currentBranch(projectRoot),
            }),
        { containedRoot: options.paths.runtimeDir },
      );
      if (written.verification !== null) {
        await writeNativeVerificationReport({
          file: path.join(nativePortableChangeDir(options.paths, state.name), 'verification.md'),
          state: written,
        });
      }
      return {
        kind: 'final-result' as const,
        result: {
          state: written,
          response: finalResult.response,
          checks: runtimeChecks,
          requestChecks: null,
        },
      };
    },
  );
  if (prepared.kind === 'final-result') return prepared.result;

  try {
    const requested = await executeReservedVerifierRequestedChecks({
      paths: options.paths,
      projectRoot: options.projectRoot ?? options.paths.projectRoot,
      reservation: prepared.reservation,
    });
    return {
      state: prepared.state,
      response: prepared.response,
      checks: requested.checks,
      requestChecks: requested.requestChecks,
    };
  } catch (error) {
    const summary = `Native Verifier response was invalid: ${(error as Error).message}`;
    const failed = await withNativeMutationLock(
      options.paths,
      `record Verifier-requested check failure ${options.name}`,
      async () => {
        const current = await readNativePortableChange(options.paths, options.name);
        if (current.state_version !== prepared.state.state_version) return null;
        return persistVerifierExecutionError({
          paths: options.paths,
          state: current,
          summary,
        });
      },
    );
    throw new Error(
      failed
        ? `${summary}; execution error ${failed.loop.execution_failure_count}/${NATIVE_MAX_VERIFIER_EXECUTION_FAILURES} was recorded`
        : `${summary}; the portable state changed before the execution error could be recorded`,
      { cause: error },
    );
  }
}

export async function recordNativePortableVerifierFailure(options: {
  paths: NativeProjectPaths;
  name: string;
  summary: string;
  expected: NativeVerifierAttemptBinding;
  requireSkillCoordination?: boolean;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `record portable verifier failure ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      const local = await readCurrentLocalExecution({ paths: options.paths, state });
      assertCurrentVerifierAttempt({ state, local, expected: options.expected });
      if (
        options.requireSkillCoordination &&
        state.builder_handoff?.identity_provider !== 'skill-coordinated'
      ) {
        throw new Error('Native Skill coordination has no current generic Builder candidate');
      }
      return persistVerifierExecutionError({
        paths: options.paths,
        state,
        summary: options.summary,
      });
    },
  );
}

export async function recordNativePortableVerifierUnavailable(options: {
  paths: NativeProjectPaths;
  name: string;
  summary: string;
  expected: NativeVerifierAttemptBinding;
  requireSkillCoordination?: boolean;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `record unavailable portable verifier ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      const local = await readCurrentLocalExecution({ paths: options.paths, state });
      const activeLocal = assertCurrentVerifierAttempt({
        state,
        local,
        expected: options.expected,
      });
      if (
        options.requireSkillCoordination &&
        state.builder_handoff?.identity_provider !== 'skill-coordinated'
      ) {
        throw new Error('Native Skill coordination has no current generic Builder candidate');
      }
      const checks = authoritativePortableChecks({
        local: activeLocal,
        projectRoot: options.paths.projectRoot,
        supplied: [],
      });
      const next = recordNativeVerifierUnavailable({
        state,
        checks,
        verifierExecutionRef: activeLocal.execution!.executionId!,
        summary: options.summary,
      });
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        preservedLocalChecksForVersion({
          local: activeLocal,
          state: written,
          projectRoot: options.paths.projectRoot,
        }),
        { containedRoot: options.paths.runtimeDir },
      );
      await writeNativeVerificationReport({
        file: path.join(nativePortableChangeDir(options.paths, state.name), 'verification.md'),
        state: written,
      });
      return written;
    },
  );
}

export async function confirmNativePortableSkillCoordinatedPass(options: {
  paths: NativeProjectPaths;
  name: string;
  expectedContinuation?: NativePortableExpectedContinuation;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `confirm portable Skill-coordinated pass ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      assertNativePortableExpectedContinuationLocked({
        state,
        expected: options.expectedContinuation,
        action: 'accept-result',
      });
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      const next = confirmNativeSkillCoordinatedPass(state);
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        rebuildNativeLocalExecution({
          portableState: written,
          projectRoot: options.paths.projectRoot,
          branch: currentBranch(options.paths.projectRoot),
        }),
        { containedRoot: options.paths.runtimeDir },
      );
      await writeNativeVerificationReport({
        file: path.join(nativePortableChangeDir(options.paths, state.name), 'verification.md'),
        state: written,
      });
      return written;
    },
  );
}

export async function confirmNativePortableVerifierUnavailable(options: {
  paths: NativeProjectPaths;
  name: string;
  summary: string;
  expectedContinuation?: NativePortableExpectedContinuation;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `confirm unavailable portable verifier ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      assertNativePortableExpectedContinuationLocked({
        state,
        expected: options.expectedContinuation,
        action: 'confirm-verifier-unavailable',
      });
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      const next = confirmNativeVerifierUnavailable({ state, summary: options.summary });
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        rebuildNativeLocalExecution({
          portableState: written,
          projectRoot: options.paths.projectRoot,
          branch: currentBranch(options.paths.projectRoot),
        }),
        { containedRoot: options.paths.runtimeDir },
      );
      await writeNativeVerificationReport({
        file: path.join(nativePortableChangeDir(options.paths, state.name), 'verification.md'),
        state: written,
      });
      return written;
    },
  );
}

export async function resolveNativePortableVerifierBlocker(options: {
  paths: NativeProjectPaths;
  name: string;
  reason?: string;
  expectedContinuation?: NativePortableExpectedContinuation;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `resolve portable verifier blocker ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      assertNativePortableExpectedContinuationLocked({
        state,
        expected: options.expectedContinuation,
        action: 'resolve-verifier-blocker',
      });
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      const local = await readCurrentLocalExecution({ paths: options.paths, state });
      const next = resolveNativeVerifierBlocker(state, { reason: options.reason });
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        preservedLocalChecksForVersion({
          local,
          state: written,
          projectRoot: options.paths.projectRoot,
        }),
        { containedRoot: options.paths.runtimeDir },
      );
      return written;
    },
  );
}

export async function retryNativePortableVerifier(options: {
  paths: NativeProjectPaths;
  name: string;
  expectedContinuation?: NativePortableExpectedContinuation;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `retry portable verifier ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      assertNativePortableExpectedContinuationLocked({
        state,
        expected: options.expectedContinuation,
        action: 'retry-verifier',
      });
      const local = await readCurrentLocalExecution({ paths: options.paths, state });
      const next = retryNativeVerifier(state);
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        preservedLocalChecksForVersion({
          local,
          state: written,
          projectRoot: options.paths.projectRoot,
        }),
        { containedRoot: options.paths.runtimeDir },
      );
      return written;
    },
  );
}

export async function returnNativePortableChangeToBuild(options: {
  paths: NativeProjectPaths;
  name: string;
  reason: string;
  expectedContinuation?: NativePortableExpectedContinuation;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `return portable change ${options.name} to Build`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      assertNativePortableExpectedContinuationLocked({
        state,
        expected: options.expectedContinuation,
        action: 'revise-implementation',
      });
      if (state.phase === 'build') return state;
      const next = returnNativeCandidateToBuild({ state, reason: options.reason });
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        rebuildNativeLocalExecution({
          portableState: written,
          projectRoot: options.paths.projectRoot,
          branch: currentBranch(options.paths.projectRoot),
        }),
        { containedRoot: options.paths.runtimeDir },
      );
      return written;
    },
  );
}

export async function markNativePortableSpecRemoval(options: {
  paths: NativeProjectPaths;
  name: string;
  capability: string;
}): Promise<NativePortableState> {
  if (!NAME_PATTERN.test(options.capability)) {
    throw new Error(`Invalid Native capability: ${options.capability}`);
  }
  return withNativeMutationLock(
    options.paths,
    `remove portable spec ${options.capability}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      if (state.archived) throw new Error(`Native change ${state.name} is already archived`);
      const existing = state.spec_changes.filter(
        ({ capability }) => capability !== options.capability,
      );
      const next: NativePortableState = {
        ...state,
        phase: 'shape',
        status: 'active',
        state_version: state.state_version + 1,
        spec_changes: [
          ...existing,
          { capability: options.capability, operation: 'remove', source: null } as const,
        ].sort((left, right) => left.capability.localeCompare(right.capability, 'en')),
        acceptance: [],
        builder_handoff: null,
        blockers: [],
        verification: null,
        verification_result: 'pending',
        verification_report: null,
        history: [],
        history_overflow: {
          dropped_entries: 0,
          first_dropped_at: null,
          last_dropped_at: null,
          outcome_counts: {
            pass: 0,
            fail: 0,
            blocked: 0,
            'execution-error': 0,
            recovery: 0,
          },
        },
        loop: {
          stage: 'shape',
          goal_cycle: state.loop.goal_cycle + (state.phase === 'shape' ? 0 : 1),
          iteration: 0,
          attempt: 0,
          retry_epoch: 0,
          failed_iteration_count: 0,
          no_progress_count: 0,
          execution_failure_count: 0,
          previous_unresolved_ids: [],
          next_action: 'confirm-shape',
        },
      };
      delete next.children_contract_hash;
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        rebuildNativeLocalExecution({
          portableState: written,
          projectRoot: options.paths.projectRoot,
          branch: currentBranch(options.paths.projectRoot),
        }),
        { containedRoot: options.paths.runtimeDir },
      );
      return written;
    },
  );
}

export async function setNativePortableWorkspaceFinish(options: {
  paths: NativeProjectPaths;
  name: string;
  finish: NonNullable<NativePortableWorkspace['finish']>;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `set portable workspace finish ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      if (state.workspace.isolation === 'current') {
        throw new Error('Native current-workspace isolation does not accept a finish action');
      }
      const next: NativePortableState = {
        ...state,
        state_version: state.state_version + 1,
        workspace: { ...state.workspace, finish: options.finish },
      };
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        rebuildNativeLocalExecution({
          portableState: written,
          projectRoot: options.paths.projectRoot,
          branch: currentBranch(options.paths.projectRoot),
        }),
        { containedRoot: options.paths.runtimeDir },
      );
      if (written.verification !== null) {
        await writeNativeVerificationReport({
          file: path.join(nativePortableChangeDir(options.paths, state.name), 'verification.md'),
          state: written,
        });
      }
      return written;
    },
  );
}

export async function returnNativePortableChangeToShape(options: {
  paths: NativeProjectPaths;
  name: string;
  reason: string;
  allowedPhases?: readonly NativePortablePhase[];
  expectedContinuation?: NativePortableExpectedContinuation;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `return portable change ${options.name} to Shape`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      assertNativePortableExpectedContinuationLocked({
        state,
        expected: options.expectedContinuation,
        action: 'revise-requirements',
      });
      if (options.allowedPhases && !options.allowedPhases.includes(state.phase)) {
        throw new Error('--revise-requirements is only valid from Verify or Archive');
      }
      if (state.phase === 'shape') return state;
      return returnNativePortableStateToShapeLocked({
        paths: options.paths,
        state,
        reason: options.reason,
      });
    },
  );
}

export async function returnNativePortableStateToShapeLocked(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  reason: string;
}): Promise<NativePortableState> {
  const { state } = options;
  if (state.archived) throw new Error(`Native change ${state.name} is already archived`);
  const withHistory = appendNativePortableHistory(state, {
    goal_cycle: state.loop.goal_cycle,
    iteration: state.loop.iteration,
    attempt: state.loop.attempt,
    outcome: 'recovery',
    unresolved_ids: [],
    summary: toNativePortableText(options.reason),
    completed_at: new Date().toISOString(),
  });
  const next: NativePortableState = {
    ...withHistory,
    phase: 'shape',
    status: 'active',
    state_version: state.state_version + 1,
    acceptance: [],
    builder_handoff: null,
    blockers: [],
    verification: null,
    verification_result: 'pending',
    verification_report: null,
    loop: {
      stage: 'shape',
      goal_cycle: state.loop.goal_cycle + 1,
      iteration: 0,
      attempt: 0,
      retry_epoch: 0,
      failed_iteration_count: 0,
      no_progress_count: 0,
      execution_failure_count: 0,
      previous_unresolved_ids: [],
      next_action: 'confirm-shape',
    },
  };
  delete next.children_contract_hash;
  const written = await writePortableMutation({ paths: options.paths, previous: state, next });
  await writeNativeLocalExecution(
    nativeLocalExecutionFile(options.paths, state.name),
    rebuildNativeLocalExecution({
      portableState: written,
      projectRoot: options.paths.projectRoot,
      branch: currentBranch(options.paths.projectRoot),
    }),
    { containedRoot: options.paths.runtimeDir },
  );
  return written;
}

export async function ensureNativePortableReport(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<'aligned' | 'rebuilt' | 'not-applicable'> {
  if (options.state.verification === null) return 'not-applicable';
  const file = path.join(
    nativePortableChangeDir(options.paths, options.state.name),
    'verification.md',
  );
  const alignment = await inspectNativeVerificationReportAlignment({
    file,
    stateVersion: options.state.state_version,
  });
  if (alignment === 'aligned') return 'aligned';
  await writeNativeVerificationReport({ file, state: options.state });
  return 'rebuilt';
}

export async function readNativePortableRuntime(options: {
  paths: NativeProjectPaths;
  name: string;
}): Promise<{
  state: NativePortableState;
  local: NativeLocalExecutionState | null;
  localStatus: 'available' | 'missing' | 'invalid' | 'stale';
}> {
  const state = await readNativePortableChange(options.paths, options.name);
  const file = nativeLocalExecutionFile(options.paths, options.name);
  try {
    const local = await readNativeLocalExecution(file);
    if (local === null) return { state, local: null, localStatus: 'missing' };
    if (local.change !== state.name || local.basedOnStateVersion !== state.state_version) {
      return { state, local: null, localStatus: 'stale' };
    }
    return { state, local, localStatus: 'available' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { state, local: null, localStatus: 'missing' };
    }
    return { state, local: null, localStatus: 'invalid' };
  }
}
