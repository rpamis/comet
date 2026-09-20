import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteText } from './native-atomic-file.js';
import {
  nativeBriefHasBlockingQuestion,
  validateNativeBrief,
  validateNativeSpecDocumentText,
} from './native-artifacts.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { canonicalHash } from './native-canonical-hash.js';
import {
  hashNativeParentContract,
  nativeChildrenAcceptanceValidation,
  readNativeChildrenContract,
  readNativeSupervisorShapeIntent,
} from './native-children.js';
import {
  listActiveNativeChangesOwnedByWorkspace,
  NativeWorkspaceIsolationRequiredError,
} from './native-change.js';
import {
  prepareNativePortableShapeConfirmation as prepareNativePortableShapeConfirmationState,
  returnNativeCandidateToBuild,
} from './native-loop-runtime.js';
import {
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
  createNativePortableState,
  writeNativePortableState,
} from './native-portable-state.js';
import { toNativePortableText } from './native-portable-text.js';
import type {
  NativePortablePhase,
  NativePortableSpecChange,
  NativePortableState,
  NativePortableWorkspace,
  NativeSupervisorCoordinationMode,
} from './native-portable-types.js';
import { writeNativeVerificationReport } from './native-verification-report-v2.js';
import { nativePreferredChangeRuntimeDir, resolveContainedNativePath } from './native-paths.js';
import { nativeBriefTemplate } from './native-artifact-language.js';
import {
  removeNativeVerificationReportSnapshot,
  writeNativeVerificationReportSnapshot,
} from './native-evidence-storage.js';
import type { CometProjectConfig, NativeProjectPaths } from './native-types.js';
import type { NativeArtifactValidation, NativeFinding } from './native-types.js';
import type { NativeWorkspaceBinding } from './native-workspace.js';
import { readProjectConfig, writeProjectConfig } from './native-config.js';
import { parseCapabilityAssociationDraft } from '../project-knowledge/capability-discovery.js';
import {
  NAME_PATTERN,
  assertPortableWorkspaceBindingCurrent,
  currentBranch,
  lateBindPortableCurrentWorkspace,
  nativeLocalExecutionFile,
  nativePortableChangeDir,
  nativePortableStateFile,
  portableWorkspace,
  readNativePortableChange,
  writePortableMutation,
} from './native-portable-storage.js';
import { returnNativePortableStateToFinalVerificationLocked } from './native-portable-transitions.js';
import { assertNoActiveNativeSupervisorTasks } from './native-supervisor-state.js';

export const NATIVE_PORTABLE_BRIEF_TEMPLATE = nativeBriefTemplate('en');

const NATIVE_CAPABILITY_ASSOCIATION_FILE = 'capability-association.yaml';

function normalizedShapeArtifactText(text: string): string {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  while (lines.length > 0 && lines.at(-1)?.trim().length === 0) lines.pop();
  return `${lines.map((line) => line.replace(/[\t ]+$/gu, '')).join('\n')}\n`;
}

function isPlaceholderExemptionReason(source: string): boolean {
  const normalized = source
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (normalized.length === 0) return true;
  if (/^(?:<[^>\r\n]+>|\{\{[^}\r\n]+\}\})[.!：: -]*$/iu.test(normalized)) return true;
  const decorated = normalized
    .replace(/[*_`>#\x5b\x5d()]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (
    /^(?:todo|tbd|fixme)(?:\s*[:：-]|\s*$)/iu.test(decorated) ||
    /^(?:fill(?:\s+this\s+in)?|placeholder)\b/iu.test(decorated) ||
    /^(?:待填写|待补充)/u.test(decorated)
  ) {
    return true;
  }
  return /^(?:(?:todo|tbd|fixme)\b|fill(?:\s+this\s+in)?\b|placeholder\b|documentation[- ]only\b|no\s+product\s+behavior\s+change\b|待填写|待补充|仅文档|不改变产品行为|不涉及产品行为)[.!。；;：:，,、 -]*$/iu.test(
    decorated,
  );
}

function hasExplicitSpecExemption(source: string): boolean {
  const visibleLines: string[] = [];
  let inFence = false;
  for (const line of source.replace(/<!--[\s\S]*?-->/gu, '').split(/\r?\n/u)) {
    if (/^\s*(?:```|~~~)/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && !/^\s*#{1,6}\s+/u.test(line)) visibleLines.push(line);
  }
  return visibleLines.some((line) => {
    const match =
      /(?:no\s+product\s+behavior\s+change|documentation[- ]only|不改变产品行为|不涉及产品行为|仅文档)\s*[:：]\s*(.*)$/iu.exec(
        line,
      );
    return match !== null && !isPlaceholderExemptionReason(match[1] ?? '');
  });
}

export function formatNativeDocumentConstraintFindings(
  findings: readonly NativeFinding[],
  options: { change: string; phase: NativePortablePhase },
): string {
  const details = findings
    .map(({ code, message, path: ref }) => `- ${code}${ref ? ` (${ref})` : ''}: ${message}`)
    .join('\n');
  return [
    `Native ${options.phase} document checks failed for ${options.change}.`,
    details,
    'Recovery: edit the reported formal file in the configured Native change directory, then rerun the latest continuation command. The current state and existing work are preserved; do not edit comet-state.yaml or bypass the Hook.',
  ].join('\n');
}

export async function validateNativePortableDocuments(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  specChanges?: readonly NativePortableSpecChange[];
}): Promise<NativeArtifactValidation> {
  const changeDir = nativePortableChangeDir(options.paths, options.state.name);
  const findings: NativeFinding[] = [
    ...(await validateNativeBrief(changeDir, options.state.brief, { strict: true })).findings,
  ];
  let briefSource = '';
  try {
    briefSource = (
      await readNativeBoundedTextFile({
        root: changeDir,
        ref: options.state.brief,
        maxBytes: null,
        includeHash: false,
      })
    ).text;
  } catch {
    // validateNativeBrief already reports the bounded/missing read failure.
  }
  const specChanges = options.specChanges ?? options.state.spec_changes;
  const targetSpecs = specChanges.filter(({ operation }) => operation !== 'remove');
  const declaredTargetSpecs = options.state.spec_changes.filter(
    ({ operation }) => operation !== 'remove',
  );
  const discoveredCapabilities = new Set(targetSpecs.map(({ capability }) => capability));
  if (options.specChanges !== undefined) {
    for (const declared of declaredTargetSpecs) {
      if (discoveredCapabilities.has(declared.capability)) continue;
      findings.push({
        code: 'spec-document-missing',
        message: `Previously declared target Spec is missing: specs/${declared.capability}/spec.md. Restore the complete file or record the intended capability deletion as a formal remove entry.`,
        path: `specs/${declared.capability}/spec.md`,
      });
    }
  }
  const formalRemovalsOnly =
    specChanges.length > 0 && specChanges.every(({ operation }) => operation === 'remove');
  if (
    targetSpecs.length === 0 &&
    declaredTargetSpecs.length === 0 &&
    !formalRemovalsOnly &&
    !hasExplicitSpecExemption(briefSource)
  ) {
    findings.push({
      code: 'spec-exemption-missing',
      message:
        'This change declares no target Spec. Add a complete target Spec, or record a concrete reason such as “No product behavior change: documentation-only wording.” in brief.md.',
      path: options.state.brief,
    });
  }
  for (const spec of targetSpecs) {
    const expectedSource = `specs/${spec.capability}/spec.md`;
    if (spec.source !== expectedSource) {
      findings.push({
        code: 'spec-source-path-invalid',
        message: `Target Spec must be staged at ${expectedSource}.`,
        path: spec.source ?? expectedSource,
      });
      continue;
    }
    try {
      const source = (
        await readNativeBoundedTextFile({
          root: changeDir,
          ref: expectedSource,
          maxBytes: null,
          includeHash: false,
        })
      ).text;
      findings.push(...validateNativeSpecDocumentText(source, expectedSource).findings);
    } catch (error) {
      findings.push({
        code: 'spec-document-missing',
        message: `Target Spec cannot be read: ${(error as Error).message}. Restore the complete file at ${expectedSource}.`,
        path: expectedSource,
      });
    }
  }
  return { valid: findings.length === 0, findings };
}

export async function assertNativePortableDocuments(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  specChanges?: readonly NativePortableSpecChange[];
}): Promise<void> {
  const validation = await validateNativePortableDocuments(options);
  if (!validation.valid) {
    throw new Error(
      formatNativeDocumentConstraintFindings(validation.findings, {
        change: options.state.name,
        phase: options.state.phase,
      }),
    );
  }
}

export type NativePortableExpectedContinuationAction =
  | 'prepare-shape-confirmation'
  | 'confirm-shape'
  | 'accept-result'
  | 'confirm-verifier-unavailable'
  | 'revise-implementation'
  | 'revise-requirements'
  | 'retry-verifier'
  | 'resolve-verifier-blocker'
  | 'disassociate-capability';

export interface NativePortableExpectedContinuation {
  stateVersion: number;
  action: NativePortableExpectedContinuationAction;
}

export function assertNativePortableExpectedContinuationLocked(options: {
  state: NativePortableState;
  expected?: NativePortableExpectedContinuation;
  action: NativePortableExpectedContinuationAction;
}): void {
  const expected = options.expected;
  if (!expected) return;
  if (options.state.state_version !== expected.stateVersion) {
    throw new Error(
      `Native continuation is stale: the change moved on since the referenced response (current phase ${options.state.phase}, next action ${options.state.loop.next_action}, state version ${options.state.state_version}). ` +
        `Run comet native status ${options.state.name} --json and execute its commandAlternatives with --expected-state-version ${options.state.state_version} --expected-action ${options.state.loop.next_action}.`,
    );
  }
  if (expected.action !== options.action) {
    throw new Error(
      `Native continuation expected ${expected.action} cannot be used for ${options.action}`,
    );
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

export async function discoverNativePortableSpecChanges(options: {
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

export async function readNativePortableAcceptance(options: {
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
      deltaContentHash = canonicalHash(
        'comet.native.shape-artifact-content.v1',
        normalizedShapeArtifactText(delta.text),
      );
    }
    specs.push({ capability: spec.capability, source: source.ref, markdown: acceptanceMarkdown });
    specArtifacts.push({
      ...spec,
      contentHash: canonicalHash(
        'comet.native.shape-artifact-content.v1',
        normalizedShapeArtifactText(source.text),
      ),
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
      normalizedShapeArtifactText(association.text),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    acceptance: buildNativePortableAcceptance({ briefMarkdown: brief.text, specs }),
    formalHash: canonicalHash('comet.native.shape-formal-artifacts.v1', {
      brief: {
        source: brief.ref,
        contentHash: canonicalHash(
          'comet.native.shape-artifact-content.v1',
          normalizedShapeArtifactText(brief.text),
        ),
      },
      specs: specArtifacts,
      association: {
        source: NATIVE_CAPABILITY_ASSOCIATION_FILE,
        contentHash: associationContentHash,
      },
    }),
  };
}

export function nativePortableShapeConfirmationHash(options: {
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
  enforceDocumentConstraints?: boolean;
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
      if (options.enforceDocumentConstraints === true) {
        await assertNativePortableDocuments({ paths: options.paths, state, specChanges });
      }
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
      let bound = state;
      if (children && state.workspace.change_branch === null) {
        await assertNoActiveNativeSupervisorTasks(options.paths, state.name);
        const workspace = lateBindPortableCurrentWorkspace(
          state.workspace,
          options.paths.projectRoot,
        );
        if (workspace === null) {
          throw new Error(
            'Native parent changes require a Git integration branch; initialize Git, commit to a branch, then rerun the latest continuation to bind the workspace',
          );
        }
        bound = appendNativePortableHistory(
          { ...state, workspace },
          {
            goal_cycle: state.loop.goal_cycle,
            iteration: state.loop.iteration,
            attempt: state.loop.attempt,
            outcome: 'recovery',
            unresolved_ids: [],
            summary: toNativePortableText(
              `Native workspace bound to branch ${workspace.change_branch} at the Supervisor Shape confirmation boundary`,
            ),
            completed_at: new Date().toISOString(),
          },
        );
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
        ...bound,
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
      if (options.enforceDocumentConstraints === true) next.document_constraints_version = 1;
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

export async function inspectNativePortableAcceptanceDrift(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  ignoreSpecOperationFor?: ReadonlySet<string>;
}): Promise<{ drifted: boolean; reason: string | null }> {
  if (options.state.document_constraints_version === 1) {
    const documents = await validateNativePortableDocuments(options);
    if (!documents.valid) {
      const first = documents.findings[0];
      return {
        drifted: true,
        reason: first
          ? `Native formal documents are invalid (${first.code}${first.path ? `: ${first.path}` : ''})`
          : 'Native formal documents are invalid',
      };
    }
  }
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

export async function recoverNativePortableShapeConfirmationDrift(options: {
  paths: NativeProjectPaths;
  name: string;
}): Promise<{
  state: NativePortableState;
  repaired: boolean;
  reason: string | null;
}> {
  return withNativeMutationLock(
    options.paths,
    `recover pending Shape confirmation ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      if (
        state.phase !== 'shape' ||
        state.status !== 'await-user' ||
        state.loop.next_action !== 'confirm-shape'
      ) {
        return { state, repaired: false, reason: null };
      }
      const drift = await inspectNativePortableAcceptanceDrift({ paths: options.paths, state });
      if (!drift.drifted) return { state, repaired: false, reason: null };
      const reason = drift.reason ?? 'Native confirmed requirements changed';
      const recovered = await returnNativePortableStateToShapeLocked({
        paths: options.paths,
        state,
        reason,
        keepFailureBudget: true,
      });
      return { state: recovered, repaired: true, reason };
    },
  );
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
    keepFailureBudget: true,
  });
  throw new Error(`${reason}; Native change returned to Shape and requires confirmation`);
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

/** Revoke a capability association through Runtime and invalidate its confirmation. */
export async function disassociateNativePortableCapability(options: {
  paths: NativeProjectPaths;
  name: string;
  expectedContinuation: NativePortableExpectedContinuation;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `disassociate portable capability ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      assertNativePortableExpectedContinuationLocked({
        state,
        expected: options.expectedContinuation,
        action: 'disassociate-capability',
      });
      if (state.archived) throw new Error(`Native change ${state.name} is already archived`);
      const associationPath = path.join(
        nativePortableChangeDir(options.paths, options.name),
        NATIVE_CAPABILITY_ASSOCIATION_FILE,
      );
      let stat;
      try {
        stat = await fs.lstat(associationPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return state;
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('Native capability association must be a regular file');
      }
      await fs.rm(associationPath);
      return returnNativePortableStateToShapeLocked({
        paths: options.paths,
        state,
        reason: 'Capability association revoked through comet native spec disassociate',
      });
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
  keepFailureBudget?: boolean;
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
        ...(options.keepFailureBudget ? { keepFailureBudget: true } : {}),
      });
    },
  );
}

export async function returnNativePortableStateToShapeLocked(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  reason: string;
  keepFailureBudget?: boolean;
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
      // Drift recovery remains inside the same goal and keeps the budget.
      // An explicit requirements revision starts a new goal cycle and clears it.
      failed_iteration_count: options.keepFailureBudget ? state.loop.failed_iteration_count : 0,
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
