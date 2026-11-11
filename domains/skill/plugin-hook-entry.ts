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
    if (
      request.cwd &&
      (await fs.lstat(path.join(request.cwd, '.comet', 'config.yaml')).catch(() => null))
    ) {
      const { resolveWorkspaceRuntimeRootSync } =
        await import('../workflow-contract/workspace-runtime.js');
      const current = resolveWorkspaceRuntimeRootSync(request.cwd);
      if (
        !(await fs.lstat(current).catch(() => null)) &&
        (
          await fs.lstat(path.join(request.cwd, '.comet', 'runtime')).catch(() => null)
        )?.isDirectory()
      ) {
        const { importLegacyWorkspaceRuntimeData } =
          await import('../workflow-contract/legacy-runtime-import.js');
        const { importClassicLegacyRuntimeData } =
          await import('../comet-classic/classic-legacy-runtime-import.js');
        await importLegacyWorkspaceRuntimeData(request.cwd);
        await importClassicLegacyRuntimeData(request.cwd);
      }
    }
    const rulePath = path.join(pluginRoot, 'rules/comet-workflow-guard.md');
    const rule = await fs.readFile(rulePath, 'utf8');
    const chinese = rule.startsWith('# Comet 当前');
    const context = chinese
      ? [
          'Comet 插件已接入。普通任务正常执行，不自动初始化 Comet 或启动 Eval。',
          '任务开始、恢复或切换工作区/change 时，先只读 .comet/config.yaml 和 .comet/current-change.json，复用仍有效的所有权。selection 决定当前需求，default_workflow 只决定默认入口。selection 缺失或失效时，只读发现活跃需求：无候选继续普通任务，唯一候选核对恢复，多个候选请用户选择；配置或状态无效时停止相关 Comet 动作，不猜测归属。',
          '用户调用 Comet 或当前需求属于 Native、Classic、应用 Run 时，推进或写入前必须读取并执行下方完整 Rule，再加载当前 Skill；应用 Run 沿用固定包 Rule 和原 Run。当前上下文已读取且仍适用时直接复用；压缩或恢复后缺少规则时重新读取。写入拒绝后按 Runtime 最新恢复命令核对原执行，不重发结果未知的工作。',
          `完整 Rule：${rulePath}`,
        ]
      : [
          'Comet is available. Continue ordinary tasks without initializing Comet or starting Eval.',
          'At task start, recovery or workspace/change switches, read .comet/config.yaml and .comet/current-change.json once and reuse valid ownership. The selection identifies the current request; default_workflow only selects an entry point. If selection is missing or stale, discover active requests read-only: continue ordinary work with none, inspect and recover a unique candidate, or ask the user to choose among several. Stop affected Comet actions on invalid config/state rather than guessing ownership.',
          'When the user invokes Comet or the current request belongs to Native, Classic or an application Run, read and follow the complete Rule below before advancing or writing, then load the current Skill. Application Runs retain their pinned Rule and original Run. Reuse a Rule already present and still applicable; reread it after compaction or recovery if missing. After a write denial, follow the latest Runtime recovery command and reconcile the original execution without replaying unknown work.',
          `Complete Rule: ${rulePath}`,
        ];
    const cli = args.get('--cli-entry');
    return {
      exitCode: 0,
      stderr: '',
      stdout:
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: [
              ...context,
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
