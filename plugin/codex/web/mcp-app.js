import { App, applyHostStyleVariables, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { App as Dashboard } from '../../../domains/dashboard/web/src/main.jsx';

const app = new App({ name: 'Comet Dashboard', version: '0.5.3' }, {}, { autoResize: false });
const container = document.getElementById('root');
const status = document.getElementById('connection-status');
const retry = document.getElementById('retry');
let connected = false;
let root;

function showError(message) {
  status.hidden = false;
  status.textContent = message;
  retry.hidden = false;
}

// 界面只通过 MCP 调用 Dashboard 原有 API，不从沙箱访问本机 HTTP 服务。
globalThis.fetch = async (input, options = {}) => {
  const route = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!/^\/api\/dashboard(?:[/?]|$)/u.test(route)) throw new Error('只允许调用 Dashboard API');
  const method = (
    options.method ?? (input instanceof globalThis.Request ? input.method : 'GET')
  ).toUpperCase();
  if (!['GET', 'POST'].includes(method)) throw new Error('不支持的 Dashboard 请求方法');
  const signal = options.signal ?? (input instanceof globalThis.Request ? input.signal : undefined);
  signal?.throwIfAborted();
  const body =
    options.body ??
    (input instanceof globalThis.Request && method === 'POST' ? await input.text() : undefined);
  if (body !== undefined && typeof body !== 'string')
    throw new Error('Dashboard 请求正文必须是 JSON 文本');
  const result = await app.callServerTool(
    {
      name: method === 'GET' ? 'dashboard_read' : 'dashboard_write',
      arguments: { path: route, ...(body === undefined ? {} : { body }) },
    },
    { signal },
  );
  signal?.throwIfAborted();
  if (result.isError)
    throw new Error(
      result.content?.find((item) => item.type === 'text')?.text ?? 'Dashboard 请求失败',
    );
  const response = result._meta?.dashboardResponse;
  if (!response || typeof response.body !== 'string') throw new Error('Dashboard 未返回有效数据');
  return new globalThis.Response(response.body, {
    status: response.status,
    headers: { 'content-type': response.contentType },
  });
};

function showResult(result) {
  if (result?.isError)
    throw new Error(
      result.content?.find((item) => item.type === 'text')?.text ?? '无法启动本地 Dashboard',
    );
  if (result?.structuredContent?.title !== 'Comet Dashboard')
    throw new Error('Dashboard 连接尚未就绪，请重试。');
  connected = true;
  container.hidden = false;
  status.hidden = true;
  retry.hidden = true;
  root ??= createRoot(container);
  root.render(createElement(Dashboard));
}

function applyContext(context) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
}

app.ontoolresult = (result) => {
  try {
    showResult(result);
  } catch (error) {
    showError(error.message);
  }
};
app.onhostcontextchanged = applyContext;
retry.addEventListener('click', async () => {
  retry.disabled = true;
  try {
    showResult(await app.callServerTool({ name: 'open_dashboard', arguments: {} }));
  } catch (error) {
    showError(`连接失败：${error.message}`);
  } finally {
    retry.disabled = false;
  }
});

try {
  await app.connect();
  applyContext(app.getHostContext());
  const host = app.getHostVersion();
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(host?.version ?? '');
  if (
    match &&
    (Number(match[1]) < 26 ||
      (Number(match[1]) === 26 &&
        (Number(match[2]) < 928 || (Number(match[2]) === 928 && Number(match[3]) < 20710))))
  ) {
    showError('请更新桌面应用后再打开 Comet Dashboard。');
  } else {
    setTimeout(async () => {
      if (connected) return;
      try {
        showResult(await app.callServerTool({ name: 'open_dashboard', arguments: {} }));
      } catch (error) {
        showError(`连接失败：${error.message}`);
      }
    }, 300);
  }
} catch (error) {
  showError(`当前应用无法打开 Comet 面板：${error.message}`);
}
