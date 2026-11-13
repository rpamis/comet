import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'mcp-dashboard-browser.spec.ts',
  workers: 1,
  timeout: 120_000,
  outputDir: '../../../coverage/playwright-mcp-results',
  reporter: 'list',
  use: { trace: 'retain-on-failure', timezoneId: 'Asia/Shanghai' },
});
