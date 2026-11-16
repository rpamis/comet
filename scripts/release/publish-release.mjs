#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'rpamis/comet';
const registry = 'https://registry.npmjs.org/';
const github = `https://api.github.com/repos/${repository}`;
const packageNames = ['@rpamis/comet', '@rpamis/comet-codex-plugin', 'comet-dsh-plugin'];

// Read-only inspection of staging records; finalize verifies public versions directly.
function isReleaseRun(run) {
  return (
    run?.repository?.full_name === repository &&
    run.head_branch === 'master' &&
    run.event === 'workflow_dispatch' &&
    run.path === '.github/workflows/release.yml' &&
    /^[a-f0-9]{40}$/.test(run.head_sha ?? '')
  );
}

export async function findReleaseRun({ version }, services = {}) {
  const request = services.request ?? requestJson;
  const published = await request(
    `${registry}${encodeURIComponent('@rpamis/comet')}/${encodeURIComponent(version)}`,
  );
  if (published?.version !== version || !/^[a-f0-9]{40}$/.test(published.gitHead ?? '')) {
    throw new Error(
      `Approve @rpamis/comet@${version} on npm before inspecting its staging record; the original commit is required for this lookup.`,
    );
  }
  for (let page = 1; ; page++) {
    const result = await request(
      `${github}/actions/workflows/release.yml/runs?head_sha=${published.gitHead}&branch=master&event=workflow_dispatch&status=completed&per_page=100&page=${page}`,
    );
    for (const run of result.workflow_runs) {
      if (!isReleaseRun(run) || run.head_sha !== published.gitHead) continue;
      const saved = await request(`${github}/actions/runs/${run.id}/artifacts?per_page=100`);
      if (saved.artifacts.some((item) => item.name === 'comet-release-stage' && !item.expired)) {
        return String(run.id);
      }
    }
    if (result.workflow_runs.length < 100) break;
  }
  throw new Error(
    `No saved staging record for ${version} at ${published.gitHead}. Check the original stage run and artifact retention.`,
  );
}

export async function resolveReleaseSource(options, services = {}) {
  const { action = 'preview', sourceRunId, env = process.env } = options;
  if (!['preview', 'stage', 'finalize'].includes(action))
    throw new Error('Unknown release action.');
  if (action !== 'finalize') return env.GITHUB_SHA;
  if (!/^\d+$/.test(sourceRunId ?? '')) throw new Error('Finalize requires a source run ID.');
  const run = await (services.request ?? requestJson)(`${github}/actions/runs/${sourceRunId}`);
  if (!isReleaseRun(run)) {
    throw new Error('Invalid release source run. Select the original master Release run.');
  }
  return run.head_sha;
}

export function validateStageReceipt(receipt, expected) {
  if (
    receipt?.schema !== 'comet.release-stage.v1' ||
    receipt.version !== expected.version ||
    receipt.head !== expected.head ||
    receipt.runId !== expected.runId ||
    typeof receipt.body !== 'string' ||
    !Array.isArray(receipt.packages) ||
    receipt.packages.some(
      (item) =>
        !packageNames.includes(item.name) ||
        !['submitting', 'staged', 'published'].includes(item.status) ||
        (item.status === 'staged' && typeof item.stageId !== 'string'),
    )
  ) {
    throw new Error('Stage receipt does not match the original release run, version and commit.');
  }
  return receipt;
}

function formatReleaseNotes(body) {
  const lines = body.replaceAll('\r\n', '\n').split('\n');
  const result = [];
  let fence;
  for (const [index, line] of lines.entries()) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
      result.push(line);
    } else if (!fence && /^#{1,6}\s+\S/.test(line)) {
      if (result.at(-1)?.trim()) result.push('');
      result.push(line);
      if (lines[index + 1]?.trim()) result.push('');
    } else result.push(line);
  }
  return result.join('\n');
}

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
    body: formatReleaseNotes([changes, details, ending].filter(Boolean).join('\n\n') + '\n'),
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
  const { root, version, action = 'preview', env = process.env } = options;
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
  assertReleaseContext(action !== 'preview', head, env);
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
  let release = await request(`${github}/releases/tags/${version}`);
  // The by-tag endpoint only returns published releases. Authenticated listing
  // also exposes drafts whose tag has not been created yet.
  if (!release) {
    for (let page = 1; ; page++) {
      const releases = await request(`${github}/releases?per_page=100&page=${page}`);
      release = releases.find((item) => item.draft && item.tag_name === version);
      if (release || releases.length < 100) break;
    }
  }
  if (release && !release.draft && !existingTag)
    throw new Error('Published release is missing its Git tag.');
  const generated = await request(`${github}/releases/generate-notes`, {
    tag_name: version,
    target_commitish: head,
    previous_tag_name: previousTag,
  });
  const { body } = composeReleaseNotes(changelog, version, generated.body);
  return { version, head, previousTag, body, release };
}

async function createNpmRunner(root) {
  const { resolveNpmCommand } = await import(
    pathToFileURL(path.join(root, 'dist/platform/process/node-cli-command.js')).href
  );
  return async (args, cwd = root) => {
    const command = resolveNpmCommand(args, { cwd });
    return runCommand(command.command, command.args, cwd);
  };
}

async function preparePublishedPackages(_directory, { root }) {
  return {
    packages: packageNames.map((name) => ({ name })),
    runNpm: await createNpmRunner(root),
  };
}

export async function prepareReleasePackages(directory, candidate, services = {}) {
  const { root, version, head } = candidate;
  const runNpm = services.runNpm ?? (await createNpmRunner(root));
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
  const action = options.action ?? 'preview';
  const env = options.env ?? process.env;
  const candidate = await checkReleaseCandidate(options, { ...services, request });
  const receiptPath = options.receiptPath ?? path.join(options.root, '.tmp/release/stage.json');
  let receipt;
  if (action === 'stage') {
    const runId = env.GITHUB_RUN_ID;
    if (!runId) throw new Error('Missing original Release run ID.');
    if (services.receipt) receipt = services.receipt;
    else {
      try {
        receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        receipt = {
          schema: 'comet.release-stage.v1',
          version: candidate.version,
          head: candidate.head,
          runId,
          body: candidate.body,
          packages: [],
        };
      }
    }
    validateStageReceipt(receipt, { ...candidate, runId });
  }
  const save =
    services.save ??
    (async () => {
      await fs.mkdir(path.dirname(receiptPath), { recursive: true });
      await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-release-'));
  try {
    const prepare =
      services.prepare ??
      (action === 'finalize' ? preparePublishedPackages : prepareReleasePackages);
    const { packages, runNpm } = await prepare(directory, { ...candidate, root: options.root });
    const results = await publishPackages(
      packages,
      { ...candidate, directory, action, receipt },
      {
        request,
        runNpm,
        save,
      },
    );
    const summary = `## ${action} ${candidate.version}\n\nCommit: ${candidate.head}\n\n${results.map((item) => `- ${item.name}: ${item.status}${item.stageId ? ` (${item.stageId})` : ''}`).join('\n')}\n\n${action === 'stage' ? `Approve the packages with npm 2FA, then start a new Release from master with action=finalize and version=${candidate.version}. Finalize verifies the public npm versions and announces that master commit.\n\n` : ''}${candidate.body}`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY)
      await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
    if (action === 'finalize' && (!candidate.release || candidate.release.draft)) {
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
        'Usage: node scripts/release/publish-release.mjs --version <x.y.z> [--action preview|stage|finalize]\nDefaults to preview. npm approval with 2FA is performed by the maintainer.',
      );
    } else {
      if (
        args[0] !== '--version' ||
        !args[1] ||
        (args.length !== 2 && args.length !== 4) ||
        (args[2] && (args[2] !== '--action' || !['preview', 'stage', 'finalize'].includes(args[3])))
      ) {
        throw new Error(
          'Usage: publish-release.mjs --version <x.y.z> [--action preview|stage|finalize]',
        );
      }
      await publishRelease({
        root: process.cwd(),
        version: args[1],
        action: args[3] ?? 'preview',
      });
    }
  } catch (error) {
    console.error(error.stderr?.toString() || error.message);
    process.exitCode = 1;
  }
}

export async function publishPackages(packages, options, services) {
  const { version, head, directory, action = 'preview', receipt } = options;
  const { request, runNpm, save = async () => {} } = services;
  const items = [];
  const inspect = async (item) => {
    const metadata = await request(`${registry}${encodeURIComponent(item.name)}/${version}`);
    if (metadata && metadata.version !== version) {
      throw new Error(`${item.name} returned version ${metadata.version}; expected ${version}.`);
    }
    if (metadata && action !== 'finalize' && metadata.gitHead !== head) {
      throw new Error(
        `${item.name}@${version} already belongs to ${metadata.gitHead ?? 'an unknown commit'}; expected ${head}.`,
      );
    }
    return metadata;
  };
  // Inspect all existing versions before the first irreversible publish.
  for (const item of packages) {
    const existing = await inspect(item);
    items.push({ ...item, status: existing ? 'published' : 'pending' });
    if (action === 'finalize') continue;
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
  }
  if (action === 'preview') return items;
  if (action === 'stage') {
    for (const item of items) {
      let saved = receipt.packages.find((entry) => entry.name === item.name);
      if (item.status === 'published') {
        if (saved) Object.assign(saved, { status: 'published' });
        else receipt.packages.push({ name: item.name, status: 'published' });
        await save();
        continue;
      }
      if (saved?.status === 'staged') {
        Object.assign(item, saved);
        continue;
      }
      if (saved)
        throw new Error(
          `${item.name} has an unknown staging result. Check npm before resubmitting.`,
        );
      saved = { name: item.name, status: 'submitting' };
      receipt.packages.push(saved);
      await save();
      const output = JSON.parse(
        await runNpm([
          'stage',
          'publish',
          item.tarball,
          '--access',
          'public',
          '--tag',
          'latest',
          '--registry',
          registry,
          '--ignore-scripts',
          '--json',
        ]),
      );
      // npm 11.21 emits either the package object or a package-name-keyed object.
      const staged = output[item.name] ?? output;
      if (staged.name !== item.name || staged.version !== version || !staged.stageId) {
        throw new Error(
          `npm stage publish did not return the expected name, version and stageId for ${item.name}.`,
        );
      }
      Object.assign(saved, { status: 'staged', stageId: staged.stageId });
      Object.assign(item, saved);
      await save();
      const line = `- ${item.name}@${version}: stage ID ${staged.stageId}\n`;
      console.log(line.trim());
      if (process.env.GITHUB_STEP_SUMMARY)
        await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, line);
    }
    return items;
  }
  if (action !== 'finalize') throw new Error('Unknown release action.');
  if (items.some((item) => item.status !== 'published')) {
    throw new Error(
      'Packages are still awaiting npm approval. Approve all staged versions with 2FA before finalizing.',
    );
  }
  for (const item of items) {
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
