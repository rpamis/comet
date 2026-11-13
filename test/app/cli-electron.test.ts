import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

it.each([false, true])(
  'runs the packaged dashboard CLI with Electron mode %s',
  async (electron) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet electron cli '));
    try {
      const entry = path.resolve('bin/comet.js');
      const script = [
        electron ? 'Object.defineProperty(process.versions, "electron", {value: "fixture"});' : '',
        `process.argv = ${JSON.stringify([process.execPath, entry, 'dashboard', root, '--json'])};`,
        `await import(${JSON.stringify(pathToFileURL(entry).href)});`,
      ].join('\n');
      const bootstrap = path.join(root, 'bootstrap.mjs');
      await fs.writeFile(bootstrap, script);
      const result = spawnSync(process.execPath, [bootstrap], {
        cwd: root,
        env: {
          ...process.env,
          HOME: root,
          USERPROFILE: root,
          COMET_DAEMON: 'off',
          COMET_NO_HINTS: '1',
        },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30_000,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).project.path).toBe(root);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
