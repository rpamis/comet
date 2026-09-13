import {
  rebuildNativeLocalExecution,
  writeNativeLocalExecution,
} from './native-local-execution.js';
import { appendNativePortableHistory } from './native-portable-state.js';
import { toNativePortableText } from './native-portable-text.js';
import type { NativePortableState } from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';
import {
  currentBranch,
  nativeLocalExecutionFile,
  writePortableMutation,
} from './native-portable-storage.js';

export async function returnNativePortableStateToFinalVerificationLocked(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  reason: string;
}): Promise<NativePortableState> {
  const { state } = options;
  if (state.archived) throw new Error(`Native change ${state.name} is already archived`);
  if (state.verification === null || state.verification_result !== 'pass') {
    throw new Error('Native Supervisor recovery requires a persisted final verification pass');
  }
  const withHistory = appendNativePortableHistory(state, {
    goal_cycle: state.loop.goal_cycle,
    iteration: state.loop.iteration,
    attempt: state.loop.attempt,
    outcome: 'recovery',
    unresolved_ids: [],
    summary: toNativePortableText(options.reason),
    completed_at: new Date().toISOString(),
  });
  const next: NativePortableState = {
    ...withHistory,
    phase: 'verify',
    status: 'active',
    state_version: state.state_version + 1,
    acceptance: state.acceptance.map((entry) => ({ ...entry, result: 'pending', reason: null })),
    blockers: [],
    verification: null,
    verification_result: 'pending',
    verification_report: null,
    loop: {
      ...state.loop,
      stage: 'verify-ready',
      execution_failure_count: 0,
      previous_unresolved_ids: [],
      no_progress_count: 0,
      next_action: 'run-final-full-verification',
    },
  };
  const written = await writePortableMutation({ paths: options.paths, previous: state, next });
  await writeNativeLocalExecution(
    nativeLocalExecutionFile(options.paths, state.name),
    rebuildNativeLocalExecution({
      portableState: written,
      projectRoot: options.paths.projectRoot,
      branch: currentBranch(options.paths.projectRoot),
    }),
    { containedRoot: options.paths.runtimeDir },
  );
  return written;
}
