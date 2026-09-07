import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { gitWorktreeIsClean, runGitCommand } from '../../platform/process/git.js';
import { canonicalHash } from './native-canonical-hash.js';
import {
  executeNativeCheck,
  validateNativeCheckPlan,
  type NativeCheckPlan,
  type NativeExecutedCheck,
} from './native-check-executor.js';
import {
  readNativeVerificationReportSnapshot,
  writeNativeVerificationReportSnapshot,
} from './native-evidence-storage.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { nativePreferredChangeRuntimeDir } from './native-paths.js';
import { redactNativeCredentialText } from './native-redaction.js';
import {
  readNativeSupervisorState,
  writeNativeSupervisorState,
  type NativeSupervisorTask,
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
  checks: Array<NativeExecutedCheck & { logContent: string }>;
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
    !gitWorktreeIsClean(task.projectRoot)
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

/** The parent evidence space is authoritative even when checks run in a child worktree. */
export async function executeNativeSupervisorChecks(options: {
  paths: NativeProjectPaths;
  parent: string;
  child: string;
  runId: string;
  plans: NativeCheckPlan[];
  materials: NativeSupervisorMaterial[];
}): Promise<{ status: 'running' | 'completed'; operationId: string; receiptRef?: string }> {
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
  const key = canonicalHash('comet.native.supervisor-check-plan.v1', {
    plans: options.plans,
    materials: options.materials,
  });
  const reservation = await withNativeMutationLock(
    options.paths,
    'reserve Supervisor checks',
    async () => {
      const state = await readNativeSupervisorState(options.paths, options.parent);
      const task = currentTask(state, options.child, options.runId);
      assertCandidate(options.parent, task);
      options.plans.forEach((plan) => validateNativeCheckPlan(task.projectRoot, plan));
      const previous = task.checkExecution;
      if (previous?.status === 'running') {
        let alive = true;
        try {
          process.kill(previous.ownerPid, 0);
        } catch (error) {
          alive = (error as NodeJS.ErrnoException).code !== 'ESRCH';
        }
        if (alive) {
          if (previous.key !== key)
            throw new Error(
              'Native Supervisor check plan is already running with different inputs',
            );
          return { task: structuredClone(task), execute: false };
        }
        previous.status = 'interrupted';
      }
      if (
        previous?.status === 'completed' &&
        previous.key === key &&
        options.plans.every(({ repeatable }) => repeatable)
      )
        return { task: structuredClone(task), execute: false };
      task.checkExecution = {
        operationId: randomUUID(),
        key,
        status: 'running',
        ownerPid: process.pid,
        startedAt: new Date().toISOString(),
      };
      task.checksReason = 'running';
      state!.stateVersion += 1;
      await writeNativeSupervisorState(options.paths, state!);
      return { task: structuredClone(task), execute: true };
    },
  );
  const { task } = reservation;
  const operationId = task.checkExecution!.operationId;
  if (!reservation.execute) {
    if (task.checkExecution!.receiptRef)
      await readNativeSupervisorCheckEvidence({
        ...options,
        task,
        receiptRef: task.checkExecution!.receiptRef,
      });
    return {
      status: task.checkExecution!.status === 'completed' ? 'completed' : 'running',
      operationId,
      ...(task.checkExecution!.receiptRef ? { receiptRef: task.checkExecution!.receiptRef } : {}),
    };
  }
  const runtimeDir = nativePreferredChangeRuntimeDir(options.paths, options.parent);
  try {
    const checks: SupervisorCheckRecord['checks'] = [];
    for (const plan of options.plans) {
      const result = await executeNativeCheck({
        projectRoot: task.projectRoot,
        runtimeDir,
        operationId,
        plan,
      });
      const logFile = path.join(runtimeDir, result.logRef);
      const log = await fs.readFile(logFile, 'utf8');
      checks.push({ ...result, logContent: redactNativeCredentialText(log).slice(0, 128 * 1024) });
    }
    assertCandidate(options.parent, task);
    const record: SupervisorCheckRecord = {
      schema: 'comet.native.supervisor-checks.v1',
      parent: options.parent,
      child: options.child,
      runId: options.runId,
      candidateCommit: task.baseCommit,
      contractHash: task.contractHash ?? null,
      operationId,
      planHash: key,
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
  if (
    record.schema !== 'comet.native.supervisor-checks.v1' ||
    record.parent !== options.parent ||
    record.child !== task.child ||
    record.runId !== task.runId ||
    record.candidateCommit !== task.baseCommit ||
    record.contractHash !== (task.contractHash ?? null) ||
    record.operationId !== task.checkExecution?.operationId ||
    record.planHash !== task.checkExecution.key ||
    task.checkExecution.status !== 'completed' ||
    task.checkExecution.receiptRef !== options.receiptRef ||
    !Array.isArray(record.checks) ||
    record.checks.length === 0 ||
    !Array.isArray(record.materials) ||
    record.materials.some(({ content, hash }) => hashText(content) !== hash)
  ) {
    throw new Error(
      'Native Supervisor receipt does not match the current candidate, runId, contract or execution',
    );
  }
  return record;
}
