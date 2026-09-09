import { CLASSIC_WIRE_KEYS, RUN_WIRE_KEYS } from './classic-state.js';

export const MACHINE_OWNED_FIELDS = new Set<string>([
  ...RUN_WIRE_KEYS,
  'archive_confirmation',
  'verify_failures',
  'check_epoch',
  'classic_profile',
  'classic_migration',
  'bound_branch',
]);
export const SETTABLE_FIELDS = new Set<string>(
  CLASSIC_WIRE_KEYS.filter((field) => !MACHINE_OWNED_FIELDS.has(field)),
);
export const FIELD_ENUMS: Record<string, readonly string[]> = {
  workflow: ['full', 'hotfix', 'tweak'],
  phase: ['open', 'design', 'build', 'verify', 'archive'],
  context_compression: ['off', 'beta'],
  build_mode: ['subagent-driven-development', 'executing-plans', 'direct'],
  build_pause: ['null', 'plan-ready'],
  subagent_dispatch: ['null', 'confirmed'],
  tdd_mode: ['tdd', 'direct'],
  review_mode: ['off', 'standard', 'thorough'],
  isolation: ['current', 'branch', 'worktree'],
  verify_mode: ['light', 'full'],
  auto_transition: ['true', 'false'],
  verify_result: ['pending', 'pass', 'fail'],
  branch_status: ['pending', 'handled'],
  archive_confirmation: ['pending', 'confirmed'],
  archived: ['true', 'false'],
  direct_override: ['true', 'false'],
  classic_profile: ['full', 'hotfix', 'tweak'],
  classic_migration: ['1'],
};
