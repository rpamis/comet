import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runExternalCommandAsync } from './external-command.js';

const SOURCE = `using System;
using System.Runtime.InteropServices;
class CometProcessIdentity {
 [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
 [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 static int Main(string[] args) {
  int pid; if(args.Length != 1 || !int.TryParse(args[0], out pid) || pid <= 0) return 1;
  IntPtr handle=OpenProcess(0x1000, false, pid); if(handle == IntPtr.Zero) return 1;
  try { long creation, exit, kernel, user; if(!GetProcessTimes(handle,out creation,out exit,out kernel,out user)) return 1;
   Console.WriteLine(DateTime.FromFileTimeUtc(creation).Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture)); return 0;
  } finally { CloseHandle(handle); }
 }
}`;
const sourceHash = createHash('sha256').update(SOURCE).digest('hex');
const PREPARATION_RETRY_DELAY_MS = 10_000;
const preparations = new Map<string, { promise: Promise<string | null>; retryAfter: number }>();

async function plainFile(target: string, maxBytes: number): Promise<Buffer> {
  const before = await fs.lstat(target, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(maxBytes))
    throw new Error('Invalid process probe cache');
  const content = await fs.readFile(target);
  const after = await fs.lstat(target, { bigint: true });
  if (before.ino !== after.ino || before.ctimeNs !== after.ctimeNs || before.size !== after.size)
    throw new Error('Process probe cache changed');
  return content;
}

async function cachedProbe(root: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(
      (await plainFile(path.join(root, 'probe.json'), 4096)).toString('utf8'),
    ) as { file?: string; hash?: string };
    if (!/^probe-[a-f0-9-]+\.exe$/u.test(manifest.file ?? '')) return null;
    const executable = path.join(root, manifest.file!);
    const content = await plainFile(executable, 65536);
    return createHash('sha256').update(content).digest('hex') === manifest.hash ? executable : null;
  } catch {
    return null;
  }
}

async function prepareProbe(root: string, systemRoot: string): Promise<string | null> {
  let lock: Awaited<ReturnType<typeof fs.open>> | undefined;
  const id = randomUUID();
  const source = path.join(root, `probe-${id}.cs`);
  const executable = path.join(root, `probe-${id}.exe`);
  const manifest = path.join(root, `probe-${id}.json`);
  try {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    if ((await fs.lstat(root)).isSymbolicLink()) return null;
    lock = await fs.open(path.join(root, 'prepare.lock'), 'wx', 0o600);
    const existing = await cachedProbe(root);
    if (existing) return existing;
    await fs.writeFile(source, SOURCE, { flag: 'wx', mode: 0o600 });
    let compiler: string | undefined;
    for (const framework of ['Framework64', 'Framework']) {
      const candidate = path.join(systemRoot, 'Microsoft.NET', framework, 'v4.0.30319', 'csc.exe');
      try {
        await fs.access(candidate);
        compiler = candidate;
        break;
      } catch {
        /* 可选系统组件。 */
      }
    }
    if (!compiler) return null;
    await runExternalCommandAsync(
      compiler,
      ['/nologo', '/target:exe', '/platform:anycpu', `/out:${executable}`, source],
      { timeoutMs: 1500, maxBufferBytes: 4096 },
    );
    const hash = createHash('sha256')
      .update(await plainFile(executable, 65536))
      .digest('hex');
    await fs.writeFile(manifest, JSON.stringify({ file: path.basename(executable), hash }), {
      flag: 'wx',
      mode: 0o600,
    });
    await fs.rename(manifest, path.join(root, 'probe.json'));
    return executable;
  } catch {
    return null;
  } finally {
    await fs.unlink(source).catch(() => undefined);
    await fs.unlink(manifest).catch(() => undefined);
    if (lock) {
      await lock.close().catch(() => undefined);
      await fs.unlink(path.join(root, 'prepare.lock')).catch(() => undefined);
    }
  }
}

async function legacyProbe(
  pid: number,
  systemRoot: string,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const output = await runExternalCommandAsync(
      path.join(systemRoot, 'System32', 'wbem', 'WMIC.exe'),
      ['process', 'where', `processid=${pid}`, 'get', 'creationdate', '/value'],
      { timeoutMs: 300, maxBufferBytes: 4096, signal },
    );
    const creation = /^CreationDate=(\S+)/mu.exec(output);
    if (creation) return `win32-wmic:${creation[1]}`;
  } catch {
    /* 新版 Windows 可能不包含 WMIC。 */
  }
  if (signal.aborted) return null;
  try {
    const output = await runExternalCommandAsync(
      path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks.ToString()`,
      ],
      { timeoutMs: 1000, maxBufferBytes: 4096, signal },
    );
    const ticks = output.trim();
    return /^\d+$/u.test(ticks) ? `win32-ps:${ticks}` : null;
  } catch {
    return null;
  }
}

function prepareProbeWithCooldown(root: string, systemRoot: string): Promise<string | null> {
  const existing = preparations.get(root);
  if (existing && performance.now() < existing.retryAfter) return existing.promise;
  const preparation = { promise: prepareProbe(root, systemRoot), retryAfter: Infinity };
  preparations.set(root, preparation);
  void preparation.promise.then((executable) => {
    if (preparations.get(root) !== preparation) return;
    if (executable) preparations.delete(root);
    else preparation.retryAfter = performance.now() + PREPARATION_RETRY_DELAY_MS;
  });
  return preparation.promise;
}

/** 可选本地探测器直接调用 GetProcessTimes，返回与旧 PowerShell 相同的 UTC ticks。 */
export async function readWindowsProcessIdentity(
  pid: number,
  options: { cacheRoot?: string; systemRoot?: string } = {},
): Promise<string | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  const systemRoot = options.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows';
  const root = path.join(
    options.cacheRoot ?? path.join(os.tmpdir(), 'comet-process-identity'),
    sourceHash,
  );
  const fast = async (executable: string | null): Promise<string | null> => {
    if (!executable) return null;
    try {
      const output = await runExternalCommandAsync(executable, [String(pid)], {
        timeoutMs: 1000,
        maxBufferBytes: 4096,
      });
      const ticks = output.trim();
      return /^\d+$/u.test(ticks) ? `win32-ps:${ticks}` : null;
    } catch {
      return null;
    }
  };
  const existing = await cachedProbe(root);
  if (existing) {
    const result = await fast(existing);
    if (result) return result;
    return legacyProbe(pid, systemRoot, new AbortController().signal);
  }
  // 首次准备与原有探测并行；任意可用结果即可继续，所有子进程都有上限。
  const preparation = prepareProbeWithCooldown(root, systemRoot);
  const controller = new AbortController();
  const available = (value: string | null): string => {
    if (!value) throw new Error('Probe unavailable');
    return value;
  };
  try {
    return await Promise.any([
      preparation.then(fast).then(available),
      legacyProbe(pid, systemRoot, controller.signal).then(available),
    ]);
  } catch {
    return null;
  } finally {
    controller.abort();
  }
}
