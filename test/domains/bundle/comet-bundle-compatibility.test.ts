import { describe, expect, it } from 'vitest';
import path from 'path';
import { runCometBundleCompatibilityBenchmark } from '../../../domains/bundle/compatibility-benchmark.js';

describe('current Comet Bundle compatibility benchmark', () => {
  it('reproduces the managed contracts for every registered platform', async () => {
    const result = await runCometBundleCompatibilityBenchmark({
      repoRoot: path.resolve('.'),
    });

    expect(result.platforms).toBe(33);
    expect(result.skillContractRate).toBe(1);
    expect(result.ruleContractRate).toBe(1);
    expect(result.hookContractRate).toBe(1);
    expect(result.referenceContractRate).toBe(1);
    expect(result.pathContractRate).toBe(1);
  }, 90_000);
});
