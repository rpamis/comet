import { findNativeV1SupervisorParents, inspectNativeChildren } from './native-children.js';
import type { NativePortableState } from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';
import { readNativePortableChange } from './native-portable-storage.js';

export interface NativeSupervisorParentAdvance {
  trigger: 'v2-integrate' | 'v1-archive' | 'recovery';
  parent: string | null;
  advanced: boolean;
  message: string | null;
  blocker: string | null;
}

/**
 * Recompute whether every Child is integrated and the parent is ready for a
 * Builder handoff. This inspection does not advance the phase.
 */
export async function inspectNativeSupervisorParentReviewReadiness(options: {
  paths: NativeProjectPaths;
  name: string;
  trigger: NativeSupervisorParentAdvance['trigger'];
}): Promise<{
  state: NativePortableState;
  parentAdvance: NativeSupervisorParentAdvance;
}> {
  const state = await readNativePortableChange(options.paths, options.name);
  const base = {
    trigger: options.trigger,
    parent: options.name,
    advanced: false,
    message: null,
    blocker: null,
  } satisfies NativeSupervisorParentAdvance;
  if (state.phase !== 'build' || state.status !== 'active') {
    return { state, parentAdvance: base };
  }
  const children = await inspectNativeChildren({ paths: options.paths, state });
  if (!children || !children.confirmed || !children.allDone) {
    return {
      state,
      parentAdvance: {
        ...base,
        blocker:
          children && !children.confirmed
            ? 'Supervisor child declarations require Shape confirmation'
            : null,
      },
    };
  }
  const message =
    state.language === 'zh-CN'
      ? '全部 Child 已完成；Supervisor 父级候选可以提交并进入验证'
      : 'All Children are complete; the Supervisor parent candidate can be submitted for verification.';
  return {
    state,
    parentAdvance: {
      ...base,
      message,
    },
  };
}

export async function tryAutoAdvanceNativeV1SupervisorParent(options: {
  childState: NativePortableState;
  childPaths: NativeProjectPaths;
}): Promise<{
  parentAdvance: NativeSupervisorParentAdvance;
  parentState: NativePortableState | null;
}> {
  const discovery = await findNativeV1SupervisorParents({
    paths: options.childPaths,
    childName: options.childState.name,
    targetBranch: options.childState.workspace.target_branch,
  });
  if (!discovery.candidate) {
    return {
      parentState: null,
      parentAdvance: {
        trigger: 'v1-archive',
        parent: null,
        advanced: false,
        message: null,
        blocker: discovery.blockers.length > 0 ? discovery.blockers.join('; ') : null,
      },
    };
  }
  const result = await inspectNativeSupervisorParentReviewReadiness({
    paths: discovery.candidate.paths,
    name: discovery.candidate.state.name,
    trigger: 'v1-archive',
  });
  return { parentState: result.state, parentAdvance: result.parentAdvance };
}
