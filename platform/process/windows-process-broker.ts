import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const WINDOWS_PROCESS_PAYLOAD = 'COMET_WINDOWS_PROCESS_PAYLOAD';
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
    const launched = spawn(
      powershellExecutable(options.env),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-InputFormat',
        'None',
        '-EncodedCommand',
        encodedScript,
      ],
      {
        cwd: options.cwd,
        env: { ...options.env, [WINDOWS_PROCESS_PAYLOAD]: payload },
        stdio: 'ignore',
        windowsHide: true,
      },
    );
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
