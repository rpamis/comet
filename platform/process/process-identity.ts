import { promises as fs } from 'node:fs';
import path from 'node:path';

import { runExternalCommand } from './external-command.js';

let ownIdentity: string | null = null;

/** OS process creation identity; null means inspection was unavailable, never proof of exit. */
export async function readProcessIdentity(pid: number): Promise<string | null> {
  if (pid === process.pid && ownIdentity !== null) return ownIdentity;
  const identity = await inspectProcessIdentity(pid);
  // Our own creation identity cannot change within this process. Avoid repeatedly
  // starting PowerShell for the same owner, especially on cold Windows hosts.
  if (pid === process.pid && identity !== null) ownIdentity = identity;
  return identity;
}

async function inspectProcessIdentity(pid: number): Promise<string | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === 'linux') {
      const [stat, boot] = await Promise.all([
        fs.readFile(`/proc/${pid}/stat`, 'utf8'),
        fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
      ]);
      // comm (field 2) may contain spaces and parentheses; starttime is field 22.
      const started = stat
        .slice(stat.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/u)[19];
      return /^\d+$/u.test(started ?? '') ? `linux:${boot.trim()}:${started}` : null;
    }
    if (process.platform === 'win32') {
      const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
      const executable = path.win32.join(
        systemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );
      const started = runExternalCommand(
        executable,
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks.ToString()`,
        ],
        { timeoutMs: 15000, maxBufferBytes: 4096 },
      ).trim();
      return /^\d+$/u.test(started) ? `win32:${started}` : null;
    }
    if (process.platform === 'darwin') {
      const started = runExternalCommand('/bin/ps', ['-p', String(pid), '-o', 'lstart='], {
        timeoutMs: 5000,
        maxBufferBytes: 4096,
        env: { ...process.env, LC_ALL: 'C', TZ: 'UTC0' },
      }).trim();
      return started ? `darwin:${started}` : null;
    }
  } catch {
    // Permission errors, unavailable process metadata and races remain conservative.
  }
  return null;
}

export async function processInstanceMayBeAlive(pid: number, identity?: string): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
  }
  if (!identity) return true;
  const current = await readProcessIdentity(pid);
  return current === null || current === identity;
}
