import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const WINDOWS_TASKKILL_ATTEMPT_MS = 1_000;
const WINDOWS_TASKKILL_ATTEMPTS = 2;
const POSIX_GROUP_EXIT_WAIT_MS = 1_000;
const terminationPreparations = new WeakMap<ChildProcess, () => Promise<void>>();

/** 自有监管器在整树清理前完成已启动的子树清理，避免两个 taskkill 互相终止。 */
export function registerTerminationPreparation(
  child: ChildProcess,
  prepare: () => Promise<void>,
): void {
  terminationPreparations.set(child, prepare);
}

async function waitForPosixGroupExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + POSIX_GROUP_EXIT_WAIT_MS;
  for (;;) {
    try {
      process.kill(-pid, 0);
      if (process.platform === 'linux') {
        const group = await inspectLinuxProcessGroupLiveness(pid);
        if (group === 'dead') return true;
        if (group === 'unknown') return false;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return true;
      if (code !== 'EPERM') return false;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Linux retains zombie group members after execution has stopped. */
export async function inspectLinuxProcessGroupLiveness(
  pid: number,
): Promise<'alive' | 'dead' | 'unknown'> {
  try {
    const entries = await fs.readdir('/proc');
    for (const entry of entries) {
      if (!/^\d+$/u.test(entry)) continue;
      try {
        const stat = await fs.readFile(`/proc/${entry}/stat`, 'utf8');
        const fields = stat
          .slice(stat.lastIndexOf(')') + 2)
          .trim()
          .split(/\s+/u);
        if (Number(fields[2]) === pid && fields[0] !== 'Z' && fields[0] !== 'X') return 'alive';
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && code !== 'ESRCH') return 'unknown';
      }
    }
    return 'dead';
  } catch {
    return 'unknown';
  }
}

/** 保留既有 best-effort 调用契约；需要清理证明的调用方使用确认版。 */
export async function terminateProcessTree(child: ChildProcess): Promise<void> {
  await terminateProcessTreeConfirmed(child);
}

/** 返回整树终止是否已确认；只杀掉组长不能证明后代已退出。 */
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
    await terminationPreparations.get(child)?.();
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
          // 已取得退出码即可核对 taskkill 结果，不能再被延迟的句柄 close 改判。
          killer.once('exit', (code) => finish(code === 0));
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
  let groupExited = false;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Darwin 的自清理进程组只剩僵尸时也可能返回 EPERM。仅复核整组消失，
    // 不按死亡组长推断成功，也不重发信号给可能复用的 PGID。
    if (
      code !== 'ESRCH' &&
      !(process.platform === 'darwin' && code === 'EPERM' && (await waitForPosixGroupExit(pid)))
    )
      throw error;
    groupExited = true;
  }
  child.kill('SIGKILL');
  // 接受组信号后，忽略 stdio 的后代仍可能尚未退出。
  // Linux 排除已停止执行的僵尸，不能把信号已发送当成整组退出证明。
  if (!groupExited) return waitForPosixGroupExit(pid);
  return true;
}
