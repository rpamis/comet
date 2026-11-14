import { readNativeBuildWorkspace } from './native-build-workspace-record.js';
import { prepareNativeBuildWorkspace } from './native-build-workspace.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { inspectNativeChildren } from './native-children.js';
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
import { readProjectConfig } from './native-config.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import {
  confirmNativePortableShape,
  confirmNativePortableSkillCoordinatedPass,
  isNativePortableChange,
  prepareNativePortableShapeConfirmation,
  readNativePortableChange,
  resolveNativePortableVerifierBlocker,
  retryNativePortableVerifier,
  returnNativePortableChangeToBuild,
  returnNativePortableChangeToShape,
  type NativePortableExpectedContinuation,
  type NativePortableExpectedContinuationAction,
} from './native-portable-runtime.js';
import { nativePortableStateSummary } from './native-portable-summary.js';
import {
  NATIVE_SUPERVISOR_COORDINATION_MODES,
  type NativeSupervisorCoordinationMode,
} from './native-portable-types.js';
import {
  applyNativeRunnerInput,
  readNativeRunnerInput,
  validateNativeRunnerInputBoundary,
} from './native-runner-input.js';
import { resolveNativeChangeRuntimeOwner } from './native-runtime-ownership.js';
import { NativeBuilderAcceptanceIncompleteError } from './native-builder-acceptance-review.js';
import { advanceNativeSdkChange } from './native-sdk-next.js';
import { advanceNativeSdkTask } from './native-sdk-task-command.js';
import {
  dispatchNativeSupervisorReadyTasks,
  projectNativeSupervisorTask,
  projectNativeSupervisorChildren,
} from './native-supervisor.js';
import type { NativeWorkspaceFinish } from './native-workspace.js';
const EXPECTED_CONTINUATION_ACTIONS = new Set<NativePortableExpectedContinuationAction>([
  'prepare-shape-confirmation',
  'confirm-shape',
  'accept-result',
  'confirm-verifier-unavailable',
  'revise-implementation',
  'revise-requirements',
  'retry-verifier',
  'continue-builder',
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
export async function nativeNextCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const originalArgs = [...args];
  const name = requiredPositional(args, 'change name');
  if (await readNativeBuildWorkspace(projectRoot, name)) {
    const target = await prepareNativeBuildWorkspace(projectRoot, name);
    return { ...(await nativeNextCommand(originalArgs, target)), executionCwd: target };
  }
  const resultFile = takeOption(args, '--result');
  const sessionId = takeOption(args, '--session');
  const actionId = takeOption(args, '--action');
  const review = takeOption(args, '--review');
  const acceptOnPass = takeOption(args, '--accept-on-pass');
  const details = takeFlag(args, '--details');
  const taskInput =
    resultFile !== undefined ||
    sessionId !== undefined ||
    actionId !== undefined ||
    review !== undefined ||
    acceptOnPass !== undefined ||
    details;
  if (review !== undefined && review !== 'current-session' && review !== 'independent')
    throw new NativeUsageError('--review 必须为 current-session 或 independent。');
  const summary = takeOption(args, '--summary');
  const proposalHash = takeOption(args, '--proposal-hash');
  const runnerInputFile = takeOption(args, '--runner-input');
  const validateOnly = takeFlag(args, '--validate-only');
  const confirmed = takeFlag(args, '--confirmed');
  const deferBuild = takeFlag(args, '--defer-build');
  if (deferBuild && !confirmed) throw new NativeUsageError('--defer-build requires --confirmed');
  const acceptResult = takeFlag(args, '--accept-result');
  const finish = takeOption(args, '--finish') as NativeWorkspaceFinish | undefined;
  if (
    finish !== undefined &&
    (!acceptResult || !['keep', 'merge', 'push', 'pull-request'].includes(finish))
  ) {
    throw new NativeUsageError(
      '--finish requires --accept-result and must be keep, merge, push, or pull-request',
    );
  }
  const reviseImplementation = takeFlag(args, '--revise-implementation');
  const reviseRequirements = takeFlag(args, '--revise-requirements');
  const retryVerifier = takeFlag(args, '--retry-verifier');
  const continueBuilder = takeFlag(args, '--continue-builder');
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
  const maxParallel = maxParallelText === undefined ? undefined : Number(maxParallelText);
  if (maxParallel !== undefined && (!Number.isSafeInteger(maxParallel) || maxParallel < 1)) {
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
      continueBuilder,
      resolveVerifierBlocker,
    ].filter(Boolean).length > 1
  ) {
    throw new NativeUsageError(
      '--confirmed, --accept-result, --revise-implementation, --revise-requirements, --retry-verifier, --continue-builder, and --resolve-verifier-blocker are mutually exclusive',
    );
  }
  if (
    coordinationMode !== undefined &&
    (acceptResult ||
      reviseImplementation ||
      reviseRequirements ||
      retryVerifier ||
      continueBuilder ||
      resolveVerifierBlocker ||
      runnerInputFile !== undefined)
  ) {
    throw new NativeUsageError(
      '--coordination-mode is only valid when preparing or confirming a Supervisor Shape',
    );
  }
  // Agent-authored Build/Verify completion fields retired with Native v4.
  // Parse the complete public surface before choosing its business continuation.
  assertNoArguments(args);
  if (taskInput && !sessionId) throw new NativeUsageError('任务领取与结果回报需要 --session。');
  if (resultFile !== undefined && !actionId)
    throw new NativeUsageError('--result 必须同时提供当前响应中的 --action。');
  const sdkOwner = await readSdkChangeOwner(projectRoot, 'native', name);
  if (sdkOwner && (await readProjectConfig(projectRoot)) === null) {
    throw new Error(`Native SDK Run ${name} requires .comet/config.yaml before next`);
  }
  const configured = await configuredPaths(projectRoot, name);
  if (!sdkOwner && !(await isNativePortableChange(configured.paths, name))) {
    return {
      command: 'next',
      exitCode: 65,
      data: {
        change: name,
        migrationRequired: true,
        repairCommand: `comet native doctor ${name} --repair`,
      },
      error: {
        code: 'invalid-data',
        message: `Native change ${name} requires explicit business import; run comet native doctor ${name} --repair`,
      },
    };
  }
  if (deferBuild && !sdkOwner) throw new NativeUsageError('--defer-build requires an SDK change');
  const owner = sdkOwner ?? (await resolveNativeChangeRuntimeOwner(configured.paths, name));
  if (owner?.format === 'sdk') {
    if (taskInput) {
      if (
        !sessionId ||
        confirmed ||
        acceptResult ||
        reviseImplementation ||
        reviseRequirements ||
        retryVerifier ||
        continueBuilder ||
        resolveVerifierBlocker ||
        summary !== undefined ||
        proposalHash !== undefined ||
        runnerInputFile !== undefined ||
        validateOnly ||
        maxParallelText !== undefined ||
        finish !== undefined ||
        coordinationMode !== undefined ||
        expectedContinuation !== undefined
      )
        throw new NativeUsageError(
          '任务领取与结果回报需要 --session，并与原用户决定、Compat 或修订参数分开调用。',
        );
      return advanceNativeSdkTask({
        projectRoot,
        name,
        sessionId,
        actionId,
        resultFile,
        review,
        acceptOnPass,
        details,
      });
    }
    if (
      runnerInputFile !== undefined ||
      validateOnly ||
      maxParallelText !== undefined ||
      finish !== undefined
    ) {
      throw new NativeUsageError(
        'This Native SDK next action does not accept legacy transition options',
      );
    }
    if (resolveVerifierBlocker) {
      if (
        summary === undefined ||
        proposalHash === undefined ||
        expectedContinuation?.action !== 'resolve-verifier-blocker'
      ) {
        throw new NativeUsageError(
          'SDK blocked 恢复需要 --summary、--proposal-hash、--expected-state-version 和 --expected-action resolve-verifier-blocker',
        );
      }
      return advanceNativeSdkChange(projectRoot, name, {
        summary,
        proposalHash,
        expectedStateVersion: expectedContinuation.stateVersion,
        expectedAction: 'resolve-verifier-blocker',
      });
    }
    if (reviseRequirements) {
      if (summary === undefined || expectedContinuation?.action !== 'revise-requirements') {
        throw new NativeUsageError(
          'SDK requirements revision requires --summary, --expected-state-version, and --expected-action revise-requirements',
        );
      }
      return advanceNativeSdkChange(projectRoot, name, {
        summary,
        ...(proposalHash === undefined ? {} : { proposalHash }),
        expectedStateVersion: expectedContinuation.stateVersion,
        expectedAction: 'revise-requirements',
      });
    }
    if (confirmed) {
      if (
        summary === undefined ||
        proposalHash !== undefined ||
        expectedContinuation?.action !== 'confirm-shape'
      ) {
        throw new NativeUsageError(
          'SDK Shape confirmation requires --summary, --expected-state-version, and --expected-action confirm-shape',
        );
      }
      return advanceNativeSdkChange(projectRoot, name, {
        summary,
        expectedStateVersion: expectedContinuation.stateVersion,
        expectedAction: 'confirm-shape',
        deferBuild,
        ...(coordinationMode === undefined ? {} : { coordinationMode }),
      });
    }
    if (acceptResult || reviseImplementation || retryVerifier) {
      const action = acceptResult
        ? 'accept-result'
        : reviseImplementation
          ? 'revise-implementation'
          : 'retry-verifier';
      if (
        summary === undefined ||
        proposalHash === undefined ||
        expectedContinuation?.action !== action
      ) {
        throw new NativeUsageError(
          `SDK Verify decision requires --summary, --proposal-hash, --expected-state-version, and --expected-action ${action}`,
        );
      }
      return advanceNativeSdkChange(projectRoot, name, {
        summary,
        proposalHash,
        expectedStateVersion: expectedContinuation.stateVersion,
        expectedAction: action,
      });
    }
    if (continueBuilder) {
      if (
        summary === undefined ||
        proposalHash === undefined ||
        expectedContinuation?.action !== 'continue-builder'
      ) {
        throw new NativeUsageError(
          'SDK Builder continuation requires --summary, --proposal-hash, --expected-state-version, and --expected-action continue-builder',
        );
      }
      return advanceNativeSdkChange(projectRoot, name, {
        summary,
        proposalHash,
        expectedStateVersion: expectedContinuation.stateVersion,
        expectedAction: 'continue-builder',
      });
    }
    if (proposalHash !== undefined || coordinationMode !== undefined) {
      throw new NativeUsageError(
        'This Native SDK next action does not accept legacy transition options',
      );
    }
    if (
      expectedContinuation !== undefined &&
      expectedContinuation.action !== 'prepare-shape-confirmation'
    ) {
      return {
        command: 'next',
        exitCode: 73,
        error: {
          code: 'conflict',
          message: 'Native SDK 机器推进动作不匹配；用户决定须使用对应的确认或修订参数。',
        },
      };
    }
    if (summary !== undefined || expectedContinuation !== undefined) {
      return advanceNativeSdkChange(projectRoot, name, {
        ...(summary === undefined ? {} : { summary }),
        ...(expectedContinuation === undefined
          ? {}
          : {
              expectedStateVersion: expectedContinuation.stateVersion,
              expectedAction: 'prepare-shape-confirmation' as const,
            }),
      });
    }
    return advanceNativeSdkChange(projectRoot, name);
  }
  if (
    (confirmed ||
      acceptResult ||
      reviseImplementation ||
      reviseRequirements ||
      retryVerifier ||
      continueBuilder ||
      resolveVerifierBlocker) &&
    expectedContinuation === undefined
  )
    throw new NativeUsageError(
      'User decisions require --expected-state-version and --expected-action from the current continuation',
    );
  let state = await readNativePortableChange(configured.paths, name);
  if (runnerInputFile) {
    const input = await readNativeRunnerInput(runnerInputFile, projectRoot);
    await validateNativeRunnerInputBoundary({
      paths: configured.paths,
      name,
      state,
      input,
      projectRoot,
    });
    if (validateOnly)
      return success('next', {
        validated: true,
        runtimeFormat: 'compat',
        change: name,
        kind: input.kind,
      });
    const result = await applyNativeRunnerInput({
      paths: configured.paths,
      name,
      input,
      maxVerifyFailures: configured.config.native.max_verify_failures,
      inputFile: runnerInputFile,
    }).catch((error: unknown) => {
      if (!(error instanceof NativeBuilderAcceptanceIncompleteError)) throw error;
      return error;
    });
    if (result instanceof NativeBuilderAcceptanceIncompleteError) {
      const rejected = errorResult('next', result);
      return {
        ...rejected,
        data: {
          ...(rejected.data as Record<string, unknown>),
          state: nativePortableStateSummary(state, configured.paths),
          continuation: nativePortableContinuation(state),
        },
      };
    }
    const { state: written, ...details } = result;
    if ('supervisorState' in details) {
      const { supervisorState, ...taskDetails } = details;
      return success('next', {
        runtimeFormat: 'compat',
        state: nativePortableStateSummary(written, configured.paths),
        ...taskDetails,
        continuation: nativePortableContinuation(
          written,
          projectNativeSupervisorChildren(supervisorState),
        ),
      });
    }
    return success('next', {
      runtimeFormat: 'compat',
      state: nativePortableStateSummary(written, configured.paths),
      ...details,
    });
  }
  if (resultFile !== undefined)
    throw new NativeUsageError(
      '此旧需求沿用返回的业务输入格式；按当前 continuation 提交 --runner-input，不另建 Run。',
    );
  if (confirmed)
    state = await confirmNativePortableShape({
      paths: configured.paths,
      name,
      coordinationMode,
      expectedContinuation,
    });
  else if (acceptResult)
    state = await confirmNativePortableSkillCoordinatedPass({
      paths: configured.paths,
      name,
      expectedContinuation,
      finish,
    });
  else if (reviseImplementation)
    state = await returnNativePortableChangeToBuild({
      paths: configured.paths,
      name,
      reason: summary ?? 'User requested implementation revision',
      expectedContinuation,
    });
  else if (reviseRequirements)
    state = await returnNativePortableChangeToShape({
      paths: configured.paths,
      name,
      reason: summary ?? 'User requested requirements revision',
      expectedContinuation,
    });
  else if (retryVerifier)
    state = await retryNativePortableVerifier({
      paths: configured.paths,
      name,
      expectedContinuation,
    });
  else if (resolveVerifierBlocker)
    state = await resolveNativePortableVerifierBlocker({
      paths: configured.paths,
      name,
      reason: summary,
      expectedContinuation,
    });
  else if (summary !== undefined && state.phase === 'shape')
    state = await prepareNativePortableShapeConfirmation({
      paths: configured.paths,
      name,
      coordinationMode,
      expectedContinuation,
    });
  const children = await inspectNativeChildren({
    paths: configured.paths,
    state,
  });
  const dispatched =
    state.phase === 'build' && children?.schema === 'comet.native.children.v2' && children.confirmed
      ? await dispatchNativeSupervisorReadyTasks({
          paths: configured.paths,
          parent: name,
          maxParallel: state.coordination_mode === 'single-session' ? 1 : maxParallel,
        })
      : null;
  return success('next', {
    runtimeFormat: 'compat',
    state: nativePortableStateSummary(state, configured.paths),
    ...(dispatched
      ? {
          supervisorTasks: dispatched.state.children.flatMap(({ task }) =>
            task ? [projectNativeSupervisorTask(task, name, projectRoot)] : [],
          ),
          readyChildren: dispatched.tasks.map((task) => task.child),
        }
      : {}),
    continuation: nativePortableContinuation(state, children, {
      verifierExecutionRef: state.verifier_action?.claim?.token,
    }),
  });
}
