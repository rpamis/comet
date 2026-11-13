import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { resolveNpmCommand } from '../../platform/process/node-cli-command.js';

const repositoryRoot = path.resolve('.');
const builder = path.join(repositoryRoot, 'scripts/build/build-dsh-plugin.mjs');
const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));

interface SkillRegistration {
  name: string;
  description: string;
  content: string;
  source: string;
  invocation: { modelInvocable: boolean; userInvocable: boolean };
  resourceBase: { kind: string; path: string };
  path: string;
}

type HostModule = {
  apply: (ctx: unknown) => void;
  inject: string[];
  resolveBundledComet: () => { binPath: string; version?: string; packageRoot: string } | undefined;
  resolveCometCli: (
    subprocess: unknown,
    bundled?: { binPath: string; version?: string; packageRoot: string },
  ) => Promise<{
    source: string;
    version?: string;
    command: string;
    argsPrefix: string[];
    env: Record<string, string>;
  }>;
  createCometShim: (cli: { command: string; argsPrefix: string[] }) => {
    file: string;
    dispose: () => void;
  };
  dashboardCommand: (
    cli: { command: string; argsPrefix: string[]; env?: Record<string, string> },
    cwd: string,
    platform?: string,
    comspec?: string,
  ) => { command: string; args: string[]; verbatim: boolean; env: Record<string, string> };
  startDashboardProxy: (upstreamUrl: string) => Promise<{
    origin: string;
    close: () => Promise<void>;
  }>;
  createDashboardLauncher: (options: Record<string, unknown>) => {
    open: (
      cli: { command: string; argsPrefix: string[]; env?: Record<string, string> },
      cwd: string,
    ) => Promise<{ url: string; webUrl: string; started: boolean }>;
    dispose: () => void;
  };
};

interface FakeRequest {
  method: string;
  headers: Record<string, string>;
  [Symbol.asyncIterator](): AsyncGenerator<Buffer, void, unknown>;
}

interface FakeResponse {
  writeHead(status: number, headers: Record<string, string>): FakeResponse;
  end(body?: string): void;
}

type FakeRoute = {
  kind: string;
  path: string;
  resource?: (request: Request) => Promise<Response>;
  handler?: (request: FakeRequest, response: FakeResponse) => Promise<void> | void;
};

function createFakeRequest({
  method = 'POST',
  body = '',
  headers = {},
}: { method?: string; body?: string; headers?: Record<string, string> } = {}): FakeRequest {
  return {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() {
      if (body !== '') yield Buffer.from(body);
    },
  };
}

function callHandler(
  handler: (request: FakeRequest, response: FakeResponse) => Promise<void> | void,
  request: FakeRequest,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const captured = { status: 0, headers: {} as Record<string, string>, body: '' };
  const response: FakeResponse = {
    writeHead(status, headers) {
      captured.status = status;
      captured.headers = headers;
      return response;
    },
    end(body) {
      captured.body = body ?? '';
    },
  };
  return Promise.resolve(handler(request, response)).then(() => captured);
}

function createFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    killed: boolean;
    kill: () => void;
  };
  child.pid = 4242;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

describe('DeepSeek Harness plugin package', () => {
  it('mounts and disposes its hook bridge without rewriting a profile or initializing projects', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'comet dsh bridge '));
    vi.stubEnv('DSH_HOME', path.join(temporary, 'dsh'));
    try {
      const built = spawnSync(process.execPath, [builder, '--output-root', temporary], {
        encoding: 'utf8',
        windowsHide: true,
      });
      expect(built.status, built.stderr).toBe(0);
      const { pluginRoot } = JSON.parse(built.stdout);
      // 只替代平台模块装载；真实官方桥接事件另在安装后的 Harness 运行时验证。
      const bridgeRoot = path.join(pluginRoot, 'node_modules/@deepseek-ai/dsh-hooks-claude-code');
      await mkdir(bridgeRoot, { recursive: true });
      await writeFile(path.join(bridgeRoot, 'package.json'), '{"main":"index.cjs"}');
      await writeFile(
        path.join(bridgeRoot, 'index.cjs'),
        'exports.name="official-bridge-fixture"; exports.apply=()=>{};',
      );
      const host = (await import(
        pathToFileURL(path.join(pluginRoot, 'index.js')).href
      )) as HostModule;
      const disposers = new Map<string, () => void>();
      const dispose = vi.fn();
      const mounted = vi.fn(() => ({ dispose }));
      const effect = (register: () => () => void, label: string) => {
        disposers.set(label, register());
      };
      host.apply({
        skills: { register: () => () => {}, list: async () => [] },
        effect,
        logger: { info() {}, warn() {} },
        inject: (_dependencies: string[], callback: (ctx: unknown) => void) =>
          callback({
            effect,
            plugin: mounted,
            agents: {},
            workingDirectory: {},
            subprocess: {},
            webServer: { register: () => () => {} },
          }),
      });
      await vi.waitFor(() => expect(mounted).toHaveBeenCalledOnce(), { timeout: 10_000 });
      const config = (mounted.mock.calls[0] as unknown as [unknown, { configPath: string }])[1];
      const hooks = (await readJson(config.configPath)).hooks;
      expect(hooks.SessionStart).toHaveLength(1);
      expect(hooks.PreToolUse[0].matcher).toBe('write|edit');
      expect(existsSync(path.join(temporary, 'dsh/profiles'))).toBe(false);
      expect(existsSync(path.join(temporary, '.comet'))).toBe(false);
      disposers.get('comet: workflow bridge')!();
      expect(dispose).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllEnvs();
      await rm(temporary, { recursive: true, force: true });
    }
  }, 30_000);
  it('preserves Node launch mode for bundled CLI and shell shim', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'comet dsh node mode '));
    const originalPath = process.env.PATH;
    try {
      const host = (await import(
        pathToFileURL(path.join(repositoryRoot, 'plugin/dsh/index.js')).href
      )) as HostModule;
      const entry = path.join(temporary, 'mode.mjs');
      await writeFile(entry, 'console.log(process.env.ELECTRON_RUN_AS_NODE ?? "missing");');
      const cli = await host.resolveCometCli(
        {},
        { packageRoot: temporary, binPath: entry, version: '0.5.3' },
      );
      expect(cli.env.ELECTRON_RUN_AS_NODE).toBe('1');
      process.env.PATH = temporary;
      const shim = host.createCometShim(cli);
      try {
        expect(process.env.PATH?.split(path.delimiter)[0]).toBe(path.dirname(shim.file));
        const result =
          process.platform === 'win32'
            ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'comet'], {
                encoding: 'utf8',
                windowsHide: true,
                windowsVerbatimArguments: true,
              })
            : spawnSync('/bin/sh', ['-c', 'comet'], { encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout.trim()).toBe('1');
        process.env.PATH += `${path.delimiter}later-plugin-entry`;
      } finally {
        shim.dispose();
      }
      expect(process.env.PATH).toBe(`${temporary}${path.delimiter}later-plugin-entry`);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      await rm(temporary, { recursive: true, force: true });
    }
  });
  it('includes bundled skills and runtime in the npm package', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'comet dsh npm '));
    try {
      const built = spawnSync(process.execPath, [builder, '--output-root', temporary], {
        encoding: 'utf8',
        windowsHide: true,
      });
      expect(built.status, built.stderr).toBe(0);
      const { pluginRoot } = JSON.parse(built.stdout);
      const command = resolveNpmCommand(['pack', '--dry-run', '--json', '--ignore-scripts'], {
        cwd: pluginRoot,
      });
      const packed = spawnSync(command.command, command.args, {
        cwd: pluginRoot,
        env: command.env,
        encoding: 'utf8',
        windowsHide: true,
      });
      expect(packed.status, packed.stderr).toBe(0);
      const files = JSON.parse(packed.stdout)[0].files.map((file: { path: string }) => file.path);
      const metadata = await readJson(path.join(pluginRoot, 'package.json'));
      expect(metadata.dependencies['@deepseek-ai/dsh-hooks-claude-code']).toBe('0.2.2-rc.1');
      expect(metadata.dependencies['@deepseek-ai/dsh-hook-protocol']).toBe('0.2.2-rc.1');
      expect(metadata.dependencies['@deepseek-ai/dsh-llm']).toBe('0.2.2-rc.1');
      expect(files).toContain('rules/comet-workflow-guard.md');
      expect(files).toContain('rules/migration-assets.json');
      expect(files).toContain('skills/comet/scripts/comet-plugin-hook.mjs');
      expect(files).toContain('skills/comet/SKILL.md');
      expect(files).toContain('skills/comet-native/SKILL.md');
      expect(files).toContain('skills/comet/scripts/comet-hook-router.mjs');
      expect(files.filter((file: string) => /^skills\/[^/]+\/SKILL\.md$/u.test(file))).toHaveLength(
        13,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
  it('builds an installable bundle whose Host half registers skills and serves the dashboard endpoints', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'comet dsh plugin '));
    try {
      const outputRoot = path.join(temporary, 'output');
      const result = spawnSync(process.execPath, [builder, '--output-root', outputRoot], {
        cwd: temporary,
        encoding: 'utf8',
        windowsHide: true,
      });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      const built = JSON.parse(result.stdout) as {
        pluginRoot: string;
        archive: string;
        version: string;
        language: string;
      };
      const pluginRoot = built.pluginRoot;
      const manifest = await readJson(path.join(pluginRoot, 'package.json'));
      const packageJson = await readJson(path.join(repositoryRoot, 'package.json'));
      expect(manifest.name).toBe('comet-dsh-plugin');
      expect(manifest.version).toBe(packageJson.version);
      expect(manifest).not.toHaveProperty('private');
      expect(manifest.publishConfig).toEqual({
        access: 'public',
        registry: 'https://registry.npmjs.org/',
      });
      expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml');
      expect(manifest.dsh.client.platform).toBe('web');
      expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-sidebar-right');
      expect(manifest.homepage).toBe('https://github.com/rpamis/comet');
      expect(manifest.repository.url).toBe('https://github.com/rpamis/comet');
      expect(manifest.description).toContain('Comet');
      expect(manifest.engines.dsh).toBe('>=0.2.2-rc.1');
      expect(manifest.dependencies['@rpamis/comet']).toBe(packageJson.version);
      expect(manifest.exports['.']).toBe('./index.js');
      expect(manifest.exports['./client']).toBe('./client.js');
      expect(manifest.icon).toBe('icon.png');

      const patch = parse(await readFile(path.join(pluginRoot, 'cordis.patch.yml'), 'utf8')) as {
        insert: { id: string; name: string }[];
      }[];
      expect(patch[0].insert[0]).toEqual({ id: 'comet', name: 'comet-dsh-plugin' });

      for (const language of ['zh', 'en']) {
        const locale = await readJson(path.join(pluginRoot, 'locale', `${language}.json`));
        expect(locale.meta.title).toBe('Comet');
        expect(locale.meta.description.length).toBeGreaterThan(10);
        expect(locale.meta.detail).toMatch(/^README(?:\.en)?\.md$/u);
        expect(await readFile(path.join(pluginRoot, locale.meta.detail), 'utf8')).toContain(
          'https://github.com/rpamis/comet',
        );
      }

      const host = (await import(
        pathToFileURL(path.join(pluginRoot, 'index.js')).href
      )) as unknown as HostModule;
      expect(host.inject).toEqual(['skills']);
      const registrations: SkillRegistration[] = [];
      const effects: (() => void)[] = [];
      const injected: string[][] = [];
      let whenServices: ((scoped: unknown) => void) | undefined;
      host.apply({
        effect: (register: () => () => void) => {
          effects.push(register());
        },
        skills: {
          register: (skill: SkillRegistration) => {
            registrations.push(skill);
            return () => {
              registrations.splice(registrations.indexOf(skill), 1);
            };
          },
          list: async () =>
            registrations.map((skill) => ({
              name: skill.name,
              description: skill.description,
              provider: 'runtime',
              source: 'bundled',
            })),
        },
        logger: { info: () => {}, warn: () => {} },
        inject: (dependencies: string[], callback: (scoped: unknown) => void) => {
          injected.push(dependencies);
          whenServices = callback;
        },
      });

      const assets = await readJson(path.join(repositoryRoot, 'assets/manifest.json'));
      const skillNames = [
        ...new Set(
          (assets.skills as string[])
            .filter((file) => file.endsWith('/SKILL.md'))
            .map((file) => file.split('/')[0]),
        ),
      ].sort();
      expect(registrations).toHaveLength(skillNames.length);
      expect(registrations.map((skill) => skill.name).sort()).toEqual(skillNames);
      for (const skill of registrations) {
        expect(skill.source).toBe('bundled');
        expect(skill.invocation).toEqual({ modelInvocable: true, userInvocable: true });
        expect(skill.description.length).toBeGreaterThan(0);
        expect(skill.content.startsWith('---')).toBe(false);
        expect(skill.content.trimStart().startsWith('#')).toBe(true);
        expect(skill.resourceBase).toEqual({
          kind: 'directory',
          path: path.join(pluginRoot, 'skills', skill.name),
        });
        expect(skill.path).toBe(path.join(pluginRoot, 'skills', skill.name, 'SKILL.md'));
      }
      expect(injected).toEqual([['agents', 'workingDirectory', 'subprocess', 'webServer']]);
      expect(registrations.find((skill) => skill.name === 'comet-native')?.description).toContain(
        'Comet Native',
      );

      const resources = new Map<string, (request: Request) => Promise<Response>>();
      const handlers = new Map<
        string,
        (request: FakeRequest, response: FakeResponse) => Promise<void> | void
      >();
      expect(whenServices).toBeDefined();
      whenServices!({
        agents: {
          get: (id: string) => (id === 'live-session' ? { id } : undefined),
        },
        workingDirectory: { ensure: async () => temporary },
        subprocess: {
          resolveExecutable: async () => {
            throw new Error('comet is not installed');
          },
        },
        webServer: {
          register: (route: FakeRoute) => {
            if (route.resource !== undefined) resources.set(route.path, route.resource);
            if (route.handler !== undefined) handlers.set(route.path, route.handler);
            return () => {};
          },
        },
        effect: (register: () => () => void) => {
          register();
        },
      });
      expect([...resources.keys(), ...handlers.keys()].sort()).toEqual([
        '/comet-plugin/dashboard',
        '/comet-plugin/status',
      ]);

      const status = await resources.get('/comet-plugin/status')!(
        new Request('http://127.0.0.1:13540/comet-plugin/status'),
      );
      expect(status.status).toBe(200);
      const payload = (await status.json()) as {
        schema: string;
        version: string;
        skills: { name: string; pluginOwned: boolean }[];
      };
      expect(payload.schema).toBe('comet.dsh-plugin.v1');
      expect(payload.version).toBe(packageJson.version);
      expect(payload.skills).toHaveLength(skillNames.length);
      expect(payload.skills.every((skill) => skill.pluginOwned)).toBe(true);
      const statusPost = await resources.get('/comet-plugin/status')!(
        new Request('http://127.0.0.1:13540/comet-plugin/status', { method: 'POST' }),
      );
      expect(statusPost.status).toBe(405);

      const dashboard = handlers.get('/comet-plugin/dashboard')!;
      const method = await callHandler(dashboard, createFakeRequest({ method: 'GET' }));
      expect(method.status).toBe(405);
      expect(method.headers.allow).toBe('POST');
      const wrongType = await callHandler(
        dashboard,
        createFakeRequest({ headers: { 'content-type': 'text/plain' }, body: '{}' }),
      );
      expect(wrongType.status).toBe(415);
      const invalidJson = await callHandler(dashboard, createFakeRequest({ body: '{' }));
      expect(invalidJson.status).toBe(400);
      expect(JSON.parse(invalidJson.body)).toEqual({ error: 'invalid-json' });
      const missingSession = await callHandler(dashboard, createFakeRequest({ body: '{}' }));
      expect(JSON.parse(missingSession.body)).toEqual({ error: 'session-required' });
      const unknownSession = await callHandler(
        dashboard,
        createFakeRequest({ body: JSON.stringify({ sessionId: 'missing-session' }) }),
      );
      expect(unknownSession.status).toBe(404);
      const unavailable = await callHandler(
        dashboard,
        createFakeRequest({ body: JSON.stringify({ sessionId: 'live-session' }) }),
      );
      expect(unavailable.status).toBe(503);
      expect(JSON.parse(unavailable.body)).toMatchObject({ error: 'cli-unavailable' });

      expect(effects).toHaveLength(2);
      effects[0]();
      expect(registrations).toHaveLength(0);

      const client = await readFile(path.join(pluginRoot, 'client.js'), 'utf8');
      expect(client).toContain("id: 'comet-dsh-plugin'");
      expect(client).toContain("name: 'sidebar.panellist'");
      expect(client).toContain("name: 'main'");
      expect(client).toContain("key: 'comet'");
      expect(client).toContain("openTab('browser'");
      expect(client).toContain("h('iframe'");
      expect(client).toContain('data:image/png;base64,');
      expect(client).not.toContain('__COMET_CLIENT_ICON__');
      expect(client).not.toContain('sidebar.workspaces.session.row.action');
      expect(client).not.toContain('@deepseek-ai/dsh-client-');
      const clientIcon = await readFile(path.join(repositoryRoot, 'plugin/dsh/icon-client-64.png'));
      expect(clientIcon.byteLength).toBeGreaterThan(1_000);

      const inventory = spawnSync('tar', ['-tzf', built.archive], {
        encoding: 'utf8',
        windowsHide: true,
      });
      expect(inventory.status).toBe(0);
      expect(inventory.stdout).toContain('skills/comet/SKILL.md');
      expect(inventory.stdout).toContain('client.js');
      expect(inventory.stdout).toContain('locale/zh.json');
      expect(inventory.stdout).not.toMatch(/node_modules|\.env/u);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }, 30_000);

  it.runIf(process.platform === 'win32')(
    'passes literal percent and bang paths through Windows npm shims',
    async () => {
      const temporary = await mkdtemp(path.join(os.tmpdir(), 'comet dsh literal '));
      try {
        const { dashboardCommand } = (await import(
          pathToFileURL(path.join(repositoryRoot, 'plugin/dsh/index.js')).href
        )) as HostModule;
        const entry = path.join(temporary, 'args.mjs');
        await writeFile(entry, 'console.log(JSON.stringify(process.argv.slice(2)));');
        const shim = path.join(temporary, 'comet.cmd');
        await writeFile(shim, `@echo off\r\n"${process.execPath}" "${entry}" %*\r\n`);
        const cwd = path.join(temporary, '%COMET_DSH_LITERAL% & !COMET_DSH_LITERAL!');
        const spec = dashboardCommand({ command: shim, argsPrefix: [] }, cwd);
        const result = spawnSync(spec.command, spec.args, {
          env: { ...process.env, COMET_DSH_LITERAL: 'must-not-expand', ...spec.env },
          encoding: 'utf8',
          windowsHide: true,
          windowsVerbatimArguments: spec.verbatim,
        });
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual(['dashboard', cwd, '--no-open']);
        for (const invalid of ['bad"path', 'bad\npath', 'bad\rpath', 'bad\0path']) {
          expect(() => dashboardCommand({ command: shim, argsPrefix: [] }, invalid)).toThrow();
        }
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    },
  );

  it('launches, rewrites, reuses and stops the dashboard process', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'comet dsh launcher '));
    try {
      const source = await readFile(path.join(repositoryRoot, 'plugin/dsh/index.js'), 'utf8');
      expect(source).toContain('taskkill');
      const { dashboardCommand, createDashboardLauncher, resolveCometCli, createCometShim } =
        (await import(
          pathToFileURL(path.join(repositoryRoot, 'plugin/dsh/index.js')).href
        )) as unknown as HostModule;
      expect(
        dashboardCommand(
          { command: '/usr/local/bin/comet', argsPrefix: [] },
          '/work/project',
          'linux',
        ),
      ).toEqual({
        command: '/usr/local/bin/comet',
        args: ['dashboard', '/work/project', '--no-open'],
        verbatim: false,
        env: {},
      });
      expect(
        dashboardCommand(
          { command: 'C:\\npm\\comet.cmd', argsPrefix: [] },
          'C:\\work project',
          'win32',
          'cmd.exe',
        ),
      ).toEqual({
        command: 'cmd.exe',
        args: [
          '/d',
          '/v:off',
          '/s',
          '/c',
          '""%COMET_DSH_CLI%" dashboard "%COMET_DSH_CWD%" --no-open"',
        ],
        verbatim: true,
        env: { COMET_DSH_CLI: 'C:\\npm\\comet.cmd', COMET_DSH_CWD: 'C:\\work project' },
      });
      expect(
        dashboardCommand(
          {
            command: 'C:\\node\\node.exe',
            argsPrefix: ['C:\\cli\\comet.js'],
            env: { ELECTRON_RUN_AS_NODE: '1' },
          },
          'C:\\work',
          'win32',
        ),
      ).toMatchObject({
        command: 'C:\\node\\node.exe',
        args: ['C:\\cli\\comet.js', 'dashboard', 'C:\\work', '--no-open'],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      });

      const bundledCli = await resolveCometCli(
        {
          resolveExecutable: async () => {
            throw new Error('comet is not on PATH');
          },
        },
        { binPath: '/opt/comet/bin/comet.js', version: '0.5.3', packageRoot: '/opt/comet' },
      );
      expect(bundledCli).toMatchObject({
        source: 'bundled',
        version: '0.5.3',
        command: process.execPath,
        argsPrefix: ['/opt/comet/bin/comet.js'],
      });
      const pathCli = await resolveCometCli(
        { resolveExecutable: async () => '/usr/bin/comet' },
        undefined,
      );
      expect(pathCli).toMatchObject({
        source: 'path',
        command: '/usr/bin/comet',
        argsPrefix: [],
      });

      const shim = createCometShim({
        command: process.execPath,
        argsPrefix: ['/opt/comet/bin/comet.js'],
      });
      expect(existsSync(shim.file)).toBe(true);
      const shimText = await readFile(shim.file, 'utf8');
      expect(shimText).toContain(process.execPath);
      expect(shimText).toContain('/opt/comet/bin/comet.js');
      shim.dispose();
      expect(existsSync(shim.file)).toBe(false);

      const cli = { command: '/usr/local/bin/comet', argsPrefix: [], env: {} };

      const spawned: {
        command: string;
        args: string[];
        options: Record<string, unknown>;
        child: ReturnType<typeof createFakeChild>;
      }[] = [];
      const stopped: unknown[] = [];
      const proxies: { origin: string; closed: boolean; close: () => Promise<void> }[] = [];
      const makeProxy = async () => {
        const proxy = {
          origin: `http://127.0.0.1:${9200 + proxies.length}`,
          closed: false,
          close: async () => {
            proxy.closed = true;
          },
        };
        proxies.push(proxy);
        return proxy;
      };
      const launcher = createDashboardLauncher({
        platform: 'linux',
        timeoutMs: 5_000,
        probe: async () => true,
        createProxy: makeProxy,
        spawnProcess: (command: string, args: string[], options: Record<string, unknown>) => {
          const child = createFakeChild();
          spawned.push({ command, args, options, child });
          return child;
        },
        stopProcess: (child: unknown) => {
          stopped.push(child);
        },
      });
      const first = launcher.open(cli, '/work/project');
      await new Promise((resolve) => setTimeout(resolve, 0));
      spawned[0].child.stdout.emit('data', 'Comet Dashboard running at http://localhost:4321\n');
      await expect(first).resolves.toEqual({
        url: 'http://localhost:4321',
        webUrl: 'http://127.0.0.1:9200',
        started: true,
      });
      expect(spawned[0].args).toEqual(['dashboard', '/work/project', '--no-open']);

      const reuse = await launcher.open(cli, '/work/project');
      expect(reuse).toEqual({
        url: 'http://localhost:4321',
        webUrl: 'http://127.0.0.1:9200',
        started: false,
      });
      expect(spawned).toHaveLength(1);

      const deadLauncher = createDashboardLauncher({
        platform: 'linux',
        timeoutMs: 5_000,
        probe: async () => false,
        createProxy: makeProxy,
        spawnProcess: (command: string, args: string[], options: Record<string, unknown>) => {
          const child = createFakeChild();
          spawned.push({ command, args, options, child });
          return child;
        },
        stopProcess: (child: unknown) => {
          stopped.push(child);
        },
      });
      const restart = deadLauncher.open(cli, '/work/project');
      await new Promise((resolve) => setTimeout(resolve, 0));
      spawned[1].child.stdout.emit('data', 'Comet Dashboard running at http://localhost:4322\n');
      await expect(restart).resolves.toEqual({
        url: 'http://localhost:4322',
        webUrl: 'http://127.0.0.1:9201',
        started: true,
      });

      const failing = createDashboardLauncher({
        platform: 'linux',
        timeoutMs: 5_000,
        createProxy: makeProxy,
        spawnProcess: () => {
          const child = createFakeChild();
          spawned.push({ command: 'comet', args: [], options: {}, child });
          return child;
        },
        stopProcess: (child: unknown) => {
          stopped.push(child);
        },
      });
      const failure = failing.open(cli, '/work/other');
      await new Promise((resolve) => setTimeout(resolve, 0));
      spawned[2].child.stderr.emit('data', 'port unavailable');
      spawned[2].child.emit('exit', 1);
      await expect(failure).rejects.toThrow('exited with code 1: port unavailable');
      expect(stopped).toContain(spawned[2].child);

      const timeoutLauncher = createDashboardLauncher({
        platform: 'linux',
        timeoutMs: 10,
        createProxy: makeProxy,
        spawnProcess: () => createFakeChild(),
        stopProcess: (child: unknown) => {
          stopped.push(child);
        },
      });
      await expect(timeoutLauncher.open(cli, '/work/slow')).rejects.toThrow('did not report a URL');

      launcher.dispose();
      expect(stopped).toContain(spawned[0].child);
      expect(proxies[0].closed).toBe(true);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('proxies the dashboard with its own authority and without browser origin markers', async () => {
    const upstream = http.createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            host: request.headers.host ?? null,
            origin: request.headers.origin ?? null,
            site: request.headers['sec-fetch-site'] ?? null,
            method: request.method,
            url: request.url,
            body,
          }),
        );
      });
    });
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const { startDashboardProxy } = (await import(
      pathToFileURL(path.join(repositoryRoot, 'plugin/dsh/index.js')).href
    )) as unknown as HostModule;
    const proxy = await startDashboardProxy(`http://127.0.0.1:${port}/`);
    try {
      const response = await fetch(`${proxy.origin}/api/dashboard/projects?x=1`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://127.0.0.1:13540',
          'sec-fetch-site': 'cross-site',
        },
        body: '{"value":1}',
      });
      expect(response.status).toBe(200);
      const seen = (await response.json()) as Record<string, unknown>;
      expect(seen.host).toBe(`127.0.0.1:${port}`);
      expect(seen.origin).toBeNull();
      expect(seen.site).toBeNull();
      expect(seen.method).toBe('POST');
      expect(seen.url).toBe('/api/dashboard/projects?x=1');
      expect(seen.body).toBe('{"value":1}');
    } finally {
      if (typeof upstream.closeAllConnections === 'function') upstream.closeAllConnections();
      await new Promise((resolve) => upstream.close(resolve));
      const failed = await fetch(`${proxy.origin}/after-close`);
      expect(failed.status).toBe(502);
      await proxy.close();
    }
  });

  it('refuses an existing output directory so unrelated files cannot be packaged or overwritten', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'comet dsh plugin existing '));
    try {
      await mkdir(path.join(temporary, 'comet-dsh-plugin'));
      const sentinel = path.join(temporary, 'comet-dsh-plugin/private.txt');
      await writeFile(sentinel, 'keep');
      const result = spawnSync(process.execPath, [builder, '--output-root', temporary], {
        encoding: 'utf8',
        windowsHide: true,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('already exists');
      expect(await readFile(sentinel, 'utf8')).toBe('keep');
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
