import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  createFileRuntimeStore,
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
  portableWorkspace,
  assertPortableWorkspaceBindingCurrent,
  NAME_PATTERN,
} from './native-portable-storage.js';
import { createNativePortableState } from './native-portable-state.js';
import { resolveContainedNativePath } from './native-paths.js';
import type { CometProjectConfig, NativeProjectPaths } from './native-types.js';
import type { NativeWorkspaceBinding } from './native-workspace.js';

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
    const application = defineNativeWorkflowApplication();
    const persistentStore = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(options.paths.projectRoot, '.comet', 'runtime', 'sdk-runs', 'native'),
    });
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
      executors: application.executors,
    });
    const run = await runtime.start({
      runId: options.name,
      workflow: { id: application.workflow.id, version: application.workflow.version },
      input: { name: options.name, artifactRootRef: options.paths.artifactRootRef },
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
    return run;
  });
}
