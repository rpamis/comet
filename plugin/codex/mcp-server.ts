import { randomBytes } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getCurrentVersion } from '../../platform/version/version.js';
import {
  startDashboardServer,
  type DashboardServerHandle,
} from '../../domains/dashboard/server.js';
import { createDefaultDashboardPluginHostFactory } from '../../domains/dashboard/default-plugin-host.js';

export const DASHBOARD_UI_URI = 'ui://comet/dashboard-native';

export function createDashboardMcpServer(options: {
  projectPath: string;
  webRoot: string;
  appHtml: string;
  icon: string;
}) {
  const server = new McpServer({
    name: 'Comet Dashboard',
    version: getCurrentVersion(),
    icons: [{ src: options.icon, mimeType: 'image/png', sizes: ['500x500'] }],
  });
  const embedToken = randomBytes(32).toString('hex');
  let pending: Promise<DashboardServerHandle> | undefined;
  let closing: Promise<void> | undefined;

  function dashboard() {
    if (closing) throw new Error('Comet Dashboard 已关闭');
    pending ??= startDashboardServer({
      projectPath: options.projectPath,
      webRoot: options.webRoot,
      port: 0,
      embedToken,
      pluginHost: createDefaultDashboardPluginHostFactory(),
    }).catch((error) => {
      pending = undefined;
      throw error;
    });
    return pending;
  }

  const closeDashboard = () => {
    closing ??= (async () => {
      const handle = await pending?.catch(() => undefined);
      await handle?.close();
    })();
    return closing;
  };
  server.server.onclose = () => {
    void closeDashboard();
  };

  // 已打开的侧栏可能保留旧入口；两个地址都返回当前页面。
  for (const uri of [DASHBOARD_UI_URI, 'ui://comet/dashboard'])
    server.registerResource(
      uri === DASHBOARD_UI_URI ? 'comet-dashboard' : 'comet-dashboard-legacy',
      uri,
      {
        title: 'Comet Dashboard',
        mimeType: 'text/html;profile=mcp-app',
      },
      async () => ({
        contents: [
          {
            uri,
            mimeType: 'text/html;profile=mcp-app',
            text: options.appHtml,
            _meta: {
              ui: {
                csp: { frameDomains: [], connectDomains: [], resourceDomains: ['data:', 'blob:'] },
              },
              'openai/ui': {
                preferredDisplayMode: 'fullscreen',
                availableDisplayModes: ['fullscreen'],
              },
            },
          },
        ],
      }),
    );

  for (const [name, method] of [
    ['dashboard_read', 'GET'],
    ['dashboard_write', 'POST'],
  ] as const) {
    server.registerTool(
      name,
      {
        title: method === 'GET' ? '读取 Dashboard 数据' : '执行 Dashboard 操作',
        description: '供 Dashboard 界面调用已有本地 API；不接受外部地址或任意文件路径。',
        inputSchema: { path: z.string().max(16_384), body: z.string().max(2_000_000).optional() },
        annotations: {
          readOnlyHint: method === 'GET',
          destructiveHint: method !== 'GET',
          openWorldHint: false,
        },
        _meta: { ui: { visibility: ['app'] } },
      },
      async ({ path: route, body }) => {
        if (!/^\/api\/dashboard(?:[/?]|$)/u.test(route) || /[\\\s#]/u.test(route)) {
          throw new Error('只允许调用本地 Dashboard API');
        }
        const relative = new URL(route, 'http://localhost');
        if (
          relative.origin !== 'http://localhost' ||
          !/^\/api\/dashboard(?:\/|$)/u.test(relative.pathname)
        ) {
          throw new Error('Dashboard API 路径无效');
        }
        if (method === 'GET' && body !== undefined) throw new Error('读取操作不接受请求正文');
        const handle = await dashboard();
        const response = await fetch(`${handle.url}${relative.pathname}${relative.search}`, {
          method,
          ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body } : {}),
          redirect: 'error',
        });
        return {
          content: [{ type: 'text' as const, text: 'Dashboard 请求已完成。' }],
          _meta: {
            dashboardResponse: {
              status: response.status,
              contentType: response.headers.get('content-type') ?? 'application/json',
              body: await response.text(),
            },
          },
        };
      },
    );
  }

  for (const [name, type] of [
    ['open_dashboard', 'global'],
    ['show_dashboard', 'thread'],
  ] as const) {
    server.registerTool(
      name,
      {
        title: 'Comet Dashboard',
        description:
          type === 'global'
            ? '打开 Comet 本地 Dashboard，查看和管理项目、工作流、知识及评估记录。打开页面不会启动 Eval。'
            : '在当前会话旁打开 Comet Dashboard。打开页面不会启动 Eval。',
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        _meta: {
          ui: { resourceUri: DASHBOARD_UI_URI },
          'openai/ui': { entrypoints: [{ type }] },
        },
      },
      async () => {
        const handle = await dashboard();
        return {
          content: [{ type: 'text' as const, text: 'Comet Dashboard 已准备就绪。' }],
          structuredContent: { title: 'Comet Dashboard' },
          // 临时令牌只交给界面，不进入模型可见内容，也不写入缓存 HTML。
          _meta: { dashboardUrl: `${handle.url}/embedded/${embedToken}` },
        };
      },
    );
  }

  return {
    server,
    close: async () => {
      await server.close();
      await closeDashboard();
    },
  };
}
