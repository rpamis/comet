import { promises as fs } from 'fs';
import path from 'path';

import { listGitWorktreeRoots } from '../../platform/paths/git-worktree.js';
import type { CometHookRequest } from './hook-types.js';
import { readCometCurrentSelection } from '../workflow-contract/current-selection.js';

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function owningWorktree(candidate: string, roots: readonly string[]): string | null {
  return (
    [...roots]
      .sort((left, right) => right.length - left.length)
      .find((root) => isWithin(root, candidate)) ?? null
  );
}

async function assertRebasedWorktreeReady(projectRoot: string): Promise<void> {
  const selected = await readCometCurrentSelection(projectRoot);
  const applicationSelected =
    selected.status === 'selected' && selected.selection.workflow === 'application';
  for (const marker of ['.git', path.join('.comet', 'config.yaml')]) {
    if (marker !== '.git' && applicationSelected) continue;
    try {
      await fs.lstat(path.join(projectRoot, marker));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      throw new Error(
        `linked worktree ${projectRoot} is not initialized for Comet: missing ${marker.replaceAll('\\', '/')}`,
        { cause: error },
      );
    }
  }
}

export async function resolveCometHookProjectRoot(
  explicitProjectRoot: string,
  request: CometHookRequest,
): Promise<string> {
  const explicitRoot = path.resolve(explicitProjectRoot);
  if (request.targets.length === 0) return explicitRoot;
  const roots = listGitWorktreeRoots(explicitRoot);
  if (roots.length < 2) return explicitRoot;

  const cwdOwner = request.cwd ? owningWorktree(path.resolve(request.cwd), roots) : null;
  const relativeTargetBase = cwdOwner ?? explicitRoot;
  const owners = new Map<string, string>();

  for (const target of request.targets) {
    const absoluteTarget = path.isAbsolute(target)
      ? path.resolve(target)
      : path.resolve(relativeTargetBase, target);
    const owner = owningWorktree(absoluteTarget, roots);
    if (!owner) continue;
    const key = process.platform === 'win32' ? owner.toLowerCase() : owner;
    owners.set(key, owner);
  }

  if (owners.size === 0) return explicitRoot;
  if (owners.size > 1) {
    throw new Error('one Hook request cannot write across multiple Git worktrees');
  }

  const [selectedRoot] = owners.values();
  if (!samePath(selectedRoot, explicitRoot)) {
    await assertRebasedWorktreeReady(selectedRoot);
  }
  return selectedRoot;
}
