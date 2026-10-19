import {
  defineWorkflow,
  hashRuntimeValue,
  type WorkflowRun,
  type RuntimeCommandValidator,
} from '../engine/runtime.js';
import { defineClassicWorkflowApplication } from './classic-sdk-application.js';
import type { ClassicProfile, ClassicState } from './classic-state.js';

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
    return {
      accepted:
        state.workflow === 'full' &&
        (state.phase === phase || (name === 'revise-design' && state.phase === 'build')) &&
        !state.archived &&
        requested?.expectedRevision === run.revision &&
        Object.keys(requested).length === 2 &&
        requested.fromPhase === state.phase &&
        pending.length === 1 &&
        (designAllowed.includes(pending[0].stepId) ||
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
) {
  const base = defineClassicWorkflowApplication(profile);
  return {
    ...base,
    workflow: {
      ...base.workflow,
      transitions: [
        ...(base.workflow.transitions ?? []),
        { from: 'full.design.evidence', to: 'full.build.plan' },
      ],
      commands: {
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
  };
}

/** 只识别已知内置定义；其他 hash 交由 Runtime 按固定定义拒绝。 */
export function classicSdkApplicationForRun(profile: ClassicProfile, run: WorkflowRun | null) {
  for (const verification of [true, 'full', false] as const) {
    const application = classicSdkRevisionApplication(profile, verification);
    if (run?.workflow.hash === hashRuntimeValue(defineWorkflow(application.workflow)))
      return application;
  }
  return { ...defineClassicWorkflowApplication(profile), commandValidators: [] };
}
