import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ExternalCommandError,
  runExternalCommand,
  runExternalCommandAsync,
} from '../../platform/process/external-command.js';

describe('external command provider', () => {
  let tempRoot: string | undefined;

  it('keeps timers responsive while an asynchronous child is running', async () => {
    let completed = false;
    const probe = runExternalCommandAsync(
      process.execPath,
      ['-e', 'setTimeout(() => process.stdout.write("ready"), 300)'],
      { timeoutMs: 5000 },
    ).then((value) => {
      completed = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(completed).toBe(false);
    await expect(probe).resolves.toBe('ready');
  });

  it('bounds an asynchronous probe and kills the timed-out child', async () => {
    await expect(
      runExternalCommandAsync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        timeoutMs: 50,
      }),
    ).rejects.toMatchObject({ name: 'ExternalCommandError', timedOut: true });
  });

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

  it('marks a timed-out child process in the typed failure', () => {
    try {
      runExternalCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], {
        timeoutMs: 20,
      });
      throw new Error('Expected the child process to time out');
    } catch (error) {
      expect(error).toBeInstanceOf(ExternalCommandError);
      expect((error as ExternalCommandError).timedOut).toBe(true);
    }
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
