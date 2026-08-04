import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { startDashboardServer } from '../../../domains/dashboard/server.js';
import { resolveDashboardStaticPath } from '../../../domains/dashboard/server.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  createNativeChange,
  nativeChangeDir,
} from '../../../domains/comet-native/native-change.js';

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

  it('serves paginated change rows and loads a selected change detail on demand', async () => {
    const changesRoot = path.join(projectDir, 'openspec', 'changes');
    await fs.mkdir(changesRoot, { recursive: true });
    for (let index = 0; index < 6; index += 1) {
      const changeDir = path.join(changesRoot, `server-${index}`);
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(path.join(changeDir, '.comet.yaml'), 'phase: build\n');
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] pending\n');
      await fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n');
    }

    const handle = await startDashboardServer({
      projectPath: projectDir,
      port: 0,
      webRoot: webDir,
    });
    handles.push(handle);

    const directoryResponse = await request(handle.port, '/api/dashboard/projects');
    const directory = JSON.parse(directoryResponse.body) as { currentProjectId: string };
    const base = `/api/dashboard/projects/${directory.currentProjectId}`;

    const overviewResponse = await request(handle.port, `${base}/overview`);
    expect(overviewResponse.status).toBe(200);
    expect(JSON.parse(overviewResponse.body)).toMatchObject({
      summary: { activeChanges: 6 },
    });
    expect(JSON.parse(overviewResponse.body)).not.toHaveProperty('changes');

    const pageResponse = await request(handle.port, `${base}/changes?status=active&limit=5`);
    expect(pageResponse.status).toBe(200);
    const page = JSON.parse(pageResponse.body) as {
      items: Array<{ id: string; status: string }>;
      total: number;
      nextCursor: string | null;
    };
    expect(page.total).toBe(6);
    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toEqual(expect.any(String));

    const detailResponse = await request(
      handle.port,
      `${base}/change?changeId=${encodeURIComponent(page.items[0].id)}`,
    );
    expect(detailResponse.status).toBe(200);
    expect(JSON.parse(detailResponse.body)).toMatchObject({
      id: page.items[0].id,
      artifacts: expect.any(Object),
      artifactPreviews: expect.any(Array),
    });
  });

  it('serves Native changes from a paginated endpoint instead of embedding them in overview', async () => {
    await writeProjectConfig(projectDir, defaultProjectConfig('docs'));
    const paths = await nativeProjectPaths(projectDir, 'docs');
    for (let index = 0; index < 6; index += 1) {
      const state = await createNativeChange({
        paths,
        name: `native-server-${index}`,
        language: 'en',
      });
      await fs.writeFile(path.join(nativeChangeDir(paths, state.name), 'brief.md'), '# Outcome\n');
    }

    const handle = await startDashboardServer({
      projectPath: projectDir,
      port: 0,
      webRoot: webDir,
    });
    handles.push(handle);

    const directoryResponse = await request(handle.port, '/api/dashboard/projects');
    const directory = JSON.parse(directoryResponse.body) as { currentProjectId: string };
    const base = `/api/dashboard/projects/${directory.currentProjectId}`;

    const overviewResponse = await request(handle.port, `${base}/overview`);
    expect(overviewResponse.status).toBe(200);
    expect(JSON.parse(overviewResponse.body)).toMatchObject({
      native: {
        totalChangeCount: 6,
        activeChangeCount: 6,
        changes: [],
      },
    });

    const firstResponse = await request(
      handle.port,
      `${base}/native-changes?status=active&limit=5`,
    );
    expect(firstResponse.status).toBe(200);
    const first = JSON.parse(firstResponse.body) as {
      items: Array<{ name: string; status: string }>;
      total: number;
      nextCursor: string | null;
    };
    expect(first.total).toBe(6);
    expect(first.items).toHaveLength(5);
    expect(first.items.every((item) => item.status === 'active')).toBe(true);
    expect(first.items[0]).not.toHaveProperty('artifacts');
    expect(first.nextCursor).toEqual(expect.any(String));

    const detailResponse = await request(
      handle.port,
      `${base}/native-change?status=active&changeName=${encodeURIComponent(first.items[0].name)}`,
    );
    expect(detailResponse.status).toBe(200);
    expect(JSON.parse(detailResponse.body)).toMatchObject({
      name: first.items[0].name,
      artifacts: [expect.objectContaining({ key: 'brief' })],
    });

    const secondResponse = await request(
      handle.port,
      `${base}/native-changes?status=active&limit=5&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(secondResponse.status).toBe(200);
    expect(JSON.parse(secondResponse.body)).toMatchObject({
      total: 6,
      items: expect.arrayContaining([expect.objectContaining({ name: 'native-server-5' })]),
      nextCursor: null,
    });
  });

  it('rejects a Native page limit above the Classic Dashboard maximum', async () => {
    await writeProjectConfig(projectDir, defaultProjectConfig('docs'));

    const handle = await startDashboardServer({
      projectPath: projectDir,
      port: 0,
      webRoot: webDir,
    });
    handles.push(handle);

    const directoryResponse = await request(handle.port, '/api/dashboard/projects');
    const directory = JSON.parse(directoryResponse.body) as { currentProjectId: string };
    const response = await request(
      handle.port,
      `/api/dashboard/projects/${directory.currentProjectId}/native-changes?status=active&limit=51`,
    );

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error).toContain('between 1 and 50');
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
