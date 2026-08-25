import { describe, expect, it } from 'vitest';

import {
  parseNativeLifecycleEvidence,
  parseNativeOutcomeEvidence,
} from '../../../domains/comet-native/native-experience.js';

describe('Native workflow experience evidence', () => {
  it('recognizes a verifier pass that resolves an earlier failure', () => {
    const stdout = JSON.stringify({
      data: {
        change: {
          phase: 'archive',
          verification: { verdict: 'pass', summary: 'All acceptance criteria passed.' },
          history: [{ outcome: 'fail' }, { outcome: 'pass' }],
        },
      },
    });

    expect(parseNativeOutcomeEvidence(stdout)).toEqual({
      reviewResolved: true,
      failureResolved: true,
      summary: 'All acceptance criteria passed.',
    });
  });

  it('extracts only bounded string lifecycle evidence', () => {
    const stdout = JSON.stringify({
      data: {
        changedPaths: ['domains/a.ts', 42, 'domains/b.ts'],
        artifacts: ['docs/brief.md', null],
      },
    });

    expect(parseNativeLifecycleEvidence(stdout)).toEqual({
      changedPaths: ['domains/a.ts', 'domains/b.ts'],
      artifactRefs: ['docs/brief.md'],
    });
  });

  it('treats malformed output as absent evidence', () => {
    expect(parseNativeOutcomeEvidence('not-json')).toEqual({
      reviewResolved: false,
      failureResolved: false,
    });
    expect(parseNativeLifecycleEvidence(undefined)).toEqual({
      changedPaths: [],
      artifactRefs: [],
    });
  });
});
