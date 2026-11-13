import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { nativeVerificationFixture } from '../../helpers/native-verification-fixture.js';
import { projectNativeSdkContinuation } from '../../../domains/comet-native/native-sdk-continuation.js';
import type { WorkflowRun, RuntimeValue } from '../../../domains/engine/runtime.js';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

function final(run: WorkflowRun, sessionId: string, verdict = 'pass'): RuntimeValue {
  const state = run.state as {
    builder_handoff: { candidate_id: string };
    loop: { iteration: number; attempt: number };
  };
  return {
    candidateId: state.builder_handoff.candidate_id,
    verifierExecutionRef: sessionId,
    response: {
      kind: 'final-result',
      result: {
        iteration: state.loop.iteration,
        attempt: state.loop.attempt,
        verdict,
        acceptance:
          verdict === 'pass'
            ? [{ id: 'A1', result: 'passed', reason: 'Read the final value.' }]
            : [{ id: 'A1', result: 'failed', reason: 'The value is wrong.' }],
        risks: [],
        summary: 'Read the final value and caller.',
      },
    },
  };
}

it('binds the original task and rejects a passing review that omits or contradicts it', async () => {
  const task = 'Recover the original operation after a disconnect; keep the public interface.';
  const fixture = await nativeVerificationFixture((root) => roots.push(root), undefined, task);
  const run = await fixture.candidate('expected\n');
  expect(run.input).toMatchObject({ task });
  const dispatchView = await projectNativeSdkContinuation({
    run,
    state: run.state as unknown as NativePortableState,
    projectRoot: fixture.root,
  });
  const dispatched = dispatchView.pendingActions.find(
    (entry) => entry.stepId === 'verify.verifier',
  );
  expect(dispatched?.sessionRequirements).toMatchObject({ independent: true, readOnly: true });
  const review = (current: typeof run) => {
    const output = final(current, 'reviewer');
    return output;
  };
  await expect(fixture.submit(review(run), 'reviewer')).rejects.toThrow(/requestReview/);
  const contradicted = review(await fixture.inspect());
  (contradicted.response.result as Record<string, unknown>).requestReview = {
    result: 'conflict',
    reason: 'The Spec excludes recovery required by the original task.',
  };
  await expect(fixture.submit(contradicted, 'reviewer')).rejects.toThrow(/requestReview/);
  (contradicted.response.result as Record<string, unknown>).requestReview = {
    result: 'blocked',
    reason: 'The original requirement remains unclear.',
  };
  await expect(fixture.submit(contradicted, 'reviewer')).rejects.toThrow(/requestReview/);
  const aligned = review(await fixture.inspect());
  (aligned.response.result as Record<string, unknown>).requestReview = {
    result: 'aligned',
    reason: 'Compared the original task, authorized scope and actual implementation.',
  };
  await fixture.submit(aligned, 'reviewer');
  expect((await fixture.inspect()).state).toMatchObject({ verification_result: 'pass' });
});
