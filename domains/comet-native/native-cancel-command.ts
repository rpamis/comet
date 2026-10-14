import { randomUUID } from 'node:crypto';

import { readCometCurrentSelection } from '../workflow-contract/current-selection.js';
import { inspectNativeSdkCancellation } from './native-sdk-cancellation.js';
import { inspectNativeSdkCheckExecutions } from './native-sdk-check-execution.js';
import { inspectNativeSdkRun, loadOwnedNativeSdkRuntime } from './native-runtime-ownership.js';
import {
  assertNoArguments,
  NativeUsageError,
  success,
  takeFlag,
  takeOption,
  type DispatchResult,
} from './native-cli-shared.js';

const DEFAULT_CANCEL_REASON = 'Cancelled by the user without completing the change';

/**
 * Cancel an unfinished SDK Native change without verifying or archiving it.
 * Business code, commits, and the workspace are retained; the Runtime stops
 * dispatching, managed check executions are terminated, and the current
 * selection is released once the original executions are quiet.
 */
export async function nativeCancelCommand(
  args: string[],
  projectRoot: string,
): Promise<DispatchResult> {
  const name = args.shift();
  if (!name || name.startsWith('--')) throw new NativeUsageError('cancel requires a change name');
  const reason = takeOption(args, '--reason') ?? DEFAULT_CANCEL_REASON;
  const dryRun = takeFlag(args, '--dry-run');
  assertNoArguments(args);

  let inspection: Awaited<ReturnType<typeof inspectNativeSdkRun>>;
  try {
    inspection = await inspectNativeSdkRun(projectRoot, name);
  } catch (error) {
    throw new Error(
      `Native change ${name} is not owned by an SDK Run. Cancellation applies to SDK Native changes; legacy 0.4 runtime changes keep their original lifecycle, and unknown names cannot be cancelled. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const { run, state } = inspection;

  if (run.status === 'completed') {
    throw new Error(
      `Native change ${name} is completed; use comet native archive instead of cancelling it`,
    );
  }

  const alreadyCancelled = run.status === 'cancelled';
  if (alreadyCancelled) {
    const cancellation = await inspectNativeSdkCancellation({ projectRoot, run });
    return success(
      'cancel',
      {
        change: name,
        runId: run.runId,
        alreadyCancelled: true,
        cancelled: true,
        status: cancellation?.status ?? 'cancelled',
        reason: run.reason ?? null,
        codeRetained: true,
        workspaceRetained: true,
        cancellation,
      },
      `Native change ${name} is already cancelled. Existing code, history, and receipts are retained. Follow the outstanding acknowledgements in cancellation if any remain.\n`,
    );
  }

  const executions = await inspectNativeSdkCheckExecutions({ projectRoot, run });
  const activeExecutions = executions.filter((execution) => !execution.quiescent);
  const pendingAcknowledgements = run.actions
    .filter((action) => ['running', 'unknown'].includes(action.status))
    .map((action) => ({
      actionId: action.id,
      stepId: action.stepId,
      attempt: action.attempt,
      status: action.status,
      note: 'The original host must confirm this execution and its child tasks stopped after cancellation',
    }));
  const selected = await readCometCurrentSelection(projectRoot);
  const selectionTargetsChange =
    selected.status === 'selected' && selected.selection.change === run.runId;

  if (dryRun) {
    return success(
      'cancel',
      {
        change: name,
        runId: run.runId,
        dryRun: true,
        willCancel: true,
        phase: state.phase,
        status: state.status,
        stateVersion: state.state_version,
        reason,
        managedExecutions: activeExecutions,
        pendingAcknowledgements,
        selectionRelease: { currentlySelected: selectionTargetsChange },
        retained: { code: true, commits: true, workspace: true, branches: true },
      },
      `Dry-run: cancelling Native change ${name} keeps all code, commits, branches, and its workspace; the Run stops dispatching, ${activeExecutions.length} managed check execution(s) are terminated, and the current selection ${selectionTargetsChange ? 'is released' : 'is untouched'}.\n`,
    );
  }

  const { runtime } = await loadOwnedNativeSdkRuntime(projectRoot, name);
  const cancelled = await runtime.cancel({
    runId: run.runId,
    expectedRevision: run.revision,
    reason,
    context: { requestId: randomUUID(), projectRoot },
  });
  // The state-store hook settles the cancellation: managed executions stop and
  // the current selection is released once the original executions are quiet.
  const cancellation = await inspectNativeSdkCancellation({ projectRoot, run: cancelled });
  return success(
    'cancel',
    {
      change: name,
      runId: cancelled.runId,
      cancelled: true,
      status: cancellation?.status ?? 'cancelled',
      reason,
      codeRetained: true,
      workspaceRetained: true,
      cancellation,
      ...(cancellation && !cancellation.quiescent
        ? { nextCommand: 'comet native next ' + name + ' --json' }
        : {}),
    },
    `Cancelled Native change ${name}. Code, commits, branches, and the workspace are retained; the change no longer counts as active once its outstanding acknowledgements are settled.\n`,
  );
}
