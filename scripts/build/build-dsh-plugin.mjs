#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRepositoryLayout, resolveRepositoryPath } from '../lib/repository-layout.mjs';
import { buildPluginIntegration } from './build-plugin-integration.mjs';
import { build as bundle } from 'esbuild';

async function copyFile(source, destination) {
  const stat = await fs.lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Plugin input must be a regular file: ${source}`);
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

function contained(root, relative) {
  const target = path.resolve(root, relative);
  const difference = path.relative(root, target);
  if (difference === '' || difference.startsWith('..') || path.isAbsolute(difference)) {
    throw new Error(`Plugin asset must stay inside its root: ${relative}`);
  }
  return target;
}

async function assertAbsent(target) {
  try {
    await fs.lstat(target);
    throw new Error(`Plugin output already exists: ${target}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function copyLocale(templateRoot, pluginRoot) {
  const localeRoot = path.join(templateRoot, 'locale');
  const entries = await fs.readdir(localeRoot, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  if (files.length === 0) throw new Error(`Plugin template has no locale files: ${localeRoot}`);
  for (const entry of files) {
    const locale = JSON.parse(await fs.readFile(path.join(localeRoot, entry.name), 'utf8'));
    const meta = locale.meta;
    if (typeof meta?.title !== 'string' || meta.title.length === 0) {
      throw new Error(`Plugin locale ${entry.name} needs meta.title`);
    }
    if (typeof meta?.description !== 'string' || meta.description.length === 0) {
      throw new Error(`Plugin locale ${entry.name} needs meta.description`);
    }
    await copyFile(path.join(localeRoot, entry.name), path.join(pluginRoot, 'locale', entry.name));
  }
}

/**
 * Assemble one installable Comet bundle for DeepSeek Harness from product assets.
 *
 * @param {{ outputRoot?: string, language?: 'zh'|'en', cliSpec?: string }} options
 * @returns {Promise<{ pluginRoot: string, archive: string, version: string, language: string, cliSpec: string }>}
 */
export async function buildDshPlugin({ outputRoot, language = 'zh', cliSpec } = {}) {
  if (!['zh', 'en'].includes(language)) throw new Error(`Unsupported plugin language: ${language}`);
  const layout = readRepositoryLayout();
  const assets = JSON.parse(await fs.readFile(resolveRepositoryPath(layout.manifestPath), 'utf8'));
  const pkg = JSON.parse(await fs.readFile(resolveRepositoryPath('package.json'), 'utf8'));
  if (assets.version !== pkg.version) {
    throw new Error('Comet package and asset manifest versions must match before packaging');
  }
  const templateRoot = resolveRepositoryPath(layout.dshPlugin.templateRoot);
  const manifest = JSON.parse(await fs.readFile(path.join(templateRoot, 'package.json'), 'utf8'));
  const patch = await fs.readFile(path.join(templateRoot, 'cordis.patch.yml'), 'utf8');
  if (!patch.includes(`name: '${manifest.name}'`)) {
    throw new Error(`Plugin patch must insert the template package ${manifest.name}`);
  }
  if (manifest.dependencies?.['@rpamis/comet'] !== '__COMET_CLI_SPEC__') {
    throw new Error('Plugin template must declare the @rpamis/comet CLI dependency placeholder');
  }
  const resolvedCliSpec = cliSpec ?? pkg.version;
  manifest.version = pkg.version;
  delete manifest.private;
  manifest.publishConfig = { access: 'public', registry: 'https://registry.npmjs.org/' };
  manifest.dependencies = { ...manifest.dependencies, '@rpamis/comet': resolvedCliSpec };
  const root = path.resolve(
    outputRoot ?? resolveRepositoryPath(`dist/dsh-plugin/${pkg.version}-${language}`),
  );
  const pluginRoot = path.join(root, manifest.name);
  const archive = path.join(root, `comet-dsh-${pkg.version}-${language}.tar.gz`);
  for (const target of [pluginRoot, archive]) await assertAbsent(target);
  await fs.mkdir(root, { recursive: true });
  try {
    await fs.mkdir(pluginRoot);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Plugin output already exists: ${pluginRoot}`);
    throw error;
  }
  const localizedRoot = resolveRepositoryPath(layout.skillsRoots[language]);
  const fallbackRoot = resolveRepositoryPath(layout.skillsRoots.en);
  for (const relative of [...assets.skills, ...assets.internalSkills]) {
    let source = contained(localizedRoot, relative);
    try {
      await fs.access(source);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      source = contained(fallbackRoot, relative);
    }
    await copyFile(source, contained(path.join(pluginRoot, 'skills'), relative));
  }
  await fs.writeFile(
    path.join(pluginRoot, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  for (const file of ['cordis.patch.yml', 'README.md', 'README.en.md', 'icon.png']) {
    await copyFile(path.join(templateRoot, file), path.join(pluginRoot, file));
  }
  const client = await fs.readFile(path.join(templateRoot, 'client.js'), 'utf8');
  const iconPlaceholder = "'__COMET_CLIENT_ICON__'";
  if (!client.includes(iconPlaceholder)) {
    throw new Error('Plugin client template must keep the __COMET_CLIENT_ICON__ placeholder');
  }
  const icon = await fs.readFile(path.join(templateRoot, 'icon-client-64.png'));
  await fs.writeFile(
    path.join(pluginRoot, 'client.js'),
    client.replace(iconPlaceholder, `'data:image/png;base64,${icon.toString('base64')}'`),
  );
  await copyFile(resolveRepositoryPath('LICENSE'), path.join(pluginRoot, 'LICENSE'));
  await copyLocale(templateRoot, pluginRoot);
  await buildPluginIntegration(pluginRoot, language);
  await bundle({
    absWorkingDir: resolveRepositoryPath('.'),
    entryPoints: [path.join(templateRoot, 'index.js')],
    outfile: path.join(pluginRoot, 'index.js'),
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
  execFileSync('tar', ['-czf', archive, '-C', pluginRoot, '.'], { windowsHide: true });
  return {
    pluginRoot,
    archive,
    version: pkg.version,
    language,
    cliSpec: resolvedCliSpec,
  };
}

async function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (
      !['--output-root', '--language', '--cli-spec'].includes(argument) ||
      !args[index + 1] ||
      args[index + 1].startsWith('--')
    ) {
      throw new Error(
        'Usage: build-dsh-plugin [--output-root <directory>] [--cli-spec <spec>] [--language zh|en]',
      );
    }
    const key =
      argument === '--output-root'
        ? 'outputRoot'
        : argument === '--cli-spec'
          ? 'cliSpec'
          : 'language';
    options[key] = args[++index];
  }
  process.stdout.write(`${JSON.stringify(await buildDshPlugin(options), null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
