import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { withRecoverableFileLock } from '../fs/recoverable-file-lock.js';
import { resolveNpmCommand } from '../process/node-cli-command.js';
import { compareSemverVersions, parseSemver } from '../version/version.js';

const execute = promisify(execFile);

export async function ensureCodexPluginCli(options: {
  pluginRoot: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ status: 'installed' | 'ready'; version: string; entry: string }> {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (process.platform === 'win32') {
      for (const existing of Object.keys(env)) {
        if (existing.toLowerCase() === key.toLowerCase()) delete env[existing];
      }
    }
    env[key] = value;
  }
  env.COMET_NO_HINTS = '1';
  const cwd = path.resolve(options.pluginRoot);
  const pkg = JSON.parse(await fs.readFile(path.join(cwd, 'plugin.json'), 'utf8'));
  const required = parseSemver(pkg.version);
  if (!required) throw new Error('Comet 插件版本无效，无法准备 CLI');
  const invokeNpm = async (args: string[]) => {
    const launch = resolveNpmCommand(args, { cwd, env });
    return execute(launch.command, launch.args, {
      cwd,
      env: launch.env ?? env,
      windowsHide: true,
      timeout: 240_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  };
  const globalRoot = path.resolve((await invokeNpm(['root', '--global'])).stdout.trim());
  const installedRoot = path.join(globalRoot, '@rpamis/comet');
  const inspect = async () => {
    try {
      const installed = JSON.parse(
        await fs.readFile(path.join(installedRoot, 'package.json'), 'utf8'),
      );
      const version = parseSemver(installed.version);
      if (
        installed.name !== '@rpamis/comet' ||
        !version ||
        compareSemverVersions(version, required) < 0
      )
        return null;
      const entry = path.join(installedRoot, 'bin/comet.js');
      const result = await execute(process.execPath, [entry, '--version'], {
        cwd,
        env,
        windowsHide: true,
        timeout: 30_000,
      });
      if (result.stdout.trim() !== installed.version) return null;
      return { status: 'ready' as const, version: installed.version as string, entry };
    } catch {
      return null;
    }
  };
  const existing = await inspect();
  if (existing) return existing;
  const key = createHash('sha256').update(globalRoot).digest('hex').slice(0, 16);
  return withRecoverableFileLock(
    path.join(os.homedir(), '.codex', `comet-cli-${key}.lock`),
    async () => {
      const ready = await inspect();
      if (ready) return ready;
      const metadata = JSON.parse(
        await fs.readFile(path.join(cwd, 'server/cli-package.json'), 'utf8'),
      );
      if (metadata.name !== '@rpamis/comet' || metadata.version !== pkg.version)
        throw new Error('Comet CLI 安装包版本与插件不一致');
      const archive = path.join(cwd, 'server/comet-cli.tgz');
      const hash = createHash('sha256');
      for await (const bytes of createReadStream(archive)) hash.update(bytes);
      if (hash.digest('hex') !== metadata.sha256)
        throw new Error('Comet CLI 安装包摘要不匹配，已停止安装');
      await invokeNpm(['install', '--global', '--no-audit', '--no-fund', archive]);
      const installed = await inspect();
      if (!installed) throw new Error('Comet CLI 安装后未通过版本检查，请保留 npm 错误并重试');
      return { ...installed, status: 'installed' as const };
    },
    { timeoutMs: 240_000, retryMs: 200 },
  );
}
