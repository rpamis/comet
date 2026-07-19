import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import {
  driftStaleReason,
  resolveBranchBinding,
  unboundDetachedMessage,
} from './classic-branch-binding.js';
import { assertOpenSpecChangeName } from './classic-paths.js';
import { readClassicState } from './classic-store.js';

export interface CurrentChangeSelection {
  version: 1;
  change: string;
  branch: string | null;
}

export type CurrentChangeResolution =
  | { status: 'selected'; selection: CurrentChangeSelection }
  | { status: 'missing' }
  | { status: 'stale'; reason: string };

export function currentChangeFile(projectRoot: string): string {
  return path.join(projectRoot, '.comet', 'current-change.json');
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
  // `branch` may be absent in files written by early 0.4.0-beta.6 builds.
  if (record.branch !== undefined && record.branch !== null && typeof record.branch !== 'string') {
    throw new Error('current change selection branch must be a string or null');
  }
  return {
    version: 1,
    change: record.change,
    branch: (record.branch as string | null | undefined) ?? null,
  };
}

export async function selectCurrentChange(
  projectRoot: string,
  changeName: string,
): Promise<CurrentChangeSelection> {
  await validateActiveChange(projectRoot, changeName);
  const outcome = await resolveBranchBinding(changeDirectory(projectRoot, changeName), {
    heal: true,
    cwd: projectRoot,
  });
  if (outcome.status === 'drift') {
    throw new Error(driftStaleReason(changeName, outcome.boundBranch, outcome.currentBranch));
  }
  if (outcome.status === 'unbound-detached') {
    throw new Error(unboundDetachedMessage(changeName));
  }
  const selection: CurrentChangeSelection = {
    version: 1,
    change: changeName,
    branch: outcome.currentBranch,
  };
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
  try {
    selection = parseSelection(source);
    await validateActiveChange(projectRoot, selection.change);
  } catch (error) {
    return {
      status: 'stale',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  // Resolution is a read path (the PreToolUse hook runs it on every tool
  // call), so it never heals: heal happens on select/check/guard instead.
  const outcome = await resolveBranchBinding(changeDirectory(projectRoot, selection.change), {
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
  if (outcome.status === 'ok') {
    return { status: 'selected', selection };
  }
  // No bound branch governs yet (isolation unset or binding not healed):
  // fall back to comparing against the branch recorded at selection time.
  if (selection.branch !== null && outcome.currentBranch !== selection.branch) {
    return {
      status: 'stale',
      reason: `current change '${selection.change}' was selected on branch '${selection.branch}', current branch is '${outcome.currentBranch ?? 'detached HEAD'}'`,
    };
  }
  return { status: 'selected', selection };
}

export async function clearCurrentChange(projectRoot: string): Promise<void> {
  await fs.rm(currentChangeFile(projectRoot), { force: true });
}
