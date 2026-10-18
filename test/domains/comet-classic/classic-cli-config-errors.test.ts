import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { createClassicCommandRunner } from '../../../domains/comet-classic/classic-script-entry.js';
import { classicStateCommand } from '../../../domains/comet-classic/classic-state-command.js';
import { requireFileSymlink } from '../../helpers/file-symlink.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-cli-config-error-'));
  await fs.mkdir(path.join(root, '.git'));
  await fs.mkdir(path.join(root, '.comet'));
  await fs.mkdir(path.join(root, 'src'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function config(field: string): string {
  return `schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n  ${field}\n`;
}

it.each([
  ['review_mode: ""', 'classic.review_mode must be off, standard, or thorough'],
  ['review_mode: noisy', 'classic.review_mode must be off, standard, or thorough'],
  ['language: zh', 'classic.language must be en or zh-CN'],
  ['language: pirate', 'classic.language must be en or zh-CN'],
])('keeps configuration failure exit 1 during project discovery: %s', async (field, message) => {
  await fs.writeFile(path.join(root, '.comet/config.yaml'), config(field));
  for (const run of [
    runClassicCli,
    (args: string[], _handlers: unknown, options: { invocationCwd: string }) =>
      createClassicCommandRunner('state', classicStateCommand)(args, options),
  ]) {
    for (const cwd of [root, path.join(root, 'src')]) {
      for (const json of [false, true]) {
        const result = await run(
          [
            'state',
            'init',
            'invalid-config',
            'full',
            '--runtime',
            'compat',
            ...(json ? ['--json'] : []),
          ],
          undefined,
          { invocationCwd: cwd },
        );
        expect(result.exitCode).toBe(1);
        if (json) expect(JSON.parse(result.stdout!).stderr).toContain(message);
        else expect(result.stderr).toContain(message);
      }
    }
  }
  await expect(fs.access(path.join(root, 'openspec/changes/invalid-config'))).rejects.toMatchObject(
    {
      code: 'ENOENT',
    },
  );
});

it('keeps malformed nearest-project YAML fail-closed instead of using the parent', async () => {
  await fs.writeFile(path.join(root, '.comet/config.yaml'), config('language: en'));
  const child = path.join(root, 'src');
  await fs.mkdir(path.join(child, '.comet'));
  await fs.writeFile(path.join(child, '.comet/config.yaml'), 'schema: [');
  const result = await runClassicCli(
    ['state', 'init', 'invalid-config', 'full', '--runtime', 'compat'],
    undefined,
    { invocationCwd: child },
  );
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('Invalid .comet/config.yaml');
  await expect(fs.access(path.join(root, 'openspec'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('does not classify an unsafe configuration path as a validation error', async (context) => {
  await requireFileSymlink(context);
  const target = path.join(root, 'external-config.yaml');
  await fs.writeFile(target, config('language: en'));
  await fs.symlink(target, path.join(root, '.comet/config.yaml'), 'file');
  const result = await runClassicCli(
    ['state', 'init', 'unsafe-config', 'full', '--runtime', 'compat'],
    undefined,
    { invocationCwd: root },
  );
  expect(result.exitCode).toBe(70);
  expect(result.stderr).toMatch(/symbolic|symlink|link/i);
  await expect(fs.access(path.join(root, 'openspec'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('keeps unexpected handler errors at exit 70 even when their message resembles validation', async () => {
  const result = await runClassicCli(
    ['state', 'init', 'unexpected', 'full'],
    {
      state: async () => {
        throw new Error('classic.language must be en or zh-CN');
      },
    },
    { invocationCwd: root },
  );
  expect(result.exitCode).toBe(70);
});
