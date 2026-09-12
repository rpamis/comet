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
