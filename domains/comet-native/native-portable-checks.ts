import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  inspectProcessLiveness,
  readProcessIdentity,
} from '../../platform/process/process-identity.js';
import {
  executeNativeCheck,
  inspectNativeCheckProcessTreeLiveness,
  isNativeCheckTerminationUnconfirmedError,
  nativeCheckInvocationKey,
  nativeCheckPlanKey,
  nativePortableArgvDisplay,
  preflightNativeCheckPlans,
  resolveNativeCheckCwd,
  validateNativeCheckPlan,
  type NativeCheckPlan,
} from './native-check-executor.js';
import {
  preservedLocalChecksForVersion,
  readCurrentLocalExecution,
} from './native-local-execution-binding.js';
import {
  readNativeLocalExecution,
  rebuildNativeLocalExecution,
  writeNativeLocalExecution,
} from './native-local-execution.js';
import {
  NATIVE_MAX_REQUEST_CHECK_ROUNDS,
  recordNativeVerifierExecutionError,
} from './native-loop-runtime.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { nativePreferredChangeRuntimeDir } from './native-paths.js';
import {
  currentBranch,
  nativeLocalExecutionFile,
  readNativePortableChange,
  writePortableMutation,
} from './native-portable-storage.js';
import { toNativePortableText } from './native-portable-text.js';
import { readNativePortableTransaction } from './native-portable-transactions.js';
import type {
  NativeLocalCheckState,
  NativeLocalExecutionState,
  NativePortableCheckSummary,
  NativePortableState,
} from './native-portable-types.js';
import type { NativeTrustedVerifierEnvelope } from './native-runner-protocol.js';
import type { NativeProjectPaths } from './native-types.js';
import {
  completeNativeVerifierAction,
  currentNativeVerifierAction,
  nativeVerifierActionExecutionRef,
  startNativeVerifierAction,
} from './native-verifier-action.js';
import {
  type NativeVerifierCheckRequest,
  type NativeVerifierResponse,
} from './native-verifier-protocol.js';
export {
  preservedLocalChecksForVersion,
  readCurrentLocalExecution,
} from './native-local-execution-binding.js';

export function localCheckCwdRef(projectRoot: string, cwd: string): string {
  const relative = path.relative(path.resolve(projectRoot), path.resolve(cwd));
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('Native local check cwd escaped the project root');
  }
  const cwdRef = relative.length === 0 ? '.' : relative.split(path.sep).join('/');
  resolveNativeCheckCwd(projectRoot, cwdRef);
  return cwdRef;
}

export function hasGitlinksInIndex(indexOutput: string): boolean {
  return indexOutput.split('\0').some((record) => record.startsWith('160000 '));
}

export function nativeLocalCheckPlanKey(check: NativeLocalCheckState, projectRoot: string): string {
  const [executable, ...argv] = check.argv;
  if (!executable) throw new Error(`Native local check ${check.id} has no executable`);
  return nativeCheckPlanKey({
    id: check.id,
    name: check.name,
    executable,
    argv,
    cwdRef: localCheckCwdRef(projectRoot, check.cwd),
    timeoutMs: check.timeoutMs,
    repeatable: check.repeatable,
    ...(check.reusable === undefined ? {} : { reusable: check.reusable }),
  });
}

export function nativePortableCheckPlansFromLocal(
  local: NativeLocalExecutionState,
  projectRoot = local.workspace.projectRoot,
): NativeCheckPlan[] {
  return local.checks.map((check) => {
    const [executable, ...argv] = check.argv;
    if (!executable) throw new Error(`Native local check ${check.id} has no executable`);
    return {
      id: check.id,
      name: check.name,
      executable,
      argv,
      cwdRef: localCheckCwdRef(projectRoot, check.cwd),
      timeoutMs: check.timeoutMs,
      repeatable: check.repeatable,
      ...(check.reusable === undefined ? {} : { reusable: check.reusable }),
    };
  });
}

export function sameNativeCheckPlan(
  local: NativeLocalExecutionState,
  plans: readonly NativeCheckPlan[],
  projectRoot: string,
  state: NativePortableState,
  _legacyInputFingerprint: string,
  branch: string | null,
): boolean {
  if (
    local.candidateId !== state.builder_handoff?.candidate_id ||
    path.resolve(local.workspace.projectRoot) !== path.resolve(projectRoot) ||
    path.resolve(local.workspace.worktreeRoot) !== path.resolve(projectRoot) ||
    local.workspace.branch !== branch ||
    local.workspace.machineId !== os.hostname()
  ) {
    return false;
  }
  if (local.checks.length !== plans.length) return false;
  return local.checks.every(
    (check, index) =>
      nativeLocalCheckPlanKey(check, projectRoot) === nativeCheckPlanKey(plans[index]),
  );
}

export function sameNativeCheckCommands(
  local: NativeLocalExecutionState,
  plans: readonly NativeCheckPlan[],
  projectRoot: string,
): boolean {
  return (
    local.checks.length === plans.length &&
    local.checks.every(
      (check, index) =>
        nativeLocalCheckPlanKey(check, projectRoot) === nativeCheckPlanKey(plans[index]),
    )
  );
}

export type NativePortableCheckExecutionLiveness =
  'not-running' | 'running' | 'orphaned' | 'unknown';

/**
 * Inspect the owner and active child recorded for a local Runtime check operation.
 * Missing identity metadata remains unknown so a stale overlay can never trigger a
 * second check while the original process might still be alive.
 */
export async function inspectNativePortableCheckExecution(
  local: NativeLocalExecutionState,
): Promise<NativePortableCheckExecutionLiveness> {
  const execution = local.execution;
  if (execution === null || execution.status !== 'running') return 'not-running';
  if (execution.ownerPid === undefined) return 'unknown';
  // 探测失败保持 unknown；Doctor 仅可接管没有未确认检查进程的 owner 登记。
  const ownerLiveness = await inspectProcessLiveness(execution.ownerPid, execution.ownerIdentity);
  if (ownerLiveness === 'alive') return 'running';

  let unknown = ownerLiveness === 'unknown';
  for (const check of local.checks) {
    if (check.status !== 'running') continue;
    const active = check.activeProcess;
    if (!active || active.status === 'starting') {
      unknown = true;
      continue;
    }
    const liveness = await inspectNativeCheckProcessTreeLiveness(active.pid, active.identity);
    if (liveness === 'alive') return 'running';
    if (liveness === 'unknown') unknown = true;
  }
  return unknown ? 'unknown' : 'orphaned';
}

function localCheck(
  plan: NativeCheckPlan,
  operationId: string,
  projectRoot: string,
): NativeLocalCheckState {
  return {
    id: plan.id,
    name: plan.name,
    operationId,
    status: 'planned',
    repeatable: plan.repeatable,
    ...(plan.reusable === undefined ? {} : { reusable: plan.reusable }),
    timeoutMs: plan.timeoutMs,
    executionCount: 0,
    argv: [plan.executable, ...plan.argv],
    cwd: resolveNativeCheckCwd(projectRoot, plan.cwdRef),
    exitCode: null,
    startedAt: null,
    completedAt: null,
    log: `logs/checks/${operationId}-${plan.id}.log`,
    activeProcess: null,
  };
}

function resetNativeCheckForExecution(
  previous: NativeLocalCheckState,
  plan: NativeCheckPlan,
  operationId: string,
  projectRoot: string,
): NativeLocalCheckState {
  return {
    ...localCheck(plan, operationId, projectRoot),
    executionCount: previous.executionCount,
  };
}

function completedCheckDuration(check: NativeLocalCheckState): number {
  if (check.startedAt === null || check.completedAt === null) return 0;
  return Math.max(0, Date.parse(check.completedAt) - Date.parse(check.startedAt));
}

export function authoritativePortableChecks(options: {
  local: NativeLocalExecutionState;
  projectRoot: string;
  supplied: readonly NativePortableCheckSummary[];
  requestedNames?: ReadonlyMap<string, string>;
}): NativePortableCheckSummary[] {
  const suppliedById = new Map<string, NativePortableCheckSummary>();
  for (const check of options.supplied) {
    if (suppliedById.has(check.id)) {
      throw new Error(`Native Runtime check summaries contain duplicate ID ${check.id}`);
    }
    suppliedById.set(check.id, check);
  }
  return options.local.checks.map((check) => {
    if (check.status === 'planned' || check.status === 'running') {
      throw new Error(`Native Runtime check ${check.id} has not completed`);
    }
    if (
      check.status === 'passed' &&
      (check.evidence !== 'runtime' || check.exitCode !== 0 || !check.completedAt)
    ) {
      throw new Error(`Native Runtime check ${check.id} has no Runtime execution evidence`);
    }
    const name = options.requestedNames?.get(check.id) ?? check.name;
    return {
      id: check.id,
      name: toNativePortableText(name),
      argv_display: nativePortableArgvDisplay(check.argv.slice(1)).map((entry) =>
        toNativePortableText(entry),
      ),
      argv_truncated: false,
      cwd_ref: localCheckCwdRef(options.projectRoot, check.cwd),
      status: check.status,
      exit_code: check.exitCode,
      duration_ms: completedCheckDuration(check),
    };
  });
}

function requestCheckPlan(request: NativeVerifierCheckRequest): NativeCheckPlan {
  return {
    id: request.id,
    name: request.name,
    executable: request.executable,
    argv: [...request.argv],
    cwdRef: request.cwdRef,
    timeoutMs: request.timeoutMs,
    repeatable: request.repeatable,
    ...(request.reusable === undefined ? {} : { reusable: request.reusable }),
  };
}

export async function persistVerifierExecutionError(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  summary: string;
}): Promise<NativePortableState> {
  const local = await readCurrentLocalExecution({
    paths: options.paths,
    state: options.state,
    allowMissing: true,
  });
  const next = recordNativeVerifierExecutionError({
    state: options.state,
    summary: options.summary,
  });
  const action = currentNativeVerifierAction(options.state, local);
  const executionRef = nativeVerifierActionExecutionRef(action);
  if (executionRef)
    next.verifier_action = completeNativeVerifierAction({
      action,
      executionRef,
      response: { kind: 'execution-error', summary: options.summary },
      status: 'failed',
    }).action;
  const written = await writePortableMutation({
    paths: options.paths,
    previous: options.state,
    next,
  });
  if (local !== null)
    await writeNativeLocalExecution(
      nativeLocalExecutionFile(options.paths, options.state.name),
      preservedLocalChecksForVersion({
        local,
        state: written,
        projectRoot: options.paths.projectRoot,
      }),
      { containedRoot: options.paths.runtimeDir },
    );
  return written;
}

/** 仅沿用 Agent 明确选择的原 Runtime 成功检查。 */
export async function rebindNativeCheckEvidence(options: {
  paths: NativeProjectPaths;
  previous: NativePortableState;
  next: NativePortableState;
  local: NativeLocalExecutionState | null;
  plans: readonly NativeCheckPlan[];
  projectRoot?: string;
}): Promise<NativeLocalExecutionState | null> {
  const { local, next, plans } = options;
  if (
    !local ||
    local.execution?.status === 'running' ||
    local.checks.some((check) => check.activeProcess !== null)
  )
    return null;
  const projectRoot = options.projectRoot ?? options.paths.projectRoot;
  const checks = plans.flatMap((plan) => {
    if (!plan.reusable) return [];
    const original = local.checks.find(
      (check) => nativeLocalCheckPlanKey(check, projectRoot) === nativeCheckPlanKey(plan),
    );
    return original?.status === 'passed' &&
      original.exitCode === 0 &&
      original.evidence === 'runtime'
      ? [{ ...original, id: plan.id, name: plan.name }]
      : [];
  });
  if (!checks.length) return null;
  const record = { ...local };
  delete record.inputFingerprint;
  delete record.inputFingerprintGate;
  delete record.candidateInputFingerprintGate;
  delete record.rawInputRef;
  return {
    ...record,
    basedOnStateVersion: next.state_version,
    candidateId: next.builder_handoff?.candidate_id ?? null,
    checks,
  };
}

async function reserveNativePortableCheckPlan(options: {
  paths: NativeProjectPaths;
  name: string;
  plans: NativeCheckPlan[];
  projectRoot: string;
  retryCheckIds?: readonly string[];
}): Promise<
  | {
      kind: 'execute';
      state: NativePortableState;
      local: NativeLocalExecutionState;
      plans: NativeCheckPlan[];
      inputDiagnostics: string[];
    }
  | { kind: 'reuse'; state: NativePortableState; checks: NativePortableCheckSummary[] }
> {
  return withNativeMutationLock(
    options.paths,
    'reserve portable checks ' + options.name,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      const supplemental =
        state.phase === 'archive' && state.status === 'active' && !state.archived;
      if (!(state.phase === 'verify' && state.loop.stage === 'verify-ready') && !supplemental)
        throw new Error('Native checks require the current Verify or supplemental check step');
      if (
        supplemental &&
        (await readNativePortableTransaction(options.paths, {
          change: state.name,
          kind: 'archive',
        }))
      )
        throw new Error('原 Archive 已开始；先恢复归档事务，不能插入检查');
      if (!state.builder_handoff) throw new Error('Native checks require a Builder result');
      const file = nativeLocalExecutionFile(options.paths, state.name);
      const existing = await readNativeLocalExecution(file);
      let local =
        existing?.change === state.name &&
        existing.candidateId === state.builder_handoff.candidate_id
          ? existing
          : rebuildNativeLocalExecution({
              portableState: state,
              projectRoot: options.projectRoot,
              branch: currentBranch(options.projectRoot),
            });
      if (
        local.execution?.status === 'running' ||
        local.checks.some((check) => check.activeProcess !== null || check.status === 'running')
      ) {
        if (
          local.execution?.stage !== 'checking' ||
          local.execution.actor !== 'runtime' ||
          (await inspectNativePortableCheckExecution(local)) !== 'orphaned'
        )
          throw new Error('原检查或验收仍在执行；保留原执行，先等待或核对停止结果');
        local = {
          ...local,
          execution: { ...local.execution, status: 'interrupted' },
          checks: local.checks.map((check) =>
            check.status === 'planned' || check.status === 'running'
              ? { ...check, status: 'interrupted', activeProcess: null }
              : check,
          ),
        };
        await writeNativeLocalExecution(file, local, { containedRoot: options.paths.runtimeDir });
      }
      if (
        !options.retryCheckIds?.length &&
        sameNativeCheckCommands(local, options.plans, options.projectRoot) &&
        local.checks.some((check) => check.status === 'interrupted') &&
        local.checks.every((check) => check.repeatable)
      )
        return {
          kind: 'reuse' as const,
          state,
          checks: authoritativePortableChecks({
            local,
            projectRoot: options.projectRoot,
            supplied: [],
          }),
        };
      const operationId = randomUUID();
      const execute: NativeCheckPlan[] = [];
      const checks = options.plans.map((plan) => {
        const once = local.checks.find(
          (check) =>
            !check.repeatable &&
            check.executionCount > 0 &&
            nativeCheckInvocationKey({
              ...plan,
              executable: check.argv[0],
              argv: check.argv.slice(1),
              cwdRef: localCheckCwdRef(options.projectRoot, check.cwd),
            }) === nativeCheckInvocationKey(plan),
        );
        if (once && once.id !== plan.id)
          throw new Error('单次检查不能通过别名重复执行：' + plan.id);
        if (once && nativeLocalCheckPlanKey(once, options.projectRoot) !== nativeCheckPlanKey(plan))
          throw new Error('已执行单次检查的定义冲突：' + plan.id);
        const previous = local.checks.find(
          (check) =>
            nativeLocalCheckPlanKey(check, options.projectRoot) === nativeCheckPlanKey(plan),
        );
        const explicitlyRetry = options.retryCheckIds?.includes(plan.id);
        if (
          previous?.status === 'passed' &&
          previous.exitCode === 0 &&
          previous.evidence === 'runtime' &&
          plan.reusable &&
          !explicitlyRetry
        )
          return { ...previous, id: plan.id, name: plan.name, reusable: true };
        if (previous && !previous.repeatable && previous.executionCount > 0)
          throw new Error('检查 ' + plan.id + ' 的单次操作已经执行，不能自动重放');
        execute.push(plan);
        return previous
          ? resetNativeCheckForExecution(previous, plan, operationId, options.projectRoot)
          : localCheck(plan, operationId, options.projectRoot);
      });
      const record = { ...local };
      delete record.inputFingerprint;
      delete record.inputFingerprintGate;
      delete record.candidateInputFingerprintGate;
      delete record.rawInputRef;
      const ownerIdentity = await readProcessIdentity(process.pid);
      const next: NativeLocalExecutionState = {
        ...record,
        basedOnStateVersion: state.state_version,
        candidateId: state.builder_handoff.candidate_id,
        execution: {
          operationId,
          stage: 'checking',
          actor: 'runtime',
          executionId: null,
          status: execute.length ? 'running' : 'completed',
          startedAt: new Date().toISOString(),
          requestCheckRounds: 0,
          ownerPid: process.pid,
          ...(ownerIdentity ? { ownerIdentity } : {}),
        },
        checks,
      };
      await writeNativeLocalExecution(file, next, { containedRoot: options.paths.runtimeDir });
      if (!execute.length)
        return {
          kind: 'reuse' as const,
          state,
          checks: authoritativePortableChecks({
            local: next,
            projectRoot: options.projectRoot,
            supplied: [],
          }),
        };
      return { kind: 'execute' as const, state, local: next, plans: execute, inputDiagnostics: [] };
    },
  );
}

async function updateReservedNativeCheckPlan(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  operationId: string;
  update: (local: NativeLocalExecutionState) => NativeLocalExecutionState;
}): Promise<NativeLocalExecutionState> {
  return withNativeMutationLock(
    options.paths,
    `update portable checks ${options.state.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.state.name);
      if (
        state.state_version !== options.state.state_version ||
        state.phase !== options.state.phase ||
        (state.phase === 'verify'
          ? state.loop.stage !== 'verify-ready'
          : state.phase !== 'archive' || state.archived || state.status !== 'active')
      ) {
        throw new Error('Native check plan state changed during execution');
      }
      const file = nativeLocalExecutionFile(options.paths, state.name);
      const local = await readNativeLocalExecution(file);
      if (
        local === null ||
        local.basedOnStateVersion !== state.state_version ||
        local.execution?.operationId !== options.operationId ||
        local.execution.stage !== 'checking' ||
        local.execution.actor !== 'runtime' ||
        local.execution.status !== 'running'
      ) {
        throw new Error('Native check plan reservation changed during execution');
      }
      const next = options.update(local);
      await writeNativeLocalExecution(file, next, { containedRoot: options.paths.runtimeDir });
      return next;
    },
  );
}

export async function executeNativePortableCheckPlan(options: {
  paths: NativeProjectPaths;
  name: string;
  plans: NativeCheckPlan[];
  projectRoot?: string;
  retryCheckIds?: readonly string[];
}): Promise<{
  state: NativePortableState;
  checks: NativePortableCheckSummary[];
  disposition: 'executed' | 'reused';
  inputDiagnostics?: string[];
}> {
  const projectRoot = options.projectRoot ?? options.paths.projectRoot;
  preflightNativeCheckPlans(projectRoot, options.plans);
  const seen = new Set<string>();
  const plans = options.plans.filter((plan) => {
    const key = nativeCheckPlanKey(plan);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const reservation = await reserveNativePortableCheckPlan({ ...options, plans, projectRoot });
  if (reservation.kind === 'reuse') return { ...reservation, disposition: 'reused' };
  const operationId = reservation.local.execution!.operationId;
  const runtimeDir = nativePreferredChangeRuntimeDir(options.paths, reservation.state.name);
  try {
    for (const plan of reservation.plans) {
      const startedAt = new Date().toISOString();
      await updateReservedNativeCheckPlan({
        paths: options.paths,
        state: reservation.state,
        operationId,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) =>
            check.id === plan.id
              ? {
                  ...check,
                  status: 'running',
                  executionCount: check.executionCount + 1,
                  startedAt,
                  activeProcess: { status: 'starting' },
                }
              : check,
          ),
        }),
      });
      const result = await executeNativeCheck({
        projectRoot,
        runtimeDir,
        operationId,
        plan,
        onSpawn: async ({ pid }) => {
          const identity = await readProcessIdentity(pid);
          await updateReservedNativeCheckPlan({
            paths: options.paths,
            state: reservation.state,
            operationId,
            update: (local) => ({
              ...local,
              checks: local.checks.map((check) =>
                check.id === plan.id
                  ? {
                      ...check,
                      activeProcess: { status: 'running', pid, ...(identity ? { identity } : {}) },
                    }
                  : check,
              ),
            }),
          });
        },
      });
      await updateReservedNativeCheckPlan({
        paths: options.paths,
        state: reservation.state,
        operationId,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) => {
            if (check.id !== plan.id) return check;
            const record = { ...check };
            delete record.evidenceDigest;
            delete record.rawInput;
            return {
              ...record,
              status: result.status,
              exitCode: result.exitCode,
              startedAt: result.startedAt,
              completedAt: result.completedAt,
              log: result.logRef,
              activeProcess: null,
              evidence: 'runtime',
            };
          }),
        }),
      });
    }
    await updateReservedNativeCheckPlan({
      paths: options.paths,
      state: reservation.state,
      operationId,
      update: (local) => ({ ...local, execution: { ...local.execution!, status: 'completed' } }),
    });
  } catch (error) {
    if (isNativeCheckTerminationUnconfirmedError(error)) throw error;
    await updateReservedNativeCheckPlan({
      paths: options.paths,
      state: reservation.state,
      operationId,
      update: (local) => ({
        ...local,
        execution: { ...local.execution!, status: 'interrupted' },
        checks: local.checks.map((check) =>
          check.status === 'planned' || check.status === 'running'
            ? { ...check, status: 'interrupted', activeProcess: null }
            : check,
        ),
      }),
    }).catch(() => undefined);
    throw error;
  }
  const local = await readNativeLocalExecution(
    nativeLocalExecutionFile(options.paths, reservation.state.name),
  );
  if (!local) throw new Error('Native check execution record disappeared');
  return {
    state: reservation.state,
    checks: authoritativePortableChecks({ local, projectRoot, supplied: [] }),
    disposition: 'executed',
  };
}

/**
 * Retry only repeatable interrupted checks for the current Builder candidate.
 * The local overlay is read to reconstruct the exact original command, so an
 * Agent cannot silently replace a failed command while claiming a retry.
 */
export async function retryNativePortableCheckPlan(options: {
  paths: NativeProjectPaths;
  name: string;
  checkIds: readonly string[];
  projectRoot?: string;
}): Promise<{ state: NativePortableState; checks: NativePortableCheckSummary[] }> {
  if (options.checkIds.length === 0) {
    throw new Error('Native check retry list must contain at least one ID');
  }
  const projectRoot = options.projectRoot ?? options.paths.projectRoot;
  const state = await readNativePortableChange(options.paths, options.name);
  if (
    !['verify', 'archive'].includes(state.phase) ||
    state.status !== 'active' ||
    (state.phase === 'verify' && state.loop.stage !== 'verify-ready') ||
    state.archived ||
    state.builder_handoff === null
  ) {
    throw new Error('Native check retry requires an active Verify-ready candidate');
  }
  const local = await readNativeLocalExecution(
    nativeLocalExecutionFile(options.paths, options.name),
  );
  if (
    local === null ||
    local.change !== state.name ||
    local.basedOnStateVersion !== state.state_version ||
    local.execution === null ||
    local.execution.stage !== 'checking' ||
    local.execution.actor !== 'runtime'
  ) {
    throw new Error('Native check retry has no current Runtime check execution');
  }
  const requested = new Set(options.checkIds);
  if (requested.size !== options.checkIds.length) {
    throw new Error('Native check retry list contains duplicate IDs');
  }
  const checks = local.checks.filter((check) => requested.has(check.id));
  const missing = options.checkIds.filter((id) => !checks.some((check) => check.id === id));
  if (missing.length > 0) {
    throw new Error(`Native check retry IDs are unknown: ${missing.join(', ')}`);
  }
  for (const check of checks) {
    if (check.status !== 'interrupted') {
      throw new Error(`Native check ${check.id} is not interrupted and cannot be retried`);
    }
    if (!check.repeatable) {
      throw new Error(`Native check ${check.id} is not repeatable and cannot be retried`);
    }
    if (check.executionCount >= 3) {
      throw new Error(`Native check retry limit (3) reached: ${check.id}`);
    }
  }
  const plans = local.checks.map((check) => {
    const [executable, ...argv] = check.argv;
    if (!executable) throw new Error(`Native local check ${check.id} has no executable`);
    return {
      id: check.id,
      name: check.name,
      executable,
      argv,
      cwdRef: localCheckCwdRef(projectRoot, check.cwd),
      timeoutMs: check.timeoutMs,
      repeatable: check.repeatable,
      reusable: !requested.has(check.id) || check.reusable === true,
    } satisfies NativeCheckPlan;
  });
  return executeNativePortableCheckPlan({
    paths: options.paths,
    name: options.name,
    plans,
    projectRoot,
    retryCheckIds: options.checkIds,
  });
}

export interface NativePortableRequestChecksOutcome {
  round: number;
  reusedCheckIds: string[];
  executedCheckIds: string[];
}

interface NativeVerifierRequestedCheckReservation {
  state: NativePortableState;
  local: NativeLocalExecutionState;
  verifierExecutionRef: string;
  round: number;
  novelPlans: NativeCheckPlan[];
  requestedNames: ReadonlyMap<string, string>;
  reusedCheckIds: string[];
  suppliedChecks: readonly NativePortableCheckSummary[];
}

export async function reserveVerifierRequestedChecks(options: {
  paths: NativeProjectPaths;
  projectRoot: string;
  state: NativePortableState;
  local: NativeLocalExecutionState;
  envelope: NativeTrustedVerifierEnvelope<unknown>;
  response: Extract<NativeVerifierResponse, { kind: 'request-checks' }>;
  suppliedChecks: readonly NativePortableCheckSummary[];
}): Promise<NativeVerifierRequestedCheckReservation> {
  const action = currentNativeVerifierAction(options.state, options.local);
  const started = startNativeVerifierAction(action, options.envelope.verifierExecutionRef);
  if (!options.state.verifier_action || action.status === 'pending') {
    const written = await writePortableMutation({
      paths: options.paths,
      previous: options.state,
      next: {
        ...options.state,
        state_version: options.state.state_version + 1,
        verifier_action: started,
      },
    });
    options = {
      ...options,
      state: written,
      local: { ...options.local, basedOnStateVersion: written.state_version },
    };
    await writeNativeLocalExecution(
      nativeLocalExecutionFile(options.paths, written.name),
      options.local,
      { containedRoot: options.paths.runtimeDir },
    );
  }
  const file = nativeLocalExecutionFile(options.paths, options.state.name);
  const local = options.local;
  if (
    local === null ||
    local.change !== options.state.name ||
    local.basedOnStateVersion !== options.state.state_version ||
    local.execution === null ||
    local.execution.stage !== 'verifying' ||
    local.execution.actor !== 'verifier' ||
    local.execution.status !== 'running'
  ) {
    throw new Error('Native Verifier request-checks has no active local execution');
  }
  if (
    local.execution.executionId !== null &&
    local.execution.executionId !== options.envelope.verifierExecutionRef
  ) {
    throw new Error('Native Verifier request-checks changed execution within the same attempt');
  }
  if (local.execution.requestCheckRounds >= NATIVE_MAX_REQUEST_CHECK_ROUNDS) {
    throw new Error(
      `Native Verifier request-checks exceeded ${NATIVE_MAX_REQUEST_CHECK_ROUNDS} rounds for this attempt`,
    );
  }

  const existingByKey = new Map<string, NativeLocalCheckState>();
  const existingByKeyAll = new Map<string, NativeLocalCheckState>();
  const existingKeyById = new Map<string, string>();
  for (const check of local.checks) {
    const key = nativeLocalCheckPlanKey(check, options.projectRoot);
    existingByKeyAll.set(key, check);
    if (
      check.status === 'passed' &&
      check.evidence === 'runtime' &&
      check.exitCode === 0 &&
      options.response.checks.some(
        (request) => request.reusable === true && nativeCheckPlanKey(request) === key,
      )
    )
      existingByKey.set(key, check);
    existingKeyById.set(check.id, key);
  }

  const requestedByKey = new Map<string, NativeCheckPlan>();
  const requestedKeyById = new Map<string, string>();
  for (const request of options.response.checks) {
    const plan = requestCheckPlan(request);
    validateNativeCheckPlan(options.projectRoot, plan);
    const key = nativeCheckPlanKey(plan);
    if (
      !existingByKeyAll.has(key) &&
      nativePortableCheckPlansFromLocal(local).some(
        (original) =>
          !original.repeatable &&
          nativeCheckInvocationKey(original) === nativeCheckInvocationKey(plan) &&
          local.checks.some((check) => check.id === original.id && check.executionCount > 0),
      )
    )
      throw new Error(
        `Native check ${plan.id} refers to an executed command that is not repeatable`,
      );
    const previousRequestKey = requestedKeyById.get(plan.id);
    if (previousRequestKey !== undefined && previousRequestKey !== key) {
      throw new Error(`Native Verifier check ID ${plan.id} refers to conflicting commands`);
    }
    const existingKey = existingKeyById.get(plan.id);
    if (existingKey !== undefined && existingKey !== key) {
      throw new Error(`Native Verifier check ID ${plan.id} conflicts with a Runtime check`);
    }
    requestedKeyById.set(plan.id, key);
    const existing = existingByKeyAll.get(key);
    if (
      existing &&
      !existingByKey.has(key) &&
      existing.executionCount > 0 &&
      !existing.repeatable
    ) {
      throw new Error(
        `Native check ${existing.id} has no applicable passing evidence and is not repeatable; user resolution is required`,
      );
    }
    if (existing && existing.status !== 'passed' && existing.executionCount >= 3) {
      throw new Error(`Native check retry limit (3) reached: ${existing.id}`);
    }
    if (!requestedByKey.has(key)) requestedByKey.set(key, plan);
  }

  preflightNativeCheckPlans(options.projectRoot, [...requestedByKey.values()]);

  const requested = [...requestedByKey.entries()];
  const novel = requested.filter(([key]) => !existingByKey.has(key));
  if (local.execution.requestCheckRounds > 0 && novel.length === 0) {
    throw new Error('Native Verifier repeatedly requested only equivalent checks');
  }

  const round = local.execution.requestCheckRounds + 1;
  const requestedNames = new Map(requested.map(([, plan]) => [plan.id, plan.name] as const));
  const operation: NativeLocalExecutionState = {
    ...local,
    execution: {
      ...local.execution,
      stage: 'checking',
      actor: 'runtime',
      executionId: options.envelope.verifierExecutionRef,
      requestCheckRounds: round,
    },
    checks: [
      ...local.checks.map((check) => {
        const key = nativeLocalCheckPlanKey(check, options.projectRoot);
        const plan = requestedByKey.get(key);
        return plan && !existingByKey.has(key)
          ? resetNativeCheckForExecution(
              check,
              plan,
              local.execution!.operationId,
              options.projectRoot,
            )
          : check;
      }),
      ...novel
        .filter(([key]) => !existingByKeyAll.has(key))
        .map(([, plan]) => localCheck(plan, local.execution!.operationId, options.projectRoot)),
    ],
  };
  await writeNativeLocalExecution(file, operation, { containedRoot: options.paths.runtimeDir });

  return {
    state: options.state,
    local: operation,
    verifierExecutionRef: options.envelope.verifierExecutionRef,
    round,
    novelPlans: novel.map(([, plan]) => plan),
    requestedNames,
    reusedCheckIds: requested.filter(([key]) => existingByKey.has(key)).map(([, plan]) => plan.id),
    suppliedChecks: options.suppliedChecks,
  };
}

async function updateReservedVerifierRequestedChecks(options: {
  paths: NativeProjectPaths;
  reservation: NativeVerifierRequestedCheckReservation;
  update: (local: NativeLocalExecutionState) => NativeLocalExecutionState;
}): Promise<NativeLocalExecutionState> {
  return withNativeMutationLock(
    options.paths,
    `update Verifier-requested checks ${options.reservation.state.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.reservation.state.name);
      if (
        state.state_version !== options.reservation.state.state_version ||
        state.phase !== 'verify' ||
        state.loop.next_action !== 'await-verifier-result'
      ) {
        throw new Error('Native Verifier request-checks state changed during execution');
      }
      const file = nativeLocalExecutionFile(options.paths, state.name);
      const local = await readNativeLocalExecution(file);
      const execution = local?.execution;
      if (
        local === null ||
        local.basedOnStateVersion !== state.state_version ||
        execution === null ||
        execution === undefined ||
        execution.operationId !== options.reservation.local.execution?.operationId ||
        execution.stage !== 'checking' ||
        execution.actor !== 'runtime' ||
        execution.status !== 'running' ||
        execution.executionId !== options.reservation.verifierExecutionRef ||
        execution.requestCheckRounds !== options.reservation.round
      ) {
        throw new Error('Native Verifier request-checks reservation changed during execution');
      }
      const next = options.update(local);
      await writeNativeLocalExecution(file, next, { containedRoot: options.paths.runtimeDir });
      return next;
    },
  );
}

export async function executeReservedVerifierRequestedChecks(options: {
  paths: NativeProjectPaths;
  projectRoot: string;
  reservation: NativeVerifierRequestedCheckReservation;
}): Promise<{
  checks: NativePortableCheckSummary[];
  requestChecks: NativePortableRequestChecksOutcome;
}> {
  let operation: NativeLocalExecutionState;
  try {
    for (const plan of options.reservation.novelPlans) {
      const startedAt = new Date().toISOString();
      operation = await updateReservedVerifierRequestedChecks({
        paths: options.paths,
        reservation: options.reservation,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) =>
            check.id === plan.id
              ? {
                  ...check,
                  status: 'running',
                  executionCount: check.executionCount + 1,
                  startedAt,
                  activeProcess: { status: 'starting' as const },
                }
              : check,
          ),
        }),
      });
      const runtimeDir = nativePreferredChangeRuntimeDir(
        options.paths,
        options.reservation.state.name,
      );
      const result = await executeNativeCheck({
        projectRoot: options.projectRoot,
        runtimeDir,
        operationId: options.reservation.local.execution!.operationId,
        plan,
        onSpawn: async ({ pid }) => {
          const identity = await readProcessIdentity(pid);
          await updateReservedVerifierRequestedChecks({
            paths: options.paths,
            reservation: options.reservation,
            update: (local) => ({
              ...local,
              checks: local.checks.map((check) =>
                check.id === plan.id
                  ? {
                      ...check,
                      activeProcess: {
                        status: 'running' as const,
                        pid,
                        ...(identity ? { identity } : {}),
                      },
                    }
                  : check,
              ),
            }),
          });
        },
      });
      operation = await updateReservedVerifierRequestedChecks({
        paths: options.paths,
        reservation: options.reservation,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) => {
            if (check.id !== plan.id) return check;
            const completed = {
              ...check,
              status: result.status,
              exitCode: result.exitCode,
              startedAt: result.startedAt,
              completedAt: result.completedAt,
              log: result.logRef,
              activeProcess: null,
              evidence: 'runtime' as const,
            };
            return completed;
          }),
        }),
      });
    }

    operation = await updateReservedVerifierRequestedChecks({
      paths: options.paths,
      reservation: options.reservation,
      update: (local) => ({
        ...local,
        execution: {
          ...local.execution!,
          stage: 'verifying',
          actor: 'verifier',
          executionId: options.reservation.verifierExecutionRef,
        },
      }),
    });
  } catch (error) {
    if (isNativeCheckTerminationUnconfirmedError(error)) throw error;
    try {
      await updateReservedVerifierRequestedChecks({
        paths: options.paths,
        reservation: options.reservation,
        update: (local) => ({
          ...local,
          execution: { ...local.execution!, status: 'interrupted' },
          checks: local.checks.map((check) =>
            check.status === 'planned' || check.status === 'running'
              ? { ...check, status: 'interrupted' as const, activeProcess: null }
              : check,
          ),
        }),
      });
    } catch {
      // Preserve the original execution failure; recovery will inspect the overlay.
    }
    throw error;
  }
  return {
    checks: authoritativePortableChecks({
      local: operation,
      projectRoot: options.projectRoot,
      supplied: options.reservation.suppliedChecks,
      requestedNames: options.reservation.requestedNames,
    }),
    requestChecks: {
      round: options.reservation.round,
      reusedCheckIds: options.reservation.reusedCheckIds,
      executedCheckIds: options.reservation.novelPlans.map(({ id }) => id),
    },
  };
}
