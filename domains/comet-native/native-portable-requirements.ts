import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  assertChangeNotSdkOwned,
  COMET_CHANGE_OWNER_SCHEMA,
  registerCompatChangeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import { nativeBriefTemplate } from './native-artifact-language.js';
import {
  NativeDocumentConstraintError,
  validateNativeBrief,
  validateNativeSpecDocumentText,
} from './native-artifacts.js';
import { atomicWriteText } from './native-atomic-file.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import {
  listActiveNativeChangesOwnedByWorkspace,
  NativeWorkspaceIsolationRequiredError,
} from './native-change.js';
import {
  nativeChildrenAcceptanceValidation,
  readNativeChildrenContract,
} from './native-children.js';
import { readProjectConfig, writeProjectConfig } from './native-config.js';
import { NATIVE_DELTA_FILE, parseNativeDelta } from './native-delta-spec.js';
import {
  preservedLocalChecksForVersion,
  readCurrentLocalExecution,
} from './native-local-execution-binding.js';
import {
  rebuildNativeLocalExecution,
  writeNativeLocalExecution,
} from './native-local-execution.js';
import {
  prepareNativePortableShapeConfirmation as prepareNativePortableShapeConfirmationState,
  returnNativeCandidateToBuild,
} from './native-loop-runtime.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { nativePreferredChangeRuntimeDir, resolveContainedNativePath } from './native-paths.js';
import {
  buildNativePortableAcceptance,
  sameNativePortableAcceptance,
} from './native-portable-acceptance.js';
import {
  appendNativePortableHistory,
  createNativePortableState,
  writeNativePortableState,
} from './native-portable-state.js';
import {
  assertPortableWorkspaceBindingCurrent,
  currentBranch,
  lateBindPortableCurrentWorkspace,
  NAME_PATTERN,
  nativeLocalExecutionFile,
  nativePortableChangeDir,
  nativePortableStateFile,
  portableWorkspace,
  readNativePortableChange,
  writePortableMutation,
} from './native-portable-storage.js';
import { toNativePortableText } from './native-portable-text.js';
import type {
  NativePortablePhase,
  NativePortableSpecChange,
  NativePortableState,
  NativePortableWorkspace,
  NativeSupervisorCoordinationMode,
} from './native-portable-types.js';
import { materializeNativeDeltaTargetsLocked } from './native-shape-materialization.js';
import { type NativeShapeSemanticSnapshot } from './native-shape-semantics.js';
import { assertNoActiveNativeSupervisorTasks } from './native-supervisor-state.js';
import type {
  CometProjectConfig,
  NativeArtifactValidation,
  NativeFinding,
  NativeProjectPaths,
} from './native-types.js';
import { writeNativeVerificationReport } from './native-verification-report-v2.js';
import type { NativeWorkspaceBinding } from './native-workspace.js';

export const NATIVE_PORTABLE_BRIEF_TEMPLATE = nativeBriefTemplate('en', { compact: true });

const NATIVE_CAPABILITY_ASSOCIATION_FILE = 'capability-association.yaml';

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
  const constraintsVersion = options.state.document_constraints_version;
  const compactConstraints = constraintsVersion === 2 || constraintsVersion === 3;
  const structureConstraints = constraintsVersion === 3;
  const findings: NativeFinding[] = [
    ...(
      await validateNativeBrief(changeDir, options.state.brief, {
        strict: true,
        compact: compactConstraints,
        structure: structureConstraints,
        maxBytes: null,
      })
    ).findings,
  ];
  const specChanges = options.specChanges ?? options.state.spec_changes;
  const targetSpecs = specChanges.filter(({ operation }) => operation !== 'remove');
  const declaredTargetSpecs = options.state.spec_changes.filter(
    ({ operation }) => operation !== 'remove',
  );
  const discoveredCapabilities = new Set(targetSpecs.map(({ capability }) => capability));
  // Before Shape confirmation the declared set is only the last prepared proposal, so a
  // replacement target Spec, or a formal remove entry for the same capability, may
  // supersede it. An exemption or an unrelated removal still cannot hide a declared Spec
  // that disappeared.
  const inShape = options.state.phase === 'shape';
  const removedCapabilities = new Set(
    specChanges
      .filter(({ operation }) => operation === 'remove')
      .map(({ capability }) => capability),
  );
  if (options.specChanges !== undefined && !(inShape && targetSpecs.length > 0)) {
    for (const declared of declaredTargetSpecs) {
      if (discoveredCapabilities.has(declared.capability)) continue;
      if (inShape && removedCapabilities.has(declared.capability)) continue;
      findings.push({
        code: 'spec-document-missing',
        message: inShape
          ? `Previously declared target Spec is missing: specs/${declared.capability}/spec.md. Restore the complete file, stage the replacement target Spec under specs/<capability>/spec.md, or record the intended capability deletion as a formal remove entry.`
          : `Previously declared target Spec is missing: specs/${declared.capability}/spec.md. Restore the complete file or record the intended capability deletion as a formal remove entry.`,
        path: `specs/${declared.capability}/spec.md`,
      });
    }
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
    throw new NativeDocumentConstraintError(
      formatNativeDocumentConstraintFindings(validation.findings, {
        change: options.state.name,
        phase: options.state.phase,
      }),
      validation.findings,
      options.state.name,
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
  | 'continue-builder'
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
      await assertChangeNotSdkOwned(options.paths.projectRoot, 'native', options.name);
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
          nativeBriefTemplate(options.language, { compact: true }),
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
        await registerCompatChangeOwner(options.paths.projectRoot, {
          schema: COMET_CHANGE_OWNER_SCHEMA,
          workflow: 'native',
          change: options.name,
          format: 'compat',
        });
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
    try {
      const canonicalStat = await fs.lstat(canonical);
      if (!canonicalStat.isFile() || canonicalStat.isSymbolicLink()) {
        throw new Error(`Canonical Native spec is unsafe: ${entry.name}`);
      }
      operation = 'modify';
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
      deltaMetadata = { delta_source: deltaSource };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    changes.push({ capability: entry.name, operation, source, ...deltaMetadata });
  }
  changes.push(...removals.values());
  return changes.sort((left, right) => left.capability.localeCompare(right.capability, 'en'));
}

export async function readNativePortableAcceptance(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  specChanges: readonly NativePortableSpecChange[];
  /** 只在完整批准指纹仍可验证时核对旧验收快照。 */
  legacyBriefBoundaries?: boolean;
  captureSemanticSnapshot?: boolean;
  /** Internal verification of original bytes, never a baseline inferred from changed files. */
  artifactTexts?: ReadonlyMap<string, string>;
  legacyOnly?: boolean;
}): Promise<{
  acceptance: import('./native-portable-acceptance.js').NativePortableAcceptanceCriterion[];
  formalHash?: string;
  semanticSnapshot?: NativeShapeSemanticSnapshot;
  approvedSemanticSnapshot?: NativeShapeSemanticSnapshot;
  approvedLegacyAcceptance?: import('./native-portable-acceptance.js').NativePortableAcceptanceCriterion[];
}> {
  const changeDir = nativePortableChangeDir(options.paths, options.state.name);
  const read = async (ref: string) => {
    const original = options.artifactTexts?.get(ref);
    if (original !== undefined) return original;
    return (
      await readNativeBoundedTextFile({ root: changeDir, ref, maxBytes: null, includeHash: false })
    ).text;
  };
  const briefMarkdown = await read('brief.md');
  const specs = [];
  for (const spec of options.specChanges) {
    if (spec.source === null) continue;
    specs.push({
      capability: spec.capability,
      source: spec.source,
      markdown: await read(spec.source),
    });
  }
  return {
    acceptance: buildNativePortableAcceptance({
      briefMarkdown,
      specs,
      legacyBriefBoundaries: options.legacyBriefBoundaries,
      resolveBriefReferences:
        options.state.document_constraints_version !== undefined &&
        options.state.document_constraints_version !== 1,
    }),
  };
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
      const shapeBoundary =
        options.enforceDocumentConstraints === true
          ? { ...state, document_constraints_version: 3 as const }
          : state;
      const specChanges = await discoverNativePortableSpecChanges({ paths: options.paths, state });
      await materializeNativeDeltaTargetsLocked({ paths: options.paths, state, specChanges });
      if (options.enforceDocumentConstraints === true) {
        await assertNativePortableDocuments({
          paths: options.paths,
          // 已撤回确认绑定的新 Shape 可重选目标；其他校验仍保护原声明。
          state:
            state.shape_confirmation_hash === undefined
              ? { ...shapeBoundary, spec_changes: specChanges }
              : shapeBoundary,
          specChanges,
        });
      }
      const shape = await readNativePortableAcceptance({
        paths: options.paths,
        state: shapeBoundary,
        specChanges,
        captureSemanticSnapshot: true,
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
        children?.contract.schema === 'comet.native.children.v2' &&
        children.contract.children.length >= 2;
      if (coordinationRequired && !children) {
        throw new Error('Native Supervisor Shape requires children.yaml before confirmation');
      }
      const coordinationMode = coordinationRequired
        ? (options.coordinationMode ?? state.coordination_mode)
        : undefined;
      if (!coordinationRequired && options.coordinationMode !== undefined) {
        throw new Error(
          '--coordination-mode is only valid for a multi-child Native Supervisor Shape',
        );
      }
      const shapeState: NativePortableState = {
        ...bound,
        ...(shapeBoundary.document_constraints_version === undefined
          ? {}
          : { document_constraints_version: shapeBoundary.document_constraints_version }),
        spec_changes: specChanges,
      };
      delete shapeState.children_contract_ref;
      delete shapeState.children_contract;
      delete shapeState.coordination_mode;
      if (coordinationRequired) shapeState.coordination_mode = coordinationMode;
      const next = prepareNativePortableShapeConfirmationState({
        state: shapeState,
        acceptance: acceptance.map((entry) => ({ ...entry })),
      });
      if (children) {
        next.children_contract_ref = next.name + ':shape:' + next.state_version;
        next.children_contract = children.contract;
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

export async function recoverNativePortableShapeConfirmationDrift(options: {
  paths: NativeProjectPaths;
  name: string;
}): Promise<{
  state: NativePortableState;
  repaired: boolean;
  reason: string | null;
}> {
  // 旧调用只取得当前记录；文件编辑不再自动撤回提案或改变阶段。
  return {
    state: await readNativePortableChange(options.paths, options.name),
    repaired: false,
    reason: null,
  };
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
      state.children_contract_ref
    )
      throw new Error(
        'Native spec sync requires a confirmed ordinary active change; revise requirements in Shape otherwise',
      );
    if (!NAME_PATTERN.test(options.capability) || !options.reason.trim() || !options.actor.trim())
      throw new Error('Native spec sync requires capability, actor and reason');
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

    try {
      const shape = await readNativePortableAcceptance({
        paths: options.paths,
        state,
        specChanges: state.spec_changes,
      });
      if (!sameNativePortableAcceptance(state.acceptance, shape.acceptance))
        throw new Error('Reference change affects acceptance; revise requirements in Shape');
      const audit = JSON.stringify({
        schema: 'comet.native.spec-sync.v1',
        change: state.name,
        actor: options.actor,
        reason: options.reason,
        source: spec.source,
        replacements: options.replacements,
        affectedAcceptanceIds: [...affected],
        requiresConfirmation: false,
        at: new Date().toISOString(),
      });
      const auditRef = 'spec-sync/' + randomUUID() + '.json';
      await atomicWriteText(path.join(options.paths.runtimeDir, auditRef), audit, {
        containedRoot: options.paths.runtimeDir,
        exclusive: true,
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
      delete next.shape_semantic_snapshot;
      delete next.children_contract_ref;
      delete next.children_contract;
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
  expectedStateVersion?: number;
}): Promise<NativePortableState> {
  return withNativeMutationLock(
    options.paths,
    `set portable workspace finish ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      if (
        options.expectedStateVersion !== undefined &&
        (state.state_version !== options.expectedStateVersion ||
          state.phase !== 'archive' ||
          state.status !== 'active' ||
          state.loop.stage !== 'archive-ready' ||
          state.workspace.finish !== null)
      ) {
        throw new Error(
          'Native workspace finish decision is stale; read the current continuation and confirm the finish again',
        );
      }
      if (state.workspace.isolation === 'current') {
        throw new Error('Native current-workspace isolation does not accept a finish action');
      }
      const local = await readCurrentLocalExecution({ paths: options.paths, state });
      const next: NativePortableState = {
        ...state,
        state_version: state.state_version + 1,
        workspace: { ...state.workspace, finish: options.finish },
      };
      const written = await writePortableMutation({ paths: options.paths, previous: state, next });
      await writeNativeLocalExecution(
        nativeLocalExecutionFile(options.paths, state.name),
        local?.rawInputRef
          ? preservedLocalChecksForVersion({
              local,
              state: written,
              projectRoot: options.paths.projectRoot,
            })
          : rebuildNativeLocalExecution({
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
        throw new Error('--revise-requirements is not valid from the current phase');
      }
      if (state.phase === 'shape' && state.status === 'active') return state;
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
  await assertChangeNotSdkOwned(options.paths.projectRoot, 'native', state.name);
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
  delete next.shape_semantic_snapshot;
  delete next.children_contract_ref;
  delete next.children_contract;
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

/** 每次从原批准全文重新校验，不信任旁证自称的语义 hash。 */
export async function readNativeApprovedShapeSemanticSnapshot(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<{
  snapshot: NativeShapeSemanticSnapshot;
  legacyFormalHash?: string;
  semanticFormalHash?: string;
  legacyAcceptance?: import('./native-portable-acceptance.js').NativePortableAcceptanceCriterion[];
} | null> {
  // 只读取旧记录供展示；不从当前文件补造内容证明或据此使验收失效。
  return options.state.shape_semantic_snapshot
    ? { snapshot: options.state.shape_semantic_snapshot }
    : null;
}
