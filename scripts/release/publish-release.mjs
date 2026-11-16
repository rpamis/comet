#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'rpamis/comet';
const registry = 'https://registry.npmjs.org/';
const github = `https://api.github.com/repos/${repository}`;

export function composeReleaseNotes(changelog, version, generated) {
  const source = changelog.replaceAll('\r\n', '\n');
  const headings = [...source.matchAll(/^## What's Changed \[([^\]]+)\].*$/gm)];
  const index = headings.findIndex((heading) => heading[1] === version);
  if (index < 0 || !headings[index + 1]) {
    throw new Error(`Changelog must contain ${version} and its previous release.`);
  }
  const details = source
    .slice(headings[index].index + headings[index][0].length, headings[index + 1].index)
    .trim();
  if (!details) throw new Error(`Changelog ${version} is empty.`);
  const notes = generated.replaceAll('\r\n', '\n').trim();
  const footer = notes.search(/^#{2,3} New Contributors\s*$|^\*\*Full Changelog\*\*:/m);
  const changes = (footer < 0 ? notes : notes.slice(0, footer)).trim();
  const ending =
    footer < 0 ? '' : notes.slice(footer).replace(/^## New Contributors/m, '### New Contributors');
  return {
    previousTag: headings[index + 1][1],
    body: [changes, details, ending].filter(Boolean).join('\n\n') + '\n',
  };
}

export function assertReleaseContext(publish, head, env = process.env) {
  if (
    publish &&
    (env.GITHUB_ACTIONS !== 'true' ||
      env.GITHUB_REPOSITORY !== repository ||
      env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      env.GITHUB_REF !== 'refs/heads/master' ||
      env.GITHUB_SHA !== head)
  ) {
    throw new Error(
      'Live publishing requires an explicit Release dispatch on rpamis/comet master.',
    );
  }
}

async function requestJson(url, body, method = body ? 'POST' : 'GET') {
  const isGithub = new URL(url).hostname === 'api.github.com';
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(isGithub && process.env.GH_TOKEN
        ? { Authorization: `Bearer ${process.env.GH_TOKEN}` }
        : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status === 404 && !body) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}

function runCommand(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export async function checkReleaseCandidate(options, services = {}) {
  const { root, version, publish = false, env = process.env } = options;
  const run = services.run ?? ((args) => runCommand('git', args, root));
  const request = services.request ?? requestJson;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '')) {
    throw new Error('Specify a stable version such as --version 0.5.4 (without v).');
  }
  const readJson = async (file) => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
  const pkg = await readJson('package.json');
  const assets = await readJson('assets/manifest.json');
  const codex = await readJson('plugin/codex/plugin.json');
  const market = await readJson('.agents/plugins/marketplace.json');
  if (
    [
      pkg.version,
      assets.version,
      codex.version,
      market.plugins.find((item) => item.name === 'comet')?.source.version,
    ].some((item) => item !== version)
  ) {
    throw new Error(`Package, assets, Codex plugin and marketplace must all use ${version}.`);
  }
  const head = await run(['rev-parse', 'HEAD']);
  assertReleaseContext(publish, head, env);
  if (await run(['status', '--porcelain', '--untracked-files=no'])) {
    throw new Error('Release candidate has tracked changes. Use a clean checkout.');
  }
  const changelog = await fs.readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
  const { previousTag } = composeReleaseNotes(changelog, version, '');
  await run(['merge-base', '--is-ancestor', `refs/tags/${previousTag}`, head]);
  const existingTag = await run(['tag', '--list', version]);
  if (existingTag && (await run(['rev-parse', `refs/tags/${version}^{commit}`])) !== head) {
    throw new Error(`Tag ${version} points to a different commit.`);
  }
  const runs = await request(
    `${github}/actions/workflows/ci.yml/runs?head_sha=${head}&branch=master&event=push&per_page=1`,
  );
  const ci = runs?.workflow_runs?.[0];
  if (ci?.head_sha !== head || ci.status !== 'completed' || ci.conclusion !== 'success') {
    throw new Error(`Wait for successful master CI on ${head} before releasing.`);
  }
  const release = await request(`${github}/releases/tags/${version}`);
  if (release && !release.draft && !existingTag)
    throw new Error('Published release is missing its Git tag.');
  const generated = await request(`${github}/releases/generate-notes`, {
    tag_name: version,
    target_commitish: head,
    previous_tag_name: previousTag,
  });
  const { body } = composeReleaseNotes(changelog, version, generated.body);
  return { version, head, previousTag, body, release, ciUrl: ci.html_url };
}

export async function prepareReleasePackages(directory, candidate, services = {}) {
  const { root, version, head } = candidate;
  const { resolveNpmCommand } = await import(
    pathToFileURL(path.join(root, 'dist/platform/process/node-cli-command.js')).href
  );
  const runNpm =
    services.runNpm ??
    (async (args, cwd = root) => {
      const command = resolveNpmCommand(args, { cwd });
      return runCommand(command.command, command.args, cwd);
    });
  const pack = async (cwd) => {
    const output = await runNpm(
      ['pack', '--json', '--ignore-scripts', '--pack-destination', directory],
      cwd,
    );
    const [item] = JSON.parse(output.slice(output.search(/\[\s*\{/u)));
    return { name: item.name, tarball: path.join(directory, item.filename) };
  };
  const main = await pack(root);
  const mainRoot = path.join(directory, 'main');
  await fs.mkdir(mainRoot);
  runCommand('tar', ['-xzf', main.tarball, '-C', mainRoot], root);
  const mainPackage = path.join(mainRoot, 'package');
  // Convert only the staged README files; preview and publishing leave the checkout untouched.
  const { README_FILES, transformReadmeForNpm } = await import('./npm-readme.mjs');
  const packedFiles = new Set(await fs.readdir(mainPackage));
  for (const readme of README_FILES.filter((item) => packedFiles.has(item.path))) {
    const file = path.join(mainPackage, readme.path);
    const result = transformReadmeForNpm(await fs.readFile(file, 'utf8'), readme.playLabel);
    if (result.skipped) throw new Error(`Unregistered npm README media: ${readme.path}`);
    await fs.writeFile(file, result.content);
  }
  // Old local plugin builds must not be nested inside the main npm package.
  for (const relative of ['dist/codex-plugin', 'dist/dsh-plugin']) {
    await fs.rm(path.join(mainPackage, relative), { recursive: true, force: true });
  }
  await fs.mkdir(path.join(mainPackage, 'scripts/release'), { recursive: true });
  await fs.copyFile(
    path.join(root, 'scripts/release/prepare.js'),
    path.join(mainPackage, 'scripts/release/prepare.js'),
  );
  const { buildCodexPlugin } = await import('../build/build-codex-plugin.mjs');
  const { buildDshPlugin } = await import('../build/build-dsh-plugin.mjs');
  const codex = await buildCodexPlugin({
    outputRoot: path.join(directory, 'codex'),
    language: 'zh',
  });
  const dsh = await buildDshPlugin({ outputRoot: path.join(directory, 'dsh'), language: 'zh' });
  const packages = [];
  for (const [packageRoot, name] of [
    [mainPackage, '@rpamis/comet'],
    [codex.pluginRoot, '@rpamis/comet-codex-plugin'],
    [dsh.pluginRoot, 'comet-dsh-plugin'],
  ]) {
    const file = path.join(packageRoot, 'package.json');
    const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
    if (
      metadata.name !== name ||
      metadata.version !== version ||
      (name === 'comet-dsh-plugin' && metadata.dependencies?.['@rpamis/comet'] !== version)
    ) {
      throw new Error(`Built package does not match ${name}@${version}.`);
    }
    // npm's standard source commit field also lets a rerun recognize completed publishes.
    await fs.writeFile(file, JSON.stringify({ ...metadata, gitHead: head }, null, 2) + '\n');
    packages.push(await pack(packageRoot));
  }
  return { packages, runNpm };
}

export async function publishRelease(options, services = {}) {
  const request = services.request ?? requestJson;
  const candidate = await checkReleaseCandidate(options, { ...services, request });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-release-'));
  try {
    const prepare = services.prepare ?? prepareReleasePackages;
    const { packages, runNpm } = await prepare(directory, { ...candidate, root: options.root });
    const results = await publishPackages(
      packages,
      { ...candidate, directory, publish: options.publish },
      {
        request,
        runNpm,
        wait: services.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      },
    );
    const summary = `## ${options.publish ? 'Published' : 'Preview'} ${candidate.version}\n\nCommit: ${candidate.head}\n\nCI: ${candidate.ciUrl}\n\n${results.map((item) => `- ${item.name}: ${item.status}`).join('\n')}\n\n${candidate.body}`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
    if (options.publish && (!candidate.release || candidate.release.draft)) {
      const body = {
        tag_name: candidate.version,
        target_commitish: candidate.head,
        name: candidate.version,
        body: candidate.body,
        draft: false,
        prerelease: false,
      };
      const release = candidate.release
        ? await request(`${github}/releases/${candidate.release.id}`, body, 'PATCH')
        : await request(`${github}/releases`, body);
      console.log(`Release: ${release.html_url}`);
    }
    return { ...candidate, packages: results };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') {
      console.log(
        'Usage: node scripts/release/publish-release.mjs --version <x.y.z> [--publish]\nDefaults to preview. Live publishing is restricted to the master Release workflow.',
      );
    } else {
      if (
        args[0] !== '--version' ||
        !args[1] ||
        args.length > 3 ||
        (args[2] && args[2] !== '--publish')
      ) {
        throw new Error('Usage: publish-release.mjs --version <x.y.z> [--publish]');
      }
      await publishRelease({
        root: process.cwd(),
        version: args[1],
        publish: args[2] === '--publish',
      });
    }
  } catch (error) {
    console.error(error.stderr?.toString() || error.message);
    process.exitCode = 1;
  }
}

export async function publishPackages(packages, options, services) {
  const { version, head, directory, publish } = options;
  const { request, runNpm, wait } = services;
  const items = [];
  const inspect = async (item) => {
    const metadata = await request(`${registry}${encodeURIComponent(item.name)}/${version}`);
    if (metadata && (metadata.version !== version || metadata.gitHead !== head)) {
      throw new Error(
        `${item.name}@${version} already belongs to ${metadata.gitHead ?? 'an unknown commit'}; expected ${head}.`,
      );
    }
    return metadata;
  };
  // Inspect all existing versions before the first irreversible publish.
  for (const item of packages) {
    const existing = await inspect(item);
    const latest = await request(`${registry}${encodeURIComponent(item.name)}/latest`);
    const latestParts = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/
      .exec(latest?.version ?? '')
      ?.slice(1)
      .map(Number);
    const parts = version.split('.').map(Number);
    const difference = latestParts
      ?.map((part, index) => part - parts[index])
      .find((part) => part !== 0);
    if (difference > 0) {
      throw new Error(
        `${item.name} latest is already ${latest.version}; refusing to release older ${version}.`,
      );
    }
    items.push({ ...item, status: existing ? 'published' : 'pending' });
  }
  if (!publish) return items;
  for (const item of items) {
    if (item.status === 'pending') {
      console.log(`Publishing ${item.name}@${version}`);
      await runNpm([
        'publish',
        item.tarball,
        '--access',
        'public',
        '--tag',
        'latest',
        '--registry',
        registry,
        '--ignore-scripts',
      ]);
      let metadata;
      for (let attempt = 0; attempt < 6; attempt++) {
        metadata = await inspect(item);
        if (metadata) break;
        if (attempt < 5) await wait(5_000);
      }
      if (!metadata)
        throw new Error(
          `${item.name}@${version} is not visible on public npm yet. Rerun after checking npm.`,
        );
    }
    const [download] = JSON.parse(
      await runNpm([
        'pack',
        `${item.name}@${version}`,
        '--registry',
        registry,
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        directory,
      ]),
    );
    if (download.name !== item.name || download.version !== version) {
      throw new Error(`Downloaded package does not match ${item.name}@${version}.`);
    }
    item.status = 'verified';
  }
  return items;
}
