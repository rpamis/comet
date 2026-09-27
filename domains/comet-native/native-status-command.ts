import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { nativeStatusSummaryLine } from './native-output-language.js';
import { inspectNativeSdkStatus, type NativeSdkStatusProjection } from './native-sdk-status.js';
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

function sdkStatusResult(data: NativeSdkStatusProjection, executionCwd: string): DispatchResult {
  return {
    ...success('status', data),
    executionCwd,
    envelope: {
      summary: nativeStatusSummaryLine({
        name: data.name,
        phase: data.phase,
        status: data.status,
        acceptance: data.acceptance,
        locale: data.language === 'zh-CN' ? 'zh-CN' : 'en',
      }),
    },
  };
}

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
  let executionCwd = projectRoot;
  if (name && (await readSdkChangeOwner(projectRoot, 'native', name))) {
    if (cursor) throw new NativeUsageError('SDK Native status details do not use --cursor');
    return sdkStatusResult(
      await inspectNativeSdkStatus({ projectRoot, name, details }),
      projectRoot,
    );
  }
  const data = name
    ? await inspectDiscoveredNativeStatus({
        projectRoot,
        name,
        onSelectedRoot: (selectedRoot) => {
          executionCwd = selectedRoot;
        },
        details,
        ...(cursor ? { detailsCursor: cursor } : {}),
      })
    : await listDiscoveredNativeStatusPage({
        projectRoot,
        ...(cursor ? { cursor } : {}),
      });
  if (name && 'run' in data && data.schema === 'comet.native.sdk-status.v1') {
    return sdkStatusResult(data, executionCwd);
  }
  return { ...success('status', data), executionCwd };
}
