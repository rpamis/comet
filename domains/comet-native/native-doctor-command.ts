import { readWorkflowApplicationRun } from '../workflow-application/index.js';
import type { RuntimeStoppedAction } from '../engine/runtime.js';
import { settleNativeSdkCancellation } from './native-sdk-cancellation-cleanup.js';
import { promises as fs } from 'node:fs';
import {
  readChangeRuntimeOwner,
  readSdkChangeOwner,
  registerSdkChangeOwner,
  COMET_CHANGE_OWNER_SCHEMA,
} from '../workflow-contract/change-runtime-owner.js';
import {
  inspectNativeSdkRun,
  inspectNativeSdkDefinitionUpgrade,
  resolveNativeSdkCommandRoot,
  loadOwnedNativeSdkRuntime,
} from './native-runtime-ownership.js';
import { inspectPristineNativeSdkChange, restoreNativeSdkChange } from './native-sdk-create.js';
import {
  hasNativeManagedRunMarker,
  hasNativePortableRunCheckpoint,
  readNativeSdkRunRecord,
  findNativeSdkArchivedStateFile,
  isNativeSdkRunRecoveryRequiredError,
} from './native-sdk-state-store.js';
import { inspectNativeSdkCheckExecutions } from './native-sdk-check-execution.js';
import { recoverNativeSdkChecks } from './native-sdk-checks.js';
import { projectNativeSdkStatus } from './native-sdk-status.js';
import {
  inspectNativeSdkProjectionLock,
  repairNativeSdkProjectionLock,
} from './native-sdk-projection-lock.js';
import { inspectNativeSdkCancellation } from './native-sdk-cancellation.js';

/**
 * A dispatched Verifier that never confirmed startup is presumed lost after
 * this long; explicit doctor repair may register its failure so the change
 * returns to a dispatchable Verify boundary (platform queue loss, quota
 * reclaim). Genuine startups report progress well within the window.
 */
const NATIVE_VERIFIER_CONFIRM_TAKEOVER_MS = 30 * 60 * 1_000;
import path from 'node:path';

import { inspectGitWorktree, resolveGitRef } from '../../platform/paths/git-worktree.js';
import { gitWorktreeIsClean } from '../../platform/process/git.js';

import { doctorNativeProject } from './native-doctor.js';
import { inspectNativeChildren, readNativeChildrenContract } from './native-children.js';
import { archiveNativePortableChange } from './native-portable-archive.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import {
  compareAndSwapNativePortableState,
  parseNativePortableState,
  readNativePortableState,
} from './native-portable-state.js';
import { recordNativeVerifierExecutionError } from './native-loop-runtime.js';
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
  activeNativeSupervisorTaskNames,
  readNativeSupervisorState,
  writeNativeSupervisorState,
} from './native-supervisor-state.js';
import { supervisorDependenciesIntegrated } from './native-supervisor-model.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import {
  isNativePortableChange,
  nativeLocalExecutionFile,
  nativePortableChangeDir,
  nativePortableStateFile,
  readNativePortableChange,
} from './native-portable-runtime.js';
import {
  listNativeWorkspaceFinishJournals,
  quarantineNativeWorkspaceFinishJournal,
  readNativeWorkspaceFinishJournal,
  readNativeWorkspaceFinishArchive,
  inspectNativeWorkspaceFinishCompletion,
  clearNativeWorkspaceFinishJournal,
  writeNativeWorkspaceFinishJournal,
  type NativeWorkspaceFinishJournal,
} from './native-workspace-finish.js';
import { listNativeArchivedStatusRecords } from './native-archived-status.js';
import type { NativePortableState } from './native-portable-types.js';
import type {
  NativeSupervisorChildState,
  NativeSupervisorState,
} from './native-supervisor-model.js';
import {
  inspectNativePortableStatus,
  listNativePortableChangeNames,
  projectNativeArchivedStatus,
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
  const clean = attached && gitWorktreeIsClean(paths.projectRoot);
  const activeTasks = attached ? await activeNativeSupervisorTaskNames(paths, name) : [];
  return {
    severity: 'error',
    code: 'portable-supervisor-git-binding-missing',
    message: !attached
      ? `${name}: the Supervisor change requires Git; initialize a Git repository, commit to a branch, then rerun the latest continuation`
      : !clean
        ? `${name}: the Supervisor change has no Git branch binding and the current Git baseline is dirty; commit or stash pending changes to restore a clean current working directory, then rerun the latest continuation`
        : activeTasks.length > 0
          ? `${name}: the Supervisor change has no Git branch binding while active child tasks exist (${activeTasks.join(', ')}); finish or recover those tasks before rerunning the latest continuation`
          : `${name}: the Supervisor change has no Git branch binding; run comet native status ${name} --json and rerun its continuation to bind branch ${inspection.currentBranch} at the Shape confirmation boundary`,
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

async function inspectWorkspaceFinishJournalErrors(
  paths: NativeProjectPaths,
  name?: string,
): Promise<Array<{ name: string; message: string }>> {
  const errors: Array<{ name: string; message: string }> = [];
  if (name !== undefined && !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(name)) return errors;
  const onError = (journalName: string, message: string) =>
    errors.push({ name: journalName, message });
  if (name !== undefined) {
    await readNativeWorkspaceFinishJournal(paths, name, { onError });
  } else {
    await listNativeWorkspaceFinishJournals(paths, { onError });
  }
  return errors;
}

function workspaceFinishJournalFinding(
  paths: NativeProjectPaths,
  error: { name: string; message: string },
): NativeDoctorFinding {
  return {
    severity: 'error',
    code: 'portable-workspace-finish-journal-invalid',
    message: `Native workspace finish journal for ${error.name} is invalid (${error.message}); run comet native doctor ${error.name} --repair to quarantine it and resume from the preserved change or Archive record`,
    path: path.join(paths.transactionsDir, `workspace-finish-${error.name}.json`),
    repair: 'continue',
    repairCommand: `comet native doctor ${error.name} --repair`,
  };
}

function unhealthyDoctor(data: Record<string, unknown>): DispatchResult {
  return {
    command: 'doctor',
    exitCode: 65,
    data,
    error: { code: 'invalid-data', message: 'Native project needs attention' },
  };
}

async function workspaceFinishInspection(
  paths: NativeProjectPaths,
  journal: NativeWorkspaceFinishJournal,
  repair: boolean,
) {
  const commandArgs = journal.result?.recoveryArgs ?? [
    'comet',
    'native',
    'archive',
    journal.name,
    '--confirmed',
  ];
  try {
    const record = await readNativeWorkspaceFinishArchive(paths, journal);
    if (repair && (await inspectNativeWorkspaceFinishCompletion(paths, journal))) {
      await clearNativeWorkspaceFinishJournal(paths, journal.name);
      return {
        repaired: true,
        result: projectNativeArchivedStatus({ paths, state: record.state, file: record.file }),
        findings: [] as NativeDoctorFinding[],
      };
    }
    const result = projectNativeArchivedStatus({
      paths,
      state: record.state,
      file: record.file,
      finishJournal: journal,
    });
    return {
      repaired: false,
      result,
      findings: [
        {
          severity: 'error' as const,
          code: 'workspace-finish-incomplete',
          message: `${journal.name}: ${journal.result?.message ?? 'Archive files are sealed, but Git workspace finish is pending'}; retry comet native archive ${journal.name} --confirmed after resolving the Git blocker`,
          path: path.join(paths.transactionsDir, `workspace-finish-${journal.name}.json`),
          repair: 'continue' as const,
          repairCommand: `comet native archive ${journal.name} --confirmed`,
        },
      ],
    };
  } catch (error) {
    return {
      repaired: false,
      result: null,
      findings: [
        {
          severity: 'error' as const,
          code: 'workspace-finish-incomplete',
          message: `${journal.name}: ${(error as Error).message}`,
          path: path.join(paths.transactionsDir, `workspace-finish-${journal.name}.json`),
          repair: 'continue' as const,
          repairCommand: commandArgs.join(' '),
        },
      ],
    };
  }
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

/**
 * A `ready` child whose dependencies are not integrated is a state the
 * dispatcher always rejects (issue #439): the Supervisor change self-locks on
 * `advance-children` while doctor reports healthy. A pre-0.4.2 overlay can
 * still carry that state, so doctor surfaces it explicitly instead of
 * reporting healthy and lets --repair demote the stuck children to `pending`
 * — the smallest write that unlocks the change without touching any
 * integrated work.
 */
function unmetReadySupervisorDependencyFinding(
  name: string,
  supervisorState: NativeSupervisorState,
  blocked: NativeSupervisorChildState[],
): NativeDoctorFinding {
  const statuses = new Map(
    supervisorState.children.map(({ name: child, status }) => [child, status]),
  );
  const detail = blocked
    .map((child) => {
      const unmet = child.dependsOn.filter(
        (dependency) => statuses.get(dependency) !== 'integrated',
      );
      return `${child.name} (waiting on: ${unmet.join(', ')})`;
    })
    .join('; ');
  return {
    severity: 'error',
    code: 'portable-supervisor-ready-dependencies-unmet',
    message: `Native Supervisor children are marked ready but their dependencies are not integrated: ${detail}. Run doctor --repair to demote them to pending until their dependencies integrate.`,
    repair: 'continue',
    repairCommand: `comet native doctor ${name} --repair`,
  };
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
  const confirmed = takeFlag(args, '--confirmed');
  const lockToken = takeOption(args, '--lock-token');
  const stoppedActionsFile = takeOption(args, '--stopped-actions');
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
  if (confirmed && (!repair || !name)) {
    throw new NativeUsageError('--confirmed requires a named change and --repair');
  }
  if (lockToken !== undefined && (!repair || !confirmed || !name)) {
    throw new NativeUsageError('--lock-token requires a named change, --repair and --confirmed');
  }
  let stoppedActions: RuntimeStoppedAction[] | undefined;
  if (stoppedActionsFile !== undefined) {
    if (!repair || !confirmed || !name || lockToken !== undefined)
      throw new NativeUsageError(
        '--stopped-actions requires a named change, --repair and --confirmed; it cannot be combined with --lock-token',
      );
    const file = path.resolve(projectRoot, stoppedActionsFile);
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 1024 * 1024)
      throw new NativeUsageError('停止证据必须是不超过 1 MiB 的 JSON 文件');
    const value: unknown = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/u, ''));
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))
    )
      throw new NativeUsageError('--stopped-actions 必须包含原 Action 停止确认的非空数组');
    stoppedActions = value as RuntimeStoppedAction[];
  }
  const paths = await doctorPaths(projectRoot);
  const owner = name ? await readChangeRuntimeOwner(projectRoot, 'native', name) : null;
  if (
    name &&
    (!owner ||
      (owner.format === 'sdk' &&
        owner.runId === name &&
        (owner.application === 'native'
          ? await readNativeSdkRunRecord(projectRoot, name)
          : await readWorkflowApplicationRun(projectRoot, owner.application, name)) === null))
  ) {
    let file = nativePortableStateFile(paths, name);
    let marked = await hasNativeManagedRunMarker(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    if (!marked) {
      const archived = await findNativeSdkArchivedStateFile(paths, name);
      if (archived) {
        file = archived;
        marked = await hasNativeManagedRunMarker(file);
      }
    }
    if (marked) {
      const recoverable =
        file === nativePortableStateFile(paths, name)
          ? await inspectPristineNativeSdkChange(paths, name)
          : null;
      const checkpoint = await hasNativePortableRunCheckpoint(file, name);
      if (checkpoint) {
        try {
          await (
            await loadOwnedNativeSdkRuntime(projectRoot, name, { readOnly: true })
          ).runtime.inspect(name);
        } catch (error) {
          if (!isNativeSdkRunRecoveryRequiredError(error)) {
            return unhealthyDoctor({
              workflow: 'native-sdk',
              runtimeFormat: 'sdk',
              change: name,
              healthy: false,
              repaired: false,
              findings: [
                {
                  code: 'sdk-run-invalid',
                  message: error instanceof Error ? error.message : String(error),
                },
              ],
            });
          }
        }
      }
      if (repair && confirmed && lockToken === undefined && stoppedActionsFile === undefined) {
        const loaded = checkpoint ? await loadOwnedNativeSdkRuntime(projectRoot, name) : null;
        const run = loaded
          ? await loaded.runtime.inspect(name)
          : await restoreNativeSdkChange(paths, name);
        if (!(await readSdkChangeOwner(projectRoot, 'native', name))) {
          await registerSdkChangeOwner(projectRoot, {
            schema: COMET_CHANGE_OWNER_SCHEMA,
            workflow: 'native',
            change: name,
            format: 'sdk',
            application: loaded?.application?.identity.id ?? 'native',
            runId: run.runId,
          });
        }
        const state = parseNativePortableState(run.state);
        const diagnosed = await nativeDoctorCommand([name], projectRoot);
        return {
          ...diagnosed,
          data: {
            ...(diagnosed.data as Record<string, unknown>),
            repaired: true,
            message: checkpoint
              ? `Recovered at ${state.phase} from the portable Run checkpoint.`
              : 'Recovered at Shape. Revalidate documents and obtain fresh confirmation before advancing.',
          },
        };
      }
      return unhealthyDoctor({
        workflow: 'native-sdk',
        runtimeFormat: 'sdk',
        change: name,
        healthy: false,
        repaired: false,
        findings: [
          {
            code: recoverable || checkpoint ? 'sdk-run-recoverable' : 'sdk-run-history-missing',
            message: checkpoint
              ? `This change can restore its Run at the saved ${parseNativePortableState(await readNativePortableState(file)).phase} phase; run comet native doctor ${name} --repair --confirmed.`
              : recoverable
                ? `This untouched change can safely recreate its Run. Run comet native doctor ${name} --repair --confirmed; doctor has not changed it.`
                : `The portable state survived but this checkout has no Run history. Run comet native doctor ${name} --repair --confirmed to restart at Shape and reconfirm the work; unknown external actions will not be replayed.`,
          },
        ],
      });
    }
  }
  if (confirmed && lockToken === undefined && stoppedActionsFile === undefined) {
    throw new NativeUsageError(
      '--confirmed requires missing Run history or the inspected projection --lock-token',
    );
  }
  const portableTransactions = await inspectPortableTransactions(paths, name);
  if (name && portableTransactions.findings.length === 0) {
    const commandRoot = await resolveNativeSdkCommandRoot(projectRoot, name, { readOnly: true });
    if (await readSdkChangeOwner(commandRoot, 'native', name)) {
      if (recoveryStrategy) {
        throw new NativeUsageError('--strategy is only available to the legacy transaction doctor');
      }
      const lockFindings: Array<Record<string, unknown>> = [];
      let lockRepaired = false;
      try {
        let lock = await inspectNativeSdkProjectionLock(commandRoot, name);
        if (
          lockToken !== undefined &&
          lock.token !== lockToken &&
          !lock.coordinator?.some((entry) => entry.token === lockToken)
        ) {
          throw new NativeUsageError(
            'Projection lock changed since inspection; inspect doctor again before confirming repair',
          );
        }
        if (repair && ((lock.token && lock.status === 'stale') || (confirmed && lockToken))) {
          const result = await repairNativeSdkProjectionLock(
            commandRoot,
            name,
            lockToken ?? lock.token!,
            confirmed,
          );
          lockRepaired = result === 'removed';
          lock = await inspectNativeSdkProjectionLock(commandRoot, name);
        }
        if (lock.status !== 'missing') {
          const uncertain = lock.status === 'unknown' || lock.status === 'malformed';
          lockFindings.push({
            code: `sdk-projection-lock-${lock.status}`,
            path: lock.path,
            owner: lock.owner,
            token: lock.token,
            message:
              lock.status === 'active'
                ? 'The projection writer is still alive; wait for that writer to finish. Read-only inspection has not changed its lock.'
                : uncertain
                  ? 'The projection owner cannot be proved stopped. Confirm the original writer and all concurrent writers have stopped on every host before running the confirmed repair command; elapsed time alone is not evidence of exit.'
                  : 'The local projection owner has exited; explicit doctor repair can recover its exact lock without a minimum waiting period.',
            ...(lock.status === 'active'
              ? {}
              : {
                  repairCommand: uncertain
                    ? `comet native doctor ${name} --repair --confirmed --lock-token ${lock.token}`
                    : `comet native doctor ${name} --repair`,
                }),
          });
        }
        for (const contender of lock.coordinator ?? []) {
          lockFindings.push({
            code: `sdk-projection-coordinator-${contender.status}`,
            path: contender.file,
            owner: contender.owner,
            token: contender.token,
            message:
              contender.status === 'active'
                ? 'A live projection lock contender is updating lock metadata; wait for it to finish.'
                : 'Projection lock coordination has an unknown owner. Confirm every original and concurrent writer has stopped before repairing this exact record.',
            ...(contender.status === 'active'
              ? {}
              : {
                  repairCommand: `comet native doctor ${name} --repair --confirmed --lock-token ${contender.token}`,
                }),
          });
        }
        const mayRepair = repair && lockFindings.length === 0;
        let executionRepaired = false;
        let inspection = await inspectNativeSdkRun(commandRoot, name, { readOnly: !mayRepair });
        if (mayRepair) {
          const checks = await inspectNativeSdkCheckExecutions({
            projectRoot: commandRoot,
            run: inspection.run,
          });
          if (checks.some((check) => check.recoveryRequired)) {
            const { runtime } = await loadOwnedNativeSdkRuntime(commandRoot, name);
            const recovered = await recoverNativeSdkChecks(commandRoot, inspection.run, runtime, {
              reconcileInterrupted: confirmed && stoppedActions !== undefined,
              stoppedActions,
            });
            executionRepaired = recovered.revision !== inspection.run.revision;
            inspection = await inspectNativeSdkRun(commandRoot, name, { readOnly: true });
          }
        }
        // 原 Action 必须先在固定旧定义下核对，再显式迁移；未知执行不能被定义升级覆盖。
        let upgrade = await inspectNativeSdkDefinitionUpgrade(commandRoot, name, false);
        if (mayRepair && upgrade?.ready) {
          upgrade = await inspectNativeSdkDefinitionUpgrade(commandRoot, name, true);
          if (upgrade?.repaired)
            inspection = await inspectNativeSdkRun(commandRoot, name, { readOnly: true });
        }
        const recoveryChecks = await inspectNativeSdkCheckExecutions({
          projectRoot: commandRoot,
          run: inspection.run,
        });
        if (
          upgrade?.required &&
          !upgrade.repaired &&
          !recoveryChecks.some((check) => check.recoveryRequired)
        )
          return unhealthyDoctor({
            workflow: 'native-sdk',
            runtimeFormat: 'sdk',
            change: name,
            healthy: false,
            repaired: lockRepaired || executionRepaired,
            findings: [...lockFindings, { code: 'sdk-definition-upgrade-required', ...upgrade }],
          });
        const { run } = inspection;
        if (mayRepair && run.status === 'cancelled')
          await settleNativeSdkCancellation({ projectRoot: commandRoot, run });
        const checks = await inspectNativeSdkCheckExecutions({ projectRoot: commandRoot, run });
        const cancellation = await inspectNativeSdkCancellation({ projectRoot: commandRoot, run });
        const status = await projectNativeSdkStatus({ projectRoot: commandRoot, name }, inspection);
        const unresolved = run.actions.filter((action) => action.status === 'unknown');
        const findings = [
          ...lockFindings,
          ...(upgrade?.required && !upgrade.repaired
            ? [{ code: 'sdk-definition-upgrade-required', ...upgrade }]
            : []),
          ...checks
            .filter(
              (check) => check.recoveryRequired && !(run.status === 'cancelled' && check.quiescent),
            )
            .map((check) => ({
              code: 'sdk-check-execution-recovery-required',
              ...check,
              message:
                check.reason ??
                'SDK check execution needs reconciliation; doctor repair preserves the original claim and does not replay the check',
              repairCommand: `comet native doctor ${name} --repair${check.phase === 'missing' || (check.quiescent && check.execution && !check.execution.outcome) ? ' --confirmed --stopped-actions <stopped-actions-json-file>' : ''}`,
            })),
          ...unresolved.map((action) => ({
            code: 'sdk-action-outcome-unresolved',
            actionId: action.id,
            stepId: action.stepId,
            status: action.status,
            message: 'Reconcile this SDK Action before continuing; doctor will not replay it',
          })),
          ...(run.status === 'failed'
            ? [{ code: 'sdk-run-failed', message: run.reason ?? 'SDK Run failed' }]
            : []),
          ...(cancellation?.cleanupRequired
            ? [{ code: 'sdk-cancellation-cleanup-pending', ...cancellation.cleanup }]
            : []),
          ...(cancellation && !cancellation.quiescent
            ? [
                {
                  code: 'sdk-cancellation-execution-unresolved',
                  message:
                    'The Run is cancelled, but external execution has not been proved stopped; preserve its workspace until cancellation is reconciled.',
                  outstandingActions: cancellation.outstandingActions,
                  outstandingRuns: cancellation.outstandingRuns,
                },
              ]
            : []),
        ];
        const data = {
          ...status,
          workflow: 'native-sdk',
          runtimeFormat: 'sdk',
          change: name,
          healthy: findings.length === 0,
          repaired: lockRepaired || executionRepaired || (upgrade?.repaired ?? false),
          findings,
        };
        return data.healthy ? success('doctor', data) : unhealthyDoctor(data);
      } catch (error) {
        return unhealthyDoctor({
          workflow: 'native-sdk',
          runtimeFormat: 'sdk',
          change: name,
          healthy: false,
          repaired: lockRepaired,
          findings: [
            ...lockFindings,
            {
              code: 'sdk-run-invalid',
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        });
      }
    }
  }
  if (lockToken !== undefined)
    throw new NativeUsageError('--lock-token is only available for SDK projection locks');
  if (stoppedActionsFile !== undefined)
    throw new NativeUsageError('--stopped-actions is only available for SDK check recovery');
  const workspaceFinishJournalErrors = await inspectWorkspaceFinishJournalErrors(paths, name);
  if (name && workspaceFinishJournalErrors.length > 0) {
    const finding = workspaceFinishJournalFinding(paths, workspaceFinishJournalErrors[0]);
    if (!repair) {
      const portable = await isNativePortableChange(paths, name);
      const result = portable
        ? await inspectNativePortableStatus({ paths, name, details: true })
        : undefined;
      return unhealthyDoctor({
        healthy: false,
        workflow: 'native-portable',
        change: name,
        repaired: false,
        ...(result ? { result, continuation: result.continuation } : {}),
        findings: [finding],
      });
    }
    const quarantined = await quarantineNativeWorkspaceFinishJournal(paths, name);
    const portable = await isNativePortableChange(paths, name);
    if (portable) {
      const state = await readNativePortableChange(paths, name);
      return success('doctor', {
        healthy: true,
        workflow: 'native-portable',
        change: name,
        repaired: true,
        workspaceFinishJournal: { quarantined, finding },
        state,
        continuation: await portableContinuation(paths, state),
      });
    }
    return success('doctor', {
      healthy: true,
      workflow: 'native-portable',
      change: name,
      repaired: true,
      workspaceFinishJournal: { quarantined, finding },
    });
  }
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
        const journal = await readNativeWorkspaceFinishJournal(paths, name);
        if (journal) {
          await writeNativeWorkspaceFinishJournal(paths, {
            ...journal,
            archiveDir: archived.archiveDir,
            updatedAt: new Date().toISOString(),
          });
          const inspected = await nativeDoctorCommand([name, '--repair'], projectRoot);
          return {
            ...inspected,
            data: {
              ...(inspected.data as Record<string, unknown>),
              repaired: true,
              archive: { recovered: true, transactionId: archived.transactionId },
            },
          };
        }
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
  const finishJournals = await listNativeWorkspaceFinishJournals(paths, {
    onError: () => undefined,
  });
  if (name && !(await isNativePortableChange(paths, name))) {
    const finishJournal = finishJournals.find((journal) => journal.name === name);
    if (finishJournal) {
      if (recoveryStrategy)
        throw new NativeUsageError('--strategy is only available to the legacy transaction doctor');
      const inspected = await workspaceFinishInspection(paths, finishJournal, repair);
      const data = {
        healthy: inspected.findings.length === 0,
        workflow: 'native-portable',
        change: name,
        repaired: inspected.repaired,
        result: inspected.result,
        continuation: inspected.result?.continuation,
        findings: inspected.findings,
      };
      return data.healthy ? success('doctor', data) : unhealthyDoctor(data);
    }
    const records = await listNativeArchivedStatusRecords(paths, undefined, name);
    const record = records.find((item) => item.state.name === name);
    if (record) {
      const result = projectNativeArchivedStatus({ paths, state: record.state, file: record.file });
      return success('doctor', {
        healthy: true,
        workflow: 'native-portable',
        change: name,
        repaired: false,
        result,
        continuation: result.continuation,
        findings: [],
      });
    }
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
      // A dispatched Verifier that never confirmed startup parks the change on
      // await-verifier forever (platform queue loss, quota reclaim). Once the
      // dispatch is old enough that no startup can plausibly still arrive,
      // explicit doctor repair registers the failure so Runtime returns to a
      // dispatchable Verify boundary.
      const localExecution = await readNativeLocalExecution(
        nativeLocalExecutionFile(paths, name),
      ).catch(() => null);
      const execution = localExecution?.execution;
      if (
        execution &&
        execution.stage === 'verifying' &&
        execution.actor === 'verifier' &&
        execution.status === 'running' &&
        execution.verifierStartedAt === undefined
      ) {
        const waitingMs = Date.now() - Date.parse(execution.startedAt);
        if (waitingMs >= NATIVE_VERIFIER_CONFIRM_TAKEOVER_MS) {
          const portableNow = await readNativePortableChange(paths, name);
          const recorded = recordNativeVerifierExecutionError({
            state: portableNow,
            summary: `Verifier dispatch registered ${Math.round(waitingMs / 60_000)} minutes ago and never confirmed startup; doctor repair recorded the failure`,
          });
          const written = await compareAndSwapNativePortableState({
            file: nativePortableStateFile(paths, name),
            expectedStateVersion: portableNow.state_version,
            next: recorded,
            containedRoot: paths.nativeRoot,
          });
          return success('doctor', {
            healthy: true,
            workflow: 'native-portable',
            change: name,
            repaired: true,
            result: { verifierTakeover: true, waitedMinutes: Math.round(waitingMs / 60_000) },
            continuation: await portableContinuation(paths, written),
          });
        }
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
      // Repair legacy overlays that the pre-0.4.2 derivation left self-locked
      // (issue #439): demote ready children with unmet dependencies to pending
      // under the same mutation lock used by dispatch and integration.
      const supervisorDependencyRepair = await withNativeMutationLock(
        paths,
        `repair Native Supervisor dependencies ${name}`,
        async () => {
          const supervisorState = await readNativeSupervisorState(paths, name);
          const demoted =
            supervisorState?.children.filter(
              (child) =>
                child.status === 'ready' &&
                !supervisorDependenciesIntegrated(child.dependsOn, supervisorState.children),
            ) ?? [];
          if (demoted.length === 0 || !supervisorState) return [];
          for (const child of demoted) {
            child.status = 'pending';
            child.blocker = null;
          }
          await writeNativeSupervisorState(paths, supervisorState);
          return demoted.map(({ name: child }) => child);
        },
      );
      return success('doctor', {
        healthy: true,
        workflow: 'native-portable',
        change: name,
        repaired: true,
        ...(supervisorDependencyRepair.length > 0 ? { supervisorDependencyRepair } : {}),
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
    // Doctor must stay available when a persisted pre-upgrade overlay has
    // lost its children contract. Diagnostic reads preserve that evidence and
    // let the continuation explain how to restore children.yaml.
    const supervisorState = await readNativeSupervisorState(paths, name, {
      diagnostics: true,
    });
    const unmetReady =
      supervisorState &&
      supervisorState.children.filter(
        (child) =>
          child.status === 'ready' &&
          !supervisorDependenciesIntegrated(child.dependsOn, supervisorState.children),
      );
    if (supervisorState && unmetReady && unmetReady.length > 0) {
      const result = await inspectNativePortableStatus({ paths, name, details: true });
      return unhealthyDoctor({
        healthy: false,
        workflow: 'native-portable',
        change: name,
        repaired: false,
        result,
        findings: [unmetReadySupervisorDependencyFinding(name, supervisorState, unmetReady)],
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
    if (!(await listActiveChangeNames(paths)).includes(name)) {
      return unhealthyDoctor({
        healthy: false,
        change: name,
        repaired: false,
        findings: [
          {
            severity: 'error',
            code: 'change-not-found',
            message: `Native change ${name} was not found in active or archived records`,
          },
        ],
      });
    }
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
  const activeNames = await listActiveChangeNames(paths);
  const sdkNames = new Set<string>();
  const sdkResults: Array<Record<string, unknown>> = [];
  for (const change of activeNames) {
    try {
      const sdk = await readSdkChangeOwner(projectRoot, 'native', change);
      const managed =
        sdk !== null ||
        (await hasNativeManagedRunMarker(nativePortableStateFile(paths, change)).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return false;
            throw error;
          },
        ));
      if (!managed) continue;
      sdkNames.add(change);
      const result = await nativeDoctorCommand(
        [change, ...(repair ? ['--repair'] : [])],
        projectRoot,
      );
      sdkResults.push({ change, ...(result.data as Record<string, unknown>) });
    } catch (error) {
      sdkNames.add(change);
      sdkResults.push({
        change,
        healthy: false,
        repaired: false,
        findings: [
          {
            code: 'sdk-run-invalid',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      });
    }
  }
  const portableNames = (await listNativePortableChangeNames(paths)).filter(
    (change) => !sdkNames.has(change),
  );
  const projectPortableTransactions = portableTransactions;
  if (
    portableNames.length > 0 ||
    sdkResults.length > 0 ||
    finishJournals.length > 0 ||
    projectPortableTransactions.findings.length > 0 ||
    workspaceFinishJournalErrors.length > 0
  ) {
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
      const repairedWorkspaceFinishJournals: Array<{ change: string; quarantined: string | null }> =
        [];
      const repairedWorkspaceFinishes: string[] = [];
      for (const journal of finishJournals) {
        if (
          !(await isNativePortableChange(paths, journal.name)) &&
          (await workspaceFinishInspection(paths, journal, true)).repaired
        )
          repairedWorkspaceFinishes.push(journal.name);
      }
      for (const error of workspaceFinishJournalErrors) {
        repairedWorkspaceFinishJournals.push({
          change: error.name,
          quarantined: await quarantineNativeWorkspaceFinishJournal(paths, error.name),
        });
      }
      for (const transaction of projectPortableTransactions.transactions) {
        if (transaction.kind === 'archive') {
          const archived = await archiveNativePortableChange({ paths, name: transaction.change });
          const journal = await readNativeWorkspaceFinishJournal(paths, transaction.change);
          if (journal)
            await writeNativeWorkspaceFinishJournal(paths, {
              ...journal,
              archiveDir: archived.archiveDir,
              updatedAt: new Date().toISOString(),
            });
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
          repairedWorkspaceFinishJournals,
          repairedWorkspaceFinishes,
          repairedShapeConfirmations,
          repairFindings: projectRepair.findings,
        },
      };
    }
    const portableSet = new Set(portableNames);
    const migrationTransactionNames = new Set(
      projectPortableTransactions.transactions
        .filter((transaction) => transaction.kind === 'migration')
        .map(({ change }) => change),
    );
    const legacyNames = activeNames.filter(
      (change) => !portableSet.has(change) && !sdkNames.has(change),
    );
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
      ...sdkResults.flatMap((result) =>
        ((result.findings ?? []) as Array<{ code: string; message?: string }>).map((finding) => ({
          ...finding,
          severity: result.healthy ? ('info' as const) : ('error' as const),
          message: `${result.change}: ${finding.message ?? finding.code}`,
          path: nativePortableStateFile(paths, String(result.change)),
        })),
      ),
      ...(
        await Promise.all(
          finishJournals
            .filter((journal) => !portableSet.has(journal.name))
            .map((journal) => workspaceFinishInspection(paths, journal, false)),
        )
      ).flatMap((inspection) => inspection.findings),
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
      ...workspaceFinishJournalErrors.map((error) => workspaceFinishJournalFinding(paths, error)),
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
      workflow:
        legacyNames.length > 0 || (sdkResults.length > 0 && portableNames.length > 0)
          ? 'native-mixed'
          : sdkResults.length > 0
            ? 'native-sdk'
            : 'native-portable',
      changes: [...sdkResults, ...changes],
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
