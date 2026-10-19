import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runOwnedCommand } from '../../../platform/process/run-owned-command.js';
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
  it('taskkill 失败只杀监管器时返回未确认，实际后代仍存活', async () => {
    const { child, grandchild } = await tree();
    const closed = once(child, 'close');
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    process.env.SystemRoot = 'C:\\comet-missing-taskkill-test';
    expect(await terminateProcessTreeConfirmed(child)).toBe(false);
    await closed;
    Object.defineProperty(process, 'platform', platform);
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
