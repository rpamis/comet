import {
  clearCometCurrentSelection,
  clearCometCurrentSelectionIf,
  cometCurrentSelectionFile,
  readCometCurrentSelection,
  writeCometCurrentSelection,
  type CometCurrentSelection,
} from '../workflow-contract/current-selection.js';
import { memoizedHookRead } from '../../platform/process/hook-read-cache.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import {
  driftStaleReason,
  evaluateBranchBinding,
  isGitWorkTree,
  liveGitBranch,
  resolveBranchBinding,
  unboundDetachedMessage,
} from './classic-branch-binding.js';
import { inspectClassicSdkRun } from './classic-sdk-status.js';
import {
  assertOpenSpecChangeName,
  findClassicArchiveChangeDirectory,
  inspectClassicActiveChangeDirectory,
} from './classic-paths.js';
import { readClassicDelivery } from './classic-progress.js';
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

// Guard 的 SDK 状态与 selection 分支校验必须基于同一个请求内快照。
const inspectHookSdkRun = memoizedHookRead(
  'classicHookSdkRun',
  (projectRoot: string, name: string) => inspectClassicSdkRun(projectRoot, name),
);

export type CurrentChangeSelection = CometCurrentSelection;

export type CurrentChangeResolution =
  | { status: 'selected'; selection: CurrentChangeSelection }
  | { status: 'missing' }
  | { status: 'stale'; reason: string };

export function currentChangeFile(projectRoot: string): string {
  return cometCurrentSelectionFile(projectRoot);
}

async function sdkSelectionBranch(projectRoot: string, changeName: string): Promise<string | null> {
  const { run, state } = await inspectHookSdkRun(projectRoot, changeName);
  if (state.archived || run.status === 'completed') {
    throw new Error(`Cannot select current change '${changeName}': change is archived`);
  }
  const currentBranch = liveGitBranch(projectRoot);
  const binding = evaluateBranchBinding({
    isolation: state.isolation,
    boundBranch: state.boundBranch,
    currentBranch,
    gitWorkTree: isGitWorkTree(projectRoot),
  });
  if (binding.status === 'drift') {
    throw new Error(driftStaleReason(changeName, binding.boundBranch, currentBranch));
  }
  if (binding.status === 'unbound-detached') {
    throw new Error(unboundDetachedMessage(changeName));
  }
  if (binding.status === 'needs-heal') {
    throw new Error(`Classic SDK change '${changeName}' has no bound branch in its Run`);
  }
  return currentBranch;
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

async function validateSelectableChange(projectRoot: string, changeName: string): Promise<string> {
  try {
    return await validateActiveChange(projectRoot, changeName);
  } catch (activeError) {
    const archived = await findClassicArchiveChangeDirectory(changeName, projectRoot);
    if (!archived) throw activeError;
    const projection = await readClassicState(archived.directory, { migrate: false });
    const delivery = await readClassicDelivery(projectRoot, archived.directory);
    if (
      !projection.classic?.archived ||
      ['complete', 'local-verified'].includes(delivery.verification.status)
    ) {
      throw activeError;
    }
    return archived.directory;
  }
}

export async function selectCurrentChange(
  projectRoot: string,
  changeName: string,
): Promise<CurrentChangeSelection> {
  assertOpenSpecChangeName(changeName);
  if (await readSdkChangeOwner(projectRoot, 'classic', changeName)) {
    const selection: CurrentChangeSelection = {
      schema: 'comet.selection.v2',
      workflow: 'classic',
      change: changeName,
      branch: await sdkSelectionBranch(projectRoot, changeName),
    };
    await writeCometCurrentSelection(projectRoot, selection);
    return selection;
  }
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
  const changeDir = await validateSelectableChange(selectedProjectRoot, changeName);
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
  try {
    if (await readSdkChangeOwner(projectRoot, 'classic', selection.change)) {
      const branch = await sdkSelectionBranch(projectRoot, selection.change);
      if (selection.branch !== null && branch !== selection.branch) {
        return {
          status: 'stale',
          reason: `current change '${selection.change}' was selected on branch '${selection.branch}', current branch is '${branch ?? 'detached HEAD'}'`,
        };
      }
      return { status: 'selected', selection };
    }
  } catch (error) {
    return { status: 'stale', reason: error instanceof Error ? error.message : String(error) };
  }
  let changeDir: string;
  try {
    changeDir = await validateActiveChange(projectRoot, selection.change);
  } catch (error) {
    try {
      const archived = await findClassicArchiveChangeDirectory(selection.change, projectRoot);
      if (!archived) throw error;
      const projection = await readClassicState(archived.directory, { migrate: false });
      const delivery = await readClassicDelivery(projectRoot, archived.directory);
      if (
        !projection.classic?.archived ||
        ['complete', 'local-verified'].includes(delivery.verification.status)
      ) {
        throw error;
      }
      changeDir = archived.directory;
    } catch (archiveError) {
      return {
        status: 'stale',
        reason: archiveError instanceof Error ? archiveError.message : String(archiveError),
      };
    }
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
