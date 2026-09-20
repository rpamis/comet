import { describe, expect, it, vi } from 'vitest';

import { withTransientFileWriteRetry } from '../../scripts/lib/transient-file-write.mjs';

function fileError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe('transient generated-file writes', () => {
  it.each(['UNKNOWN', 'EPERM', 'EACCES', 'EBUSY'])(
    'retries a transient %s sharing failure',
    async (code) => {
      const operation = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(fileError(code))
        .mockResolvedValue('written');
      const wait = vi.fn(async () => undefined);

      await expect(withTransientFileWriteRetry(operation, { delaysMs: [1], wait })).resolves.toBe(
        'written',
      );
      expect(operation).toHaveBeenCalledTimes(2);
      expect(wait).toHaveBeenCalledWith(1);
    },
  );

  it('does not retry a permanent write failure', async () => {
    const operation = vi.fn<() => Promise<void>>().mockRejectedValue(fileError('ENOSPC'));
    const wait = vi.fn(async () => undefined);

    await expect(
      withTransientFileWriteRetry(operation, { delaysMs: [1], wait }),
    ).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('surfaces the last transient failure after the retry budget', async () => {
    const operation = vi.fn<() => Promise<void>>().mockRejectedValue(fileError('UNKNOWN'));
    const wait = vi.fn(async () => undefined);

    await expect(
      withTransientFileWriteRetry(operation, { delaysMs: [1, 2], wait }),
    ).rejects.toMatchObject({ code: 'UNKNOWN' });
    expect(operation).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 1);
    expect(wait).toHaveBeenNthCalledWith(2, 2);
  });
});
