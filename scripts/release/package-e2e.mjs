#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PLATFORMS, getPlatformSkillsDir } from '../../dist/platform/install/platforms.js';

const repositoryRoot = path.resolve('.');
const requiredPackageFiles = [
  'assets/manifest.json',
  'assets/skills/comet/SKILL.md',
  'assets/skills/comet/scripts/comet-entry-runtime.mjs',
  'assets/skills/comet/scripts/comet-hook-router.mjs',
  'assets/skills/comet/scripts/comet-runtime.mjs',
  'assets/skills/comet-native/SKILL.md',
  'assets/skills/comet-native/scripts/comet-native-runtime.mjs',
  'bin/comet.js',
  'dist/app/cli/index.js',
  'scripts/install/postinstall.js',
];
const requiredNativeInstallFiles = [
  'comet/SKILL.md',
  'comet/scripts/comet-entry-runtime.mjs',
  'comet/scripts/comet-hook-router.mjs',
  'comet-native/SKILL.md',
  'comet-native/scripts/comet-native-runtime.mjs',
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
    shell: process.platform === 'win32' && command === 'npm',
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${String(result.status)})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function parseJsonPayload(raw) {
  const sanitized = raw.replace(/\u001b\[[0-9;]*m/g, '').trim();
  const starts = [...sanitized.matchAll(/[\[{]/g)].map((match) => match.index).reverse();
  for (const start of starts) {
    try {
      return JSON.parse(sanitized.slice(start));
    } catch {
      // Lifecycle scripts may write non-JSON output before npm's final payload.
    }
  }
  throw new Error(`No JSON payload found in output:\n${raw}`);
}

async function assertFile(filePath, description) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`${description} is missing: ${filePath}`);
  }
}

async function main() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-package-e2e-'));
  try {
    const packageDir = path.join(temporaryRoot, 'package');
    const consumerDir = path.join(temporaryRoot, 'consumer');
    const projectDir = path.join(temporaryRoot, 'project');
    const homeDir = path.join(temporaryRoot, 'home');
    const npmCache = path.join(temporaryRoot, 'npm-cache');
    await Promise.all(
      [packageDir, consumerDir, projectDir, homeDir, npmCache].map((directory) =>
        fs.mkdir(directory, { recursive: true }),
      ),
    );

    const packOutput = run(
      'npm',
      ['pack', '--json', '--ignore-scripts=true', '--pack-destination', packageDir],
      { env: { ...process.env, npm_config_ignore_scripts: 'true' } },
    );
    const [packed] = parseJsonPayload(packOutput);
    if (!packed?.filename || !Array.isArray(packed.files)) {
      throw new Error(`npm pack returned an unexpected payload:\n${packOutput}`);
    }
    const packageFiles = new Set(packed.files.map((entry) => entry.path));
    for (const required of requiredPackageFiles) {
      if (!packageFiles.has(required)) {
        throw new Error(`Published tarball is missing required file: ${required}`);
      }
    }

    const tarball = path.join(packageDir, packed.filename);
    const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
    const packageName = packageJson.name;
    const packageRoot = path.join(consumerDir, 'node_modules', ...packageName.split('/'));
    const cli = path.join(packageRoot, 'bin', 'comet.js');
    const environment = {
      ...process.env,
      CI: 'true',
      COMET_NO_HINTS: '1',
      HOME: homeDir,
      USERPROFILE: homeDir,
      NPM_CONFIG_CACHE: npmCache,
      npm_config_cache: npmCache,
    };

    run('npm', ['init', '--yes'], { cwd: consumerDir, env: environment });
    run('npm', ['install', '--no-audit', '--no-fund', tarball], {
      cwd: consumerDir,
      env: environment,
    });
    await assertFile(cli, 'Installed Comet CLI');

    const version = run(process.execPath, [cli, '--version'], {
      cwd: consumerDir,
      env: environment,
    }).trim();
    if (version !== packageJson.version) {
      throw new Error(
        `Installed CLI version mismatch: expected ${packageJson.version}, got ${version}`,
      );
    }

    const init = parseJsonPayload(
      run(process.execPath, [cli, 'init', projectDir, '--yes', '--workflow', 'native', '--json'], {
        cwd: consumerDir,
        env: environment,
      }),
    );
    if (init.status !== 'complete' || !Array.isArray(init.results) || init.failures.length > 0) {
      throw new Error(
        `Packaged Native init did not complete successfully: ${JSON.stringify(init)}`,
      );
    }
    if (init.results.length !== PLATFORMS.length) {
      throw new Error(
        `Packaged Native init covered ${init.results.length} platforms; expected ${PLATFORMS.length}`,
      );
    }

    for (const result of init.results) {
      if (!['installed', 'skipped'].includes(result.comet)) {
        throw new Error(`${result.platform}: packaged Comet install status was ${result.comet}`);
      }
      const platform = PLATFORMS.find((candidate) => candidate.id === result.platform);
      if (!platform) throw new Error(`Unknown platform in init output: ${result.platform}`);
      const skillsRoot = path.join(projectDir, getPlatformSkillsDir(platform, 'project'), 'skills');
      for (const relative of requiredNativeInstallFiles) {
        await assertFile(path.join(skillsRoot, relative), `${platform.name} packaged Native asset`);
      }
    }

    const resolution = parseJsonPayload(
      run(process.execPath, [cli, 'workflow', 'resolve', projectDir, '--json'], {
        cwd: consumerDir,
        env: environment,
      }),
    );
    if (resolution.workflow !== 'native' || resolution.skill !== 'comet-native') {
      throw new Error(`Packaged workflow resolution failed: ${JSON.stringify(resolution)}`);
    }

    const doctor = parseJsonPayload(
      run(process.execPath, [cli, 'doctor', projectDir, '--scope', 'project', '--json'], {
        cwd: consumerDir,
        env: environment,
      }),
    );
    if (doctor.status === 'failed' || doctor.healthy === false) {
      throw new Error(`Packaged doctor reported an unhealthy install: ${JSON.stringify(doctor)}`);
    }

    console.log(
      `Packaged Comet ${version} installed and verified across ${PLATFORMS.length} Native platform targets.`,
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

await main();
