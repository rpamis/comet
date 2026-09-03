import { promises as fs } from 'node:fs';
import path from 'node:path';

import { doctorNativeProject } from './native-doctor.js';
import { inspectNativeChildren } from './native-children.js';
import { archiveNativePortableChange } from './native-portable-archive.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import {
  hasIncompleteNativePortableMigration,
  migrateNativeLegacyChangeToPortable,
} from './native-portable-migration-runtime.js';
import { recoverNativePortableChange } from './native-portable-recovery.js';
import { inspectNativeSupervisorOverlay } from './native-supervisor-overlay.js';
import { isNativePortableChange, readNativePortableChange } from './native-portable-runtime.js';
import type { NativePortableState } from './native-portable-types.js';
import {
  inspectNativePortableStatus,
  listNativePortableChangeNames,
} from './native-portable-status.js';
import {
  describeNativePortableTransactionEntry,
  listNativePortableTransactionEntryNames,
  readNativePortableTransactionEntry,
  type NativePortableTransaction,
} from './native-portable-transactions.js';
import {
  assertNoArguments,
  doctorPaths,
  NativeUsageError,
  success,
  takeFlag,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';
import type { NativeDoctorFinding, NativeProjectPaths } from './native-types.js';

async function portableContinuation(paths: NativeProjectPaths, state: NativePortableState) {
  const children = await inspectNativeChildren({ paths, state });
  return nativePortableContinuation(state, children);
}

async function listActiveChangeNames(paths: NativeProjectPaths): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(paths.changesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

async function activeArchiveConflictFinding(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeDoctorFinding | null> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(paths.archiveDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const expected = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escapeRegularExpression(name)}$`, 'u');
  const archived = entries.find(
    (entry) => entry.isDirectory() && !entry.isSymbolicLink() && expected.test(entry.name),
  );
  if (!archived) return null;
  return {
    severity: 'error',
    code: 'portable-active-archive-conflict',
    message: `Native change ${name} exists in both active and Archive storage`,
    path: path.join(paths.archiveDir, archived.name),
  };
}

function uniqueFindings(findings: readonly NativeDoctorFinding[]): NativeDoctorFinding[] {
  const unique = new Map<string, NativeDoctorFinding>();
  for (const finding of findings) {
    const key = [finding.severity, finding.code, finding.message, finding.path ?? ''].join('\0');
    unique.set(key, finding);
  }
  return [...unique.values()];
}

function unhealthyDoctor(data: Record<string, unknown>): DispatchResult {
  return {
    command: 'doctor',
    exitCode: 65,
    data,
    error: { code: 'invalid-data', message: 'Native project needs attention' },
  };
}

function incompleteMigrationFinding(paths: NativeProjectPaths, name: string): NativeDoctorFinding {
  return {
    severity: 'error',
    code: 'portable-migration-incomplete',
    message: `Native portable migration is incomplete for ${name}`,
    path: path.join(paths.changesDir, name, 'comet-state.yaml'),
    repair: 'migrate',
  };
}

function portableSupervisorOverlayFinding(
  name: string,
  inspection: Awaited<ReturnType<typeof inspectNativeSupervisorOverlay>>,
): NativeDoctorFinding | null {
  if (inspection.status === 'repairable-legacy-overlay') {
    return {
      severity: 'error',
      code: 'portable-supervisor-overlay-stale',
      message: inspection.message,
      path: inspection.file,
      repair: 'continue',
      repairCommand: `comet native doctor ${name} --repair`,
    };
  }
  if (inspection.status === 'incompatible') {
    return {
      severity: 'error',
      code: 'portable-supervisor-overlay-incompatible',
      message: inspection.message,
      path: inspection.file,
    };
  }
  return null;
}

async function inspectPortableTransactions(
  paths: NativeProjectPaths,
  name?: string,
): Promise<{
  transactions: NativePortableTransaction[];
  findings: NativeDoctorFinding[];
}> {
  const transactions: NativePortableTransaction[] = [];
  const findings: NativeDoctorFinding[] = [];
  for (const entryName of await listNativePortableTransactionEntryNames(paths)) {
    const ref = describeNativePortableTransactionEntry(entryName)!;
    if (name && ref.change !== name) continue;
    const file = path.join(paths.transactionsDir, entryName);
    try {
      const transaction = await readNativePortableTransactionEntry(paths, entryName);
      if (!transaction) continue;
      transactions.push(transaction);
      findings.push(
        transaction.kind === 'archive'
          ? {
              severity: 'error',
              code: 'portable-archive-transaction-incomplete',
              message: `Native portable Archive transaction ${transaction.journal.id} is incomplete for ${transaction.change}`,
              path: transaction.file,
              repair: 'continue',
            }
          : {
              severity: 'error',
              code: 'portable-migration-incomplete',
              message:
                transaction.journal.status === 'committed'
                  ? `Native portable migration cleanup is incomplete for ${transaction.change}`
                  : `Native portable migration transaction ${transaction.journal.id} is incomplete for ${transaction.change}`,
              path: transaction.file,
              repair: 'migrate',
            },
      );
    } catch (error) {
      findings.push({
        severity: 'error',
        code: 'portable-transaction-invalid',
        message: `Native portable transaction ${entryName} is invalid: ${(error as Error).message}`,
        path: file,
      });
    }
  }
  return { transactions, findings };
}

export async function nativeDoctorCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const repair = takeFlag(args, '--repair');
  const recoveryStrategy = takeOption(args, '--strategy');
  if (
    recoveryStrategy !== undefined &&
    recoveryStrategy !== 'continue' &&
    recoveryStrategy !== 'rollback'
  ) {
    throw new NativeUsageError('--strategy must be continue or rollback');
  }
  const name = args[0]?.startsWith('--') ? undefined : args.shift();
  assertNoArguments(args);
  const paths = await doctorPaths(projectRoot);
  const portableTransactions = await inspectPortableTransactions(paths, name);
  if (name && portableTransactions.findings.length > 0) {
    if (recoveryStrategy) {
      throw new NativeUsageError('--strategy is only available to the legacy transaction doctor');
    }
    const portable = await isNativePortableChange(paths, name);
    const result = portable
      ? await inspectNativePortableStatus({ paths, name, details: true })
      : undefined;
    if (
      repair &&
      portableTransactions.transactions.length === 1 &&
      portableTransactions.findings.length === 1
    ) {
      const transaction = portableTransactions.transactions[0];
      if (transaction.kind === 'archive') {
        const archived = await archiveNativePortableChange({ paths, name });
        return success('doctor', {
          healthy: true,
          workflow: 'native-portable',
          change: name,
          repaired: true,
          archive: { recovered: true, transactionId: archived.transactionId },
          state: archived.state,
          continuation: await portableContinuation(paths, archived.state),
        });
      }
      const state = await migrateNativeLegacyChangeToPortable({ paths, name });
      return success('doctor', {
        healthy: true,
        workflow: 'native-portable',
        change: name,
        repaired: true,
        migration: { recovered: true, to: state.schema, stateVersion: state.state_version },
        state,
        continuation: await portableContinuation(paths, state),
      });
    }
    return unhealthyDoctor({
      healthy: false,
      workflow: 'native-portable',
      change: name,
      repaired: false,
      ...(result ? { result, continuation: result.continuation } : {}),
      findings: portableTransactions.findings,
    });
  }
  if (name && (await isNativePortableChange(paths, name))) {
    if (recoveryStrategy) {
      throw new NativeUsageError('--strategy is only available to the legacy transaction doctor');
    }
    const [conflict, migrationIncomplete] = await Promise.all([
      activeArchiveConflictFinding(paths, name),
      hasIncompleteNativePortableMigration(paths, name),
    ]);
    if (conflict) {
      const result = await inspectNativePortableStatus({ paths, name, details: true });
      return unhealthyDoctor({
        healthy: false,
        workflow: 'native-portable',
        change: name,
        repaired: false,
        result,
        findings: [conflict],
        continuation: result.continuation,
      });
    }
    if (migrationIncomplete && !repair) {
      const result = await inspectNativePortableStatus({ paths, name, details: true });
      return unhealthyDoctor({
        healthy: false,
        workflow: 'native-portable',
        change: name,
        repaired: false,
        result,
        findings: [incompleteMigrationFinding(paths, name)],
        continuation: result.continuation,
      });
    }
    const portableState = await readNativePortableChange(paths, name);
    const supervisorOverlay = await inspectNativeSupervisorOverlay({
      paths,
      state: portableState,
    });
    const supervisorFinding = portableSupervisorOverlayFinding(name, supervisorOverlay);
    if (supervisorFinding && (supervisorOverlay.status === 'incompatible' || !repair)) {
      const result = await inspectNativePortableStatus({ paths, name, details: true });
      return unhealthyDoctor({
        healthy: false,
        workflow: 'native-portable',
        change: name,
        repaired: false,
        result,
        findings: [supervisorFinding],
        continuation: result.continuation,
      });
    }
    if (repair) {
      if (migrationIncomplete) {
        const state = await migrateNativeLegacyChangeToPortable({ paths, name });
        return success('doctor', {
          healthy: true,
          workflow: 'native-portable',
          change: name,
          repaired: true,
          migration: { recovered: true, to: state.schema, stateVersion: state.state_version },
          state,
          continuation: await portableContinuation(paths, state),
        });
      }
      const result = await recoverNativePortableChange({ paths, name });
      return success('doctor', {
        healthy: true,
        workflow: 'native-portable',
        change: name,
        repaired: true,
        result,
        continuation: await portableContinuation(paths, result.state),
      });
    }
    const result = await inspectNativePortableStatus({ paths, name, details: true });
    return success('doctor', {
      healthy: true,
      workflow: 'native-portable',
      change: name,
      repaired: false,
      result,
      continuation: result.continuation,
    });
  }
  if (name) {
    if (repair) {
      const state = await migrateNativeLegacyChangeToPortable({ paths, name });
      return success('doctor', {
        healthy: true,
        workflow: 'native-portable',
        change: name,
        repaired: true,
        migration: { from: 'legacy', to: state.schema, stateVersion: state.state_version },
        state,
        continuation: await portableContinuation(paths, state),
      });
    }
    return {
      command: 'doctor',
      exitCode: 65,
      data: {
        healthy: false,
        change: name,
        migrationRequired: true,
        repairCommand: `comet native doctor ${name} --repair`,
      },
      error: {
        code: 'invalid-data',
        message: `Native active change ${name} requires migration to portable Runtime`,
      },
    };
  }
  const portableNames = await listNativePortableChangeNames(paths);
  const projectPortableTransactions = portableTransactions;
  if (portableNames.length > 0 || projectPortableTransactions.findings.length > 0) {
    if (recoveryStrategy) {
      throw new NativeUsageError('--strategy is only available to the legacy transaction doctor');
    }
    if (repair) {
      const projectRepair = await doctorNativeProject({ paths, repair: true, projectOnly: true });
      const repairedPortableTransactions: Array<{
        kind: NativePortableTransaction['kind'];
        change: string;
        transactionId: string;
      }> = [];
      for (const transaction of projectPortableTransactions.transactions) {
        if (transaction.kind === 'archive') {
          await archiveNativePortableChange({ paths, name: transaction.change });
        } else {
          await migrateNativeLegacyChangeToPortable({ paths, name: transaction.change });
        }
        repairedPortableTransactions.push({
          kind: transaction.kind,
          change: transaction.change,
          transactionId: transaction.journal.id,
        });
      }
      const inspected = await nativeDoctorCommand([], projectRoot);
      const inspectedData =
        inspected.data && typeof inspected.data === 'object' && !Array.isArray(inspected.data)
          ? (inspected.data as Record<string, unknown>)
          : {};
      return {
        ...inspected,
        data: {
          ...inspectedData,
          repaired: true,
          repairedPortableTransactions,
          repairFindings: projectRepair.findings,
        },
      };
    }
    const activeNames = await listActiveChangeNames(paths);
    const portableSet = new Set(portableNames);
    const migrationTransactionNames = new Set(
      projectPortableTransactions.transactions
        .filter((transaction) => transaction.kind === 'migration')
        .map(({ change }) => change),
    );
    const legacyNames = activeNames.filter((change) => !portableSet.has(change));
    const [changes, conflicts, incompleteMigrations, legacyResults, projectResult] =
      await Promise.all([
        Promise.all(
          portableNames.map((change) => inspectNativePortableStatus({ paths, name: change })),
        ),
        Promise.all(portableNames.map((change) => activeArchiveConflictFinding(paths, change))),
        Promise.all(
          portableNames.map((change) => hasIncompleteNativePortableMigration(paths, change)),
        ),
        Promise.all(legacyNames.map((change) => doctorNativeProject({ paths, name: change }))),
        doctorNativeProject({ paths, projectOnly: true }),
      ]);
    const findings = uniqueFindings([
      ...conflicts.filter((finding): finding is NativeDoctorFinding => finding !== null),
      ...portableNames.flatMap((change, index) =>
        incompleteMigrations[index] && !migrationTransactionNames.has(change)
          ? [incompleteMigrationFinding(paths, change)]
          : [],
      ),
      ...projectPortableTransactions.findings,
      ...legacyNames.map<NativeDoctorFinding>((change) => ({
        severity: 'error',
        code: 'portable-migration-required',
        message: `Native active change ${change} requires migration to portable Runtime`,
        path: path.join(paths.changesDir, change, 'comet-state.yaml'),
        repair: 'migrate',
      })),
      ...legacyResults.flatMap(({ findings: resultFindings }) => resultFindings),
      ...projectResult.findings,
    ]);
    const data = {
      healthy: findings.every((finding) => finding.severity === 'info'),
      workflow: legacyNames.length > 0 ? 'native-mixed' : 'native-portable',
      changes,
      legacyChanges: legacyNames,
      findings,
    };
    return data.healthy ? success('doctor', data) : unhealthyDoctor(data);
  }
  const result = await doctorNativeProject({
    paths,
    ...(name ? { name } : {}),
    repair,
    ...(recoveryStrategy ? { recoveryStrategy } : {}),
  });
  return result.healthy
    ? success('doctor', result)
    : {
        command: 'doctor',
        exitCode: 65,
        data: result,
        error: { code: 'invalid-data', message: 'Native project needs attention' },
      };
}
