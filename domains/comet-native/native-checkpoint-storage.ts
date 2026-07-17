import path from 'path';

import { atomicWriteJson } from './native-atomic-file.js';
import { nativeChangeDir, parseNativeChangeValue } from './native-change.js';
import { sha256Text } from './native-hash.js';
import { isInsidePath, resolveContainedNativePath } from './native-paths.js';
import { readNativeProtectedFile } from './native-protected-file.js';
import {
  nativeSensitiveArtifactReason,
  nativeSensitiveRelativePathReason,
} from './native-sensitive-paths.js';
import { redactNativeCredentialText } from './native-redaction.js';
import type {
  NativeCheckpointArtifact,
  NativeCheckpointJournal,
  NativeCheckpointManifest,
  NativeFinding,
  NativeProgressCheckpoint,
  NativeProjectPaths,
} from './native-types.js';

export const NATIVE_CHECKPOINT_LIMITS = {
  maxArtifacts: 128,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxDocumentBytes: 256 * 1024,
} as const;

const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export interface NativeCheckpointArtifactReadHooks {
  afterParentChainCaptured?: (artifactRef: string) => void | Promise<void>;
  afterOpen?: (artifactRef: string) => void | Promise<void>;
  beforeRead?: (artifactRef: string) => void | Promise<void>;
}

export interface NativeCheckpointManifestWriteHooks {
  beforeCommit?: () => void | Promise<void>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in value));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}`);
  if (missing.length > 0) throw new Error(`${label} is missing field(s): ${missing.join(', ')}`);
}

function stringValue(value: unknown, label: string, max = 2_000): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new Error(`${label} must be a non-empty string of at most ${max} characters`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value as number;
}

export function normalizeNativeCheckpointArtifactRef(value: string): string {
  const trimmed = value.trim().replaceAll('\\', '/');
  if (
    trimmed.length === 0 ||
    path.isAbsolute(trimmed) ||
    /^(?:[A-Za-z]:|~|\/)/u.test(trimmed) ||
    trimmed.split('/').includes('..')
  ) {
    throw new Error(`Checkpoint artifact must be project-relative: ${value}`);
  }
  const normalized = path.posix.normalize(trimmed);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Checkpoint artifact must name a project file: ${value}`);
  }
  return normalized;
}

export function nativeProgressCheckpointFile(paths: NativeProjectPaths, name: string): string {
  return path.join(nativeChangeDir(paths, name), 'runtime', 'checkpoints', 'progress.json');
}

export function nativeCheckpointJournalFile(paths: NativeProjectPaths, name: string): string {
  return path.join(nativeChangeDir(paths, name), 'runtime', 'checkpoint-journal.json');
}

export function nativeCheckpointManifestFile(
  paths: NativeProjectPaths,
  name: string,
  hash: string,
): string {
  if (!HASH_PATTERN.test(hash)) throw new Error('Native checkpoint manifest hash is invalid');
  return path.join(
    nativeChangeDir(paths, name),
    'runtime',
    'checkpoints',
    'manifests',
    `${hash}.json`,
  );
}

export function nativeCheckpointManifestRef(hash: string): string {
  if (!HASH_PATTERN.test(hash)) throw new Error('Native checkpoint manifest hash is invalid');
  return `runtime/checkpoints/manifests/${hash}.json`;
}

async function readBoundedJson(root: string, file: string, label: string): Promise<unknown> {
  const snapshot = await readNativeProtectedFile({
    root,
    file,
    maxBytes: NATIVE_CHECKPOINT_LIMITS.maxDocumentBytes,
    label,
  });
  return JSON.parse(snapshot.bytes.toString('utf8')) as unknown;
}

function parseArtifact(value: unknown, index: number): NativeCheckpointArtifact {
  const artifact = record(value, `checkpoint manifest artifact ${index}`);
  exactKeys(artifact, ['path', 'hash', 'size'], `checkpoint manifest artifact ${index}`);
  const artifactPath = normalizeNativeCheckpointArtifactRef(
    stringValue(artifact.path, `checkpoint artifact ${index} path`, 4_096),
  );
  const sensitiveReason = nativeSensitiveRelativePathReason(artifactPath);
  if (sensitiveReason) {
    throw new Error(
      `checkpoint artifact ${index} is excluded as sensitive (${sensitiveReason}): ${artifactPath}`,
    );
  }
  if (typeof artifact.hash !== 'string' || !HASH_PATTERN.test(artifact.hash)) {
    throw new Error(`checkpoint artifact ${index} hash is invalid`);
  }
  return {
    path: artifactPath,
    hash: artifact.hash,
    size: nonNegativeInteger(artifact.size, `checkpoint artifact ${index} size`),
  };
}

export function parseNativeCheckpointManifestValue(
  value: unknown,
  expectedName: string,
): NativeCheckpointManifest {
  const manifest = record(value, 'Native checkpoint manifest');
  exactKeys(
    manifest,
    ['schema', 'change', 'artifacts', 'totalBytes'],
    'Native checkpoint manifest',
  );
  if (manifest.schema !== 'comet.native.checkpoint-manifest.v1') {
    throw new Error('Native checkpoint manifest schema is invalid');
  }
  if (manifest.change !== expectedName)
    throw new Error('Native checkpoint manifest change mismatch');
  if (!Array.isArray(manifest.artifacts)) {
    throw new Error('Native checkpoint manifest artifacts must be an array');
  }
  if (manifest.artifacts.length > NATIVE_CHECKPOINT_LIMITS.maxArtifacts) {
    throw new Error('Native checkpoint manifest has too many artifacts');
  }
  const artifacts = manifest.artifacts.map(parseArtifact);
  const sorted = [...artifacts].sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(artifacts) !== JSON.stringify(sorted)) {
    throw new Error('Native checkpoint manifest artifacts must be sorted');
  }
  if (new Set(artifacts.map((artifact) => artifact.path)).size !== artifacts.length) {
    throw new Error('Native checkpoint manifest has duplicate artifacts');
  }
  const totalBytes = nonNegativeInteger(manifest.totalBytes, 'checkpoint manifest totalBytes');
  if (artifacts.reduce((total, artifact) => total + artifact.size, 0) !== totalBytes) {
    throw new Error('Native checkpoint manifest totalBytes mismatch');
  }
  if (totalBytes > NATIVE_CHECKPOINT_LIMITS.maxTotalBytes) {
    throw new Error('Native checkpoint manifest totalBytes exceeds its budget');
  }
  return {
    schema: 'comet.native.checkpoint-manifest.v1',
    change: expectedName,
    artifacts,
    totalBytes,
  };
}

export function hashNativeCheckpointManifest(manifest: NativeCheckpointManifest): string {
  return sha256Text(JSON.stringify(parseNativeCheckpointManifestValue(manifest, manifest.change)));
}

export function parseNativeProgressCheckpointValue(
  value: unknown,
  expectedName: string,
): NativeProgressCheckpoint {
  const checkpoint = record(value, 'Native progress checkpoint');
  exactKeys(
    checkpoint,
    [
      'schema',
      'id',
      'change',
      'phase',
      'previousRevision',
      'stateRevision',
      'summary',
      'nextAction',
      'inputHash',
      'manifestHash',
      'manifestRef',
      'artifactCount',
      'createdAt',
    ],
    'Native progress checkpoint',
  );
  if (checkpoint.schema !== 'comet.native.progress-checkpoint.v1') {
    throw new Error('Native progress checkpoint schema is invalid');
  }
  if (checkpoint.change !== expectedName) throw new Error('Native checkpoint change mismatch');
  const phase = checkpoint.phase;
  if (phase !== 'shape' && phase !== 'build' && phase !== 'verify' && phase !== 'archive') {
    throw new Error('Native checkpoint phase is invalid');
  }
  const previousRevision = positiveInteger(
    checkpoint.previousRevision,
    'Native checkpoint previousRevision',
  );
  const stateRevision = positiveInteger(
    checkpoint.stateRevision,
    'Native checkpoint stateRevision',
  );
  if (stateRevision !== previousRevision + 1) {
    throw new Error('Native checkpoint stateRevision must increment previousRevision once');
  }
  const manifestHash = stringValue(checkpoint.manifestHash, 'Native checkpoint manifestHash', 64);
  if (!HASH_PATTERN.test(manifestHash))
    throw new Error('Native checkpoint manifestHash is invalid');
  const expectedManifestRef = nativeCheckpointManifestRef(manifestHash);
  if (checkpoint.manifestRef !== expectedManifestRef) {
    throw new Error('Native checkpoint manifestRef does not match manifestHash');
  }
  const inputHash = stringValue(checkpoint.inputHash, 'Native checkpoint inputHash', 64);
  if (!HASH_PATTERN.test(inputHash)) throw new Error('Native checkpoint inputHash is invalid');
  const createdAt = stringValue(checkpoint.createdAt, 'Native checkpoint createdAt', 64);
  if (Number.isNaN(Date.parse(createdAt)))
    throw new Error('Native checkpoint createdAt is invalid');
  const artifactCount = nonNegativeInteger(
    checkpoint.artifactCount,
    'Native checkpoint artifactCount',
  );
  if (artifactCount > NATIVE_CHECKPOINT_LIMITS.maxArtifacts) {
    throw new Error('Native checkpoint artifactCount exceeds its budget');
  }
  const summary = stringValue(checkpoint.summary, 'Native checkpoint summary');
  const nextAction = stringValue(checkpoint.nextAction, 'Native checkpoint nextAction');
  if (
    redactNativeCredentialText(summary) !== summary ||
    redactNativeCredentialText(nextAction) !== nextAction
  ) {
    throw new Error('Native checkpoint text contains unredacted credential material');
  }
  return {
    schema: 'comet.native.progress-checkpoint.v1',
    id: stringValue(checkpoint.id, 'Native checkpoint id', 128),
    change: expectedName,
    phase,
    previousRevision,
    stateRevision,
    summary,
    nextAction,
    inputHash,
    manifestHash,
    manifestRef: expectedManifestRef,
    artifactCount,
    createdAt,
  };
}

export function parseNativeCheckpointJournalValue(
  value: unknown,
  expectedName: string,
): NativeCheckpointJournal {
  const journal = record(value, 'Native checkpoint journal');
  exactKeys(
    journal,
    [
      'schema',
      'id',
      'change',
      'inputHash',
      'createdAt',
      'previousState',
      'nextState',
      'checkpoint',
      'manifest',
    ],
    'Native checkpoint journal',
  );
  if (journal.schema !== 'comet.native.checkpoint-journal.v1') {
    throw new Error('Native checkpoint journal schema is invalid');
  }
  if (journal.change !== expectedName) throw new Error('Native checkpoint journal change mismatch');
  const previousState = parseNativeChangeValue(journal.previousState);
  const nextState = parseNativeChangeValue(journal.nextState);
  const checkpoint = parseNativeProgressCheckpointValue(journal.checkpoint, expectedName);
  const manifest = parseNativeCheckpointManifestValue(journal.manifest, expectedName);
  const inputHash = stringValue(journal.inputHash, 'Native checkpoint journal inputHash', 64);
  const expectedInputHash = sha256Text(
    JSON.stringify({
      summary: checkpoint.summary,
      nextAction: checkpoint.nextAction,
      artifacts: manifest.artifacts,
    }),
  );
  if (
    !HASH_PATTERN.test(inputHash) ||
    inputHash !== checkpoint.inputHash ||
    inputHash !== expectedInputHash ||
    journal.id !== checkpoint.id ||
    journal.createdAt !== checkpoint.createdAt
  ) {
    throw new Error('Native checkpoint journal envelope mismatch');
  }
  if (
    previousState.name !== expectedName ||
    nextState.name !== expectedName ||
    nextState.revision !== previousState.revision + 1 ||
    checkpoint.previousRevision !== previousState.revision ||
    checkpoint.stateRevision !== nextState.revision ||
    checkpoint.phase !== nextState.phase ||
    checkpoint.manifestHash !== hashNativeCheckpointManifest(manifest) ||
    checkpoint.artifactCount !== manifest.artifacts.length
  ) {
    throw new Error('Native checkpoint journal state mismatch');
  }
  return {
    schema: 'comet.native.checkpoint-journal.v1',
    id: checkpoint.id,
    change: expectedName,
    inputHash,
    createdAt: checkpoint.createdAt,
    previousState,
    nextState,
    checkpoint,
    manifest,
  };
}

async function hashProjectArtifact(
  paths: NativeProjectPaths,
  artifactRef: string,
  hooks?: NativeCheckpointArtifactReadHooks,
): Promise<NativeCheckpointArtifact> {
  const target = path.resolve(paths.projectRoot, ...artifactRef.split('/'));
  if (!isInsidePath(paths.projectRoot, target) || isInsidePath(paths.nativeRoot, target)) {
    throw new Error(`Checkpoint artifact is outside project content: ${artifactRef}`);
  }
  const sensitiveReason = nativeSensitiveArtifactReason(paths, artifactRef);
  if (sensitiveReason) {
    throw new Error(
      `Checkpoint artifact is excluded as sensitive (${sensitiveReason}): ${artifactRef}`,
    );
  }
  const snapshot = await readNativeProtectedFile({
    root: paths.projectRoot,
    file: target,
    maxBytes: NATIVE_CHECKPOINT_LIMITS.maxFileBytes,
    label: `Checkpoint artifact ${artifactRef}`,
    forbiddenRoots: [paths.nativeRoot],
    hooks: {
      afterParentChainCaptured: () => hooks?.afterParentChainCaptured?.(artifactRef),
      afterOpen: () => hooks?.afterOpen?.(artifactRef),
      beforeRead: () => hooks?.beforeRead?.(artifactRef),
    },
  });
  return { path: artifactRef, hash: snapshot.hash, size: snapshot.size };
}

export async function createNativeCheckpointManifest(
  paths: NativeProjectPaths,
  name: string,
  artifactRefs: readonly string[],
  hooks?: NativeCheckpointArtifactReadHooks,
): Promise<NativeCheckpointManifest> {
  const normalized = artifactRefs.map(normalizeNativeCheckpointArtifactRef).sort();
  if (normalized.length > NATIVE_CHECKPOINT_LIMITS.maxArtifacts) {
    throw new Error(
      `Checkpoint supports at most ${NATIVE_CHECKPOINT_LIMITS.maxArtifacts} artifacts`,
    );
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Checkpoint artifacts must not contain duplicates');
  }
  const artifacts: NativeCheckpointArtifact[] = [];
  let totalBytes = 0;
  for (const artifactRef of normalized) {
    const artifact = await hashProjectArtifact(paths, artifactRef, hooks);
    totalBytes += artifact.size;
    if (totalBytes > NATIVE_CHECKPOINT_LIMITS.maxTotalBytes) {
      throw new Error('Checkpoint artifacts exceed the total byte budget');
    }
    artifacts.push(artifact);
  }
  return {
    schema: 'comet.native.checkpoint-manifest.v1',
    change: name,
    artifacts,
    totalBytes,
  };
}

export async function readNativeProgressCheckpoint(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeProgressCheckpoint | null> {
  const file = nativeProgressCheckpointFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    return parseNativeProgressCheckpointValue(
      await readBoundedJson(paths.nativeRoot, file, 'Native progress checkpoint'),
      name,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function readNativeCheckpointManifest(
  paths: NativeProjectPaths,
  name: string,
  hash: string,
): Promise<NativeCheckpointManifest> {
  const file = nativeCheckpointManifestFile(paths, name, hash);
  await resolveContainedNativePath(paths.nativeRoot, file);
  const value = await readBoundedJson(paths.nativeRoot, file, 'Native checkpoint manifest');
  const manifest = parseNativeCheckpointManifestValue(value, name);
  assertCheckpointManifestSafeForPaths(paths, manifest);
  if (hashNativeCheckpointManifest(manifest) !== hash) {
    throw new Error('Native checkpoint manifest content hash mismatch');
  }
  return manifest;
}

export async function readNativeCheckpointJournal(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeCheckpointJournal | null> {
  const file = nativeCheckpointJournalFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    const journal = parseNativeCheckpointJournalValue(
      await readBoundedJson(paths.nativeRoot, file, 'Native checkpoint journal'),
      name,
    );
    assertCheckpointManifestSafeForPaths(paths, journal.manifest);
    return journal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeNativeCheckpointManifest(
  paths: NativeProjectPaths,
  name: string,
  manifest: NativeCheckpointManifest,
  hooks?: NativeCheckpointManifestWriteHooks,
): Promise<string> {
  const parsed = parseNativeCheckpointManifestValue(manifest, name);
  assertCheckpointManifestSafeForPaths(paths, parsed);
  const hash = hashNativeCheckpointManifest(parsed);
  const file = nativeCheckpointManifestFile(paths, name, hash);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    const existing = await readNativeCheckpointManifest(paths, name, hash);
    if (JSON.stringify(existing) !== JSON.stringify(parsed)) {
      throw new Error('Native checkpoint manifest hash collision');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  // Commit through the protected boundary even when identical content already
  // exists. Otherwise an internal parent symlink could bypass the write-time
  // directory-chain validation through the read-only idempotent branch.
  await atomicWriteJson(file, parsed, {
    containedRoot: paths.nativeRoot,
    beforeCommit: hooks?.beforeCommit,
  });
  return hash;
}

function assertCheckpointManifestSafeForPaths(
  paths: NativeProjectPaths,
  manifest: NativeCheckpointManifest,
): void {
  for (const artifact of manifest.artifacts) {
    const reason = nativeSensitiveArtifactReason(paths, artifact.path);
    if (reason) {
      throw new Error(
        `Native checkpoint manifest contains a sensitive artifact (${reason}): ${artifact.path}`,
      );
    }
  }
}

export async function writeNativeProgressCheckpoint(
  paths: NativeProjectPaths,
  checkpoint: NativeProgressCheckpoint,
): Promise<void> {
  const parsed = parseNativeProgressCheckpointValue(checkpoint, checkpoint.change);
  const manifest = await readNativeCheckpointManifest(paths, parsed.change, parsed.manifestHash);
  const expectedInputHash = sha256Text(
    JSON.stringify({
      summary: parsed.summary,
      nextAction: parsed.nextAction,
      artifacts: manifest.artifacts,
    }),
  );
  if (
    parsed.inputHash !== expectedInputHash ||
    parsed.artifactCount !== manifest.artifacts.length
  ) {
    throw new Error('Native progress checkpoint does not match its artifact manifest');
  }
  const file = nativeProgressCheckpointFile(paths, checkpoint.change);
  await resolveContainedNativePath(paths.nativeRoot, file);
  await atomicWriteJson(file, parsed, { containedRoot: paths.nativeRoot });
}

export async function writeNativeCheckpointJournal(
  paths: NativeProjectPaths,
  journal: NativeCheckpointJournal,
): Promise<void> {
  const parsed = parseNativeCheckpointJournalValue(journal, journal.change);
  const file = nativeCheckpointJournalFile(paths, journal.change);
  await resolveContainedNativePath(paths.nativeRoot, file);
  if (await readNativeCheckpointJournal(paths, journal.change)) {
    throw new Error(`Native checkpoint recovery is already pending for ${journal.change}`);
  }
  await atomicWriteJson(file, parsed, { containedRoot: paths.nativeRoot });
}

export async function inspectNativeCheckpointFreshness(options: {
  paths: NativeProjectPaths;
  name: string;
  stateRevision: number;
}): Promise<{
  checkpoint: NativeProgressCheckpoint | null;
  manifest: NativeCheckpointManifest | null;
  freshness: 'fresh' | 'stale';
  reasons: string[];
  findings: NativeFinding[];
}> {
  let checkpoint: NativeProgressCheckpoint | null;
  try {
    checkpoint = await readNativeProgressCheckpoint(options.paths, options.name);
  } catch (error) {
    return {
      checkpoint: null,
      manifest: null,
      freshness: 'stale',
      reasons: ['checkpoint-progress-invalid'],
      findings: [
        {
          code: 'checkpoint-progress-invalid',
          message: `Native progress checkpoint is invalid: ${(error as Error).message}. Automatic repair is unavailable; inspect and move the invalid checkpoint file aside before retrying`,
          path: nativeProgressCheckpointFile(options.paths, options.name),
        },
      ],
    };
  }
  if (!checkpoint) {
    return {
      checkpoint: null,
      manifest: null,
      freshness: 'fresh',
      reasons: ['no-checkpoint'],
      findings: [],
    };
  }
  const reasons: string[] = [];
  const findings: NativeFinding[] = [];
  if (checkpoint.stateRevision !== options.stateRevision) reasons.push('state-revision-changed');
  let manifest: NativeCheckpointManifest | null = null;
  try {
    manifest = await readNativeCheckpointManifest(
      options.paths,
      options.name,
      checkpoint.manifestHash,
    );
    const expectedInputHash = sha256Text(
      JSON.stringify({
        summary: checkpoint.summary,
        nextAction: checkpoint.nextAction,
        artifacts: manifest.artifacts,
      }),
    );
    if (
      checkpoint.inputHash !== expectedInputHash ||
      checkpoint.artifactCount !== manifest.artifacts.length
    ) {
      throw new Error('Native progress checkpoint does not match its artifact manifest');
    }
    for (const expected of manifest.artifacts) {
      try {
        const actual = await hashProjectArtifact(options.paths, expected.path);
        if (actual.hash !== expected.hash || actual.size !== expected.size) {
          reasons.push(`artifact-changed:${expected.path}`);
        }
      } catch {
        reasons.push(`artifact-unavailable:${expected.path}`);
      }
    }
  } catch (error) {
    reasons.push('checkpoint-manifest-invalid');
    findings.push({
      code: 'checkpoint-manifest-invalid',
      message: `Native checkpoint manifest is invalid: ${(error as Error).message}`,
      path: nativeCheckpointManifestFile(options.paths, options.name, checkpoint.manifestHash),
    });
  }
  return {
    checkpoint,
    manifest,
    freshness: reasons.length === 0 ? 'fresh' : 'stale',
    reasons,
    findings,
  };
}
