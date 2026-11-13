import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDashboardMcpServer } from './mcp-server.js';
import { discoverDashboardProjectRoot } from '../../domains/dashboard/project-root.js';
import { ensureCodexPluginCli } from '../../platform/install/codex-plugin-cli.js';
import { preparePluginIntegration } from '../../domains/skill/plugin-integration.js';
import {
  migratePluginInstallation,
  type PluginMigrationResult,
} from '../../domains/skill/plugin-migration.js';

const application = createDashboardMcpServer({
  projectPath: await discoverDashboardProjectRoot(process.cwd()),
  webRoot: fileURLToPath(new URL('./web/', import.meta.url)),
  appHtml: await fs.readFile(new URL('./dashboard-app.html', import.meta.url), 'utf8'),
  icon: `data:image/png;base64,${await fs.readFile(new URL('../assets/icon.png', import.meta.url), 'base64')}`,
});
let cliPreparation: ReturnType<typeof ensureCodexPluginCli> | undefined;
let migration: PluginMigrationResult | undefined;
function prepareCli() {
  cliPreparation ??= ensureCodexPluginCli({
    pluginRoot: fileURLToPath(new URL('../', import.meta.url)),
  })
    .then(async (cli) => {
      if (process.env.COMET_PLUGIN_SKIP_INTEGRATION !== '1') {
        const prepared = await preparePluginIntegration({
          platform: 'codex',
          pluginRoot: fileURLToPath(new URL('../', import.meta.url)),
          cliEntry: cli.entry,
        });
        migration = await migratePluginInstallation({
          platform: 'codex',
          pluginRoot: fileURLToPath(new URL('../', import.meta.url)),
          configRoot: path.dirname(prepared.hookConfigPath),
          projectPath: process.cwd(),
        });
      }
      return cli;
    })
    .finally(() => {
      cliPreparation = undefined;
    });
  return cliPreparation;
}
if (process.env.COMET_PLUGIN_SKIP_CLI_INSTALL !== '1')
  void prepareCli().catch((error) => console.error(`Comet 自动接入失败：${error.message}`));
application.server.registerTool(
  'setup_comet_cli',
  {
    title: '准备 Comet CLI',
    description:
      '等待插件自动安装配套的 Comet CLI npm 包。安装失败后可再次调用重试；执行工作流前可用此工具确认 CLI 已准备就绪。不会初始化项目或启动 Eval。',
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async () => {
    const result = await prepareCli();
    return {
      content: [
        {
          type: 'text',
          text: `Comet CLI ${result.version} 已准备就绪。入口：${JSON.stringify(result.entry)}。用户级 Hook 自动接入；Codex 要求在原生界面审阅并信任后执行。无需再运行 comet init。${migration?.reportPath ? `原有安装迁移记录：${migration.reportPath}；保留 ${migration.preserved.length} 项。` : ''}`,
        },
      ],
    };
  },
);
const stop = () => {
  void application.close();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.stdin.once('end', stop);
await application.server.connect(new StdioServerTransport());
