import {
  inspectNativeChange,
  nativeChangeDir,
  NativeRuntimeCompatibilityError,
} from './native-change.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { inspectNativeChildren } from './native-children.js';
import { NATIVE_CONTRACT_FILE_LIMITS } from './native-contract-files.js';
import { readNativeProposedSpecs } from './native-specs.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import {
  isNativePortableChange,
  nativePortableChangeDir,
  readNativePortableChange,
} from './native-portable-runtime.js';
import {
  assertNoArguments,
  configuredPaths,
  NATIVE_SHOW_MAX_SERIALIZED_BYTES,
  requiredPositional,
  success,
  type DispatchResult,
} from './native-cli-shared.js';

export async function nativeShowCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const name = requiredPositional(args, 'change name');
  assertNoArguments(args);
  const { paths } = await configuredPaths(projectRoot);
  if (await isNativePortableChange(paths, name)) {
    const state = await readNativePortableChange(paths, name);
    const changeDir = nativePortableChangeDir(paths, name);
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
      brief: brief.text,
      proposedSpecs,
      continuation: nativePortableContinuation(
        state,
        await inspectNativeChildren({ paths, state }),
      ),
    };
    return success('show', payload);
  }
  const inspection = await inspectNativeChange(paths, name);
  if (inspection.status === 'migration-required') {
    return success('show', {
      name,
      schema: inspection.schema,
      minimumRuntimeVersion: inspection.minimumRuntimeVersion,
      migrationRequired: true,
      message: inspection.message,
    });
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
    maxBytes: NATIVE_CONTRACT_FILE_LIMITS.maxFileBytes,
  });
  const payload = {
    state,
    brief: brief.text,
    proposedSpecs,
  };
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > NATIVE_SHOW_MAX_SERIALIZED_BYTES) {
    throw new Error('Native show output exceeds its serialized byte budget');
  }
  return success('show', payload);
}
