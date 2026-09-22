import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('starts a hidden broker with a bundled PowerShell executable and encoded payload', () => {
    const on = vi.fn();
    const unref = vi.fn();
    existsSyncMock.mockReturnValue(true);
    spawnMock.mockReturnValue({ pid: 1234, on, unref });

    const result = launchWindowsProcessWithBroker({
      command: 'node.exe',
      args: ['', 'workspace folder', 'quote"tail\\'],
      cwd: 'C:\\workspace',
      env: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32' },
    });

    expect(result).toEqual({ started: true });
    const [executable, args, options] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { cwd: string; env: NodeJS.ProcessEnv; stdio: string; windowsHide: boolean },
    ];
    expect(executable).toBe(
      path.join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    );
    expect(args).toContain('-EncodedCommand');
    expect(options).toMatchObject({
      cwd: 'C:\\workspace',
      stdio: 'ignore',
      windowsHide: true,
    });
    const payload = JSON.parse(
      Buffer.from(options.env.COMET_WINDOWS_PROCESS_PAYLOAD as string, 'base64').toString('utf8'),
    ) as { commandLine: string; cwd: string };
    expect(payload).toEqual({
      commandLine: 'node.exe "" "workspace folder" "quote\\"tail\\\\"',
      cwd: 'C:\\workspace',
    });
    expect(on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(unref).toHaveBeenCalledOnce();
  });

  it('returns a startup error when the broker has no process id', () => {
    spawnMock.mockReturnValue({ pid: 0, on: vi.fn() });

    expect(
      launchWindowsProcessWithBroker({
        command: 'node.exe',
        args: [],
        cwd: 'C:\\workspace',
        env: {},
      }),
    ).toEqual({ started: false, error: 'Windows process broker did not start' });
    expect(spawnMock.mock.calls[0]?.[0]).toBe('powershell.exe');
  });

  it('returns spawn failures without throwing', () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    expect(
      launchWindowsProcessWithBroker({ command: 'node.exe', args: [], cwd: '.', env: {} }),
    ).toEqual({ started: false, error: 'spawn failed' });

    spawnMock.mockImplementationOnce(() => {
      throw 'unexpected failure';
    });
    expect(
      launchWindowsProcessWithBroker({ command: 'node.exe', args: [], cwd: '.', env: {} }),
    ).toEqual({ started: false, error: 'Windows process broker failed to start' });
  });
});
