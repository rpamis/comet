import { describe, expect, it, vi, afterEach } from 'vitest';
import https from 'https';
import {
  compareVersions,
  getCurrentVersion,
  checkForUpdate,
  printVersionInfo,
} from '../../src/core/version.js';

/**
 * Helper: mock https.get to return a specific response body.
 * Automatically restores after each test via vi.restoreAllMocks().
 */
function mockRegistryResponse(body: Record<string, unknown> | null): void {
  vi.spyOn(https, 'get').mockImplementation((_url: unknown, _opts: unknown, callback?: unknown) => {
    const cb = typeof _opts === 'function' ? _opts : (callback as (res: unknown) => void);
    const res = {
      statusCode: body ? 200 : 500,
      resume: vi.fn(),
      on: (event: string, handler: (chunk?: string) => void) => {
        if (event === 'data' && body) handler(JSON.stringify(body));
        if (event === 'end') handler();
      },
    };
    const req = {
      on: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
    };
    // Call the callback on next tick to simulate async
    setTimeout(() => cb(res), 0);
    return req as unknown as ReturnType<typeof https.get>;
  });
}

function mockRegistryError(): void {
  vi.spyOn(https, 'get').mockImplementation(() => {
    const req = {
      on: (event: string, handler: (err: Error) => void) => {
        if (event === 'error') setTimeout(() => handler(new Error('network error')), 0);
        return req;
      },
      destroy: vi.fn(),
    };
    return req as unknown as ReturnType<typeof https.get>;
  });
}

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.3.8', '0.3.8')).toBe(0);
  });

  it('returns positive when first version is greater', () => {
    expect(compareVersions('1.1.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.4.0', '0.3.8')).toBeGreaterThan(0);
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
  });

  it('returns negative when first version is smaller', () => {
    expect(compareVersions('1.0.0', '1.1.0')).toBeLessThan(0);
    expect(compareVersions('0.3.7', '0.3.8')).toBeLessThan(0);
    expect(compareVersions('1.9.9', '2.0.0')).toBeLessThan(0);
  });

  it('handles versions with v prefix', () => {
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('v1.1.0', 'v1.0.0')).toBeGreaterThan(0);
  });

  it('handles different length versions by padding with zeros', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', '1.0')).toBe(0);
    expect(compareVersions('1.1', '1.0.0')).toBeGreaterThan(0);
  });

  it('handles non-numeric parts as zero', () => {
    expect(compareVersions('1.0.beta', '1.0.0')).toBe(0);
  });
});

describe('getCurrentVersion', () => {
  it('returns a valid semver string', () => {
    const version = getCurrentVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+(?:-.+)?$/);
  });
});

describe('checkForUpdate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns correct shape when registry returns newer version', async () => {
    mockRegistryResponse({ version: '99.99.99' });

    const result = await checkForUpdate();
    expect(result.checked).toBe(true);
    expect(result.hasUpdate).toBe(true);
    expect(result.latestVersion).toBe('99.99.99');
    expect(result.currentVersion).toBe(getCurrentVersion());
  });

  it('returns hasUpdate false when already on latest', async () => {
    const currentVersion = getCurrentVersion();
    mockRegistryResponse({ version: currentVersion });

    const result = await checkForUpdate();
    expect(result.checked).toBe(true);
    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBe(currentVersion);
  });

  it('returns checked false when registry returns non-200', async () => {
    mockRegistryResponse(null);

    const result = await checkForUpdate();
    expect(result.checked).toBe(false);
    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBeNull();
  });

  it('returns checked false when network error occurs', async () => {
    mockRegistryError();

    const result = await checkForUpdate();
    expect(result.checked).toBe(false);
    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBeNull();
  });
});

describe('printVersionInfo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints current version and update available when newer version exists', async () => {
    mockRegistryResponse({ version: '99.99.99' });

    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    await printVersionInfo(log);

    expect(logs[0]).toMatch(/^  Comet v\d+\.\d+\.\d+(?:-.+)?$/);
    expect(logs[1]).toContain('99.99.99');
    expect(logs[1]).toContain('npm update -g');
  });

  it('prints latest version confirmation when on latest', async () => {
    mockRegistryResponse({ version: getCurrentVersion() });

    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    await printVersionInfo(log);

    expect(logs[0]).toMatch(/^  Comet v/);
    expect(logs[1]).toContain('latest version');
  });

  it('prints only version when registry is unreachable', async () => {
    mockRegistryError();

    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    await printVersionInfo(log);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^  Comet v/);
  });
});
