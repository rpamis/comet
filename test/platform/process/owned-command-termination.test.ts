import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runOwnedCommand } from '../../../platform/process/run-owned-command.js';
import * as termination from '../../../platform/process/terminate-process-tree.js';
import { terminateProcessTreeConfirmed } from '../../../platform/process/terminate-process-tree.js';
import {
  spawnOwnedCommand,
  type OwnedProcessInstance,
} from '../../../platform/process/owned-command.js';

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const systemRoot = process.env.SystemRoot;
let directory: string;
const processes: ChildProcess[] = [];
const descendants = new Set<number>();

it('keeps its deadline when the owner event loop cannot run its timeout timer', async () => {
  const marker = path.join(directory, 'timer-heartbeat'),
    started = path.join(directory, 'timer-started'),
    blocked = path.join(directory, 'owner-blocked'),
    resumed = path.join(directory, 'owner-resumed'),
    result = path.join(directory, 'owner-result.json'),
    bundle = path.join(directory, 'blocked-owner.cjs');
  const heartbeat =
    "setInterval(() => require('node:fs').appendFileSync(process.argv[1], 'tick\\n'), 40)";
  const command = `const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(heartbeat)},process.argv[2]],{stdio:'ignore',windowsHide:true});require('node:fs').writeFileSync(process.argv[1],JSON.stringify({command:process.pid,descendant:child.pid}));setInterval(()=>{},1000)`;
  await build({
    stdin: {
      contents: `const fs=require('node:fs');const {runOwnedCommand}=require('./platform/process/run-owned-command.ts');let confirmed;runOwnedCommand(process.execPath,['-e',${JSON.stringify(command)},process.env.COMET_TEST_STARTED,process.env.COMET_TEST_MARKER],{cwd:process.env.COMET_TEST_ROOT,timeoutMs:5000,onTerminated:async(_instance,value)=>{confirmed=value}}).then(()=>fs.writeFileSync(process.env.COMET_TEST_RESULT,JSON.stringify({completed:true,confirmed})),error=>fs.writeFileSync(process.env.COMET_TEST_RESULT,JSON.stringify({error:error.message,confirmed})));const poll=setInterval(()=>{if(fs.existsSync(process.env.COMET_TEST_STARTED)){clearInterval(poll);fs.writeFileSync(process.env.COMET_TEST_BLOCKED,'blocked');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000);fs.writeFileSync(process.env.COMET_TEST_RESUMED,'resumed')}},25);`,
      resolveDir: process.cwd(),
    },
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  });
  const owner = spawn(process.execPath, [bundle], {
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      COMET_TEST_ROOT: directory,
      COMET_TEST_STARTED: started,
      COMET_TEST_MARKER: marker,
      COMET_TEST_BLOCKED: blocked,
      COMET_TEST_RESUMED: resumed,
      COMET_TEST_RESULT: result,
    },
  });
  processes.push(owner);
  const deadline = Date.now() + 5000;
  while (!(await fs.stat(started).catch(() => null))) {
    if (Date.now() > deadline) throw new Error('owned command did not start');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const pids = JSON.parse(await fs.readFile(started, 'utf8')) as {
    command: number;
    descendant: number;
  };
  descendants.add(pids.command);
  descendants.add(pids.descendant);
  expect(await alive(pids.command)).toBe(true);
  expect(await alive(pids.descendant)).toBe(true);
  const cleanupDeadline = Date.now() + 8000;
  while ((await alive(pids.command)) || (await alive(pids.descendant))) {
    if (Date.now() > cleanupDeadline)
      throw new Error('command tree survived its deadline while the owner was blocked');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(await fs.readFile(blocked, 'utf8')).toBe('blocked');
  expect(await fs.stat(resumed).catch(() => null)).toBeNull();
  const stoppedHeartbeat = await fs.readFile(marker, 'utf8');
  expect(stoppedHeartbeat).toContain('tick');
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(await fs.readFile(marker, 'utf8')).toBe(stoppedHeartbeat);
  await Promise.race([
    owner.exitCode !== null ? Promise.resolve() : once(owner, 'exit'),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('owner did not finish after timeout')), 10000),
    ),
  ]);
  expect(JSON.parse(await fs.readFile(result, 'utf8'))).toEqual({
    error: 'timeout',
    confirmed: true,
  });
}, 25000);

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
  it('并行命令超时后均能确认整树停止，不与监管器的子树清理竞争', async () => {
    for (let round = 0; round < 3; round++) {
      const outcomes = await Promise.all(
        Array.from({ length: 4 }, async () => {
          let confirmed: boolean | undefined;
          let error: string | undefined;
          try {
            await runOwnedCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
              cwd: directory,
              env: process.env,
              timeoutMs: 1500,
              onTerminated: async (_instance, stopped) => {
                confirmed = stopped;
              },
            });
          } catch (failure) {
            error = (failure as Error).message;
          }
          return { confirmed, error };
        }),
      );
      for (const outcome of outcomes)
        expect(outcome).toEqual({ confirmed: true, error: 'timeout' });
    }
  }, 30000);
  it('无限时命令仍需登记，并可确认停止其进程树', async () => {
    const owned = spawnOwnedCommand(
      process.execPath,
      ['-e', 'console.log("ready");setInterval(()=>{},1000)'],
      {
        cwd: directory,
        timeoutMs: null,
      },
    );
    processes.push(owned.child);
    await owned.ready;
    const output = once(owned.child.stdout, 'data');
    owned.start();
    expect(String((await output)[0])).toContain('ready');
    expect(await alive(owned.child.pid!)).toBe(true);
    expect(await terminateProcessTreeConfirmed(owned.child)).toBe(true);
    await untilDead(owned.child.pid!);
  });
  // 各平台都执行延迟收尾；Windows 还须保留 taskkill 核对所需的监管器身份。
  it('Windows 等待调用方核对整树终止时保留原监管器身份', async () => {
    const terminate = termination.terminateProcessTreeConfirmed;
    vi.spyOn(termination, 'terminateProcessTreeConfirmed').mockImplementation(async (child) => {
      await new Promise((resolve) => setTimeout(resolve, 6000));
      return terminate(child);
    });
    const output = await runOwnedCommand(process.execPath, ['-e', 'console.log("done")'], {
      cwd: directory,
      env: process.env,
      timeoutMs: 10000,
    });
    expect(output).toBe('done\n');
  }, 20000);
  it('短命令时限不让尚未启动命令的监管器抢先自清理', async () => {
    const owned = spawnOwnedCommand(process.execPath, ['-e', 'setTimeout(() => {}, 200)'], {
      cwd: directory,
      timeoutMs: 25,
      confirmTermination: true,
    });
    processes.push(owned.child);
    await owned.ready;
    const messages: unknown[] = [];
    owned.child.on('message', (message) => messages.push(message));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(messages).toEqual([]);
    expect(await alive(owned.child.pid!)).toBe(true);
    expect(await terminateProcessTreeConfirmed(owned.child)).toBe(true);
    await untilDead(owned.child.pid!);
  });
  it('超时后 Windows 等待原调用方核对，POSIX 仍能自行停止进程组', async () => {
    const owned = spawnOwnedCommand(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      cwd: directory,
      timeoutMs: 500,
      confirmTermination: true,
    });
    processes.push(owned.child);
    const timedOut = new Promise<void>((resolve) => {
      owned.child.on('message', (message: { type?: string; reason?: string }) => {
        if (message.type === 'interrupted' && message.reason === 'timeout') resolve();
      });
    });
    await owned.ready;
    owned.start();
    await timedOut;
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (platform.value === 'win32') expect(await alive(owned.child.pid!)).toBe(true);
    else await untilDead(owned.child.pid!);
    expect(await terminateProcessTreeConfirmed(owned.child)).toBe(true);
    await untilDead(owned.child.pid!);
  });
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

  it.each(['gone', 'delayed', 'alive', 'unknown'] as const)(
    'Darwin 成功发送 SIGKILL 后整组为 %s 时按退出探测确认',
    async (state) => {
      Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
      const pid = 2147483002;
      let probes = 0;
      const now = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => now + (probes > 0 ? 2000 : 0));
      const kill = vi.spyOn(process, 'kill').mockImplementation((target, signal) => {
        expect(target).toBe(-pid);
        if (signal === 'SIGKILL') return true;
        expect(signal).toBe(0);
        probes += 1;
        if (state === 'gone' || (state === 'delayed' && probes === 2))
          throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
        if (state === 'unknown') throw Object.assign(new Error('probe EIO'), { code: 'EIO' });
        return true;
      });
      // delayed 的首轮仍存活，保留一次真实等待，第二轮退出。
      if (state === 'delayed') vi.mocked(Date.now).mockReturnValue(now);
      const child = { pid, kill: vi.fn(() => false) } as unknown as ChildProcess;
      await expect(terminateProcessTreeConfirmed(child)).resolves.toBe(
        state === 'gone' || state === 'delayed',
      );
      expect(probes).toBe(state === 'delayed' ? 2 : 1);
      expect(kill.mock.calls.filter(([, signal]) => signal === 'SIGKILL')).toHaveLength(1);
    },
  );

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
