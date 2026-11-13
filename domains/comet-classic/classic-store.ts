import {
  resolveClassicStateFile,
  LEGACY_CLASSIC_STATE_FILE,
  isClassicStateFileName,
} from './classic-state-file.js';
import { randomUUID } from 'node:crypto';
import { memoizedHookRead } from '../../platform/process/hook-read-cache.js';
import { ensureWorkspaceRuntimeRoot } from '../workflow-contract/workspace-runtime.js';
import { ensureProtectedProjectDirectory } from '../workflow-contract/protected-project-path.js';
import { discoverClassicProject } from './classic-layout.js';
import {
  resolveClassicRunDirectory,
  resolveClassicRunDirectoryForRead,
} from './classic-runtime-paths.js';
import path from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { Document, parseDocument } from 'yaml';
import {
  atomicWriteContainedText,
  removeContainedFile,
} from '../workflow-contract/contained-atomic-write.js';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import { hasClassicManagedRunMarker } from './classic-state.js';
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

const stateMutation = new AsyncLocalStorage<string>();
const STATE_TRANSACTION = '.comet-state-transaction.json';

/** 同一 controller 串行提交；嵌套业务操作复用当前事务恢复边界。 */
export async function withClassicStateMutation<T>(
  changeDir: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = await resolveClassicRunDirectory(changeDir);
  if (stateMutation.getStore() === key) return operation();
  return stateMutation.run(key, async () => {
    await recoverStateTransaction(changeDir);
    return operation();
  });
}

async function optionalStateText(changeDir: string, file: string): Promise<string | null> {
  const root = file === STATE_TRANSACTION ? await resolveClassicRunDirectory(changeDir) : changeDir;
  try {
    return (
      await readProtectedProjectFile(root, file, Number.MAX_SAFE_INTEGER, {
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
  const file = await resolveClassicStateFile(changeDir);
  const recordedFile = transaction.stateFile ?? LEGACY_CLASSIC_STATE_FILE;
  if (
    typeof recordedFile !== 'string' ||
    !isClassicStateFileName(recordedFile) ||
    path.basename(file) !== recordedFile
  )
    throw new Error(
      'Classic state transaction belongs to a different state filename; preserve files for recovery',
    );
  const actual = await optionalStateText(changeDir, recordedFile);
  // The YAML rename is the commit point. Never overwrite an unrelated manual edit.
  if (actual !== transaction.beforeYaml && actual !== transaction.afterYaml)
    throw new Error(
      'Classic state transaction conflicts with current YAML; preserve files for recovery',
    );
  const run = checkedRun(
    actual === transaction.afterYaml ? transaction.afterRun : transaction.beforeRun,
  );
  if ((await resolveClassicStateFile(changeDir)) !== file)
    throw new Error('Classic state filename changed during transaction recovery');
  if (run) await writeRunState(await resolveClassicRunDirectory(changeDir), run);
  else await removeRunState(await resolveClassicRunDirectory(changeDir));
  const runtimeRoot = await resolveClassicRunDirectory(changeDir);
  await removeContainedFile(path.join(runtimeRoot, STATE_TRANSACTION), {
    containedRoot: runtimeRoot,
  });
}

function assertRunIdentity(doc: StateDocument, run: ClassicStateProjection['run']): void {
  if (run && doc.run_id !== run.runId)
    throw new Error(
      'Classic local Run identity differs from .comet.yaml; preserve both records and restore the matching Runtime history',
    );
  if (!run && doc.run_id && !doc.skill && doc.run_checkpoint === undefined)
    throw new Error(
      'Classic local Run history is missing; restore the matching workspace Runtime backup before continuing',
    );
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
        Number.MAX_SAFE_INTEGER,
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

const cachedReadClassicStateWithoutMigration = memoizedHookRead(
  'classicStateProjection',
  (changeDir: string) => readClassicStateWithoutMigration(changeDir),
);

export async function readClassicState(
  changeDir: string,
  options: ReadClassicStateOptions = {},
): Promise<ClassicStateProjection> {
  if (options.migrate === false) return cachedReadClassicStateWithoutMigration(changeDir);
  return withClassicStateMutation(changeDir, () => readClassicStateForUpdate(changeDir, options));
}

async function readClassicStateWithoutMigration(
  changeDir: string,
): Promise<ClassicStateProjection> {
  const runtime = await resolveClassicRunDirectoryForRead(changeDir);
  if (runtime === null) return parseClassicStateDocument({});
  if (
    (
      await inspectProtectedProjectPath(runtime, STATE_TRANSACTION, {
        label: 'Classic state transaction',
        expected: 'file',
      })
    ).exists
  )
    throw new Error(
      'Classic state transaction is incomplete; use an explicit state operation to recover it',
    );
  const document = await readDocument(await resolveClassicStateFile(changeDir));
  stripLegacyCommandFields(document);
  const doc = documentRecord(document);
  let run = await readRunState(runtime);
  if (!run && doc.run_id && doc.skill) run = runStateFromDocument(doc);
  assertRunIdentity(doc, run);
  return parseClassicStateDocument(doc, run);
}

async function readClassicStateForUpdate(
  changeDir: string,
  options: ReadClassicStateOptions,
): Promise<ClassicStateProjection> {
  const shouldMigrate = options.migrate !== false;
  const file = await resolveClassicStateFile(changeDir);
  const document = await readDocument(file);
  let doc = documentRecord(document);
  let migrated = stripLegacyCommandFields(document);
  if (migrated) doc = documentRecord(document);

  // Try reading Run state from the new location first
  let run = await readRunState(await resolveClassicRunDirectory(changeDir));
  assertRunIdentity(doc, run);

  if (!run && doc.run_id && doc.skill) {
    // Legacy format: Run fields embedded in .comet.yaml — migrate
    const { runStateFromDocument } = await import('../../domains/engine/state.js');
    run = runStateFromDocument(doc);
    if (run && shouldMigrate) {
      await writeRunState(await resolveClassicRunDirectory(changeDir), run);
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
  const document = await readDocument(await resolveClassicStateFile(changeDir));
  return readLegacyStateSummary(documentRecord(document));
}

export async function writeClassicState(
  changeDir: string,
  projection: Omit<ClassicStateProjection, 'unknownKeys'> & { unknownKeys?: string[] },
  options: { beforeCommit?: () => void | Promise<void> } = {},
): Promise<void> {
  const file = await resolveClassicStateFile(changeDir, {
    defaultFileName: LEGACY_CLASSIC_STATE_FILE,
  });
  if ((await optionalStateText(changeDir, path.basename(file))) === null) {
    const document = new Document({ change_id: randomUUID() });
    applyProjection(document, { ...projection, unknownKeys: projection.unknownKeys ?? [] });
    parseClassicStateDocument(documentRecord(document), projection.run ?? null);
    const projectRoot = await discoverClassicProject(changeDir);
    const root = await ensureWorkspaceRuntimeRoot(projectRoot);
    const directory = await ensureProtectedProjectDirectory(
      root,
      `classic-changes/${document.get('change_id')}`,
      { label: 'Classic initial Run' },
    );
    if (projection.run) await writeRunState(directory, projection.run);
    await atomicWriteContainedText(file, document.toString(), {
      containedRoot: changeDir,
      exclusive: true,
      beforeCommit: options.beforeCommit,
    });
    return;
  }
  return withClassicStateMutation(changeDir, () =>
    writeClassicStateUpdate(changeDir, projection, options),
  );
}

async function writeClassicStateUpdate(
  changeDir: string,
  projection: Omit<ClassicStateProjection, 'unknownKeys'> & { unknownKeys?: string[] },
  options: { beforeCommit?: () => void | Promise<void> },
): Promise<void> {
  const file = await resolveClassicStateFile(changeDir);
  const source = await optionalStateText(changeDir, path.basename(file));
  if (source !== null && hasClassicManagedRunMarker(source)) {
    throw new Error('Classic managed Run state is owned by the SDK; compat writes are not allowed');
  }
  const document = await readDocument(file);
  if (!document.has('change_id')) {
    // 旧 Archive 在真正写入时固定已选身份，避免新增 run_id 后切换到另一本机目录。
    document.set('change_id', path.basename(await resolveClassicRunDirectory(changeDir)));
  }
  const epoch = document.get('check_epoch') ?? 0;
  if (typeof epoch === 'number' && epoch > (projection.classic?.checkEpoch ?? 0)) {
    throw new Error('Classic state changed during this operation; reload before retrying');
  }
  applyProjection(document, {
    ...projection,
    unknownKeys: projection.unknownKeys ?? [],
  });

  parseClassicStateDocument(documentRecord(document), projection.run ?? null);
  const beforeYaml = await optionalStateText(changeDir, path.basename(file));
  const afterYaml = document.toString();
  if (beforeYaml === afterYaml) {
    // Only one file changes for derived Run updates, so its atomic writer is enough.
    await options.beforeCommit?.();
    if (projection.run)
      await writeRunState(await resolveClassicRunDirectory(changeDir), projection.run);
    else await removeRunState(await resolveClassicRunDirectory(changeDir));
    return;
  }
  const runtimeRoot = await resolveClassicRunDirectory(changeDir);
  const transactionFile = path.join(runtimeRoot, STATE_TRANSACTION);
  await atomicWriteContainedText(
    transactionFile,
    JSON.stringify({
      schema: 'comet.classic.state-transaction.v1',
      stateFile: path.basename(file),
      beforeYaml,
      afterYaml,
      beforeRun: await readRunState(await resolveClassicRunDirectory(changeDir)),
      afterRun: projection.run,
    }),
    { containedRoot: runtimeRoot },
  );
  try {
    if (projection.run)
      await writeRunState(await resolveClassicRunDirectory(changeDir), projection.run);
    else await removeRunState(await resolveClassicRunDirectory(changeDir));
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
  await removeContainedFile(transactionFile, { containedRoot: runtimeRoot }).catch(() => undefined);
}
