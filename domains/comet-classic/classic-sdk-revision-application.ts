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
import {
  defineClassicWorkflowApplication,
  assertClassicPresetRequirementsCurrent,
  assertClassicBuildReady,
} from './classic-sdk-application.js';
import { classicSdkCheckRefreshInput } from './classic-sdk-check.js';
import {
  observeClassicCheckInputs,
  classicEditReviewScope,
  classicFormalEditReviewScope,
  assertClassicEditReviewsComplete,
  assertClassicSdkAcceptedCandidateInputs,
} from './classic-edit-review.js';
import { areObservedEditsNonBehavioral } from '../workflow-contract/edit-review.js';
import { hashProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import path from 'node:path';
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

const checkRefreshValidator: RuntimeCommandValidator = {
  id: 'comet-classic-check-refresh-command',
  version: '1',
  async validate({ run, name, input, context }) {
    try {
      const state = run.state as unknown as ClassicState;
      const value = input as {
        expectedRevision: number;
        archiveActionId: string;
        approvalWaitId: string;
        proposalHash: string;
        reportSha256: string;
        sourceActionId: string;
        observationHash: string;
        summary: string;
      };
      const pending = run.actions.filter((action) => action.status === 'pending');
      const approval = run.waits.find((wait) => wait.id === value?.approvalWaitId);
      const report = run.evidenceWaits
        ?.slice()
        .reverse()
        .find(
          (wait) =>
            wait.stepId === `${state.workflow}.verify.report.evidence` &&
            wait.status === 'resolved',
        )?.receipt;
      if (
        !context?.projectRoot ||
        name !== 'refresh-checks' ||
        !canReopenClassicVerification(run as WorkflowRun) ||
        state.phase !== 'archive' ||
        state.archiveConfirmation !== 'confirmed' ||
        state.verifyResult !== 'pass' ||
        !value ||
        Object.keys(value).sort().join(',') !==
          'approvalWaitId,archiveActionId,expectedRevision,observationHash,proposalHash,reportSha256,sourceActionId,summary' ||
        value.expectedRevision !== run.revision ||
        pending.length !== 1 ||
        pending[0].id !== value.archiveActionId ||
        !['archive.preflight', 'archive.execute'].some(
          (step) => pending[0].stepId === `${state.workflow}.${step}`,
        ) ||
        !approval ||
        approval.stepId !== `${state.workflow}.archive.confirm` ||
        approval.status !== 'resolved' ||
        !['local', 'push', 'pr'].includes(approval.decision?.choice ?? '') ||
        approval.proposalHash !== value.proposalHash ||
        !report ||
        report.contentHash !== value.reportSha256 ||
        !value.summary?.trim()
      )
        throw new Error('补充检查必须对应原验收、批准和未执行的归档步骤');
      const root = context.projectRoot;
      if (
        (
          await hashProtectedProjectFile(root, report.ref, {
            label: 'Classic approved verification report',
          })
        ).digest !== report.contentHash
      )
        throw new Error('原验收报告已变化');
      const observation = await observeClassicCheckInputs(root, run);
      if (
        observation.sourceActionId !== value.sourceActionId ||
        observation.currentManifestHash !== value.observationHash
      )
        throw new Error('输入观察已失效，请由当前 Agent 核对新增变化');
      const change = path.posix.basename((run.input as { changeDir: string }).changeDir);
      await assertClassicPresetRequirementsCurrent(
        root,
        (run.input as { changeDir: string }).changeDir,
        run,
      );
      await assertClassicBuildReady(
        root,
        (run.input as { changeDir: string }).changeDir,
        state,
        run,
      );
      await assertClassicEditReviewsComplete(root, change, state);
      await assertClassicSdkAcceptedCandidateInputs(root, run);
      if (
        !(await areObservedEditsNonBehavioral(
          [
            await classicEditReviewScope(root, change, state),
            await classicFormalEditReviewScope(root, change, state, false, undefined, run),
          ],
          observation.changes,
        ))
      )
        throw new Error('尚有未经当前 Agent 判断的实现变化，不能仅补检查保留验收');
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: String(error) };
    }
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
  checkRefresh = true,
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
        ...(checkRefresh
          ? [
              {
                from: `${verification === 'full' ? 'full' : profile}.verify.check`,
                to: `${verification === 'full' ? 'full' : profile}.archive.preflight`,
              },
              {
                from: `${verification === 'full' ? 'full' : profile}.verify.check`,
                to: `${verification === 'full' ? 'full' : profile}.archive.preflight`,
                on: 'failed',
              },
            ]
          : []),
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
        ...(checkRefresh
          ? {
              'refresh-checks': {
                stepId: `${verification === 'full' ? 'full' : profile}.verify.check`,
                validator: { id: checkRefreshValidator.id, version: checkRefreshValidator.version },
              },
            }
          : {}),
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
      ...(checkRefresh ? [checkRefreshValidator] : []),
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
        if (context.event.kind === 'action-outcome') {
          const actionId = context.event.outcome.actionId;
          const action = context.run.actions.find((entry) => entry.id === actionId);
          if (action && classicSdkCheckRefreshInput(context.run, action))
            return {
              state: context.run.state!,
              next: [
                `${(context.run.state as unknown as ClassicState).workflow}.archive.preflight`,
              ],
            };
        }
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
  options: { upgradePresetRequirements?: boolean; upgradeBuildCheckRecovery?: boolean } = {},
) {
  const base = { ...defineClassicWorkflowApplication(profile), commandValidators: [] };
  // 正常 Run 精确匹配原定义后直接返回；旧定义仍按下方完整兼容路径识别。
  if (!run || run.workflow.hash === hashRuntimeValue(defineWorkflow(base.workflow))) return base;
  const withoutCheckRefresh = <T extends { workflow: DefineWorkflowOptions }>(application: T) => {
    const workflow = structuredClone(application.workflow);
    if (workflow.commands) delete workflow.commands['refresh-checks'];
    workflow.transitions = workflow.transitions?.filter(
      ({ from, to }) => !(from.endsWith('.verify.check') && to.endsWith('.archive.preflight')),
    );
    return { ...application, workflow };
  };
  const effective = (run?.state as unknown as ClassicState | undefined)?.workflow ?? profile;
  const repair = withClassicDeliveryRepair(
    classicSdkRevisionApplication(
      profile,
      effective === 'full' && profile !== 'full' ? 'full' : true,
    ),
    effective,
  );
  if (run?.workflow.hash === hashRuntimeValue(defineWorkflow(repair.workflow))) return repair;
  const beforeRepairRefresh = withoutCheckRefresh(repair);
  if (run?.workflow.hash === hashRuntimeValue(defineWorkflow(beforeRepairRefresh.workflow)))
    return beforeRepairRefresh;
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
  const withoutBuildCheckRecovery = <T extends { workflow: DefineWorkflowOptions }>(
    application: T,
  ) => ({
    ...application,
    workflow: {
      ...application.workflow,
      transitions: application.workflow.transitions?.filter(
        (edge) =>
          !(
            profile !== 'full' &&
            edge.from === `${profile}.build.check.evidence` &&
            edge.on === 'invalidated'
          ),
      ),
    },
  });
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
          const beforeRefresh = withoutCheckRefresh(application);
          if (run?.workflow.hash === hashRuntimeValue(defineWorkflow(beforeRefresh.workflow)))
            return beforeRefresh;
          const previousRecovery = withoutBuildCheckRecovery(application);
          const oldRecoveryBeforeRefresh = withoutCheckRefresh(previousRecovery);
          if (
            run?.workflow.hash ===
            hashRuntimeValue(defineWorkflow(oldRecoveryBeforeRefresh.workflow))
          )
            return options.upgradeBuildCheckRecovery ? application : oldRecoveryBeforeRefresh;
          if (run?.workflow.hash === hashRuntimeValue(defineWorkflow(previousRecovery.workflow)))
            return options.upgradeBuildCheckRecovery ? application : previousRecovery;
          const previous = compatible(application);
          const oldBeforeRefresh = withoutCheckRefresh(previous);
          if (run?.workflow.hash === hashRuntimeValue(defineWorkflow(oldBeforeRefresh.workflow)))
            return options.upgradePresetRequirements ? application : oldBeforeRefresh;
          if (run?.workflow.hash === hashRuntimeValue(defineWorkflow(previous.workflow)))
            return options.upgradePresetRequirements ? application : previous;
          const previousBoth = withoutBuildCheckRecovery(previous);
          const oldBothBeforeRefresh = withoutCheckRefresh(previousBoth);
          if (
            run?.workflow.hash === hashRuntimeValue(defineWorkflow(oldBothBeforeRefresh.workflow))
          )
            return options.upgradePresetRequirements
              ? application
              : options.upgradeBuildCheckRecovery
                ? oldBeforeRefresh
                : oldBothBeforeRefresh;
          if (run?.workflow.hash === hashRuntimeValue(defineWorkflow(previousBoth.workflow)))
            return options.upgradePresetRequirements
              ? application
              : options.upgradeBuildCheckRecovery
                ? previous
                : previousBoth;
        }
      }
    }
  }
  const previous = compatible(base);
  const oldRecovery = withoutBuildCheckRecovery(base);
  if (run?.workflow.hash === hashRuntimeValue(defineWorkflow(oldRecovery.workflow)))
    return options.upgradeBuildCheckRecovery ? base : oldRecovery;
  if (run?.workflow.hash === hashRuntimeValue(defineWorkflow(previous.workflow)))
    return options.upgradePresetRequirements ? base : previous;
  const previousBoth = withoutBuildCheckRecovery(previous);
  if (run?.workflow.hash === hashRuntimeValue(defineWorkflow(previousBoth.workflow)))
    return options.upgradePresetRequirements
      ? base
      : options.upgradeBuildCheckRecovery
        ? previous
        : previousBoth;
  return base;
}
