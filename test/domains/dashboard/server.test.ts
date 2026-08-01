import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { startDashboardServer } from '../../../domains/dashboard/server.js';
import { resolveDashboardStaticPath } from '../../../domains/dashboard/server.js';

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

// vitest's bundled fetch (undici) refuses to bind a 127.0.0.1 outbound on
// some macOS configs (EADDRNOTAVAIL with Local 0.0.0.0). The native http
// client picks the right local address, so the server tests use it directly.
function request(port: number, urlPath: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('startDashboardServer', () => {
  let projectDir: string;
  let webDir: string;
  let handles: Array<{ close: () => Promise<void> }> = [];

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-srv-proj-'));
    webDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-srv-web-'));
    await fs.writeFile(
      path.join(webDir, 'index.html'),
      '<!doctype html><title>Dashboard</title><p>hi</p>',
    );
    await fs.writeFile(path.join(webDir, 'app.js'), 'console.log(1);');
  });

  afterEach(async () => {
    await Promise.all(handles.map((h) => h.close().catch(() => undefined)));
    handles = [];
    await fs.rm(projectDir, { recursive: true, force: true });
    await fs.rm(webDir, { recursive: true, force: true });
  });

  it('serves /api/dashboard with a valid snapshot payload', async () => {
    const handle = await startDashboardServer({
      projectPath: projectDir,
      port: 0,
      webRoot: webDir,
    });
    handles.push(handle);

    const res = await request(handle.port, '/api/dashboard');
    expect(res.status).toBe(200);
    const snap = JSON.parse(res.body) as Record<string, unknown>;

    expect(snap).toMatchObject({
      project: expect.objectContaining({ path: projectDir }),
      summary: expect.objectContaining({
        activeChanges: 0,
        archivedChanges: 0,
      }),
      changes: { active: [], archived: [] },
    });
  });

  it('lists the current project and only resolves snapshot requests by registered project id', async () => {
    const handle = await startDashboardServer({
      projectPath: projectDir,
      port: 0,
      webRoot: webDir,
    });
    handles.push(handle);

    const directoryResponse = await request(handle.port, '/api/dashboard/projects');
    expect(directoryResponse.status).toBe(200);
    const directory = JSON.parse(directoryResponse.body) as {
      currentProjectId: string;
      projects: Array<{ id: string; path: string }>;
    };
    expect(directory.projects).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: projectDir })]),
    );

    const snapshotResponse = await request(
      handle.port,
      `/api/dashboard/projects/${directory.currentProjectId}`,
    );
    expect(snapshotResponse.status).toBe(200);
    expect(JSON.parse(snapshotResponse.body)).toMatchObject({
      project: expect.objectContaining({ path: projectDir }),
    });

    const unknownResponse = await request(handle.port, '/api/dashboard/projects/not-a-project-id');
    expect(unknownResponse.status).toBe(404);
    expect(JSON.parse(unknownResponse.body)).toEqual({ error: 'Unknown dashboard project id' });
  });
  it('serves the static index for the root path', async () => {
    const handle = await startDashboardServer({
      projectPath: projectDir,
      port: 0,
      webRoot: webDir,
    });
    handles.push(handle);

    const res = await request(handle.port, '/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Dashboard');
  });

  it('serves static assets next to index.html', async () => {
    const handle = await startDashboardServer({
      projectPath: projectDir,
      port: 0,
      webRoot: webDir,
    });
    handles.push(handle);

    const res = await request(handle.port, '/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
    expect(res.body).toContain('console.log');
  });

  it('rejects static paths that escape its web root', () => {
    expect(resolveDashboardStaticPath(webDir, '/../etc/passwd')).toBeNull();
  });

  it('rejects encoded path traversal attempts', async () => {
    const handle = await startDashboardServer({
      projectPath: projectDir,
      port: 0,
      webRoot: webDir,
    });
    handles.push(handle);

    const response = await request(handle.port, '/%2e%2e/etc/passwd');
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: 'Not found' });
  });

  it('falls back to the next available port when the requested one is taken', async () => {
    const blocker = await new Promise<net.Server>((resolve) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => resolve(server));
    });
    const blockedPort = (blocker.address() as net.AddressInfo).port;

    try {
      const handle = await startDashboardServer({
        projectPath: projectDir,
        port: blockedPort,
        webRoot: webDir,
      });
      handles.push(handle);
      expect(handle.port).toBeGreaterThan(blockedPort);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});
