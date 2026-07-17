import { promises as fs } from 'fs';
import path from 'path';
import { TextDecoder } from 'util';

import { atomicWriteJson, atomicWriteText } from './native-atomic-file.js';
import { isInsidePath, resolveContainedNativePath } from './native-paths.js';
import {
  copyNativeProtectedFile,
  ensureNativeProtectedDirectory,
  moveNativeProtectedDirectory,
  readNativeProtectedDirectory,
  readNativeProtectedFile,
  removeNativeProtectedFile,
  type NativeProtectedFile,
  type NativeProtectedFileHooks,
} from './native-protected-file.js';
import type {
  NativeProjectPaths,
  NativeTransactionEvent,
  NativeTransactionHooks,
  NativeTransactionJournal,
  NativeTransactionOperation,
  NativeTransactionStatus,
} from './native-types.js';

const JOURNAL_KEYS = new Set([
  'schema',
  'id',
  'kind',
  'status',
  'projectRoot',
  'nativeRoot',
  'change',
  'createdAt',
  'operations',
]);
const OPERATION_KEYS = new Set(['id', 'type', 'source', 'target', 'staged', 'backup']);
const ARCHIVE_V2_JOURNAL_KEYS = new Set([
  'schema',
  'id',
  'kind',
  'status',
  'change',
  'createdAt',
  'preflightHash',
  'operations',
]);
const ARCHIVE_V2_OPERATION_KEYS = new Set([
  'id',
  'type',
  'source',
  'target',
  'staged',
  'backup',
  'expectedSourceHash',
  'expectedTargetHash',
  'stagedHash',
]);
const EVENT_KEYS = new Set(['sequence', 'timestamp', 'type', 'operationId']);
const TRANSACTION_STATUSES = new Set<NativeTransactionStatus>([
  'prepared',
  'applying',
  'committed',
  'rolling-back',
  'rolled-back',
]);
const EVENT_TYPES = new Set<NativeTransactionEvent['type']>([
  'prepared',
  'operation-started',
  'operation-completed',
  'archive-finalization-started',
  'archive-finalized',
  'commit',
  'rollback-started',
  'rollback-completed',
]);
const NATIVE_TRANSACTION_JOURNAL_MAX_BYTES = 256 * 1024;
const NATIVE_TRANSACTION_EVENTS_MAX_BYTES = 1024 * 1024;
const NATIVE_TRANSACTION_EVENT_MAX_BYTES = 16 * 1024;
const NATIVE_TRANSACTION_EVENT_MAX_COUNT = 1024;
const NATIVE_LEGACY_TRANSACTION_FILE_MAX_BYTES = 64 * 1024 * 1024;
const NATIVE_LEGACY_TRANSACTION_DIRECTORY_MAX_ENTRIES = 20_000;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export interface NativeTransactionReadOptions {
  hooks?: NativeProtectedFileHooks;
}

interface NativeTransactionEventLogSnapshot {
  exists: boolean;
  hash: string | null;
  size: number;
  events: NativeTransactionEvent[];
  canonicalSource: string;
  needsRepair: boolean;
}

export interface NativeArchiveTransactionOperationV2 {
  id: string;
  type: 'write' | 'remove' | 'move';
  source?: string;
  target: string;
  staged?: string;
  backup?: string;
  expectedSourceHash?: string;
  expectedTargetHash: string | null;
  stagedHash?: string;
}

export interface NativeArchiveTransactionJournalV2 {
  schema: 'comet.native.transaction.v2';
  id: string;
  kind: 'archive';
  status: NativeTransactionStatus;
  change: string;
  createdAt: string;
  preflightHash: string;
  operations: NativeArchiveTransactionOperationV2[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, keys: Set<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !keys.has(key));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}`);
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function assertRef(ref: unknown, label: string): asserts ref is string {
  if (
    typeof ref !== 'string' ||
    ref.length === 0 ||
    path.isAbsolute(ref) ||
    /^(?:[A-Za-z]:|~|[\\/])/u.test(ref) ||
    ref.split(/[\\/]/u).includes('..')
  ) {
    throw new Error(`${label} must stay inside the Native root`);
  }
}

function assertHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 hash`);
  }
}

function assertArchiveRef(ref: unknown, label: string): asserts ref is string {
  assertRef(ref, label);
  if (
    ref.includes('\\') ||
    ref !== path.posix.normalize(ref) ||
    ref.split('/').includes('.') ||
    ref.endsWith('/') ||
    Buffer.byteLength(ref, 'utf8') > 1024
  ) {
    throw new Error(`${label} must be a normalized Native-relative ref`);
  }
}

function parseOperation(value: unknown, index: number): NativeTransactionOperation {
  const operation = record(value, `transaction operations[${index}]`);
  rejectUnknown(operation, OPERATION_KEYS, `transaction operations[${index}]`);
  if (typeof operation.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/u.test(operation.id)) {
    throw new Error(`transaction operations[${index}].id is invalid`);
  }
  if (operation.type !== 'write' && operation.type !== 'remove' && operation.type !== 'move') {
    throw new Error(`transaction operation ${operation.id} has an invalid type`);
  }
  assertRef(operation.target, `transaction operation ${operation.id} target`);
  for (const field of ['source', 'staged', 'backup'] as const) {
    if (operation[field] !== undefined) {
      assertRef(operation[field], `transaction operation ${operation.id} ${field}`);
    }
  }
  if (operation.type === 'write') {
    if (operation.staged === undefined || operation.source !== undefined) {
      throw new Error(`write operation ${operation.id} requires staged and forbids source`);
    }
  } else if (operation.type === 'remove') {
    if (operation.source !== undefined || operation.staged !== undefined) {
      throw new Error(`remove operation ${operation.id} forbids source and staged`);
    }
  } else if (
    operation.source === undefined ||
    operation.staged !== undefined ||
    operation.backup !== undefined
  ) {
    throw new Error(`move operation ${operation.id} requires source and forbids staged and backup`);
  }
  return operation as unknown as NativeTransactionOperation;
}

export function parseNativeArchiveTransactionJournalV2(
  value: unknown,
): NativeArchiveTransactionJournalV2 {
  const journal = record(value, 'Native Archive transaction journal');
  rejectUnknown(journal, ARCHIVE_V2_JOURNAL_KEYS, 'Native Archive transaction journal');
  if (journal.schema !== 'comet.native.transaction.v2') {
    throw new Error('Unsupported Native Archive transaction schema');
  }
  if (typeof journal.id !== 'string' || !/^[a-f0-9-]{8,}$/u.test(journal.id)) {
    throw new Error('Native Archive transaction id is invalid');
  }
  if (journal.kind !== 'archive') throw new Error('Native v2 transaction kind must be archive');
  if (
    typeof journal.status !== 'string' ||
    !TRANSACTION_STATUSES.has(journal.status as NativeTransactionStatus)
  ) {
    throw new Error('Native Archive transaction status is invalid');
  }
  if (
    typeof journal.change !== 'string' ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(journal.change)
  ) {
    throw new Error('Native Archive transaction change name is invalid');
  }
  if (!validTimestamp(journal.createdAt)) {
    throw new Error('Native Archive transaction createdAt is invalid');
  }
  assertHash(journal.preflightHash, 'Native Archive transaction preflightHash');
  if (!Array.isArray(journal.operations) || journal.operations.length > 65) {
    throw new Error('Native Archive transaction operations must be an array');
  }
  const operations = journal.operations.map((value, index) => {
    const operation = record(value, `Archive transaction operations[${index}]`);
    rejectUnknown(operation, ARCHIVE_V2_OPERATION_KEYS, `Archive transaction operations[${index}]`);
    if (typeof operation.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/u.test(operation.id)) {
      throw new Error(`Archive transaction operations[${index}].id is invalid`);
    }
    if (operation.type !== 'write' && operation.type !== 'remove' && operation.type !== 'move') {
      throw new Error(`Archive transaction operation ${operation.id} has an invalid type`);
    }
    assertArchiveRef(operation.target, `Archive transaction operation ${operation.id} target`);
    for (const field of ['source', 'staged', 'backup'] as const) {
      if (operation[field] !== undefined) {
        assertArchiveRef(
          operation[field],
          `Archive transaction operation ${operation.id} ${field}`,
        );
      }
    }
    if (operation.expectedTargetHash !== null) {
      assertHash(
        operation.expectedTargetHash,
        `Archive transaction operation ${operation.id} expectedTargetHash`,
      );
    }
    if (operation.type === 'write') {
      if (
        operation.staged === undefined ||
        operation.source !== undefined ||
        operation.expectedSourceHash !== undefined
      ) {
        throw new Error(
          `Archive write operation ${operation.id} requires staged and forbids source`,
        );
      }
      assertHash(operation.stagedHash, `Archive write operation ${operation.id} stagedHash`);
      if ((operation.expectedTargetHash === null) !== (operation.backup === undefined)) {
        throw new Error(
          `Archive write operation ${operation.id} backup must match target existence`,
        );
      }
    } else if (operation.type === 'remove') {
      if (
        operation.source !== undefined ||
        operation.staged !== undefined ||
        operation.stagedHash !== undefined ||
        operation.expectedSourceHash !== undefined ||
        operation.backup === undefined ||
        operation.expectedTargetHash === null
      ) {
        throw new Error(
          `Archive remove operation ${operation.id} requires a bound target and backup`,
        );
      }
    } else {
      if (
        operation.source === undefined ||
        operation.staged !== undefined ||
        operation.stagedHash !== undefined ||
        operation.backup !== undefined ||
        operation.expectedTargetHash !== null
      ) {
        throw new Error(
          `Archive move operation ${operation.id} requires source and an absent target`,
        );
      }
      assertHash(
        operation.expectedSourceHash,
        `Archive move operation ${operation.id} expectedSourceHash`,
      );
    }
    return operation as unknown as NativeArchiveTransactionOperationV2;
  });
  const operationIds = operations.map((operation) => operation.id);
  if (new Set(operationIds).size !== operationIds.length) {
    throw new Error('Native Archive transaction operation ids must be unique');
  }
  const transactionPrefix = `runtime/transactions/${journal.id}`;
  const archiveMoves = operations.filter((operation) => operation.type === 'move');
  if (
    archiveMoves.length !== 1 ||
    archiveMoves[0].id !== 'archive-change' ||
    archiveMoves[0].source !== `changes/${journal.change}` ||
    !new RegExp(`^archive/\\d{4}-\\d{2}-\\d{2}-${journal.change}$`, 'u').test(
      archiveMoves[0].target,
    ) ||
    operations.at(-1) !== archiveMoves[0]
  ) {
    throw new Error('Native Archive transaction must end with its exact change move');
  }
  const specTargets = new Set<string>();
  for (const operation of operations.slice(0, -1)) {
    if (
      operation.type === 'move' ||
      !/^specs\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/spec\.md$/u.test(operation.target) ||
      specTargets.has(operation.target)
    ) {
      throw new Error(`Native Archive transaction spec target is invalid: ${operation.target}`);
    }
    specTargets.add(operation.target);
    if (
      operation.staged !== undefined &&
      !operation.staged.startsWith(`${transactionPrefix}/staged/specs/`)
    ) {
      throw new Error(`Native Archive transaction staged ref is invalid: ${operation.staged}`);
    }
    if (
      operation.backup !== undefined &&
      !operation.backup.startsWith(`${transactionPrefix}/backups/specs/`)
    ) {
      throw new Error(`Native Archive transaction backup ref is invalid: ${operation.backup}`);
    }
  }
  return {
    schema: 'comet.native.transaction.v2',
    id: journal.id,
    kind: 'archive',
    status: journal.status as NativeTransactionStatus,
    change: journal.change,
    createdAt: journal.createdAt,
    preflightHash: journal.preflightHash,
    operations,
  };
}

function parseJournal(value: unknown): NativeTransactionJournal {
  const journal = record(value, 'Native transaction journal');
  if (journal.schema === 'comet.native.transaction.v2') {
    // Generic callers (mutation lock and doctor) only consume the common id/kind/status/change
    // fields. Archive execution always reparses through the v2-specific API below.
    return parseNativeArchiveTransactionJournalV2(journal) as unknown as NativeTransactionJournal;
  }
  rejectUnknown(journal, JOURNAL_KEYS, 'Native transaction journal');
  if (journal.schema !== 'comet.native.transaction.v1') {
    throw new Error('Unsupported Native transaction schema');
  }
  if (typeof journal.id !== 'string' || !/^[a-f0-9-]{8,}$/u.test(journal.id)) {
    throw new Error('Native transaction id is invalid');
  }
  if (journal.kind !== 'archive' && journal.kind !== 'root-move') {
    throw new Error('Native transaction kind is invalid');
  }
  if (
    typeof journal.status !== 'string' ||
    !TRANSACTION_STATUSES.has(journal.status as NativeTransactionStatus)
  ) {
    throw new Error('Native transaction status is invalid');
  }
  if (
    typeof journal.projectRoot !== 'string' ||
    !path.isAbsolute(journal.projectRoot) ||
    typeof journal.nativeRoot !== 'string' ||
    !path.isAbsolute(journal.nativeRoot)
  ) {
    throw new Error('Native transaction roots must be absolute paths');
  }
  if (
    journal.change !== undefined &&
    (typeof journal.change !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(journal.change))
  ) {
    throw new Error('Native transaction change name is invalid');
  }
  if (!validTimestamp(journal.createdAt)) {
    throw new Error('Native transaction createdAt is invalid');
  }
  if (!Array.isArray(journal.operations)) {
    throw new Error('Native transaction operations must be an array');
  }
  const operations = journal.operations.map(parseOperation);
  const operationIds = operations.map((operation) => operation.id);
  if (new Set(operationIds).size !== operationIds.length) {
    throw new Error('Native transaction operation ids must be unique');
  }
  return {
    schema: 'comet.native.transaction.v1',
    id: journal.id,
    kind: journal.kind,
    status: journal.status as NativeTransactionStatus,
    projectRoot: journal.projectRoot,
    nativeRoot: journal.nativeRoot,
    ...(typeof journal.change === 'string' ? { change: journal.change } : {}),
    createdAt: journal.createdAt,
    operations,
  };
}

function parseEvent(value: unknown, line: number): NativeTransactionEvent {
  const event = record(value, `Native transaction event at line ${line}`);
  rejectUnknown(event, EVENT_KEYS, `Native transaction event at line ${line}`);
  if (event.sequence !== line) {
    throw new Error(`Native transaction event sequence at line ${line} must be ${line}`);
  }
  if (!validTimestamp(event.timestamp)) {
    throw new Error(`Native transaction event timestamp at line ${line} is invalid`);
  }
  if (
    typeof event.type !== 'string' ||
    !EVENT_TYPES.has(event.type as NativeTransactionEvent['type'])
  ) {
    throw new Error(`Native transaction event type at line ${line} is invalid`);
  }
  const operationEvent = event.type === 'operation-started' || event.type === 'operation-completed';
  if (
    (operationEvent &&
      (typeof event.operationId !== 'string' ||
        !/^[a-z0-9][a-z0-9-]*$/u.test(event.operationId) ||
        Buffer.byteLength(event.operationId, 'utf8') > 256)) ||
    (!operationEvent && event.operationId !== undefined)
  ) {
    throw new Error(`Native transaction event operationId at line ${line} is invalid`);
  }
  return {
    sequence: event.sequence,
    timestamp: event.timestamp,
    type: event.type as NativeTransactionEvent['type'],
    ...(typeof event.operationId === 'string' ? { operationId: event.operationId } : {}),
  };
}

function matchesIsoTimestampPrefix(value: string): boolean {
  if (value.length > 24) return false;
  const shape = '0000-00-00T00:00:00.000Z';
  for (let index = 0; index < value.length; index += 1) {
    const expected = shape[index];
    const actual = value[index];
    if (expected === '0') {
      if (!/[0-9]/u.test(actual)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  const numericRanges: ReadonlyArray<readonly [number, number, number, number]> = [
    [5, 2, 1, 12],
    [8, 2, 1, 31],
    [11, 2, 0, 23],
    [14, 2, 0, 59],
    [17, 2, 0, 59],
    [20, 3, 0, 999],
  ];
  for (const [offset, width, minimum, maximum] of numericRanges) {
    if (value.length <= offset) continue;
    const partial = value.slice(offset, Math.min(offset + width, value.length));
    const completable = Array.from({ length: maximum - minimum + 1 }, (_entry, index) =>
      String(minimum + index).padStart(width, '0'),
    ).some((candidate) => candidate.startsWith(partial));
    if (!completable) return false;
  }
  if (value.length >= 10 && !validTimestamp(`${value.slice(0, 10)}T00:00:00.000Z`)) {
    return false;
  }
  return value.length < 24 || validTimestamp(value);
}

function isStrictLiteralPrefix(value: string, expected: string): boolean {
  return value.length < expected.length && expected.startsWith(value);
}

function couldCompleteOperationEventSuffix(value: string): boolean {
  const operationPrefix = '","operationId":"';
  if (isStrictLiteralPrefix(value, operationPrefix)) return true;
  if (!value.startsWith(operationPrefix)) return false;
  const remainder = value.slice(operationPrefix.length);
  const closingQuote = remainder.indexOf('"');
  if (closingQuote === -1) {
    return remainder.length === 0 || /^[a-z0-9][a-z0-9-]*$/u.test(remainder);
  }
  const operationId = remainder.slice(0, closingQuote);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(operationId)) return false;
  return isStrictLiteralPrefix(remainder.slice(closingQuote), '"}');
}

/**
 * Legacy writers appended JSON and the trailing newline in one write. A crash
 * could therefore leave only a prefix of the canonical event serialization.
 * Do not treat arbitrary invalid JSON as recoverable: the final bytes must be a
 * strict prefix of an event this runtime could have generated for the next
 * sequence number.
 */
function isRecognizedIncompleteEventTail(source: string, sequence: number): boolean {
  if (
    source.length === 0 ||
    Buffer.byteLength(source, 'utf8') > NATIVE_TRANSACTION_EVENT_MAX_BYTES
  ) {
    return false;
  }
  const prefix = `{"sequence":${sequence},"timestamp":"`;
  if (isStrictLiteralPrefix(source, prefix)) return true;
  if (!source.startsWith(prefix)) return false;

  const afterPrefix = source.slice(prefix.length);
  const timestamp = afterPrefix.slice(0, Math.min(24, afterPrefix.length));
  if (!matchesIsoTimestampPrefix(timestamp)) return false;
  if (afterPrefix.length < 24) return true;
  if (!validTimestamp(timestamp)) return false;

  const typePrefix = '","type":"';
  const afterTimestamp = afterPrefix.slice(24);
  if (isStrictLiteralPrefix(afterTimestamp, typePrefix)) return true;
  if (!afterTimestamp.startsWith(typePrefix)) return false;
  const typeAndSuffix = afterTimestamp.slice(typePrefix.length);

  for (const type of EVENT_TYPES) {
    if (isStrictLiteralPrefix(typeAndSuffix, type)) return true;
    if (!typeAndSuffix.startsWith(type)) continue;
    const suffix = typeAndSuffix.slice(type.length);
    if (type === 'operation-started' || type === 'operation-completed') {
      if (couldCompleteOperationEventSuffix(suffix)) return true;
    } else if (isStrictLiteralPrefix(suffix, '"}')) {
      return true;
    }
  }
  return false;
}

function parseEventLine(source: string, line: number): NativeTransactionEvent {
  if (source.length === 0) throw new Error('Blank transaction event line');
  if (Buffer.byteLength(source, 'utf8') > NATIVE_TRANSACTION_EVENT_MAX_BYTES) {
    throw new Error(`Native transaction event at line ${line} is too large`);
  }
  return parseEvent(JSON.parse(source) as unknown, line);
}

function parseEventLogSource(source: string): NativeTransactionEvent[] {
  const entries = source.split('\n');
  const terminated = entries.at(-1) === '';
  if (terminated) entries.pop();
  if (entries.length > NATIVE_TRANSACTION_EVENT_MAX_COUNT) {
    throw new Error(
      `Native transaction event log exceeds ${NATIVE_TRANSACTION_EVENT_MAX_COUNT} events`,
    );
  }

  const events: NativeTransactionEvent[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const line = index + 1;
    const raw = entries[index];
    const entry = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const finalUnterminated = !terminated && index === entries.length - 1;
    try {
      events.push(parseEventLine(entry, line));
    } catch (error) {
      if (finalUnterminated) {
        let syntacticallyComplete = false;
        try {
          JSON.parse(entry);
          syntacticallyComplete = true;
        } catch {
          // Only a canonical event prefix is a recoverable crash tail.
        }
        if (!syntacticallyComplete && isRecognizedIncompleteEventTail(entry, line)) break;
      }
      throw new Error(`Invalid Native transaction event at line ${line}`, { cause: error });
    }
  }
  return events;
}

function canonicalEventLogSource(events: readonly NativeTransactionEvent[]): string {
  return events.length === 0 ? '' : `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

function transactionDir(paths: NativeProjectPaths, id: string): string {
  if (!/^[a-f0-9-]{8,}$/u.test(id)) throw new Error(`Invalid Native transaction id: ${id}`);
  return path.join(paths.transactionsDir, id);
}

export function nativeTransactionPaths(
  paths: NativeProjectPaths,
  id: string,
): {
  directory: string;
  journal: string;
  events: string;
  staged: string;
  backups: string;
} {
  const directory = transactionDir(paths, id);
  return {
    directory,
    journal: path.join(directory, 'transaction.json'),
    events: path.join(directory, 'events.jsonl'),
    staged: path.join(directory, 'staged'),
    backups: path.join(directory, 'backups'),
  };
}

export async function resolveNativeTransactionPaths(
  paths: NativeProjectPaths,
  id: string,
): Promise<ReturnType<typeof nativeTransactionPaths>> {
  const transaction = nativeTransactionPaths(paths, id);
  await Promise.all(
    Object.values(transaction).map((target) =>
      resolveContainedNativePath(paths.nativeRoot, target),
    ),
  );
  return transaction;
}

function resolveRefLexically(paths: NativeProjectPaths, ref: string): string {
  if (
    ref.length === 0 ||
    path.isAbsolute(ref) ||
    /^(?:[A-Za-z]:|~|[\\/])/u.test(ref) ||
    ref.split(/[\\/]/u).includes('..')
  ) {
    throw new Error(`Unsafe Native transaction ref: ${ref}`);
  }
  const target = path.resolve(paths.nativeRoot, ...ref.split(/[\\/]/u));
  if (!isInsidePath(paths.nativeRoot, target))
    throw new Error(`Unsafe Native transaction ref: ${ref}`);
  return target;
}

async function resolveRef(paths: NativeProjectPaths, ref: string): Promise<string> {
  return resolveContainedNativePath(paths.nativeRoot, resolveRefLexically(paths, ref));
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function readEventLogSnapshot(
  paths: NativeProjectPaths,
  id: string,
  options: NativeTransactionReadOptions = {},
): Promise<NativeTransactionEventLogSnapshot> {
  const tx = await resolveNativeTransactionPaths(paths, id);
  try {
    await fs.lstat(tx.events);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        exists: false,
        hash: null,
        size: 0,
        events: [],
        canonicalSource: '',
        needsRepair: false,
      };
    }
    throw error;
  }
  try {
    const snapshot = await readNativeProtectedFile({
      root: paths.nativeRoot,
      file: tx.events,
      maxBytes: NATIVE_TRANSACTION_EVENTS_MAX_BYTES,
      label: `Native transaction event log ${id}`,
      hooks: options.hooks,
    });
    let source: string;
    try {
      source = UTF8_DECODER.decode(snapshot.bytes);
    } catch (error) {
      throw new Error(`Native transaction event log ${id} is not valid UTF-8`, { cause: error });
    }
    const events = parseEventLogSource(source);
    const canonicalSource = canonicalEventLogSource(events);
    return {
      exists: true,
      hash: snapshot.hash,
      size: snapshot.size,
      events,
      canonicalSource,
      needsRepair: source !== canonicalSource,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Native transaction event log ${id} changed while reading`, {
        cause: error,
      });
    }
    throw error;
  }
}

async function assertEventLogSnapshotUnchanged(
  paths: NativeProjectPaths,
  id: string,
  expected: NativeTransactionEventLogSnapshot,
): Promise<void> {
  const actual = await readEventLogSnapshot(paths, id);
  if (
    actual.exists !== expected.exists ||
    actual.hash !== expected.hash ||
    actual.size !== expected.size
  ) {
    throw new Error(`Native transaction event log ${id} changed before append`);
  }
}

export async function appendNativeTransactionEvent(
  paths: NativeProjectPaths,
  id: string,
  type: NativeTransactionEvent['type'],
  operationId?: string,
): Promise<NativeTransactionEvent> {
  const tx = await resolveNativeTransactionPaths(paths, id);
  const snapshot = await readEventLogSnapshot(paths, id);
  const existing = snapshot.events.find(
    (event) => event.type === type && event.operationId === operationId,
  );
  if (existing) {
    if (snapshot.needsRepair) {
      await atomicWriteText(tx.events, snapshot.canonicalSource, {
        containedRoot: paths.nativeRoot,
        beforeCommit: () => assertEventLogSnapshotUnchanged(paths, id, snapshot),
      });
    }
    return existing;
  }
  if (snapshot.events.length >= NATIVE_TRANSACTION_EVENT_MAX_COUNT) {
    throw new Error(
      `Native transaction event log ${id} exceeds ${NATIVE_TRANSACTION_EVENT_MAX_COUNT} events`,
    );
  }
  const event: NativeTransactionEvent = {
    sequence: snapshot.events.length + 1,
    timestamp: new Date().toISOString(),
    type,
    ...(operationId ? { operationId } : {}),
  };
  parseEvent(event, event.sequence);
  await fs.mkdir(tx.directory, { recursive: true });
  await atomicWriteText(tx.events, canonicalEventLogSource([...snapshot.events, event]), {
    containedRoot: paths.nativeRoot,
    beforeCommit: () => assertEventLogSnapshotUnchanged(paths, id, snapshot),
  });
  return event;
}

export async function createNativeTransaction(
  paths: NativeProjectPaths,
  journal: NativeTransactionJournal,
): Promise<void> {
  if ((journal as unknown as { schema: string }).schema !== 'comet.native.transaction.v1') {
    throw new Error('Native Archive v2 transactions require the content-bound transaction API');
  }
  journal = parseJournal(journal);
  const tx = await resolveNativeTransactionPaths(paths, journal.id);
  await fs.mkdir(tx.staged, { recursive: true });
  await fs.mkdir(tx.backups, { recursive: true });
  await atomicWriteJson(tx.journal, journal);
  await appendNativeTransactionEvent(paths, journal.id, 'prepared');
}

export async function readNativeTransaction(
  paths: NativeProjectPaths,
  id: string,
  options: NativeTransactionReadOptions = {},
): Promise<NativeTransactionJournal> {
  const tx = await resolveNativeTransactionPaths(paths, id);
  const snapshot = await readNativeProtectedFile({
    root: paths.nativeRoot,
    file: tx.journal,
    maxBytes: NATIVE_TRANSACTION_JOURNAL_MAX_BYTES,
    label: `Native transaction journal ${id}`,
    hooks: options.hooks,
  });
  const value = JSON.parse(UTF8_DECODER.decode(snapshot.bytes)) as unknown;
  const journal = parseJournal(value);
  if (journal.id !== id) {
    throw new Error(`Invalid Native transaction journal: ${id}`);
  }
  return journal;
}

export async function readNativeTransactionEvents(
  paths: NativeProjectPaths,
  id: string,
  options: NativeTransactionReadOptions = {},
): Promise<NativeTransactionEvent[]> {
  return (await readEventLogSnapshot(paths, id, options)).events;
}

export async function setNativeTransactionStatus(
  paths: NativeProjectPaths,
  journal: NativeTransactionJournal,
  status: NativeTransactionStatus,
): Promise<NativeTransactionJournal> {
  if ((journal as unknown as { schema: string }).schema !== 'comet.native.transaction.v1') {
    throw new Error('Native Archive v2 transactions require the content-bound transaction API');
  }
  const updated = parseJournal({ ...journal, status });
  await atomicWriteJson((await resolveNativeTransactionPaths(paths, journal.id)).journal, updated);
  return updated;
}

async function readLegacyTransactionFile(
  paths: NativeProjectPaths,
  file: string,
  label: string,
): Promise<NativeProtectedFile | null> {
  try {
    return await readNativeProtectedFile({
      root: paths.nativeRoot,
      file,
      maxBytes: NATIVE_LEGACY_TRANSACTION_FILE_MAX_BYTES,
      label,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function copyAtomic(
  paths: NativeProjectPaths,
  source: string,
  target: string,
  label: string,
): Promise<void> {
  const sourceSnapshot = await readLegacyTransactionFile(paths, source, `${label} source`);
  if (!sourceSnapshot) throw new Error(`${label} source does not exist`);
  const targetSnapshot = await readLegacyTransactionFile(paths, target, `${label} target`);
  await ensureNativeProtectedDirectory({
    root: paths.nativeRoot,
    directory: path.dirname(target),
    label: `${label} target parent`,
  });
  await copyNativeProtectedFile({
    sourceRoot: paths.nativeRoot,
    source,
    targetRoot: paths.nativeRoot,
    target,
    maxBytes: NATIVE_LEGACY_TRANSACTION_FILE_MAX_BYTES,
    label,
    expectedHash: sourceSnapshot.hash,
    expectedTargetHash: targetSnapshot?.hash ?? null,
    exclusive: targetSnapshot === null,
  });
}

async function removeLegacyTransactionFile(
  paths: NativeProjectPaths,
  file: string,
  label: string,
): Promise<void> {
  const snapshot = await readLegacyTransactionFile(paths, file, label);
  if (!snapshot) return;
  await removeNativeProtectedFile({
    root: paths.nativeRoot,
    file,
    maxBytes: NATIVE_LEGACY_TRANSACTION_FILE_MAX_BYTES,
    expectedHash: snapshot.hash,
    expectedSize: snapshot.size,
    label,
  });
}

async function backupTarget(
  paths: NativeProjectPaths,
  operation: NativeTransactionOperation,
): Promise<void> {
  if (!operation.backup) return;
  const target = await resolveRef(paths, operation.target);
  const backup = await resolveRef(paths, operation.backup);
  if (!(await exists(target)) || (await exists(backup))) return;
  await copyAtomic(paths, target, backup, `Legacy Native transaction backup ${operation.id}`);
}

async function applyOperation(
  paths: NativeProjectPaths,
  operation: NativeTransactionOperation,
): Promise<void> {
  const target = await resolveRef(paths, operation.target);
  if (operation.type === 'write') {
    if (!operation.staged) throw new Error(`Write operation ${operation.id} has no staged ref`);
    await backupTarget(paths, operation);
    await copyAtomic(
      paths,
      await resolveRef(paths, operation.staged),
      target,
      `Legacy Native transaction write ${operation.id}`,
    );
    return;
  }
  if (operation.type === 'remove') {
    await backupTarget(paths, operation);
    await removeLegacyTransactionFile(
      paths,
      target,
      `Legacy Native transaction remove ${operation.id}`,
    );
    return;
  }
  if (!operation.source) throw new Error(`Move operation ${operation.id} has no source ref`);
  const source = await resolveRef(paths, operation.source);
  const [sourceExists, targetExists] = await Promise.all([exists(source), exists(target)]);
  if (!sourceExists && targetExists) {
    const targetDirectory = await readNativeProtectedDirectory({
      root: paths.nativeRoot,
      directory: target,
      label: `Legacy Native transaction move target ${operation.id}`,
      maxEntries: NATIVE_LEGACY_TRANSACTION_DIRECTORY_MAX_ENTRIES,
    });
    await targetDirectory.verify();
    return;
  }
  if (targetExists) throw new Error(`Move target already exists: ${operation.target}`);
  if (!sourceExists) throw new Error(`Move source does not exist: ${operation.source}`);
  await moveNativeProtectedDirectory({
    root: paths.nativeRoot,
    source,
    target,
    label: `Legacy Native transaction move ${operation.id}`,
  });
}

export async function applyNativeTransaction(
  paths: NativeProjectPaths,
  journal: NativeTransactionJournal,
  hooks?: NativeTransactionHooks,
): Promise<NativeTransactionJournal> {
  if ((journal as unknown as { schema: string }).schema !== 'comet.native.transaction.v1') {
    throw new Error('Native Archive v2 transactions require the content-bound transaction API');
  }
  let current =
    journal.status === 'prepared'
      ? await setNativeTransactionStatus(paths, journal, 'applying')
      : journal;
  const events = await readNativeTransactionEvents(paths, journal.id);
  const completed = new Set(
    events
      .filter((event) => event.type === 'operation-completed')
      .map((event) => event.operationId),
  );
  let completedCount = completed.size;
  for (const operation of current.operations) {
    if (completed.has(operation.id)) continue;
    await appendNativeTransactionEvent(paths, current.id, 'operation-started', operation.id);
    await applyOperation(paths, operation);
    await appendNativeTransactionEvent(paths, current.id, 'operation-completed', operation.id);
    completedCount += 1;
    await hooks?.afterOperation?.(operation, completedCount);
  }
  current = await readNativeTransaction(paths, current.id);
  return current;
}

async function rollbackOperation(
  paths: NativeProjectPaths,
  operation: NativeTransactionOperation,
): Promise<void> {
  const target = await resolveRef(paths, operation.target);
  const backup = operation.backup ? await resolveRef(paths, operation.backup) : null;
  if (operation.type === 'move') {
    if (!operation.source) throw new Error(`Move operation ${operation.id} has no source ref`);
    const source = await resolveRef(paths, operation.source);
    if (await exists(target)) {
      if (await exists(source)) {
        throw new Error(`Legacy Native rollback source already exists: ${operation.source}`);
      }
      await moveNativeProtectedDirectory({
        root: paths.nativeRoot,
        source: target,
        target: source,
        label: `Legacy Native transaction rollback move ${operation.id}`,
      });
    }
    return;
  }
  if (backup && (await exists(backup))) {
    await copyAtomic(
      paths,
      backup,
      target,
      `Legacy Native transaction rollback restore ${operation.id}`,
    );
  } else {
    await removeLegacyTransactionFile(
      paths,
      target,
      `Legacy Native transaction rollback remove ${operation.id}`,
    );
  }
}

export async function rollbackNativeTransaction(
  paths: NativeProjectPaths,
  journal: NativeTransactionJournal,
): Promise<NativeTransactionJournal> {
  if ((journal as unknown as { schema: string }).schema !== 'comet.native.transaction.v1') {
    throw new Error('Native Archive v2 transactions require the content-bound transaction API');
  }
  const events = await readNativeTransactionEvents(paths, journal.id);
  if (
    events.some(
      (event) =>
        event.type === 'archive-finalization-started' || event.type === 'archive-finalized',
    )
  ) {
    throw new Error('An archive whose finalization started can only be recovered by continuing it');
  }
  let current = await setNativeTransactionStatus(paths, journal, 'rolling-back');
  await appendNativeTransactionEvent(paths, current.id, 'rollback-started');
  const started = new Set(
    events
      .filter((event) => event.type === 'operation-started' || event.type === 'operation-completed')
      .map((event) => event.operationId),
  );
  for (const operation of [...current.operations].reverse()) {
    if (started.has(operation.id)) await rollbackOperation(paths, operation);
  }
  await appendNativeTransactionEvent(paths, current.id, 'rollback-completed');
  current = await setNativeTransactionStatus(paths, current, 'rolled-back');
  return current;
}

export async function finalizeNativeTransaction(
  paths: NativeProjectPaths,
  journal: NativeTransactionJournal,
  event: 'archive-finalization-started' | 'archive-finalized' | 'commit',
): Promise<NativeTransactionJournal> {
  if ((journal as unknown as { schema: string }).schema !== 'comet.native.transaction.v1') {
    throw new Error('Native Archive v2 transactions require the content-bound transaction API');
  }
  await appendNativeTransactionEvent(paths, journal.id, event);
  return event === 'commit' ? setNativeTransactionStatus(paths, journal, 'committed') : journal;
}

export function nativeRootRef(paths: NativeProjectPaths, target: string): string {
  const absolute = path.resolve(target);
  if (!isInsidePath(paths.nativeRoot, absolute)) {
    throw new Error(`Path is outside the Native root: ${target}`);
  }
  return path.relative(paths.nativeRoot, absolute).split(path.sep).join('/');
}
