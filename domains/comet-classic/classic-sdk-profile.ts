import type { WorkflowRun } from '../engine/runtime.js';
import type { ClassicProfile, ClassicState } from './classic-state.js';

/** preset 经原批准升级后继续同一 Run，其定义身份仍保留最初的 profile。 */
export function classicSdkRunMatchesProfile(run: WorkflowRun, profile: ClassicProfile): boolean {
  if (run.workflow.id === `comet-classic-${profile}`) return true;
  const original = /^comet-classic-(hotfix|tweak)$/u.exec(run.workflow.id)?.[1];
  return profile === 'full' && Boolean(original) && isClassicSdkApprovedUpgrade(run, original!);
}

/** 升级改变领域阶段，原 Run 定义及其审批记录仍保留 preset 身份。 */
export function isClassicSdkApprovedUpgrade(run: WorkflowRun, profile: string): boolean {
  const state = run.state as ClassicState | undefined;
  return (
    (profile === 'hotfix' || profile === 'tweak') &&
    run.workflow.id === `comet-classic-${profile}` &&
    state?.workflow === 'full' &&
    state.classicProfile === 'full' &&
    run.waits.some(
      (wait) =>
        wait.stepId === `${profile}.build.escalation-confirm` &&
        wait.status === 'resolved' &&
        wait.decision?.choice === 'upgrade' &&
        wait.decision.proposalHash === wait.proposalHash,
    )
  );
}
