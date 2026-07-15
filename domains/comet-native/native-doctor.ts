import { promises as fs, type Dirent } from 'fs';
import path from 'path';

import { recoverArchiveTransaction } from './native-archive.js';
import { readNativeChange } from './native-change.js';
import { readProjectConfig } from './native-config.js';
import { inspectNativeArtifactFindings, listNativeStatus } from './native-diagnostics.js';
import { diagnoseNativeLock } from './native-lock.js';
import { nativeProjectPaths, resolveContainedNativePath } from './native-paths.js';
import { recoverNativeRootMove } from './native-root-move.js';
import { nativeSelectionFile } from './native-selection.js';
import { readNativeTransaction } from './native-transaction.js';
import {
  continueNativeTransition,
  inspectPendingNativeTransition,
  nativeTransitionJournalFile,
} from './native-transition-journal.js';
import type {
  NativeDoctorFinding,
  NativeProjectPaths,
  NativeTransactionJournal,
} from './native-types.js';

async function directoryEntries(directory: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function clearStaleRecoveryLocks(
  files: string[],
  findings: NativeDoctorFinding[],
): Promise<boolean> {
  for (const file of [...new Set(files.map((entry) => path.resolve(entry)))]) {
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
      await fs.rm(file, { force: true });
      findings.push({
        severity: 'info',
        code: 'stale-recovery-lock-removed',
        message: `Removed stale lock before explicit transaction recovery`,
        path: file,
      });
      continue;
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
  let value: { schema?: unknown; change?: unknown };
  try {
    await resolveContainedNativePath(paths.nativeRoot, file);
    value = JSON.parse(await fs.readFile(file, 'utf8')) as typeof value;
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
  if (value.schema !== 'comet.native.selection.v1' || typeof value.change !== 'string') {
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
  for (const entry of await directoryEntries(paths.transactionsDir)) {
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
        const locksReady = await clearStaleRecoveryLocks(
          [path.join(paths.locksDir, 'root-move.lock'), path.join(paths.locksDir, 'archive.lock')],
          findings,
        );
        if (!locksReady) {
          unfinished.push(journal);
          continue;
        }
        await recoverArchiveTransaction({
          paths,
          transactionId: journal.id,
          strategy: options.recoveryStrategy,
        });
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
  for (const entry of await directoryEntries(paths.locksDir)) {
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
          await fs.rm(file, { force: true });
          findings.push({
            severity: 'info',
            code: 'stale-lock-removed',
            message: 'Removed a Native lock whose local owner process is absent',
            path: file,
          });
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
    if (status.phase === 'invalid') {
      findings.push({
        severity: 'error',
        code: 'change-invalid',
        message: status.error ?? `Native change ${status.name} is invalid`,
        path: path.join(paths.changesDir, status.name, 'change.yaml'),
      });
      continue;
    }
    const state = await readNativeChange(paths, status.name);
    for (const artifact of await inspectNativeArtifactFindings(paths, state)) {
      findings.push({
        severity: 'error',
        code: artifact.code,
        message: `${status.name}: ${artifact.message}`,
        ...(artifact.path ? { path: artifact.path } : {}),
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
    : (await directoryEntries(paths.changesDir))
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => entry.name)
        .sort();
  for (const name of names) {
    let journal;
    try {
      journal = await inspectPendingNativeTransition(paths, name);
    } catch (error) {
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
        await continueNativeTransition(paths, name);
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

export async function doctorNativeProject(options: {
  paths: NativeProjectPaths;
  name?: string;
  repair?: boolean;
  recoveryStrategy?: 'continue' | 'rollback';
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
            path.join(fromPaths.locksDir, 'root-move.lock'),
            path.join(toPaths.locksDir, 'root-move.lock'),
          ],
          findings,
        );
        if (!locksReady) return { healthy: false, findings };
        const recovered = await recoverNativeRootMove({
          projectRoot: paths.projectRoot,
          strategy: options.recoveryStrategy,
        });
        paths = await nativeProjectPaths(paths.projectRoot, recovered.config.native.artifact_root);
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
  findings.push(
    ...(await inspectTransitionJournals(paths, {
      name: options.name,
      repair,
      recoveryStrategy: options.recoveryStrategy,
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
