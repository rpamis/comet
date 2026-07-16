import { describe, expect, it, vi } from 'vitest';

import { compareAndSwapNativeRevision } from '../../../domains/comet-native/native-revision.js';

describe('Native revision CAS protocol', () => {
  it('writes exactly one revision and treats an identical journal replay as idempotent', async () => {
    let stored = { revision: 1, value: 'before' };
    const write = vi.fn(async (next: typeof stored) => {
      stored = next;
    });
    const options = {
      expectedRevision: 1,
      next: { revision: 2, value: 'after' },
      read: async () => stored,
      write,
      conflict: (actualRevision: number) => new Error(`conflict:${actualRevision}`),
    };

    await expect(compareAndSwapNativeRevision(options)).resolves.toEqual(options.next);
    await expect(compareAndSwapNativeRevision(options)).resolves.toEqual(options.next);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('rejects a different value based on a stale expected revision', async () => {
    await expect(
      compareAndSwapNativeRevision({
        expectedRevision: 1,
        next: { revision: 2, value: 'stale' },
        read: async () => ({ revision: 2, value: 'current' }),
        write: async () => undefined,
        conflict: (actualRevision) => new Error(`conflict:${actualRevision}`),
      }),
    ).rejects.toThrow('conflict:2');
  });
});
