import path from 'node:path';
import { promises as fs } from 'node:fs';
import { parseDocument } from 'yaml';

import { listGitWorktrees, samePath } from '../../platform/paths/git-worktree.js';
import {
  createRuntime,
  defineWorkflow,
  hashRuntimeValue,
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
import { currentNativeSdkSupervisorActions } from './native-sdk-supervisor-plan.js';
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
    executors: application.executors,
  });
}

/** 仅显式恢复增加 Child 归档步骤前的内置定义，不接纳任意同版本漂移。 */
export async function inspectNativeSdkDefinitionUpgrade(
  projectRoot: string,
  name: string,
  repair: boolean,
) {
  const owner = await readSdkChangeOwner(projectRoot, 'native', name);
  if (owner?.application !== 'native' || owner.runId !== name) return null;
  const application = defineNativeWorkflowApplication();
  const definition = defineWorkflow(application.workflow);
  const previous = structuredClone(definition);
  delete previous.steps['supervisor.child.archive'];
  previous.transitions = previous.transitions.filter(
    ({ from, to }) => from !== 'supervisor.child.archive' && to !== 'supervisor.child.archive',
  );
  const previousHash = hashRuntimeValue(previous);
  // 固定已知前后定义；后续定义变化必须重新评估恢复条件。
  if (
    previousHash !== '241450a81ad7237162f72c834e8e7712f1becd90c0a78fa3a1714c86efa4ca06' ||
    hashRuntimeValue(definition) !==
      '500dc5be719eb5493dbdadf35c372de49f0232439eef849bb521f6b3db346aff'
  )
    return null;
  const store = createNativeSdkStateStore(projectRoot);
  const saved = await store.read(name);
  if (!saved || saved.workflow.hash !== previousHash) return null;
  const oldRuntime = createRuntime({
    ...application,
    store,
    workflows: [previous],
    transitionHandlers: [application.transitionHandler],
  });
  const run = await oldRuntime.inspect(name);
  const state = parseNativePortableState(run.state);
  if (state.name !== name || (run.input as { name?: unknown })?.name !== name)
    throw new Error('Native SDK definition upgrade does not match its change');
  const unresolved = run.actions.filter(({ status }) => ['running', 'unknown'].includes(status));
  const ready = unresolved.length === 0;
  const result = {
    ready,
    repaired: false,
    fromHash: previousHash,
    toHash: hashRuntimeValue(definition),
    unresolvedActions: unresolved.map(({ id, status }) => ({ id, status })),
    repairCommand: `comet native doctor ${name} --repair`,
  };
  if (!repair) return result;
  if (!ready)
    throw new Error('Reconcile running or unknown Actions before upgrading the definition');
  const next = structuredClone(run);
  next.workflow.hash = result.toHash;
  next.definitionHashes[JSON.stringify([definition.id, definition.version])] = result.toHash;
  const current = currentNativeSdkSupervisorActions(run);
  const unarchived = current.filter(
    (action) =>
      action.stepId === 'supervisor.child.integration-checks' &&
      action.status === 'succeeded' &&
      !current.some(
        (archive) =>
          archive.stepId === 'supervisor.child.archive' &&
          (archive.input as { activation?: { checksActionId?: unknown } })?.activation
            ?.checksActionId === action.id,
      ),
  );
  // 旧版本只有当前集成头仍对应此检查时可以直接补归档；不复用较早候选的检查。
  if (unarchived.length > 1)
    throw new Error('Multiple unarchived Child integrations require fresh integration checks');
  for (const check of unarchived) {
    if (state.phase !== 'build' || state.status !== 'active' || !state.children_contract_hash)
      throw new Error('Native SDK Child archive upgrade requires the active Supervisor Build');
    const input = (check.input as { activation?: Record<string, unknown> }).activation;
    const output = check.outcome?.output as { candidateId?: unknown } | undefined;
    if (
      typeof input?.child !== 'string' ||
      typeof input.candidateCommit !== 'string' ||
      typeof output?.candidateId !== 'string'
    )
      throw new Error('Native SDK Child archive upgrade lacks its integration evidence');
    next.ready.push({
      from: check.stepId,
      to: 'supervisor.child.archive',
      results: {
        ...run.actionContexts[check.id].results,
        [check.stepId]: {
          sequence: run.actionContexts[check.id].sequence,
          value: check.outcome!.output,
        },
      },
      activation: {
        child: input.child,
        candidateCommit: input.candidateCommit,
        integrationCommit: output.candidateId,
        checksActionId: check.id,
        contractHash: state.children_contract_hash,
      },
    });
  }
  // 提交前用新定义重新校验，保留所有既有 Action、attempt、确认和检查结果。
  await createRuntime({
    ...application,
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    store: { read: async () => next, compareAndSwap: async () => false },
  }).inspect(name);
  next.revision = run.revision + 1;
  if (!(await store.compareAndSwap(name, run.revision, next)))
    throw new Error('Native SDK Run changed while upgrading its definition; inspect again');
  return { ...result, repaired: true };
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
