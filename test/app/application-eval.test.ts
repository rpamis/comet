import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';
import { createDiskApplication } from '../helpers/workflow-application.js';

const execute = promisify(execFile);
const repository = path.resolve('.');
const roots: string[] = [];
beforeAll(() => ensureCliBuilt(repository));
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-cli-app-eval-'));
  roots.push(root);
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  return { root, env: { ...process.env, HOME: home, USERPROFILE: home } };
}
async function cli(root: string, env: NodeJS.ProcessEnv, ...args: string[]) {
  return execute(process.execPath, [path.join(repository, 'bin/comet.js'), ...args], {
    cwd: root,
    env,
    timeout: 30000,
  });
}

it('collects the actual SDK application through the CLI without starting models or generating cases', async () => {
  const { root, env } = await workspace();
  const app = await createDiskApplication(root);
  await fs.cp(app.skillRoot, path.join(app.packageRoot, 'skills/writer'), { recursive: true });
  app.manifest.skills[0].root = 'skills/writer';
  await fs.writeFile(app.file, JSON.stringify(app.manifest));
  const preview = JSON.parse(
    (
      await cli(
        root,
        env,
        'eval',
        app.file,
        '--project',
        root,
        '--collect',
        '--agent',
        'codex',
        '--model',
        'fixture-model',
      )
    ).stdout,
  );
  expect(preview).toMatchObject({
    noModelsStarted: true,
    application: { id: 'editorial' },
    settings: { agent: 'codex', model: 'fixture-model' },
    taskCount: { min: 2, max: 4 },
  });
  expect(preview.workflows[0].steps).toContain('draft');
  expect(await fs.stat(path.join(root, '.comet/eval/generated')).catch(() => null)).toBeNull();
});

it('starts the new Creator workflow with non-sensitive Eval configuration', async () => {
  const { root, env } = await workspace();
  const config = path.join(root, 'eval-config.json');
  await fs.writeFile(
    config,
    JSON.stringify({ agent: 'codex', model: 'fixture-model', maxTurns: 6 }),
  );
  const summary = JSON.parse(
    (
      await cli(
        root,
        env,
        'creator',
        'start',
        'new-eval',
        '--project',
        root,
        '--goal',
        '报告审批',
        '--install-target',
        'output',
        '--eval-config',
        config,
        '--json',
      )
    ).stdout,
  );
  expect(summary.actions[0].stepId).toBe('analyze');
  const { createCreatorRuntime } = await import('../../domains/workflow-creation/index.js');
  const run = await createCreatorRuntime(root).inspect('new-eval');
  expect(run.workflow.version).toBe('2');
  expect(run.input).toMatchObject({
    evaluation: { agent: 'codex', model: 'fixture-model', maxTurns: 6 },
  });
});

it('rejects credential-bearing Eval configuration before creating a Run', async () => {
  const { root, env } = await workspace();
  const config = path.join(root, 'invalid-config.json');
  await fs.writeFile(config, JSON.stringify({ agent: 'codex', apiKey: 'fixture-value' }));
  await expect(
    cli(
      root,
      env,
      'creator',
      'start',
      'invalid-eval',
      '--project',
      root,
      '--goal',
      '报告审批',
      '--install-target',
      'output',
      '--eval-config',
      config,
      '--json',
    ),
  ).rejects.toMatchObject({ code: 1 });
  expect(await fs.stat(path.join(root, '.comet/runtime/creator')).catch(() => null)).toBeNull();
});
