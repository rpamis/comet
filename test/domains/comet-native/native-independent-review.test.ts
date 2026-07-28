import { describe, expect, it } from 'vitest';

import { canonicalHash } from '../../../domains/comet-native/native-canonical-hash.js';
import {
  isNativeHighRiskScope,
  parseNativeIndependentReview,
} from '../../../domains/comet-native/native-independent-review.js';

const acceptanceId = `acceptance-${'a'.repeat(64)}`;

function review(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const content = {
    schema: 'comet.native.independent-review.v1',
    implementationAuthor: 'implementation-agent',
    reviewer: 'independent-reviewer',
    acceptanceIds: [acceptanceId],
    checked: {
      unifiedIo: true,
      adversarialPaths: true,
      generatedAssets: true,
      lifecycleEval: true,
    },
    findings: [],
    ...overrides,
  };
  return {
    schema: content.schema,
    implementation_author: content.implementationAuthor,
    reviewer: content.reviewer,
    acceptance_ids: content.acceptanceIds,
    checked: {
      unified_io: content.checked.unifiedIo,
      adversarial_paths: content.checked.adversarialPaths,
      generated_assets: content.checked.generatedAssets,
      lifecycle_eval: content.checked.lifecycleEval,
    },
    findings: content.findings,
    review_hash: canonicalHash('comet.native.independent-review.v1', content),
  };
}

describe('Native independent review', () => {
  it('requires a distinct reviewer, full MUST coverage, required checks, and resolved P0/P1 findings', () => {
    expect(parseNativeIndependentReview(review(), [acceptanceId])).toMatchObject({
      reviewer: 'independent-reviewer',
    });
    expect(() =>
      parseNativeIndependentReview(review({ reviewer: 'implementation-agent' }), [acceptanceId]),
    ).toThrow('must differ');
    expect(() =>
      parseNativeIndependentReview(
        review({ findings: [{ severity: 'P1', status: 'open', summary: 'missing test' }] }),
        [acceptanceId],
      ),
    ).toThrow('unresolved P0/P1');
  });

  it('classifies runtime, path, migration, install, and transaction changes as high risk', () => {
    expect(isNativeHighRiskScope(['domains/comet-native/native-archive.ts'])).toBe(true);
    expect(isNativeHighRiskScope(['src/feature.ts'])).toBe(false);
    expect(isNativeHighRiskScope(['domains/example/path-parser.ts'])).toBe(true);
  });
});
