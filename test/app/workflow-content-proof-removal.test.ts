import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';

beforeAll(() => ensureCliBuilt(path.resolve('.')), 180_000);

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it.each(['native', 'classic'])(
  'rejects retired %s content-proof commands without creating workflow state',
  async (workflow) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-content-proof-'));
    roots.push(root);
    const home = path.join(root, 'home');
    await fs.mkdir(home);
    const before = await fs.readdir(root);
    for (const operation of ['observe', 'prepare', 'record', 'refresh-checks']) {
      const result = spawnSync(
        process.execPath,
        [
          path.resolve('bin/comet.js'),
          'edit-review',
          operation,
          workflow,
          'demo',
          '--project-root',
          root,
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, HOME: home, USERPROFILE: home, XDG_DATA_HOME: home },
          windowsHide: true,
        },
      );
      expect(result.status, result.stderr).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
      expect(result.stdout).toContain('内容证明协议已移除');
      expect(await fs.readdir(root)).toEqual(before);
    }
  },
);

it('rejects retired Native snapshot proof through the generated command bundle', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-content-proof-'));
  roots.push(root);
  const result = spawnSync(
    process.execPath,
    [
      path.resolve('assets/skills/comet-native/scripts/comet-native-spec.mjs'),
      'snapshot',
      'demo',
      '--project-root',
      root,
      '--json',
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain('内容证明快照已移除');
  expect(await fs.readdir(root)).toEqual([]);
});
