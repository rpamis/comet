import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readNativeBoundedTextFile } from '../comet-native/native-bounded-file.js';
import {
  NATIVE_CHANGE_STATE_FILE,
  readNativeChange,
  readNativeChangeFile,
} from '../comet-native/native-change.js';
import { inspectNativeArchivePreflight } from '../comet-native/native-archive-inspection.js';
import { inspectNativeConflictRadar } from '../comet-native/native-conflict-inspection.js';
import { collectNativeContractFiles } from '../comet-native/native-contract-files.js';
import { inspectNativeStatus, listNativeStatusPage } from '../comet-native/native-diagnostics.js';
import { canonicalHash } from '../comet-native/native-canonical-hash.js';
import {
  readArchivedNativeVerificationAcceptanceCounts,
  readNativeImplementationScope,
  readNativeVerificationEvidence,
} from '../comet-native/native-evidence-storage.js';
import { nativeProjectPaths, resolveContainedNativePath } from '../comet-native/native-paths.js';
import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';
import type {
  NativeChangeState,
  NativeClarificationMode,
  NativeProjectPaths,
} from '../comet-native/native-types.js';
import {
  adaptNativeDashboardProjection,
  NATIVE_DASHBOARD_LIMITS,
  type NativeDashboardArtifactPreview,
  type NativeDashboardAcceptanceSummary,
  type NativeDashboardChangeProjection,
  type NativeDashboardChangeListItem,
  type NativeDashboardConflictSummary,
  type NativeDashboardImplementationSummary,
  type NativeDashboardSpecSummary,
  type NativeDashboardProjection,
} from './native-adapter.js';
import type { DashboardChangeTab, NativeDashboardChangePage } from './types.js';

const ARCHIVE_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})-(.+)$/u;
const DEFAULT_NATIVE_CHANGE_PAGE_SIZE = 5;
const MAX_NATIVE_CHANGE_PAGE_SIZE = 50;
const NATIVE_DASHBOARD_CURSOR_PATTERN =
  /^native-dashboard-v1\.([a-f0-9]{64})\.([0-9a-z]+)\.([a-f0-9]{64})$/u;

interface NativeDashboardEntry {
  status: 'active' | 'archived';
  name: string;
  archiveName?: string;
}

export class NativeDashboardQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NativeDashboardQueryError';
  }
}

function artifactDescriptors(state: NativeChangeState): Array<[string, string, string]> {
  const descriptors: Array<[string, string, string]> = [['brief', '需求简报', state.brief]];
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
  const preview: NativeDashboardArtifactPreview = {
    key,
    label,
    path: ref,
    exists: false,
  };
  try {
    const artifact = await readNativeBoundedTextFile({ root, ref });
    const bytes = Buffer.from(artifact.text, 'utf8');
    const truncated = bytes.length > NATIVE_DASHBOARD_LIMITS.maxArtifactPreviewBytes;
    return {
      ...preview,
      exists: true,
      content: truncated
        ? bytes.subarray(0, NATIVE_DASHBOARD_LIMITS.maxArtifactPreviewBytes).toString('utf8')
        : artifact.text,
      truncated,
      size: artifact.size,
    };
  } catch {
    return preview;
  }
}

async function collectArtifacts(
  changeDir: string,
  state: NativeChangeState,
): Promise<NativeDashboardArtifactPreview[]> {
  return Promise.all(
    artifactDescriptors(state).map((descriptor) => readArtifactPreview(changeDir, descriptor)),
  );
}

function specSummary(state: NativeChangeState): NativeDashboardSpecSummary {
  const capabilities = [...state.spec_changes]
    .sort((left, right) => left.capability.localeCompare(right.capability))
    .slice(0, NATIVE_DASHBOARD_LIMITS.maxCapabilities)
    .map(({ capability, operation }) => ({ capability, operation }));
  return {
    total: state.spec_changes.length,
    create: state.spec_changes.filter(({ operation }) => operation === 'create').length,
    replace: state.spec_changes.filter(({ operation }) => operation === 'replace').length,
    remove: state.spec_changes.filter(({ operation }) => operation === 'remove').length,
    capabilities,
    capabilitiesTruncated: state.spec_changes.length > capabilities.length,
  };
}

async function acceptanceSummary(
  paths: NativeProjectPaths,
  changeDir: string,
  state: NativeChangeState,
  includeRuntimeEvidence: boolean,
): Promise<NativeDashboardAcceptanceSummary | null> {
  try {
    const contract = await collectNativeContractFiles({
      changeDir,
      briefRef: state.brief,
      specChanges: state.spec_changes,
    });
    const total = contract.contract.acceptance.length;
    if (!includeRuntimeEvidence || !state.verification_evidence) {
      return { total, evidenced: 0, skipped: 0, missing: total };
    }
    if (state.archived) {
      const counts = await readArchivedNativeVerificationAcceptanceCounts(
        paths,
        state.name,
        state.verification_evidence,
        changeDir,
      );
      return {
        ...counts,
        missing: Math.max(0, counts.total - counts.evidenced - counts.skipped),
      };
    }
    const evidence = await readNativeVerificationEvidence(
      paths,
      state.name,
      state.verification_evidence,
      undefined,
      changeDir,
    );
    return {
      total: evidence.acceptanceTrace.total,
      evidenced: evidence.acceptanceTrace.evidenced,
      skipped: evidence.acceptanceTrace.skipped,
      missing: Math.max(
        0,
        evidence.acceptanceTrace.total -
          evidence.acceptanceTrace.evidenced -
          evidence.acceptanceTrace.skipped,
      ),
    };
  } catch {
    return null;
  }
}

async function implementationSummary(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeDashboardImplementationSummary | null> {
  if (!state.implementation_scope) return null;
  try {
    const scope = await readNativeImplementationScope(
      paths,
      state.name,
      state.implementation_scope,
    );
    return {
      complete: scope.complete,
      declaredArtifactCount: scope.declaredArtifacts.length,
      changeCount: scope.changes.length,
      unattributedCount: scope.unattributed.length,
      unresolvedCount: scope.unresolvedScopes.length,
    };
  } catch {
    return null;
  }
}

async function collectChangeFacts(
  paths: NativeProjectPaths,
  changeDir: string,
  state: NativeChangeState,
  includeRuntimeEvidence: boolean,
): Promise<
  Pick<
    NativeDashboardChangeProjection,
    'artifacts' | 'specs' | 'acceptance' | 'implementation' | 'approval'
  > & { createdAt: string }
> {
  const [artifacts, acceptance, implementation] = await Promise.all([
    collectArtifacts(changeDir, state),
    acceptanceSummary(paths, changeDir, state, includeRuntimeEvidence),
    includeRuntimeEvidence ? implementationSummary(paths, state) : Promise.resolve(null),
  ]);
  return {
    artifacts,
    specs: specSummary(state),
    acceptance,
    implementation,
    approval: state.approval,
    createdAt: state.created_at,
  };
}

async function listActiveNativeEntries(paths: NativeProjectPaths): Promise<NativeDashboardEntry[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(paths.changesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({ status: 'active' as const, name: entry.name }));
}

async function listArchivedNativeEntries(
  paths: NativeProjectPaths,
): Promise<NativeDashboardEntry[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(paths.archiveDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const archived: NativeDashboardEntry[] = [];
  for (const entry of entries.sort((left, right) => right.name.localeCompare(left.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const match = ARCHIVE_NAME_PATTERN.exec(entry.name);
    if (!match) continue;
    archived.push({ status: 'archived', name: match[2], archiveName: entry.name });
  }
  return archived;
}

function nativeListVerificationFreshness(
  result: NativeChangeState['verification_result'],
  archived: boolean,
): NativeDashboardChangeListItem['verificationFreshness'] {
  if (result === 'fail') return 'invalid';
  if (result === 'pass') return archived ? 'complete' : 'unknown';
  return 'missing';
}

async function collectNativeChangeListItem(
  paths: NativeProjectPaths,
  entry: NativeDashboardEntry,
): Promise<NativeDashboardChangeListItem> {
  const archivedAt = entry.archiveName ? ARCHIVE_NAME_PATTERN.exec(entry.archiveName)?.[1] : null;
  try {
    const state =
      entry.status === 'active'
        ? await readNativeChange(paths, entry.name)
        : await readNativeChangeFile(
            path.join(paths.archiveDir, entry.archiveName ?? '', NATIVE_CHANGE_STATE_FILE),
          );
    if (state.name !== entry.name || state.archived !== (entry.status === 'archived')) {
      throw new Error('Native change state does not match its Dashboard entry');
    }
    return {
      workflow: 'native',
      name: entry.name,
      status: entry.status,
      ...(entry.archiveName ? { archiveName: entry.archiveName } : {}),
      archivedAt: archivedAt ?? null,
      phase: entry.status === 'archived' ? 'archive' : state.phase,
      revision: state.revision,
      verificationResult: state.verification_result,
      verificationFreshness: nativeListVerificationFreshness(
        state.verification_result,
        entry.status === 'archived',
      ),
    };
  } catch {
    return {
      workflow: 'native',
      name: entry.name,
      status: entry.status,
      ...(entry.archiveName ? { archiveName: entry.archiveName } : {}),
      archivedAt: archivedAt ?? null,
      phase: entry.status === 'archived' ? 'archive' : 'invalid',
      revision: null,
      verificationResult: 'pending',
      verificationFreshness: 'invalid',
    };
  }
}

function nativeDashboardEntryKey(entry: NativeDashboardEntry): string {
  return `${entry.status}:${entry.archiveName ?? entry.name}:${entry.name}`;
}

function nativeDashboardEntriesHash(
  status: DashboardChangeTab,
  query: string,
  entries: readonly NativeDashboardEntry[],
): string {
  return canonicalHash('comet.dashboard.native-page-names.v1', {
    status,
    query,
    entries: entries.map(nativeDashboardEntryKey),
  });
}

function nativeDashboardCursor(hash: string, offset: number): string {
  const encodedOffset = offset.toString(36);
  const integrity = canonicalHash('comet.dashboard.native-page-cursor.v1', { hash, offset });
  return `native-dashboard-v1.${hash}.${encodedOffset}.${integrity}`;
}

function nativeDashboardOffset(cursor: string | undefined, hash: string, total: number): number {
  if (!cursor) return 0;
  const match = NATIVE_DASHBOARD_CURSOR_PATTERN.exec(cursor);
  if (!match) throw new NativeDashboardQueryError('Invalid Native Dashboard change cursor');
  if (match[1] !== hash)
    throw new NativeDashboardQueryError('Stale Native Dashboard change cursor');
  const offset = Number.parseInt(match[2], 36);
  if (
    !Number.isSafeInteger(offset) ||
    offset <= 0 ||
    offset >= total ||
    offset.toString(36) !== match[2]
  ) {
    throw new NativeDashboardQueryError('Invalid Native Dashboard change cursor offset');
  }
  const expected = canonicalHash('comet.dashboard.native-page-cursor.v1', { hash, offset });
  if (match[3] !== expected) {
    throw new NativeDashboardQueryError('Invalid Native Dashboard change cursor integrity');
  }
  return offset;
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

async function collectArchivedChanges(
  paths: NativeProjectPaths,
  requestedEntries?: readonly NativeDashboardEntry[],
): Promise<NativeDashboardChangeProjection[]> {
  const entries = requestedEntries ?? (await listArchivedNativeEntries(paths));
  const archived: NativeDashboardChangeProjection[] = [];
  for (const entry of entries) {
    if (entry.status !== 'archived' || !entry.archiveName) continue;
    const match = ARCHIVE_NAME_PATTERN.exec(entry.archiveName);
    if (!match) continue;
    const changeDir = path.join(paths.archiveDir, entry.archiveName);
    await resolveContainedNativePath(paths.nativeRoot, changeDir);
    try {
      const state = await readNativeChangeFile(path.join(changeDir, NATIVE_CHANGE_STATE_FILE));
      if (!state.archived || entry.archiveName !== `${match[1]}-${state.name}`) continue;
      // Archived changes retain their immutable verification evidence. Read it so the
      // Dashboard reports the completed acceptance trace instead of treating every
      // criterion as missing merely because the change is no longer active.
      const facts = await collectChangeFacts(paths, changeDir, state, true);
      archived.push({
        workflow: 'native',
        name: state.name,
        status: 'archived',
        archivedAt: match[1],
        phase: 'archive',
        revision: state.revision,
        selected: false,
        approval: facts.approval,
        nextCommand: null,
        verificationResult: state.verification_result,
        verificationFreshness: state.verification_result === 'pass' ? 'complete' : 'unknown',
        archiveReady: true,
        continuation: {
          disposition: 'done',
          action: 'none',
          command: null,
          requiresUserDecision: false,
          requiredInputs: [],
          requiredInputsTruncated: false,
        },
        findings: {
          total: 0,
          errors: 0,
          warnings: 0,
          info: 0,
          requiresUserDecision: false,
          codes: [],
          truncated: false,
        },
        archive: {
          ready: true,
          evidenceFreshness: state.verification_result === 'pass' ? 'complete' : 'unknown',
          operationCount: state.spec_changes.length,
          findingCodes: [],
          findingCodesTruncated: false,
          preflightHash: null,
        },
        conflicts: {
          visibleDefiniteConflict: 0,
          visiblePossibleOverlap: 0,
          peers: [],
          peersTruncated: false,
        },
        artifacts: facts.artifacts,
        progress: {
          createdAt: facts.createdAt,
          checkpointAt: null,
          checkpointPhase: null,
          summary: 'Native change 已完成并归档。',
          nextAction: null,
          artifactCount: facts.artifacts.filter(({ exists }) => exists).length,
        },
        specs: facts.specs,
        acceptance: facts.acceptance,
        implementation: null,
        repair: null,
      });
    } catch {
      // Invalid or unreadable archives are omitted from the read-only Dashboard projection.
    }
  }
  return archived;
}

function emptyNativeConflictSummary(): NativeDashboardConflictSummary {
  return {
    available: false,
    definiteConflict: 0,
    possibleOverlap: 0,
    disjoint: 0,
    relationshipCount: 0,
    visibleRelationshipCount: 0,
    omittedRelationshipCount: 0,
    relationshipsTruncated: false,
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

async function collectActiveNativeChanges(
  paths: NativeProjectPaths,
  entries: readonly NativeDashboardEntry[],
  options: {
    clarificationMode?: NativeClarificationMode;
    maxVerifyFailures?: number;
    now?: Date;
    maxChanges?: number;
  },
): Promise<NativeDashboardChangeProjection[]> {
  if (entries.length === 0) return [];
  const statuses = await Promise.all(
    entries.map((entry) =>
      inspectNativeStatus(paths, entry.name, {
        clarificationMode: options.clarificationMode,
        maxVerifyFailures: options.maxVerifyFailures,
      }),
    ),
  );
  const preflightEntries = await Promise.all(
    statuses.map(async (status) => {
      if (status.phase === 'invalid' || status.revision === null) {
        return [status.name, null] as const;
      }
      try {
        return [
          status.name,
          await inspectNativeArchivePreflight({ paths, name: status.name, now: options.now }),
        ] as const;
      } catch {
        return [status.name, null] as const;
      }
    }),
  );
  const conflictRadar = await inspectNativeConflictRadar(paths).catch(() => null);
  const projection = adaptNativeDashboardProjection({
    generatedAt: (options.now ?? new Date()).toISOString(),
    statuses,
    preflights: Object.fromEntries(preflightEntries),
    conflictRadar,
    maxChanges: options.maxChanges,
  });
  return Promise.all(
    projection.changes.map(async (change) => {
      try {
        const state = await readNativeChange(paths, change.name);
        const facts = await collectChangeFacts(
          paths,
          path.join(paths.changesDir, change.name),
          state,
          true,
        );
        return {
          ...change,
          ...facts,
          progress: { ...change.progress, createdAt: facts.createdAt },
        };
      } catch {
        return change;
      }
    }),
  );
}

export interface NativeDashboardChangePageOptions {
  status: DashboardChangeTab;
  limit?: number;
  cursor?: string;
  query?: string;
  now?: Date;
}

/** Load one lightweight Native change page; full projections are loaded by selection. */
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
  const hash = nativeDashboardEntriesHash(options.status, listed.query, listed.entries);
  const offset = nativeDashboardOffset(options.cursor, hash, listed.entries.length);
  const limit = nativeDashboardPageLimit(options.limit);
  const pageEntries = listed.entries.slice(offset, offset + limit);
  const items = await Promise.all(
    pageEntries.map((entry) => collectNativeChangeListItem(paths, entry)),
  );
  const nextOffset = offset + pageEntries.length;
  return {
    status: options.status,
    items,
    total: listed.entries.length,
    nextCursor: nextOffset < listed.entries.length ? nativeDashboardCursor(hash, nextOffset) : null,
  };
}

export interface NativeDashboardChangeDetailOptions {
  status: 'active' | 'archived';
  name: string;
  archiveName?: string;
  now?: Date;
}

/** Load one complete Native change projection after the user selects its lightweight row. */
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
  if (!entry) return null;
  if (entry.status === 'archived') {
    return (await collectArchivedChanges(paths, [entry]))[0] ?? null;
  }
  return (
    (
      await collectActiveNativeChanges(paths, [entry], {
        clarificationMode: config.native.clarification_mode,
        maxVerifyFailures: config.native.max_verify_failures,
        now: options.now,
        maxChanges: 1,
      })
    )[0] ?? null
  );
}

/** Return only Native list metadata for the initial overview request. */
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
    schema: 'comet.dashboard.native.v1',
    generatedAt: (options.now ?? new Date()).toISOString(),
    totalChangeCount,
    activeChangeCount: active.length,
    archivedChangeCount: archived.length,
    visibleChangeCount: 0,
    omittedChangeCount: totalChangeCount,
    changesTruncated: totalChangeCount > 0,
    changes: [],
    conflicts: emptyNativeConflictSummary(),
  };
}

/** Collect a fresh, read-only Native Dashboard projection when this project enables Native. */
export async function collectNativeDashboardProjection(
  projectRoot: string,
  options: { now?: Date } = {},
): Promise<NativeDashboardProjection | null> {
  const root = path.resolve(projectRoot);
  const config = await readWorkflowProjectConfig(root);
  if (!config?.native) return null;
  const paths = await nativeProjectPaths(root, config.native.artifact_root);
  const statuses = [];
  let statusCursor: string | null = null;
  let totalStatusCount: number | undefined;
  do {
    const page = await listNativeStatusPage(paths, {
      cursor: statusCursor,
      clarificationMode: config.native.clarification_mode,
      maxVerifyFailures: config.native.max_verify_failures,
    });
    totalStatusCount ??= page.total;
    if (page.total !== totalStatusCount) {
      throw new Error('Native status total changed during Dashboard pagination');
    }
    statuses.push(...page.items.slice(0, NATIVE_DASHBOARD_LIMITS.maxChanges - statuses.length));
    statusCursor = page.nextCursor;
  } while (statusCursor !== null && statuses.length < NATIVE_DASHBOARD_LIMITS.maxChanges);
  const preflightEntries = await Promise.all(
    statuses.map(async (status) => {
      if (status.phase === 'invalid' || status.revision === null) {
        return [status.name, null] as const;
      }
      try {
        return [
          status.name,
          await inspectNativeArchivePreflight({ paths, name: status.name, now: options.now }),
        ] as const;
      } catch {
        return [status.name, null] as const;
      }
    }),
  );
  const conflictRadar = await inspectNativeConflictRadar(paths).catch(() => null);
  const projection = adaptNativeDashboardProjection({
    generatedAt: (options.now ?? new Date()).toISOString(),
    statuses,
    preflights: Object.fromEntries(preflightEntries),
    conflictRadar,
    omittedSourceChangeCount: Math.max(0, (totalStatusCount ?? 0) - statuses.length),
  });
  const active = await Promise.all(
    projection.changes.map(async (change) => {
      try {
        const state = await readNativeChange(paths, change.name);
        const facts = await collectChangeFacts(
          paths,
          path.join(paths.changesDir, change.name),
          state,
          true,
        );
        return {
          ...change,
          ...facts,
          progress: { ...change.progress, createdAt: facts.createdAt },
        };
      } catch {
        return change;
      }
    }),
  );
  const archived = await collectArchivedChanges(paths);
  const visible = [...active, ...archived].slice(0, NATIVE_DASHBOARD_LIMITS.maxChanges);
  const totalChangeCount = projection.totalChangeCount + archived.length;
  const result: NativeDashboardProjection = {
    ...projection,
    totalChangeCount,
    activeChangeCount: totalStatusCount ?? projection.changes.length,
    archivedChangeCount: archived.length,
    visibleChangeCount: visible.length,
    omittedChangeCount: totalChangeCount - visible.length,
    changesTruncated: totalChangeCount > visible.length,
    changes: visible,
  };
  if (
    Buffer.byteLength(JSON.stringify(result), 'utf8') > NATIVE_DASHBOARD_LIMITS.maxSerializedBytes
  ) {
    throw new Error('Native Dashboard projection exceeds its serialized output budget');
  }
  return result;
}
