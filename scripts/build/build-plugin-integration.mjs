import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveRepositoryPath } from '../lib/repository-layout.mjs';

export async function buildPluginIntegration(pluginRoot, language = 'zh') {
  await fs.mkdir(path.join(pluginRoot, 'rules'), { recursive: true });
  await fs.copyFile(
    resolveRepositoryPath(
      `assets/skills/comet/rules/comet-workflow-guard${language === 'en' ? '.en' : ''}.md`,
    ),
    path.join(pluginRoot, 'rules/comet-workflow-guard.md'),
  );
  const catalog = JSON.parse(
    await fs.readFile(resolveRepositoryPath('config/plugin-migration-assets.json'), 'utf8'),
  );
  const digest = (text) => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');
  const assets = JSON.parse(
    await fs.readFile(resolveRepositoryPath('assets/manifest.json'), 'utf8'),
  );
  const names = [
    ...new Set(
      assets.skills.filter((file) => file.endsWith('/SKILL.md')).map((file) => file.split('/')[0]),
    ),
  ];
  catalog.skills = Object.fromEntries(names.map((name) => [name, catalog.skills[name] ?? []]));
  for (const name of names) {
    for (const root of ['assets/skills', 'assets/skills-zh']) {
      const hash = digest(
        await fs.readFile(resolveRepositoryPath(`${root}/${name}/SKILL.md`), 'utf8'),
      );
      if (!catalog.skills[name].includes(hash)) catalog.skills[name].push(hash);
    }
  }
  for (const file of assets.rules ?? []) {
    const hash = digest(await fs.readFile(resolveRepositoryPath(`assets/skills/${file}`), 'utf8'));
    if (!catalog.rules.includes(hash)) catalog.rules.push(hash);
  }
  await fs.writeFile(
    path.join(pluginRoot, 'rules/migration-assets.json'),
    JSON.stringify(catalog, null, 2) + '\n',
  );
  for (const [entry, outfile] of [
    ['domains/skill/plugin-hook-entry.ts', 'skills/comet/scripts/comet-plugin-hook.mjs'],
    ['domains/skill/plugin-integration.ts', 'server/comet-plugin-setup.mjs'],
  ])
    await build({
      absWorkingDir: resolveRepositoryPath('.'),
      entryPoints: [entry],
      outfile: path.join(pluginRoot, outfile),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      minify: true,
      legalComments: 'none',
      banner: {
        js: "import {createRequire as __cometCreateRequire} from 'node:module'; const require=__cometCreateRequire(import.meta.url);",
      },
    });
}
