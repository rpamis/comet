import { readNativeBuildWorkspace, transferFile } from './native-build-workspace-record.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createFileRuntimeStore, type WorkflowRun } from '../engine/runtime.js';
import { resolveWorkspaceRuntimeRoot } from '../workflow-contract/workspace-runtime.js';
import {
  registerSdkChangeOwner,
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
    if (existing) throw new Error(`Build worktree already owns ${name}: ${prepared.projectRoot}`);
    transfer = {
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
  await writeNativeManagedRunState(
    path.join(paths.changesDir, name, 'comet-state.yaml'),
    parseNativePortableState(transfer.run.state),
    paths.nativeRoot,
    transfer.run,
  );
  const target = transfer.projectRoot;
  const targetPaths = await nativeProjectPaths(target, config.native.artifact_root);
  const store = createFileRuntimeStore<WorkflowRun>({
    singleWriter: true,
    rootDir: path.join(await resolveWorkspaceRuntimeRoot(target), 'sdk-runs', 'native'),
  });
  if (!(await store.read(name))) {
    await fs.cp(path.join(paths.changesDir, name), path.join(targetPaths.changesDir, name), {
      recursive: true,
    });
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
