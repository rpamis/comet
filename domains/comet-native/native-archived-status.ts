import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

import { runGitCommand } from '../../platform/process/git.js';
import { canonicalHash } from './native-canonical-hash.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { parseNativePortableState } from './native-portable-state.js';
import type { NativePortableState } from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';

class NativeHistoricalArchiveSchemaError extends Error {}

export interface NativeStatusRecord {
  projectRoot: string;
  file: string;
  state: NativePortableState;
}

export async function readNativeStatusRecord(
  paths: NativeProjectPaths,
  file: string,
): Promise<NativeStatusRecord> {
  const source = await readNativeBoundedTextFile({
    root: paths.nativeRoot,
    ref: path.relative(paths.nativeRoot, file).replaceAll('\\', '/'),
    maxBytes: null,
    includeHash: false,
  });
  const parsed = parse(source.text);
  if (['comet.native.v1', 'comet.native.v2', 'comet.native.v3'].includes(parsed?.schema))
    throw new NativeHistoricalArchiveSchemaError('Historical Native schema');
  return {
    projectRoot: paths.projectRoot,
    file,
    state: parseNativePortableState(parsed),
  };
}

export async function listNativeArchivedStatusRecords(
  paths: NativeProjectPaths,
  onError?: (name: string, message: string) => void,
  targetName?: string,
): Promise<NativeStatusRecord[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(paths.archiveDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (entries.length > 4096) throw new Error('Native archive discovery exceeds 4096 records');
  const records: NativeStatusRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const archiveName = /^\d{4}-\d{2}-\d{2}-(.+)$/u.exec(entry.name)?.[1];
    if (targetName !== undefined && archiveName !== undefined && archiveName !== targetName)
      continue;
    const file = path.join(paths.archiveDir, entry.name, 'comet-state.yaml');
    try {
      const record = await readNativeStatusRecord(paths, file);
      if (record.state.archived && record.state.status === 'done') records.push(record);
    } catch (error) {
      // Archives from older protocols are historical documents, not v4 candidates.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      if (error instanceof NativeHistoricalArchiveSchemaError) continue;
      const name = entry.name.replace(/^\d{4}-\d{2}-\d{2}-/u, '');
      onError?.(name, `Native archive ${entry.name} is unreadable: ${(error as Error).message}`);
    }
  }
  return records;
}

function stateHash(state: NativePortableState): string {
  return canonicalHash('comet.native.status-record.v1', state);
}

function committedRecord(record: NativeStatusRecord): string | null {
  const ref = path.relative(record.projectRoot, record.file).replaceAll('\\', '/');
  try {
    const commit = runGitCommand(record.projectRoot, [
      'log',
      '-1',
      '--format=%H',
      'HEAD',
      '--',
      ref,
    ]);
    if (!commit) return null;
    const committed = parseNativePortableState(
      parse(runGitCommand(record.projectRoot, ['show', `${commit}:${ref}`])),
    );
    return stateHash(committed) === stateHash(record.state) ? commit : null;
  } catch {
    return null;
  }
}

/** Identity plus an exact committed predecessor, never name/version ordering. */
export function nativeArchiveSupersedes(
  archived: NativeStatusRecord,
  previous: NativeStatusRecord,
): boolean {
  if (
    !archived.state.archived ||
    archived.state.status !== 'done' ||
    archived.state.name !== previous.state.name ||
    archived.state.created_at !== previous.state.created_at
  )
    return false;
  const finalCommit = committedRecord(archived);
  const previousCommit = committedRecord(previous);
  if (!finalCommit || !previousCommit) return false;
  try {
    runGitCommand(archived.projectRoot, [
      'merge-base',
      '--is-ancestor',
      previousCommit,
      finalCommit,
    ]);
    return true;
  } catch {
    return false;
  }
}

export function sameNativeArchivedRecord(
  left: NativeStatusRecord,
  right: NativeStatusRecord,
): boolean {
  return (
    left.state.archived && right.state.archived && stateHash(left.state) === stateHash(right.state)
  );
}
