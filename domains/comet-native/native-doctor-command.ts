import {
  inspectNativeChildren,
  readNativeChildrenContract,
  nativeChildrenAcceptanceValidation,
} from './native-children.js';
import {
  readNativeSupervisorState,
  writeNativeSupervisorState,
  assertNoActiveNativeSupervisorTasks,
} from './native-supervisor-state.js';
import { reconcileNativeSupervisorState } from './native-supervisor-model.js';
import { lateBindPortableCurrentWorkspace } from './native-portable-storage.js';
import { listNativeSdkHistoryNames } from './native-sdk-history-discovery.js';
import {
  readSdkChangeOwner,
  recoverSdkChangeOwnerToActive,
  listSdkChangeOwnerRecoveryNames,
} from '../workflow-contract/change-runtime-owner.js';
import {
  assertNoArguments,
  doctorPaths,
  NativeUsageError,
  success,
  takeFlag,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';
import {
  inspectNativeSdkRun,
  resolveNativeChangeRuntimeOwner,
} from './native-runtime-ownership.js';
import { projectNativeSdkStatus } from './native-sdk-status.js';
import { settleNativeSdkCancellation } from './native-sdk-cancellation-cleanup.js';
import { settleNativeSdkCompletion } from './native-sdk-completion-cleanup.js';
import { closeNativeSdkHistory } from './native-sdk-history.js';
import {
  isNativePortableChange,
  readNativePortableChange,
  nativePortableStateFile,
} from './native-portable-storage.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import { nativePortableStateSummary } from './native-portable-summary.js';
import { migrateNativeLegacyChangeToPortable } from './native-portable-migration-runtime.js';
import { recoverNativeRootMove } from './native-root-move.js';
import { readProjectConfig } from './native-config.js';
import { recoverArchiveTransaction } from './native-archive.js';
import { promises as fs } from 'node:fs';
import { readNativeTransaction } from './native-transaction.js';
import {
  describeNativePortableTransactionEntry,
  readNativePortableTransactionEntry,
  isNativePortableTransactionUnfinished,
} from './native-portable-transactions.js';
import {
  listNativeWorkspaceFinishJournals,
  inspectNativeWorkspaceFinishCompletion,
  clearNativeWorkspaceFinishJournal,
} from './native-workspace-finish.js';
import { inspectNativeChangeStateDocument } from './native-change.js';
import {
  inspectNativeTrajectoryTail,
  repairNativeTrajectoryTail,
} from './native-trajectory-recovery.js';
import { inspectPendingNativeTransitionSchema } from './native-transition-journal.js';
import type { NativeProjectPaths } from './native-types.js';
import { listNativeArchivedStatusRecords } from './native-archived-status.js';
import { hasNativeManagedRunMarker } from './native-sdk-state-store.js';
import path from 'node:path';
import { createFileRuntimeStore, type WorkflowRun } from '../engine/runtime.js';
import { resolveWorkspaceRuntimeRootSync } from '../workflow-contract/workspace-runtime.js';

/** 显式 Doctor 只观察当前工作区的实际提交事务，不搜索其他 worktree。 */
async function pendingTransactions(paths: NativeProjectPaths, name?: string) {
  const entries = await fs
    .readdir(paths.transactionsDir, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
  const pending: Array<{
    id: string;
    change?: string;
    kind: string;
    status: string;
    recoveryCommandArgs?: string[];
    message?: string;
  }> = [];
  for (const entry of entries) {
    const portable = describeNativePortableTransactionEntry(entry.name);
    if (!entry.isDirectory() && !portable) continue;
    try {
      if (entry.isSymbolicLink()) throw new Error('事务路径不能是符号链接');
      const transaction = portable
        ? await readNativePortableTransactionEntry(paths, entry.name)
        : null;
      const journal = transaction?.journal ?? (await readNativeTransaction(paths, entry.name));
      if (name && journal.change !== name) continue;
      if (
        transaction
          ? !isNativePortableTransactionUnfinished(transaction)
          : ['committed', 'rolled-back'].includes(journal.status)
      )
        continue;
      const sdkArchive =
        portable?.kind === 'archive' &&
        (await readSdkChangeOwner(paths.projectRoot, 'native', portable.change, {
          readOnly: true,
        }));
      pending.push({
        id: journal.id,
        change: journal.change,
        kind: transaction?.kind ?? ('kind' in journal ? journal.kind : 'transaction'),
        status: journal.status,
        recoveryCommandArgs: portable
          ? [
              'comet',
              'native',
              portable.kind === 'archive' ? 'archive' : 'doctor',
              portable.change,
              ...(portable.kind === 'archive'
                ? [sdkArchive ? '--recover' : '--confirmed']
                : ['--repair']),
            ]
          : [
              'comet',
              'native',
              'doctor',
              '--transaction',
              journal.id,
              '--repair',
              '--strategy',
              '<continue|rollback>',
            ],
      });
    } catch (error) {
      pending.push({
        id: entry.name,
        kind: portable?.kind ?? 'transaction',
        status: 'invalid',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return pending;
}
/** 只诊断业务记录、实际事务和写锁；普通执行不恢复进程或要求停止回执。 */
export async function nativeDoctorCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const repair = takeFlag(args, '--repair'),
    migrateHistory = takeFlag(args, '--migrate-history'),
    legacyStopFile = takeOption(args, '--stopped-actions'),
    strategy = takeOption(args, '--strategy');
  const transaction = takeOption(args, '--transaction');
  takeFlag(args, '--confirmed');
  const name = args[0]?.startsWith('--') ? undefined : args.shift();
  assertNoArguments(args);
  if (migrateHistory && (repair || legacyStopFile || strategy || transaction))
    throw new NativeUsageError('--migrate-history cannot combine with other mutation flags');
  if (strategy !== undefined && !['continue', 'rollback'].includes(strategy))
    throw new NativeUsageError('--strategy must be continue or rollback');
  if (strategy && !repair) throw new NativeUsageError('--strategy requires --repair');
  const paths = await doctorPaths(projectRoot);
  if (transaction) {
    if (!repair || !strategy)
      throw new NativeUsageError('--transaction requires --repair --strategy <continue|rollback>');
    const result = await recoverArchiveTransaction({
      paths,
      transactionId: transaction,
      strategy: strategy as 'continue' | 'rollback',
    });
    return success('doctor', { transaction: result });
  }
  let repaired = false;
  if (repair && strategy) {
    await recoverNativeRootMove({
      projectRoot,
      strategy: strategy as 'continue' | 'rollback',
    });
    repaired = true;
  }
  if (migrateHistory) {
    const names = name ? [name] : await listSdkChangeOwnerRecoveryNames(projectRoot, 'native');
    const migrated: string[] = [],
      active: string[] = [],
      findings: Array<{ change: string; code: string; message: string }> = [];
    for (const change of names) {
      try {
        let inspection: Awaited<ReturnType<typeof inspectNativeSdkRun>>;
        try {
          inspection = await inspectNativeSdkRun(projectRoot, change);
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.message.startsWith('Conflicting active and history Runtime owners for ')
          )
            throw error;
          await recoverSdkChangeOwnerToActive(projectRoot, 'native', change);
          inspection = await inspectNativeSdkRun(projectRoot, change);
        }
        if (['completed', 'cancelled'].includes(inspection.run.status)) {
          if (
            await closeNativeSdkHistory({
              projectRoot,
              run: inspection.run,
              recover: true,
            })
          )
            migrated.push(change);
          else
            findings.push({
              change,
              code: 'native-history-closure-pending',
              message:
                'Native history closure remains pending; inspect the original Run and complete its business cleanup.',
            });
        } else active.push(change);
      } catch (error) {
        findings.push({
          change,
          code: 'native-history-migration-failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      ...success('doctor', {
        healthy: findings.length === 0,
        migrated,
        active,
        ...(findings.length ? { findings } : {}),
      }),
      exitCode: findings.length ? 65 : 0,
    };
  }
  const pendingMove = (await readProjectConfig(projectRoot))?.native.pending_root_move;
  let transactions = await pendingTransactions(paths, name);
  if (repair) {
    for (const pending of transactions) {
      if (pending.kind !== 'migration' || pending.status === 'invalid' || !pending.change) continue;
      await migrateNativeLegacyChangeToPortable({
        paths,
        name: pending.change,
      });
      repaired = true;
    }
    if (repaired) transactions = await pendingTransactions(paths, name);
  }
  const finishJournals = (await listNativeWorkspaceFinishJournals(paths)).filter(
    (journal) => !name || journal.name === name,
  );
  const workspaceFinishes = [];
  for (const journal of finishJournals) {
    const completed = journal.archiveDir
      ? await inspectNativeWorkspaceFinishCompletion(paths, journal)
      : false;
    if (repair && completed) {
      await clearNativeWorkspaceFinishJournal(paths, journal.name);
      repaired = true;
    } else
      workspaceFinishes.push({
        change: journal.name,
        status: journal.status,
        completed,
        archiveDir: journal.archiveDir,
        recoveryCommandArgs: ['comet', 'native', 'archive', journal.name, '--confirmed'],
      });
  }
  const businessRecovery = { transactions, workspaceFinishes };
  if (!name) {
    const entries = await fs
      .readdir(paths.changesDir, { withFileTypes: true })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
    const changes = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      try {
        if (await isNativePortableChange(paths, entry.name)) {
          const state = await readNativePortableChange(paths, entry.name);
          changes.push({
            name: entry.name,
            schema: state.schema,
            status: 'current',
            phase: state.phase,
          });
          continue;
        }
        const inspection = await inspectNativeChangeStateDocument(paths, entry.name);
        changes.push({
          name: entry.name,
          schema: inspection.schema,
          status: inspection.status,
          phase: inspection.state?.phase,
          ...(inspection.schema === 'comet.native.v4'
            ? {}
            : {
                recoveryCommandArgs: ['comet', 'native', 'doctor', entry.name, '--repair'],
              }),
        });
      } catch (error) {
        changes.push({
          name: entry.name,
          schema: null,
          status: 'invalid',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const historyFindings: Array<{
      change: string;
      code: string;
      message: string;
    }> = [];
    for (const change of await listNativeSdkHistoryNames(projectRoot)) {
      try {
        await inspectNativeSdkRun(projectRoot, change, { readOnly: true });
      } catch (error) {
        historyFindings.push({
          change,
          code: 'native-history-invalid',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      ...success('doctor', {
        ...businessRecovery,
        changes,
        healthy:
          changes.every(
            (change) => change.schema === 'comet.native.v4' && change.status === 'current',
          ) &&
          !transactions.length &&
          !workspaceFinishes.length &&
          !pendingMove &&
          !historyFindings.length,
        ...(historyFindings.length ? { findings: historyFindings } : {}),
        repaired,
        pendingRootMove: pendingMove ?? null,
        ...(pendingMove
          ? {
              recoveryCommand: 'comet native doctor --repair --strategy <continue|rollback> --json',
            }
          : {}),
      }),
      exitCode: historyFindings.length ? 65 : 0,
    };
  }
  let owner = await readSdkChangeOwner(projectRoot, 'native', name);
  const missingSdkRun = () =>
    success('doctor', {
      healthy: false,
      repaired: false,
      runtimeFormat: 'sdk',
      change: name,
      recovery: {
        code: 'runtime-recovery-required',
        reason:
          'Original SDK Run needs checkpoint recovery; preserve its portable approval and claims.',
        commandArgs: ['comet', 'native', 'doctor', name, '--repair', '--confirmed'],
      },
    });
  if (!owner && !repair) {
    try {
      if (await hasNativeManagedRunMarker(nativePortableStateFile(paths, name)))
        return missingSdkRun();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  if (!owner && (transactions.length || finishJournals.length))
    return success('doctor', {
      ...businessRecovery,
      change: name,
      healthy: !transactions.length && !workspaceFinishes.length,
      repaired,
    });
  if (!owner && repair) {
    await resolveNativeChangeRuntimeOwner(paths, name);
    owner = await readSdkChangeOwner(projectRoot, 'native', name);
    if (owner) repaired = true;
  }
  if (owner) {
    const missingRun =
      owner.application === 'native' &&
      !(await createFileRuntimeStore<WorkflowRun>({
        singleWriter: true,
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs/native'),
      }).read(owner.runId));
    if (missingRun && !repair) return missingSdkRun();
    const inspection = await inspectNativeSdkRun(projectRoot, name, {
      readOnly: !repair,
    });
    if (missingRun) repaired = true;
    if (repair) {
      if (inspection.run.status === 'cancelled')
        await settleNativeSdkCancellation({ projectRoot, run: inspection.run });
      else if (inspection.run.status === 'completed')
        await settleNativeSdkCompletion({ projectRoot, run: inspection.run });
    }
    const projected = await projectNativeSdkStatus({ projectRoot, name }, inspection);
    return {
      ...success('doctor', {
        ...projected,
        ...businessRecovery,
        healthy: projected.diagnostics.healthy && !transactions.length && !workspaceFinishes.length,
        repaired,
        ...(legacyStopFile
          ? {
              notice: '旧进程停止回执不再用于推进；请在 Agent 平台核对原任务和实际副作用。',
            }
          : {}),
      }),
      exitCode: 0,
    };
  }
  if (!(await isNativePortableChange(paths, name))) {
    let legacy;
    try {
      const inspection = await inspectNativeChangeStateDocument(paths, name);
      if (!inspection.state)
        throw new Error(inspection.message ?? `Native change ${name} is unreadable`);
      legacy = inspection.state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const archived = (await listNativeArchivedStatusRecords(paths, undefined, name)).filter(
        (record) => record.state.name === name,
      );
      if (!archived.length) throw error;
      if (archived.length !== 1)
        throw new Error('同名 Native 归档不唯一，请核对原归档路径；诊断不会选择或迁移其中一个。', {
          cause: error,
        });
      if (await hasNativeManagedRunMarker(archived[0].file)) return missingSdkRun();
      return success('doctor', {
        healthy: true,
        repaired,
        runtimeFormat: 'compat',
        change: name,
        state: nativePortableStateSummary(archived[0].state, paths),
      });
    }
    const findings = [];
    if (legacy.run_id || (await inspectPendingNativeTransitionSchema(paths, name))) {
      const tail = await inspectNativeTrajectoryTail(paths, name);
      if (repair && tail.status === 'repairable') {
        await repairNativeTrajectoryTail(paths, name);
      } else if (tail.status !== 'clean')
        findings.push({
          code: 'trajectory-invalid',
          severity: 'error',
          path: tail.file,
          message:
            tail.status === 'invalid'
              ? tail.message
              : `Native Run trajectory has a repairable ${tail.reason} tail; run doctor --repair`,
        });
    }
    if (!repair || findings.length)
      return success('doctor', {
        healthy: false,
        repaired: false,
        runtimeFormat: 'compat',
        state: legacy,
        findings,
        recoveryCommandArgs: ['comet', 'native', 'doctor', name, '--repair'],
        instruction: '旧业务文档需要显式导入；只读诊断不写入材料或启动执行。',
      });
    await migrateNativeLegacyChangeToPortable({ paths, name });
    repaired = true;
  }
  const state = await readNativePortableChange(paths, name);
  const findings: Array<{ code: string; message: string }> = [];
  let supervisor = await readNativeSupervisorState(paths, name, {
    diagnostics: true,
  });
  let contract = state.children_contract;
  if (!contract) {
    try {
      contract = (
        await readNativeChildrenContract({
          changeDir: path.join(paths.changesDir, name),
          policy: 'advisory',
          validation: nativeChildrenAcceptanceValidation(state),
          ...(state.acceptance.length ? { acceptanceIds: state.acceptance.map((a) => a.id) } : {}),
        })
      )?.contract;
    } catch (error) {
      findings.push({
        code: 'portable-supervisor-contract-unavailable',
        message: 'restore children.yaml and retry next: ' + (error as Error).message,
      });
    }
  }
  if (supervisor && !contract && !findings.length)
    findings.push({
      code: 'portable-supervisor-contract-unavailable',
      message: 'restore children.yaml and retry next; confirmed Child scope is missing',
    });
  const supervisorDependencyRepair =
    supervisor?.children
      .filter(
        (child) =>
          child.status === 'ready' &&
          child.dependsOn.some(
            (dep) =>
              !supervisor!.children.some(
                (c) => c.name === dep && ['integrated', 'archived'].includes(c.status),
              ),
          ),
      )
      .map((c) => c.name) ?? [];
  if (supervisorDependencyRepair.length && supervisor && contract) {
    if (repair) {
      supervisor = reconcileNativeSupervisorState({
        state: supervisor,
        contract,
      });
      await writeNativeSupervisorState(paths, supervisor);
      repaired = true;
    } else
      findings.push({
        code: 'portable-supervisor-ready-dependencies-unmet',
        message:
          'Confirmed Child dependencies are not integrated; run doctor ' + name + ' --repair',
      });
  }
  if (contract && state.workspace.change_branch === null) {
    try {
      await assertNoActiveNativeSupervisorTasks(paths, name);
      const binding = lateBindPortableCurrentWorkspace(state.workspace, projectRoot);
      findings.push({
        code: 'portable-supervisor-git-binding-missing',
        message: binding
          ? 'Confirm Shape to bind the Supervisor to ' + binding.change_branch
          : 'Initialize Git and confirm the Supervisor Shape on a clean branch',
      });
    } catch (error) {
      findings.push({
        code: 'portable-supervisor-git-binding-missing',
        message: (error as Error).message,
      });
    }
  }
  const children =
    supervisor || contract?.schema === 'comet.native.children.v1'
      ? await inspectNativeChildren({ paths, state })
      : null;
  return {
    ...success('doctor', {
      healthy: findings.length === 0,
      repaired,
      ...(findings.length ? { findings } : {}),
      ...(repair && supervisorDependencyRepair.length ? { supervisorDependencyRepair } : {}),
      runtimeFormat: 'compat',
      state: nativePortableStateSummary(state, paths),
      continuation: nativePortableContinuation(state, children),
      instruction:
        '旧业务进度和批准继续保留；普通检查与任务由 Agent 平台执行，Comet 不恢复旧进程。',
    }),
    exitCode: findings.length ? 65 : 0,
  };
}
