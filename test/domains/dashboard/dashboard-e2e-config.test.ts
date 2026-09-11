import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Dashboard browser verification freshness', () => {
  it('uses the current dashboard build and rejects an unknown preview server', async () => {
    const [config, server] = await Promise.all([
      fs.readFile(path.resolve('test', 'domains', 'dashboard', 'playwright.config.ts'), 'utf8'),
      fs.readFile(path.resolve('scripts', 'dashboard-e2e-server.mjs'), 'utf8'),
    ]);

    expect(config).toContain('node ../../../scripts/dashboard-e2e-server.mjs');
    expect(config).toContain('reuseExistingServer: false');
    expect(server).toContain("'--strictPort'");
  });
});
