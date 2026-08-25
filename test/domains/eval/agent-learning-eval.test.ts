import { describe, expect, it } from 'vitest';

import {
  AGENT_LEARNING_EVAL_SCHEMA,
  runAgentLearningEval,
} from '../../../domains/eval/agent-learning-eval.js';

describe('agent learning eval', () => {
  it('covers formation and retrieval quality across both learning domains', async () => {
    const report = await runAgentLearningEval();

    expect(report.schema).toBe(AGENT_LEARNING_EVAL_SCHEMA);
    expect(report.formation.cases.map((entry) => entry.id)).toEqual([
      'explicit-preference',
      'implicit-correction',
      'one-time-instruction',
      'failure-resolution',
      'review-decision',
      'archive-reflection',
      'project-constraint',
    ]);
    expect(report.formation.cases.filter((entry) => !entry.passed)).toEqual([]);
    expect(report.formation.passRate).toBe(1);
    expect(report.formation.cases.every((entry) => entry.passed)).toBe(true);
    expect(report.retrieval.targetRecall).toBe(1);
    expect(report.retrieval.falseApplicationRate).toBe(0);
    expect(report.retrieval.contextSavingsRatio).toBeGreaterThan(0.5);
    expect(report.retrieval.injectedContextBytes).toBeLessThan(report.retrieval.naiveContextBytes);
    expect(report.retrieval.feedbackRankingChanged).toBe(true);
    expect(report.passed).toBe(true);
  });
});
