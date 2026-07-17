import path from 'path';

import { NATIVE_RUN_STORAGE } from '../engine/storage-layout.js';
import { nativeChangeDir } from './native-change.js';
import {
  readNativeCheckpoint,
  readNativeRunState,
  readNativeTrajectory,
} from './native-run-store.js';
import { inspectNativeTrajectoryTail } from './native-trajectory-recovery.js';
import type { NativeChangeState, NativeFinding, NativeProjectPaths } from './native-types.js';

function runPath(changeDir: string, ref: string): string {
  return path.resolve(changeDir, ...ref.split(/[\\/]/u));
}

export async function inspectNativeRunConsistency(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeFinding[]> {
  const findings: NativeFinding[] = [];
  const changeDir = nativeChangeDir(paths, state.name);
  const stateFile = runPath(changeDir, NATIVE_RUN_STORAGE.stateRef);
  let run;
  try {
    run = await readNativeRunState(changeDir);
  } catch (error) {
    return [
      {
        code: 'run-state-invalid',
        message: `Native Run state is invalid: ${(error as Error).message}`,
        path: stateFile,
      },
    ];
  }
  if (!run) {
    if (state.run_id !== null || state.phase !== 'shape') {
      findings.push({
        code: 'run-state-missing',
        message: 'Native change references a missing Run state',
        path: stateFile,
      });
    }
    return findings;
  }
  if (state.run_id === null) {
    return [
      {
        code: 'run-state-unexpected',
        message: 'Native change has a Run state but no run_id',
        path: stateFile,
      },
    ];
  }
  if (run.runId !== state.run_id) {
    findings.push({
      code: 'run-id-mismatch',
      message: `Native Run id ${run.runId} does not match change run_id ${state.run_id}`,
      path: stateFile,
    });
  }
  if (run.pending || run.status === 'waiting') {
    findings.push({
      code: 'run-action-pending',
      message: 'Native Run has an unresolved pending action',
      path: stateFile,
    });
  }
  if (run.currentStep !== state.phase) {
    findings.push({
      code: 'run-phase-mismatch',
      message: `Native Run step ${run.currentStep ?? '(none)'} does not match phase ${state.phase}`,
      path: stateFile,
    });
  }

  const trajectoryFile = runPath(changeDir, run.trajectoryRef);
  const tailInspection = await inspectNativeTrajectoryTail(paths, state.name);
  if (tailInspection.status === 'repairable') {
    findings.push({
      code: 'trajectory-tail-incomplete',
      message: `Native trajectory final line is incomplete at line ${tailInspection.line}; doctor repair can discard ${tailInspection.discardedBytes} incomplete byte(s)`,
      path: trajectoryFile,
    });
    return findings;
  }
  if (tailInspection.status === 'invalid') {
    findings.push({
      code: 'trajectory-invalid',
      message: `Native trajectory is invalid at line ${tailInspection.line}: ${tailInspection.message}`,
      path: trajectoryFile,
    });
    return findings;
  }
  let trajectory;
  try {
    trajectory = await readNativeTrajectory(changeDir, run.trajectoryRef);
    if (
      trajectory.length === 0 ||
      trajectory.some(
        (event, index) =>
          !event ||
          typeof event !== 'object' ||
          event.sequence !== index + 1 ||
          event.runId !== run.runId ||
          typeof event.type !== 'string' ||
          !event.data ||
          typeof event.data !== 'object' ||
          Array.isArray(event.data),
      )
    ) {
      throw new Error('trajectory events are missing or inconsistent');
    }
  } catch (error) {
    findings.push({
      code: 'trajectory-invalid',
      message: `Native trajectory is invalid: ${(error as Error).message}`,
      path: trajectoryFile,
    });
    return findings;
  }

  const checkpointFile = runPath(changeDir, run.checkpointRef);
  try {
    const checkpoint = await readNativeCheckpoint(changeDir, run.checkpointRef);
    if (!checkpoint) {
      findings.push({
        code: 'checkpoint-missing',
        message: 'Native Run checkpoint is missing',
        path: checkpointFile,
      });
    } else if (
      checkpoint.runId !== run.runId ||
      checkpoint.stateVersion !== run.iteration ||
      checkpoint.trajectoryOffset !== trajectory.length
    ) {
      findings.push({
        code: 'checkpoint-mismatch',
        message: 'Native Run checkpoint does not match Run state and trajectory',
        path: checkpointFile,
      });
    }
  } catch (error) {
    findings.push({
      code: 'checkpoint-invalid',
      message: `Native Run checkpoint is invalid: ${(error as Error).message}`,
      path: checkpointFile,
    });
  }
  return findings;
}
