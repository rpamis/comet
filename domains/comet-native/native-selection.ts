import {
  clearCometCurrentSelection,
  clearCometCurrentSelectionIf,
  cometCurrentSelectionFile,
  readCometCurrentSelection,
  writeCometCurrentSelection,
  type CometCurrentSelection,
} from '../comet-entry/current-selection.js';
import { assertNativeName, readNativeChange } from './native-change.js';
import { assertNoPendingNativeRootMove } from './native-config.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import type { NativeProjectPaths } from './native-types.js';

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

export async function selectNativeChange(paths: NativeProjectPaths, name: string): Promise<void> {
  return withNativeMutationLock(paths, `select change ${name}`, async () => {
    assertNativeName(name);
    await readNativeChange(paths, name);
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
  await readNativeChange(paths, value.change);
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
