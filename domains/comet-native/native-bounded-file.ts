import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import { nativeSensitiveRelativePathReason } from './native-sensitive-paths.js';
import { hasComparableNativeFileObject, sameNativeFileObject } from './native-file-identity.js';

export const DEFAULT_NATIVE_ARTIFACT_MAX_BYTES = 1024 * 1024;

export interface NativeBoundedFileReadHooks {
  afterParentChainCaptured?: () => void | Promise<void>;
  afterOpen?: () => void | Promise<void>;
  beforeFinalCheck?: () => void | Promise<void>;
}

export interface NativeBoundedTextFile {
  ref: string;
  size: number;
  hash: string;
  text: string;
}

export interface NativeUnhashedTextFile extends Omit<NativeBoundedTextFile, 'hash'> {
  hash: null;
}

export interface NativeTextFilePrefix {
  ref: string;
  size: number;
  text: string;
  truncated: boolean;
}

interface NativeTextFileReadOptions {
  root: string;
  ref: string;
  maxBytes?: number | null;
  includeHash?: boolean;
  hooks?: NativeBoundedFileReadHooks;
}

interface NativeTextFilePrefixReadOptions {
  root: string;
  ref: string;
  maxBytes: number;
  hooks?: NativeBoundedFileReadHooks;
}

interface DirectoryIdentity {
  path: string;
  realPath: string;
  dev: number;
  ino: number;
  birthtimeMs: number;
}

function isInside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function portableArtifactRef(value: string): string {
  const normalized = path.posix.normalize(value);
  if (
    value.length === 0 ||
    value !== value.trim() ||
    value.includes('\\') ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    }) ||
    path.posix.isAbsolute(normalized) ||
    /^(?:[A-Za-z]:|~)/u.test(value) ||
    value.split('/').includes('..') ||
    normalized !== value ||
    normalized === '.' ||
    value.endsWith('/')
  ) {
    throw new Error(`Native artifact ref must be normalized and relative: ${value}`);
  }
  const lower = value.toLowerCase();
  const sensitiveReason = nativeSensitiveRelativePathReason(value);
  if (sensitiveReason || lower === 'runtime' || lower.startsWith('runtime/')) {
    throw new Error(
      `Native artifact ref is excluded as sensitive (${sensitiveReason ?? 'native-runtime'}): ${value}`,
    );
  }
  return value;
}

function positiveLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Native artifact byte limit must be a positive integer');
  }
  return value;
}

function sameDirectoryIdentity(
  identity: DirectoryIdentity,
  stat: import('node:fs').Stats,
): boolean {
  return sameNativeFileObject(
    { ...identity, birthtime: identity.birthtimeMs },
    {
      ...stat,
      birthtime: stat.birthtimeMs,
    },
  );
}

function sameFileIdentity(left: import('node:fs').Stats, right: import('node:fs').Stats): boolean {
  const leftObject = { ...left, birthtime: left.birthtimeMs };
  const rightObject = { ...right, birthtime: right.birthtimeMs };
  if (hasComparableNativeFileObject(leftObject, rightObject)) {
    return sameNativeFileObject(leftObject, rightObject);
  }
  return (
    sameNativeFileObject(leftObject, rightObject) &&
    left.birthtimeMs === right.birthtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.size === right.size
  );
}

async function directoryIdentity(directory: string): Promise<DirectoryIdentity> {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Native artifact parent must be a real directory: ${directory}`);
  }
  return {
    path: directory,
    realPath: await fs.realpath(directory),
    dev: stat.dev,
    ino: stat.ino,
    birthtimeMs: stat.birthtimeMs,
  };
}

async function captureDirectoryChain(
  root: string,
  directory: string,
): Promise<DirectoryIdentity[]> {
  const lexicalRoot = path.resolve(root);
  const lexicalDirectory = path.resolve(directory);
  if (!isInside(lexicalRoot, lexicalDirectory)) {
    throw new Error('Native artifact path is outside its root');
  }
  const chain = [await directoryIdentity(lexicalRoot)];
  let cursor = lexicalRoot;
  for (const segment of path
    .relative(lexicalRoot, lexicalDirectory)
    .split(path.sep)
    .filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const identity = await directoryIdentity(cursor);
    if (!isInside(chain[0].realPath, identity.realPath)) {
      throw new Error(`Native artifact parent resolves outside its root: ${cursor}`);
    }
    chain.push(identity);
  }
  return chain;
}

async function verifyDirectoryChain(chain: readonly DirectoryIdentity[]): Promise<void> {
  for (const identity of chain) {
    const stat = await fs.lstat(identity.path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !sameDirectoryIdentity(identity, stat) ||
      (await fs.realpath(identity.path)) !== identity.realPath
    ) {
      throw new Error(`Native artifact parent changed while reading: ${identity.path}`);
    }
  }
}

export function readNativeBoundedTextFile(
  options: NativeTextFileReadOptions & { includeHash: false },
): Promise<NativeUnhashedTextFile>;
export function readNativeBoundedTextFile(
  options: NativeTextFileReadOptions & { includeHash?: true; maxBytes?: number },
): Promise<NativeBoundedTextFile>;
export async function readNativeBoundedTextFile(
  options: NativeTextFileReadOptions,
): Promise<NativeBoundedTextFile | NativeUnhashedTextFile> {
  const ref = portableArtifactRef(options.ref);
  const maxBytes =
    options.maxBytes === null
      ? null
      : positiveLimit(options.maxBytes ?? DEFAULT_NATIVE_ARTIFACT_MAX_BYTES);
  const file = path.resolve(options.root, ...ref.split('/'));
  const chain = await captureDirectoryChain(options.root, path.dirname(file));
  await options.hooks?.afterParentChainCaptured?.();
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`Native artifact must be a regular file: ${ref}`);
  }
  if (maxBytes !== null && before.size > maxBytes) {
    throw new Error(`Native artifact exceeds ${maxBytes} bytes: ${ref}`);
  }
  const realPath = await fs.realpath(file);
  if (!isInside(chain[0].realPath, realPath)) {
    throw new Error(`Native artifact resolves outside its root: ${ref}`);
  }
  const handle = await fs.open(file, 'r');
  try {
    const [opened, afterOpenPath, afterOpenRealPath] = await Promise.all([
      handle.stat(),
      fs.lstat(file),
      fs.realpath(file),
    ]);
    await verifyDirectoryChain(chain);
    if (
      !opened.isFile() ||
      !afterOpenPath.isFile() ||
      afterOpenPath.isSymbolicLink() ||
      afterOpenRealPath !== realPath ||
      !sameFileIdentity(before, opened) ||
      !sameFileIdentity(opened, afterOpenPath)
    ) {
      throw new Error(`Native artifact changed while opening: ${ref}`);
    }
    await options.hooks?.afterOpen?.();
    const chunks: Buffer[] = [];
    let total = 0;
    const buffer = Buffer.allocUnsafe(
      maxBytes === null ? 64 * 1024 : Math.min(64 * 1024, maxBytes + 1),
    );
    while (true) {
      const remaining = maxBytes === null ? buffer.length : maxBytes + 1 - total;
      const result = await handle.read(buffer, 0, Math.min(buffer.length, remaining), null);
      if (result.bytesRead === 0) break;
      total += result.bytesRead;
      if (maxBytes !== null && total > maxBytes) {
        throw new Error(`Native artifact exceeds ${maxBytes} bytes: ${ref}`);
      }
      chunks.push(Buffer.from(buffer.subarray(0, result.bytesRead)));
    }
    await options.hooks?.beforeFinalCheck?.();
    const [afterHandle, afterPath, afterRealPath] = await Promise.all([
      handle.stat(),
      fs.lstat(file),
      fs.realpath(file),
    ]);
    await verifyDirectoryChain(chain);
    if (
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      afterRealPath !== realPath ||
      !sameFileIdentity(opened, afterHandle) ||
      !sameFileIdentity(opened, afterPath)
    ) {
      throw new Error(`Native artifact changed while reading: ${ref}`);
    }
    const bytes = Buffer.concat(chunks, total);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      throw new Error(`Native artifact is not valid UTF-8: ${ref}`, { cause: error });
    }
    return {
      ref,
      size: total,
      hash: options.includeHash === false ? null : createHash('sha256').update(bytes).digest('hex'),
      text,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Read a display prefix without making the file's total size the read budget.
 * The returned size comes from the verified open file, while at most maxBytes
 * are read into memory.
 */
export async function readNativeTextFilePrefix(
  options: NativeTextFilePrefixReadOptions,
): Promise<NativeTextFilePrefix> {
  const ref = portableArtifactRef(options.ref);
  const maxBytes = positiveLimit(options.maxBytes);
  const file = path.resolve(options.root, ...ref.split('/'));
  const chain = await captureDirectoryChain(options.root, path.dirname(file));
  await options.hooks?.afterParentChainCaptured?.();
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`Native artifact must be a regular file: ${ref}`);
  }
  const realPath = await fs.realpath(file);
  if (!isInside(chain[0].realPath, realPath)) {
    throw new Error(`Native artifact resolves outside its root: ${ref}`);
  }
  const handle = await fs.open(file, 'r');
  try {
    const [opened, afterOpenPath, afterOpenRealPath] = await Promise.all([
      handle.stat(),
      fs.lstat(file),
      fs.realpath(file),
    ]);
    await verifyDirectoryChain(chain);
    if (
      !opened.isFile() ||
      !afterOpenPath.isFile() ||
      afterOpenPath.isSymbolicLink() ||
      afterOpenRealPath !== realPath ||
      !sameFileIdentity(before, opened) ||
      !sameFileIdentity(opened, afterOpenPath)
    ) {
      throw new Error(`Native artifact changed while opening: ${ref}`);
    }
    await options.hooks?.afterOpen?.();

    const targetBytes = Math.min(opened.size, maxBytes);
    const chunks: Buffer[] = [];
    let total = 0;
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes));
    while (total < targetBytes) {
      const result = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, targetBytes - total),
        null,
      );
      if (result.bytesRead === 0) break;
      total += result.bytesRead;
      chunks.push(Buffer.from(buffer.subarray(0, result.bytesRead)));
    }

    await options.hooks?.beforeFinalCheck?.();
    const [afterHandle, afterPath, afterRealPath] = await Promise.all([
      handle.stat(),
      fs.lstat(file),
      fs.realpath(file),
    ]);
    await verifyDirectoryChain(chain);
    if (
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      afterRealPath !== realPath ||
      !sameFileIdentity(opened, afterHandle) ||
      !sameFileIdentity(opened, afterPath) ||
      total !== targetBytes
    ) {
      throw new Error(`Native artifact changed while reading: ${ref}`);
    }

    const truncated = opened.size > maxBytes;
    const bytes = Buffer.concat(chunks, total);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: truncated });
    } catch (error) {
      throw new Error(`Native artifact prefix is not valid UTF-8: ${ref}`, { cause: error });
    }
    return { ref, size: opened.size, text, truncated };
  } finally {
    await handle.close();
  }
}
