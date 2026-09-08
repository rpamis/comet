import { checkNativeChange } from './native-check.js';
import { isNativePortableChange } from './native-portable-runtime.js';
import {
  assertNoArguments,
  configuredPaths,
  NativeUsageError,
  requiredPositional,
  type DispatchResult,
} from './native-cli-shared.js';

export async function nativeCheckCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const name = requiredPositional(args, 'change name');
  assertNoArguments(args);
  const { paths } = await configuredPaths(projectRoot);
  if (await isNativePortableChange(paths, name)) {
    throw new NativeUsageError(
      `comet native check is a legacy-only command. Run comet native status ${name} --json and follow its continuation to dispatch verification through comet native next.`,
    );
  }
  const checked = await checkNativeChange({ paths, name });
  const data = {
    ref: checked.ref,
    hash: checked.receipt.receiptHash,
    status: checked.receipt.status,
    checker: checked.receipt.checker,
    counts: checked.receipt.counts,
    issues: checked.receipt.issues,
    issuesTruncated: checked.receipt.issuesTruncated,
    stale: checked.receipt.stale,
    staleReasons: checked.receipt.staleReasons,
    startedAt: checked.receipt.startedAt,
    endedAt: checked.receipt.endedAt,
    sourceRevision: checked.receipt.sourceRevision,
  };
  const passed = checked.receipt.status === 'passed' && !checked.receipt.stale;
  return {
    command: 'check',
    exitCode: passed ? 0 : 1,
    data,
    text: `Native check ${passed ? 'passed' : 'failed'}: ${checked.ref}\n`,
  };
}
