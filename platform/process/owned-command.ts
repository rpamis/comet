import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

import { commandInvocation } from './spawn-command.js';
import { registerTerminationPreparation } from './terminate-process-tree.js';

/** 独立监管器持有时限；原调用方退出后，IPC 断连仍会终止整个检查进程组。 */
const SUPERVISOR = String.raw`
const { spawn } = require('node:child_process');
const path = require('node:path');
let started = false;
let stopping = false;
let terminating = false;
let child;
let commandStop;
const ownerConfirmsTermination = process.argv[2] === 'confirm-termination';
const send = (message) => { if (process.connected) process.send(message, () => {}); };
const killTree = (pid) => {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  return spawn(path.win32.join(systemRoot, 'System32', 'taskkill.exe'), ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
};
const stopCommand = () => commandStop ??= new Promise((resolve) => {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
  const killer = killTree(child.pid);
  const fallback = () => child?.kill('SIGKILL');
  const finish = () => { clearTimeout(timer); resolve(); };
  killer.once('error', () => { fallback(); finish(); });
  const timer = setTimeout(() => { killer.kill('SIGKILL'); fallback(); }, 2000);
  killer.once('close', finish);
});
const terminate = () => {
  if (terminating) return;
  terminating = true;
  if (process.platform !== 'win32') {
    try { process.kill(-process.pid, 'SIGKILL'); } catch {}
    process.exit(1);
  }
  const killer = killTree(process.pid);
  killer.on('error', () => { child?.kill('SIGKILL'); process.exit(1); });
  setTimeout(() => { killer.kill('SIGKILL'); child?.kill('SIGKILL'); process.exit(1); }, 2000);
};
const stop = (reason) => {
  if (stopping) return;
  stopping = true;
  if (reason !== 'completed') send({ type: 'interrupted', reason });
  // 原调用方必须在监管器仍存活时确认 taskkill；不要同时退出造成竞态。
  if (ownerConfirmsTermination && process.connected) {
    // 先守住命令时限，监管器继续存活以供原调用方核对整树停止。
    if (reason === 'timeout' && process.platform === 'win32') stopCommand();
    // 调用方仍在线时给系统整树核对留出期限；断连仍立即清理，不能先退出丢失原 PID 身份。
    setTimeout(terminate, reason === 'timeout' && process.platform !== 'win32' ? 250 : 30000);
    return;
  }
  terminate();
};
process.stdout.on('error', () => stop('owner-output-closed'));
process.stderr.on('error', () => stop('owner-output-closed'));
process.on('uncaughtException', () => stop('supervisor-error'));
process.on('unhandledRejection', () => stop('supervisor-error'));
process.on('disconnect', () => { if (stopping) terminate(); else stop('owner-exited'); });
process.on('SIGTERM', () => stop('cancelled'));
process.on('SIGINT', () => stop('cancelled'));
process.on('message', (message) => {
  if (message.type === 'prepare-termination') {
    if (!stopping) { stopping = true; setTimeout(terminate, 30000); }
    void stopCommand().then(() => send({ type: 'termination-ready' }));
    return;
  }
  if (started || stopping || message.type !== 'start') return;
  started = true;
  const timer = message.timeoutMs === null ? undefined : setTimeout(() => stop('timeout'), message.timeoutMs);
  try {
    child = spawn(message.command, message.args, { cwd: message.cwd, env: message.env, shell: false, windowsHide: true, detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    child.once('error', (error) => { send({ type: 'spawn-error', message: error.message }); clearTimeout(timer); if (ownerConfirmsTermination) stop('spawn-error'); else process.exit(1); });
    child.once('close', (code, signal) => {
      let remaining = 2;
      const flushed = () => {
        if (--remaining !== 0) return;
        clearTimeout(timer);
        if (process.connected) process.send({ type: 'completed', exitCode: code, signal }, () => stop('completed'));
        else stop('owner-exited');
      };
      process.stdout.write('', flushed);
      process.stderr.write('', flushed);
    });
  } catch (error) { send({ type: 'spawn-error', message: String(error) }); clearTimeout(timer); if (ownerConfirmsTermination) stop('spawn-error'); else process.exit(1); }
});
// 未登记的监管器不能启动命令，登记方丢失或永久卡住也不会留下常驻进程。
setTimeout(() => { if (!started) stop('registration-timeout'); }, Number(process.argv[1]) || 30000).unref();
send({ type: 'ready' });
`;

export interface OwnedProcessInstance {
  pid: number;
  identity?: string;
  instanceId: string;
  ownerPid: number;
}

export function spawnOwnedCommand(
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs: number | null;
    confirmTermination?: boolean;
  },
): {
  child: ChildProcessByStdio<null, Readable, Readable>;
  start: () => void;
  instanceId: string;
  ready: Promise<void>;
} {
  if (
    options.timeoutMs !== null &&
    (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1)
  )
    throw new Error('受管命令时限必须是正整数');
  const deadlineAt = options.timeoutMs === null ? null : Date.now() + options.timeoutMs;
  const invocation = commandInvocation(command, args, options);
  const child = spawn(
    process.execPath,
    [
      '-e',
      SUPERVISOR,
      // 登记期限独立于命令期限，避免极短命令时限与调用方的整树终止相互竞争。
      '30000',
      options.confirmTermination ? 'confirm-termination' : '',
    ],
    {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  ) as ChildProcessByStdio<null, Readable, Readable>;
  if (options.confirmTermination && process.platform === 'win32') {
    let preparation: Promise<void> | undefined;
    registerTerminationPreparation(
      child,
      () =>
        (preparation ??= new Promise<void>((resolve) => {
          if (!child.connected) {
            resolve();
            return;
          }
          const finish = () => {
            clearTimeout(timer);
            child.off('message', onMessage);
            child.off('error', finish);
            child.off('close', finish);
            child.off('disconnect', finish);
            resolve();
          };
          const onMessage = (message: unknown) => {
            if ((message as { type?: unknown } | null)?.type === 'termination-ready') finish();
          };
          // 监管器的清理工具最多等待 2 秒；通信失败后仍由调用方尝试整树确认。
          const timer = setTimeout(finish, 3000);
          child.on('message', onMessage);
          child.once('error', finish);
          child.once('close', finish);
          child.once('disconnect', finish);
          child.send!({ type: 'prepare-termination' }, (error) => {
            if (error) finish();
          });
        })),
    );
  }
  const ready = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('close', onClose);
    };
    const onMessage = (message: unknown) => {
      if ((message as { type?: unknown } | null)?.type !== 'ready') return;
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('检查监管进程在就绪前退出'));
    };
    child.on('message', onMessage);
    child.once('error', onError);
    child.once('close', onClose);
  });
  void ready.catch(() => {});
  return {
    child,
    ready,
    instanceId: randomUUID(),
    start: () => {
      if (!child.connected) throw new Error('检查监管进程在登记完成前退出');
      child.send!({
        type: 'start',
        ...invocation,
        cwd: options.cwd,
        timeoutMs: deadlineAt === null ? null : Math.max(1, deadlineAt - Date.now()),
      });
    },
  };
}
