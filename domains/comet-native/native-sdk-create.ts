import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  createRuntime,
  RuntimeProtocolError,
  type RuntimeStore,
  type WorkflowRun,
} from '../engine/runtime.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  readChangeRuntimeOwner,
  readSdkChangeOwner,
  registerSdkChangeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import { atomicWriteText } from './native-atomic-file.js';
import { nativeBriefTemplate } from './native-artifact-language.js';
import {
  listActiveNativeChangesOwnedByWorkspace,
  NativeWorkspaceIsolationRequiredError,
} from './native-change.js';
import { readProjectConfig, writeProjectConfig } from './native-config.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import {
  assertNativeSdkStartAvailable,
  defineNativeWorkflowApplication,
} from './native-sdk-application.js';
import {
  nativePortableChangeDir,
  nativeLocalExecutionFile,
  portableWorkspace,
  assertPortableWorkspaceBindingCurrent,
  NAME_PATTERN,
} from './native-portable-storage.js';
import {
  createNativePortableState,
  parseNativePortableState,
  readNativePortableState,
} from './native-portable-state.js';
import { resolveContainedNativePath } from './native-paths.js';
import {
  createNativeSdkStateStore,
  hasNativeManagedRunMarker,
  readNativeSdkRunRecord,
  writeNativeManagedRunState,
} from './native-sdk-state-store.js';
import type { CometProjectConfig, NativeProjectPaths } from './native-types.js';
import type { NativeWorkspaceBinding } from './native-workspace.js';

async function startNativeSdkRun(options: {
  paths: NativeProjectPaths;
  name: string;
  initialState: ReturnType<typeof createNativePortableState>;
  recoverySourceHash?: string;
  recoverySource?: string;
}): Promise<WorkflowRun> {
  const application = defineNativeWorkflowApplication();
  const persistentStore = createNativeSdkStateStore(options.paths.projectRoot);
  const store: RuntimeStore<WorkflowRun> = {
    async read(runId) {
      const current = await persistentStore.read(runId);
      if (current && !(await readSdkChangeOwner(options.paths.projectRoot, 'native', runId))) {
        throw new RuntimeProtocolError('RUN_OWNER_MISSING', `SDK Run ${runId} 缺少归属记录`);
      }
      return current;
    },
    async compareAndSwap(runId, expectedRevision, next) {
      if (expectedRevision === null) {
        if (runId !== options.name) throw new Error('Native SDK Run ID and change name differ');
        await registerSdkChangeOwner(options.paths.projectRoot, {
          schema: COMET_CHANGE_OWNER_SCHEMA,
          workflow: 'native',
          change: options.name,
          format: 'sdk',
          application: 'native',
          runId,
        });
      }
      return persistentStore.compareAndSwap(runId, expectedRevision, next);
    },
  };
  const runtime = createRuntime({
    store,
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    validators: application.validators,
    stateValidators: application.stateValidators,
    commandValidators: application.commandValidators,
    validateRecovery: application.validateRecovery,
    executors: application.executors,
  });
  return runtime.start({
    runId: options.name,
    workflow: { id: application.workflow.id, version: application.workflow.version },
    input: {
      name: options.name,
      artifactRootRef: options.paths.artifactRootRef,
      ...(options.recoverySourceHash ? { recoverySourceHash: options.recoverySourceHash } : {}),
      ...(options.recoverySource ? { recoverySource: options.recoverySource } : {}),
    },
    initialState: options.initialState,
  });
}

/** Rebuild only an untouched entry Run; later phases require their original Action history. */
export async function inspectPristineNativeSdkChange(
  paths: NativeProjectPaths,
  name: string,
): Promise<ReturnType<typeof createNativePortableState> | null> {
  const file = path.join(nativePortableChangeDir(paths, name), 'comet-state.yaml');
  if (!(await hasNativeManagedRunMarker(file))) return null;
  const state = await readNativePortableState(file);
  const initialState = createNativePortableState({
    name,
    language: state.language,
    workspace: state.workspace,
    createdAt: state.created_at,
    nextAction: 'prepare-shape-confirmation',
  });
  if (JSON.stringify(state) !== JSON.stringify(initialState)) return null;
  return initialState;
}

/** Rebuild only an untouched entry Run; later phases require their original Action history. */
export async function recoverPristineNativeSdkChange(
  paths: NativeProjectPaths,
  name: string,
): Promise<WorkflowRun | null> {
  const initialState = await inspectPristineNativeSdkChange(paths, name);
  if (!initialState) return null;
  return startNativeSdkRun({ paths, name, initialState });
}

/** Restore a portable Run when present; older states explicitly restart at Shape. */
export async function restoreNativeSdkChange(
  paths: NativeProjectPaths,
  name: string,
): Promise<WorkflowRun> {
  return withNativeMutationLock(paths, `restore SDK change ${name}`, async () => {
    const owner = await readChangeRuntimeOwner(paths.projectRoot, 'native', name);
    if (
      owner &&
      (owner.format !== 'sdk' ||
        owner.application !== 'native' ||
        owner.runId !== name ||
        (await readNativeSdkRunRecord(paths.projectRoot, name)) !== null)
    ) {
      throw new Error(`Native change ${name} already has Runtime ownership`);
    }
    const resumed = await createNativeSdkStateStore(paths.projectRoot).read(name);
    if (resumed) return resumed;
    const local = await fs
      .stat(nativeLocalExecutionFile(paths, name))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if (local)
      throw new Error(
        `Native change ${name} still has local execution records; reconcile them before restoring`,
      );
    const file = path.join(nativePortableChangeDir(paths, name), 'comet-state.yaml');
    const source = await fs.readFile(file, 'utf8');
    if (!(await hasNativeManagedRunMarker(file))) {
      throw new Error(`Native change ${name} is not a managed Run`);
    }
    const state = await readNativePortableState(file);
    if (state.name !== name || state.archived || state.phase === 'archive') {
      throw new Error(`Native change ${name} cannot be restored from this state file`);
    }
    if (
      state.coordination_mode ||
      (state.verifier_action &&
        ['pending', 'running', 'unknown'].includes(state.verifier_action.status))
    ) {
      throw new Error(
        `Native change ${name} has unresolved external work; restore the original Run history and reconcile its outcome`,
      );
    }
    assertPortableWorkspaceBindingCurrent(paths.projectRoot, {
      isolation: state.workspace.isolation,
      changeBranch: state.workspace.change_branch,
      targetBranch: state.workspace.target_branch,
    });
    const initialState = createNativePortableState({
      name,
      language: state.language,
      workspace: { ...state.workspace, finish: null },
      createdAt: state.created_at,
      nextAction: 'prepare-shape-confirmation',
    });
    const run = await startNativeSdkRun({
      paths,
      name,
      initialState,
      recoverySourceHash: createHash('sha256').update(source).digest('hex'),
      recoverySource: source,
    });
    return run;
  });
}

export async function createNativeSdkChange(options: {
  paths: NativeProjectPaths;
  name: string;
  language: 'en' | 'zh-CN';
  workspaceBinding: NativeWorkspaceBinding;
  initialProjectConfig?: CometProjectConfig;
}): Promise<WorkflowRun> {
  return withNativeMutationLock(options.paths, `create SDK change ${options.name}`, async () => {
    if (!NAME_PATTERN.test(options.name))
      throw new Error(`Invalid Native change name: ${options.name}`);
    assertPortableWorkspaceBindingCurrent(options.paths.projectRoot, options.workspaceBinding);
    const owner = await readChangeRuntimeOwner(options.paths.projectRoot, 'native', options.name);
    if (owner) throw new Error(`Native change ${options.name} already has Runtime ownership`);
    await assertNativeSdkStartAvailable({
      projectRoot: options.paths.projectRoot,
      name: options.name,
      artifactRootRef: options.paths.artifactRootRef,
    });
    const activeChanges = await listActiveNativeChangesOwnedByWorkspace(options.paths);
    if (activeChanges.some((name) => name !== options.name)) {
      throw new NativeWorkspaceIsolationRequiredError(
        options.workspaceBinding.isolation,
        activeChanges.filter((name) => name !== options.name),
      );
    }
    const changeDir = nativePortableChangeDir(options.paths, options.name);
    await resolveContainedNativePath(options.paths.nativeRoot, changeDir);
    try {
      await fs.lstat(changeDir);
      throw new Error(`Native change ${options.name} already has an artifact directory`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (
      options.initialProjectConfig &&
      (await readProjectConfig(options.paths.projectRoot)) === null
    ) {
      await writeProjectConfig(options.paths.projectRoot, options.initialProjectConfig);
    }
    const run = await startNativeSdkRun({
      paths: options.paths,
      name: options.name,
      initialState: createNativePortableState({
        name: options.name,
        language: options.language,
        workspace: portableWorkspace(options.workspaceBinding),
        nextAction: 'prepare-shape-confirmation',
      }),
    });
    await fs.mkdir(options.paths.changesDir, { recursive: true });
    await fs.mkdir(changeDir);
    await fs.mkdir(path.join(changeDir, 'specs'));
    await atomicWriteText(path.join(changeDir, 'brief.md'), nativeBriefTemplate(options.language), {
      containedRoot: options.paths.nativeRoot,
    });
    await writeNativeManagedRunState(
      path.join(changeDir, 'comet-state.yaml'),
      parseNativePortableState(run.state),
      options.paths.nativeRoot,
      run,
    );
    await createNativeSdkStateStore(options.paths.projectRoot).read(run.runId);
    return run;
  });
}
