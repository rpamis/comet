import path from 'node:path';

import { listGitWorktreeRoots } from '../../platform/paths/git-worktree.js';

import { canonicalHash } from './native-canonical-hash.js';
import { readProjectConfig } from './native-config.js';
import {
  inspectNativeStatus,
  listNativeChangeNames,
  NATIVE_STATUS_PAGE_LIMITS,
} from './native-diagnostics.js';
import { nativeProjectPaths } from './native-paths.js';
import { projectNativeWorkspace } from './native-workspace.js';
import type {
  CometProjectConfig,
  NativeProjectPaths,
  NativeStatusPageProjection,
  NativeStatusProjection,
  NativeWorkspaceProjection,
} from './native-types.js';

const DISCOVERY_CURSOR_PATTERN =
  /^native-workspaces-v1\.([a-f0-9]{64})\.([0-9a-z]+)\.([a-f0-9]{64})$/u;

interface NativeWorkspaceSource {
  projectRoot: string;
  config: CometProjectConfig;
  paths: NativeProjectPaths;
  names: string[];
}

interface NativeStatusCandidate {
  source: NativeWorkspaceSource;
  name: string;
  workspace: NativeWorkspaceProjection;
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function displayCommandArgs(args: readonly string[]): string {
  return args
    .map((value) => (/^[A-Za-z0-9_./:=+@-]+$/u.test(value) ? value : JSON.stringify(value)))
    .join(' ');
}

async function discoverSources(projectRoot: string): Promise<NativeWorkspaceSource[]> {
  const roots = listGitWorktreeRoots(projectRoot);
  const candidates = roots.length > 0 ? roots : [path.resolve(projectRoot)];
  if (!candidates.some((candidate) => samePath(candidate, projectRoot))) {
    candidates.push(path.resolve(projectRoot));
  }
  const sources: NativeWorkspaceSource[] = [];
  for (const candidate of [...new Set(candidates.map((value) => path.resolve(value)))].sort()) {
    const config = await readProjectConfig(candidate);
    if (!config) continue;
    const paths = await nativeProjectPaths(candidate, config.native.artifact_root);
    sources.push({
      projectRoot: candidate,
      config,
      paths,
      names: await listNativeChangeNames(paths),
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
      names: await listNativeChangeNames(paths),
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
  const grouped = new Map<string, NativeWorkspaceSource[]>();
  for (const source of sources) {
    for (const name of source.names) {
      grouped.set(name, [...(grouped.get(name) ?? []), source]);
    }
  }
  const selected: NativeStatusCandidate[] = [];
  for (const [name, nameSources] of [...grouped.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const candidates = await Promise.all(
      nameSources.map(async (source) => ({
        source,
        name,
        workspace: await projectNativeWorkspace(source.paths, name),
      })),
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
    ? ['comet', 'native', 'status', '--cursor', cursor, '--project-root', projectRoot]
    : null;
  return {
    nextPageCommand: args ? displayCommandArgs(args) : null,
    nextPageArgs: args,
  };
}

async function inspectCandidate(
  candidate: NativeStatusCandidate,
  details: boolean,
  acceptanceCursor?: string,
): Promise<NativeStatusProjection> {
  return inspectNativeStatus(candidate.source.paths, candidate.name, {
    details,
    ...(acceptanceCursor ? { acceptanceCursor } : {}),
    clarificationMode: candidate.source.config.native.clarification_mode,
    maxVerifyFailures: candidate.source.config.native.max_verify_failures,
  });
}

export async function inspectDiscoveredNativeStatus(options: {
  projectRoot: string;
  name: string;
  details?: boolean;
  acceptanceCursor?: string;
}): Promise<NativeStatusProjection> {
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
  return inspectCandidate(candidates[0], options.details ?? false, options.acceptanceCursor);
}

export async function listDiscoveredNativeStatusPage(options: {
  projectRoot: string;
  cursor?: string | null;
}): Promise<NativeStatusPageProjection> {
  const sources = await discoverSources(options.projectRoot);
  const candidates = await discoverCandidates(options.projectRoot, sources);
  const candidatesHash = canonicalHash(
    'comet.native.workspace-status-candidates.v1',
    candidates.map((candidate) => ({
      name: candidate.name,
      projectRoot: candidate.source.projectRoot,
      bindingState: candidate.workspace.bindingState,
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
  const items: NativeStatusProjection[] = [];
  for (const candidate of projected) {
    const trialItems = [...items, candidate];
    const nextOffset = offset + trialItems.length;
    const nextCursor =
      nextOffset < candidates.length ? discoveryCursor(candidatesHash, nextOffset) : null;
    const trial: NativeStatusPageProjection = {
      schema: 'comet.native.status-page.v1',
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
    schema: 'comet.native.status-page.v1',
    total: candidates.length,
    offset,
    items,
    nextCursor,
    ...pageAction(path.resolve(options.projectRoot), nextCursor),
    limits: { ...NATIVE_STATUS_PAGE_LIMITS },
  };
}
