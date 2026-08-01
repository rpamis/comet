import { inspectNativeStatus } from './native-diagnostics.js';
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
  const { config, paths } = await configuredPaths(projectRoot);
  await selectNativeChange(paths, name);
  const status = await inspectNativeStatus(paths, name, {
    clarificationMode: config.native.clarification_mode,
    maxVerifyFailures: config.native.max_verify_failures,
  });
  return success(
    'select',
    { selected: name, continuation: status.continuation },
    `Selected Native change ${name}\n`,
  );
}
