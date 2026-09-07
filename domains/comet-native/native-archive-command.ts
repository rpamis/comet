import path from 'node:path';
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
  tryAutoAdvanceNativeV1SupervisorParent,
} from './native-portable-runtime.js';
import type { NativeWorkspaceFinish } from './native-workspace.js';
import {
  finishArchivedNativeWorkspace,
  NativeWorkspaceFinishError,
  NativeWorkspaceFinishPreparationError,
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
  const appliedSpecChanges =
    activeArchiveTransaction?.kind === 'archive'
      ? activeArchiveTransaction.journal.spec_changes.slice(
          0,
          activeArchiveTransaction.journal.next_spec_index,
        )
      : [];
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
    if (serialFirstOption && serialFirstOption !== name) {
      throw new NativeUsageError('--serial-first must name the change being archived');
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
      }
      const preview = await inspectNativePortableArchive({ paths: configured.paths, name });
      const capabilityBlockerPrefix = 'capabilities are also declared by:';
      const blockers = preview.blockers.filter(
        (blocker) => !blocker.startsWith(capabilityBlockerPrefix),
      );
      const workspaceFinishBlockers: Array<{
        message: string;
        paths: string[];
        workspaceRoot: string;
      }> = [];
      const finishRequired =
        state.workspace.isolation !== 'current' && state.workspace.finish === null;
      if (finishRequired) {
        blockers.push('Native branch and worktree isolation require a workspace finish choice');
      }
      if (!finishRequired) {
        try {
          await prepareNativePortableWorkspaceFinish({
            paths: configured.paths,
            state,
            appliedSpecChanges,
            pullRequestFinish: configured.config.native.finish?.pull_request,
          });
        } catch (error) {
          const message = (error as Error).message;
          blockers.push(message);
          workspaceFinishBlockers.push({
            message,
            paths: error instanceof NativeWorkspaceFinishPreparationError ? error.paths : [],
            workspaceRoot:
              error instanceof NativeWorkspaceFinishPreparationError
                ? error.workspaceRoot
                : configured.paths.projectRoot,
          });
        }
      }
      const orderRequired = preview.capabilityPeers.length > 0 && serialFirstOption !== name;
      const previewContinuation =
        orderRequired && blockers.length === 0
          ? nativePortableContinuation(state, null, { archiveMode: 'preview' })
          : null;
      const continuation = previewContinuation
        ? {
            ...previewContinuation,
            disposition: 'await-user' as const,
            action: 'none' as const,
            commandArgs: null,
            requiredInputs: ['choose-first-archive'],
            requiresUserDecision: true,
            userCommunication: {
              required: true,
              message:
                state.language === 'zh-CN'
                  ? `当前规格也由 ${preview.capabilityPeers.join(', ')} 修改。是否先归档 ${name}？其他 change 随后需要对齐最新规格。`
                  : `The same specifications are changed by ${preview.capabilityPeers.join(', ')}. Archive ${name} first? The other changes must then align with the latest specifications.`,
              suggestedReply:
                state.language === 'zh-CN' ? `先归档 ${name}` : `Archive ${name} first`,
              agentInstruction:
                'Wait for the ordering decision, then execute the matching dry-run commandAlternative.',
            },
            commandAlternatives: [
              {
                name: 'archive-this-change-first',
                commandArgs: [
                  'comet',
                  'native',
                  'archive',
                  name,
                  '--dry-run',
                  '--serial-first',
                  name,
                ],
                description: `Archive ${name} before ${preview.capabilityPeers.join(', ')}`,
                inputOptions: [],
                requiredInputs: [],
              },
            ],
            runnerAction: { ...previewContinuation.runnerAction, kind: 'none' as const },
          }
        : finishRequired
          ? nativePortableContinuation(state)
          : nativePortableContinuation(state, null, {
              archiveMode: 'preview',
              archiveBlockers: blockers,
            });
      const allBlockers = [
        ...blockers,
        ...(orderRequired
          ? [`${capabilityBlockerPrefix} ${preview.capabilityPeers.join(', ')}`]
          : []),
      ];
      return success(
        'archive --dry-run',
        {
          ...preview,
          ready: allBlockers.length === 0,
          blockers: allBlockers,
          ...(workspaceFinishBlockers.length > 0 ? { workspaceFinishBlockers } : {}),
          workspaceFinish: state.workspace.finish,
          continuation:
            serialFirstOption === name && continuation.commandArgs
              ? {
                  ...continuation,
                  commandArgs: [...continuation.commandArgs, '--serial-first', name],
                }
              : continuation,
        },
        `Native Archive preview: ${allBlockers.length === 0 ? 'ready' : 'blocked'}\n`,
      );
    }
    if (configured.config.native.archive_confirmation === 'required' && !confirmed) {
      throw new NativeUsageError(
        'archive requires --confirmed when native.archive_confirmation is required',
      );
    }
    if (state && state.workspace.isolation !== 'current' && state.workspace.finish === null) {
      const continuation = nativePortableContinuation(state);
      return {
        command: 'archive',
        exitCode: 65,
        data: {
          change: name,
          archived: false,
          workspaceFinish: null,
          continuation,
        },
        error: {
          code: 'usage',
          message:
            'Native branch and worktree isolation require a workspace finish choice; follow continuation.commandAlternatives and run its dry-run command',
        },
      };
    }
    let finishPlan = null;
    if (state) {
      try {
        finishPlan = await prepareNativePortableWorkspaceFinish({
          paths: configured.paths,
          state,
          appliedSpecChanges,
          pullRequestFinish: configured.config.native.finish?.pull_request,
        });
      } catch (error) {
        const message = (error as Error).message;
        const blockedPaths =
          error instanceof NativeWorkspaceFinishPreparationError ? error.paths : [];
        const workspaceRoot =
          error instanceof NativeWorkspaceFinishPreparationError
            ? error.workspaceRoot
            : configured.paths.projectRoot;
        const workspaceFinishResult = {
          action: state.workspace.finish ?? 'keep',
          status: 'blocked' as const,
          commit: null,
          remote: null,
          pushed: false,
          pullRequestUrl: null,
          pullRequest: null,
          merged: false,
          targetRoot: workspaceRoot,
          cleanup: { performed: false, reason: null },
          blockedPaths,
          message,
          recoveryArgs: ['git', '-C', workspaceRoot, 'status', '--short'],
        };
        return {
          command: 'archive',
          exitCode: 73,
          data: {
            change: name,
            archived: false,
            state,
            workspaceFinish: state.workspace.finish,
            workspaceFinishResult,
            continuation: nativePortableContinuation(state, null, {
              archiveMode: 'blocked',
              archiveBlockers: [message],
            }),
          },
          error: { code: 'conflict', message },
        };
      }
    }
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
    if (!finishPlan && state) {
      finishPlan = await prepareNativePortableWorkspaceFinish({
        paths: configured.paths,
        state,
        archiveDir: result.archiveDir,
        pullRequestFinish: configured.config.native.finish?.pull_request,
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
    const parentAdvance =
      workspaceFinishResult?.merged === true
        ? await tryAutoAdvanceNativeV1SupervisorParent({
            childPaths: configured.paths,
            childState: result.state,
          })
        : null;
    return success(
      'archive',
      {
        ...result,
        artifactRefs: [
          'brief.md',
          ...(result.state.verification_report ? [result.state.verification_report] : []),
        ].map((source) =>
          path.relative(projectRoot, path.join(result.archiveDir, source)).replaceAll('\\', '/'),
        ),
        workspaceFinish: result.state.workspace.finish,
        workspaceFinishResult,
        ...(parentAdvance ? { parentAdvance: parentAdvance.parentAdvance } : {}),
        ...(parentAdvance?.parentState ? { parentState: parentAdvance.parentState } : {}),
        continuation: nativePortableContinuation(parentAdvance?.parentState ?? result.state),
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
