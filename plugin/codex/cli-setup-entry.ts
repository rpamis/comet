import { fileURLToPath } from 'node:url';
import { ensureCodexPluginCli } from '../../platform/install/codex-plugin-cli.js';
import { preparePluginIntegration } from '../../domains/skill/plugin-integration.js';

try {
  const result = await ensureCodexPluginCli({
    pluginRoot: fileURLToPath(new URL('../', import.meta.url)),
  });
  if (process.env.COMET_PLUGIN_SKIP_INTEGRATION !== '1')
    await preparePluginIntegration({
      platform: 'codex',
      pluginRoot: fileURLToPath(new URL('../', import.meta.url)),
      cliEntry: result.entry,
    });
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `Comet CLI ${result.version} 已准备就绪。CLI 入口：${JSON.stringify(result.entry)}；若 PATH 中没有 comet，可使用 node 加此入口执行相同命令。`,
      },
    }),
  );
} catch (error) {
  console.error(
    `Comet CLI 自动安装失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
