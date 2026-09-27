import {
  clearCometCurrentSelection,
  clearCometCurrentSelectionIf,
  cometCurrentSelectionFile,
  readCometCurrentSelection,
  writeCometCurrentSelection,
  type CometCurrentSelection,
} from '../workflow-contract/current-selection.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { assertNativeName, readNativeChange } from './native-change.js';
import { assertNoPendingNativeRootMove } from './native-config.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { parseNativePortableState } from './native-portable-state.js';
import type { NativeProjectPaths } from './native-types.js';
import { isNativePortableChange, readNativePortableChange } from './native-portable-runtime.js';

export const NATIVE_SELECTION_MAX_BYTES = 16 * 1024;

export async function readNativeSelectionRecord(
  paths: NativeProjectPaths,
): Promise<CometCurrentSelection | null> {
  const current = await readCometCurrentSelection(paths.projectRoot);
  if (current.status === 'missing' || current.selection.workflow !== 'native') return null;
  assertNativeName(current.selection.change);
  return current.selection;
}

export function nativeSelectionFile(paths: NativeProjectPaths): string {
  return cometCurrentSelectionFile(paths.projectRoot);
}

async function assertNativeChangeSelectable(
  paths: NativeProjectPaths,
  name: string,
): Promise<void> {
  if (await readSdkChangeOwner(paths.projectRoot, 'native', name)) {
    const runtime = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(paths.projectRoot, '.comet', 'runtime', 'sdk-runs', 'native'),
      }),
      workflows: [],
    });
    const run = await runtime.inspect(name);
    if (
      run.workflow.id !== 'comet-native' ||
      run.workflow.version !== '1' ||
      parseNativePortableState(run.state).name !== name
    ) {
      throw new Error(`Native SDK Run ${name} does not match its change selection`);
    }
  } else if (await isNativePortableChange(paths, name)) {
    await readNativePortableChange(paths, name);
  } else {
    await readNativeChange(paths, name);
  }
}

export async function selectNativeChange(paths: NativeProjectPaths, name: string): Promise<void> {
  return withNativeMutationLock(paths, `select change ${name}`, async () => {
    assertNativeName(name);
    await assertNativeChangeSelectable(paths, name);
    await writeCometCurrentSelection(paths.projectRoot, {
      schema: 'comet.selection.v2',
      workflow: 'native',
      change: name,
      branch: null,
    });
  });
}

export async function resolveSelectedNativeChange(
  paths: NativeProjectPaths,
): Promise<string | null> {
  const value = await readNativeSelectionRecord(paths);
  if (!value) return null;
  await assertNativeChangeSelectable(paths, value.change);
  return value.change;
}

export async function clearNativeSelection(paths: NativeProjectPaths): Promise<void> {
  return withNativeMutationLock(paths, 'clear change selection', () =>
    clearNativeSelectionLocked(paths),
  );
}

export async function clearNativeSelectionLocked(paths: NativeProjectPaths): Promise<void> {
  await assertNoPendingNativeRootMove(paths.projectRoot);
  const current = await readCometCurrentSelection(paths.projectRoot);
  if (current.status === 'selected' && current.selection.workflow === 'native') {
    await clearCometCurrentSelection(paths.projectRoot);
  }
}

export async function clearNativeSelectionIf(
  paths: NativeProjectPaths,
  name: string,
): Promise<boolean> {
  return withNativeMutationLock(paths, `clear selection for ${name}`, () =>
    clearNativeSelectionIfLocked(paths, name),
  );
}

export async function clearNativeSelectionIfLocked(
  paths: NativeProjectPaths,
  name: string,
): Promise<boolean> {
  await assertNoPendingNativeRootMove(paths.projectRoot);
  return clearCometCurrentSelectionIf(paths.projectRoot, 'native', name);
}
import path from 'node:path';

import { createFileRuntimeStore, createRuntime, type WorkflowRun } from '../engine/runtime.js';
