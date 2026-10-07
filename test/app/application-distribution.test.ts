import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { createDiskApplication } from '../helpers/workflow-application.js';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';

const repositoryRoot = path.resolve('.');
const cli = path.join(repositoryRoot, 'bin/comet.js');
const execute = promisify(execFile);
const roots: string[] = [];
beforeAll(() => ensureCliBuilt(repositoryRoot));
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it('previews, distributes, cold-starts, upgrades and uninstalls an application through the public CLI', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-application-distribution-'));
  roots.push(root);
  const source = await createDiskApplication(root);
  await fs.cp(source.skillRoot, path.join(source.packageRoot, 'skills/writer'), {
    recursive: true,
  });
  source.manifest.skills[0].root = 'skills/writer';
  await fs.writeFile(source.file, JSON.stringify(source.manifest));
  const project = path.join(root, 'consumer');
  await fs.mkdir(project);
  const invoke = async (...args: string[]) => {
    const { stdout } = await execute(process.execPath, [cli, ...args, '--json'], {
      cwd: repositoryRoot,
      timeout: 30000,
      env: { ...process.env, HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home') },
    });
    return JSON.parse(stdout);
  };
  const distribute = [
    'application',
    'distribute',
    source.file,
    '--project',
    project,
    '--platform',
    'cursor',
    '--platform',
    'workbuddy',
  ];
  const preview = await invoke(...distribute, '--preview');
  expect(preview.platforms.map(({ id }: { id: string }) => id)).toEqual(['cursor', 'workbuddy']);
  expect(await fs.readdir(project)).toEqual([]);
  const first = await invoke(...distribute, '--confirmation-hash', preview.confirmationHash);
  const request = path.join(root, 'request.json');
  await fs.writeFile(
    request,
    JSON.stringify({
      operation: 'start',
      runId: 'cold',
      workflow: { id: 'editorial', version: '1' },
      input: { topic: 'CLI report' },
    }),
  );
  const started = await invoke(
    'runtime',
    'dispatch',
    '--application',
    'editorial',
    '--project-root',
    project,
    '--request',
    request,
    '--details',
  );
  expect(started.status).toBe('succeeded');
  expect(started.application.packageRoot).toBe(path.dirname(first.file));
  source.manifest.version = '2';
  await fs.writeFile(source.file, JSON.stringify(source.manifest));
  const upgrade = await invoke(...distribute, '--upgrade');
  const second = await invoke(
    ...distribute,
    '--upgrade',
    '--confirmation-hash',
    upgrade.confirmationHash,
  );
  expect(second.file).not.toBe(first.file);
  const uninstall = ['application', 'uninstall', 'editorial', '--project', project];
  const removal = await invoke(...uninstall);
  await invoke(...uninstall, '--confirmation-hash', removal.confirmationHash);
  await expect(fs.stat(path.join(project, '.cursor/skills/editorial'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await expect(
    fs.stat(path.join(project, '.workbuddy/skills/writer/scripts/run.mjs')),
  ).resolves.toBeDefined();
  await fs.writeFile(request, JSON.stringify({ operation: 'inspect', runId: 'cold' }));
  const restored = await invoke(
    'runtime',
    'dispatch',
    '--application',
    'editorial',
    '--project-root',
    project,
    '--request',
    request,
    '--details',
  );
  expect(restored.status).toBe('succeeded');
  expect(restored.application.packageRoot).toBe(path.dirname(first.file));
});
