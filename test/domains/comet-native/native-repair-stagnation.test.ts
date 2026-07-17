import { describe, expect, it } from 'vitest';

import {
  buildNativeRepairSignature,
  decideNativeRepairOverride,
  decideNativeRepairStagnation,
  hashNativeRepairOverrideSummary,
  NATIVE_REPAIR_STAGNATION_LIMITS,
  type NativeRepairFailureFacts,
  type NativeRepairHistoryRecord,
} from '../../../domains/comet-native/native-repair-stagnation.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

function facts(overrides: Partial<NativeRepairFailureFacts> = {}): NativeRepairFailureFacts {
  return {
    contractHash: A,
    implementationScopeHash: B,
    artifactSnapshotHash: C,
    categories: ['test-failure'],
    failedCheckIds: ['auth.invalid', 'auth.valid'],
    ...overrides,
  };
}

function failures(signatureHash: string, count: number): NativeRepairHistoryRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'failure' as const,
    revision: index + 1,
    iteration: index + 1,
    signatureHash,
  }));
}

describe('Native repair stagnation control', () => {
  it('normalizes failure facts without depending on category or check order', () => {
    const first = buildNativeRepairSignature(facts());
    const reordered = buildNativeRepairSignature({
      ...facts(),
      categories: ['test-failure'],
      failedCheckIds: ['auth.valid', 'auth.invalid'],
    });

    expect(reordered).toEqual(first);
    expect(first.signatureHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('continues once, warns on the first repeat, and stops on the third identical failure', () => {
    const signature = buildNativeRepairSignature(facts());
    expect(decideNativeRepairStagnation({ facts: facts(), history: [] })).toMatchObject({
      disposition: 'continue',
      consecutiveFailures: 1,
    });
    expect(
      decideNativeRepairStagnation({
        facts: facts(),
        history: failures(signature.signatureHash, 1),
      }),
    ).toMatchObject({ disposition: 'warn', consecutiveFailures: 2 });
    expect(
      decideNativeRepairStagnation({
        facts: facts(),
        history: failures(signature.signatureHash, 2),
      }),
    ).toMatchObject({ disposition: 'manual-stop', consecutiveFailures: 3 });
  });

  it('treats a changed scope or failed-check set as progress and resets the consecutive count', () => {
    const original = buildNativeRepairSignature(facts());
    const changed = decideNativeRepairStagnation({
      facts: facts({ artifactSnapshotHash: A, failedCheckIds: ['auth.valid'] }),
      history: failures(original.signatureHash, 2),
    });

    expect(changed).toMatchObject({
      disposition: 'continue',
      reasonCode: 'new-failure-signature',
      consecutiveFailures: 1,
    });
  });

  it('allows one explicit matching override but never a second one', () => {
    const signature = buildNativeRepairSignature(facts());
    const history = failures(signature.signatureHash, 2);
    const first = decideNativeRepairStagnation({
      facts: facts(),
      history,
      override: {
        expectedSignatureHash: signature.signatureHash,
        summary: 'Try the independent compatibility path once.',
      },
    });
    expect(first).toMatchObject({
      disposition: 'continue',
      reasonCode: 'override-accepted',
      overrideAccepted: true,
    });

    const second = decideNativeRepairStagnation({
      facts: facts(),
      history: [
        ...history,
        {
          kind: 'override',
          revision: 3,
          iteration: 3,
          signatureHash: signature.signatureHash,
          summaryHash: A,
        },
      ],
      override: {
        expectedSignatureHash: signature.signatureHash,
        summary: 'Try again.',
      },
    });
    expect(second).toMatchObject({
      disposition: 'manual-stop',
      reasonCode: 'override-already-used',
      overrideAccepted: false,
    });
  });

  it('accepts an override on a later transition without counting the stopped failure twice', () => {
    const signature = buildNativeRepairSignature(facts());
    const stopped = failures(signature.signatureHash, 3);
    const accepted = decideNativeRepairOverride({
      facts: facts(),
      history: stopped,
      override: {
        expectedSignatureHash: signature.signatureHash,
        summary: 'Try the independent path once.',
      },
    });
    expect(accepted).toMatchObject({
      disposition: 'continue',
      totalRepairFailures: 3,
      consecutiveFailures: 3,
      overrideAccepted: true,
    });

    expect(
      decideNativeRepairOverride({
        facts: facts(),
        history: [
          ...stopped,
          {
            kind: 'override',
            revision: 4,
            iteration: 3,
            signatureHash: signature.signatureHash,
            summaryHash: hashNativeRepairOverrideSummary('Try the independent path once.'),
          },
        ],
        override: {
          expectedSignatureHash: signature.signatureHash,
          summary: 'A second attempt must be refused.',
        },
      }),
    ).toMatchObject({ reasonCode: 'override-already-used', overrideAccepted: false });
  });

  it('hard-stops at the total iteration ceiling even when the signature changed', () => {
    const old = buildNativeRepairSignature(facts({ contractHash: B }));
    const result = decideNativeRepairStagnation({
      facts: facts(),
      history: failures(old.signatureHash, NATIVE_REPAIR_STAGNATION_LIMITS.maxRepairIterations - 1),
      override: {
        expectedSignatureHash: buildNativeRepairSignature(facts()).signatureHash,
        summary: 'The limit must still win.',
      },
    });

    expect(result).toMatchObject({
      disposition: 'hard-stop',
      reasonCode: 'repair-iteration-limit',
      remainingIterations: 0,
      overrideAccepted: false,
    });
  });

  it('fails closed on malformed IDs, duplicate history ordering, and mismatched override', () => {
    expect(() => buildNativeRepairSignature(facts({ failedCheckIds: ['bad check'] }))).toThrow(
      'invalid token',
    );
    const signature = buildNativeRepairSignature(facts());
    expect(() =>
      decideNativeRepairStagnation({
        facts: facts(),
        history: [
          { kind: 'failure', revision: 2, iteration: 2, signatureHash: signature.signatureHash },
          { kind: 'failure', revision: 1, iteration: 1, signatureHash: signature.signatureHash },
        ],
      }),
    ).toThrow('strictly ordered');
    expect(() =>
      decideNativeRepairStagnation({
        facts: facts(),
        history: failures(signature.signatureHash, 2),
        override: { expectedSignatureHash: B, summary: 'Wrong failure.' },
      }),
    ).toThrow('does not match');
    expect(() =>
      decideNativeRepairStagnation({
        facts: facts(),
        history: [
          {
            kind: 'failure',
            revision: 1,
            iteration: 1,
            signatureHash: signature.signatureHash,
            forged: true,
          } as unknown as NativeRepairHistoryRecord,
        ],
      }),
    ).toThrow('fields are invalid');
  });
});
