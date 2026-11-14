import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { renderDashboardMcpHtml } from '../../scripts/build/build-dashboard-mcp.mjs';
import { resolveNpmCommand } from '../../platform/process/node-cli-command.js';

const repositoryRoot = path.resolve('.');
const builder = path.join(repositoryRoot, 'scripts/build/build-codex-plugin.mjs');
const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));

describe('Codex plugin package', () => {
  it('preserves JavaScript replacement characters and escapes closing script tags in the MCP resource', () => {
    const result = renderDashboardMcpHtml(
      '<!-- COMET_MCP_SCRIPT -->',
      'console.log("$& $$ </script>");',
    );
    expect(result).toContain('$& $$ <\\/script>');
    expect(result).not.toContain('COMET_MCP_SCRIPT');
    expect(result.match(/<\/script>/gu)).toHaveLength(1);
  });
  it('builds a relocatable archive from product assets when invoked outside the repository', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'comet codex plugin '));
    try {
      const outputRoot = path.join(temporary, 'output');
      const result = spawnSync(process.execPath, [builder, '--output-root', outputRoot], {
        cwd: temporary,
        encoding: 'utf8',
        windowsHide: true,
      });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      const built = JSON.parse(result.stdout);
      const manifest = await readJson(path.join(built.pluginRoot, 'plugin.json'));
      const packageJson = await readJson(path.join(repositoryRoot, 'package.json'));
      expect(manifest.name).toBe('comet');
      const template = await readJson(path.join(repositoryRoot, 'plugin/codex/plugin.json'));
      expect(manifest.version).toBe(template.version);
      expect(manifest.version).toBe(packageJson.version);
      const npmManifest = await readJson(path.join(built.pluginRoot, 'package.json'));
      expect(npmManifest).toMatchObject({
        name: '@rpamis/comet-codex-plugin',
        version: manifest.version,
        publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
      });
      expect(npmManifest.private).not.toBe(true);
      expect(npmManifest.scripts).toBeUndefined();
      const npm = resolveNpmCommand(['pack', '--json', '--ignore-scripts'], {
        cwd: built.pluginRoot,
      });
      const packed = spawnSync(npm.command, npm.args, {
        cwd: built.pluginRoot,
        env: npm.env ?? process.env,
        encoding: 'utf8',
        windowsHide: true,
      });
      expect(packed.status, packed.stderr).toBe(0);
      const npmPackage = JSON.parse(packed.stdout)[0];
      expect(npmPackage.name).toBe('@rpamis/comet-codex-plugin');
      const npmFiles = npmPackage.files.map((file: { path: string }) => file.path);
      for (const file of [
        'plugin.json',
        'mcp.json',
        'server/comet-dashboard-mcp.mjs',
        'server/comet-cli.tgz',
        'skills/comet-native/SKILL.md',
        'hooks/hooks.json',
      ])
        expect(npmFiles).toContain(file);
      expect(npmFiles.some((file: string) => /node_modules|marketplace|\.env/u.test(file))).toBe(
        false,
      );
      expect(built.cometVersion).toBe(packageJson.version);
      expect(manifest.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
      expect(manifest.extensions['com.openai'].requires_local_executor).toBe(true);
      const mcp = await readJson(path.join(built.pluginRoot, 'mcp.json'));
      expect(mcp.mcpServers['comet-dashboard'].type).toBe('stdio');
      expect(
        manifest.extensions['com.openai'].interface.shortDescription.length,
      ).toBeLessThanOrEqual(30);
      const presentation = manifest.extensions['com.openai'].interface;
      expect(presentation.websiteURL).toBe('https://github.com/rpamis/comet');
      expect(presentation.longDescription).toMatch(
        /^Comet 是一个面向 Agent 的可恢复长程任务工作流与 Skill 平台/u,
      );
      for (const feature of [
        'Native',
        'Classic',
        'Comet Any',
        '个人记忆与项目知识',
        'Comet Eval',
        'Dashboard',
      ])
        expect(presentation.longDescription).toContain(feature);
      const sourceLogo = await readFile(path.join(repositoryRoot, 'plugin/codex/icon.png'));
      for (const key of ['logo', 'composerIcon']) {
        expect(presentation[key]).toBe('./assets/comet-logo.png');
        expect(await readFile(path.join(built.pluginRoot, presentation[key]))).toEqual(sourceLogo);
      }

      const inventory = spawnSync('tar', ['-tzf', built.archive], {
        encoding: 'utf8',
        windowsHide: true,
      });
      expect(inventory.status).toBe(0);
      expect(inventory.stdout).toContain('plugin.json');
      expect(inventory.stdout).not.toMatch(/marketplace|node_modules|\.env/u);
      const extracted = path.join(temporary, 'relocated package');
      await mkdir(extracted);
      const unpack = spawnSync('tar', ['-xzf', built.archive, '-C', extracted], {
        encoding: 'utf8',
        windowsHide: true,
      });
      expect(unpack.status).toBe(0);
      const npmExtracted = path.join(temporary, 'npm package');
      await mkdir(npmExtracted);
      const npmUnpack = spawnSync(
        'tar',
        [
          '-xzf',
          path.join(built.pluginRoot, npmPackage.filename),
          '--strip-components=1',
          '-C',
          npmExtracted,
        ],
        { encoding: 'utf8', windowsHide: true },
      );
      expect(npmUnpack.status, npmUnpack.stderr).toBe(0);
      for (const file of npmFiles) {
        const npmBytes = await readFile(path.join(npmExtracted, file));
        const archiveBytes = await readFile(path.join(extracted, file));
        expect(npmBytes.equals(archiveBytes), file).toBe(true);
      }
      const migrationAssets = await readJson(path.join(extracted, 'rules/migration-assets.json'));
      expect(migrationAssets.versions).toContain('0.5.2');
      expect(Object.keys(migrationAssets.skills)).toHaveLength(13);
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(extracted, 'server/comet-dashboard-mcp.mjs')],
        cwd: temporary,
        env: {
          HOME: temporary,
          USERPROFILE: temporary,
          COMET_PLUGIN_SKIP_CLI_INSTALL: '1',
          PATH: process.env.PATH ?? '',
          SYSTEMROOT: process.env.SYSTEMROOT ?? '',
        },
        stderr: 'pipe',
      });
      const client = new Client({ name: 'packaged-dashboard-test', version: '1.0.0' });
      try {
        await client.connect(transport);
        const logo = await readFile(
          path.join(repositoryRoot, 'domains/dashboard/web/public/favicon.png'),
        );
        expect(client.getServerVersion()?.icons?.[0].src).toBe(
          `data:image/png;base64,${logo.toString('base64')}`,
        );
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual([
          'dashboard_read',
          'dashboard_write',
          'open_dashboard',
          'setup_comet_cli',
          'show_dashboard',
        ]);
        const resource = await client.readResource({ uri: 'ui://comet/dashboard-native' });
        const content = resource.contents[0];
        expect(content.mimeType).toBe('text/html;profile=mcp-app');
        if (!('text' in content)) throw new Error('Comet Dashboard 必须返回文本资源');
        expect(content.text).toContain('Comet Dashboard');
        const markup = content.text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '');
        expect(/<iframe\b/iu.test(markup)).toBe(false);
        expect(Buffer.byteLength(JSON.stringify(resource))).toBeLessThan(10 * 1024 * 1024);
        expect(content._meta?.ui).toEqual({
          csp: { frameDomains: [], connectDomains: [], resourceDomains: ['data:', 'blob:'] },
        });
        const opened = await client.callTool({ name: 'open_dashboard', arguments: {} });
        expect(opened.isError).not.toBe(true);
        const response = await fetch(String(opened._meta?.dashboardUrl), {
          headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'iframe' },
        });
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('Comet Dashboard');
      } finally {
        await client.close();
      }
      const assets = await readJson(path.join(repositoryRoot, 'assets/manifest.json'));
      for (const relative of assets.skills.filter((file: string) => file.endsWith('/SKILL.md'))) {
        const contents = await readFile(path.join(extracted, 'skills', relative), 'utf8');
        const header = parse(/^---\r?\n([\s\S]*?)\r?\n---/u.exec(contents)![1]);
        expect(header.name).toBe(relative.split('/')[0]);
        expect(header.description).toBeTruthy();
      }
      expect(
        await readFile(path.join(extracted, 'skills/comet-native/SKILL.md'), 'utf8'),
      ).toContain('Comet Native');
      expect(
        await readFile(path.join(extracted, 'skills/comet/runtime/classic/skill.yaml'), 'utf8'),
      ).toBeTruthy();

      const hooks = await readJson(path.join(extracted, 'hooks/hooks.json'));
      expect(hooks.hooks.SessionStart[0].hooks[0].command).toContain(
        '${PLUGIN_ROOT}/server/comet-cli-setup.mjs',
      );
      const cliMetadata = await readJson(path.join(extracted, 'server/cli-package.json'));
      expect(cliMetadata).toMatchObject({ name: '@rpamis/comet', version: manifest.version });
      const cliManifest = spawnSync(
        'tar',
        ['-xOf', path.join(extracted, 'server/comet-cli.tgz'), 'package/package.json'],
        { encoding: 'utf8', windowsHide: true },
      );
      expect(cliManifest.status).toBe(0);
      expect(JSON.parse(cliManifest.stdout)).toMatchObject({
        name: '@rpamis/comet',
        version: manifest.version,
      });
      const hook = hooks.hooks.PreToolUse[0];
      expect(new RegExp(hook.matcher).test('apply_patch')).toBe(true);
      expect(new RegExp(hook.matcher).test('exec_command')).toBe(true);
      expect(hook.hooks[0].command).toContain(
        '${PLUGIN_ROOT}/skills/comet/scripts/comet-hook-router.mjs',
      );
      const router = path.join(extracted, 'skills/comet/scripts/comet-hook-router.mjs');
      const environment = { ...process.env, HOME: temporary, USERPROFILE: temporary };
      if (process.platform === 'win32') {
        const windowsHook = spawnSync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', hook.hooks[0].commandWindows],
          {
            cwd: temporary,
            input: JSON.stringify({
              tool_name: 'Read',
              tool_input: { file_path: 'README.md' },
              cwd: temporary,
            }),
            env: { ...environment, PLUGIN_ROOT: extracted },
            encoding: 'utf8',
            windowsHide: true,
          },
        );
        expect(windowsHook.status, windowsHook.stderr).toBe(0);
      }
      const read = spawnSync(process.execPath, [router, '--platform', 'codex'], {
        cwd: temporary,
        input: JSON.stringify({
          tool_name: 'Read',
          tool_input: { file_path: 'README.md' },
          cwd: temporary,
        }),
        env: environment,
        encoding: 'utf8',
        windowsHide: true,
      });
      expect(read.status).toBe(0);
      await mkdir(path.join(temporary, '.git'));
      await mkdir(path.join(temporary, '.comet'));
      await writeFile(
        path.join(temporary, '.comet/config.yaml'),
        'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
      );
      await writeFile(
        path.join(temporary, '.comet/current-change.json'),
        JSON.stringify({
          schema: 'comet.selection.v2',
          workflow: 'classic',
          change: 'selected',
          branch: null,
        }),
      );
      for (const change of ['selected', 'other']) {
        const changeRoot = path.join(temporary, 'openspec/changes', change);
        await mkdir(changeRoot, { recursive: true });
        await writeFile(
          path.join(changeRoot, '.comet.yaml'),
          'workflow: hotfix\nphase: build\ndesign_doc: null\nplan: null\nverification_report: null\nbuild_mode: direct\nisolation: null\nverify_mode: null\nverify_result: pending\nverified_at: null\narchived: false\n',
        );
      }
      const forbidden = spawnSync(process.execPath, [router, '--platform', 'codex'], {
        cwd: temporary,
        input: JSON.stringify({
          tool_name: 'Write',
          tool_input: { file_path: 'openspec/changes/other/tasks.md' },
          cwd: temporary,
        }),
        env: environment,
        encoding: 'utf8',
        windowsHide: true,
      });
      expect(forbidden.status, forbidden.stderr).toBe(2);
      expect(forbidden.stderr).toContain("belongs to Classic change 'other'");
      expect(forbidden.stderr).toContain("current selection is 'selected'");
      const legitimate = spawnSync(process.execPath, [router, '--platform', 'codex'], {
        cwd: temporary,
        input: JSON.stringify({
          tool_name: 'Write',
          tool_input: { file_path: 'src/feature.ts' },
          cwd: temporary,
        }),
        env: environment,
        encoding: 'utf8',
        windowsHide: true,
      });
      expect(legitimate.status, legitimate.stderr).toBe(0);
      const marketplace = await readJson(path.join(outputRoot, '.agents/plugins/marketplace.json'));
      expect(marketplace.name).toBe('comet-market');
      expect(marketplace.interface.displayName).toBe('Comet Market');
      expect(marketplace.plugins[0].source.path).toBe('./comet');
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }, 90_000);

  it('refuses an existing output directory so unrelated files cannot be packaged or overwritten', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'comet-plugin-existing-'));
    try {
      await mkdir(path.join(temporary, 'comet'));
      const sentinel = path.join(temporary, 'comet/private.txt');
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
