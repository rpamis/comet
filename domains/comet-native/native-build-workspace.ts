import { readNativeBuildWorkspace, transferFile } from './native-build-workspace-record.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createFileRuntimeStore, type WorkflowRun } from '../engine/runtime.js';
import { resolveWorkspaceRuntimeRoot } from '../workflow-contract/workspace-runtime.js';
import {
  registerSdkChangeOwner,
  readChangeRuntimeOwner,
  COMET_CHANGE_OWNER_SCHEMA,
} from '../workflow-contract/change-runtime-owner.js';
import { readProjectConfig } from './native-config.js';
import { nativeProjectPaths } from './native-paths.js';
import { parseNativePortableState } from './native-portable-state.js';
import { prepareNativeWorkspace } from './native-workspace-preparation.js';
import { atomicWriteText } from './native-atomic-file.js';
import { selectNativeChange } from './native-selection.js';
import { inspectGitWorktree } from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';

/** Move an approved, unclaimed built-in Run before dispatching implementation. */
export async function prepareNativeBuildWorkspace(
  projectRoot: string,
  name: string,
): Promise<string> {
  const { readNativeSdkRunRecord, createNativeSdkStateStore, writeNativeManagedRunState } =
    await import('./native-sdk-state-store.js');
  let transfer = await readNativeBuildWorkspace(projectRoot, name);
  const config = await readProjectConfig(projectRoot);
  if (!config) throw new Error('Native Build requires project configuration');
  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
  if (!transfer) {
    const { listActiveNativeChangesOwnedByWorkspace } = await import('./native-change.js');
    const active = await listActiveNativeChangesOwnedByWorkspace(paths);
    if (active.filter((change) => change !== name).length === 0) return projectRoot;
    const run = await readNativeSdkRunRecord(projectRoot, name);
    if (!run || run.workflow.version !== '4')
      throw new Error('Build workspace preparation requires Native v4');
    const state = parseNativePortableState(run.state);
    if (
      state.phase !== 'build' ||
      run.actions.some((action) => action.status === 'running' || action.status === 'unknown')
    )
      throw new Error(
        'Build workspace preparation requires an approved Run with no active execution',
      );
    const changed = runGitCommand(projectRoot, ['diff', 'HEAD', '--name-only'])
      .split(/\r?\n/u)
      .filter(Boolean);
    const changesRef = path.relative(projectRoot, paths.changesDir).replaceAll('\\', '/') + '/';
    if (changed.some((file) => !file.startsWith(changesRef) && file !== '.comet/config.yaml'))
      throw new Error(
        'Build worktree requires committed code changes. Commit the implementation baseline before retrying the same next command.',
      );
    const prepared = await prepareNativeWorkspace({
      projectRoot,
      name,
      isolation: 'worktree',
      sourceConfig: config,
      targetBranch: inspectGitWorktree(projectRoot).currentBranch ?? undefined,
    });
    const existing = await readNativeSdkRunRecord(prepared.projectRoot, name);
    const targetPaths = await nativeProjectPaths(prepared.projectRoot, config.native.artifact_root);
    const owner = await readChangeRuntimeOwner(prepared.projectRoot, 'native', name, {
      readOnly: true,
    });
    const existingArtifacts = await fs.lstat(path.join(targetPaths.changesDir, name)).then(
      () => true,
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
    if (existing || owner || (!prepared.preparation.createdWorktree && existingArtifacts))
      throw new Error(
        `Build worktree already contains Runtime ownership or change artifacts for ${name}: ${prepared.projectRoot}. Preserve both workspaces and choose an unused worktree before retrying native next.`,
      );
    transfer = {
      copied: false,
      projectRoot: prepared.projectRoot,
      run: {
        ...run,
        state: {
          ...(run.state as object),
          workspace: {
            isolation: prepared.binding.isolation,
            change_branch: prepared.binding.changeBranch,
            target_branch: prepared.binding.targetBranch,
            finish: null,
          },
        } as WorkflowRun['state'],
      },
    };
    const file = await transferFile(projectRoot, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWriteText(file, JSON.stringify(transfer), { containedRoot: path.dirname(file) });
  }
  const target = transfer.projectRoot;
  const targetPaths = await nativeProjectPaths(target, config.native.artifact_root);
  const store = createFileRuntimeStore<WorkflowRun>({
    singleWriter: true,
    rootDir: path.join(await resolveWorkspaceRuntimeRoot(target), 'sdk-runs', 'native'),
  });
  if (!(await store.read(name)) && transfer.copied !== false) {
    const recovered = await createNativeSdkStateStore(target).read(name);
    if (!recovered)
      throw new Error(
        `Native Build Run ${name} is missing at ${target}; preserve its latest checkpoint and recover the original Run with comet native doctor ${name} --project-root ${JSON.stringify(target)} --repair --confirmed.`,
      );
  } else if (!(await store.read(name))) {
    await writeNativeManagedRunState(
      path.join(paths.changesDir, name, 'comet-state.yaml'),
      parseNativePortableState(transfer.run.state),
      paths.nativeRoot,
      transfer.run,
    );

    await fs.cp(path.join(paths.changesDir, name), path.join(targetPaths.changesDir, name), {
      recursive: true,
    });
    transfer = { ...transfer, copied: true };
    const file = await transferFile(projectRoot, name);
    await atomicWriteText(file, JSON.stringify(transfer), { containedRoot: path.dirname(file) });
    await registerSdkChangeOwner(target, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'native',
      change: name,
      format: 'sdk',
      application: 'native',
      runId: name,
    });
    await store.restoreCheckpoint!(name, null, transfer.run);
  }
  await createNativeSdkStateStore(target).read(name);
  await selectNativeChange(targetPaths, name);
  return target;
}
