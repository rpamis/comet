import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

import { commandInvocation } from './spawn-command.js';

/** 独立监管器持有时限；原调用方退出后，IPC 断连仍会终止整个检查进程组。 */
const SUPERVISOR = String.raw`
const { spawn } = require('node:child_process');
const path = require('node:path');
let started = false;
let stopping = false;
let child;
const send = (message) => { if (process.connected) process.send(message, () => {}); };
const stop = (reason) => {
  if (stopping) return;
  stopping = true;
  if (reason !== 'completed') send({ type: 'interrupted', reason });
  if (process.platform !== 'win32') {
    try { process.kill(-process.pid, 'SIGKILL'); } catch {}
    process.exit(1);
  }
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const killer = spawn(path.win32.join(systemRoot, 'System32', 'taskkill.exe'), ['/pid', String(process.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  killer.on('error', () => { child?.kill('SIGKILL'); process.exit(1); });
  setTimeout(() => { killer.kill('SIGKILL'); child?.kill('SIGKILL'); process.exit(1); }, 2000);
};
process.stdout.on('error', () => stop('owner-output-closed'));
process.stderr.on('error', () => stop('owner-output-closed'));
process.on('uncaughtException', () => stop('supervisor-error'));
process.on('unhandledRejection', () => stop('supervisor-error'));
process.on('disconnect', () => stop('owner-exited'));
process.on('SIGTERM', () => stop('cancelled'));
process.on('SIGINT', () => stop('cancelled'));
process.on('message', (message) => {
  if (started || message.type !== 'start') return;
  started = true;
  const timer = setTimeout(() => stop('timeout'), message.timeoutMs);
  try {
    child = spawn(message.command, message.args, { cwd: message.cwd, env: message.env, shell: false, windowsHide: true, detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    child.once('error', (error) => { send({ type: 'spawn-error', message: error.message }); clearTimeout(timer); process.exit(1); });
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
  } catch (error) { send({ type: 'spawn-error', message: String(error) }); clearTimeout(timer); process.exit(1); }
});
// 未登记的监管器不能启动命令，登记方丢失或永久卡住也不会留下常驻进程。
setTimeout(() => { if (!started) stop('registration-timeout'); }, Number(process.argv[1]) || 30000).unref();
`;

export function spawnOwnedCommand(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): {
  child: ChildProcessByStdio<null, Readable, Readable>;
  start: () => void;
} {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1)
    throw new Error('受管命令时限必须是正整数');
  const deadlineAt = Date.now() + options.timeoutMs;
  const invocation = commandInvocation(command, args, options);
  const child = spawn(process.execPath, ['-e', SUPERVISOR, String(options.timeoutMs)], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  }) as ChildProcessByStdio<null, Readable, Readable>;
  return {
    child,
    start: () => {
      if (!child.connected) throw new Error('检查监管进程在登记完成前退出');
      child.send!({
        type: 'start',
        ...invocation,
        cwd: options.cwd,
        timeoutMs: Math.max(1, deadlineAt - Date.now()),
      });
    },
  };
}
