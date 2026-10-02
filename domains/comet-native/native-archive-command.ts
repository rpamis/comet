import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  archiveNativePortableChange,
  hasNativePortableArchiveRecovery,
  inspectNativePortableArchive,
  nativePortableArchiveDirectory,
  NativePortableArchiveOrderRequiredError,
  NativePortableArchiveRequiresReverificationError,
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
  clearNativeWorkspaceFinishJournal,
  finishArchivedNativeWorkspace,
  NATIVE_WORKSPACE_FINISH_JOURNAL_SCHEMA,
  NativeWorkspaceFinishError,
  NativeWorkspaceFinishPreparationError,
  prepareNativePortableWorkspaceFinish,
  prepareNativeWorkspaceFinishMessages,
  validateNativeWorkspaceFinishMessage,
  readNativeWorkspaceFinishJournal,
  readNativeWorkspaceFinishArchive,
  writeNativeWorkspaceFinishJournal,
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

function withArchiveMessageOptions<
  T extends {
    commandArgs?: string[] | null;
    commandAlternatives?: Array<{ commandArgs: string[] | null }>;
  },
>(continuation: T, options: string[]): T {
  if (options.length === 0) return continuation;
  const withOptions = (args: string[]) =>
    args[0] === 'comet' && args[1] === 'native' && args[2] === 'archive'
      ? [...args, ...options]
      : args;
  return {
    ...continuation,
    ...(continuation.commandArgs ? { commandArgs: withOptions(continuation.commandArgs) } : {}),
    ...(continuation.commandAlternatives
      ? {
          commandAlternatives: continuation.commandAlternatives.map((alternative) => ({
            ...alternative,
            commandArgs: alternative.commandArgs ? withOptions(alternative.commandArgs) : null,
          })),
        }
      : {}),
  };
}

export async function nativeArchiveCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const name = requiredPositional(args, 'change name');
  const dryRun = takeFlag(args, '--dry-run');
  const expectedPreflightHash = takeOption(args, '--expect-preflight');
  const confirmed = takeFlag(args, '--confirmed');
  if (dryRun && confirmed)
    throw new NativeUsageError('--confirmed is only valid when executing Archive');
  const finishOption = takeOption(args, '--finish');
  const serialFirstOption = takeOption(args, '--serial-first');
  const commitMessage = takeOption(args, '--commit-message');
  const mergeMessage = takeOption(args, '--merge-message');
  for (const [flag, message] of [
    ['--commit-message', commitMessage],
    ['--merge-message', mergeMessage],
  ] as const) {
    if (message === undefined) continue;
    try {
      validateNativeWorkspaceFinishMessage(message, flag);
    } catch (error) {
      throw new NativeUsageError((error as Error).message);
    }
  }
  const messageOptions = [
    ...(commitMessage === undefined ? [] : ['--commit-message', commitMessage]),
    ...(mergeMessage === undefined ? [] : ['--merge-message', mergeMessage]),
  ];
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
  const finishJournal = await readNativeWorkspaceFinishJournal(configured.paths, name);
  const activeArchiveTransaction = await readNativePortableTransaction(configured.paths, {
    kind: 'archive',
    change: name,
  });
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
  if (
    finishJournal &&
    !portableActive &&
    activeArchiveTransaction?.kind !== 'archive' &&
    (finishJournal.archiveDir || !portableRecoveryAvailable)
  ) {
    if (expectedPreflightHash) {
      throw new NativeUsageError('A recorded workspace finish does not use preflight hashes');
    }
    if (serialFirstOption) {
      throw new NativeUsageError('--serial-first is only valid while archiving an active change');
    }
    if (
      finishOption &&
      (finishJournal.plan?.finish ?? finishJournal.result?.action) &&
      finishOption !== (finishJournal.plan?.finish ?? finishJournal.result?.action)
    ) {
      throw new NativeUsageError(
        `Recorded workspace finish is '${finishJournal.plan?.finish ?? finishJournal.result?.action}'; retry it without changing --finish`,
      );
    }
    if (dryRun) {
      const prepared = finishJournal.plan
        ? await prepareNativeWorkspaceFinishMessages({
            name,
            plan: finishJournal.plan,
            journal: finishJournal,
            commitMessage,
            mergeMessage,
          })
        : null;
      return {
        command: 'archive --dry-run',
        exitCode: 73,
        data: {
          change: name,
          archived: true,
          workspaceFinishResult: finishJournal.result,
          commitMessages: {
            commitMessage:
              commitMessage ?? prepared?.commitMessage ?? `chore(native): archive ${name}`,
            mergeMessage: mergeMessage ?? prepared?.mergeMessage ?? null,
          },
          recovery: [
            ...(finishJournal.result?.recoveryArgs ?? [
              'comet',
              'native',
              'archive',
              name,
              '--confirmed',
            ]),
            ...messageOptions,
            ...(prepared?.mergeMessage && mergeMessage === undefined
              ? ['--merge-message', prepared.mergeMessage]
              : []),
          ],
        },
        error: {
          code: 'conflict',
          message: finishJournal.result?.message ?? 'Native workspace finish is still pending',
        },
      };
    }
    if (!confirmed) {
      throw new NativeUsageError(
        'Native workspace finish is pending; rerun Archive with --confirmed after resolving the blocker',
      );
    }
    assertNoArguments(args);
    const archivedRecord = await readNativeWorkspaceFinishArchive(configured.paths, finishJournal);
    const archiveDir = finishJournal.archiveDir!;
    let finishPlan;
    try {
      finishPlan = await prepareNativePortableWorkspaceFinish({
        paths: configured.paths,
        state: archivedRecord.state,
        archiveDir,
        pullRequestFinish: configured.config.native.finish?.pull_request,
      });
      if (finishPlan)
        finishPlan = await prepareNativeWorkspaceFinishMessages({
          name,
          plan: finishPlan,
          journal: finishJournal,
          commitMessage,
          mergeMessage,
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const blockedResult = {
        ...(finishJournal.result ?? {
          action: archivedRecord.state.workspace.finish ?? ('keep' as const),
          commit: null,
          remote: null,
          pushed: false,
          pullRequestUrl: null,
          pullRequest: null,
          merged: false,
          targetRoot: null,
          cleanup: { performed: false, reason: null },
          blockedPaths: [],
          diagnosticArgs: null,
          recoveryArgs: null,
        }),
        status: 'blocked' as const,
        message,
        recoveryArgs: ['comet', 'native', 'archive', name, '--confirmed'],
      };
      await writeNativeWorkspaceFinishJournal(configured.paths, {
        ...finishJournal,
        status: 'blocked',
        result: blockedResult,
        updatedAt: new Date().toISOString(),
      });
      return {
        command: 'archive',
        exitCode: 73,
        data: {
          archived: true,
          state: archivedRecord.state,
          archiveDir,
          workspaceFinish: archivedRecord.state.workspace.finish,
          workspaceFinishResult: blockedResult,
          continuation: {
            disposition: 'blocked',
            reason: message,
            commandArgs: blockedResult.recoveryArgs,
            inputOptions: [],
            runnerAction: null,
          },
        },
        error: { code: 'conflict', message },
      };
    }
    if (finishPlan) {
      await writeNativeWorkspaceFinishJournal(configured.paths, {
        ...finishJournal,
        plan: finishPlan,
        updatedAt: new Date().toISOString(),
      });
      try {
        const workspaceFinishResult = await finishArchivedNativeWorkspace({
          paths: configured.paths,
          state: archivedRecord.state,
          name,
          archiveDir,
          transactionId: finishJournal.transactionId,
          plan: finishPlan,
        });
        await clearNativeWorkspaceFinishJournal(configured.paths, name);
        return success(
          'archive',
          {
            archived: true,
            state: archivedRecord.state,
            archiveDir,
            workspaceFinish: archivedRecord.state.workspace.finish,
            workspaceFinishResult,
            continuation: nativePortableContinuation(archivedRecord.state),
          },
          `Completed pending workspace finish for Native change ${name}\n`,
        );
      } catch (error) {
        if (!(error instanceof NativeWorkspaceFinishError)) throw error;
        await writeNativeWorkspaceFinishJournal(configured.paths, {
          ...((await readNativeWorkspaceFinishJournal(configured.paths, name)) ?? finishJournal),
          status: 'blocked',
          result: error.result,
          updatedAt: new Date().toISOString(),
        });
        return {
          command: 'archive',
          exitCode: 73,
          data: {
            archived: true,
            state: archivedRecord.state,
            archiveDir,
            workspaceFinish: archivedRecord.state.workspace.finish,
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
    await clearNativeWorkspaceFinishJournal(configured.paths, name);
    return success(
      'archive',
      {
        archived: true,
        state: archivedRecord.state,
        archiveDir,
        workspaceFinish: archivedRecord.state.workspace.finish,
        workspaceFinishResult: null,
        continuation: nativePortableContinuation(archivedRecord.state),
      },
      `Native change ${name} is already archived\n`,
    );
  }
  if (portableActive || portableRecoveryAvailable || finishJournal) {
    if (expectedPreflightHash) {
      throw new NativeUsageError('Portable Native Archive does not use preflight hashes');
    }
    if (dryRun && confirmed) {
      throw new NativeUsageError('--confirmed is only valid when executing Archive');
    }
    if (serialFirstOption && serialFirstOption !== name) {
      throw new NativeUsageError('--serial-first must name the change being archived');
    }
    if (!dryRun && finish && !confirmed) {
      throw new NativeUsageError('--finish without --dry-run requires --confirmed');
    }
    assertNoArguments(args);
    const recovery =
      portableActive && !dryRun && activeArchiveTransaction?.kind !== 'archive'
        ? await recoverNativePortableChange({ paths: configured.paths, name })
        : null;
    let state =
      recovery?.state ??
      (portableActive ? await readNativePortableChange(configured.paths, name) : null);
    if (mergeMessage !== undefined && state && (finish ?? state.workspace.finish) !== 'merge') {
      throw new NativeUsageError('--merge-message requires a merge workspace finish');
    }
    if (
      !dryRun &&
      confirmed &&
      finish &&
      state &&
      state.workspace.isolation !== 'current' &&
      state.workspace.finish === null
    ) {
      // One-step archive after a finish decision: record the choice first, then
      // the single preflight + in-transaction freshness recheck run. This replaces
      // the mandatory second full dry-run, which repeated the same snapshot fence
      // the transaction already revalidates.
      state = await setNativePortableWorkspaceFinish({ paths: configured.paths, name, finish });
    }
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
              commandArgs: ['comet', 'native', 'archive', name, '--confirmed', ...messageOptions],
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
      if (preview.requiresReverification) {
        return success(
          'archive --dry-run',
          {
            ...preview,
            archived: false,
            ready: false,
            state,
            blockers: preview.blockers,
            recovery: {
              action: 'reverify',
              reason: 'stale',
              message:
                'The canonical Spec changed independently; the portable change returned to Verify and must be checked again after delta remerge.',
            },
            continuation: nativePortableContinuation(state),
          },
          'Native Archive preview requires fresh verification after delta remerge; no rebase was written during dry-run\n',
        );
      }
      const capabilityBlockerPrefix = 'capabilities are also declared by:';
      const blockers = preview.blockers.filter(
        (blocker) => !blocker.startsWith(capabilityBlockerPrefix),
      );
      const workspaceFinishBlockers: Array<{
        message: string;
        paths: string[];
        workspaceRoot: string;
      }> = [];
      let previewFinishPlan = null;
      const finishRequired =
        state.workspace.isolation !== 'current' && state.workspace.finish === null;
      if (finishRequired) {
        blockers.push('Native branch and worktree isolation require a workspace finish choice');
      }
      if (!finishRequired) {
        try {
          previewFinishPlan = await prepareNativePortableWorkspaceFinish({
            paths: configured.paths,
            state,
            appliedSpecChanges,
            pullRequestFinish: configured.config.native.finish?.pull_request,
          });
          if (previewFinishPlan)
            previewFinishPlan = await prepareNativeWorkspaceFinishMessages({
              name,
              plan: previewFinishPlan,
              journal: finishJournal,
              commitMessage,
              mergeMessage,
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
          commitMessages: previewFinishPlan
            ? {
                commitMessage: previewFinishPlan.commitMessage,
                mergeMessage: previewFinishPlan.mergeMessage,
              }
            : null,
          continuation: withArchiveMessageOptions(
            serialFirstOption === name && continuation.commandArgs
              ? {
                  ...continuation,
                  commandArgs: [...continuation.commandArgs, '--serial-first', name],
                }
              : continuation,
            previewFinishPlan?.mergeMessage && mergeMessage === undefined
              ? [...messageOptions, '--merge-message', previewFinishPlan.mergeMessage]
              : messageOptions,
          ),
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
          continuation: withArchiveMessageOptions(continuation, messageOptions),
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
        if (finishPlan)
          finishPlan = await prepareNativeWorkspaceFinishMessages({
            name,
            plan: finishPlan,
            journal: finishJournal,
            commitMessage,
            mergeMessage,
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
          diagnosticArgs: ['git', '-C', workspaceRoot, 'status', '--short'],
          recoveryArgs: ['comet', 'native', 'archive', name, '--confirmed'],
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
    let finishJournalWritten = false;
    if (finishPlan) {
      await writeNativeWorkspaceFinishJournal(configured.paths, {
        ...finishJournal,
        schema: NATIVE_WORKSPACE_FINISH_JOURNAL_SCHEMA,
        name,
        transactionId:
          finishJournal?.transactionId ??
          (activeArchiveTransaction?.kind === 'archive'
            ? activeArchiveTransaction.journal.id
            : undefined) ??
          randomUUID(),
        archiveDir:
          finishJournal?.archiveDir ??
          (state ? nativePortableArchiveDirectory(configured.paths, state) : null),
        ...(state ? { createdAt: state.created_at } : {}),
        status: 'pending',
        result: null,
        updatedAt: new Date().toISOString(),
        plan: finishPlan,
      });
      finishJournalWritten = true;
    }
    let result;
    try {
      result = await archiveNativePortableChange({
        paths: configured.paths,
        name,
        ...(serialFirstOption ? { serialFirstChange: serialFirstOption } : {}),
      });
    } catch (error) {
      if (error instanceof NativePortableArchiveRequiresReverificationError) {
        // The archive did not complete and the change remains active. The
        // finish journal is only a post-Archive transaction fence; retaining
        // it here would later masquerade as an orphaned completed Archive if
        // the user revises requirements or abandons this attempt.
        if (finishJournalWritten || finishJournal) {
          await clearNativeWorkspaceFinishJournal(configured.paths, name);
        }
        return success(
          'archive',
          {
            archived: false,
            state: error.state,
            recovery: {
              action: 'reverify',
              reason: 'stale',
              message:
                'The canonical Spec changed independently; the portable change returned to Verify and must be checked again after delta remerge.',
            },
            continuation: nativePortableContinuation(error.state),
          },
          'Native Archive requires fresh verification after delta remerge\n',
        );
      }
      if (!(error instanceof NativePortableArchiveOrderRequiredError)) throw error;
      if (finishJournalWritten || finishJournal) {
        await clearNativeWorkspaceFinishJournal(configured.paths, name);
      }
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
            commandArgs: [...commandArgs, ...messageOptions],
            inputOptions: error.peers.length > 0 ? ['serial-first-change'] : [],
            runnerAction: null,
          },
        },
        error: { code: 'conflict', message: error.message },
      };
    }
    state = result.state;
    if (!finishPlan && state) {
      try {
        finishPlan = await prepareNativePortableWorkspaceFinish({
          paths: configured.paths,
          state,
          archiveDir: result.archiveDir,
          pullRequestFinish: configured.config.native.finish?.pull_request,
        });
        if (finishPlan)
          finishPlan = await prepareNativeWorkspaceFinishMessages({
            name,
            plan: finishPlan,
            journal: finishJournal,
            commitMessage,
            mergeMessage,
          });
      } catch (error) {
        // Archive has already committed the sealed record.  Preparation can
        // still fail because the workspace changed between the preflight and
        // the archive transaction; persist the post-Archive recovery fence so
        // the completed change is never left without a resumable finish path.
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
          diagnosticArgs: ['git', '-C', workspaceRoot, 'status', '--short'],
          recoveryArgs: ['comet', 'native', 'archive', name, '--confirmed'],
        };
        await writeNativeWorkspaceFinishJournal(configured.paths, {
          schema: NATIVE_WORKSPACE_FINISH_JOURNAL_SCHEMA,
          name,
          transactionId: result.transactionId,
          archiveDir: result.archiveDir,
          status: 'blocked',
          result: workspaceFinishResult,
          updatedAt: new Date().toISOString(),
        });
        return {
          command: 'archive',
          exitCode: 73,
          data: {
            ...result,
            workspaceFinish: state.workspace.finish,
            workspaceFinishResult,
            continuation: {
              disposition: 'blocked',
              reason: message,
              commandArgs: workspaceFinishResult.recoveryArgs,
              inputOptions: [],
              runnerAction: null,
            },
          },
          error: { code: 'conflict', message },
        };
      }
    }
    if (finishPlan) {
      await writeNativeWorkspaceFinishJournal(configured.paths, {
        ...(await readNativeWorkspaceFinishJournal(configured.paths, name)),
        schema: NATIVE_WORKSPACE_FINISH_JOURNAL_SCHEMA,
        name,
        transactionId: result.transactionId,
        archiveDir: result.archiveDir,
        status: 'pending',
        result: null,
        updatedAt: new Date().toISOString(),
        plan: finishPlan,
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
        await writeNativeWorkspaceFinishJournal(configured.paths, {
          ...(await readNativeWorkspaceFinishJournal(configured.paths, name)),
          schema: NATIVE_WORKSPACE_FINISH_JOURNAL_SCHEMA,
          name,
          transactionId: result.transactionId,
          archiveDir: result.archiveDir,
          status: 'blocked',
          result: error.result,
          updatedAt: new Date().toISOString(),
        });
        return {
          command: 'archive',
          exitCode: 73,
          data: {
            ...result,
            archived: true,
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
    if (finishPlan) await clearNativeWorkspaceFinishJournal(configured.paths, name);
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
        archived: true,
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
  if (!dryRun && finish && !confirmed) {
    throw new NativeUsageError('--finish without --dry-run requires --confirmed');
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
