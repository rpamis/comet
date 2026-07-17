import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { sha256File, sha256Text } from './native-hash.js';

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

async function walkArchiveTree(
  root: string,
  directory: string,
  entries: TreeEntry[],
): Promise<void> {
  const children = await fs.readdir(directory, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    const target = path.join(directory, child.name);
    const ref = path.relative(root, target).replaceAll('\\', '/');
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) {
      throw new Error(`Native Archive content must not contain symlinks or junctions: ${ref}`);
    }
    if (stat.isDirectory()) {
      entries.push({ ref, kind: 'directory' });
      await walkArchiveTree(root, target, entries);
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(`Native Archive content must contain only files and directories: ${ref}`);
    }
    entries.push({ ref, kind: 'file', hash: await sha256File(target), size: stat.size });
  }
}

/** Hash the complete change tree without embedding its absolute location. */
export async function hashNativeArchiveTree(directory: string): Promise<string> {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Native Archive move source must be a real directory: ${directory}`);
  }
  const entries: TreeEntry[] = [];
  await walkArchiveTree(directory, directory, entries);
  return sha256Text(`${TREE_HASH_TAG}\0${JSON.stringify(entries)}`);
}

export async function inspectNativeArchiveContent(
  target: string,
): Promise<NativeArchiveContentIdentity | null> {
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
  if (stat.isFile()) return { kind: 'file', hash: await sha256File(target) };
  if (stat.isDirectory()) return { kind: 'directory', hash: await hashNativeArchiveTree(target) };
  throw new Error(`Native Archive transaction path has an unsupported file type: ${target}`);
}

export function isNativeArchiveHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

export function hashNativeArchiveBytes(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}
