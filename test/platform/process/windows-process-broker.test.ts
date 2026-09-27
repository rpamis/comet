import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import path from 'node:path';

const { existsSyncMock, spawnMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('node:fs', () => ({ existsSync: existsSyncMock }));

import { launchWindowsProcessWithBroker } from '../../../platform/process/windows-process-broker.js';

describe('Windows process broker', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    existsSyncMock.mockReturnValue(false);
  });

  it('waits for the broker to finish creating the daemon before reporting success', async () => {
    const broker = Object.assign(new EventEmitter(), { pid: 1234, unref: vi.fn() });
    spawnMock.mockReturnValue(broker);

    let settled = false;
    const launched = Promise.resolve(
      launchWindowsProcessWithBroker({ command: 'node.exe', args: [], cwd: '.', env: {} }),
    );
    void launched.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    broker.emit('close', 0);
    expect(await launched).toEqual({ started: true });
  });

  it('starts a hidden broker with a bundled PowerShell executable and encoded payload', async () => {
    existsSyncMock.mockReturnValue(true);
    const broker = Object.assign(new EventEmitter(), { pid: 1234, stderr: new EventEmitter() });
    spawnMock.mockReturnValue(broker);

    const launched = launchWindowsProcessWithBroker({
      command: 'node.exe',
      args: ['', 'workspace folder', 'quote"tail\\'],
      cwd: 'C:\\workspace',
      env: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32' },
    });
    broker.emit('close', 0);
    const result = await launched;

    expect(result).toEqual({ started: true });
    const [executable, args, options] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { cwd: string; env: NodeJS.ProcessEnv; stdio: string[]; windowsHide: boolean },
    ];
    expect(executable).toBe(
      path.join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    );
    expect(args).toContain('-EncodedCommand');
    expect(options).toMatchObject({
      cwd: 'C:\\workspace',
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    const payload = JSON.parse(
      Buffer.from(options.env.COMET_WINDOWS_PROCESS_PAYLOAD as string, 'base64').toString('utf8'),
    ) as { commandLine: string; cwd: string };
    expect(payload).toEqual({
      commandLine: 'node.exe "" "workspace folder" "quote\\"tail\\\\"',
      cwd: 'C:\\workspace',
    });
  });

  it('returns a startup error when the broker has no process id', async () => {
    spawnMock.mockReturnValue({ pid: 0, on: vi.fn() });

    await expect(
      launchWindowsProcessWithBroker({
        command: 'node.exe',
        args: [],
        cwd: 'C:\\workspace',
        env: {},
      }),
    ).resolves.toEqual({ started: false, error: 'Windows process broker did not start' });
    expect(spawnMock.mock.calls[0]?.[0]).toBe('powershell.exe');
  });

  it('returns spawn failures without throwing', async () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    await expect(
      launchWindowsProcessWithBroker({ command: 'node.exe', args: [], cwd: '.', env: {} }),
    ).resolves.toEqual({ started: false, error: 'spawn failed' });

    spawnMock.mockImplementationOnce(() => {
      throw 'unexpected failure';
    });
    await expect(
      launchWindowsProcessWithBroker({ command: 'node.exe', args: [], cwd: '.', env: {} }),
    ).resolves.toEqual({ started: false, error: 'Windows process broker failed to start' });
  });
});
