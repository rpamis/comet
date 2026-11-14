#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRepositoryLayout, resolveRepositoryPath } from '../lib/repository-layout.mjs';
import { buildDashboardMcp } from './build-dashboard-mcp.mjs';
import { buildCodexCliPackage } from './build-codex-cli-package.mjs';
import { buildPluginIntegration } from './build-plugin-integration.mjs';

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

export async function buildCodexPlugin({ outputRoot, language = 'zh' } = {}) {
  if (!['zh', 'en'].includes(language)) throw new Error(`Unsupported plugin language: ${language}`);
  const layout = readRepositoryLayout();
  const assets = JSON.parse(await fs.readFile(resolveRepositoryPath(layout.manifestPath), 'utf8'));
  const pkg = JSON.parse(await fs.readFile(resolveRepositoryPath('package.json'), 'utf8'));
  if (assets.version !== pkg.version) {
    throw new Error('Comet package and asset manifest versions must match before packaging');
  }
  const templateRoot = resolveRepositoryPath(layout.codexPlugin.templateRoot);
  const manifest = JSON.parse(await fs.readFile(path.join(templateRoot, 'plugin.json'), 'utf8'));
  manifest.version = pkg.version;
  const root = path.resolve(
    outputRoot ?? resolveRepositoryPath(`dist/codex-plugin/${manifest.version}-${language}`),
  );
  const pluginRoot = path.join(root, manifest.name);
  const marketplacePath = path.join(root, '.agents/plugins/marketplace.json');
  const archive = path.join(root, `comet-codex-${manifest.version}-${language}.tar.gz`);
  for (const target of [pluginRoot, marketplacePath, archive]) {
    try {
      await fs.lstat(target);
      throw new Error(`Plugin output already exists: ${target}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
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
    path.join(pluginRoot, 'plugin.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(pluginRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: '@rpamis/comet-codex-plugin',
        version: manifest.version,
        description: manifest.description,
        license: manifest.license,
        homepage: manifest.homepage,
        repository: { type: 'git', url: manifest.repository },
        publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
        files: ['plugin.json', 'mcp.json', 'skills', 'rules', 'server', 'hooks', 'assets'],
      },
      null,
      2,
    )}\n`,
  );
  await copyFile(path.join(templateRoot, 'README.md'), path.join(pluginRoot, 'README.md'));
  await copyFile(
    path.join(templateRoot, 'hooks/hooks.json'),
    path.join(pluginRoot, 'hooks/hooks.json'),
  );
  await copyFile(
    resolveRepositoryPath(layout.codexPlugin.icon),
    path.join(pluginRoot, 'assets/icon.png'),
  );
  await copyFile(
    resolveRepositoryPath(layout.codexPlugin.icon),
    path.join(pluginRoot, 'assets/comet-logo.png'),
  );
  await copyFile(resolveRepositoryPath('LICENSE'), path.join(pluginRoot, 'LICENSE'));
  await copyFile(path.join(templateRoot, 'mcp.json'), path.join(pluginRoot, 'mcp.json'));
  await buildCodexCliPackage(path.join(pluginRoot, 'server'), pkg.version);
  await buildDashboardMcp({ outputRoot: path.join(pluginRoot, 'server'), version: pkg.version });
  await buildPluginIntegration(pluginRoot, language);

  await fs.mkdir(path.dirname(marketplacePath), { recursive: true });
  await fs.writeFile(
    marketplacePath,
    `${JSON.stringify(
      {
        name: 'comet-market',
        interface: { displayName: 'Comet Market' },
        plugins: [
          {
            name: manifest.name,
            source: { source: 'local', path: `./${manifest.name}` },
            policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
            category: 'Developer Tools',
          },
        ],
      },
      null,
      2,
    )}\n`,
    { flag: 'wx' },
  );
  execFileSync('tar', ['-czf', archive, '-C', pluginRoot, '.'], { windowsHide: true });
  return {
    pluginRoot,
    archive,
    marketplaceRoot: root,
    version: manifest.version,
    cometVersion: pkg.version,
    language,
  };
}

async function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (
      !['--output-root', '--language'].includes(argument) ||
      !args[index + 1] ||
      args[index + 1].startsWith('--')
    ) {
      throw new Error('Usage: build-codex-plugin [--output-root <directory>] [--language zh|en]');
    }
    options[argument === '--output-root' ? 'outputRoot' : 'language'] = args[++index];
  }
  process.stdout.write(`${JSON.stringify(await buildCodexPlugin(options), null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
