import { resolveNativeChangeRuntimeOwner } from './native-runtime-ownership.js';
import {
  inspectDiscoveredNativeStatus,
  NativePristineSdkRunRecoverableError,
} from './native-status-discovery.js';
import { selectNativeChange } from './native-selection.js';
import {
  assertNoArguments,
  configuredPaths,
  requiredPositional,
  success,
  type DispatchResult,
} from './native-cli-shared.js';

export async function nativeSelectCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const name = requiredPositional(args, 'change name');
  assertNoArguments(args);
  await configuredPaths(projectRoot);
  // The discovered projection carries the workspace that owns the change, so
  // selecting a worktree-bound change from the primary root routes both the
  // recorded selection and the caller into the right workspace (the compact
  // form dropped everything but the continuation).
  let executionCwd = projectRoot;
  const inspect = () =>
    inspectDiscoveredNativeStatus({
      projectRoot,
      name,
      onSelectedRoot: (selectedRoot) => {
        executionCwd = selectedRoot;
      },
    });
  let status;
  try {
    status = await inspect();
  } catch (error) {
    if (!(error instanceof NativePristineSdkRunRecoverableError)) throw error;
    const owner = await resolveNativeChangeRuntimeOwner(
      (await configuredPaths(error.projectRoot)).paths,
      name,
    );
    if (owner?.format !== 'sdk') throw error;
    status = await inspect();
  }
  await selectNativeChange((await configuredPaths(executionCwd)).paths, name);
  return {
    ...success('select', { selected: name, ...status }),
    executionCwd,
  };
}
