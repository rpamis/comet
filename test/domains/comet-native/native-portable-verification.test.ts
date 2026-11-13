import { describe, expect, it } from 'vitest';

import { nativeVerifierResponsePosition } from '../../../domains/comet-native/native-portable-verification.js';

describe('Native portable verification protocol', () => {
  it('projects the response position without loading the portable workflow orchestrator', () => {
    expect(
      nativeVerifierResponsePosition({
        kind: 'final-result',
        result: {
          iteration: 3,
          attempt: 2,
          verdict: 'pass',
          acceptance: [],
          risks: [],
          summary: 'Position projection only; no execution.',
        },
      }),
    ).toEqual({ iteration: 3, attempt: 2 });
  });
});
