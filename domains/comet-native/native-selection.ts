import { promises as fs } from 'fs';
import path from 'path';

import { atomicWriteJson } from './native-atomic-file.js';
import { assertNativeName, readNativeChange } from './native-change.js';
import { assertNoPendingNativeRootMove } from './native-config.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { resolveContainedNativePath } from './native-paths.js';
import { readNativeProtectedTextFile } from './native-protected-file.js';
import type { NativeProjectPaths } from './native-types.js';

export interface NativeSelection {
  schema: 'comet.native.selection.v1';
  change: string;
}

export const NATIVE_SELECTION_MAX_BYTES = 16 * 1024;

export async function readNativeSelectionRecord(
  paths: NativeProjectPaths,
): Promise<NativeSelection | null> {
  const file = await resolveContainedNativePath(paths.nativeRoot, nativeSelectionFile(paths));
  let source: string;
  try {
    source = (
      await readNativeProtectedTextFile({
        root: paths.nativeRoot,
        file,
        maxBytes: NATIVE_SELECTION_MAX_BYTES,
        label: 'Native current-change selection',
      })
    ).text;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const value = JSON.parse(source) as Partial<NativeSelection>;
  if (value.schema !== 'comet.native.selection.v1' || typeof value.change !== 'string') {
    throw new Error('Invalid Native current-change selection');
  }
  assertNativeName(value.change);
  return value as NativeSelection;
}

export function nativeSelectionFile(paths: NativeProjectPaths): string {
  return path.join(paths.runtimeDir, 'current-change.json');
}

export async function selectNativeChange(paths: NativeProjectPaths, name: string): Promise<void> {
  return withNativeMutationLock(paths, `select change ${name}`, async () => {
    assertNativeName(name);
    await readNativeChange(paths, name);
    const selection: NativeSelection = { schema: 'comet.native.selection.v1', change: name };
    const file = await resolveContainedNativePath(paths.nativeRoot, nativeSelectionFile(paths));
    await atomicWriteJson(file, selection);
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
  await fs.rm(await resolveContainedNativePath(paths.nativeRoot, nativeSelectionFile(paths)), {
    force: true,
  });
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
  const value = await readNativeSelectionRecord(paths);
  if (!value || value.change !== name) return false;
  await clearNativeSelectionLocked(paths);
  return true;
}
