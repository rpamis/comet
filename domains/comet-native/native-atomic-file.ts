import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export interface NativeAtomicWriteOptions {
  containedRoot?: string;
  beforeTemporaryOpen?: () => void | Promise<void>;
  beforeCommit?: () => void | Promise<void>;
  exclusive?: boolean;
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

function sameDirectoryIdentity(identity: DirectoryIdentity, stat: import('fs').Stats): boolean {
  if (identity.dev !== 0 || identity.ino !== 0 || stat.dev !== 0 || stat.ino !== 0) {
    return identity.dev === stat.dev && identity.ino === stat.ino;
  }
  return identity.birthtimeMs === stat.birthtimeMs;
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

async function captureDirectoryIdentity(directory: string): Promise<DirectoryIdentity> {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Native atomic write parent must be a real directory: ${directory}`);
  }
  return {
    path: directory,
    realPath: await fs.realpath(directory),
    dev: stat.dev,
    ino: stat.ino,
    birthtimeMs: stat.birthtimeMs,
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
      throw new Error(`Native atomic write parent changed before commit: ${identity.path}`);
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
    throw new Error(`Native atomic write parent is outside its managed root: ${directory}`);
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
      throw new Error(`Native atomic write parent resolves outside its managed root: ${cursor}`);
    }
    chain.push(identity);
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

async function atomicWrite(
  file: string,
  content: string | Uint8Array,
  options: NativeAtomicWriteOptions = {},
): Promise<void> {
  const directory = path.dirname(file);
  const directoryChain = options.containedRoot
    ? await prepareContainedDirectoryChain(options.containedRoot, directory)
    : null;
  if (!directoryChain) await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let temporaryIdentity: import('fs').Stats | undefined;
  try {
    await options.beforeTemporaryOpen?.();
    handle = await fs.open(temporary, 'wx');
    temporaryIdentity = await handle.stat();
    if (directoryChain) {
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
        throw new Error('Native atomic write temporary file opened outside its managed parent');
      }
    }
    if (typeof content === 'string') await handle.writeFile(content, 'utf8');
    else await handle.writeFile(content);
    await handle.sync();
    if (!sameFileIdentity(temporaryIdentity, await handle.stat())) {
      throw new Error('Native atomic write temporary file changed while writing');
    }
    await handle.close();
    handle = undefined;
    await options.beforeCommit?.();
    if (directoryChain) {
      await verifyDirectoryChain(directoryChain);
      const temporaryStat = await fs.lstat(temporary);
      if (
        !temporaryStat.isFile() ||
        temporaryStat.isSymbolicLink() ||
        !temporaryIdentity ||
        !sameFileIdentity(temporaryStat, temporaryIdentity)
      ) {
        throw new Error('Native atomic write temporary file changed before commit');
      }
    }
    if (options.exclusive) {
      await fs.link(temporary, file);
      await fs.unlink(temporary);
    } else {
      await fs.rename(temporary, file);
    }
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close();
    if (!directoryChain) {
      await fs.rm(temporary, { force: true });
    } else {
      try {
        await verifyDirectoryChain(directoryChain);
        await fs.rm(temporary, { force: true });
      } catch {
        // The lexical path may now name an attacker-controlled parent. Leave the
        // temporary file in the displaced managed directory for doctor cleanup.
      }
    }
    throw error;
  }
}

export async function atomicWriteText(
  file: string,
  content: string,
  options: NativeAtomicWriteOptions = {},
): Promise<void> {
  await atomicWrite(file, content, options);
}

export async function atomicWriteBytes(
  file: string,
  content: Uint8Array,
  options: NativeAtomicWriteOptions = {},
): Promise<void> {
  await atomicWrite(file, content, options);
}

export async function atomicWriteJson(
  file: string,
  value: unknown,
  options: NativeAtomicWriteOptions = {},
): Promise<void> {
  await atomicWriteText(file, JSON.stringify(value, null, 2) + '\n', options);
}
