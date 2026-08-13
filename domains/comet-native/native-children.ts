import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parseDocument } from 'yaml';

import { listGitWorktreeRoots } from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';

import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { canonicalHash } from './native-canonical-hash.js';
import { readProjectConfig } from './native-config.js';
import { nativeProjectPaths } from './native-paths.js';
import { parseNativePortableState, readNativePortableState } from './native-portable-state.js';
import type {
  NativePortableAcceptanceState,
  NativePortablePhase,
  NativePortableState,
} from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';

export const NATIVE_CHILDREN_FILE = 'children.yaml';
export const NATIVE_CHILDREN_SCHEMA = 'comet.native.children.v1' as const;

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const ROOT_KEYS = new Set(['schema', 'children']);
const CHILD_KEYS = new Set(['name', 'depends_on', 'covers']);

export interface NativeChildDefinition {
  name: string;
  depends_on: string[];
  covers: string[];
}

export interface NativeChildrenContract {
  schema: typeof NATIVE_CHILDREN_SCHEMA;
  children: NativeChildDefinition[];
}

export interface NativeChildrenDocument {
  contract: NativeChildrenContract;
  size: number;
}

export type NativeChildDerivedStatus = 'pending' | 'ready' | 'active' | 'done' | 'blocked';

export interface NativeChildStatusProjection {
  name: string;
  dependsOn: string[];
  covers: string[];
  status: NativeChildDerivedStatus;
  phase: NativePortablePhase | null;
  projectRoot: string | null;
  message: string | null;
}

export interface NativeChildrenInspection {
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

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
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
    throw new Error(`${label} fields are invalid`);
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
  const missing = acceptanceIds.filter((id) => !covered.has(id));
  if (missing.length > 0) {
    throw new Error(`Native children do not cover parent acceptance: ${missing.join(', ')}`);
  }
}

export function parseNativeChildrenContract(
  source: string,
  acceptanceIds?: readonly string[],
): NativeChildrenContract {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Native children contract is invalid YAML: ${document.errors[0].message}`);
  }
  const root = record(document.toJS({ mapAsMap: false }), 'Native children contract');
  exactKeys(root, ROOT_KEYS, 'Native children contract');
  if (root.schema !== NATIVE_CHILDREN_SCHEMA) {
    throw new Error(`Native children schema must be ${NATIVE_CHILDREN_SCHEMA}`);
  }
  if (!Array.isArray(root.children) || root.children.length === 0) {
    throw new Error('Native children must be a non-empty array');
  }
  const children = root.children.map((entry, index): NativeChildDefinition => {
    const child = record(entry, `Native child ${index}`);
    exactKeys(child, CHILD_KEYS, `Native child ${index}`);
    if (typeof child.name !== 'string' || !NAME_PATTERN.test(child.name)) {
      throw new Error(`Native child ${index} name is invalid`);
    }
    return {
      name: child.name,
      depends_on: stringList(child.depends_on, `Native child ${child.name} depends_on`),
      covers: stringList(child.covers, `Native child ${child.name} covers`),
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
  if (acceptanceIds) validateCoverage(children, acceptanceIds);
  return { schema: NATIVE_CHILDREN_SCHEMA, children };
}

export async function readNativeChildrenContract(options: {
  changeDir: string;
  acceptanceIds?: readonly string[];
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
  return {
    contract: parseNativeChildrenContract(source.text, options.acceptanceIds),
    size: source.size,
  };
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
  const document = await readNativeChildrenContract({
    changeDir,
    ...(options.state.acceptance.length > 0
      ? { acceptanceIds: options.state.acceptance.map(({ id }) => id) }
      : {}),
  });
  if (!document) {
    return options.state.children_contract_hash
      ? {
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
  const confirmed =
    options.state.phase !== 'shape' && options.state.children_contract_hash === contractHash;
  const sources = await workspaceSources(options.paths);
  const parentBranch = options.state.workspace.change_branch;
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
    contractHash,
    confirmed,
    parentBranch,
    children,
    readyChildren: children.filter(({ status }) => status === 'ready').map(({ name }) => name),
    allDone: children.every(({ status }) => status === 'done'),
  };
}
