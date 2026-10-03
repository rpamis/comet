import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { existsSyncMock, spawnMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  existsSync: existsSyncMock,
}));

import { launchWindowsProcessWithBroker } from '../../../platform/process/windows-process-broker.js';

describe('Windows process broker', () => {
  let cacheRoot: string;
  beforeEach(() => {
    vi.resetAllMocks();
    existsSyncMock.mockReturnValue(false);
    cacheRoot = mkdtempSync(path.join(os.tmpdir(), 'comet-broker-test-'));
  });
  afterEach(() => rmSync(cacheRoot, { recursive: true, force: true }));

  it('starts a detached Node worker that owns the hidden PowerShell handoff', () => {
    const on = vi.fn();
    const unref = vi.fn();
    existsSyncMock.mockReturnValue(true);
    spawnMock.mockReturnValue({ pid: 1234, on, unref });

    const result = launchWindowsProcessWithBroker({
      command: 'node.exe',
      args: ['', 'workspace folder', 'quote"tail\\'],
      cwd: 'C:\\workspace',
      env: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32' },
      cacheRoot,
    });

    expect(result).toEqual({ started: true });
    const [executable, args, options] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { cwd: string; env: NodeJS.ProcessEnv; stdio: string; windowsHide: boolean },
    ];
    expect(executable).toBe(process.execPath);
    expect(path.dirname(args[0])).toBe(cacheRoot);
    expect(args[0]).toMatch(/\.cjs$/u);
    expect(readFileSync(args[0], 'utf8')).toContain('child.kill(); process.exit(1)');
    expect(args[1]).toBe(
      path.join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    );
    expect(options).toMatchObject({
      cwd: 'C:\\workspace',
      stdio: 'ignore',
      detached: true,
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
        cacheRoot,
      }),
    ).toEqual({ started: false, error: 'Windows process broker did not start' });
    expect(spawnMock.mock.calls[0]?.[1]?.[1]).toBe('powershell.exe');
  });

  it('returns spawn failures without throwing', () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    expect(
      launchWindowsProcessWithBroker({
        command: 'node.exe',
        args: [],
        cwd: '.',
        env: {},
        cacheRoot,
      }),
    ).toEqual({ started: false, error: 'spawn failed' });

    spawnMock.mockImplementationOnce(() => {
      throw 'unexpected failure';
    });
    expect(
      launchWindowsProcessWithBroker({
        command: 'node.exe',
        args: [],
        cwd: '.',
        env: {},
        cacheRoot,
      }),
    ).toEqual({ started: false, error: 'Windows process broker failed to start' });
  });

  it('repairs modified worker bytes before reuse and never stores the launch payload', () => {
    spawnMock.mockReturnValue({ pid: 1234, on: vi.fn(), unref: vi.fn() });
    const options = { command: 'node.exe', args: ['private target'], cwd: '.', env: {}, cacheRoot };
    expect(launchWindowsProcessWithBroker(options).started).toBe(true);
    const workerPath = spawnMock.mock.calls[0][1][0] as string;
    const original = readFileSync(workerPath, 'utf8');
    expect(original).not.toContain('private target');
    writeFileSync(workerPath, 'throw new Error("modified")');
    expect(launchWindowsProcessWithBroker(options).started).toBe(true);
    expect(readFileSync(workerPath, 'utf8')).toBe(original);
  });

  it('returns unavailable when its optional worker cache cannot be prepared', () => {
    const invalid = path.join(cacheRoot, 'file');
    writeFileSync(invalid, 'occupied');
    expect(
      launchWindowsProcessWithBroker({
        command: 'node.exe',
        args: [],
        cwd: '.',
        env: {},
        cacheRoot: invalid,
      }).started,
    ).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
