import { describe, expect, it } from 'vitest';

import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import {
  validateNativeTrustedVerifierEnvelope,
  type NativeVerifierBinding,
} from '../../../domains/comet-native/native-verifier-protocol.js';

const binding: NativeVerifierBinding = {
  candidateId: 'candidate-1',
  identityProvider: 'codex-host',
  builderExecutionRef: 'builder-1',
  iteration: 1,
  attempt: 1,
  acceptanceIds: ['A1', 'A2'],
  requiredChecksPassed: true,
};

function finalResult(
  acceptance = [
    { id: 'A1', result: 'passed', reason: 'Observed the expected first behavior.' },
    { id: 'A2', result: 'passed', reason: 'Observed the expected second behavior.' },
  ],
) {
  return {
    kind: 'final-result',
    result: {
      iteration: 1,
      attempt: 1,
      verdict: 'pass',
      acceptance,
      risks: [],
      summary: 'All acceptance criteria passed.',
    },
  };
}

describe('Native trusted Verifier protocol', () => {
  it('accepts one complete result from a different trusted execution', () => {
    const runner = createNativeRunnerChannel();
    const identity = runner.captureExecutionIdentity({
      identityProvider: 'codex-host',
      executionRef: 'verifier-1',
    });
    const envelope = runner.envelopeVerifierResponse({
      candidateId: 'candidate-1',
      identity,
      payload: finalResult(),
    });

    expect(validateNativeTrustedVerifierEnvelope({ envelope, binding })).toMatchObject({
      kind: 'final-result',
      result: { verdict: 'pass' },
    });
  });

  it('rejects an Agent-shaped plain object even if it forges identity fields', () => {
    expect(() =>
      validateNativeTrustedVerifierEnvelope({
        envelope: {
          candidateId: 'candidate-1',
          identityProvider: 'codex-host',
          verifierExecutionRef: 'verifier-1',
          payload: finalResult(),
        },
        binding,
      }),
    ).toThrow('trusted Runner');
  });

  it('rejects same-execution self verification and cross-provider strings', () => {
    const runner = createNativeRunnerChannel();
    for (const [identityProvider, executionRef, message] of [
      ['codex-host', 'builder-1', 'different executions'],
      ['other-host', 'verifier-1', 'provider'],
    ] as const) {
      const envelope = runner.envelopeVerifierResponse({
        candidateId: 'candidate-1',
        identity: runner.captureExecutionIdentity({ identityProvider, executionRef }),
        payload: finalResult(),
      });
      expect(() => validateNativeTrustedVerifierEnvelope({ envelope, binding })).toThrow(message);
    }
  });

  it.each([
    [[{ id: 'A1', result: 'passed', reason: 'ok' }], 'missing'],
    [
      [
        { id: 'A1', result: 'passed', reason: 'ok' },
        { id: 'A1', result: 'passed', reason: 'again' },
      ],
      'duplicate',
    ],
    [
      [
        { id: 'A1', result: 'passed', reason: 'ok' },
        { id: 'A3', result: 'passed', reason: 'unknown' },
      ],
      'unknown',
    ],
  ])('rejects incomplete acceptance coverage (%s)', (acceptance, message) => {
    const runner = createNativeRunnerChannel();
    const envelope = runner.envelopeVerifierResponse({
      candidateId: 'candidate-1',
      identity: runner.captureExecutionIdentity({
        identityProvider: 'codex-host',
        executionRef: 'verifier-1',
      }),
      payload: finalResult(acceptance),
    });
    expect(() => validateNativeTrustedVerifierEnvelope({ envelope, binding })).toThrow(message);
  });

  it('rejects pass when a required check failed or any criterion did not pass', () => {
    const runner = createNativeRunnerChannel();
    const envelope = runner.envelopeVerifierResponse({
      candidateId: 'candidate-1',
      identity: runner.captureExecutionIdentity({
        identityProvider: 'codex-host',
        executionRef: 'verifier-1',
      }),
      payload: finalResult([
        { id: 'A1', result: 'passed', reason: 'ok' },
        { id: 'A2', result: 'failed', reason: 'missing behavior' },
      ]),
    });
    expect(() => validateNativeTrustedVerifierEnvelope({ envelope, binding })).toThrow(
      'every acceptance',
    );
    expect(() =>
      validateNativeTrustedVerifierEnvelope({
        envelope: runner.envelopeVerifierResponse({
          candidateId: 'candidate-1',
          identity: runner.captureExecutionIdentity({
            identityProvider: 'codex-host',
            executionRef: 'verifier-2',
          }),
          payload: finalResult(),
        }),
        binding: { ...binding, requiredChecksPassed: false },
      }),
    ).toThrow('required check');
  });
});
