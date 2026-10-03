import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WINDOWS_PROCESS_PAYLOAD = 'COMET_WINDOWS_PROCESS_PAYLOAD';
const WINDOWS_PROCESS_SCRIPT = 'COMET_WINDOWS_PROCESS_SCRIPT';
// PowerShell needs to finish the WMI handoff before its Node parent exits.
// A detached Node worker owns that short lifetime without delaying the CLI.
const WINDOWS_BROKER_WORKER = [
  "const { spawn } = require('node:child_process')",
  `const script = process.env.${WINDOWS_PROCESS_SCRIPT}`,
  `delete process.env.${WINDOWS_PROCESS_SCRIPT}`,
  "const child = spawn(process.argv[2], ['-NoLogo', '-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-EncodedCommand', script], { stdio: 'ignore', windowsHide: true })",
  'const deadline = setTimeout(() => { child.kill(); process.exit(1) }, 5000)',
  "child.on('error', () => { clearTimeout(deadline); process.exitCode = 1 })",
  "child.on('exit', (code) => { clearTimeout(deadline); process.exitCode = code ?? 1 })",
].join('; ');
const WINDOWS_BROKER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  `$encoded = $env:${WINDOWS_PROCESS_PAYLOAD}`,
  `Remove-Item Env:${WINDOWS_PROCESS_PAYLOAD} -ErrorAction SilentlyContinue`,
  '$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))',
  '$payload = ConvertFrom-Json $json',
  '$environment = [System.Collections.Generic.List[string]]::new()',
  "Get-ChildItem Env: | ForEach-Object { $environment.Add($_.Name + '=' + $_.Value) }",
  "$startup = ([wmiclass]'Win32_ProcessStartup').CreateInstance()",
  '$startup.ShowWindow = [uint16]0',
  '$startup.EnvironmentVariables = [string[]]$environment',
  "$created = ([wmiclass]'Win32_Process').Create($payload.commandLine, $payload.cwd, $startup)",
  "if ($created.ReturnValue -ne 0) { throw ('Win32_Process.Create returned ' + $created.ReturnValue) }",
].join('; ');

export interface WindowsBrokerProcessOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  cacheRoot?: string;
}

export interface WindowsBrokerProcessResult {
  started: boolean;
  error?: string;
}

function environmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const expected = name.toLowerCase();
  return Object.entries(env).find(
    ([key, value]) => key.toLowerCase() === expected && value !== undefined,
  )?.[1];
}

function powershellExecutable(env: NodeJS.ProcessEnv): string {
  const systemRoot = environmentValue(env, 'SystemRoot');
  if (systemRoot) {
    const bundled = path.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    if (existsSync(bundled)) return bundled;
  }
  return 'powershell.exe';
}

function quoteWindowsArgument(argument: string): string {
  if (argument.length === 0) return '""';
  if (!/[\s"]/u.test(argument)) return argument;
  let quoted = '"';
  let backslashes = 0;
  for (const character of argument) {
    if (character === '\\') {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      quoted += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    quoted += '\\'.repeat(backslashes) + character;
    backslashes = 0;
  }
  return quoted + '\\'.repeat(backslashes * 2) + '"';
}

function windowsCommandLine(command: string, args: readonly string[]): string {
  return [command, ...args].map(quoteWindowsArgument).join(' ');
}

function prepareBrokerWorker(cacheRoot: string): string {
  mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
  const directory = lstatSync(cacheRoot);
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error('Windows broker cache must be a regular directory');
  }
  const digest = createHash('sha256').update(WINDOWS_BROKER_WORKER).digest('hex');
  const workerPath = path.join(cacheRoot, `${digest}.cjs`);
  const matches = () => {
    try {
      const before = lstatSync(workerPath, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink() || before.size > 4096n) {
        throw new Error('Windows broker worker must be a regular file');
      }
      const source = readFileSync(workerPath, 'utf8');
      const after = lstatSync(workerPath, { bigint: true });
      return (
        source === WINDOWS_BROKER_WORKER &&
        before.ino === after.ino &&
        before.ctimeNs === after.ctimeNs &&
        before.mtimeNs === after.mtimeNs &&
        before.size === after.size
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  };
  if (!matches()) {
    const temporary = path.join(cacheRoot, `${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, WINDOWS_BROKER_WORKER, { flag: 'wx', mode: 0o600 });
      renameSync(temporary, workerPath);
    } finally {
      try {
        unlinkSync(temporary);
      } catch {
        /* The atomic rename already consumed the file. */
      }
    }
    if (!matches()) throw new Error('Windows broker worker changed during preparation');
  }
  return workerPath;
}

export function launchWindowsProcessWithBroker(
  options: WindowsBrokerProcessOptions,
): WindowsBrokerProcessResult {
  const payload = Buffer.from(
    JSON.stringify({
      commandLine: windowsCommandLine(options.command, options.args),
      cwd: options.cwd,
    }),
    'utf8',
  ).toString('base64');
  const encodedScript = Buffer.from(WINDOWS_BROKER_SCRIPT, 'utf16le').toString('base64');
  try {
    const worker = prepareBrokerWorker(
      options.cacheRoot ?? path.join(os.tmpdir(), 'comet-windows-broker'),
    );
    const launched = spawn(process.execPath, [worker, powershellExecutable(options.env)], {
      cwd: options.cwd,
      env: {
        ...options.env,
        [WINDOWS_PROCESS_PAYLOAD]: payload,
        [WINDOWS_PROCESS_SCRIPT]: encodedScript,
      },
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    launched.on('error', () => undefined);
    if (!launched.pid) return { started: false, error: 'Windows process broker did not start' };
    launched.unref();
    return { started: true };
  } catch (error) {
    return {
      started: false,
      error: error instanceof Error ? error.message : 'Windows process broker failed to start',
    };
  }
}
