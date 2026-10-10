import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getNpmExecutable } from '../../dist/domains/integrations/openspec.js';
import { quoteArgsForShell } from '../../dist/platform/process/shell-quote.js';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed with ${result.signal ?? result.status}`);
}

let fixtureRoot;
try {
  let packageRoot = process.env.COMET_TEST_OPENSPEC_PACKAGE;
  if (!packageRoot) {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-openspec-package-'));
    const home = path.join(fixtureRoot, 'home');
    await fs.mkdir(home);
    const userConfig = path.join(home, '.npmrc');
    const globalConfig = path.join(home, 'global.npmrc');
    await fs.writeFile(userConfig, '');
    await fs.writeFile(globalConfig, '');
    const args = [
      'install',
      '--prefix',
      fixtureRoot,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '@fission-ai/openspec@1.11.0',
    ];
    run(getNpmExecutable(), process.platform === 'win32' ? quoteArgsForShell(args) : args, {
      timeout: 120000,
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, '.config'),
        OPENSPEC_TELEMETRY: '0',
        npm_config_cache: path.join(home, '.npm-cache'),
        npm_config_userconfig: userConfig,
        npm_config_globalconfig: globalConfig,
      },
    });
    packageRoot = path.join(fixtureRoot, 'node_modules', '@fission-ai', 'openspec');
  }
  run(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      'test/domains/comet-classic/classic-openspec-upstream.test.ts',
    ],
    {
      env: { ...process.env, COMET_TEST_OPENSPEC_PACKAGE: packageRoot },
    },
  );
} finally {
  if (fixtureRoot)
    await fs.rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
