import { describe, expect, it } from 'vitest';

import { runSemanticMemoryEval } from '../../../domains/eval/semantic-memory-eval.js';

describe('semantic memory eval', () => {
  it('compares the real current-observe baseline with semantic memory', async () => {
    const first = await runSemanticMemoryEval();
    const second = await runSemanticMemoryEval();

    expect(first.provenance).toEqual(second.provenance);
    expect(first.metrics.treatmentHashes).toEqual(second.metrics.treatmentHashes);
    expect(first.cases.map((entry) => stableSemantic(entry.semantic))).toEqual(
      second.cases.map((entry) => stableSemantic(entry.semantic)),
    );
    expect(first.schema).toBe('comet.semantic-memory.eval.v1');
    expect(first.provenance.skillHash).toMatch(/^sha256:/);
    expect(first.provenance.runtimeHash).toMatch(/^sha256:/);
    expect(first.provenance.datasetHash).toMatch(/^sha256:/);
    expect(first.provenance.rubricHash).toMatch(/^sha256:/);
    expect(first.metrics.totalCases).toBeGreaterThanOrEqual(15);
    expect(first.cases.filter((entry) => !entry.passed)).toEqual([]);
    expect(first.metrics.passedCases).toBe(first.metrics.totalCases);
    expect(first.metrics.noiseSkipped).toBeGreaterThan(0);
    expect(first.metrics.usefulActivated).toBeGreaterThanOrEqual(2);
    expect(first.metrics.securityRejected).toBeGreaterThanOrEqual(1);
    expect(first.metrics.idempotentRepeats).toBeGreaterThanOrEqual(1);
    expect(first.metrics.scopeCorrect).toBe(true);
    expect(first.metrics.languageCorrect).toBe(true);
    expect(first.metrics.abstainCorrect).toBe(true);
    expect(first.metrics.downstreamImpactCases).toBeGreaterThan(0);
    expect(first.metrics.baselineNoiseRecords).toBeGreaterThan(first.metrics.semanticRecords);
    expect(first.metrics.conflictProtected).toBe(true);
    expect(first.metrics.globalEvidenceCorrect).toBe(true);
    expect(first.metrics.pauseCorrect).toBe(true);
    expect(first.metrics.syncFallbackCorrect).toBe(true);
    expect(first.metrics.actionAccuracy).toBe(1);
    expect(first.metrics.skipAccuracy).toBeGreaterThan(0.9);
    expect(first.metrics.extractionPrecision).toBe(1);
    expect(first.metrics.extractionRecall).toBe(1);
    expect(first.metrics.harmfulOrNoisySaveRate).toBe(0);
    expect(first.metrics.staleResurrectionRate).toBe(0);
    expect(first.metrics.timeoutRate).toBe(0);
    expect(first.metrics.degradationRate).toBe(0);
    expect(first.metrics.latencyMs).toBeGreaterThan(0);
    expect(first.metrics.thresholds).toMatchObject({
      minActionAccuracy: 1,
      maxHarmfulOrNoisySaveRate: 0,
      maxTimeoutRate: 0,
    });
    expect(first.metrics.thresholdsPassed).toBe(true);
    expect(
      first.cases.find((entry) => entry.id === 'allow-global-trial-before-cross-project-promotion')
        ?.treatments.currentObserve.correct,
    ).toBe(false);
    expect(
      first.cases.find((entry) => entry.id === 'allow-global-trial-before-cross-project-promotion')
        ?.treatments.currentObserve.downstreamAction,
    ).toContain('Workflow command summary completed');
    expect(first.metrics.treatmentHashes.semanticReview).toMatch(/^sha256:/);
    expect(
      first.cases.every(
        (entry) =>
          entry.input.projectIdentity !== undefined &&
          entry.input.stableCheckpoint !== undefined &&
          entry.input.inputEvidence !== undefined &&
          entry.input.existingMemory !== undefined &&
          entry.input.expectedPersistence !== undefined &&
          entry.input.followUpQuery !== undefined &&
          entry.semantic.actualAction === entry.input.expectedAction &&
          entry.semantic.persistedState !== undefined &&
          entry.semantic.retrievalSummary !== undefined &&
          entry.treatments.noMemory !== undefined &&
          entry.treatments.currentObserve !== undefined &&
          entry.treatments.semanticReview !== undefined &&
          entry.treatments.semanticReview.correct &&
          entry.persistenceDiff !== undefined &&
          entry.judge.mode === 'frozen-rubric-deterministic-judge' &&
          entry.scoringEvidence.length > 0 &&
          entry.baseline.model === 'current-observe-runtime-v1' &&
          entry.baseline.actualAction === 'record-command-summary',
      ),
    ).toBe(true);
    expect(first.cases.some((entry) => entry.id === 'skip-zh-one-time-request')).toBe(true);
    expect(first.cases.every((entry) => entry.failureCategories.length === 0)).toBe(true);
    expect(
      first.cases.some((entry) => entry.semantic.downstream?.requiresUserCorrection === false),
    ).toBe(true);
    expect(
      first.cases
        .filter((entry) => entry.semantic.downstream !== undefined)
        .every(
          (entry) =>
            (entry.semantic.downstream?.retrievalRecordCount ?? 0) > 0 &&
            (entry.semantic.downstream?.noMemoryLatencyMs ?? 0) > 0 &&
            (entry.semantic.downstream?.baselineLatencyMs ?? 0) > 0 &&
            (entry.semantic.downstream?.semanticLatencyMs ?? 0) > 0,
        ),
    ).toBe(true);
    expect(first.markdown).toContain('Semantic Memory Eval');
    expect(first.markdown).toContain('Baseline noise records');
    expect(first.markdown).toContain('No-memory treatment');
    expect(first.markdown).toContain('## Formation quality');
    expect(first.markdown).toContain('## Retrieval quality');
    expect(first.markdown).toContain('## Downstream behavior');
    expect(first.markdown).toContain('## Frozen thresholds');
    expect(first.markdown).not.toMatch(/password|Bearer|sk-[A-Za-z0-9]/i);
    expect(JSON.stringify(first)).not.toMatch(
      /secret-value|person@example\.com|Ignore previous instructions/i,
    );
  });
});

function stableSemantic<T extends { downstream?: Record<string, unknown> }>(semantic: T) {
  if (semantic.downstream === undefined) return semantic;
  const {
    noMemoryLatencyMs: _noMemoryLatencyMs,
    baselineLatencyMs: _baselineLatencyMs,
    semanticLatencyMs: _semanticLatencyMs,
    ...downstream
  } = semantic.downstream;
  return { ...semantic, downstream };
}
