import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  applicationDistributeCommand,
  applicationExportCommand,
  applicationInstallCommand,
  applicationUninstallCommand,
} from '../../app/commands/application.js';
import { createDiskApplication } from '../helpers/workflow-application.js';

let root: string;
let project: string;
let source: Awaited<ReturnType<typeof createDiskApplication>>;
const output = vi.spyOn(console, 'log').mockImplementation(() => {});
function result() {
  return JSON.parse(output.mock.calls.at(-1)![0]);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-application-command-'));
  project = path.join(root, 'consumer');
  await fs.mkdir(project);
  source = await createDiskApplication(root);
  await fs.cp(source.skillRoot, path.join(source.packageRoot, 'skills/writer'), {
    recursive: true,
  });
  source.manifest.skills[0].root = 'skills/writer';
  await fs.writeFile(source.file, JSON.stringify(source.manifest));
  output.mockClear();
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it('rejects a stale installation confirmation without writing files', async () => {
  const options = { project, platform: ['cursor'], json: true };
  await applicationDistributeCommand(source.file, { ...options, preview: true });
  const preview = result();
  expect(preview.platforms.map((platform: { id: string }) => platform.id)).toEqual(['cursor']);
  expect(await fs.readdir(project)).toEqual([]);
  await expect(
    applicationInstallCommand(source.file, { ...options, confirmationHash: 'stale' }),
  ).rejects.toThrow('安装预览已变化');
  expect(await fs.readdir(project)).toEqual([]);
});

it('installs, exports and selectively uninstalls the confirmed application', async () => {
  const options = { project, platform: ['cursor'] };
  await applicationInstallCommand(source.file, options);
  const preview = result();
  await applicationDistributeCommand(source.file, {
    ...options,
    confirmationHash: preview.confirmationHash,
  });
  const installed = result();
  expect(installed.contentHash).toBe(preview.contentHash);
  expect(
    await fs.readFile(path.join(project, '.cursor/skills/editorial/SKILL.md'), 'utf8'),
  ).toContain('editorial');
  const destination = path.join(root, 'export');
  await applicationExportCommand(source.file, destination, { project });
  expect(await fs.readFile(path.join(destination, 'application.json'), 'utf8')).toContain(
    'editorial',
  );
  await applicationUninstallCommand('editorial', { project });
  const removal = result();
  expect(removal.confirmationHash).toEqual(expect.any(String));
  await applicationUninstallCommand('editorial', {
    project,
    confirmationHash: removal.confirmationHash,
  });
  await expect(fs.stat(path.join(project, '.cursor/skills/editorial'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(await fs.readFile(path.join(destination, 'application.json'), 'utf8')).toContain(
    'editorial',
  );
  expect(await fs.readFile(path.join(project, '.cursor/skills/writer/SKILL.md'), 'utf8')).toContain(
    'Writer',
  );
});

it('keeps user-scope preview out of the project and does not write before confirmation', async () => {
  const userRoot = path.join(root, 'isolated-home');
  await applicationInstallCommand(source.file, {
    project,
    scope: 'user',
    userRoot,
    host: 'codex',
    upgrade: true,
  });
  expect(result()).toMatchObject({ scope: 'user', platforms: [{ id: 'codex' }] });
  expect(await fs.readdir(project)).toEqual([]);
  await expect(fs.stat(userRoot)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects conflicting and incomplete delivery options before creating targets', async () => {
  await expect(applicationDistributeCommand(source.file, { project })).rejects.toThrow(
    '至少需要一个',
  );
  await expect(
    applicationInstallCommand(source.file, { project, preview: true, confirmationHash: 'stale' }),
  ).rejects.toThrow('preview');
  await expect(
    applicationInstallCommand(source.file, { project, host: 'codex', platform: ['cursor'] }),
  ).rejects.toThrow('不能同时使用');
  await expect(
    applicationInstallCommand(source.file, { project, scope: 'invalid' as 'project' }),
  ).rejects.toThrow('scope 必须');
  expect(await fs.readdir(project)).toEqual([]);
});
