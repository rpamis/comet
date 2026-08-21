import path from 'node:path';
import { realpathSync } from 'node:fs';

import { listGitWorktreeRoots } from '../../platform/paths/git-worktree.js';

import { canonicalHash } from './native-canonical-hash.js';
import { inspectNativeChangeStateDocument } from './native-change.js';
import { readProjectConfig } from './native-config.js';
import {
  inspectNativeStatus,
  listNativeChangeNames,
  NATIVE_STATUS_PAGE_LIMITS,
} from './native-diagnostics.js';
import { nativeProjectPaths } from './native-paths.js';
import {
  inspectNativePortableStatus,
  type NativePortableStatusProjection,
} from './native-portable-status.js';
import { isNativePortableChange } from './native-portable-runtime.js';
import { projectNativeWorkspace } from './native-workspace.js';
import type {
  CometProjectConfig,
  NativeProjectPaths,
  NativeStatusProjection,
  NativeWorkspaceProjection,
} from './native-types.js';

const DISCOVERY_CURSOR_PATTERN =
  /^native-workspaces-v1\.([a-f0-9]{64})\.([0-9a-z]+)\.([a-f0-9]{64})$/u;

interface NativeWorkspaceSource {
  projectRoot: string;
  config: CometProjectConfig;
  paths: NativeProjectPaths;
  changes: Array<{ name: string; kind: 'portable' | 'legacy' }>;
}

interface NativeStatusCandidate {
  source: NativeWorkspaceSource;
  name: string;
  kind: 'portable' | 'legacy';
  workspace: NativeWorkspaceProjection | NativePortableStatusProjection['workspace'];
  portableStatus: NativePortableStatusProjection | null;
}

export type NativeDiscoveredStatusProjection =
  | NativeStatusProjection
  | NativePortableStatusProjection
  | NativeLegacyMigrationStatusProjection;

export interface NativeLegacyMigrationStatusProjection {
  schema: 'comet.native.status.v2';
  name: string;
  phase: string;
  status: 'blocked';
  migrationRequired: true;
  legacySchema: string;
  workspace: NativeWorkspaceProjection;
  continuation: {
    schema: 'comet.native.continuation.v2';
    skill: 'comet-native';
    change: string;
    phase: string;
    status: 'blocked';
    disposition: 'blocked';
    action: 'none';
    commandArgs: string[];
    requiredInputs: [];
    runnerAction: {
      kind: 'none';
      candidateId: null;
      iteration: 0;
      attempt: 0;
    };
  };
}

export interface NativeDiscoveredStatusPageProjection {
  schema: 'comet.native.status-page.v1' | 'comet.native.status-page.v2';
  total: number;
  offset: number;
  items: NativeDiscoveredStatusProjection[];
  nextCursor: string | null;
  nextPageCommand: string | null;
  nextPageArgs: string[] | null;
  limits: typeof NATIVE_STATUS_PAGE_LIMITS;
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(pathIdentity(left));
  const normalizedRight = path.normalize(pathIdentity(right));
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function pathIdentity(value: string): string {
  const resolved = path.resolve(value);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function displayCommandArgs(args: readonly string[]): string {
  return args
    .map((value) => (/^[A-Za-z0-9_./:=+@-]+$/u.test(value) ? value : JSON.stringify(value)))
    .join(' ');
}

async function discoverChanges(
  paths: NativeProjectPaths,
): Promise<NativeWorkspaceSource['changes']> {
  const changes: NativeWorkspaceSource['changes'] = [];
  for (const name of await listNativeChangeNames(paths)) {
    changes.push({
      name,
      kind: (await isNativePortableChange(paths, name)) ? 'portable' : 'legacy',
    });
  }
  return changes;
}

async function discoverSources(projectRoot: string): Promise<NativeWorkspaceSource[]> {
  const requestedRoot = path.resolve(projectRoot);
  const roots = listGitWorktreeRoots(projectRoot);
  const candidates = roots.length > 0 ? roots : [requestedRoot];
  if (!candidates.some((candidate) => samePath(candidate, requestedRoot))) {
    candidates.push(requestedRoot);
  }
  const sources: NativeWorkspaceSource[] = [];
  const seen = new Set<string>();
  for (const candidatePath of candidates.map((value) => path.resolve(value)).sort()) {
    const candidate = samePath(candidatePath, requestedRoot) ? requestedRoot : candidatePath;
    const identity = pathIdentity(candidate);
    const key = process.platform === 'win32' ? identity.toLowerCase() : identity;
    if (seen.has(key)) continue;
    seen.add(key);
    const config = await readProjectConfig(candidate);
    if (!config) continue;
    const paths = await nativeProjectPaths(candidate, config.native.artifact_root);
    sources.push({
      projectRoot: candidate,
      config,
      paths,
      changes: await discoverChanges(paths),
    });
  }
  if (sources.length === 0) {
    const config = await readProjectConfig(projectRoot);
    if (!config) throw new Error('.comet/config.yaml was not found in any registered worktree');
    const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
    sources.push({
      projectRoot: path.resolve(projectRoot),
      config,
      paths,
      changes: await discoverChanges(paths),
    });
  }
  return sources;
}

function candidateRank(candidate: NativeStatusCandidate, requestedRoot: string): number {
  if (candidate.workspace.bindingState === 'aligned') return 0;
  if (samePath(candidate.source.projectRoot, requestedRoot)) return 1;
  if (candidate.workspace.bindingState === 'legacy') return 2;
  if (candidate.workspace.bindingState === 'missing') return 3;
  if (candidate.workspace.bindingState === 'drifted') return 4;
  return 5;
}

async function discoverCandidates(
  projectRoot: string,
  sources: readonly NativeWorkspaceSource[],
): Promise<NativeStatusCandidate[]> {
  const grouped = new Map<
    string,
    Array<{ source: NativeWorkspaceSource; kind: 'portable' | 'legacy' }>
  >();
  for (const source of sources) {
    for (const change of source.changes) {
      grouped.set(change.name, [
        ...(grouped.get(change.name) ?? []),
        { source, kind: change.kind },
      ]);
    }
  }
  const selected: NativeStatusCandidate[] = [];
  for (const [name, nameSources] of [...grouped.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const candidates = await Promise.all(
      nameSources.map(async ({ source, kind }): Promise<NativeStatusCandidate> => {
        if (kind === 'portable') {
          const portableStatus = await inspectNativePortableStatus({ paths: source.paths, name });
          return {
            source,
            name,
            kind,
            workspace: portableStatus.workspace,
            portableStatus,
          };
        }
        return {
          source,
          name,
          kind,
          workspace: await projectNativeWorkspace(source.paths, name),
          portableStatus: null,
        };
      }),
    );
    candidates.sort((left, right) => {
      const rank = candidateRank(left, projectRoot) - candidateRank(right, projectRoot);
      return rank || left.source.projectRoot.localeCompare(right.source.projectRoot);
    });
    const aligned = candidates.filter(
      (candidate) => candidate.workspace.bindingState === 'aligned',
    );
    if (aligned.length > 1) {
      selected.push(...aligned);
    } else {
      selected.push(aligned[0] ?? candidates[0]);
    }
  }
  if (selected.length > NATIVE_STATUS_PAGE_LIMITS.maxChanges) {
    throw new Error(
      `Native status discovery exceeds ${NATIVE_STATUS_PAGE_LIMITS.maxChanges} visible changes`,
    );
  }
  return selected.sort((left, right) =>
    `${left.name}\0${left.source.projectRoot}`.localeCompare(
      `${right.name}\0${right.source.projectRoot}`,
    ),
  );
}

function discoveryCursor(candidatesHash: string, offset: number): string {
  const encodedOffset = offset.toString(36);
  const integrity = canonicalHash('comet.native.workspace-status-cursor.v1', {
    candidatesHash,
    offset,
  });
  return `native-workspaces-v1.${candidatesHash}.${encodedOffset}.${integrity}`;
}

function discoveryOffset(options: {
  candidatesHash: string;
  total: number;
  cursor?: string | null;
}): number {
  if (options.cursor === undefined || options.cursor === null) return 0;
  const match = DISCOVERY_CURSOR_PATTERN.exec(options.cursor);
  if (!match || match[1] !== options.candidatesHash) {
    throw new Error('Native workspace status cursor is invalid or stale');
  }
  const offset = Number.parseInt(match[2], 36);
  if (
    !Number.isSafeInteger(offset) ||
    offset <= 0 ||
    offset >= options.total ||
    offset.toString(36) !== match[2]
  ) {
    throw new Error('Native workspace status cursor offset is invalid');
  }
  const integrity = canonicalHash('comet.native.workspace-status-cursor.v1', {
    candidatesHash: options.candidatesHash,
    offset,
  });
  if (match[3] !== integrity) throw new Error('Native workspace status cursor integrity failed');
  return offset;
}

function pageAction(
  projectRoot: string,
  cursor: string | null,
): {
  nextPageCommand: string | null;
  nextPageArgs: string[] | null;
} {
  const args = cursor
    ? ['comet', 'native', 'status', '--cursor', cursor, '--project-root', projectRoot, '--json']
    : null;
  return {
    nextPageCommand: args ? displayCommandArgs(args) : null,
    nextPageArgs: args,
  };
}

async function inspectLegacyCandidate(
  candidate: NativeStatusCandidate,
  details: boolean,
  acceptanceCursor?: string,
): Promise<NativeStatusProjection | NativeLegacyMigrationStatusProjection> {
  let inspection: Awaited<ReturnType<typeof inspectNativeChangeStateDocument>> | null = null;
  try {
    inspection = await inspectNativeChangeStateDocument(candidate.source.paths, candidate.name);
  } catch {
    // The legacy status adapter below owns malformed and missing-state diagnostics.
  }
  if (inspection?.state) {
    return {
      schema: 'comet.native.status.v2',
      name: candidate.name,
      phase: inspection.state.phase,
      status: 'blocked',
      migrationRequired: true,
      legacySchema: inspection.schema,
      workspace: candidate.workspace as NativeWorkspaceProjection,
      continuation: {
        schema: 'comet.native.continuation.v2',
        skill: 'comet-native',
        change: candidate.name,
        phase: inspection.state.phase,
        status: 'blocked',
        disposition: 'blocked',
        action: 'none',
        commandArgs: ['comet', 'native', 'doctor', candidate.name, '--repair'],
        requiredInputs: [],
        runnerAction: {
          kind: 'none',
          candidateId: null,
          iteration: 0,
          attempt: 0,
        },
      },
    };
  }
  return inspectNativeStatus(candidate.source.paths, candidate.name, {
    details,
    ...(acceptanceCursor ? { acceptanceCursor } : {}),
    clarificationMode: candidate.source.config.native.clarification_mode,
    maxVerifyFailures: candidate.source.config.native.max_verify_failures,
  });
}

async function inspectCandidate(
  candidate: NativeStatusCandidate,
  details: boolean,
  acceptanceCursor?: string,
  detailsCursor?: string,
): Promise<NativeDiscoveredStatusProjection> {
  if (candidate.kind === 'portable') {
    if (acceptanceCursor) {
      throw new Error('Portable Native status includes the complete acceptance list');
    }
    if (!details && candidate.portableStatus) return candidate.portableStatus;
    return inspectNativePortableStatus({
      paths: candidate.source.paths,
      name: candidate.name,
      details,
      ...(detailsCursor ? { cursor: detailsCursor } : {}),
    });
  }
  return inspectLegacyCandidate(candidate, details, acceptanceCursor);
}

export async function inspectDiscoveredNativeStatus(options: {
  projectRoot: string;
  name: string;
  details?: boolean;
  acceptanceCursor?: string;
  detailsCursor?: string;
}): Promise<NativeDiscoveredStatusProjection> {
  const sources = await discoverSources(options.projectRoot);
  const candidates = (await discoverCandidates(options.projectRoot, sources)).filter(
    (candidate) => candidate.name === options.name,
  );
  if (candidates.length === 0) {
    const current =
      sources.find((source) => samePath(source.projectRoot, options.projectRoot)) ?? sources[0];
    return inspectNativeStatus(current.paths, options.name, {
      details: options.details,
      ...(options.acceptanceCursor ? { acceptanceCursor: options.acceptanceCursor } : {}),
      clarificationMode: current.config.native.clarification_mode,
      maxVerifyFailures: current.config.native.max_verify_failures,
    });
  }
  if (candidates.length > 1) {
    throw new Error(
      `Native change ${options.name} has multiple aligned workspace bindings: ${candidates
        .map((candidate) => candidate.source.projectRoot)
        .join(', ')}`,
    );
  }
  return inspectCandidate(
    candidates[0],
    options.details ?? false,
    options.acceptanceCursor,
    options.detailsCursor,
  );
}

export async function listDiscoveredNativeStatusPage(options: {
  projectRoot: string;
  cursor?: string | null;
}): Promise<NativeDiscoveredStatusPageProjection> {
  const sources = await discoverSources(options.projectRoot);
  const candidates = await discoverCandidates(options.projectRoot, sources);
  const candidatesHash = canonicalHash(
    'comet.native.workspace-status-candidates.v1',
    candidates.map((candidate) => ({
      name: candidate.name,
      projectRoot: candidate.source.projectRoot,
      bindingState: candidate.workspace.bindingState,
      kind: candidate.kind,
    })),
  );
  const offset = discoveryOffset({
    candidatesHash,
    total: candidates.length,
    cursor: options.cursor,
  });
  const projected = await Promise.all(
    candidates
      .slice(offset, offset + NATIVE_STATUS_PAGE_LIMITS.maxItems)
      .map((candidate) => inspectCandidate(candidate, false)),
  );
  const items: NativeDiscoveredStatusProjection[] = [];
  const schema = candidates.some(({ kind }) => kind === 'portable')
    ? ('comet.native.status-page.v2' as const)
    : ('comet.native.status-page.v1' as const);
  for (const candidate of projected) {
    const trialItems = [...items, candidate];
    const nextOffset = offset + trialItems.length;
    const nextCursor =
      nextOffset < candidates.length ? discoveryCursor(candidatesHash, nextOffset) : null;
    const trial: NativeDiscoveredStatusPageProjection = {
      schema,
      total: candidates.length,
      offset,
      items: trialItems,
      nextCursor,
      ...pageAction(path.resolve(options.projectRoot), nextCursor),
      limits: { ...NATIVE_STATUS_PAGE_LIMITS },
    };
    if (
      Buffer.byteLength(JSON.stringify(trial), 'utf8') >
      NATIVE_STATUS_PAGE_LIMITS.maxSerializedBytes
    ) {
      if (items.length === 0) {
        throw new Error('Native workspace status item exceeds its page serialization budget');
      }
      break;
    }
    items.push(candidate);
  }
  const nextOffset = offset + items.length;
  const nextCursor =
    nextOffset < candidates.length ? discoveryCursor(candidatesHash, nextOffset) : null;
  return {
    schema,
    total: candidates.length,
    offset,
    items,
    nextCursor,
    ...pageAction(path.resolve(options.projectRoot), nextCursor),
    limits: { ...NATIVE_STATUS_PAGE_LIMITS },
  };
}
