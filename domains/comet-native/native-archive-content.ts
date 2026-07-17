import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { sha256Text } from './native-hash.js';
import { readNativeProtectedDirectory, readNativeProtectedFile } from './native-protected-file.js';

export interface NativeArchiveContentIdentity {
  kind: 'file' | 'directory';
  hash: string;
}

interface TreeEntry {
  ref: string;
  kind: 'directory' | 'file';
  hash?: string;
  size?: number;
}

const TREE_HASH_TAG = 'comet.native.archive-tree.v1';
export const NATIVE_ARCHIVE_CONTENT_LIMITS = {
  maxDepth: 128,
  maxEntries: 20_000,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxManifestBytes: 16 * 1024 * 1024,
  maxRefBytes: 4 * 1024,
} as const;

export interface NativeArchiveContentLimits {
  maxDepth: number;
  maxEntries: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxManifestBytes: number;
  maxRefBytes: number;
}

interface TreeWalkBudget {
  entryCount: number;
  totalBytes: number;
  manifestBytes: number;
}

function normalizedLimits(limits: Partial<NativeArchiveContentLimits>): NativeArchiveContentLimits {
  const resolved = { ...NATIVE_ARCHIVE_CONTENT_LIMITS, ...limits };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Native Archive content limit ${name} must be a positive safe integer`);
    }
  }
  return resolved;
}

function directorySnapshot(
  entries: Awaited<ReturnType<typeof readNativeProtectedDirectory>>['entries'],
): string {
  return JSON.stringify(
    entries
      .map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory()
          ? 'directory'
          : entry.isFile()
            ? 'file'
            : entry.isSymbolicLink()
              ? 'symlink'
              : 'other',
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  );
}

function appendTreeEntry(
  entries: TreeEntry[],
  entry: TreeEntry,
  budget: TreeWalkBudget,
  limits: NativeArchiveContentLimits,
): void {
  budget.entryCount += 1;
  if (budget.entryCount > limits.maxEntries) {
    throw new Error(`Native Archive content exceeds ${limits.maxEntries} entries`);
  }
  if (Buffer.byteLength(entry.ref, 'utf8') > limits.maxRefBytes) {
    throw new Error(`Native Archive content ref exceeds ${limits.maxRefBytes} bytes: ${entry.ref}`);
  }
  const entryBytes = Buffer.byteLength(JSON.stringify(entry), 'utf8');
  budget.manifestBytes += entryBytes + (entries.length === 0 ? 0 : 1);
  if (budget.manifestBytes + 2 > limits.maxManifestBytes) {
    throw new Error(`Native Archive content manifest exceeds ${limits.maxManifestBytes} bytes`);
  }
  entries.push(entry);
}

async function walkArchiveTree(
  root: string,
  directory: string,
  entries: TreeEntry[],
  budget: TreeWalkBudget,
  limits: NativeArchiveContentLimits,
  depth: number,
): Promise<void> {
  if (depth > limits.maxDepth) {
    throw new Error(`Native Archive content exceeds depth ${limits.maxDepth}`);
  }
  const protectedDirectory = await readNativeProtectedDirectory({
    root,
    directory,
    label: `Native Archive content directory ${path.relative(root, directory) || '.'}`,
    maxEntries: limits.maxEntries,
  });
  const beforeSnapshot = directorySnapshot(protectedDirectory.entries);
  const children = [...protectedDirectory.entries];
  children.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    await protectedDirectory.verify();
    const target = path.join(directory, child.name);
    const ref = path.relative(root, target).replaceAll('\\', '/');
    const stat = await fs.lstat(target);
    if (child.isSymbolicLink() || stat.isSymbolicLink()) {
      throw new Error(`Native Archive content must not contain symlinks or junctions: ${ref}`);
    }
    if (child.isDirectory() && stat.isDirectory()) {
      appendTreeEntry(entries, { ref, kind: 'directory' }, budget, limits);
      await walkArchiveTree(root, target, entries, budget, limits, depth + 1);
      continue;
    }
    if (!child.isFile() || !stat.isFile()) {
      throw new Error(`Native Archive content must contain only files and directories: ${ref}`);
    }
    const snapshot = await readNativeProtectedFile({
      root,
      file: target,
      maxBytes: limits.maxFileBytes,
      label: `Native Archive content file ${ref}`,
    });
    budget.totalBytes += snapshot.size;
    if (budget.totalBytes > limits.maxTotalBytes) {
      throw new Error(`Native Archive content exceeds ${limits.maxTotalBytes} total file bytes`);
    }
    appendTreeEntry(
      entries,
      { ref, kind: 'file', hash: snapshot.hash, size: snapshot.size },
      budget,
      limits,
    );
    await protectedDirectory.verify();
  }
  await protectedDirectory.verify();
  const afterDirectory = await readNativeProtectedDirectory({
    root,
    directory,
    label: `Native Archive content directory ${path.relative(root, directory) || '.'}`,
    maxEntries: limits.maxEntries,
  });
  if (directorySnapshot(afterDirectory.entries) !== beforeSnapshot) {
    throw new Error(
      `Native Archive content directory changed while reading: ${path.relative(root, directory) || '.'}`,
    );
  }
  await Promise.all([protectedDirectory.verify(), afterDirectory.verify()]);
}

/** Hash the complete change tree without embedding its absolute location. */
export async function hashNativeArchiveTree(
  directory: string,
  requestedLimits: Partial<NativeArchiveContentLimits> = {},
): Promise<string> {
  const limits = normalizedLimits(requestedLimits);
  directory = path.resolve(directory);
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Native Archive move source must be a real directory: ${directory}`);
  }
  const entries: TreeEntry[] = [];
  const budget: TreeWalkBudget = { entryCount: 0, totalBytes: 0, manifestBytes: 0 };
  await walkArchiveTree(directory, directory, entries, budget, limits, 0);
  const manifest = JSON.stringify(entries);
  if (Buffer.byteLength(manifest, 'utf8') > limits.maxManifestBytes) {
    throw new Error(`Native Archive content manifest exceeds ${limits.maxManifestBytes} bytes`);
  }
  return sha256Text(`${TREE_HASH_TAG}\0${manifest}`);
}

export async function inspectNativeArchiveContent(
  target: string,
  requestedLimits: Partial<NativeArchiveContentLimits> = {},
): Promise<NativeArchiveContentIdentity | null> {
  const limits = normalizedLimits(requestedLimits);
  target = path.resolve(target);
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`Native Archive transaction path must not be a symlink or junction: ${target}`);
  }
  if (stat.isFile()) {
    const snapshot = await readNativeProtectedFile({
      root: path.dirname(target),
      file: target,
      maxBytes: limits.maxFileBytes,
      label: `Native Archive transaction file ${path.basename(target)}`,
    });
    return { kind: 'file', hash: snapshot.hash };
  }
  if (stat.isDirectory()) {
    return { kind: 'directory', hash: await hashNativeArchiveTree(target, limits) };
  }
  throw new Error(`Native Archive transaction path has an unsupported file type: ${target}`);
}

export function isNativeArchiveHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

export function hashNativeArchiveBytes(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}
