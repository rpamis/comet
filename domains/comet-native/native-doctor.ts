import { promises as fs, type Dirent } from 'fs';
import path from 'path';

import { recoverArchiveTransaction } from './native-archive.js';
import {
  inspectNativeChange,
  NATIVE_CHANGE_STATE_FILE,
  readNativeChange,
} from './native-change.js';
import { readProjectConfig } from './native-config.js';
import { inspectNativeStatus, listNativeStatus } from './native-diagnostics.js';
import { inspectNativeEvidenceRetention } from './native-evidence-retention.js';
import {
  diagnoseNativeLock,
  takeOverNativeStaleLock,
  withNativeLockRecovery,
} from './native-lock.js';
import { nativeProjectPaths, resolveContainedNativePath } from './native-paths.js';
import { readNativeProtectedDirectory } from './native-protected-file.js';
import { recoverNativeRootMove } from './native-root-move.js';
import { continueNativeCheckpoint } from './native-checkpoint-journal.js';
import {
  nativeCheckpointJournalFile,
  readNativeCheckpointJournal,
} from './native-checkpoint-storage.js';
import { nativeSelectionFile, readNativeSelectionRecord } from './native-selection.js';
import {
  inspectPendingNativeSchemaMigration,
  migrateNativeChange,
  nativeSchemaMigrationJournalFile,
} from './native-schema-migration.js';
import { readNativeTransaction } from './native-transaction.js';
import {
  continueNativeTransition,
  inspectPendingNativeTransition,
  NativeTransitionMigrationRequiredError,
  nativeTransitionJournalFile,
} from './native-transition-journal.js';
import {
  inspectNativeTrajectoryTail,
  repairNativeTrajectoryTail,
} from './native-trajectory-recovery.js';
import {
  migrateLegacyNativeWorkspaceIdentity,
  nativeWorkspaceIdentityNeedsMigration,
  nativeWorkspaceFile,
} from './native-workspace.js';
import type {
  NativeDoctorFinding,
  NativeProjectPaths,
  NativeTransactionJournal,
} from './native-types.js';

const NATIVE_DOCTOR_MAX_CHANGE_ENTRIES = 4_096;
const NATIVE_DOCTOR_MAX_TRANSACTION_ENTRIES = 4_096;
const NATIVE_DOCTOR_MAX_LOCK_ENTRIES = 1_024;

async function directoryEntries(
  paths: NativeProjectPaths,
  directory: string,
  maxEntries: number,
): Promise<Dirent[]> {
  try {
    const protectedDirectory = await readNativeProtectedDirectory({
      root: paths.nativeRoot,
      directory,
      label: 'Native doctor directory',
      maxEntries,
    });
    await protectedDirectory.verify();
    return protectedDirectory.entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function clearStaleRecoveryLocks(
  targets: Array<{ paths: NativeProjectPaths; file: string }>,
  findings: NativeDoctorFinding[],
): Promise<boolean> {
  const unique = new Map(
    targets.map((target) => [
      path.resolve(target.file),
      { ...target, file: path.resolve(target.file) },
    ]),
  );
  for (const { paths, file } of unique.values()) {
    let diagnosis;
    try {
      diagnosis = await diagnoseNativeLock(file);
    } catch (error) {
      findings.push({
        severity: 'error',
        code: 'lock-invalid',
        message: `Native recovery lock is invalid: ${(error as Error).message}`,
        path: file,
      });
      return false;
    }
    if (diagnosis.status === 'missing') continue;
    if (diagnosis.status === 'stale') {
      const takeover = await takeOverNativeStaleLock(paths, file, diagnosis);
      if (takeover.status === 'removed') {
        findings.push({
          severity: 'info',
          code: 'stale-recovery-lock-removed',
          message: `Removed stale lock before explicit transaction recovery`,
          path: file,
        });
        continue;
      }
      if (takeover.status === 'missing') continue;
      diagnosis = takeover.diagnosis;
    }
    if (diagnosis.status === 'stale') {
      findings.push({
        severity: 'error',
        code: 'lock-takeover-raced',
        message: 'Native recovery lock changed while doctor was preparing stale takeover',
        path: file,
      });
      return false;
    }
    findings.push({
      severity: 'error',
      code: diagnosis.status === 'active' ? 'lock-active' : 'lock-owner-unknown',
      message:
        diagnosis.status === 'active'
          ? `Native recovery lock is still owned by a live process`
          : `Native recovery lock owner cannot be proven stale`,
      path: file,
    });
    return false;
  }
  return true;
}

async function inspectSelection(
  paths: NativeProjectPaths,
  repair: boolean,
): Promise<NativeDoctorFinding[]> {
  const file = nativeSelectionFile(paths);
  let value: { schema?: unknown; workflow?: unknown; change?: unknown };
  try {
    await resolveContainedNativePath(paths.projectRoot, file);
    const selection = await readNativeSelectionRecord(paths);
    if (!selection) return [];
    value = selection;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    return [
      {
        severity: 'error',
        code: 'selection-invalid',
        message: `Native selection is invalid: ${(error as Error).message}`,
        path: file,
      },
    ];
  }
  if (
    value.schema !== 'comet.selection.v2' ||
    value.workflow !== 'native' ||
    typeof value.change !== 'string'
  ) {
    return [
      {
        severity: 'error',
        code: 'selection-invalid',
        message: 'Native selection has an invalid schema or change name',
        path: file,
      },
    ];
  }
  try {
    await readNativeChange(paths, value.change);
    return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return [
        {
          severity: 'error',
          code: 'selection-target-invalid',
          message: `Selected Native change is invalid: ${(error as Error).message}`,
          path: file,
        },
      ];
    }
  }
  if (repair) {
    await fs.rm(file, { force: true });
    return [
      {
        severity: 'info',
        code: 'selection-cleared',
        message: `Cleared stale Native selection ${value.change}`,
        path: file,
      },
    ];
  }
  return [
    {
      severity: 'warning',
      code: 'selection-stale',
      message: `Selected Native change does not exist: ${value.change}`,
      path: file,
    },
  ];
}

async function inspectManagedPaths(paths: NativeProjectPaths): Promise<NativeDoctorFinding[]> {
  const findings: NativeDoctorFinding[] = [];
  for (const managedPath of [
    paths.specsDir,
    paths.changesDir,
    paths.archiveDir,
    paths.runtimeDir,
    paths.locksDir,
    paths.transactionsDir,
  ]) {
    try {
      await resolveContainedNativePath(paths.nativeRoot, managedPath);
    } catch (error) {
      findings.push({
        severity: 'error',
        code: 'native-path-unsafe',
        message: `Managed Native path is unsafe: ${(error as Error).message}`,
        path: managedPath,
      });
    }
  }
  return findings;
}

async function inspectTransactions(
  paths: NativeProjectPaths,
  options: {
    name?: string;
    repair: boolean;
    recoveryStrategy?: 'continue' | 'rollback';
  },
): Promise<{ findings: NativeDoctorFinding[]; unfinished: NativeTransactionJournal[] }> {
  const findings: NativeDoctorFinding[] = [];
  const unfinished: NativeTransactionJournal[] = [];
  for (const entry of await directoryEntries(
    paths,
    paths.transactionsDir,
    NATIVE_DOCTOR_MAX_TRANSACTION_ENTRIES,
  )) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    let journal: NativeTransactionJournal;
    try {
      journal = await readNativeTransaction(paths, entry.name);
    } catch (error) {
      findings.push({
        severity: 'error',
        code: 'transaction-invalid',
        message: `Native transaction ${entry.name} is invalid: ${(error as Error).message}`,
        path: path.join(paths.transactionsDir, entry.name),
      });
      continue;
    }
    if (journal.status === 'committed' || journal.status === 'rolled-back') continue;
    if (options.name && journal.change && journal.change !== options.name) continue;
    if (journal.kind !== 'archive') {
      unfinished.push(journal);
      findings.push({
        severity: 'error',
        code: 'root-move-transaction-orphaned',
        message: `Root-move transaction ${journal.id} is incomplete but project config has no matching pending move`,
      });
      continue;
    }
    if (options.repair && options.recoveryStrategy) {
      try {
        const locksReady = await withNativeLockRecovery(
          [paths],
          `doctor archive recovery ${journal.id}`,
          async () => {
            const ready = await clearStaleRecoveryLocks(
              [
                { paths, file: path.join(paths.locksDir, 'root-move.lock') },
                { paths, file: path.join(paths.locksDir, 'archive.lock') },
              ],
              findings,
            );
            if (!ready) return false;
            await recoverArchiveTransaction({
              paths,
              transactionId: journal.id,
              strategy: options.recoveryStrategy!,
            });
            return true;
          },
        );
        if (!locksReady) {
          unfinished.push(journal);
          continue;
        }
        findings.push({
          severity: 'info',
          code: 'archive-transaction-recovered',
          message: `${options.recoveryStrategy === 'continue' ? 'Continued' : 'Rolled back'} archive transaction ${journal.id}`,
        });
      } catch (error) {
        unfinished.push(journal);
        findings.push({
          severity: 'error',
          code: 'archive-recovery-failed',
          message: `Archive recovery failed: ${(error as Error).message}`,
        });
      }
    } else {
      unfinished.push(journal);
      findings.push({
        severity: 'error',
        code: 'archive-transaction-incomplete',
        message: options.repair
          ? `Archive transaction ${journal.id} needs an explicit recovery strategy`
          : `Archive transaction ${journal.id} is incomplete`,
        repair: options.recoveryStrategy ?? 'continue',
      });
    }
  }
  return { findings, unfinished };
}

async function inspectLocks(
  paths: NativeProjectPaths,
  repair: boolean,
  unfinished: NativeTransactionJournal[],
): Promise<NativeDoctorFinding[]> {
  const findings: NativeDoctorFinding[] = [];
  for (const entry of await directoryEntries(
    paths,
    paths.locksDir,
    NATIVE_DOCTOR_MAX_LOCK_ENTRIES,
  )) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.lock')) continue;
    const file = path.join(paths.locksDir, entry.name);
    try {
      const diagnosis = await diagnoseNativeLock(file);
      if (diagnosis.status === 'active') {
        findings.push({
          severity: 'warning',
          code: 'lock-active',
          message: `Native lock is active for ${diagnosis.owner?.operation ?? 'an operation'}`,
          path: file,
        });
      } else if (diagnosis.status === 'unknown') {
        findings.push({
          severity: 'warning',
          code: 'lock-owner-unknown',
          message: 'Native lock owner cannot be proven stale',
          path: file,
        });
      } else if (diagnosis.status === 'stale') {
        if (repair && unfinished.length === 0) {
          const takeover = await takeOverNativeStaleLock(paths, file, diagnosis);
          if (takeover.status === 'removed') {
            findings.push({
              severity: 'info',
              code: 'stale-lock-removed',
              message: 'Removed a Native lock whose local owner process is absent',
              path: file,
            });
          } else if (takeover.status === 'changed') {
            findings.push({
              severity: takeover.diagnosis.status === 'active' ? 'warning' : 'error',
              code: 'lock-takeover-raced',
              message: 'Native lock changed while doctor was preparing stale takeover',
              path: file,
            });
          }
        } else {
          findings.push({
            severity: unfinished.length > 0 ? 'error' : 'warning',
            code: 'lock-stale',
            message:
              unfinished.length > 0
                ? 'Native lock is stale but an unfinished transaction still requires recovery'
                : 'Native lock owner process is absent',
            path: file,
          });
        }
      }
    } catch (error) {
      findings.push({
        severity: 'error',
        code: 'lock-invalid',
        message: `Native lock metadata is invalid: ${(error as Error).message}`,
        path: file,
      });
    }
  }
  return findings;
}

async function inspectChanges(
  paths: NativeProjectPaths,
  name?: string,
): Promise<NativeDoctorFinding[]> {
  const findings: NativeDoctorFinding[] = [];
  const statuses = name
    ? await listNativeStatus(paths).then((all) => all.filter((status) => status.name === name))
    : await listNativeStatus(paths);
  if (name && statuses.length === 0) {
    return [
      {
        severity: 'error',
        code: 'change-missing',
        message: `Native change does not exist: ${name}`,
      },
    ];
  }
  for (const status of statuses) {
    if (status.migrationRequired) continue;
    if (status.phase === 'invalid') {
      findings.push({
        severity: 'error',
        code: 'change-invalid',
        message: status.error ?? `Native change ${status.name} is invalid`,
        path: path.join(paths.changesDir, status.name, NATIVE_CHANGE_STATE_FILE),
      });
      continue;
    }
    const detailed = await inspectNativeStatus(paths, status.name, { details: true });
    for (const artifact of detailed.findings ?? []) {
      if (
        artifact.code === 'trajectory-tail-incomplete' ||
        artifact.code === 'checkpoint-progress-incomplete'
      ) {
        continue;
      }
      findings.push({
        severity: artifact.severity,
        code: artifact.code,
        message: `${status.name}: ${artifact.message}`,
        ...(artifact.path ? { path: path.join(paths.projectRoot, artifact.path) } : {}),
      });
    }
  }
  return findings;
}

async function inspectTrajectoryTailRepairs(
  paths: NativeProjectPaths,
  options: { name?: string; repair: boolean },
): Promise<NativeDoctorFinding[]> {
  const findings: NativeDoctorFinding[] = [];
  const names = options.name
    ? [options.name]
    : (await directoryEntries(paths, paths.changesDir, NATIVE_DOCTOR_MAX_CHANGE_ENTRIES))
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => entry.name)
        .sort();
  for (const name of names) {
    try {
      const inspection = await inspectNativeTrajectoryTail(paths, name);
      if (inspection.status !== 'repairable') continue;
      if (!options.repair) {
        findings.push({
          severity: 'error',
          code: 'trajectory-tail-incomplete',
          message: `Native trajectory for ${name} has an incomplete final line ${inspection.line}; ${inspection.discardedBytes} byte(s) are outside the last complete event`,
          path: inspection.file,
          repair: 'truncate-tail',
        });
        continue;
      }
      const repaired = await repairNativeTrajectoryTail(paths, name);
      if (repaired) {
        findings.push({
          severity: 'info',
          code: 'trajectory-tail-repaired',
          message: `Removed the incomplete Native trajectory tail for ${name} and preserved all complete events`,
          path: repaired.file,
        });
      }
    } catch (error) {
      findings.push({
        severity: 'error',
        code: 'trajectory-tail-repair-failed',
        message: `Native trajectory tail repair failed for ${name}: ${(error as Error).message}`,
        path: path.join(paths.changesDir, name, 'runtime', 'trajectory.jsonl'),
      });
    }
  }
  return findings;
}

async function inspectWorkspaceIdentityMigrations(
  paths: NativeProjectPaths,
  options: { name?: string; repair: boolean },
): Promise<NativeDoctorFinding[]> {
  const findings: NativeDoctorFinding[] = [];
  const names = options.name
    ? [options.name]
    : (await directoryEntries(paths, paths.changesDir, NATIVE_DOCTOR_MAX_CHANGE_ENTRIES))
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => entry.name)
        .sort();
  for (const name of names) {
    try {
      if (!(await nativeWorkspaceIdentityNeedsMigration(paths, name))) {
        continue;
      }
      if (!options.repair) {
        findings.push({
          severity: 'warning',
          code: 'workspace-identity-migration-required',
          message: `Native workspace identity for ${name} uses legacy external-probe or hash-only metadata`,
          path: nativeWorkspaceFile(paths, name),
          repair: 'migrate',
        });
        continue;
      }
      const state = await readNativeChange(paths, name);
      const migrated = await migrateLegacyNativeWorkspaceIdentity({
        paths,
        name,
        revision: state.revision,
      });
      if (migrated) {
        findings.push({
          severity: 'info',
          code: 'workspace-identity-migrated',
          message: `Replaced legacy workspace metadata for ${name} with process-free root identities`,
          path: nativeWorkspaceFile(paths, name),
        });
      }
    } catch (error) {
      findings.push({
        severity: 'error',
        code: 'workspace-identity-migration-failed',
        message: `Native workspace identity migration failed for ${name}: ${(error as Error).message}`,
        path: nativeWorkspaceFile(paths, name),
      });
    }
  }
  return findings;
}

async function inspectSchemaMigrations(
  paths: NativeProjectPaths,
  options: { name?: string; repair: boolean },
): Promise<NativeDoctorFinding[]> {
  const findings: NativeDoctorFinding[] = [];
  const names = options.name
    ? [options.name]
    : (await directoryEntries(paths, paths.changesDir, NATIVE_DOCTOR_MAX_CHANGE_ENTRIES))
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => entry.name)
        .sort();
  for (const name of names) {
    const file = nativeSchemaMigrationJournalFile(paths, name);
    try {
      const pending = await inspectPendingNativeSchemaMigration(paths, name);
      const inspection = await inspectNativeChange(paths, name);
      if (!pending && inspection.status === 'current') continue;
      if (inspection.status === 'runtime-incompatible') {
        findings.push({
          severity: 'error',
          code: 'change-runtime-incompatible',
          message: inspection.message ?? `Native change ${name} requires a newer runtime`,
          path: path.join(paths.changesDir, name, NATIVE_CHANGE_STATE_FILE),
        });
        continue;
      }
      if (!options.repair) {
        findings.push({
          severity: 'error',
          code: pending ? 'schema-migration-incomplete' : 'schema-migration-required',
          message: pending
            ? `Native schema migration ${pending.id} is incomplete for ${name}`
            : `Native change ${name} requires migration to the current schema`,
          path: pending ? file : path.join(paths.changesDir, name, NATIVE_CHANGE_STATE_FILE),
          repair: 'migrate',
        });
        continue;
      }
      await migrateNativeChange({ paths, name });
      findings.push({
        severity: 'info',
        code: pending ? 'schema-migration-recovered' : 'schema-migrated',
        message: `Migrated Native change ${name} to the current schema`,
        path: path.join(paths.changesDir, name, NATIVE_CHANGE_STATE_FILE),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      findings.push({
        severity: 'error',
        code: 'schema-migration-failed',
        message: `Native schema migration failed for ${name}: ${(error as Error).message}`,
        path: file,
      });
    }
  }
  return findings;
}

async function inspectTransitionJournals(
  paths: NativeProjectPaths,
  options: {
    name?: string;
    repair: boolean;
    recoveryStrategy?: 'continue' | 'rollback';
  },
): Promise<NativeDoctorFinding[]> {
  const findings: NativeDoctorFinding[] = [];
  const names = options.name
    ? [options.name]
    : (await directoryEntries(paths, paths.changesDir, NATIVE_DOCTOR_MAX_CHANGE_ENTRIES))
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => entry.name)
        .sort();
  for (const name of names) {
    let journal;
    try {
      journal = await inspectPendingNativeTransition(paths, name);
    } catch (error) {
      if (error instanceof NativeTransitionMigrationRequiredError) continue;
      findings.push({
        severity: 'error',
        code: 'transition-invalid',
        message: `Native transition journal is invalid: ${(error as Error).message}`,
        path: nativeTransitionJournalFile(paths, name),
      });
      continue;
    }
    if (!journal) continue;
    if (options.repair && options.recoveryStrategy === 'continue') {
      try {
        const recovered = await withNativeLockRecovery(
          [paths],
          `doctor transition recovery ${name}`,
          async () => {
            const locksReady = await clearStaleRecoveryLocks(
              [
                { paths, file: path.join(paths.locksDir, 'root-move.lock') },
                { paths, file: path.join(paths.locksDir, `transition-${name}.lock`) },
              ],
              findings,
            );
            if (!locksReady) return false;
            await continueNativeTransition(paths, name);
            return true;
          },
        );
        if (!recovered) continue;
        findings.push({
          severity: 'info',
          code: 'transition-recovered',
          message: `Continued Native phase transition ${journal.id} for ${name}`,
          path: nativeTransitionJournalFile(paths, name),
        });
      } catch (error) {
        findings.push({
          severity: 'error',
          code: 'transition-recovery-failed',
          message: `Native transition recovery failed: ${(error as Error).message}`,
          path: nativeTransitionJournalFile(paths, name),
        });
      }
      continue;
    }
    findings.push({
      severity: 'error',
      code: 'transition-incomplete',
      message:
        options.repair && options.recoveryStrategy === 'rollback'
          ? `Native phase transition ${journal.id} only supports deterministic continue recovery`
          : `Native phase transition ${journal.id} is incomplete for ${name}`,
      path: nativeTransitionJournalFile(paths, name),
      repair: 'continue',
    });
  }
  return findings;
}

async function inspectCheckpointJournals(
  paths: NativeProjectPaths,
  options: { name?: string; repair: boolean },
): Promise<NativeDoctorFinding[]> {
  const findings: NativeDoctorFinding[] = [];
  const names = options.name
    ? [options.name]
    : (await directoryEntries(paths, paths.changesDir, NATIVE_DOCTOR_MAX_CHANGE_ENTRIES))
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => entry.name)
        .sort();
  for (const name of names) {
    const file = nativeCheckpointJournalFile(paths, name);
    let journal;
    try {
      journal = await readNativeCheckpointJournal(paths, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      findings.push({
        severity: 'error',
        code: 'checkpoint-progress-invalid',
        message: `Native progress checkpoint journal is invalid: ${(error as Error).message}`,
        path: file,
      });
      continue;
    }
    if (!journal) continue;
    if (!options.repair) {
      findings.push({
        severity: 'error',
        code: 'checkpoint-progress-incomplete',
        message: `Native progress checkpoint ${journal.id} is incomplete for ${name}`,
        path: file,
      });
      continue;
    }
    try {
      const recovered = await withNativeLockRecovery(
        [paths],
        `doctor checkpoint recovery ${name}`,
        async () => {
          const locksReady = await clearStaleRecoveryLocks(
            [
              { paths, file: path.join(paths.locksDir, 'root-move.lock') },
              { paths, file: path.join(paths.locksDir, `transition-${name}.lock`) },
            ],
            findings,
          );
          if (!locksReady) return false;
          await continueNativeCheckpoint(paths, name);
          return true;
        },
      );
      if (!recovered) continue;
      findings.push({
        severity: 'info',
        code: 'checkpoint-progress-recovered',
        message: `Continued Native progress checkpoint ${journal.id} for ${name}`,
        path: file,
      });
    } catch (error) {
      findings.push({
        severity: 'error',
        code: 'checkpoint-progress-recovery-failed',
        message: `Native progress checkpoint recovery failed: ${(error as Error).message}`,
        path: file,
      });
    }
  }
  return findings;
}

export async function doctorNativeProject(options: {
  paths: NativeProjectPaths;
  name?: string;
  repair?: boolean;
  recoveryStrategy?: 'continue' | 'rollback';
  now?: Date;
}): Promise<{ healthy: boolean; findings: NativeDoctorFinding[] }> {
  const repair = options.repair ?? false;
  const findings: NativeDoctorFinding[] = [];
  let paths = options.paths;
  let config;
  try {
    config = await readProjectConfig(paths.projectRoot);
  } catch (error) {
    const result = {
      healthy: false,
      findings: [
        {
          severity: 'error' as const,
          code: 'config-invalid',
          message: `Comet project config is invalid: ${(error as Error).message}`,
          path: paths.configFile,
        },
      ],
    };
    return result;
  }
  let relocationRecoveryPending = Boolean(config?.native.pending_root_move);
  if (config?.native.pending_root_move) {
    const pending = config.native.pending_root_move;
    const [fromPaths, toPaths] = await Promise.all([
      nativeProjectPaths(paths.projectRoot, pending.fromArtifactRoot),
      nativeProjectPaths(paths.projectRoot, pending.toArtifactRoot),
    ]);
    if (repair && options.recoveryStrategy) {
      try {
        const locksReady = await clearStaleRecoveryLocks(
          [
            { paths: fromPaths, file: path.join(fromPaths.locksDir, 'root-move.lock') },
            { paths: toPaths, file: path.join(toPaths.locksDir, 'root-move.lock') },
          ],
          findings,
        );
        if (!locksReady) return { healthy: false, findings };
        const recovered = await recoverNativeRootMove({
          projectRoot: paths.projectRoot,
          strategy: options.recoveryStrategy,
        });
        paths = await nativeProjectPaths(paths.projectRoot, recovered.config.native.artifact_root);
        relocationRecoveryPending = false;
        findings.push({
          severity: 'info',
          code: 'root-move-recovered',
          message: `${options.recoveryStrategy === 'continue' ? 'Continued' : 'Rolled back'} Native root move ${pending.id}`,
        });
      } catch (error) {
        findings.push({
          severity: 'error',
          code: 'root-move-recovery-failed',
          message: `Native root recovery failed: ${(error as Error).message}`,
        });
        return { healthy: false, findings };
      }
    } else {
      findings.push({
        severity: 'error',
        code: 'root-move-incomplete',
        message: `Native root move ${pending.id} is ${pending.stage}; inspect ${fromPaths.nativeRoot} and ${toPaths.nativeRoot}`,
        repair: options.recoveryStrategy ?? 'continue',
      });
    }
  }

  const managedPathFindings = await inspectManagedPaths(paths);
  findings.push(...managedPathFindings);
  if (managedPathFindings.length > 0) return { healthy: false, findings };

  const transactions = await inspectTransactions(paths, {
    name: options.name,
    repair,
    recoveryStrategy: options.recoveryStrategy,
  });
  findings.push(...transactions.findings);
  findings.push(...(await inspectSchemaMigrations(paths, { name: options.name, repair })));
  findings.push(
    ...(await inspectWorkspaceIdentityMigrations(paths, { name: options.name, repair })),
  );
  findings.push(...(await inspectTrajectoryTailRepairs(paths, { name: options.name, repair })));
  findings.push(
    ...(await inspectTransitionJournals(paths, {
      name: options.name,
      repair,
      recoveryStrategy: options.recoveryStrategy,
    })),
  );
  findings.push(...(await inspectCheckpointJournals(paths, { name: options.name, repair })));
  findings.push(
    ...(await inspectNativeEvidenceRetention({
      paths,
      name: options.name,
      repair,
      now: options.now,
      deferAll: relocationRecoveryPending || transactions.unfinished.length > 0,
    })),
  );
  findings.push(...(await inspectLocks(paths, repair, transactions.unfinished)));
  findings.push(...(await inspectSelection(paths, repair)));
  findings.push(...(await inspectChanges(paths, options.name)));
  return {
    healthy: findings.every((finding) => finding.severity === 'info'),
    findings,
  };
}
