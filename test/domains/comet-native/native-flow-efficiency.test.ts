import { describe, expect, it } from 'vitest';

import { buildNativePortableAcceptance } from '../../../domains/comet-native/native-portable-acceptance.js';
import { nativePortableContinuation } from '../../../domains/comet-native/native-portable-continuation.js';
import {
  applyNativeVerifierEnvelope,
  confirmNativePortableAcceptance,
  prepareNativePortableShapeConfirmation,
  reserveNativeVerifierAttempt,
  submitNativeBuilderCandidate,
} from '../../../domains/comet-native/native-loop-runtime.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import {
  createNativeRunnerChannel,
  type NativeTrustedVerifierEnvelope,
} from '../../../domains/comet-native/native-runner-protocol.js';
import { parseNativeRunnerInput } from '../../../domains/comet-native/native-runner-input.js';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';

function confirmedState(name: string, ids = ['A1', 'A2']): NativePortableState {
  const acceptance = ids.map((id) => ({
    id,
    source: 'brief.md',
    text: `${id} behavior works.`,
  }));
  const shape = prepareNativePortableShapeConfirmation({
    state: createNativePortableState({ name, language: 'en' }),
    acceptance,
  });
  return confirmNativePortableAcceptance({ state: shape, acceptance });
}

function builderCandidate(
  state: NativePortableState,
  runner: ReturnType<typeof createNativeRunnerChannel>,
  review: object | null = {
    status: 'passed',
    summary: 'A separate read-only review passed.',
    reviewerExecutionRef: 'reviewer-1',
  },
): NativePortableState {
  return submitNativeBuilderCandidate({
    state,
    input: {
      identity: runner.captureExecutionIdentity({
        identityProvider: 'test-host',
        executionRef: `builder-${state.loop.iteration}`,
      }),
      candidateId: `candidate-${state.loop.iteration}`,
      summary: 'Implemented the candidate.',
      addressedAcceptanceIds: state.acceptance.map(({ id }) => id),
      review: review as never,
    },
  });
}

function verifierEnvelope(
  runner: ReturnType<typeof createNativeRunnerChannel>,
  state: NativePortableState,
  verdict: 'pass' | 'fail',
  failedIds: string[] = [],
): NativeTrustedVerifierEnvelope<unknown> {
  return runner.envelopeVerifierResponse({
    candidateId: state.builder_handoff!.candidate_id,
    identity: runner.captureExecutionIdentity({
      identityProvider: 'test-host',
      executionRef: `verifier-${state.loop.iteration}-${state.loop.attempt}`,
    }),
    payload: {
      kind: 'final-result',
      result: {
        iteration: state.loop.iteration,
        attempt: state.loop.attempt,
        verdict,
        acceptance: state.acceptance
          .filter(({ result }) => result === 'pending')
          .map(({ id }) => ({
            id,
            result: failedIds.includes(id) ? 'failed' : 'passed',
            reason: failedIds.includes(id)
              ? 'The behavior is missing.'
              : 'The behavior was observed.',
          })),
        risks: [],
        summary: verdict === 'pass' ? 'All behavior passed.' : 'A behavior is missing.',
      },
    },
  });
}

describe('Native flow efficiency plan', () => {
  it('allows an ordinary Builder candidate without a mandatory pre-review', () => {
    const runner = createNativeRunnerChannel();
    const state = builderCandidate(confirmedState('no-pre-review'), runner, null);

    expect(state.phase).toBe('verify');
    expect(state.builder_handoff?.review).toBeNull();
    expect(reserveNativeVerifierAttempt(state).loop.next_action).toBe('await-verifier-result');
  });

  it('does not emit a review placeholder in the Builder input template', () => {
    const state = confirmedState('template-without-review', ['A1']);
    const continuation = nativePortableContinuation(state);
    const template = continuation.inputOptions[0]?.template as Record<string, unknown>;

    expect(template).toBeTruthy();
    expect(template).not.toHaveProperty('review');
  });

  it('rejects the same acceptance criterion duplicated across brief and Spec sources', () => {
    expect(() =>
      buildNativePortableAcceptance({
        briefMarkdown: '# Acceptance examples\n- shared\n',
        specs: [
          {
            capability: 'shared',
            source: 'specs/shared/spec.md',
            markdown: '### Scenario: shared\n',
          },
        ],
      }),
    ).toThrow('duplicate criterion');
  });

  it('finishes after one complete Verifier pass on a repaired candidate', () => {
    const runner = createNativeRunnerChannel();
    let state = reserveNativeVerifierAttempt(
      builderCandidate(confirmedState('repair-pass'), runner),
    );
    const failed = applyNativeVerifierEnvelope({
      state,
      envelope: verifierEnvelope(runner, state, 'fail', ['A1']),
      checks: [],
      maxVerifyFailures: 3,
    });
    state = reserveNativeVerifierAttempt(builderCandidate(failed.state, runner, null));
    const passed = applyNativeVerifierEnvelope({
      state,
      envelope: verifierEnvelope(runner, state, 'pass'),
      checks: [],
      maxVerifyFailures: 3,
    });

    expect(passed.state.phase).toBe('verify');
    expect(passed.state.verification_result).toBe('pass');
    expect(passed.state.loop.next_action).toBe('confirm-skill-coordinated-pass');
    expect(passed.state.acceptance.every(({ result }) => result === 'passed')).toBe(true);
  });

  it('keeps validate-only runner parsing side-effect free and leaves verdict fields absent', () => {
    const parsed = parseNativeRunnerInput({
      kind: 'builder-handoff',
      summary: 'Candidate summary.',
      addressed_acceptance_ids: ['A1'],
      checks: [],
      known_limits: [],
      review: null,
    });

    expect(parsed).toMatchObject({ kind: 'builder-handoff', review: null });
  });
});
