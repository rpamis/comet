import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { preparePluginIntegration } from '../../../domains/skill/plugin-integration.js';

let root: string;
let plugin: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet plugin integration '));
  plugin = path.join(root, 'cache', 'comet-market', 'comet', '0.5.3');
  await fs.mkdir(path.join(plugin, 'skills/comet/scripts'), { recursive: true });
  await fs.mkdir(path.join(plugin, 'rules'));
  await fs.writeFile(path.join(plugin, 'skills/comet/scripts/comet-plugin-hook.mjs'), '// fixture');
  await fs.writeFile(path.join(plugin, 'rules/comet-workflow-guard.md'), '# Comet Guard');
  await fs.writeFile(path.join(plugin, 'plugin.json'), '{"name":"comet","version":"0.5.3"}');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it('prepares one user-level Codex router without initializing projects or trusting hooks', async () => {
  const codexHome = path.join(root, 'codex');
  await fs.mkdir(codexHome);
  await fs.writeFile(
    path.join(codexHome, 'hooks.json'),
    JSON.stringify({
      custom: true,
      hooks: {
        PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'user-check' }] }],
      },
    }),
  );
  const options = {
    platform: 'codex' as const,
    pluginRoot: plugin,
    homeDir: root,
    env: { CODEX_HOME: codexHome },
  };
  const [result] = await Promise.all(
    Array.from({ length: 3 }, () => preparePluginIntegration(options)),
  );
  const before = await fs.readFile(result.hookConfigPath, 'utf8');
  await preparePluginIntegration(options);
  expect(await fs.readFile(result.hookConfigPath, 'utf8')).toBe(before);
  const config = JSON.parse(before);
  expect(config.custom).toBe(true);
  expect(config.hooks.PreToolUse).toHaveLength(2);
  expect(config.hooks.PreToolUse[0].hooks[0].command).toBe('user-check');
  expect(config.hooks.PreToolUse[1].matcher).toBe('');
  expect(config.hooks.SessionStart[0].matcher).toBe('');
  expect(config.hooks.SessionStart).toHaveLength(1);
  expect(result.requiresHookTrust).toBe(true);
  expect(before).not.toContain('--project-root');
  expect(await fs.readdir(codexHome)).toEqual(expect.arrayContaining(['hooks.json']));
  await expect(fs.access(path.join(root, '.comet/config.yaml'))).rejects.toThrow();
  await expect(fs.access(path.join(codexHome, 'config.toml'))).rejects.toThrow();
});

it('gives DSH a private bridge config and does not rewrite profiles or copy skills', async () => {
  const dshHome = path.join(root, 'dsh');
  const result = await preparePluginIntegration({
    platform: 'dsh',
    pluginRoot: plugin,
    homeDir: root,
    env: { DSH_HOME: dshHome },
  });
  const hooks = JSON.parse(await fs.readFile(result.hookConfigPath, 'utf8')).hooks;
  expect(hooks.PreToolUse).toHaveLength(1);
  expect(hooks.PreToolUse[0].matcher).toBe('write|edit');
  expect(hooks.SessionStart).toHaveLength(1);
  await expect(fs.access(path.join(dshHome, 'profiles'))).rejects.toThrow();
  await expect(fs.access(path.join(dshHome, 'skills'))).rejects.toThrow();
});

it('preserves malformed user config and rejects linked integration targets', async () => {
  const codexHome = path.join(root, 'codex');
  await fs.mkdir(codexHome);
  await fs.writeFile(path.join(codexHome, 'hooks.json'), '{broken');
  await expect(
    preparePluginIntegration({
      platform: 'codex',
      pluginRoot: plugin,
      homeDir: root,
      env: { CODEX_HOME: codexHome },
    }),
  ).rejects.toThrow();
  expect(await fs.readFile(path.join(codexHome, 'hooks.json'), 'utf8')).toBe('{broken');
  await fs.writeFile(path.join(codexHome, 'hooks.json'), '{}');
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.rm(path.join(codexHome, 'comet-plugin'), { recursive: true, force: true });
  await fs.symlink(
    outside,
    path.join(codexHome, 'comet-plugin'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await expect(
    preparePluginIntegration({
      platform: 'codex',
      pluginRoot: plugin,
      homeDir: root,
      env: { CODEX_HOME: codexHome },
    }),
  ).rejects.toThrow();
  expect(await fs.readdir(outside)).toEqual([]);
});
