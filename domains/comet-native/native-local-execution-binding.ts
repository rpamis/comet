import { randomUUID } from 'node:crypto';
import { readNativeLocalExecution, rebuildNativeLocalExecution } from './native-local-execution.js';
import { currentBranch, nativeLocalExecutionFile } from './native-portable-storage.js';
import type { NativeLocalExecutionState, NativePortableState } from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';
import { activeNativeVerifierAction } from './native-verifier-action.js';

export function preservedLocalChecksForVersion(options: {
  local: NativeLocalExecutionState | null;
  state: NativePortableState;
  projectRoot: string;
}): NativeLocalExecutionState {
  if (options.local === null || options.local.change !== options.state.name) {
    return rebuildNativeLocalExecution({
      portableState: options.state,
      projectRoot: options.projectRoot,
      branch: currentBranch(options.projectRoot),
    });
  }
  const operationId = options.local.execution?.operationId ?? randomUUID();
  return {
    ...options.local,
    basedOnStateVersion: options.state.state_version,
    execution: {
      operationId,
      stage: 'checking',
      actor: 'runtime',
      executionId: null,
      status: 'completed',
      startedAt: options.local.execution?.startedAt ?? new Date().toISOString(),
      requestCheckRounds: 0,
    },
    checks: options.local.checks.map((check) =>
      check.status === 'running' || check.status === 'planned'
        ? { ...check, operationId, status: 'interrupted' as const }
        : { ...check, operationId },
    ),
  };
}

export async function readCurrentLocalExecution(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  allowMissing?: boolean;
}): Promise<NativeLocalExecutionState | null> {
  const local = await readNativeLocalExecution(
    nativeLocalExecutionFile(options.paths, options.state.name),
  );
  if (!local) return null;
  const action = activeNativeVerifierAction(options.state);
  const boundToAction =
    action &&
    local.execution?.operationId === action.id &&
    local.candidateId === options.state.builder_handoff?.candidate_id;
  if (
    local.change !== options.state.name ||
    (local.candidateId !== undefined &&
      local.candidateId !== options.state.builder_handoff?.candidate_id) ||
    (local.basedOnStateVersion !== options.state.state_version && !boundToAction) ||
    (action && !boundToAction)
  )
    return null;
  return { ...local, basedOnStateVersion: options.state.state_version };
}
