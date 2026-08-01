import { inspectNativeHookGuard, readNativeHookRequest } from './native-hook-guard.js';
import {
  assertNoArguments,
  takeOption,
  NativeUsageError,
  type DispatchResult,
} from './native-cli-shared.js';

export async function nativeHookGuardCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const hookOutput = takeOption(args, '--hook-output');
  if (hookOutput !== undefined && hookOutput !== 'copilot') {
    throw new NativeUsageError('--hook-output must be copilot');
  }
  assertNoArguments(args);
  const result = await inspectNativeHookGuard(projectRoot, await readNativeHookRequest());
  if (hookOutput === 'copilot') {
    return {
      command: 'hook-guard',
      exitCode: 0,
      data: result,
      text: result.allowed
        ? '{}\n'
        : `${JSON.stringify({
            permissionDecision: 'deny',
            permissionDecisionReason: result.reason,
          })}\n`,
    };
  }
  return result.allowed
    ? { command: 'hook-guard', exitCode: 0, data: result }
    : {
        command: 'hook-guard',
        exitCode: 2,
        data: result,
        error: { code: 'blocked', message: result.reason },
      };
}
