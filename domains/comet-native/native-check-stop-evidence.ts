import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  inspectProcessLiveness,
  inspectProcessTreeLiveness,
  type ProcessLiveness,
} from '../../platform/process/process-identity.js';
import { atomicWriteJson } from './native-atomic-file.js';
import { canonicalHash } from './native-canonical-hash.js';
import { readNativeLocalExecution, writeNativeLocalExecution } from './native-local-execution.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { nativePreferredChangeRuntimeDir, resolveContainedNativePath } from './native-paths.js';
import { preservedLocalChecksForVersion } from './native-portable-checks.js';
import { recordNativeVerifierExecutionError } from './native-loop-runtime.js';
import {
  currentNativeVerifierAction,
  nativeVerifierActionExecutionRef,
  completeNativeVerifierAction,
} from './native-verifier-action.js';
import {
  nativeLocalExecutionFile,
  readNativePortableChange,
  writePortableMutation,
} from './native-portable-storage.js';
import type { NativeLocalExecutionState, NativePortableState } from './native-portable-types.js';
import type { NativeSupervisorState, NativeSupervisorTask } from './native-supervisor-model.js';
import {
  readNativeSupervisorState,
  writeNativeSupervisorState,
} from './native-supervisor-state.js';
import type { NativeProjectPaths } from './native-types.js';

type CheckStopKind =
  'portable-checks' | 'supervisor-child-checks' | 'supervisor-integration-checks';

export interface NativeCheckStopConfirmation {
  kind: CheckStopKind;
  operationId: string;
  executionHash: string;
  evidence: string;
}

export interface NativeCheckStopEvidenceTarget {
  kind: CheckStopKind;
  operationId: string;
  executionHash: string;
  child?: string;
  runId?: string;
  owner: ProcessLiveness;
  process: ProcessLiveness;
  processBoundary: 'supervisor-process' | 'process-group';
  canConfirm: boolean;
  confirmation: NativeCheckStopConfirmation;
}

interface StopTarget {
  kind: CheckStopKind;
  operationId: string;
  executionHash: string;
  snapshot: unknown;
  ownerPid?: number;
  ownerIdentity?: string;
  machineId?: string;
  processes: Array<null | undefined | { status: string; pid?: number; identity?: string }>;
  local?: NativeLocalExecutionState;
  supervisor?: NativeSupervisorState;
  task?: NativeSupervisorTask;
  child?: string;
  runId?: string;
}

async function stopTargets(paths: NativeProjectPaths, name: string): Promise<StopTarget[]> {
  return snapshotTargets(await recoverySnapshot(paths, name), paths.projectRoot);
}

function snapshotTargets(
  { portable, local, supervisor }: RecoverySnapshot,
  projectRoot: string,
): StopTarget[] {
  const targets: StopTarget[] = [];
  const add = (target: Omit<StopTarget, 'executionHash'>) => {
    targets.push({
      ...target,
      executionHash: canonicalHash('comet.native.check-stop-snapshot.v1', target.snapshot),
    });
  };
  if (
    local?.execution?.stage === 'checking' &&
    local.execution.actor === 'runtime' &&
    local.execution.status === 'running'
  ) {
    add({
      kind: 'portable-checks',
      operationId: local.execution.operationId,
      snapshot: { kind: 'portable-checks', projectRoot, portable, local },
      ownerPid: local.execution.ownerPid,
      ownerIdentity: local.execution.ownerIdentity,
      machineId: local.workspace.machineId,
      processes: local.checks
        .filter((check) => check.status === 'running' || check.activeProcess != null)
        .map((check) => check.activeProcess),
      local,
    });
  }
  if (supervisor) {
    for (const child of supervisor.children) {
      const task = child.task;
      const execution = task?.checkExecution;
      if (!task || execution?.status !== 'running') continue;
      add({
        kind: 'supervisor-child-checks',
        operationId: execution.operationId,
        snapshot: {
          kind: 'supervisor-child-checks',
          projectRoot,
          portable,
          supervisor,
          child: child.name,
          runId: task.runId,
        },
        ownerPid: execution.ownerPid,
        ownerIdentity: execution.ownerIdentity,
        machineId: execution.machineId,
        processes: [execution.activeProcess],
        supervisor,
        task,
        child: child.name,
        runId: task.runId,
      });
    }
    const integration = supervisor.integration.checkExecution;
    if (integration?.status === 'running') {
      add({
        kind: 'supervisor-integration-checks',
        operationId: integration.operationId,
        snapshot: {
          kind: 'supervisor-integration-checks',
          projectRoot,
          portable,
          supervisor,
        },
        ownerPid: integration.ownerPid,
        ownerIdentity: integration.ownerIdentity,
        machineId: integration.machineId,
        processes: [integration.activeProcess],
        supervisor,
        child: integration.child,
      });
    }
  }
  return targets;
}

async function inspectTarget(target: StopTarget): Promise<NativeCheckStopEvidenceTarget> {
  const sameMachine = target.machineId === os.hostname();
  const owner =
    sameMachine && target.ownerPid !== undefined
      ? await inspectProcessLiveness(target.ownerPid, target.ownerIdentity)
      : 'unknown';
  const processes = await Promise.all(
    target.processes.map((entry) =>
      sameMachine && entry?.status === 'running' && entry.pid !== undefined
        ? inspectProcessTreeLiveness(entry.pid, entry.identity)
        : Promise.resolve('unknown' as const),
    ),
  );
  const processState: ProcessLiveness = processes.includes('alive')
    ? 'alive'
    : processes.length === 0 || processes.includes('unknown')
      ? 'unknown'
      : 'dead';
  return {
    kind: target.kind,
    operationId: target.operationId,
    executionHash: target.executionHash,
    ...(target.child ? { child: target.child } : {}),
    ...(target.runId ? { runId: target.runId } : {}),
    owner,
    process: processState,
    processBoundary: process.platform === 'win32' ? 'supervisor-process' : 'process-group',
    canConfirm: owner === 'dead' && processState === 'dead',
    confirmation: {
      kind: target.kind,
      operationId: target.operationId,
      executionHash: target.executionHash,
      evidence: '<说明如何确认原检查及全部后代已经停止>',
    },
  };
}

/** 只读检查；模板中的占位符不是停止证据。 */
export async function inspectNativeCheckStopEvidenceTargets(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeCheckStopEvidenceTarget[]> {
  return Promise.all((await stopTargets(paths, name)).map(inspectTarget));
}

function parseConfirmations(value: unknown): NativeCheckStopConfirmation[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error('必须提供非空的原检查停止确认数组');
  const seen = new Set<string>();
  return value.map((entry: NativeCheckStopConfirmation) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Object.keys(entry).some(
        (key) => !['kind', 'operationId', 'executionHash', 'evidence'].includes(key),
      ) ||
      !['portable-checks', 'supervisor-child-checks', 'supervisor-integration-checks'].includes(
        entry.kind,
      ) ||
      typeof entry.operationId !== 'string' ||
      !entry.operationId.trim() ||
      typeof entry.executionHash !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(entry.executionHash) ||
      typeof entry.evidence !== 'string' ||
      !entry.evidence.trim() ||
      entry.evidence.length > 4096 ||
      /^<.*>$/su.test(entry.evidence.trim())
    ) {
      throw new Error(
        '停止确认必须绑定检查类型、operationId、完整executionHash，并提供实际停止证据',
      );
    }
    const key = `${entry.kind}:${entry.operationId}`;
    if (seen.has(key)) throw new Error('不能重复提交同一检查执行的停止确认');
    seen.add(key);
    return entry;
  });
}

interface RecoverySnapshot {
  portable: NativePortableState;
  local: NativeLocalExecutionState | null;
  supervisor: NativeSupervisorState | null;
}

interface StopReceipt {
  schema: 'comet.native.check-stop-evidence.v1';
  confirmationHash: string;
  recordedAt: string;
  confirmations: NativeCheckStopConfirmation[];
  snapshots: Array<Pick<StopTarget, 'kind' | 'operationId' | 'executionHash' | 'snapshot'>>;
  before: RecoverySnapshot;
  after: RecoverySnapshot;
  recoveryHash: string;
  applied?: boolean;
}

async function recoverySnapshot(
  paths: NativeProjectPaths,
  name: string,
): Promise<RecoverySnapshot> {
  return {
    portable: await readNativePortableChange(paths, name),
    local: await readNativeLocalExecution(nativeLocalExecutionFile(paths, name)),
    supervisor: await readNativeSupervisorState(paths, name, { diagnostics: true }),
  };
}

function snapshotHash(value: unknown): string {
  return canonicalHash('comet.native.check-stop-recovery.v1', value);
}

function prepareRecovery(
  before: RecoverySnapshot,
  selected: StopTarget[],
  receiptRef: string,
  projectRoot: string,
  recordedAt: string,
): RecoverySnapshot {
  const after = structuredClone(before);
  let supervisorChanged = false;
  for (const target of selected) {
    if (target.kind === 'portable-checks') {
      const local = after.local!;
      local.execution!.status = 'interrupted';
      for (const check of local.checks) {
        if (check.status === 'planned' || check.status === 'running') check.status = 'interrupted';
        check.activeProcess = null;
      }
      if (
        after.portable.phase === 'verify' &&
        after.portable.loop.next_action === 'await-verifier-result'
      ) {
        const summary = `人工确认原追加检查及全部后代已停止；保留已完成检查，停止证据：${receiptRef}`;
        const next = recordNativeVerifierExecutionError({
          state: after.portable,
          summary,
          now: new Date(recordedAt),
        });
        if (after.portable.verifier_action) {
          const action = currentNativeVerifierAction(after.portable, local);
          const executionRef = nativeVerifierActionExecutionRef(action);
          if (executionRef)
            next.verifier_action = completeNativeVerifierAction({
              action,
              executionRef,
              response: { kind: 'execution-error', summary },
              status: 'failed',
            }).action;
        }
        after.portable = next;
        after.local = preservedLocalChecksForVersion({ local, state: next, projectRoot });
      }
    } else {
      const task =
        target.kind === 'supervisor-child-checks'
          ? after.supervisor!.children.find(({ name }) => name === target.child)!.task!
          : null;
      const execution = task?.checkExecution ?? after.supervisor!.integration.checkExecution!;
      execution.status = 'interrupted';
      execution.activeProcess = null;
      for (const check of execution.checkStates ?? []) {
        if (check.status === 'planned' || check.status === 'running') check.status = 'interrupted';
      }
      if (task) task.checksReason = 'not-run';
      supervisorChanged = true;
    }
  }
  if (supervisorChanged) after.supervisor!.stateVersion += 1;
  return after;
}

/** 先保存精确 before/after 快照和人工事实；中断恢复只补写缺失步骤，不重复计数。 */
export async function recoverNativeChecksWithStopEvidence(options: {
  paths: NativeProjectPaths;
  name: string;
  confirmations: unknown;
}): Promise<{
  kinds: CheckStopKind[];
  operationIds: string[];
  receiptRef: string;
  alreadyApplied: boolean;
}> {
  const confirmations = parseConfirmations(options.confirmations);
  return withNativeMutationLock(
    options.paths,
    `confirm stopped checks ${options.name}`,
    async () => {
      const confirmationHash = canonicalHash('comet.native.check-stop-confirmations.v1', {
        projectRoot: options.paths.projectRoot,
        name: options.name,
        confirmations,
      });
      const receiptRef = `evidence/check-stops/${confirmationHash}.json`;
      const runtimeDir = nativePreferredChangeRuntimeDir(options.paths, options.name);
      const receiptFile = await resolveContainedNativePath(
        runtimeDir,
        path.join(runtimeDir, receiptRef),
      );
      const previousReceipt = await fs
        .readFile(receiptFile, 'utf8')
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
      let receipt: StopReceipt;
      if (previousReceipt !== null) {
        receipt = JSON.parse(previousReceipt) as StopReceipt;
        if (
          receipt.schema !== 'comet.native.check-stop-evidence.v1' ||
          receipt.confirmationHash !== confirmationHash ||
          snapshotHash(receipt.confirmations) !== snapshotHash(confirmations) ||
          !Array.isArray(receipt.snapshots) ||
          receipt.snapshots.length !== confirmations.length ||
          receipt.snapshots.some(
            (entry, index) =>
              entry.kind !== confirmations[index].kind ||
              entry.operationId !== confirmations[index].operationId ||
              entry.executionHash !== confirmations[index].executionHash ||
              canonicalHash('comet.native.check-stop-snapshot.v1', entry.snapshot) !==
                entry.executionHash,
          ) ||
          !receipt.before ||
          !receipt.after ||
          typeof receipt.recordedAt !== 'string' ||
          !Number.isFinite(Date.parse(receipt.recordedAt)) ||
          receipt.recoveryHash !== snapshotHash({ before: receipt.before, after: receipt.after })
        )
          throw new Error('已有停止证据记录损坏或不匹配；保留原记录并检查');
        const originalTargets = snapshotTargets(receipt.before, options.paths.projectRoot);
        const selected = confirmations.map((confirmation) => {
          const target = originalTargets.find(
            (entry) =>
              entry.kind === confirmation.kind && entry.operationId === confirmation.operationId,
          );
          if (!target || target.executionHash !== confirmation.executionHash)
            throw new Error('停止证据原始快照与确认身份不匹配；保留原记录并检查');
          return target;
        });
        const expected = prepareRecovery(
          receipt.before,
          selected,
          receiptRef,
          options.paths.projectRoot,
          receipt.recordedAt,
        );
        if (snapshotHash(expected) !== snapshotHash(receipt.after))
          throw new Error('停止证据包含不合法的恢复结果；不能覆盖原执行');
      } else {
        const targets = await stopTargets(options.paths, options.name);
        const selected = confirmations.map((confirmation) => {
          const target = targets.find(
            (entry) =>
              entry.kind === confirmation.kind && entry.operationId === confirmation.operationId,
          );
          if (!target || target.executionHash !== confirmation.executionHash) {
            throw new Error(
              '原检查执行快照已变化或停止确认指向其他执行；请重新检查，不能沿用旧证据',
            );
          }
          return target;
        });
        for (const target of selected) {
          if (!(await inspectTarget(target)).canConfirm) {
            throw new Error(
              '原执行owner或检查进程尚未确认退出，或缺少同机PID登记；不能接受人工停止确认',
            );
          }
        }
        const current = await stopTargets(options.paths, options.name);
        if (
          selected.some(
            (target) =>
              !current.some(
                (entry) =>
                  entry.kind === target.kind &&
                  entry.operationId === target.operationId &&
                  entry.executionHash === target.executionHash,
              ),
          )
        )
          throw new Error('探测期间原检查执行快照已变化；请重新检查，不能沿用旧证据');
        const before = await recoverySnapshot(options.paths, options.name);
        const recordedAt = new Date().toISOString();
        const after = prepareRecovery(
          before,
          selected,
          receiptRef,
          options.paths.projectRoot,
          recordedAt,
        );
        receipt = structuredClone({
          schema: 'comet.native.check-stop-evidence.v1',
          confirmationHash,
          recordedAt,
          confirmations,
          snapshots: selected.map(({ kind, operationId, executionHash, snapshot }) => ({
            kind,
            operationId,
            executionHash,
            snapshot,
          })),
          before,
          after,
          recoveryHash: snapshotHash({ before, after }),
        });
        await atomicWriteJson(receiptFile, receipt, {
          containedRoot: options.paths.changesRuntimeDir,
          exclusive: true,
        });
      }
      const current = await recoverySnapshot(options.paths, options.name);
      const keys = ['portable', 'local', 'supervisor'] as const;
      for (const key of keys) {
        const hash = snapshotHash(current[key]);
        if (
          hash !== snapshotHash(receipt.before[key]) &&
          hash !== snapshotHash(receipt.after[key])
        ) {
          throw new Error('停止证据对应的执行状态已变化；不能将旧证明应用到新的执行');
        }
      }
      const alreadyApplied = keys.every(
        (key) => snapshotHash(current[key]) === snapshotHash(receipt.after[key]),
      );
      if (receipt.applied && !alreadyApplied)
        throw new Error('已应用停止证据对应的执行状态已变化；不能重新应用旧证明');
      if (previousReceipt !== null && !alreadyApplied) {
        const originals = snapshotTargets(receipt.before, options.paths.projectRoot);
        for (const confirmation of confirmations) {
          const target = originals.find(
            (entry) =>
              entry.kind === confirmation.kind && entry.operationId === confirmation.operationId,
          )!;
          if (!(await inspectTarget(target)).canConfirm)
            throw new Error('原执行owner或检查进程尚未确认退出；保留停止证据但不能继续恢复');
        }
      }
      if (snapshotHash(current.portable) !== snapshotHash(receipt.after.portable)) {
        await writePortableMutation({
          paths: options.paths,
          previous: current.portable,
          next: receipt.after.portable,
        });
      }
      if (snapshotHash(current.local) !== snapshotHash(receipt.after.local)) {
        if (!receipt.after.local) throw new Error('停止证据缺少预期本地执行记录');
        await writeNativeLocalExecution(
          nativeLocalExecutionFile(options.paths, options.name),
          receipt.after.local,
          {
            containedRoot: options.paths.runtimeDir,
          },
        );
      }
      if (snapshotHash(current.supervisor) !== snapshotHash(receipt.after.supervisor)) {
        if (!receipt.after.supervisor) throw new Error('停止证据缺少预期Supervisor执行记录');
        await writeNativeSupervisorState(options.paths, receipt.after.supervisor);
      }
      if (!receipt.applied)
        await atomicWriteJson(
          receiptFile,
          { ...receipt, applied: true },
          {
            containedRoot: options.paths.changesRuntimeDir,
          },
        );
      return {
        kinds: confirmations.map(({ kind }) => kind),
        operationIds: confirmations.map(({ operationId }) => operationId),
        receiptRef,
        alreadyApplied,
      };
    },
  );
}
