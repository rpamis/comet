import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

import { atomicWriteJson } from './native-atomic-file.js';
import { nativeChangeDir } from './native-change.js';
import { parseNativeCheckReceipt, type NativeCheckReceipt } from './native-check-receipt-model.js';
import { isInsidePath, resolveContainedNativePath } from './native-paths.js';
import { hasComparableNativeFileObject, sameNativeFileObject } from './native-file-identity.js';
import type { NativeProjectPaths } from './native-types.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const RECEIPT_REF_PATTERN = /^runtime\/evidence\/check-receipts\/([a-f0-9]{64})\.json$/u;
const MAX_NATIVE_CHECK_RECEIPT_BYTES = 512 * 1024;

interface DirectoryIdentity {
  path: string;
  realPath: string;
  dev: number;
  ino: number;
  birthtimeMs: number;
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

async function captureDirectoryChain(
  root: string,
  directory: string,
): Promise<DirectoryIdentity[]> {
  const lexicalRoot = path.resolve(root);
  const lexicalDirectory = path.resolve(directory);
  if (!isInsidePath(lexicalRoot, lexicalDirectory)) {
    throw new Error('Native check receipt parent is outside the Native root');
  }
  const chain: DirectoryIdentity[] = [];
  let cursor = lexicalRoot;
  for (const segment of [
    '',
    ...path.relative(lexicalRoot, lexicalDirectory).split(path.sep).filter(Boolean),
  ]) {
    if (segment) cursor = path.join(cursor, segment);
    const stat = await fs.lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Native check receipt parent must be a real directory: ${cursor}`);
    }
    const realPath = await fs.realpath(cursor);
    if (chain.length > 0 && !isInsidePath(chain[0].realPath, realPath)) {
      throw new Error('Native check receipt parent resolves outside the Native root');
    }
    chain.push({
      path: cursor,
      realPath,
      dev: stat.dev,
      ino: stat.ino,
      birthtimeMs: stat.birthtimeMs,
    });
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
      throw new Error(`Native check receipt parent changed while reading: ${identity.path}`);
    }
  }
}

export function nativeCheckReceiptRef(hash: string): string {
  if (!HASH_PATTERN.test(hash)) throw new Error('Native check receipt hash is invalid');
  return `runtime/evidence/check-receipts/${hash}.json`;
}

function receiptHashFromRef(ref: string): string {
  const match = RECEIPT_REF_PATTERN.exec(ref);
  if (!match) throw new Error('Native check receipt ref is invalid');
  return match[1];
}

function receiptFile(paths: NativeProjectPaths, name: string, hash: string): string {
  return path.join(nativeChangeDir(paths, name), ...nativeCheckReceiptRef(hash).split('/'));
}

async function readBoundedReceipt(
  file: string,
  changeRoot: string,
  nativeRoot: string,
): Promise<unknown> {
  const chain = await captureDirectoryChain(nativeRoot, path.dirname(file));
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error('Native check receipt must be a regular file');
  }
  if (before.size > MAX_NATIVE_CHECK_RECEIPT_BYTES) {
    throw new Error(`Native check receipt exceeds ${MAX_NATIVE_CHECK_RECEIPT_BYTES} bytes`);
  }
  const [realChangeRoot, beforeRealPath] = await Promise.all([
    fs.realpath(changeRoot),
    fs.realpath(file),
  ]);
  if (!isInsidePath(realChangeRoot, beforeRealPath)) {
    throw new Error('Native check receipt resolves outside its change');
  }
  const openFlags =
    process.platform === 'win32'
      ? 'r'
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
  const handle = await fs.open(file, openFlags).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ELOOP' || error.code === 'ENXIO') {
      throw new Error('Native check receipt became unsafe while opening');
    }
    throw error;
  });
  try {
    const [opened, pathAfterOpen, realPathAfterOpen] = await Promise.all([
      handle.stat(),
      fs.lstat(file),
      fs.realpath(file),
    ]);
    await verifyDirectoryChain(chain);
    if (
      !opened.isFile() ||
      !pathAfterOpen.isFile() ||
      pathAfterOpen.isSymbolicLink() ||
      realPathAfterOpen !== beforeRealPath ||
      !sameFileIdentity(before, opened) ||
      !sameFileIdentity(opened, pathAfterOpen)
    ) {
      throw new Error('Native check receipt changed while opening');
    }
    const chunks: Buffer[] = [];
    let total = 0;
    const buffer = Buffer.allocUnsafe(16 * 1024);
    while (true) {
      const remaining = MAX_NATIVE_CHECK_RECEIPT_BYTES + 1 - total;
      const read = await handle.read(buffer, 0, Math.min(buffer.length, remaining), null);
      if (read.bytesRead === 0) break;
      total += read.bytesRead;
      if (total > MAX_NATIVE_CHECK_RECEIPT_BYTES) {
        throw new Error(`Native check receipt exceeds ${MAX_NATIVE_CHECK_RECEIPT_BYTES} bytes`);
      }
      chunks.push(Buffer.from(buffer.subarray(0, read.bytesRead)));
    }
    const [afterHandle, afterPath, afterRealPath] = await Promise.all([
      handle.stat(),
      fs.lstat(file),
      fs.realpath(file),
    ]);
    await verifyDirectoryChain(chain);
    if (
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      afterRealPath !== beforeRealPath ||
      !isInsidePath(realChangeRoot, afterRealPath) ||
      !sameFileIdentity(opened, afterHandle) ||
      !sameFileIdentity(opened, afterPath)
    ) {
      throw new Error('Native check receipt changed while reading');
    }
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8')) as unknown;
  } finally {
    await handle.close();
  }
}

export async function readNativeCheckReceipt(
  paths: NativeProjectPaths,
  name: string,
  ref: string,
): Promise<NativeCheckReceipt> {
  const expectedHash = receiptHashFromRef(ref);
  const changeRoot = nativeChangeDir(paths, name);
  const file = receiptFile(paths, name, expectedHash);
  await resolveContainedNativePath(paths.nativeRoot, file);
  const receipt = parseNativeCheckReceipt(
    await readBoundedReceipt(file, changeRoot, paths.nativeRoot),
  );
  if (receipt.change !== name || receipt.receiptHash !== expectedHash) {
    throw new Error('Native check receipt ref/hash/change mismatch');
  }
  return receipt;
}

export async function writeNativeCheckReceipt(options: {
  paths: NativeProjectPaths;
  name: string;
  receipt: NativeCheckReceipt;
}): Promise<string> {
  const receipt = parseNativeCheckReceipt(options.receipt);
  if (receipt.change !== options.name) {
    throw new Error('Native check receipt change mismatch');
  }
  const ref = nativeCheckReceiptRef(receipt.receiptHash);
  const file = receiptFile(options.paths, options.name, receipt.receiptHash);
  const serializedBytes = Buffer.byteLength(JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  if (serializedBytes > MAX_NATIVE_CHECK_RECEIPT_BYTES) {
    throw new Error(`Native check receipt exceeds ${MAX_NATIVE_CHECK_RECEIPT_BYTES} bytes`);
  }
  await resolveContainedNativePath(options.paths.nativeRoot, file);
  try {
    const existing = await readNativeCheckReceipt(options.paths, options.name, ref);
    if (JSON.stringify(existing) !== JSON.stringify(receipt)) {
      throw new Error(`Native check receipt hash collision for ${receipt.receiptHash}`);
    }
    return ref;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await atomicWriteJson(file, receipt, { containedRoot: options.paths.nativeRoot });
  const persisted = await readNativeCheckReceipt(options.paths, options.name, ref);
  if (JSON.stringify(persisted) !== JSON.stringify(receipt)) {
    throw new Error('Native check receipt changed while being persisted');
  }
  return ref;
}
