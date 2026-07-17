import { continueNativeCheckpointLocked } from './native-checkpoint-journal.js';
import { continueNativeTransitionLocked } from './native-transition-journal.js';
import type { NativeProjectPaths } from './native-types.js';

/**
 * Settles every change-local write-ahead journal before a new state mutation.
 *
 * The caller must hold the project mutation lock and the change transition
 * lock. Transition recovery remains first for compatibility with the existing
 * phase WAL; a pending progress checkpoint is then completed before the caller
 * reads the revision it intends to mutate.
 */
export async function settleNativeChangeJournalsLocked(
  paths: NativeProjectPaths,
  name: string,
): Promise<void> {
  await continueNativeTransitionLocked(paths, name);
  await continueNativeCheckpointLocked(paths, name);
}
