import { createReadStream, promises as fs } from 'fs';
import http from 'http';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { collectDashboardSnapshot } from './collector.js';

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
 *   `src/dashboard/web` to `dist/dashboard/web`).
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
    const body = JSON.stringify(snapshot);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }

  await serveStatic(res, req.method ?? 'GET', webRoot, pathname);
}

async function serveStatic(
  res: http.ServerResponse,
  method: string,
  webRoot: string,
  pathname: string,
): Promise<void> {
  const resolvedRoot = path.resolve(webRoot);
  const requested = pathname === '/' ? '/index.html' : pathname;
  const targetPath = path.resolve(resolvedRoot, '.' + requested);

  // Defence in depth against `..` path traversal.
  if (!targetPath.startsWith(resolvedRoot + path.sep) && targetPath !== resolvedRoot) {
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
