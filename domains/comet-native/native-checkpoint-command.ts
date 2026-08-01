import path from 'path';

import { nativeChangeDir } from './native-change.js';
import { inspectNativeStatus } from './native-diagnostics.js';
import { checkpointNativeChange } from './native-progress-checkpoint.js';
import {
  assertNoArguments,
  configuredPaths,
  NativeUsageError,
  requiredPositional,
  revisionOption,
  success,
  takeMany,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';

export async function nativeCheckpointCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const name = requiredPositional(args, 'change name');
  const summary = takeOption(args, '--summary');
  if (!summary) throw new NativeUsageError('--summary is required');
  const nextAction = takeOption(args, '--next-action');
  if (!nextAction) throw new NativeUsageError('--next-action is required');
  const artifacts = takeMany(args, '--artifact');
  const expectedRevision = revisionOption(args);
  assertNoArguments(args);
  const { config, paths } = await configuredPaths(projectRoot);
  const result = await checkpointNativeChange({
    paths,
    name,
    summary,
    nextAction,
    artifacts,
    expectedRevision,
  });
  const status = await inspectNativeStatus(paths, name, {
    clarificationMode: config.native.clarification_mode,
    maxVerifyFailures: config.native.max_verify_failures,
  });
  const manifestRef = path
    .relative(
      paths.projectRoot,
      path.join(nativeChangeDir(paths, name), ...result.checkpoint.manifestRef.split('/')),
    )
    .replaceAll('\\', '/');
  return success('checkpoint', {
    ...result,
    checkpoint: { ...result.checkpoint, manifestRef },
    continuation: status.continuation,
  });
}
