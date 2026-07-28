import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

export interface TrustedReadonlyFileIdentity {
  realPath: string;
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
}

export interface TrustedReadonlyPosixFacts {
  currentUid: number;
  fileUid: number;
  fileMode: number;
  fileWritable: boolean;
  parents: Array<{ uid: number; mode: number; writable: boolean }>;
}

export function trustedReadonlyPosixFactsIssue(facts: TrustedReadonlyPosixFacts): string | null {
  if (facts.fileUid === facts.currentUid) {
    return 'Trusted file must be owned by a different host identity';
  }
  if ((facts.fileMode & 0o022) !== 0 || facts.fileWritable) {
    return 'Trusted file is writable by the current process';
  }
  if (
    facts.parents.some(
      (parent) => parent.uid === facts.currentUid || (parent.mode & 0o022) !== 0 || parent.writable,
    )
  ) {
    return 'Trusted file parent chain is writable by the current process';
  }
  return null;
}

const testHostIsolatedFiles = new Set<string>();

export function registerTrustedReadonlyFileForTest(file: string): () => void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Trusted read-only file test capability is available only in tests');
  }
  const normalized = path.resolve(file);
  testHostIsolatedFiles.add(normalized);
  return () => testHostIsolatedFiles.delete(normalized);
}

function sameIdentity(
  left: TrustedReadonlyFileIdentity,
  right: TrustedReadonlyFileIdentity,
): boolean {
  return (
    left.realPath === right.realPath &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

async function currentProcessCanWrite(file: string): Promise<boolean> {
  try {
    await fs.access(file, fsConstants.W_OK);
    return true;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'EACCES' ||
      (error as NodeJS.ErrnoException).code === 'EPERM'
    ) {
      return false;
    }
    throw error;
  }
}

async function inspectIdentity(file: string): Promise<TrustedReadonlyFileIdentity> {
  const [stat, realPath] = await Promise.all([fs.lstat(file), fs.realpath(file)]);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Trusted file capability requires a regular non-symlink file');
  }
  return {
    realPath,
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

/**
 * Proves that a trust-anchor file cannot be replaced or modified by the
 * current process. POSIX proof requires a different owner and a complete
 * non-writable parent chain. Windows must use a host-provided read-only mount
 * capability until ACL proof is available.
 */
export async function assertTrustedReadonlyFile(options: {
  file: string;
  previous?: TrustedReadonlyFileIdentity;
}): Promise<TrustedReadonlyFileIdentity> {
  const identity = await inspectIdentity(options.file);
  if (options.previous && !sameIdentity(options.previous, identity)) {
    throw new Error('Trusted file identity changed while reading');
  }
  if (process.env.NODE_ENV === 'test' && testHostIsolatedFiles.has(path.resolve(options.file))) {
    return identity;
  }
  if (process.platform === 'win32') {
    throw new Error(
      'Trusted file isolation cannot be proven from Windows file mode; use a host read-only mount capability',
    );
  }
  const currentUid = process.geteuid?.() ?? process.getuid?.();
  if (currentUid === undefined) {
    throw new Error('Trusted file owner isolation is unavailable on this platform');
  }
  const fileStat = await fs.stat(identity.realPath);
  const parents: TrustedReadonlyPosixFacts['parents'] = [];
  let directory = path.dirname(identity.realPath);
  for (;;) {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Trusted file parent chain is not a physical directory chain');
    }
    parents.push({
      uid: stat.uid,
      mode: stat.mode,
      writable: await currentProcessCanWrite(directory),
    });
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const issue = trustedReadonlyPosixFactsIssue({
    currentUid,
    fileUid: fileStat.uid,
    fileMode: fileStat.mode,
    fileWritable: await currentProcessCanWrite(identity.realPath),
    parents,
  });
  if (issue) throw new Error(issue);
  return identity;
}
