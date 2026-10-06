import { describe, expect, it } from 'vitest';
import {
  buildBundleResumeSummary,
  determineBundleNextAction,
} from '../../../domains/bundle/next-action.js';
import type { BundleAuthoringState } from '../../../domains/bundle/types.js';

function state(overrides: Partial<BundleAuthoringState> = {}): BundleAuthoringState {
  return {
    schemaVersion: 1,
    name: 'demo-skill',
    mode: 'create',
    status: 'draft',
    draftPath: '/project/.comet/bundle-drafts/demo-skill',
    currentHash: 'a'.repeat(64),
    candidates: [],
    defaultLocale: 'en',
    locales: ['en'],
    engineEnabled: true,
    ...overrides,
  };
}

describe('Bundle next action', () => {
  it('reports the Bundle evidence and publish steps without suggesting retired Creator commands', () => {
    const summary = buildBundleResumeSummary(state());
    expect(summary).toMatchObject({
      currentStep: 'needs-eval',
      evidencePaths: { draft: '/project/.comet/bundle-drafts/demo-skill' },
      missing: [
        'Passing eval evidence for the current draft',
        'Review approval for the current draft',
      ],
      recommendedNextStep: {
        action: 'choose-eval-level',
        backendCommand: 'comet bundle eval-plan demo-skill --level quick',
      },
    });
    expect(JSON.stringify(summary)).not.toContain('comet creator');
    const approved = state({
      status: 'review-approved',
      eval: {
        level: 'quick',
        hash: 'a'.repeat(64),
        resultPath: '/project/result.json',
        passed: true,
      },
      review: {
        hash: 'a'.repeat(64),
        decision: 'approved',
        reviewer: 'human',
        at: '2026-10-06T00:00:00Z',
      },
    });
    expect(buildBundleResumeSummary(approved)).toMatchObject({
      currentStep: 'needs-publish',
      recommendedNextStep: { action: 'publish' },
    });
  });

  it('requests review again when the current-hash review was rejected', () => {
    const reviewedState = state({
      status: 'draft',
      eval: {
        hash: 'a'.repeat(64),
        level: 'quick',
        resultPath: '/project/.comet/bundle-drafts/demo-skill/eval-result.json',
        passed: true,
      },
      review: {
        hash: 'a'.repeat(64),
        decision: 'rejected',
        reviewer: 'qa',
        at: '2026-06-24T00:00:00.000Z',
      },
    });

    expect(determineBundleNextAction(reviewedState)).toMatchObject({
      action: 'request-review',
      category: 'review',
    });

    expect(buildBundleResumeSummary(reviewedState)).toMatchObject({
      currentStep: 'needs-review',
      recommendedNextStep: {
        action: 'request-review',
      },
    });
  });
});
