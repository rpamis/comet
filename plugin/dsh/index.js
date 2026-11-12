/**
 * Comet bundle Host half.
 *
 * Registers the bundled Comet workflow Skills with the Harness skill registry so
 * every workspace can load them without copying files into the project, and
 * serves the dashboard endpoints the Client half calls: one reports the plugin
 * state, the other starts or reuses the local Comet Dashboard for a Session's
 * workspace and returns its URL.
 *
 * The Skills drive the public `comet` CLI: the copy installed with this bundle as
 * a dependency when the package is installed from a registry, otherwise one on
 * PATH.
 */
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preparePluginIntegration } from '../../domains/skill/plugin-integration.js';

export const name = 'comet';
export const inject = ['skills'];

/** 优先使用插件依赖的官方桥接，也兼容发行版已提供的副本。 */
export async function resolveDshHookBridge() {
  const roots = [import.meta.url];
  if (process.argv[1]) roots.push(pathToFileURL(path.resolve(process.argv[1])).href);
  for (const root of roots) {
    const runtimeRequire = createRequire(root);
    try {
      runtimeRequire.resolve('@deepseek-ai/dsh-hooks-claude-code');
    } catch {
      continue;
    }
    return runtimeRequire('@deepseek-ai/dsh-hooks-claude-code');
  }
  throw new Error('Comet 缺少官方 dsh-hooks-claude-code 依赖，请重新安装插件');
}

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.join(packageRoot, 'skills');
const statusPath = '/comet-plugin/status';
const dashboardPath = '/comet-plugin/dashboard';
const statusSchema = 'comet.dsh-plugin.v1';
const dashboardSchema = 'comet.dsh-dashboard.v1';
const version = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;
const dashboardTimeoutMs = 30_000;
const probeTimeoutMs = 1_500;

/** Strip a single YAML quote pair without interpreting the rest of the scalar. */
function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Read one bundled skill directory into a registry registration input. */
function readSkill(name, directory) {
  const file = path.join(directory, 'SKILL.md');
  const source = readFileSync(file, 'utf8');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source);
  if (frontmatter === null) throw new Error(`Comet skill ${file} has no frontmatter block`);
  const description = /^description:[ \t]*(.+?)[ \t]*$/mu.exec(frontmatter[1]);
  if (description === null) throw new Error(`Comet skill ${file} has no description`);
  const content = source.slice(frontmatter[0].length).replace(/^\r?\n/u, '');
  const trimmed = unquote(description[1]);
  return {
    directory,
    description: trimmed,
    registration: {
      name,
      description: trimmed,
      content,
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
      path: file,
      resourceBase: { kind: 'directory', path: directory },
    },
  };
}

/** Load every bundled skill once; a malformed bundle must fail loudly. */
let bundledSkills;
function loadBundledSkills() {
  if (bundledSkills !== undefined) return bundledSkills;
  const directories = readdirSync(skillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (directories.length === 0) throw new Error(`Comet bundle has no skills in ${skillRoot}`);
  bundledSkills = directories.map((name) => readSkill(name, path.join(skillRoot, name)));
  return bundledSkills;
}

/** Resolve the Comet CLI installed as a dependency of this plugin package. */
export function resolveBundledComet() {
  let manifestPath;
  try {
    manifestPath = createRequire(import.meta.url).resolve('@rpamis/comet/package.json');
  } catch {
    return undefined;
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.comet;
    if (typeof bin !== 'string' || bin === '') return undefined;
    return {
      packageRoot: path.dirname(manifestPath),
      binPath: path.resolve(path.dirname(manifestPath), bin),
      version: typeof manifest.version === 'string' ? manifest.version : undefined,
    };
  } catch {
    return undefined;
  }
}

/** Build the command that runs the Comet CLI in this host's execution world. */
export async function resolveCometCli(subprocess, bundled = resolveBundledComet()) {
  if (bundled !== undefined) {
    return {
      source: 'bundled',
      version: bundled.version,
      command: process.execPath,
      argsPrefix: [bundled.binPath],
      // DSH 的 Node 执行环境可能不暴露 Electron 版本，但 execPath 仍指向桌面程序。
      env: { ELECTRON_RUN_AS_NODE: '1' },
    };
  }
  const executable = await subprocess.resolveExecutable('comet');
  return { source: 'path', command: executable, argsPrefix: [], env: {} };
}

/**
 * 把自带 CLI 接入当前 DSH 进程的 PATH，让共享 Skills 直接运行 comet。
 */
export function createCometShim(cli) {
  const directory = mkdtempSync(path.join(tmpdir(), 'comet-dsh-cli-'));
  const windows = process.platform === 'win32';
  const file = path.join(directory, windows ? 'comet.cmd' : 'comet');
  const prefix = cli.argsPrefix.map((argument) => `"${argument}"`).join(' ');
  const body = windows
    ? `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"${cli.command}" ${prefix} %*\r\n`
    : `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec "${cli.command}" ${prefix} "$@"\n`;
  writeFileSync(file, body);
  if (!windows) chmodSync(file, 0o755);
  const pathKey = windows
    ? (Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH')
    : 'PATH';
  const previousPath = process.env[pathKey];
  process.env[pathKey] = previousPath ? `${directory}${path.delimiter}${previousPath}` : directory;
  return {
    file,
    dispose() {
      if (process.env[pathKey] !== undefined) {
        const remaining = process.env[pathKey]
          .split(path.delimiter)
          .filter((entry) => entry !== directory)
          .join(path.delimiter);
        if (remaining === '' && previousPath === undefined) delete process.env[pathKey];
        else process.env[pathKey] = remaining;
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/**
 * Build the argv that launches `comet dashboard <cwd> --no-open` in this host's
 * execution world. Windows npm shims are `.cmd` files, so they run through the
 * command processor with verbatim quoting; other executables run directly.
 */
export function dashboardCommand(
  cli,
  cwd,
  platform = process.platform,
  comspec = process.env.ComSpec,
) {
  const executable = cli.command;
  const lower = executable.toLowerCase();
  const env = cli.env ?? {};
  if (platform === 'win32' && (lower.endsWith('.cmd') || lower.endsWith('.bat'))) {
    if (/["\r\n\0]/u.test(executable) || /["\r\n\0]/u.test(cwd)) {
      throw new Error('Comet Dashboard paths cannot contain double quotes');
    }
    return {
      command: comspec || 'cmd.exe',
      args: [
        '/d',
        '/v:off',
        '/s',
        '/c',
        '""%COMET_DSH_CLI%" dashboard "%COMET_DSH_CWD%" --no-open"',
      ],
      verbatim: true,
      // 参数值在环境变量展开后不会再次展开其中的 %NAME% 或 !NAME!。
      env: { ...env, COMET_DSH_CLI: executable, COMET_DSH_CWD: cwd },
    };
  }
  return {
    command: executable,
    args: [...(cli.argsPrefix ?? []), 'dashboard', cwd, '--no-open'],
    verbatim: false,
    env,
  };
}

/** Whether something still accepts TCP connections at the dashboard URL. */
function probeDashboard(url) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      resolve(false);
      return;
    }
    const port = Number(
      target.port === '' ? (target.protocol === 'https:' ? 443 : 80) : target.port,
    );
    const socket = connect({ host: target.hostname, port });
    const settle = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(probeTimeoutMs, () => settle(false));
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
  });
}

/** Stop one Dashboard process and, on Windows, the child tree its shell owns. */
function stopChildProcess(child, platform) {
  if (platform === 'win32' && child.pid !== undefined) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  child.kill();
}

/**
 * Serve the Dashboard to the Harness page from a loopback origin of this plugin.
 *
 * The Dashboard admits only same-origin browser requests, so an iframe on the
 * Harness origin cannot load it directly. This proxy forwards to the Dashboard
 * with its own authority and without the browser's origin markers, letting the
 * main column host the Dashboard in an iframe without weakening the Dashboard's
 * checks for every other client.
 */
export function startDashboardProxy(upstreamUrl) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(upstreamUrl);
    } catch (error) {
      reject(error);
      return;
    }
    const upstreamPort =
      target.port === '' ? (target.protocol === 'https:' ? 443 : 80) : Number(target.port);
    const server = http.createServer((request, response) => {
      const headers = { ...request.headers, host: target.host };
      delete headers.origin;
      delete headers['sec-fetch-site'];
      delete headers['sec-fetch-dest'];
      delete headers['sec-fetch-mode'];
      const forward = http.request(
        {
          hostname: target.hostname,
          port: upstreamPort,
          path: request.url,
          method: request.method,
          headers,
        },
        (answer) => {
          response.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(response);
        },
      );
      forward.on('error', () => {
        if (!response.headersSent) {
          response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        }
        response.end('Comet Dashboard is unavailable');
      });
      request.pipe(forward);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close() {
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}

/**
 * Start one `comet dashboard` process per project and reuse it for later opens.
 * The processes belong to this plugin: disposing the launcher stops them.
 */
export function createDashboardLauncher({
  spawnProcess = spawn,
  probe = probeDashboard,
  stopProcess = stopChildProcess,
  createProxy = startDashboardProxy,
  timeoutMs = dashboardTimeoutMs,
  platform = process.platform,
} = {}) {
  const running = new Map();
  const pending = new Map();
  const keyOf = (cwd) => (platform === 'win32' ? cwd.toLowerCase() : cwd);

  const stop = (child) => {
    try {
      stopProcess(child, platform);
    } catch {
      // The process is already gone; nothing else to stop.
    }
  };

  const closeProxy = (proxy) => {
    if (proxy === undefined) return;
    Promise.resolve(proxy.close()).catch(() => {});
  };

  const launch = async (cli, cwd) => {
    const spec = dashboardCommand(cli, cwd, platform);
    const child = spawnProcess(spec.command, spec.args, {
      cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: spec.verbatim,
    });
    let stderr = '';
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Comet Dashboard did not report a URL within ${timeoutMs} ms`)),
        timeoutMs,
      );
      const settle = (action, value) => {
        clearTimeout(timer);
        action(value);
      };
      child.stdout?.on('data', (chunk) => {
        const output = String(chunk);
        if (!output.includes('Comet Dashboard running at')) return;
        const match = /Comet Dashboard running at (https?:\/\/\S+)/u.exec(output);
        if (match !== null) settle(resolve, match[1]);
      });
      child.stderr?.on('data', (chunk) => {
        stderr = `${stderr}${String(chunk)}`.slice(-2000);
      });
      child.once('error', (error) => settle(reject, error));
      child.once('exit', (code) => {
        settle(reject, new Error(`Comet Dashboard exited with code ${code}: ${stderr.trim()}`));
      });
    }).catch((error) => {
      stop(child);
      throw error;
    });
    let proxy;
    try {
      proxy = await createProxy(url);
    } catch (error) {
      stop(child);
      throw error;
    }
    running.set(keyOf(cwd), { child, url, proxy });
    return { url, webUrl: proxy.origin };
  };

  return {
    /**
     * @param {{ command: string, argsPrefix: string[], env?: Record<string, string>, source?: string, version?: string }} cli
     * @param {string} cwd
     * @returns {Promise<{ url: string, webUrl: string, started: boolean }>}
     */
    async open(cli, cwd) {
      const key = keyOf(cwd);
      const existing = running.get(key);
      if (existing !== undefined && (await probe(existing.url))) {
        return { url: existing.url, webUrl: existing.proxy.origin, started: false };
      }
      if (existing !== undefined) {
        stop(existing.child);
        closeProxy(existing.proxy);
        running.delete(key);
      }
      const inFlight = pending.get(key);
      if (inFlight !== undefined) {
        const launched = await inFlight;
        return { ...launched, started: true };
      }
      const promise = launch(cli, cwd);
      pending.set(key, promise);
      try {
        return { ...(await promise), started: true };
      } finally {
        pending.delete(key);
      }
    },
    dispose() {
      for (const entry of running.values()) {
        stop(entry.child);
        closeProxy(entry.proxy);
      }
      running.clear();
      pending.clear();
    },
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function methodNotAllowed() {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { allow: 'GET, HEAD' },
  });
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

/** Read a small JSON request body; rejects oversized or malformed input. */
async function readJsonBody(request, limitBytes = 16_384) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes > limitBytes) return { error: 'body-too-large' };
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text === '') return { value: {} };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: 'invalid-json' };
  }
}

/** Report the plugin's bundled skills and the registry's winning candidates. */
async function statusPayload(ctx, integration) {
  const summaries = await ctx.skills.list();
  const byName = new Map(summaries.map((summary) => [summary.name, summary]));
  const bundledCli = resolveBundledComet();
  return {
    schema: statusSchema,
    version,
    integration,
    cli:
      bundledCli !== undefined && bundledCli.version !== undefined
        ? { source: 'bundled', version: bundledCli.version }
        : { source: 'path' },
    skills: loadBundledSkills().map((skill) => {
      const summary = byName.get(skill.registration.name);
      return {
        name: skill.registration.name,
        description: summary?.description ?? skill.description,
        provider: summary?.provider ?? null,
        source: summary?.source ?? null,
        pluginOwned: summary?.provider === 'runtime',
      };
    }),
  };
}

/** Resolve one Session's workspace and start or reuse its local Dashboard. */
async function handleDashboard(
  { agents, workingDirectory, subprocess, launcher },
  request,
  response,
) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'method-not-allowed' }, { allow: 'POST' });
    return;
  }
  const contentType = String(request.headers['content-type'] ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    sendJson(response, 415, { error: 'json-required' });
    return;
  }
  const parsed = await readJsonBody(request);
  if (parsed.error !== undefined) {
    sendJson(response, parsed.error === 'body-too-large' ? 413 : 400, { error: parsed.error });
    return;
  }
  const sessionId =
    typeof parsed.value?.sessionId === 'string' ? parsed.value.sessionId.trim() : '';
  if (sessionId === '') {
    sendJson(response, 400, { error: 'session-required' });
    return;
  }
  const agent = agents.get(sessionId);
  if (agent === undefined) {
    sendJson(response, 404, { error: 'unknown-session' });
    return;
  }
  let cwd;
  try {
    cwd = await workingDirectory.ensure(agent);
  } catch (error) {
    sendJson(response, 409, {
      error: 'workspace-unavailable',
      message: String(error?.message ?? error),
    });
    return;
  }
  let cli;
  try {
    cli = await resolveCometCli(subprocess);
  } catch (error) {
    sendJson(response, 503, {
      error: 'cli-unavailable',
      message: String(error?.message ?? error),
    });
    return;
  }
  try {
    const opened = await launcher.open(cli, cwd);
    sendJson(response, 200, {
      schema: dashboardSchema,
      version,
      cwd,
      cli: {
        source: cli.source,
        ...(cli.version === undefined ? {} : { cliVersion: cli.version }),
      },
      ...opened,
    });
  } catch (error) {
    sendJson(response, 503, {
      error: 'dashboard-unavailable',
      message: String(error?.message ?? error),
    });
  }
}

export function apply(ctx) {
  const integration = { status: 'starting' };
  const skills = loadBundledSkills();
  ctx.effect(() => {
    const disposers = skills.map((skill) => ctx.skills.register(skill.registration));
    return () => {
      for (const dispose of disposers.reverse()) dispose();
    };
  }, 'comet: bundled skills');
  ctx.logger?.info?.(`Comet plugin registered ${skills.length} bundled skills`);

  const launcher = createDashboardLauncher();
  ctx.effect(() => () => launcher.dispose(), 'comet: dashboard processes');

  const bundledCli = resolveBundledComet();
  if (bundledCli !== undefined) {
    let shim;
    try {
      shim = createCometShim({ command: process.execPath, argsPrefix: [bundledCli.binPath] });
    } catch (error) {
      ctx.logger?.warn?.(
        `Comet plugin could not prepare its bundled CLI: ${String(error?.message ?? error)}`,
      );
    }
    if (shim !== undefined) {
      ctx.effect(() => () => shim.dispose(), 'comet: bundled CLI shim');
    }
  }

  ctx.inject(['agents', 'workingDirectory', 'subprocess', 'webServer'], (scoped) => {
    let disposed = false;
    let bridge;
    scoped.effect(
      () => () => {
        disposed = true;
        bridge?.dispose();
      },
      'comet: workflow bridge',
    );
    if (typeof scoped.plugin !== 'function') {
      integration.status = 'unavailable';
      integration.message = '当前 DSH 未提供 Cordis 插件挂载入口';
    } else {
      void (async () => {
        const prepared = await preparePluginIntegration({
          platform: 'dsh',
          pluginRoot: packageRoot,
        });
        const module = await resolveDshHookBridge();
        if (disposed) return;
        bridge = scoped.plugin(module, {
          configPath: prepared.hookConfigPath,
          pluginRoot: packageRoot,
        });
        integration.status = 'ready';
        integration.hookConfigPath = prepared.hookConfigPath;
      })().catch((error) => {
        integration.status = 'failed';
        integration.message = String(error?.message ?? error);
        ctx.logger?.warn?.(`Comet 自动接入失败：${integration.message}`);
      });
    }
    const services = {
      agents: scoped.agents,
      workingDirectory: scoped.workingDirectory,
      subprocess: scoped.subprocess,
      launcher,
    };
    scoped.effect(
      () =>
        scoped.webServer.register({
          kind: 'exact',
          path: statusPath,
          resource: async (request) => {
            const method = request.method.toUpperCase();
            if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed();
            try {
              return json(await statusPayload(ctx, integration));
            } catch (error) {
              return json(
                { schema: statusSchema, version, error: String(error?.message ?? error) },
                500,
              );
            }
          },
        }),
      'comet: status route',
    );
    scoped.effect(
      () =>
        scoped.webServer.register({
          kind: 'exact',
          path: dashboardPath,
          handler: (request, response) => handleDashboard(services, request, response),
        }),
      'comet: dashboard route',
    );
  });
}
