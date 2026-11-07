import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import {
  parseCometHookRequest,
  renderCometHookDecision,
} from '../../platform/process/hook-adapter.js';
import { readStdinTextWithTimeoutAsync } from '../../platform/process/stdin-read.js';
import { readNodeHookArguments } from '../../platform/process/hook-command.js';
import { migratePluginInstallation } from './plugin-migration.js';
import { hashPluginRuntime } from './plugin-integration.js';
import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';

export async function runPluginHook(
  argv: string[],
  input: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || !argv[i + 1]) throw new Error('Comet 插件 Hook 参数无效');
    args.set(argv[i], argv[i + 1]);
  }
  const platform = args.get('--platform');
  if (platform !== 'codex' && platform !== 'dsh') throw new Error('Comet 插件 Hook 平台无效');
  const pluginRoot = args.get('--plugin-root');
  const configRoot = args.get('--config-root');
  if (!pluginRoot || !configRoot || !path.isAbsolute(pluginRoot) || !path.isAbsolute(configRoot))
    throw new Error('Comet 插件 Hook 路径必须是绝对路径');
  const neutral = { exitCode: 0, stdout: '', stderr: '' };
  if (
    !(await fs.stat(pluginRoot).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    }))
  ) {
    // 插件已卸载时，只清理引用该安装的配置，不阻塞其他项目或删除用户 Hook。
    if (platform === 'codex') {
      const file = path.join(configRoot, 'hooks.json');
      try {
        await withRecoverableFileLock(
          path.join(configRoot, 'comet-plugin-setup.lock'),
          async () => {
            const stat = await fs.lstat(file);
            if (!stat.isFile() || stat.isSymbolicLink()) return;
            const config = JSON.parse(await fs.readFile(file, 'utf8'));
            for (const event of ['SessionStart', 'PreToolUse']) {
              if (!Array.isArray(config.hooks?.[event])) continue;
              config.hooks[event] = config.hooks[event].flatMap(
                (group: Record<string, unknown>) => {
                  if (!Array.isArray(group?.hooks)) return [group];
                  const hooks = group.hooks.filter((hook: Record<string, unknown>) => {
                    const invocation = readNodeHookArguments(hook.command);
                    return (
                      !invocation ||
                      !invocation[0]
                        .replaceAll('\\', '/')
                        .endsWith('/skills/comet/scripts/comet-plugin-hook.mjs') ||
                      invocation[invocation.indexOf('--plugin-root') + 1] !== pluginRoot
                    );
                  });
                  return hooks.length === 0 &&
                    Object.keys(group).every((k) => ['matcher', 'hooks'].includes(k))
                    ? []
                    : [{ ...group, hooks }];
                },
              );
            }
            await atomicWriteContainedText(file, JSON.stringify(config, null, 2) + '\n', {
              containedRoot: configRoot,
            });
          },
          { timeoutMs: 30_000, retryMs: 50 },
        );
      } catch {
        /* 配置不可读时保持原文件，已卸载插件仍然放行。 */
      }
    }
    return neutral;
  }
  const pluginKey = args.get('--plugin-key');
  if (platform === 'codex' && pluginKey) {
    try {
      const config = parseToml(await fs.readFile(path.join(configRoot, 'config.toml'), 'utf8')) as {
        plugins?: Record<string, { enabled?: boolean }>;
      };
      if (config.plugins?.[pluginKey]?.enabled !== true) return neutral;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const event = args.get('--event');
  if (event !== 'SessionStart' && event !== 'PreToolUse')
    throw new Error('Comet 插件 Hook 事件无效');
  if (args.get('--package-hash') !== (await hashPluginRuntime(pluginRoot)))
    return renderCometHookDecision(
      platform,
      {
        allowed: false,
        reason: 'Comet 插件内容已改变，请重新启用并审阅更新后的 Hook',
      },
      { denialOutput: 'json' },
    );
  const payload: unknown = JSON.parse(input);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('Comet 插件 Hook 输入必须是 JSON 对象');
  const request = parseCometHookRequest(input);
  const migration = await migratePluginInstallation({
    platform,
    pluginRoot,
    configRoot,
    projectPath: request.cwd,
    hookExecuted: true,
  }).catch((error) => ({
    changed: [],
    backups: [],
    preserved: [{ path: configRoot, reason: String(error?.message ?? error) }],
    reportPath: undefined,
  }));
  const migrationContext =
    migration.changed.length || migration.preserved.length
      ? `Comet 原有安装迁移：已处理 ${migration.changed.length} 项，保留 ${migration.preserved.length} 项。${migration.reportPath ? `备份与保留原因见 ${migration.reportPath}` : ''}`
      : '';
  if (event === 'SessionStart') {
    const rule = await fs.readFile(path.join(pluginRoot, 'rules/comet-workflow-guard.md'), 'utf8');
    const cli = args.get('--cli-entry');
    return {
      exitCode: 0,
      stderr: '',
      stdout:
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: [
              'Comet 插件已接入。以下规则仅约束已启动的 Comet 工作流；普通任务正常执行，不自动初始化项目或启动 Eval。',
              rule,
              cli ? `Comet CLI 入口：node ${JSON.stringify(cli)}` : '',
              migrationContext,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        }) + '\n',
    };
  }
  const router = path.join(pluginRoot, 'skills/comet/scripts/comet-hook-router.mjs');
  const result = spawnSync(process.execPath, [router, '--platform', platform], {
    input,
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status === null)
    return renderCometHookDecision(
      platform,
      {
        allowed: false,
        reason: `Comet Router 启动失败：${result.error?.message ?? result.signal}`,
      },
      { denialOutput: 'json' },
    );
  if (result.status !== 0)
    return renderCometHookDecision(
      platform,
      {
        allowed: false,
        reason:
          result.status === 2
            ? result.stderr.trim() || 'Comet Router 拒绝本次写入'
            : `Comet Router 执行失败（${result.status}）：${result.stderr.trim()}`,
      },
      { denialOutput: 'json' },
    );
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: (migration.preserved.length ? `${migrationContext}\n` : '') + result.stderr,
  };
}

async function main() {
  try {
    const input = await readStdinTextWithTimeoutAsync();
    if (input.text === null) throw new Error('Comet Hook 未收到事件输入');
    const result = await runPluginHook(process.argv.slice(2), input.text);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  } catch (error) {
    const reason = `Comet 插件 Hook 失败：${error instanceof Error ? error.message : String(error)}`;
    const platform = process.argv[process.argv.indexOf('--platform') + 1];
    const result = renderCometHookDecision(
      platform,
      { allowed: false, reason },
      { denialOutput: 'json' },
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  await main();
