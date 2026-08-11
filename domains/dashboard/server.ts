import { createReadStream, promises as fs } from 'fs';
import http from 'http';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  collectDashboardChangeDetail,
  collectDashboardChangePage,
  collectDashboardOverview,
  collectDashboardSnapshot,
  DashboardChangeQueryError,
} from './collector.js';
import {
  collectNativeDashboardChangeDetail,
  collectNativeDashboardChangePage,
  NativeDashboardQueryError,
} from './native-collector.js';
import { collectDashboardProjectDirectory, findDashboardProject } from './project-directory.js';
import type { DashboardChangeTab } from './types.js';

export interface DashboardServerOptions {
  projectPath: string;
  port?: number;
  webRoot?: string;
}

export interface DashboardServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

const DEFAULT_PORT = 4321;
const PORT_RETRY_LIMIT = 50;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Start the dashboard HTTP server.
 *
 * - Serves `GET /api/dashboard` with a freshly-collected snapshot on every hit.
 * - Serves the static frontend from `webRoot` (defaults to `./web` next to
 *   this module — both in source and after build, since the build step copies
 *   `domains/dashboard/web` to `dist/domains/dashboard/web`).
 * - Tries `port` first, then port+1 ... until it finds a free one (max 50).
 */
export async function startDashboardServer(
  options: DashboardServerOptions,
): Promise<DashboardServerHandle> {
  const webRoot = options.webRoot ?? defaultWebRoot();
  const requestedPort = options.port ?? DEFAULT_PORT;
  const port = requestedPort === 0 ? 0 : await findAvailablePort(requestedPort);

  const server = http.createServer((req, res) => {
    handleRequest(req, res, options.projectPath, webRoot).catch((error) => {
      if (
        error instanceof DashboardChangeQueryError ||
        error instanceof NativeDashboardQueryError
      ) {
        respondJson(res, req.method ?? 'GET', 400, { error: error.message });
        return;
      }
      respondError(res, 500, `Internal server error: ${(error as Error).message}`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  return {
    port: actualPort,
    url: `http://localhost:${actualPort}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectPath: string,
  webRoot: string,
): Promise<void> {
  if (!req.url) {
    respondError(res, 400, 'Bad request');
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    respondError(res, 405, 'Method not allowed');
    return;
  }

  if (pathname === '/api/dashboard') {
    const snapshot = await collectDashboardSnapshot(projectPath);
    respondJson(res, req.method, 200, snapshot);
    return;
  }

  if (pathname === '/api/dashboard/projects') {
    const directory = await collectDashboardProjectDirectory(projectPath);
    respondJson(res, req.method, 200, directory);
    return;
  }

  if (pathname.startsWith('/api/dashboard/projects/')) {
    let suffix: string;
    try {
      suffix = decodeURIComponent(pathname.slice('/api/dashboard/projects/'.length));
    } catch {
      respondJson(res, req.method, 400, { error: 'Invalid dashboard project id' });
      return;
    }

    const separator = suffix.indexOf('/');
    const projectId = separator === -1 ? suffix : suffix.slice(0, separator);
    const subpath = separator === -1 ? '' : suffix.slice(separator);

    const directory = await collectDashboardProjectDirectory(projectPath);
    const project = findDashboardProject(directory, projectId);
    if (!project) {
      respondJson(res, req.method, 404, { error: 'Unknown dashboard project id' });
      return;
    }
    if (project.availability !== 'available') {
      respondJson(res, req.method, 409, {
        error: 'Dashboard project is unavailable',
        availability: project.availability,
      });
      return;
    }

    if (subpath === '/overview') {
      const overview = await collectDashboardOverview(project.path, {
        projectName: project.name,
        query: url.searchParams.get('q') ?? undefined,
      });
      respondJson(res, req.method, 200, overview);
      return;
    }

    if (subpath === '/changes') {
      const page = await collectDashboardChangePage(project.path, {
        status: parseChangeTab(url.searchParams.get('status')),
        limit: parseChangeLimit(url.searchParams.get('limit')),
        cursor: url.searchParams.get('cursor') ?? undefined,
        query: url.searchParams.get('q') ?? undefined,
      });
      respondJson(res, req.method, 200, page);
      return;
    }

    if (subpath === '/native-changes') {
      const page = await collectNativeDashboardChangePage(project.path, {
        status: parseChangeTab(url.searchParams.get('status')),
        limit: parseChangeLimit(url.searchParams.get('limit')),
        cursor: url.searchParams.get('cursor') ?? undefined,
        query: url.searchParams.get('q') ?? undefined,
      });
      respondJson(res, req.method, 200, page);
      return;
    }

    if (subpath === '/native-change') {
      const changeName = url.searchParams.get('changeName');
      const changeLocator = url.searchParams.get('changeLocator');
      const status = url.searchParams.get('status');
      if (!changeName && !changeLocator) {
        throw new NativeDashboardQueryError('Missing Native Dashboard change name');
      }
      if (status !== 'active' && status !== 'archived') {
        throw new NativeDashboardQueryError('Invalid Native Dashboard change status');
      }
      const detail = await collectNativeDashboardChangeDetail(project.path, {
        status,
        name: changeName ?? '',
        archiveName: url.searchParams.get('archiveName') ?? undefined,
        locator: changeLocator ?? undefined,
      });
      if (!detail) {
        respondJson(res, req.method, 404, { error: 'Unknown Native Dashboard change' });
        return;
      }
      respondJson(res, req.method, 200, detail);
      return;
    }

    if (subpath === '/change') {
      const changeId = url.searchParams.get('changeLocator') ?? url.searchParams.get('changeId');
      if (!changeId) {
        throw new DashboardChangeQueryError('Missing dashboard change id');
      }
      const detail = await collectDashboardChangeDetail(project.path, changeId);
      if (!detail) {
        respondJson(res, req.method, 404, { error: 'Unknown dashboard change id' });
        return;
      }
      respondJson(res, req.method, 200, detail);
      return;
    }

    if (subpath) {
      respondJson(res, req.method, 404, { error: 'Not found' });
      return;
    }

    const snapshot = await collectDashboardSnapshot(project.path, { projectName: project.name });
    respondJson(res, req.method, 200, snapshot);
    return;
  }

  await serveStatic(res, req.method ?? 'GET', webRoot, pathname);
}

function parseChangeTab(raw: string | null): DashboardChangeTab {
  const value = raw ?? 'active';
  if (value === 'active' || value === 'archived' || value === 'all') return value;
  throw new DashboardChangeQueryError('Invalid dashboard change status');
}

function parseChangeLimit(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  if (!/^\d+$/u.test(raw)) {
    throw new DashboardChangeQueryError('Change page limit must be a positive integer');
  }
  return Number(raw);
}

function respondJson(
  res: http.ServerResponse,
  method: string,
  status: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(method === 'HEAD' ? undefined : body);
}

export function resolveDashboardStaticPath(webRoot: string, pathname: string): string | null {
  const resolvedRoot = path.resolve(webRoot);
  const requested = pathname === '/' ? '/index.html' : pathname;
  const targetPath = path.resolve(resolvedRoot, '.' + requested);
  if (!targetPath.startsWith(resolvedRoot + path.sep) && targetPath !== resolvedRoot) return null;
  return targetPath;
}

async function serveStatic(
  res: http.ServerResponse,
  method: string,
  webRoot: string,
  pathname: string,
): Promise<void> {
  const targetPath = resolveDashboardStaticPath(webRoot, pathname);
  if (!targetPath) {
    respondError(res, 403, 'Forbidden');
    return;
  }

  try {
    const stat = await fs.stat(targetPath);
    if (stat.isDirectory()) {
      respondError(res, 404, 'Not found');
      return;
    }

    const ext = path.extname(targetPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    });
    if (method === 'HEAD') {
      res.end();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(targetPath);
      stream.on('error', reject);
      stream.on('end', resolve);
      stream.pipe(res);
    });
  } catch {
    respondError(res, 404, 'Not found');
  }
}

function respondError(res: http.ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const body = JSON.stringify({ error: message });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function findAvailablePort(start: number): Promise<number> {
  for (let i = 0; i < PORT_RETRY_LIMIT; i += 1) {
    const candidate = start + i;
    if (await isPortAvailable(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Could not find a free port in range ${start}..${start + PORT_RETRY_LIMIT - 1}`);
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, '127.0.0.1');
  });
}

function defaultWebRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, 'web');
}
