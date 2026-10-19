import type { RuntimeAction } from '../engine/runtime.js';
import type { ClassicState } from './classic-state.js';

export interface ClassicConfigurationReadiness {
  missingFields: string[];
  invalidFields: Array<{
    field: string;
    reason: string;
  }>;
}

type ClassicBuildConfigurationState = Pick<
  ClassicState,
  'workflow' | 'buildMode' | 'subagentDispatch' | 'tddMode' | 'reviewMode' | 'directOverride'
>;

/**
 * Derive the user-facing full-workflow configuration gap from the same state
 * values used by the Classic resolver. Workspace selection is intentionally
 * excluded: it has its own recovery action and safety checks.
 */
export function classicConfigurationReadiness(
  state: ClassicBuildConfigurationState,
): ClassicConfigurationReadiness {
  if (state.workflow !== 'full') return { missingFields: [], invalidFields: [] };

  const missingFields: string[] = [];
  const invalidFields: ClassicConfigurationReadiness['invalidFields'] = [];

  if (!state.buildMode) missingFields.push('build_mode');
  if (!state.tddMode) missingFields.push('tdd_mode');
  if (!state.reviewMode) missingFields.push('review_mode');

  if (state.buildMode === 'subagent-driven-development' && state.subagentDispatch !== 'confirmed') {
    missingFields.push('subagent_dispatch');
  }
  if (state.buildMode !== 'subagent-driven-development' && state.subagentDispatch === 'confirmed') {
    invalidFields.push({
      field: 'subagent_dispatch',
      reason: 'subagent_dispatch=confirmed 仅适用于 build_mode=subagent-driven-development',
    });
  }
  if (state.buildMode !== 'direct' && state.directOverride === true) {
    invalidFields.push({
      field: 'direct_override',
      reason: 'direct_override=true 仅适用于 build_mode=direct',
    });
  }
  if (state.buildMode === 'autonomous' && state.reviewMode === 'off') {
    invalidFields.push({
      field: 'review_mode',
      reason: 'autonomous full build requires review_mode=standard or thorough',
    });
  }
  if (state.buildMode === 'direct' && state.directOverride !== true) {
    invalidFields.push({
      field: 'direct_override',
      reason: 'full workflow direct execution requires direct_override=true',
    });
  }

  return { missingFields, invalidFields };
}

export function classicConfigurationReady(state: ClassicBuildConfigurationState): boolean {
  const readiness = classicConfigurationReadiness(state);
  return readiness.missingFields.length === 0 && readiness.invalidFields.length === 0;
}

/** 仅内置配置提案可修正已拒结果；执行任务与未回传的领取仍须核对原执行器。 */
export function isClassicSdkRejectedBuildProposal(action: Readonly<RuntimeAction>): boolean {
  return (
    action.stepId === 'full.build.configure' &&
    action.type === 'invoke_skill' &&
    action.ref === 'comet-build' &&
    (action.status === 'running' || action.status === 'unknown') &&
    action.claim?.executorId === 'comet-classic-state' &&
    !!action.rejectedOutcomes?.some(
      ({ outcome, code }) =>
        (code === 'OUTCOME_REJECTED' || code === 'OUTPUT_INVALID') &&
        outcome.status === 'succeeded' &&
        outcome.actionId === action.id &&
        outcome.attempt === action.attempt &&
        outcome.inputHash === action.inputHash &&
        outcome.claimToken === action.claim?.token,
    )
  );
}
