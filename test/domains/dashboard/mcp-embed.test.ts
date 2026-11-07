import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  startDashboardServer,
  type DashboardServerHandle,
} from '../../../domains/dashboard/server.js';

let fixture: string;
let handle: DashboardServerHandle | undefined;
const token = 'a'.repeat(64);

beforeEach(async () => {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-mcp-embed-'));
  vi.spyOn(os, 'homedir').mockReturnValue(path.join(fixture, 'home'));
  await fs.writeFile(path.join(fixture, 'index.html'), '<title>Comet Dashboard</title>');
});
afterEach(async () => {
  await handle?.close();
  handle = undefined;
  vi.restoreAllMocks();
  await fs.rm(fixture, { recursive: true, force: true });
});

async function request(route: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>(
    (resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: handle!.port,
          path: route,
          method,
          headers: { host: `localhost:${handle!.port}`, ...headers },
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8').on('data', (data) => {
            body += data;
          });
          res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }));
        },
      );
      req.on('error', reject);
      req.end();
    },
  );
}

it('permits only token-bound iframe navigation while retaining normal API origin checks', async () => {
  handle = await startDashboardServer({
    projectPath: fixture,
    webRoot: fixture,
    port: 0,
    embedToken: token,
  });
  const crossSite = {
    'sec-fetch-site': 'cross-site',
    'sec-fetch-dest': 'iframe',
    origin: 'https://chatgpt.com',
  };
  const entry = await request(`/embedded/${token}`, crossSite);
  expect(entry.status).toBe(200);
  expect(entry.body).toContain('Comet Dashboard');
  expect(entry.headers['referrer-policy']).toBe('no-referrer');
  expect(entry.headers['access-control-allow-origin']).toBeUndefined();
  for (const route of [
    '/',
    `/embedded/${'b'.repeat(64)}`,
    `/embedded/${token}?other=1`,
    `/api/dashboard?token=${token}`,
  ]) {
    expect((await request(route, crossSite)).status, route).toBe(403);
  }
  expect(
    (await request(`/embedded/${token}`, { ...crossSite, 'sec-fetch-dest': 'document' })).status,
  ).toBe(403);
  expect((await request(`/embedded/${token}`, crossSite, 'POST')).status).toBe(403);
  expect(
    (await request(`/embedded/${token}`, { ...crossSite, host: 'attacker.example' })).status,
  ).toBe(403);
  expect((await request('/')).status).toBe(200);
});

it('rejects predictable embed tokens before opening the listener', async () => {
  await expect(
    startDashboardServer({ projectPath: fixture, webRoot: fixture, port: 0, embedToken: 'short' }),
  ).rejects.toThrow('embed');
});
