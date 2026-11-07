import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { parse } from 'smol-toml';
import { migratePluginInstallation } from '../../../domains/skill/plugin-migration.js';
import { buildNodeHookCommand } from '../../../platform/process/hook-command.js';
import { buildPluginIntegration } from '../../../scripts/build/build-plugin-integration.mjs';

let root: string;
let plugin: string;
let project: string;
const definition = '---\nname: comet\ndescription: Comet workflow\n---\n# Comet\n';
const rule = '# Comet Guard\n';
const hash = (text: string) =>
  createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet migration '));
  plugin = path.join(root, 'plugin');
  project = path.join(root, 'project');
  await fs.mkdir(path.join(plugin, 'rules'), { recursive: true });
  await fs.mkdir(path.join(project, '.git'), { recursive: true });
  await fs.writeFile(
    path.join(plugin, 'rules/migration-assets.json'),
    JSON.stringify({
      schema: 'comet.plugin-migration-assets.v1',
      skills: { comet: [hash(definition)] },
      rules: [hash(rule)],
    }),
  );
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
async function put(file: string, text: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}
function options(platform: 'codex' | 'dsh', hookExecuted = false) {
  return {
    platform,
    pluginRoot: plugin,
    projectPath: project,
    homeDir: root,
    configRoot: path.join(root, platform),
    hookExecuted,
  };
}

it('disables only recognized Codex skill paths and preserves shared files and user settings', async () => {
  const skill = path.join(project, '.agents/skills/comet/SKILL.md');
  await put(skill, definition);
  await put(path.join(root, '.agents/skills/comet/SKILL.md'), definition);
  await put(path.join(project, '.agents/skills/comet-custom/SKILL.md'), '# custom');
  await put(path.join(root, 'codex/config.toml'), '# user settings\nmodel = "test"\n');
  const result = await migratePluginInstallation(options('codex'));
  const configFile = path.join(root, 'codex/config.toml');
  const first = await fs.readFile(configFile, 'utf8');
  expect(first).toContain('# user settings');
  expect(parse(first).skills).toEqual({
    config: expect.arrayContaining([{ path: skill, enabled: false }]),
  });
  expect(await fs.readFile(skill, 'utf8')).toBe(definition);
  expect(result.changed).toHaveLength(2);
  await migratePluginInstallation(options('codex'));
  expect(await fs.readFile(configFile, 'utf8')).toBe(first);
});

it('backs up DSH skill entry points while preserving runtime, data, other platforms and custom skills', async () => {
  const skill = path.join(project, '.dsh/skills/comet/SKILL.md');
  await put(skill, definition);
  await put(path.join(project, '.dsh/skills/comet/scripts/runtime.mjs'), '// keep runtime');
  await put(path.join(project, '.dsh/skills/comet-native/SKILL.md'), '# user variant');
  await put(path.join(project, '.claude/skills/comet/SKILL.md'), definition);
  await put(path.join(project, '.comet/config.yaml'), '# keep config');
  const result = await migratePluginInstallation(options('dsh', true));
  await expect(fs.access(skill)).rejects.toThrow();
  expect(await fs.readFile(result.backups[0], 'utf8')).toBe(definition);
  expect(
    await fs.readFile(path.join(project, '.dsh/skills/comet/scripts/runtime.mjs'), 'utf8'),
  ).toContain('keep');
  expect(await fs.readFile(path.join(project, '.dsh/skills/comet-native/SKILL.md'), 'utf8')).toBe(
    '# user variant',
  );
  expect(await fs.readFile(path.join(project, '.claude/skills/comet/SKILL.md'), 'utf8')).toBe(
    definition,
  );
  expect(await fs.readFile(path.join(project, '.comet/config.yaml'), 'utf8')).toBe('# keep config');
  expect((await migratePluginInstallation(options('dsh', true))).changed).toEqual([]);
});

it('preserves edited Comet definitions, explicit Codex choices and linked platform directories', async () => {
  const skill = path.join(project, '.agents/skills/comet/SKILL.md');
  await put(skill, definition + '# customized');
  const first = await migratePluginInstallation(options('codex'));
  expect(first.preserved.some((entry) => entry.path === skill)).toBe(true);
  await put(skill, definition);
  const configFile = path.join(root, 'codex/config.toml');
  const explicit = `[[skills.config]]\npath = ${JSON.stringify(skill)}\nenabled = true\n`;
  await put(configFile, explicit);
  expect(
    (await migratePluginInstallation(options('codex'))).preserved.some(
      (entry) => entry.path === skill,
    ),
  ).toBe(true);
  expect(await fs.readFile(configFile, 'utf8')).toBe(explicit);
  const outside = path.join(root, 'outside');
  await put(path.join(outside, 'skills/comet/SKILL.md'), definition);
  await fs.symlink(
    outside,
    path.join(project, '.dsh'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  expect((await migratePluginInstallation(options('dsh', true))).changed).toEqual([]);
  expect(await fs.readFile(path.join(outside, 'skills/comet/SKILL.md'), 'utf8')).toBe(definition);
});

it('migrates only owned hook entries and DSH rule blocks after hook execution with backups', async () => {
  const hookFile = path.join(project, '.dsh/hooks.json');
  const original = JSON.stringify({
    custom: true,
    hooks: {
      PreToolUse: [
        {
          matcher: '.*',
          hooks: [
            {
              type: 'command',
              command: buildNodeHookCommand([
                path.join(project, '.dsh/skills/comet/scripts/comet-hook-router.mjs'),
              ]),
            },
            { type: 'command', command: 'user-check' },
          ],
        },
      ],
    },
  });
  await put(hookFile, original);
  const instructions = path.join(project, 'AGENTS.local.md');
  await put(
    instructions,
    `用户前文\n<!-- COMET:DSH:START -->\n${rule.trimEnd()}\n<!-- COMET:DSH:END -->\n用户后文\n`,
  );
  await migratePluginInstallation(options('dsh'));
  expect(await fs.readFile(hookFile, 'utf8')).toBe(original);
  const result = await migratePluginInstallation(options('dsh', true));
  expect(await fs.readFile(hookFile, 'utf8')).not.toContain('comet-hook-router');
  expect(await fs.readFile(hookFile, 'utf8')).toContain('user-check');
  expect(await fs.readFile(instructions, 'utf8')).toBe('用户前文\n\n用户后文\n');
  expect(result.backups).toHaveLength(2);
  expect(
    (await Promise.all(result.backups.map((file) => fs.readFile(file, 'utf8')))).some(
      (text) => text === original,
    ),
  ).toBe(true);
});

it('keeps malformed config intact and never disables a skill if backup publication fails', async () => {
  await put(path.join(project, '.agents/skills/comet/SKILL.md'), definition);
  const configFile = path.join(root, 'codex/config.toml');
  await put(configFile, '[broken');
  const result = await migratePluginInstallation(options('codex'));
  expect(result.changed).toEqual([]);
  expect(result.preserved.length).toBeGreaterThan(0);
  expect(await fs.readFile(configFile, 'utf8')).toBe('[broken');
  await put(configFile, '# user\n');
  await fs.mkdir(path.join(root, 'codex/comet-plugin'), { recursive: true });
  await fs.writeFile(path.join(root, 'codex/comet-plugin/migration-backups'), 'occupied');
  expect((await migratePluginInstallation(options('codex'))).changed).toEqual([]);
  expect(await fs.readFile(configFile, 'utf8')).toBe('# user\n');
});

it('recognizes a released 0.5.2 definition from the packaged migration catalog', async () => {
  await buildPluginIntegration(plugin);
  const old = await fs.readFile(
    path.resolve('test/fixtures/plugin-migration/comet-0.5.2.SKILL.md'),
    'utf8',
  );
  const skill = path.join(project, '.dsh/skills/comet/SKILL.md');
  await put(skill, old);
  const result = await migratePluginInstallation(options('dsh', true));
  expect(result.changed).toContain(skill);
  expect(await fs.readFile(result.backups[0], 'utf8')).toBe(old);
});

it('migrates global DSH entries in a custom config root and serializes concurrent runs', async () => {
  const globalSkill = path.join(root, 'dsh/skills/comet/SKILL.md');
  await put(globalSkill, definition);
  const results = await Promise.all(
    Array.from({ length: 3 }, () => migratePluginInstallation(options('dsh', true))),
  );
  expect(results.flatMap((result) => result.changed)).toEqual([globalSkill]);
  expect(results.flatMap((result) => result.backups)).toHaveLength(1);
});

it('recognizes released 0.4.3 Classic definitions without treating customized copies as stock', async () => {
  await buildPluginIntegration(plugin);
  const old = await fs.readFile(
    path.resolve('test/fixtures/plugin-migration/comet-classic-0.4.3.SKILL.md'),
    'utf8',
  );
  const globalSkill = path.join(root, '.agents/skills/comet-classic/SKILL.md');
  const customized = path.join(project, '.agents/skills/comet-classic/SKILL.md');
  await put(globalSkill, old);
  await put(customized, old + '\n用户自定义内容\n');
  const result = await migratePluginInstallation(options('codex'));
  expect(result.changed).toContain(globalSkill);
  expect(result.changed).not.toContain(customized);
  expect(result.preserved.some((entry) => entry.path === customized)).toBe(true);
  expect(await fs.readFile(globalSkill, 'utf8')).toBe(old);
  expect(await fs.readFile(customized, 'utf8')).toContain('用户自定义内容');
});
