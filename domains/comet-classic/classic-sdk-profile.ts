import type { WorkflowRun } from '../engine/runtime.js';
import type { ClassicProfile, ClassicState } from './classic-state.js';

/** preset 经原批准升级后继续同一 Run，其定义身份仍保留最初的 profile。 */
export function classicSdkRunMatchesProfile(run: WorkflowRun, profile: ClassicProfile): boolean {
  if (run.workflow.id === `comet-classic-${profile}`) return true;
  const original = /^comet-classic-(hotfix|tweak)$/u.exec(run.workflow.id)?.[1];
  const state = run.state as unknown as ClassicState;
  return (
    profile === 'full' &&
    Boolean(original) &&
    state.workflow === 'full' &&
    state.classicProfile === 'full' &&
    run.waits.some(
      (wait) =>
        wait.stepId === `${original}.build.escalation-confirm` &&
        wait.status === 'resolved' &&
        wait.decision?.choice === 'upgrade',
    )
  );
}
