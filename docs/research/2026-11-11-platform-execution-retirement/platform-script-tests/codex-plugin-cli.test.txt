import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ensureCodexPluginCli } from '../../platform/install/codex-plugin-cli.js';

let root: string;
let pluginRoot: string;
let env: NodeJS.ProcessEnv;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet npm 中文 '));
  pluginRoot = path.join(root, 'plugin');
  env = {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    npm_config_prefix: path.join(root, 'prefix'),
    COMET_INSTALL_COUNT: path.join(root, 'installs.txt'),
  };
  vi.spyOn(os, 'homedir').mockReturnValue(root);
  const source = path.join(root, 'source/package');
  await fs.mkdir(path.join(source, 'bin'), { recursive: true });
  await fs.writeFile(
    path.join(source, 'package.json'),
    JSON.stringify({
      name: '@rpamis/comet',
      version: '0.5.3',
      bin: { comet: 'bin/comet.js' },
      scripts: { postinstall: 'node install.cjs' },
    }),
  );
  await fs.writeFile(
    path.join(source, 'bin/comet.js'),
    "#!/usr/bin/env node\nconsole.log('0.5.3')\n",
  );
  await fs.writeFile(
    path.join(source, 'install.cjs'),
    "require('node:fs').appendFileSync(process.env.COMET_INSTALL_COUNT, 'installed\\n')",
  );
  await fs.mkdir(path.join(pluginRoot, 'server'), { recursive: true });
  await fs.writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify({ version: '0.5.3' }));
  const archive = path.join(pluginRoot, 'server/comet-cli.tgz');
  execFileSync('tar', ['-czf', archive, '-C', path.join(root, 'source'), 'package'], {
    windowsHide: true,
  });
  await fs.writeFile(
    path.join(pluginRoot, 'server/cli-package.json'),
    JSON.stringify({
      name: '@rpamis/comet',
      version: '0.5.3',
      sha256: createHash('sha256')
        .update(await fs.readFile(archive))
        .digest('hex'),
    }),
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

it('installs the bundled npm CLI once across concurrent starts and reuses its verified version', async () => {
  const results = await Promise.all([
    ensureCodexPluginCli({ pluginRoot, env }),
    ensureCodexPluginCli({ pluginRoot, env }),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual(['installed', 'ready']);
  expect(await fs.readFile(env.COMET_INSTALL_COUNT!, 'utf8')).toBe('installed\n');
  expect((await ensureCodexPluginCli({ pluginRoot, env })).status).toBe('ready');
});

it('rejects a mismatched archive before npm installation and leaves existing files intact', async () => {
  await fs.appendFile(path.join(pluginRoot, 'server/comet-cli.tgz'), 'changed');
  const sentinel = path.join(root, 'keep.txt');
  await fs.writeFile(sentinel, 'keep');
  await expect(ensureCodexPluginCli({ pluginRoot, env })).rejects.toThrow('摘要不匹配');
  expect(await fs.readFile(sentinel, 'utf8')).toBe('keep');
  await expect(fs.access(env.COMET_INSTALL_COUNT!)).rejects.toThrow();
});

it('keeps a healthy newer global CLI instead of downgrading it to the plugin version', async () => {
  const globalRoot =
    process.platform === 'win32'
      ? path.join(env.npm_config_prefix!, 'node_modules')
      : path.join(env.npm_config_prefix!, 'lib/node_modules');
  const installed = path.join(globalRoot, '@rpamis/comet');
  await fs.mkdir(path.join(installed, 'bin'), { recursive: true });
  await fs.writeFile(
    path.join(installed, 'package.json'),
    JSON.stringify({ name: '@rpamis/comet', version: '9.0.0' }),
  );
  await fs.writeFile(path.join(installed, 'bin/comet.js'), "console.log('9.0.0')");
  expect(await ensureCodexPluginCli({ pluginRoot, env })).toMatchObject({
    status: 'ready',
    version: '9.0.0',
  });
  await expect(fs.access(env.COMET_INSTALL_COUNT!)).rejects.toThrow();
});
