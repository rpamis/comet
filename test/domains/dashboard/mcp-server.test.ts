import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDashboardMcpServer, DASHBOARD_UI_URI } from '../../../plugin/codex/mcp-server.js';

let fixture: string;
let close: (() => Promise<void>) | undefined;
beforeEach(async () => {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-mcp-server-'));
  vi.spyOn(os, 'homedir').mockReturnValue(path.join(fixture, 'home'));
  await fs.writeFile(path.join(fixture, 'index.html'), '<title>Comet Dashboard</title>');
});
afterEach(async () => {
  await close?.();
  close = undefined;
  vi.restoreAllMocks();
  await fs.rm(fixture, { recursive: true, force: true });
});

it('advertises independent sidebar and thread entrypoints with a static cached UI and fresh private connection details', async () => {
  const application = createDashboardMcpServer({
    projectPath: fixture,
    webRoot: fixture,
    appHtml: '<title>MCP Dashboard</title>',
    icon: 'data:image/png;base64,comet-logo',
  });
  close = application.close;
  const client = new Client({ name: 'dashboard-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await application.server.connect(serverTransport);
  await client.connect(clientTransport);
  expect(client.getServerVersion()?.icons).toEqual([
    { src: 'data:image/png;base64,comet-logo', mimeType: 'image/png', sizes: ['500x500'] },
  ]);
  const { tools } = await client.listTools();
  expect(tools.find((tool) => tool.name === 'open_dashboard')?._meta?.['openai/ui']).toEqual({
    entrypoints: [{ type: 'global' }],
  });
  expect(tools.find((tool) => tool.name === 'show_dashboard')?._meta?.['openai/ui']).toEqual({
    entrypoints: [{ type: 'thread' }],
  });
  const resourceBefore = await client.readResource({ uri: DASHBOARD_UI_URI });
  const legacyResource = await client.readResource({ uri: 'ui://comet/dashboard' });
  expect(legacyResource.contents).toEqual(
    resourceBefore.contents.map((content) => ({ ...content, uri: 'ui://comet/dashboard' })),
  );
  expect(resourceBefore.contents[0].mimeType).toBe('text/html;profile=mcp-app');
  expect(resourceBefore.contents[0]._meta?.ui).toEqual({
    csp: { frameDomains: [], connectDomains: [], resourceDomains: ['data:', 'blob:'] },
  });
  const opened = await client.callTool({ name: 'open_dashboard', arguments: {} });
  expect(opened.isError).not.toBe(true);
  const url = String(opened._meta?.dashboardUrl);
  expect(url).toMatch(/^http:\/\/localhost:\d+\/embedded\/[a-f0-9]{64}$/u);
  expect(JSON.stringify(opened.content)).not.toContain(url);
  expect(JSON.stringify(opened.structuredContent)).not.toContain(url);
  const second = await client.callTool({ name: 'show_dashboard', arguments: {} });
  expect(second._meta?.dashboardUrl).toBe(url);
  expect((await client.readResource({ uri: DASHBOARD_UI_URI })).contents).toEqual(
    resourceBefore.contents,
  );
  const response = await fetch(url, {
    headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'iframe' },
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('Comet Dashboard');
  await client.close();
  await application.close();
  await expect(fetch(url)).rejects.toThrow();
});

it('serves Dashboard API data through app-only tools and rejects paths outside its local API', async () => {
  const application = createDashboardMcpServer({
    projectPath: fixture,
    webRoot: fixture,
    appHtml: '<title>MCP Dashboard</title>',
    icon: 'data:image/png;base64,comet-logo',
  });
  close = application.close;
  const client = new Client({ name: 'dashboard-api-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await application.server.connect(serverTransport);
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  for (const name of ['dashboard_read', 'dashboard_write']) {
    expect(tools.find((tool) => tool.name === name)?._meta?.ui).toEqual({ visibility: ['app'] });
  }
  const result = await client.callTool({
    name: 'dashboard_read',
    arguments: { path: '/api/dashboard/projects' },
  });
  expect(result.isError).not.toBe(true);
  const response = result._meta?.dashboardResponse as { status: number; body: string };
  expect(response.status).toBe(200);
  expect(JSON.parse(response.body).projects).toHaveLength(1);
  expect(JSON.stringify(result.content)).not.toContain(fixture);
  for (const invalid of [
    'https://example.com/api/dashboard',
    '//example.com/api/dashboard',
    '/api/dashboard/../../secret',
    '/api/dashboard/../dashboard/../secret',
    '/api/dashboard\\secret',
    '/api/dashboard#fragment',
    '/index.html',
  ]) {
    const rejected = await client.callTool({
      name: 'dashboard_read',
      arguments: { path: invalid },
    });
    expect(rejected.isError, invalid).toBe(true);
  }
  await client.close();
});
