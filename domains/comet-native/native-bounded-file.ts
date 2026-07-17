import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import { nativeSensitiveRelativePathReason } from './native-sensitive-paths.js';

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
  if (identity.dev !== 0 || identity.ino !== 0 || stat.dev !== 0 || stat.ino !== 0) {
    return identity.dev === stat.dev && identity.ino === stat.ino;
  }
  return identity.birthtimeMs === stat.birthtimeMs;
}

function sameFileIdentity(left: import('node:fs').Stats, right: import('node:fs').Stats): boolean {
  if (left.dev !== 0 || left.ino !== 0 || right.dev !== 0 || right.ino !== 0) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return (
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

export async function readNativeBoundedTextFile(options: {
  root: string;
  ref: string;
  maxBytes?: number;
  hooks?: NativeBoundedFileReadHooks;
}): Promise<NativeBoundedTextFile> {
  const ref = portableArtifactRef(options.ref);
  const maxBytes = positiveLimit(options.maxBytes ?? DEFAULT_NATIVE_ARTIFACT_MAX_BYTES);
  const file = path.resolve(options.root, ...ref.split('/'));
  const chain = await captureDirectoryChain(options.root, path.dirname(file));
  await options.hooks?.afterParentChainCaptured?.();
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`Native artifact must be a regular file: ${ref}`);
  }
  if (before.size > maxBytes) throw new Error(`Native artifact exceeds ${maxBytes} bytes: ${ref}`);
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
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
    while (true) {
      const remaining = maxBytes + 1 - total;
      const result = await handle.read(buffer, 0, Math.min(buffer.length, remaining), null);
      if (result.bytesRead === 0) break;
      total += result.bytesRead;
      if (total > maxBytes) throw new Error(`Native artifact exceeds ${maxBytes} bytes: ${ref}`);
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
      hash: createHash('sha256').update(bytes).digest('hex'),
      text,
    };
  } finally {
    await handle.close();
  }
}
