import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send, endpoint, launch, spawnChild, timing, filesystem } = vi.hoisted(() => ({
  send: vi.fn(),
  endpoint: vi.fn(),
  launch: vi.fn(),
  spawnChild: vi.fn(),
  timing: { firstRequest: null as number | null, startedAt: 0 },
  filesystem: { failure: '' },
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

vi.mock('node:child_process', () => ({ spawn: spawnChild }));
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return {
    ...actual,
    mkdirSync: (...args: Parameters<typeof actual.mkdirSync>) => {
      if (filesystem.failure === 'directory')
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return actual.mkdirSync(...args);
    },
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      if (filesystem.failure === 'file' && String(args[0]).endsWith('.tmp')) {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }
      if (filesystem.failure === 'read' && String(args[0]).endsWith('.retry')) {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }
      return actual.openSync(...args);
    },
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (filesystem.failure === 'rename')
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return actual.renameSync(...args);
    },
    existsSync: (file: Parameters<typeof actual.existsSync>[0]) =>
      String(file).replaceAll('\\', '/').endsWith('dist/app/commands/daemon-server.js') ||
      actual.existsSync(file),
  };
});

import {
  runCometDaemonCommand,
  tryRunCometDaemon,
  resolveCometDaemonRoute,
} from '../../bin/comet-daemon-router.js';

describe('daemon invocation startup budget', () => {
  let project: string;
  let lock: string;
  let retry: string;
  let previousExitCode: typeof process.exitCode;
  beforeEach(() => {
    vi.resetAllMocks();
    filesystem.failure = '';
    timing.firstRequest = null;
    project = mkdtempSync(path.join(os.tmpdir(), 'comet-daemon-budget-'));
    vi.spyOn(os, 'tmpdir').mockReturnValue(project);
    const key = `budget-${randomUUID()}`;
    lock = path.join(os.tmpdir(), 'comet-daemon-launch', `${key}.lock`);
    retry = `${lock}.retry`;
    endpoint.mockReturnValue({ key, endpoint: 'test-endpoint', environmentFingerprint: 'test' });
    launch.mockReturnValue({ started: true });
    spawnChild.mockReturnValue({ once: vi.fn(), unref: vi.fn() });
    previousExitCode = process.exitCode;
    vi.stubEnv('HOME', project);
    vi.stubEnv('USERPROFILE', project);
    vi.stubEnv('COMET_DAEMON_BUILD_ID', key);
    vi.stubEnv('COMET_DAEMON', 'auto');
    vi.stubEnv('COMET_DAEMON_SERVER', '');
    vi.stubEnv('COMET_TASK', '');
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    filesystem.failure = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = previousExitCode;
    rmSync(project, { recursive: true, force: true });
  });

  async function finishStart() {
    timing.startedAt = performance.now();
    const pending = runCometDaemonCommand(['daemon', 'start', '--project-root', project, '--json']);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    await vi.runAllTimersAsync();
    return pending;
  }

  function automaticRead() {
    return tryRunCometDaemon(['native', 'status', '--project-root', project, '--json']);
  }

  function expectLaunchCount(count: number) {
    expect(process.platform === 'win32' ? launch : spawnChild).toHaveBeenCalledTimes(count);
  }

  it.runIf(process.platform === 'win32')(
    'stops retrying absent endpoints within one budget',
    async () => {
      send.mockRejectedValue(new Error('not ready'));
      await finishStart();
      expect(performance.now() - timing.startedAt).toBe(10_000);
      expect(process.exitCode).toBe(70);
      expect(launch).toHaveBeenCalledOnce();
    },
  );

  it('includes stalled IPC requests in the same budget', async () => {
    send.mockImplementation(
      ({ timeoutMs }: { timeoutMs: number }) =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('request timeout')), timeoutMs);
        }),
    );
    await finishStart();
    expect(performance.now() - timing.startedAt).toBe(10_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].timeoutMs).toBe(4980 - (timing.firstRequest! - timing.startedAt));
    expect(process.exitCode).toBe(70);
  });

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

  it('falls back immediately when another automatic launch is pending', async () => {
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
    expect(spawnChild).not.toHaveBeenCalled();
  });
  it('bounds automatic read fallback even when every connection stalls', async () => {
    send.mockImplementation(
      ({ timeoutMs }: { timeoutMs: number }) =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('request timeout')), timeoutMs);
        }),
    );
    timing.startedAt = performance.now();
    const pending = tryRunCometDaemon([
      'classic',
      'state',
      'current',
      '--project-root',
      project,
      '--json',
    ]);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    await vi.runAllTimersAsync();
    expect(await pending).toBe(false);
    expect(performance.now() - timing.firstRequest!).toBe(100);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0].control).toBe('ping');
    expectLaunchCount(1);
    expect(process.exitCode).toBe(previousExitCode);
    expect(process.stdout.write).not.toHaveBeenCalled();

    rmSync(lock, { force: true });
    const repeated = automaticRead();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await vi.runAllTimersAsync();
    expect(await repeated).toBe(false);
    expectLaunchCount(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still probes a ready daemon after slow invocation setup', async () => {
    const resolvedEndpoint = endpoint();
    endpoint.mockImplementationOnce(() => {
      vi.advanceTimersByTime(250);
      return resolvedEndpoint;
    });
    send.mockResolvedValue({ ok: true, stdout: 'ready\n', exitCode: 0 });
    expect(await automaticRead()).toBe(true);
    expect(send.mock.calls[0][0]).toMatchObject({ control: 'ping', timeoutMs: 100 });
    expect(process.stdout.write).toHaveBeenCalledWith('ready\n');
    expectLaunchCount(0);
  });

  it('falls back without startup retries and shares failed-launch cooldown across invocations', async () => {
    send.mockRejectedValue(new Error('missing endpoint'));
    timing.startedAt = performance.now();
    expect(await automaticRead()).toBe(false);
    expect(performance.now() - timing.startedAt).toBe(0);
    expectLaunchCount(1);
    expect(vi.getTimerCount()).toBe(0);

    // 模拟子进程创建 IPC 失败并清理启动锁，下一次 CLI 加载仍应遵守冷却时间。
    rmSync(lock, { force: true });
    vi.resetModules();
    const nextInvocation = await import('../../bin/comet-daemon-router.js');
    expect(
      await nextInvocation.tryRunCometDaemon([
        'native',
        'status',
        '--project-root',
        project,
        '--json',
      ]),
    ).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
    expectLaunchCount(1);
    expect(existsSync(lock)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries background startup after the failed-launch cooldown expires', async () => {
    send.mockRejectedValue(new Error('missing endpoint'));
    expect(await automaticRead()).toBe(false);
    rmSync(lock, { force: true });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await automaticRead()).toBe(false);
    expectLaunchCount(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.runIf(process.platform !== 'win32').each(['private content', 'current timestamp'])(
    'replaces a retry symlink without reading or changing its target: %s',
    async (kind) => {
      const victim = path.join(project, 'victim.txt');
      const contents = kind === 'current timestamp' ? String(Date.now()) : 'Keep these settings';
      writeFileSync(victim, contents);
      mkdirSync(path.dirname(retry), { recursive: true, mode: 0o700 });
      symlinkSync(victim, retry);
      send.mockRejectedValue(new Error('missing endpoint'));

      expect(await automaticRead()).toBe(false);
      expectLaunchCount(1);
      expect(readFileSync(victim, 'utf8')).toBe(contents);
      expect(lstatSync(retry).isSymbolicLink()).toBe(false);
      expect(readFileSync(retry, 'utf8')).toBe(String(Date.now()));
    },
  );

  it.runIf(process.platform !== 'win32')(
    'rejects a symlink launch directory without touching its target',
    async () => {
      const target = path.join(project, 'other-directory');
      mkdirSync(target, { mode: 0o700 });
      symlinkSync(target, path.dirname(lock), 'dir');
      send.mockRejectedValue(new Error('missing endpoint'));
      expect(await automaticRead()).toBe(false);
      expectLaunchCount(0);
      expect(readdirSync(target)).toEqual([]);
      expect(lstatSync(path.dirname(lock)).isSymbolicLink()).toBe(true);
    },
  );

  it('rejects a non-directory launch path without changing the file', async () => {
    const directory = path.dirname(lock);
    writeFileSync(directory, 'keep this file');
    send.mockRejectedValue(new Error('missing endpoint'));
    expect(await automaticRead()).toBe(false);
    expectLaunchCount(0);
    expect(readFileSync(directory, 'utf8')).toBe('keep this file');
  });

  it('does not read a non-regular cooldown record', async () => {
    mkdirSync(retry, { recursive: true, mode: 0o700 });
    send.mockRejectedValue(new Error('missing endpoint'));
    expect(await automaticRead()).toBe(false);
    expectLaunchCount(0);
    expect(lstatSync(retry).isDirectory()).toBe(true);
    expect(readdirSync(retry)).toEqual([]);
    rmSync(retry, { recursive: true });
  });

  it('replaces oversized cooldown contents without reading them', async () => {
    mkdirSync(path.dirname(retry), { recursive: true, mode: 0o700 });
    writeFileSync(retry, `${' '.repeat(100)}${Date.now()}`);
    send.mockRejectedValue(new Error('missing endpoint'));
    expect(await automaticRead()).toBe(false);
    expectLaunchCount(1);
    expect(readFileSync(retry, 'utf8')).toBe(String(Date.now()));
  });

  it.each(['directory', 'file', 'read', 'rename'])(
    'falls back locally when cooldown %s access is denied',
    async (operation) => {
      mkdirSync(path.dirname(retry), { recursive: true, mode: 0o700 });
      writeFileSync(retry, '0');
      filesystem.failure = operation;
      send.mockRejectedValue(new Error('missing endpoint'));
      expect(await automaticRead()).toBe(false);
      expectLaunchCount(0);
      expect(existsSync(lock)).toBe(false);
      expect(readFileSync(retry, 'utf8')).toBe('0');
      expect(readdirSync(path.dirname(retry))).toEqual([path.basename(retry)]);
      expect(process.exitCode).toBe(previousExitCode);
      expect(process.stdout.write).not.toHaveBeenCalled();
      expect(process.stderr.write).not.toHaveBeenCalled();
    },
  );

  it('keeps launch failures local and observes cooldown after releasing the launch lock', async () => {
    send.mockRejectedValue(new Error('missing endpoint'));
    spawnChild.mockImplementationOnce(() => {
      throw new Error('launch unavailable');
    });
    launch.mockReturnValueOnce({ started: false, error: 'launch unavailable' });
    expect(await automaticRead()).toBe(false);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(retry)).toBe(true);
    expect(await automaticRead()).toBe(false);
    expectLaunchCount(1);
    expect(process.exitCode).toBe(previousExitCode);
    expect(process.stdout.write).not.toHaveBeenCalled();
    expect(process.stderr.write).not.toHaveBeenCalled();
  });

  it.runIf(process.platform !== 'win32')(
    'handles asynchronous child launch failure without crashing the caller',
    async () => {
      send.mockRejectedValue(new Error('missing endpoint'));
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
      spawnChild.mockReturnValueOnce(child);
      expect(await automaticRead()).toBe(false);
      expect(() => child.emit('error', new Error('spawn unavailable'))).not.toThrow();
      expect(existsSync(lock)).toBe(false);
      expect(existsSync(retry)).toBe(true);
      expect(await automaticRead()).toBe(false);
      expectLaunchCount(1);
    },
  );

  it.runIf(process.platform !== 'win32')(
    'keeps a replacement launch lock when an older child fails',
    async () => {
      send.mockRejectedValue(new Error('missing endpoint'));
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
      spawnChild.mockReturnValueOnce(child);
      expect(await automaticRead()).toBe(false);
      const replacement = `${lock}.replacement`;
      writeFileSync(replacement, 'replacement launcher');
      renameSync(replacement, lock);
      expect(() => child.emit('error', new Error('older spawn unavailable'))).not.toThrow();
      expect(readFileSync(lock, 'utf8')).toBe('replacement launcher');
    },
  );

  it('uses a recovered daemon during cooldown and clears the failed-launch record', async () => {
    send.mockRejectedValue(new Error('missing endpoint'));
    expect(await automaticRead()).toBe(false);
    rmSync(lock, { force: true });
    expect(existsSync(retry)).toBe(true);
    send.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({
      ok: true,
      stdout: '{"recovered":true}\n',
      exitCode: 0,
    });
    expect(await automaticRead()).toBe(true);
    expect(process.stdout.write).toHaveBeenCalledWith('{"recovered":true}\n');
    expect(existsSync(retry)).toBe(false);
    expectLaunchCount(1);

    // 就绪服务之后退出时，应允许立即重新启动。
    expect(await automaticRead()).toBe(false);
    expectLaunchCount(2);
  });

  it('preserves the full response timeout for reads on a ready daemon', async () => {
    send.mockResolvedValueOnce({ ok: true }).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true, stdout: 'read finished\n', exitCode: 0 }), 1_500);
        }),
    );
    const pending = automaticRead();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await vi.runAllTimersAsync();
    expect(await pending).toBe(true);
    expect(send.mock.calls[0][0].control).toBe('ping');
    expect(send.mock.calls[1][0]).toMatchObject({ runtime: 'native', timeoutMs: 5_000 });
    expect(send.mock.calls[1][0].control).toBeUndefined();
    expect(process.stdout.write).toHaveBeenCalledWith('read finished\n');
    expectLaunchCount(0);
  });

  it('allows explicit startup during automatic-launch cooldown', async () => {
    send.mockRejectedValue(new Error('missing endpoint'));
    expect(await automaticRead()).toBe(false);
    rmSync(lock, { force: true });
    send.mockReset();
    send
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce({ ok: true, status: { pid: 777 } });
    await finishStart();
    expectLaunchCount(2);
    expect(send.mock.calls[0][0]).toMatchObject({ control: 'status', timeoutMs: 5_000 });
    expect(process.stdout.write).toHaveBeenCalledWith('{"pid":777}\n');
    expect(process.exitCode).toBe(previousExitCode);
  });

  it('falls back without relaunching when a ready daemon read times out', async () => {
    send.mockResolvedValueOnce({ ok: true }).mockImplementationOnce(
      ({ timeoutMs }: { timeoutMs: number }) =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('read timeout')), timeoutMs);
        }),
    );
    const pending = automaticRead();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await vi.runAllTimersAsync();
    expect(await pending).toBe(false);
    expect(send.mock.calls[1][0].timeoutMs).toBe(5_000);
    expectLaunchCount(0);
    expect(process.exitCode).toBe(previousExitCode);
    expect(process.stdout.write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('routes grouped Classic reads identically and leaves mutations and contextual options local', () => {
    expect(resolveCometDaemonRoute(['classic', 'state', 'next', 'demo', '--json'])).toEqual(
      resolveCometDaemonRoute(['state', 'next', 'demo', '--json']),
    );
    expect(
      resolveCometDaemonRoute(['classic', 'state', 'current', '--comet-task', 'review']),
    ).toBeNull();
    expect(
      resolveCometDaemonRoute(['classic', 'state', 'set', 'demo', 'phase', 'build']),
    ).toBeNull();
    expect(
      resolveCometDaemonRoute(['runtime', 'dispatch', '--request', 'request.json']),
    ).toBeNull();
  });

  it.each(['current', 'next'])(
    'retains facade context for top-level and grouped state %s',
    async (command) => {
      vi.stubEnv('COMET_TASK', 'Review the requested change');
      for (const prefix of [[], ['classic']]) {
        const argv = [...prefix, 'state', command, '--project-root', project, '--json'];
        expect(resolveCometDaemonRoute(argv)).toBeNull();
        expect(await tryRunCometDaemon(argv)).toBe(false);
        expect(resolveCometDaemonRoute(argv, { COMET_TASK: '  ' })).toEqual({
          runtime: 'classic',
          commandArgs: argv.slice(prefix.length),
        });
      }
      expect(send).not.toHaveBeenCalled();
      expect(resolveCometDaemonRoute(['native', 'status', '--json'])).not.toBeNull();
    },
  );

  it('retains the facade when a Classic query supplies a summary task', () => {
    for (const prefix of [[], ['classic']]) {
      expect(
        resolveCometDaemonRoute([...prefix, 'state', 'next', 'demo', '--summary', 'Review']),
      ).toBeNull();
    }
  });
});
