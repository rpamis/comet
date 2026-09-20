import { afterEach, describe, expect, it } from 'vitest';
import * as net from 'node:net';
import path from 'node:path';

import {
  COMET_DAEMON_MESSAGE_LIMIT,
  createCometDaemonServer,
  resolveCometDaemonEndpoint,
  sendCometDaemonRequest,
  type CometDaemonServer,
} from '../../../platform/process/comet-daemon.js';

function sendRawDaemonLine(endpoint: string, line: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let output = '';
    socket.setEncoding('utf8');
    socket.once('error', reject);
    socket.on('data', (chunk: string) => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline < 0) return;
      socket.destroy();
      try {
        resolve(JSON.parse(output.slice(0, newline)) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    socket.once('connect', () => socket.write(line));
  });
}

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

  it('rejects permission and project mismatches before invoking the handler', async () => {
    const projectRoot = process.cwd();
    const endpoint = resolveCometDaemonEndpoint(projectRoot, 'test-request-binding');
    let calls = 0;
    const server = await createCometDaemonServer({
      endpoint,
      buildId: 'test-request-binding',
      projectRoot,
      permissionContext: 'expected-user',
      handler: async () => {
        calls += 1;
        return { exitCode: 0 };
      },
    });
    servers.push(server);

    await expect(
      sendCometDaemonRequest({
        endpoint,
        buildId: 'test-request-binding',
        projectRoot,
        permissionContext: 'other-user',
        runtime: 'native',
        argv: ['status'],
      }),
    ).resolves.toMatchObject({ ok: false, error: 'daemon permission context mismatch' });
    await expect(
      sendCometDaemonRequest({
        endpoint,
        buildId: 'test-request-binding',
        projectRoot: path.join(projectRoot, 'other-project'),
        permissionContext: 'expected-user',
        runtime: 'native',
        argv: ['status'],
      }),
    ).resolves.toMatchObject({ ok: false, error: 'daemon project mismatch' });
    expect(calls).toBe(0);
  });

  it('returns handler failures and answers ping controls', async () => {
    const projectRoot = process.cwd();
    const endpoint = resolveCometDaemonEndpoint(projectRoot, 'test-handler-failure');
    const server = await createCometDaemonServer({
      endpoint,
      buildId: 'test-handler-failure',
      projectRoot,
      handler: async () => {
        throw new Error('handler failed');
      },
    });
    servers.push(server);

    await expect(
      sendCometDaemonRequest({
        endpoint,
        buildId: 'test-handler-failure',
        projectRoot,
        runtime: 'classic',
        argv: ['state'],
      }),
    ).resolves.toMatchObject({ ok: false, error: 'handler failed' });
    await expect(
      sendCometDaemonRequest({
        endpoint,
        buildId: 'test-handler-failure',
        projectRoot,
        control: 'ping',
      }),
    ).resolves.toMatchObject({ ok: true, status: { buildId: 'test-handler-failure' } });
  });

  it('rejects malformed and oversized raw requests', async () => {
    const projectRoot = process.cwd();
    const endpoint = resolveCometDaemonEndpoint(projectRoot, 'test-invalid-request');
    const server = await createCometDaemonServer({
      endpoint,
      buildId: 'test-invalid-request',
      projectRoot,
      handler: async () => ({ exitCode: 0 }),
    });
    servers.push(server);

    await expect(sendRawDaemonLine(endpoint.endpoint, '{\n')).resolves.toMatchObject({
      ok: false,
      error: 'daemon request is not valid JSON',
    });
    await expect(sendRawDaemonLine(endpoint.endpoint, '{}\n')).resolves.toMatchObject({
      ok: false,
      error: 'daemon request has an invalid shape',
    });
    await expect(
      sendRawDaemonLine(endpoint.endpoint, `${'x'.repeat(COMET_DAEMON_MESSAGE_LIMIT + 1)}\n`),
    ).resolves.toMatchObject({
      ok: false,
      error: 'daemon request exceeds the message limit',
    });
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
