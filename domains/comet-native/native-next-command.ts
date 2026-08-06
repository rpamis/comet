import { inspectNativeStatus } from './native-diagnostics.js';
import { readNativeChange } from './native-change.js';
import { advanceNativeChange } from './native-transitions.js';
import type { NativeAdvanceEvidence } from './native-types.js';
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

export async function nativeNextCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const name = requiredPositional(args, 'change name');
  const summary = takeOption(args, '--summary');
  if (!summary) throw new NativeUsageError('--summary is required');
  const confirmed = takeFlag(args, '--confirmed');
  const returnToBuild = takeFlag(args, '--return-to-build');
  const artifacts = takeMany(args, '--artifact');
  const noCodeReason = takeOption(args, '--no-code-reason');
  const allowPartialScopeHash = takeOption(args, '--allow-partial-scope');
  const partialReason = takeOption(args, '--partial-reason');
  const verificationResult = takeOption(args, '--result');
  const verificationReport = takeOption(args, '--report');
  const repairOverrideSignature = takeOption(args, '--override-repair');
  const repairOverrideSummary = takeOption(args, '--override-summary');
  if (
    verificationResult !== undefined &&
    verificationResult !== 'pass' &&
    verificationResult !== 'fail'
  ) {
    throw new NativeUsageError('--result must be pass or fail');
  }
  if ((allowPartialScopeHash === undefined) !== (partialReason === undefined)) {
    throw new NativeUsageError(
      '--allow-partial-scope and --partial-reason must be provided together',
    );
  }
  if (allowPartialScopeHash && !/^[a-f0-9]{64}$/u.test(allowPartialScopeHash)) {
    throw new NativeUsageError('--allow-partial-scope must be a SHA-256 hash');
  }
  if (allowPartialScopeHash && !confirmed) {
    throw new NativeUsageError('--allow-partial-scope requires --confirmed');
  }
  if ((repairOverrideSignature === undefined) !== (repairOverrideSummary === undefined)) {
    throw new NativeUsageError(
      '--override-repair and --override-summary must be provided together',
    );
  }
  if (repairOverrideSignature && !/^[a-f0-9]{64}$/u.test(repairOverrideSignature)) {
    throw new NativeUsageError('--override-repair must be a SHA-256 hash');
  }
  if (repairOverrideSignature && verificationResult !== undefined) {
    throw new NativeUsageError('--override-repair cannot be combined with --result');
  }
  if (
    returnToBuild &&
    (confirmed ||
      artifacts.length > 0 ||
      noCodeReason !== undefined ||
      allowPartialScopeHash !== undefined ||
      partialReason !== undefined ||
      verificationResult !== undefined ||
      verificationReport !== undefined ||
      repairOverrideSignature !== undefined ||
      repairOverrideSummary !== undefined)
  ) {
    throw new NativeUsageError(
      '--return-to-build cannot be combined with confirmation, artifact, verification, partial-scope, or repair evidence',
    );
  }
  assertNoArguments(args);
  const { config, paths } = await configuredPaths(projectRoot);
  if (returnToBuild) {
    const state = await readNativeChange(paths, name);
    if (state.phase !== 'verify' && state.phase !== 'archive') {
      throw new NativeUsageError('--return-to-build is only valid in Verify or Archive');
    }
  }
  const evidence: NativeAdvanceEvidence = {
    summary,
    ...(returnToBuild ? { returnToBuild: true } : {}),
    ...(confirmed ? { confirmed: true } : {}),
    ...(artifacts.length > 0 ? { artifacts } : {}),
    ...(noCodeReason ? { noCodeReason } : {}),
    ...(allowPartialScopeHash ? { allowPartialScopeHash } : {}),
    ...(partialReason ? { partialReason } : {}),
    ...(verificationResult ? { verificationResult } : {}),
    ...(verificationReport ? { verificationReport } : {}),
    ...(repairOverrideSignature ? { repairOverrideSignature } : {}),
    ...(repairOverrideSummary ? { repairOverrideSummary } : {}),
  };
  const result = await advanceNativeChange({
    paths,
    name,
    evidence,
    clarificationMode: config.native.clarification_mode,
    maxVerifyFailures: config.native.max_verify_failures,
  });
  if (result.next === 'manual') {
    const repairBlocked =
      result.repair?.disposition === 'manual-stop' ||
      result.repair?.disposition === 'hard-stop' ||
      result.findings.some((finding) =>
        ['repair-stagnation-stop', 'repair-iteration-limit', 'repair-override-exhausted'].includes(
          finding.code,
        ),
      );
    return {
      command: 'next',
      exitCode: repairBlocked ? 75 : 65,
      data: result,
      error: {
        code: repairBlocked ? 'blocked' : 'invalid-data',
        message: result.findings[0]?.message ?? 'Native phase guard failed',
      },
    };
  }
  const status = await inspectNativeStatus(paths, name, {
    clarificationMode: config.native.clarification_mode,
    maxVerifyFailures: config.native.max_verify_failures,
  });
  return success('next', { ...result, continuation: status.continuation });
}
