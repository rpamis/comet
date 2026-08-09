import {
  archiveNativePortableChange,
  hasNativePortableArchiveRecovery,
  inspectNativePortableArchive,
  NativePortableArchiveOrderRequiredError,
} from './native-portable-archive.js';
import { nativePortableContinuation } from './native-portable-continuation.js';
import { migrateNativeLegacyChangeToPortable } from './native-portable-migration-runtime.js';
import { recoverNativePortableChange } from './native-portable-recovery.js';
import { readNativePortableTransaction } from './native-portable-transactions.js';
import {
  isNativePortableChange,
  readNativePortableChange,
  setNativePortableWorkspaceFinish,
} from './native-portable-runtime.js';
import type { NativeWorkspaceFinish } from './native-workspace.js';
import {
  finishArchivedNativeWorkspace,
  NativeWorkspaceFinishError,
  prepareNativePortableWorkspaceFinish,
} from './native-workspace-finish.js';
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
  const serialFirstOption = takeOption(args, '--serial-first');
  if (
    serialFirstOption !== undefined &&
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(serialFirstOption)
  ) {
    throw new NativeUsageError('--serial-first must be one Native change name');
  }
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
  const configured = await configuredPaths(projectRoot);
  const portableActive = await isNativePortableChange(configured.paths, name);
  const activeArchiveTransaction = portableActive
    ? await readNativePortableTransaction(configured.paths, { kind: 'archive', change: name })
    : null;
  const portableRecoveryAvailable = portableActive
    ? false
    : await hasNativePortableArchiveRecovery(configured.paths, name);
  if (portableActive || portableRecoveryAvailable) {
    if (expectedPreflightHash) {
      throw new NativeUsageError('Portable Native Archive does not use preflight hashes');
    }
    if (dryRun && confirmed) {
      throw new NativeUsageError('--confirmed is only valid when executing Archive');
    }
    if (dryRun && serialFirstOption) {
      throw new NativeUsageError('--serial-first is only valid when executing Archive');
    }
    if (!dryRun && finish) {
      throw new NativeUsageError('--finish is only valid with --dry-run');
    }
    assertNoArguments(args);
    const recovery =
      portableActive && !dryRun && activeArchiveTransaction?.kind !== 'archive'
        ? await recoverNativePortableChange({ paths: configured.paths, name })
        : null;
    let state =
      recovery?.state ??
      (portableActive ? await readNativePortableChange(configured.paths, name) : null);
    if (recovery?.action === 'reverify' || recovery?.action === 'await-user') {
      return success(
        dryRun ? 'archive --dry-run' : 'archive',
        {
          archived: false,
          state: recovery.state,
          recovery,
          continuation: nativePortableContinuation(recovery.state),
        },
        `${recovery.message}\n`,
      );
    }
    if (dryRun) {
      if (!state) {
        return success(
          'archive --dry-run',
          {
            change: name,
            ready: true,
            archiveRecovery: true,
            continuation: {
              disposition: 'continue',
              reason: 'Resume the interrupted Native Archive transaction.',
              commandArgs: ['comet', 'native', 'archive', name, '--confirmed'],
              inputOptions: [],
              runnerAction: null,
            },
          },
          `Native Archive recovery is ready for ${name}\n`,
        );
      }
      if (finish) {
        state = await setNativePortableWorkspaceFinish({
          paths: configured.paths,
          name,
          finish,
        });
      } else if (state.workspace.isolation !== 'current' && state.workspace.finish === null) {
        throw new NativeUsageError(
          'Native branch and worktree isolation require --finish with --dry-run',
        );
      }
      const preview = await inspectNativePortableArchive({ paths: configured.paths, name });
      const baseContinuation = nativePortableContinuation(state);
      const continuation =
        preview.capabilityPeers.length > 0
          ? {
              ...baseContinuation,
              disposition: 'await-user' as const,
              action: 'none' as const,
              commandArgs: null,
              requiredInputs: ['choose-first-archive'],
              runnerAction: { ...baseContinuation.runnerAction, kind: 'none' as const },
            }
          : baseContinuation;
      return success(
        'archive --dry-run',
        {
          ...preview,
          workspaceFinish: state.workspace.finish,
          continuation,
        },
        `Native Archive preview: ${preview.ready ? 'ready' : 'blocked'}\n`,
      );
    }
    if (configured.config.native.archive_confirmation === 'required' && !confirmed) {
      throw new NativeUsageError(
        'archive requires --confirmed when native.archive_confirmation is required',
      );
    }
    if (state && state.workspace.isolation !== 'current' && state.workspace.finish === null) {
      throw new NativeUsageError(
        'Native branch and worktree isolation require a persisted --finish preview',
      );
    }
    let finishPlan = state
      ? await prepareNativePortableWorkspaceFinish({
          paths: configured.paths,
          state,
        })
      : null;
    let result;
    try {
      result = await archiveNativePortableChange({
        paths: configured.paths,
        name,
        ...(serialFirstOption ? { serialFirstChange: serialFirstOption } : {}),
      });
    } catch (error) {
      if (!(error instanceof NativePortableArchiveOrderRequiredError)) throw error;
      if (!state) throw error;
      const preview = await inspectNativePortableArchive({ paths: configured.paths, name });
      const commandArgs =
        error.peers.length > 0
          ? ['comet', 'native', 'archive', name, '--confirmed', '--serial-first', name]
          : ['comet', 'native', 'archive', name, '--confirmed'];
      return {
        command: 'archive',
        exitCode: 73,
        data: {
          ...preview,
          workspaceFinish: state.workspace.finish,
          workspaceFinishResult: null,
          continuation: {
            disposition: 'await-user',
            reason: error.message,
            commandArgs,
            inputOptions: error.peers.length > 0 ? ['serial-first-change'] : [],
            runnerAction: null,
          },
        },
        error: { code: 'conflict', message: error.message },
      };
    }
    state = result.state;
    if (!finishPlan && state.workspace.isolation !== 'current') {
      finishPlan = await prepareNativePortableWorkspaceFinish({
        paths: configured.paths,
        state,
        archiveDir: result.archiveDir,
      });
    }
    let workspaceFinishResult = null;
    if (finishPlan) {
      try {
        workspaceFinishResult = await finishArchivedNativeWorkspace({
          paths: configured.paths,
          state: result.state,
          name,
          archiveDir: result.archiveDir,
          transactionId: result.transactionId,
          plan: finishPlan,
        });
      } catch (error) {
        if (!(error instanceof NativeWorkspaceFinishError)) throw error;
        return {
          command: 'archive',
          exitCode: 73,
          data: {
            ...result,
            workspaceFinish: result.state.workspace.finish,
            workspaceFinishResult: error.result,
            continuation: {
              disposition: 'blocked',
              reason: error.message,
              commandArgs: error.result.recoveryArgs,
              inputOptions: [],
              runnerAction: null,
            },
          },
          error: { code: 'conflict', message: error.message },
        };
      }
    }
    return success(
      'archive',
      {
        ...result,
        workspaceFinish: result.state.workspace.finish,
        workspaceFinishResult,
        continuation: nativePortableContinuation(result.state),
      },
      `Archived Native change ${name} to ${result.archiveDir}\n`,
    );
  }
  if (serialFirstOption) {
    throw new NativeUsageError('--serial-first is only valid for portable Native changes');
  }
  if (!dryRun && finish) {
    throw new NativeUsageError('--finish is only valid with --dry-run');
  }
  assertNoArguments(args);
  if (dryRun) {
    return {
      command: 'archive --dry-run',
      exitCode: 65,
      data: {
        change: name,
        migrationRequired: true,
        repairCommand: `comet native doctor ${name} --repair`,
      },
      error: {
        code: 'invalid-data',
        message: `Native active change ${name} must migrate before Archive preview`,
      },
    };
  }
  const state = await migrateNativeLegacyChangeToPortable({
    paths: configured.paths,
    name,
  });
  return success(
    'archive',
    {
      migration: { from: 'legacy', to: state.schema, completed: true },
      state,
      continuation: nativePortableContinuation(state),
    },
    `Migrated Native change ${name}; follow the returned portable continuation before Archive\n`,
  );
}
