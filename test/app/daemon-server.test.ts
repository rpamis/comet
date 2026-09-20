import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createCometDaemonServer = vi.hoisted(() => vi.fn());
const runClassicCli = vi.hoisted(() => vi.fn());
const runNativeCliDetailed = vi.hoisted(() => vi.fn());

vi.mock('../../platform/process/comet-daemon.js', () => ({ createCometDaemonServer }));
vi.mock('../../domains/comet-classic/classic-cli.js', () => ({ runClassicCli }));
vi.mock('../../domains/comet-native/native-cli.js', () => ({ runNativeCliDetailed }));

import { runCometDaemonServer } from '../../app/commands/daemon-server.js';

describe('Comet daemon server entry', () => {
  const environment = { ...process.env };

  beforeEach(() => {
    createCometDaemonServer.mockReset();
    runClassicCli.mockReset();
    runNativeCliDetailed.mockReset();
    process.env = { ...environment };
  });

  it('validates its required positional arguments', async () => {
    await expect(runCometDaemonServer([])).rejects.toThrow('daemon endpoint is required');
    await expect(runCometDaemonServer(['endpoint'])).rejects.toThrow('daemon build ID is required');
    await expect(runCometDaemonServer(['endpoint', 'build'])).rejects.toThrow(
      'daemon project root is required',
    );
    await expect(runCometDaemonServer(['--endpoint', 'build', 'root'])).rejects.toThrow(
      'daemon endpoint is required',
    );
  });

  it('cleans the launcher lock when server startup fails', async () => {
    const lockPath = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), 'comet-daemon-test-')),
      'start.lock',
    );
    await fs.writeFile(lockPath, 'starting\n');
    process.env.COMET_DAEMON_START_LOCK = lockPath;
    process.env.COMET_DAEMON_IDLE_TIMEOUT_MS = '1250.9';
    createCometDaemonServer.mockRejectedValue(new Error('bind failed'));

    await expect(runCometDaemonServer(['socket', 'build-1', '.'])).rejects.toThrow('bind failed');
    expect(createCometDaemonServer).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'socket',
        buildId: 'build-1',
        projectRoot: path.resolve('.'),
        idleTimeoutMs: 1250,
      }),
    );
    await expect(fs.access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('routes classic and native requests through the selected Runtime', async () => {
    let options: { handler: (request: unknown) => Promise<unknown> } | undefined;
    createCometDaemonServer.mockImplementation(async (nextOptions) => {
      options = nextOptions;
      throw new Error('stop after capture');
    });
    runClassicCli.mockResolvedValue({ exitCode: 7, stdout: 'classic' });
    runNativeCliDetailed.mockResolvedValue({ output: { exitCode: 8, stdout: 'native' } });

    await expect(runCometDaemonServer(['socket', 'build-2', '.'])).rejects.toThrow(
      'stop after capture',
    );
    expect(options).toBeDefined();

    const request = { cwd: path.resolve('.'), projectRoot: path.resolve('.') };
    await expect(
      options!.handler({ ...request, runtime: 'classic', argv: ['state'] }),
    ).resolves.toEqual({ exitCode: 7, stdout: 'classic' });
    expect(runClassicCli).toHaveBeenCalledWith(['state'], undefined, {
      invocationCwd: request.cwd,
      projectRoot: request.projectRoot,
    });

    await expect(
      options!.handler({ ...request, runtime: 'native', argv: ['status'] }),
    ).resolves.toEqual({
      exitCode: 8,
      stdout: 'native',
    });
    expect(runNativeCliDetailed).toHaveBeenCalledWith([
      'status',
      '--project-root',
      request.projectRoot,
    ]);

    await options!.handler({
      ...request,
      runtime: 'native',
      argv: ['--project-root', path.resolve('other')],
    });
    expect(runNativeCliDetailed).toHaveBeenLastCalledWith([
      '--project-root',
      path.resolve('other'),
    ]);
  });
});
