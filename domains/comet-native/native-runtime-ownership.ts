import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readFileRaceSafe } from '../../platform/fs/race-safe-read.js';
import { memoizedHookReadSync } from '../../platform/process/hook-read-cache.js';
import { parseNativeStateDocument } from './native-state-document.js';
import {
  createRuntime,
  type RuntimeExecutor,
  type WorkflowRun,
  type WorkflowRuntime,
} from '../engine/runtime.js';
import {
  loadWorkflowApplication,
  resolveWorkflowApplicationFile,
} from '../workflow-application/application.js';
import type {
  ApplicationIdentity,
  LoadedWorkflowApplication,
} from '../workflow-application/index.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  listSdkChangeNames,
  readChangeRuntimeOwner,
  readSdkChangeOwner,
  registerCompatChangeOwner,
  registerSdkChangeOwner,
  type ChangeRuntimeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { readProjectConfig } from './native-config.js';
import { withNativeMutation } from './native-mutation.js';
import { nativeProjectPaths } from './native-paths.js';
import { parseNativePortableState } from './native-portable-state.js';
import { nativePortableStateFile } from './native-portable-storage.js';
import type { NativePortableState } from './native-portable-types.js';
import { defineNativeWorkflowApplication } from './native-sdk-application.js';
import { upgradeNativeRun } from './native-sdk-run-upgrade.js';
import { recoverPristineNativeSdkChange } from './native-sdk-create.js';
import {
  createNativeSdkStateStore,
  findNativeSdkArchivedStateFile,
  hasNativeManagedRunMarker,
  hasNativePortableRunCheckpoint,
} from './native-sdk-state-store.js';
import type { NativeProjectPaths } from './native-types.js';
/** 在已绑定的 SDK 入口登记请求文件；只读 inspect 不调用此写入口。 */
export async function registerNativeSdkRequestInput(options: {
  projectRoot: string;
  artifactRootRef: string;
  file: string;
  runId: string;
  validateContent: (content: string) => void;
}): Promise<void> {
  const read = await readFileRaceSafe(
    path.resolve(options.projectRoot, options.file),
    Number.MAX_SAFE_INTEGER,
    { label: 'Native Runner request input' },
  );
  options.validateContent(read.bytes.toString('utf8'));
}
export { inspectPristineNativeSdkChange } from './native-sdk-create.js';
/** Restore routing only after the existing native Run passes its known definition. */
async function restoreNativeSdkRunOwner(projectRoot: string, name: string, saved: WorkflowRun) {
  if (saved.lineage.length > 0)
    throw new Error('Native Child Run must be restored through its original parent');
  const application = nativeApplicationForRead();
  const normalized = upgradeNativeRun(saved, application.workflow, application.transitionHandler);
  await createRuntime({
    ...application,
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    store: { read: async () => normalized, compareAndSwap: async () => false },
  }).inspect(name);
  return registerSdkChangeOwner(
    projectRoot,
    {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'native',
      change: name,
      format: 'sdk',
      application: 'native',
      runId: name,
    },
    { canonical: true },
  );
}
export async function resolveNativeChangeRuntimeOwner(
  paths: NativeProjectPaths,
  name: string,
): Promise<ChangeRuntimeOwner | null> {
  const current = await readChangeRuntimeOwner(paths.projectRoot, 'native', name);
  if (current) return current;
  return withNativeMutation(paths, async () => {
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
      const saved = await createNativeSdkStateStore(paths.projectRoot, { rootRunId: name }).read(
        name,
      );
      if (saved) {
        const recovered = await readSdkChangeOwner(paths.projectRoot, 'native', name);
        if (!recovered) return restoreNativeSdkRunOwner(paths.projectRoot, name, saved);
        return recovered;
      }
      throw new Error(
        `Native archived change ${name} has a managed state file but lost its Run checkpoint`,
      );
    }
    const applicationCheckpoint = await readNativeApplicationCheckpoint(paths.projectRoot, name);
    if (applicationCheckpoint) {
      await (await loadOwnedNativeSdkRuntime(paths.projectRoot, name)).runtime.inspect(name);
      return readSdkChangeOwner(paths.projectRoot, 'native', name);
    }
    const saved = await createNativeSdkStateStore(paths.projectRoot, { rootRunId: name }).read(
      name,
    );
    if (saved) {
      const recovered = await readSdkChangeOwner(paths.projectRoot, 'native', name);
      if (!recovered) return restoreNativeSdkRunOwner(paths.projectRoot, name, saved);
      return recovered;
    }
    if (await recoverPristineNativeSdkChange(paths, name)) {
      const recovered = await readSdkChangeOwner(paths.projectRoot, 'native', name);
      if (!recovered) throw new Error(`Recovered Native change ${name} has no Run ownership`);
      return recovered;
    }
    await assertNativePortableChangeNotOrphaned(paths, name);
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
export async function listNativeSdkChangeNames(
  projectRoot: string,
  options: {
    readOnly?: boolean;
    partition?: 'all' | 'active' | 'history';
  } = {},
): Promise<string[]> {
  return listSdkChangeNames(projectRoot, 'native', options);
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
/** 诊断沿用自动数据升级入口，不装配旧执行定义。 */
export async function inspectNativeSdkDefinitionUpgrade(
  projectRoot: string,
  name: string,
  repair: boolean,
) {
  const store = createNativeSdkStateStore(projectRoot, { readOnly: !repair });
  const saved = await store.read(name);
  if (!saved) return null;
  const application = nativeApplicationForRead();
  const next = upgradeNativeRun(saved, application.workflow, application.transitionHandler);
  if (next === saved) return null;
  await createRuntime({
    ...application,
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    store: { read: async () => next, compareAndSwap: async () => false },
  }).inspect(name);
  if (repair) {
    next.revision = saved.revision + 1;
    if (!(await store.compareAndSwap(name, saved.revision, next)))
      throw new Error('Native Run 已变化，请重试原命令');
  }
  return {
    ready: true,
    required: true,
    repaired: repair,
    fromHash: saved.workflow.hash,
    toHash: next.workflow.hash,
    unresolvedActions: [],
    repairCommand: 'comet native doctor ' + name + ' --repair',
  };
}
async function readNativeApplicationCheckpoint(
  projectRoot: string,
  name: string,
): Promise<ApplicationIdentity | null> {
  const config = await readProjectConfig(projectRoot);
  if (!config) return null;
  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root, {
    readOnly: true,
  });
  let file = nativePortableStateFile(paths, name);
  try {
    await fs.access(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const archived = await findNativeSdkArchivedStateFile(paths, name);
    if (!archived) return null;
    file = archived;
  }
  const data = parseNativeStateDocument(
    await fs.readFile(file, 'utf8'),
    'Native application checkpoint',
  );
  return (
    (
      data as {
        application_checkpoint?: ApplicationIdentity;
      }
    ).application_checkpoint ?? null
  );
}
const readOnlyNativeApplication = memoizedHookReadSync('nativeBuiltinDefinition', () =>
  defineNativeWorkflowApplication(),
);
function nativeApplicationForRead() {
  return readOnlyNativeApplication();
}
/** 每个公开 Native 入口都恢复 owner 绑定的同一固定应用。 */
export async function loadOwnedNativeSdkRuntime(
  projectRoot: string,
  name: string,
  options: {
    readOnly?: boolean;
    owner?: Awaited<ReturnType<typeof readSdkChangeOwner>>;
  } = {},
): Promise<{
  runtime: WorkflowRuntime;
  executors: readonly RuntimeExecutor[];
  application: LoadedWorkflowApplication | null;
}> {
  const owner = options.owner ?? (await readSdkChangeOwner(projectRoot, 'native', name, options));
  const checkpoint =
    owner?.application === 'native'
      ? null
      : await readNativeApplicationCheckpoint(projectRoot, name);
  const id = owner?.application ?? checkpoint?.id ?? 'native';
  if (id === 'native') {
    const store = createNativeSdkStateStore(projectRoot, {
      ...options,
      rootRunId: name,
    });
    let snapshot = await store.read(name);
    const defined = nativeApplicationForRead();
    if (snapshot) {
      const upgraded = upgradeNativeRun(snapshot, defined.workflow, defined.transitionHandler);
      if (upgraded !== snapshot) {
        await createRuntime({
          ...defined,
          workflows: [defined.workflow],
          transitionHandlers: [defined.transitionHandler],
          store: { read: async () => upgraded, compareAndSwap: async () => false },
        }).inspect(name);
        snapshot = upgraded;
      }
    }
    return {
      runtime: createRuntime({
        ...defined,
        executors: options.readOnly ? [] : defined.executors,
        store: {
          ...store,
          async read(runId) {
            if (snapshot && runId === name) {
              const current = snapshot;
              snapshot = null;
              return Promise.resolve(current);
            }
            const current = await store.read(runId);
            return current
              ? upgradeNativeRun(current, defined.workflow, defined.transitionHandler)
              : current;
          },
        },
        workflows: [defined.workflow],
        transitionHandlers: [defined.transitionHandler],
      }),
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
    readOnly: options.readOnly,
  });
  if (application.identity.id !== id || application.identity.base !== 'native')
    throw new Error('Native change owner does not match its fixed Application');
  return {
    runtime: createRuntime({
      ...application.implementation,
      ...(options.readOnly ? { executors: [] } : {}),
      store: application.store,
    }),
    executors: application.implementation.executors ?? [],
    application,
  };
}
export async function inspectNativeSdkRun(
  projectRoot: string,
  name: string,
  options: {
    readOnly?: boolean;
  } = {},
): Promise<{
  run: WorkflowRun;
  state: NativePortableState;
  artifactRootRef: string;
  application: LoadedWorkflowApplication | null;
}> {
  const owner = await readSdkChangeOwner(projectRoot, 'native', name, options);
  if (!owner) throw new Error(`Native change ${name} is not owned by an SDK Run`);
  const { runtime, application } = await loadOwnedNativeSdkRuntime(projectRoot, name, {
    ...options,
    owner,
  });
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
  return { run, state, artifactRootRef: run.input.artifactRootRef, application };
}
export async function findNativeSdkWorkspace(
  projectRoot: string,
  name: string,
  options: {
    readOnly?: boolean;
  } = {},
): Promise<
  | ({
      projectRoot: string;
    } & Awaited<ReturnType<typeof inspectNativeSdkRun>>)
  | null
> {
  const requestedRoot = path.resolve(projectRoot);
  if (await readSdkChangeOwner(requestedRoot, 'native', name, options)) {
    return {
      projectRoot: requestedRoot,
      ...(await inspectNativeSdkRun(requestedRoot, name, options)),
    };
  }
  return null;
}
export async function resolveNativeSdkCommandRoot(
  projectRoot: string,
  name: string,
  options: {
    readOnly?: boolean;
  } = {},
): Promise<string> {
  const requestedRoot = path.resolve(projectRoot);
  let localOwner = await readChangeRuntimeOwner(requestedRoot, 'native', name, options);
  if (!localOwner && !options.readOnly) {
    const config = await readProjectConfig(requestedRoot);
    if (config) {
      const paths = await nativeProjectPaths(requestedRoot, config.native.artifact_root, {
        change: name,
      });
      localOwner = await resolveNativeChangeRuntimeOwner(paths, name);
    }
  }
  if (localOwner) return requestedRoot;
  return (await findNativeSdkWorkspace(requestedRoot, name, options))?.projectRoot ?? requestedRoot;
}
