import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveWindowsCommand } from './spawn-command.js';

/** Recognize package-manager Node launchers without interpreting a shell or user argv. */
function nodeShimTarget(source: string): { target: string; nodePath?: string } | null {
  const text = source.replaceAll('\r\n', '\n').trim();
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

export function resolveNodeCliCommand(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform },
): { command: string; args: string[]; env?: NodeJS.ProcessEnv } {
  if ((options.platform ?? process.platform) !== 'win32') return { command, args: [...args] };
  const resolved = resolveWindowsCommand(command, options.env ?? process.env, options.cwd);
  const extension = path.extname(resolved).toLowerCase();
  if (['.mjs', '.cjs', '.js'].includes(extension))
    return { command: process.execPath, args: [path.resolve(options.cwd, resolved), ...args] };
  if (extension === '.cmd') {
    const target = nodeShimTarget(readFileSync(resolved, 'utf8'));
    if (target) {
      const entry = path.resolve(path.dirname(resolved), target.target);
      if (!existsSync(entry)) throw new Error(`Node CLI entry is missing: ${entry}`);
      const localNode = path.join(path.dirname(resolved), 'node.exe');
      const env = { ...(options.env ?? process.env) };
      const previousKey = Object.keys(env).find((key) => key.toUpperCase() === 'NODE_PATH');
      const previousPath = previousKey ? env[previousKey] : undefined;
      if (target.nodePath) {
        if (previousKey) delete env[previousKey];
        env.NODE_PATH = target.nodePath + (previousPath ? `;${previousPath}` : '');
      }
      return {
        command: existsSync(localNode) ? localNode : process.execPath,
        args: [entry, ...args],
        ...(target.nodePath ? { env } : {}),
      };
    }
  }
  if (['.cmd', '.bat', '.ps1'].includes(extension))
    throw new Error(
      `Unsupported Node CLI shim: ${resolved}. Use a standard npm/pnpm .cmd launcher or the Node CLI .js/.mjs/.cjs entry; no shell fallback is allowed.`,
    );
  return { command: resolved, args: [...args] };
}
