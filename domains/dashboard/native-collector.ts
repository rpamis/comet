import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readNativeTextFilePrefix } from '../comet-native/native-bounded-file.js';
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
import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';
import {
  adaptNativeDashboardChange,
  adaptNativeDashboardListItem,
  adaptNativeDashboardProjection,
  NATIVE_DASHBOARD_LIMITS,
  NATIVE_DASHBOARD_SCHEMA,
  type NativeDashboardArtifactPreview,
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

const ARCHIVE_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})-(.+)$/u;
const DEFAULT_NATIVE_CHANGE_PAGE_SIZE = 5;
const MAX_NATIVE_CHANGE_PAGE_SIZE = 50;
const NATIVE_DASHBOARD_CURSOR_PREFIX = 'native-dashboard-v2.';

interface NativeDashboardEntry {
  status: 'active' | 'archived';
  name: string;
  archiveName?: string;
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

function nativeDashboardEntryKey(entry: NativeDashboardEntry): string {
  return `${entry.status}:${entry.archiveName ?? entry.name}:${entry.name}`;
}

async function listNativeDashboardEntries(
  paths: NativeProjectPaths,
  status: DashboardChangeTab,
  query = '',
): Promise<{ entries: NativeDashboardEntry[]; query: string }> {
  const normalizedQuery = query.trim().toLowerCase();
  let candidates: NativeDashboardEntry[];
  if (status === 'active') {
    candidates = await listActiveNativeEntries(paths);
  } else if (status === 'archived') {
    candidates = await listArchivedNativeEntries(paths);
  } else {
    const [active, archived] = await Promise.all([
      listActiveNativeEntries(paths),
      listArchivedNativeEntries(paths),
    ]);
    candidates = [...active, ...archived];
  }
  return {
    entries: candidates.filter(
      (entry) => !normalizedQuery || entry.name.toLowerCase().includes(normalizedQuery),
    ),
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
  entries: readonly NativeDashboardEntry[];
}): number {
  if (!options.cursor) return 0;
  const cursor = parseNativeDashboardCursor(options.cursor);
  if (
    cursor.status !== options.status ||
    cursor.query !== options.query ||
    cursor.total !== options.entries.length ||
    cursor.offset <= 0 ||
    cursor.offset >= options.entries.length ||
    nativeDashboardEntryKey(options.entries[cursor.offset]) !== cursor.nextKey
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
  paths: NativeProjectPaths,
  entry: NativeDashboardEntry,
): Promise<NativeDashboardChangeListItem> {
  const common = {
    status: entry.status,
    ...(entry.archiveName ? { archiveName: entry.archiveName } : {}),
    archivedAt: archiveDate(entry),
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
  paths: NativeProjectPaths,
  entry: NativeDashboardEntry,
): Promise<NativeDashboardChangeProjection> {
  const common = {
    status: entry.status,
    ...(entry.archiveName ? { archiveName: entry.archiveName } : {}),
    archivedAt: archiveDate(entry),
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
  const config = await readWorkflowProjectConfig(root);
  if (!config?.native) return emptyPage;
  const paths = await nativeProjectPaths(root, config.native.artifact_root);
  const listed = await listNativeDashboardEntries(paths, options.status, options.query);
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
    items: await Promise.all(pageEntries.map((entry) => collectNativeChangeListItem(paths, entry))),
    total: listed.entries.length,
    nextCursor:
      nextOffset < listed.entries.length
        ? encodeNativeDashboardCursor({
            status: options.status,
            query: listed.query,
            offset: nextOffset,
            total: listed.entries.length,
            nextKey: nativeDashboardEntryKey(listed.entries[nextOffset]),
          })
        : null,
  };
}

export interface NativeDashboardChangeDetailOptions {
  status: 'active' | 'archived';
  name: string;
  archiveName?: string;
  now?: Date;
}

/** Read one selected YAML document, its formal Markdown, and a version-matched local overlay. */
export async function collectNativeDashboardChangeDetail(
  projectRoot: string,
  options: NativeDashboardChangeDetailOptions,
): Promise<NativeDashboardChangeProjection | null> {
  const root = path.resolve(projectRoot);
  const config = await readWorkflowProjectConfig(root);
  if (!config?.native) return null;
  const paths = await nativeProjectPaths(root, config.native.artifact_root);
  const entries =
    options.status === 'active'
      ? await listActiveNativeEntries(paths)
      : await listArchivedNativeEntries(paths);
  const entry = entries.find(
    (candidate) =>
      candidate.name === options.name &&
      (!options.archiveName || candidate.archiveName === options.archiveName),
  );
  return entry ? collectNativeChange(paths, entry) : null;
}

/** Return directory counts only; change YAML is loaded by the paged endpoint. */
export async function collectNativeDashboardOverview(
  projectRoot: string,
  options: { now?: Date } = {},
): Promise<NativeDashboardProjection | null> {
  const root = path.resolve(projectRoot);
  const config = await readWorkflowProjectConfig(root);
  if (!config?.native) return null;
  const paths = await nativeProjectPaths(root, config.native.artifact_root);
  const [active, archived] = await Promise.all([
    listActiveNativeEntries(paths),
    listArchivedNativeEntries(paths),
  ]);
  const totalChangeCount = active.length + archived.length;
  return {
    schema: NATIVE_DASHBOARD_SCHEMA,
    generatedAt: (options.now ?? new Date()).toISOString(),
    totalChangeCount,
    activeChangeCount: active.length,
    archivedChangeCount: archived.length,
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
  const config = await readWorkflowProjectConfig(root);
  if (!config?.native) return null;
  const paths = await nativeProjectPaths(root, config.native.artifact_root);
  const [active, archived] = await Promise.all([
    listActiveNativeEntries(paths),
    listArchivedNativeEntries(paths),
  ]);
  const entries = [...active, ...archived];
  return adaptNativeDashboardProjection({
    generatedAt: (options.now ?? new Date()).toISOString(),
    changes: await Promise.all(
      entries
        .slice(0, NATIVE_DASHBOARD_LIMITS.maxChanges)
        .map((entry) => collectNativeChange(paths, entry)),
    ),
    totalChangeCount: entries.length,
    activeChangeCount: active.length,
    archivedChangeCount: archived.length,
  });
}
