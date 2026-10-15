import { describe, expect, it } from 'vitest';

import { mapWithConcurrency } from '../../../domains/comet-native/native-concurrency.js';

describe('Native bounded concurrency', () => {
  it('drains started work and stops scheduling after a failure', async () => {
    const started: number[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finished = false;
    const failure = new Error('read failed');
    const result = mapWithConcurrency([0, 1, 2, 3], 2, async (value) => {
      started.push(value);
      if (value === 0) throw failure;
      await pending;
      finished = true;
      return value;
    });
    let settled = false;
    const observed = result.catch((error) => {
      settled = true;
      return error;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const settledBeforeDrain = settled;
    release();
    expect(await observed).toBe(failure);
    expect(settledBeforeDrain).toBe(false);
    expect(finished).toBe(true);
    expect(started).toEqual([0, 1]);
  });

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
