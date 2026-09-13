import { promises as fs } from 'node:fs';
import { findNativeV1SupervisorParents, inspectNativeChildren } from './native-children.js';
import {
  advanceNativeSupervisorFinalVerificationHead,
  recordNativeSupervisorPortableFinalVerification,
} from './native-supervisor-coordinator.js';
import {
  readNativeSupervisorState,
  writeNativeSupervisorState,
} from './native-supervisor-state.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { readNativePortableTransaction } from './native-portable-transactions.js';
import type { NativePortableState } from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';
import { readNativePortableChange } from './native-portable-storage.js';
import { returnNativePortableStateToFinalVerificationLocked } from './native-portable-transitions.js';

export interface NativeSupervisorParentAdvance {
  trigger: 'v2-integrate' | 'v1-archive' | 'recovery';
  parent: string | null;
  advanced: boolean;
  message: string | null;
  blocker: string | null;
}

/**
 * Recompute whether every Child is integrated and the parent is ready for a
 * Builder handoff. This inspection does not advance the phase.
 */
export async function inspectNativeSupervisorParentReviewReadiness(options: {
  paths: NativeProjectPaths;
  name: string;
  trigger: NativeSupervisorParentAdvance['trigger'];
}): Promise<{ state: NativePortableState; parentAdvance: NativeSupervisorParentAdvance }> {
  const state = await readNativePortableChange(options.paths, options.name);
  const base = {
    trigger: options.trigger,
    parent: options.name,
    advanced: false,
    message: null,
    blocker: null,
  } satisfies NativeSupervisorParentAdvance;
  if (state.phase !== 'build' || state.status !== 'active') {
    return { state, parentAdvance: base };
  }
  const children = await inspectNativeChildren({ paths: options.paths, state });
  if (!children || !children.confirmed || !children.allDone) {
    return {
      state,
      parentAdvance: {
        ...base,
        blocker:
          children && !children.confirmed
            ? 'Supervisor child declarations require Shape confirmation'
            : null,
      },
    };
  }
  if (state.loop.stage === 'repairing' && state.verification_result === 'fail') {
    return {
      state,
      parentAdvance: {
        ...base,
        blocker: 'Native parent verification failed; add and confirm a repair child',
      },
    };
  }
  const message =
    state.language === 'zh-CN'
      ? '全部 Child 已完成；Supervisor 父级候选可以提交并进入验证'
      : 'All Children are complete; the Supervisor parent candidate can be submitted for verification.';
  return {
    state,
    parentAdvance: {
      ...base,
      message,
    },
  };
}

export async function tryAutoAdvanceNativeV1SupervisorParent(options: {
  childState: NativePortableState;
  childPaths: NativeProjectPaths;
}): Promise<{
  parentAdvance: NativeSupervisorParentAdvance;
  parentState: NativePortableState | null;
}> {
  const discovery = await findNativeV1SupervisorParents({
    paths: options.childPaths,
    childName: options.childState.name,
    targetBranch: options.childState.workspace.target_branch,
  });
  if (!discovery.candidate) {
    return {
      parentState: null,
      parentAdvance: {
        trigger: 'v1-archive',
        parent: null,
        advanced: false,
        message: null,
        blocker: discovery.blockers.length > 0 ? discovery.blockers.join('; ') : null,
      },
    };
  }
  const result = await inspectNativeSupervisorParentReviewReadiness({
    paths: discovery.candidate.paths,
    name: discovery.candidate.state.name,
    trigger: 'v1-archive',
  });
  return { parentState: result.state, parentAdvance: result.parentAdvance };
}

export interface NativeSupervisorFinalVerificationResumeResult {
  state: NativePortableState;
  action: 'none' | 'rerun-final-verification' | 'recorded-final-verification';
}

export async function recoverNativeSupervisorFinalVerificationLocked(options: {
  paths: NativeProjectPaths;
  name: string;
}): Promise<NativeSupervisorFinalVerificationResumeResult> {
  const state = await readNativePortableChange(options.paths, options.name);
  const transaction = await readNativePortableTransaction(options.paths, {
    kind: 'archive',
    change: options.name,
  });
  const archiveTransaction = transaction?.kind === 'archive' ? transaction : null;
  if (
    !archiveTransaction &&
    (state.archived || state.verification === null || state.verification_result !== 'pass')
  ) {
    // There is no final result to replay. In particular, Build must still reach
    // requirements recovery when a legacy Supervisor contract is unavailable.
    return { state, action: 'none' };
  }
  const supervisor = await readNativeSupervisorState(options.paths, options.name);
  if (archiveTransaction && supervisor?.finalVerification.status === 'pending') {
    if (
      archiveTransaction.journal.status !== 'prepared' ||
      archiveTransaction.journal.next_spec_index !== 0
    ) {
      throw new Error(
        'Native Supervisor final verification changed after Archive applied side effects; doctor intervention is required',
      );
    }
    if (
      state.phase === 'verify' &&
      state.status === 'active' &&
      state.verification === null &&
      state.verification_result === 'pending' &&
      state.loop.stage === 'verify-ready'
    ) {
      await fs.rm(archiveTransaction.file, { force: true });
      return { state, action: 'rerun-final-verification' };
    }
  }
  if (
    state.archived ||
    state.verification === null ||
    state.verification_result !== 'pass' ||
    supervisor?.finalVerification.status !== 'pending'
  ) {
    return { state, action: 'none' };
  }

  const advanced = advanceNativeSupervisorFinalVerificationHead(supervisor);
  if (archiveTransaction || advanced.stateVersion !== supervisor.stateVersion) {
    const recovered = await returnNativePortableStateToFinalVerificationLocked({
      paths: options.paths,
      state,
      reason:
        'Supervisor final verification was not bound to the current integration commit; the final full verification will resume automatically.',
    });
    if (archiveTransaction) {
      await fs.rm(archiveTransaction.file, { force: true });
    }
    return { state: recovered, action: 'rerun-final-verification' };
  }

  await writeNativeSupervisorState(
    options.paths,
    recordNativeSupervisorPortableFinalVerification(supervisor, state),
  );
  return { state, action: 'recorded-final-verification' };
}

/**
 * Repair an interrupted Supervisor final-verification write as part of normal
 * Native continuation. No recovery flag or direct state edit is required.
 */
export async function recoverNativeSupervisorFinalVerificationOnResume(options: {
  paths: NativeProjectPaths;
  name: string;
}): Promise<NativeSupervisorFinalVerificationResumeResult> {
  return withNativeMutationLock(
    options.paths,
    `recover Supervisor final verification ${options.name}`,
    () => recoverNativeSupervisorFinalVerificationLocked(options),
    { allowedPortableTransaction: { kind: 'archive', change: options.name } },
  );
}
