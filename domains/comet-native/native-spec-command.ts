import { inspectNativeStatus } from './native-diagnostics.js';
import { markNativeSpecRemoval, rebaseNativeSpecChanges } from './native-specs.js';
import {
  assertNoArguments,
  configuredPaths,
  NativeUsageError,
  requiredPositional,
  success,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';

export async function nativeSpecCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const subcommand = requiredPositional(args, 'spec subcommand');
  if (subcommand === 'remove') {
    const name = requiredPositional(args, 'change name');
    const capability = requiredPositional(args, 'capability');
    assertNoArguments(args);
    const { config, paths } = await configuredPaths(projectRoot);
    const state = await markNativeSpecRemoval(paths, name, capability);
    const status = await inspectNativeStatus(paths, state.name, {
      clarificationMode: config.native.clarification_mode,
      maxVerifyFailures: config.native.max_verify_failures,
    });
    return success(
      'spec remove',
      { ...state, continuation: status.continuation },
      `Marked Native capability ${capability} for removal in ${name}\n`,
    );
  }
  if (subcommand === 'rebase') {
    const name = requiredPositional(args, 'change name');
    const summary = takeOption(args, '--summary');
    if (!summary) throw new NativeUsageError('--summary is required');
    assertNoArguments(args);
    const { config, paths } = await configuredPaths(projectRoot);
    const state = await rebaseNativeSpecChanges({ paths, name, summary });
    const status = await inspectNativeStatus(paths, state.name, {
      clarificationMode: config.native.clarification_mode,
      maxVerifyFailures: config.native.max_verify_failures,
    });
    return success(
      'spec rebase',
      { ...state, continuation: status.continuation },
      `Rebased Native specs for ${name}\n`,
    );
  }
  throw new NativeUsageError(`Unknown spec command: ${subcommand}`);
}
