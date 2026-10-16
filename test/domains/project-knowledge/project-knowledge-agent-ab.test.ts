import { describe, expect, test } from 'vitest';

import { summarizeAgentAB } from '../../../scripts/benchmark/project-knowledge-agent-ab.mjs';

describe('project knowledge Agent A/B harness', () => {
  test('requires provenance on every run before accepting the comparison as decision ready', () => {
    const runs = ['none', 'rg', 'fts', 'hybrid'].flatMap((mode) =>
      [1, 2, 3].map((replication) => ({
        mode,
        snapshotId: 'same-snapshot',
        model: 'same-model',
        promptVersion: 'same-prompt',
        worktreeId: `${mode}-${replication}`,
        supplementalQuerySet: 'supplemental-v1',
        success: true,
      })),
    );
    expect(summarizeAgentAB(runs).evidence.decisionReady).toBe(true);
    const incomplete = runs.map((entry, index) =>
      index === 1 ? { ...entry, snapshotId: undefined } : entry,
    );
    expect(summarizeAgentAB(incomplete).evidence).toMatchObject({
      decisionReady: false,
      missing: ['snapshotId'],
    });
  });
  test('compares success, exploration, and change coverage without storing transcripts', () => {
    const report = summarizeAgentAB([
      {
        mode: 'none',
        success: true,
        searchesBeforeEdit: 10,
        changeCoverage: 0.8,
        firstGoldModuleTurns: 4,
        tokens: 1000,
        toolCalls: 12,
        latencyMs: 200,
      },
      {
        mode: 'hybrid',
        success: true,
        searchesBeforeEdit: 7,
        changeCoverage: 0.9,
        firstGoldModuleTurns: 2,
        tokens: 700,
        toolCalls: 8,
        latencyMs: 120,
      },
    ]);
    expect(report.schema).toBe('comet.project-knowledge.agent-ab.v1');
    expect(report.comparison.hybridSuccessNotLower).toBe(true);
    expect(report.comparison.explorationReduction).toBeCloseTo(0.3);
    expect(report.comparison.changeCoverageNotLower).toBe(true);
  });
});
