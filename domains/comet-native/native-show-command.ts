import {
  inspectNativeChange,
  nativeChangeDir,
  NativeRuntimeCompatibilityError,
} from './native-change.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { inspectNativeChildren } from './native-children.js';
import { readNativeProposedSpecs } from './native-specs.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import { nativePortableCheckPlansFromLocal } from './native-portable-checks.js';
import { nativeVerifierExecutionRefForState } from './native-local-execution.js';
import {
  isNativePortableChange,
  nativePortableChangeDir,
  readNativePortableRuntime,
} from './native-portable-runtime.js';
import {
  assertNoArguments,
  configuredPaths,
  NATIVE_SHOW_MAX_SERIALIZED_BYTES,
  requiredPositional,
  success,
  type DispatchResult,
} from './native-cli-shared.js';
import { nativeChangeArtifactPaths } from './native-paths.js';
import { discoverNativeChangeProjectRoot } from './native-status-discovery.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { inspectNativeSdkRun } from './native-runtime-ownership.js';
import type { NativeProjectPaths } from './native-types.js';
import type { NativePortableState } from './native-portable-types.js';

async function portableShowResult(
  paths: NativeProjectPaths,
  state: NativePortableState,
  local: Awaited<ReturnType<typeof readNativePortableRuntime>>['local'],
  executionCwd: string,
): Promise<DispatchResult> {
  const changeDir = nativePortableChangeDir(paths, state.name);
  const brief = await readNativeBoundedTextFile({
    root: changeDir,
    ref: state.brief,
    maxBytes: null,
    includeHash: false,
  });
  const proposedSpecs = [];
  for (const spec of state.spec_changes) {
    if (spec.source === null) continue;
    const source = await readNativeBoundedTextFile({
      root: changeDir,
      ref: spec.source,
      maxBytes: null,
      includeHash: false,
    });
    proposedSpecs.push({
      capability: spec.capability,
      operation: spec.operation,
      source: spec.source,
      content: source.text,
    });
  }
  const payload = {
    state,
    artifacts: nativeChangeArtifactPaths(paths, state.name),
    brief: brief.text,
    proposedSpecs,
    continuation: nativePortableContinuation(state, await inspectNativeChildren({ paths, state }), {
      verifierExecutionRef: nativeVerifierExecutionRefForState(state, local),
      ...(local
        ? {
            verificationCheckPlans: nativePortableCheckPlansFromLocal(
              local,
              local.workspace.projectRoot,
            ),
          }
        : {}),
    }),
  };
  return { ...success('show', payload), executionCwd };
}

export async function nativeShowCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const name = requiredPositional(args, 'change name');
  assertNoArguments(args);
  const executionCwd = await discoverNativeChangeProjectRoot({ projectRoot, name });
  const { paths } = await configuredPaths(executionCwd);
  if (await readSdkChangeOwner(executionCwd, 'native', name)) {
    const { state } = await inspectNativeSdkRun(executionCwd, name);
    return portableShowResult(paths, state, null, executionCwd);
  }
  if (await isNativePortableChange(paths, name)) {
    const runtime = await readNativePortableRuntime({ paths, name });
    return portableShowResult(paths, runtime.state, runtime.local, executionCwd);
  }
  const inspection = await inspectNativeChange(paths, name);
  if (inspection.status === 'migration-required') {
    return {
      ...success('show', {
        name,
        artifacts: nativeChangeArtifactPaths(paths, name),
        schema: inspection.schema,
        minimumRuntimeVersion: inspection.minimumRuntimeVersion,
        migrationRequired: true,
        message: inspection.message,
      }),
      executionCwd,
    };
  }
  if (inspection.status !== 'current' || !inspection.state) {
    throw new NativeRuntimeCompatibilityError(inspection.schema, inspection.minimumRuntimeVersion);
  }
  const state = inspection.state;
  const changeDir = nativeChangeDir(paths, name);
  const proposedSpecs = await readNativeProposedSpecs(paths, name);
  const brief = await readNativeBoundedTextFile({
    root: changeDir,
    ref: state.brief,
    maxBytes: null,
  });
  const payload = {
    state,
    artifacts: nativeChangeArtifactPaths(paths, state.name),
    brief: brief.text,
    proposedSpecs,
  };
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > NATIVE_SHOW_MAX_SERIALIZED_BYTES) {
    throw new Error('Native show output exceeds its serialized byte budget');
  }
  return { ...success('show', payload), executionCwd };
}
