import { randomUUID } from 'crypto';
import { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';

import { sameFileObject, type FileObjectIdentity } from '../../platform/fs/file-identity.js';

export interface ContainedAtomicWriteOptions {
  containedRoot: string;
  beforeTemporaryOpen?: () => void | Promise<void>;
  beforeCommit?: () => void | Promise<void>;
  exclusive?: boolean;
}

export interface ContainedFileRemoveOptions {
  containedRoot: string;
  beforeRemove?: () => void | Promise<void>;
}

interface DirectoryIdentity extends FileObjectIdentity {
  path: string;
  realPath: string;
}

export async function publishFileExclusively(
  source: string,
  destination: string,
): Promise<{ linked: boolean }> {
  try {
    await fs.link(source, destination);
    return { linked: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOTSUP' && code !== 'EOPNOTSUPP') throw error;
  }

  await fs.copyFile(source, destination, fsConstants.COPYFILE_EXCL);
  return { linked: false };
}

function isInside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function statsIdentity(stat: import('fs').Stats): FileObjectIdentity {
  return {
    dev: stat.dev,
    ino: stat.ino,
    birthtime: stat.birthtimeMs,
  };
}

function sameDirectoryIdentity(identity: DirectoryIdentity, stat: import('fs').Stats): boolean {
  return sameFileObject(identity, statsIdentity(stat));
}

function sameFileIdentity(left: import('fs').Stats, right: import('fs').Stats): boolean {
  // On file systems without stable file ids (exFAT, FAT, some network mounts)
  // the comparison degrades to birthtime. ctime and size change with every
  // legitimate write, so they cannot distinguish tampering from our own write.
  return sameFileObject(statsIdentity(left), statsIdentity(right));
}

function sameUnchangedFile(left: import('fs').Stats, right: import('fs').Stats): boolean {
  // Linux may immediately reuse an inode after unlink, so object identity alone
  // cannot prove that a path still names the post-write snapshot. These fields
  // are safe to compare only after our own write has finished.
  return (
    sameFileIdentity(left, right) &&
    left.birthtimeMs === right.birthtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size
  );
}

async function captureDirectoryIdentity(directory: string): Promise<DirectoryIdentity> {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Contained atomic write parent must be a real directory: ${directory}`);
  }
  return {
    path: directory,
    realPath: await fs.realpath(directory),
    ...statsIdentity(stat),
  };
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
      throw new Error(`Contained atomic write parent changed before commit: ${identity.path}`);
    }
  }
}

async function prepareContainedDirectoryChain(
  root: string,
  directory: string,
): Promise<DirectoryIdentity[]> {
  const lexicalRoot = path.resolve(root);
  const lexicalDirectory = path.resolve(directory);
  if (!isInside(lexicalRoot, lexicalDirectory)) {
    throw new Error(`Contained atomic write parent is outside its managed root: ${directory}`);
  }

  const chain: DirectoryIdentity[] = [await captureDirectoryIdentity(lexicalRoot)];
  const segments = path.relative(lexicalRoot, lexicalDirectory).split(path.sep).filter(Boolean);
  let cursor = lexicalRoot;
  for (const segment of segments) {
    await verifyDirectoryChain(chain);
    cursor = path.join(cursor, segment);
    try {
      await fs.mkdir(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const identity = await captureDirectoryIdentity(cursor);
    if (!isInside(chain[0].realPath, identity.realPath)) {
      throw new Error(`Contained atomic write parent resolves outside its managed root: ${cursor}`);
    }
    chain.push(identity);
  }
  await verifyDirectoryChain(chain);
  return chain;
}

async function captureExistingContainedDirectoryChain(
  root: string,
  directory: string,
): Promise<DirectoryIdentity[] | null> {
  const lexicalRoot = path.resolve(root);
  const lexicalDirectory = path.resolve(directory);
  if (!isInside(lexicalRoot, lexicalDirectory)) {
    throw new Error(`Contained file parent is outside its managed root: ${directory}`);
  }
  const chain: DirectoryIdentity[] = [await captureDirectoryIdentity(lexicalRoot)];
  const segments = path.relative(lexicalRoot, lexicalDirectory).split(path.sep).filter(Boolean);
  let cursor = lexicalRoot;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    try {
      const identity = await captureDirectoryIdentity(cursor);
      if (!isInside(chain[0].realPath, identity.realPath)) {
        throw new Error(`Contained file parent resolves outside its managed root: ${cursor}`);
      }
      chain.push(identity);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  await verifyDirectoryChain(chain);
  return chain;
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function atomicWriteContained(
  file: string,
  content: string | Uint8Array,
  options: ContainedAtomicWriteOptions,
): Promise<void> {
  const directory = path.dirname(file);
  const directoryChain = await prepareContainedDirectoryChain(options.containedRoot, directory);
  const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let temporaryIdentity: import('fs').Stats | undefined;
  let writtenIdentity: import('fs').Stats | undefined;
  try {
    await options.beforeTemporaryOpen?.();
    handle = await fs.open(temporary, 'wx');
    temporaryIdentity = await handle.stat();
    const [temporaryPathStat, temporaryRealPath] = await Promise.all([
      fs.lstat(temporary),
      fs.realpath(temporary),
    ]);
    await verifyDirectoryChain(directoryChain);
    if (
      !temporaryPathStat.isFile() ||
      temporaryPathStat.isSymbolicLink() ||
      !sameFileIdentity(temporaryIdentity, temporaryPathStat) ||
      !isInside(directoryChain[0].realPath, temporaryRealPath)
    ) {
      throw new Error('Contained atomic write temporary file opened outside its managed parent');
    }

    if (typeof content === 'string') await handle.writeFile(content, 'utf8');
    else await handle.writeFile(content);
    await handle.sync();
    writtenIdentity = await handle.stat();
    if (!sameFileIdentity(temporaryIdentity, writtenIdentity)) {
      throw new Error('Contained atomic write temporary file changed while writing');
    }
    await handle.close();
    handle = undefined;

    await options.beforeCommit?.();
    await verifyDirectoryChain(directoryChain);
    const temporaryStat = await fs.lstat(temporary);
    if (
      !temporaryStat.isFile() ||
      temporaryStat.isSymbolicLink() ||
      !writtenIdentity ||
      !sameUnchangedFile(temporaryStat, writtenIdentity)
    ) {
      throw new Error('Contained atomic write temporary file changed before commit');
    }
    if (options.exclusive) {
      await publishFileExclusively(temporary, file);
      await fs.unlink(temporary);
    } else {
      await fs.rename(temporary, file);
    }
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close();
    try {
      await verifyDirectoryChain(directoryChain);
      await fs.rm(temporary, { force: true });
    } catch {
      // The lexical path may now name an attacker-controlled parent. Leave the
      // temporary file in the displaced managed directory for later cleanup.
    }
    throw error;
  }
}

export async function atomicWriteContainedText(
  file: string,
  content: string,
  options: ContainedAtomicWriteOptions,
): Promise<void> {
  await atomicWriteContained(file, content, options);
}

export async function atomicWriteContainedBytes(
  file: string,
  content: Uint8Array,
  options: ContainedAtomicWriteOptions,
): Promise<void> {
  await atomicWriteContained(file, content, options);
}

export async function atomicWriteContainedJson(
  file: string,
  value: unknown,
  options: ContainedAtomicWriteOptions,
): Promise<void> {
  await atomicWriteContainedText(file, JSON.stringify(value, null, 2) + '\n', options);
}

/**
 * Remove one regular file only after checking that both its parent chain and
 * the file identity still belong to the managed root.  This deliberately does
 * not recurse: callers that need tree cleanup must establish their own
 * manifest-bound ownership proof first.
 */
export async function removeContainedFile(
  file: string,
  options: ContainedFileRemoveOptions,
): Promise<boolean> {
  const directory = path.dirname(file);
  const directoryChain = await captureExistingContainedDirectoryChain(
    options.containedRoot,
    directory,
  );
  if (!directoryChain) return false;

  let identity: import('fs').Stats;
  let realPath: string;
  try {
    identity = await fs.lstat(file);
    realPath = await fs.realpath(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (
    !identity.isFile() ||
    identity.isSymbolicLink() ||
    !isInside(directoryChain[0].realPath, realPath)
  ) {
    throw new Error('Contained file removal target must be a regular file inside its managed root');
  }

  await options.beforeRemove?.();
  await verifyDirectoryChain(directoryChain);
  const [current, currentRealPath] = await Promise.all([fs.lstat(file), fs.realpath(file)]);
  if (
    !current.isFile() ||
    current.isSymbolicLink() ||
    !sameUnchangedFile(identity, current) ||
    currentRealPath !== realPath
  ) {
    throw new Error('Contained file removal target changed before removal');
  }
  await fs.unlink(file);
  await verifyDirectoryChain(directoryChain);
  await syncDirectory(directory);
  return true;
}
