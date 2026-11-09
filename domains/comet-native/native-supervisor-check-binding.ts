import os from 'node:os';
import path from 'node:path';
import { atomicWriteText } from './native-atomic-file.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { nativeCheckPlanKey } from './native-check-executor.js';
import { nativePreferredChangeRuntimeDir, nativeRuntimeRefFile } from './native-paths.js';
import type { NativeProjectPaths } from './native-types.js';

import {
  nativePortableArgvDisplay,
  type NativeCheckPlan,
  type NativeExecutedCheck,
} from './native-check-executor.js';
import type { NativeSupervisorCheckExecutionState } from './native-supervisor.js';

export type NativeSupervisorCheckBindingKind = 'child' | 'integration';

export function plannedNativeSupervisorCheckState(
  plan: NativeCheckPlan,
): NativeSupervisorCheckExecutionState {
  return {
    id: plan.id,
    name: plan.name,
    status: 'planned',
    repeatable: plan.repeatable,
    executionCount: 0,
    argvDisplay: nativePortableArgvDisplay(plan.argv),
    cwdRef: plan.cwdRef,
    exitCode: null,
    signal: null,
    timedOut: false,
    durationMs: 0,
    startedAt: null,
    completedAt: null,
    logRef: null,
  };
}

export function completedNativeSupervisorCheckState(
  previous: NativeSupervisorCheckExecutionState,
  result: NativeExecutedCheck,
): NativeSupervisorCheckExecutionState {
  return {
    ...previous,
    name: result.name,
    status: result.status,
    argvDisplay: [...result.argvDisplay],
    cwdRef: result.cwdRef,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    logRef: result.logRef,
  };
}

export function nativeSupervisorExecutedCheckFromState(
  state: NativeSupervisorCheckExecutionState,
): NativeExecutedCheck {
  if (
    (state.status !== 'passed' && state.status !== 'failed' && state.status !== 'interrupted') ||
    state.startedAt === null ||
    state.completedAt === null ||
    state.logRef === null
  ) {
    throw new Error(`Native Supervisor check ${state.id} has incomplete Runtime evidence`);
  }
  return {
    id: state.id,
    name: state.name,
    argvDisplay: [...state.argvDisplay],
    cwdRef: state.cwdRef,
    status: state.status,
    exitCode: state.exitCode,
    signal: state.signal,
    timedOut: state.timedOut,
    durationMs: state.durationMs,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    repeatable: state.repeatable,
    logRef: state.logRef,
  };
}

export function nativeSupervisorCheckMachineId(): string {
  return os.hostname();
}

export function sameNativeSupervisorCheckPlans(
  previous: readonly NativeCheckPlan[] | undefined,
  plans: readonly NativeCheckPlan[],
): boolean {
  return Boolean(
    previous &&
    previous.length === plans.length &&
    previous.every(
      (plan, index) =>
        plan.id === plans[index].id &&
        nativeCheckPlanKey(plan) === nativeCheckPlanKey(plans[index]),
    ),
  );
}
export async function writeNativeSupervisorCheckReceipt(options: {
  paths: NativeProjectPaths;
  name: string;
  operationId: string;
  text: string;
}): Promise<string> {
  if (!/^[a-zA-Z0-9-]+$/u.test(options.operationId)) throw new Error('Invalid check operation ID');
  const runtimeDir = nativePreferredChangeRuntimeDir(options.paths, options.name);
  const ref = 'checks/' + options.operationId + '.json';
  await atomicWriteText(path.join(runtimeDir, ref), options.text, {
    containedRoot: options.paths.runtimeDir,
  });
  return 'runtime/' + ref;
}
export async function readNativeSupervisorCheckReceipt(
  paths: NativeProjectPaths,
  name: string,
  ref: string,
): Promise<string> {
  const runtimeDir = nativePreferredChangeRuntimeDir(paths, name);
  const file = nativeRuntimeRefFile(runtimeDir, ref);
  const result = await readNativeBoundedTextFile({
    root: runtimeDir,
    ref: path.relative(runtimeDir, file).replaceAll('\\', '/'),
    maxBytes: null,
    includeHash: false,
  });
  if (ref.startsWith('runtime/evidence/reports/')) {
    const old = JSON.parse(result.text) as { content?: unknown };
    if (typeof old.content !== 'string')
      throw new Error('Legacy Supervisor check record is incomplete');
    return old.content;
  }
  return result.text;
}
