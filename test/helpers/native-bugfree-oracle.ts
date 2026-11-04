import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** 普通确定性判定：实际文件/进程、浏览器或 SDK；不启动模型或容器。 */
export async function checkFrozenProjectAtBoundary(
  files: Record<string, string>,
  oracle: string,
  boundary?: 'browser' | 'supervisor',
  requirements = '',
  baselineFiles?: Record<string, string>,
) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-frozen-oracle-'));
  let root = path.join(temporary, 'project');
  try {
    if (boundary === 'supervisor') {
      const { prepareFrozenSupervisorCandidate } = await import('./native-bugfree-supervisor.js');
      const prepared = await prepareFrozenSupervisorCandidate(
        temporary,
        files,
        requirements,
        baselineFiles,
      );
      root = prepared.integrationRoot;
      assert.equal(
        prepared.run.actions.filter(
          (action) => action.stepId === 'supervisor.child.checks' && action.status === 'succeeded',
        ).length,
        2,
      );
      assert.equal(
        prepared.run.actions.filter(
          (action) =>
            action.stepId === 'supervisor.child.integrate' && action.status === 'succeeded',
        ).length,
        2,
      );
      assert.equal(prepared.context?.verifyMode, 'bugfree');
      assert.equal(prepared.context?.workspace.implementationRoot, root);
      // 隐藏判定使用字节相同的副本，避免测试数据写入使已绑定的父级候选失效。
      root = path.join(temporary, 'oracle-project');
      await fs.mkdir(root);
      for (const [ref, text] of Object.entries(files))
        await fs.writeFile(path.join(root, ref), text);
    } else {
      await fs.mkdir(root);
      for (const [ref, text] of Object.entries(files))
        await fs.writeFile(path.join(root, ref), text);
    }
    if (boundary === 'browser') return await checkBrowser(root, temporary, oracle);
    const hidden = path.join(temporary, 'hidden-oracle.cjs');
    await fs.writeFile(
      hidden,
      `const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {execFileSync,spawnSync}=require('node:child_process');const root=process.argv[2];const candidate=require(path.join(root,'candidate.cjs'));(async()=>{${oracle}})().catch(error=>{process.stderr.write(String(error));process.exitCode=1});`,
    );
    const result = spawnSync(process.execPath, [hidden, root], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0 && result.status !== 1)
      throw new Error(`Hidden oracle execution failed: ${result.status}`);
    return result.status === 0 ? 'pass' : 'fail';
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

async function checkBrowser(root: string, temporary: string, oracle: string) {
  const browser = [
    process.env.COMET_TEST_CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find((file) => file && existsSync(file));
  if (!browser)
    throw new Error(
      'A real Chrome/Edge browser is required for frozen UI truth; no model Eval was started',
    );
  let count = 0;
  const pending: ServerResponse[] = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/tick') {
      setTimeout(() => response.end('tick'), 30);
      return;
    }
    if (request.url === '/submit') {
      count++;
      pending.push(response);
      return;
    }
    if (request.url === '/state') {
      response.end(String(count));
      return;
    }
    if (request.url === '/release') {
      for (const waiting of pending.splice(0)) waiting.end('ok');
      response.end('released');
      return;
    }
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        (await fs.readFile(path.join(root, 'index.html'), 'utf8')).replace(
          '</body>',
          `<script>${oracle}</script></body>`,
        ),
      );
      return;
    }
    if (request.url === '/browser.js') {
      response.setHeader('Content-Type', 'application/javascript');
      response.end(await fs.readFile(path.join(root, 'browser.js')));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    const result = await promisify(execFile)(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-proxy-server',
        `--user-data-dir=${path.join(temporary, 'browser-profile')}`,
        '--dump-dom',
        '--virtual-time-budget=5000',
        `http://127.0.0.1:${address.port}/`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024 },
    );
    const verdict = /<pre id="oracle-result" data-verdict="(pass|fail)"/u.exec(result.stdout)?.[1];
    if (!verdict) throw new Error('Browser did not produce a complete hidden verdict');
    return verdict;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
