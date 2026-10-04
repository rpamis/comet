import path from 'node:path';
import { promises as fs } from 'node:fs';
import { parseDocument } from 'yaml';

import { listGitWorktrees, samePath } from '../../platform/paths/git-worktree.js';
import {
  createRuntime,
  type WorkflowRun,
  type WorkflowRuntime,
  type RuntimeExecutor,
} from '../engine/runtime.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  listSdkChangeNames,
  readChangeRuntimeOwner,
  readSdkChangeOwner,
  registerCompatChangeOwner,
  type ChangeRuntimeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { defineNativeWorkflowApplication } from './native-sdk-application.js';
import { readProjectConfig } from './native-config.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { nativeProjectPaths } from './native-paths.js';
import { parseNativePortableState } from './native-portable-state.js';
import { recoverPristineNativeSdkChange } from './native-sdk-create.js';
import { createNativeSdkStateStore } from './native-sdk-state-store.js';
import {
  findNativeSdkArchivedStateFile,
  hasNativeManagedRunMarker,
  hasNativePortableRunCheckpoint,
} from './native-sdk-state-store.js';
import { nativeLocalExecutionFile, nativePortableStateFile } from './native-portable-storage.js';
import type { NativePortableState } from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';
import {
  loadWorkflowApplication,
  resolveWorkflowApplicationFile,
  type ApplicationIdentity,
  type LoadedWorkflowApplication,
} from '../workflow-application/index.js';

export { inspectPristineNativeSdkChange } from './native-sdk-create.js';

export async function resolveNativeChangeRuntimeOwner(
  paths: NativeProjectPaths,
  name: string,
): Promise<ChangeRuntimeOwner | null> {
  const current = await readChangeRuntimeOwner(paths.projectRoot, 'native', name);
  if (current) return current;
  return withNativeMutationLock(paths, `resolve change runtime owner ${name}`, async () => {
    const bound = await readChangeRuntimeOwner(paths.projectRoot, 'native', name);
    if (bound) return bound;
    const stateRef = path.relative(paths.projectRoot, nativePortableStateFile(paths, name));
    const state = await inspectProtectedProjectPath(paths.projectRoot, stateRef, {
      label: 'Native legacy change state',
      expected: 'file',
    });
    if (!state.exists) {
      const archivedFile = await findNativeSdkArchivedStateFile(paths, name);
      if (!archivedFile) return null;
      const archivedRef = path.relative(paths.projectRoot, archivedFile);
      const archived = await inspectProtectedProjectPath(paths.projectRoot, archivedRef, {
        label: 'Native archived change state',
        expected: 'file',
      });
      if (!archived.exists || !(await hasNativeManagedRunMarker(archived.target))) return null;
      if (await readNativeApplicationCheckpoint(paths.projectRoot, name)) {
        await (await loadOwnedNativeSdkRuntime(paths.projectRoot, name)).runtime.inspect(name);
        return readSdkChangeOwner(paths.projectRoot, 'native', name);
      }
      if (await createNativeSdkStateStore(paths.projectRoot).read(name)) {
        const recovered = await readSdkChangeOwner(paths.projectRoot, 'native', name);
        if (!recovered) throw new Error(`Recovered Native change ${name} has no Run ownership`);
        return recovered;
      }
      throw new Error(
        `Native archived change ${name} has a managed state file but lost its Run checkpoint`,
      );
    }
    const local = await inspectProtectedProjectPath(
      paths.projectRoot,
      path.relative(paths.projectRoot, nativeLocalExecutionFile(paths, name)),
      { label: 'Native local execution state', expected: 'file' },
    );
    const applicationCheckpoint = await readNativeApplicationCheckpoint(paths.projectRoot, name);
    if (applicationCheckpoint) {
      await (await loadOwnedNativeSdkRuntime(paths.projectRoot, name)).runtime.inspect(name);
      return readSdkChangeOwner(paths.projectRoot, 'native', name);
    }
    if (!local.exists && (await createNativeSdkStateStore(paths.projectRoot).read(name))) {
      const recovered = await readSdkChangeOwner(paths.projectRoot, 'native', name);
      if (!recovered) throw new Error(`Recovered Native change ${name} has no Run ownership`);
      return recovered;
    }
    if (!local.exists && (await recoverPristineNativeSdkChange(paths, name))) {
      const recovered = await readSdkChangeOwner(paths.projectRoot, 'native', name);
      if (!recovered) throw new Error(`Recovered Native change ${name} has no Run ownership`);
      return recovered;
    }
    if (!local.exists) await assertNativePortableChangeNotOrphaned(paths, name);
    return registerCompatChangeOwner(paths.projectRoot, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'native',
      change: name,
      format: 'compat',
    });
  });
}

/** Read-only guard for entry probes that must not register Runtime ownership. */
export async function assertNativePortableChangeNotOrphaned(
  paths: NativeProjectPaths,
  name: string,
): Promise<void> {
  const file = nativePortableStateFile(paths, name);
  if (
    (await hasNativeManagedRunMarker(file)) &&
    !(await hasNativePortableRunCheckpoint(file, name))
  ) {
    throw new Error(
      `Native change ${name} has a portable state file but lost its local Run history; inspect it with comet native doctor ${name} before restoring`,
    );
  }
}

export async function listNativeSdkChangeNames(projectRoot: string): Promise<string[]> {
  return listSdkChangeNames(projectRoot, 'native');
}

export function createNativeSdkRuntime(projectRoot: string): WorkflowRuntime {
  const application = defineNativeWorkflowApplication();
  return createRuntime({
    store: createNativeSdkStateStore(projectRoot),
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    validators: application.validators,
    stateValidators: application.stateValidators,
    commandValidators: application.commandValidators,
    validateRecovery: application.validateRecovery,
    executors: application.executors,
  });
}

async function readNativeApplicationCheckpoint(
  projectRoot: string,
  name: string,
): Promise<ApplicationIdentity | null> {
  const config = await readProjectConfig(projectRoot);
  if (!config) return null;
  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
  let file = nativePortableStateFile(paths, name);
  try {
    await fs.access(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const archived = await findNativeSdkArchivedStateFile(paths, name);
    if (!archived) return null;
    file = archived;
  }
  const data = parseDocument(await fs.readFile(file, 'utf8'), { uniqueKeys: true });
  if (data.errors.length) throw new Error('Native application checkpoint is invalid');
  return (
    (data.toJS() as { application_checkpoint?: ApplicationIdentity }).application_checkpoint ?? null
  );
}

/** 每个公开 Native 入口都恢复 owner 绑定的同一固定应用。 */
export async function loadOwnedNativeSdkRuntime(
  projectRoot: string,
  name: string,
): Promise<{
  runtime: WorkflowRuntime;
  executors: readonly RuntimeExecutor[];
  application: LoadedWorkflowApplication | null;
}> {
  const owner = await readSdkChangeOwner(projectRoot, 'native', name);
  const checkpoint =
    owner?.application === 'native'
      ? null
      : await readNativeApplicationCheckpoint(projectRoot, name);
  const id = owner?.application ?? checkpoint?.id ?? 'native';
  if (id === 'native') {
    const defined = defineNativeWorkflowApplication();
    return {
      runtime: createNativeSdkRuntime(projectRoot),
      executors: defined.executors,
      application: null,
    };
  }
  const file = checkpoint?.packageRoot
    ? path.join(checkpoint.packageRoot, 'application.json')
    : await resolveWorkflowApplicationFile(projectRoot, id, name);
  const application = await loadWorkflowApplication({
    file,
    projectRoot,
    runId: name,
    ...(checkpoint ? { expectedIdentity: checkpoint } : {}),
  });
  if (application.identity.id !== id || application.identity.base !== 'native')
    throw new Error('Native change owner does not match its fixed Application');
  return {
    runtime: createRuntime({ ...application.implementation, store: application.store }),
    executors: application.implementation.executors ?? [],
    application,
  };
}

export async function inspectNativeSdkRun(
  projectRoot: string,
  name: string,
): Promise<{ run: WorkflowRun; state: NativePortableState; artifactRootRef: string }> {
  const owner = await readSdkChangeOwner(projectRoot, 'native', name);
  if (!owner) throw new Error(`Native change ${name} is not owned by an SDK Run`);
  const { runtime } = await loadOwnedNativeSdkRuntime(projectRoot, name);
  const run = await runtime.inspect(owner.runId);
  if (
    run.workflow.id !== 'comet-native' ||
    !run.input ||
    typeof run.input !== 'object' ||
    Array.isArray(run.input) ||
    run.input.name !== name ||
    typeof run.input.artifactRootRef !== 'string'
  ) {
    throw new Error(`Native SDK Run ${name} does not match its change ownership`);
  }
  const state = parseNativePortableState(run.state);
  if (state.name !== name) throw new Error(`Native SDK Run ${name} has a different state name`);
  return { run, state, artifactRootRef: run.input.artifactRootRef };
}

export async function findNativeSdkWorkspace(
  projectRoot: string,
  name: string,
): Promise<({ projectRoot: string } & Awaited<ReturnType<typeof inspectNativeSdkRun>>) | null> {
  const requestedRoot = path.resolve(projectRoot);
  if (await readSdkChangeOwner(requestedRoot, 'native', name)) {
    return { projectRoot: requestedRoot, ...(await inspectNativeSdkRun(requestedRoot, name)) };
  }
  const candidates: Array<
    { projectRoot: string } & Awaited<ReturnType<typeof inspectNativeSdkRun>>
  > = [];
  for (const worktree of listGitWorktrees(requestedRoot)) {
    if (samePath(worktree.root, requestedRoot)) continue;
    if (!(await readSdkChangeOwner(worktree.root, 'native', name))) continue;
    const inspected = await inspectNativeSdkRun(worktree.root, name);
    if (!worktree.branch || inspected.state.workspace.change_branch !== worktree.branch) {
      throw new Error(`Native SDK change '${name}' is not bound to its registered worktree`);
    }
    candidates.push({ projectRoot: worktree.root, ...inspected });
  }
  if (candidates.length > 1) {
    throw new Error(`Native SDK change '${name}' exists in multiple registered worktrees`);
  }
  return candidates[0] ?? null;
}

export async function resolveNativeSdkCommandRoot(
  projectRoot: string,
  name: string,
): Promise<string> {
  const requestedRoot = path.resolve(projectRoot);
  let localOwner = await readChangeRuntimeOwner(requestedRoot, 'native', name);
  if (!localOwner) {
    const config = await readProjectConfig(requestedRoot);
    if (config) {
      const paths = await nativeProjectPaths(requestedRoot, config.native.artifact_root);
      localOwner = await resolveNativeChangeRuntimeOwner(paths, name);
    }
  }
  if (localOwner) return requestedRoot;
  return (await findNativeSdkWorkspace(requestedRoot, name))?.projectRoot ?? requestedRoot;
}
