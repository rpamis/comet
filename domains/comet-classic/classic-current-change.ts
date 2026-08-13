import {
  clearCometCurrentSelection,
  clearCometCurrentSelectionIf,
  cometCurrentSelectionFile,
  readCometCurrentSelection,
  writeCometCurrentSelection,
  type CometCurrentSelection,
} from '../comet-entry/current-selection.js';
import { memoizedHookRead } from '../../platform/process/hook-read-cache.js';
import {
  driftStaleReason,
  resolveBranchBinding,
  unboundDetachedMessage,
} from './classic-branch-binding.js';
import { assertOpenSpecChangeName, inspectClassicActiveChangeDirectory } from './classic-paths.js';
import { readClassicState } from './classic-store.js';
import { resolveClassicWorkspace } from './classic-workspace.js';
import { ClassicLayoutUnavailableError } from './classic-layout.js';

// Share the current-selection read with the router layer when both execute
// inside one Hook decision. The clear/write paths below keep the raw reader
// because they are not part of the cached Hook-read scope.
const readCachedCurrentSelection = memoizedHookRead(
  'readCometCurrentSelection',
  (projectRoot: string) => readCometCurrentSelection(projectRoot),
);

export type CurrentChangeSelection = CometCurrentSelection;

export type CurrentChangeResolution =
  | { status: 'selected'; selection: CurrentChangeSelection }
  | { status: 'missing' }
  | { status: 'stale'; reason: string };

export function currentChangeFile(projectRoot: string): string {
  return cometCurrentSelectionFile(projectRoot);
}

async function validateActiveChange(projectRoot: string, changeName: string): Promise<string> {
  assertOpenSpecChangeName(changeName);
  const active = await inspectClassicActiveChangeDirectory(changeName, projectRoot);
  if (!active.stateExists) {
    throw new Error(`Cannot select current change '${changeName}': active change state not found`);
  }

  const projection = await readClassicState(active.directory, { migrate: false });
  if (!projection.classic) {
    throw new Error(`Cannot select current change '${changeName}': Classic state is incomplete`);
  }
  if (projection.classic.archived) {
    throw new Error(`Cannot select current change '${changeName}': change is archived`);
  }
  return active.directory;
}

export async function selectCurrentChange(
  projectRoot: string,
  changeName: string,
): Promise<CurrentChangeSelection> {
  assertOpenSpecChangeName(changeName);
  let localInspection: Awaited<ReturnType<typeof inspectClassicActiveChangeDirectory>> = {
    label: '',
    directory: '',
    exists: false,
    stateExists: false,
  };
  try {
    localInspection = await inspectClassicActiveChangeDirectory(changeName, projectRoot);
  } catch (error) {
    if (!(error instanceof ClassicLayoutUnavailableError)) throw error;
  }
  let workspace: Awaited<ReturnType<typeof resolveClassicWorkspace>>;
  try {
    workspace = await resolveClassicWorkspace({ projectRoot, name: changeName });
  } catch (error) {
    if (!localInspection.stateExists) await validateActiveChange(projectRoot, changeName);
    throw error;
  }
  const selectedProjectRoot = workspace.projectRoot;
  const changeDir = await validateActiveChange(selectedProjectRoot, changeName);
  const outcome = await resolveBranchBinding(changeDir, {
    heal: true,
    cwd: selectedProjectRoot,
  });
  if (outcome.status === 'drift') {
    throw new Error(driftStaleReason(changeName, outcome.boundBranch, outcome.currentBranch));
  }
  if (outcome.status === 'unbound-detached') {
    throw new Error(unboundDetachedMessage(changeName));
  }
  const selection: CurrentChangeSelection = {
    schema: 'comet.selection.v2',
    workflow: 'classic',
    change: changeName,
    branch: outcome.currentBranch,
  };
  await writeCometCurrentSelection(selectedProjectRoot, selection);
  return selection;
}

export async function resolveCurrentChange(projectRoot: string): Promise<CurrentChangeResolution> {
  let current;
  try {
    current = await readCachedCurrentSelection(projectRoot);
  } catch (error) {
    return {
      status: 'stale',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (current.status === 'missing') return { status: 'missing' };
  if (current.selection.workflow !== 'classic') {
    return {
      status: 'stale',
      reason: `current change '${current.selection.change}' belongs to Native, not Classic`,
    };
  }

  const selection = current.selection;
  let changeDir: string;
  try {
    changeDir = await validateActiveChange(projectRoot, selection.change);
  } catch (error) {
    return {
      status: 'stale',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const outcome = await resolveBranchBinding(changeDir, {
    heal: false,
    cwd: projectRoot,
  });
  if (outcome.status === 'drift') {
    return {
      status: 'stale',
      reason: driftStaleReason(selection.change, outcome.boundBranch, outcome.currentBranch),
    };
  }
  if (outcome.status === 'unbound-detached') {
    return { status: 'stale', reason: unboundDetachedMessage(selection.change) };
  }
  if (outcome.status === 'ok') return { status: 'selected', selection };
  if (selection.branch !== null && outcome.currentBranch !== selection.branch) {
    return {
      status: 'stale',
      reason: `current change '${selection.change}' was selected on branch '${selection.branch}', current branch is '${outcome.currentBranch ?? 'detached HEAD'}'`,
    };
  }
  return { status: 'selected', selection };
}

export async function clearCurrentChange(projectRoot: string): Promise<void> {
  let current;
  try {
    current = await readCometCurrentSelection(projectRoot);
  } catch {
    return;
  }
  if (current.status === 'selected' && current.selection.workflow === 'classic') {
    await clearCometCurrentSelection(projectRoot);
  }
}

export async function clearCurrentChangeIf(projectRoot: string, change: string): Promise<boolean> {
  return clearCometCurrentSelectionIf(projectRoot, 'classic', change);
}
