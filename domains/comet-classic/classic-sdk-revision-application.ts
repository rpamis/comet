import {
  defineWorkflow,
  hashRuntimeValue,
  preserveRuntimeExecutionOrigins,
  type WorkflowRun,
  type RuntimeCommandValidator,
  type DefineWorkflowOptions,
  type RuntimeExecutor,
  type RuntimeValidator,
} from '../engine/runtime.js';
import { defineClassicWorkflowApplication } from './classic-sdk-application.js';
import type { ClassicProfile, ClassicState } from './classic-state.js';
import { assertClassicArchiveUnchanged } from './classic-sdk-archive-manifest.js';
import { classicDeliveryRepairCheckpointHash } from './classic-sdk-delivery-repair.js';
import { classicDeliveryActionContext } from './classic-sdk-delivery-repair-model.js';
import { withClassicDeliveryRepair } from './classic-sdk-delivery-repair-application.js';

export function classicInterruptedSkill(run: Readonly<WorkflowRun>) {
  const last = run.actions.at(-1);
  return run.status === 'failed' &&
    last?.status === 'failed' &&
    last.type === 'invoke_skill' &&
    !run.actions.some((action) => ['running', 'unknown', 'pending'].includes(action.status)) &&
    !run.waits.some((wait) => wait.status === 'pending') &&
    !run.evidenceWaits?.some((wait) => wait.status === 'pending')
    ? last
    : null;
}
const workContinuationValidator: RuntimeCommandValidator = {
  id: 'comet-classic-work-continuation-command',
  version: '1',
  async validate({ run, name, input, context }) {
    const value = input as {
      expectedRevision?: unknown;
      fromPhase?: unknown;
      interruptedActionId?: unknown;
      deliveryCheckpointHash?: unknown;
    } | null;
    const failed = classicInterruptedSkill(run);
    const repaired = failed && classicDeliveryActionContext(run, failed);
    const checkpointCurrent =
      !repaired ||
      (context?.projectRoot &&
        value?.deliveryCheckpointHash ===
          (await classicDeliveryRepairCheckpointHash(context.projectRoot, run)));
    const accepted =
      name === 'continue-work' &&
      failed !== null &&
      value?.expectedRevision === run.revision &&
      value.fromPhase === (run.state as unknown as ClassicState).phase &&
      value.interruptedActionId === failed.id &&
      Object.keys(value).length === (repaired ? 4 : 3) &&
      Boolean(checkpointCurrent);
    return {
      accepted,
      allowFailed: accepted,
      reason:
        'Classic continuation requires the original settled failed Skill and current revision',
    };
  },
};
const workContinuationExecutor: RuntimeExecutor = {
  id: 'comet-classic-work-continuation',
  capabilities: [],
  supports: (action) => action.ref === 'classic-work-continuation',
  async execute(action, _context, run) {
    const id = (action.input as { activation?: { interruptedActionId?: string } }).activation
      ?.interruptedActionId;
    const failed = run?.actions.find((entry) => entry.id === id);
    if (!failed || failed.status !== 'failed' || failed.type !== 'invoke_skill')
      throw new Error('Classic original failed Skill is missing');
    return {
      status: 'succeeded',
      output: { interruptedActionId: failed.id, resumeStepId: failed.stepId },
    };
  },
};
const workContinuationOutcomeValidator: RuntimeValidator = {
  id: 'comet-classic-work-continuation-outcome',
  version: '1',
  validate({ run, action, outcome }) {
    const id = (action.input as { activation?: { interruptedActionId?: string } }).activation
      ?.interruptedActionId;
    const failed = run.actions.find((entry) => entry.id === id);
    return {
      accepted:
        action.claim?.executorId === workContinuationExecutor.id &&
        outcome.status === 'succeeded' &&
        failed?.status === 'failed' &&
        failed.type === 'invoke_skill' &&
        hashRuntimeValue(outcome.output) ===
          hashRuntimeValue({ interruptedActionId: failed.id, resumeStepId: failed.stepId }),
      reason: 'Classic continuation does not match its original failed Skill',
    };
  },
};

export function classicInterruptedBuilder(run: Readonly<WorkflowRun>) {
  const state = run.state as unknown as ClassicState;
  const last = run.actions.at(-1);
  return state.phase === 'build' &&
    run.status === 'failed' &&
    !state.archived &&
    last?.status === 'failed' &&
    last.stepId === `${state.workflow}.build.execute` &&
    !run.actions.some((action) => ['running', 'unknown', 'pending'].includes(action.status))
    ? last
    : null;
}

const buildContinuationValidator: RuntimeCommandValidator = {
  id: 'comet-classic-build-continuation-command',
  version: '1',
  validate({ run, name, input }) {
    const request = input as { expectedRevision?: unknown; fromPhase?: unknown } | null;
    const state = run.state as unknown as ClassicState;
    const accepted =
      name === 'continue-build' &&
      (classicInterruptedBuilder(run) !== null || canReopenClassicVerification(run)) &&
      request?.expectedRevision === run.revision &&
      request.fromPhase === state.phase &&
      Object.keys(request).length === 2;
    return {
      accepted,
      allowFailed: accepted,
      reason: 'Classic Build continuation requires the current stopped failed Builder',
    };
  },
};

export function classicArchiveRepairAction(run: Readonly<WorkflowRun>) {
  const state = run.state as unknown as ClassicState;
  if (
    state.archived ||
    state.phase !== 'archive' ||
    !['failed', 'running'].includes(run.status) ||
    run.actions.some((action) => ['running', 'unknown', 'pending'].includes(action.status)) ||
    run.waits.some((wait) => wait.status === 'pending') ||
    run.evidenceWaits?.some((wait) => wait.status === 'pending')
  )
    return null;
  return (
    run.actions
      .slice()
      .reverse()
      .find(
        (action) =>
          action.stepId === `${state.workflow}.archive.execute` && action.status === 'failed',
      ) ?? null
  );
}

const archiveRepairValidator: RuntimeCommandValidator = {
  id: 'comet-classic-archive-repair-command',
  version: '1',
  async validate({ run, name, input, context }) {
    const requested = input as { expectedRevision?: unknown; fromPhase?: unknown } | null;
    const action = classicArchiveRepairAction(run);
    if (
      name !== 'repair-archive' ||
      !action ||
      !context?.projectRoot ||
      requested?.expectedRevision !== run.revision ||
      requested.fromPhase !== 'archive' ||
      Object.keys(requested).length !== 2
    )
      return {
        accepted: false,
        reason: 'Classic Archive requires a stopped failed execution and the current revision',
      };
    await assertClassicArchiveUnchanged(context.projectRoot, run, action);
    return { accepted: true, allowFailed: true };
  },
};

const revisionValidator: RuntimeCommandValidator = {
  id: 'comet-classic-revision-command',
  version: '1',
  validate({ run, name, input }) {
    const state = run.state as unknown as ClassicState;
    const phase = name === 'revise-design' ? 'design' : name === 'revise-plan' ? 'build' : null;
    const requested = input as { expectedRevision?: unknown; fromPhase?: unknown } | null;
    const pending = [
      ...run.actions.filter((entry) => entry.status === 'pending'),
      ...run.waits.filter((entry) => entry.status === 'pending'),
      ...(run.evidenceWaits ?? []).filter((entry) => entry.status === 'pending'),
    ];
    const designAllowed =
      name === 'revise-design'
        ? [
            'full.design.handoff',
            'full.design.confirm',
            'full.design.document',
            'full.design.evidence',
          ]
        : [
            'full.build.plan',
            'full.build.plan.evidence',
            'full.build.plan-ready',
            'full.build.execute',
            'full.build.check',
            'full.build.check.evidence',
          ];
    const laterPhase =
      ['verify', 'archive'].includes(state.phase) && canReopenClassicVerification(run);
    return {
      accepted:
        state.workflow === 'full' &&
        (state.phase === phase ||
          (name === 'revise-design' && state.phase === 'build') ||
          laterPhase) &&
        !state.archived &&
        requested?.expectedRevision === run.revision &&
        Object.keys(requested).length === 2 &&
        requested.fromPhase === state.phase &&
        pending.length === 1 &&
        (laterPhase ||
          designAllowed.includes(pending[0].stepId) ||
          (name === 'revise-design' &&
            state.phase === 'build' &&
            [
              'full.build.plan',
              'full.build.plan.evidence',
              'full.build.plan-ready',
              'full.build.execute',
              'full.build.check',
              'full.build.check.evidence',
            ].includes(pending[0].stepId))),
      reason: 'Classic revision is stale or does not match the pending Design or Build work',
    };
  },
};

/** 只重开尚未发生归档副作用的当前验收回合。 */
export function canReopenClassicVerification(run: WorkflowRun): boolean {
  const state = run.state as unknown as ClassicState;
  if (
    state.archived ||
    !['verify', 'archive'].includes(state.phase) ||
    !['running', 'waiting'].includes(run.status) ||
    run.actions.some(
      (action) =>
        ['running', 'unknown'].includes(action.status) ||
        (action.stepId.endsWith('.archive.execute') &&
          (!['pending', 'cancelled'].includes(action.status) ||
            action.attempt !== 1 ||
            Boolean(action.claim) ||
            action.receipts.length > 0)),
    )
  )
    return false;
  const pending = [
    ...run.actions.filter((entry) => entry.status === 'pending'),
    ...run.waits.filter((entry) => entry.status === 'pending'),
    ...(run.evidenceWaits ?? []).filter((entry) => entry.status === 'pending'),
  ];
  return (
    pending.length === 1 &&
    [
      'verify.run',
      'verify.report.evidence',
      'verify.check',
      'verify.check.evidence',
      'archive.prepare',
      'archive.confirm',
      'archive.preflight',
      'archive.execute',
    ].some((suffix) => pending[0].stepId === `${state.workflow}.${suffix}`)
  );
}

const verificationRevisionValidator: RuntimeCommandValidator = {
  id: 'comet-classic-verification-revision-command',
  version: '1',
  validate({ run, name, input }) {
    const requested = input as { expectedRevision?: unknown; fromPhase?: unknown } | null;
    return {
      accepted:
        name === 'reopen-verification' &&
        canReopenClassicVerification(run) &&
        requested?.expectedRevision === run.revision &&
        Object.keys(requested).length === 2 &&
        requested.fromPhase === (run.state as unknown as ClassicState).phase,
      reason:
        'Classic verification cannot reopen after Archive execution or while work has an unresolved outcome',
    };
  },
};

/** 仅给内置 Run 添加显式修订命令；原应用工厂和固定扩展包保持不变。 */
export function classicSdkRevisionApplication(
  profile: ClassicProfile,
  verification: boolean | 'full' = true,
  archiveRepair = true,
  buildContinuation = true,
  workContinuation = true,
  sourceRun?: Readonly<WorkflowRun>,
) {
  const base = defineClassicWorkflowApplication(profile);
  const continuationValidator: RuntimeCommandValidator = {
    ...workContinuationValidator,
    async validate(context) {
      if (!sourceRun) return workContinuationValidator.validate(context);
      const expected =
        context.run.workflow.hash === sourceRun.workflow.hash
          ? (structuredClone(sourceRun) as WorkflowRun)
          : preserveRuntimeExecutionOrigins(sourceRun as WorkflowRun);
      expected.workflow.hash = context.run.workflow.hash;
      expected.definitionHashes[
        JSON.stringify([context.run.workflow.id, context.run.workflow.version])
      ] = context.run.workflow.hash;
      if (hashRuntimeValue(expected) !== hashRuntimeValue(context.run))
        return {
          accepted: false,
          reason: 'Classic continuation no longer matches its authoritative source Run',
        };
      return workContinuationValidator.validate({ ...context, run: sourceRun });
    },
  };
  const fullOpen =
    archiveRepair && verification === 'full' && profile !== 'full'
      ? defineClassicWorkflowApplication('full').workflow
      : null;
  return {
    ...base,
    workflow: {
      ...base.workflow,
      steps: {
        ...base.workflow.steps,
        ...(workContinuation
          ? {
              'classic.resume-work': {
                type: 'call_tool' as const,
                ref: 'classic-work-continuation',
                validator: {
                  id: workContinuationOutcomeValidator.id,
                  version: workContinuationOutcomeValidator.version,
                },
              },
            }
          : {}),
        ...Object.fromEntries(
          Object.entries(fullOpen?.steps ?? {}).filter(([id]) => id.startsWith('full.open')),
        ),
      },
      transitions: [
        ...(base.workflow.transitions ?? []),
        ...(fullOpen?.transitions?.filter((edge) => edge.from.startsWith('full.open')) ?? []),
        { from: 'full.design.evidence', to: 'full.build.plan' },
        ...(workContinuation
          ? Object.entries(base.workflow.steps)
              .filter(([, step]) => step.type === 'invoke_skill')
              .map(([to]) => ({ from: 'classic.resume-work', to }))
          : []),
      ],
      commands: {
        ...(workContinuation
          ? {
              'continue-work': {
                stepId: 'classic.resume-work',
                validator: {
                  id: workContinuationValidator.id,
                  version: workContinuationValidator.version,
                },
              },
            }
          : {}),
        ...(buildContinuation
          ? {
              'continue-build': {
                stepId: `${verification === 'full' ? 'full' : profile}.build.execute`,
                validator: {
                  id: buildContinuationValidator.id,
                  version: buildContinuationValidator.version,
                },
              },
            }
          : {}),
        ...(archiveRepair
          ? {
              'repair-archive': {
                stepId: `${verification === 'full' ? 'full' : profile}.open`,
                validator: {
                  id: archiveRepairValidator.id,
                  version: archiveRepairValidator.version,
                },
              },
            }
          : {}),
        ...(verification
          ? {
              'reopen-verification': {
                stepId: `${verification === 'full' ? 'full' : profile}.verify.run`,
                validator: {
                  id: verificationRevisionValidator.id,
                  version: verificationRevisionValidator.version,
                },
              },
            }
          : {}),
        'revise-design': {
          stepId: 'full.design.handoff',
          validator: { id: revisionValidator.id, version: revisionValidator.version },
        },
        'revise-plan': {
          stepId: 'full.build.plan',
          validator: { id: revisionValidator.id, version: revisionValidator.version },
        },
      },
    },
    commandValidators: [
      ...(workContinuation ? [continuationValidator] : []),
      ...(buildContinuation ? [buildContinuationValidator] : []),
      ...(archiveRepair ? [archiveRepairValidator] : []),
      revisionValidator,
      ...(verification
        ? [
            {
              ...verificationRevisionValidator,
              validate: (context: Parameters<RuntimeCommandValidator['validate']>[0]) => {
                if (
                  (context.run.state as unknown as ClassicState).workflow !==
                  (verification === 'full' ? 'full' : profile)
                )
                  return {
                    accepted: false,
                    reason:
                      'Classic verification command does not match the active workflow profile',
                  };
                return verificationRevisionValidator.validate(context);
              },
            },
          ]
        : []),
    ],
    executors: [...base.executors, ...(workContinuation ? [workContinuationExecutor] : [])],
    validators: [
      ...base.validators,
      ...(workContinuation ? [workContinuationOutcomeValidator] : []),
    ],
    transitionHandler: {
      ...base.transitionHandler,
      apply(context: Parameters<typeof base.transitionHandler.apply>[0]) {
        if (
          context.event.kind === 'action-outcome' &&
          context.event.stepId === 'classic.resume-work' &&
          context.event.outcome.status === 'succeeded'
        ) {
          const output = context.event.outcome.output as {
            resumeStepId: string;
            interruptedActionId: string;
          };
          const failed = context.run.actions.find(
            (entry) => entry.id === output.interruptedActionId,
          );
          const repairId = failed?.stepId.endsWith('.archive.deliver')
            ? (failed.input as { activation?: { deliveryRepairCheckId?: string } }).activation
                ?.deliveryRepairCheckId
            : undefined;
          return {
            state: context.run.state!,
            next: [
              {
                stepId: output.resumeStepId,
                input: {
                  interruptedActionId: output.interruptedActionId,
                  ...(repairId ? { deliveryRepairCheckId: repairId } : {}),
                  summary: 'Continue preserved partial work; do not repeat completed side effects.',
                },
              },
            ],
          };
        }
        return base.transitionHandler.apply(context);
      },
    },
  };
}

/** 只识别已知内置定义；其他 hash 交由 Runtime 按固定定义拒绝。 */
export function classicSdkApplicationForRun(
  profile: ClassicProfile,
  run: WorkflowRun | null,
  options: { upgradePresetRequirements?: boolean } = {},
) {
  const effective = (run?.state as unknown as ClassicState | undefined)?.workflow ?? profile;
  const repair = withClassicDeliveryRepair(
    classicSdkRevisionApplication(
      profile,
      effective === 'full' && profile !== 'full' ? 'full' : true,
    ),
    effective,
  );
  if (run?.workflow.hash === hashRuntimeValue(defineWorkflow(repair.workflow))) return repair;
  const compatible = <T extends { workflow: DefineWorkflowOptions }>(application: T) => {
    const previous = structuredClone(application.workflow);
    const step = previous.steps[`${profile}.build.execute`];
    if (step?.outputSchema && typeof step.outputSchema === 'object') {
      const schema = step.outputSchema as { properties?: Record<string, unknown> };
      if (schema.properties) delete schema.properties.requirementsEvidence;
    }
    if (step?.validator?.id === 'comet-classic-preset-scope') delete step.validator;
    return { ...application, workflow: previous };
  };
  for (const verification of [true, 'full', false] as const) {
    for (const archiveRepair of [true, false]) {
      for (const buildContinuation of [true, false]) {
        for (const workContinuation of [true, false]) {
          const application = classicSdkRevisionApplication(
            profile,
            verification,
            archiveRepair,
            buildContinuation,
            workContinuation,
          );
          if (run?.workflow.hash === hashRuntimeValue(defineWorkflow(application.workflow)))
            return application;
          const previous = compatible(application);
          if (run?.workflow.hash === hashRuntimeValue(defineWorkflow(previous.workflow)))
            return options.upgradePresetRequirements ? application : previous;
        }
      }
    }
  }
  const base = { ...defineClassicWorkflowApplication(profile), commandValidators: [] };
  const previous = compatible(base);
  if (run?.workflow.hash === hashRuntimeValue(defineWorkflow(previous.workflow)))
    return options.upgradePresetRequirements ? base : previous;
  return base;
}
