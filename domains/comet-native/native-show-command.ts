import {
  inspectNativeChange,
  nativeChangeDir,
  NativeRuntimeCompatibilityError,
} from './native-change.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { inspectNativeChildren } from './native-children.js';
import { readNativeProposedSpecs } from './native-specs.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import {
  isNativePortableChange,
  nativePortableChangeDir,
  readNativePortableRuntime,
} from './native-portable-runtime.js';
import {
  assertNoArguments,
  configuredPaths,
  requiredPositional,
  success,
  type DispatchResult,
} from './native-cli-shared.js';
import { nativeChangeArtifactPaths } from './native-paths.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { projectNativeSdkContinuation } from './native-sdk-continuation.js';
import { inspectNativeSdkRun } from './native-runtime-ownership.js';
import type { NativeProjectPaths } from './native-types.js';
import type { NativePortableState } from './native-portable-types.js';
async function portableShowResult(
  paths: NativeProjectPaths,
  state: NativePortableState,
  executionCwd: string,
  sdk?: Awaited<ReturnType<typeof projectNativeSdkContinuation>>,
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
    ...(sdk ?? {
      continuation: nativePortableContinuation(
        state,
        await inspectNativeChildren({ paths, state }),
        {
          verifierExecutionRef: state.verifier_action?.claim?.token,
        },
      ),
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
  const executionCwd = projectRoot;
  const { paths } = await configuredPaths(executionCwd);
  if (await readSdkChangeOwner(executionCwd, 'native', name)) {
    const { run, state, application } = await inspectNativeSdkRun(executionCwd, name);
    return portableShowResult(
      paths,
      state,
      executionCwd,
      await projectNativeSdkContinuation({
        run,
        state,
        projectRoot: executionCwd,
        applicationId: application?.identity.id,
        skillExecutors: application?.implementation.executors,
      }),
    );
  }
  if (await isNativePortableChange(paths, name)) {
    const runtime = await readNativePortableRuntime({ paths, name });
    return portableShowResult(paths, runtime.state, executionCwd);
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
  return { ...success('show', payload), executionCwd };
}
