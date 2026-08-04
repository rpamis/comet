import { archiveNativeChange } from './native-archive.js';
import { inspectNativeArchivePreflight } from './native-archive-inspection.js';
import { readNativeChange } from './native-change.js';
import { nativeContinuation } from './native-continuation.js';
import {
  readNativeWorkspaceIdentity,
  setNativeWorkspaceFinish,
  type NativeWorkspaceFinish,
} from './native-workspace.js';
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
  const finishOption = takeOption(args, '--finish');
  const finish = finishOption as NativeWorkspaceFinish | undefined;
  if (
    finish !== undefined &&
    finish !== 'merge' &&
    finish !== 'push' &&
    finish !== 'pull-request' &&
    finish !== 'keep'
  ) {
    throw new NativeUsageError('--finish must be merge, push, pull-request, or keep');
  }
  if (dryRun && expectedPreflightHash) {
    throw new NativeUsageError('--dry-run and --expect-preflight cannot be combined');
  }
  if (dryRun && confirmed) {
    throw new NativeUsageError('--confirmed is only valid with --expect-preflight');
  }
  if (!dryRun && finish) {
    throw new NativeUsageError('--finish is only valid with --dry-run');
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
    const initialWorkspace = await readNativeWorkspaceIdentity(paths, name);
    let workspace = initialWorkspace;
    if (initialWorkspace?.schema === 'comet.native.workspace.v3') {
      if (initialWorkspace.isolation === 'current') {
        if (finish) {
          throw new NativeUsageError('Native current isolation does not accept --finish');
        }
      } else if (finish) {
        workspace = await setNativeWorkspaceFinish(paths, name, finish);
      } else if (initialWorkspace.finish === null) {
        throw new NativeUsageError(
          'Native branch and worktree isolation require --finish with --dry-run',
        );
      }
    } else if (finish) {
      throw new NativeUsageError('--finish requires a workspace v3 branch or worktree binding');
    }
    const preview = await inspectNativeArchivePreflight({ paths, name });
    const state = await readNativeChange(paths, name);
    return success(
      'archive --dry-run',
      {
        ...preview,
        workspaceFinish:
          workspace?.schema === 'comet.native.workspace.v3' ? workspace.finish : null,
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
  const workspace = await readNativeWorkspaceIdentity(paths, name);
  if (
    workspace?.schema === 'comet.native.workspace.v3' &&
    workspace.isolation !== 'current' &&
    workspace.finish === null
  ) {
    throw new NativeUsageError(
      'Native branch and worktree isolation require a persisted --finish preview',
    );
  }
  const result = await archiveNativeChange({
    paths,
    name,
    expectedPreflightHash: expectedPreflightHash!,
  });
  return success(
    'archive',
    {
      ...result,
      workspaceFinish: workspace?.schema === 'comet.native.workspace.v3' ? workspace.finish : null,
      continuation: nativeContinuation({ state, done: true }),
    },
    `Archived Native change ${name} to ${result.archiveDir}\n`,
  );
}
