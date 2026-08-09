import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { spawnCommand } from '../../../platform/process/spawn-command.js';

describe('spawnCommand on Windows', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    root = undefined;
  });

  it.runIf(process.platform === 'win32')(
    'resolves PATH and PATHEXT case-insensitively for command shims',
    async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-spawn-command-'));
      await fs.writeFile(path.join(root, 'probe.cmd'), '@echo off\r\necho ready\r\n', 'utf8');
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: undefined,
        PATHEXT: undefined,
        SYSTEMROOT: undefined,
        Path: root,
        Pathext: '.CMD',
        SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT,
      };

      const child = spawnCommand('probe', [], { cwd: root, env });
      const [exitCode] = (await once(child, 'close')) as [number | null];

      expect(exitCode).toBe(0);
    },
  );

  it.runIf(process.platform === 'win32')(
    'rejects shell syntax in batch command arguments',
    async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-spawn-command-'));
      const batch = path.join(root, 'probe.cmd');
      await fs.writeFile(batch, '@echo off\r\n', 'utf8');

      expect(() => spawnCommand(batch, ['& whoami'], { cwd: root })).toThrow(
        'Windows batch check arguments must not contain shell syntax',
      );
    },
  );
});
