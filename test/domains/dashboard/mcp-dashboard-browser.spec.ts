import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

test('renders the packaged Dashboard without frames or browser network access under desktop CSP', async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  const browserApiRequests: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /content security policy|blocked by csp/iu.test(message.text())
    )
      browserErrors.push(message.text());
  });
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/dashboard'))
      browserApiRequests.push(request.url());
  });
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-mcp-browser-'));
  const project = path.join(fixture, 'sidebar-project');
  const home = path.join(fixture, 'home');
  const { version } = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8'));
  const pluginRoot = path.resolve(
    process.env.COMET_MCP_PLUGIN_ROOT ?? `dist/codex-plugin/${version}-zh/comet`,
  );
  await fs.mkdir(path.join(project, '.comet'), { recursive: true });
  await fs.mkdir(home);
  execFileSync('git', ['init', '--quiet'], { cwd: project, windowsHide: true });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--allow-empty',
      '-qm',
      'Initialize fixture',
    ],
    { cwd: project, windowsHide: true },
  );
  const isolatedEnvironment = {
    HOME: home,
    USERPROFILE: home,
    PATH: process.env.PATH ?? '',
    SYSTEMROOT: process.env.SYSTEMROOT ?? '',
    TMP: fixture,
    TEMP: fixture,
    COMET_DAEMON: 'off',
    COMET_PLUGIN_SKIP_CLI_INSTALL: '1',
  };
  for (const command of [
    ['init', '--language', 'zh-CN'],
    ['new', 'sidebar-change', '--language', 'zh-CN', '--isolation', 'current'],
  ]) {
    execFileSync(process.execPath, [path.resolve('bin/comet.js'), 'native', ...command, '--json'], {
      cwd: project,
      env: isolatedEnvironment,
      windowsHide: true,
      stdio: 'pipe',
      timeout: 60_000,
    });
  }
  const client = new Client({ name: 'dashboard-browser-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(pluginRoot, 'server/comet-dashboard-mcp.mjs')],
    cwd: project,
    env: isolatedEnvironment,
    stderr: 'pipe',
  });
  let harness: http.Server | undefined;
  let simulateConnectionFailure = true;
  let openCalls = 0;
  try {
    await client.connect(transport);
    // 已打开的桌面入口仍可能请求旧 URI，必须显示同一份修复后的页面。
    const resource = await client.readResource({ uri: 'ui://comet/dashboard' });
    const html = String(resource.contents[0].text);
    const policy =
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; frame-src 'none'; connect-src 'none'";
    const sourceDocument = html.replace(
      '<head>',
      `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`,
    );
    harness = http.createServer(async (req, res) => {
      try {
        if (req.url === '/tool') {
          let text = '';
          for await (const chunk of req) text += chunk;
          const call = text ? JSON.parse(text) : { name: 'open_dashboard', arguments: {} };
          if (call.name === 'open_dashboard') openCalls++;
          const result =
            simulateConnectionFailure && call.name === 'open_dashboard'
              ? { isError: true, content: [{ type: 'text', text: '连接暂时不可用' }] }
              : await client.callTool(call);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(result));
        } else {
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy':
              "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; frame-src 'self' https: data: blob:",
          });
          res.end(`<!doctype html><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;overflow:hidden}</style><iframe title="MCP App" sandbox="allow-scripts allow-same-origin"></iframe><script>
            const frame = document.querySelector('iframe');
            frame.srcdoc = ${JSON.stringify(sourceDocument).replace(/</gu, '\\u003c')};
            window.addEventListener('message', async event => {
              if (event.source !== frame.contentWindow) return;
              const request = event.data;
              const reply = result => frame.contentWindow.postMessage({jsonrpc:'2.0',id:request.id,result}, '*');
              if(request.method === 'ui/initialize') reply({protocolVersion:'2026-01-26',hostInfo:{name:'Desktop test',version:'26.1106.1'},hostCapabilities:{serverTools:{}},hostContext:{displayMode:'fullscreen',availableDisplayModes:['fullscreen'],theme:'light'}});
              if(request.method === 'ui/notifications/initialized') {
                const result = await fetch('/tool').then(r=>r.json());
                frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:result}, '*');
              }
              if(request.method === 'tools/call') reply(await fetch('/tool', {method:'POST',body:JSON.stringify(request.params)}).then(r=>r.json()));
            });
          </script>`);
        }
      } catch (error) {
        res.writeHead(500);
        res.end(String(error));
      }
    });
    await new Promise<void>((resolve) => harness!.listen(0, '127.0.0.1', resolve));
    const address = harness.address() as { port: number };
    await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'domcontentloaded' });
    const app = page.frameLocator('iframe[title="MCP App"]');
    await expect(app.getByText(/连接暂时不可用/)).toBeVisible();
    await expect.poll(() => openCalls).toBeGreaterThanOrEqual(2);
    simulateConnectionFailure = false;
    await app
      .getByRole('button', { name: '重新连接' })
      .click({ noWaitAfter: true, timeout: 10_000 });
    const dashboard = app;
    await expect(dashboard.locator('iframe')).toHaveCount(0);
    for (const width of [1600, 1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(dashboard.locator('body')).toContainText('sidebar-project', { timeout: 8_000 });
      await expect(dashboard.locator('body')).toContainText('Native');
      await expect(dashboard.getByText('Native 变更工作区', { exact: true })).toBeVisible({
        timeout: 45_000,
      });
      await expect(dashboard.getByText('sidebar-change', { exact: true }).first()).toBeVisible({
        timeout: 45_000,
      });
      await expect(
        dashboard.getByRole('heading', { name: 'sidebar-change', exact: true }),
      ).toBeVisible({
        timeout: 45_000,
      });
      await expect(dashboard.getByLabel('正在加载 Native 变更详情')).toHaveCount(0);
      await expect(dashboard.getByText('状态异常', { exact: true })).toHaveCount(0);
      const sizes = await dashboard
        .locator('html')
        .evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
      expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 1);
      await page.screenshot({
        path: testInfo.outputPath(`dashboard-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    const settings = dashboard.getByRole('button', { name: /^(设置|Settings)$/ });
    if (!(await settings.isVisible()))
      await dashboard.getByRole('button', { name: /^(展开导航|Open navigation)$/ }).click();
    await settings.click();
    const dialog = dashboard.getByRole('dialog');
    await dialog.getByRole('menuitem', { name: /外观|Appearance/ }).click();
    await dialog.getByRole('radio', { name: /^(暗色|Dark)$/ }).check();
    await dialog.getByRole('button', { name: /^(完成|Done)$/ }).click();
    await expect(dialog).toBeHidden();
    expect(browserErrors).toEqual([]);
    expect(browserApiRequests).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('dashboard-dark.png'), fullPage: true });
  } finally {
    await page.close();
    if (harness) await new Promise<void>((resolve) => harness!.close(() => resolve()));
    await client.close();
    await fs.rm(fixture, { recursive: true, force: true });
  }
});
