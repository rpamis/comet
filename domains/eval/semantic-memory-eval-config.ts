import { createHash } from 'node:crypto';

/** Frozen after the first semantic-memory baseline; changes require a new eval version. */
export const SEMANTIC_MEMORY_EVAL_THRESHOLDS = Object.freeze({
  minActionAccuracy: 1,
  minExtractionPrecision: 1,
  minExtractionRecall: 1,
  minSkipAccuracy: 0.9,
  minRetrievalRecall: 1,
  minDownstreamTaskSuccessDelta: 1,
  maxHarmfulOrNoisySaveRate: 0,
  maxScopeErrorDelta: 0,
  maxLanguageErrorDelta: 0,
  maxStaleResurrectionRate: 0,
  maxStaleResurrectionDelta: 0,
  maxTimeoutRate: 0,
  maxDegradationRate: 0,
  maxLatencyMs: 250,
});

export const SEMANTIC_MEMORY_EVAL_CONFIG_VERSION = 'semantic-memory-eval-config-v1';
export const SEMANTIC_MEMORY_EVAL_CONFIG_HASH = `sha256:${createHash('sha256')
  .update(
    JSON.stringify({
      version: SEMANTIC_MEMORY_EVAL_CONFIG_VERSION,
      thresholds: SEMANTIC_MEMORY_EVAL_THRESHOLDS,
    }),
  )
  .digest('hex')}`;
