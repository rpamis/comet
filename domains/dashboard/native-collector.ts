import { promises as fs } from 'node:fs';
import { fingerprintDashboardFiles } from './source-version.js';
import path from 'node:path';
import os from 'node:os';
import {
  readNativeBoundedTextFile,
  readNativeTextFilePrefix,
} from '../comet-native/native-bounded-file.js';
import {
  NATIVE_CHILDREN_FILE,
  inspectNativeChildren,
  readNativeChildrenContract,
  type NativeChildStatusProjection,
} from '../comet-native/native-children.js';
import { NATIVE_CHANGE_STATE_FILE, readNativeChangeFile } from '../comet-native/native-change.js';
import { nativeProjectPaths, resolveContainedNativePath } from '../comet-native/native-paths.js';
import { readNativePortableState } from '../comet-native/native-portable-state.js';
import { projectNativeSdkAcceptanceEvidence } from '../comet-native/native-sdk-acceptance-evidence.js';
import {
  isNativeSdkChangeCancellationComplete,
  nativeSdkChangeCancellationPaths,
} from '../comet-native/native-sdk-cancellation.js';
import type { NativePortableState } from '../comet-native/native-portable-types.js';
import type { NativeChangeState, NativeProjectPaths } from '../comet-native/native-types.js';
import { projectNativeWorkspace } from '../comet-native/native-workspace.js';
import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';
import { withoutProtectedProjectReadScope } from '../workflow-contract/protected-project-path.js';
import { runWithoutHookReadCache } from '../../platform/process/hook-read-cache.js';
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
import { nativeSupervisorStateFile } from '../comet-native/native-supervisor-state.js';
import {
  adaptNativeDashboardSdkChild,
  nativeDashboardSdkAttention,
  readNativeDashboardSdkProjection,
  type NativeDashboardSdkChild,
  type NativeDashboardSdkProjection,
} from './native-sdk-projection.js';
import type { WorkflowAttentionItem, WorkflowAttentionState } from './workflow-attention.js';
import {
  collectDashboardWorkspaceSources,
  withDashboardReadScope,
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
const NATIVE_INDEX_REFRESH_INTERVAL_MS = 30000;
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
  | {
      kind: 'portable';
      state: NativePortableState;
    }
  | {
      kind: 'legacy';
      state: NativeChangeState;
    }
  | {
      kind: 'invalid';
      message: string;
    };
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
    const artifact = await readNativeBoundedTextFile({
      root,
      ref,
      maxBytes: null,
      includeHash: false,
    });
    return {
      ...missing,
      exists: true,
      content: artifact.text,
      truncated: false,
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
  const descriptors = artifactDescriptors(state);
  if (state.archived && state.spec_changes.length === 0) {
    descriptors.push(['parent-spec', 'Parent Spec 快照', 'spec.md']);
    descriptors.push(['archive-source', '归档材料来源', 'archive-source.md']);
  }
  return Promise.all(descriptors.map((descriptor) => readArtifactPreview(changeDir, descriptor)));
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
// Bump when the rebuild starts reading new facts or filtering candidates
// differently. A stored index from another revision is rebuilt on the next read,
// because its refreshPaths cannot notice the facts it never tracked.
const NATIVE_DASHBOARD_INDEX_REVISION = 5;
interface NativeDashboardIndex {
  revision?: number;
  runtimeDataRoot?: string;
  refreshPaths?: string[];
  fingerprint?: string | null;
  unavailable: boolean;
  active: NativeDashboardRootCandidate[];
  archived: NativeDashboardRootCandidate[];
  all: NativeDashboardCandidate[];
  activeChangeCount: number;
  archivedChangeCount: number;
}
function nativeDashboardRuntimeDataRoot(): string {
  return process.env.COMET_DATA_DIR ?? path.join(os.homedir(), '.comet');
}
async function discoverNativeDashboardSources(
  projectRoot: string,
  workspaces = collectDashboardWorkspaceSources(projectRoot),
) {
  const sources: NativeDashboardSource[] = [];
  let unavailable = false;
  for (const workspace of workspaces) {
    try {
      const config = await readWorkflowProjectConfig(workspace.projectRoot);
      if (!config?.native) continue;
      sources.push({
        workspace,
        paths: await nativeProjectPaths(workspace.projectRoot, config.native.artifact_root, {
          readOnly: true,
        }),
      });
    } catch (error) {
      unavailable = true;
      console.warn(
        `[dashboard] skipping Native workspace "${workspace.label}": ${(error as Error).message ?? error}`,
      );
    }
  }
  return { sources, unavailable };
}
async function rawNativeDashboardCandidates(sources: readonly NativeDashboardSource[]): Promise<{
  active: NativeDashboardCandidate[];
  archived: NativeDashboardCandidate[];
  unavailable: boolean;
}> {
  let unavailable = false;
  const collections = await Promise.all(
    sources.map(async (source) => {
      const [active, archived] = await Promise.allSettled([
        listActiveNativeEntries(source.paths),
        listArchivedNativeEntries(source.paths),
      ]);
      const adapt = (
        status: 'active' | 'archived',
        result: PromiseSettledResult<NativeDashboardEntry[]>,
      ): NativeDashboardCandidate[] => {
        if (result.status === 'fulfilled')
          return result.value.map((entry) => ({
            source,
            entry,
            locator: nativeDashboardCandidateLocator(source, entry),
          }));
        unavailable = true;
        console.warn(
          `[dashboard] cannot list ${status} Native changes in "${source.workspace.label}": ${result.reason}`,
        );
        return [];
      };
      return { active: adapt('active', active), archived: adapt('archived', archived) };
    }),
  );
  return {
    active: collections.flatMap(({ active }) => active),
    archived: collections.flatMap(({ archived }) => archived),
    unavailable,
  };
}
/** 与 `comet native status` 一致：取消已完成的 change 以 SDK Run 为准离开活跃列表；读取失败时保留。 */
async function withoutCancelledNativeCandidates(
  candidates: readonly NativeDashboardCandidate[],
): Promise<NativeDashboardCandidate[]> {
  const cancelled = await Promise.all(
    candidates.map((candidate) =>
      isNativeSdkChangeCancellationComplete(
        candidate.source.workspace.projectRoot,
        candidate.entry.name,
      ).catch(() => false),
    ),
  );
  return candidates.filter((_, index) => !cancelled[index]);
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
  candidate: NativeDashboardCandidate | null,
): NativeDashboardChildSummary {
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

const SDK_CHILD_LOCATOR_PREFIX = 'native:supervisor-child:';

function sdkChildSummary(
  parent: NativeDashboardCandidate,
  sdk: NativeDashboardSdkProjection,
  child: NativeDashboardSdkChild,
  candidates: readonly NativeDashboardCandidate[],
  planned = false,
): NativeDashboardChildSummary {
  const candidate = child.archiveName
    ? (candidates.find(
        ({ entry }) => entry.archiveName === child.archiveName && entry.name === child.name,
      ) ?? null)
    : (candidates.find(
        ({ entry, source }) =>
          entry.status === 'active' &&
          entry.name === child.name &&
          child.projectRoot !== null &&
          sameDashboardPath(source.workspace.projectRoot, child.projectRoot),
      ) ?? null);
  const summary = childSummary(child, candidate);
  if (!planned && (candidate || (child.status !== 'active' && child.status !== 'blocked')))
    return summary;
  if (planned && child.status === 'integrated') return summary;
  const parentWorkspace = parent.source.workspace;
  const childWorkspace = child.projectRoot
    ? collectDashboardWorkspaceSources(parentWorkspace.projectRoot).find(({ projectRoot }) =>
        sameDashboardPath(projectRoot, child.projectRoot!),
      )
    : undefined;
  return {
    ...summary,
    locator: encodeDashboardChangeLocator(
      parentWorkspace.id,
      `${SDK_CHILD_LOCATOR_PREFIX}${parent.entry.name}:${child.name}:${sdk.state.children_contract_ref}${planned ? ':planned' : ''}`,
    ),
    changeStatus: 'active',
    workspace: dashboardWorkspaceIdentity(childWorkspace ?? parentWorkspace),
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
    const { changeDir, read, sdk } = await readEntryState(candidate.source.paths, candidate.entry);
    if (sdk) return sdk.children.map((child) => sdkChildSummary(candidate, sdk, child, candidates));
    if (read.kind !== 'portable') return [];
    const document = read.state.children_contract
      ? { contract: read.state.children_contract, drift: null }
      : await readNativeChildrenContract({
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
        return inspection.children.map((child) =>
          childSummary(child, matchingChildCandidate(child, candidates)),
        );
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
          childCandidate,
        );
      }),
    );
  } catch {
    return [];
  }
}

async function childArchiveOrigin(candidate: NativeDashboardCandidate) {
  const source = await readNativeTextFilePrefix({
    root: entryDirectory(candidate.source.paths, candidate.entry),
    ref: 'archive-source.md',
    maxBytes: 1024,
  }).catch(() => null);
  // The Runtime writes provenance before the copied Parent materials in every SDK child archive.
  const header = source?.text.split(/\r?\n/u, 6);
  const parentRun = header?.[2]?.match(/^- Parent Run: (.+)$/u)?.[1];
  const contractRef = header?.[4]?.match(/^- Contract: (.+)$/u)?.[1];
  return parentRun && contractRef && header?.[3]?.startsWith(`- Archive Action: ${parentRun}:`)
    ? { parentRun, contractRef, candidate }
    : null;
}

async function archivedParentChildren(
  candidate: NativeDashboardCandidate,
  candidates: readonly NativeDashboardCandidate[],
  archiveOrigins: Map<string, ReturnType<typeof childArchiveOrigin>>,
): Promise<{ children: NativeDashboardChildSummary[]; ownedLocators: string[] }> {
  const empty = { children: [], ownedLocators: [] };
  try {
    if (!(await hasNativeChildrenContract(candidate))) return empty;
    const { changeDir, read } = await readEntryState(candidate.source.paths, candidate.entry);
    if (
      read.kind !== 'portable' ||
      !matchesEntry(candidate.entry, read.state) ||
      !read.state.children_contract_ref
    )
      return empty;
    const { state } = read;
    const contract =
      state.children_contract ??
      (
        await readNativeChildrenContract({
          changeDir,
          policy: 'advisory',
          acceptanceIds: state.acceptance.map(({ id }) => id),
          validation: { acceptanceCatalog: state.acceptance },
        })
      )?.contract;
    if (!contract) return empty;
    const names = new Set(contract.children.map(({ name }) => name));
    const snapshots = candidates.filter(({ entry }) => names.has(entry.name));
    const origins = await Promise.all(
      snapshots.map((snapshot) => {
        let origin = archiveOrigins.get(snapshot.locator);
        if (!origin) {
          origin = childArchiveOrigin(snapshot);
          archiveOrigins.set(snapshot.locator, origin);
        }
        return origin;
      }),
    );
    const owned = origins
      .filter((origin) => origin !== null)
      .filter(({ parentRun }) => parentRun === state.name)
      .sort((left, right) =>
        right.candidate.entry.archiveName!.localeCompare(left.candidate.entry.archiveName!),
      );
    const children = contract.children.map((child) => {
      const progress: NativeChildStatusProjection = {
        name: child.name,
        summary: child.summary,
        dependsOn: child.depends_on,
        covers: child.covers,
        status: 'done',
        phase: 'archive',
        projectRoot: null,
        message: null,
      };
      const current = owned.find(
        ({ candidate: snapshot, contractRef }) =>
          snapshot.entry.name === child.name && contractRef === state.children_contract_ref,
      );
      const target =
        current?.candidate ??
        (contract.schema === 'comet.native.children.v1'
          ? matchingChildCandidate(progress, snapshots)
          : null);
      return childSummary(progress, target);
    });
    return { children, ownedLocators: owned.map(({ candidate: snapshot }) => snapshot.locator) };
  } catch {
    return empty;
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
  const workspaces = new Map(
    [...index.active, ...index.archived, ...index.all].map(({ source }) => [
      `${source.workspace.projectRoot}\0${source.workspace.branch}\0${source.workspace.current}`,
      source.workspace,
    ]),
  );
  return [...workspaces.values()].some(
    (workspace) => !isDashboardWorkspaceSourceEligible(projectRoot, workspace),
  );
}
function nativeDashboardIndexFingerprint(
  files: readonly string[],
  workspaces: readonly DashboardWorkspaceSource[],
): Promise<string | null> {
  return fingerprintDashboardFiles(
    files,
    JSON.stringify(workspaces.map(({ id, branch, current }) => [id, branch, current])),
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
  limit: number,
  offset: number,
): Promise<{
  entries: NativeDashboardRootCandidate[];
  query: string;
  total: number;
} | null> {
  const store = new DashboardIndexStore({ projectRoot });
  try {
    await store.open();
    const result = await store.queryNativeIndex<NativeDashboardRootCandidate>({
      status,
      query,
      limit,
      offset,
    });
    if (!result.indexed) return null;
    return { entries: result.rows, query: query?.trim().toLowerCase() ?? '', total: result.total };
  } catch {
    return null;
  } finally {
    await store.close();
  }
}
async function rebuildNativeDashboardIndex(
  projectRoot: string,
): Promise<NativeDashboardIndex | null> {
  const workspaces = collectDashboardWorkspaceSources(projectRoot);
  const discovery = await discoverNativeDashboardSources(projectRoot, workspaces);
  const { sources } = discovery;
  if (sources.length === 0 && !discovery.unavailable) return null;
  const discoveryPaths = [
    ...new Set([
      nativeDashboardRuntimeDataRoot(),
      ...workspaces.map(({ projectRoot: root }) => path.join(root, '.comet', 'config.yaml')),
      ...sources.flatMap(({ paths }) => [
        paths.projectRoot,
        paths.artifactRoot,
        paths.nativeRoot,
        paths.changesDir,
        paths.archiveDir,
      ]),
    ]),
  ].sort();
  const discoveryBefore = await nativeDashboardIndexFingerprint(discoveryPaths, workspaces);
  const raw = await rawNativeDashboardCandidates(sources);
  // Archived entries are immutable history. Their container detects additions,
  // removals and renames; only active candidates need per-file change tracking.
  // A cancellation can complete through SDK Run records alone (the change's Run,
  // the child Runs it waits for, or the current selection), so those are tracked
  // too, and the fingerprint is taken before the cancellation check so a change
  // during the rebuild leaves the index stale.
  const cancellationPaths = await Promise.all(
    raw.active.map(({ source, entry }) =>
      nativeSdkChangeCancellationPaths(source.workspace.projectRoot, entry.name),
    ),
  );
  const refreshPaths = [
    ...new Set([
      ...discoveryPaths,
      ...raw.active.flatMap(({ source, entry }, index) => [
        path.join(entryDirectory(source.paths, entry), NATIVE_CHANGE_STATE_FILE),
        path.join(entryDirectory(source.paths, entry), NATIVE_CHILDREN_FILE),
        nativeSupervisorStateFile(source.paths, entry.name),
        ...cancellationPaths[index],
      ]),
    ]),
  ].sort();
  const before = await nativeDashboardIndexFingerprint(refreshPaths, workspaces);
  raw.active = await withoutCancelledNativeCandidates(raw.active);
  const active = await selectActiveNativeCandidates(raw.active);
  const archived = selectArchivedNativeCandidates(raw.archived);
  const archiveLocators = new Set(archived.map(({ locator }) => locator));
  const selected = [...active, ...archived];
  const all = [...selected, ...raw.archived.filter(({ locator }) => !archiveLocators.has(locator))];
  const archivesByWorkspace = new Map<string, NativeDashboardCandidate[]>();
  for (const candidate of raw.archived) {
    const id = candidate.source.workspace.id;
    const entries = archivesByWorkspace.get(id) ?? [];
    entries.push(candidate);
    archivesByWorkspace.set(id, entries);
  }
  const archiveOrigins = new Map<string, ReturnType<typeof childArchiveOrigin>>();
  const [activeChildren, archivedParents] = await Promise.all([
    Promise.all(active.map((candidate) => activeParentChildren(candidate, selected))),
    Promise.all(
      raw.archived.map(
        async (candidate) =>
          [
            candidate.locator,
            await archivedParentChildren(
              candidate,
              archivesByWorkspace.get(candidate.source.workspace.id) ?? [],
              archiveOrigins,
            ),
          ] as const,
      ),
    ),
  ]);
  const archivedChildren = new Map(archivedParents);
  const suppressed = new Set([
    ...archivedParents.flatMap(([, { ownedLocators }]) => ownedLocators),
    ...[...activeChildren, ...archivedParents.map(([, { children }]) => children)].flatMap(
      (children) => children.flatMap(({ locator }) => (locator ? [locator] : [])),
    ),
  ]);
  const rootActive = active
    .map((candidate, index) => ({ ...candidate, children: activeChildren[index] }))
    .filter(({ locator }) => !suppressed.has(locator));
  // Group child archives before choosing a root for a shared dated name.
  const rootArchived = selectArchivedNativeCandidates(
    raw.archived.filter(({ locator }) => !suppressed.has(locator)),
  ).map((candidate) => ({
    ...candidate,
    children: archivedChildren.get(candidate.locator)?.children ?? [],
  }));
  const after = await nativeDashboardIndexFingerprint(refreshPaths, workspaces);
  const discoveryAfter = await nativeDashboardIndexFingerprint(discoveryPaths, workspaces);
  const unavailable = raw.unavailable || discovery.unavailable;
  return {
    revision: NATIVE_DASHBOARD_INDEX_REVISION,
    runtimeDataRoot: nativeDashboardRuntimeDataRoot(),
    refreshPaths,
    fingerprint:
      !unavailable && before === after && discoveryBefore === discoveryAfter ? after : null,
    unavailable,
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
  // The rebuild outlives the request that scheduled it, so it reads with its
  // own sessions and cache instead of the request's, which close when it ends.
  nativeIndexReconciler.schedule(key, () =>
    withoutProtectedProjectReadScope(() =>
      runWithoutHookReadCache(() => reconcileNativeDashboardIndex(root)),
    ),
  );
}
async function buildNativeDashboardIndex(
  projectRoot: string,
  options: {
    refreshIfChanged?: boolean;
  } = {},
): Promise<NativeDashboardIndex | null> {
  const root = path.resolve(projectRoot);
  const cached = await readCachedNativeDashboardIndex(root);
  if (cached) {
    if (cached.revision !== NATIVE_DASHBOARD_INDEX_REVISION)
      return refreshNativeDashboardIndex(root);
    if (cached.runtimeDataRoot !== nativeDashboardRuntimeDataRoot())
      return refreshNativeDashboardIndex(root);
    if (hasInvalidCachedNativeSource(cached, root)) return refreshNativeDashboardIndex(root);
    if (
      !cached.refreshPaths ||
      !cached.fingerprint ||
      (await nativeDashboardIndexFingerprint(
        cached.refreshPaths,
        collectDashboardWorkspaceSources(root),
      )) !== cached.fingerprint
    ) {
      if (options.refreshIfChanged) return refreshNativeDashboardIndex(root);
      scheduleNativeDashboardRefresh(root);
    }
    return cached;
  }
  return refreshNativeDashboardIndex(root);
}
function listNativeDashboardEntries(
  index: NativeDashboardIndex,
  status: DashboardChangeTab,
  query = '',
): {
  entries: NativeDashboardRootCandidate[];
  query: string;
} {
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
  total: number;
  entriesOffset: number;
}): number {
  if (!options.cursor) return 0;
  const cursor = parseNativeDashboardCursor(options.cursor);
  if (
    cursor.status !== options.status ||
    cursor.query !== options.query ||
    cursor.total !== options.total ||
    cursor.offset <= 0 ||
    cursor.offset >= options.total ||
    !options.entries[cursor.offset - options.entriesOffset] ||
    nativeDashboardCandidateKey(options.entries[cursor.offset - options.entriesOffset]) !==
      cursor.nextKey
  ) {
    throw new NativeDashboardQueryError('Stale Native Dashboard change cursor');
  }
  return cursor.offset;
}
async function readEntryState(
  paths: NativeProjectPaths,
  entry: NativeDashboardEntry,
): Promise<{
  changeDir: string;
  read: NativeDashboardStateRead;
  sdk?: NativeDashboardSdkProjection;
}> {
  const changeDir = entryDirectory(paths, entry);
  await resolveContainedNativePath(paths.nativeRoot, changeDir);
  // 归档有独立的最终快照，同名活跃 Run 和本机 Runtime 不能覆盖历史记录。
  const sdk =
    entry.status === 'active'
      ? await readNativeDashboardSdkProjection(paths.projectRoot, entry.name)
      : null;
  if (sdk) return { changeDir, read: { kind: 'portable', state: sdk.state }, sdk };
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
  candidates: readonly NativeDashboardCandidate[] = [],
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
    const { read, sdk } = await readEntryState(paths, entry);
    if (sdk)
      common.children = sdk.children.map((child) =>
        sdkChildSummary(candidate, sdk, child, candidates),
      );
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
    if (sdk)
      return adaptNativeDashboardListItem({
        state: read.state,
        ...common,
        localExecutionSummary: sdk.localExecution,
      });
    return adaptNativeDashboardListItem({
      state: read.state,
      ...common,
    });
  } catch (error) {
    return invalidNativeDashboardListItem({
      name: entry.name,
      ...common,
      children: [],
      message: error instanceof Error ? error.message : 'Native state is unreadable.',
    });
  }
}
async function collectNativeChange(
  candidate: NativeDashboardCandidate,
  children: NativeDashboardChildSummary[] = [],
  candidates: readonly NativeDashboardCandidate[] = [],
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
    const { changeDir, read, sdk } = await readEntryState(paths, entry);
    if (sdk)
      common.children = sdk.children.map((child) =>
        sdkChildSummary(candidate, sdk, child, candidates),
      );
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
    if (sdk)
      return {
        ...adaptNativeDashboardChange({
          state: read.state,
          ...common,
          artifacts,
          localExecutionSummary: sdk.localExecution,
        }),
        acceptanceEvidence: projectNativeSdkAcceptanceEvidence(
          sdk.run,
          sdk.state,
          paths.projectRoot,
        ),
      };
    return adaptNativeDashboardChange({
      state: read.state,
      ...common,
      artifacts,
    });
  } catch (error) {
    return invalidNativeDashboardChange({
      name: entry.name,
      ...common,
      children: [],
      message: error instanceof Error ? error.message : 'Native state is unreadable.',
    });
  }
}

export async function collectNativeDashboardWorkflowAttention(
  projectRoot: string,
): Promise<{ items: WorkflowAttentionItem[]; unavailable: boolean }> {
  const index = await buildNativeDashboardIndex(projectRoot, { refreshIfChanged: true });
  if (!index) return { items: [], unavailable: false };
  const rows = await Promise.all(
    index.active.map(async (candidate): Promise<WorkflowAttentionItem[]> => {
      const { source, entry, locator } = candidate;
      const item = {
        workflow: 'native' as const,
        name: entry.name,
        locator,
        workspace: dashboardWorkspaceIdentity(source.workspace),
      };
      try {
        const { read, sdk } = await readEntryState(source.paths, entry);
        if (read.kind === 'invalid' || !matchesEntry(entry, read.state))
          return [{ ...item, runId: null, status: 'unknown-outcome', reason: 'unknown' }];
        if (!sdk) {
          const status = read.kind === 'portable' ? read.state.status : null;
          if (status === 'done' || read.state.archived) return [];
          const attention: WorkflowAttentionState = ['fail', 'blocked'].includes(
            read.state.verification_result,
          )
            ? { status: 'verification-blocker', reason: 'verification' }
            : status === 'await-user'
              ? { status: 'awaiting-user', reason: 'decision' }
              : { status: 'unknown-outcome', reason: 'unknown' };
          return [{ ...item, runId: null, ...attention }];
        }
        const runId = sdk.run.runId;
        if (['completed', 'cancelled'].includes(sdk.run.status) || sdk.state.archived) return [];
        const focus = nativeDashboardSdkAttention(sdk);
        const children = sdk.children.flatMap((child): WorkflowAttentionItem[] => {
          if (!child.attention) return [];
          const current = sdkChildSummary(candidate, sdk, child, index.all);
          const identity =
            current.locator && parseDashboardChangeLocator(current.locator)?.identity;
          const summary =
            identity && identity.startsWith(SDK_CHILD_LOCATOR_PREFIX)
              ? current
              : sdkChildSummary(candidate, sdk, child, index.all, true);
          if (!summary.locator || !summary.workspace) return [];
          return [
            {
              ...item,
              ...child.attention,
              runId,
              name: child.name,
              locator: summary.locator,
              workspace: summary.workspace,
              supervisorParent: sdk.state.name,
              hasEvidence: child.covers.length > 0,
            },
          ];
        });
        return focus
          ? [
              { ...item, ...focus, runId, hasEvidence: sdk.state.acceptance.length > 0 },
              ...children,
            ]
          : children;
      } catch {
        return [{ ...item, runId: null, status: 'unknown-outcome', reason: 'unknown' }];
      }
    }),
  );
  return { items: rows.flat(), unavailable: index.unavailable };
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
  return withDashboardReadScope(projectRoot, () =>
    collectNativeDashboardChangePageUncached(projectRoot, options),
  );
}
async function collectNativeDashboardChangePageUncached(
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
  const limit = nativeDashboardPageLimit(options.limit);
  const requestedOffset = options.cursor ? parseNativeDashboardCursor(options.cursor).offset : 0;
  const index = await buildNativeDashboardIndex(root, {
    refreshIfChanged: Boolean(options.cursor),
  });
  if (!index) return emptyPage;
  const cached = await readCachedNativeDashboardEntries(
    root,
    options.status,
    options.query,
    limit + 1,
    requestedOffset,
  );
  const listed = cached ?? listNativeDashboardEntries(index, options.status, options.query);
  const total = cached?.total ?? listed.entries.length;
  const entriesOffset = cached ? requestedOffset : 0;
  const offset = nativeDashboardOffset({
    cursor: options.cursor,
    status: options.status,
    query: listed.query,
    entries: listed.entries,
    total,
    entriesOffset,
  });
  const pageEntries = listed.entries.slice(offset - entriesOffset, offset - entriesOffset + limit);
  const nextOffset = offset + pageEntries.length;
  return {
    status: options.status,
    items: await Promise.all(
      pageEntries.map((candidate) =>
        collectNativeChangeListItem(candidate, candidate.children, index.all),
      ),
    ),
    total,
    nextCursor:
      nextOffset < total
        ? encodeNativeDashboardCursor({
            status: options.status,
            query: listed.query,
            offset: nextOffset,
            total,
            nextKey: nativeDashboardCandidateKey(listed.entries[nextOffset - entriesOffset]),
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
  return withDashboardReadScope(projectRoot, () =>
    collectNativeDashboardChangeDetailUncached(projectRoot, options),
  );
}
async function collectNativeDashboardChangeDetailUncached(
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
    if (parsed.identity.startsWith(SDK_CHILD_LOCATOR_PREFIX)) {
      if (options.status !== 'active') return null;
      const [parentName, childName] = parsed.identity
        .slice(SDK_CHILD_LOCATOR_PREFIX.length)
        .split(':');
      const parent = index.active.find(
        ({ entry, source }) =>
          entry.name === parentName && source.workspace.id === parsed.workspaceId,
      );
      if (!parent) return null;
      const sdk = await readNativeDashboardSdkProjection(
        parent.source.paths.projectRoot,
        parentName,
      ).catch(() => null);
      const child = sdk?.children.find(({ name }) => name === childName);
      if (!sdk || !child) return null;
      const planned = parsed.identity.endsWith(':planned');
      const summary = sdkChildSummary(parent, sdk, child, index.all, planned);
      return summary.locator === options.locator
        ? adaptNativeDashboardSdkChild(sdk, child, summary, parent.source.paths.projectRoot)
        : null;
    }
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
  return collectNativeChange(candidate, parent?.children ?? [], index.all);
}
/** Return directory counts only; change YAML is loaded by the paged endpoint. */
export async function collectNativeDashboardOverview(
  projectRoot: string,
  options: {
    now?: Date;
  } = {},
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
  options: {
    now?: Date;
  } = {},
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
        .map((candidate) => collectNativeChange(candidate, candidate.children, index.all)),
    ),
    totalChangeCount: index.activeChangeCount + index.archivedChangeCount,
    activeChangeCount: index.activeChangeCount,
    archivedChangeCount: index.archivedChangeCount,
  });
}
