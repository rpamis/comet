import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { assertOpenSpecChangeName } from './classic-paths.js';
import { readClassicState } from './classic-store.js';
import type { ClassicState } from './classic-state.js';
import {
  driftStaleReason,
  evaluateBranchBinding,
  healBoundBranch,
  liveGitBranch,
  unboundDetachedMessage,
} from './classic-branch-binding.js';

export interface CurrentChangeSelection {
  version: 1;
  change: string;
}

export type CurrentChangeResolution =
  | {
      status: 'selected';
      selection: CurrentChangeSelection;
      classic: ClassicState;
      branch: string | null;
    }
  | { status: 'missing' }
  | { status: 'stale'; reason: string };

export function currentChangeFile(projectRoot: string): string {
  return path.join(projectRoot, '.comet', 'current-change.json');
}

function changeDirectory(projectRoot: string, changeName: string): string {
  return path.join(projectRoot, 'openspec', 'changes', changeName);
}

async function validateActiveChange(
  projectRoot: string,
  changeName: string,
): Promise<ClassicState> {
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
  return projection.classic;
}

function parseSelection(source: string): CurrentChangeSelection {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `current change selection contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('current change selection must be a JSON object');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error('current change selection version must be 1');
  }
  if (typeof record.change !== 'string') {
    throw new Error('current change selection change must be a string');
  }
  assertOpenSpecChangeName(record.change);
  return { version: 1, change: record.change };
}

export async function selectCurrentChange(
  projectRoot: string,
  changeName: string,
): Promise<CurrentChangeSelection> {
  await validateActiveChange(projectRoot, changeName);
  const selection: CurrentChangeSelection = { version: 1, change: changeName };
  const file = currentChangeFile(projectRoot);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(temporary, JSON.stringify(selection, null, 2) + '\n', 'utf8');
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  return selection;
}

export async function resolveCurrentChange(projectRoot: string): Promise<CurrentChangeResolution> {
  let source: string;
  try {
    source = await fs.readFile(currentChangeFile(projectRoot), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    return {
      status: 'stale',
      reason: `cannot read current change selection: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let selection: CurrentChangeSelection;
  let classic: ClassicState;
  try {
    selection = parseSelection(source);
    classic = await validateActiveChange(projectRoot, selection.change);
  } catch (error) {
    return {
      status: 'stale',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const branch = liveGitBranch(projectRoot);
  const verdict = evaluateBranchBinding({
    isolation: classic.isolation,
    boundBranch: classic.boundBranch,
    currentBranch: branch,
  });
  if (verdict.status === 'drift') {
    return {
      status: 'stale',
      reason: driftStaleReason(selection.change, verdict.boundBranch, verdict.currentBranch),
    };
  }
  if (verdict.status === 'unbound-detached') {
    return { status: 'stale', reason: unboundDetachedMessage(selection.change) };
  }
  if (verdict.status === 'needs-heal') {
    await healBoundBranch(
      path.join(projectRoot, 'openspec', 'changes', selection.change),
      verdict.branch,
    );
  }
  return { status: 'selected', selection, classic, branch };
}

export async function clearCurrentChange(projectRoot: string): Promise<void> {
  await fs.rm(currentChangeFile(projectRoot), { force: true });
}
