import { describe, expect, it } from 'vitest';

import { nativeAdvanceEvidenceHash } from '../../../domains/comet-native/native-transition-evidence.js';

describe('Native transition evidence hashing', () => {
  it('binds the Runtime-owned verification report input without duplicate receipt refs', () => {
    const baseline = {
      summary: 'Verify with report-owned evidence.',
      verificationResult: 'pass' as const,
      verificationReport: 'verification.md',
    };

    expect(
      nativeAdvanceEvidenceHash({
        ...baseline,
        verificationReport: 'verification-retry.md',
      }),
    ).not.toBe(nativeAdvanceEvidenceHash(baseline));
  });

  it('binds a repair override independently from verification evidence', () => {
    const evidence = {
      summary: 'Retry with a new repair hypothesis.',
      artifacts: ['src/repair.ts'],
    };
    expect(nativeAdvanceEvidenceHash(evidence)).not.toBe(
      nativeAdvanceEvidenceHash({
        ...evidence,
        repairOverrideSignature: 'a'.repeat(64),
        repairOverrideSummary: 'Try the alternate parser boundary.',
      }),
    );
  });
});
