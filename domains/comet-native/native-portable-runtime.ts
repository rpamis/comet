import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  currentGitBranch,
  inspectGitWorktree,
  resolveGitRef,
} from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';

import { atomicWriteText } from './native-atomic-file.js';
import { nativeBriefHasBlockingQuestion } from './native-artifacts.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { canonicalHash } from './native-canonical-hash.js';
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
  advanceNativeSupervisorFinalVerificationHead,
  prepareNativeSupervisorIntegrationWorkspace,
  recordNativeSupervisorPortableFinalVerification,
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
  preflightNativeCheckPlans,
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
  prepareNativePortableShapeConfirmation as prepareNativePortableShapeConfirmationState,
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
  applyNativeDelta,
  inspectNativeTotalSpec,
  mergeNativeDeltaAgainstCurrent,
  NATIVE_DELTA_FILE,
  nativeDeltaAcceptanceMarkdown,
  nativeLegacySectionHash,
  nativeTotalSpecHash,
  parseNativeDelta,
  renderNativeDelta,
} from './native-delta-spec.js';
import {
  appendNativePortableHistory,
  compareAndSwapNativePortableState,
  createNativePortableState,
  readNativePortableState,
  writeNativePortableState,
} from './native-portable-state.js';
import { readNativePortableTransaction } from './native-portable-transactions.js';
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
import {
  removeNativeVerificationReportSnapshot,
  writeNativeVerificationReportSnapshot,
} from './native-evidence-storage.js';
import type { CometProjectConfig, NativeProjectPaths } from './native-types.js';
import type { NativeSupervisorCoordinationMode } from './native-portable-types.js';
import type { NativeWorkspaceBinding } from './native-workspace.js';
import { readProjectConfig, writeProjectConfig } from './native-config.js';
import { parseCapabilityAssociationDraft } from '../project-knowledge/capability-discovery.js';

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
export const NATIVE_PORTABLE_STATE_FILE = 'comet-state.yaml';
export const NATIVE_LOCAL_EXECUTION_FILE = 'state.json';

export const NATIVE_PORTABLE_BRIEF_TEMPLATE = nativeBriefTemplate('en');
const NATIVE_CAPABILITY_ASSOCIATION_FILE = 'capability-association.yaml';

export type NativePortableExpectedContinuationAction =
  | 'prepare-shape-confirmation'
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
  return currentGitBranch(projectRoot);
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
          nextAction: 'prepare-shape-confirmation',
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
    let canonicalHash: string | null = null;
    try {
      const canonicalStat = await fs.lstat(canonical);
      if (!canonicalStat.isFile() || canonicalStat.isSymbolicLink()) {
        throw new Error(`Canonical Native spec is unsafe: ${entry.name}`);
      }
      operation = 'modify';
      canonicalHash = nativeTotalSpecHash(
        (
          await readNativeBoundedTextFile({
            root: options.paths.specsDir,
            ref: `${entry.name}/spec.md`,
            maxBytes: null,
            includeHash: false,
          })
        ).text,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const deltaSource = `specs/${entry.name}/${NATIVE_DELTA_FILE}`;
    const deltaFile = path.join(changeDir, ...deltaSource.split('/'));
    let deltaMetadata: Pick<NativePortableSpecChange, 'delta_source' | 'base_hash'> = {};
    try {
      const deltaStat = await fs.lstat(deltaFile);
      if (!deltaStat.isFile() || deltaStat.isSymbolicLink()) {
        throw new Error(`Native delta manifest must be a regular file: ${deltaSource}`);
      }
      const deltaText = await readNativeBoundedTextFile({
        root: changeDir,
        ref: deltaSource,
        maxBytes: null,
        includeHash: false,
      });
      const delta = parseNativeDelta(deltaText.text);
      if (delta.capability !== entry.name) {
        throw new Error(
          `Native delta capability ${delta.capability} does not match directory ${entry.name}`,
        );
      }
      const expectedBaseHash = canonicalHash ?? nativeTotalSpecHash('');
      const previous = options.state.spec_changes.find(
        (change) => change.capability === entry.name,
      );
      if (previous?.delta_source !== undefined) {
        if (previous.base_hash !== delta.base_hash) {
          throw new Error(
            `Native delta base changed for ${entry.name}; explicit conversion is required`,
          );
        }
      } else if (delta.base_hash !== expectedBaseHash) {
        throw new Error(
          `Native delta base_hash does not match the current total Spec for ${entry.name}`,
        );
      }
      deltaMetadata = { delta_source: deltaSource, base_hash: delta.base_hash };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    changes.push({ capability: entry.name, operation, source, ...deltaMetadata });
  }
  changes.push(...removals.values());
  return changes.sort((left, right) => left.capability.localeCompare(right.capability, 'en'));
}

/**
 * Rebase independent canonical edits into the active delta before Verify is
 * restarted. The caller must hold the Native mutation lock.
 */
export async function rebaseNativePortableDeltasLocked(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<{ state: NativePortableState; rebased: boolean; capabilities: string[] }> {
  const changeRoot = nativePortableChangeDir(options.paths, options.state.name);
  const specChanges = await discoverNativePortableSpecChanges(options);
  const nextSpecChanges = [...specChanges];
  const capabilities: string[] = [];
  const pending: Array<{
    readonly index: number;
    readonly spec: NativePortableSpecChange;
    readonly originalDeltaText: string;
    readonly originalSourceText: string;
    readonly deltaText: string;
    readonly sourceText: string;
  }> = [];

  for (const [index, spec] of specChanges.entries()) {
    if (!spec.delta_source || !spec.source) continue;
    const deltaText = await readNativeBoundedTextFile({
      root: changeRoot,
      ref: spec.delta_source,
      maxBytes: null,
      includeHash: false,
    });
    const delta = parseNativeDelta(deltaText.text);
    let canonicalText = '';
    try {
      canonicalText = (
        await readNativeBoundedTextFile({
          root: options.paths.specsDir,
          ref: `${spec.capability}/spec.md`,
          maxBytes: null,
          includeHash: false,
        })
      ).text;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const merged = mergeNativeDeltaAgainstCurrent({
      currentMarkdown: canonicalText,
      delta,
    });
    if (!merged.rebased) continue;

    const currentSpec = inspectNativeTotalSpec(canonicalText);
    const currentRequirementHashes = Object.fromEntries(
      currentSpec.requirements.map((requirement) => [
        requirement.id,
        nativeTotalSpecHash(requirement.raw),
      ]),
    );
    const rebasedIndependentRequirements =
      delta.independent_requirements === undefined
        ? undefined
        : Object.fromEntries(
            Object.keys(delta.independent_requirements).flatMap((id) => {
              const requirement = currentSpec.requirements.find((candidate) => candidate.id === id);
              return requirement ? [[id, nativeTotalSpecHash(requirement.raw)]] : [];
            }),
          );
    const rebasedDelta = {
      ...delta,
      base_hash: nativeTotalSpecHash(canonicalText),
      base_version: delta.base_version + 1,
      legacy_hash: nativeLegacySectionHash(canonicalText),
      base_requirements: currentRequirementHashes,
      ...(rebasedIndependentRequirements === undefined
        ? {}
        : { independent_requirements: rebasedIndependentRequirements }),
    };
    const source = await readNativeBoundedTextFile({
      root: changeRoot,
      ref: spec.source,
      maxBytes: null,
      includeHash: false,
    });
    pending.push({
      index,
      spec,
      originalDeltaText: deltaText.text,
      originalSourceText: source.text,
      deltaText: renderNativeDelta(rebasedDelta),
      sourceText: merged.markdown,
    });
    nextSpecChanges[index] = {
      ...spec,
      base_hash: rebasedDelta.base_hash,
    };
    capabilities.push(spec.capability);
  }

  if (capabilities.length === 0) {
    return { state: options.state, rebased: false, capabilities };
  }
  let stateWritten = false;
  try {
    for (const entry of pending) {
      await atomicWriteText(
        path.join(changeRoot, ...entry.spec.delta_source!.split('/')),
        entry.deltaText,
        { containedRoot: options.paths.nativeRoot },
      );
      await atomicWriteText(
        path.join(changeRoot, ...entry.spec.source!.split('/')),
        entry.sourceText,
        {
          containedRoot: options.paths.nativeRoot,
        },
      );
    }
    const rebasedStateForShape = { ...options.state, spec_changes: nextSpecChanges };
    const shape = await readNativePortableAcceptance({
      paths: options.paths,
      state: rebasedStateForShape,
      specChanges: nextSpecChanges,
    });
    if (!sameNativePortableAcceptance(options.state.acceptance, shape.acceptance)) {
      throw new Error(
        'Native delta rebase changed the confirmed acceptance scope; explicit Shape confirmation is required',
      );
    }
    const children = await readNativeChildrenContract({
      changeDir: changeRoot,
      acceptanceIds: shape.acceptance.map(({ id }) => id),
      validation: nativeChildrenAcceptanceValidation({
        ...rebasedStateForShape,
        acceptance: shape.acceptance,
      }),
    });
    const state = await writePortableMutation({
      paths: options.paths,
      previous: options.state,
      next: {
        ...options.state,
        state_version: options.state.state_version + 1,
        spec_changes: nextSpecChanges,
        shape_confirmation_hash: nativePortableShapeConfirmationHash({
          formalHash: shape.formalHash,
          childrenHash: children?.hash ?? null,
          coordinationMode: options.state.coordination_mode,
        }),
      },
    });
    stateWritten = true;
    return { state, rebased: true, capabilities };
  } catch (error) {
    if (!stateWritten) {
      for (const entry of pending) {
        await atomicWriteText(
          path.join(changeRoot, ...entry.spec.delta_source!.split('/')),
          entry.originalDeltaText,
          { containedRoot: options.paths.nativeRoot },
        );
        await atomicWriteText(
          path.join(changeRoot, ...entry.spec.source!.split('/')),
          entry.originalSourceText,
          { containedRoot: options.paths.nativeRoot },
        );
      }
    }
    throw error;
  }
}

/** Rebase and return a passed Native change to the final Verify boundary. */
export async function rebaseNativePortableDeltas(options: {
  paths: NativeProjectPaths;
  name: string;
  reason?: string;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `rebase portable deltas ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      const result = await rebaseNativePortableDeltasLocked({ paths: options.paths, state });
      if (!result.rebased) return state;
      return returnNativePortableStateToFinalVerificationLocked({
        paths: options.paths,
        state: result.state,
        reason:
          options.reason ??
          'Native canonical Spec changed independently; the delta was re-based before fresh verification.',
      });
    },
  );
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
  if (nativeBriefHasBlockingQuestion(brief.text)) {
    throw new Error('Brief has a blocking open question');
  }
  const specs = [];
  const specArtifacts = [];
  for (const spec of options.specChanges) {
    if (spec.source === null) {
      specArtifacts.push({ ...spec, contentHash: null });
      continue;
    }
    const source = await readNativeBoundedTextFile({
      root: changeDir,
      ref: spec.source,
      maxBytes: null,
      includeHash: false,
    });
    let acceptanceMarkdown = source.text;
    let deltaContentHash: string | null = null;
    if (spec.delta_source) {
      const delta = await readNativeBoundedTextFile({
        root: changeDir,
        ref: spec.delta_source,
        maxBytes: null,
        includeHash: false,
      });
      const parsedDelta = parseNativeDelta(delta.text);
      acceptanceMarkdown = nativeDeltaAcceptanceMarkdown(source.text, parsedDelta);
      let canonicalMarkdown = '';
      try {
        canonicalMarkdown = (
          await readNativeBoundedTextFile({
            root: options.paths.specsDir,
            ref: `${spec.capability}/spec.md`,
            maxBytes: null,
            includeHash: false,
          })
        ).text;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (nativeTotalSpecHash(canonicalMarkdown) === parsedDelta.base_hash) {
        const expected = applyNativeDelta({
          baselineMarkdown: canonicalMarkdown,
          delta: parsedDelta,
          allowAlreadyApplied: true,
        });
        if (nativeTotalSpecHash(source.text) !== expected.result_hash) {
          throw new Error(
            `Native full target Spec does not match delta result for ${spec.capability}; update the complete target before confirming Shape`,
          );
        }
      }
      deltaContentHash = canonicalHash('comet.native.shape-artifact-content.v1', delta.text);
    }
    specs.push({ capability: spec.capability, source: source.ref, markdown: acceptanceMarkdown });
    specArtifacts.push({
      ...spec,
      contentHash: canonicalHash('comet.native.shape-artifact-content.v1', source.text),
      ...(deltaContentHash === null ? {} : { deltaContentHash }),
    });
  }
  let associationContentHash: string | null = null;
  try {
    const association = await readNativeBoundedTextFile({
      root: changeDir,
      ref: NATIVE_CAPABILITY_ASSOCIATION_FILE,
      maxBytes: 64 * 1024,
      includeHash: false,
    });
    const draft = parseCapabilityAssociationDraft(association.text);
    if (draft.workflow !== 'native') {
      throw new Error('Native capability association must use the native workflow');
    }
    const declared = options.specChanges.some(({ capability }) => capability === draft.capability);
    if (!declared) {
      throw new Error(
        `Native capability association ${draft.capability} is not declared by this change`,
      );
    }
    const expectedSource = path
      .relative(
        options.paths.projectRoot,
        path.join(options.paths.specsDir, draft.capability, 'spec.md'),
      )
      .replaceAll(path.sep, '/');
    if (draft.current_spec !== expectedSource) {
      throw new Error(
        `Native capability association points to ${draft.current_spec}, expected ${expectedSource}`,
      );
    }
    // The hash is discovery evidence, not a second baseline. A later canonical
    // edit is handled by the delta merge/reverification path below; treating a
    // stale evidence hash as Shape drift would bypass that safe rebase path.
    associationContentHash = canonicalHash(
      'comet.native.shape-artifact-content.v1',
      association.text,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    acceptance: buildNativePortableAcceptance({ briefMarkdown: brief.text, specs }),
    formalHash: canonicalHash('comet.native.shape-formal-artifacts.v1', {
      brief: {
        source: brief.ref,
        contentHash: canonicalHash('comet.native.shape-artifact-content.v1', brief.text),
      },
      specs: specArtifacts,
      association: {
        source: NATIVE_CAPABILITY_ASSOCIATION_FILE,
        contentHash: associationContentHash,
      },
    }),
  };
}

function nativePortableShapeConfirmationHash(options: {
  formalHash: string;
  childrenHash: string | null;
  coordinationMode: NativeSupervisorCoordinationMode | undefined;
}): string {
  return canonicalHash('comet.native.shape-confirmation.v1', {
    formalHash: options.formalHash,
    childrenHash: options.childrenHash,
    coordinationMode: options.coordinationMode ?? null,
  });
}

export async function prepareNativePortableShapeConfirmation(options: {
  paths: NativeProjectPaths;
  name: string;
  coordinationMode?: NativeSupervisorCoordinationMode;
  expectedContinuation?: NativePortableExpectedContinuation;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `prepare portable shape confirmation ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      assertNativePortableExpectedContinuationLocked({
        state,
        expected: options.expectedContinuation,
        action: 'prepare-shape-confirmation',
      });
      if (state.phase !== 'shape' || state.status !== 'active' || state.loop.stage !== 'shape') {
        throw new Error('Native Shape confirmation can only be prepared from active Shape');
      }
      const specChanges = await discoverNativePortableSpecChanges({ paths: options.paths, state });
      const shape = await readNativePortableAcceptance({
        paths: options.paths,
        state,
        specChanges,
      });
      const { acceptance } = shape;
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
      if (coordinationRequired && !children) {
        throw new Error('Native Supervisor Shape requires children.yaml before confirmation');
      }
      const coordinationMode = coordinationRequired
        ? (options.coordinationMode ?? state.coordination_mode)
        : undefined;
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
      const shapeState: NativePortableState = {
        ...state,
        spec_changes: specChanges,
        shape_confirmation_hash: nativePortableShapeConfirmationHash({
          formalHash: shape.formalHash,
          childrenHash: children?.hash ?? null,
          coordinationMode,
        }),
      };
      delete shapeState.children_contract_hash;
      delete shapeState.coordination_mode;
      if (coordinationRequired) shapeState.coordination_mode = coordinationMode;
      const next = prepareNativePortableShapeConfirmationState({
        state: shapeState,
        acceptance: acceptance.map((entry) => ({ ...entry })),
      });
      if (children) {
        next.children_contract_hash = hashNativeParentContract({
          acceptance: next.acceptance,
          children: children.contract,
        });
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
      return written;
    },
  );
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
      if (
        state.phase !== 'shape' ||
        state.status !== 'await-user' ||
        state.loop.stage !== 'await-user' ||
        state.loop.next_action !== 'confirm-shape'
      ) {
        throw new Error(
          'Native Shape can only be confirmed from the persisted user confirmation boundary',
        );
      }
      if (options.coordinationMode !== undefined) {
        throw new Error('--coordination-mode must be selected before final Shape confirmation');
      }
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      const specChanges = await discoverNativePortableSpecChanges({ paths: options.paths, state });
      const shape = await readNativePortableAcceptance({
        paths: options.paths,
        state,
        specChanges,
      });
      const { acceptance } = shape;
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
      const coordinationMode = state.coordination_mode;
      if (coordinationRequired && !children) {
        throw new Error('Native Supervisor Shape requires children.yaml before confirmation');
      }
      if (coordinationRequired && coordinationMode === undefined) {
        throw new Error(
          'Native Supervisor Shape requires --coordination-mode multi-session or single-session',
        );
      }
      const latestShapeConfirmationHash = nativePortableShapeConfirmationHash({
        formalHash: shape.formalHash,
        childrenHash: children?.hash ?? null,
        coordinationMode,
      });
      if (
        state.shape_confirmation_hash === undefined ||
        latestShapeConfirmationHash !== state.shape_confirmation_hash
      ) {
        const reason =
          state.shape_confirmation_hash === undefined
            ? 'Native Shape confirmation fingerprint is missing'
            : 'Native Shape artifacts changed';
        await returnNativePortableStateToShapeLocked({
          paths: options.paths,
          state,
          reason,
        });
        throw new Error(`${reason}; Native change returned to Shape and requires confirmation`);
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
          const statusByChild = new Map(
            (inspection?.children ?? []).map(({ name, status }) => [name, status]),
          );
          const repairCoverage = new Set(
            children.contract.children
              .filter(({ name }) => {
                const status = statusByChild.get(name);
                return status !== 'done' && status !== 'integrated' && status !== 'archived';
              })
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
        supervisorTargetBranch = state.workspace.change_branch ?? state.workspace.target_branch;
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
        actual.delta_source === expected.delta_source &&
        actual.base_hash === expected.base_hash &&
        (actual.operation === expected.operation ||
          ignoredOperations?.has(actual.capability) === true)
      );
    });
  if (!declarationsMatch) {
    return { drifted: true, reason: 'Native target specification declarations changed' };
  }
  let shape;
  try {
    shape = await readNativePortableAcceptance({ ...options, specChanges });
  } catch {
    return { drifted: true, reason: 'Native Shape artifacts changed or became invalid' };
  }
  const { acceptance } = shape;
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
  if (
    options.state.phase === 'shape' &&
    options.state.status === 'await-user' &&
    options.state.loop.next_action === 'confirm-shape' &&
    options.state.shape_confirmation_hash === undefined
  ) {
    return { drifted: true, reason: 'Native Shape confirmation fingerprint is missing' };
  }
  if (
    options.state.shape_confirmation_hash !== undefined &&
    nativePortableShapeConfirmationHash({
      formalHash: shape.formalHash,
      childrenHash: children?.hash ?? null,
      coordinationMode: options.state.coordination_mode,
    }) !== options.state.shape_confirmation_hash
  ) {
    return { drifted: true, reason: 'Native Shape artifacts changed' };
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
 * Recompute whether every Child is integrated and the parent is ready for a
 * Builder handoff. This inspection does not advance the phase.
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
      ? '全部 Child 已完成；Supervisor 父级候选可以提交并进入验证'
      : 'All Children are complete; the Supervisor parent candidate can be submitted for verification.';
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
  return resetNativeCheckForExecution(previous, plan, operationId, projectRoot);
}

function resetNativeCheckForExecution(
  previous: NativeLocalCheckState,
  plan: NativeCheckPlan,
  operationId: string,
  projectRoot: string,
): NativeLocalCheckState {
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
    name: check.name,
    executable,
    argv,
    cwdRef: localCheckCwdRef(projectRoot, check.cwd),
    timeoutMs: check.timeoutMs,
    repeatable: check.repeatable,
  });
}

function digestNativeCheckInput(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const NATIVE_IGNORED_INPUT_MAX_FILES = 20_000;
const NATIVE_IGNORED_INPUT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const NATIVE_GENERATED_INPUT_DIRECTORIES = [
  'build',
  'dist',
  'gen',
  'generated',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
] as const;

interface NativeIgnoredInputFile {
  path: string;
  digest: string;
  size: number;
}

interface NativeIgnoredInputSnapshot {
  complete: boolean;
  files: NativeIgnoredInputFile[];
}

const NATIVE_PHYSICAL_INPUT_EXCLUDED_DIRECTORIES = new Set([
  '.agents',
  '.cache',
  '.claude',
  '.codex',
  '.comet',
  '.git',
  '.idea',
  '.next',
  '.nuxt',
  '.output',
  '.parcel-cache',
  '.svelte-kit',
  '.tmp',
  '.turbo',
  '.vscode',
  '.worktrees',
  'coverage',
  'logs',
  'node_modules',
  'temp',
  'tmp',
]);

function incompleteNativeIgnoredInputSnapshot(): NativeIgnoredInputSnapshot {
  return { complete: false, files: [] };
}

function nativeGeneratedInputPathspecs(cwdRef: string): string[] {
  const prefix = cwdRef === '.' ? '' : `${cwdRef}/`;
  return NATIVE_GENERATED_INPUT_DIRECTORIES.flatMap((directory) => [
    `:(glob)${prefix}${directory}/**`,
    `:(glob)${prefix}**/${directory}/**`,
  ]);
}

function sensitiveNativeIgnoredInputPath(relative: string): boolean {
  return /(?:^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:key|pem|p12|pfx))$/iu.test(relative);
}

async function nativeIgnoredCheckInputSnapshot(
  projectRoot: string,
  plans: readonly NativeCheckPlan[],
): Promise<NativeIgnoredInputSnapshot> {
  const cwdRefs = [...new Set(plans.map(({ cwdRef }) => cwdRef))];
  if (cwdRefs.length === 0) return { complete: true, files: [] };

  let ignoredPaths: string[];
  try {
    ignoredPaths = [
      ...new Set(
        runGitCommand(projectRoot, [
          'ls-files',
          '--others',
          '--ignored',
          '--exclude-standard',
          '-z',
          '--',
          ...cwdRefs.flatMap(nativeGeneratedInputPathspecs),
        ])
          .split('\0')
          .filter(Boolean)
          .map((relative) => relative.replaceAll('\\', '/')),
      ),
    ].sort();
  } catch {
    return incompleteNativeIgnoredInputSnapshot();
  }
  if (ignoredPaths.length > NATIVE_IGNORED_INPUT_MAX_FILES) {
    return incompleteNativeIgnoredInputSnapshot();
  }

  const files: NativeIgnoredInputFile[] = [];
  let totalBytes = 0;
  for (const relative of ignoredPaths) {
    const target = path.resolve(projectRoot, ...relative.split('/'));
    if (!isInsidePath(projectRoot, target) || sensitiveNativeIgnoredInputPath(relative)) {
      return incompleteNativeIgnoredInputSnapshot();
    }
    try {
      const before = await fs.lstat(target);
      if (!before.isFile() || totalBytes + before.size > NATIVE_IGNORED_INPUT_MAX_TOTAL_BYTES) {
        return incompleteNativeIgnoredInputSnapshot();
      }
      const content = await fs.readFile(target);
      const after = await fs.lstat(target);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
        return incompleteNativeIgnoredInputSnapshot();
      }
      totalBytes += before.size;
      files.push({
        path: relative,
        digest: digestNativeCheckInput(content.toString('base64')),
        size: before.size,
      });
    } catch {
      return incompleteNativeIgnoredInputSnapshot();
    }
  }
  return { complete: true, files };
}

async function nativePhysicalCheckInputSnapshot(
  projectRoot: string,
  plans: readonly NativeCheckPlan[],
): Promise<NativeIgnoredInputSnapshot> {
  const cwdRefs = [...new Set(plans.map(({ cwdRef }) => cwdRef))];
  const files = new Map<string, NativeIgnoredInputFile>();
  let totalBytes = 0;
  const isGeneratedDirectory = (name: string): boolean =>
    NATIVE_GENERATED_INPUT_DIRECTORIES.includes(
      name as (typeof NATIVE_GENERATED_INPUT_DIRECTORIES)[number],
    );

  const visit = async (
    directory: string,
    relativeDirectory: string,
    insideGeneratedDirectory: boolean,
  ): Promise<boolean> => {
    let entries: Dirent<string>[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return false;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory() && NATIVE_PHYSICAL_INPUT_EXCLUDED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          !(await visit(
            target,
            relative,
            insideGeneratedDirectory || isGeneratedDirectory(entry.name),
          ))
        ) {
          return false;
        }
        continue;
      }
      if (!insideGeneratedDirectory) continue;
      if (sensitiveNativeIgnoredInputPath(relative)) return false;
      if (!entry.isFile()) return false;
      try {
        const before = await fs.lstat(target);
        if (totalBytes + before.size > NATIVE_IGNORED_INPUT_MAX_TOTAL_BYTES) return false;
        const content = await fs.readFile(target);
        const after = await fs.lstat(target);
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) return false;
        totalBytes += before.size;
        files.set(relative, {
          path: relative,
          digest: digestNativeCheckInput(content.toString('base64')),
          size: before.size,
        });
        if (files.size > NATIVE_IGNORED_INPUT_MAX_FILES) return false;
      } catch {
        return false;
      }
    }
    return true;
  };

  for (const cwdRef of cwdRefs) {
    const directory = resolveNativeCheckCwd(projectRoot, cwdRef);
    const relativeDirectory = cwdRef === '.' ? '' : cwdRef;
    if (
      !(await visit(directory, relativeDirectory, isGeneratedDirectory(path.basename(directory))))
    ) {
      return incompleteNativeIgnoredInputSnapshot();
    }
  }
  return {
    complete: true,
    files: [...files.values()].sort((left, right) => left.path.localeCompare(right.path, 'en')),
  };
}

function nativeLocalCheckEvidenceDigest(
  check: Pick<
    NativeLocalCheckState,
    | 'id'
    | 'name'
    | 'status'
    | 'repeatable'
    | 'timeoutMs'
    | 'argv'
    | 'cwd'
    | 'exitCode'
    | 'startedAt'
    | 'completedAt'
    | 'log'
  >,
  logContent: string,
): string {
  return canonicalHash('comet.native.local-check-evidence.v1', {
    id: check.id,
    name: check.name,
    status: check.status,
    repeatable: check.repeatable,
    timeoutMs: check.timeoutMs,
    argv: check.argv,
    cwd: path.resolve(check.cwd),
    exitCode: check.exitCode,
    startedAt: check.startedAt,
    completedAt: check.completedAt,
    log: check.log,
    logDigest: digestNativeCheckInput(logContent),
  });
}

async function nativeCheckInputFingerprint(options: {
  state: NativePortableState;
  projectRoot: string;
  plans: readonly NativeCheckPlan[];
}): Promise<string> {
  const gitSnapshot = {
    complete: true,
    capture: 'git' as 'git' | 'physical-tree',
    head: null as string | null,
    branch: null as string | null,
    status: null as string | null,
    diff: null as string | null,
    stagedDiff: null as string | null,
    submodules: null as string | null,
    untracked: [] as Array<{ path: string; digest: string | null; size: number | null }>,
    ignored: { complete: true, files: [] as NativeIgnoredInputFile[] },
    physical: { complete: true, files: [] as NativeIgnoredInputFile[] },
    reuseNonce: null as string | null,
  };
  let stableGitView = false;
  try {
    gitSnapshot.head = runGitCommand(options.projectRoot, ['rev-parse', 'HEAD']);
    stableGitView = true;
    gitSnapshot.branch = runGitCommand(options.projectRoot, ['branch', '--show-current']);
    gitSnapshot.status = runGitCommand(options.projectRoot, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--ignore-submodules=none',
    ]);
    gitSnapshot.diff = digestNativeCheckInput(
      runGitCommand(options.projectRoot, ['diff', '--binary', 'HEAD', '--submodule=diff', '--']),
    );
    gitSnapshot.stagedDiff = digestNativeCheckInput(
      runGitCommand(options.projectRoot, [
        'diff',
        '--cached',
        '--binary',
        '--submodule=diff',
        '--',
      ]),
    );
    gitSnapshot.submodules = runGitCommand(options.projectRoot, [
      'submodule',
      'status',
      '--recursive',
    ]);
    const untracked = runGitCommand(options.projectRoot, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
    ])
      .split('\0')
      .filter(Boolean)
      .sort();
    gitSnapshot.untracked = await Promise.all(
      untracked.map(async (relative) => {
        const target = path.resolve(options.projectRoot, ...relative.split('/'));
        try {
          const stat = await fs.stat(target);
          const content = await fs.readFile(target);
          return {
            path: relative,
            digest: digestNativeCheckInput(content.toString('base64')),
            size: stat.size,
          };
        } catch {
          return { path: relative, digest: null, size: null };
        }
      }),
    );
    if (gitSnapshot.untracked.some(({ digest }) => digest === null)) {
      gitSnapshot.complete = false;
      gitSnapshot.reuseNonce = randomUUID();
    }
    gitSnapshot.ignored = await nativeIgnoredCheckInputSnapshot(options.projectRoot, options.plans);
    if (!gitSnapshot.ignored.complete) {
      gitSnapshot.complete = false;
      gitSnapshot.reuseNonce = randomUUID();
    }
  } catch {
    // Non-Git projects still receive a candidate/tool fingerprint. They do
    // not receive a Git view, so use a bounded physical snapshot instead.
    if (stableGitView) {
      gitSnapshot.complete = false;
      gitSnapshot.reuseNonce = randomUUID();
    } else {
      gitSnapshot.capture = 'physical-tree';
      gitSnapshot.physical = await nativePhysicalCheckInputSnapshot(
        options.projectRoot,
        options.plans,
      );
      gitSnapshot.complete = gitSnapshot.physical.complete;
      if (!gitSnapshot.physical.complete) gitSnapshot.reuseNonce = randomUUID();
    }
  }
  return canonicalHash('comet.native.check-input.v1', {
    candidateId: options.state.builder_handoff?.candidate_id ?? null,
    shapeConfirmationHash: options.state.shape_confirmation_hash ?? null,
    acceptance: options.state.acceptance.map(({ id, source, text }) => ({ id, source, text })),
    git: gitSnapshot,
    projectRoot: path.resolve(options.projectRoot),
    machineId: os.hostname(),
    execPath: process.execPath,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    path: process.env.PATH ?? null,
    pathext: process.env.PATHEXT ?? null,
    environment: Object.entries(process.env)
      .map(([key, value]) => [key, value ?? null] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
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
    if (check.status === 'passed' && (check.evidence !== 'runtime' || !check.evidenceDigest)) {
      throw new Error(`Native Runtime check ${check.id} has no Runtime execution evidence`);
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
  state: NativePortableState,
  inputFingerprint: string,
): boolean {
  if (
    local.candidateId !== state.builder_handoff?.candidate_id ||
    local.inputFingerprint !== inputFingerprint ||
    path.resolve(local.workspace.projectRoot) !== path.resolve(projectRoot) ||
    path.resolve(local.workspace.worktreeRoot) !== path.resolve(projectRoot) ||
    local.workspace.branch !== currentBranch(projectRoot) ||
    local.workspace.machineId !== os.hostname()
  )
    return false;
  if (local.checks.length !== plans.length) return false;
  return local.checks.every(
    (check, index) => localCheckPlanKey(check, projectRoot) === nativeCheckPlanKey(plans[index]),
  );
}

function sameNativeCheckCommands(
  local: NativeLocalExecutionState,
  plans: readonly NativeCheckPlan[],
  projectRoot: string,
): boolean {
  return (
    local.checks.length === plans.length &&
    local.checks.every(
      (check, index) => localCheckPlanKey(check, projectRoot) === nativeCheckPlanKey(plans[index]),
    )
  );
}

async function hasNativeRuntimeCheckEvidence(
  local: NativeLocalExecutionState,
  runtimeDir: string,
): Promise<boolean> {
  for (const check of local.checks) {
    if (check.status !== 'passed') continue;
    if (check.evidence !== 'runtime') return false;
    try {
      const logFile = await resolveContainedNativePath(
        runtimeDir,
        path.resolve(runtimeDir, ...check.log.split(/[\\/]/u)),
      );
      if (!(await fs.stat(logFile)).isFile()) return false;
      const logContent = await fs.readFile(logFile, 'utf8');
      if (
        !check.evidenceDigest ||
        check.evidenceDigest !== nativeLocalCheckEvidenceDigest(check, logContent)
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function reserveNativePortableCheckPlan(options: {
  paths: NativeProjectPaths;
  name: string;
  plans: NativeCheckPlan[];
  projectRoot: string;
  retryCheckIds?: readonly string[];
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
      let local = (
        await readOrRebuildNativeLocalExecution({
          file,
          portableState: state,
          projectRoot: options.projectRoot,
          branch: currentBranch(options.projectRoot),
          containedRoot: options.paths.runtimeDir,
        })
      ).state;
      const inputFingerprint = await nativeCheckInputFingerprint({
        state,
        projectRoot: options.projectRoot,
        plans: options.plans,
      });
      const runtimeDir = nativePreferredChangeRuntimeDir(options.paths, state.name);
      const runtimeEvidenceAvailable = await hasNativeRuntimeCheckEvidence(local, runtimeDir);
      const allChecksPassed = local.checks.every((check) => check.status === 'passed');
      const retryIds = options.retryCheckIds === undefined ? null : new Set(options.retryCheckIds);
      const branch = currentBranch(options.projectRoot);
      const sameBinding =
        local.candidateId === state.builder_handoff?.candidate_id &&
        path.resolve(local.workspace.projectRoot) === path.resolve(options.projectRoot) &&
        path.resolve(local.workspace.worktreeRoot) === path.resolve(options.projectRoot) &&
        local.workspace.branch === branch &&
        local.workspace.machineId === os.hostname() &&
        local.inputFingerprint === inputFingerprint;
      const forceReexecuteForMissingEvidence =
        sameBinding && allChecksPassed && !runtimeEvidenceAvailable;
      if (retryIds && retryIds.size === 0) {
        throw new Error('Native check retry list must contain at least one ID');
      }
      if (!sameBinding) {
        // A local overlay from another candidate, workspace or host is not
        // evidence for the current candidate. Rebuild the local overlay before
        // reserving a new plan; the portable state remains untouched.
        const rebuilt = rebuildNativeLocalExecution({
          portableState: state,
          projectRoot: options.projectRoot,
          branch,
        });
        await writeNativeLocalExecution(file, rebuilt, { containedRoot: options.paths.runtimeDir });
        local = rebuilt;
      }
      const planMatches = sameNativeCheckCommands(local, options.plans, options.projectRoot);
      if (
        local.execution?.stage === 'checking' &&
        local.execution.actor === 'runtime' &&
        planMatches &&
        sameNativeCheckPlan(local, options.plans, options.projectRoot, state, inputFingerprint)
      ) {
        const execution = local.execution;
        if (execution.status === 'running') {
          throw new Error('Native check plan is already in progress');
        }
        const interrupted = local.checks.filter((check) => check.status === 'interrupted');
        if (
          interrupted.length === 0 &&
          execution.status === 'completed' &&
          allChecksPassed &&
          !forceReexecuteForMissingEvidence
        ) {
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
        if (
          interrupted.length === 0 &&
          execution.status === 'completed' &&
          !allChecksPassed &&
          !forceReexecuteForMissingEvidence
        ) {
          throw new Error(
            `Native check plan contains a failed check (${local.checks
              .filter(({ status }) => status === 'failed')
              .map(({ id }) => id)
              .join(', ')}); submit a new Builder candidate`,
          );
        }
        if (interrupted.length > 0 && retryIds === null && !forceReexecuteForMissingEvidence) {
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
        if (retryIds) {
          const unknown = [...retryIds].filter(
            (id) => !interrupted.some((check) => check.id === id),
          );
          if (unknown.length > 0) {
            throw new Error(
              `Native check retry IDs must refer to interrupted checks: ${unknown.join(', ')}`,
            );
          }
          const exhausted = interrupted.filter(
            (check) => retryIds.has(check.id) && check.executionCount >= 3,
          );
          if (exhausted.length > 0) {
            throw new Error(
              `Native check retry limit (3) reached: ${exhausted.map(({ id }) => id).join(', ')}`,
            );
          }
        }
        if (
          interrupted.length > 0 &&
          interrupted.some((check) => !check.repeatable) &&
          !forceReexecuteForMissingEvidence
        ) {
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
          planMatches;
        if (!sameInterruptedPlan && !forceReexecuteForMissingEvidence) {
          throw new Error('Native check plan was already resolved with a different plan');
        }
      } else if (
        (local.execution !== null || local.checks.length > 0) &&
        !forceReexecuteForMissingEvidence
      ) {
        throw new Error('Native check plan was already resolved with a different plan');
      }
      const operationId = randomUUID();
      const operation: NativeLocalExecutionState = {
        ...local,
        candidateId: state.builder_handoff?.candidate_id ?? null,
        inputFingerprint,
        workspace: {
          ...local.workspace,
          projectRoot: path.resolve(options.projectRoot),
          worktreeRoot: path.resolve(options.projectRoot),
          branch: currentBranch(options.projectRoot),
          machineId: os.hostname(),
        },
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
          if (forceReexecuteForMissingEvidence && previous) {
            return resetNativeCheckForExecution(previous, plan, operationId, options.projectRoot);
          }
          if (
            previous?.status === 'interrupted' &&
            (retryIds === null || retryIds.has(previous.id))
          ) {
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
          return (
            forceReexecuteForMissingEvidence ||
            previous === undefined ||
            (previous.status === 'interrupted' && (retryIds === null || retryIds.has(previous.id)))
          );
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
  retryCheckIds?: readonly string[];
}): Promise<{ state: NativePortableState; checks: NativePortableCheckSummary[] }> {
  const projectRoot = options.projectRoot ?? options.paths.projectRoot;
  preflightNativeCheckPlans(projectRoot, options.plans);
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
      const logContent = await fs.readFile(
        path.resolve(runtimeDir, ...result.logRef.split('/')),
        'utf8',
      );
      await updateReservedNativeCheckPlan({
        paths: options.paths,
        state: reservation.state,
        operationId,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) => {
            if (check.id !== plan.id) return check;
            const completed = {
              ...check,
              status: result.status,
              exitCode: result.exitCode,
              startedAt: result.startedAt,
              completedAt: result.completedAt,
              log: result.logRef,
              evidence: 'runtime' as const,
            };
            return {
              ...completed,
              evidenceDigest: nativeLocalCheckEvidenceDigest(completed, logContent),
            };
          }),
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

/**
 * Retry only repeatable interrupted checks for the current Builder candidate.
 * The local overlay is read to reconstruct the exact original command, so an
 * Agent cannot silently replace a failed command while claiming a retry.
 */
export async function retryNativePortableCheckPlan(options: {
  paths: NativeProjectPaths;
  name: string;
  checkIds: readonly string[];
  projectRoot?: string;
}): Promise<{ state: NativePortableState; checks: NativePortableCheckSummary[] }> {
  if (options.checkIds.length === 0) {
    throw new Error('Native check retry list must contain at least one ID');
  }
  const projectRoot = options.projectRoot ?? options.paths.projectRoot;
  const state = await readNativePortableChange(options.paths, options.name);
  if (
    state.phase !== 'verify' ||
    state.status !== 'active' ||
    state.loop.stage !== 'verify-ready' ||
    state.builder_handoff === null
  ) {
    throw new Error('Native check retry requires an active Verify-ready candidate');
  }
  const local = await readNativeLocalExecution(
    nativeLocalExecutionFile(options.paths, options.name),
  );
  if (
    local === null ||
    local.change !== state.name ||
    local.basedOnStateVersion !== state.state_version ||
    local.execution === null ||
    local.execution.stage !== 'checking' ||
    local.execution.actor !== 'runtime'
  ) {
    throw new Error('Native check retry has no current Runtime check execution');
  }
  const requested = new Set(options.checkIds);
  if (requested.size !== options.checkIds.length) {
    throw new Error('Native check retry list contains duplicate IDs');
  }
  const checks = local.checks.filter((check) => requested.has(check.id));
  const missing = options.checkIds.filter((id) => !checks.some((check) => check.id === id));
  if (missing.length > 0) {
    throw new Error(`Native check retry IDs are unknown: ${missing.join(', ')}`);
  }
  for (const check of checks) {
    if (check.status !== 'interrupted') {
      throw new Error(`Native check ${check.id} is not interrupted and cannot be retried`);
    }
    if (!check.repeatable) {
      throw new Error(`Native check ${check.id} is not repeatable and cannot be retried`);
    }
    if (check.executionCount >= 3) {
      throw new Error(`Native check retry limit (3) reached: ${check.id}`);
    }
  }
  const plans = local.checks.map((check) => {
    const [executable, ...argv] = check.argv;
    if (!executable) throw new Error(`Native local check ${check.id} has no executable`);
    return {
      id: check.id,
      name: check.name,
      executable,
      argv,
      cwdRef: localCheckCwdRef(projectRoot, check.cwd),
      timeoutMs: check.timeoutMs,
      repeatable: check.repeatable,
    } satisfies NativeCheckPlan;
  });
  return executeNativePortableCheckPlan({
    paths: options.paths,
    name: options.name,
    plans,
    projectRoot,
    retryCheckIds: options.checkIds,
  });
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
    if (existing?.status === 'interrupted' && existing.executionCount >= 3) {
      throw new Error(`Native check retry limit (3) reached: ${existing.id}`);
    }
    if (!requestedByKey.has(key)) requestedByKey.set(key, plan);
  }

  preflightNativeCheckPlans(options.projectRoot, [...requestedByKey.values()]);

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
      const runtimeDir = nativePreferredChangeRuntimeDir(
        options.paths,
        options.reservation.state.name,
      );
      const result = await executeNativeCheck({
        projectRoot: options.projectRoot,
        runtimeDir,
        operationId: options.reservation.local.execution!.operationId,
        plan,
      });
      const logContent = await fs.readFile(
        await resolveContainedNativePath(
          runtimeDir,
          path.resolve(runtimeDir, ...result.logRef.split(/[\\/]/u)),
        ),
        'utf8',
      );
      operation = await updateReservedVerifierRequestedChecks({
        paths: options.paths,
        reservation: options.reservation,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) => {
            if (check.id !== plan.id) return check;
            const completed = {
              ...check,
              status: result.status,
              exitCode: result.exitCode,
              startedAt: result.startedAt,
              completedAt: result.completedAt,
              log: result.logRef,
              evidence: 'runtime' as const,
            };
            return {
              ...completed,
              evidenceDigest: nativeLocalCheckEvidenceDigest(completed, logContent),
            };
          }),
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
      const supervisor = await readNativeSupervisorState(options.paths, options.name);
      if (supervisor?.finalVerification.status === 'pending') {
        const advanced = advanceNativeSupervisorFinalVerificationHead(supervisor);
        if (advanced.stateVersion !== supervisor.stateVersion) {
          return returnNativePortableStateToFinalVerificationLocked({
            paths: options.paths,
            state,
            reason:
              'Supervisor final verification was not bound to the current integration commit; rerun the final full verification.',
          });
        }
        await writeNativeSupervisorState(
          options.paths,
          recordNativeSupervisorPortableFinalVerification(supervisor, state),
        );
      }
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

export interface NativeSupervisorFinalVerificationResumeResult {
  state: NativePortableState;
  action: 'none' | 'rerun-final-verification' | 'recorded-final-verification';
}

export async function recoverNativeSupervisorFinalVerificationLocked(options: {
  paths: NativeProjectPaths;
  name: string;
}): Promise<NativeSupervisorFinalVerificationResumeResult> {
  const state = await readNativePortableChange(options.paths, options.name);
  const transaction = await readNativePortableTransaction(options.paths, {
    kind: 'archive',
    change: options.name,
  });
  const archiveTransaction = transaction?.kind === 'archive' ? transaction : null;
  if (
    !archiveTransaction &&
    (state.archived || state.verification === null || state.verification_result !== 'pass')
  ) {
    // There is no final result to replay. In particular, Build must still reach
    // requirements recovery when a legacy Supervisor contract is unavailable.
    return { state, action: 'none' };
  }
  const supervisor = await readNativeSupervisorState(options.paths, options.name);
  if (archiveTransaction && supervisor?.finalVerification.status === 'pending') {
    if (
      archiveTransaction.journal.status !== 'prepared' ||
      archiveTransaction.journal.next_spec_index !== 0
    ) {
      throw new Error(
        'Native Supervisor final verification changed after Archive applied side effects; doctor intervention is required',
      );
    }
    if (
      state.phase === 'verify' &&
      state.status === 'active' &&
      state.verification === null &&
      state.verification_result === 'pending' &&
      state.loop.stage === 'verify-ready'
    ) {
      await fs.rm(archiveTransaction.file, { force: true });
      return { state, action: 'rerun-final-verification' };
    }
  }
  if (
    state.archived ||
    state.verification === null ||
    state.verification_result !== 'pass' ||
    supervisor?.finalVerification.status !== 'pending'
  ) {
    return { state, action: 'none' };
  }

  const advanced = advanceNativeSupervisorFinalVerificationHead(supervisor);
  if (archiveTransaction || advanced.stateVersion !== supervisor.stateVersion) {
    const recovered = await returnNativePortableStateToFinalVerificationLocked({
      paths: options.paths,
      state,
      reason:
        'Supervisor final verification was not bound to the current integration commit; the final full verification will resume automatically.',
    });
    if (archiveTransaction) {
      await fs.rm(archiveTransaction.file, { force: true });
    }
    return { state: recovered, action: 'rerun-final-verification' };
  }

  await writeNativeSupervisorState(
    options.paths,
    recordNativeSupervisorPortableFinalVerification(supervisor, state),
  );
  return { state, action: 'recorded-final-verification' };
}

/**
 * Repair an interrupted Supervisor final-verification write as part of normal
 * Native continuation. No recovery flag or direct state edit is required.
 */
export async function recoverNativeSupervisorFinalVerificationOnResume(options: {
  paths: NativeProjectPaths;
  name: string;
}): Promise<NativeSupervisorFinalVerificationResumeResult> {
  return withNativeMutationLock(
    options.paths,
    `recover Supervisor final verification ${options.name}`,
    () => recoverNativeSupervisorFinalVerificationLocked(options),
    { allowedPortableTransaction: { kind: 'archive', change: options.name } },
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

/** Only link destinations may change; prose, examples and acceptance remain confirmed. */
export async function syncNativePortableSpecReferences(options: {
  paths: NativeProjectPaths;
  name: string;
  capability: string;
  reason: string;
  actor: string;
  expectedStateVersion: number;
  affectedAcceptanceIds: string[];
  replacements: Array<{ from: string; to: string }>;
}): Promise<NativePortableState> {
  return withNativeMutationLock(options.paths, `sync spec references ${options.name}`, async () => {
    const state = await readNativePortableChange(options.paths, options.name);
    if (state.state_version !== options.expectedStateVersion)
      throw new Error('Native spec sync state version is stale');
    if (
      state.archived ||
      !['build', 'verify', 'archive'].includes(state.phase) ||
      state.children_contract_hash
    )
      throw new Error(
        'Native spec sync requires a confirmed ordinary active change; revise requirements in Shape otherwise',
      );
    if (!NAME_PATTERN.test(options.capability) || !options.reason.trim() || !options.actor.trim())
      throw new Error('Native spec sync requires capability, actor and reason');
    await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
    const spec = state.spec_changes.find(
      ({ capability, operation }) => capability === options.capability && operation !== 'remove',
    );
    if (!spec?.source)
      throw new Error(
        'Stage this capability in the current change and confirm Shape before syncing references',
      );
    const affected = new Set(options.affectedAcceptanceIds);
    if (
      affected.size === 0 ||
      [...affected].some((id) => !state.acceptance.some((entry) => entry.id === id)) ||
      state.acceptance.some(({ source, id }) => source === spec.source && !affected.has(id))
    )
      throw new Error('Native spec sync must cover the affected spec acceptance IDs');
    if (
      options.replacements.length === 0 ||
      options.replacements.some(
        ({ from, to }) =>
          !/^[A-Za-z0-9_./#%-]+$/u.test(from) || !/^[A-Za-z0-9_./#%-]+$/u.test(to) || from === to,
      ) ||
      new Set(options.replacements.map(({ from }) => from)).size !== options.replacements.length
    )
      throw new Error('Native spec sync only accepts unique local Markdown reference replacements');
    const changeDir = nativePortableChangeDir(options.paths, state.name);
    const original = await readNativeBoundedTextFile({
      root: changeDir,
      ref: spec.source,
      maxBytes: null,
      includeHash: false,
    });
    const replacements = new Map(options.replacements.map(({ from, to }) => [from, to]));
    const used = new Set<string>();
    let fence: { marker: string; length: number } | null = null;
    let comment = false;
    const updated = original.text
      .split(/(?<=\n)/u)
      .map((line) => {
        const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line.trimEnd());
        if (delimiter) {
          if (!fence) fence = { marker: delimiter[1][0], length: delimiter[1].length };
          else if (
            delimiter[1][0] === fence.marker &&
            delimiter[1].length >= fence.length &&
            !delimiter[2].trim()
          )
            fence = null;
          return line;
        }
        // Container Markdown can contain its own code fences. Conservatively
        // leave quotes, lists and indented content to the Shape revision path.
        if (/^(?:\s|>|[-+*]\s|\d+[.)]\s)/u.test(line)) return line;
        if (line.includes('<!--')) comment = true;
        if (comment) {
          if (line.includes('-->')) comment = false;
          return line;
        }
        if (fence || /^(?: {4}|\t)/u.test(line) || line.includes('`')) return line;
        return line.replace(
          /(?<!!)\[([^\]\n]+)\]\(([^()\s]+)\)/gu,
          (link, label: string, target: string) => {
            const replacement = replacements.get(target);
            if (!replacement) return link;
            used.add(target);
            return `[${label}](${replacement})`;
          },
        );
      })
      .join('');
    if (used.size !== replacements.size)
      throw new Error(
        'Native spec sync replacement is not an existing prose Markdown reference; use revise-requirements for semantic changes',
      );
    const file = path.join(changeDir, spec.source);
    await atomicWriteText(file, updated, { containedRoot: options.paths.nativeRoot });
    let committed = false;
    let createdAuditHash: string | null = null;
    try {
      const shape = await readNativePortableAcceptance({
        paths: options.paths,
        state,
        specChanges: state.spec_changes,
      });
      if (!sameNativePortableAcceptance(state.acceptance, shape.acceptance))
        throw new Error('Reference change affects acceptance; revise requirements in Shape');
      const digest = (text: string) => createHash('sha256').update(text).digest('hex');
      const audit = JSON.stringify({
        schema: 'comet.native.spec-sync.v1',
        change: state.name,
        actor: options.actor,
        reason: options.reason,
        source: spec.source,
        beforeHash: digest(original.text),
        afterHash: digest(updated),
        replacements: options.replacements,
        affectedAcceptanceIds: [...affected],
        requiresConfirmation: false,
        at: new Date().toISOString(),
      });
      const auditHash = digest(audit);
      const auditRef = await writeNativeVerificationReportSnapshot({
        paths: options.paths,
        name: state.name,
        hash: auditHash,
        text: audit,
        onCreated: () => {
          createdAuditHash = auditHash;
        },
      });
      const scoped = {
        ...state,
        loop: {
          ...state.loop,
          previous_unresolved_ids: [
            ...new Set([...state.loop.previous_unresolved_ids, ...affected]),
          ],
        },
      };
      let next =
        state.phase === 'build'
          ? {
              ...scoped,
              state_version: state.state_version + 1,
              acceptance: state.acceptance.map((entry) =>
                affected.has(entry.id)
                  ? { ...entry, result: 'pending' as const, reason: null }
                  : entry,
              ),
            }
          : returnNativeCandidateToBuild({
              state: scoped,
              reason: `Spec reference sync: ${options.reason}`,
            });
      next = appendNativePortableHistory(next, {
        goal_cycle: state.loop.goal_cycle,
        iteration: state.loop.iteration,
        attempt: state.loop.attempt,
        outcome: 'recovery',
        unresolved_ids: [...affected],
        summary: toNativePortableText(
          `Spec reference sync by ${options.actor}: ${options.reason}; ${auditRef}`,
        ),
        completed_at: new Date().toISOString(),
      });
      next.shape_confirmation_hash = nativePortableShapeConfirmationHash({
        formalHash: shape.formalHash,
        childrenHash: null,
        coordinationMode: state.coordination_mode,
      });
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      committed = true;
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
    } catch (error) {
      if (!committed) {
        // State CAS may succeed before report cleanup fails. Never roll formal content
        // back across an already committed state version; recovery can rebuild local data.
        try {
          const current = await readNativePortableChange(options.paths, state.name);
          if (current.state_version === state.state_version) {
            await atomicWriteText(file, original.text, { containedRoot: options.paths.nativeRoot });
            if (createdAuditHash) {
              await removeNativeVerificationReportSnapshot({
                paths: options.paths,
                name: state.name,
                hash: createdAuditHash,
              });
            }
          }
        } catch {
          // An unknown commit outcome must retain evidence. Preserve the triggering
          // failure when rollback itself cannot safely inspect or restore storage.
        }
      }
      throw error;
    }
  });
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
          next_action: 'prepare-shape-confirmation',
        },
      };
      delete next.shape_confirmation_hash;
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
      next_action: 'prepare-shape-confirmation',
    },
  };
  delete next.shape_confirmation_hash;
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

export async function returnNativePortableStateToFinalVerificationLocked(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  reason: string;
}): Promise<NativePortableState> {
  const { state } = options;
  if (state.archived) throw new Error(`Native change ${state.name} is already archived`);
  if (state.verification === null || state.verification_result !== 'pass') {
    throw new Error('Native Supervisor recovery requires a persisted final verification pass');
  }
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
    phase: 'verify',
    status: 'active',
    state_version: state.state_version + 1,
    acceptance: state.acceptance.map((entry) => ({ ...entry, result: 'pending', reason: null })),
    blockers: [],
    verification: null,
    verification_result: 'pending',
    verification_report: null,
    loop: {
      ...state.loop,
      stage: 'verify-ready',
      execution_failure_count: 0,
      previous_unresolved_ids: [],
      no_progress_count: 0,
      next_action: 'run-final-full-verification',
    },
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
