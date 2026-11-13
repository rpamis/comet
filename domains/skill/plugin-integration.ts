import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';
import { buildNodeHookCommand } from '../../platform/process/hook-command.js';
import { mergeHookGroups } from './platform-install.js';
export { migratePluginInstallation } from './plugin-migration.js';
import {
  atomicWriteContainedBytes,
  atomicWriteContainedText,
} from '../workflow-contract/contained-atomic-write.js';

export type PluginPlatform = 'codex' | 'dsh';
const hookRelativePath = 'comet/scripts/comet-plugin-hook.mjs';

/** 将 Hook 信任绑定到该安装的规则、技能与 Runtime 内容，而不仅是可变目录名。 */
export async function hashPluginRuntime(pluginRoot: string): Promise<string> {
  const hash = createHash('sha256').update(path.resolve(pluginRoot));
  async function visit(directory: string) {
    for (const name of (await fs.readdir(directory)).sort()) {
      const file = path.join(directory, name);
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) throw new Error(`Comet 插件资源不能是符号链接：${file}`);
      if (stat.isDirectory()) await visit(file);
      else {
        await regularFile(file);
        hash.update(path.relative(pluginRoot, file));
        hash.update('\0');
        hash.update(await fs.readFile(file));
      }
    }
  }
  await visit(path.join(pluginRoot, 'skills'));
  await visit(path.join(pluginRoot, 'rules'));
  return hash.digest('hex');
}

async function regularFile(file: string, optional = false): Promise<void> {
  const stat = await fs.lstat(file).catch((error) => {
    if (optional && error.code === 'ENOENT') return null;
    throw error;
  });
  if (stat && (!stat.isFile() || stat.isSymbolicLink()))
    throw new Error(`Comet 插件文件不是普通文件：${file}`);
}

export async function preparePluginIntegration(options: {
  platform: PluginPlatform;
  pluginRoot: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  cliEntry?: string;
}): Promise<{ platform: PluginPlatform; hookConfigPath: string; requiresHookTrust: boolean }> {
  const { platform } = options;
  const pluginRoot = path.resolve(options.pluginRoot);
  const home = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  const configRoot = path.resolve(
    platform === 'codex'
      ? (env.CODEX_HOME ?? path.join(home, '.codex'))
      : (env.DSH_HOME ?? path.join(home, '.dsh')),
  );
  const source = path.join(pluginRoot, 'skills', hookRelativePath);
  await regularFile(source);
  await regularFile(path.join(pluginRoot, 'rules/comet-workflow-guard.md'));
  const bytes = await fs.readFile(source);
  const fingerprint = await hashPluginRuntime(pluginRoot);
  const identity = fingerprint.slice(0, 24);
  const storage = path.join(configRoot, 'comet-plugin', identity);
  const entry = path.join(storage, 'skills', hookRelativePath);
  const hookConfigPath =
    platform === 'codex' ? path.join(configRoot, 'hooks.json') : path.join(storage, 'hooks.json');
  await fs.mkdir(configRoot, { recursive: true });
  if ((await fs.lstat(configRoot)).isSymbolicLink())
    throw new Error('Comet 插件配置目录不能是符号链接');
  await regularFile(entry, true);
  if ((await fs.readFile(entry).catch(() => null)) === null)
    await atomicWriteContainedBytes(entry, bytes, {
      containedRoot: configRoot,
      exclusive: true,
    }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
  if (!(await fs.readFile(entry)).equals(bytes))
    throw new Error('Comet 插件启动器内容与安装包不一致');
  const name = path.basename(path.dirname(pluginRoot));
  const pluginKey =
    name === 'comet' ? `comet@${path.basename(path.dirname(path.dirname(pluginRoot)))}` : undefined;
  const command = (event: string) =>
    buildNodeHookCommand([
      entry,
      '--platform',
      platform,
      '--plugin-root',
      pluginRoot,
      '--event',
      event,
      '--config-root',
      configRoot,
      '--package-hash',
      fingerprint,
      ...(pluginKey && platform === 'codex' ? ['--plugin-key', pluginKey] : []),
      ...(options.cliEntry ? ['--cli-entry', options.cliEntry] : []),
    ]);
  await withRecoverableFileLock(
    path.join(configRoot, 'comet-plugin-setup.lock'),
    async () => {
      await regularFile(hookConfigPath, true);
      const previous = await fs.readFile(hookConfigPath, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return '{}';
        throw error;
      });
      const config = JSON.parse(previous);
      if (!config || typeof config !== 'object' || Array.isArray(config))
        throw new Error('Hook 配置必须是 JSON 对象');
      if (
        config.hooks !== undefined &&
        (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks))
      )
        throw new Error('hooks 必须是 JSON 对象');
      const hooks = config.hooks ?? {};
      for (const event of ['SessionStart', 'PreToolUse']) {
        if (hooks[event] !== undefined && !Array.isArray(hooks[event]))
          throw new Error(`${event} 必须是数组`);
        hooks[event] = mergeHookGroups(
          hooks[event] ?? [],
          [
            {
              matcher: platform === 'dsh' && event === 'PreToolUse' ? 'write|edit' : '',
              hooks: [{ type: 'command', command: command(event) }],
            },
          ],
          [hookRelativePath],
        );
      }
      config.hooks = hooks;
      const next = `${JSON.stringify(config, null, 2)}\n`;
      if (previous !== next)
        await atomicWriteContainedText(hookConfigPath, next, { containedRoot: configRoot });
    },
    { timeoutMs: 30_000, retryMs: 50 },
  );
  return { platform, hookConfigPath, requiresHookTrust: platform === 'codex' };
}
