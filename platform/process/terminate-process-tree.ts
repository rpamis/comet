import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

const WINDOWS_TASKKILL_ATTEMPT_MS = 1_000;
const WINDOWS_TASKKILL_ATTEMPTS = 2;

/** 保留既有 best-effort 调用契约；需要清理证明的调用方使用确认版。 */
export async function terminateProcessTree(child: ChildProcess): Promise<void> {
  await terminateProcessTreeConfirmed(child);
}

/** 返回整树终止是否已确认；只杀掉组长不能证明 Windows 后代已退出。 */
export async function terminateProcessTreeConfirmed(child: ChildProcess): Promise<boolean> {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill('SIGKILL');
    return false;
  }
  if (process.platform === 'win32') {
    const exited = () => typeof child.exitCode === 'number' || child.signalCode != null;
    // 已退出的 ChildProcess 句柄不能授权再次按裸 PID 杀树，PID 可能已复用。
    if (exited()) return false;
    const configuredSystemRoot = process.env.SystemRoot ?? process.env.WINDIR;
    const systemRoot =
      configuredSystemRoot && path.win32.isAbsolute(configuredSystemRoot)
        ? path.win32.resolve(configuredSystemRoot)
        : 'C:\\Windows';
    const taskkill = path.win32.join(systemRoot, 'System32', 'taskkill.exe');
    const runTaskkillAttempt = (): Promise<boolean> =>
      new Promise((resolve) => {
        let finished = false;
        let killer: ChildProcess | null = null;
        let fallbackTimer: NodeJS.Timeout | null = null;
        const finish = (confirmed: boolean, terminateKiller = false): void => {
          if (finished) return;
          finished = true;
          if (fallbackTimer) clearTimeout(fallbackTimer);
          if (terminateKiller) killer?.kill('SIGKILL');
          resolve(confirmed);
        };
        try {
          killer = spawn(taskkill, ['/pid', String(pid), '/t', '/f'], {
            stdio: 'ignore',
            windowsHide: true,
          });
          killer.once('error', () => finish(false));
          killer.once('close', (code) => finish(code === 0));
          fallbackTimer = setTimeout(() => finish(false, true), WINDOWS_TASKKILL_ATTEMPT_MS);
        } catch {
          finish(false);
        }
      });
    for (let attempt = 0; attempt < WINDOWS_TASKKILL_ATTEMPTS; attempt += 1) {
      if (exited()) return false;
      if (await runTaskkillAttempt()) {
        child.kill('SIGKILL');
        return true;
      }
    }
    child.kill('SIGKILL');
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
    return false;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  child.kill('SIGKILL');
  return true;
}
