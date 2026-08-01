import { describe, expect, it, vi } from 'vitest';

import {
  memoizedHookReadSync,
  runWithHookReadCache,
} from '../../platform/process/hook-read-cache.js';

describe('Hook read cache', () => {
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
