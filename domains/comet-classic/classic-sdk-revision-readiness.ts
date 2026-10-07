import type { WorkflowRun } from '../engine/runtime.js';
import {
  assertClassicSdkDesignRequirementsCurrent,
  classicOpenEvidenceReceipt,
  classicAcceptedDesignEvidence,
  classicPlanEvidenceReceipt,
} from './classic-sdk-application.js';
import type { ClassicState } from './classic-state.js';
import { classicVerificationReportReceipt } from './classic-verification-report.js';

/** 只读取当前候选的漂移；历史轮次不作为当前恢复的前置条件。 */
export async function inspectClassicSdkRevisionReadiness(projectRoot: string, run: WorkflowRun) {
  const state = run.state as unknown as ClassicState;
  const change = run.runId;
  const input = run.input as { changeDir: string };
  const revision = run.revision;
  const problems: Array<{
    code: string;
    message: string;
    remediation: string;
    commandArgs: string[];
  }> = [];
  const record = (phase: 'design' | 'plan', message: string) => {
    const command = `revise-${phase}`;
    problems.push({
      code: 'CLASSIC_EVIDENCE_DRIFT',
      message,
      remediation: `Run comet state ${command} ${change} --expected-revision ${revision}, then ${phase === 'design' ? 'propose-design and approve the new proposal' : 'submit-plan and follow its next action'}`,
      commandArgs: ['comet', 'state', command, change, '--expected-revision', String(revision)],
    });
  };
  if (
    state.workflow === 'full' &&
    state.phase === 'design' &&
    !run.actions.some(
      (action) => action.stepId === 'full.design.handoff' && action.status === 'pending',
    )
  ) {
    const proposal = run.outputs['full.design.handoff']?.value as
      | {
          requirementsEvidence?: { ref: string; contentHash: string };
        }
      | undefined;
    const expected =
      proposal?.requirementsEvidence ??
      (run.outputs['full.open.evidence']?.value as
        { ref?: unknown; contentHash?: unknown } | undefined);
    if (expected) {
      try {
        const current = await classicOpenEvidenceReceipt(projectRoot, input.changeDir, {
          designRequirements: Boolean(proposal?.requirementsEvidence),
        });
        if (expected.ref !== current.ref || expected.contentHash !== current.contentHash)
          record('design', 'Classic Design requirements changed after the proposal');
      } catch (error) {
        record('design', error instanceof Error ? error.message : String(error));
      }
    }
  }
  let requirementsDrift = false;
  if (
    state.workflow === 'full' &&
    state.phase === 'build' &&
    !run.actions.some(
      (action) => action.stepId === 'full.design.handoff' && action.status === 'pending',
    )
  ) {
    try {
      await assertClassicSdkDesignRequirementsCurrent(projectRoot, input.changeDir, run);
      await classicAcceptedDesignEvidence(projectRoot, run);
    } catch (error) {
      requirementsDrift = true;
      record('design', error instanceof Error ? error.message : String(error));
    }
  }
  if (
    !requirementsDrift &&
    state.workflow === 'full' &&
    state.phase === 'build' &&
    state.plan &&
    !run.actions.some(
      (action) => action.stepId === 'full.build.plan' && action.status === 'pending',
    )
  ) {
    const plan = run.outputs['full.build.plan']?.value as
      { planEvidence?: { ref: string; contentHash: string } } | undefined;
    const expected =
      plan?.planEvidence ??
      run.evidenceWaits
        ?.slice()
        .reverse()
        .find((wait) => wait.stepId === 'full.build.plan.evidence' && wait.status === 'resolved')
        ?.receipt;
    if (expected) {
      try {
        const current = await classicPlanEvidenceReceipt(projectRoot, state.plan, input.changeDir);
        if (expected.ref !== current.ref || expected.contentHash !== current.contentHash)
          record('plan', 'Classic Build plan or task requirements changed after accepted evidence');
      } catch (error) {
        record('plan', error instanceof Error ? error.message : String(error));
      }
    }
  }
  if (state.phase === 'verify' && state.verificationReport) {
    const step = `${state.workflow}.verify.run`;
    const action = run.actions
      .slice()
      .reverse()
      .find((entry) => entry.stepId === step);
    const sequence = action ? run.actionContexts[action.id]?.sequence : undefined;
    const expected = run.evidenceWaits
      ?.slice()
      .reverse()
      .find(
        (wait) =>
          wait.stepId === `${state.workflow}.verify.report.evidence` &&
          wait.status === 'resolved' &&
          sequence !== undefined &&
          wait.results[step]?.sequence === sequence,
      )?.receipt;
    if (expected) {
      try {
        const current = await classicVerificationReportReceipt(
          projectRoot,
          state.verificationReport,
          state.language,
        );
        if (expected.ref !== current.ref || expected.contentHash !== current.contentHash)
          throw new Error('Classic Verify report changed within the accepted verification round');
      } catch (error) {
        problems.push({
          code: 'CLASSIC_EVIDENCE_DRIFT',
          message: error instanceof Error ? error.message : String(error),
          remediation: `Restore ${expected.ref} to the report accepted in this round (SHA256 ${expected.contentHash}), then resume the pending check`,
          commandArgs: ['comet', 'state', 'next', change],
        });
      }
    }
  }
  return problems;
}
