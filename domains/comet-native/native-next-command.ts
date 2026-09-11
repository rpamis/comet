import { inspectNativeChildren } from './native-children.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import { migrateNativeLegacyChangeToPortable } from './native-portable-migration-runtime.js';
import {
  nativePortableWorkspaceMismatch,
  recoverNativePortableChange,
  type NativePortableRecoveryResult,
} from './native-portable-recovery.js';
import { nativePortableStateSummary } from './native-portable-summary.js';
import {
  applyNativeRunnerInput,
  readNativeRunnerInput,
  validateNativeRunnerInputBoundary,
} from './native-runner-input.js';
import { NATIVE_SKILL_COORDINATION } from './native-runner-protocol.js';
import {
  dispatchNativeSupervisorReadyTasks,
  projectNativeSupervisorTask,
  readNativeSupervisorState,
} from './native-supervisor.js';
import {
  confirmNativePortableShape,
  confirmNativePortableSkillCoordinatedPass,
  confirmNativePortableVerifierUnavailable,
  inspectNativePortableAcceptanceDrift,
  isNativePortableChange,
  prepareNativePortableShapeConfirmation,
  readNativePortableChange,
  recoverNativeSupervisorFinalVerificationOnResume,
  resolveNativePortableVerifierBlocker,
  returnNativePortableChangeToBuild,
  returnNativePortableChangeToShape,
  retryNativePortableVerifier,
  inspectNativeSupervisorParentReviewReadiness,
  type NativePortableExpectedContinuation,
  type NativePortableExpectedContinuationAction,
} from './native-portable-runtime.js';
import {
  NATIVE_SUPERVISOR_COORDINATION_MODES,
  type NativePortableState,
  type NativeSupervisorCoordinationMode,
} from './native-portable-types.js';
import {
  assertNoArguments,
  configuredPaths,
  errorResult,
  NativeUsageError,
  requiredPositional,
  success,
  takeFlag,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';
import type { NativeProjectPaths } from './native-types.js';

const EXPECTED_CONTINUATION_ACTIONS = new Set<NativePortableExpectedContinuationAction>([
  'prepare-shape-confirmation',
  'confirm-shape',
  'accept-result',
  'confirm-verifier-unavailable',
  'revise-implementation',
  'revise-requirements',
  'retry-verifier',
  'resolve-verifier-blocker',
]);

function expectedContinuationOption(
  args: string[],
): NativePortableExpectedContinuation | undefined {
  const stateVersion = takeOption(args, '--expected-state-version');
  const action = takeOption(args, '--expected-action');
  if (stateVersion === undefined && action === undefined) return undefined;
  if (stateVersion === undefined || action === undefined) {
    throw new NativeUsageError(
      '--expected-state-version and --expected-action must be provided together',
    );
  }
  if (!/^[1-9]\d*$/u.test(stateVersion) || !Number.isSafeInteger(Number(stateVersion))) {
    throw new NativeUsageError('--expected-state-version must be a positive integer');
  }
  if (!EXPECTED_CONTINUATION_ACTIONS.has(action as NativePortableExpectedContinuationAction)) {
    throw new NativeUsageError('--expected-action is not a recognized Native continuation action');
  }
  return {
    stateVersion: Number(stateVersion),
    action: action as NativePortableExpectedContinuationAction,
  };
}

async function portableParentView(
  paths: NativeProjectPaths,
  state: NativePortableState,
  verifierExecutionRef?: string,
) {
  const children = await inspectNativeChildren({ paths, state });
  const supervisor = children?.confirmed
    ? await readNativeSupervisorState(paths, state.name, { diagnostics: true })
    : null;
  const activeTasks = supervisor?.children.flatMap(({ task }) => (task ? [task.child] : [])) ?? [];
  const integrationExecution = supervisor?.integration.checkExecution;
  const supervisorIntegrationRetryIds =
    integrationExecution?.status === 'interrupted'
      ? (integrationExecution.checkStates ?? [])
          .filter(({ status }) => status === 'interrupted')
          .map(({ id }) => id)
      : undefined;
  return {
    ...(children
      ? {
          childSummary: children.children.reduce<Record<string, number>>(
            (summary, child) => ({ ...summary, [child.status]: (summary[child.status] ?? 0) + 1 }),
            { total: children.children.length },
          ),
          readyChildren: activeTasks.length > 0 ? activeTasks : children.readyChildren,
        }
      : {}),
    continuation: nativePortableContinuation(state, children, {
      verifierExecutionRef,
      supervisorIntegrationRetryIds,
    }),
  };
}

function compactRunnerResult<T extends { state: NativePortableState }>(result: T) {
  return Object.fromEntries(
    Object.entries(result).filter(
      ([key]) => key !== 'state' && key !== 'response' && key !== 'supervisorState',
    ),
  ) as Omit<T, 'state' | 'response' | 'supervisorState'>;
}

function compactRecoveryResult(recovery: NativePortableRecoveryResult) {
  return {
    action: recovery.action,
    reason: recovery.reason,
    message: recovery.message,
  };
}

export async function nativeNextCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const name = requiredPositional(args, 'change name');
  const summary = takeOption(args, '--summary');
  const runnerInputFile = takeOption(args, '--runner-input');
  const validateOnly = takeFlag(args, '--validate-only');
  const confirmed = takeFlag(args, '--confirmed');
  const acceptResult = takeFlag(args, '--accept-result');
  const reviseImplementation = takeFlag(args, '--revise-implementation');
  const reviseRequirements = takeFlag(args, '--revise-requirements');
  const retryVerifier = takeFlag(args, '--retry-verifier');
  const resolveVerifierBlocker = takeFlag(args, '--resolve-verifier-blocker');
  const coordinationModeText = takeOption(args, '--coordination-mode');
  const coordinationMode = coordinationModeText as NativeSupervisorCoordinationMode | undefined;
  if (
    coordinationModeText !== undefined &&
    !(NATIVE_SUPERVISOR_COORDINATION_MODES as readonly string[]).includes(coordinationModeText)
  ) {
    throw new NativeUsageError('--coordination-mode must be multi-session or single-session');
  }
  if (validateOnly && runnerInputFile === undefined) {
    throw new NativeUsageError('--validate-only requires --runner-input');
  }
  const maxParallelText = takeOption(args, '--max-parallel');
  const maxParallel = maxParallelText === undefined ? 2 : Number(maxParallelText);
  if (!Number.isSafeInteger(maxParallel) || maxParallel < 1) {
    throw new NativeUsageError('--max-parallel must be a positive integer');
  }
  const expectedContinuation = expectedContinuationOption(args);
  if (
    [
      confirmed,
      acceptResult,
      reviseImplementation,
      reviseRequirements,
      retryVerifier,
      resolveVerifierBlocker,
    ].filter(Boolean).length > 1
  ) {
    throw new NativeUsageError(
      '--confirmed, --accept-result, --revise-implementation, --revise-requirements, --retry-verifier, and --resolve-verifier-blocker are mutually exclusive',
    );
  }
  if (
    coordinationMode !== undefined &&
    (confirmed ||
      acceptResult ||
      reviseImplementation ||
      reviseRequirements ||
      retryVerifier ||
      resolveVerifierBlocker ||
      runnerInputFile !== undefined)
  ) {
    throw new NativeUsageError(
      '--coordination-mode is only valid when preparing a Supervisor Shape confirmation',
    );
  }
  // Agent-authored Build/Verify completion fields retired with Native v4.
  // Parsing the complete public surface before migration prevents a legacy
  // invocation from silently accepting one of those old fields.
  assertNoArguments(args);

  const configured = await configuredPaths(projectRoot);
  if (!(await isNativePortableChange(configured.paths, name))) {
    if (runnerInputFile) {
      throw new NativeUsageError('--runner-input is only valid for portable Native changes');
    }
    if (!summary) throw new NativeUsageError('--summary is required');
    // The first mutating command on a legacy active change performs the
    // deterministic migration and stops at the resulting stable boundary.
    const state = await migrateNativeLegacyChangeToPortable({
      paths: configured.paths,
      name,
    });
    return success('next', {
      state: nativePortableStateSummary(state, configured.paths),
      migration: { completed: true, summary },
      continuation: nativePortableContinuation(state),
    });
  }

  const initialState = await readNativePortableChange(configured.paths, name);
  if (validateOnly) {
    if (
      summary ||
      confirmed ||
      acceptResult ||
      reviseImplementation ||
      reviseRequirements ||
      retryVerifier ||
      resolveVerifierBlocker ||
      expectedContinuation ||
      coordinationMode !== undefined
    ) {
      throw new NativeUsageError(
        '--validate-only cannot be combined with --summary, continuation expectations, or coordination mode',
      );
    }
    let input;
    try {
      input = await readNativeRunnerInput(runnerInputFile!, projectRoot);
    } catch (error) {
      return {
        ...errorResult('next', error),
        data: {
          state: nativePortableStateSummary(initialState, configured.paths),
          continuation: nativePortableContinuation(initialState),
        },
      };
    }
    try {
      await validateNativeRunnerInputBoundary({
        paths: configured.paths,
        name,
        state: initialState,
        input,
        projectRoot,
      });
    } catch (error) {
      return {
        ...errorResult('next', error),
        data: {
          state: nativePortableStateSummary(initialState, configured.paths),
          continuation: nativePortableContinuation(initialState),
        },
      };
    }
    return success('next', {
      validation: { valid: true, kind: input.kind },
      state: nativePortableStateSummary(initialState, configured.paths),
      continuation: nativePortableContinuation(initialState),
    });
  }
  const initialWorkspaceMismatch = nativePortableWorkspaceMismatch(configured.paths, initialState);
  if (initialWorkspaceMismatch) {
    const continuation = nativePortableContinuation(initialState);
    const instruction =
      initialState.language === 'zh-CN'
        ? `先恢复此需求绑定的工作区和分支，再运行 comet native status ${name} --json 获取下一步；当前操作未推进状态，不要重复请求验收确认。`
        : `Restore the workspace and branch bound to this change, then run comet native status ${name} --json for the next action. No transition occurred; do not request acceptance again.`;
    return success('next', {
      state: nativePortableStateSummary(initialState, configured.paths),
      ...(await portableParentView(configured.paths, initialState)),
      recovery: {
        action: 'await-user',
        reason: 'workspace-mismatch',
        message: initialWorkspaceMismatch,
      },
      continuation: {
        ...continuation,
        disposition: 'blocked',
        requiresUserDecision: false,
        action: 'repair',
        commandArgs: null,
        commandAlternatives: [],
        requiredInputs: [],
        inputOptions: [],
        runnerAction: { ...continuation.runnerAction, kind: 'none' },
        userCommunication: {
          required: true,
          message: `${initialWorkspaceMismatch}. ${instruction}`,
          suggestedReply: null,
          agentInstruction: instruction,
        },
      },
    });
  }

  if (runnerInputFile) {
    if (
      summary ||
      confirmed ||
      acceptResult ||
      reviseImplementation ||
      reviseRequirements ||
      retryVerifier ||
      resolveVerifierBlocker ||
      coordinationMode !== undefined ||
      expectedContinuation
    ) {
      throw new NativeUsageError(
        '--runner-input cannot be combined with --summary, continuation expectations, or Agent transition flags',
      );
    }
    const supervisorRecovery = await recoverNativeSupervisorFinalVerificationOnResume({
      paths: configured.paths,
      name,
    });
    if (supervisorRecovery.action === 'rerun-final-verification') {
      return success('next', {
        state: nativePortableStateSummary(supervisorRecovery.state, configured.paths),
        ...(await portableParentView(configured.paths, supervisorRecovery.state)),
      });
    }
    const recovery = await recoverNativePortableChange({
      paths: configured.paths,
      name,
      preserveRunningExecution: true,
    });
    const current = recovery.state;
    if (
      recovery.action === 'await-user' ||
      recovery.action === 'done' ||
      recovery.reason !== 'available'
    ) {
      return success('next', {
        state: nativePortableStateSummary(current, configured.paths),
        recovery: compactRecoveryResult(recovery),
        ...(await portableParentView(configured.paths, current)),
      });
    }
    if (current.phase === 'build') {
      const drift = await inspectNativePortableAcceptanceDrift({
        paths: configured.paths,
        state: current,
      });
      if (drift.drifted) {
        const state = await returnNativePortableChangeToShape({
          paths: configured.paths,
          name,
          reason: drift.reason ?? 'Native confirmed requirements changed',
        });
        return success('next', {
          state: nativePortableStateSummary(state, configured.paths),
          ...(await portableParentView(configured.paths, state)),
        });
      }
      const supervisor = await readNativeSupervisorState(configured.paths, name);
      const children = await inspectNativeChildren({ paths: configured.paths, state: current });
      if (children && !children.allDone && !supervisor) {
        throw new NativeUsageError(
          'Native parent Build advances child changes and does not accept a Builder handoff',
        );
      }
    }
    let input;
    try {
      input = await readNativeRunnerInput(runnerInputFile, projectRoot);
    } catch (error) {
      const failure = errorResult('next', error);
      return {
        ...failure,
        data: {
          state: nativePortableStateSummary(current, configured.paths),
          ...(await portableParentView(configured.paths, current)),
        },
      };
    }
    const result = await applyNativeRunnerInput({
      paths: configured.paths,
      name,
      input,
      maxVerifyFailures: configured.config.native.max_verify_failures,
    });
    return success('next', {
      ...compactRunnerResult(result),
      state: nativePortableStateSummary(result.state, configured.paths),
      ...(await portableParentView(
        configured.paths,
        result.state,
        result.verifierDispatch?.verifierExecutionRef,
      )),
      coordination: NATIVE_SKILL_COORDINATION,
    });
  }
  const supervisorRecovery = await recoverNativeSupervisorFinalVerificationOnResume({
    paths: configured.paths,
    name,
  });
  if (supervisorRecovery.action === 'rerun-final-verification') {
    return success('next', {
      state: nativePortableStateSummary(supervisorRecovery.state, configured.paths),
      ...(await portableParentView(configured.paths, supervisorRecovery.state)),
    });
  }
  const recovery = await recoverNativePortableChange({ paths: configured.paths, name });
  const current = recovery.state;
  if (coordinationMode !== undefined && current.phase !== 'shape') {
    throw new NativeUsageError('--coordination-mode is only valid when confirming Shape');
  }
  if (!summary) throw new NativeUsageError('--summary is required');
  let state;
  let parentAdvance: Awaited<
    ReturnType<typeof inspectNativeSupervisorParentReviewReadiness>
  > | null = null;
  if (confirmed) {
    if (
      current.phase === 'shape' &&
      current.status === 'await-user' &&
      current.loop.next_action === 'confirm-shape'
    ) {
      if (!expectedContinuation) {
        throw new NativeUsageError(
          '--expected-state-version and --expected-action are required for Shape confirmation',
        );
      }
      state = await confirmNativePortableShape({
        paths: configured.paths,
        name,
        expectedContinuation,
      });
    } else if (current.phase === 'shape') {
      throw new NativeUsageError(
        '--confirmed is only valid from the persisted Shape user confirmation boundary',
      );
    } else if (
      current.phase === 'verify' &&
      current.status === 'await-user' &&
      current.loop.next_action === 'confirm-verifier-unavailable'
    ) {
      state = await confirmNativePortableVerifierUnavailable({
        paths: configured.paths,
        name,
        summary,
        expectedContinuation,
      });
    } else {
      throw new NativeUsageError(
        '--confirmed is only valid in Shape or for a user-accepted degraded verification fallback',
      );
    }
  } else if (acceptResult) {
    if (
      !expectedContinuation &&
      (current.phase !== 'verify' ||
        current.status !== 'await-user' ||
        current.loop.next_action !== 'confirm-skill-coordinated-pass')
    ) {
      throw new NativeUsageError(
        '--accept-result is only valid for a pending Verify pass decision',
      );
    }
    state = await confirmNativePortableSkillCoordinatedPass({
      paths: configured.paths,
      name,
      expectedContinuation,
    });
  } else if (reviseImplementation) {
    if (current.phase !== 'verify') {
      throw new NativeUsageError('--revise-implementation is only valid from Verify');
    }
    state = await returnNativePortableChangeToBuild({
      paths: configured.paths,
      name,
      reason: summary,
      expectedContinuation,
    });
  } else if (reviseRequirements) {
    if (!expectedContinuation && current.phase !== 'verify' && current.phase !== 'archive') {
      throw new NativeUsageError('--revise-requirements is only valid from Verify or Archive');
    }
    state = await returnNativePortableChangeToShape({
      paths: configured.paths,
      name,
      reason: summary,
      allowedPhases: ['verify', 'archive'],
      expectedContinuation,
    });
  } else if (retryVerifier) {
    state = await retryNativePortableVerifier({
      paths: configured.paths,
      name,
      expectedContinuation,
    });
  } else if (resolveVerifierBlocker) {
    state = await resolveNativePortableVerifierBlocker({
      paths: configured.paths,
      name,
      reason: summary,
      expectedContinuation,
    });
  } else {
    if (recovery.reason !== 'available') {
      return success('next', {
        state: nativePortableStateSummary(current, configured.paths),
        recovery: compactRecoveryResult(recovery),
        ...(await portableParentView(configured.paths, current)),
      });
    }
    if (current.phase === 'build') {
      const drift = await inspectNativePortableAcceptanceDrift({
        paths: configured.paths,
        state: current,
      });
      if (drift.drifted) {
        state = await returnNativePortableChangeToShape({
          paths: configured.paths,
          name,
          reason: drift.reason ?? 'Native confirmed requirements changed',
        });
      } else {
        const children = await inspectNativeChildren({ paths: configured.paths, state: current });
        if (children) {
          let effectiveChildren = children;
          let supervisorTasks = [] as Awaited<
            ReturnType<typeof dispatchNativeSupervisorReadyTasks>
          >['tasks'];
          let supervisorBlockers: Array<{ child: string; message: string }> = [];
          let readySupervisorChildren: string[] | null = null;
          const supervisor = await readNativeSupervisorState(configured.paths, name);
          if (supervisor && !children.allDone) {
            const dispatched = await dispatchNativeSupervisorReadyTasks({
              paths: configured.paths,
              parent: name,
              maxParallel: current.coordination_mode === 'single-session' ? 1 : maxParallel,
            });
            supervisorTasks = dispatched.state.children.flatMap(({ task }) =>
              task ? [projectNativeSupervisorTask(task, name, configured.paths.projectRoot)] : [],
            );
            readySupervisorChildren = dispatched.tasks.map(({ child }) => child);
            supervisorBlockers = dispatched.state.children.flatMap(({ name: child, blocker }) =>
              blocker ? [{ child, message: blocker }] : [],
            );
            if (
              supervisorTasks.length > 0 ||
              dispatched.state.stateVersion !== supervisor.stateVersion
            ) {
              effectiveChildren =
                (await inspectNativeChildren({ paths: configured.paths, state: current })) ??
                effectiveChildren;
            }
          }
          if (
            effectiveChildren.allDone &&
            !(current.loop.stage === 'repairing' && current.verification_result === 'fail')
          ) {
            parentAdvance = await inspectNativeSupervisorParentReviewReadiness({
              paths: configured.paths,
              name,
              trigger: 'recovery',
            });
            state = parentAdvance.state;
          } else {
            return success('next', {
              state: nativePortableStateSummary(current, configured.paths),
              childSummary: effectiveChildren.children.reduce<Record<string, number>>(
                (childSummary, child) => ({
                  ...childSummary,
                  [child.status]: (childSummary[child.status] ?? 0) + 1,
                }),
                { total: effectiveChildren.children.length },
              ),
              readyChildren: readySupervisorChildren ?? effectiveChildren.readyChildren,
              ...(supervisorTasks.length > 0 ? { supervisorTasks } : {}),
              ...(supervisorBlockers.length > 0 ? { supervisorBlockers } : {}),
              continuation: nativePortableContinuation(current, effectiveChildren),
            });
          }
        }
      }
    }
    if (current.phase === 'shape') {
      state = await prepareNativePortableShapeConfirmation({
        paths: configured.paths,
        name,
        ...(coordinationMode === undefined ? {} : { coordinationMode }),
        expectedContinuation,
      });
    }
    if (state) {
      return success('next', {
        state: nativePortableStateSummary(state, configured.paths),
        ...(parentAdvance ? { parentAdvance: parentAdvance.parentAdvance } : {}),
        ...(await portableParentView(configured.paths, state)),
      });
    }
    const continuationChildren =
      current.phase === 'shape'
        ? await inspectNativeChildren({ paths: configured.paths, state: current })
        : null;
    return {
      command: 'next',
      exitCode: 65,
      data: {
        state: nativePortableStateSummary(current, configured.paths),
        continuation: nativePortableContinuation(current, continuationChildren),
      },
      error: {
        code: 'invalid-data',
        message:
          'This Native step requires the skill-coordinated --runner-input action returned by continuation; public JSON cannot supply identity, provider, execution ref, or candidate binding',
      },
    };
  }
  return success('next', {
    state: nativePortableStateSummary(state, configured.paths),
    ...(coordinationMode === undefined ? {} : { coordinationMode }),
    ...(await portableParentView(configured.paths, state)),
  });
}
