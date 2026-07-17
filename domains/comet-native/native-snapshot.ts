import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { atomicWriteJson } from './native-atomic-file.js';
import { sha256Text } from './native-hash.js';
import { isInsidePath, resolveContainedNativePath } from './native-paths.js';
import { readNativeProtectedTextFile } from './native-protected-file.js';
import { isNativeEnvFileName, NATIVE_EXCLUDED_DIRECTORY_NAMES } from './native-sensitive-paths.js';
import type {
  NativeContentSnapshotManifest,
  NativeProjectPaths,
  NativeSnapshotEntry,
  NativeSnapshotOmission,
  NativeSnapshotOmissionOverflow,
} from './native-types.js';

export const DEFAULT_NATIVE_SNAPSHOT_LIMITS = {
  maxFiles: 10_000,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxManifestBytes: 1024 * 1024,
} as const;

const MAX_RECORDED_OMISSIONS = 1_000;
const NATIVE_SNAPSHOT_MANIFEST_HARD_MAX_BYTES = 8 * 1024 * 1024;
const CHANGE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const MANIFEST_KEYS = new Set([
  'schema',
  'origin',
  'createdAt',
  'complete',
  'limits',
  'entries',
  'omitted',
  'omittedCount',
  'omissionOverflow',
]);
const LIMIT_KEYS = new Set(['maxFiles', 'maxFileBytes', 'maxTotalBytes', 'maxManifestBytes']);
const ENTRY_KEYS = new Set(['path', 'hash', 'size', 'type']);
const OMISSION_KEYS = new Set(['path', 'size', 'type', 'reason']);
const OMISSION_OVERFLOW_KEYS = new Set(['ref', 'hash', 'count']);
const SNAPSHOT_ORIGINS = new Set<NativeContentSnapshotManifest['origin']>([
  'change-created',
  'legacy-migration',
  'explicit',
]);
const OMISSION_TYPES = new Set<NativeSnapshotOmission['type']>(['file', 'directory', 'other']);
const OMISSION_REASONS = new Set<NativeSnapshotOmission['reason']>([
  'file-size',
  'file-count',
  'total-size',
  'manifest-size',
  'changed-during-read',
  'unreadable',
]);
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const UNREADABLE_ERROR_CODES = new Set(['EACCES', 'EPERM']);

interface SnapshotOptions {
  now?: Date;
  origin?: NativeContentSnapshotManifest['origin'];
  limits?: Partial<NativeContentSnapshotManifest['limits']>;
  denylist?: readonly string[];
}

function portableRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

function normalizedDenylist(projectRoot: string, values: readonly string[]): string[] {
  return values.map((value) => path.resolve(projectRoot, ...value.split(/[\\/]/u)));
}

function sameOrInside(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  return normalizedTarget === normalizedRoot || isInsidePath(normalizedRoot, normalizedTarget);
}

function isUnreadableError(error: unknown): boolean {
  return UNREADABLE_ERROR_CODES.has((error as NodeJS.ErrnoException).code ?? '');
}

function isChangedDuringReadError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function serializedManifestBytes(manifest: NativeContentSnapshotManifest): number {
  return Buffer.byteLength(JSON.stringify(manifest, null, 2) + '\n');
}

function sameFileIdentity(left: import('fs').Stats, right: import('fs').Stats): boolean {
  if (left.dev !== 0 || left.ino !== 0 || right.dev !== 0 || right.ino !== 0) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return (
    left.birthtimeMs === right.birthtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.size === right.size
  );
}

async function sha256FileBounded(
  file: string,
  maxBytes: number,
  expected: import('fs').Stats,
): Promise<
  | { status: 'complete'; hash: string; bytes: number; finalStat: import('fs').Stats }
  | { status: 'changed' }
> {
  const handle = await fs.open(file, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
  let bytes = 0;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFileIdentity(expected, opened)) return { status: 'changed' };
    while (true) {
      const remaining = maxBytes + 1 - bytes;
      if (remaining < 1) return { status: 'changed' };
      const result = await handle.read(buffer, 0, Math.min(buffer.length, remaining), null);
      if (result.bytesRead === 0) {
        const finalStat = await handle.stat();
        if (!finalStat.isFile() || !sameFileIdentity(opened, finalStat)) {
          return { status: 'changed' };
        }
        return { status: 'complete', hash: hash.digest('hex'), bytes, finalStat };
      }
      if (bytes + result.bytesRead > maxBytes) return { status: 'changed' };
      hash.update(buffer.subarray(0, result.bytesRead));
      bytes += result.bytesRead;
    }
  } finally {
    await handle.close();
  }
}

function omissionType(child: import('fs').Dirent): NativeSnapshotOmission['type'] {
  if (child.isFile()) return 'file';
  if (child.isDirectory()) return 'directory';
  return 'other';
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, keys: Set<string>, label: string): void {
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown) throw new Error(`${label} contains unknown field: ${unknown}`);
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

function snapshotPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\')) {
    throw new Error(`${label} must be a normalized project-relative path`);
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value ||
    path.posix.isAbsolute(value) ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error(`${label} must stay inside the project root`);
  }
  return value;
}

function parseEntry(value: unknown, index: number): NativeSnapshotEntry {
  const entry = record(value, `Native snapshot entry ${index}`);
  rejectUnknown(entry, ENTRY_KEYS, `Native snapshot entry ${index}`);
  const entryPath = snapshotPath(entry.path, `Native snapshot entry ${index} path`);
  if (typeof entry.hash !== 'string' || !HASH_PATTERN.test(entry.hash)) {
    throw new Error(`Native snapshot entry ${index} hash is invalid`);
  }
  if (entry.type !== 'file') throw new Error(`Native snapshot entry ${index} type is invalid`);
  return {
    path: entryPath,
    hash: entry.hash,
    size: nonNegativeInteger(entry.size, `Native snapshot entry ${index} size`),
    type: 'file',
  };
}

function parseOmission(value: unknown, index: number): NativeSnapshotOmission {
  const omission = record(value, `Native snapshot omission ${index}`);
  rejectUnknown(omission, OMISSION_KEYS, `Native snapshot omission ${index}`);
  if (!OMISSION_TYPES.has(omission.type as NativeSnapshotOmission['type'])) {
    throw new Error(`Native snapshot omission ${index} type is invalid`);
  }
  if (!OMISSION_REASONS.has(omission.reason as NativeSnapshotOmission['reason'])) {
    throw new Error(`Native snapshot omission ${index} reason is invalid`);
  }
  return {
    path: snapshotPath(omission.path, `Native snapshot omission ${index} path`),
    size:
      omission.size === null
        ? null
        : nonNegativeInteger(omission.size, `Native snapshot omission ${index} size`),
    type: omission.type as NativeSnapshotOmission['type'],
    reason: omission.reason as NativeSnapshotOmission['reason'],
  };
}

function parseOmissionOverflow(value: unknown): NativeSnapshotOmissionOverflow {
  const overflow = record(value, 'Native snapshot omission overflow');
  rejectUnknown(overflow, OMISSION_OVERFLOW_KEYS, 'Native snapshot omission overflow');
  if (typeof overflow.hash !== 'string' || !HASH_PATTERN.test(overflow.hash)) {
    throw new Error('Native snapshot omission overflow hash is invalid');
  }
  const expectedRef = `native-snapshot://omitted-overflow/${overflow.hash}`;
  if (overflow.ref !== expectedRef) {
    throw new Error('Native snapshot omission overflow ref is invalid');
  }
  return {
    ref: expectedRef,
    hash: overflow.hash,
    count: positiveInteger(overflow.count, 'Native snapshot omission overflow count'),
  };
}

export function parseNativeContentSnapshotManifest(value: unknown): NativeContentSnapshotManifest {
  const manifest = record(value, 'Native content snapshot manifest');
  rejectUnknown(manifest, MANIFEST_KEYS, 'Native content snapshot manifest');
  if (manifest.schema !== 'comet.native.content-snapshot.v1') {
    throw new Error('Unsupported Native content snapshot schema');
  }
  if (!SNAPSHOT_ORIGINS.has(manifest.origin as NativeContentSnapshotManifest['origin'])) {
    throw new Error('Native content snapshot origin is invalid');
  }
  if (typeof manifest.createdAt !== 'string' || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error('Native content snapshot timestamp is invalid');
  }
  if (typeof manifest.complete !== 'boolean') {
    throw new Error('Native content snapshot complete flag is invalid');
  }
  const limitValue = record(manifest.limits, 'Native content snapshot limits');
  rejectUnknown(limitValue, LIMIT_KEYS, 'Native content snapshot limits');
  const limits = {
    maxFiles: positiveInteger(limitValue.maxFiles, 'Native snapshot maxFiles'),
    maxFileBytes: positiveInteger(limitValue.maxFileBytes, 'Native snapshot maxFileBytes'),
    maxTotalBytes: positiveInteger(limitValue.maxTotalBytes, 'Native snapshot maxTotalBytes'),
    maxManifestBytes: positiveInteger(
      limitValue.maxManifestBytes,
      'Native snapshot maxManifestBytes',
    ),
  };
  if (!Array.isArray(manifest.entries) || !Array.isArray(manifest.omitted)) {
    throw new Error('Native content snapshot entries and omissions must be arrays');
  }
  const entries = manifest.entries.map(parseEntry);
  const omitted = manifest.omitted.map(parseOmission);
  const omittedCount = nonNegativeInteger(
    manifest.omittedCount,
    'Native content snapshot omittedCount',
  );
  const omissionOverflow =
    manifest.omissionOverflow === undefined
      ? undefined
      : parseOmissionOverflow(manifest.omissionOverflow);
  if (entries.length > limits.maxFiles) {
    throw new Error('Native content snapshot exceeds its file-count limit');
  }
  if (
    entries.some((entry) => entry.size > limits.maxFileBytes) ||
    entries.reduce((total, entry) => total + entry.size, 0) > limits.maxTotalBytes
  ) {
    throw new Error('Native content snapshot exceeds its byte limits');
  }
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) {
    throw new Error('Native content snapshot contains duplicate paths');
  }
  if (omitted.length > MAX_RECORDED_OMISSIONS || omittedCount < omitted.length) {
    throw new Error('Native content snapshot omission count is invalid');
  }
  const overflowCount = omittedCount - omitted.length;
  if (
    (overflowCount === 0 && omissionOverflow) ||
    (overflowCount > 0 && omissionOverflow?.count !== overflowCount)
  ) {
    throw new Error('Native content snapshot omission overflow is inconsistent');
  }
  if (manifest.complete !== (omittedCount === 0)) {
    throw new Error('Native content snapshot completeness is inconsistent');
  }
  const parsed: NativeContentSnapshotManifest = {
    schema: 'comet.native.content-snapshot.v1',
    origin: manifest.origin as NativeContentSnapshotManifest['origin'],
    createdAt: manifest.createdAt,
    complete: manifest.complete,
    limits,
    entries,
    omitted,
    omittedCount,
    ...(omissionOverflow ? { omissionOverflow } : {}),
  };
  if (serializedManifestBytes(parsed) > limits.maxManifestBytes) {
    throw new Error('Native content snapshot exceeds its manifest byte limit');
  }
  return parsed;
}

export function nativeBaselineManifestFile(paths: NativeProjectPaths, name: string): string {
  if (!CHANGE_NAME_PATTERN.test(name)) throw new Error(`Invalid Native change name: ${name}`);
  const changeDir = path.join(paths.changesDir, name);
  if (!isInsidePath(paths.changesDir, changeDir)) throw new Error('Native change path escaped');
  return path.join(changeDir, 'runtime', 'baseline-manifest.json');
}

export async function createNativeContentSnapshot(
  paths: NativeProjectPaths,
  options: SnapshotOptions = {},
): Promise<NativeContentSnapshotManifest> {
  const limits = {
    maxFiles: options.limits?.maxFiles ?? DEFAULT_NATIVE_SNAPSHOT_LIMITS.maxFiles,
    maxFileBytes: options.limits?.maxFileBytes ?? DEFAULT_NATIVE_SNAPSHOT_LIMITS.maxFileBytes,
    maxTotalBytes: options.limits?.maxTotalBytes ?? DEFAULT_NATIVE_SNAPSHOT_LIMITS.maxTotalBytes,
    maxManifestBytes:
      options.limits?.maxManifestBytes ?? DEFAULT_NATIVE_SNAPSHOT_LIMITS.maxManifestBytes,
  };
  if (
    limits.maxFiles < 1 ||
    limits.maxFileBytes < 1 ||
    limits.maxTotalBytes < 1 ||
    limits.maxManifestBytes < 1
  ) {
    throw new Error('Native snapshot limits must be positive');
  }

  const projectRoot = path.resolve(paths.projectRoot);
  const physicalProjectRoot = await fs.realpath(projectRoot);
  const nativeRoot = path.resolve(paths.nativeRoot);
  const physicalNativeRoot = await fs.realpath(nativeRoot);
  const configFile = path.resolve(paths.configFile);
  const denylist = normalizedDenylist(projectRoot, options.denylist ?? []);
  const entries: NativeContentSnapshotManifest['entries'] = [];
  const omitted: NativeSnapshotOmission[] = [];
  let omittedCount = 0;
  let overflowCount = 0;
  let overflowHash = sha256Text('comet.native.snapshot-omission-overflow.v1');
  let totalBytes = 0;

  const foldOverflow = (value: NativeSnapshotOmission): void => {
    overflowCount += 1;
    overflowHash = sha256Text(`${overflowHash}\n${JSON.stringify(value)}`);
  };

  const omit = (value: NativeSnapshotOmission): void => {
    omittedCount += 1;
    if (omitted.length < MAX_RECORDED_OMISSIONS) {
      omitted.push(value);
      return;
    }
    foldOverflow(value);
  };

  const visit = async (directory: string): Promise<void> => {
    let children;
    try {
      children = (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) =>
        left.name.localeCompare(right.name, 'en'),
      );
    } catch (error) {
      if (directory === projectRoot) throw error;
      if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
      omit({
        path: portableRelative(projectRoot, directory),
        size: null,
        type: 'directory',
        reason: isChangedDuringReadError(error) ? 'changed-during-read' : 'unreadable',
      });
      return;
    }
    for (const child of children) {
      const target = path.join(directory, child.name);
      const relative = portableRelative(projectRoot, target);
      if (
        target === configFile ||
        sameOrInside(nativeRoot, target) ||
        denylist.some((denied) => sameOrInside(denied, target)) ||
        isNativeEnvFileName(child.name) ||
        child.name.toLowerCase() === '.git'
      ) {
        continue;
      }
      let before;
      try {
        before = await fs.lstat(target);
      } catch (error) {
        if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
        omit({
          path: relative,
          size: null,
          type: omissionType(child),
          reason: isChangedDuringReadError(error) ? 'changed-during-read' : 'unreadable',
        });
        continue;
      }
      if (child.isSymbolicLink() || before.isSymbolicLink()) continue;
      if (child.isDirectory()) {
        if (!before.isDirectory()) continue;
        if (NATIVE_EXCLUDED_DIRECTORY_NAMES.has(child.name.toLowerCase())) continue;
        let realDirectory;
        try {
          realDirectory = await fs.realpath(target);
        } catch (error) {
          if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
          omit({
            path: relative,
            size: null,
            type: 'directory',
            reason: isChangedDuringReadError(error) ? 'changed-during-read' : 'unreadable',
          });
          continue;
        }
        if (
          !isInsidePath(physicalProjectRoot, realDirectory) ||
          sameOrInside(physicalNativeRoot, realDirectory)
        ) {
          continue;
        }
        await visit(target);
        continue;
      }
      if (!child.isFile()) continue;

      if (!before.isFile() || before.isSymbolicLink()) continue;
      let realTarget;
      try {
        realTarget = await fs.realpath(target);
      } catch (error) {
        if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
        omit({
          path: relative,
          size: before.size,
          type: 'file',
          reason: isChangedDuringReadError(error) ? 'changed-during-read' : 'unreadable',
        });
        continue;
      }
      if (
        !isInsidePath(physicalProjectRoot, realTarget) ||
        sameOrInside(physicalNativeRoot, realTarget)
      ) {
        continue;
      }
      if (entries.length >= limits.maxFiles) {
        omit({ path: relative, size: before.size, type: 'file', reason: 'file-count' });
        continue;
      }
      if (before.size > limits.maxFileBytes) {
        omit({ path: relative, size: before.size, type: 'file', reason: 'file-size' });
        continue;
      }
      if (totalBytes + before.size > limits.maxTotalBytes) {
        omit({ path: relative, size: before.size, type: 'file', reason: 'total-size' });
        continue;
      }
      let boundedHash;
      let after;
      let afterRealTarget;
      try {
        boundedHash = await sha256FileBounded(realTarget, before.size, before);
        if (boundedHash.status === 'changed') {
          omit({
            path: relative,
            size: null,
            type: 'file',
            reason: 'changed-during-read',
          });
          continue;
        }
        afterRealTarget = await fs.realpath(target);
        after = await fs.lstat(target);
      } catch (error) {
        if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
        omit({
          path: relative,
          size: before.size,
          type: 'file',
          reason: isChangedDuringReadError(error) ? 'changed-during-read' : 'unreadable',
        });
        continue;
      }
      if (
        boundedHash.bytes !== before.size ||
        afterRealTarget !== realTarget ||
        !sameFileIdentity(before, boundedHash.finalStat) ||
        !sameFileIdentity(boundedHash.finalStat, after) ||
        !after.isFile() ||
        after.isSymbolicLink() ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs
      ) {
        omit({
          path: relative,
          size: after.isFile() ? after.size : null,
          type: after.isFile() ? 'file' : 'other',
          reason: 'changed-during-read',
        });
        continue;
      }
      entries.push({ path: relative, hash: boundedHash.hash, size: after.size, type: 'file' });
      totalBytes += after.size;
    }
  };

  await visit(projectRoot);
  entries.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  omitted.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const buildManifest = (): NativeContentSnapshotManifest => ({
    schema: 'comet.native.content-snapshot.v1',
    origin: options.origin ?? 'explicit',
    createdAt: (options.now ?? new Date()).toISOString(),
    complete: omittedCount === 0,
    limits,
    entries,
    omitted,
    omittedCount,
    ...(overflowCount > 0
      ? {
          omissionOverflow: {
            ref: `native-snapshot://omitted-overflow/${overflowHash}`,
            hash: overflowHash,
            count: overflowCount,
          },
        }
      : {}),
  });

  let manifest = buildManifest();
  while (serializedManifestBytes(manifest) > limits.maxManifestBytes) {
    if (omitted.length > 0) {
      const removeCount = Math.max(1, Math.ceil(omitted.length / 4));
      for (const value of omitted.splice(-removeCount)) foldOverflow(value);
    } else if (entries.length > 0) {
      const removeCount = Math.max(1, Math.ceil(entries.length / 4));
      for (const entry of entries.splice(-removeCount)) {
        omittedCount += 1;
        foldOverflow({
          path: entry.path,
          size: entry.size,
          type: 'file',
          reason: 'manifest-size',
        });
      }
    } else {
      throw new Error('Native snapshot manifest byte limit is too small for its metadata');
    }
    manifest = buildManifest();
  }
  return manifest;
}

export async function writeNativeBaselineManifest(
  paths: NativeProjectPaths,
  name: string,
  manifest: NativeContentSnapshotManifest,
): Promise<void> {
  const file = nativeBaselineManifestFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  await atomicWriteJson(file, parseNativeContentSnapshotManifest(manifest));
}

export async function readNativeBaselineManifest(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeContentSnapshotManifest | null> {
  const file = nativeBaselineManifestFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    const source = await readNativeProtectedTextFile({
      root: paths.nativeRoot,
      file,
      maxBytes: NATIVE_SNAPSHOT_MANIFEST_HARD_MAX_BYTES,
      label: 'Native baseline snapshot manifest',
    });
    return parseNativeContentSnapshotManifest(JSON.parse(source.text));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
