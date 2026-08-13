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
  'assets/skills/comet/scripts/comet-state.mjs',
  'assets/skills/comet-native/SKILL.md',
  'assets/skills/comet-native/scripts/comet-native-runtime.mjs',
  'assets/skills/comet-native/scripts/comet-native-new.mjs',
  'assets/skills/comet-native/scripts/comet-native-status.mjs',
  'bin/comet.js',
  'bin/fast-runtime-router.js',
  'dist/app/cli/index.js',
  'eval/schemas/comet.eval/v1alpha1.schema.json',
  'scripts/install/postinstall.js',
];
const requiredNativeInstallFiles = [
  'comet/SKILL.md',
  'comet/scripts/comet-entry-runtime.mjs',
  'comet/scripts/comet-hook-router.mjs',
  'comet-native/SKILL.md',
  'comet-native/scripts/comet-native-runtime.mjs',
  'comet-native/scripts/comet-native-new.mjs',
  'comet-native/scripts/comet-native-status.mjs',
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

async function disableCliFallback(packageRoot, relativePath) {
  const source = path.join(packageRoot, ...relativePath.split('/'));
  const disabled = `${source}.package-e2e-disabled`;
  await fs.rename(source, disabled);
}

async function main() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-package-e2e-'));
  try {
    const packageDir = path.join(temporaryRoot, 'package');
    const consumerDir = path.join(temporaryRoot, 'consumer');
    const projectDir = path.join(temporaryRoot, 'project');
    const classicProjectDir = path.join(temporaryRoot, 'classic-project');
    const homeDir = path.join(temporaryRoot, 'home');
    const npmCache = path.join(temporaryRoot, 'npm-cache');
    await Promise.all(
      [packageDir, consumerDir, projectDir, classicProjectDir, homeDir, npmCache].map((directory) =>
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

    const installedSkills = path.join(projectDir, '.agents', 'skills');
    const installedNativeNew = path.join(
      installedSkills,
      'comet-native',
      'scripts',
      'comet-native-new.mjs',
    );
    const installedNativeStatus = path.join(
      installedSkills,
      'comet-native',
      'scripts',
      'comet-native-status.mjs',
    );
    const installedEntryRuntime = path.join(
      installedSkills,
      'comet',
      'scripts',
      'comet-entry-runtime.mjs',
    );
    const installedHookRouter = path.join(
      installedSkills,
      'comet',
      'scripts',
      'comet-hook-router.mjs',
    );
    for (const [script, description] of [
      [installedNativeNew, 'Installed Native new runtime'],
      [installedNativeStatus, 'Installed Native status runtime'],
      [installedEntryRuntime, 'Installed Entry runtime'],
      [installedHookRouter, 'Installed Hook Router runtime'],
    ]) {
      await assertFile(script, description);
    }

    const createdChange = parseJsonPayload(
      run(
        process.execPath,
        [installedNativeNew, 'package-runtime-change', '--project-root', projectDir, '--json'],
        { cwd: projectDir, env: environment },
      ),
    );
    if (
      createdChange.command !== 'new' ||
      createdChange.exitCode !== 0 ||
      createdChange.data?.name !== 'package-runtime-change'
    ) {
      throw new Error(
        `Installed Native runtime could not create a change: ${JSON.stringify(createdChange)}`,
      );
    }

    const nativeStatus = parseJsonPayload(
      run(
        process.execPath,
        [installedNativeStatus, 'package-runtime-change', '--project-root', projectDir, '--json'],
        {
          cwd: projectDir,
          env: environment,
        },
      ),
    );
    if (
      nativeStatus.command !== 'status' ||
      nativeStatus.exitCode !== 0 ||
      nativeStatus.data?.name !== 'package-runtime-change' ||
      nativeStatus.data?.phase !== 'shape'
    ) {
      throw new Error(
        `Installed Native runtime returned an invalid status: ${JSON.stringify(nativeStatus)}`,
      );
    }

    const installedResolution = parseJsonPayload(
      run(process.execPath, [installedEntryRuntime, projectDir, '--json'], {
        cwd: projectDir,
        env: environment,
      }),
    );
    if (installedResolution.workflow !== 'native' || installedResolution.skill !== 'comet-native') {
      throw new Error(
        `Installed Entry runtime resolution failed: ${JSON.stringify(installedResolution)}`,
      );
    }

    const hookDecision = parseJsonPayload(
      run(
        process.execPath,
        [installedHookRouter, '--platform', 'github-copilot', '--project-root', projectDir],
        {
          cwd: projectDir,
          env: { ...environment, FILE_PATH: 'src/index.ts' },
        },
      ),
    );
    if (
      hookDecision.permissionDecision !== 'deny' ||
      !String(hookDecision.permissionDecisionReason).toLowerCase().includes('only allowed in build')
    ) {
      throw new Error(
        `Installed Hook Router did not block a Shape write: ${JSON.stringify(hookDecision)}`,
      );
    }

    await fs.mkdir(path.join(classicProjectDir, '.comet'), { recursive: true });
    await fs.mkdir(path.join(classicProjectDir, 'openspec'), { recursive: true });
    await fs.writeFile(
      path.join(classicProjectDir, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'classic:',
        '  artifact_layout: legacy',
        '',
      ].join('\n'),
    );
    await fs.writeFile(
      path.join(classicProjectDir, 'openspec', 'config.yaml'),
      'schema: spec-driven\n',
    );

    await Promise.all([
      disableCliFallback(packageRoot, 'dist/domains/comet-native/native-cli.js'),
      disableCliFallback(packageRoot, 'dist/domains/comet-entry/workflow-resolution.js'),
      disableCliFallback(packageRoot, 'dist/domains/comet-classic/classic-cli.js'),
    ]);

    const fastNativeStatus = parseJsonPayload(
      run(
        process.execPath,
        [cli, 'native', 'status', 'package-runtime-change', '--project-root', projectDir, '--json'],
        {
          cwd: consumerDir,
          env: environment,
        },
      ),
    );
    if (fastNativeStatus.command !== 'status' || fastNativeStatus.exitCode !== 0) {
      throw new Error(
        `CLI did not use the packaged Native fast runtime: ${JSON.stringify(fastNativeStatus)}`,
      );
    }

    const fastResolution = parseJsonPayload(
      run(process.execPath, [cli, 'workflow', 'resolve', projectDir, '--json'], {
        cwd: consumerDir,
        env: environment,
      }),
    );
    if (fastResolution.workflow !== 'native' || fastResolution.skill !== 'comet-native') {
      throw new Error(
        `CLI did not use the packaged Entry fast runtime: ${JSON.stringify(fastResolution)}`,
      );
    }

    const classicState = parseJsonPayload(
      run(process.execPath, [cli, 'state', 'init', 'package-classic-change', 'full', '--json'], {
        cwd: classicProjectDir,
        env: environment,
      }),
    );
    if (classicState.command !== 'state' || classicState.exitCode !== 0) {
      throw new Error(
        `CLI did not use the packaged Classic fast runtime: ${JSON.stringify(classicState)}`,
      );
    }

    console.log(
      `Packaged Comet ${version} installed, routed, and verified across ${PLATFORMS.length} Native platform targets.`,
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

await main();
