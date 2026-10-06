import { spawnSync } from 'child_process';
import path from 'path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';

const prepareScript = path.resolve('scripts/release/prepare.js');

describe('release prepare script', () => {
  it.each(['true', 'false'])('respects npm ignore-scripts=%s during pack', async (ignored) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-prepare-ignore-'));
    try {
      const bin = path.join(root, 'bin');
      await fs.mkdir(bin);
      await fs.writeFile(
        path.join(root, 'build.js'),
        "require('fs').writeFileSync('build-ran.txt','actual build invoked');\n",
      );
      const shim = path.join(bin, process.platform === 'win32' ? 'husky.cmd' : 'husky');
      await fs.writeFile(
        shim,
        process.platform === 'win32'
          ? '@echo off\necho actual hook setup invoked > hooks-ran.txt\n'
          : '#!/bin/sh\necho actual hook setup invoked > hooks-ran.txt\n',
      );
      await fs.chmod(shim, 0o755);
      const result = spawnSync(process.execPath, [prepareScript], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: bin + path.delimiter + process.env.PATH,
          HOME: root,
          USERPROFILE: root,
          npm_command: 'pack',
          NPM_COMMAND: 'pack',
          npm_config_ignore_scripts: ignored,
        },
      });
      expect(result.status, result.stdout + result.stderr).toBe(0);
      for (const file of ['build-ran.txt', 'hooks-ran.txt']) {
        if (ignored === 'true') await expect(fs.access(path.join(root, file))).rejects.toThrow();
        else expect(await fs.readFile(path.join(root, file), 'utf8')).toContain('actual');
      }
    } finally {
      expect(path.relative(os.tmpdir(), root).startsWith('comet-prepare-ignore-')).toBe(true);
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('skips prepare work during npm publish because prepublishOnly already builds', () => {
    const result = spawnSync(process.execPath, [prepareScript], {
      encoding: 'utf-8',
      env: { ...process.env, npm_command: 'publish', NPM_COMMAND: 'publish' },
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('skipped during npm publish');
  });
});
