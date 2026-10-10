import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { requiredArtifactClosure } from '../../../domains/comet-classic/classic-artifact-requirements.js';
import { getNpmExecutable } from '../../../domains/integrations/openspec.js';
import { quoteArgsForShell } from '../../../platform/process/shell-quote.js';

const packages: Array<[string, string | undefined]> = [
  ['isolated OpenSpec 1.11.0', undefined],
  ...(process.env.COMET_TEST_OPENSPEC_PACKAGE
    ? [['provided OpenSpec', process.env.COMET_TEST_OPENSPEC_PACKAGE] as [string, string]]
    : []),
];
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe.each(packages)('real OpenSpec status from %s', (_label, configuredPackageRoot) => {
  let packageRoot = configuredPackageRoot ?? '';
  let fixtureRoot: string | undefined;
  beforeAll(async () => {
    if (configuredPackageRoot) return;
    // The product invokes an external CLI. Keep this pinned upstream test
    // package in an isolated fixture rather than in Comet's published dependencies.
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
    const result = spawnSync(
      getNpmExecutable(),
      process.platform === 'win32' ? quoteArgsForShell(args) : args,
      {
        encoding: 'utf8',
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
      },
    );
    expect(result.status, result.error?.message ?? result.stderr).toBe(0);
    packageRoot = path.join(fixtureRoot, 'node_modules', '@fission-ai', 'openspec');
  }, 130000);
  afterAll(async () => {
    if (fixtureRoot)
      await fs.rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  it('exposes skipped specs, transitive requirements and schema-optional design', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-upstream-'));
    roots.push(root);
    const change = path.join(root, 'openspec/changes/demo');
    await fs.mkdir(change, { recursive: true });
    await fs.writeFile(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
    await fs.writeFile(
      path.join(change, '.openspec.yaml'),
      'schema: spec-driven\nskip_specs: true\n',
    );
    await fs.writeFile(path.join(change, 'proposal.md'), '# Proposal\nPure refactor.\n');
    await fs.writeFile(path.join(change, 'tasks.md'), '- [ ] Refactor and test\n');
    const status = () => {
      const result = spawnSync(
        process.execPath,
        [path.join(packageRoot, 'bin/openspec.js'), 'status', '--change', 'demo', '--json'],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 30000,
          env: {
            ...process.env,
            HOME: root,
            USERPROFILE: root,
            XDG_CONFIG_HOME: path.join(root, 'config'),
            CI: 'true',
            DO_NOT_TRACK: '1',
            OPENSPEC_TELEMETRY: '0',
          },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout);
    };
    const first = requiredArtifactClosure(status());
    expect(first.find((item) => item.id === 'specs')?.status).toBe('skipped');
    expect(first.find((item) => item.id === 'design')?.status).toBe('ready');
    expect(first.find((item) => item.id === 'tasks')?.status).toBe('done');
    const schema = parse(
      await fs.readFile(path.join(packageRoot, 'schemas/spec-driven/schema.yaml'), 'utf8'),
    );
    schema.name = 'classic-optional';
    schema.artifacts.find((item: { id: string }) => item.id === 'tasks').requires = ['specs'];
    const schemaDir = path.join(root, 'openspec/schemas/classic-optional');
    await fs.mkdir(schemaDir, { recursive: true });
    await fs.writeFile(path.join(schemaDir, 'schema.yaml'), stringify(schema));
    await fs.writeFile(
      path.join(change, '.openspec.yaml'),
      'schema: classic-optional\nskip_specs: true\n',
    );
    expect(requiredArtifactClosure(status()).map((item) => item.id)).toEqual([
      'proposal',
      'specs',
      'tasks',
    ]);
  });
});
