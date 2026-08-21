import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ExternalCommandError,
  runExternalCommand,
} from '../../platform/process/external-command.js';

describe('external command provider', () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  it('returns bounded command output without a shell', () => {
    expect(
      runExternalCommand(process.execPath, ['-e', 'process.stdout.write("ready")'], {
        timeoutMs: 5_000,
      }),
    ).toBe('ready');
  });

  it('writes configured input to child stdin', () => {
    expect(
      runExternalCommand(
        process.execPath,
        [
          '-e',
          "process.stdin.setEncoding('utf8'); let input = ''; process.stdin.on('data', (chunk) => { input += chunk; }); process.stdin.on('end', () => process.stdout.write(input));",
        ],
        { input: 'hello from stdin', timeoutMs: 5_000 },
      ),
    ).toBe('hello from stdin');
  });

  it('preserves stderr in a typed failure', () => {
    expect(() =>
      runExternalCommand(
        process.execPath,
        ['-e', 'process.stderr.write("failed safely"); process.exit(2)'],
        { timeoutMs: 5_000 },
      ),
    ).toThrowError(ExternalCommandError);
    expect(() =>
      runExternalCommand(
        process.execPath,
        ['-e', 'process.stderr.write("failed safely"); process.exit(2)'],
        { timeoutMs: 5_000 },
      ),
    ).toThrow('failed safely');
  });

  it.runIf(process.platform === 'win32')(
    'resolves and executes a Windows command shim from PATH',
    async () => {
      tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-external-command-'));
      await fs.writeFile(path.join(tempRoot, 'probe.cmd'), '@echo off\r\necho %1\r\n', 'utf8');

      expect(
        runExternalCommand('probe', ['ready'], {
          cwd: tempRoot,
          env: {
            ...process.env,
            PATH: tempRoot,
            PATHEXT: '.CMD',
          },
        }),
      ).toContain('ready');
    },
  );
});
