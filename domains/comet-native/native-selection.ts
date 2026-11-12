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
import { withNativeMutation } from './native-mutation.js';
import { parseNativePortableState } from './native-portable-state.js';
import type { NativeProjectPaths } from './native-types.js';
import { isNativePortableChange, readNativePortableChange } from './native-portable-runtime.js';
import path from 'node:path';
import { createFileRuntimeStore, createRuntime, type WorkflowRun } from '../engine/runtime.js';
import {
  loadWorkflowApplication,
  resolveWorkflowApplicationFile,
} from '../workflow-application/application.js';

export const NATIVE_SELECTION_MAX_BYTES = Number.MAX_SAFE_INTEGER;

export async function readNativeSelectionRecord(
  paths: NativeProjectPaths,
): Promise<CometCurrentSelection | null> {
  const current = await readCometCurrentSelection(paths.projectRoot);
  if (current.status === 'missing') return null;
  if (current.selection.workflow !== 'native') {
    if (current.selection.workflow !== 'application') return null;
    const owner = await readSdkChangeOwner(paths.projectRoot, 'native', current.selection.change, {
      readOnly: true,
    });
    if (!owner || owner.application !== current.selection.applicationId) return null;
  }
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
  const owner = await readSdkChangeOwner(paths.projectRoot, 'native', name);
  if (owner) {
    const application =
      owner.application === 'native'
        ? null
        : await loadWorkflowApplication({
            projectRoot: paths.projectRoot,
            runId: name,
            file: await resolveWorkflowApplicationFile(paths.projectRoot, owner.application, name),
          });
    const runtime = application
      ? createRuntime({ ...application.implementation, store: application.store })
      : createRuntime({
          workflows: [],
          store: createFileRuntimeStore<WorkflowRun>({
            singleWriter: true,
            rootDir: path.join(paths.workspaceRuntimeRoot, 'sdk-runs/native'),
          }),
        });
    const run = await runtime.inspect(name);
    if (run.workflow.id !== 'comet-native' || parseNativePortableState(run.state).name !== name) {
      throw new Error(`Native SDK Run ${name} does not match its change selection`);
    }
  } else if (await isNativePortableChange(paths, name)) {
    await readNativePortableChange(paths, name);
  } else {
    await readNativeChange(paths, name);
  }
}

export async function selectNativeChange(paths: NativeProjectPaths, name: string): Promise<void> {
  return withNativeMutation(paths, async () => {
    assertNativeName(name);
    await assertNativeChangeSelectable(paths, name);
    const owner = await readSdkChangeOwner(paths.projectRoot, 'native', name);
    await writeCometCurrentSelection(paths.projectRoot, {
      schema: 'comet.selection.v2',
      workflow: owner && owner.application !== 'native' ? 'application' : 'native',
      ...(owner && owner.application !== 'native' ? { applicationId: owner.application } : {}),
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
  return withNativeMutation(paths, () => clearNativeSelectionLocked(paths));
}

export async function clearNativeSelectionLocked(paths: NativeProjectPaths): Promise<void> {
  await assertNoPendingNativeRootMove(paths.projectRoot);
  const current = await readCometCurrentSelection(paths.projectRoot);
  if (current.status === 'selected' && (await readNativeSelectionRecord(paths))) {
    await clearCometCurrentSelection(paths.projectRoot);
  }
}

export async function clearNativeSelectionIf(
  paths: NativeProjectPaths,
  name: string,
): Promise<boolean> {
  return withNativeMutation(paths, () => clearNativeSelectionIfLocked(paths, name));
}

export async function clearNativeSelectionIfLocked(
  paths: NativeProjectPaths,
  name: string,
): Promise<boolean> {
  await assertNoPendingNativeRootMove(paths.projectRoot);
  const selected = await readNativeSelectionRecord(paths);
  return selected?.change === name
    ? clearCometCurrentSelectionIf(paths.projectRoot, selected.workflow, name)
    : false;
}
