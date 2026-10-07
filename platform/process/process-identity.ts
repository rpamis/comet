import type { ChildProcess } from 'node:child_process';
import { terminateProcessTree } from './terminate-process-tree.js';
import { promises as fs } from 'node:fs';

import { runExternalCommandAsync } from './external-command.js';
import { readWindowsProcessIdentity } from './windows-process-identity.js';

let ownIdentity: string | null = null;

// 只短暂缓存不可读取结果；外部 PID 可能被复用，成功身份必须重新探测。
const FAILED_PROBE_TTL_MS = 10_000;
const identityCache = new Map<number, { value: string | null; at: number }>();
const pendingIdentities = new Map<number, Promise<string | null>>();

function cachedIdentity(pid: number): string | null | undefined {
  const entry = identityCache.get(pid);
  if (!entry) return undefined;
  if (Date.now() - entry.at > FAILED_PROBE_TTL_MS) {
    identityCache.delete(pid);
    return undefined;
  }
  return entry.value;
}

/** OS process creation identity; null means inspection was unavailable, never proof of exit. */
export async function readProcessIdentity(pid: number): Promise<string | null> {
  if (pid === process.pid && ownIdentity !== null) return ownIdentity;
  const cached = cachedIdentity(pid);
  if (cached !== undefined) return cached;
  let pending = pendingIdentities.get(pid);
  if (!pending) {
    pending = inspectProcessIdentity(pid);
    pendingIdentities.set(pid, pending);
  }
  const identity = await pending;
  if (pendingIdentities.get(pid) === pending) pendingIdentities.delete(pid);
  // Our own creation identity cannot change within this process. Avoid repeatedly
  // starting a process probe for the same owner, especially on cold Windows hosts.
  if (pid === process.pid && identity !== null) ownIdentity = identity;
  if (identity === null) identityCache.set(pid, { value: null, at: Date.now() });
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
      // Await inside the try: a bare `return` of the promise would let a probe
      // rejection escape this catch and surface as an unhandled error.
      return await readWindowsProcessIdentity(pid);
    }
    if (process.platform === 'darwin') {
      const started = (
        await runExternalCommandAsync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], {
          timeoutMs: 5000,
          maxBufferBytes: 4096,
          env: { ...process.env, LC_ALL: 'C', TZ: 'UTC0' },
        })
      ).trim();
      return started ? `darwin:${started}` : null;
    }
  } catch {
    // Permission errors, unavailable process metadata and races remain conservative.
  }
  return null;
}

export type ProcessLiveness = 'alive' | 'dead' | 'unknown';

// The two Windows probe sources format creation time differently; a mismatch
// between them says which probe ran, not that the pid was reused.
const INTERCHANGEABLE_IDENTITY_SOURCES = new Set(['win32-wmic', 'win32-ps']);

function identitySource(value: string): string {
  const separator = value.indexOf(':');
  return separator === -1 ? '' : value.slice(0, separator);
}

/**
 * Three-state liveness. `unknown` means the pid exists but its recorded creation
 * identity could not be re-inspected — distinct from `alive`, so callers can offer
 * a time-bounded takeover path instead of waiting on a probe that never succeeds.
 * Identities recorded through different interchangeable probe sources also resolve
 * to `unknown` rather than `dead`, because such a mismatch proves nothing about reuse.
 */
export async function inspectProcessLiveness(
  pid: number,
  identity?: string,
): Promise<ProcessLiveness> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return 'alive';
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return 'dead';
  }
  // A legacy or degraded owner without a creation identity cannot prove that
  // the currently live PID is the process that created the lock. Keep it in
  // the conservative unknown state so explicit repair can recover it safely.
  if (!identity) return 'unknown';
  const current = await readProcessIdentity(pid);
  if (current === identity) return 'alive';
  if (current === null) return 'unknown';
  if (
    identitySource(current) !== identitySource(identity) &&
    INTERCHANGEABLE_IDENTITY_SOURCES.has(identitySource(current)) &&
    INTERCHANGEABLE_IDENTITY_SOURCES.has(identitySource(identity))
  ) {
    return 'unknown';
  }
  return 'dead';
}

export async function processInstanceMayBeAlive(pid: number, identity?: string): Promise<boolean> {
  return (await inspectProcessLiveness(pid, identity)) !== 'dead';
}

/** 检查整个受管进程组；组长已退出不能证明后代已停止。 */
export async function inspectProcessTreeLiveness(
  pid: number,
  identity?: string,
): Promise<ProcessLiveness> {
  const leader = await inspectProcessLiveness(pid, identity);
  if (process.platform === 'win32') return leader;
  // PID 已被其他创建实例复用时，该实例的进程组不属于原任务。
  const currentIdentity = await readProcessIdentity(pid);
  if (identity && currentIdentity && currentIdentity !== identity) return 'dead';
  try {
    process.kill(-pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'dead' : 'unknown';
  }
  if (process.platform === 'linux') {
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
          if (Number(fields[2]) === pid && fields[0] !== 'Z' && fields[0] !== 'X')
            return leader === 'alive' ? 'alive' : 'unknown';
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
            (error as NodeJS.ErrnoException).code !== 'ESRCH'
          )
            return 'unknown';
        }
      }
      return 'dead';
    } catch {
      return 'unknown';
    }
  }
  return leader === 'alive' ? 'alive' : 'unknown';
}

/** PID 复用或身份无法确认时，绝不向该 PID 发送终止信号。 */
export async function terminateRegisteredProcessTree(instance: {
  pid: number;
  identity?: string;
}): Promise<boolean> {
  if ((await inspectProcessLiveness(instance.pid, instance.identity)) !== 'alive') return false;
  const child = {
    pid: instance.pid,
    kill: (signal: NodeJS.Signals) => {
      try {
        return process.kill(instance.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
        throw error;
      }
    },
  } as ChildProcess;
  await terminateProcessTree(child);
  return true;
}
