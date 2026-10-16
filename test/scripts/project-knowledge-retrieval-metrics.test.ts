import { expect, test } from 'vitest';
import { retrievalEvidence } from '../../scripts/benchmark/project-knowledge-retrieval-metrics.mjs';

test('distinguishes a file hit from a supporting passage and strict source recall', () => {
  const entry = {
    goldSources: ['current.md', 'related.md'],
    goldPassages: [{ source: 'current.md', allOf: ['phase', 'path'] }],
  };
  expect(
    retrievalEvidence(entry, [{ source: 'current.md', content: 'An unrelated introduction.' }]),
  ).toMatchObject({
    hitRateAt4: true,
    sourceRecallAt4: 0.5,
    sourcePrecisionAt4: 0.25,
    passageHitAt4: false,
  });
  expect(
    retrievalEvidence(entry, [
      { source: 'current.md', content: 'Use the PATH and PHASE selectors.' },
    ]).passageHitAt4,
  ).toBe(true);
  expect(retrievalEvidence({ goldSources: [], expectedAbstain: true }, []).hitRateAt4).toBe(true);
  expect(() =>
    retrievalEvidence(
      { goldSources: ['current.md'], goldPassages: [{ source: 'current.md' }] },
      [],
    ),
  ).toThrow(/content assertions/);
});
