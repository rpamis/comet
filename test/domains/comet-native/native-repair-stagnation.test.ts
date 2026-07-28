import { describe, expect, it } from 'vitest';

import {
  buildNativeRepairSignature,
  decideNativeRepairOverride,
  decideNativeRepairStagnation,
  hashNativeRepairOverrideSummary,
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
    failedAcceptanceIds: [`acceptance-${A}`],
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
    expect(
      decideNativeRepairStagnation({
        facts: facts(),
        history: [],
        maxVerifyFailures: 5,
      }),
    ).toMatchObject({
      disposition: 'continue',
      consecutiveFailures: 1,
    });
    expect(
      decideNativeRepairStagnation({
        facts: facts(),
        history: failures(signature.signatureHash, 1),
        maxVerifyFailures: 5,
      }),
    ).toMatchObject({ disposition: 'warn', consecutiveFailures: 2 });
    expect(
      decideNativeRepairStagnation({
        facts: facts(),
        history: failures(signature.signatureHash, 2),
        maxVerifyFailures: 5,
      }),
    ).toMatchObject({ disposition: 'manual-stop', consecutiveFailures: 3 });
  });

  it('ignores implementation churn but treats a changed semantic gap as progress', () => {
    const original = buildNativeRepairSignature(facts());
    const scopeOnly = decideNativeRepairStagnation({
      facts: facts({ artifactSnapshotHash: A, implementationScopeHash: C }),
      history: failures(original.signatureHash, 1),
      maxVerifyFailures: 5,
    });
    expect(scopeOnly).toMatchObject({
      disposition: 'warn',
      consecutiveFailures: 2,
    });

    const changedGap = decideNativeRepairStagnation({
      facts: facts({ artifactSnapshotHash: A, failedCheckIds: ['auth.valid'] }),
      history: failures(original.signatureHash, 2),
      maxVerifyFailures: 5,
    });

    expect(changedGap).toMatchObject({
      disposition: 'continue',
      reasonCode: 'new-failure-signature',
      consecutiveFailures: 1,
    });
  });

  it('resets stagnation only for a strict semantic gap reduction', () => {
    const previousFacts = facts({
      failedAcceptanceIds: [`acceptance-${A}`, `acceptance-${B}`],
      failedCheckIds: ['check-a', 'check-b'],
    });
    const previous = buildNativeRepairSignature(previousFacts);
    const history: NativeRepairHistoryRecord[] = [1, 2].map((iteration) => ({
      kind: 'failure',
      revision: iteration,
      iteration,
      signatureHash: previous.signatureHash,
      failedAcceptanceIds: [...previous.failedAcceptanceIds],
      failedCheckIds: [...previous.failedCheckIds],
    }));
    const swappedFacts = facts({
      failedAcceptanceIds: [`acceptance-${A}`, `acceptance-${C}`],
      failedCheckIds: ['check-a', 'check-c'],
    });
    expect(
      decideNativeRepairStagnation({
        facts: swappedFacts,
        history,
        maxVerifyFailures: 5,
      }),
    ).toMatchObject({ disposition: 'manual-stop', consecutiveFailures: 3 });

    const reducedFacts = facts({
      failedAcceptanceIds: [`acceptance-${A}`],
      failedCheckIds: ['check-a'],
    });
    expect(
      decideNativeRepairStagnation({
        facts: reducedFacts,
        history,
        maxVerifyFailures: 5,
      }),
    ).toMatchObject({ disposition: 'continue', consecutiveFailures: 1 });
  });

  it('allows one explicit matching override but never a second one', () => {
    const signature = buildNativeRepairSignature(facts());
    const history = failures(signature.signatureHash, 2);
    const first = decideNativeRepairStagnation({
      facts: facts(),
      history,
      maxVerifyFailures: 5,
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
      maxVerifyFailures: 5,
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
      maxVerifyFailures: 5,
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
        maxVerifyFailures: 5,
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
      history: failures(old.signatureHash, 4),
      maxVerifyFailures: 5,
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
        maxVerifyFailures: 5,
      }),
    ).toThrow('strictly ordered');
    expect(() =>
      decideNativeRepairStagnation({
        facts: facts(),
        history: failures(signature.signatureHash, 2),
        maxVerifyFailures: 5,
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
        maxVerifyFailures: 5,
      }),
    ).toThrow('fields are invalid');
  });
});
