import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

/** Recognize package-manager Node launchers without interpreting a shell or user argv. */
function nodeShimTarget(
  source: string,
): { target: string; nodePath?: string; nodeCommand?: string } | null {
  const text = source.replaceAll('\r\n', '\n').trim();
  const literal = /^@"([^"%\r\n]+)" "%~dp0([^"%\r\n]+\.(?:mjs|cjs|js))" %\*$/u.exec(text);
  if (
    literal &&
    path.win32.isAbsolute(literal[1]) &&
    path.win32.basename(literal[1]).toLowerCase() === 'node.exe'
  )
    return { target: literal[2], nodeCommand: literal[1] };
  const npm =
    /^@ECHO off\nGOTO start\n:find_dp0\nSET dp0=%~dp0\nEXIT \/b\n:start\nSETLOCAL\nCALL :find_dp0\n\nIF EXIST "%dp0%\\node\.exe" \(\n {2}SET "_prog=%dp0%\\node\.exe"\n\) ELSE \(\n {2}SET "_prog=node"\n {2}SET PATHEXT=%PATHEXT:;\.JS;=;%\n\)\n\nendLocal & goto #_undefined_# 2>NUL \|\| title %COMSPEC% & "%_prog%" {2}"%dp0%\\([^"%\r\n]+\.(?:mjs|cjs|js))" %\*$/u.exec(
      text,
    );
  if (npm) return { target: npm[1] };
  const pnpm =
    /^@SETLOCAL\n(?:@IF NOT DEFINED NODE_PATH \(\n {2}@SET "NODE_PATH=([^"\r\n]+)"\n\) ELSE \(\n {2}@SET "NODE_PATH=\1;%NODE_PATH%"\n\)\n)?@IF EXIST "%~dp0\\node\.exe" \(\n {2}"%~dp0\\node\.exe" {2}"%~dp0\\([^"%\r\n]+\.(?:mjs|cjs|js))" %\*\n\) ELSE \(\n {2}@SET PATHEXT=%PATHEXT:;\.JS;=;%\n {2}node {2}"%~dp0\\\2" %\*\n\)$/u.exec(
      text,
    );
  return pnpm ? { target: pnpm[2], ...(pnpm[1] ? { nodePath: pnpm[1] } : {}) } : null;
}

/** 只将完整匹配的 Node 包装器转为字面启动；其他批处理继续使用原执行路径。 */
export function resolveWindowsNodeShim(
  resolved: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  nodeCommand = process.execPath,
): { command: string; args: string[]; env?: NodeJS.ProcessEnv } | null {
  const target = nodeShimTarget(readFileSync(resolved, 'utf8'));
  if (!target) return null;
  const entry = path.resolve(path.dirname(resolved), target.target);
  if (!existsSync(entry)) throw new Error('Node CLI entry is missing: ' + entry);
  const localNode = path.join(path.dirname(resolved), 'node.exe');
  const env = { ...environment };
  const previousKey = Object.keys(env).find((key) => key.toUpperCase() === 'NODE_PATH');
  const previousPath = previousKey ? env[previousKey] : undefined;
  if (target.nodePath) {
    if (previousKey) delete env[previousKey];
    env.NODE_PATH = target.nodePath + (previousPath ? ';' + previousPath : '');
  }
  return {
    command: target.nodeCommand ?? (existsSync(localNode) ? localNode : nodeCommand),
    args: [entry, ...args],
    ...(target.nodePath ? { env } : {}),
  };
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

export function commandInvocation(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const env = options.env ?? process.env;
  if (process.platform !== 'win32') return { command, args: [...args], env };
  const resolved = resolveWindowsCommand(command, env, options.cwd);
  const extension = path.win32.extname(resolved).toLowerCase();
  if (WINDOWS_BATCH_EXTENSIONS.has(extension)) assertSafeWindowsBatchArguments(args);
  if (extension === '.cmd') {
    const invocation = resolveWindowsNodeShim(
      resolved,
      args,
      env,
      resolveWindowsCommand('node', env, options.cwd),
    );
    if (invocation) return { ...invocation, env: invocation.env ?? env };
  }
  if (!WINDOWS_SHIM_EXTENSIONS.has(extension)) return { command: resolved, args: [...args], env };
  const payload = Buffer.from(
    JSON.stringify({ command: resolved, arguments: [...args] }),
    'utf8',
  ).toString('base64');
  return {
    command: powershellExecutable(env),
    args: [
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
      Buffer.from(WINDOWS_POWERSHELL_SCRIPT, 'utf16le').toString('base64'),
    ],
    env: { ...env, COMET_COMMAND_PAYLOAD: payload },
  };
}

export function spawnCommand(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): SpawnedCommand {
  const invocation = commandInvocation(command, args, options);
  return spawn(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: invocation.env,
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
