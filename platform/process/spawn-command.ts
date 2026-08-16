import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';

export type SpawnedCommand = ChildProcessByStdio<null, Readable, Readable>;

const WINDOWS_SHIM_EXTENSIONS = new Set(['.bat', '.cmd', '.ps1']);
const WINDOWS_BATCH_EXTENSIONS = new Set(['.bat', '.cmd']);
const WINDOWS_BATCH_UNSAFE_ARGUMENT = /[&|<>()^%"!\r\n]/u;
const WINDOWS_POWERSHELL_SCRIPT = [
  "$ProgressPreference = 'SilentlyContinue'",
  '$encoded = $env:COMET_COMMAND_PAYLOAD',
  'Remove-Item Env:COMET_COMMAND_PAYLOAD -ErrorAction SilentlyContinue',
  '$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))',
  '$payload = ConvertFrom-Json $json',
  '$commandArgs = @($payload.arguments)',
  '& $payload.command @commandArgs',
  'if ($null -eq $LASTEXITCODE) { if ($?) { exit 0 } else { exit 1 } }',
  'exit $LASTEXITCODE',
].join('; ');

function environmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const expected = name.toLowerCase();
  return Object.entries(env).find(
    ([key, value]) => key.toLowerCase() === expected && value !== undefined,
  )?.[1];
}

function windowsExecutableExtensions(env: NodeJS.ProcessEnv): string[] {
  const configured = (environmentValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...configured, '.ps1'])];
}

function windowsCommandCandidates(command: string, env: NodeJS.ProcessEnv, cwd: string): string[] {
  const hasPath = path.win32.isAbsolute(command) || /[\\/]/u.test(command);
  const directories = hasPath
    ? ['']
    : (environmentValue(env, 'PATH') ?? '')
        .split(path.delimiter)
        .map((directory) => directory.trim().replace(/^"(.*)"$/u, '$1'))
        .filter(Boolean);
  const extension = path.win32.extname(command);
  const names = extension
    ? [command]
    : windowsExecutableExtensions(env).map((candidate) => `${command}${candidate}`);
  return directories.flatMap((directory) =>
    names.map((name) => (directory ? path.join(directory, name) : path.resolve(cwd, name))),
  );
}

export function resolveWindowsCommand(
  command: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): string {
  return (
    windowsCommandCandidates(command, env, cwd).find((candidate) => existsSync(candidate)) ??
    command
  );
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

export function assertSafeWindowsBatchArguments(args: readonly string[]): void {
  if (args.some((argument) => WINDOWS_BATCH_UNSAFE_ARGUMENT.test(argument))) {
    throw new Error('Windows batch check arguments must not contain shell syntax');
  }
}

function spawnWindowsShim(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): SpawnedCommand {
  const payload = Buffer.from(JSON.stringify({ command, arguments: [...args] }), 'utf8').toString(
    'base64',
  );
  const encodedScript = Buffer.from(WINDOWS_POWERSHELL_SCRIPT, 'utf16le').toString('base64');
  return spawn(
    powershellExecutable(options.env),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-InputFormat',
      'None',
      '-OutputFormat',
      'Text',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodedScript,
    ],
    {
      cwd: options.cwd,
      env: { ...options.env, COMET_COMMAND_PAYLOAD: payload },
      shell: false,
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

export function spawnCommand(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): SpawnedCommand {
  const env = options.env ?? process.env;
  if (process.platform !== 'win32') {
    return spawn(command, [...args], {
      cwd: options.cwd,
      env,
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  const resolved = resolveWindowsCommand(command, env, options.cwd);
  const extension = path.win32.extname(resolved).toLowerCase();
  if (WINDOWS_BATCH_EXTENSIONS.has(extension)) assertSafeWindowsBatchArguments(args);
  if (WINDOWS_SHIM_EXTENSIONS.has(extension)) {
    return spawnWindowsShim(resolved, args, { cwd: options.cwd, env });
  }
  return spawn(resolved, [...args], {
    cwd: options.cwd,
    env,
    shell: false,
    windowsHide: true,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
