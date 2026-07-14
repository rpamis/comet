import { promises as fs } from 'fs';
import path from 'path';

import { atomicWriteJson } from './native-atomic-file.js';
import { assertNativeName, readNativeChange } from './native-change.js';
import { assertNoPendingNativeRootMove } from './native-config.js';
import type { NativeProjectPaths } from './native-types.js';

interface NativeSelection {
  schema: 'comet.native.selection.v1';
  change: string;
}

export function nativeSelectionFile(paths: NativeProjectPaths): string {
  return path.join(paths.runtimeDir, 'current-change.json');
}

export async function selectNativeChange(paths: NativeProjectPaths, name: string): Promise<void> {
  await assertNoPendingNativeRootMove(paths.projectRoot);
  assertNativeName(name);
  await readNativeChange(paths, name);
  const selection: NativeSelection = { schema: 'comet.native.selection.v1', change: name };
  await atomicWriteJson(nativeSelectionFile(paths), selection);
}

export async function resolveSelectedNativeChange(
  paths: NativeProjectPaths,
): Promise<string | null> {
  let source: string;
  try {
    source = await fs.readFile(nativeSelectionFile(paths), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const value = JSON.parse(source) as Partial<NativeSelection>;
  if (value.schema !== 'comet.native.selection.v1' || typeof value.change !== 'string') {
    throw new Error('Invalid Native current-change selection');
  }
  assertNativeName(value.change);
  await readNativeChange(paths, value.change);
  return value.change;
}

export async function clearNativeSelection(paths: NativeProjectPaths): Promise<void> {
  await assertNoPendingNativeRootMove(paths.projectRoot);
  await fs.rm(nativeSelectionFile(paths), { force: true });
}

export async function clearNativeSelectionIf(
  paths: NativeProjectPaths,
  name: string,
): Promise<boolean> {
  let source: string;
  try {
    source = await fs.readFile(nativeSelectionFile(paths), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  const value = JSON.parse(source) as Partial<NativeSelection>;
  if (value.schema !== 'comet.native.selection.v1' || value.change !== name) return false;
  await clearNativeSelection(paths);
  return true;
}
