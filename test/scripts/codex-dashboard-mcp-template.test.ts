import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { renderDashboardMcpHtml } from '../../scripts/build/build-dashboard-mcp.mjs';

describe('Codex plugin package', () => {
  it('lets the Dashboard stylesheet control document overflow in the MCP resource', async () => {
    const template = await readFile('plugin/codex/web/mcp-app.html', 'utf8');
    const html = renderDashboardMcpHtml(template, '', 'html, body { overflow: auto; }');
    const { window } = new JSDOM(html);
    try {
      expect(window.getComputedStyle(window.document.documentElement).overflow).toBe('auto');
      expect(window.getComputedStyle(window.document.body).overflow).toBe('auto');
    } finally {
      window.close();
    }
  });
});
