import { afterEach, describe, expect, it, vi } from 'vitest';

const { loaded, get } = vi.hoisted(() => ({ loaded: vi.fn(), get: vi.fn() }));
vi.mock('https', () => {
  loaded();
  return { default: { get } };
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('version module loading', () => {
  it('loads HTTPS only when a registry update is requested', async () => {
    const version = await import('../../platform/version/version.js');
    expect(version.getCurrentVersion()).toMatch(/^\d+\.\d+\.\d+/u);
    expect(version.compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(loaded).not.toHaveBeenCalled();
    get.mockImplementation((_url, options, callback) => {
      expect(options.timeout).toBe(5000);
      callback({ statusCode: 503, resume: vi.fn() });
      return { on: vi.fn() };
    });
    expect(await version.getLatestVersion()).toBeNull();
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
