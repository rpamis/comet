import { settleNativeChangeJournalsLocked } from './native-change-recovery.js';
import { readNativeChange } from './native-change.js';
import { executeNativeCheckReceipt, type NativeCheckReceipt } from './native-check-receipt.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { withNativeTransitionLock } from './native-transition-journal.js';
import type { NativeChangeState, NativeProjectPaths } from './native-types.js';
import {
  findNativeReusableRequiredCheckReceipt,
  persistNativeStaticInspectionReceipt,
} from './native-verification-receipt-runtime.js';

export interface NativeCheckResult {
  change: NativeChangeState;
  receipt: NativeCheckReceipt;
  checkRef: string;
  ref: string;
}

/**
 * Run the one built-in, read-only Native check without advancing workflow state.
 *
 * Journal recovery and the state read happen under the same lock pair as transitions. The receipt
 * is independent evidence: this function deliberately writes no state, run, or trajectory record.
 */
export async function checkNativeChange(options: {
  paths: NativeProjectPaths;
  name: string;
}): Promise<NativeCheckResult> {
  return withNativeMutationLock(options.paths, `check ${options.name}`, () =>
    withNativeTransitionLock(options.paths, options.name, `check ${options.name}`, () =>
      checkNativeChangeLocked(options),
    ),
  );
}

/** Run the check while the caller already owns Native's mutation and transition locks. */
export async function checkNativeChangeLocked(options: {
  paths: NativeProjectPaths;
  name: string;
}): Promise<NativeCheckResult> {
  await settleNativeChangeJournalsLocked(options.paths, options.name);
  const state = await readNativeChange(options.paths, options.name);
  if (state.phase !== 'verify') throw new Error(`Native check requires Verify, got ${state.phase}`);
  if (!state.implementation_scope) throw new Error('Native check requires an implementation scope');
  const reusable = await findNativeReusableRequiredCheckReceipt({
    paths: options.paths,
    state,
  });
  if (reusable) {
    return {
      change: state,
      receipt: reusable.checkReceipt,
      checkRef: reusable.checkReceiptRef,
      ref: reusable.ref,
    };
  }
  const executed = await executeNativeCheckReceipt({ paths: options.paths, state });
  const typed = await persistNativeStaticInspectionReceipt({
    paths: options.paths,
    state,
    checkReceipt: executed.receipt,
    checkReceiptRef: executed.ref,
  });
  return {
    change: state,
    receipt: executed.receipt,
    checkRef: executed.ref,
    ref: typed.ref,
  };
}
