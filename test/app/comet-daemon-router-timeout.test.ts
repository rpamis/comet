import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send, endpoint, launch, timing } = vi.hoisted(() => ({
  send: vi.fn(),
  endpoint: vi.fn(),
  launch: vi.fn(),
  timing: { firstRequest: null as number | null },
}));
vi.mock('../../dist/platform/process/comet-daemon.js', () => ({
  sendCometDaemonRequest: (...args: unknown[]) => {
    timing.firstRequest ??= performance.now();
    return send(...args);
  },
  resolveCometDaemonEndpoint: endpoint,
}));
vi.mock('../../dist/platform/process/windows-process-broker.js', () => ({
  launchWindowsProcessWithBroker: launch,
}));

import { runCometDaemonCommand, tryRunCometDaemon } from '../../bin/comet-daemon-router.js';

describe('Windows explicit daemon startup budget', () => {
  let project: string;
  let lock: string;
  let previousExitCode: typeof process.exitCode;
  beforeEach(() => {
    vi.resetAllMocks();
    timing.firstRequest = null;
    project = mkdtempSync(path.join(os.tmpdir(), 'comet-daemon-budget-'));
    const key = `budget-${randomUUID()}`;
    lock = path.join(os.tmpdir(), 'comet-daemon-launch', `${key}.lock`);
    endpoint.mockReturnValue({ key, endpoint: 'test-endpoint', environmentFingerprint: 'test' });
    launch.mockReturnValue({ started: true });
    previousExitCode = process.exitCode;
    vi.stubEnv('HOME', project);
    vi.stubEnv('USERPROFILE', project);
    vi.stubEnv('COMET_DAEMON_BUILD_ID', key);
    vi.stubEnv('COMET_DAEMON', 'auto');
    vi.stubEnv('COMET_DAEMON_SERVER', '');
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = previousExitCode;
    rmSync(lock, { force: true });
    rmSync(project, { recursive: true, force: true });
  });

  async function finishStart() {
    const pending = runCometDaemonCommand(['daemon', 'start', '--project-root', project, '--json']);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    await vi.runAllTimersAsync();
    return pending;
  }

  it.runIf(process.platform === 'win32')(
    'stops retrying absent endpoints within one budget',
    async () => {
      send.mockRejectedValue(new Error('not ready'));
      await finishStart();
      expect(performance.now() - timing.firstRequest!).toBe(10_000);
      expect(process.exitCode).toBe(70);
      expect(launch).toHaveBeenCalledOnce();
    },
  );

  it.runIf(process.platform === 'win32')(
    'includes stalled IPC requests in the same budget',
    async () => {
      send.mockImplementation(
        ({ timeoutMs }: { timeoutMs: number }) =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('request timeout')), timeoutMs);
          }),
      );
      await finishStart();
      expect(performance.now() - timing.firstRequest!).toBe(10_000);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[1][0].timeoutMs).toBe(4980);
      expect(process.exitCode).toBe(70);
    },
  );

  it.runIf(process.platform === 'win32')(
    'waits for an already pending launch without launching twice',
    async () => {
      mkdirSync(path.dirname(lock), { recursive: true });
      writeFileSync(lock, 'pending');
      send
        .mockRejectedValueOnce(new Error('not ready'))
        .mockRejectedValueOnce(new Error('not ready'))
        .mockResolvedValue({ ok: true, status: { pid: 777 } });
      await finishStart();
      expect(send).toHaveBeenCalledTimes(3);
      expect(launch).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(previousExitCode);
    },
  );

  it.runIf(process.platform !== 'win32')(
    'falls back immediately when another automatic launch is pending',
    async () => {
      mkdirSync(path.dirname(lock), { recursive: true });
      writeFileSync(lock, 'pending');
      send.mockRejectedValue(new Error('not ready'));
      const handled = await tryRunCometDaemon([
        'native',
        'status',
        '--project-root',
        project,
        '--json',
      ]);
      expect(handled).toBe(false);
      expect(send).toHaveBeenCalledOnce();
      expect(performance.now() - timing.firstRequest!).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(launch).not.toHaveBeenCalled();
    },
  );
});
