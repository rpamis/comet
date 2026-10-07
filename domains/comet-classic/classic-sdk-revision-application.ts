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

/** 仅给内置 Run 添加显式修订命令；原应用工厂和固定扩展包保持不变。 */
export function classicSdkRevisionApplication(profile: ClassicProfile) {
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
    commandValidators: [revisionValidator],
  };
}

/** 只识别两种已知内置定义；其他 hash 交由 Runtime 按固定定义拒绝。 */
export function classicSdkApplicationForRun(profile: ClassicProfile, run: WorkflowRun | null) {
  const revised = classicSdkRevisionApplication(profile);
  return run?.workflow.hash === hashRuntimeValue(defineWorkflow(revised.workflow))
    ? revised
    : { ...defineClassicWorkflowApplication(profile), commandValidators: [] };
}
