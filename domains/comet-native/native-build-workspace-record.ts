import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createFileRuntimeStore, type WorkflowRun } from '../engine/runtime.js';
import { listSdkChangeNames } from '../workflow-contract/change-runtime-owner.js';
import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';
import type { NativePortableState } from './native-portable-types.js';
import { resolveWorkspaceRuntimeRoot } from '../workflow-contract/workspace-runtime.js';

export interface BuildWorkspaceTransfer {
  copied?: boolean;
  projectRoot: string;
  run: WorkflowRun;
}

/** Existing approvals keep the workspace contract under which Shape ran. */
export function usesNativeSharedPlanning(run: Readonly<WorkflowRun>): boolean {
  const shape = [...run.actions]
    .reverse()
    .find((action) => ['shape.prepare', 'shape.revalidate'].includes(action.stepId));
  return (
    (shape?.executionOrigin?.workflow.version ?? run.workflow.version) === '4' &&
    (run.state as unknown as NativePortableState).workspace.change_branch !== null
  );
}

export async function transferFile(
  projectRoot: string,
  name: string,
  workspaceRuntimeRoot?: string,
): Promise<string> {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(name)) throw new Error('Invalid Native change name');
  return path.join(
    workspaceRuntimeRoot ?? (await resolveWorkspaceRuntimeRoot(projectRoot)),
    'native-build-workspaces',
    `${name}.json`,
  );
}

/** The source record also blocks writes while an interrupted transfer is resumed. */
export async function readNativeBuildWorkspace(
  projectRoot: string,
  name: string,
  workspaceRuntimeRoot?: string,
): Promise<BuildWorkspaceTransfer | null> {
  try {
    return JSON.parse(
      await fs.readFile(await transferFile(projectRoot, name, workspaceRuntimeRoot), 'utf8'),
    ) as BuildWorkspaceTransfer;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Inspect built-in peers without loading or advancing any Run. */
export async function listNativeSdkBuildPeers(
  projectRoot: string,
  name: string,
): Promise<string[]> {
  const root = await resolveWorkspaceRuntimeRoot(projectRoot);
  const store = createFileRuntimeStore<WorkflowRun>({
    singleWriter: true,
    rootDir: path.join(root, 'sdk-runs', 'native'),
  });
  const current = await store.read(name);
  if (!current || !usesNativeSharedPlanning(current)) return [];
  const peers: string[] = [];
  const workspace = inspectGitWorktree(projectRoot);
  for (const candidate of await listSdkChangeNames(projectRoot, 'native', {
    readOnly: true,
    partition: 'active',
  })) {
    if (candidate === name || (await readNativeBuildWorkspace(projectRoot, candidate))) continue;
    const run = await store.read(candidate);
    if (!run || ['completed', 'cancelled'].includes(run.status)) continue;
    const binding = (run.state as unknown as NativePortableState).workspace;
    if (binding.change_branch !== null && binding.change_branch !== workspace.currentBranch)
      continue;
    if (binding.isolation === 'worktree' && !workspace.isSecondaryWorktree) continue;
    peers.push(candidate);
  }
  return peers;
}
