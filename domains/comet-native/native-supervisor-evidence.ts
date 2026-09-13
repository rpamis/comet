import { nativeWorkspaceIsClean } from './native-workspace-config.js';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { runGitCommand } from '../../platform/process/git.js';
import {
  processInstanceMayBeAlive,
  readProcessIdentity,
} from '../../platform/process/process-identity.js';
import { canonicalHash } from './native-canonical-hash.js';
import {
  executeNativeCheck,
  preflightNativeCheckPlans,
  type NativeCheckPlan,
  type NativeExecutedCheck,
} from './native-check-executor.js';
import {
  nativeSupervisorCheckInputFingerprint,
  nativeSupervisorCheckMachineId,
  completedNativeSupervisorCheckState,
  nativeSupervisorExecutedCheckFromState,
  plannedNativeSupervisorCheckState,
} from './native-supervisor-check-binding.js';
import {
  readNativeVerificationReportSnapshot,
  writeNativeVerificationReportSnapshot,
} from './native-evidence-storage.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { nativePreferredChangeRuntimeDir, resolveContainedNativePath } from './native-paths.js';
import { redactNativeCredentialText } from './native-redaction.js';
import {
  readNativeSupervisorState,
  writeNativeSupervisorState,
} from './native-supervisor-state.js';
import type {
  NativeSupervisorCheckExecutionState,
  NativeSupervisorTask,
} from './native-supervisor.js';
import type { NativeProjectPaths } from './native-types.js';

export interface NativeSupervisorMaterial {
  name: string;
  content: string;
}
interface SupervisorCheckRecord {
  schema: 'comet.native.supervisor-checks.v1';
  parent: string;
  child: string;
  runId: string;
  candidateCommit: string;
  contractHash: string | null;
  operationId: string;
  planHash: string;
  machineId: string;
  inputFingerprint: string;
  checks: Array<NativeExecutedCheck & { logContent: string; logDigest: string }>;
  materials: Array<NativeSupervisorMaterial & { hash: string }>;
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function assertCandidate(parent: string, task: NativeSupervisorTask): void {
  if (
    runGitCommand(task.projectRoot, ['branch', '--show-current']) !==
      `comet/supervisor/${parent}/${task.child}` ||
    runGitCommand(task.projectRoot, ['rev-parse', 'HEAD']) !== task.baseCommit ||
    !nativeWorkspaceIsClean(task.projectRoot)
  ) {
    throw new Error(
      'Native Supervisor checks require the clean current candidate in its bound worktree',
    );
  }
}

function currentTask(
  state: Awaited<ReturnType<typeof readNativeSupervisorState>>,
  child: string,
  runId: string,
) {
  const task = state?.children.find((entry) => entry.name === child)?.task;
  if (!task || task.role !== 'verifier' || task.runId !== runId)
    throw new Error('Native Supervisor check runId is not current');
  return task;
}

async function supervisorCheckRecords(
  runtimeDir: string,
  states: readonly NativeSupervisorCheckExecutionState[],
): Promise<SupervisorCheckRecord['checks']> {
  return Promise.all(
    states.map(async (state) => {
      const result = nativeSupervisorExecutedCheckFromState(state);
      const logFile = await resolveContainedNativePath(
        runtimeDir,
        path.resolve(runtimeDir, ...result.logRef.split(/[\\/]/u)),
      );
      const log = await fs.readFile(logFile, 'utf8');
      const redacted = redactNativeCredentialText(log);
      return {
        ...result,
        logContent: redacted.slice(0, 128 * 1024),
        logDigest: hashText(redacted),
      };
    }),
  );
}

function supervisorCheckRecordMatchesState(
  record: SupervisorCheckRecord['checks'][number],
  state: NativeSupervisorCheckExecutionState,
): boolean {
  return (
    typeof record.logContent === 'string' &&
    typeof record.logDigest === 'string' &&
    record.logDigest.length > 0 &&
    state.status === record.status &&
    state.id === record.id &&
    state.name === record.name &&
    JSON.stringify(state.argvDisplay) === JSON.stringify(record.argvDisplay) &&
    state.cwdRef === record.cwdRef &&
    state.exitCode === record.exitCode &&
    state.signal === record.signal &&
    state.timedOut === record.timedOut &&
    state.durationMs === record.durationMs &&
    state.startedAt === record.startedAt &&
    state.completedAt === record.completedAt &&
    state.repeatable === record.repeatable &&
    state.logRef === record.logRef
  );
}

async function supervisorCheckLogsMatchCurrentFiles(options: {
  paths: NativeProjectPaths;
  parent: string;
  checks: SupervisorCheckRecord['checks'];
}): Promise<boolean> {
  try {
    const runtimeDir = nativePreferredChangeRuntimeDir(options.paths, options.parent);
    const matches = await Promise.all(
      options.checks.map(async (check) => {
        if (typeof check.logContent !== 'string' || typeof check.logDigest !== 'string') {
          return false;
        }
        const logFile = await resolveContainedNativePath(
          runtimeDir,
          path.resolve(runtimeDir, ...check.logRef.split(/[\\/]/u)),
        );
        const redacted = redactNativeCredentialText(await fs.readFile(logFile, 'utf8'));
        return (
          hashText(redacted) === check.logDigest &&
          redacted.slice(0, 128 * 1024) === check.logContent
        );
      }),
    );
    return matches.every(Boolean);
  } catch {
    return false;
  }
}

function retryIds(value: readonly string[] | undefined): Set<string> | null {
  if (value === undefined) return null;
  const result = new Set(value);
  if (result.size === 0 || result.size !== value.length) {
    throw new Error('Native Supervisor retry IDs must be non-empty and unique');
  }
  return result;
}

function assertSupervisorRetryableStates(
  states: readonly NativeSupervisorCheckExecutionState[] | undefined,
  plans: readonly NativeCheckPlan[],
  requested: ReadonlySet<string>,
): void {
  if (!states) {
    throw new Error('Native Supervisor check retry requires per-check Runtime state');
  }
  const plansById = new Map(plans.map((plan) => [plan.id, plan]));
  for (const id of requested) {
    const state = states.find((entry) => entry.id === id);
    const plan = plansById.get(id);
    if (!state || !plan || state.status !== 'interrupted') {
      throw new Error(`Native Supervisor retry ID is not an interrupted current check: ${id}`);
    }
    if (!state.repeatable || !plan.repeatable) {
      throw new Error(`Native Supervisor check ${id} is not repeatable and cannot be retried`);
    }
    if (state.executionCount >= 3) {
      throw new Error(`Native Supervisor check retry limit (3) reached: ${id}`);
    }
  }
}

/** The parent evidence space is authoritative even when checks run in a child worktree. */
export async function executeNativeSupervisorChecks(options: {
  paths: NativeProjectPaths;
  parent: string;
  child: string;
  runId: string;
  plans: NativeCheckPlan[];
  materials: NativeSupervisorMaterial[];
  retryCheckIds?: readonly string[];
}): Promise<{
  status: 'running' | 'completed' | 'interrupted';
  operationId: string;
  receiptRef?: string;
}> {
  if (
    options.plans.length === 0 ||
    new Set(options.plans.map(({ id }) => id)).size !== options.plans.length
  )
    throw new Error('Native Supervisor checks require a non-empty plan with unique IDs');
  if (options.plans.some(({ repeatable }) => !repeatable))
    throw new Error('Native Supervisor checks must be repeatable for safe recovery');
  if (
    options.materials.some(
      ({ name, content }) => !name.trim() || Buffer.byteLength(content) > 1024 * 1024,
    )
  )
    throw new Error('Native Supervisor external material name or size is invalid');
  const requestedRetryIds = retryIds(options.retryCheckIds);
  const reservation = await withNativeMutationLock(
    options.paths,
    'reserve Supervisor checks',
    async () => {
      const state = await readNativeSupervisorState(options.paths, options.parent);
      const task = currentTask(state, options.child, options.runId);
      assertCandidate(options.parent, task);
      // Complete the executable, cwd and platform-argument preflight before
      // reserving the durable Supervisor check lease.
      preflightNativeCheckPlans(task.projectRoot, options.plans);
      const machineId = nativeSupervisorCheckMachineId();
      const inputFingerprint = await nativeSupervisorCheckInputFingerprint({
        kind: 'child',
        parent: options.parent,
        child: options.child,
        runId: options.runId,
        projectRoot: task.projectRoot,
        candidateCommit: task.baseCommit,
        contractHash: task.contractHash ?? null,
        plans: options.plans,
        materials: options.materials,
      });
      const key = canonicalHash('comet.native.supervisor-check-plan.v2', {
        machineId,
        inputFingerprint,
      });
      const previous = task.checkExecution;
      if (previous?.status === 'running') {
        const alive = await processInstanceMayBeAlive(previous.ownerPid, previous.ownerIdentity);
        // An expired lease cannot prove a live owner stopped; never start overlapping checks.
        const expiresAt =
          Date.parse(previous.expiresAt ?? '') || Date.parse(previous.startedAt) + 30000;
        if (alive) {
          if (!(Date.now() < expiresAt))
            throw new Error(
              'Native Supervisor check lease expired while owner PID is alive; inspect the original execution before retrying',
            );
          if (previous.key !== key)
            throw new Error(
              'Native Supervisor check plan is already running with different inputs',
            );
          return { task: structuredClone(task), execute: false };
        }
        const active = previous.activeProcess;
        if (active === undefined || active?.status === 'starting') {
          throw new Error(
            `Native Supervisor check process registration is incomplete. Check logs in ${path.join(nativePreferredChangeRuntimeDir(options.paths, options.parent), 'logs', 'checks')} for operation ${previous.operationId}; stop any remaining check process in ${task.projectRoot}, then submit supervisor-cancel for child ${options.child} and runId ${task.runId}, and dispatch a new Verifier for the preserved candidate.`,
          );
        }
        if (active && (await processInstanceMayBeAlive(active.pid, active.identity))) {
          if (!(Date.now() < expiresAt)) {
            throw new Error(
              `Native Supervisor check ${active.checkId} is still running as PID ${active.pid} after its owner exited and lease expired; stop that original check process, then retry supervisor-checks for ${options.child}.`,
            );
          }
          return { task: structuredClone(task), execute: false };
        }
        const completedStates =
          previous.checkStates?.length &&
          previous.checkStates.every(({ status }) => status === 'passed' || status === 'failed') &&
          previous.receiptRef;
        if (completedStates) {
          previous.status = 'completed';
          try {
            await readNativeSupervisorCheckEvidence({
              ...options,
              task,
              receiptRef: previous.receiptRef!,
            });
            state!.stateVersion += 1;
            await writeNativeSupervisorState(options.paths, state!);
            return { task: structuredClone(task), execute: false, key: previous.key };
          } catch {
            previous.status = 'interrupted';
          }
        }
        previous.status = 'interrupted';
        for (const check of previous.checkStates ?? []) {
          if (check.status === 'planned' || check.status === 'running') {
            check.status = 'interrupted';
          }
        }
      }
      const sameBinding =
        previous?.key === key &&
        previous.machineId === machineId &&
        previous.inputFingerprint === inputFingerprint;
      if (requestedRetryIds) {
        if (!sameBinding || previous?.status !== 'interrupted') {
          throw new Error(
            'Native Supervisor check retry requires the interrupted current plan on the same candidate, machine and workspace',
          );
        }
        assertSupervisorRetryableStates(previous.checkStates, options.plans, requestedRetryIds);
      } else if (previous?.status === 'interrupted' && sameBinding) {
        return { task: structuredClone(task), execute: false, key };
      }
      if (previous?.status === 'completed' && sameBinding && previous.receiptRef) {
        try {
          await readNativeSupervisorCheckEvidence({
            ...options,
            task,
            receiptRef: previous.receiptRef,
          });
          return { task: structuredClone(task), execute: false, key };
        } catch {
          // Missing or inconsistent snapshots are not reusable evidence.
        }
      }
      const priorStates =
        requestedRetryIds && previous?.checkStates
          ? previous.checkStates.map((check) =>
              requestedRetryIds.has(check.id)
                ? {
                    ...check,
                    status: 'planned' as const,
                    exitCode: null,
                    signal: null,
                    timedOut: false,
                    durationMs: 0,
                    startedAt: null,
                    completedAt: null,
                    logRef: null,
                  }
                : { ...check },
            )
          : options.plans.map(plannedNativeSupervisorCheckState);
      const checkStates = options.plans.map(
        (plan) =>
          priorStates.find((check) => check.id === plan.id) ??
          plannedNativeSupervisorCheckState(plan),
      );
      task.checkExecution = {
        operationId: randomUUID(),
        key,
        status: 'running',
        ownerPid: process.pid,
        ownerIdentity: (await readProcessIdentity(process.pid)) ?? undefined,
        activeProcess: null,
        startedAt: new Date().toISOString(),
        expiresAt: new Date(
          Date.now() + options.plans.reduce((total, plan) => total + plan.timeoutMs, 0) + 30000,
        ).toISOString(),
        machineId,
        inputFingerprint,
        checkStates,
      };
      task.checksReason = 'running';
      state!.stateVersion += 1;
      await writeNativeSupervisorState(options.paths, state!);
      return {
        task: structuredClone(task),
        execute: true,
        key,
        plansToExecute: options.plans.filter(
          (plan) => !requestedRetryIds || requestedRetryIds.has(plan.id),
        ),
      };
    },
  );
  const { task } = reservation;
  const operationId = task.checkExecution!.operationId;
  if (!reservation.execute) {
    if (task.checkExecution!.status === 'completed' && task.checkExecution!.receiptRef)
      await readNativeSupervisorCheckEvidence({
        ...options,
        task,
        receiptRef: task.checkExecution!.receiptRef,
      });
    return {
      status:
        task.checkExecution!.status === 'completed'
          ? 'completed'
          : task.checkExecution!.status === 'interrupted'
            ? 'interrupted'
            : 'running',
      operationId,
      ...(task.checkExecution!.receiptRef ? { receiptRef: task.checkExecution!.receiptRef } : {}),
    };
  }
  const runtimeDir = nativePreferredChangeRuntimeDir(options.paths, options.parent);
  const plansToExecute = reservation.plansToExecute!;
  const updateProcess = async (
    activeProcess: NonNullable<NativeSupervisorTask['checkExecution']>['activeProcess'],
  ) => {
    await withNativeMutationLock(options.paths, 'register Supervisor check process', async () => {
      const currentState = await readNativeSupervisorState(options.paths, options.parent);
      const current = currentTask(currentState, options.child, options.runId);
      if (
        current.checkExecution?.operationId !== operationId ||
        current.checkExecution.status !== 'running'
      )
        throw new Error('Native Supervisor check operation is stale');
      if (activeProcess?.status === 'starting') {
        const check = current.checkExecution.checkStates?.find(
          ({ id }) => id === activeProcess.checkId,
        );
        if (!check || check.status !== 'planned') {
          throw new Error(`Native Supervisor check ${activeProcess.checkId} is not planned`);
        }
        check.status = 'running';
        check.executionCount += 1;
        check.startedAt = new Date().toISOString();
        check.completedAt = null;
        check.logRef = null;
      }
      current.checkExecution.activeProcess = activeProcess;
      currentState!.stateVersion += 1;
      await writeNativeSupervisorState(options.paths, currentState!);
    });
  };
  const recordCheckResult = async (result: NativeExecutedCheck) =>
    withNativeMutationLock(options.paths, 'record Supervisor check result', async () => {
      const currentState = await readNativeSupervisorState(options.paths, options.parent);
      const current = currentTask(currentState, options.child, options.runId);
      if (
        current.checkExecution?.operationId !== operationId ||
        current.checkExecution.status !== 'running'
      )
        throw new Error('Native Supervisor check operation is stale');
      const check = current.checkExecution.checkStates?.find(({ id }) => id === result.id);
      if (!check) throw new Error(`Native Supervisor check state is missing: ${result.id}`);
      Object.assign(check, completedNativeSupervisorCheckState(check, result));
      current.checkExecution.activeProcess = null;
      currentState!.stateVersion += 1;
      await writeNativeSupervisorState(options.paths, currentState!);
    });
  try {
    for (const plan of plansToExecute) {
      await updateProcess({ status: 'starting', checkId: plan.id });
      const result = await executeNativeCheck({
        projectRoot: task.projectRoot,
        runtimeDir,
        operationId,
        plan,
        onSpawn: async ({ pid }) => {
          await updateProcess({
            status: 'running',
            checkId: plan.id,
            pid,
            identity: (await readProcessIdentity(pid)) ?? undefined,
          });
        },
      });
      await recordCheckResult(result);
      if (result.status === 'interrupted') {
        throw new Error(
          `Native Supervisor check ${result.id} was interrupted; retry only the listed repeatable check after the process has exited`,
        );
      }
    }
    const latestState = await readNativeSupervisorState(options.paths, options.parent);
    const latestTask = currentTask(latestState, options.child, options.runId);
    assertCandidate(options.parent, latestTask);
    const checkStates = latestTask.checkExecution?.checkStates;
    if (!checkStates || checkStates.some(({ status }) => !['passed', 'failed'].includes(status))) {
      throw new Error(
        'Native Supervisor check plan remains incomplete; retry each interrupted check explicitly',
      );
    }
    const checks = await supervisorCheckRecords(runtimeDir, checkStates);
    const record: SupervisorCheckRecord = {
      schema: 'comet.native.supervisor-checks.v1',
      parent: options.parent,
      child: options.child,
      runId: options.runId,
      candidateCommit: task.baseCommit,
      contractHash: task.contractHash ?? null,
      operationId,
      planHash: reservation.key!,
      machineId: latestTask.checkExecution!.machineId!,
      inputFingerprint: latestTask.checkExecution!.inputFingerprint!,
      checks,
      materials: options.materials.map(({ name, content }) => {
        const redacted = redactNativeCredentialText(content);
        return { name, content: redacted, hash: hashText(redacted) };
      }),
    };
    const text = JSON.stringify(record);
    const receiptRef = await writeNativeVerificationReportSnapshot({
      paths: options.paths,
      name: options.parent,
      hash: hashText(text),
      text,
    });
    await withNativeMutationLock(options.paths, 'complete Supervisor checks', async () => {
      const state = await readNativeSupervisorState(options.paths, options.parent);
      const current = currentTask(state, options.child, options.runId);
      if (current.checkExecution?.operationId !== operationId)
        throw new Error('Native Supervisor check operation is stale');
      assertCandidate(options.parent, current);
      current.checkExecution.status = 'completed';
      current.checkExecution.receiptRef = receiptRef;
      current.checkExecution.activeProcess = null;
      current.checksReason = 'completed';
      state!.stateVersion += 1;
      await writeNativeSupervisorState(options.paths, state!);
    });
    return { status: 'completed', operationId, receiptRef };
  } catch (error) {
    await withNativeMutationLock(options.paths, 'interrupt Supervisor checks', async () => {
      const state = await readNativeSupervisorState(options.paths, options.parent);
      const current = state?.children.find(({ name }) => name === options.child)?.task;
      if (current?.runId === options.runId && current.checkExecution?.operationId === operationId) {
        current.checkExecution.status = 'interrupted';
        current.checkExecution.activeProcess = null;
        for (const check of current.checkExecution.checkStates ?? []) {
          if (check.status === 'planned' || check.status === 'running') {
            check.status = 'interrupted';
          }
        }
        current.checksReason = 'not-run';
        state!.stateVersion += 1;
        await writeNativeSupervisorState(options.paths, state!);
      }
    });
    throw error;
  }
}

export async function readNativeSupervisorCheckEvidence(options: {
  paths: NativeProjectPaths;
  parent: string;
  task: NativeSupervisorTask;
  receiptRef: string;
}): Promise<SupervisorCheckRecord> {
  const match = /^runtime\/evidence\/reports\/([a-f0-9]{64})\.json$/u.exec(options.receiptRef);
  if (!match) throw new Error('Native Supervisor receipt ref is invalid');
  const record = JSON.parse(
    await readNativeVerificationReportSnapshot(options.paths, options.parent, match[1]),
  ) as SupervisorCheckRecord;
  const task = options.task;
  const checkStates = task.checkExecution?.checkStates;
  const checksMatchCurrentExecution =
    checkStates !== undefined &&
    Array.isArray(record.checks) &&
    record.checks.length === checkStates.length &&
    record.checks.every((check, index) =>
      supervisorCheckRecordMatchesState(check, checkStates[index]),
    );
  const checkLogsMatchCurrentFiles =
    Array.isArray(record.checks) &&
    (await supervisorCheckLogsMatchCurrentFiles({
      paths: options.paths,
      parent: options.parent,
      checks: record.checks,
    }));
  if (
    record.schema !== 'comet.native.supervisor-checks.v1' ||
    record.parent !== options.parent ||
    record.child !== task.child ||
    record.runId !== task.runId ||
    record.candidateCommit !== task.baseCommit ||
    record.contractHash !== (task.contractHash ?? null) ||
    record.operationId !== task.checkExecution?.operationId ||
    record.planHash !== task.checkExecution.key ||
    record.machineId !== task.checkExecution.machineId ||
    record.inputFingerprint !== task.checkExecution.inputFingerprint ||
    task.checkExecution.status !== 'completed' ||
    task.checkExecution.receiptRef !== options.receiptRef ||
    !Array.isArray(record.checks) ||
    record.checks.length === 0 ||
    !checksMatchCurrentExecution ||
    !checkLogsMatchCurrentFiles ||
    !Array.isArray(record.materials) ||
    record.materials.some(({ content, hash }) => hashText(content) !== hash)
  ) {
    throw new Error(
      'Native Supervisor receipt does not match the current candidate, runId, contract or execution',
    );
  }
  return record;
}
