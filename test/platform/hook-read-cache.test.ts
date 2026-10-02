import { describe, expect, it, vi } from 'vitest';

import {
  invalidateHookReadCache,
  memoizedHookRead,
  memoizedHookReadSync,
  runWithHookReadCache,
} from '../../platform/process/hook-read-cache.js';

describe('Hook read cache', () => {
  it('keeps overlapping requests isolated and shares nested reads only within their request', async () => {
    let value = 0;
    const cached = memoizedHookRead('isolated-value', async () => ++value);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = runWithHookReadCache(async () => {
      const initial = await cached();
      entered();
      await blocked;
      return [initial, await runWithHookReadCache(() => cached())];
    });
    await ready;
    try {
      expect(await runWithHookReadCache(() => cached())).toBe(2);
    } finally {
      release();
    }
    expect(await first).toEqual([1, 1]);
    expect(await cached()).toBe(3);
  });

  it('reloads after invalidation without retaining a pending result or its failure', async () => {
    let reject!: (error: Error) => void;
    const failed = new Promise<number>((_resolve, fail) => {
      reject = fail;
    });
    const factory = vi.fn().mockReturnValueOnce(failed).mockResolvedValueOnce(2);
    const cached = memoizedHookRead('invalidate-pending', factory);
    await runWithHookReadCache(async () => {
      const old = cached();
      invalidateHookReadCache();
      expect(await cached()).toBe(2);
      reject(new Error('obsolete read failed'));
      await expect(old).rejects.toThrow('obsolete read failed');
      expect(await cached()).toBe(2);
      expect(factory).toHaveBeenCalledTimes(2);
    });
  });

  it('returns the original synchronous value on repeated cache hits', async () => {
    const factory = vi.fn((value: string) => `value:${value}`);
    const cached = memoizedHookReadSync('sync-value', factory);

    const result = await runWithHookReadCache(async () => ({
      first: cached('x'),
      second: cached('x'),
    }));

    expect(result).toEqual({ first: 'value:x', second: 'value:x' });
    expect(result.second).not.toBeInstanceOf(Promise);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
