import path from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { withRecoverableFileLock } from '../../platform/fs/plugin-store.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { Document, parseDocument } from 'yaml';
import {
  atomicWriteContainedText,
  removeContainedFile,
} from '../workflow-contract/contained-atomic-write.js';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import {
  CLASSIC_WIRE_KEYS,
  classicStateToDocument,
  parseClassicStateDocument,
  readLegacyStateSummary,
  type ClassicStateProjection,
  type LegacyStateSummary,
} from './classic-state.js';
import {
  applyRunStateToDocument,
  readRunState,
  writeRunState,
  removeRunState,
  runStateFromDocument,
  type StateDocument,
} from '../../domains/engine/state.js';

const CLASSIC_STATE_MAX_BYTES = 2 * 1024 * 1024;
const stateLock = new AsyncLocalStorage<string>();
const STATE_TRANSACTION = '.comet-state-transaction.json';

export async function withClassicStateLock<T>(
  changeDir: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(changeDir);
  if (stateLock.getStore() === key) return operation();
  await inspectProtectedProjectPath(key, '.comet-state.lock', {
    label: 'Classic state lock',
    expected: 'file',
  });
  return withRecoverableFileLock(path.join(key, '.comet-state.lock'), () =>
    stateLock.run(key, async () => {
      await recoverStateTransaction(key);
      return operation();
    }),
  );
}

async function optionalStateText(changeDir: string, file: string): Promise<string | null> {
  try {
    return (
      await readProtectedProjectFile(changeDir, file, CLASSIC_STATE_MAX_BYTES * 4, {
        label: 'Classic state transaction',
      })
    ).bytes.toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function checkedRun(value: unknown): ClassicStateProjection['run'] {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid Classic transaction Run');
  const run = value as Record<string, unknown>;
  const result = runStateFromDocument({
    run_id: run.runId,
    skill: run.skill,
    skill_version: run.skillVersion,
    skill_hash: run.skillHash,
    orchestration: run.orchestration,
    current_step: run.currentStep,
    iteration: run.iteration,
    pending: run.pending,
    pending_ref: run.pendingRef,
    trajectory_ref: run.trajectoryRef,
    context_ref: run.contextRef,
    artifacts_ref: run.artifactsRef,
    checkpoint_ref: run.checkpointRef,
    run_status: run.status,
    run_retries: run.retries,
  });
  if (!result) throw new Error('Invalid Classic transaction Run identity');
  return result;
}

async function recoverStateTransaction(changeDir: string): Promise<void> {
  const source = await optionalStateText(changeDir, STATE_TRANSACTION);
  if (source === null) return;
  const transaction = JSON.parse(source) as Record<string, unknown>;
  if (
    !transaction ||
    transaction.schema !== 'comet.classic.state-transaction.v1' ||
    (transaction.beforeYaml !== null && typeof transaction.beforeYaml !== 'string') ||
    typeof transaction.afterYaml !== 'string'
  )
    throw new Error('Invalid Classic state transaction');
  const actual = await optionalStateText(changeDir, '.comet.yaml');
  // The YAML rename is the commit point. Never overwrite an unrelated manual edit.
  if (actual !== transaction.beforeYaml && actual !== transaction.afterYaml)
    throw new Error(
      'Classic state transaction conflicts with current YAML; preserve files for recovery',
    );
  const run = checkedRun(
    actual === transaction.afterYaml ? transaction.afterRun : transaction.beforeRun,
  );
  if (run) await writeRunState(changeDir, run);
  else await removeRunState(changeDir);
  await removeContainedFile(path.join(changeDir, STATE_TRANSACTION), { containedRoot: changeDir });
}

function documentRecord(document: Document): StateDocument {
  const value = document.toJS() as unknown;
  if (value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Classic state document: root must be a mapping');
  }
  return value as StateDocument;
}

function setIfChanged(document: Document, key: string, value: unknown): void {
  if (document.get(key) !== value) document.set(key, value);
}

function applyProjection(document: Document, projection: ClassicStateProjection): void {
  if (projection.classic) {
    for (const [key, value] of Object.entries(classicStateToDocument(projection.classic))) {
      // Legacy omission inherits configuration; an explicit null is rejected by the wire schema.
      if (key === 'auto_transition' && value === null && !document.has(key)) continue;
      setIfChanged(document, key, value);
    }
  } else {
    for (const key of CLASSIC_WIRE_KEYS) document.delete(key);
  }

  // Only write run_id as a link — full Run state lives in .comet/run-state.json
  applyRunStateToDocument(document.toJS() as StateDocument, projection.run);
  if (projection.run) {
    setIfChanged(document, 'run_id', projection.run.runId);
  } else {
    document.delete('run_id');
  }
}

/** Strip legacy Run fields from a yaml document (migration helper). */
function stripLegacyRunFields(document: Document): void {
  const LEGACY_RUN_KEYS = [
    'skill',
    'skill_version',
    'skill_hash',
    'orchestration',
    'current_step',
    'iteration',
    'pending',
    'pending_ref',
    'trajectory_ref',
    'context_ref',
    'artifacts_ref',
    'checkpoint_ref',
    'run_status',
    'run_retries',
  ];
  for (const key of LEGACY_RUN_KEYS) document.delete(key);
}

/** Strip removed command override fields from older change state files. */
function stripLegacyCommandFields(document: Document): boolean {
  let changed = false;
  for (const key of ['build_command', 'verify_command']) {
    if (document.has(key)) {
      document.delete(key);
      changed = true;
    }
  }
  return changed;
}

async function readDocument(file: string): Promise<Document> {
  let source: string;
  try {
    source = (
      await readProtectedProjectFile(
        path.dirname(file),
        path.basename(file),
        CLASSIC_STATE_MAX_BYTES,
        {
          label: 'Classic state document',
        },
      )
    ).bytes.toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return new Document({});
  }

  const document = parseDocument(source);
  if (document.errors.length > 0) {
    throw new Error(`Invalid Classic state document: ${document.errors[0].message}`);
  }
  documentRecord(document);
  return document;
}

export interface ReadClassicStateOptions {
  migrate?: boolean;
}

export async function readClassicState(
  changeDir: string,
  options: ReadClassicStateOptions = {},
): Promise<ClassicStateProjection> {
  return withClassicStateLock(changeDir, () => readClassicStateLocked(changeDir, options));
}

async function readClassicStateLocked(
  changeDir: string,
  options: ReadClassicStateOptions,
): Promise<ClassicStateProjection> {
  const shouldMigrate = options.migrate !== false;
  const file = path.join(changeDir, '.comet.yaml');
  const document = await readDocument(file);
  let doc = documentRecord(document);
  let migrated = stripLegacyCommandFields(document);
  if (migrated) doc = documentRecord(document);

  // Try reading Run state from the new location first
  let run = await readRunState(changeDir);

  if (!run && doc.run_id && doc.skill) {
    // Legacy format: Run fields embedded in .comet.yaml — migrate
    const { runStateFromDocument } = await import('../../domains/engine/state.js');
    run = runStateFromDocument(doc);
    if (run && shouldMigrate) {
      await writeRunState(changeDir, run);
      stripLegacyRunFields(document);
      migrated = true;
    }
  }

  if (migrated && shouldMigrate) {
    await atomicWriteContainedText(file, document.toString(), { containedRoot: changeDir });
  }

  return parseClassicStateDocument(documentRecord(document), run);
}

export async function readLegacyState(changeDir: string): Promise<LegacyStateSummary> {
  const document = await readDocument(path.join(changeDir, '.comet.yaml'));
  return readLegacyStateSummary(documentRecord(document));
}

export async function writeClassicState(
  changeDir: string,
  projection: Omit<ClassicStateProjection, 'unknownKeys'> & { unknownKeys?: string[] },
  options: { beforeCommit?: () => void | Promise<void> } = {},
): Promise<void> {
  return withClassicStateLock(changeDir, () =>
    writeClassicStateLocked(changeDir, projection, options),
  );
}

async function writeClassicStateLocked(
  changeDir: string,
  projection: Omit<ClassicStateProjection, 'unknownKeys'> & { unknownKeys?: string[] },
  options: { beforeCommit?: () => void | Promise<void> },
): Promise<void> {
  const file = path.join(changeDir, '.comet.yaml');
  const document = await readDocument(file);
  const epoch = document.get('check_epoch') ?? 0;
  if (typeof epoch === 'number' && epoch > (projection.classic?.checkEpoch ?? 0)) {
    throw new Error('Classic state changed during this operation; reload before retrying');
  }
  applyProjection(document, {
    ...projection,
    unknownKeys: projection.unknownKeys ?? [],
  });

  parseClassicStateDocument(documentRecord(document), projection.run ?? null);
  const beforeYaml = await optionalStateText(changeDir, '.comet.yaml');
  const afterYaml = document.toString();
  if (beforeYaml === afterYaml) {
    // Only one file changes for derived Run updates, so its atomic writer is enough.
    await options.beforeCommit?.();
    if (projection.run) await writeRunState(changeDir, projection.run);
    else await removeRunState(changeDir);
    return;
  }
  const transactionFile = path.join(changeDir, STATE_TRANSACTION);
  await atomicWriteContainedText(
    transactionFile,
    JSON.stringify({
      schema: 'comet.classic.state-transaction.v1',
      beforeYaml,
      afterYaml,
      beforeRun: await readRunState(changeDir),
      afterRun: projection.run,
    }),
    { containedRoot: changeDir },
  );
  try {
    if (projection.run) await writeRunState(changeDir, projection.run);
    else await removeRunState(changeDir);
    await atomicWriteContainedText(file, afterYaml, {
      containedRoot: changeDir,
      beforeCommit: options.beforeCommit,
    });
  } catch (error) {
    // Interrupted rollback keeps the journal; the next state operation retries recovery.
    await recoverStateTransaction(changeDir).catch(() => undefined);
    throw error;
  }
  // A committed transition remains successful if only journal cleanup is interrupted.
  await removeContainedFile(transactionFile, { containedRoot: changeDir }).catch(() => undefined);
}
