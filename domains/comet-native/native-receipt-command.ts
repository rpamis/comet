import {
  issueNativeAutomatedCheckReceipt,
  issueNativeManualEvidenceReceipt,
  MAX_NATIVE_AUTOMATED_COMMAND_TIMEOUT_MS,
} from './native-verification-receipt-runtime.js';
import { refreshNativeVerificationReceipts } from './native-receipt-refresh.js';
import {
  assertNoArguments,
  configuredPaths,
  NativeUsageError,
  requiredPositional,
  success,
  takeFlag,
  takeMany,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';

export async function nativeReceiptCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const subcommand = requiredPositional(args, 'receipt subcommand');
  const name = requiredPositional(args, 'change name');
  const { paths } = await configuredPaths(projectRoot);
  if (subcommand === 'manual') {
    const acceptanceIds = takeMany(args, '--acceptance');
    const steps = takeMany(args, '--step');
    const observations = takeMany(args, '--observation');
    assertNoArguments(args);
    const issued = await issueNativeManualEvidenceReceipt({
      paths,
      name,
      acceptanceIds,
      steps,
      observations,
    });
    return success('receipt manual', issued, `Native manual receipt: ${issued.ref}\n`);
  }
  if (subcommand === 'automated') {
    const separator = args.indexOf('--');
    if (separator < 0 || separator === args.length - 1) {
      throw new NativeUsageError('receipt automated requires -- <executable> [args...]');
    }
    const commandArgs = args.splice(separator + 1);
    args.splice(separator, 1);
    const acceptanceIds = takeMany(args, '--acceptance');
    const timeoutText = takeOption(args, '--timeout-ms');
    assertNoArguments(args);
    const timeoutMs =
      timeoutText === undefined
        ? undefined
        : /^[1-9]\d*$/u.test(timeoutText) &&
            Number.isSafeInteger(Number(timeoutText)) &&
            Number(timeoutText) <= MAX_NATIVE_AUTOMATED_COMMAND_TIMEOUT_MS
          ? Number(timeoutText)
          : null;
    if (timeoutMs === null) {
      throw new NativeUsageError(
        `--timeout-ms must be an integer from 1 through ${MAX_NATIVE_AUTOMATED_COMMAND_TIMEOUT_MS}`,
      );
    }
    const issued = await issueNativeAutomatedCheckReceipt({
      paths,
      name,
      acceptanceIds,
      command: commandArgs[0],
      args: commandArgs.slice(1),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    const lines = [`Native automated receipt ${issued.receipt.status}: ${issued.ref}`];
    if (issued.recovery) {
      const changed = issued.recovery.changedPaths
        .map((entry) => `  ${entry.kind}: ${entry.path}`)
        .join('\n');
      lines.push('Implementation changed while the verification command was running.');
      if (changed) lines.push(changed);
      if (issued.recovery.changedPathsTruncated) {
        lines.push(
          `  ... ${issued.recovery.changedPathCount - issued.recovery.changedPaths.length} more path(s)`,
        );
      }
      lines.push(`Recover with: ${issued.recovery.nextCommand}`);
    }
    return {
      command: 'receipt automated',
      exitCode: issued.receipt.status === 'passed' ? 0 : 1,
      data: issued,
      text: `${lines.join('\n')}\n`,
    };
  }
  if (subcommand === 'refresh') {
    const apply = takeFlag(args, '--apply');
    const dryRun = takeFlag(args, '--dry-run');
    assertNoArguments(args);
    if (apply && dryRun) {
      throw new NativeUsageError('receipt refresh --apply and --dry-run cannot be combined');
    }
    const result = await refreshNativeVerificationReceipts({ paths, name, apply });
    const lines: string[] = [];
    if (result.refreshed.length > 0) {
      lines.push(`Re-issued ${result.refreshed.length} manual receipt(s) at the current revision:`);
      for (const item of result.refreshed) {
        lines.push(`  ${item.acceptanceId}: ${item.oldRef} -> ${item.newRef}`);
      }
    }
    if (result.requiresRerun.length > 0) {
      lines.push(
        `Re-run ${result.requiresRerun.length} stale automated receipt(s) (they cannot be re-issued without a real execution):`,
      );
      for (const item of result.requiresRerun) {
        const acceptances = item.acceptanceIds.join(', ');
        lines.push(`  [${acceptances}] ${item.command}`);
      }
    }
    if (result.requiresManual.length > 0) {
      lines.push(
        `Re-run manual verification for ${result.requiresManual.length} receipt(s); contract, scope, snapshot, or artifact bindings changed:`,
      );
      for (const item of result.requiresManual) {
        lines.push(`  [${item.acceptanceIds.join(', ')}] ${item.mismatches.join('; ')}`);
      }
    }
    if (result.requiresCheck.length > 0) {
      lines.push(
        `Re-run \`comet native check ${name}\` to refresh ${result.requiresCheck.length} required-check receipt(s).`,
      );
    }
    if (result.applied) {
      lines.push(`Updated acceptance evidence in ${result.verificationReport}.`);
    } else if (
      result.refreshed.length === 0 &&
      result.requiresRerun.length === 0 &&
      result.requiresManual.length === 0 &&
      result.requiresCheck.length === 0
    ) {
      lines.push('No stale receipts found.');
    } else if (!apply) {
      lines.push('Dry run only. Re-run with --apply to re-issue manual receipts.');
    } else if (result.requiresManual.length > 0) {
      lines.push('Fresh manual verification is required before these receipts can be refreshed.');
    }
    return success('receipt refresh', result, `${lines.join('\n')}\n`);
  }
  throw new NativeUsageError(`Unknown receipt command: ${subcommand}`);
}
