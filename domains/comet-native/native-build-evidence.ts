import { promises as fs } from 'node:fs';
import path from 'node:path';

import { NativeBaselineIncompleteError, nativeChangeDir } from './native-change.js';
import {
  collectNativeContractFiles,
  type NativeCollectedContract,
} from './native-contract-files.js';
import {
  nativeEvidenceRef,
  writeNativeImplementationScope,
  writeNativePartialAllowance,
} from './native-evidence-storage.js';
import { isInsidePath, resolveContainedNativePath } from './native-paths.js';
import { nativeSensitiveArtifactReason } from './native-sensitive-paths.js';
import {
  createNativeContentSnapshot,
  filterNativeContentSnapshotToProjectScope,
  readNativeBaselineManifest,
} from './native-snapshot.js';
import type {
  NativeChangeState,
  NativeContentSnapshotManifest,
  NativeFinding,
  NativeProjectPaths,
} from './native-types.js';
import {
  buildNativeImplementationScopeBundle,
  type NativeDeclaredArtifact,
  type NativeImplementationScopeBundle,
  type NativeSnapshotProjection,
  type NativeUnresolvedScope,
} from './native-verification-scope.js';
import {
  buildNativePartialAllowance,
  type NativePartialAllowance,
} from './native-verification-evidence.js';

export const NATIVE_BUILD_EVIDENCE_LIMITS = {
  maxDeclaredArtifacts: 128,
  maxArtifactPathBytes: 512,
} as const;

export interface NativeBuildEvidencePreparation {
  contract: NativeCollectedContract;
  bundle: NativeImplementationScopeBundle;
  scopeRef: string;
  allowance: NativePartialAllowance | null;
  allowanceRef: string | null;
  findings: NativeFinding[];
  unresolvedScopes: NativeUnresolvedScope[];
}

export interface NativeBuildEvidenceOptions {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  artifactRefs: readonly string[];
  noCodeReason?: string | null;
  allowPartialScopeHash?: string | null;
  partialReason?: string | null;
  confirmedSummary?: string | null;
  confirmed?: boolean;
  now?: Date;
}

function assertStableNativeSelection(
  snapshot: NativeContentSnapshotManifest,
  source: 'baseline projection' | 'current snapshot',
): void {
  if (snapshot.omitted.some((omission) => omission.reason === 'git-selection-changed')) {
    throw new Error(
      `Native Git selection changed while capturing the ${source}; stabilize the Git index and retry Build evidence`,
    );
  }
  if (
    snapshot.omitted.some(
      (omission) =>
        omission.reason === 'physical-enumeration-limit' ||
        omission.reason === 'physical-selection-changed',
    )
  ) {
    throw new Error(
      `Native physical selection was incomplete or changed while capturing the ${source}; retry Build evidence with a stable bounded project tree`,
    );
  }
}

function nativeBaselineIncompleteError(
  change: string,
  baseline: NativeContentSnapshotManifest,
): NativeBaselineIncompleteError {
  const samplePaths = baseline.omitted.slice(0, 20).map((omission) => omission.path);
  const omittedByReason = baseline.omitted.reduce<Record<string, number>>((counts, item) => {
    counts[item.reason] = (counts[item.reason] ?? 0) + 1;
    return counts;
  }, {});
  const overflowCount = baseline.omissionOverflow?.count ?? 0;
  if (overflowCount > 0) omittedByReason.overflow = overflowCount;
  return new NativeBaselineIncompleteError(
    change,
    baseline.omittedCount,
    omittedByReason,
    samplePaths,
    baseline.omitted.length > samplePaths.length || overflowCount > 0,
  );
}

function nativeBaselineProjectionIncompleteError(
  change: string,
  baseline: NativeContentSnapshotManifest,
  projection: NativeSnapshotProjection,
): NativeBaselineIncompleteError {
  const retained = new Set(projection.entries.map((entry) => entry.path));
  const removedPaths = baseline.entries
    .filter((entry) => !retained.has(entry.path))
    .slice(0, 20)
    .map((entry) => entry.path);
  return new NativeBaselineIncompleteError(
    change,
    projection.omittedCount,
    { 'manifest-size': projection.omittedCount },
    removedPaths,
    projection.omittedCount > removedPaths.length,
  );
}

function normalizeProjectRef(value: string, label: string): string {
  const normalized = value.replaceAll('\\', '/').trim();
  if (
    normalized.length === 0 ||
    normalized !== value.replaceAll('\\', '/') ||
    path.posix.isAbsolute(normalized) ||
    /^(?:[A-Za-z]:|~)/u.test(normalized) ||
    normalized.split('/').includes('..') ||
    path.posix.normalize(normalized) !== normalized ||
    normalized === '.' ||
    normalized.endsWith('/') ||
    Buffer.byteLength(normalized, 'utf8') > NATIVE_BUILD_EVIDENCE_LIMITS.maxArtifactPathBytes ||
    Array.from(normalized).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new Error(`${label} must be a normalized project-relative path`);
  }
  return normalized;
}

function baselineArtifactKind(
  baseline: NativeContentSnapshotManifest,
  artifactRef: string,
): NativeDeclaredArtifact['kind'] | null {
  if (baseline.entries.some((entry) => entry.path === artifactRef)) return 'file';
  if (baseline.entries.some((entry) => entry.path.startsWith(`${artifactRef}/`))) {
    return 'directory';
  }
  return null;
}

async function inspectDeclaredArtifact(
  paths: NativeProjectPaths,
  baseline: NativeContentSnapshotManifest,
  rawRef: string,
): Promise<NativeDeclaredArtifact> {
  const artifactRef = normalizeProjectRef(rawRef, 'Native build artifact');
  const sensitiveReason = nativeSensitiveArtifactReason(paths, artifactRef);
  if (sensitiveReason) {
    throw new Error(`Native build artifact is excluded as ${sensitiveReason}: ${artifactRef}`);
  }
  const target = path.resolve(paths.projectRoot, ...artifactRef.split('/'));
  if (!isInsidePath(paths.projectRoot, target)) {
    throw new Error(`Native build artifact escapes the project: ${artifactRef}`);
  }
  await resolveContainedNativePath(paths.projectRoot, target);
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) {
      throw new Error(`Native build artifact must not be a symlink or junction: ${artifactRef}`);
    }
    const realTarget = await fs.realpath(target);
    const realProjectRoot = await fs.realpath(paths.projectRoot);
    if (!isInsidePath(realProjectRoot, realTarget)) {
      throw new Error(`Native build artifact resolves outside the project: ${artifactRef}`);
    }
    if (stat.isFile()) return { path: artifactRef, kind: 'file' };
    if (stat.isDirectory()) return { path: artifactRef, kind: 'directory' };
    throw new Error(`Native build artifact is not a file or directory: ${artifactRef}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const kind = baselineArtifactKind(baseline, artifactRef);
    if (kind === null) {
      throw new Error(`Native build artifact does not exist: ${artifactRef}`, { cause: error });
    }
    return { path: artifactRef, kind };
  }
}

async function collectDeclaredArtifacts(options: {
  paths: NativeProjectPaths;
  baseline: NativeContentSnapshotManifest;
  refs: readonly string[];
}): Promise<NativeDeclaredArtifact[]> {
  if (options.refs.length > NATIVE_BUILD_EVIDENCE_LIMITS.maxDeclaredArtifacts) {
    throw new Error('Native build evidence exceeds its declared-artifact budget');
  }
  const artifacts = await Promise.all(
    options.refs.map((reference) =>
      inspectDeclaredArtifact(options.paths, options.baseline, reference),
    ),
  );
  artifacts.sort(
    (left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind),
  );
  if (new Set(artifacts.map((artifact) => artifact.path)).size !== artifacts.length) {
    throw new Error('Native build evidence contains duplicate or conflicting artifacts');
  }
  return artifacts;
}

function partialFindings(unresolvedScopes: readonly NativeUnresolvedScope[]): NativeFinding[] {
  return unresolvedScopes.map((scope) => ({
    code: 'verification-scope-partial',
    message: `${scope.id}: ${scope.reason}`,
    ...(scope.path === null ? {} : { path: scope.path }),
  }));
}

function partialScopeHash(value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error('Native partial allowance requires a scope hash');
  }
  return value;
}

/**
 * Capture Build evidence from the real project and persist only content-addressed derived facts.
 *
 * A partial scope is persisted so its deterministic IDs can be shown and confirmed on a later
 * invocation, but it is not attached to change state until the caller commits a phase transition.
 */
export async function inspectNativeBuildEvidence(
  options: NativeBuildEvidenceOptions,
): Promise<NativeBuildEvidencePreparation> {
  if (options.state.phase !== 'build') {
    throw new Error(`Native build evidence requires Build, got ${options.state.phase}`);
  }
  if ((options.noCodeReason ?? '').trim().length > 0 && options.artifactRefs.length > 0) {
    throw new Error('Native build evidence cannot combine artifacts with a no-code reason');
  }
  const storedBaseline = await readNativeBaselineManifest(options.paths, options.state.name);
  if (storedBaseline === null) throw new Error('Native change has no baseline content snapshot');
  const baseline = await filterNativeContentSnapshotToProjectScope(options.paths, storedBaseline);
  assertStableNativeSelection(baseline, 'baseline projection');
  if (!baseline.complete) {
    throw nativeBaselineIncompleteError(options.state.name, baseline);
  }
  const contract = await collectNativeContractFiles({
    changeDir: nativeChangeDir(options.paths, options.state.name),
    briefRef: options.state.brief,
    specChanges: options.state.spec_changes,
  });
  const declaredArtifacts = await collectDeclaredArtifacts({
    paths: options.paths,
    baseline,
    refs: options.artifactRefs,
  });
  const current = await createNativeContentSnapshot(options.paths, {
    origin: 'explicit',
    now: options.now,
  });
  assertStableNativeSelection(current, 'current snapshot');
  const bundle = buildNativeImplementationScopeBundle({
    baseline,
    current,
    contractHash: contract.contract.contractHash,
    declaredArtifacts,
    noCodeReason: options.noCodeReason ?? null,
  });
  if (!bundle.baseline.complete) {
    throw nativeBaselineProjectionIncompleteError(options.state.name, baseline, bundle.baseline);
  }
  const scopeRef = nativeEvidenceRef('scopes', bundle.scope.scopeHash);
  if (bundle.scope.complete) {
    if (
      (options.allowPartialScopeHash !== undefined && options.allowPartialScopeHash !== null) ||
      (options.partialReason !== undefined && options.partialReason !== null)
    ) {
      throw new Error('Complete Native build evidence must not include a partial allowance');
    }
    return {
      contract,
      bundle,
      scopeRef,
      allowance: null,
      allowanceRef: null,
      findings: [],
      unresolvedScopes: [],
    };
  }
  if (options.allowPartialScopeHash === undefined || options.allowPartialScopeHash === null) {
    return {
      contract,
      bundle,
      scopeRef,
      allowance: null,
      allowanceRef: null,
      findings: partialFindings(bundle.scope.unresolvedScopes),
      unresolvedScopes: bundle.scope.unresolvedScopes,
    };
  }
  if (!options.confirmed) {
    throw new Error('Native partial verification requires explicit confirmation');
  }
  const expectedScopeHash = partialScopeHash(options.allowPartialScopeHash);
  if (expectedScopeHash !== bundle.scope.scopeHash) {
    throw new Error('Native partial allowance does not match the current implementation scope');
  }
  const allowance = buildNativePartialAllowance({
    change: options.state.name,
    scopeBundle: bundle,
    allowedScopeIds: bundle.scope.unresolvedScopes.map((scope) => scope.id),
    reason: options.partialReason ?? '',
    confirmedSummary: options.confirmedSummary ?? '',
    sourceRevision: options.state.revision,
    now: options.now,
  });
  const allowanceRef = nativeEvidenceRef('allowances', allowance.allowanceHash);
  return {
    contract,
    bundle,
    scopeRef,
    allowance,
    allowanceRef,
    findings: [],
    unresolvedScopes: bundle.scope.unresolvedScopes,
  };
}

export async function persistNativeBuildEvidence(
  options: Pick<NativeBuildEvidenceOptions, 'paths' | 'state'> & {
    preparation: NativeBuildEvidencePreparation;
    includeAllowance?: boolean;
  },
): Promise<void> {
  const scopeRef = await writeNativeImplementationScope({
    paths: options.paths,
    name: options.state.name,
    bundle: options.preparation.bundle,
  });
  if (scopeRef !== options.preparation.scopeRef) {
    throw new Error('Native implementation scope persistence ref changed');
  }
  if (options.includeAllowance === false || options.preparation.allowance === null) return;
  const allowanceRef = await writeNativePartialAllowance({
    paths: options.paths,
    name: options.state.name,
    allowance: options.preparation.allowance,
  });
  if (allowanceRef !== options.preparation.allowanceRef) {
    throw new Error('Native partial allowance persistence ref changed');
  }
}

/** Backwards-compatible one-shot API for callers that intentionally persist a prepared scope. */
export async function prepareNativeBuildEvidence(
  options: NativeBuildEvidenceOptions,
): Promise<NativeBuildEvidencePreparation> {
  const preparation = await inspectNativeBuildEvidence(options);
  await persistNativeBuildEvidence({ paths: options.paths, state: options.state, preparation });
  return preparation;
}
