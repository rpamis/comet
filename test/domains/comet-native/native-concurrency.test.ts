import { describe, expect, it } from 'vitest';

import { mapWithConcurrency } from '../../../domains/comet-native/native-concurrency.js';

describe('Native bounded concurrency', () => {
  it('limits active work while preserving input order', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value === 1 ? 8 : 1));
      active -= 1;
      return value * 2;
    });

    expect(peak).toBe(2);
    expect(result).toEqual([2, 4, 6, 8, 10, 12]);
  });
});
