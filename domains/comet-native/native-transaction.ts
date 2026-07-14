import { promises as fs } from 'fs';
import path from 'path';

import { atomicWriteJson, atomicWriteText } from './native-atomic-file.js';
import { isInsidePath } from './native-paths.js';
import type {
  NativeProjectPaths,
  NativeTransactionEvent,
  NativeTransactionHooks,
  NativeTransactionJournal,
  NativeTransactionOperation,
  NativeTransactionStatus,
} from './native-types.js';

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

function resolveRef(paths: NativeProjectPaths, ref: string): string {
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

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function appendEvent(
  paths: NativeProjectPaths,
  journal: NativeTransactionJournal,
  type: NativeTransactionEvent['type'],
  operationId?: string,
): Promise<NativeTransactionEvent> {
  const tx = nativeTransactionPaths(paths, journal.id);
  const events = await readNativeTransactionEvents(paths, journal.id);
  const event: NativeTransactionEvent = {
    sequence: events.length + 1,
    timestamp: new Date().toISOString(),
    type,
    ...(operationId ? { operationId } : {}),
  };
  await fs.mkdir(tx.directory, { recursive: true });
  const handle = await fs.open(tx.events, 'a');
  try {
    await handle.writeFile(JSON.stringify(event) + '\n', 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return event;
}

export async function createNativeTransaction(
  paths: NativeProjectPaths,
  journal: NativeTransactionJournal,
): Promise<void> {
  const tx = nativeTransactionPaths(paths, journal.id);
  await fs.mkdir(tx.staged, { recursive: true });
  await fs.mkdir(tx.backups, { recursive: true });
  await atomicWriteJson(tx.journal, journal);
  await appendEvent(paths, journal, 'prepared');
}

export async function readNativeTransaction(
  paths: NativeProjectPaths,
  id: string,
): Promise<NativeTransactionJournal> {
  const value = JSON.parse(
    await fs.readFile(nativeTransactionPaths(paths, id).journal, 'utf8'),
  ) as NativeTransactionJournal;
  if (value.schema !== 'comet.native.transaction.v1' || value.id !== id) {
    throw new Error(`Invalid Native transaction journal: ${id}`);
  }
  return value;
}

export async function readNativeTransactionEvents(
  paths: NativeProjectPaths,
  id: string,
): Promise<NativeTransactionEvent[]> {
  let source: string;
  try {
    source = await fs.readFile(nativeTransactionPaths(paths, id).events, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return source
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as NativeTransactionEvent);
}

export async function setNativeTransactionStatus(
  paths: NativeProjectPaths,
  journal: NativeTransactionJournal,
  status: NativeTransactionStatus,
): Promise<NativeTransactionJournal> {
  const updated = { ...journal, status };
  await atomicWriteJson(nativeTransactionPaths(paths, journal.id).journal, updated);
  return updated;
}

async function copyAtomic(source: string, target: string): Promise<void> {
  const content = await fs.readFile(source);
  await atomicWriteText(target, content.toString('utf8'));
}

async function backupTarget(
  paths: NativeProjectPaths,
  operation: NativeTransactionOperation,
): Promise<void> {
  if (!operation.backup) return;
  const target = resolveRef(paths, operation.target);
  const backup = resolveRef(paths, operation.backup);
  if (!(await exists(target)) || (await exists(backup))) return;
  await fs.mkdir(path.dirname(backup), { recursive: true });
  await fs.copyFile(target, backup);
}

async function applyOperation(
  paths: NativeProjectPaths,
  operation: NativeTransactionOperation,
): Promise<void> {
  const target = resolveRef(paths, operation.target);
  if (operation.type === 'write') {
    if (!operation.staged) throw new Error(`Write operation ${operation.id} has no staged ref`);
    await backupTarget(paths, operation);
    await copyAtomic(resolveRef(paths, operation.staged), target);
    return;
  }
  if (operation.type === 'remove') {
    await backupTarget(paths, operation);
    await fs.rm(target, { force: true });
    return;
  }
  if (!operation.source) throw new Error(`Move operation ${operation.id} has no source ref`);
  const source = resolveRef(paths, operation.source);
  const [sourceExists, targetExists] = await Promise.all([exists(source), exists(target)]);
  if (!sourceExists && targetExists) return;
  if (targetExists) throw new Error(`Move target already exists: ${operation.target}`);
  if (!sourceExists) throw new Error(`Move source does not exist: ${operation.source}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(source, target);
}

export async function applyNativeTransaction(
  paths: NativeProjectPaths,
  journal: NativeTransactionJournal,
  hooks?: NativeTransactionHooks,
): Promise<NativeTransactionJournal> {
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
    await appendEvent(paths, current, 'operation-started', operation.id);
    await applyOperation(paths, operation);
    await appendEvent(paths, current, 'operation-completed', operation.id);
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
  const target = resolveRef(paths, operation.target);
  const backup = operation.backup ? resolveRef(paths, operation.backup) : null;
  if (operation.type === 'move') {
    if (!operation.source) throw new Error(`Move operation ${operation.id} has no source ref`);
    const source = resolveRef(paths, operation.source);
    if (await exists(target)) {
      await fs.mkdir(path.dirname(source), { recursive: true });
      await fs.rename(target, source);
    }
    return;
  }
  if (backup && (await exists(backup))) {
    await copyAtomic(backup, target);
  } else {
    await fs.rm(target, { force: true });
  }
}

export async function rollbackNativeTransaction(
  paths: NativeProjectPaths,
  journal: NativeTransactionJournal,
): Promise<NativeTransactionJournal> {
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
  await appendEvent(paths, current, 'rollback-started');
  const started = new Set(
    events
      .filter((event) => event.type === 'operation-started' || event.type === 'operation-completed')
      .map((event) => event.operationId),
  );
  for (const operation of [...current.operations].reverse()) {
    if (started.has(operation.id)) await rollbackOperation(paths, operation);
  }
  await appendEvent(paths, current, 'rollback-completed');
  current = await setNativeTransactionStatus(paths, current, 'rolled-back');
  return current;
}

export async function finalizeNativeTransaction(
  paths: NativeProjectPaths,
  journal: NativeTransactionJournal,
  event: 'archive-finalization-started' | 'archive-finalized' | 'commit',
): Promise<NativeTransactionJournal> {
  await appendEvent(paths, journal, event);
  return event === 'commit' ? setNativeTransactionStatus(paths, journal, 'committed') : journal;
}

export function nativeRootRef(paths: NativeProjectPaths, target: string): string {
  const absolute = path.resolve(target);
  if (!isInsidePath(paths.nativeRoot, absolute)) {
    throw new Error(`Path is outside the Native root: ${target}`);
  }
  return path.relative(paths.nativeRoot, absolute).split(path.sep).join('/');
}
