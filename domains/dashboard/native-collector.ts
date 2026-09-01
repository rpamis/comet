import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readNativeTextFilePrefix } from '../comet-native/native-bounded-file.js';
import {
  NATIVE_CHILDREN_FILE,
  inspectNativeChildren,
  readNativeChildrenContract,
  type NativeChildStatusProjection,
} from '../comet-native/native-children.js';
import { NATIVE_CHANGE_STATE_FILE, readNativeChangeFile } from '../comet-native/native-change.js';
import { readNativeLocalExecution } from '../comet-native/native-local-execution.js';
import {
  nativePreferredChangeRuntimeDir,
  nativeProjectPaths,
  resolveContainedNativePath,
} from '../comet-native/native-paths.js';
import { readNativePortableState } from '../comet-native/native-portable-state.js';
import type {
  NativeLocalExecutionState,
  NativePortableState,
} from '../comet-native/native-portable-types.js';
import type { NativeChangeState, NativeProjectPaths } from '../comet-native/native-types.js';
import { projectNativeWorkspace } from '../comet-native/native-workspace.js';
import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';
import {
  adaptNativeDashboardChange,
  adaptNativeDashboardListItem,
  adaptNativeDashboardProjection,
  NATIVE_DASHBOARD_LIMITS,
  NATIVE_DASHBOARD_SCHEMA,
  type NativeDashboardArtifactPreview,
  type NativeDashboardChildSummary,
  type NativeDashboardChangeListItem,
  type NativeDashboardChangeProjection,
  type NativeDashboardLocalExecutionReason,
  type NativeDashboardProjection,
} from './native-adapter.js';
import {
  adaptLegacyNativeDashboardChange,
  adaptLegacyNativeDashboardListItem,
  invalidNativeDashboardChange,
  invalidNativeDashboardListItem,
} from './native-legacy-adapter.js';
import type { DashboardChangeTab, NativeDashboardChangePage } from './types.js';
import { DashboardIndexStore, resolveDashboardIndexPath } from './index-store.js';
import { DashboardIndexReconciler } from './index-reconciler.js';
import {
  collectDashboardWorkspaceSources,
  dashboardWorkspaceIdentity,
  encodeDashboardChangeLocator,
  isDashboardWorkspaceSourceEligible,
  parseDashboardChangeLocator,
  sameDashboardPath,
  type DashboardWorkspaceSource,
} from './workspace.js';

const ARCHIVE_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})-(.+)$/u;
const DEFAULT_NATIVE_CHANGE_PAGE_SIZE = 5;
const MAX_NATIVE_CHANGE_PAGE_SIZE = 50;
const NATIVE_DASHBOARD_CURSOR_PREFIX = 'native-dashboard-v2.';
const NATIVE_INDEX_REFRESH_INTERVAL_MS = 30_000;

const nativeIndexReconciler = new DashboardIndexReconciler(NATIVE_INDEX_REFRESH_INTERVAL_MS);

interface NativeDashboardEntry {
  status: 'active' | 'archived';
  name: string;
  archiveName?: string;
}

interface NativeDashboardSource {
  workspace: DashboardWorkspaceSource;
  paths: NativeProjectPaths;
}

interface NativeDashboardCandidate {
  source: NativeDashboardSource;
  entry: NativeDashboardEntry;
  locator: string;
}

interface NativeDashboardRootCandidate extends NativeDashboardCandidate {
  children: NativeDashboardChildSummary[];
}

type NativeDashboardStateRead =
  | { kind: 'portable'; state: NativePortableState }
  | { kind: 'legacy'; state: NativeChangeState }
  | { kind: 'invalid'; message: string };

interface NativeDashboardCursor {
  status: DashboardChangeTab;
  query: string;
  offset: number;
  total: number;
  nextKey: string;
}

export class NativeDashboardQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NativeDashboardQueryError';
  }
}

function archiveDate(entry: NativeDashboardEntry): string | null {
  return entry.archiveName ? (ARCHIVE_NAME_PATTERN.exec(entry.archiveName)?.[1] ?? null) : null;
}

function entryDirectory(paths: NativeProjectPaths, entry: NativeDashboardEntry): string {
  return entry.status === 'active'
    ? path.join(paths.changesDir, entry.name)
    : path.join(paths.archiveDir, entry.archiveName ?? '');
}

async function readDashboardState(file: string): Promise<NativeDashboardStateRead> {
  try {
    return { kind: 'portable', state: await readNativePortableState(file) };
  } catch (portableError) {
    try {
      return { kind: 'legacy', state: await readNativeChangeFile(file) };
    } catch {
      return {
        kind: 'invalid',
        message:
          portableError instanceof Error ? portableError.message : 'Native state is invalid.',
      };
    }
  }
}

function matchesEntry(
  entry: NativeDashboardEntry,
  state: NativePortableState | NativeChangeState,
): boolean {
  return state.name === entry.name && state.archived === (entry.status === 'archived');
}

function artifactDescriptors(
  state: Pick<
    NativePortableState | NativeChangeState,
    'brief' | 'spec_changes' | 'verification_report'
  >,
): Array<[string, string, string]> {
  const descriptors: Array<[string, string, string]> = [
    ['comet-state.yaml', '工作流状态', NATIVE_CHANGE_STATE_FILE],
    ['brief', '需求简报', state.brief],
  ];
  for (const spec of state.spec_changes) {
    if (!spec.source) continue;
    descriptors.push([`spec-${spec.capability}`, `${spec.capability} Spec`, spec.source]);
  }
  if (state.verification_report) {
    descriptors.push(['verification', '验证报告', state.verification_report]);
  }
  return descriptors.slice(0, NATIVE_DASHBOARD_LIMITS.maxArtifactPreviews);
}

async function readArtifactPreview(
  root: string,
  [key, label, ref]: [string, string, string],
): Promise<NativeDashboardArtifactPreview> {
  const missing: NativeDashboardArtifactPreview = { key, label, path: ref, exists: false };
  try {
    const artifact = await readNativeTextFilePrefix({
      root,
      ref,
      maxBytes: NATIVE_DASHBOARD_LIMITS.maxArtifactPreviewBytes,
    });
    return {
      ...missing,
      exists: true,
      content: artifact.text,
      truncated: artifact.truncated,
      size: artifact.size,
    };
  } catch {
    return missing;
  }
}

async function collectArtifacts(
  changeDir: string,
  state: NativePortableState | NativeChangeState,
): Promise<NativeDashboardArtifactPreview[]> {
  return Promise.all(
    artifactDescriptors(state).map((descriptor) => readArtifactPreview(changeDir, descriptor)),
  );
}

async function readMatchingLocalExecution(
  paths: NativeProjectPaths,
  state: NativePortableState,
  status: NativeDashboardEntry['status'],
): Promise<{
  state: NativeLocalExecutionState | null;
  reason: NativeDashboardLocalExecutionReason;
}> {
  if (status === 'archived' || state.archived || state.status === 'done') {
    return { state: null, reason: 'archived' };
  }
  let file: string;
  try {
    file = path.join(nativePreferredChangeRuntimeDir(paths, state.name), 'state.json');
    await resolveContainedNativePath(paths.projectRoot, file);
  } catch {
    return { state: null, reason: 'invalid' };
  }
  let local: NativeLocalExecutionState | null;
  try {
    local = await readNativeLocalExecution(file);
  } catch {
    return { state: null, reason: 'invalid' };
  }
  if (!local) return { state: null, reason: 'missing' };
  if (local.change !== state.name || local.basedOnStateVersion !== state.state_version) {
    return { state: null, reason: 'version-mismatch' };
  }
  return { state: local, reason: local.execution ? 'current' : 'idle' };
}

async function listDirectoryEntries(directory: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function listActiveNativeEntries(paths: NativeProjectPaths): Promise<NativeDashboardEntry[]> {
  return (await listDirectoryEntries(paths.changesDir))
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({ status: 'active' as const, name: entry.name }));
}

async function listArchivedNativeEntries(
  paths: NativeProjectPaths,
): Promise<NativeDashboardEntry[]> {
  const result: NativeDashboardEntry[] = [];
  for (const entry of (await listDirectoryEntries(paths.archiveDir)).sort((left, right) =>
    right.name.localeCompare(left.name),
  )) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const match = ARCHIVE_NAME_PATTERN.exec(entry.name);
    if (match) {
      result.push({ status: 'archived', name: match[2], archiveName: entry.name });
    }
  }
  return result;
}

function nativeDashboardEntryIdentity(entry: NativeDashboardEntry): string {
  return `${entry.status}:${entry.archiveName ?? entry.name}:${entry.name}`;
}

function nativeDashboardCandidateKey(candidate: NativeDashboardCandidate): string {
  return `${candidate.source.workspace.id}:${nativeDashboardEntryIdentity(candidate.entry)}`;
}

function nativeDashboardCandidateLocator(
  source: NativeDashboardSource,
  entry: NativeDashboardEntry,
): string {
  return encodeDashboardChangeLocator(
    source.workspace.id,
    `native:${nativeDashboardEntryIdentity(entry)}`,
  );
}

interface NativeDashboardIndex {
  active: NativeDashboardRootCandidate[];
  archived: NativeDashboardRootCandidate[];
  all: NativeDashboardCandidate[];
  activeChangeCount: number;
  archivedChangeCount: number;
}

async function discoverNativeDashboardSources(
  projectRoot: string,
): Promise<NativeDashboardSource[]> {
  const sources: NativeDashboardSource[] = [];
  for (const workspace of collectDashboardWorkspaceSources(projectRoot)) {
    try {
      const config = await readWorkflowProjectConfig(workspace.projectRoot);
      if (!config?.native) continue;
      sources.push({
        workspace,
        paths: await nativeProjectPaths(workspace.projectRoot, config.native.artifact_root),
      });
    } catch (error) {
      console.warn(
        `[dashboard] skipping Native workspace "${workspace.label}": ${(error as Error).message ?? error}`,
      );
    }
  }
  return sources;
}

async function rawNativeDashboardCandidates(
  sources: readonly NativeDashboardSource[],
): Promise<{ active: NativeDashboardCandidate[]; archived: NativeDashboardCandidate[] }> {
  const collections = await Promise.all(
    sources.map(async (source) => {
      try {
        const [active, archived] = await Promise.all([
          listActiveNativeEntries(source.paths),
          listArchivedNativeEntries(source.paths),
        ]);
        const adapt = (entry: NativeDashboardEntry): NativeDashboardCandidate => ({
          source,
          entry,
          locator: nativeDashboardCandidateLocator(source, entry),
        });
        return { active: active.map(adapt), archived: archived.map(adapt) };
      } catch (error) {
        console.warn(
          `[dashboard] skipping Native workspace "${source.workspace.label}": ${(error as Error).message ?? error}`,
        );
        return { active: [], archived: [] };
      }
    }),
  );
  return {
    active: collections.flatMap(({ active }) => active),
    archived: collections.flatMap(({ archived }) => archived),
  };
}

async function nativeCandidateBindingState(
  candidate: NativeDashboardCandidate,
): Promise<'aligned' | 'unbound' | 'drifted'> {
  try {
    const { read } = await readEntryState(candidate.source.paths, candidate.entry);
    if (read.kind === 'portable') {
      const boundBranch = read.state.workspace.change_branch;
      if (!boundBranch) return 'unbound';
      return boundBranch === candidate.source.workspace.branch ? 'aligned' : 'drifted';
    }
    if (read.kind === 'legacy') {
      const workspace = await projectNativeWorkspace(candidate.source.paths, candidate.entry.name);
      return workspace.bindingState === 'aligned'
        ? 'aligned'
        : workspace.bindingState === 'drifted'
          ? 'drifted'
          : 'unbound';
    }
  } catch {
    // The selected page adapter reports malformed state; discovery only needs
    // a deterministic source when ownership cannot be inspected.
  }
  return 'unbound';
}

async function selectActiveNativeCandidates(
  candidates: readonly NativeDashboardCandidate[],
): Promise<NativeDashboardCandidate[]> {
  const grouped = new Map<string, NativeDashboardCandidate[]>();
  for (const candidate of candidates) {
    grouped.set(candidate.entry.name, [...(grouped.get(candidate.entry.name) ?? []), candidate]);
  }
  const selected: NativeDashboardCandidate[] = [];
  for (const group of grouped.values()) {
    if (group.length === 1) {
      selected.push(group[0]);
      continue;
    }
    const inspected = await Promise.all(
      group.map(async (candidate) => ({
        candidate,
        bindingState: await nativeCandidateBindingState(candidate),
      })),
    );
    const aligned = inspected.filter(({ bindingState }) => bindingState === 'aligned');
    if (aligned.length > 0) {
      selected.push(...aligned.map(({ candidate }) => candidate));
      continue;
    }
    selected.push(
      group.find(({ source }) => source.workspace.current) ??
        group
          .slice()
          .sort((left, right) =>
            left.source.workspace.label.localeCompare(right.source.workspace.label),
          )[0],
    );
  }
  return selected;
}

function selectArchivedNativeCandidates(
  candidates: readonly NativeDashboardCandidate[],
): NativeDashboardCandidate[] {
  const grouped = new Map<string, NativeDashboardCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.entry.archiveName ?? candidate.entry.name;
    grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
  }
  return [...grouped.values()].map(
    (group) =>
      group.find(({ source }) => source.workspace.current) ??
      group
        .slice()
        .sort((left, right) =>
          left.source.workspace.label.localeCompare(right.source.workspace.label),
        )[0],
  );
}

function matchingChildCandidate(
  child: NativeChildStatusProjection,
  candidates: readonly NativeDashboardCandidate[],
): NativeDashboardCandidate | null {
  const named = candidates.filter(({ entry }) => entry.name === child.name);
  if (!child.projectRoot && named.length > 1) return null;
  const rooted = child.projectRoot
    ? named.filter(({ source }) =>
        sameDashboardPath(source.workspace.projectRoot, child.projectRoot!),
      )
    : named;
  const pool = rooted.length > 0 ? rooted : named;
  if (pool.length === 0) return null;
  const preferredStatus =
    child.status === 'done' || (child.status === 'blocked' && child.phase === 'archive')
      ? 'archived'
      : 'active';
  return pool.find(({ entry }) => entry.status === preferredStatus) ?? pool[0];
}

function childSummary(
  child: NativeChildStatusProjection,
  candidates: readonly NativeDashboardCandidate[],
): NativeDashboardChildSummary {
  const candidate = matchingChildCandidate(child, candidates);
  return {
    name: child.name,
    summary: child.summary,
    dependsOn: [...child.dependsOn],
    covers: [...child.covers],
    status: child.status,
    phase: child.phase,
    message: child.message,
    locator: candidate?.locator ?? null,
    changeStatus: candidate?.entry.status ?? null,
    ...(candidate?.entry.archiveName ? { archiveName: candidate.entry.archiveName } : {}),
    workspace: candidate ? dashboardWorkspaceIdentity(candidate.source.workspace) : null,
  };
}

async function hasNativeChildrenContract(candidate: NativeDashboardCandidate): Promise<boolean> {
  try {
    await fs.access(
      path.join(entryDirectory(candidate.source.paths, candidate.entry), NATIVE_CHILDREN_FILE),
    );
    return true;
  } catch {
    return false;
  }
}

async function activeParentChildren(
  candidate: NativeDashboardCandidate,
  candidates: readonly NativeDashboardCandidate[],
): Promise<NativeDashboardChildSummary[]> {
  try {
    if (!(await hasNativeChildrenContract(candidate))) return [];
    const { changeDir, read } = await readEntryState(candidate.source.paths, candidate.entry);
    if (read.kind !== 'portable') return [];
    const document = await readNativeChildrenContract({
      changeDir,
      policy: 'advisory',
      ...(read.state.acceptance.length > 0
        ? { acceptanceIds: read.state.acceptance.map(({ id }) => id) }
        : {}),
    });
    if (!document) return [];
    if (document.contract.schema === 'comet.native.children.v2') {
      const inspection = await inspectNativeChildren({
        paths: candidate.source.paths,
        state: read.state,
      });
      if (inspection) {
        return inspection.children.map((child) => childSummary(child, candidates));
      }
    }
    const children = document.contract.children;
    const candidatesByName = new Map(
      children.map((child) => [
        child.name,
        matchingChildCandidate(
          {
            name: child.name,
            summary: child.summary,
            dependsOn: child.depends_on,
            covers: child.covers,
            status: 'pending',
            phase: null,
            projectRoot: null,
            message: null,
          },
          candidates,
        ),
      ]),
    );
    const archived = new Set(
      children
        .filter(({ name }) => candidatesByName.get(name)?.entry.status === 'archived')
        .map(({ name }) => name),
    );
    return Promise.all(
      children.map(async (child): Promise<NativeDashboardChildSummary> => {
        const childCandidate = candidatesByName.get(child.name) ?? null;
        let status: NativeChildStatusProjection['status'] = 'pending';
        let phase: NativeChildStatusProjection['phase'] = null;
        let message: string | null = null;
        if (childCandidate?.entry.status === 'archived') {
          status = 'done';
        } else if (childCandidate) {
          status = 'active';
          const childState = await readEntryState(
            childCandidate.source.paths,
            childCandidate.entry,
          );
          if (childState.read.kind === 'portable') {
            phase = childState.read.state.phase;
            if (childState.read.state.status === 'blocked') {
              status = 'blocked';
              message = childState.read.state.blockers[0]?.reason.text ?? null;
            } else if (childState.read.state.status === 'await-user') {
              status = 'blocked';
              message = childState.read.state.blockers[0]?.reason.text ?? null;
            }
          }
        } else if (child.depends_on.every((dependency) => archived.has(dependency))) {
          status = 'ready';
        }
        return childSummary(
          {
            name: child.name,
            summary: child.summary,
            dependsOn: child.depends_on,
            covers: child.covers,
            status,
            phase,
            projectRoot: childCandidate?.source.workspace.projectRoot ?? null,
            message,
          },
          candidates,
        );
      }),
    );
  } catch {
    return [];
  }
}

async function archivedParentChildren(
  candidate: NativeDashboardCandidate,
  candidates: readonly NativeDashboardCandidate[],
): Promise<NativeDashboardChildSummary[]> {
  try {
    if (!(await hasNativeChildrenContract(candidate))) return [];
    const { changeDir, read } = await readEntryState(candidate.source.paths, candidate.entry);
    if (read.kind !== 'portable' || !read.state.children_contract_hash) return [];
    const document = await readNativeChildrenContract({
      changeDir,
      policy: 'advisory',
      acceptanceIds: read.state.acceptance.map(({ id }) => id),
    });
    if (!document) return [];
    return document.contract.children.map((child) =>
      childSummary(
        {
          name: child.name,
          summary: child.summary,
          dependsOn: child.depends_on,
          covers: child.covers,
          status: 'done',
          phase: 'archive',
          projectRoot: null,
          message: null,
        },
        candidates,
      ),
    );
  } catch {
    return [];
  }
}

function isNativeDashboardIndex(value: unknown): value is NativeDashboardIndex {
  if (!value || typeof value !== 'object') return false;
  const index = value as Partial<NativeDashboardIndex>;
  return (
    Array.isArray(index.active) &&
    Array.isArray(index.archived) &&
    Array.isArray(index.all) &&
    typeof index.activeChangeCount === 'number' &&
    typeof index.archivedChangeCount === 'number'
  );
}

function hasInvalidCachedNativeSource(index: NativeDashboardIndex, projectRoot: string): boolean {
  return [...index.active, ...index.archived, ...index.all].some(
    (candidate) => !isDashboardWorkspaceSourceEligible(projectRoot, candidate.source.workspace),
  );
}

async function readCachedNativeDashboardIndex(
  projectRoot: string,
): Promise<NativeDashboardIndex | null> {
  const store = new DashboardIndexStore({ projectRoot });
  try {
    await store.open();
    const cached = await store.readNativeIndex<unknown>();
    return isNativeDashboardIndex(cached) ? cached : null;
  } catch {
    return null;
  } finally {
    await store.close();
  }
}

async function readCachedNativeDashboardEntries(
  projectRoot: string,
  status: DashboardChangeTab,
  query: string | undefined,
): Promise<{ entries: NativeDashboardRootCandidate[]; query: string } | null> {
  const store = new DashboardIndexStore({ projectRoot });
  try {
    await store.open();
    const result = await store.queryNativeIndex<NativeDashboardRootCandidate>({
      status,
      query,
    });
    if (!result.indexed) return null;
    return { entries: result.rows, query: query?.trim().toLowerCase() ?? '' };
  } catch {
    return null;
  } finally {
    await store.close();
  }
}

async function rebuildNativeDashboardIndex(
  projectRoot: string,
): Promise<NativeDashboardIndex | null> {
  const sources = await discoverNativeDashboardSources(projectRoot);
  if (sources.length === 0) return null;
  const raw = await rawNativeDashboardCandidates(sources);
  const [active, archived] = await Promise.all([
    selectActiveNativeCandidates(raw.active),
    Promise.resolve(selectArchivedNativeCandidates(raw.archived)),
  ]);
  const all = [...active, ...archived];
  const [activeChildren, archivedChildren] = await Promise.all([
    Promise.all(active.map((candidate) => activeParentChildren(candidate, all))),
    Promise.all(archived.map((candidate) => archivedParentChildren(candidate, all))),
  ]);
  const suppressed = new Set(
    [...activeChildren, ...archivedChildren]
      .flat()
      .map(({ locator }) => locator)
      .filter((locator): locator is string => Boolean(locator)),
  );
  const rootCandidates = (
    candidates: readonly NativeDashboardCandidate[],
    children: readonly NativeDashboardChildSummary[][],
  ): NativeDashboardRootCandidate[] =>
    candidates
      .map((candidate, index) => ({ ...candidate, children: [...children[index]] }))
      .filter(({ locator }) => !suppressed.has(locator));
  const rootActive = rootCandidates(active, activeChildren);
  const rootArchived = rootCandidates(archived, archivedChildren);
  return {
    active: rootActive,
    archived: rootArchived,
    all,
    activeChangeCount: rootActive.length,
    archivedChangeCount: rootArchived.length,
  };
}

async function reconcileNativeDashboardIndex(root: string): Promise<NativeDashboardIndex | null> {
  const index = await rebuildNativeDashboardIndex(root);
  if (!index) return null;
  const store = new DashboardIndexStore({ projectRoot: root });
  try {
    await store.open();
    await store.replaceNativeIndex(index);
  } finally {
    await store.close();
  }
  return index;
}

async function refreshNativeDashboardIndex(
  projectRoot: string,
): Promise<NativeDashboardIndex | null> {
  const root = path.resolve(projectRoot);
  const key = resolveDashboardIndexPath(root);
  try {
    return await nativeIndexReconciler.refresh(key, () => reconcileNativeDashboardIndex(root));
  } catch {
    // SQLite is only a cache. A failed open, lock, or transaction must not
    // make the Dashboard unavailable when the fact sources are readable.
    return rebuildNativeDashboardIndex(root);
  }
}

function scheduleNativeDashboardRefresh(projectRoot: string): void {
  const root = path.resolve(projectRoot);
  const key = resolveDashboardIndexPath(root);
  nativeIndexReconciler.schedule(key, () => reconcileNativeDashboardIndex(root));
}

export function markNativeDashboardIndexDirty(projectRoot: string): void {
  nativeIndexReconciler.markDirty(resolveDashboardIndexPath(path.resolve(projectRoot)));
  scheduleNativeDashboardRefresh(projectRoot);
}

async function buildNativeDashboardIndex(
  projectRoot: string,
): Promise<NativeDashboardIndex | null> {
  const root = path.resolve(projectRoot);
  const cached = await readCachedNativeDashboardIndex(root);
  if (cached) {
    if (hasInvalidCachedNativeSource(cached, root)) return refreshNativeDashboardIndex(root);
    scheduleNativeDashboardRefresh(root);
    return cached;
  }
  return refreshNativeDashboardIndex(root);
}

function listNativeDashboardEntries(
  index: NativeDashboardIndex,
  status: DashboardChangeTab,
  query = '',
): { entries: NativeDashboardRootCandidate[]; query: string } {
  const normalizedQuery = query.trim().toLowerCase();
  const candidates =
    status === 'active'
      ? index.active
      : status === 'archived'
        ? index.archived
        : [...index.active, ...index.archived];
  return {
    entries: candidates.filter((candidate) => {
      if (!normalizedQuery) return true;
      const workspace = candidate.source.workspace;
      return [
        candidate.entry.name,
        workspace.label,
        workspace.branch,
        ...candidate.children.flatMap((child) => [
          child.name,
          child.workspace?.label,
          child.workspace?.branch,
          child.message,
        ]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    }),
    query: normalizedQuery,
  };
}

function nativeDashboardPageLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_NATIVE_CHANGE_PAGE_SIZE;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_NATIVE_CHANGE_PAGE_SIZE) {
    throw new NativeDashboardQueryError(
      `Native Dashboard change page limit must be an integer between 1 and ${MAX_NATIVE_CHANGE_PAGE_SIZE}`,
    );
  }
  return limit;
}

function encodeNativeDashboardCursor(cursor: NativeDashboardCursor): string {
  return `${NATIVE_DASHBOARD_CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')}`;
}

function parseNativeDashboardCursor(value: string): NativeDashboardCursor {
  if (!value.startsWith(NATIVE_DASHBOARD_CURSOR_PREFIX)) {
    throw new NativeDashboardQueryError('Invalid Native Dashboard change cursor');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(value.slice(NATIVE_DASHBOARD_CURSOR_PREFIX.length), 'base64url').toString('utf8'),
    ) as unknown;
  } catch {
    throw new NativeDashboardQueryError('Invalid Native Dashboard change cursor');
  }
  const record = parsed as Partial<NativeDashboardCursor> | null;
  if (
    !record ||
    (record.status !== 'active' && record.status !== 'archived' && record.status !== 'all') ||
    typeof record.query !== 'string' ||
    !Number.isSafeInteger(record.offset) ||
    !Number.isSafeInteger(record.total) ||
    typeof record.nextKey !== 'string'
  ) {
    throw new NativeDashboardQueryError('Invalid Native Dashboard change cursor');
  }
  return record as NativeDashboardCursor;
}

function nativeDashboardOffset(options: {
  cursor?: string;
  status: DashboardChangeTab;
  query: string;
  entries: readonly NativeDashboardRootCandidate[];
}): number {
  if (!options.cursor) return 0;
  const cursor = parseNativeDashboardCursor(options.cursor);
  if (
    cursor.status !== options.status ||
    cursor.query !== options.query ||
    cursor.total !== options.entries.length ||
    cursor.offset <= 0 ||
    cursor.offset >= options.entries.length ||
    nativeDashboardCandidateKey(options.entries[cursor.offset]) !== cursor.nextKey
  ) {
    throw new NativeDashboardQueryError('Stale Native Dashboard change cursor');
  }
  return cursor.offset;
}

async function readEntryState(
  paths: NativeProjectPaths,
  entry: NativeDashboardEntry,
): Promise<{ changeDir: string; read: NativeDashboardStateRead }> {
  const changeDir = entryDirectory(paths, entry);
  await resolveContainedNativePath(paths.nativeRoot, changeDir);
  return {
    changeDir,
    read: await readDashboardState(path.join(changeDir, NATIVE_CHANGE_STATE_FILE)),
  };
}

function invalidEntryMessage(entry: NativeDashboardEntry): string {
  return `Native ${entry.status} state does not match its Dashboard directory.`;
}

async function collectNativeChangeListItem(
  candidate: NativeDashboardCandidate,
  children: NativeDashboardChildSummary[] = [],
): Promise<NativeDashboardChangeListItem> {
  const { paths } = candidate.source;
  const { entry } = candidate;
  const common = {
    status: entry.status,
    ...(entry.archiveName ? { archiveName: entry.archiveName } : {}),
    archivedAt: archiveDate(entry),
    locator: candidate.locator,
    workspace: dashboardWorkspaceIdentity(candidate.source.workspace),
    children,
  };
  try {
    const { read } = await readEntryState(paths, entry);
    if (read.kind === 'invalid') {
      return invalidNativeDashboardListItem({ name: entry.name, ...common, message: read.message });
    }
    if (!matchesEntry(entry, read.state)) {
      return invalidNativeDashboardListItem({
        name: entry.name,
        ...common,
        message: invalidEntryMessage(entry),
      });
    }
    if (read.kind === 'legacy') {
      return adaptLegacyNativeDashboardListItem({ state: read.state, ...common });
    }
    const local = await readMatchingLocalExecution(paths, read.state, entry.status);
    return adaptNativeDashboardListItem({
      state: read.state,
      ...common,
      localExecution: local.state,
      localExecutionReason: local.reason,
    });
  } catch (error) {
    return invalidNativeDashboardListItem({
      name: entry.name,
      ...common,
      message: error instanceof Error ? error.message : 'Native state is unreadable.',
    });
  }
}

async function collectNativeChange(
  candidate: NativeDashboardCandidate,
  children: NativeDashboardChildSummary[] = [],
): Promise<NativeDashboardChangeProjection> {
  const { paths } = candidate.source;
  const { entry } = candidate;
  const common = {
    status: entry.status,
    ...(entry.archiveName ? { archiveName: entry.archiveName } : {}),
    archivedAt: archiveDate(entry),
    locator: candidate.locator,
    workspace: dashboardWorkspaceIdentity(candidate.source.workspace),
    children,
  };
  try {
    const { changeDir, read } = await readEntryState(paths, entry);
    if (read.kind === 'invalid') {
      return invalidNativeDashboardChange({ name: entry.name, ...common, message: read.message });
    }
    if (!matchesEntry(entry, read.state)) {
      return invalidNativeDashboardChange({
        name: entry.name,
        ...common,
        message: invalidEntryMessage(entry),
      });
    }
    const artifacts = await collectArtifacts(changeDir, read.state);
    if (read.kind === 'legacy') {
      return adaptLegacyNativeDashboardChange({ state: read.state, ...common, artifacts });
    }
    const local = await readMatchingLocalExecution(paths, read.state, entry.status);
    return adaptNativeDashboardChange({
      state: read.state,
      ...common,
      artifacts,
      localExecution: local.state,
      localExecutionReason: local.reason,
    });
  } catch (error) {
    return invalidNativeDashboardChange({
      name: entry.name,
      ...common,
      message: error instanceof Error ? error.message : 'Native state is unreadable.',
    });
  }
}

export interface NativeDashboardChangePageOptions {
  status: DashboardChangeTab;
  limit?: number;
  cursor?: string;
  query?: string;
  now?: Date;
}

/** Read only the YAML and matching local overlay for the requested Native page. */
export async function collectNativeDashboardChangePage(
  projectRoot: string,
  options: NativeDashboardChangePageOptions,
): Promise<NativeDashboardChangePage> {
  const emptyPage: NativeDashboardChangePage = {
    status: options.status,
    items: [],
    total: 0,
    nextCursor: null,
  };
  const root = path.resolve(projectRoot);
  const index = options.cursor
    ? await refreshNativeDashboardIndex(root)
    : await buildNativeDashboardIndex(root);
  if (!index) return emptyPage;
  const listed =
    (await readCachedNativeDashboardEntries(root, options.status, options.query)) ??
    listNativeDashboardEntries(index, options.status, options.query);
  const offset = nativeDashboardOffset({
    cursor: options.cursor,
    status: options.status,
    query: listed.query,
    entries: listed.entries,
  });
  const limit = nativeDashboardPageLimit(options.limit);
  const pageEntries = listed.entries.slice(offset, offset + limit);
  const nextOffset = offset + pageEntries.length;
  return {
    status: options.status,
    items: await Promise.all(
      pageEntries.map((candidate) => collectNativeChangeListItem(candidate, candidate.children)),
    ),
    total: listed.entries.length,
    nextCursor:
      nextOffset < listed.entries.length
        ? encodeNativeDashboardCursor({
            status: options.status,
            query: listed.query,
            offset: nextOffset,
            total: listed.entries.length,
            nextKey: nativeDashboardCandidateKey(listed.entries[nextOffset]),
          })
        : null,
  };
}

export interface NativeDashboardChangeDetailOptions {
  status: 'active' | 'archived';
  name: string;
  archiveName?: string;
  locator?: string;
  now?: Date;
}

/** Read one selected YAML document, its formal Markdown, and a version-matched local overlay. */
export async function collectNativeDashboardChangeDetail(
  projectRoot: string,
  options: NativeDashboardChangeDetailOptions,
): Promise<NativeDashboardChangeProjection | null> {
  const root = path.resolve(projectRoot);
  const index = await buildNativeDashboardIndex(root);
  if (!index) return null;
  let candidate: NativeDashboardCandidate | undefined;
  if (options.locator) {
    const parsed = parseDashboardChangeLocator(options.locator);
    if (!parsed || !parsed.identity.startsWith('native:')) return null;
    candidate = index.all.find(({ locator }) => locator === options.locator);
  } else {
    candidate = index.all.find(
      ({ entry, source }) =>
        entry.status === options.status &&
        entry.name === options.name &&
        (!options.archiveName || entry.archiveName === options.archiveName) &&
        source.workspace.current,
    );
    candidate ??= index.all.find(
      ({ entry }) =>
        entry.status === options.status &&
        entry.name === options.name &&
        (!options.archiveName || entry.archiveName === options.archiveName),
    );
  }
  if (!candidate) return null;
  const parent = [...index.active, ...index.archived].find(
    ({ locator }) => locator === candidate!.locator,
  );
  return collectNativeChange(candidate, parent?.children ?? []);
}

/** Return directory counts only; change YAML is loaded by the paged endpoint. */
export async function collectNativeDashboardOverview(
  projectRoot: string,
  options: { now?: Date } = {},
): Promise<NativeDashboardProjection | null> {
  const root = path.resolve(projectRoot);
  const index = await buildNativeDashboardIndex(root);
  if (!index) return null;
  const totalChangeCount = index.activeChangeCount + index.archivedChangeCount;
  return {
    schema: NATIVE_DASHBOARD_SCHEMA,
    generatedAt: (options.now ?? new Date()).toISOString(),
    totalChangeCount,
    activeChangeCount: index.activeChangeCount,
    archivedChangeCount: index.archivedChangeCount,
    visibleChangeCount: 0,
    omittedChangeCount: totalChangeCount,
    changesTruncated: totalChangeCount > 0,
    changes: [],
  };
}

/** Collect at most 32 Native details for the legacy all-in-one Dashboard API. */
export async function collectNativeDashboardProjection(
  projectRoot: string,
  options: { now?: Date } = {},
): Promise<NativeDashboardProjection | null> {
  const root = path.resolve(projectRoot);
  const index = await buildNativeDashboardIndex(root);
  if (!index) return null;
  const entries = [...index.active, ...index.archived];
  return adaptNativeDashboardProjection({
    generatedAt: (options.now ?? new Date()).toISOString(),
    changes: await Promise.all(
      entries
        .slice(0, NATIVE_DASHBOARD_LIMITS.maxChanges)
        .map((candidate) => collectNativeChange(candidate, candidate.children)),
    ),
    totalChangeCount: index.activeChangeCount + index.archivedChangeCount,
    activeChangeCount: index.activeChangeCount,
    archivedChangeCount: index.archivedChangeCount,
  });
}
