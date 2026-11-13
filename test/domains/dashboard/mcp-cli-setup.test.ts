import { resolveNpmCommand } from '../../../platform/process/node-cli-command.js';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { parse as parseToml } from 'smol-toml';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

it('automatically installs the CLI on MCP activation before any setup tool call', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-mcp-cli-'));
  const plugin = path.join(root, 'plugin');
  const client = new Client({ name: 'comet-cli-activation-test', version: '1.0.0' });
  try {
    await fs.mkdir(path.join(plugin, 'server'), { recursive: true });
    await fs.mkdir(path.join(plugin, 'assets'));
    await fs.mkdir(path.join(plugin, 'rules'));
    await fs.mkdir(path.join(plugin, 'skills/comet/scripts'), { recursive: true });
    await fs.writeFile(path.join(plugin, 'rules/comet-workflow-guard.md'), '# Comet Guard');
    const legacyDefinition = '# Comet stock definition\n';
    const legacySkill = path.join(root, '.agents/skills/comet/SKILL.md');
    await fs.mkdir(path.dirname(legacySkill), { recursive: true });
    await fs.writeFile(legacySkill, legacyDefinition);
    await fs.writeFile(
      path.join(plugin, 'rules/migration-assets.json'),
      JSON.stringify({
        schema: 'comet.plugin-migration-assets.v1',
        skills: { comet: [createHash('sha256').update(legacyDefinition).digest('hex')] },
        rules: [],
      }),
    );
    await fs.writeFile(
      path.join(plugin, 'skills/comet/scripts/comet-plugin-hook.mjs'),
      '// test fixture launcher',
    );
    await fs.copyFile('plugin/codex/icon.png', path.join(plugin, 'assets/icon.png'));
    await fs.writeFile(path.join(plugin, 'plugin.json'), JSON.stringify({ version: '0.5.3' }));
    await fs.writeFile(
      path.join(plugin, 'server/dashboard-app.html'),
      '<title>Dashboard fixture</title>',
    );
    const fixture = path.join(root, 'source/package');
    await fs.mkdir(path.join(fixture, 'bin'), { recursive: true });
    await fs.writeFile(
      path.join(fixture, 'package.json'),
      JSON.stringify({ name: '@rpamis/comet', version: '0.5.3', bin: { comet: 'bin/comet.js' } }),
    );
    await fs.writeFile(
      path.join(fixture, 'bin/comet.js'),
      "#!/usr/bin/env node\nconsole.log('0.5.3')",
    );
    const archive = path.join(plugin, 'server/comet-cli.tgz');
    execFileSync('tar', ['-czf', archive, '-C', path.join(root, 'source'), 'package'], {
      windowsHide: true,
    });
    await fs.writeFile(
      path.join(plugin, 'server/cli-package.json'),
      JSON.stringify({
        name: '@rpamis/comet',
        version: '0.5.3',
        sha256: createHash('sha256')
          .update(await fs.readFile(archive))
          .digest('hex'),
      }),
    );
    const server = path.join(plugin, 'server/comet-dashboard-mcp.mjs');
    await build({
      entryPoints: ['plugin/codex/mcp-server-entry.ts'],
      outfile: server,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      define: { __COMET_VERSION__: JSON.stringify('0.5.3') },
      banner: {
        js: "import {createRequire as __cometCreateRequire} from 'node:module'; const require = __cometCreateRequire(import.meta.url);",
      },
    });
    const prefix = path.join(root, 'prefix');
    const installed = path.join(
      prefix,
      process.platform === 'win32' ? 'node_modules' : 'lib/node_modules',
      '@rpamis/comet/package.json',
    );
    await expect(fs.access(installed)).rejects.toThrow();
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      CODEX_HOME: path.join(root, 'codex'),
      npm_config_prefix: prefix,
      COMET_PLUGIN_SKIP_CLI_INSTALL: '0',
      COMET_DAEMON: 'off',
    };
    // Windows child creation treats environment keys case-insensitively; make the explicit Temp npm configuration authoritative before spawning MCP.
    const overrides: NodeJS.ProcessEnv = {
      HOME: root,
      USERPROFILE: root,
      APPDATA: path.join(root, 'AppData/Roaming'),
      LOCALAPPDATA: path.join(root, 'AppData/Local'),
      CODEX_HOME: path.join(root, 'codex'),
      COMET_DATA_DIR: path.join(root, 'comet-data'),
      npm_config_prefix: prefix,
      npm_config_userconfig: path.join(root, 'npm-user.npmrc'),
      npm_config_globalconfig: path.join(root, 'npm-global.npmrc'),
      npm_config_cache: path.join(root, 'npm-cache'),
    };
    for (const [key, value] of Object.entries(overrides)) {
      if (process.platform === 'win32')
        for (const existing of Object.keys(childEnv))
          if (existing.toLowerCase() === key.toLowerCase()) delete childEnv[existing];
      childEnv[key] = value;
    }
    await fs.writeFile(childEnv.npm_config_userconfig!, '');
    await fs.writeFile(childEnv.npm_config_globalconfig!, '');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [server],
      cwd: root,
      env: childEnv,
      stderr: 'pipe',
    });
    const npmLaunch = resolveNpmCommand(['root', '--global'], { cwd: root, env: childEnv });
    const npmProbe = execFileSync(npmLaunch.command, npmLaunch.args, {
      env: npmLaunch.env ?? childEnv,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    expect(path.resolve(npmProbe)).toBe(
      path.join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules'),
    );
    let stderr = '';
    transport.stderr?.on('data', (data) => {
      stderr += data;
    });
    await client.connect(transport).catch((error) => {
      throw new Error(stderr || String(error));
    });
    await vi.waitFor(() => fs.access(installed), { timeout: 15000, interval: 100 });
    const result = await client.callTool({ name: 'setup_comet_cli', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain('Comet CLI 0.5.3');
    expect(JSON.parse(await fs.readFile(installed, 'utf8')).version).toBe('0.5.3');
    const integration = JSON.parse(await fs.readFile(path.join(root, 'codex/hooks.json'), 'utf8'));
    expect(integration.hooks.PreToolUse).toHaveLength(1);
    expect(integration.hooks.SessionStart).toHaveLength(1);
    const config = parseToml(await fs.readFile(path.join(root, 'codex/config.toml'), 'utf8'));
    expect(config.skills).toEqual({ config: [{ path: legacySkill, enabled: false }] });
    expect(await fs.readFile(legacySkill, 'utf8')).toBe(legacyDefinition);
    await expect(fs.access(path.join(root, '.comet/config.yaml'))).rejects.toThrow();
  } finally {
    await client.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
