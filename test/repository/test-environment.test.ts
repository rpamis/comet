import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it('keeps fixture and subprocess temporary roots physical when the inherited directory is an alias', async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'comet-test-environment-')),
  );
  try {
    const physical = path.join(root, 'physical');
    const alias = path.join(root, 'alias');
    await fs.mkdir(physical);
    await fs.symlink(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await fs.mkdir(path.join(root, 'test'));
    await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await fs.symlink(
      path.resolve('node_modules'),
      path.join(root, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await fs.writeFile(
      path.join(root, 'vitest.config.mjs'),
      `export default { test: { maxWorkers: 1, setupFiles: [${JSON.stringify(path.resolve('test/helpers/runtime-home.ts'))}] } };`,
    );
    await fs.writeFile(
      path.join(root, 'test/roots.test.ts'),
      `import {expect,it} from 'vitest'; import fs from 'node:fs'; import os from 'node:os'; import{execFileSync}from'node:child_process';
it('physical fixture roots', () => {
  expect(os.tmpdir()).toBe(fs.realpathSync.native(os.tmpdir()));
  expect(process.env.COMET_DATA_DIR).toBe(fs.realpathSync.native(process.env.COMET_DATA_DIR));
  const child = JSON.parse(execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify({temp:require("node:os").tmpdir(),data:process.env.COMET_DATA_DIR}))'], {encoding:'utf8'}));
  expect(child).toEqual({temp:os.tmpdir(),data:process.env.COMET_DATA_DIR});
});`,
    );
    const vitest = path.join(
      path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
      'vitest.mjs',
    );
    const result = spawnSync(
      process.execPath,
      [vitest, 'run', '--root', root, '--config', path.join(root, 'vitest.config.mjs')],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, TMPDIR: alias, TEMP: alias, TMP: alias },
      },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
