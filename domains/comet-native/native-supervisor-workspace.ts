import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  inspectGitWorktree,
  isLocalGitBranch,
  listGitWorktreeRoots,
  resolveGitRef,
} from '../../platform/paths/git-worktree.js';
import { resolvePortablePath } from '../../platform/paths/portable-path.js';
import { runGitCommand } from '../../platform/process/git.js';
import {
  processInstanceMayBeAlive,
  readProcessIdentity,
} from '../../platform/process/process-identity.js';
import { atomicWriteJson } from './native-atomic-file.js';
import { canonicalHash } from './native-canonical-hash.js';
import {
  executeNativeCheck,
  preflightNativeCheckPlans,
  type NativeCheckPlan,
  type NativeExecutedCheck,
} from './native-check-executor.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { nativePreferredChangeRuntimeDir } from './native-paths.js';
import {
  completedNativeSupervisorCheckState,
  nativeSupervisorCheckInputFingerprint,
  nativeSupervisorCheckMachineId,
  nativeSupervisorExecutedCheckFromState,
  plannedNativeSupervisorCheckState,
} from './native-supervisor-check-binding.js';
import {
  cloneState,
  integrateNativeSupervisorChild,
  recordEvent,
  stableSupervisorIntegrationOrder,
  type NativeSupervisorCheckExecutionState,
  type NativeSupervisorIntegrationCheck,
  type NativeSupervisorState,
  type NativeSupervisorTask,
} from './native-supervisor-model.js';
import {
  nativeSupervisorRuntimeDir,
  readNativeSupervisorState,
  writeNativeSupervisorState,
} from './native-supervisor-state.js';
import type { CometProjectConfig, NativeProjectPaths } from './native-types.js';
import { nativeWorkspaceIsClean, removeNativeWorkspaceConfig } from './native-workspace-config.js';
import {
  prepareNativeWorkspace,
  type PreparedNativeWorkspace,
} from './native-workspace-preparation.js';

function isPathInside(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === '' || (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`));
}

export function nativeSupervisorIntegrationBranch(parent: string): string {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(parent)) {
    throw new Error(`Invalid Native Supervisor parent name: ${parent}`);
  }
  return `comet/supervisor/${parent}/integration`;
}

export function nativeSupervisorIntegrationWorktree(projectRoot: string, parent: string): string {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(parent)) {
    throw new Error(`Invalid Native Supervisor parent name: ${parent}`);
  }
  return resolvePortablePath(projectRoot, '.worktrees', `${parent}-integration`);
}

export function nativeSupervisorChildWorktree(
  projectRoot: string,
  parent: string,
  child: string,
): string {
  if (
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(parent) ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(child)
  ) {
    throw new Error('Native Supervisor parent and child names are invalid');
  }
  return resolvePortablePath(projectRoot, '.worktrees', `${parent}-${child}`);
}

export async function prepareNativeSupervisorIntegrationWorkspace(options: {
  projectRoot: string;
  parent: string;
  targetBranch: string;
  sourceConfig: CometProjectConfig | null;
}): Promise<PreparedNativeWorkspace> {
  const worktreePath = path.join('.worktrees', `${options.parent}-integration`);
  return prepareNativeWorkspace({
    projectRoot: options.projectRoot,
    name: `${options.parent}-integration`,
    isolation: 'worktree',
    changeBranch: nativeSupervisorIntegrationBranch(options.parent),
    targetBranch: options.targetBranch,
    worktreePath,
    sourceConfig: options.sourceConfig,
  });
}

export async function prepareNativeSupervisorChildWorkspace(options: {
  projectRoot: string;
  parent: string;
  child: string;
  targetBranch: string;
  sourceConfig: CometProjectConfig | null;
}): Promise<PreparedNativeWorkspace> {
  if (
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(options.parent) ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(options.child)
  ) {
    throw new Error('Native Supervisor parent and child names are invalid');
  }
  return prepareNativeWorkspace({
    projectRoot: options.projectRoot,
    name: `${options.parent}-${options.child}`,
    isolation: 'worktree',
    changeBranch: `comet/supervisor/${options.parent}/${options.child}`,
    targetBranch: options.targetBranch,
    worktreePath: path.join('.worktrees', `${options.parent}-${options.child}`),
    sourceConfig: options.sourceConfig,
  });
}

function supervisorRetryIds(value: readonly string[] | undefined): Set<string> | null {
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

export function refreshNativeSupervisorBuilderWorkspace(
  workspaceRoot: string,
  expectedBranch: string,
  integrationHead: string,
): void {
  const identity = inspectGitWorktree(workspaceRoot);
  if (!identity.isGitWorktree || identity.currentBranch !== expectedBranch) {
    throw new Error(`Native Supervisor child worktree identity is not ${expectedBranch}`);
  }
  if (!nativeWorkspaceIsClean(workspaceRoot)) {
    throw new Error(`Native Supervisor child worktree is not clean: ${workspaceRoot}`);
  }
  const currentHead = runGitCommand(workspaceRoot, ['rev-parse', 'HEAD']);
  if (currentHead === integrationHead) return;

  const integrationContainsCurrent = (() => {
    try {
      runGitCommand(workspaceRoot, ['merge-base', '--is-ancestor', currentHead, integrationHead]);
      return true;
    } catch {
      return false;
    }
  })();
  if (!integrationContainsCurrent) {
    throw new Error(
      `Native Supervisor child worktree ${workspaceRoot} cannot be refreshed from integration HEAD`,
    );
  }

  const childContainsIntegration = (() => {
    try {
      runGitCommand(workspaceRoot, ['merge-base', '--is-ancestor', integrationHead, currentHead]);
      return true;
    } catch {
      return false;
    }
  })();
  if (childContainsIntegration) {
    throw new Error(
      `Native Supervisor child worktree ${workspaceRoot} contains unintegrated commits`,
    );
  }
  runGitCommand(workspaceRoot, ['merge', '--ff-only', integrationHead]);
  const refreshedHead = runGitCommand(workspaceRoot, ['rev-parse', 'HEAD']);
  if (refreshedHead !== integrationHead) {
    throw new Error(`Native Supervisor child worktree did not reach integration HEAD`);
  }
}

export function assertNativeSupervisorIntegrationWorkspace(state: NativeSupervisorState): string {
  if (!nativeWorkspaceIsClean(state.integration.worktree)) {
    throw new Error('Native Supervisor integration worktree must be clean');
  }
  const root = runGitCommand(state.integration.worktree, ['rev-parse', '--show-toplevel']);
  if (path.resolve(root) !== path.resolve(state.integration.worktree)) {
    throw new Error('Native Supervisor integration worktree identity is invalid');
  }
  const branch = runGitCommand(state.integration.worktree, ['branch', '--show-current']);
  if (branch !== state.integration.branch) {
    throw new Error(
      `Native Supervisor integration branch mismatch: expected ${state.integration.branch}, got ${branch || '(detached)'}`,
    );
  }
  return runGitCommand(state.integration.worktree, ['rev-parse', 'HEAD']);
}

export function assertNativeSupervisorVerifierWorkspace(
  workspaceRoot: string,
  expectedBranch: string,
  expectedCommit: string,
): void {
  const identity = inspectGitWorktree(workspaceRoot);
  if (!identity.isGitWorktree || identity.currentBranch !== expectedBranch) {
    throw new Error(`Native Supervisor Verifier worktree identity is not ${expectedBranch}`);
  }
  if (!nativeWorkspaceIsClean(workspaceRoot)) {
    throw new Error(`Native Supervisor Verifier worktree is not clean: ${workspaceRoot}`);
  }
  const head = runGitCommand(workspaceRoot, ['rev-parse', 'HEAD']);
  if (head !== expectedCommit) {
    throw new Error('Native Supervisor Verifier worktree is not at its candidate commit');
  }
}

/**
 * Merge one verified Child into the dedicated integration worktree.
 *
 * Git is the source of truth for the resulting integration commit. A failed
 * merge deliberately leaves the worktree in place for diagnosis and does not
 * advance the persisted Supervisor state.
 */
export async function integrateNativeSupervisorChildWorkspace(options: {
  paths: NativeProjectPaths;
  state: NativeSupervisorState;
  name: string;
  checks: NativeSupervisorIntegrationCheck[];
  checkPlans?: NativeCheckPlan[];
  retryCheckIds?: readonly string[];
}): Promise<NativeSupervisorState> {
  const requestedRetryIds = supervisorRetryIds(options.retryCheckIds);
  const prepared = await withNativeMutationLock(
    options.paths,
    `integrate Native Supervisor child ${options.name}`,
    async () => {
      const persisted = await readNativeSupervisorState(options.paths, options.state.parent);
      const state = persisted ?? options.state;
      const previous = state.integration.checkExecution;
      if (previous?.status === 'running') {
        if (await processInstanceMayBeAlive(previous.ownerPid, previous.ownerIdentity)) {
          throw new Error(
            'Native Supervisor integration checks are already running; wait for the original execution',
          );
        }
        if (previous.activeProcess === undefined || previous.activeProcess?.status === 'starting') {
          throw new Error(
            'Native Supervisor integration check launch was interrupted; inspect the original check process before retrying',
          );
        }
        if (
          previous.activeProcess &&
          (await processInstanceMayBeAlive(
            previous.activeProcess.pid,
            previous.activeProcess.identity,
          ))
        ) {
          throw new Error(
            'Native Supervisor integration check process is still running after its owner stopped; wait for that process before retrying',
          );
        }
      }
      if (state.stateVersion !== options.state.stateVersion) {
        throw new Error('Native Supervisor state changed before integration; reload status first');
      }
      const child = state.children.find(({ name }) => name === options.name);
      if (!child) throw new Error(`Native Supervisor child ${options.name} does not exist`);
      // Keep integration deterministic using a stable topological order with
      // declaration order as the same-level tie-breaker.
      const nextInIntegrationOrder = stableSupervisorIntegrationOrder(state).find(
        ({ status }) => status !== 'integrated' && status !== 'archived',
      );
      if (nextInIntegrationOrder && nextInIntegrationOrder.name !== options.name) {
        throw new Error(
          `Native Supervisor integration order requires ${nextInIntegrationOrder.name} before ${options.name}`,
        );
      }
      if (child.status !== 'verified' || !child.verifiedCommit) {
        throw new Error(
          `Native Supervisor child ${options.name} must be verified before integration`,
        );
      }
      if (options.checkPlans) {
        if (options.checkPlans.some(({ repeatable }) => !repeatable))
          throw new Error(
            'Native Supervisor integration checks must be repeatable for safe recovery',
          );
        if (
          options.checkPlans.length === 0 ||
          new Set(options.checkPlans.map(({ id }) => id)).size !== options.checkPlans.length
        )
          throw new Error(
            'Native Supervisor integration requires non-empty checks with unique IDs',
          );
        // Do all command and platform validation before the integration check
        // reservation is persisted. Invalid plans must not consume a lease or
        // leave a recovery record behind.
        preflightNativeCheckPlans(state.integration.worktree, options.checkPlans);
        if (!child.verification?.receiptRef || !child.verification.execution)
          throw new Error(
            'Native Supervisor integration requires current Runtime verification evidence; reverify the child',
          );
        const { readNativeSupervisorCheckEvidence } =
          await import('./native-supervisor-evidence.js');
        const evidence = await readNativeSupervisorCheckEvidence({
          paths: options.paths,
          parent: state.parent,
          task: child.verification.execution,
          receiptRef: child.verification.receiptRef,
        });
        if (
          evidence.candidateCommit !== child.verifiedCommit ||
          evidence.checks.some(({ status }) => status !== 'passed')
        )
          throw new Error('Native Supervisor integration verification evidence is stale or failed');
      }
      let head = assertNativeSupervisorIntegrationWorkspace(state);
      const resumeExistingCheck =
        options.checkPlans !== undefined &&
        previous?.status === 'interrupted' &&
        previous.child === options.name &&
        previous.candidateCommit === child.verifiedCommit &&
        head !== state.integration.headCommit &&
        head === previous.integrationCommit;
      if (head !== state.integration.headCommit) {
        // A process can die after Git has committed the merge but before the
        // atomic Supervisor state write. Reconcile that fact instead of
        // attempting a second merge or rejecting the recoverable operation.
        const oldHeadIsAncestor = (() => {
          try {
            runGitCommand(state.integration.worktree, [
              'merge-base',
              '--is-ancestor',
              state.integration.headCommit,
              head,
            ]);
            return true;
          } catch {
            return false;
          }
        })();
        const verifiedIsAncestor = (() => {
          try {
            runGitCommand(state.integration.worktree, [
              'merge-base',
              '--is-ancestor',
              child.verifiedCommit,
              head,
            ]);
            return true;
          } catch {
            return false;
          }
        })();
        if (!oldHeadIsAncestor || !verifiedIsAncestor) {
          throw new Error(
            `Native Supervisor integration head drifted: expected ${state.integration.headCommit}, got ${head}`,
          );
        }
      }
      try {
        runGitCommand(state.integration.worktree, [
          'cat-file',
          '-e',
          `${child.verifiedCommit}^{commit}`,
        ]);
      } catch (error) {
        throw new Error(
          `Native Supervisor verified commit is unavailable: ${child.verifiedCommit}`,
          { cause: error },
        );
      }
      if (head === state.integration.headCommit && !resumeExistingCheck) {
        try {
          runGitCommand(state.integration.worktree, [
            'merge',
            '--no-ff',
            '--no-edit',
            child.verifiedCommit,
          ]);
        } catch (error) {
          throw new Error(
            `Native Supervisor integration conflict preserved in ${state.integration.worktree}`,
            { cause: error },
          );
        }
        head = runGitCommand(state.integration.worktree, ['rev-parse', 'HEAD']);
      }
      const integrationCommit = head;
      if (options.checkPlans) {
        const machineId = nativeSupervisorCheckMachineId();
        const inputFingerprint = await nativeSupervisorCheckInputFingerprint({
          kind: 'integration',
          parent: state.parent,
          child: options.name,
          runId: child.verification?.execution?.runId ?? `integration:${options.name}`,
          projectRoot: state.integration.worktree,
          candidateCommit: child.verifiedCommit,
          integrationCommit,
          contractHash: child.contractHash ?? null,
          plans: options.checkPlans,
          materials: [],
        });
        const key = canonicalHash('comet.native.supervisor-integration-plan.v2', {
          machineId,
          inputFingerprint,
        });
        const sameBinding =
          previous?.key === key &&
          previous.machineId === machineId &&
          previous.inputFingerprint === inputFingerprint &&
          previous.child === options.name &&
          previous.candidateCommit === child.verifiedCommit &&
          previous.integrationCommit === integrationCommit;
        if (requestedRetryIds) {
          if (!sameBinding || previous?.status !== 'interrupted') {
            throw new Error(
              'Native Supervisor integration retry requires the interrupted current plan on the same candidate, machine and workspace',
            );
          }
          assertSupervisorRetryableStates(
            previous.checkStates,
            options.checkPlans,
            requestedRetryIds,
          );
        } else if (previous?.status === 'interrupted' && sameBinding) {
          return { completed: state };
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
            : options.checkPlans.map(plannedNativeSupervisorCheckState);
        const checkStates = options.checkPlans.map(
          (plan) =>
            priorStates.find((check) => check.id === plan.id) ??
            plannedNativeSupervisorCheckState(plan),
        );
        const operationId = randomUUID();
        state.integration.checkExecution = {
          operationId,
          key,
          child: options.name,
          candidateCommit: child.verifiedCommit,
          integrationCommit,
          status: 'running',
          ownerPid: process.pid,
          ownerIdentity: (await readProcessIdentity(process.pid)) ?? undefined,
          startedAt: new Date().toISOString(),
          activeProcess: null,
          machineId,
          inputFingerprint,
          checkStates,
        };
        state.stateVersion += 1;
        await writeNativeSupervisorState(options.paths, state);
        return {
          pending: {
            state,
            candidateCommit: child.verifiedCommit,
            integrationCommit,
            operationId,
            key,
            machineId,
            inputFingerprint,
            plansToExecute: options.checkPlans.filter(
              (plan) => !requestedRetryIds || requestedRetryIds.has(plan.id),
            ),
          },
        };
      }
      const next = integrateNativeSupervisorChild(state, {
        name: options.name,
        integrationCommit,
        checks: options.checks,
      });
      await writeNativeSupervisorState(options.paths, next);
      return { completed: next };
    },
  );
  if (prepared.completed) return prepared.completed;
  const { state, candidateCommit, integrationCommit, operationId, key } = prepared.pending!;
  const { writeNativeVerificationReportSnapshot } = await import('./native-evidence-storage.js');
  const { createHash } = await import('node:crypto');
  const recordActiveProcess = async (
    activeProcess: NonNullable<NativeSupervisorTask['checkExecution']>['activeProcess'],
  ) =>
    withNativeMutationLock(
      options.paths,
      'record Supervisor integration check process',
      async () => {
        const current = await readNativeSupervisorState(options.paths, state.parent);
        const execution = current?.integration.checkExecution;
        if (
          !current ||
          execution?.operationId !== operationId ||
          execution.key !== key ||
          execution.status !== 'running'
        )
          throw new Error('Native Supervisor integration check operation is stale');
        if (activeProcess?.status === 'starting') {
          const check = execution.checkStates?.find(({ id }) => id === activeProcess.checkId);
          if (!check || check.status !== 'planned') {
            throw new Error(`Native Supervisor check ${activeProcess.checkId} is not planned`);
          }
          check.status = 'running';
          check.executionCount += 1;
          check.startedAt = new Date().toISOString();
          check.completedAt = null;
          check.logRef = null;
        }
        execution.activeProcess = activeProcess;
        current.stateVersion += 1;
        await writeNativeSupervisorState(options.paths, current);
      },
    );
  const recordCheckResult = async (result: NativeExecutedCheck) =>
    withNativeMutationLock(
      options.paths,
      'record Supervisor integration check result',
      async () => {
        const current = await readNativeSupervisorState(options.paths, state.parent);
        const execution = current?.integration.checkExecution;
        if (
          !current ||
          execution?.operationId !== operationId ||
          execution.key !== key ||
          execution.status !== 'running'
        )
          throw new Error('Native Supervisor integration check operation is stale');
        const check = execution.checkStates?.find(({ id }) => id === result.id);
        if (!check) throw new Error(`Native Supervisor check state is missing: ${result.id}`);
        Object.assign(check, completedNativeSupervisorCheckState(check, result));
        execution.activeProcess = null;
        current.stateVersion += 1;
        await writeNativeSupervisorState(options.paths, current);
      },
    );
  try {
    for (const plan of prepared.pending!.plansToExecute!) {
      await recordActiveProcess({ status: 'starting', checkId: plan.id });
      const result = await executeNativeCheck({
        projectRoot: state.integration.worktree,
        runtimeDir: nativePreferredChangeRuntimeDir(options.paths, state.parent),
        operationId,
        plan,
        onSpawn: async ({ pid }) =>
          recordActiveProcess({
            status: 'running',
            checkId: plan.id,
            pid,
            identity: (await readProcessIdentity(pid)) ?? undefined,
          }),
      });
      await recordCheckResult(result);
      if (result.status === 'interrupted') {
        throw new Error(
          `Native Supervisor integration check ${result.id} was interrupted; retry only the listed repeatable check after the process has exited`,
        );
      }
    }
    const latest = await readNativeSupervisorState(options.paths, state.parent);
    const latestExecution = latest?.integration.checkExecution;
    const checkStates = latestExecution?.checkStates;
    if (
      !latest ||
      !checkStates ||
      checkStates.some(({ status }) => !['passed', 'failed'].includes(status))
    ) {
      throw new Error(
        'Native Supervisor integration check plan remains incomplete; retry each interrupted check explicitly',
      );
    }
    const results = checkStates.map(nativeSupervisorExecutedCheckFromState);
    const text = JSON.stringify({
      schema: 'comet.native.supervisor-integration-checks.v1',
      parent: state.parent,
      child: options.name,
      candidateCommit,
      integrationCommit,
      operationId,
      planHash: key,
      results,
    });
    const receiptRef = await writeNativeVerificationReportSnapshot({
      paths: options.paths,
      name: state.parent,
      hash: createHash('sha256').update(text).digest('hex'),
      text,
    });
    const checks: NativeSupervisorIntegrationCheck[] = results.map((result) => ({
      name: result.name,
      status: result.status === 'interrupted' ? 'incomplete' : result.status,
      reason:
        result.status === 'passed'
          ? null
          : result.timedOut
            ? 'timed out'
            : `exit ${result.exitCode ?? result.signal ?? 'interrupted'}`,
      receiptRef,
    }));
    const unsuccessful = checks.filter(({ status }) => status !== 'passed');
    return await withNativeMutationLock(
      options.paths,
      'complete Supervisor integration checks',
      async () => {
        const current = await readNativeSupervisorState(options.paths, state.parent);
        const child = current?.children.find(({ name }) => name === options.name);
        const execution = current?.integration.checkExecution;
        if (
          !current ||
          !child ||
          execution?.operationId !== operationId ||
          execution.key !== key ||
          execution.status !== 'running' ||
          execution.child !== options.name ||
          execution.candidateCommit !== candidateCommit ||
          execution.integrationCommit !== integrationCommit ||
          child.verifiedCommit !== candidateCommit ||
          assertNativeSupervisorIntegrationWorkspace(current) !== integrationCommit
        )
          throw new Error('Native Supervisor integration changed during checks');
        execution.receiptRef = receiptRef;
        execution.checks = checks;
        if (unsuccessful.length > 0) {
          const message = `Native Supervisor integration checks did not pass (${unsuccessful.map(({ name, reason }) => `${name}: ${reason}`).join('; ')}); receipt ${receiptRef}`;
          execution.status = 'interrupted';
          execution.error = message;
          child.blocker = message;
          current.stateVersion += 1;
          await writeNativeSupervisorState(options.paths, current);
          throw new Error(message);
        }
        execution.status = 'completed';
        const next = integrateNativeSupervisorChild(current, {
          name: options.name,
          integrationCommit,
          checks,
        });
        await writeNativeSupervisorState(options.paths, next);
        return next;
      },
    );
  } catch (error) {
    await withNativeMutationLock(
      options.paths,
      'interrupt Supervisor integration checks',
      async () => {
        const current = await readNativeSupervisorState(options.paths, state.parent);
        const execution = current?.integration.checkExecution;
        if (
          current &&
          execution?.operationId === operationId &&
          execution.key === key &&
          execution.status === 'running'
        ) {
          execution.status = 'interrupted';
          execution.error = (error as Error).message;
          execution.activeProcess = null;
          for (const check of execution.checkStates ?? []) {
            if (check.status === 'planned' || check.status === 'running') {
              check.status = 'interrupted';
            }
          }
          current.stateVersion += 1;
          await writeNativeSupervisorState(options.paths, current);
        }
      },
    );
    throw error;
  }
}

/**
 * Bring a drifted target into the isolated integration branch. The target is
 * never modified here; the caller must rerun parent checks before delivery.
 */
export function assertNativeSupervisorTargetUnchanged(
  projectRoot: string,
  state: NativeSupervisorState,
): string {
  const target = resolveGitRef(projectRoot, state.integration.targetBranch);
  if (target !== state.integration.targetCommit) {
    throw new Error(
      `Native Supervisor target branch drifted: expected ${state.integration.targetCommit}, got ${target ?? '(missing)'}`,
    );
  }
  return target;
}

export async function refreshNativeSupervisorTarget(options: {
  paths: NativeProjectPaths;
  state: NativeSupervisorState;
}): Promise<NativeSupervisorState | null> {
  const target = resolveGitRef(options.paths.projectRoot, options.state.integration.targetBranch);
  if (!target || target === options.state.integration.targetCommit) return null;
  const state = options.state;
  const integrationHead = assertNativeSupervisorIntegrationWorkspace(state);
  if (integrationHead !== state.integration.headCommit) {
    throw new Error('Native Supervisor integration head changed before target refresh');
  }
  try {
    runGitCommand(state.integration.worktree, [
      'merge',
      '--no-edit',
      state.integration.targetBranch,
    ]);
  } catch (error) {
    throw new Error(
      `Native Supervisor target drift requires conflict resolution in ${state.integration.worktree}`,
      { cause: error },
    );
  }
  const headCommit = runGitCommand(state.integration.worktree, ['rev-parse', 'HEAD']);
  const next = cloneState(state);
  next.integration.headCommit = headCommit;
  next.finalVerification = { status: 'pending', summary: null };
  recordEvent(next, {
    kind: 'target-refreshed',
    child: null,
    runId: null,
    summary: `Target ${state.integration.targetBranch} was refreshed before delivery`,
  });
  next.stateVersion += 1;
  await writeNativeSupervisorState(options.paths, next);
  return next;
}

export async function finalizeNativeSupervisorDeliveryLocked(options: {
  paths: NativeProjectPaths;
  state: NativeSupervisorState;
  archiveOwnedPaths?: readonly string[];
}): Promise<{ state: NativeSupervisorState; targetRoot: string; targetCommit: string }> {
  const persisted = await readNativeSupervisorState(options.paths, options.state.parent);
  const state = persisted ?? options.state;
  if (state.stateVersion !== options.state.stateVersion) {
    throw new Error('Native Supervisor state changed before delivery; reload status first');
  }
  if (state.finalVerification.status !== 'passed') {
    throw new Error('Native Supervisor delivery requires a passed final verification');
  }
  const allChildrenIntegrated = state.children.every(
    ({ status }) => status === 'integrated' || status === 'archived',
  );
  if (!allChildrenIntegrated) {
    throw new Error('Native Supervisor delivery requires every child to be integrated');
  }
  const targetRoot = listGitWorktreeRoots(options.paths.projectRoot)
    .map((root) => path.resolve(root))
    .find((root) => inspectGitWorktree(root).currentBranch === state.integration.targetBranch);
  if (!targetRoot) {
    throw new Error(
      `Native Supervisor target branch worktree is unavailable: ${state.integration.targetBranch}`,
    );
  }
  const archiveOwned =
    path.resolve(targetRoot) === path.resolve(options.paths.projectRoot)
      ? [
          path
            .relative(targetRoot, path.join(options.paths.changesDir, state.parent))
            .replaceAll('\\', '/'),
          '.comet/current-change.json',
          ...(options.archiveOwnedPaths ?? []),
        ]
      : [];
  if (!nativeWorkspaceIsClean(targetRoot, archiveOwned)) {
    throw new Error(`Native Supervisor target worktree is not clean: ${targetRoot}`);
  }
  const targetHeadBeforeDelivery = runGitCommand(targetRoot, ['rev-parse', 'HEAD']);
  const targetContainsIntegration = (() => {
    try {
      runGitCommand(targetRoot, [
        'merge-base',
        '--is-ancestor',
        state.integration.headCommit,
        targetHeadBeforeDelivery,
      ]);
      return true;
    } catch {
      return false;
    }
  })();
  const alreadyDelivered = targetContainsIntegration;
  if (alreadyDelivered) {
    const plan = await loadOrPreflightNativeSupervisorCleanup({
      paths: options.paths,
      state,
      targetCommit: targetHeadBeforeDelivery,
    });
    await executeNativeSupervisorCleanup({ paths: options.paths, plan, targetRoot });
    if (state.children.every(({ status }) => status === 'archived')) {
      await clearNativeSupervisorCleanupJournal(options.paths, state.parent);
      return { state, targetRoot, targetCommit: targetHeadBeforeDelivery };
    }
    const next = cloneState(state);
    for (const child of next.children) child.status = 'archived';
    next.stateVersion += 1;
    await writeNativeSupervisorState(options.paths, next);
    await clearNativeSupervisorCleanupJournal(options.paths, state.parent);
    return { state: next, targetRoot, targetCommit: targetHeadBeforeDelivery };
  }

  const integrationHead = assertNativeSupervisorIntegrationWorkspace(state);
  if (integrationHead !== state.integration.headCommit) {
    throw new Error('Native Supervisor integration head changed after final verification');
  }
  const targetRefBeforeDelivery = resolveGitRef(
    options.paths.projectRoot,
    state.integration.targetBranch,
  );
  const targetAlreadyIncluded = (() => {
    if (!targetRefBeforeDelivery) return false;
    try {
      runGitCommand(state.integration.worktree, [
        'merge-base',
        '--is-ancestor',
        targetRefBeforeDelivery,
        integrationHead,
      ]);
      return true;
    } catch {
      return false;
    }
  })();
  if (targetRefBeforeDelivery !== integrationHead) {
    if (!targetAlreadyIncluded && targetRefBeforeDelivery !== state.integration.targetCommit) {
      const refreshed = await refreshNativeSupervisorTarget({ paths: options.paths, state });
      if (refreshed) {
        throw new Error(
          'Native Supervisor target changed; parent integration checks must be rerun before delivery',
        );
      }
    }
  }
  const cleanupPlan = await loadOrPreflightNativeSupervisorCleanup({
    paths: options.paths,
    state,
    targetCommit: integrationHead,
  });
  if (targetRefBeforeDelivery !== integrationHead) {
    runGitCommand(targetRoot, ['merge', '--ff-only', state.integration.branch]);
  }
  const targetCommit = runGitCommand(targetRoot, ['rev-parse', 'HEAD']);
  if (targetCommit !== integrationHead) {
    throw new Error('Native Supervisor target did not receive the verified integration head');
  }
  const next = cloneState(state);
  for (const child of next.children) child.status = 'archived';
  await executeNativeSupervisorCleanup({
    paths: options.paths,
    plan: cleanupPlan,
    targetRoot,
  });
  next.stateVersion += 1;
  await writeNativeSupervisorState(options.paths, next);
  await clearNativeSupervisorCleanupJournal(options.paths, state.parent);
  return { state: next, targetRoot, targetCommit };
}

interface NativeSupervisorCleanupPlan {
  parent: string;
  targetCommit: string;
  worktrees: string[];
  expectedBranches: Record<string, string>;
  branches: string[];
}

function nativeSupervisorCleanupJournalFile(
  paths: Pick<NativeProjectPaths, 'changesRuntimeDir'>,
  parent: string,
): string {
  return path.join(nativeSupervisorRuntimeDir(paths, parent), 'cleanup.json');
}

function preflightNativeSupervisorCleanup(options: {
  paths: NativeProjectPaths;
  state: NativeSupervisorState;
  targetCommit: string;
}): NativeSupervisorCleanupPlan {
  const roots = listGitWorktreeRoots(options.paths.projectRoot).map((root) => path.resolve(root));
  const currentRoot = path.resolve(process.cwd());
  const candidateSpecs = [
    {
      root: options.state.integration.worktree,
      branch: options.state.integration.branch,
    },
    ...options.state.children.map(({ name, projectRoot, task }) => ({
      root:
        projectRoot ??
        task?.projectRoot ??
        nativeSupervisorChildWorktree(
          inspectGitWorktree(options.paths.projectRoot).primaryWorktreeRoot ??
            options.paths.projectRoot,
          options.state.parent,
          name,
        ),
      branch: `comet/supervisor/${options.state.parent}/${name}`,
    })),
  ].map((candidate) => ({ ...candidate, root: path.resolve(candidate.root) }));
  const targetCommit = options.targetCommit;
  const branches = [
    options.state.integration.branch,
    ...options.state.children.map(({ name }) => `comet/supervisor/${options.state.parent}/${name}`),
  ];

  const registeredCandidates = candidateSpecs.flatMap((candidate) => {
    const registered = roots.find((root) => root === candidate.root);
    return registered ? [{ ...candidate, root: registered }] : [];
  });

  // Complete all safety checks before removing anything. A clean worktree is
  // not sufficient: its branch must also be fully contained in the delivered
  // target commit, otherwise cleanup would discard an unintegrated commit.
  for (const candidate of registeredCandidates) {
    if (isPathInside(candidate.root, currentRoot)) {
      throw new Error(`Native Supervisor cannot clean the current worktree: ${candidate.root}`);
    }
    if (!nativeWorkspaceIsClean(candidate.root)) {
      throw new Error(`Native Supervisor cleanup requires a clean worktree: ${candidate.root}`);
    }
    const branch = inspectGitWorktree(candidate.root).currentBranch;
    if (!branch) throw new Error(`Native Supervisor worktree is detached: ${candidate.root}`);
    if (branch !== candidate.branch) {
      throw new Error(
        `Native Supervisor cleanup found unexpected branch ${branch} for ${candidate.root}; expected ${candidate.branch}`,
      );
    }
    try {
      runGitCommand(options.paths.projectRoot, [
        'merge-base',
        '--is-ancestor',
        branch,
        targetCommit,
      ]);
    } catch {
      throw new Error(`Native Supervisor cleanup found unintegrated branch ${branch}`);
    }
  }
  for (const branch of branches) {
    if (!isLocalGitBranch(options.paths.projectRoot, branch)) continue;
    try {
      runGitCommand(options.paths.projectRoot, [
        'merge-base',
        '--is-ancestor',
        branch,
        targetCommit,
      ]);
    } catch {
      throw new Error(`Native Supervisor cleanup found unintegrated branch ${branch}`);
    }
  }

  return {
    parent: options.state.parent,
    targetCommit: options.targetCommit,
    worktrees: registeredCandidates.map(({ root }) => root),
    expectedBranches: Object.fromEntries(
      registeredCandidates.map(({ root, branch }) => [root, branch]),
    ),
    branches,
  };
}

async function loadOrPreflightNativeSupervisorCleanup(options: {
  paths: NativeProjectPaths;
  state: NativeSupervisorState;
  targetCommit: string;
}): Promise<NativeSupervisorCleanupPlan> {
  const journal = nativeSupervisorCleanupJournalFile(options.paths, options.state.parent);
  try {
    const parsed = JSON.parse(await fs.readFile(journal, 'utf8')) as NativeSupervisorCleanupPlan;
    if (
      parsed.parent === options.state.parent &&
      parsed.targetCommit === options.targetCommit &&
      Array.isArray(parsed.worktrees) &&
      parsed.expectedBranches &&
      typeof parsed.expectedBranches === 'object' &&
      Array.isArray(parsed.branches)
    ) {
      // A journal makes execution resumable, but it never bypasses the
      // safety preflight: a worktree may have become dirty while a previous
      // cleanup attempt was interrupted.
      const refreshed = preflightNativeSupervisorCleanup(options);
      return {
        parent: parsed.parent,
        targetCommit: parsed.targetCommit,
        worktrees: [...new Set([...parsed.worktrees, ...refreshed.worktrees])],
        expectedBranches: {
          ...parsed.expectedBranches,
          ...refreshed.expectedBranches,
        },
        branches: [...new Set([...parsed.branches, ...refreshed.branches])],
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const plan = preflightNativeSupervisorCleanup(options);
  await atomicWriteJson(journal, plan, { containedRoot: options.paths.changesRuntimeDir });
  return plan;
}

async function executeNativeSupervisorCleanup(options: {
  paths: NativeProjectPaths;
  plan: NativeSupervisorCleanupPlan;
  targetRoot: string;
}): Promise<void> {
  for (const worktree of options.plan.worktrees) {
    const registered = listGitWorktreeRoots(options.paths.projectRoot)
      .map((root) => path.resolve(root))
      .includes(path.resolve(worktree));
    if (!registered) continue;
    const expectedBranch = options.plan.expectedBranches[worktree];
    if (!expectedBranch) {
      throw new Error(`Native Supervisor cleanup has no expected branch for ${worktree}`);
    }
    const currentBranch = inspectGitWorktree(worktree).currentBranch;
    if (currentBranch !== expectedBranch) {
      throw new Error(
        `Native Supervisor cleanup found unexpected branch ${currentBranch ?? '(detached)'} for ${worktree}; expected ${expectedBranch}`,
      );
    }
    await removeNativeWorkspaceConfig(worktree);
    runGitCommand(options.paths.projectRoot, ['worktree', 'remove', worktree]);
  }
  for (const branch of options.plan.branches) {
    if (!isLocalGitBranch(options.paths.projectRoot, branch)) continue;
    runGitCommand(options.targetRoot, ['branch', '-d', branch]);
  }
}

async function clearNativeSupervisorCleanupJournal(
  paths: Pick<NativeProjectPaths, 'changesRuntimeDir'>,
  parent: string,
): Promise<void> {
  await fs.rm(nativeSupervisorCleanupJournalFile(paths, parent), { force: true });
}

export async function finalizeNativeSupervisorDelivery(options: {
  paths: NativeProjectPaths;
  state: NativeSupervisorState;
}): Promise<{ state: NativeSupervisorState; targetRoot: string; targetCommit: string }> {
  return withNativeMutationLock(
    options.paths,
    `deliver Native Supervisor ${options.state.parent}`,
    () => finalizeNativeSupervisorDeliveryLocked(options),
  );
}
