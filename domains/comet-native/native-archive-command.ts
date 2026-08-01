import { archiveNativeChange } from './native-archive.js';
import { inspectNativeArchivePreflight } from './native-archive-inspection.js';
import { readNativeChange } from './native-change.js';
import { nativeContinuation } from './native-continuation.js';
import {
  assertNoArguments,
  configuredPaths,
  NativeUsageError,
  requiredPositional,
  success,
  takeFlag,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';

export async function nativeArchiveCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const name = requiredPositional(args, 'change name');
  const dryRun = takeFlag(args, '--dry-run');
  const expectedPreflightHash = takeOption(args, '--expect-preflight');
  const confirmed = takeFlag(args, '--confirmed');
  if (dryRun && expectedPreflightHash) {
    throw new NativeUsageError('--dry-run and --expect-preflight cannot be combined');
  }
  if (dryRun && confirmed) {
    throw new NativeUsageError('--confirmed is only valid with --expect-preflight');
  }
  if (!dryRun && !expectedPreflightHash) {
    throw new NativeUsageError('archive requires --dry-run or --expect-preflight <sha256>');
  }
  if (expectedPreflightHash && !/^[a-f0-9]{64}$/u.test(expectedPreflightHash)) {
    throw new NativeUsageError('--expect-preflight must be a SHA-256 hash');
  }
  assertNoArguments(args);
  const { config, paths } = await configuredPaths(projectRoot);
  if (dryRun) {
    const preview = await inspectNativeArchivePreflight({ paths, name });
    const state = await readNativeChange(paths, name);
    return success(
      'archive --dry-run',
      {
        ...preview,
        continuation: nativeContinuation({
          state,
          archiveReady: preview.ready,
          archiveConfirmation: preview.archiveConfirmation,
          archivePreflightHash: preview.preflightHash,
        }),
      },
      `Native Archive preview ${preview.preflightHash}: ${preview.ready ? 'ready' : 'blocked'}\n`,
    );
  }
  if (config.native.archive_confirmation === 'required' && !confirmed) {
    throw new NativeUsageError(
      'archive requires --confirmed when native.archive_confirmation is required',
    );
  }
  const state = await readNativeChange(paths, name);
  const result = await archiveNativeChange({
    paths,
    name,
    expectedPreflightHash: expectedPreflightHash!,
  });
  return success(
    'archive',
    { ...result, continuation: nativeContinuation({ state, done: true }) },
    `Archived Native change ${name} to ${result.archiveDir}\n`,
  );
}
