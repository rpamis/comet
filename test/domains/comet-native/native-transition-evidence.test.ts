import { describe, expect, it } from 'vitest';

import { nativeAdvanceEvidenceHash } from '../../../domains/comet-native/native-transition-evidence.js';

const receipt = (character: string) => `runtime/evidence/receipts/${character.repeat(64)}.json`;

describe('Native transition evidence hashing', () => {
  it('binds every current verification receipt ref', () => {
    const baseline = {
      summary: 'Verify with v2 evidence.',
      verificationResult: 'pass' as const,
      verificationReport: 'verification.md',
      verificationReceipt: receipt('1'),
      verificationReceiptRefs: [receipt('2')],
    };

    expect(
      nativeAdvanceEvidenceHash({
        ...baseline,
        verificationReceiptRefs: [receipt('5')],
      }),
    ).not.toBe(nativeAdvanceEvidenceHash(baseline));
  });

  it('distinguishes omitted ref lists from an explicit empty ref graph', () => {
    const evidence = {
      summary: 'Verify with runtime-derived refs.',
      verificationResult: 'fail' as const,
      verificationReport: 'verification.md',
    };
    expect(nativeAdvanceEvidenceHash(evidence)).not.toBe(
      nativeAdvanceEvidenceHash({
        ...evidence,
        verificationReceiptRefs: [],
      }),
    );
  });
});
