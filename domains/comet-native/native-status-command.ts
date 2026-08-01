import { inspectNativeStatus, listNativeStatusPage } from './native-diagnostics.js';
import {
  assertNoArguments,
  configuredPaths,
  NativeUsageError,
  success,
  takeFlag,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';

export async function nativeStatusCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const details = takeFlag(args, '--details');
  const cursor = takeOption(args, '--cursor');
  const acceptanceCursor = takeOption(args, '--acceptance-cursor');
  const name = args[0]?.startsWith('--') ? undefined : args.shift();
  if (details && !name) throw new NativeUsageError('status --details requires a change name');
  if (cursor && name) throw new NativeUsageError('--cursor is only valid for status lists');
  if (cursor && details) throw new NativeUsageError('--cursor cannot be combined with --details');
  if (acceptanceCursor && !details) {
    throw new NativeUsageError('--acceptance-cursor requires status --details');
  }
  if (acceptanceCursor && !name) {
    throw new NativeUsageError('--acceptance-cursor requires a change name');
  }
  assertNoArguments(args);
  const { config, paths } = await configuredPaths(projectRoot);
  const data = name
    ? await inspectNativeStatus(paths, name, {
        details,
        ...(acceptanceCursor ? { acceptanceCursor } : {}),
        clarificationMode: config.native.clarification_mode,
        maxVerifyFailures: config.native.max_verify_failures,
      })
    : await listNativeStatusPage(paths, {
        ...(cursor ? { cursor } : {}),
        clarificationMode: config.native.clarification_mode,
        maxVerifyFailures: config.native.max_verify_failures,
      });
  return success('status', data);
}
