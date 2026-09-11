import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'dashboard-browser.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  outputDir: 'coverage/playwright-results',
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never', outputFolder: 'coverage/playwright-report' }]]
    : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node ../../../scripts/dashboard-e2e-server.mjs',
    url: 'http://127.0.0.1:4173/?demo',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
