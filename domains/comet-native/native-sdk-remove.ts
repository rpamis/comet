import path from 'node:path';

import type {
  RuntimeCommandValidator,
  RuntimeExecutor,
  RuntimeValidator,
  WorkflowRun,
} from '../engine/runtime.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { assertCapabilityId } from './native-change-model.js';
import { readProjectConfig } from './native-config.js';
import { nativeProjectPaths } from './native-paths.js';
import { parseNativePortableState } from './native-portable-state.js';

async function removalTarget(run: Readonly<WorkflowRun>, projectRoot: string, capability: string) {
  assertCapabilityId(capability);
  const state = parseNativePortableState(run.state);
  const input = run.input as { name?: unknown; artifactRootRef?: unknown };
  const config = await readProjectConfig(projectRoot);
  if (
    state.archived ||
    state.status === 'done' ||
    input.name !== state.name ||
    typeof input.artifactRootRef !== 'string' ||
    config?.native.artifact_root !== input.artifactRootRef
  ) {
    throw new Error('Native SDK capability removal requires an active change');
  }
  const paths = await nativeProjectPaths(projectRoot, input.artifactRootRef);
  const canonical = await inspectProtectedProjectPath(
    projectRoot,
    path.relative(projectRoot, path.join(paths.specsDir, capability, 'spec.md')),
    { label: 'Canonical Native spec', expected: 'file' },
  );
  if (!canonical.exists) throw new Error(`Canonical Native spec does not exist: ${capability}`);
  const proposal = await inspectProtectedProjectPath(
    projectRoot,
    path.relative(projectRoot, path.join(paths.changesDir, state.name, 'specs', capability)),
    { label: 'Native proposed spec', expected: 'directory' },
  );
  if (proposal.exists) {
    throw new Error(`Capability ${capability} cannot be proposed and removed together`);
  }
  return state;
}

export const nativeSdkRemoveCommandValidator: RuntimeCommandValidator = {
  id: 'comet-native-remove-command',
  version: '1',
  async validate({ run, name, input, context }) {
    const state = parseNativePortableState(run.state);
    if (
      name !== 'remove-capability' ||
      !['active', 'await-user', 'blocked'].includes(state.status) ||
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'capability,expectedStateVersion' ||
      typeof input.capability !== 'string' ||
      input.expectedStateVersion !== state.state_version ||
      !context?.projectRoot
    ) {
      return { accepted: false, reason: 'Native capability removal is stale or invalid' };
    }
    try {
      await removalTarget(run, context.projectRoot, input.capability);
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const nativeSdkRemoveExecutor: RuntimeExecutor = {
  id: 'comet-native-remove',
  capabilities: [],
  supports(action) {
    return action.stepId === 'shape.remove' && action.ref === 'native-remove';
  },
  async execute(action, context, run) {
    if (!context?.projectRoot || !run) throw new Error('Native SDK project context is required');
    const activation = (
      action.input as {
        activation?: { capability?: unknown; expectedStateVersion?: unknown };
      }
    ).activation;
    const state = parseNativePortableState(run.state);
    if (
      typeof activation?.capability !== 'string' ||
      activation.expectedStateVersion !== state.state_version
    ) {
      throw new Error('Native capability removal references a stale change');
    }
    await removalTarget(run, context.projectRoot, activation.capability);
    return { status: 'succeeded', output: { capability: activation.capability } };
  },
};

export const nativeSdkRemoveValidator: RuntimeValidator = {
  id: 'comet-native-remove-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    const activation = (action.input as { activation?: { capability?: unknown } }).activation;
    if (
      outcome.status !== 'succeeded' ||
      action.stepId !== 'shape.remove' ||
      !context?.projectRoot ||
      typeof activation?.capability !== 'string' ||
      (outcome.output as { capability?: unknown } | null)?.capability !== activation.capability
    ) {
      return { accepted: false, reason: 'Native capability removal has no matching receipt' };
    }
    try {
      await removalTarget(run, context.projectRoot, activation.capability);
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
