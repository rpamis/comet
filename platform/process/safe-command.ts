import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Readable } from 'node:stream';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

const ENVIRONMENT_ALLOWLIST = new Set([
  'CI',
  'COMSPEC',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'LOCALAPPDATA',
  'NO_COLOR',
  'PATH',
  'PATHEXT',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'WINDIR',
]);

export type SafeCommandStatus = 'passed' | 'failed' | 'timeout' | 'spawn-error' | 'interrupted';

export interface BoundedCommandOutput {
  excerpt: string;
  excerptHash: string;
  bytes: number;
  capturedBytes: number;
  truncated: boolean;
}

export interface SafeCommandResult {
  status: SafeCommandStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdout: BoundedCommandOutput;
  stderr: BoundedCommandOutput;
  errorCode: string | null;
}

export interface RunSafeCommandOptions {
  cwd: string;
  executable: string;
  args?: string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  environment?: Record<string, string>;
  signal?: AbortSignal;
}

interface OutputCollector {
  append(chunk: Buffer): void;
  finish(): BoundedCommandOutput;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

/** Best-effort redaction for common credential formats before output is persisted. */
export function redactCommandText(value: string): string {
  return value
    .replace(/\b(Bearer|Basic)\s+[^\s"']+/giu, '$1 [REDACTED]')
    .replace(
      /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gu,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu, '$1[REDACTED]@')
    .replace(
      /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,})\b/gu,
      '[REDACTED TOKEN]',
    )
    .replace(
      /("(?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret(?:[_-]?access)?[_-]?key|private[_-]?key|token|password|passwd|secret|authorization|cookie|set[_-]?cookie)"\s*:\s*)"(?:\\[\s\S]|[^"\\\r\n])*"/giu,
      '$1"[REDACTED]"',
    )
    .replace(
      /(["'])((?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret(?:[_-]?access)?[_-]?key|private[_-]?key|token|password|passwd|secret|authorization|cookie|set[_-]?cookie))\1(\s*:\s*)(["'])[^\r\n]*?\4/giu,
      '$1$2$1$3$4[REDACTED]$4',
    )
    .replace(
      /\b((?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret(?:[_-]?access)?[_-]?key|private[_-]?key|token|password|passwd|secret|authorization|cookie|set[_-]?cookie))\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;"']+)/giu,
      '$1$2[REDACTED]',
    );
}

export function minimalCommandEnvironment(
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && ENVIRONMENT_ALLOWLIST.has(key.toUpperCase())) {
      environment[process.platform === 'win32' ? key.toUpperCase() : key] = value;
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!ENVIRONMENT_ALLOWLIST.has(key.toUpperCase())) {
      throw new Error(`Safe command environment variable is not allowed: ${key}`);
    }
    environment[process.platform === 'win32' ? key.toUpperCase() : key] = value;
  }
  environment.CI = environment.CI ?? '1';
  environment.NO_COLOR = '1';
  return environment;
}

function createOutputCollector(maxBytes: number): OutputCollector {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let capturedBytes = 0;

  return {
    append(chunk: Buffer): void {
      bytes += chunk.length;
      if (capturedBytes >= maxBytes) return;
      const remaining = maxBytes - capturedBytes;
      const captured = chunk.subarray(0, remaining);
      chunks.push(captured);
      capturedBytes += captured.length;
    },
    finish(): BoundedCommandOutput {
      const excerpt = redactCommandText(Buffer.concat(chunks).toString('utf8'));
      return {
        excerpt,
        excerptHash: createHash('sha256')
          .update('comet.safe-command-output.v1\n')
          .update(excerpt)
          .digest('hex'),
        bytes,
        capturedBytes,
        truncated: bytes > capturedBytes,
      };
    },
  };
}

function processErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === 'string' ? code : code === undefined ? null : String(code);
}

type SafeChildProcess = ChildProcessByStdio<null, Readable, Readable>;

const WINDOWS_PROCESS_TREE_SOURCE = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class CometProcessTree
{
    private const uint SnapshotProcesses = 0x00000002;
    private const uint TerminateAccess = 0x00000001;
    private const uint QueryLimitedInformationAccess = 0x00001000;
    private const uint StillActive = 259;
    private static readonly IntPtr InvalidHandle = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime
    {
        public uint Low;
        public uint High;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry
    {
        public uint Size;
        public uint Usage;
        public uint ProcessId;
        public IntPtr DefaultHeapId;
        public uint ModuleId;
        public uint Threads;
        public uint ParentProcessId;
        public int BasePriority;
        public uint Flags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string Executable;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessTimes(
        IntPtr process,
        out FileTime creation,
        out FileTime exit,
        out FileTime kernel,
        out FileTime user);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageNameW(
        IntPtr process,
        uint flags,
        StringBuilder executable,
        ref uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    private static long FileTimeValue(FileTime value)
    {
        return ((long)value.High << 32) | value.Low;
    }

    private static string ExecutableName(IntPtr process)
    {
        uint size = 32768;
        var executable = new StringBuilder((int)size);
        if (!QueryFullProcessImageNameW(process, 0, executable, ref size))
        {
            throw new InvalidOperationException("Unable to inspect the root process executable.");
        }
        var fullPath = executable.ToString();
        var separator = Math.Max(fullPath.LastIndexOf('\\'), fullPath.LastIndexOf('/'));
        return separator < 0 ? fullPath : fullPath.Substring(separator + 1);
    }

    private static void TerminateOrConfirmExited(IntPtr process)
    {
        if (TerminateProcess(process, 1))
        {
            return;
        }
        uint exitCode;
        if (GetExitCodeProcess(process, out exitCode) && exitCode != StillActive)
        {
            return;
        }
        throw new InvalidOperationException("Unable to terminate a verified process.");
    }

    private sealed class ProcessIdentity
    {
        public readonly uint ParentProcessId;
        public readonly string Executable;

        public ProcessIdentity(uint parentProcessId, string executable)
        {
            ParentProcessId = parentProcessId;
            Executable = executable;
        }
    }

    private static Dictionary<uint, ProcessIdentity> SnapshotProcessTree()
    {
        var processes = new Dictionary<uint, ProcessIdentity>();
        var snapshot = CreateToolhelp32Snapshot(SnapshotProcesses, 0);
        if (snapshot == InvalidHandle)
        {
            throw new InvalidOperationException("Unable to snapshot Windows processes.");
        }
        try
        {
            var entry = new ProcessEntry();
            entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
            if (Process32FirstW(snapshot, ref entry))
            {
                do
                {
                    processes[entry.ProcessId] = new ProcessIdentity(
                        entry.ParentProcessId,
                        entry.Executable);
                }
                while (Process32NextW(snapshot, ref entry));
            }
        }
        finally
        {
            CloseHandle(snapshot);
        }
        return processes;
    }

    private static bool RootMatches(
        Dictionary<uint, ProcessIdentity> processes,
        uint rootProcessId,
        uint expectedParentProcessId,
        string expectedExecutable)
    {
        ProcessIdentity root;
        return
            processes.TryGetValue(rootProcessId, out root) &&
            root.ParentProcessId == expectedParentProcessId &&
            string.Equals(root.Executable, expectedExecutable, StringComparison.OrdinalIgnoreCase);
    }

    private static List<uint> DescendantProcessIds(
        Dictionary<uint, ProcessIdentity> processes,
        uint rootProcessId)
    {
        var descendants = new List<uint>();
        var frontier = new Queue<uint>();
        var seen = new HashSet<uint>();
        frontier.Enqueue(rootProcessId);
        seen.Add(rootProcessId);
        while (frontier.Count > 0)
        {
            var parentProcessId = frontier.Dequeue();
            foreach (var process in processes)
            {
                if (process.Value.ParentProcessId != parentProcessId || !seen.Add(process.Key))
                {
                    continue;
                }
                descendants.Add(process.Key);
                frontier.Enqueue(process.Key);
            }
        }
        return descendants;
    }

    public static bool Terminate(
        uint rootProcessId,
        uint expectedParentProcessId,
        long earliestCreationTime,
        long latestCreationTime)
    {
        // Open and validate the root before taking the tree snapshot. The held
        // handle pins the process object, so its PID cannot be reused while the
        // snapshot is traversed and the verified tree is terminated.
        var rootHandle = OpenProcess(
            TerminateAccess | QueryLimitedInformationAccess,
            false,
            rootProcessId);
        if (rootHandle == IntPtr.Zero)
        {
            return false;
        }
        try
        {
            FileTime creation;
            FileTime exit;
            FileTime kernel;
            FileTime user;
            if (!GetProcessTimes(rootHandle, out creation, out exit, out kernel, out user))
            {
                throw new InvalidOperationException("Unable to inspect the root process identity.");
            }
            var creationTime = FileTimeValue(creation);
            if (creationTime < earliestCreationTime || creationTime > latestCreationTime)
            {
                return false;
            }
            var expectedExecutable = ExecutableName(rootHandle);

            var firstSnapshot = SnapshotProcessTree();
            if (!RootMatches(
                firstSnapshot,
                rootProcessId,
                expectedParentProcessId,
                expectedExecutable))
            {
                return false;
            }
            var descendants = DescendantProcessIds(firstSnapshot, rootProcessId);
            descendants.Reverse();

            // Hold every candidate before the confirmation snapshot. If a child
            // exited after the first snapshot, the second snapshot will no longer
            // place that held PID under this root and it will not be terminated.
            var descendantHandles = new List<KeyValuePair<uint, IntPtr>>();
            foreach (var processId in descendants)
            {
                var handle = OpenProcess(
                    TerminateAccess | QueryLimitedInformationAccess,
                    false,
                    processId);
                if (handle != IntPtr.Zero)
                {
                    descendantHandles.Add(new KeyValuePair<uint, IntPtr>(processId, handle));
                }
            }
            try
            {
                var confirmedSnapshot = SnapshotProcessTree();
                if (!RootMatches(
                    confirmedSnapshot,
                    rootProcessId,
                    expectedParentProcessId,
                    expectedExecutable))
                {
                    return false;
                }
                var confirmedDescendants = new HashSet<uint>(
                    DescendantProcessIds(confirmedSnapshot, rootProcessId));
                var heldDescendants = new HashSet<uint>();
                foreach (var process in descendantHandles)
                {
                    heldDescendants.Add(process.Key);
                }
                foreach (var processId in confirmedDescendants)
                {
                    if (!heldDescendants.Contains(processId))
                    {
                        throw new InvalidOperationException(
                            "Unable to retain every confirmed descendant process.");
                    }
                }
                foreach (var process in descendantHandles)
                {
                    if (confirmedDescendants.Contains(process.Key))
                    {
                        TerminateOrConfirmExited(process.Value);
                    }
                }
                TerminateOrConfirmExited(rootHandle);
                return true;
            }
            finally
            {
                foreach (var process in descendantHandles)
                {
                    CloseHandle(process.Value);
                }
            }
        }
        finally
        {
            CloseHandle(rootHandle);
        }
    }
}
`.trim();

async function runProcessKiller(executable: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (succeeded: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(succeeded);
    };
    try {
      const killer = spawn(executable, args, {
        env: minimalCommandEnvironment(),
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => finish(false));
      killer.once('close', (code) => finish(code === 0));
    } catch {
      finish(false);
    }
  });
}

function childHandleIsLive(child: SafeChildProcess): boolean {
  if (child.exitCode !== null || child.signalCode !== null) return false;
  try {
    return child.kill(0);
  } catch {
    return false;
  }
}

const WINDOWS_FILE_TIME_EPOCH = 116_444_736_000_000_000n;

function windowsFileTimeBounds(startedAtMs: number, spawnedAtMs: number): [bigint, bigint] {
  const start = BigInt(Math.min(startedAtMs, spawnedAtMs));
  const end = BigInt(Math.max(startedAtMs, spawnedAtMs) + 1);
  return [start * 10_000n + WINDOWS_FILE_TIME_EPOCH, end * 10_000n + WINDOWS_FILE_TIME_EPOCH - 1n];
}

async function terminateProcessTree(
  child: SafeChildProcess,
  spawnStartedAtMs: number,
  spawnCompletedAtMs: number,
): Promise<void> {
  const pid = child.pid;
  if (!pid) {
    child.kill('SIGKILL');
    return;
  }
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
    return;
  }

  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot) {
    child.kill();
    return;
  }

  // `taskkill /t` does not reliably follow a child that created a new process
  // group. Toolhelp32 exposes parent links without WMI privileges. The helper
  // verifies the still-live root's creation window, executable, and parent. It
  // holds candidate handles and confirms their ancestry in a second snapshot
  // before terminating leaves and then the root.
  const powershell = path.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const [earliestCreationTime, latestCreationTime] = windowsFileTimeBounds(
    spawnStartedAtMs,
    spawnCompletedAtMs,
  );
  const treeScript = [
    "$ErrorActionPreference = 'Stop'",
    `$rootProcessId = [uint32]${pid}`,
    `$expectedParentProcessId = [uint32]${process.pid}`,
    `$earliestCreationTime = [long]${earliestCreationTime}`,
    `$latestCreationTime = [long]${latestCreationTime}`,
    "$source = @'",
    WINDOWS_PROCESS_TREE_SOURCE,
    "'@",
    'Add-Type -TypeDefinition $source',
    '$terminated = [CometProcessTree]::Terminate($rootProcessId, $expectedParentProcessId, $earliestCreationTime, $latestCreationTime)',
    'if (-not $terminated) { exit 42 }',
  ].join('\n');
  const helperSucceeded = await runProcessKiller(powershell, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    treeScript,
  ]);
  if (helperSucceeded || !childHandleIsLive(child)) return;

  // This fallback is reached only when the identity-checking helper itself
  // failed and a signal-0 probe through Node's retained child handle proves the
  // original root is still live. Keep taskkill synchronous in this same event-
  // loop turn so Node cannot release that handle and make the PID reusable.
  const taskkill = path.join(systemRoot, 'System32', 'taskkill.exe');
  let taskkillSucceeded: boolean;
  try {
    const result = spawnSync(taskkill, ['/pid', String(pid), '/t', '/f'], {
      env: minimalCommandEnvironment(),
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    taskkillSucceeded = result.error === undefined && result.status === 0;
  } catch {
    taskkillSucceeded = false;
  }
  if (!taskkillSucceeded) child.kill();
}

/**
 * Execute a structured argv without a shell. The child receives a small allowlisted
 * environment and only bounded, redacted output is retained by the caller.
 */
export async function runSafeCommand(options: RunSafeCommandOptions): Promise<SafeCommandResult> {
  if (!options.executable.trim()) throw new Error('Safe command executable is required');
  if (options.args?.some((argument) => argument.includes('\0'))) {
    throw new Error('Safe command arguments cannot contain NUL bytes');
  }

  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxOutputBytes = positiveInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);
  const stdout = createOutputCollector(maxOutputBytes);
  const stderr = createOutputCollector(maxOutputBytes);
  const startedAt = process.hrtime.bigint();

  return new Promise((resolve) => {
    let settled = false;
    let finishing = false;
    let terminalStatus: SafeCommandStatus | null = null;
    let errorCode: string | null = null;
    let timeout: NodeJS.Timeout | null = null;
    let termination: Promise<void> | null = null;
    let spawnStartedAtMs = Date.now();
    let spawnCompletedAtMs = spawnStartedAtMs;

    const finish = async (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
    ): Promise<void> => {
      if (settled || finishing) return;
      finishing = true;
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', interrupt);
      await termination;
      settled = true;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      resolve({
        status:
          terminalStatus ??
          (exitCode === 0 ? 'passed' : errorCode !== null ? 'spawn-error' : 'failed'),
        exitCode: terminalStatus === null ? exitCode : null,
        signal,
        durationMs: Math.max(0, Math.round(durationMs)),
        stdout: stdout.finish(),
        stderr: stderr.finish(),
        errorCode,
      });
    };

    let child: SafeChildProcess | undefined;
    try {
      spawnStartedAtMs = Date.now();
      child = spawn(options.executable, options.args ?? [], {
        cwd: options.cwd,
        env: minimalCommandEnvironment(options.environment),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
      spawnCompletedAtMs = Date.now();
    } catch (error) {
      errorCode = processErrorCode(error);
      terminalStatus = 'spawn-error';
      void finish(null, null);
      return;
    }

    function interrupt(): void {
      if (settled || finishing || !child) return;
      terminalStatus = 'interrupted';
      termination = terminateProcessTree(child, spawnStartedAtMs, spawnCompletedAtMs);
    }

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.once('error', (error) => {
      errorCode = processErrorCode(error);
      terminalStatus = terminalStatus ?? 'spawn-error';
    });
    child.once('close', (exitCode, signal) => void finish(exitCode, signal));

    timeout = setTimeout(() => {
      if (settled) return;
      terminalStatus = 'timeout';
      termination = terminateProcessTree(child, spawnStartedAtMs, spawnCompletedAtMs);
    }, timeoutMs);
    timeout.unref();

    if (options.signal?.aborted) interrupt();
    else options.signal?.addEventListener('abort', interrupt, { once: true });
  });
}
