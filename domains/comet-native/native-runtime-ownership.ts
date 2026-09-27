import path from 'node:path';

import { listGitWorktrees, samePath } from '../../platform/paths/git-worktree.js';
import {
  createFileRuntimeStore,
  createRuntime,
  type WorkflowRun,
  type WorkflowRuntime,
} from '../engine/runtime.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  listSdkChangeNames,
  readChangeRuntimeOwner,
  readSdkChangeOwner,
  registerLegacyChangeOwner,
  type ChangeRuntimeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import {
  assertNativeSdkStartAvailable,
  defineNativeWorkflowApplication,
} from './native-sdk-application.js';
import { readProjectConfig } from './native-config.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { nativeProjectPaths } from './native-paths.js';
import { parseNativePortableState } from './native-portable-state.js';
import { nativePortableStateFile } from './native-portable-storage.js';
import type { NativePortableState } from './native-portable-types.js';
import type { NativeProjectPaths } from './native-types.js';

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
    if (!state.exists) return null;
    return registerLegacyChangeOwner(paths.projectRoot, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'native',
      change: name,
      format: 'legacy',
    });
  });
}

export async function listNativeSdkChangeNames(projectRoot: string): Promise<string[]> {
  return listSdkChangeNames(projectRoot, 'native');
}

export function createNativeSdkRuntime(projectRoot: string): WorkflowRuntime {
  const application = defineNativeWorkflowApplication();
  return createRuntime({
    store: createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(projectRoot, '.comet', 'runtime', 'sdk-runs', 'native'),
    }),
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    validators: application.validators,
    stateValidators: application.stateValidators,
    commandValidators: application.commandValidators,
    executors: application.executors,
  });
}

export async function inspectNativeSdkRun(
  projectRoot: string,
  name: string,
): Promise<{ run: WorkflowRun; state: NativePortableState; artifactRootRef: string }> {
  const owner = await readSdkChangeOwner(projectRoot, 'native', name);
  if (!owner) throw new Error(`Native change ${name} is not owned by an SDK Run`);
  const application = defineNativeWorkflowApplication();
  const runtime = createNativeSdkRuntime(projectRoot);
  const run = await runtime.inspect(owner.runId);
  if (
    run.workflow.id !== application.workflow.id ||
    run.workflow.version !== application.workflow.version ||
    !run.input ||
    typeof run.input !== 'object' ||
    Array.isArray(run.input) ||
    run.input.name !== name ||
    typeof run.input.artifactRootRef !== 'string'
  ) {
    throw new Error(`Native SDK Run ${name} does not match its change ownership`);
  }
  await assertNativeSdkStartAvailable({
    projectRoot,
    name,
    artifactRootRef: run.input.artifactRootRef,
  });
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
