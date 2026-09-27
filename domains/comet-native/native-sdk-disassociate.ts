import { promises as fs } from 'node:fs';
import path from 'node:path';

import type {
  RuntimeCommandValidator,
  RuntimeExecutor,
  RuntimeValidator,
  WorkflowRun,
} from '../engine/runtime.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { readProjectConfig } from './native-config.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { nativeProjectPaths } from './native-paths.js';
import { parseNativePortableState } from './native-portable-state.js';

async function association(run: Readonly<WorkflowRun>, projectRoot: string) {
  const state = parseNativePortableState(run.state);
  const input = run.input as { name?: unknown; artifactRootRef?: unknown };
  const config = await readProjectConfig(projectRoot);
  if (
    state.phase !== 'shape' ||
    state.archived ||
    input.name !== state.name ||
    typeof input.artifactRootRef !== 'string' ||
    config?.native.artifact_root !== input.artifactRootRef
  ) {
    throw new Error('Native SDK capability association is not bound to the current Shape');
  }
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef);
  const file = path.join(paths.changesDir, state.name, 'capability-association.yaml');
  const ref = path.relative(projectRoot, file);
  const inspected = await inspectProtectedProjectPath(projectRoot, ref, {
    label: 'Native capability association',
    expected: 'file',
  });
  return { paths, file, inspected };
}

export const nativeSdkDisassociateExecutor: RuntimeExecutor = {
  id: 'comet-native-disassociate',
  capabilities: [],
  supports(action) {
    return action.stepId === 'shape.disassociate' && action.ref === 'native-disassociate';
  },
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) throw new Error('Native SDK project context is required');
    const activation = (action.input as { activation?: { expectedStateVersion?: unknown } })
      .activation;
    const state = parseNativePortableState(run.state);
    if (activation?.expectedStateVersion !== state.state_version) {
      throw new Error('Native SDK capability revocation references a stale Shape');
    }
    const bound = await association(run, context.projectRoot);
    await withNativeMutationLock(
      bound.paths,
      `disassociate SDK capability ${state.name}`,
      async () => {
        const current = await association(run, context.projectRoot!);
        if (current.inspected.exists) await fs.rm(current.file);
      },
    );
    return { status: 'succeeded', output: { removed: true } };
  },
};

export const nativeSdkDisassociateCommandValidator: RuntimeCommandValidator = {
  id: 'comet-native-disassociate-command',
  version: '1',
  async validate({ run, name, input, context }) {
    const state = parseNativePortableState(run.state);
    if (
      name !== 'disassociate-capability' ||
      state.phase !== 'shape' ||
      !['active', 'await-user'].includes(state.status) ||
      state.archived ||
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'expectedStateVersion' ||
      input.expectedStateVersion !== state.state_version ||
      !context?.projectRoot
    ) {
      return { accepted: false, reason: 'Native capability revocation is stale or outside Shape' };
    }
    try {
      const current = await association(run, context.projectRoot);
      return current.inspected.exists
        ? { accepted: true }
        : { accepted: false, reason: 'Native capability association does not exist' };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const nativeSdkDisassociateValidator: RuntimeValidator = {
  id: 'comet-native-disassociate-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (
      outcome.status !== 'succeeded' ||
      action.stepId !== 'shape.disassociate' ||
      !context?.projectRoot ||
      (outcome.output as { removed?: unknown } | null)?.removed !== true
    ) {
      return { accepted: false, reason: 'Native capability revocation has no successful receipt' };
    }
    try {
      const current = await association(run, context.projectRoot);
      return current.inspected.exists
        ? { accepted: false, reason: 'Native capability association still exists' }
        : { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
