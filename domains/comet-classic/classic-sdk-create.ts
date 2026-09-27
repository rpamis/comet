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
  readSdkChangeOwner,
  registerSdkChangeOwner,
} from '../workflow-contract/change-runtime-owner.js';
import { defineClassicWorkflowApplication } from './classic-sdk-application.js';
import type { ClassicProfile, ClassicState } from './classic-state.js';

/** Caller holds the Classic per-change ownership lock. */
export async function createClassicSdkRun(options: {
  projectRoot: string;
  name: string;
  profile: ClassicProfile;
  changeDir: string;
  initialState: ClassicState;
}): Promise<WorkflowRun> {
  const application = defineClassicWorkflowApplication(options.profile);
  const persistentStore = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(options.projectRoot, '.comet', 'runtime', 'sdk-runs', 'classic'),
  });
  const store: RuntimeStore<WorkflowRun> = {
    async read(runId) {
      const current = await persistentStore.read(runId);
      if (current && !(await readSdkChangeOwner(options.projectRoot, 'classic', runId))) {
        throw new RuntimeProtocolError(
          'RUN_OWNER_MISSING',
          `Classic SDK Run ${runId} 缺少归属记录`,
        );
      }
      return current;
    },
    async compareAndSwap(runId, expectedRevision, next) {
      if (expectedRevision === null) {
        if (runId !== options.name) throw new Error('Classic SDK Run ID and change name differ');
        await registerSdkChangeOwner(options.projectRoot, {
          schema: COMET_CHANGE_OWNER_SCHEMA,
          workflow: 'classic',
          change: options.name,
          format: 'sdk',
          application: `classic-${options.profile}`,
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
    evidenceValidators: application.evidenceValidators,
    validators: application.validators,
  });
  return runtime.start({
    runId: options.name,
    workflow: { id: application.workflow.id, version: application.workflow.version },
    input: {
      change: options.name,
      changeDir: path.relative(options.projectRoot, options.changeDir).replaceAll('\\', '/'),
    },
    initialState: options.initialState,
  });
}
