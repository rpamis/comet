import type { RuntimeWait, WorkflowRun } from '../engine/runtime.js';
import type { NativePortableState } from './native-portable-types.js';

export type NativeSdkVerifyDecisionAction =
  'accept-result' | 'revise-implementation' | 'retry-verifier' | 'resolve-verifier-blocker';

/** CLI、continuation 和转移共用同一状态/Wait 契约，不能展示当前不可执行的决定。 */
export function nativeSdkVerifyWaitDecisions(
  state: NativePortableState,
  wait: Pick<RuntimeWait, 'stepId' | 'choices'>,
): { action: NativeSdkVerifyDecisionAction; choice: string }[] {
  if (state.phase !== 'verify') return [];
  const decisions: { action: NativeSdkVerifyDecisionAction; choice: string }[] = [];
  if (state.status === 'await-user') {
    if (
      wait.stepId === 'verify.stop' &&
      ['await-user', 'resolve-verifier-blocker'].includes(state.loop.next_action ?? '')
    ) {
      if (state.loop.next_action === 'resolve-verifier-blocker')
        decisions.push({ action: 'resolve-verifier-blocker', choice: 'retry' });
      decisions.push({ action: 'revise-implementation', choice: 'repair' });
    } else if (wait.stepId === 'verify.checks-stop' && state.loop.next_action === 'await-user') {
      decisions.push({ action: 'revise-implementation', choice: 'repair' });
    } else if (
      wait.stepId === 'verify.confirm' &&
      state.loop.next_action === 'confirm-skill-coordinated-pass'
    ) {
      decisions.push(
        { action: 'accept-result', choice: 'approved' },
        { action: 'revise-implementation', choice: 'rejected' },
        { action: 'retry-verifier', choice: 'reverify' },
      );
    }
  }
  if (
    wait.stepId === 'verify.retry' &&
    state.status === 'blocked' &&
    state.loop.next_action === 'retry-verifier'
  )
    decisions.push({ action: 'retry-verifier', choice: 'retry' });
  return decisions.filter(({ choice }) => wait.choices.includes(choice));
}

export function nativeSdkVerifyDecisions(run: Readonly<WorkflowRun>, state: NativePortableState) {
  if (['failed', 'cancelled', 'completed'].includes(run.status)) return [];
  return run.waits
    .filter((wait) => wait.status === 'pending')
    .flatMap((wait) =>
      nativeSdkVerifyWaitDecisions(state, wait).map((decision) => ({ ...decision, wait })),
    );
}
