import { accessSync, constants, statSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveWindowsCommand, resolveWindowsNodeShim } from './spawn-command.js';

/** npm 自带的 Windows 启动器会查找前缀；直接调用同一安装中的 npm JS 入口。 */
export function resolveNpmCommand(
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
) {
  if (process.platform === 'win32') {
    const shim = resolveWindowsCommand('npm', options.env ?? process.env, options.cwd);
    const root = path.join(path.dirname(shim), 'node_modules/npm');
    const entry = path.join(root, 'bin/npm-cli.js');
    if (
      existsSync(entry) &&
      JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).name === 'npm'
    )
      return { command: process.execPath, args: [entry, ...args] };
  }
  return resolveNodeCliCommand('npm', args, options);
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
    const invocation = resolveWindowsNodeShim(resolved, args, options.env ?? process.env);
    if (invocation) return invocation;
  }
  if (['.cmd', '.bat', '.ps1'].includes(extension))
    throw new Error(
      `Unsupported Node CLI shim: ${resolved}. Use a standard npm/pnpm .cmd launcher or the Node CLI .js/.mjs/.cjs entry; no shell fallback is allowed.`,
    );
  return { command: resolved, args: [...args] };
}

/** 只检查启动所需的文件，不运行 CLI，也不缓存可在重试前修复的依赖。 */
export function assertNodeCliCommandAvailable(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform },
): void {
  const launch = resolveNodeCliCommand(command, args, options);
  const platform = options.platform ?? process.platform;
  const env = launch.env ?? options.env ?? process.env;
  const executable = launch.command;
  const candidates =
    platform === 'win32'
      ? [resolveWindowsCommand(executable, env, options.cwd)]
      : executable.includes('/')
        ? [path.resolve(options.cwd, executable)]
        : (env.PATH ?? '/usr/bin:/bin')
            .split(path.delimiter)
            .map((directory) => path.resolve(options.cwd, directory, executable));
  const available = candidates.some((candidate) => {
    try {
      const target = path.resolve(options.cwd, candidate);
      if (!statSync(target).isFile()) return false;
      accessSync(target, platform === 'win32' ? constants.F_OK : constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (!available) throw new Error(`Executable not found or not executable: ${command}`);
  if (launch.command !== command && launch.args.length > args.length) {
    const entry = launch.args[0];
    if (!statSync(entry).isFile()) throw new Error(`Node CLI entry is not a file: ${entry}`);
    accessSync(entry, constants.R_OK);
  }
}
