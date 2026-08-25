import { promises as fs } from 'node:fs';
import path from 'node:path';

import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';

import {
  readNativeLocalExecution,
  rebuildNativeLocalExecution,
  writeNativeLocalExecution,
} from './native-local-execution.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import {
  nativeLocalExecutionFile,
  nativePortableStateFile,
  ensureNativePortableReport,
  readNativePortableChange,
} from './native-portable-runtime.js';
import {
  appendNativePortableHistory,
  compareAndSwapNativePortableState,
  parseNativePortableState,
} from './native-portable-state.js';
import { returnNativeCandidateToBuild } from './native-loop-runtime.js';
import { toNativePortableText } from './native-portable-text.js';
import type { NativeLocalExecutionState, NativePortableState } from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';

export interface NativePortableRecoveryResult {
  state: NativePortableState;
  local: NativeLocalExecutionState | null;
  action: 'resume-stable-boundary' | 'reverify' | 'await-user' | 'done';
  reason:
    | 'available'
    | 'missing'
    | 'invalid'
    | 'stale'
    | 'interrupted'
    | 'workspace-mismatch'
    | 'done';
  message: string;
}

function workspaceMismatch(paths: NativeProjectPaths, state: NativePortableState): string | null {
  const context = inspectGitWorktree(paths.projectRoot);
  if (state.workspace.change_branch !== null) {
    if (!context.isGitWorktree) return 'The portable change requires a Git branch/worktree';
    if (context.currentBranch !== state.workspace.change_branch) {
      return `Expected Native change branch ${state.workspace.change_branch}, current branch is ${context.currentBranch ?? '(detached)'}`;
    }
  }
  if (state.workspace.isolation === 'current') return null;
  if (!context.isGitWorktree) return 'The portable change requires a Git branch/worktree';
  if (state.workspace.isolation === 'worktree' && !context.isSecondaryWorktree) {
    return 'The portable change requires its linked worktree';
  }
  return null;
}

function resetAcceptance(state: NativePortableState): NativePortableState['acceptance'] {
  return state.acceptance.map((entry) => ({ ...entry, result: 'pending', reason: null }));
}

function reverifyAfterMissingRuntime(
  state: NativePortableState,
  reason: string,
  reverifyAll: boolean,
): NativePortableState {
  const completedAt = new Date().toISOString();
  const historical =
    state.verification === null
      ? state
      : appendNativePortableHistory(state, {
          goal_cycle: state.loop.goal_cycle,
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          outcome: 'recovery',
          unresolved_ids: [],
          summary: toNativePortableText(reason),
          completed_at: completedAt,
        });
  return parseNativePortableState({
    ...historical,
    phase: 'verify',
    status: 'active',
    state_version: state.state_version + 1,
    acceptance: reverifyAll ? resetAcceptance(state) : state.acceptance,
    verification: null,
    verification_result: 'pending',
    verification_report: null,
    blockers: [],
    loop: {
      ...state.loop,
      stage: 'verify-ready',
      next_action: 'run-required-checks-and-dispatch-verifier',
    },
  });
}

async function inspectLocal(file: string): Promise<{
  local: NativeLocalExecutionState | null;
  reason: 'available' | 'missing' | 'invalid' | 'stale';
}> {
  try {
    const local = await readNativeLocalExecution(file);
    return local === null ? { local: null, reason: 'missing' } : { local, reason: 'available' };
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code &&
      (error as NodeJS.ErrnoException).code !== 'ENOENT'
    ) {
      throw error;
    }
    return { local: null, reason: 'invalid' };
  }
}

export async function recoverNativePortableChange(options: {
  paths: NativeProjectPaths;
  name: string;
  preserveRunningExecution?: boolean;
}): Promise<NativePortableRecoveryResult> {
  return withNativeMutationLock(
    options.paths,
    `recover portable change ${options.name}`,
    async () => {
      let state = await readNativePortableChange(options.paths, options.name);
      if (state.status === 'done') {
        await ensureNativePortableReport({ paths: options.paths, state });
        return {
          state,
          local: null,
          action: 'done',
          reason: 'done',
          message: 'Archived Native changes do not require a local execution overlay.',
        };
      }
      const mismatch = workspaceMismatch(options.paths, state);
      if (mismatch) {
        return {
          state,
          local: null,
          action: 'await-user',
          reason: 'workspace-mismatch',
          message: mismatch,
        };
      }

      const file = nativeLocalExecutionFile(options.paths, options.name);
      const inspected = await inspectLocal(file);
      let reason: NativePortableRecoveryResult['reason'] =
        inspected.reason === 'available' &&
        (inspected.local?.change !== state.name ||
          inspected.local?.basedOnStateVersion !== state.state_version)
          ? 'stale'
          : inspected.reason;
      const operationWasInterrupted =
        reason === 'available' &&
        !options.preserveRunningExecution &&
        inspected.local?.execution !== null &&
        inspected.local?.execution?.status !== 'completed';
      if (operationWasInterrupted && inspected.local) {
        reason = 'interrupted';
        if (inspected.local.execution?.status === 'running') {
          inspected.local = {
            ...inspected.local,
            execution: { ...inspected.local.execution, status: 'interrupted' },
            checks: inspected.local.checks.map((check) =>
              check.status === 'planned' || check.status === 'running'
                ? { ...check, status: 'interrupted' }
                : check,
            ),
          };
          await writeNativeLocalExecution(file, inspected.local, {
            containedRoot: options.paths.runtimeDir,
          });
        }
      }
      if (reason === 'available') {
        await ensureNativePortableReport({ paths: options.paths, state });
        return {
          state,
          local: inspected.local,
          action: 'resume-stable-boundary',
          reason,
          message: 'Native local execution overlay matches the portable state.',
        };
      }

      const unsafeInterruptedCheck =
        reason === 'interrupted'
          ? inspected.local?.checks.find(
              (check) => check.status === 'interrupted' && !check.repeatable,
            )
          : undefined;
      if (unsafeInterruptedCheck) {
        const next = returnNativeCandidateToBuild({
          state,
          reason: `Check ${unsafeInterruptedCheck.id} was interrupted and is not declared repeatable; a new Builder candidate is required before retrying.`,
        });
        state = await compareAndSwapNativePortableState({
          file: nativePortableStateFile(options.paths, state.name),
          expectedStateVersion: state.state_version,
          next,
          containedRoot: options.paths.nativeRoot,
        });
        await fs.rm(path.join(options.paths.changesDir, options.name, 'verification.md'), {
          force: true,
        });
        const local = rebuildNativeLocalExecution({
          portableState: state,
          projectRoot: options.paths.projectRoot,
          branch: state.workspace.change_branch,
        });
        await writeNativeLocalExecution(file, local, {
          containedRoot: options.paths.runtimeDir,
        });
        return {
          state,
          local,
          action: 'resume-stable-boundary',
          reason,
          message: `Native check ${unsafeInterruptedCheck.id} was not repeatable; the change returned to Build for a new candidate.`,
        };
      }

      const lostVerifier =
        state.phase === 'verify' && state.loop.next_action === 'await-verifier-result';
      const lostArchivePass =
        state.phase === 'archive' &&
        state.loop.stage === 'archive-ready' &&
        state.verification_result === 'pass';
      const mustReverify = lostVerifier || lostArchivePass;
      if (mustReverify) {
        const next = reverifyAfterMissingRuntime(
          state,
          lostArchivePass
            ? 'Local Runtime was unavailable at Archive ready; the synchronized implementation must be verified again.'
            : 'The previous Verifier execution was unavailable; dispatch a new attempt from the stable Verify boundary.',
          lostArchivePass,
        );
        state = await compareAndSwapNativePortableState({
          file: nativePortableStateFile(options.paths, state.name),
          expectedStateVersion: state.state_version,
          next,
          containedRoot: options.paths.nativeRoot,
        });
      }
      const local = rebuildNativeLocalExecution({
        portableState: state,
        projectRoot: options.paths.projectRoot,
        branch: inspectGitWorktree(options.paths.projectRoot).currentBranch,
      });
      await fs.mkdir(path.dirname(nativeLocalExecutionFile(options.paths, state.name)), {
        recursive: true,
      });
      await writeNativeLocalExecution(file, local, { containedRoot: options.paths.runtimeDir });
      await ensureNativePortableReport({ paths: options.paths, state });
      return {
        state,
        local,
        action: mustReverify ? 'reverify' : 'resume-stable-boundary',
        reason,
        message: mustReverify
          ? 'Rebuilt local execution from the portable boundary; previous pass/execution was not reused.'
          : `Rebuilt local execution from the portable ${state.phase}/${state.loop.stage} boundary.`,
      };
    },
  );
}
