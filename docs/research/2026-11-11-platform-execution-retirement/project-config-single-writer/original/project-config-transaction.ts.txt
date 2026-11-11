import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';

import { atomicWriteContainedText } from './contained-atomic-write.js';
import {
  readWorkflowProjectConfigIdentity,
  WORKFLOW_PROJECT_CONFIG_PATH,
} from './project-config-reader.js';
import { inspectProtectedProjectPath, readProtectedProjectFile } from './protected-project-path.js';

const CONFIG_TRANSACTION_SCHEMA = 'comet.project-config-write.v1';
const CONFIG_TRANSACTION_PATH = '.comet/config-write-transaction.json';
const CONFIG_TRANSACTION_MAX_BYTES = 16 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

interface ProjectConfigWriteTransactionJournal {
  schema: typeof CONFIG_TRANSACTION_SCHEMA;
  id: string;
  owner_pid: number;
  expected_sha256: string;
  output_sha256: string;
  candidate: string;
  quarantine: string;
}

export interface ProjectConfigWriteTransactionInspection {
  id: string;
  stage:
    | 'prepared'
    | 'config-quarantined'
    | 'published-cleanup-pending'
    | 'successor-preserved-cleanup-pending';
  candidate: string;
  quarantine: string;
  allowedRepair: 'rollback-or-cleanup';
}

function transactionCandidate(id: string): string {
  return `.comet/config.yaml.${id}.next`;
}

function transactionQuarantine(id: string): string {
  return `.comet/config.yaml.${id}.quarantine`;
}

function transactionCleanup(id: string): string {
  return `.comet/config-write-transaction.${id}.cleanup`;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function readTransaction(
  projectRoot: string,
): Promise<{ journal: ProjectConfigWriteTransactionJournal; source: string } | null> {
  let bytes: Buffer;
  try {
    bytes = (
      await readProtectedProjectFile(
        projectRoot,
        CONFIG_TRANSACTION_PATH,
        CONFIG_TRANSACTION_MAX_BYTES,
        { label: 'project config write transaction' },
      )
    ).bytes;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Invalid project config write transaction: expected JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid project config write transaction: expected an object');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = [
    'candidate',
    'expected_sha256',
    'id',
    'output_sha256',
    'owner_pid',
    'quarantine',
    'schema',
  ].sort();
  if (keys.join('\n') !== expectedKeys.join('\n')) {
    throw new Error('Invalid project config write transaction: unexpected fields');
  }
  if (record.schema !== CONFIG_TRANSACTION_SCHEMA) {
    throw new Error('Invalid project config write transaction: unsupported schema');
  }
  if (typeof record.id !== 'string' || !UUID_PATTERN.test(record.id)) {
    throw new Error('Invalid project config write transaction: invalid id');
  }
  if (
    typeof record.owner_pid !== 'number' ||
    !Number.isSafeInteger(record.owner_pid) ||
    record.owner_pid <= 0
  ) {
    throw new Error('Invalid project config write transaction: invalid owner pid');
  }
  if (
    typeof record.expected_sha256 !== 'string' ||
    !SHA256_PATTERN.test(record.expected_sha256) ||
    typeof record.output_sha256 !== 'string' ||
    !SHA256_PATTERN.test(record.output_sha256)
  ) {
    throw new Error('Invalid project config write transaction: invalid config hash');
  }
  if (
    record.candidate !== transactionCandidate(record.id) ||
    record.quarantine !== transactionQuarantine(record.id)
  ) {
    throw new Error('Invalid project config write transaction: paths do not match its id');
  }
  return {
    journal: record as unknown as ProjectConfigWriteTransactionJournal,
    source: bytes.toString('utf8'),
  };
}

async function readOwnedFileHash(
  projectRoot: string,
  relativePath: string,
): Promise<string | null> {
  try {
    const { bytes } = await readProtectedProjectFile(
      projectRoot,
      relativePath,
      CONFIG_TRANSACTION_MAX_BYTES,
      { label: relativePath },
    );
    return sha256(bytes);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function removeOwnedFile(
  projectRoot: string,
  relativePath: string,
  expectedHash: string,
  afterQuarantine?: (relativePath: string, cleanupRelative: string) => void | Promise<void>,
): Promise<boolean> {
  const canonical = await inspectProtectedProjectPath(projectRoot, relativePath, {
    label: relativePath,
    expected: 'file',
  });
  if (!canonical.exists) return false;
  const cleanupRelative = `${relativePath}.${randomUUID()}.cleanup`;
  const cleanup = await inspectProtectedProjectPath(projectRoot, cleanupRelative, {
    label: `${relativePath} cleanup`,
    expected: 'file',
  });
  if (cleanup.exists) throw new Error(`Owned cleanup path already exists: ${cleanupRelative}`);
  await fs.rename(canonical.target, cleanup.target);
  await afterQuarantine?.(relativePath, cleanupRelative);
  const actualHash = await readOwnedFileHash(projectRoot, cleanupRelative);
  if (actualHash !== expectedHash) {
    try {
      const successor = await inspectProtectedProjectPath(projectRoot, relativePath, {
        label: relativePath,
        expected: 'file',
      });
      if (!successor.exists) {
        await fs.link(cleanup.target, successor.target);
        await fs.unlink(cleanup.target);
      }
    } catch {
      // Preserve the displaced file when its ownership cannot be established.
    }
    throw new Error(`Refusing to remove modified project config transaction file: ${relativePath}`);
  }
  await fs.unlink(cleanup.target);
  return true;
}

function processIsAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function removeTransactionJournal(
  projectRoot: string,
  transaction: { journal: ProjectConfigWriteTransactionJournal; source: string },
): Promise<void> {
  const cleanupRelative = transactionCleanup(transaction.journal.id);
  const cleanup = await inspectProtectedProjectPath(projectRoot, cleanupRelative, {
    label: 'project config write transaction cleanup',
    expected: 'file',
  });
  if (cleanup.exists) {
    throw new Error('Project config write transaction cleanup path already exists');
  }
  const canonical = await inspectProtectedProjectPath(projectRoot, CONFIG_TRANSACTION_PATH, {
    label: 'project config write transaction',
    expected: 'file',
  });
  if (!canonical.exists) {
    throw new Error('Project config write transaction changed before cleanup');
  }
  await fs.rename(canonical.target, cleanup.target);
  const displaced = await readProtectedProjectFile(
    projectRoot,
    cleanupRelative,
    CONFIG_TRANSACTION_MAX_BYTES,
    { label: 'project config write transaction cleanup' },
  );
  if (sha256(displaced.bytes) !== sha256(transaction.source)) {
    try {
      const successor = await inspectProtectedProjectPath(projectRoot, CONFIG_TRANSACTION_PATH, {
        label: 'project config write transaction',
        expected: 'file',
      });
      if (!successor.exists) await fs.link(cleanup.target, successor.target);
    } catch {
      // Keep the displaced file for manual recovery when its ownership changed.
    }
    throw new Error('Project config write transaction changed before cleanup');
  }
  await fs.unlink(cleanup.target);
}

export async function beginWorkflowProjectConfigTransaction(
  projectRoot: string,
  id: string,
  expectedSha256: string,
  outputSha256: string,
): Promise<{ candidate: string; quarantine: string }> {
  if (!UUID_PATTERN.test(id)) throw new Error('Invalid project config write transaction id');
  if (!SHA256_PATTERN.test(expectedSha256) || !SHA256_PATTERN.test(outputSha256)) {
    throw new Error('Invalid project config write transaction hash');
  }
  if (await readTransaction(projectRoot)) {
    throw new Error(
      'An unfinished project config write transaction exists; run comet doctor --repair',
    );
  }
  const journal: ProjectConfigWriteTransactionJournal = {
    schema: CONFIG_TRANSACTION_SCHEMA,
    id,
    owner_pid: process.pid,
    expected_sha256: expectedSha256,
    output_sha256: outputSha256,
    candidate: transactionCandidate(id),
    quarantine: transactionQuarantine(id),
  };
  await atomicWriteContainedText(
    (
      await inspectProtectedProjectPath(projectRoot, CONFIG_TRANSACTION_PATH, {
        label: 'project config write transaction',
        expected: 'file',
      })
    ).target,
    `${JSON.stringify(journal, null, 2)}\n`,
    { containedRoot: projectRoot, exclusive: true },
  );
  return { candidate: journal.candidate, quarantine: journal.quarantine };
}

export async function finishWorkflowProjectConfigTransaction(
  projectRoot: string,
  id: string,
): Promise<void> {
  const transaction = await readTransaction(projectRoot);
  if (!transaction || transaction.journal.id !== id) {
    throw new Error('Project config write transaction changed before completion');
  }
  await removeTransactionJournal(projectRoot, transaction);
}

export async function inspectWorkflowProjectConfigTransaction(
  projectRoot: string,
): Promise<ProjectConfigWriteTransactionInspection | null> {
  const transaction = await readTransaction(projectRoot);
  if (!transaction) return null;
  const { journal } = transaction;
  const [config, candidateHash, quarantineHash] = await Promise.all([
    readWorkflowProjectConfigIdentity(projectRoot),
    readOwnedFileHash(projectRoot, journal.candidate),
    readOwnedFileHash(projectRoot, journal.quarantine),
  ]);
  if (candidateHash !== null && candidateHash !== journal.output_sha256) {
    throw new Error('Project config write transaction candidate changed after creation');
  }
  if (quarantineHash !== null && quarantineHash !== journal.expected_sha256) {
    throw new Error('Project config write transaction quarantine changed after creation');
  }

  let stage: ProjectConfigWriteTransactionInspection['stage'];
  if (!config.exists && quarantineHash === journal.expected_sha256) {
    stage = 'config-quarantined';
  } else if (config.sha256 === journal.output_sha256) {
    stage = 'published-cleanup-pending';
  } else if (
    config.exists &&
    config.sha256 !== journal.expected_sha256 &&
    config.sha256 !== journal.output_sha256
  ) {
    stage = 'successor-preserved-cleanup-pending';
  } else {
    stage = 'prepared';
  }
  return {
    id: journal.id,
    stage,
    candidate: journal.candidate,
    quarantine: journal.quarantine,
    allowedRepair: 'rollback-or-cleanup',
  };
}

export async function repairWorkflowProjectConfigTransaction(
  projectRoot: string,
  options: {
    ownerId?: string;
    testHooks?: {
      afterOwnedFileQuarantine?: (
        relativePath: string,
        cleanupRelative: string,
      ) => void | Promise<void>;
    };
  } = {},
): Promise<boolean> {
  const transaction = await readTransaction(projectRoot);
  if (!transaction) return false;
  const { journal } = transaction;
  if (options.ownerId !== journal.id && processIsAlive(journal.owner_pid)) {
    throw new Error(
      `Project config write transaction ${journal.id} is still active in process ${journal.owner_pid}`,
    );
  }
  const inspection = await inspectWorkflowProjectConfigTransaction(projectRoot);
  if (!inspection) return false;

  let config = await readWorkflowProjectConfigIdentity(projectRoot);
  const quarantineHash = await readOwnedFileHash(projectRoot, journal.quarantine);
  if (!config.exists) {
    if (quarantineHash !== journal.expected_sha256) {
      throw new Error(
        'Cannot recover project config write transaction: the config and owned quarantine are missing',
      );
    }
    const canonical = await inspectProtectedProjectPath(projectRoot, WORKFLOW_PROJECT_CONFIG_PATH, {
      label: WORKFLOW_PROJECT_CONFIG_PATH,
      expected: 'file',
    });
    const quarantine = await inspectProtectedProjectPath(projectRoot, journal.quarantine, {
      label: 'project config write transaction quarantine',
      expected: 'file',
    });
    try {
      await fs.link(quarantine.target, canonical.target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    config = await readWorkflowProjectConfigIdentity(projectRoot);
    if (!config.exists) {
      throw new Error('Cannot recover project config write transaction: config publish failed');
    }
  }

  await removeOwnedFile(
    projectRoot,
    journal.candidate,
    journal.output_sha256,
    options.testHooks?.afterOwnedFileQuarantine,
  );
  if (config.exists) {
    await removeOwnedFile(
      projectRoot,
      journal.quarantine,
      journal.expected_sha256,
      options.testHooks?.afterOwnedFileQuarantine,
    );
  }
  await removeTransactionJournal(projectRoot, transaction);
  return true;
}
