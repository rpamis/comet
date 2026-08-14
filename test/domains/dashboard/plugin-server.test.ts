import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  DashboardPluginHost,
  type DashboardPluginPageRegistration,
} from '../../../domains/dashboard/plugin-host.js';
import { MemoryPluginStateStore, PluginRuntime } from '../../../domains/comet-plugin/index.js';
import { startDashboardServer } from '../../../domains/dashboard/server.js';

interface ResponsePayload {
  status: number;
  body: string;
}

function request(
  port: number,
  pathname: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
): Promise<ResponsePayload> {
  return new Promise((resolve, reject) => {
    const content = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method,
        headers: content
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(content) }
          : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    if (content) req.write(content);
    req.end();
  });
}

describe('Dashboard plugin HTTP API', () => {
  let projectPath: string;
  let webRoot: string;
  let close: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-dashboard-'));
    webRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-plugin-dashboard-web-'));
    await fs.writeFile(path.join(webRoot, 'index.html'), '<!doctype html>');
  });

  afterEach(async () => {
    await close?.();
    close = null;
    await fs.rm(projectPath, { recursive: true, force: true });
    await fs.rm(webRoot, { recursive: true, force: true });
  });

  it('lists pages, returns a page snapshot, and invokes a capability', async () => {
    const descriptor = {
      id: 'test.dashboard',
      kind: 'first-party' as const,
      version: '1.0.0',
      scopes: ['project'] as const,
      compatible: () => true,
      create: async () => ({
        dashboard: { id: 'test', label: '测试插件', route: '/plugins/test' },
        invoke: async (capability: string, input: unknown) =>
          capability === 'echo' ? input : null,
      }),
    };
    const runtime = new PluginRuntime({
      cometVersion: '0.4.0',
      store: new MemoryPluginStateStore(),
      descriptors: [descriptor],
    });
    await runtime.reconcileFirstParty();
    const pages: readonly DashboardPluginPageRegistration[] = [
      {
        pluginId: 'test.dashboard',
        label: '测试插件',
        route: '/plugins/test',
        load: async ({ invoke }) => ({ value: await invoke('echo', { ok: true }) }),
      },
    ];
    const server = await startDashboardServer({
      projectPath,
      port: 0,
      webRoot,
      pluginHost: async (projectId) => new DashboardPluginHost({ runtime, projectId, pages }),
    });
    close = server.close;

    const directory = JSON.parse((await request(server.port, '/api/dashboard/projects')).body) as {
      currentProjectId: string;
    };
    const base = `/api/dashboard/projects/${directory.currentProjectId}`;
    const list = await request(server.port, `${base}/plugins`);
    expect(list.status).toBe(200);
    expect(JSON.parse(list.body)).toMatchObject({
      pages: [expect.objectContaining({ pluginId: 'test.dashboard', status: 'enabled' })],
    });
    const page = await request(server.port, `${base}/plugins/test.dashboard`);
    expect(page.status).toBe(200);
    expect(JSON.parse(page.body)).toMatchObject({ data: { value: { ok: true } } });
    const invoke = await request(server.port, `${base}/plugins/test.dashboard/invoke`, 'POST', {
      capability: 'echo',
      input: { from: 'dashboard' },
    });
    expect(invoke.status).toBe(200);
    expect(JSON.parse(invoke.body)).toEqual({ result: { from: 'dashboard' } });
  });

  it('rejects malformed plugin actions instead of forwarding them', async () => {
    const runtime = new PluginRuntime({
      cometVersion: '0.4.0',
      store: new MemoryPluginStateStore(),
      descriptors: [],
    });
    const server = await startDashboardServer({
      projectPath,
      port: 0,
      webRoot,
      pluginHost: async () => new DashboardPluginHost({ runtime, projectId: 'project', pages: [] }),
    });
    close = server.close;
    const directory = JSON.parse((await request(server.port, '/api/dashboard/projects')).body) as {
      currentProjectId: string;
    };
    const response = await request(
      server.port,
      `/api/dashboard/projects/${directory.currentProjectId}/plugins/missing/invoke`,
      'POST',
      { input: {} },
    );
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: 'Plugin capability is required' });
  });
});
