import { promises as fs } from 'node:fs';
import path from 'node:path';

import { runExternalCommand } from './external-command.js';

let ownIdentity: string | null = null;

// A pid's creation identity never changes, so caching the probe result is
// always semantically safe for live processes. Caching a failed probe is only
// safe briefly (the process may have exited and its identity become readable
// later is impossible — but a *timeout* can clear), so failures get a short
// TTL. This keeps lock/recovery paths off the PowerShell cold start when a
// foreign pid is probed repeatedly within one command.
const IDENTITY_CACHE_TTL_MS = 60_000;
const FAILED_PROBE_TTL_MS = 10_000;
const identityCache = new Map<number, { value: string | null; at: number }>();

function cachedIdentity(pid: number): string | null | undefined {
  const entry = identityCache.get(pid);
  if (!entry) return undefined;
  const ttl = entry.value === null ? FAILED_PROBE_TTL_MS : IDENTITY_CACHE_TTL_MS;
  if (Date.now() - entry.at > ttl) {
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
  const identity = await inspectProcessIdentity(pid);
  // Our own creation identity cannot change within this process. Avoid repeatedly
  // starting a process probe for the same owner, especially on cold Windows hosts.
  if (pid === process.pid && identity !== null) ownIdentity = identity;
  if (pid !== process.pid) identityCache.set(pid, { value: identity, at: Date.now() });
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
      return await inspectWindowsProcessIdentity(pid);
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

function windowsProcessTicks(raw: string): string | null {
  const ticks = raw.trim();
  return /^\d+$/u.test(ticks) ? `win32-ps:${ticks}` : null;
}

/**
 * Windows creation-time identity. WMIC answers in tens of milliseconds without a
 * PowerShell cold start, so it is tried first; PowerShell remains the fallback for
 * hosts where WMIC was removed. Each source keeps its own prefix: a value recorded
 * through one source never compares equal to the other, so an occasional WMIC
 * timeout that falls back to PowerShell yields `unknown`, never a false reuse verdict.
 */
async function inspectWindowsProcessIdentity(pid: number): Promise<string | null> {
  try {
    const wmic = runExternalCommand(
      path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wbem', 'WMIC.exe'),
      ['process', 'where', `processid=${pid}`, 'get', 'creationdate', '/value'],
      { timeoutMs: 5000, maxBufferBytes: 4096 },
    );
    const creation = /^CreationDate=(\S+)/mu.exec(wmic);
    // WMIC prints local time like 20260918161643.123456+480; keep the raw form as
    // the identity string. It only needs to be stable per process, not comparable
    // across hosts or sources, so the timezone suffix stays part of the value.
    if (creation) return `win32-wmic:${creation[1]}`;
  } catch {
    // WMIC is optional on modern Windows; fall through to PowerShell.
  }
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
    { timeoutMs: 8000, maxBufferBytes: 4096 },
  ).trim();
  return windowsProcessTicks(started);
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
