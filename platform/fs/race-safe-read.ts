import { constants as fsConstants, promises as fs } from 'fs';
import type { BigIntStats, Stats } from 'fs';

import {
  hasComparableFileObject,
  sameFileObject,
  type FileObjectIdentity,
} from './file-identity.js';

export type RaceSafeReadCheckpoint = 'pre-open' | 'post-open' | 'post-read';

export interface RaceSafeReadContext {
  realPath: string;
  identity: FileObjectIdentity;
}

export type RaceSafeReadFailureReason = 'not-regular-file' | 'too-large' | 'changed';

export class RaceSafeReadError extends Error {
  readonly reason: RaceSafeReadFailureReason;

  constructor(reason: RaceSafeReadFailureReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RaceSafeReadError';
    this.reason = reason;
  }
}

export interface RaceSafeReadOptions {
  /** Use BigIntStats precision (dev/ino/size/mtimeNs/ctimeNs) end to end. */
  bigint?: boolean;
  /** Prefixed into built-in error messages, e.g. `${label} changed while reading`. */
  label?: string;
  /** Test-only synchronization points; behavior is passed through unchanged. */
  hooks?: {
    afterOpen?: () => void | Promise<void>;
    beforeFinalCheck?: () => void | Promise<void>;
  };
  /**
   * Called inside the same synchronization window as the built-in identity
   * checks at each checkpoint. A thrown error aborts the read exactly like an
   * identity mismatch. Use this to stack domain-specific checks (for example
   * Native directory-chain verification) without opening a second race window.
   */
  verify?: (
    checkpoint: RaceSafeReadCheckpoint,
    context: RaceSafeReadContext,
  ) => void | Promise<void>;
}

export interface RaceSafeReadResult {
  bytes: Buffer;
  stat: Stats | BigIntStats;
  realPath: string;
}

type AnyStats = Stats | BigIntStats;

function birthtimeOf(stat: AnyStats): number | bigint {
  return 'birthtimeNs' in stat && typeof stat.birthtimeNs === 'bigint'
    ? stat.birthtimeNs
    : stat.birthtimeMs;
}

function ctimeOf(stat: AnyStats): number | bigint {
  return 'ctimeNs' in stat && typeof stat.ctimeNs === 'bigint' ? stat.ctimeNs : stat.ctimeMs;
}

function identityOf(stat: AnyStats): FileObjectIdentity {
  return { dev: stat.dev, ino: stat.ino, birthtime: birthtimeOf(stat) };
}

function sameStatIdentity(left: AnyStats, right: AnyStats): boolean {
  const leftObject = identityOf(left);
  const rightObject = identityOf(right);
  if (hasComparableFileObject(leftObject, rightObject)) {
    return sameFileObject(leftObject, rightObject);
  }
  return (
    sameFileObject(leftObject, rightObject) &&
    birthtimeOf(left) === birthtimeOf(right) &&
    ctimeOf(left) === ctimeOf(right) &&
    left.size === right.size
  );
}

/**
 * Read a regular file through one descriptor with identity re-verification
 * before open, after open, and after the bounded read, so a path swapped for
 * a symlink or replacement file between checks is always rejected.
 *
 * ENOENT (and every other system error except ELOOP) propagates unchanged so
 * callers can keep their own missing-file semantics.
 */
export async function readFileRaceSafe(
  file: string,
  maxBytes: number,
  options: RaceSafeReadOptions = {},
): Promise<RaceSafeReadResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('race-safe read byte limit must be a positive integer');
  }
  const label = options.label ?? 'file';
  const bigint = options.bigint === true;

  const before = await fs.lstat(file, { bigint });
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new RaceSafeReadError('not-regular-file', `${label} must be a regular file`);
  }
  if (BigInt(before.size) > BigInt(maxBytes)) {
    throw new RaceSafeReadError('too-large', `${label} exceeds ${maxBytes} bytes`);
  }
  const beforeRealPath = await fs.realpath(file);
  await options.verify?.('pre-open', { realPath: beforeRealPath, identity: identityOf(before) });

  // POSIX: O_NOFOLLOW rejects a symlink swapped in since the lstat above and
  // O_NONBLOCK prevents a FIFO from blocking the open. Windows: Node exposes
  // neither flag, so this branch opens with plain O_RDONLY and the
  // lstat/realpath identity checks below - which run identically on every
  // platform - are the sole and sufficient guard against both swaps.
  const flags =
    process.platform === 'win32'
      ? fsConstants.O_RDONLY
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(file, flags);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new RaceSafeReadError('not-regular-file', `${label} must be a regular file`, {
        cause: error,
      });
    }
    throw error;
  }
  try {
    const [opened, pathAfterOpen, realPathAfterOpen] = await Promise.all([
      handle.stat({ bigint }),
      fs.lstat(file, { bigint }),
      fs.realpath(file),
    ]);
    if (
      !opened.isFile() ||
      !pathAfterOpen.isFile() ||
      pathAfterOpen.isSymbolicLink() ||
      realPathAfterOpen !== beforeRealPath ||
      !sameStatIdentity(before, opened) ||
      !sameStatIdentity(before, pathAfterOpen)
    ) {
      throw new RaceSafeReadError('changed', `${label} changed while opening`);
    }
    await options.verify?.('post-open', {
      realPath: realPathAfterOpen,
      identity: identityOf(opened),
    });
    await options.hooks?.afterOpen?.();

    const chunks: Buffer[] = [];
    let total = 0;
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
    for (;;) {
      const remaining = maxBytes + 1 - total;
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, remaining), null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) {
        throw new RaceSafeReadError('too-large', `${label} exceeds ${maxBytes} bytes`);
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    await options.hooks?.beforeFinalCheck?.();

    const [afterHandle, afterPath, afterRealPath] = await Promise.all([
      handle.stat({ bigint }),
      fs.lstat(file, { bigint }),
      fs.realpath(file),
    ]);
    if (
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      afterRealPath !== beforeRealPath ||
      !sameStatIdentity(before, afterHandle) ||
      !sameStatIdentity(before, afterPath)
    ) {
      throw new RaceSafeReadError('changed', `${label} changed while reading`);
    }
    await options.verify?.('post-read', {
      realPath: afterRealPath,
      identity: identityOf(afterHandle),
    });
    return { bytes: Buffer.concat(chunks, total), stat: afterHandle, realPath: afterRealPath };
  } finally {
    await handle.close();
  }
}
