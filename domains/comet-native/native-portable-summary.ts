import type { NativePortableState } from './native-portable-types.js';

export interface NativePortableStateSummary {
  schema: 'comet.native.state-summary.v1';
  name: string;
  phase: NativePortableState['phase'];
  status: NativePortableState['status'];
  state_version: number;
  coordination_mode?: NativePortableState['coordination_mode'];
  loop: NativePortableState['loop'];
  acceptance: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    pending: number;
  };
  unresolved_acceptance_ids: string[];
  verification_result: NativePortableState['verification_result'];
  blockers: Array<{
    owner: NativePortableState['blockers'][number]['owner'];
    reason: string;
    acceptance_ids: string[];
    resolution_action: NativePortableState['blockers'][number]['resolution_action'];
  }>;
  workspace: Pick<
    NativePortableState['workspace'],
    'isolation' | 'change_branch' | 'target_branch' | 'finish'
  >;
  archived: boolean;
}

function compactReason(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 237)}...`;
}

export function nativePortableStateSummary(state: NativePortableState): NativePortableStateSummary {
  const acceptance = state.acceptance.reduce<NativePortableStateSummary['acceptance']>(
    (result, entry) => ({ ...result, [entry.result]: result[entry.result] + 1 }),
    { total: state.acceptance.length, passed: 0, failed: 0, blocked: 0, pending: 0 },
  );
  return {
    schema: 'comet.native.state-summary.v1',
    name: state.name,
    phase: state.phase,
    status: state.status,
    state_version: state.state_version,
    ...(state.coordination_mode === undefined
      ? {}
      : { coordination_mode: state.coordination_mode }),
    loop: state.loop,
    acceptance,
    unresolved_acceptance_ids: state.acceptance
      .filter(({ result }) => result === 'failed' || result === 'blocked')
      .map(({ id }) => id),
    verification_result: state.verification_result,
    blockers: state.blockers.slice(0, 8).map((blocker) => ({
      owner: blocker.owner,
      reason: compactReason(blocker.reason.text),
      acceptance_ids: blocker.acceptance_ids,
      resolution_action: blocker.resolution_action,
    })),
    workspace: {
      isolation: state.workspace.isolation,
      change_branch: state.workspace.change_branch,
      target_branch: state.workspace.target_branch,
      finish: state.workspace.finish,
    },
    archived: state.archived,
  };
}
