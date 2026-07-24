import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readNativeChange: vi.fn(),
  advanceRuntimeNativeChange: vi.fn(),
}));

vi.mock('../../../domains/comet-native/native-change.js', () => ({
  readNativeChange: mocks.readNativeChange,
}));

vi.mock('../../../domains/comet-native/native-transitions.js', () => ({
  advanceNativeChange: mocks.advanceRuntimeNativeChange,
}));

import { advanceNativeChange } from '../../helpers/native-confirmed-transition.js';

describe('advanceNativeChange test helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to runtime creation only when the change is missing', async () => {
    const missing = Object.assign(new Error('missing change'), {
      code: 'ENOENT',
    });
    const created = { phase: 'build' };
    mocks.readNativeChange.mockRejectedValue(missing);
    mocks.advanceRuntimeNativeChange.mockResolvedValue(created);

    await expect(
      advanceNativeChange({
        paths: {} as never,
        name: 'missing-change',
        evidence: { summary: 'confirmed' },
      }),
    ).resolves.toBe(created);
    expect(mocks.advanceRuntimeNativeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        clarificationMode: 'sequential',
        name: 'missing-change',
      }),
    );
  });

  it('does not hide malformed state or filesystem failures', async () => {
    const failure = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    mocks.readNativeChange.mockRejectedValue(failure);

    await expect(
      advanceNativeChange({
        paths: {} as never,
        name: 'unreadable-change',
        evidence: { summary: 'confirmed' },
      }),
    ).rejects.toBe(failure);
    expect(mocks.advanceRuntimeNativeChange).not.toHaveBeenCalled();
  });
});
