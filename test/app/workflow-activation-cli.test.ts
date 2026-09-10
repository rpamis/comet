import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../domains/comet-native/native-config.js';
import { writeWorkflowGlobalConfig } from '../../domains/workflow-contract/global-config.js';
import { isolatedBenchmarkEnvironment } from '../../scripts/benchmark/runtime-coldstart-benchmark.mjs';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';

const repositoryRoot = path.resolve('.');
const publicCli = path.join(repositoryRoot, 'bin/comet.js');
const fullCli = path.join(repositoryRoot, 'dist/app/cli/index.js');
const temporary: string[] = [];

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-activation-cli-'));
  temporary.push(root);
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  await fs.mkdir(home);
  await fs.mkdir(project);
  const env = isolatedBenchmarkEnvironment(home);
  const initialized = spawnSync('git', ['init', project], {
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
  expect(initialized.status, initialized.stderr).toBe(0);
  return { root, home, project, env };
}

function run(cli: string, project: string, env: NodeJS.ProcessEnv, extra: string[] = ['--json']) {
  const result = spawnSync(
    process.execPath,
    [cli, 'workflow', 'resolve', '.', '--activate', ...extra],
    {
      cwd: project,
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function walk(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else files[path.relative(root, file)] = (await fs.readFile(file)).toString('base64');
    }
  }
  await walk(root);
  return files;
}

describe('built workflow activation fast path', () => {
  beforeAll(async () => {
    await ensureCliBuilt(repositoryRoot);
  }, 120_000);
  afterEach(async () => {
    await Promise.all(
      temporary.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
    );
  });

  it('matches the full facade on configured projects and does not mutate their files', async () => {
    const { project, env } = await fixture();
    await writeProjectConfig(project, defaultProjectConfig('docs', 'en'));
    const before = await snapshot(project);
    for (const extra of [
      ['--json'],
      [],
      ['--task', 'Inspect the project', '--json'],
      ['--help'],
      ['--unknown'],
    ]) {
      const actual = run(publicCli, project, env, extra);
      const expected = run(fullCli, project, env, extra);
      if (extra.includes('--task')) {
        expect(actual.stderr).toContain('Comet context:');
        // Each context delivery owns a fresh application receipt.
        for (const result of [actual, expected]) {
          result.stderr = result.stderr.replace(
            /application:[a-f0-9-]{36}/gu,
            'application:<receipt>',
          );
        }
      }
      expect(actual).toEqual(expected);
    }
    expect(await snapshot(project)).toEqual(before);
  }, 30_000);

  it.each(['broken: [', 'schema: comet.project.v1\ndefault_workflow: native\n'])(
    'preserves failure exit/output and files for malformed or incomplete config: %s',
    async (config) => {
      const { project, env } = await fixture();
      await fs.mkdir(path.join(project, '.comet'));
      await fs.writeFile(path.join(project, '.comet/config.yaml'), config);
      const before = await snapshot(project);
      const result = run(publicCli, project, env);
      expect(result).toEqual(run(fullCli, project, env));
      expect(result.status).not.toBe(0);
      expect(await snapshot(project)).toEqual(before);
    },
  );

  it('uses the full activation path to materialize Native roots and the installed platform Hook', async () => {
    for (const cli of [publicCli, fullCli]) {
      const { home, project, env } = await fixture();
      const config = defaultProjectConfig('artifacts', 'en');
      config.workflows = ['native'];
      await writeWorkflowGlobalConfig(home, { ...config, schema: 'comet.global.v1' });
      const installedRouter = path.join(home, '.agents/skills/comet/scripts/comet-hook-router.mjs');
      await fs.mkdir(path.dirname(installedRouter), { recursive: true });
      await fs.mkdir(path.join(home, '.codex'));
      await fs.writeFile(installedRouter, '// installed global router\n');
      const result = run(cli, project, env);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        schema: 'comet.workflow-resolution.v1',
        workflow: 'native',
        skill: 'comet-native',
        source: 'global-config',
      });
      const router = path.join(project, '.agents/skills/comet/scripts/comet-hook-router.mjs');
      expect(await fs.readFile(router)).toEqual(
        await fs.readFile(
          path.join(repositoryRoot, 'assets/skills/comet/scripts/comet-hook-router.mjs'),
        ),
      );
      expect(
        (await fs.readFile(path.join(project, '.codex/hooks.json'), 'utf8')).replaceAll('\\', '/'),
      ).toContain(router.replaceAll('\\', '/'));
      expect(await fs.readdir(path.join(project, 'artifacts/comet'))).toEqual(
        expect.arrayContaining(['changes', 'specs']),
      );
      expect(await fs.readFile(path.join(project, '.comet/config.yaml'), 'utf8')).toContain(
        'default_workflow: native',
      );
    }
  }, 30_000);
});
