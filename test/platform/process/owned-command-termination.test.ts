import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runOwnedCommand } from '../../../platform/process/run-owned-command.js';
import * as termination from '../../../platform/process/terminate-process-tree.js';
import { terminateProcessTreeConfirmed } from '../../../platform/process/terminate-process-tree.js';
import type { OwnedProcessInstance } from '../../../platform/process/owned-command.js';

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const systemRoot = process.env.SystemRoot;
let directory: string;
const processes: ChildProcess[] = [];
const descendants = new Set<number>();

async function alive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    if (platform.value === 'linux') {
      const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
      if (/^[ZX] /u.test(stat.slice(stat.lastIndexOf(')') + 2))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function untilDead(pid: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!(await alive(pid))) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`测试后代仍存活：${pid}`);
}

async function tree() {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e','setTimeout(()=>{},20000)'],{stdio:'ignore'});
    child.unref(); console.log(child.pid); setTimeout(()=>{},20000);
  `,
    ],
    { cwd: directory, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  processes.push(child);
  const grandchild = Number(String((await once(child.stdout!, 'data'))[0]).trim());
  descendants.add(grandchild);
  return { child, grandchild };
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-process-termination-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  Object.defineProperty(process, 'platform', platform);
  if (systemRoot === undefined) delete process.env.SystemRoot;
  else process.env.SystemRoot = systemRoot;
  for (const child of processes.splice(0)) {
    await terminateProcessTreeConfirmed(child);
    if (child.pid) await untilDead(child.pid);
  }
  for (const pid of descendants) {
    if (await alive(pid)) process.kill(pid, 'SIGKILL');
    await untilDead(pid);
  }
  descendants.clear();
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('受管命令的整树终止证明', () => {
  it('POSIX 自清理后的短暂 EPERM 只有在整组消失后才能确认停止', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
    const pid = 2147483002;
    const denied = Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    const missing = Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    let probes = 0;
    const kill = vi.spyOn(process, 'kill').mockImplementation((target, signal) => {
      expect(target).toBe(-pid);
      if (signal === 'SIGKILL') throw denied;
      expect(signal).toBe(0);
      if (++probes === 1) throw denied;
      throw missing;
    });
    const child = { pid, kill: vi.fn(() => false) } as unknown as ChildProcess;
    await expect(terminateProcessTreeConfirmed(child)).resolves.toBe(true);
    expect(probes).toBe(2);
    expect(kill.mock.calls.filter(([, signal]) => signal === 'SIGKILL')).toHaveLength(1);
  });

  it.each(['alive', 'unknown'] as const)(
    'POSIX kill 被拒绝且整组仍为 %s 时不能只凭组长退出确认',
    async (state) => {
      Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
      const pid = 2147483002;
      const denied = Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
      vi.spyOn(process, 'kill').mockImplementation((target, signal) => {
        expect(target).toBe(-pid);
        if (signal === 'SIGKILL' || state === 'unknown') throw denied;
        expect(signal).toBe(0);
        return true;
      });
      const child = {
        pid,
        exitCode: 0,
        signalCode: null,
        kill: vi.fn(() => false),
      } as unknown as ChildProcess;
      await expect(terminateProcessTreeConfirmed(child)).rejects.toBe(denied);
      expect(child.kill).not.toHaveBeenCalled();
    },
  );

  it('POSIX 整组已消失的 ESRCH 可确认，不再探测或重发组信号', async () => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
    const pid = 2147483002;
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    });
    const child = { pid, kill: vi.fn(() => false) } as unknown as ChildProcess;
    await expect(terminateProcessTreeConfirmed(child)).resolves.toBe(true);
    expect(kill).toHaveBeenCalledExactlyOnceWith(-pid, 'SIGKILL');
  });

  it.each(['signal', 'probe'] as const)(
    'POSIX %s 遇到不明错误时保留原信号失败，不生成停止证明',
    async (stage) => {
      Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
      const pid = 2147483002;
      const original = Object.assign(new Error(`kill ${stage}`), {
        code: stage === 'signal' ? 'EIO' : 'EPERM',
      });
      const kill = vi.spyOn(process, 'kill').mockImplementation((_target, signal) => {
        if (signal === 'SIGKILL') throw original;
        throw Object.assign(new Error('probe EIO'), { code: 'EIO' });
      });
      const child = { pid, kill: vi.fn(() => false) } as unknown as ChildProcess;
      await expect(terminateProcessTreeConfirmed(child)).rejects.toBe(original);
      expect(kill).toHaveBeenCalledTimes(stage === 'signal' ? 1 : 2);
      expect(child.kill).not.toHaveBeenCalled();
    },
  );

  it('taskkill 失败时真实父子进程的清理保持未确认', async () => {
    const { child, grandchild } = await tree();
    expect(await alive(grandchild)).toBe(true);
    const closed = once(child, 'close');
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    process.env.SystemRoot = 'C:\\comet-missing-taskkill-test';
    expect(await terminateProcessTreeConfirmed(child)).toBe(false);
    await closed;
    Object.defineProperty(process, 'platform', platform);
    // Windows 的 Node 子进程可能随所属 Job 退出；不能把这种退出反推成 taskkill 成功。
    // POSIX 保留“组长已死、真实后代仍活”的故障证据。
    if (platform.value !== 'win32') expect(await alive(grandchild)).toBe(true);
  });

  it('taskkill 与单进程兜底都未停止真实父子进程时不能确认成功', async () => {
    const { child, grandchild } = await tree();
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    process.env.SystemRoot = 'C:\\comet-missing-taskkill-test';
    vi.spyOn(child, 'kill').mockReturnValue(false);
    expect(await terminateProcessTreeConfirmed(child)).toBe(false);
    Object.defineProperty(process, 'platform', platform);
    expect(await alive(child.pid!)).toBe(true);
    expect(await alive(grandchild)).toBe(true);
  });

  it('已收到退出事件的 Windows 句柄不能再次按 PID 生成成功证明', async () => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    processes.push(child);
    await once(child, 'close');
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    expect(await terminateProcessTreeConfirmed(child)).toBe(false);
  });

  it('runOwnedCommand 的终止失败不会被 completed 消息覆盖，回调保存未确认', async () => {
    let confirmed: boolean | undefined;
    await expect(
      runOwnedCommand(process.execPath, ['-e', 'console.log("done")'], {
        cwd: directory,
        env: process.env,
        timeoutMs: 10000,
        onRegistered: async () => {
          Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
          process.env.SystemRoot = 'C:\\comet-missing-taskkill-test';
        },
        onTerminated: async (_instance, value) => {
          confirmed = value;
        },
      }),
    ).rejects.toThrow('停止尚未确认');
    expect(confirmed).toBe(false);
  }, 20000);

  it('runOwnedCommand 保留终止错误 cause 和原进程上下文', async () => {
    const original = Object.assign(new Error('kill EIO'), { code: 'EIO' });
    vi.spyOn(termination, 'terminateProcessTreeConfirmed').mockRejectedValue(original);
    let registered: OwnedProcessInstance | undefined;
    let failure: unknown;
    try {
      await runOwnedCommand(process.execPath, ['-e', ''], {
        cwd: directory,
        env: process.env,
        timeoutMs: 10000,
        onRegistered: async (instance) => {
          registered = instance;
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).cause).toBe(original);
    expect((failure as Error).message).toContain(`${platform.value}; pid=${registered!.pid}`);
    await untilDead(registered!.pid);
  }, 20000);

  it('实际成功终止整树时返回确认且后代停止', async () => {
    const { child, grandchild } = await tree();
    expect(await terminateProcessTreeConfirmed(child)).toBe(true);
    await untilDead(grandchild);
  }, 15000);

  it('正常命令保留输出且登记匹配的成功收尾，不等待持活监管器死锁', async () => {
    let registered: OwnedProcessInstance | undefined;
    let termination: { instance: OwnedProcessInstance; confirmed: boolean } | undefined;
    const output = await runOwnedCommand(
      process.execPath,
      ['-e', 'console.log("完整输出 中文");'],
      {
        cwd: directory,
        env: process.env,
        timeoutMs: 10000,
        onRegistered: async (instance) => {
          registered = instance;
        },
        onTerminated: async (instance, confirmed) => {
          termination = { instance, confirmed };
        },
      },
    );
    expect(output).toBe('完整输出 中文\n');
    expect(termination).toEqual({ instance: registered, confirmed: true });
    expect(registered?.instanceId).toBeTruthy();
    expect(registered?.ownerPid).toBe(process.pid);
    await untilDead(registered!.pid);
  }, 20000);

  it.each([false, true])(
    '命令及中间父进程退出后不能为仍活着的忽略stdio后代写成功收据（bridge=%s）',
    async (bridge) => {
      const file = path.join(directory, 'orphan.json');
      const spawnDescendant = `
      const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,['-e','setTimeout(()=>{},20000)'],{stdio:'ignore'});
      child.unref();
      require('node:fs').writeFileSync(${JSON.stringify(file)},JSON.stringify({pid:child.pid,parent:process.pid}));
    `;
      const script = bridge
        ? `const result=require('node:child_process').spawnSync(process.execPath,['-e',${JSON.stringify(spawnDescendant)}],{stdio:'ignore'});process.exit(result.status ?? 1);`
        : spawnDescendant;
      let termination: { instance: OwnedProcessInstance; confirmed: boolean } | undefined;
      let failure: unknown;
      try {
        await runOwnedCommand(process.execPath, ['-e', script], {
          cwd: directory,
          env: process.env,
          timeoutMs: 10000,
          onTerminated: async (instance, confirmed) => {
            termination = { instance, confirmed };
          },
        });
      } catch (error) {
        failure = error;
      }
      const record = JSON.parse(await fs.readFile(file, 'utf8')) as { pid: number; parent: number };
      descendants.add(record.pid);
      expect(await alive(record.parent)).toBe(false);
      const orphanAlive = await alive(record.pid);
      expect(
        termination?.confirmed && orphanAlive,
        `不能确认整树已停却留下后代：${JSON.stringify({ platform: process.platform, bridge, orphanAlive, termination })}`,
      ).toBe(false);
      if (termination?.confirmed) expect(failure).toBeUndefined();
      else expect(failure).toBeTruthy();
    },
    20000,
  );

  it('命令超时仍登记已核验的终止，并等待实际后代停止', async () => {
    const file = path.join(directory, 'descendant.json');
    let termination: { instance: OwnedProcessInstance; confirmed: boolean } | undefined;
    await expect(
      runOwnedCommand(
        process.execPath,
        [
          '-e',
          `
      const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,['-e','setTimeout(()=>{},20000)'],{stdio:'ignore'});
      require('node:fs').writeFileSync(${JSON.stringify(file)},String(child.pid));
      setTimeout(()=>{},20000);
    `,
        ],
        {
          cwd: directory,
          env: process.env,
          timeoutMs: process.platform === 'win32' ? 8000 : 700,
          onTerminated: async (instance, confirmed) => {
            termination = { instance, confirmed };
          },
        },
      ),
    ).rejects.toThrow();
    const pid = Number(await fs.readFile(file, 'utf8'));
    descendants.add(pid);
    expect(termination?.confirmed).toBe(true);
    await untilDead(termination!.instance.pid);
    await untilDead(pid);
  }, 20000);
});
