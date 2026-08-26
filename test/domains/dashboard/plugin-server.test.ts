import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  DashboardPluginHost,
  type DashboardPluginPageRegistration,
} from '../../../domains/dashboard/plugin-host.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
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
        invoke: async (capability: string, input: unknown) => {
          if (capability === 'echo') return input;
          throw new Error('capability exploded');
        },
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
    let hostFactoryCalls = 0;
    const server = await startDashboardServer({
      projectPath,
      port: 0,
      webRoot,
      pluginHost: async (projectId) => {
        hostFactoryCalls += 1;
        return new DashboardPluginHost({ runtime, projectId, pages });
      },
    });
    close = server.close;

    const directory = JSON.parse((await request(server.port, '/api/dashboard/projects')).body) as {
      currentProjectId: string;
    };
    const base = `/api/dashboard/projects/${directory.currentProjectId}`;
    let list!: ResponsePayload;
    let page!: ResponsePayload;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      list = await request(server.port, `${base}/plugins`);
      expect(list.status).toBe(200);
      expect(JSON.parse(list.body)).toMatchObject({
        pages: [expect.objectContaining({ pluginId: 'test.dashboard', status: 'enabled' })],
      });
      page = await request(server.port, `${base}/plugins/test.dashboard`);
      expect(hostFactoryCalls).toBe(1);
    } finally {
      clock.mockRestore();
    }
    expect(page.status).toBe(200);
    expect(JSON.parse(page.body)).toMatchObject({ data: { value: { ok: true } } });
    const invoke = await request(server.port, `${base}/plugins/test.dashboard/invoke`, 'POST', {
      capability: 'echo',
      input: { from: 'dashboard' },
    });
    expect(invoke.status).toBe(200);
    expect(JSON.parse(invoke.body)).toEqual({ result: { from: 'dashboard' } });
    const failedInvoke = await request(
      server.port,
      `${base}/plugins/test.dashboard/invoke`,
      'POST',
      { capability: 'broken', input: {} },
    );
    expect(failedInvoke.status).toBe(400);
    expect(JSON.parse(failedInvoke.body)).toEqual({
      error: 'capability exploded',
      pluginId: 'test.dashboard',
    });

    const disabled = await request(
      server.port,
      `${base}/plugins/test.dashboard/lifecycle`,
      'POST',
      { action: 'disable' },
    );
    expect(disabled.status).toBe(200);
    await expect(request(server.port, `${base}/plugins/test.dashboard`)).resolves.toMatchObject({
      status: 200,
      body: expect.stringContaining('"data":null'),
    });

    const enabled = await request(server.port, `${base}/plugins/test.dashboard/lifecycle`, 'POST', {
      action: 'enable',
    });
    expect(enabled.status).toBe(200);
    await expect(request(server.port, `${base}/plugins/test.dashboard`)).resolves.toMatchObject({
      status: 200,
      body: expect.stringContaining('"value"'),
    });

    const uninstalled = await request(
      server.port,
      `${base}/plugins/test.dashboard/lifecycle`,
      'POST',
      { action: 'uninstall' },
    );
    expect(uninstalled.status).toBe(200);
    expect(JSON.parse((await request(server.port, `${base}/plugins`)).body)).toEqual({ pages: [] });
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
    expect(JSON.parse(response.body)).toEqual({
      error: 'Plugin capability is required',
      pluginId: 'missing',
    });
  });

  it('loads and updates the current project Comet configuration', async () => {
    await writeProjectConfig(projectPath, defaultProjectConfig('docs'));
    const server = await startDashboardServer({ projectPath, port: 0, webRoot });
    close = server.close;
    const directory = JSON.parse((await request(server.port, '/api/dashboard/projects')).body) as {
      currentProjectId: string;
    };
    const endpoint = `/api/dashboard/projects/${directory.currentProjectId}/config`;
    const loadedResponse = await request(server.port, endpoint);
    expect(loadedResponse.status).toBe(200);
    const loaded = JSON.parse(loadedResponse.body) as {
      revision: string;
      defaultWorkflow: 'native' | 'classic';
      workflows: Array<'native' | 'classic'>;
      ambientResume: boolean;
      hookAllowPaths: string[];
      native: Record<string, unknown>;
      classic: Record<string, unknown>;
    };

    const updatedResponse = await request(server.port, endpoint, 'POST', {
      expectedRevision: loaded.revision,
      config: {
        defaultWorkflow: loaded.defaultWorkflow,
        workflows: loaded.workflows,
        ambientResume: false,
        hookAllowPaths: ['docs/generated'],
        native: loaded.native,
        classic: loaded.classic,
      },
    });
    expect(updatedResponse.status).toBe(200);
    expect(JSON.parse(updatedResponse.body)).toMatchObject({
      ambientResume: false,
      hookAllowPaths: ['docs/generated'],
    });
  });
});
