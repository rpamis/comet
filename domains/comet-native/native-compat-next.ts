import { inspectNativeChildren } from './native-children.js';
import {
  errorResult,
  NativeUsageError,
  success,
  type DispatchResult,
} from './native-cli-shared.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import { confirmNativePortableShape } from './native-portable-shape-coordination.js';
import { confirmNativePortableSkillCoordinatedPass } from './native-portable-verifier-coordination.js';
import {
  prepareNativePortableShapeConfirmation,
  returnNativePortableChangeToShape,
  type NativePortableExpectedContinuation,
} from './native-portable-requirements.js';
import { readNativePortableChange } from './native-portable-storage.js';
import {
  resolveNativePortableVerifierBlocker,
  retryNativePortableVerifier,
  returnNativePortableChangeToBuild,
} from './native-portable-verification.js';
import { nativePortableStateSummary } from './native-portable-summary.js';
import type { NativeSupervisorCoordinationMode } from './native-portable-types.js';
import {
  applyNativeRunnerInput,
  readNativeRunnerInput,
  validateNativeRunnerInputBoundary,
} from './native-runner-input.js';
import { NativeBuilderAcceptanceIncompleteError } from './native-builder-acceptance-review.js';
import { dispatchNativeSupervisorReadyTasks } from './native-supervisor-coordinator.js';
import {
  projectNativeSupervisorTask,
  projectNativeSupervisorChildren,
} from './native-supervisor-model.js';
import type { NativeProjectPaths } from './native-types.js';
import type { NativeWorkspaceFinish } from './native-workspace.js';

export async function advanceNativeCompatChange({
  name,
  projectRoot,
  paths,
  maxVerifyFailures,
  expectedContinuation,
  confirmed,
  acceptResult,
  reviseImplementation,
  reviseRequirements,
  retryVerifier,
  continueBuilder,
  resolveVerifierBlocker,
  runnerInputFile,
  resultFile,
  summary,
  validateOnly,
  coordinationMode,
  finish,
  maxParallel,
}: {
  name: string;
  projectRoot: string;
  paths: NativeProjectPaths;
  maxVerifyFailures: number;
  expectedContinuation: NativePortableExpectedContinuation | undefined;
  confirmed: boolean;
  acceptResult: boolean;
  reviseImplementation: boolean;
  reviseRequirements: boolean;
  retryVerifier: boolean;
  continueBuilder: boolean;
  resolveVerifierBlocker: boolean;
  runnerInputFile: string | undefined;
  resultFile: string | undefined;
  summary: string | undefined;
  validateOnly: boolean;
  coordinationMode: NativeSupervisorCoordinationMode | undefined;
  finish: NativeWorkspaceFinish | undefined;
  maxParallel: number | undefined;
}): Promise<DispatchResult> {
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
  let state = await readNativePortableChange(paths, name);
  if (runnerInputFile) {
    const input = await readNativeRunnerInput(runnerInputFile, projectRoot);
    await validateNativeRunnerInputBoundary({
      paths: paths,
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
      paths: paths,
      name,
      input,
      maxVerifyFailures: maxVerifyFailures,
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
          state: nativePortableStateSummary(state, paths),
          continuation: nativePortableContinuation(state),
        },
      };
    }
    const { state: written, ...details } = result;
    if ('supervisorState' in details) {
      const { supervisorState, ...taskDetails } = details;
      return success('next', {
        runtimeFormat: 'compat',
        state: nativePortableStateSummary(written, paths),
        ...taskDetails,
        continuation: nativePortableContinuation(
          written,
          projectNativeSupervisorChildren(supervisorState),
        ),
      });
    }
    return success('next', {
      runtimeFormat: 'compat',
      state: nativePortableStateSummary(written, paths),
      ...details,
    });
  }
  if (resultFile !== undefined)
    throw new NativeUsageError(
      '此旧需求沿用返回的业务输入格式；按当前 continuation 提交 --runner-input，不另建 Run。',
    );
  if (confirmed)
    state = await confirmNativePortableShape({
      paths: paths,
      name,
      coordinationMode,
      expectedContinuation,
    });
  else if (acceptResult)
    state = await confirmNativePortableSkillCoordinatedPass({
      paths: paths,
      name,
      expectedContinuation,
      finish,
    });
  else if (reviseImplementation)
    state = await returnNativePortableChangeToBuild({
      paths: paths,
      name,
      reason: summary ?? 'User requested implementation revision',
      expectedContinuation,
    });
  else if (reviseRequirements)
    state = await returnNativePortableChangeToShape({
      paths: paths,
      name,
      reason: summary ?? 'User requested requirements revision',
      expectedContinuation,
    });
  else if (retryVerifier)
    state = await retryNativePortableVerifier({
      paths: paths,
      name,
      expectedContinuation,
    });
  else if (resolveVerifierBlocker)
    state = await resolveNativePortableVerifierBlocker({
      paths: paths,
      name,
      reason: summary,
      expectedContinuation,
    });
  else if (summary !== undefined && state.phase === 'shape')
    state = await prepareNativePortableShapeConfirmation({
      paths: paths,
      name,
      coordinationMode,
      expectedContinuation,
    });
  const children = await inspectNativeChildren({
    paths: paths,
    state,
  });
  const dispatched =
    state.phase === 'build' && children?.schema === 'comet.native.children.v2' && children.confirmed
      ? await dispatchNativeSupervisorReadyTasks({
          paths: paths,
          parent: name,
          maxParallel: state.coordination_mode === 'single-session' ? 1 : maxParallel,
        })
      : null;
  return success('next', {
    runtimeFormat: 'compat',
    state: nativePortableStateSummary(state, paths),
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
