import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import { atomicWriteBytes } from './native-atomic-file.js';

export interface NativeProtectedFileHooks {
  afterParentChainCaptured?: () => void | Promise<void>;
  afterOpen?: () => void | Promise<void>;
  beforeRead?: () => void | Promise<void>;
  beforeFinalCheck?: () => void | Promise<void>;
  beforeTargetCommit?: () => void | Promise<void>;
}

export interface NativeProtectedFile {
  bytes: Buffer;
  hash: string;
  size: number;
}

export interface NativeProtectedTextFile extends NativeProtectedFile {
  text: string;
}

interface DirectoryIdentity {
  path: string;
  realPath: string;
  dev: number;
  ino: number;
  birthtimeMs: number;
}

interface FileIdentity {
  dev: number;
  ino: number;
  birthtimeMs: number;
  ctimeMs: number;
  mtimeMs: number;
  size: number;
}

function isInside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function positiveLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Native protected file byte limit must be a positive integer');
  }
  return value;
}

function sameDirectoryIdentity(
  expected: DirectoryIdentity,
  actual: import('node:fs').Stats,
): boolean {
  if (expected.dev !== 0 || expected.ino !== 0 || actual.dev !== 0 || actual.ino !== 0) {
    return expected.dev === actual.dev && expected.ino === actual.ino;
  }
  return expected.birthtimeMs === actual.birthtimeMs;
}

function asFileIdentity(stat: import('node:fs').Stats): FileIdentity {
  return {
    dev: stat.dev,
    ino: stat.ino,
    birthtimeMs: stat.birthtimeMs,
    ctimeMs: stat.ctimeMs,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

function sameFileIdentity(expected: FileIdentity, actual: import('node:fs').Stats): boolean {
  const sameObject =
    expected.dev !== 0 || expected.ino !== 0 || actual.dev !== 0 || actual.ino !== 0
      ? expected.dev === actual.dev && expected.ino === actual.ino
      : expected.birthtimeMs === actual.birthtimeMs;
  return (
    sameObject &&
    expected.birthtimeMs === actual.birthtimeMs &&
    expected.ctimeMs === actual.ctimeMs &&
    expected.mtimeMs === actual.mtimeMs &&
    expected.size === actual.size
  );
}

async function captureDirectoryIdentity(
  directory: string,
  label: string,
): Promise<DirectoryIdentity> {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} parent must be a real directory: ${directory}`);
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
  label: string,
): Promise<DirectoryIdentity[]> {
  const lexicalRoot = path.resolve(root);
  const lexicalDirectory = path.resolve(directory);
  if (!isInside(lexicalRoot, lexicalDirectory)) {
    throw new Error(`${label} is outside its managed root`);
  }
  const chain = [await captureDirectoryIdentity(lexicalRoot, label)];
  let cursor = lexicalRoot;
  for (const segment of path
    .relative(lexicalRoot, lexicalDirectory)
    .split(path.sep)
    .filter(Boolean)) {
    await verifyDirectoryChain(chain, label);
    cursor = path.join(cursor, segment);
    const identity = await captureDirectoryIdentity(cursor, label);
    if (!isInside(chain[0].realPath, identity.realPath)) {
      throw new Error(`${label} parent resolves outside its managed root: ${cursor}`);
    }
    chain.push(identity);
  }
  await verifyDirectoryChain(chain, label);
  return chain;
}

async function verifyDirectoryChain(
  chain: readonly DirectoryIdentity[],
  label: string,
): Promise<void> {
  for (const identity of chain) {
    const stat = await fs.lstat(identity.path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !sameDirectoryIdentity(identity, stat) ||
      (await fs.realpath(identity.path)) !== identity.realPath
    ) {
      throw new Error(`${label} parent changed during I/O: ${identity.path}`);
    }
  }
}

async function readHandleBounded(
  handle: Awaited<ReturnType<typeof fs.open>>,
  maxBytes: number,
  label: string,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
  while (true) {
    const remaining = maxBytes + 1 - total;
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, remaining), null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
  }
  return Buffer.concat(chunks, total);
}

export async function readNativeProtectedFile(options: {
  root: string;
  file: string;
  maxBytes: number;
  label: string;
  forbiddenRoots?: readonly string[];
  hooks?: NativeProtectedFileHooks;
}): Promise<NativeProtectedFile> {
  const maxBytes = positiveLimit(options.maxBytes);
  const file = path.resolve(options.file);
  const chain = await captureDirectoryChain(options.root, path.dirname(file), options.label);
  const forbidden = await Promise.all(
    (options.forbiddenRoots ?? []).map((root) =>
      captureDirectoryIdentity(path.resolve(root), options.label),
    ),
  );
  await options.hooks?.afterParentChainCaptured?.();
  await verifyDirectoryChain(chain, options.label);
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`${options.label} must be a regular file`);
  }
  if (before.size > maxBytes) throw new Error(`${options.label} exceeds ${maxBytes} bytes`);
  const beforeIdentity = asFileIdentity(before);
  const beforeRealPath = await fs.realpath(file);
  if (!isInside(chain[0].realPath, beforeRealPath)) {
    throw new Error(`${options.label} resolves outside its managed root`);
  }
  if (forbidden.some((identity) => isInside(identity.realPath, beforeRealPath))) {
    throw new Error(`${options.label} resolves inside an excluded root`);
  }
  const flags =
    process.platform === 'win32'
      ? fsConstants.O_RDONLY
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
  const handle = await fs.open(file, flags);
  try {
    const opened = await handle.stat();
    await options.hooks?.afterOpen?.();
    const [pathAfterOpen, realPathAfterOpen] = await Promise.all([
      fs.lstat(file),
      fs.realpath(file),
    ]);
    await verifyDirectoryChain(chain, options.label);
    await verifyDirectoryChain(forbidden, options.label);
    if (
      !opened.isFile() ||
      !pathAfterOpen.isFile() ||
      pathAfterOpen.isSymbolicLink() ||
      realPathAfterOpen !== beforeRealPath ||
      !sameFileIdentity(beforeIdentity, opened) ||
      !sameFileIdentity(beforeIdentity, pathAfterOpen)
    ) {
      throw new Error(`${options.label} changed while opening`);
    }
    await options.hooks?.beforeRead?.();
    const bytes = await readHandleBounded(handle, maxBytes, options.label);
    await options.hooks?.beforeFinalCheck?.();
    const [afterHandle, afterPath, afterRealPath] = await Promise.all([
      handle.stat(),
      fs.lstat(file),
      fs.realpath(file),
    ]);
    await verifyDirectoryChain(chain, options.label);
    await verifyDirectoryChain(forbidden, options.label);
    if (
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      afterRealPath !== beforeRealPath ||
      !sameFileIdentity(beforeIdentity, afterHandle) ||
      !sameFileIdentity(beforeIdentity, afterPath)
    ) {
      throw new Error(`${options.label} changed while reading`);
    }
    return {
      bytes,
      hash: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
    };
  } finally {
    await handle.close();
  }
}

export async function readNativeProtectedTextFile(options: {
  root: string;
  file: string;
  maxBytes: number;
  label: string;
  forbiddenRoots?: readonly string[];
  hooks?: NativeProtectedFileHooks;
}): Promise<NativeProtectedTextFile> {
  const snapshot = await readNativeProtectedFile(options);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes);
  } catch (error) {
    throw new Error(`${options.label} is not valid UTF-8`, { cause: error });
  }
  return { ...snapshot, text };
}

export async function readNativeProtectedDirectory(options: {
  root: string;
  directory: string;
  label: string;
  maxEntries?: number;
}): Promise<{ entries: Dirent[]; verify: () => Promise<void> }> {
  const chain = await captureDirectoryChain(options.root, options.directory, options.label);
  let entries: Dirent[];
  if (options.maxEntries === undefined) {
    entries = await fs.readdir(options.directory, { withFileTypes: true });
  } else {
    const maxEntries = positiveLimit(options.maxEntries);
    entries = [];
    const directory = await fs.opendir(options.directory);
    try {
      for await (const entry of directory) {
        entries.push(entry);
        if (entries.length > maxEntries) {
          throw new Error(`${options.label} exceeds ${maxEntries} entries`);
        }
      }
    } finally {
      await directory.close().catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ERR_DIR_CLOSED') throw error;
      });
    }
  }
  await verifyDirectoryChain(chain, options.label);
  return {
    entries,
    verify: () => verifyDirectoryChain(chain, options.label),
  };
}

export async function captureNativeProtectedDirectoryGuard(options: {
  root: string;
  directory: string;
  label: string;
}): Promise<{ verify: () => Promise<void> }> {
  const chain = await captureDirectoryChain(options.root, options.directory, options.label);
  return { verify: () => verifyDirectoryChain(chain, options.label) };
}

interface NativeProtectedQuarantineGuard {
  quarantine: string;
  parentChain: DirectoryIdentity[];
  identity: DirectoryIdentity;
}

async function quarantineNativeProtectedDirectoryInternal(options: {
  root: string;
  directory: string;
  quarantine: string;
  label: string;
  beforeQuarantine?: () => void | Promise<void>;
  afterQuarantine?: (quarantine: string) => void | Promise<void>;
}): Promise<NativeProtectedQuarantineGuard> {
  const directory = path.resolve(options.directory);
  const quarantine = path.resolve(options.quarantine);
  if (
    path.dirname(quarantine) !== path.dirname(directory) ||
    !isInside(path.resolve(options.root), quarantine) ||
    quarantine === directory
  ) {
    throw new Error(`${options.label} quarantine must be a distinct sibling inside its root`);
  }
  const parentChain = await captureDirectoryChain(
    options.root,
    path.dirname(directory),
    options.label,
  );
  const identity = await captureDirectoryIdentity(directory, options.label);
  if (!isInside(parentChain[0].realPath, identity.realPath)) {
    throw new Error(`${options.label} resolves outside its managed root`);
  }
  await options.beforeQuarantine?.();
  await verifyDirectoryChain(parentChain, options.label);
  const current = await fs.lstat(directory);
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    !sameDirectoryIdentity(identity, current) ||
    (await fs.realpath(directory)) !== identity.realPath
  ) {
    throw new Error(`${options.label} changed before quarantine`);
  }

  try {
    await fs.lstat(quarantine);
    throw new Error(`${options.label} quarantine path is occupied`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await fs.rename(directory, quarantine);
  await verifyDirectoryChain(parentChain, options.label);
  const quarantined = await fs.lstat(quarantine);
  if (
    !quarantined.isDirectory() ||
    quarantined.isSymbolicLink() ||
    !sameDirectoryIdentity(identity, quarantined)
  ) {
    throw new Error(`${options.label} changed while quarantining`);
  }
  await options.afterQuarantine?.(quarantine);
  try {
    await fs.lstat(directory);
    throw new Error(`${options.label} path was recreated while quarantining`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { quarantine, parentChain, identity };
}

export async function quarantineNativeProtectedDirectory(options: {
  root: string;
  directory: string;
  quarantine: string;
  label: string;
  beforeQuarantine?: () => void | Promise<void>;
  afterQuarantine?: (quarantine: string) => void | Promise<void>;
}): Promise<void> {
  await quarantineNativeProtectedDirectoryInternal(options);
}

export async function removeNativeProtectedDirectory(options: {
  root: string;
  directory: string;
  quarantine: string;
  label: string;
  beforeQuarantine?: () => void | Promise<void>;
  afterQuarantine?: (quarantine: string) => void | Promise<void>;
  beforeRemove?: (quarantine: string) => void | Promise<void>;
}): Promise<void> {
  const { quarantine, parentChain, identity } =
    await quarantineNativeProtectedDirectoryInternal(options);
  await options.beforeRemove?.(quarantine);
  await verifyDirectoryChain(parentChain, options.label);
  const beforeRemove = await fs.lstat(quarantine);
  if (
    !beforeRemove.isDirectory() ||
    beforeRemove.isSymbolicLink() ||
    !sameDirectoryIdentity(identity, beforeRemove)
  ) {
    throw new Error(`${options.label} changed before removal`);
  }
  await fs.rm(quarantine, { recursive: true });
  await verifyDirectoryChain(parentChain, options.label);
}

export async function removeNativeProtectedFile(options: {
  root: string;
  file: string;
  maxBytes: number;
  expectedHash: string;
  expectedSize: number;
  label: string;
  beforeRemove?: () => void | Promise<void>;
}): Promise<void> {
  const file = path.resolve(options.file);
  const parentChain = await captureDirectoryChain(options.root, path.dirname(file), options.label);
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`${options.label} must be a regular file`);
  }
  const identity = asFileIdentity(before);
  const realPath = await fs.realpath(file);
  if (!isInside(parentChain[0].realPath, realPath)) {
    throw new Error(`${options.label} resolves outside its managed root`);
  }
  const snapshot = await readNativeProtectedFile({
    root: options.root,
    file,
    maxBytes: options.maxBytes,
    label: options.label,
  });
  if (snapshot.hash !== options.expectedHash || snapshot.size !== options.expectedSize) {
    throw new Error(`${options.label} changed before removal`);
  }
  const [afterRead, afterReadRealPath] = await Promise.all([fs.lstat(file), fs.realpath(file)]);
  if (
    !afterRead.isFile() ||
    afterRead.isSymbolicLink() ||
    !sameFileIdentity(identity, afterRead) ||
    afterReadRealPath !== realPath
  ) {
    throw new Error(`${options.label} changed while verifying removal`);
  }
  await options.beforeRemove?.();
  await verifyDirectoryChain(parentChain, options.label);
  const [current, currentRealPath] = await Promise.all([fs.lstat(file), fs.realpath(file)]);
  if (
    !current.isFile() ||
    current.isSymbolicLink() ||
    !sameFileIdentity(identity, current) ||
    currentRealPath !== realPath
  ) {
    throw new Error(`${options.label} changed before removal`);
  }
  await fs.rm(file);
  await verifyDirectoryChain(parentChain, options.label);
}

export async function removeNativeProtectedEmptyDirectory(options: {
  root: string;
  directory: string;
  label: string;
  beforeRemove?: () => void | Promise<void>;
}): Promise<void> {
  const directory = path.resolve(options.directory);
  const parentChain = await captureDirectoryChain(
    options.root,
    path.dirname(directory),
    options.label,
  );
  const identity = await captureDirectoryIdentity(directory, options.label);
  if (!isInside(parentChain[0].realPath, identity.realPath)) {
    throw new Error(`${options.label} resolves outside its managed root`);
  }
  await options.beforeRemove?.();
  await verifyDirectoryChain(parentChain, options.label);
  const current = await fs.lstat(directory);
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    !sameDirectoryIdentity(identity, current) ||
    (await fs.realpath(directory)) !== identity.realPath
  ) {
    throw new Error(`${options.label} changed before removal`);
  }
  await fs.rmdir(directory);
  await verifyDirectoryChain(parentChain, options.label);
}

export async function removeNativeProtectedQuarantine(options: {
  root: string;
  quarantine: string;
  label: string;
  beforeRemove?: (quarantine: string) => void | Promise<void>;
}): Promise<void> {
  const quarantine = path.resolve(options.quarantine);
  const parentChain = await captureDirectoryChain(
    options.root,
    path.dirname(quarantine),
    options.label,
  );
  const identity = await captureDirectoryIdentity(quarantine, options.label);
  if (!isInside(parentChain[0].realPath, identity.realPath)) {
    throw new Error(`${options.label} resolves outside its managed root`);
  }
  await options.beforeRemove?.(quarantine);
  await verifyDirectoryChain(parentChain, options.label);
  const beforeRemove = await fs.lstat(quarantine);
  if (
    !beforeRemove.isDirectory() ||
    beforeRemove.isSymbolicLink() ||
    !sameDirectoryIdentity(identity, beforeRemove) ||
    (await fs.realpath(quarantine)) !== identity.realPath
  ) {
    throw new Error(`${options.label} changed before removal`);
  }
  await fs.rm(quarantine, { recursive: true });
  await verifyDirectoryChain(parentChain, options.label);
}

export async function ensureNativeProtectedDirectory(options: {
  root: string;
  directory: string;
  label: string;
}): Promise<void> {
  const lexicalRoot = path.resolve(options.root);
  const lexicalDirectory = path.resolve(options.directory);
  if (!isInside(lexicalRoot, lexicalDirectory)) {
    throw new Error(`${options.label} is outside its managed root`);
  }
  const chain = [await captureDirectoryIdentity(lexicalRoot, options.label)];
  let cursor = lexicalRoot;
  for (const segment of path
    .relative(lexicalRoot, lexicalDirectory)
    .split(path.sep)
    .filter(Boolean)) {
    await verifyDirectoryChain(chain, options.label);
    cursor = path.join(cursor, segment);
    try {
      await fs.mkdir(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const identity = await captureDirectoryIdentity(cursor, options.label);
    if (!isInside(chain[0].realPath, identity.realPath)) {
      throw new Error(`${options.label} resolves outside its managed root: ${cursor}`);
    }
    chain.push(identity);
  }
  await verifyDirectoryChain(chain, options.label);
}

/** Move a real directory inside one managed root while binding the source object identity. */
export async function moveNativeProtectedDirectory(options: {
  root: string;
  source: string;
  target: string;
  label: string;
  beforeMove?: () => void | Promise<void>;
}): Promise<void> {
  const root = path.resolve(options.root);
  const source = path.resolve(options.source);
  const target = path.resolve(options.target);
  if (
    source === target ||
    !isInside(root, source) ||
    !isInside(root, target) ||
    isInside(source, target) ||
    isInside(target, source)
  ) {
    throw new Error(`${options.label} source and target must be distinct paths inside one root`);
  }
  await ensureNativeProtectedDirectory({
    root,
    directory: path.dirname(target),
    label: `${options.label} target parent`,
  });
  const sourceParentChain = await captureDirectoryChain(root, path.dirname(source), options.label);
  const targetParentChain = await captureDirectoryChain(root, path.dirname(target), options.label);
  const sourceIdentity = await captureDirectoryIdentity(source, options.label);
  if (!isInside(sourceParentChain[0].realPath, sourceIdentity.realPath)) {
    throw new Error(`${options.label} source resolves outside its managed root`);
  }
  try {
    await fs.lstat(target);
    throw new Error(`${options.label} target already exists`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await options.beforeMove?.();
  await Promise.all([
    verifyDirectoryChain(sourceParentChain, options.label),
    verifyDirectoryChain(targetParentChain, options.label),
  ]);
  const current = await fs.lstat(source);
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    !sameDirectoryIdentity(sourceIdentity, current) ||
    (await fs.realpath(source)) !== sourceIdentity.realPath
  ) {
    throw new Error(`${options.label} source changed before move`);
  }
  await fs.rename(source, target);
  await Promise.all([
    verifyDirectoryChain(sourceParentChain, options.label),
    verifyDirectoryChain(targetParentChain, options.label),
  ]);
  const moved = await fs.lstat(target);
  if (
    !moved.isDirectory() ||
    moved.isSymbolicLink() ||
    !sameDirectoryIdentity(sourceIdentity, moved) ||
    !isInside(sourceParentChain[0].realPath, await fs.realpath(target))
  ) {
    throw new Error(`${options.label} source identity changed while moving`);
  }
  try {
    await fs.lstat(source);
    throw new Error(`${options.label} source was recreated while moving`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function copyNativeProtectedFile(options: {
  sourceRoot: string;
  source: string;
  targetRoot: string;
  target: string;
  maxBytes: number;
  label: string;
  expectedHash?: string;
  expectedTargetHash?: string | null;
  forbiddenRoots?: readonly string[];
  exclusive?: boolean;
  hooks?: NativeProtectedFileHooks;
}): Promise<NativeProtectedFile> {
  const source = await readNativeProtectedFile({
    root: options.sourceRoot,
    file: options.source,
    maxBytes: options.maxBytes,
    label: options.label,
    hooks: options.hooks,
    forbiddenRoots: options.forbiddenRoots,
  });
  if (options.expectedHash !== undefined && source.hash !== options.expectedHash) {
    throw new Error(`${options.label} content changed before copy`);
  }
  await atomicWriteBytes(options.target, source.bytes, {
    containedRoot: options.targetRoot,
    exclusive: options.exclusive,
    beforeCommit: async () => {
      await options.hooks?.beforeTargetCommit?.();
      if (options.expectedTargetHash === undefined) return;
      if (options.expectedTargetHash === null) {
        try {
          await fs.lstat(options.target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw error;
        }
        throw new Error(`${options.label} target changed before commit`);
      }
      const target = await readNativeProtectedFile({
        root: options.targetRoot,
        file: options.target,
        maxBytes: options.maxBytes,
        label: `${options.label} existing target`,
      });
      if (target.hash !== options.expectedTargetHash) {
        throw new Error(`${options.label} target changed before commit`);
      }
    },
  });
  const persisted = await readNativeProtectedFile({
    root: options.targetRoot,
    file: options.target,
    maxBytes: options.maxBytes,
    label: `${options.label} target`,
  });
  if (persisted.hash !== source.hash || persisted.size !== source.size) {
    throw new Error(`${options.label} target could not be verified`);
  }
  return persisted;
}
