import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureCliBuilt } from '../../helpers/ensure-cli-built.js';
import { nativeVerificationFixture } from '../../helpers/native-verification-fixture.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  prepareEditReview,
  recordEditReview,
} from '../../../domains/workflow-contract/edit-review.js';
import { nativeFormalEditReviewScope } from '../../../domains/comet-native/native-edit-review.js';
import { runNativeEditReviewCommand } from '../../../domains/comet-native/native-edit-review-command.js';
import { projectNativeSdkContinuation } from '../../../domains/comet-native/native-sdk-continuation.js';
import type { WorkflowRun, RuntimeValue } from '../../../domains/engine/runtime.js';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
it.each(['runtime', 'public-cli'])(
  'surfaces an unapplied formal edit before dispatching an independent verifier through %s',
  async (boundary) => {
    if (boundary === 'public-cli') await ensureCliBuilt(path.resolve('.'));
    const fixture = await nativeVerificationFixture(
      (root) => roots.push(root),
      boundary === 'public-cli' ? path.resolve('bin/comet.js') : undefined,
    );
    const run = await fixture.candidate('expected\n');
    const state = run.state as unknown as NativePortableState;
    const paths = await nativeProjectPaths(fixture.root, 'docs');
    const ref = 'docs/comet/changes/verification-test/brief.md';
    const original = await fs.readFile(path.join(fixture.root, ref), 'utf8');
    const scope = { ...nativeFormalEditReviewScope(paths, state), allowedFormalPaths: [ref] };
    const proposal = await prepareEditReview(scope, {
      intent: 'write',
      toolName: 'Write',
      targets: [ref],
      writes: [{ path: ref, content: original + '\nA formatting explanation.\n' }],
    });
    await recordEditReview(
      scope,
      {
        proposalHash: proposal.proposalHash,
        decision: 'non-behavioral',
        summary: 'The explanation preserves every requirement and acceptance item.',
      },
      { kind: 'runtime-agent', executionRef: 'builder' },
    );
    const prepared = (
      boundary === 'public-cli'
        ? JSON.parse(
            execFileSync(
              process.execPath,
              [
                path.resolve('bin/comet.js'),
                'edit-review',
                'prepare-applied',
                'native',
                state.name,
                '--session',
                'builder',
                '--project-root',
                fixture.root,
                '--json',
              ],
              { encoding: 'utf8', windowsHide: true },
            ),
          ).data
        : await runNativeEditReviewCommand({
            projectRoot: fixture.root,
            name: state.name,
            operation: 'prepare-applied',
            sessionId: 'builder',
          })
    ) as { reviews: Array<{ proposalHash: string }>; continuation: unknown };
    expect(prepared.reviews).toEqual(
      expect.arrayContaining([expect.objectContaining({ proposalHash: proposal.proposalHash })]),
    );
    expect(prepared.continuation).not.toBeNull();
    const projection =
      boundary === 'public-cli'
        ? ((await fixture.invoke('status', state.name)).data as Awaited<
            ReturnType<typeof projectNativeSdkContinuation>
          >)
        : await projectNativeSdkContinuation({ run, state, projectRoot: fixture.root });
    expect(projection.continuation.action).toBe('review-edit');
    const pending = projection.pendingActions?.find((entry) => entry.stepId === 'verify.verifier');
    expect(pending?.claimRequest).toBeUndefined();
    expect(pending?.sessionRequirements).toBeUndefined();
    expect(await fs.readFile(path.join(fixture.root, ref), 'utf8')).toBe(original);
    expect((await fixture.inspect()).actions.at(-1)?.status).toBe('pending');
    await expect(fixture.submit(final(run, 'reviewer'), 'reviewer')).rejects.toThrow(
      new RegExp(`${ref.replaceAll('.', '\\.')}.*${proposal.proposalHash}`),
    );
    await recordEditReview(
      scope,
      {
        proposalHash: proposal.proposalHash,
        decision: 'discard',
        summary: 'Keep the approved original; the proposed explanation was never written.',
      },
      { kind: 'runtime-agent', executionRef: 'builder' },
    );
    const ready = await fixture.inspect();
    const resumed = await projectNativeSdkContinuation({
      run: ready,
      state: ready.state as unknown as NativePortableState,
      projectRoot: fixture.root,
    });
    expect(resumed.continuation.action).not.toBe('review-edit');
    await fixture.submit(final(ready, 'reviewer'), 'reviewer');
    expect((await fixture.inspect()).state).toMatchObject({ verification_result: 'pass' });
  },
);

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
