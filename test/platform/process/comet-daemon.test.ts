import { afterEach, describe, expect, it } from 'vitest';
import * as net from 'node:net';

import {
  createCometDaemonServer,
  resolveCometDaemonEndpoint,
  sendCometDaemonRequest,
  type CometDaemonServer,
} from '../../../platform/process/comet-daemon.js';

describe('Comet daemon protocol', () => {
  const servers: CometDaemonServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('serves an isolated request and reports lifecycle status', async () => {
    const projectRoot = process.cwd();
    const endpoint = resolveCometDaemonEndpoint(projectRoot, 'test-build');
    const server = await createCometDaemonServer({
      endpoint,
      buildId: 'test-build',
      projectRoot,
      idleTimeoutMs: 5_000,
      handler: async (request) => ({
        exitCode: 0,
        stdout: `${request.runtime}:${request.argv?.join('|')}\n`,
      }),
    });
    servers.push(server);

    const response = await sendCometDaemonRequest({
      endpoint,
      buildId: 'test-build',
      projectRoot,
      runtime: 'native',
      argv: ['status'],
    });
    expect(response).toMatchObject({ ok: true, exitCode: 0, stdout: 'native:status\n' });

    const status = await sendCometDaemonRequest({
      endpoint,
      buildId: 'test-build',
      projectRoot,
      control: 'status',
    });
    expect(status).toMatchObject({
      ok: true,
      status: { buildId: 'test-build' },
    });
    expect(status.status?.activeRequests).toBeGreaterThanOrEqual(1);
  });

  it('rejects a request from another build before invoking the handler', async () => {
    const projectRoot = process.cwd();
    const endpoint = resolveCometDaemonEndpoint(projectRoot, 'test-build-mismatch');
    let calls = 0;
    const server = await createCometDaemonServer({
      endpoint,
      buildId: 'test-build-mismatch',
      projectRoot,
      handler: async () => {
        calls += 1;
        return { exitCode: 0 };
      },
    });
    servers.push(server);

    const response = await sendCometDaemonRequest({
      endpoint,
      buildId: 'old-build',
      projectRoot,
      runtime: 'classic',
      argv: ['state', 'current'],
    });
    expect(response).toMatchObject({ ok: false, error: 'daemon build mismatch' });
    expect(calls).toBe(0);
  });

  it('stops through the control channel', async () => {
    const projectRoot = process.cwd();
    const endpoint = resolveCometDaemonEndpoint(projectRoot, 'test-stop');
    const server = await createCometDaemonServer({
      endpoint,
      buildId: 'test-stop',
      projectRoot,
      handler: async () => ({ exitCode: 0 }),
    });
    servers.push(server);

    const response = await sendCometDaemonRequest({
      endpoint,
      buildId: 'test-stop',
      projectRoot,
      control: 'stop',
    });
    expect(response).toMatchObject({ ok: true });
    await server.close();
  });

  it('binds endpoints and requests to their environment fingerprint', async () => {
    const projectRoot = process.cwd();
    const endpoint = resolveCometDaemonEndpoint(
      projectRoot,
      'test-environment',
      'test-user',
      'env-a',
    );
    let calls = 0;
    const server = await createCometDaemonServer({
      endpoint,
      buildId: 'test-environment',
      projectRoot,
      permissionContext: 'test-user',
      environmentFingerprint: 'env-a',
      handler: async () => {
        calls += 1;
        return { exitCode: 0 };
      },
    });
    servers.push(server);

    const response = await sendCometDaemonRequest({
      endpoint,
      buildId: 'test-environment',
      projectRoot,
      permissionContext: 'test-user',
      environmentFingerprint: 'env-b',
      runtime: 'native',
      argv: ['status'],
    });
    expect(response).toMatchObject({ ok: false, error: 'daemon environment binding mismatch' });
    expect(calls).toBe(0);
  });

  it('bounds a client that opens an IPC connection without sending a request', async () => {
    const projectRoot = process.cwd();
    const endpoint = resolveCometDaemonEndpoint(projectRoot, 'test-connection-timeout');
    const server = await createCometDaemonServer({
      endpoint,
      buildId: 'test-connection-timeout',
      projectRoot,
      connectionTimeoutMs: 25,
      handler: async () => ({ exitCode: 0 }),
    });
    servers.push(server);

    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection(endpoint.endpoint);
      let output = '';
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('connection timeout test did not receive a response'));
      }, 1_000);
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        output += chunk;
        if (!output.includes('\n')) return;
        clearTimeout(timeout);
        socket.destroy();
        resolve(output);
      });
      socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    expect(JSON.parse(response.trim())).toMatchObject({
      ok: false,
      error: 'daemon connection timed out',
    });
  });
});
