import { randomUUID } from 'node:crypto';
import { readNativeLocalExecution, rebuildNativeLocalExecution } from './native-local-execution.js';
import { currentBranch, nativeLocalExecutionFile } from './native-portable-storage.js';
import { activeNativeVerifierAction } from './native-verifier-action.js';
import type { NativeLocalExecutionState, NativePortableState } from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';

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
}): Promise<NativeLocalExecutionState | null> {
  try {
    const local = await readNativeLocalExecution(
      nativeLocalExecutionFile(options.paths, options.state.name),
    );
    if (
      options.state.builder_handoff?.raw_input_ref &&
      (!local ||
        local.rawInputRef !== options.state.builder_handoff.raw_input_ref ||
        local.candidateId !== options.state.builder_handoff.candidate_id)
    )
      throw new Error(
        'Native 原始执行记录缺失或候选绑定不同；保留工作并诊断原执行，不能从当前文件重建旧证据',
      );
    const action = activeNativeVerifierAction(options.state);
    const boundToAction =
      action &&
      local?.execution?.operationId === action.id &&
      local?.candidateId === options.state.builder_handoff?.candidate_id;
    if (
      local === null ||
      local.change !== options.state.name ||
      (local.basedOnStateVersion !== options.state.state_version && !boundToAction) ||
      (action && !boundToAction)
    ) {
      if (options.state.builder_handoff?.raw_input_ref)
        throw new Error(
          'Native 原始执行记录版本未对齐；保留原候选和批准，恢复原执行记录，不能降级为旧摘要',
        );
      return null;
    }
    return { ...local, basedOnStateVersion: options.state.state_version };
  } catch (error) {
    if (options.state.builder_handoff?.raw_input_ref) throw error;
    return null;
  }
}
