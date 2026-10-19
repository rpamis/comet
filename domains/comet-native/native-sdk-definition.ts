import {
  defineWorkflow,
  hashRuntimeValue,
  type DefineWorkflowOptions,
  type WorkflowDefinition,
  type WorkflowRun,
  type WorkflowTransitionHandler,
} from '../engine/runtime.js';

export const NATIVE_SDK_RECOVERABLE_FAILURE_STEPS: readonly string[] = [
  'archive.prepare',
  'archive.execute',
  'verify.revalidate',
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
export const NATIVE_SDK_PRE_EDIT_REVIEW_HASH =
  'a4fa2f7ad12c5c7dd37374f9cb5f1154f2c686e3b3b5473533154c01fdcdd9ea';

export function nativeSdkBeforeArchiveCandidateRecovery(workflow: DefineWorkflowOptions) {
  const previous = structuredClone(workflow);
  previous.transitions = previous.transitions?.filter(
    (edge) =>
      !(['archive.prepare', 'archive.execute'].includes(edge.from) && edge.to === 'verify.stop'),
  );
  return previous;
}

export function nativeSdkBeforeReportRecovery(workflow: DefineWorkflowOptions) {
  const previous = nativeSdkBeforeArchiveCandidateRecovery(workflow);
  previous.transitions = previous.transitions?.filter(
    (edge) =>
      !(edge.from === 'verify.revalidate' && ['verify.checks', 'verify.stop'].includes(edge.to)),
  );
  return previous;
}

export function nativeSdkBeforeReadOnlyArchivePreflight(workflow: DefineWorkflowOptions) {
  const previous = nativeSdkBeforeReportRecovery(workflow);
  delete previous.steps['archive.prepare'].retry;
  return previous;
}

export function nativeSdkBeforeEditReview(workflow: DefineWorkflowOptions) {
  const previous = nativeSdkBeforeReadOnlyArchivePreflight(workflow);
  const confirmation = previous.steps['verify.confirm'];
  if (confirmation?.type === 'ask_user' && Array.isArray(confirmation.choices))
    confirmation.choices = confirmation.choices.filter((choice) => choice !== 'reverify');
  previous.transitions = previous.transitions?.filter(
    (edge) => !(edge.from === 'verify.confirm' && edge.on === 'reverify'),
  );
  return previous;
}

/** 只撤回指定版本新增的定义；其余步骤、绑定和转移必须与原 hash 完全一致。 */
export function nativeSdkBeforeVerifierRecovery(workflow: DefineWorkflowOptions) {
  const previous = nativeSdkBeforeEditReview(workflow);
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
  const beforeEditReview = nativeSdkBeforeEditReview(workflow);
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
  return [
    nativeSdkBeforeArchiveCandidateRecovery(workflow),
    nativeSdkBeforeReportRecovery(workflow),
    nativeSdkBeforeReadOnlyArchivePreflight(workflow),
    ...(hashRuntimeValue(defineWorkflow(beforeEditReview)) === NATIVE_SDK_PRE_EDIT_REVIEW_HASH
      ? [beforeEditReview]
      : []),
    ...definitions.filter(
      (candidate, index) => hashRuntimeValue(defineWorkflow(candidate)) === hashes[index],
    ),
  ];
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
        ['archive.prepare', 'archive.execute'].includes(event.stepId) &&
        event.outcome.status === 'failed' &&
        !(workflow.transitions ?? []).some(
          (edge) => edge.from === event.stepId && edge.to === 'verify.stop',
        )
      )
        return { state: run.state!, next: [] };
      if (
        event.kind === 'action-outcome' &&
        event.stepId === 'verify.revalidate' &&
        event.outcome.status === 'failed' &&
        (event.outcome.output as { reason?: string } | null)?.reason === 'check-input-drift' &&
        !(workflow.transitions ?? []).some(
          (edge) => edge.from === 'verify.revalidate' && edge.to === 'verify.checks',
        )
      )
        return { state: run.state!, next: [] };

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

const normalizedDefinitionHashes = new WeakMap<WorkflowDefinition, string>();

export function nativeSdkMatchesRun(
  workflow: DefineWorkflowOptions,
  run: Pick<WorkflowRun, 'workflow'> | null | undefined,
) {
  const definition = defineWorkflow(workflow);
  let hash = normalizedDefinitionHashes.get(definition);
  if (hash === undefined) {
    hash = hashRuntimeValue(definition);
    normalizedDefinitionHashes.set(definition, hash);
  }
  return run?.workflow.hash === hash;
}
