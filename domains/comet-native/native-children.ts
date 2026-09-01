import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parseDocument } from 'yaml';

import { inspectGitWorktree, listGitWorktreeRoots } from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';

import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { canonicalHash } from './native-canonical-hash.js';
import { readProjectConfig } from './native-config.js';
import { nativeProjectPaths } from './native-paths.js';
import { parseNativePortableState, readNativePortableState } from './native-portable-state.js';
import {
  projectNativeSupervisorChildren,
  readNativeSupervisorState,
  rebuildNativeSupervisorStateFromFacts,
  writeNativeSupervisorState,
} from './native-supervisor.js';
import type {
  NativePortableAcceptanceState,
  NativePortablePhase,
  NativePortableState,
} from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';

export const NATIVE_CHILDREN_FILE = 'children.yaml';
export const NATIVE_CHILDREN_SCHEMA = 'comet.native.children.v1' as const;
export const NATIVE_CHILDREN_V2_SCHEMA = 'comet.native.children.v2' as const;
export const NATIVE_CHILDREN_SCHEMA_V2 = NATIVE_CHILDREN_V2_SCHEMA;

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const ROOT_KEYS_V1 = new Set(['schema', 'children']);
const ROOT_KEYS_V2 = new Set(['schema', 'acceptance_index', 'children']);
const V1_CHILD_KEYS = new Set(['name', 'depends_on', 'covers']);
const V2_CHILD_KEYS = new Set(['name', 'summary', 'depends_on']);
const CHILD_KEYS = new Set(['name', 'depends_on', 'covers']);

type NativeChildrenContractVariant = 'v1' | 'summary-v2' | 'indexed-v2';

export interface NativeChildDefinition {
  name: string;
  summary: string | null;
  depends_on: string[];
  covers: string[];
}

export interface NativeChildAcceptanceIndexEntry {
  source: string;
  text: string;
}

export interface NativeChildrenContract {
  schema: typeof NATIVE_CHILDREN_SCHEMA | typeof NATIVE_CHILDREN_SCHEMA_V2;
  acceptance_index?: Record<string, NativeChildAcceptanceIndexEntry>;
  children: NativeChildDefinition[];
}

export interface NativeChildrenDocument {
  contract: NativeChildrenContract;
  size: number;
  drift: NativeChildrenIndexDrift | null;
}

export type NativeChildDerivedStatus =
  | 'pending'
  | 'ready'
  | 'active'
  | 'verified'
  | 'integrated'
  | 'archived'
  | 'needs-reverify'
  | 'done'
  | 'blocked';

export interface NativeChildStatusProjection {
  name: string;
  summary: string | null;
  dependsOn: string[];
  covers: string[];
  status: NativeChildDerivedStatus;
  phase: NativePortablePhase | null;
  projectRoot: string | null;
  message: string | null;
}

export interface NativeChildrenInspection {
  schema?: NativeChildrenContract['schema'];
  coordinationChoiceRequired?: boolean;
  contractHash: string | null;
  confirmed: boolean;
  parentBranch: string | null;
  children: NativeChildStatusProjection[];
  readyChildren: string[];
  allDone: boolean;
}

interface WorkspaceSource {
  projectRoot: string;
  paths: NativeProjectPaths;
  parent: boolean;
}

export interface NativeV1SupervisorParentCandidate {
  paths: NativeProjectPaths;
  state: NativePortableState;
  inspection: NativeChildrenInspection;
}

interface ChildFact {
  kind: 'active' | 'done' | 'blocked';
  phase: NativePortablePhase | null;
  projectRoot: string | null;
  message: string | null;
}

interface ArchivedChildState {
  file: string;
  state: NativePortableState;
}

interface ArchivedChildEvidence extends ArchivedChildState {
  source: WorkspaceSource;
  committedState: NativePortableState | null;
}

function record(value: unknown, label: string, hint = ''): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object${hint}`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  known: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  const missing = [...known].filter((key) => !(key in value));
  if (unknown.length > 0 || missing.length > 0) {
    const details = [
      ...(missing.length > 0 ? [`missing ${missing.join(', ')}`] : []),
      ...(unknown.length > 0 ? [`unexpected ${unknown.join(', ')}`] : []),
      `expected ${[...known].join(', ')}`,
    ];
    throw new Error(`${label} fields are invalid: ${details.join('; ')}`);
  }
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`${label} must be an array of strings`);
  }
  return [...new Set(value)].sort((left, right) => left.localeCompare(right, 'en'));
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(path.resolve(left));
  const normalizedRight = path.normalize(path.resolve(right));
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function assertAcyclic(children: readonly NativeChildDefinition[]): void {
  const byName = new Map(children.map((child) => [child.name, child]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`Native children dependency cycle includes ${name}`);
    visiting.add(name);
    for (const dependency of byName.get(name)!.depends_on) visit(dependency);
    visiting.delete(name);
    visited.add(name);
  };
  for (const child of children) visit(child.name);
}

function validateCoverage(
  children: readonly NativeChildDefinition[],
  acceptanceIds: readonly string[],
  requiredAcceptanceIds: readonly string[] = acceptanceIds,
): void {
  const known = new Set(acceptanceIds);
  for (const child of children) {
    const unknown = child.covers.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `Native child ${child.name} covers unknown acceptance: ${unknown.join(', ')}`,
      );
    }
  }
  const covered = new Set(children.flatMap((child) => child.covers));
  const missing = requiredAcceptanceIds.filter((id) => !covered.has(id));
  if (missing.length > 0) {
    throw new Error(`Native children do not cover parent acceptance: ${missing.join(', ')}`);
  }
}

export function nativeChildrenIndexDrift(
  contract: NativeChildrenContract,
  acceptanceIds: readonly string[] | undefined,
  options: NativeChildrenValidationOptions,
): NativeChildrenIndexDrift | null {
  const drift: NativeChildrenIndexDrift = {
    missing: [],
    extra: [],
    mismatched: [],
    uncovered: [],
    unknownCovers: [],
  };
  if (contract.schema === NATIVE_CHILDREN_SCHEMA_V2 && contract.acceptance_index) {
    const required = options.requiredAcceptanceIds ?? acceptanceIds ?? [];
    const indexKeys = Object.keys(contract.acceptance_index);
    drift.missing = required.filter((id) => !(id in contract.acceptance_index!));
    drift.extra = indexKeys.filter((id) => !required.includes(id));
    const catalog = new Map((options.acceptanceCatalog ?? []).map((entry) => [entry.id, entry]));
    for (const id of required) {
      const expected = catalog.get(id);
      const actual = contract.acceptance_index[id];
      if (
        expected &&
        actual &&
        (actual.source !== expected.source || actual.text !== expected.text)
      ) {
        drift.mismatched.push(id);
      }
    }
    const known = new Set(indexKeys);
    for (const child of contract.children) {
      drift.unknownCovers.push(...child.covers.filter((id) => !known.has(id)));
    }
    drift.uncovered = indexKeys.filter((id) => !coveredBy(contract.children, id));
    return hasDrift(drift) ? drift : null;
  }
  if (contract.schema === NATIVE_CHILDREN_SCHEMA && acceptanceIds) {
    const known = new Set(acceptanceIds);
    for (const child of contract.children) {
      drift.unknownCovers.push(...child.covers.filter((id) => !known.has(id)));
    }
    drift.uncovered = acceptanceIds.filter((id) => !coveredBy(contract.children, id));
    return hasDrift(drift) ? drift : null;
  }
  return null;
}

function coveredBy(children: readonly NativeChildDefinition[], id: string): boolean {
  return children.some((child) => child.covers.includes(id));
}

function hasDrift(drift: NativeChildrenIndexDrift): boolean {
  return (
    drift.missing.length > 0 ||
    drift.extra.length > 0 ||
    drift.mismatched.length > 0 ||
    drift.uncovered.length > 0 ||
    drift.unknownCovers.length > 0
  );
}

export interface NativeChildrenValidationOptions {
  acceptanceCatalog?: readonly Pick<NativePortableAcceptanceState, 'id' | 'source' | 'text'>[];
  requiredAcceptanceIds?: readonly string[];
  /**
   * Advisory parsing keeps the same structural checks but reports acceptance-index
   * drift through NativeChildrenDocument.drift instead of throwing, so read-only
   * projections can render a stale contract as "confirmation required".
   */
  policy?: 'strict' | 'advisory';
}

export interface NativeChildrenIndexDrift {
  missing: string[];
  extra: string[];
  mismatched: string[];
  uncovered: string[];
  unknownCovers: string[];
}

type NativeChildrenAcceptanceState = Pick<
  NativePortableState,
  'brief' | 'loop' | 'verification_result' | 'history'
> & {
  acceptance: readonly Pick<NativePortableAcceptanceState, 'id' | 'source' | 'text'>[];
};

export function nativeChildrenAcceptanceValidation(
  state: NativeChildrenAcceptanceState,
): NativeChildrenValidationOptions {
  const requiredAcceptanceIds = new Set(
    state.acceptance.filter(({ source }) => source === state.brief).map(({ id }) => id),
  );
  if (state.loop.stage === 'repairing' && state.verification_result === 'fail') {
    const latestFailure = [...state.history].reverse().find(({ outcome }) => outcome === 'fail');
    for (const id of latestFailure?.unresolved_ids ?? []) requiredAcceptanceIds.add(id);
  }
  return {
    acceptanceCatalog: state.acceptance,
    requiredAcceptanceIds: [...requiredAcceptanceIds],
  };
}

function parseAcceptanceIndex(value: unknown): Record<string, NativeChildAcceptanceIndexEntry> {
  const index = record(
    value,
    'Native children acceptance_index',
    ' keyed by acceptance ID, for example A1: { source: brief.md, text: "Full acceptance text" }',
  );
  const result: Record<string, NativeChildAcceptanceIndexEntry> = {};
  for (const [id, entry] of Object.entries(index)) {
    const item = record(entry, `Native children acceptance_index.${id}`);
    exactKeys(item, new Set(['source', 'text']), `Native children acceptance_index.${id}`);
    if (typeof item.source !== 'string' || item.source.length === 0) {
      throw new Error(`Native children acceptance_index.${id}.source must be a non-empty string`);
    }
    if (typeof item.text !== 'string' || item.text.length === 0) {
      throw new Error(`Native children acceptance_index.${id}.text must be a non-empty string`);
    }
    result[id] = { source: item.source, text: item.text };
  }
  return result;
}

function validateAcceptanceIndex(
  index: Record<string, NativeChildAcceptanceIndexEntry>,
  acceptanceIds: readonly string[] | undefined,
  options: NativeChildrenValidationOptions,
): void {
  const required = options.requiredAcceptanceIds ?? acceptanceIds ?? [];
  const actual = Object.keys(index);
  const missing = required.filter((id) => !(id in index));
  const extra = actual.filter((id) => !required.includes(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Native children acceptance_index must match the required acceptance: missing ${missing.join(', ') || 'none'}; extra ${extra.join(', ') || 'none'}`,
    );
  }
  const catalog = new Map((options.acceptanceCatalog ?? []).map((entry) => [entry.id, entry]));
  for (const id of required) {
    const expected = catalog.get(id);
    if (!expected) continue;
    const actualEntry = index[id];
    if (actualEntry.source !== expected.source || actualEntry.text !== expected.text) {
      const mismatched = (['source', 'text'] as const).filter(
        (key) => actualEntry[key] !== expected[key],
      );
      throw new Error(
        `Native children acceptance_index.${id} does not match the acceptance catalog: copy ${mismatched.join(', ')} exactly from the current acceptance catalog`,
      );
    }
  }
}

export function parseNativeChildrenContract(
  source: string,
  acceptanceIds?: readonly string[],
  options: NativeChildrenValidationOptions = {},
): NativeChildrenContract {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Native children contract is invalid YAML: ${document.errors[0].message}`);
  }
  const root = record(document.toJS({ mapAsMap: false }), 'Native children contract');
  const schema = root.schema;
  if (schema !== NATIVE_CHILDREN_SCHEMA && schema !== NATIVE_CHILDREN_V2_SCHEMA) {
    exactKeys(root, ROOT_KEYS_V1, 'Native children contract');
    throw new Error(
      `Native children schema must be ${NATIVE_CHILDREN_SCHEMA} or ${NATIVE_CHILDREN_V2_SCHEMA}`,
    );
  }
  const variant: NativeChildrenContractVariant =
    schema === NATIVE_CHILDREN_SCHEMA
      ? 'v1'
      : 'acceptance_index' in root
        ? 'indexed-v2'
        : 'summary-v2';
  const variantLabel = variant.replace('-', ' ');
  exactKeys(
    root,
    variant === 'indexed-v2' ? ROOT_KEYS_V2 : ROOT_KEYS_V1,
    'Native children contract',
  );
  if (!Array.isArray(root.children) || root.children.length === 0) {
    throw new Error('Native children must be a non-empty array');
  }
  const children = root.children.map((entry, index): NativeChildDefinition => {
    const child = record(entry, `Native child ${index}`);
    exactKeys(
      child,
      variant === 'indexed-v2'
        ? CHILD_KEYS
        : variant === 'summary-v2'
          ? V2_CHILD_KEYS
          : V1_CHILD_KEYS,
      `Native ${variantLabel} child fields (child ${index})`,
    );
    if (typeof child.name !== 'string' || !NAME_PATTERN.test(child.name)) {
      throw new Error(`Native child ${index} name is invalid`);
    }
    const readableV2 = variant === 'summary-v2';
    if (readableV2) {
      if (typeof child.summary !== 'string' || child.summary.trim().length === 0) {
        throw new Error(`Native child ${child.name} summary must be a non-empty string`);
      }
      if (child.summary.length > 2_000) {
        throw new Error(`Native child ${child.name} summary exceeds 2000 characters`);
      }
    }
    return {
      name: child.name,
      summary: readableV2 ? (child.summary as string) : null,
      depends_on: stringList(child.depends_on, `Native child ${child.name} depends_on`),
      covers:
        variant === 'indexed-v2' || variant === 'v1'
          ? stringList(child.covers, `Native child ${child.name} covers`)
          : [],
    };
  });
  const names = children.map(({ name }) => name);
  if (new Set(names).size !== names.length) throw new Error('Native child names must be unique');
  const known = new Set(names);
  for (const child of children) {
    const missing = child.depends_on.filter((dependency) => !known.has(dependency));
    if (missing.length > 0) {
      throw new Error(`Native child ${child.name} depends on unknown child: ${missing.join(', ')}`);
    }
  }
  assertAcyclic(children);
  const advisory = options.policy === 'advisory';
  if (schema === NATIVE_CHILDREN_SCHEMA_V2) {
    if (variant === 'indexed-v2') {
      const acceptanceIndex = parseAcceptanceIndex(root.acceptance_index);
      if (!advisory) validateAcceptanceIndex(acceptanceIndex, acceptanceIds, options);
      const indexedAcceptanceIds = Object.keys(acceptanceIndex);
      if (!advisory) validateCoverage(children, indexedAcceptanceIds, indexedAcceptanceIds);
      return { schema: NATIVE_CHILDREN_V2_SCHEMA, acceptance_index: acceptanceIndex, children };
    }
    return { schema: NATIVE_CHILDREN_V2_SCHEMA, children };
  }
  if (acceptanceIds && !advisory) validateCoverage(children, acceptanceIds);
  return { schema: NATIVE_CHILDREN_SCHEMA, children };
}

export async function readNativeChildrenContract(options: {
  changeDir: string;
  acceptanceIds?: readonly string[];
  validation?: NativeChildrenValidationOptions;
  policy?: 'strict' | 'advisory';
}): Promise<NativeChildrenDocument | null> {
  const file = path.join(options.changeDir, NATIVE_CHILDREN_FILE);
  try {
    await fs.lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const source = await readNativeBoundedTextFile({
    root: options.changeDir,
    ref: NATIVE_CHILDREN_FILE,
  });
  const advisory = options.policy === 'advisory';
  const validation: NativeChildrenValidationOptions = advisory
    ? { ...options.validation, policy: 'advisory' }
    : (options.validation ?? {});
  const contract = parseNativeChildrenContract(source.text, options.acceptanceIds, validation);
  return {
    contract,
    size: source.size,
    drift: advisory
      ? nativeChildrenIndexDrift(contract, options.acceptanceIds, options.validation ?? {})
      : null,
  };
}

function decisionsSection(source: string): string | null {
  const heading = /^#\s+(?:Decisions|决策)\s*$/imu.exec(source);
  if (!heading || heading.index === undefined) return null;
  const section = source.slice(heading.index + heading[0].length);
  return section.split(/^#\s+/mu, 1)[0] ?? section;
}

/**
 * Detect an explicitly recorded Supervisor Shape before children.yaml exists.
 *
 * This intentionally requires the formal Decisions section, an explicit Supervisor Change
 * declaration, and at least two child declarations. It does not infer coordination from brief
 * length, acceptance count, or ordinary task wording.
 */
export function hasNativeSupervisorShapeIntent(source: string): boolean {
  const decisions = decisionsSection(source);
  if (!decisions || !/Supervisor\s+Change/iu.test(decisions)) return false;
  const childDeclarations = decisions.match(/^\s*[-*]\s+(?:Child\b|子任务\b|子 Change\b)/gimu);
  const numberedChildren = decisions.match(/\bChild\s+\d+\b/giu);
  return Math.max(childDeclarations?.length ?? 0, numberedChildren?.length ?? 0) >= 2;
}

export async function readNativeSupervisorShapeIntent(changeDir: string): Promise<boolean> {
  try {
    const brief = await readNativeBoundedTextFile({
      root: changeDir,
      ref: 'brief.md',
      maxBytes: null,
      includeHash: false,
    });
    return hasNativeSupervisorShapeIntent(brief.text);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function hashNativeParentContract(options: {
  acceptance: readonly Pick<NativePortableAcceptanceState, 'id' | 'source' | 'text'>[];
  children: NativeChildrenContract;
}): string {
  return canonicalHash('comet.native.parent-contract.v1', {
    acceptance: options.acceptance.map(({ id, source, text }) => ({ id, source, text })),
    children: options.children,
  });
}

async function workspaceSources(paths: NativeProjectPaths): Promise<WorkspaceSource[]> {
  const roots = listGitWorktreeRoots(paths.projectRoot);
  if (!roots.some((root) => samePath(root, paths.projectRoot))) roots.push(paths.projectRoot);
  const sources: WorkspaceSource[] = [];
  for (const projectRoot of [...new Set(roots.map((root) => path.resolve(root)))]) {
    const config = await readProjectConfig(projectRoot);
    if (!config) continue;
    sources.push({
      projectRoot,
      paths: await nativeProjectPaths(projectRoot, config.native.artifact_root),
      parent: samePath(projectRoot, paths.projectRoot),
    });
  }
  if (!sources.some(({ parent }) => parent)) {
    sources.push({ projectRoot: paths.projectRoot, paths, parent: true });
  }
  return sources;
}

/**
 * Locate the unique active v1 Supervisor parent for a Child archive. v1 is
 * intentionally discovered from its declared children contract and current
 * Git binding; v2 Supervisor state is never inferred from this compatibility
 * path.
 */
export async function findNativeV1SupervisorParents(options: {
  paths: NativeProjectPaths;
  childName: string;
  targetBranch: string | null;
}): Promise<{
  candidate: NativeV1SupervisorParentCandidate | null;
  blockers: string[];
}> {
  const sources = await workspaceSources(options.paths);
  const candidates: NativeV1SupervisorParentCandidate[] = [];
  const blockers: string[] = [];
  const matchingParents = new Map<
    string,
    Array<{ source: WorkspaceSource; state: NativePortableState }>
  >();
  for (const source of sources) {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(source.paths.changesDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === options.childName) {
        continue;
      }
      const changeDir = path.join(source.paths.changesDir, entry.name);
      let state: NativePortableState;
      try {
        state = await readNativePortableState(path.join(changeDir, 'comet-state.yaml'));
      } catch {
        continue;
      }
      if (state.phase !== 'build' || state.status !== 'active') continue;
      const contract = await readNativeChildrenContract({
        changeDir,
        ...(state.acceptance.length > 0
          ? { acceptanceIds: state.acceptance.map(({ id }) => id) }
          : {}),
      });
      if (!contract || contract.contract.schema !== NATIVE_CHILDREN_SCHEMA) continue;
      if (!contract.contract.children.some(({ name }) => name === options.childName)) continue;
      matchingParents.set(state.name, [
        ...(matchingParents.get(state.name) ?? []),
        { source, state },
      ]);
    }
  }
  for (const [parentName, records] of matchingParents) {
    const targetRecords =
      options.targetBranch === null
        ? []
        : records.filter(({ state }) => state.workspace.target_branch === options.targetBranch);
    if (options.targetBranch === null) {
      blockers.push(
        `Native Supervisor Child ${options.childName} has no target branch to match parent ${parentName}`,
      );
      continue;
    }
    const boundRecord = targetRecords.find(
      ({ source, state }) =>
        inspectGitWorktree(source.projectRoot).currentBranch === state.workspace.change_branch,
    );
    if (!boundRecord) {
      const targetRecord = records.find(
        ({ state }) => state.workspace.target_branch !== options.targetBranch,
      );
      if (targetRecord) {
        blockers.push(
          `Native Supervisor parent ${parentName} targets ${targetRecord.state.workspace.target_branch ?? '(missing)'}, not ${options.targetBranch}`,
        );
      } else {
        const state = targetRecords[0]?.state ?? records[0].state;
        blockers.push(
          `Native Supervisor parent ${parentName} is not bound to branch ${state.workspace.change_branch}`,
        );
      }
      continue;
    }
    const { source, state } = boundRecord;
    const parentPaths = source.paths;
    const inspection = await inspectNativeChildren({ paths: parentPaths, state });
    if (!inspection) {
      blockers.push(`Native Supervisor parent ${parentName} has no readable Child inspection`);
    } else if (!inspection.confirmed) {
      blockers.push(`Native Supervisor parent ${parentName} requires Shape confirmation`);
    } else if (inspection.allDone) {
      candidates.push({ paths: parentPaths, state, inspection });
    } else {
      const incomplete = inspection.children
        .filter(({ status }) => status !== 'done')
        .map(({ name, status, message }) => `${name}=${status}${message ? ` (${message})` : ''}`)
        .join(', ');
      blockers.push(
        `Native Supervisor parent ${parentName} is not ready to advance: ${incomplete || 'Child facts are incomplete'}`,
      );
    }
  }
  if (matchingParents.size === 0) {
    blockers.push(
      `Native Supervisor Child ${options.childName} has no active v1 parent declaring it`,
    );
  }
  if (matchingParents.size > 1) {
    blockers.push(
      `Native Supervisor Child ${options.childName} has multiple active parents: ${[...matchingParents.keys()].join(', ')}`,
    );
  }
  if (candidates.length === 1 && blockers.length === 0)
    return { candidate: candidates[0], blockers };
  if (candidates.length > 1) {
    blockers.push(
      `Native Supervisor Child ${options.childName} has multiple eligible parents: ${candidates
        .map(({ state }) => state.name)
        .join(', ')}`,
    );
  }
  return { candidate: null, blockers };
}

async function readActiveChild(
  source: WorkspaceSource,
  name: string,
): Promise<NativePortableState | null> {
  const file = path.join(source.paths.changesDir, name, 'comet-state.yaml');
  try {
    return await readNativePortableState(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function readArchivedChildren(
  source: WorkspaceSource,
  names: ReadonlySet<string>,
): Promise<ArchivedChildState[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(source.paths.archiveDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const states: ArchivedChildState[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const possible = [...names].some((name) => entry.name.endsWith(`-${name}`));
    if (!possible) continue;
    try {
      const file = path.join(source.paths.archiveDir, entry.name, 'comet-state.yaml');
      const state = await readNativePortableState(file);
      if (names.has(state.name)) states.push({ file, state });
    } catch {
      // Legacy archives cannot satisfy a Portable Native child declaration.
    }
  }
  return states;
}

function readCommittedPortableState(
  source: WorkspaceSource,
  file: string,
  ref: string,
): NativePortableState | null {
  const relative = path.relative(source.projectRoot, file);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)) return null;
  const repositoryPath = relative.split(path.sep).join('/');
  try {
    const document = parseDocument(
      runGitCommand(source.projectRoot, ['show', `${ref}:${repositoryPath}`]),
      { uniqueKeys: true },
    );
    if (document.errors.length > 0) return null;
    return parseNativePortableState(document.toJS({ mapAsMap: false }));
  } catch {
    return null;
  }
}

function activeFact(
  state: NativePortableState,
  source: WorkspaceSource,
  parentBranch: string | null,
): ChildFact {
  if (
    state.workspace.isolation !== 'worktree' ||
    state.workspace.target_branch !== parentBranch ||
    (state.workspace.finish !== null && state.workspace.finish !== 'merge')
  ) {
    return {
      kind: 'blocked',
      phase: state.phase,
      projectRoot: source.projectRoot,
      message: `Native child ${state.name} must use a linked worktree targeting parent branch ${parentBranch ?? '(missing)'}`,
    };
  }
  if (state.status === 'blocked' || state.status === 'await-user') {
    return {
      kind: 'blocked',
      phase: state.phase,
      projectRoot: source.projectRoot,
      message:
        state.blockers[0]?.reason.text ?? `Native child ${state.name} requires user resolution`,
    };
  }
  return {
    kind: 'active',
    phase: state.phase,
    projectRoot: source.projectRoot,
    message: null,
  };
}

function isMergedChildArchive(state: NativePortableState, parentBranch: string | null): boolean {
  return (
    state.status === 'done' &&
    state.archived &&
    state.workspace.finish === 'merge' &&
    state.workspace.target_branch === parentBranch
  );
}

export async function inspectNativeChildren(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<NativeChildrenInspection | null> {
  const changeDir = path.join(options.paths.changesDir, options.state.name);
  const coordinationChoiceRequired = await readNativeSupervisorShapeIntent(changeDir);
  const document = await readNativeChildrenContract({
    changeDir,
    validation: nativeChildrenAcceptanceValidation(options.state),
    ...(options.state.acceptance.length > 0
      ? { acceptanceIds: options.state.acceptance.map(({ id }) => id) }
      : {}),
    policy: 'advisory',
  });
  if (!document) {
    return options.state.children_contract_hash
      ? {
          ...(coordinationChoiceRequired ? { coordinationChoiceRequired: true } : {}),
          contractHash: null,
          confirmed: false,
          parentBranch: options.state.workspace.change_branch,
          children: [],
          readyChildren: [],
          allDone: false,
        }
      : coordinationChoiceRequired
        ? {
            coordinationChoiceRequired: true,
            contractHash: null,
            confirmed: false,
            parentBranch: options.state.workspace.change_branch,
            children: [],
            readyChildren: [],
            allDone: false,
          }
        : null;
  }

  const contractHash = hashNativeParentContract({
    acceptance: options.state.acceptance,
    children: document.contract,
  });
  const parentBranch = options.state.workspace.change_branch;
  const confirmed =
    options.state.phase !== 'shape' &&
    options.state.children_contract_hash === contractHash &&
    !document.drift;
  if (document.contract.schema === NATIVE_CHILDREN_V2_SCHEMA) {
    let supervisor = await readNativeSupervisorState(options.paths, options.state.name);
    if (!supervisor) {
      const targetBranch =
        options.state.workspace.target_branch ?? options.state.workspace.change_branch;
      if (targetBranch) {
        const rebuilt = await rebuildNativeSupervisorStateFromFacts({
          paths: options.paths,
          parent: options.state.name,
          targetBranch,
          contract: document.contract,
        });
        if (rebuilt) {
          supervisor = rebuilt;
          await writeNativeSupervisorState(options.paths, rebuilt);
        }
      }
    }
    if (supervisor) {
      const projected = projectNativeSupervisorChildren(supervisor);
      if (options.state.children_contract_hash !== contractHash || document.drift) {
        return {
          ...projected,
          schema: document.contract.schema,
          ...(coordinationChoiceRequired ? { coordinationChoiceRequired: true } : {}),
          contractHash,
          confirmed: false,
          readyChildren: [],
          allDone: false,
          children: projected.children.map((child) => ({
            ...child,
            message: document.drift
              ? 'Children acceptance index is stale; Shape confirmation is required'
              : 'Supervisor child plan changed; Shape confirmation is required',
          })),
        };
      }
      return {
        ...projected,
        schema: document.contract.schema,
        ...(coordinationChoiceRequired ? { coordinationChoiceRequired: true } : {}),
        contractHash,
        confirmed,
      };
    }
    const definitions = new Map(document.contract.children.map((child) => [child.name, child]));
    const projections = document.contract.children.map(
      (child): NativeChildStatusProjection => ({
        name: child.name,
        summary: child.summary,
        dependsOn: [...child.depends_on],
        covers: [],
        status:
          confirmed &&
          child.depends_on.every((dependency) =>
            document.contract.children
              .filter(({ name }) => name !== child.name)
              .every(({ name }) => name !== dependency),
          )
            ? 'ready'
            : 'pending',
        phase: null,
        projectRoot: null,
        message: confirmed ? null : 'Parent Shape confirmation is required',
      }),
    );
    // The fallback only applies before the machine state is first written. A dependency
    // is ready only when all of its declared ancestors are represented in the plan;
    // the persisted Supervisor state becomes authoritative as soon as Build starts.
    for (const projection of projections) {
      if (projection.status !== 'ready') continue;
      const definition = definitions.get(projection.name)!;
      if (definition.depends_on.length > 0) projection.status = 'pending';
    }
    return {
      schema: document.contract.schema,
      ...(coordinationChoiceRequired ? { coordinationChoiceRequired: true } : {}),
      contractHash,
      confirmed,
      parentBranch,
      children: projections,
      readyChildren: projections.filter(({ status }) => status === 'ready').map(({ name }) => name),
      allDone: false,
    };
  }
  const sources = await workspaceSources(options.paths);
  const names = new Set(document.contract.children.map(({ name }) => name));
  const archives = new Map<string, ArchivedChildEvidence[]>();
  const active = new Map<string, Array<{ source: WorkspaceSource; state: NativePortableState }>>();
  for (const source of sources) {
    const archiveRef = source.parent && parentBranch ? `refs/heads/${parentBranch}` : 'HEAD';
    for (const archived of await readArchivedChildren(source, names)) {
      const evidence = {
        ...archived,
        source,
        committedState: readCommittedPortableState(source, archived.file, archiveRef),
      };
      archives.set(archived.state.name, [...(archives.get(archived.state.name) ?? []), evidence]);
    }
    for (const name of names) {
      const state = await readActiveChild(source, name);
      if (state) active.set(name, [...(active.get(name) ?? []), { source, state }]);
    }
  }

  const facts = new Map<string, ChildFact>();
  for (const child of document.contract.children) {
    const merged = (archives.get(child.name) ?? []).find(
      ({ source, committedState }) =>
        source.parent &&
        committedState?.name === child.name &&
        isMergedChildArchive(committedState, parentBranch),
    );
    if (merged) {
      facts.set(child.name, {
        kind: 'done',
        phase: merged.state.phase,
        projectRoot: merged.source.projectRoot,
        message: null,
      });
      continue;
    }
    const unmerged = archives.get(child.name)?.[0];
    if (unmerged) {
      facts.set(child.name, {
        kind: 'blocked',
        phase: unmerged.state.phase,
        projectRoot: unmerged.source.projectRoot,
        message: `Native child ${child.name} is archived but not merged into parent branch ${parentBranch ?? '(missing)'}`,
      });
      continue;
    }
    const candidates = active.get(child.name) ?? [];
    if (candidates.length > 1) {
      facts.set(child.name, {
        kind: 'blocked',
        phase: null,
        projectRoot: null,
        message: `Native child ${child.name} has multiple active workspace owners`,
      });
    } else if (candidates[0]) {
      facts.set(child.name, activeFact(candidates[0].state, candidates[0].source, parentBranch));
    }
  }

  const definitions = new Map(document.contract.children.map((child) => [child.name, child]));
  const resolved = new Map<string, NativeChildStatusProjection>();
  const resolve = (name: string): NativeChildStatusProjection => {
    const existing = resolved.get(name);
    if (existing) return existing;
    const definition = definitions.get(name)!;
    const dependencies = definition.depends_on.map(resolve);
    const dependenciesDone = dependencies.every(({ status }) => status === 'done');
    const fact = facts.get(name);
    const missingBaseDependencies =
      fact?.kind === 'active' && dependenciesDone
        ? definition.depends_on.filter(
            (dependency) =>
              !(archives.get(dependency) ?? []).some(
                ({ source, committedState }) =>
                  samePath(source.projectRoot, fact.projectRoot!) &&
                  committedState?.name === dependency &&
                  isMergedChildArchive(committedState, parentBranch),
              ),
          )
        : [];
    let status: NativeChildDerivedStatus;
    let message = fact?.message ?? null;
    if (fact?.kind === 'done') {
      status = dependenciesDone ? 'done' : 'blocked';
      if (!dependenciesDone) message = `Native child ${name} was merged before its dependencies`;
    } else if (fact?.kind === 'active') {
      status = dependenciesDone && missingBaseDependencies.length === 0 ? 'active' : 'blocked';
      if (!dependenciesDone)
        message = `Native child ${name} started before its dependencies merged`;
      else if (missingBaseDependencies.length > 0)
        message = `Native child ${name} does not include merged dependencies: ${missingBaseDependencies.join(', ')}`;
    } else if (fact?.kind === 'blocked') {
      status = 'blocked';
    } else {
      status = confirmed && dependenciesDone ? 'ready' : 'pending';
      if (!confirmed) message = 'Parent Shape confirmation is required';
    }
    const projection: NativeChildStatusProjection = {
      name,
      summary: definition.summary,
      dependsOn: [...definition.depends_on],
      covers: [...definition.covers],
      status,
      phase: fact?.phase ?? null,
      projectRoot: fact?.projectRoot ?? null,
      message,
    };
    resolved.set(name, projection);
    return projection;
  };
  const children = document.contract.children.map(({ name }) => resolve(name));
  return {
    schema: document.contract.schema,
    ...(coordinationChoiceRequired ? { coordinationChoiceRequired: true } : {}),
    contractHash,
    confirmed,
    parentBranch,
    children,
    readyChildren: children.filter(({ status }) => status === 'ready').map(({ name }) => name),
    allDone: children.every(({ status }) => status === 'done'),
  };
}
