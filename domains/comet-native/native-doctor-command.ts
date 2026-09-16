import { promises as fs } from 'node:fs';
import path from 'node:path';

import { inspectGitWorktree, resolveGitRef } from '../../platform/paths/git-worktree.js';

import { doctorNativeProject } from './native-doctor.js';
import { inspectNativeChildren, readNativeChildrenContract } from './native-children.js';
import { archiveNativePortableChange } from './native-portable-archive.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import {
  hasIncompleteNativePortableMigration,
  migrateNativeLegacyChangeToPortable,
} from './native-portable-migration-runtime.js';
import {
  inspectNativePortableAcceptanceDrift,
  recoverNativePortableShapeConfirmationDrift,
} from './native-portable-requirements.js';
import { recoverNativePortableChange } from './native-portable-recovery.js';
import { readNativeLocalExecution } from './native-local-execution.js';
import { inspectNativePortableCheckExecution } from './native-portable-checks.js';
import { inspectNativeSupervisorOverlay } from './native-supervisor-overlay.js';
import {
  isNativePortableChange,
  nativeLocalExecutionFile,
  nativePortableChangeDir,
  nativePortableStateFile,
  readNativePortableChange,
} from './native-portable-runtime.js';
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

async function portableCheckExecutionFinding(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeDoctorFinding | null> {
  let local: Awaited<ReturnType<typeof readNativeLocalExecution>>;
  try {
    local = await readNativeLocalExecution(nativeLocalExecutionFile(paths, name));
  } catch {
    return null;
  }
  if (local?.execution?.stage !== 'checking' || local.execution.actor !== 'runtime') return null;
  if (local.execution.status !== 'running') return null;
  const liveness = await inspectNativePortableCheckExecution(local);
  if (liveness === 'running') return null;
  const message =
    liveness === 'orphaned'
      ? `Native Runtime check operation ${local.execution.operationId} has no live owner or active check process`
      : `Native Runtime check operation ${local.execution.operationId} is running, but its owner process identity is unavailable`;
  return {
    severity: 'error',
    code: 'portable-check-execution-stuck',
    message: `${name}: ${message}; run comet native doctor ${name} --repair to recover it`,
    path: nativeLocalExecutionFile(paths, name),
    repair: 'recover',
  };
}

async function portableShapeConfirmationFinding(
  paths: NativeProjectPaths,
  name: string,
  state: NativePortableState,
): Promise<NativeDoctorFinding | null> {
  if (
    state.phase !== 'shape' ||
    state.status !== 'await-user' ||
    state.loop.next_action !== 'confirm-shape'
  ) {
    return null;
  }
  const drift = await inspectNativePortableAcceptanceDrift({ paths, state });
  if (!drift.drifted) return null;
  const reason = drift.reason ?? 'Native confirmed requirements changed';
  return {
    severity: 'error',
    code: 'portable-shape-confirmation-drift',
    message: `${name}: pending Shape confirmation is stale (${reason}); run comet native doctor ${name} --repair to reopen Shape`,
    path: nativePortableStateFile(paths, name),
    repair: 'recover',
    repairCommand: `comet native doctor ${name} --repair`,
  };
}

/**
 * A change with a children contract needs a Git target branch, but
 * `--isolation current` changes created before Git existed keep a null
 * binding. Surface the mismatch instead of reporting an unqualified healthy
 * state; the confirmation boundary binds the workspace once Git is available.
 */
async function portableSupervisorGitBindingFinding(
  paths: NativeProjectPaths,
  name: string,
  state: NativePortableState,
): Promise<NativeDoctorFinding | null> {
  if (state.archived || state.workspace.change_branch !== null) return null;
  let childrenPresent: boolean;
  try {
    childrenPresent =
      (await readNativeChildrenContract({
        changeDir: nativePortableChangeDir(paths, name),
        policy: 'advisory',
      })) !== null;
  } catch {
    // An unreadable children.yaml still requires the Git binding; the
    // continuation reports the contract error separately.
    childrenPresent = true;
  }
  if (!childrenPresent) return null;
  const inspection = inspectGitWorktree(paths.projectRoot);
  const attached =
    inspection.isGitWorktree &&
    inspection.currentBranch !== null &&
    resolveGitRef(paths.projectRoot, inspection.currentBranch) !== null;
  return {
    severity: 'error',
    code: 'portable-supervisor-git-binding-missing',
    message: attached
      ? `${name}: the Supervisor change has no Git branch binding; run comet native status ${name} --json and rerun its continuation to bind branch ${inspection.currentBranch} at the Shape confirmation boundary`
      : `${name}: the Supervisor change requires Git; initialize a Git repository, commit to a branch, then rerun the latest continuation`,
    path: nativePortableStateFile(paths, name),
  };
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
    const gitBindingFinding = await portableSupervisorGitBindingFinding(paths, name, portableState);
    if (gitBindingFinding) {
      const result = await inspectNativePortableStatus({ paths, name, details: true });
      return unhealthyDoctor({
        healthy: false,
        workflow: 'native-portable',
        change: name,
        repaired: false,
        result,
        findings: [gitBindingFinding],
        continuation: result.continuation,
      });
    }
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
      const shapeRecovery = await recoverNativePortableShapeConfirmationDrift({ paths, name });
      if (shapeRecovery.repaired) {
        return success('doctor', {
          healthy: true,
          workflow: 'native-portable',
          change: name,
          repaired: true,
          result: shapeRecovery,
          continuation: await portableContinuation(paths, shapeRecovery.state),
        });
      }
      const result = await recoverNativePortableChange({
        paths,
        name,
        recoverUnknownRuntimeCheck: true,
      });
      if (result.reason === 'execution-active') {
        return success('doctor', {
          healthy: true,
          workflow: 'native-portable',
          change: name,
          repaired: false,
          result,
          continuation: await portableContinuation(paths, result.state),
        });
      }
      return success('doctor', {
        healthy: true,
        workflow: 'native-portable',
        change: name,
        repaired: true,
        result,
        continuation: await portableContinuation(paths, result.state),
      });
    }
    const shapeFinding = await portableShapeConfirmationFinding(paths, name, portableState);
    if (shapeFinding) {
      const result = await inspectNativePortableStatus({ paths, name, details: true });
      return unhealthyDoctor({
        healthy: false,
        workflow: 'native-portable',
        change: name,
        repaired: false,
        result,
        findings: [shapeFinding],
        continuation: result.continuation,
      });
    }
    const executionFinding = await portableCheckExecutionFinding(paths, name);
    if (executionFinding) {
      const result = await inspectNativePortableStatus({ paths, name, details: true });
      return unhealthyDoctor({
        healthy: false,
        workflow: 'native-portable',
        change: name,
        repaired: false,
        result,
        findings: [executionFinding],
        continuation: result.continuation,
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
      const repairedShapeConfirmations: Array<{ change: string; reason: string }> = [];
      for (const change of portableNames) {
        const shapeRecovery = await recoverNativePortableShapeConfirmationDrift({
          paths,
          name: change,
        });
        if (shapeRecovery.repaired) {
          repairedShapeConfirmations.push({
            change,
            reason: shapeRecovery.reason ?? 'Native confirmed requirements changed',
          });
        }
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
          repairedShapeConfirmations,
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
    const [
      changes,
      conflicts,
      incompleteMigrations,
      shapeFindings,
      gitBindingFindings,
      executionFindings,
      legacyResults,
      projectResult,
    ] = await Promise.all([
      Promise.all(
        portableNames.map((change) => inspectNativePortableStatus({ paths, name: change })),
      ),
      Promise.all(portableNames.map((change) => activeArchiveConflictFinding(paths, change))),
      Promise.all(
        portableNames.map((change) => hasIncompleteNativePortableMigration(paths, change)),
      ),
      Promise.all(
        portableNames.map(async (change) => {
          const state = await readNativePortableChange(paths, change);
          return portableShapeConfirmationFinding(paths, change, state);
        }),
      ),
      Promise.all(
        portableNames.map(async (change) => {
          const state = await readNativePortableChange(paths, change);
          return portableSupervisorGitBindingFinding(paths, change, state);
        }),
      ),
      Promise.all(portableNames.map((change) => portableCheckExecutionFinding(paths, change))),
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
      ...shapeFindings.filter((finding): finding is NativeDoctorFinding => finding !== null),
      ...gitBindingFindings.filter((finding): finding is NativeDoctorFinding => finding !== null),
      ...executionFindings.filter((finding): finding is NativeDoctorFinding => finding !== null),
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
