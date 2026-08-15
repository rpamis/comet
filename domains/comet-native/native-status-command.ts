import {
  inspectDiscoveredNativeStatus,
  listDiscoveredNativeStatusPage,
} from './native-status-discovery.js';
import {
  assertNoArguments,
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
  const name = args[0]?.startsWith('--') ? undefined : args.shift();
  if (details && !name) throw new NativeUsageError('status --details requires a change name');
  if (cursor && name && !details) {
    throw new NativeUsageError('--cursor for a named status requires --details');
  }
  assertNoArguments(args);
  const data = name
    ? await inspectDiscoveredNativeStatus({
        projectRoot,
        name,
        details,
        ...(cursor ? { detailsCursor: cursor } : {}),
      })
    : await listDiscoveredNativeStatusPage({
        projectRoot,
        ...(cursor ? { cursor } : {}),
      });
  return success('status', data);
}
