import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { snapshotCometRuntimeMetrics } from './runtime-metrics.js';

/**
 * The daemon deliberately speaks a small, line-delimited protocol.  A request
 * is complete only after its newline has been received, which keeps the
 * client/server boundary deterministic on both Unix sockets and Windows named
 * pipes.
 */
export const COMET_DAEMON_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_COMET_DAEMON_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_COMET_DAEMON_REQUEST_TIMEOUT_MS = 8_000;
export const DEFAULT_COMET_DAEMON_CONNECTION_TIMEOUT_MS = 10_000;
export const COMET_DAEMON_MESSAGE_LIMIT = 4 * 1024 * 1024;

const COMET_DAEMON_ENVIRONMENT_IGNORED_KEYS = new Set([
  'COMET_DAEMON',
  'COMET_DAEMON_BUILD_ID',
  'COMET_DAEMON_ENVIRONMENT_FINGERPRINT',
  'COMET_DAEMON_IDLE_TIMEOUT_MS',
  'COMET_DAEMON_SERVER',
  'COMET_DAEMON_START_LOCK',
]);

export type CometDaemonControl = 'ping' | 'status' | 'stop';

export interface CometDaemonRequest {
  protocolVersion: typeof COMET_DAEMON_PROTOCOL_VERSION;
  requestId: string;
  buildId: string;
  environmentFingerprint: string;
  kind: 'cli' | 'control';
  runtime?: 'classic' | 'native';
  permissionContext: string;
  projectRoot: string;
  cwd: string;
  argv?: string[];
  control?: CometDaemonControl;
}

export interface CometDaemonResponse {
  protocolVersion: typeof COMET_DAEMON_PROTOCOL_VERSION;
  requestId: string;
  ok: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  data?: unknown;
  error?: string;
  status?: CometDaemonStatus;
}

export interface CometDaemonStatus {
  pid: number;
  buildId: string;
  endpoint: string;
  idleTimeoutMs: number;
  idleForMs: number;
  activeRequests: number;
  startedAt: string;
  requestCount: number;
  memoryRssBytes: number;
  memoryHeapUsedBytes: number;
  lastRequest?: CometDaemonRequestMetrics;
  totalWork: CometDaemonWorkMetrics;
}

export interface CometDaemonRequestMetrics {
  durationMs: number;
  queueMs: number;
  gitCommands: number;
  filesystemReads: number | null;
  filesystemWrites: number | null;
}

export interface CometDaemonWorkMetrics {
  gitCommands: number;
  filesystemReads: number | null;
  filesystemWrites: number | null;
}

export interface CometDaemonEndpoint {
  endpoint: string;
  key: string;
  isNamedPipe: boolean;
  environmentFingerprint?: string;
}

export interface CometDaemonHandlerResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  data?: unknown;
}

export type CometDaemonHandler = (request: CometDaemonRequest) => Promise<CometDaemonHandlerResult>;

export interface CometDaemonServerOptions {
  endpoint: CometDaemonEndpoint | string;
  buildId: string;
  projectRoot?: string;
  idleTimeoutMs?: number;
  handler: CometDaemonHandler;
  permissionContext?: string;
  environmentFingerprint?: string;
  connectionTimeoutMs?: number;
}

export interface CometDaemonServer {
  readonly endpoint: string;
  readonly buildId: string;
  close(): Promise<void>;
  status(): CometDaemonStatus;
}

export interface CometDaemonRequestOptions {
  endpoint: CometDaemonEndpoint | string;
  buildId: string;
  projectRoot: string;
  cwd?: string;
  argv?: readonly string[];
  control?: CometDaemonControl;
  runtime?: 'classic' | 'native';
  permissionContext?: string;
  requestId?: string;
  timeoutMs?: number;
  environmentFingerprint?: string;
}

function endpointValue(endpoint: CometDaemonEndpoint | string): string {
  return typeof endpoint === 'string' ? endpoint : endpoint.endpoint;
}

function normalizedPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function resolveCometDaemonPermissionContext(): string {
  if (typeof process.getuid === 'function') return String(process.getuid());
  return process.env.USERNAME ?? process.env.USER ?? 'user';
}

/**
 * Bind the daemon to the complete caller environment without sending the
 * values over IPC. The fingerprint is only an endpoint/request discriminator;
 * the server still inherits the actual environment from its launcher.
 * Daemon launcher bookkeeping is excluded because it is intentionally unique
 * to the short-lived launcher/server handshake rather than command semantics.
 */
export function resolveCometDaemonEnvironmentFingerprint(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const entries = Object.keys(environment)
    .filter((key) => !COMET_DAEMON_ENVIRONMENT_IGNORED_KEYS.has(key))
    .sort()
    .map((key) => [key, environment[key] ?? null]);
  return createHash('sha256').update(JSON.stringify(entries), 'utf8').digest('hex').slice(0, 40);
}

/**
 * Derive an isolated endpoint from the project and runtime build.  Unix
 * sockets live in a per-user 0700 directory; Windows named pipes inherit the
 * OS named-pipe ACL instead of leaving a socket file in a shared temp folder.
 */
export function resolveCometDaemonEndpoint(
  projectRoot: string,
  buildId: string,
  permissionContext = resolveCometDaemonPermissionContext(),
  environmentFingerprint = resolveCometDaemonEnvironmentFingerprint(),
): CometDaemonEndpoint {
  const normalizedRoot = normalizedPath(projectRoot);
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        root: normalizedRoot,
        buildId,
        platform: process.platform,
        arch: process.arch,
        user: permissionContext,
        environment: environmentFingerprint,
      }),
      'utf8',
    )
    .digest('hex')
    .slice(0, 40);
  if (process.platform === 'win32') {
    return {
      endpoint: `\\\\.\\pipe\\comet-${digest}`,
      key: digest,
      isNamedPipe: true,
      environmentFingerprint,
    };
  }
  return {
    endpoint: path.join(os.tmpdir(), 'comet-daemons', permissionContext, `comet-${digest}.sock`),
    key: digest,
    isNamedPipe: false,
    environmentFingerprint,
  };
}

function makeRequest(options: CometDaemonRequestOptions): CometDaemonRequest {
  const projectRoot = path.resolve(options.projectRoot);
  const argv = options.argv ? [...options.argv] : undefined;
  const request: CometDaemonRequest = {
    protocolVersion: COMET_DAEMON_PROTOCOL_VERSION,
    requestId: options.requestId ?? randomUUID(),
    buildId: options.buildId,
    environmentFingerprint:
      options.environmentFingerprint ?? resolveCometDaemonEnvironmentFingerprint(),
    kind: options.control ? 'control' : 'cli',
    projectRoot,
    cwd: path.resolve(options.cwd ?? projectRoot),
    ...(options.runtime ? { runtime: options.runtime } : {}),
    permissionContext: options.permissionContext ?? resolveCometDaemonPermissionContext(),
    ...(argv ? { argv } : {}),
    ...(options.control ? { control: options.control } : {}),
  };
  return request;
}

function invalidRequest(message: string): CometDaemonResponse {
  return {
    protocolVersion: COMET_DAEMON_PROTOCOL_VERSION,
    requestId: 'invalid',
    ok: false,
    error: message,
  };
}

function validRequest(value: unknown): value is CometDaemonRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<CometDaemonRequest>;
  if (request.protocolVersion !== COMET_DAEMON_PROTOCOL_VERSION) return false;
  if (typeof request.requestId !== 'string' || request.requestId.length > 128) return false;
  if (typeof request.buildId !== 'string' || request.buildId.length === 0) return false;
  if (
    typeof request.environmentFingerprint !== 'string' ||
    request.environmentFingerprint.length === 0
  ) {
    return false;
  }
  if (request.kind !== 'cli' && request.kind !== 'control') return false;
  if (typeof request.projectRoot !== 'string' || !path.isAbsolute(request.projectRoot))
    return false;
  if (typeof request.cwd !== 'string' || !path.isAbsolute(request.cwd)) return false;
  if (typeof request.permissionContext !== 'string' || request.permissionContext.length === 0) {
    return false;
  }
  if (request.kind === 'cli') {
    if (!Array.isArray(request.argv) || request.argv.some((entry) => typeof entry !== 'string')) {
      return false;
    }
    if (request.runtime !== 'classic' && request.runtime !== 'native') return false;
  } else if (
    request.control !== 'ping' &&
    request.control !== 'status' &&
    request.control !== 'stop'
  ) {
    return false;
  }
  return true;
}

function responseFor(
  requestId: string,
  result: Omit<CometDaemonResponse, 'protocolVersion' | 'requestId'>,
): CometDaemonResponse {
  return { protocolVersion: COMET_DAEMON_PROTOCOL_VERSION, requestId, ...result };
}

async function ensureSocketDirectory(endpoint: CometDaemonEndpoint): Promise<void> {
  if (endpoint.isNamedPipe) return;
  const directory = path.dirname(endpoint.endpoint);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await fs.chmod(directory, 0o700);
  } catch {
    // chmod is not available on every supported filesystem. mkdir still
    // provides the intended permission on normal Unix filesystems.
  }
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

export async function createCometDaemonServer(
  options: CometDaemonServerOptions,
): Promise<CometDaemonServer> {
  const endpoint = endpointValue(options.endpoint);
  const endpointInfo: CometDaemonEndpoint =
    typeof options.endpoint === 'string'
      ? { endpoint, key: endpoint, isNamedPipe: process.platform === 'win32' }
      : options.endpoint;
  const idleTimeoutMs =
    Number.isFinite(options.idleTimeoutMs) && (options.idleTimeoutMs ?? 0) > 0
      ? Math.floor(options.idleTimeoutMs!)
      : DEFAULT_COMET_DAEMON_IDLE_TIMEOUT_MS;
  await ensureSocketDirectory(endpointInfo);

  const server = net.createServer();
  const startedAt = Date.now();
  let lastActivityAt = startedAt;
  let activeRequests = 0;
  let requestCount = 0;
  let lastRequest: CometDaemonRequestMetrics | undefined;
  let totalGitCommands = 0;
  let totalFilesystemReads: number | null = 0;
  let totalFilesystemWrites: number | null = 0;
  let closed = false;
  let stopping = false;
  let idleTimer: NodeJS.Timeout | undefined;
  let resolveClosed: (() => void) | undefined;
  const onSigterm = () => void close();
  const onSigint = () => void close();
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const scheduleIdleCheck = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => {
        if (activeRequests === 0 && Date.now() - lastActivityAt >= idleTimeoutMs) {
          void close();
        } else {
          scheduleIdleCheck();
        }
      },
      Math.max(1, Math.min(idleTimeoutMs, 30_000)),
    );
    idleTimer.unref();
  };

  const close = async (): Promise<void> => {
    if (closed) return closedPromise;
    closed = true;
    stopping = true;
    if (idleTimer) clearTimeout(idleTimer);
    process.removeListener('SIGTERM', onSigterm);
    process.removeListener('SIGINT', onSigint);
    await closeServer(server);
    if (!endpointInfo.isNamedPipe) {
      try {
        await fs.rm(endpointInfo.endpoint, { force: true });
      } catch {
        // An already removed socket is a successful close.
      }
    }
    resolveClosed?.();
    return closedPromise;
  };

  const status = (): CometDaemonStatus => ({
    pid: process.pid,
    buildId: options.buildId,
    endpoint,
    idleTimeoutMs,
    idleForMs: Math.max(0, Date.now() - lastActivityAt),
    activeRequests,
    startedAt: new Date(startedAt).toISOString(),
    requestCount,
    memoryRssBytes: process.memoryUsage().rss,
    memoryHeapUsedBytes: process.memoryUsage().heapUsed,
    ...(lastRequest ? { lastRequest } : {}),
    totalWork: {
      gitCommands: totalGitCommands,
      filesystemReads: totalFilesystemReads,
      filesystemWrites: totalFilesystemWrites,
    },
  });

  server.on('connection', (socket) => {
    if (stopping) {
      socket.end(JSON.stringify(invalidRequest('daemon is stopping')) + '\n');
      return;
    }
    lastActivityAt = Date.now();
    socket.setEncoding('utf8');
    let buffer = '';
    let handled = false;
    const connectionTimeoutMs =
      Number.isFinite(options.connectionTimeoutMs) && (options.connectionTimeoutMs ?? 0) > 0
        ? Math.floor(options.connectionTimeoutMs!)
        : DEFAULT_COMET_DAEMON_CONNECTION_TIMEOUT_MS;
    const connectionTimer = setTimeout(() => {
      if (handled) return;
      handled = true;
      socket.end(JSON.stringify(invalidRequest('daemon connection timed out')) + '\n');
    }, connectionTimeoutMs);
    connectionTimer.unref();
    const clearConnectionTimer = () => clearTimeout(connectionTimer);
    const finish = () => {
      clearConnectionTimer();
      socket.removeAllListeners();
      socket.end();
    };
    socket.once('close', clearConnectionTimer);
    socket.on('data', (chunk: string) => {
      if (handled) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > COMET_DAEMON_MESSAGE_LIMIT) {
        handled = true;
        clearConnectionTimer();
        socket.end(
          JSON.stringify(invalidRequest('daemon request exceeds the message limit')) + '\n',
        );
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      handled = true;
      clearConnectionTimer();
      const line = buffer.slice(0, newline).trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        socket.end(JSON.stringify(invalidRequest('daemon request is not valid JSON')) + '\n');
        return;
      }
      if (!validRequest(parsed)) {
        socket.end(JSON.stringify(invalidRequest('daemon request has an invalid shape')) + '\n');
        return;
      }
      const request = parsed;
      if (request.buildId !== options.buildId) {
        socket.end(
          JSON.stringify(
            responseFor(request.requestId, { ok: false, error: 'daemon build mismatch' }),
          ) + '\n',
        );
        return;
      }
      const expectedEnvironment =
        options.environmentFingerprint ?? resolveCometDaemonEnvironmentFingerprint();
      if (request.environmentFingerprint !== expectedEnvironment) {
        socket.end(
          JSON.stringify(
            responseFor(request.requestId, {
              ok: false,
              error: 'daemon environment binding mismatch',
            }),
          ) + '\n',
        );
        return;
      }
      const expectedPermission = options.permissionContext ?? resolveCometDaemonPermissionContext();
      if (request.permissionContext !== expectedPermission) {
        socket.end(
          JSON.stringify(
            responseFor(request.requestId, {
              ok: false,
              error: 'daemon permission context mismatch',
            }),
          ) + '\n',
        );
        return;
      }
      if (
        options.projectRoot &&
        normalizedPath(options.projectRoot) !== normalizedPath(request.projectRoot)
      ) {
        socket.end(
          JSON.stringify(
            responseFor(request.requestId, { ok: false, error: 'daemon project mismatch' }),
          ) + '\n',
        );
        return;
      }
      activeRequests += 1;
      requestCount += 1;
      lastActivityAt = Date.now();
      const queuedAt = Date.now();
      const usageBefore = process.resourceUsage?.();
      const runtimeMetricsBefore = snapshotCometRuntimeMetrics();
      const run = async () => {
        if (request.kind === 'control') {
          if (request.control === 'status' || request.control === 'ping') {
            return responseFor(request.requestId, { ok: true, status: status() });
          }
          if (request.control === 'stop') {
            stopping = true;
            const response = responseFor(request.requestId, { ok: true, status: status() });
            setImmediate(() => void close());
            return response;
          }
        }
        try {
          const result = await options.handler(request);
          return responseFor(request.requestId, { ok: true, ...result });
        } catch (error) {
          return responseFor(request.requestId, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };
      void run()
        .then((response) => {
          const usageAfter = process.resourceUsage?.();
          const runtimeMetricsAfter = snapshotCometRuntimeMetrics();
          const filesystemReads =
            usageBefore && usageAfter && Number.isFinite(usageAfter.fsRead - usageBefore.fsRead)
              ? Math.max(0, usageAfter.fsRead - usageBefore.fsRead)
              : null;
          const filesystemWrites =
            usageBefore && usageAfter && Number.isFinite(usageAfter.fsWrite - usageBefore.fsWrite)
              ? Math.max(0, usageAfter.fsWrite - usageBefore.fsWrite)
              : null;
          const metrics: CometDaemonRequestMetrics = {
            durationMs: Math.max(0, Date.now() - queuedAt),
            queueMs: 0,
            gitCommands: Math.max(
              0,
              runtimeMetricsAfter.gitCommands - runtimeMetricsBefore.gitCommands,
            ),
            filesystemReads,
            filesystemWrites,
          };
          lastRequest = metrics;
          totalGitCommands += metrics.gitCommands;
          totalFilesystemReads =
            totalFilesystemReads === null || filesystemReads === null
              ? null
              : totalFilesystemReads + filesystemReads;
          totalFilesystemWrites =
            totalFilesystemWrites === null || filesystemWrites === null
              ? null
              : totalFilesystemWrites + filesystemWrites;
          lastActivityAt = Date.now();
          socket.end(JSON.stringify(response) + '\n');
        })
        .finally(() => {
          activeRequests = Math.max(0, activeRequests - 1);
          scheduleIdleCheck();
        });
    });
    socket.on('error', () => finish());
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(endpoint);
  });
  server.once('close', () => {
    closed = true;
    resolveClosed?.();
  });
  process.once('SIGTERM', onSigterm);
  process.once('SIGINT', onSigint);
  scheduleIdleCheck();

  return { endpoint, buildId: options.buildId, close, status };
}

export async function sendCometDaemonRequest(
  options: CometDaemonRequestOptions,
): Promise<CometDaemonResponse> {
  const request = makeRequest(options);
  const endpoint = endpointValue(options.endpoint);
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
      ? Math.floor(options.timeoutMs!)
      : DEFAULT_COMET_DAEMON_REQUEST_TIMEOUT_MS;
  return await new Promise<CometDaemonResponse>((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let settled = false;
    let buffer = '';
    const timer = setTimeout(() => {
      finish(new Error(`daemon request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref();
    const finish = (error?: Error, response?: CometDaemonResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else if (response) resolve(response);
      else reject(new Error('daemon closed without a response'));
    };
    socket.setEncoding('utf8');
    socket.once('error', (error) => finish(error));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > COMET_DAEMON_MESSAGE_LIMIT) {
        finish(new Error('daemon response exceeds the message limit'));
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline).trim();
      try {
        const parsed = JSON.parse(line) as CometDaemonResponse;
        if (
          parsed.protocolVersion !== COMET_DAEMON_PROTOCOL_VERSION ||
          parsed.requestId !== request.requestId
        ) {
          finish(new Error('daemon response does not match the request'));
          return;
        }
        finish(undefined, parsed);
      } catch {
        finish(new Error('daemon response is not valid JSON'));
      }
    });
    socket.once('close', () => {
      if (!settled) finish();
    });
    socket.once('connect', () => {
      socket.write(JSON.stringify(request) + '\n');
    });
  });
}
