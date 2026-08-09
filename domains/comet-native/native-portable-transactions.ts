import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readNativeBoundedTextFile } from './native-bounded-file.js';
import {
  parseNativePortableMigrationTransaction,
  type NativePortableMigrationTransaction,
} from './native-portable-migration.js';
import type { NativePortableSpecChange } from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';

export const NATIVE_PORTABLE_ARCHIVE_TRANSACTION_SCHEMA =
  'comet.native.archive-transaction.v4' as const;

export interface NativePortableArchiveSpecChange extends NativePortableSpecChange {
  content: string | null;
}

export interface NativePortableArchiveTransaction {
  schema: typeof NATIVE_PORTABLE_ARCHIVE_TRANSACTION_SCHEMA;
  id: string;
  change: string;
  start_state_version: number;
  archive_ref: string;
  status: 'prepared' | 'specs-applied' | 'state-finalized' | 'report-aligned' | 'moved';
  next_spec_index: number;
  spec_changes: NativePortableArchiveSpecChange[];
  created_at: string;
}

export type NativePortableTransaction =
  | {
      kind: 'archive';
      change: string;
      file: string;
      journal: NativePortableArchiveTransaction;
    }
  | {
      kind: 'migration';
      change: string;
      file: string;
      journal: NativePortableMigrationTransaction;
    };

export interface NativePortableTransactionRef {
  kind: NativePortableTransaction['kind'];
  change: string;
}

const CHANGE_NAME_PATTERN = '[a-z][a-z0-9]*(?:-[a-z0-9]+)*';
const ARCHIVE_FILE_PATTERN = new RegExp(`^portable-archive-(${CHANGE_NAME_PATTERN})\\.json$`, 'u');
const MIGRATION_FILE_PATTERN = new RegExp(
  `^portable-migration-(${CHANGE_NAME_PATTERN})\\.json$`,
  'u',
);
const TRANSACTION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ARCHIVE_REF_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const ARCHIVE_STATUSES = new Set<NativePortableArchiveTransaction['status']>([
  'prepared',
  'specs-applied',
  'state-finalized',
  'report-aligned',
  'moved',
]);
const ARCHIVE_KEYS = new Set([
  'schema',
  'id',
  'change',
  'start_state_version',
  'archive_ref',
  'status',
  'next_spec_index',
  'spec_changes',
  'created_at',
]);
const SPEC_CHANGE_KEYS = new Set(['capability', 'operation', 'source', 'content']);
const CAPABILITY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}`);
  if (Object.keys(value).length !== expected.size) {
    throw new Error(`${label} fields are invalid`);
  }
}

function parseSpecChange(value: unknown, index: number): NativePortableArchiveSpecChange {
  const label = `Native portable Archive spec_changes[${index}]`;
  const input = record(value, label);
  rejectUnknown(input, SPEC_CHANGE_KEYS, label);
  if (typeof input.capability !== 'string' || !CAPABILITY_PATTERN.test(input.capability)) {
    throw new Error(`${label}.capability is invalid`);
  }
  if (!['create', 'modify', 'remove'].includes(String(input.operation))) {
    throw new Error(`${label}.operation is invalid`);
  }
  const operation = input.operation as NativePortableSpecChange['operation'];
  if (operation === 'remove') {
    if (input.source !== null || input.content !== null) {
      throw new Error(`${label} remove requires source and content null`);
    }
    return { capability: input.capability, operation, source: null, content: null };
  }
  if (
    typeof input.source !== 'string' ||
    input.source.length === 0 ||
    input.source.includes('\\') ||
    input.source.startsWith('/') ||
    /^[A-Za-z]:/u.test(input.source) ||
    input.source.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(`${label}.${operation} source is invalid`);
  }
  if (typeof input.content !== 'string') {
    throw new Error(`${label}.${operation} content is invalid`);
  }
  return {
    capability: input.capability,
    operation,
    source: input.source,
    content: input.content,
  };
}

export function parseNativePortableArchiveTransaction(
  value: unknown,
): NativePortableArchiveTransaction {
  const input = record(value, 'Native portable Archive transaction');
  rejectUnknown(input, ARCHIVE_KEYS, 'Native portable Archive transaction');
  if (input.schema !== NATIVE_PORTABLE_ARCHIVE_TRANSACTION_SCHEMA) {
    throw new Error('Unsupported Native portable Archive transaction schema');
  }
  if (typeof input.id !== 'string' || !TRANSACTION_ID_PATTERN.test(input.id)) {
    throw new Error('Native portable Archive transaction id is invalid');
  }
  if (typeof input.change !== 'string' || !CAPABILITY_PATTERN.test(input.change)) {
    throw new Error('Native portable Archive transaction change is invalid');
  }
  if (!Number.isSafeInteger(input.start_state_version) || Number(input.start_state_version) < 0) {
    throw new Error('Native portable Archive transaction state version is invalid');
  }
  if (
    typeof input.archive_ref !== 'string' ||
    !ARCHIVE_REF_PATTERN.test(input.archive_ref) ||
    !input.archive_ref.endsWith(`-${input.change}`)
  ) {
    throw new Error('Native portable Archive transaction ref is invalid');
  }
  if (
    typeof input.status !== 'string' ||
    !ARCHIVE_STATUSES.has(input.status as NativePortableArchiveTransaction['status'])
  ) {
    throw new Error('Native portable Archive transaction status is invalid');
  }
  if (!Array.isArray(input.spec_changes)) {
    throw new Error('Native portable Archive transaction spec changes are invalid');
  }
  const spec_changes = input.spec_changes.map(parseSpecChange);
  if (new Set(spec_changes.map(({ capability }) => capability)).size !== spec_changes.length) {
    throw new Error('Native portable Archive transaction capabilities must be unique');
  }
  if (
    !Number.isSafeInteger(input.next_spec_index) ||
    Number(input.next_spec_index) < 0 ||
    Number(input.next_spec_index) > spec_changes.length
  ) {
    throw new Error('Native portable Archive transaction spec cursor is invalid');
  }
  if (typeof input.created_at !== 'string') {
    throw new Error('Native portable Archive transaction timestamp is invalid');
  }
  const createdAt = new Date(input.created_at);
  if (Number.isNaN(createdAt.valueOf()) || createdAt.toISOString() !== input.created_at) {
    throw new Error('Native portable Archive transaction timestamp is invalid');
  }
  return {
    schema: NATIVE_PORTABLE_ARCHIVE_TRANSACTION_SCHEMA,
    id: input.id,
    change: input.change,
    start_state_version: Number(input.start_state_version),
    archive_ref: input.archive_ref,
    status: input.status as NativePortableArchiveTransaction['status'],
    next_spec_index: Number(input.next_spec_index),
    spec_changes,
    created_at: input.created_at,
  };
}

export function describeNativePortableTransactionEntry(
  entryName: string,
): NativePortableTransactionRef | null {
  const archive = ARCHIVE_FILE_PATTERN.exec(entryName);
  if (archive) return { kind: 'archive', change: archive[1] };
  const migration = MIGRATION_FILE_PATTERN.exec(entryName);
  return migration ? { kind: 'migration', change: migration[1] } : null;
}

export function nativePortableTransactionFile(
  paths: NativeProjectPaths,
  ref: NativePortableTransactionRef,
): string {
  const entry = `${ref.kind === 'archive' ? 'portable-archive' : 'portable-migration'}-${ref.change}.json`;
  const descriptor = describeNativePortableTransactionEntry(entry);
  if (!descriptor || descriptor.kind !== ref.kind || descriptor.change !== ref.change) {
    throw new Error(`Invalid Native portable transaction change: ${ref.change}`);
  }
  return path.join(paths.transactionsDir, entry);
}

export async function readNativePortableTransactionEntry(
  paths: NativeProjectPaths,
  entryName: string,
): Promise<NativePortableTransaction | null> {
  const ref = describeNativePortableTransactionEntry(entryName);
  if (!ref) return null;
  const text = await readNativeBoundedTextFile({
    root: paths.transactionsDir,
    ref: entryName,
    maxBytes: null,
    includeHash: false,
  });
  const value = JSON.parse(text.text) as unknown;
  const file = path.join(paths.transactionsDir, entryName);
  if (ref.kind === 'archive') {
    const journal = parseNativePortableArchiveTransaction(value);
    if (journal.change !== ref.change) {
      throw new Error(`Native portable transaction filename does not match ${journal.change}`);
    }
    return { kind: 'archive', change: ref.change, file, journal };
  }
  const journal = parseNativePortableMigrationTransaction(value);
  if (journal.change !== ref.change) {
    throw new Error(`Native portable transaction filename does not match ${journal.change}`);
  }
  return { kind: 'migration', change: ref.change, file, journal };
}

export async function readNativePortableTransaction(
  paths: NativeProjectPaths,
  ref: NativePortableTransactionRef,
): Promise<NativePortableTransaction | null> {
  const file = nativePortableTransactionFile(paths, ref);
  try {
    return await readNativePortableTransactionEntry(paths, path.basename(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function listNativePortableTransactionEntryNames(
  paths: NativeProjectPaths,
): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(paths.transactionsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .map(({ name }) => name)
    .filter((name) => describeNativePortableTransactionEntry(name) !== null)
    .sort((left, right) => left.localeCompare(right, 'en'));
}

export function isNativePortableTransactionUnfinished(
  transaction: NativePortableTransaction,
): boolean {
  return transaction.kind === 'archive' || transaction.journal.status !== 'committed';
}
