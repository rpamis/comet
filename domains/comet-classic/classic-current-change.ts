import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import {
  clearCometCurrentSelection,
  clearCometCurrentSelectionIf,
  cometCurrentSelectionFile,
  readCometCurrentSelection,
  writeCometCurrentSelection,
  type CometCurrentSelection,
} from '../comet-entry/current-selection.js';
import { assertOpenSpecChangeName } from './classic-paths.js';
import { readClassicState } from './classic-store.js';

export type CurrentChangeSelection = CometCurrentSelection;

export type CurrentChangeResolution =
  | { status: 'selected'; selection: CurrentChangeSelection }
  | { status: 'missing' }
  | { status: 'stale'; reason: string };

export function currentChangeFile(projectRoot: string): string {
  return cometCurrentSelectionFile(projectRoot);
}

function currentBranch(projectRoot: string): string | null {
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return branch && branch !== 'HEAD' ? branch : null;
  } catch {
    return null;
  }
}

function changeDirectory(projectRoot: string, changeName: string): string {
  return path.join(projectRoot, 'openspec', 'changes', changeName);
}

async function validateActiveChange(projectRoot: string, changeName: string): Promise<void> {
  assertOpenSpecChangeName(changeName);
  const changeDir = changeDirectory(projectRoot, changeName);
  try {
    await fs.access(path.join(changeDir, '.comet.yaml'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Cannot select current change '${changeName}': active change state not found`,
        {
          cause: error,
        },
      );
    }
    throw error;
  }

  const projection = await readClassicState(changeDir, { migrate: false });
  if (!projection.classic) {
    throw new Error(`Cannot select current change '${changeName}': Classic state is incomplete`);
  }
  if (projection.classic.archived) {
    throw new Error(`Cannot select current change '${changeName}': change is archived`);
  }
}

export async function selectCurrentChange(
  projectRoot: string,
  changeName: string,
): Promise<CurrentChangeSelection> {
  await validateActiveChange(projectRoot, changeName);
  const selection: CurrentChangeSelection = {
    schema: 'comet.selection.v2',
    workflow: 'classic',
    change: changeName,
    branch: currentBranch(projectRoot),
  };
  await writeCometCurrentSelection(projectRoot, selection);
  return selection;
}

export async function resolveCurrentChange(projectRoot: string): Promise<CurrentChangeResolution> {
  let current;
  try {
    current = await readCometCurrentSelection(projectRoot);
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
    await validateActiveChange(projectRoot, selection.change);
  } catch (error) {
    return {
      status: 'stale',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const branch = currentBranch(projectRoot);
  if (selection.branch !== null && branch !== selection.branch) {
    return {
      status: 'stale',
      reason: `current change '${selection.change}' was selected on branch '${selection.branch}', current branch is '${branch ?? 'detached HEAD'}'`,
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
