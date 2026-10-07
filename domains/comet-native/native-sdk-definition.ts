import {
  defineWorkflow,
  hashRuntimeValue,
  type DefineWorkflowOptions,
  type WorkflowRun,
  type WorkflowTransitionHandler,
} from '../engine/runtime.js';

export const NATIVE_SDK_RECOVERABLE_FAILURE_STEPS: readonly string[] = [
  'verify.checks',
  'verify.requested-checks',
  'supervisor.child.checks',
  'supervisor.child.integration-checks',
  'supervisor.child.verifier',
];

export function nativeSdkRecoverableFailureReason(reason: string | undefined): boolean {
  return NATIVE_SDK_RECOVERABLE_FAILURE_STEPS.some((step) => reason === `ACTION_FAILED: ${step}`);
}

export const NATIVE_SDK_PRE_VERIFIER_RECOVERY_HASH =
  '8742aed398ddab2cdb5259ccd2c6a236c70e44f4d028d9412b2d3b78ebc59465';
export const NATIVE_SDK_PRE_CHECK_RECOVERY_HASH =
  '500dc5be719eb5493dbdadf35c372de49f0232439eef849bb521f6b3db346aff';
export const NATIVE_SDK_PRE_CHILD_ARCHIVE_HASH =
  '241450a81ad7237162f72c834e8e7712f1becd90c0a78fa3a1714c86efa4ca06';

/** 只撤回指定版本新增的定义；其余步骤、绑定和转移必须与原 hash 完全一致。 */
export function nativeSdkBeforeVerifierRecovery(workflow: DefineWorkflowOptions) {
  const previous = structuredClone(workflow);
  const recoverySteps = [
    'supervisor.child.verifier-retry',
    'supervisor.child.checks-stop',
    'supervisor.child.integration-checks-stop',
  ];
  for (const step of recoverySteps) delete previous.steps[step];
  previous.transitions = (previous.transitions ?? []).filter(
    ({ from, to }) =>
      !recoverySteps.includes(from) &&
      !recoverySteps.includes(to) &&
      !(from === 'verify.requested-checks' && to === 'verify.checks-stop'),
  );
  return previous;
}

export function nativeSdkLegacyDefinitions(workflow: DefineWorkflowOptions) {
  const beforeVerifierRecovery = nativeSdkBeforeVerifierRecovery(workflow);
  const beforeCheckRecovery = structuredClone(beforeVerifierRecovery);
  delete beforeCheckRecovery.steps['verify.checks-stop'];
  beforeCheckRecovery.transitions = (beforeCheckRecovery.transitions ?? []).filter(
    ({ from, to, on }) =>
      from !== 'verify.checks-stop' &&
      to !== 'verify.checks-stop' &&
      !(from === 'verify.checks' && on === 'failed'),
  );
  const beforeChildArchive = structuredClone(beforeCheckRecovery);
  delete beforeChildArchive.steps['supervisor.child.archive'];
  beforeChildArchive.transitions = (beforeChildArchive.transitions ?? []).filter(
    ({ from, to }) => from !== 'supervisor.child.archive' && to !== 'supervisor.child.archive',
  );
  const definitions = [beforeVerifierRecovery, beforeCheckRecovery, beforeChildArchive];
  const hashes = [
    NATIVE_SDK_PRE_VERIFIER_RECOVERY_HASH,
    NATIVE_SDK_PRE_CHECK_RECOVERY_HASH,
    NATIVE_SDK_PRE_CHILD_ARCHIVE_HASH,
  ];
  return definitions.filter(
    (candidate, index) => hashRuntimeValue(defineWorkflow(candidate)) === hashes[index],
  );
}

/** 旧定义继续保存原语义，只有显式 doctor 迁移才增加新的恢复后继。 */
export function nativeSdkLegacyTransitionHandler(
  workflow: DefineWorkflowOptions,
  transitionHandler: WorkflowTransitionHandler,
): WorkflowTransitionHandler {
  return {
    ...transitionHandler,
    apply(input) {
      const { run, event } = input;
      if (
        event.kind === 'action-outcome' &&
        event.outcome.status === 'failed' &&
        ((event.stepId === 'supervisor.child.verifier' &&
          !workflow.steps['supervisor.child.verifier-retry']) ||
          (event.stepId === 'verify.checks' && !workflow.steps['verify.checks-stop']) ||
          (Boolean((event.outcome.output as { interruption?: unknown } | null)?.interruption) &&
            ((event.stepId === 'supervisor.child.checks' &&
              !workflow.steps['supervisor.child.checks-stop']) ||
              (event.stepId === 'supervisor.child.integration-checks' &&
                !workflow.steps['supervisor.child.integration-checks-stop']) ||
              (event.stepId === 'verify.requested-checks' &&
                !(workflow.transitions ?? []).some(
                  (edge) => edge.from === event.stepId && edge.to === 'verify.checks-stop',
                )))))
      )
        return { state: run.state!, next: [] };
      return transitionHandler.apply(input);
    },
  };
}

export function nativeSdkMatchesRun(
  workflow: DefineWorkflowOptions,
  run: Pick<WorkflowRun, 'workflow'> | null | undefined,
) {
  return run?.workflow.hash === hashRuntimeValue(defineWorkflow(workflow));
}
