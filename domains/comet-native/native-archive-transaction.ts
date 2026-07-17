import { promises as fs } from 'node:fs';
import path from 'node:path';

import { atomicWriteJson, atomicWriteText } from './native-atomic-file.js';
import {
  inspectNativeArchiveContent,
  type NativeArchiveContentIdentity,
} from './native-archive-content.js';
import { resolveContainedNativePath } from './native-paths.js';
import {
  nativeTransactionPaths,
  parseNativeArchiveTransactionJournalV2,
  readNativeTransactionEvents,
  resolveNativeTransactionPaths,
  type NativeArchiveTransactionJournalV2,
  type NativeArchiveTransactionOperationV2,
} from './native-transaction.js';
import type {
  NativeProjectPaths,
  NativeTransactionEvent,
  NativeTransactionStatus,
} from './native-types.js';

export interface NativeArchiveTransactionHooksV2 {
  afterPrepared?: (journal: NativeArchiveTransactionJournalV2) => void | Promise<void>;
  afterOperation?: (
    operation: NativeArchiveTransactionOperationV2,
    completedCount: number,
  ) => void | Promise<void>;
}

function resolveRefLexically(paths: NativeProjectPaths, ref: string): string {
  const target = path.resolve(paths.nativeRoot, ...ref.split('/'));
  if (path.relative(paths.nativeRoot, target).split(path.sep).includes('..')) {
    throw new Error(`Unsafe Native Archive transaction ref: ${ref}`);
  }
  return target;
}

async function resolveRef(paths: NativeProjectPaths, ref: string): Promise<string> {
  return resolveContainedNativePath(paths.nativeRoot, resolveRefLexically(paths, ref));
}

function sameContent(
  actual: NativeArchiveContentIdentity | null,
  expectedHash: string | null,
  expectedKind: NativeArchiveContentIdentity['kind'] = 'file',
): boolean {
  return expectedHash === null
    ? actual === null
    : actual?.kind === expectedKind && actual.hash === expectedHash;
}

function contentDescription(value: NativeArchiveContentIdentity | null): string {
  return value === null ? 'missing' : `${value.kind}:${value.hash}`;
}

async function assertContent(options: {
  target: string;
  expectedHash: string | null;
  expectedKind?: NativeArchiveContentIdentity['kind'];
  label: string;
}): Promise<NativeArchiveContentIdentity | null> {
  const actual = await inspectNativeArchiveContent(options.target);
  if (!sameContent(actual, options.expectedHash, options.expectedKind)) {
    throw new Error(
      `${options.label} content changed: expected ${options.expectedHash ?? 'missing'}, got ${contentDescription(actual)}`,
    );
  }
  return actual;
}

async function appendEvent(
  paths: NativeProjectPaths,
  journal: NativeArchiveTransactionJournalV2,
  type: NativeTransactionEvent['type'],
  operationId?: string,
): Promise<void> {
  const tx = await resolveNativeTransactionPaths(paths, journal.id);
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
    await handle.writeFile(`${JSON.stringify(event)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function createNativeArchiveTransactionV2(
  paths: NativeProjectPaths,
  journal: NativeArchiveTransactionJournalV2,
): Promise<void> {
  const validated = parseNativeArchiveTransactionJournalV2(journal);
  const tx = await resolveNativeTransactionPaths(paths, validated.id);
  await fs.mkdir(tx.staged, { recursive: true });
  await fs.mkdir(tx.backups, { recursive: true });
  await atomicWriteJson(tx.journal, validated, { containedRoot: paths.nativeRoot });
  await appendEvent(paths, validated, 'prepared');
}

export async function readNativeArchiveTransactionV2(
  paths: NativeProjectPaths,
  id: string,
): Promise<NativeArchiveTransactionJournalV2> {
  const tx = await resolveNativeTransactionPaths(paths, id);
  const journal = parseNativeArchiveTransactionJournalV2(
    JSON.parse(await fs.readFile(tx.journal, 'utf8')) as unknown,
  );
  if (journal.id !== id) throw new Error(`Invalid Native Archive transaction journal: ${id}`);
  return journal;
}

async function setStatus(
  paths: NativeProjectPaths,
  journal: NativeArchiveTransactionJournalV2,
  status: NativeTransactionStatus,
): Promise<NativeArchiveTransactionJournalV2> {
  const updated = parseNativeArchiveTransactionJournalV2({ ...journal, status });
  const tx = await resolveNativeTransactionPaths(paths, updated.id);
  await atomicWriteJson(tx.journal, updated, { containedRoot: paths.nativeRoot });
  return updated;
}

async function ensureBackup(
  paths: NativeProjectPaths,
  operation: NativeArchiveTransactionOperationV2,
): Promise<void> {
  if (!operation.backup || operation.expectedTargetHash === null) return;
  const target = await resolveRef(paths, operation.target);
  const backup = await resolveRef(paths, operation.backup);
  const existing = await inspectNativeArchiveContent(backup);
  if (existing !== null) {
    if (!sameContent(existing, operation.expectedTargetHash)) {
      throw new Error(`Archive transaction backup content changed: ${operation.backup}`);
    }
    return;
  }
  await assertContent({
    target,
    expectedHash: operation.expectedTargetHash,
    label: `Archive transaction target ${operation.target}`,
  });
  await fs.mkdir(path.dirname(backup), { recursive: true });
  await fs.copyFile(target, backup, fs.constants.COPYFILE_EXCL);
  await assertContent({
    target: backup,
    expectedHash: operation.expectedTargetHash,
    label: `Archive transaction backup ${operation.backup}`,
  });
}

async function applyWrite(
  paths: NativeProjectPaths,
  operation: NativeArchiveTransactionOperationV2,
): Promise<void> {
  const target = await resolveRef(paths, operation.target);
  const staged = await resolveRef(paths, operation.staged!);
  await assertContent({
    target: staged,
    expectedHash: operation.stagedHash!,
    label: `Archive transaction staged file ${operation.staged}`,
  });
  const actual = await inspectNativeArchiveContent(target);
  if (sameContent(actual, operation.stagedHash!)) {
    await ensureBackup(paths, operation);
    return;
  }
  if (!sameContent(actual, operation.expectedTargetHash)) {
    throw new Error(
      `Archive transaction target ${operation.target} content changed before write: ${contentDescription(actual)}`,
    );
  }
  await ensureBackup(paths, operation);
  const content = await fs.readFile(staged);
  await atomicWriteText(target, content.toString('utf8'), { containedRoot: paths.nativeRoot });
  await assertContent({
    target,
    expectedHash: operation.stagedHash!,
    label: `Archive transaction target ${operation.target}`,
  });
}

async function applyRemove(
  paths: NativeProjectPaths,
  operation: NativeArchiveTransactionOperationV2,
): Promise<void> {
  const target = await resolveRef(paths, operation.target);
  const actual = await inspectNativeArchiveContent(target);
  if (actual === null) {
    await ensureBackup(paths, operation);
    return;
  }
  if (!sameContent(actual, operation.expectedTargetHash)) {
    throw new Error(
      `Archive transaction target ${operation.target} content changed before remove: ${contentDescription(actual)}`,
    );
  }
  await ensureBackup(paths, operation);
  await fs.rm(target);
  await assertContent({
    target,
    expectedHash: null,
    label: `Archive transaction target ${operation.target}`,
  });
}

async function applyMove(
  paths: NativeProjectPaths,
  operation: NativeArchiveTransactionOperationV2,
): Promise<void> {
  const source = await resolveRef(paths, operation.source!);
  const target = await resolveRef(paths, operation.target);
  const [sourceContent, targetContent] = await Promise.all([
    inspectNativeArchiveContent(source),
    inspectNativeArchiveContent(target),
  ]);
  if (
    sourceContent === null &&
    sameContent(targetContent, operation.expectedSourceHash!, 'directory')
  ) {
    return;
  }
  if (
    !sameContent(sourceContent, operation.expectedSourceHash!, 'directory') ||
    targetContent !== null
  ) {
    throw new Error(
      `Archive transaction move ${operation.id} content changed: source=${contentDescription(sourceContent)}, target=${contentDescription(targetContent)}`,
    );
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(source, target);
  await assertContent({
    target,
    expectedHash: operation.expectedSourceHash!,
    expectedKind: 'directory',
    label: `Archive transaction move target ${operation.target}`,
  });
}

async function applyOperation(
  paths: NativeProjectPaths,
  operation: NativeArchiveTransactionOperationV2,
): Promise<void> {
  if (operation.type === 'write') return applyWrite(paths, operation);
  if (operation.type === 'remove') return applyRemove(paths, operation);
  return applyMove(paths, operation);
}

function completedOperationIds(options: {
  journal: NativeArchiveTransactionJournalV2;
  events: readonly NativeTransactionEvent[];
}): string[] {
  let operationIndex = 0;
  let startedCurrent = false;
  const completed: string[] = [];
  for (const event of options.events) {
    if (event.type !== 'operation-started' && event.type !== 'operation-completed') continue;
    const expected = options.journal.operations[operationIndex];
    if (!expected || event.operationId !== expected.id) {
      throw new Error(
        `Native Archive transaction ${options.journal.id} operation events are out of order`,
      );
    }
    if (event.type === 'operation-started') {
      startedCurrent = true;
      continue;
    }
    if (!startedCurrent) {
      throw new Error(
        `Native Archive transaction ${options.journal.id} completed an operation before it started`,
      );
    }
    completed.push(expected.id);
    operationIndex += 1;
    startedCurrent = false;
  }
  return completed;
}

async function assertCompletedOperation(
  paths: NativeProjectPaths,
  operation: NativeArchiveTransactionOperationV2,
  finalizationStarted: boolean,
): Promise<void> {
  const target = await resolveRef(paths, operation.target);
  if (operation.type === 'write') {
    const staged = await resolveRef(paths, operation.staged!);
    await assertContent({
      target: staged,
      expectedHash: operation.stagedHash!,
      label: `Completed Archive staged file ${operation.staged}`,
    });
    await assertContent({
      target,
      expectedHash: operation.stagedHash!,
      label: `Completed Archive target ${operation.target}`,
    });
    if (operation.expectedTargetHash !== null) {
      await assertContent({
        target: await resolveRef(paths, operation.backup!),
        expectedHash: operation.expectedTargetHash,
        label: `Completed Archive backup ${operation.backup}`,
      });
    }
    return;
  }
  if (operation.type === 'remove') {
    await assertContent({
      target,
      expectedHash: null,
      label: `Completed Archive target ${operation.target}`,
    });
    await assertContent({
      target: await resolveRef(paths, operation.backup!),
      expectedHash: operation.expectedTargetHash,
      label: `Completed Archive backup ${operation.backup}`,
    });
    return;
  }
  if (finalizationStarted) return;
  await assertContent({
    target: await resolveRef(paths, operation.source!),
    expectedHash: null,
    label: `Completed Archive move source ${operation.source}`,
  });
  await assertContent({
    target,
    expectedHash: operation.expectedSourceHash!,
    expectedKind: 'directory',
    label: `Completed Archive move target ${operation.target}`,
  });
}

export async function applyNativeArchiveTransactionV2(
  paths: NativeProjectPaths,
  journal: NativeArchiveTransactionJournalV2,
  hooks?: NativeArchiveTransactionHooksV2,
): Promise<NativeArchiveTransactionJournalV2> {
  let current =
    journal.status === 'prepared' ? await setStatus(paths, journal, 'applying') : journal;
  if (current.status !== 'applying') {
    throw new Error(`Native Archive transaction ${current.id} cannot apply from ${current.status}`);
  }
  const events = await readNativeTransactionEvents(paths, current.id);
  const completedIds = completedOperationIds({ journal: current, events });
  const completed = new Set(completedIds);
  const finalizationStarted = events.some((event) => event.type === 'archive-finalization-started');
  for (const operation of current.operations.slice(0, completedIds.length)) {
    await assertCompletedOperation(paths, operation, finalizationStarted);
  }
  let completedCount = completed.size;
  for (const operation of current.operations) {
    if (completed.has(operation.id)) continue;
    await appendEvent(paths, current, 'operation-started', operation.id);
    await applyOperation(paths, operation);
    await appendEvent(paths, current, 'operation-completed', operation.id);
    completedCount += 1;
    await hooks?.afterOperation?.(operation, completedCount);
  }
  current = await readNativeArchiveTransactionV2(paths, current.id);
  return current;
}

async function rollbackWriteOrRemove(
  paths: NativeProjectPaths,
  operation: NativeArchiveTransactionOperationV2,
): Promise<void> {
  const target = await resolveRef(paths, operation.target);
  const expectedPostHash = operation.type === 'write' ? operation.stagedHash! : null;
  const actual = await inspectNativeArchiveContent(target);
  if (sameContent(actual, operation.expectedTargetHash)) return;
  if (!sameContent(actual, expectedPostHash)) {
    throw new Error(
      `Archive rollback target ${operation.target} content changed: ${contentDescription(actual)}`,
    );
  }
  if (operation.expectedTargetHash === null) {
    await fs.rm(target, { force: true });
  } else {
    const backup = await resolveRef(paths, operation.backup!);
    await assertContent({
      target: backup,
      expectedHash: operation.expectedTargetHash,
      label: `Archive rollback backup ${operation.backup}`,
    });
    const content = await fs.readFile(backup);
    await atomicWriteText(target, content.toString('utf8'), { containedRoot: paths.nativeRoot });
  }
  await assertContent({
    target,
    expectedHash: operation.expectedTargetHash,
    label: `Archive rollback target ${operation.target}`,
  });
}

async function rollbackMove(
  paths: NativeProjectPaths,
  operation: NativeArchiveTransactionOperationV2,
): Promise<void> {
  const source = await resolveRef(paths, operation.source!);
  const target = await resolveRef(paths, operation.target);
  const [sourceContent, targetContent] = await Promise.all([
    inspectNativeArchiveContent(source),
    inspectNativeArchiveContent(target),
  ]);
  if (
    sameContent(sourceContent, operation.expectedSourceHash!, 'directory') &&
    targetContent === null
  ) {
    return;
  }
  if (
    sourceContent !== null ||
    !sameContent(targetContent, operation.expectedSourceHash!, 'directory')
  ) {
    throw new Error(
      `Archive rollback move ${operation.id} content changed: source=${contentDescription(sourceContent)}, target=${contentDescription(targetContent)}`,
    );
  }
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.rename(target, source);
}

export async function rollbackNativeArchiveTransactionV2(
  paths: NativeProjectPaths,
  journal: NativeArchiveTransactionJournalV2,
): Promise<NativeArchiveTransactionJournalV2> {
  const events = await readNativeTransactionEvents(paths, journal.id);
  if (
    events.some(
      (event) =>
        event.type === 'archive-finalization-started' || event.type === 'archive-finalized',
    )
  ) {
    throw new Error('An archive whose finalization started can only be recovered by continuing it');
  }
  let current = await setStatus(paths, journal, 'rolling-back');
  await appendEvent(paths, current, 'rollback-started');
  const started = new Set(
    events
      .filter((event) => event.type === 'operation-started' || event.type === 'operation-completed')
      .map((event) => event.operationId),
  );
  for (const operation of [...current.operations].reverse()) {
    if (!started.has(operation.id)) continue;
    if (operation.type === 'move') await rollbackMove(paths, operation);
    else await rollbackWriteOrRemove(paths, operation);
  }
  await appendEvent(paths, current, 'rollback-completed');
  current = await setStatus(paths, current, 'rolled-back');
  return current;
}

export async function finalizeNativeArchiveTransactionV2(
  paths: NativeProjectPaths,
  journal: NativeArchiveTransactionJournalV2,
  event: 'archive-finalization-started' | 'archive-finalized' | 'commit',
): Promise<NativeArchiveTransactionJournalV2> {
  await appendEvent(paths, journal, event);
  return event === 'commit' ? setStatus(paths, journal, 'committed') : journal;
}

export function nativeArchiveTransactionPaths(
  paths: NativeProjectPaths,
  id: string,
): ReturnType<typeof nativeTransactionPaths> {
  return nativeTransactionPaths(paths, id);
}
